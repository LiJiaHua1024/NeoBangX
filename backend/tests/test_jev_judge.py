"""Jev 决策判定（错误重试）的回归测试。

覆盖：
1. 启发式回退与旧行为一致（默认切换；上下文超限与内容审核不切）；
2. Jev 可用时结论以 Jev 为准（可覆盖启发式）；
3. Jev 不可用（异常/超时/回包无法解析/未启用/未配齐）立刻回退启发式，不抛异常；
4. 空响应与超时走快车道，不消耗 Jev 调用；
5. 标题任务：Jev 优先、永久错误类不问 Jev、不可用回退；
6. Router 集成：Jev 判定期间不提前产生事件，全链失败只抛一次（前端只会收到一条 terminal error）。
"""
import anyio
import httpx
import pytest
from litellm import exceptions as litellm_exceptions

from app.services import jev_judge as jev_module
from app.services import llm_router as router_module
from app.services.jev_judge import (
    a_should_retry_provider,
    a_should_retry_title,
    heuristic_is_retryable,
    heuristic_is_title_retryable,
)
from app.services.llm_router import EmptyResponseError, LLMRouter, is_retryable

_HTTP_REQUEST = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
_HTTP_403 = httpx.Response(403, request=_HTTP_REQUEST)


def _auth_error():
    return litellm_exceptions.AuthenticationError(
        message="invalid api key", llm_provider="openai", model="test-model"
    )


def _context_window_error():
    return litellm_exceptions.ContextWindowExceededError(
        message="This model's maximum context length is 8192 tokens",
        llm_provider="openai",
        model="test-model",
    )


def _content_filter_error():
    return litellm_exceptions.BadRequestError(
        message="The response was filtered due to content policy",
        llm_provider="openai",
        model="test-model",
    )


def _gateway_error():
    return litellm_exceptions.BadGatewayError(
        message="bad gateway", llm_provider="openai", model="test-model"
    )


_JEV_ON = {
    "enabled": True,
    "base_url": "https://api.typesafe.ai/v1/systemone",
    "api_key": "test-key",
    "model": "jev-latest",
    "timeout": 5,
}
_JEV_OFF = {"enabled": False, "base_url": "", "api_key": "", "model": "", "timeout": 5}


def _fake_ask_factory(answers=None, error=None, calls=None):
    async def fake(jev_cfg, state, questions, **kwargs):
        if calls is not None:
            calls.append({"state": state, "questions": questions})
        if error is not None:
            raise error
        return answers

    return fake


# ---- 1. 启发式回退与旧行为一致 ----


@pytest.mark.parametrize(
    "name,exc,expected",
    [
        ("401 鉴权失败可切", _auth_error(), True),
        ("502 网关错误可切", _gateway_error(), True),
        ("空响应可切", EmptyResponseError("空"), True),
        ("上下文超限不切", _context_window_error(), False),
        ("内容过滤不切", _content_filter_error(), False),
    ],
)
def test_heuristic_matches_legacy_behavior(name, exc, expected):
    assert heuristic_is_retryable(exc) is expected, name
    # llm_router 同名入口保持委托一致
    assert is_retryable(exc) is expected, name


# ---- 2/3. Jev 优先与不可用回退 ----


def _provider_answers(*, overflow: float, filtered: float) -> dict:
    return {
        "is_context_overflow": {"noul": overflow},
        "is_content_filtered": {"noul": filtered},
    }


def _title_answers(*, transient: float, overflow: float = 0.05, filtered: float = 0.05, permanent: float = 0.05) -> dict:
    return {
        "is_transient": {"noul": transient},
        "is_context_overflow": {"noul": overflow},
        "is_content_filtered": {"noul": filtered},
        "is_permanent_request_error": {"noul": permanent},
    }


def test_jev_disabled_falls_back_to_heuristic(monkeypatch):
    calls = []
    monkeypatch.setattr(jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.01, filtered=0.01), calls=calls))
    # 未启用：即使 Jev 会判 False，启发式 True 仍生效，且不发请求
    assert anyio.run(a_should_retry_provider, _auth_error(), _JEV_OFF) is True
    assert anyio.run(a_should_retry_provider, _auth_error(), None) is True
    assert calls == []


def _ambiguous_400(text: str = "weird provider failure"):
    return litellm_exceptions.BadRequestError(
        message=text, llm_provider="openai", model="test-model"
    )


def test_jev_overrides_heuristic_when_available(monkeypatch):
    # 400 + 超限文案：启发式判 False，但 Jev 说两类否决都不成立 → 以 Jev 为准，切
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.05, filtered=0.05))
    )
    err = _ambiguous_400("This model's maximum context length is 8192 tokens")
    assert heuristic_is_retryable(err) is False
    assert anyio.run(a_should_retry_provider, err, _JEV_ON) is True
    # 400 + 普通文案：启发式判 True，但 Jev 确信是超限 → 不切
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.95, filtered=0.05))
    )
    err2 = _ambiguous_400("unsupported parameter")
    assert heuristic_is_retryable(err2) is True
    assert anyio.run(a_should_retry_provider, err2, _JEV_ON) is False


def test_jev_suppression_needs_confidence(monkeypatch):
    """拿不准（0.6 < 0.7 阈值）一律切；确信（0.75）才不切。400 才问 Jev，401 直接程序化。"""
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.6, filtered=0.1))
    )
    assert anyio.run(a_should_retry_provider, _ambiguous_400(), _JEV_ON) is True
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.1, filtered=0.75))
    )
    assert anyio.run(a_should_retry_provider, _ambiguous_400(), _JEV_ON) is False


def test_provider_certain_cases_skip_jev(monkeypatch):
    """精确可判定的不问 Jev：Jev mock 会爆炸，调了就失败。"""
    calls = []
    monkeypatch.setattr(
        jev_module,
        "a_ask_jev",
        _fake_ask_factory(error=AssertionError("must not be called"), calls=calls),
    )
    # 明确值得切：401 / 429 / 502
    assert anyio.run(a_should_retry_provider, _auth_error(), _JEV_ON) is True
    assert anyio.run(a_should_retry_provider, _gateway_error(), _JEV_ON) is True
    assert anyio.run(
        a_should_retry_provider,
        litellm_exceptions.RateLimitError(message="slow down", llm_provider="openai", model="test-model"),
        _JEV_ON,
    ) is True
    # 明确不切：超限类 / 审核类（类名精确命中；注意前者 status 也是 400，类检查优先）
    assert anyio.run(a_should_retry_provider, _context_window_error(), _JEV_ON) is False
    policy_err = litellm_exceptions.ContentPolicyViolationError(
        message="filtered", llm_provider="openai", model="test-model"
    )
    assert anyio.run(a_should_retry_provider, policy_err, _JEV_ON) is False
    # 413 请求体过大：请求的性质，与哪家无关
    big = litellm_exceptions.APIError(status_code=413, message="payload too large", llm_provider="openai", model="test-model")
    assert anyio.run(a_should_retry_provider, big, _JEV_ON) is False
    assert calls == []


def test_provider_ambiguous_400_asks_jev(monkeypatch):
    """400 必须看文案：会发请求，且发的是两道否决题。"""
    calls = []
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.05, filtered=0.05), calls=calls)
    )
    assert anyio.run(a_should_retry_provider, _ambiguous_400(), _JEV_ON) is True
    assert len(calls) == 1
    assert set(calls[0]["questions"]) == {"is_context_overflow", "is_content_filtered"}
    assert set(calls[0]["state"]) >= {"exception_class", "http_status", "error_message"}


def test_jev_error_falls_back_immediately(monkeypatch):
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(error=RuntimeError("boom"))
    )
    assert anyio.run(a_should_retry_provider, _auth_error(), _JEV_ON) is True
    assert anyio.run(a_should_retry_provider, _context_window_error(), _JEV_ON) is False


def test_jev_unparseable_response_falls_back(monkeypatch):
    monkeypatch.setattr(jev_module, "a_ask_jev", _fake_ask_factory({}))
    assert anyio.run(a_should_retry_provider, _auth_error(), _JEV_ON) is True
    # 缺一道题同样无法组合，回退
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory({"is_context_overflow": {"noul": 0.05}})
    )
    assert anyio.run(a_should_retry_provider, _auth_error(), _JEV_ON) is True


def test_jev_incomplete_config_falls_back(monkeypatch):
    calls = []
    monkeypatch.setattr(jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.0, filtered=0.0), calls=calls))
    # 启用了但缺 key：不发请求，直接启发式
    cfg = dict(_JEV_ON, api_key="")
    assert anyio.run(a_should_retry_provider, _auth_error(), cfg) is True
    assert calls == []


def test_fast_path_skips_jev(monkeypatch):
    calls = []
    monkeypatch.setattr(
        jev_module,
        "a_ask_jev",
        _fake_ask_factory(error=AssertionError("must not be called"), calls=calls),
    )
    assert anyio.run(a_should_retry_provider, EmptyResponseError("空"), _JEV_ON) is True
    assert anyio.run(a_should_retry_provider, TimeoutError("超时"), _JEV_ON) is True
    assert calls == []


# ---- 5. 标题任务 ----


def test_title_permanent_error_never_retries(monkeypatch):
    from app.services.title_jobs import TitleJobPermanentError

    calls = []
    monkeypatch.setattr(jev_module, "a_ask_jev", _fake_ask_factory(_title_answers(transient=0.99), calls=calls))
    assert anyio.run(a_should_retry_title, TitleJobPermanentError("nope"), _JEV_ON) is False
    assert calls == []


def test_title_jev_overrides_and_falls_back(monkeypatch):
    # 无状态码的通用异常：启发式拿它没办法，Jev 说瞬态 → 稍后重试
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_title_answers(transient=0.9))
    )
    assert anyio.run(a_should_retry_title, RuntimeError("upstream exploded"), _JEV_ON) is True
    # 400 类启发式判 False，Jev 不可用时保持 False
    bad_request = litellm_exceptions.BadRequestError(
        message="bad request", llm_provider="openai", model="test-model"
    )
    monkeypatch.setattr(jev_module, "a_ask_jev", _fake_ask_factory(error=TimeoutError("t")))
    assert anyio.run(a_should_retry_title, bad_request, _JEV_ON) is False
    assert heuristic_is_title_retryable(bad_request) is False


def test_title_certain_cases_skip_jev(monkeypatch):
    """标题任务精确可判定的不问 Jev：状态码表 + 自抛配置错误。"""
    calls = []
    monkeypatch.setattr(
        jev_module,
        "a_ask_jev",
        _fake_ask_factory(error=AssertionError("must not be called"), calls=calls),
    )
    denied = litellm_exceptions.PermissionDeniedError(
        message="no permission", model="test-model", llm_provider="openai", response=_HTTP_403
    )
    assert anyio.run(a_should_retry_title, denied, _JEV_ON) is False
    limited = litellm_exceptions.RateLimitError(message="slow", llm_provider="openai", model="test-model")
    assert anyio.run(a_should_retry_title, limited, _JEV_ON) is True
    assert anyio.run(a_should_retry_title, _gateway_error(), _JEV_ON) is True
    assert anyio.run(a_should_retry_title, RuntimeError("该模型未绑定任何可用 Provider"), _JEV_ON) is False
    assert calls == []


def test_title_uncertain_means_no_retry(monkeypatch):
    """标题任务拿不准就不重试：瞬态 0.5（不 > 0.5），或任一否决 0.5（不 < 0.5）。
    用无状态码的通用异常（502 这类精确的可直接程序化，根本到不了 Jev）。"""
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_title_answers(transient=0.5))
    )
    assert anyio.run(a_should_retry_title, RuntimeError("upstream exploded"), _JEV_ON) is False
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_title_answers(transient=0.9, permanent=0.5))
    )
    assert anyio.run(a_should_retry_title, RuntimeError("upstream exploded"), _JEV_ON) is False


# ---- 6. Router 集成：单次 terminal 语义 ----


class _Delta:
    def __init__(self, content=None):
        self.content = content


class _Choice:
    def __init__(self, delta):
        self.delta = delta


class _Chunk:
    def __init__(self, content=None):
        self.choices = [_Choice(_Delta(content))] if content is not None else []
        self.usage = None


class _Stream:
    def __init__(self, chunks=None):
        self._chunks = list(chunks or [])
        self.closed = False

    async def _gen(self):
        for chunk in self._chunks:
            yield chunk

    def __aiter__(self):
        return self._gen()

    async def aclose(self):
        self.closed = True


def _router(count=2, jev_config=None):
    providers = [
        {
            "id": f"prov_{index}",
            "name": f"通道{index}",
            "base_url": "",
            "api_key": "test-key",
            "enabled": True,
            "provider_model_id": "test-model",
        }
        for index in range(1, count + 1)
    ]
    return LLMRouter(
        providers_for_model=providers,
        default_model="test-model",
        max_tokens=128,
        timeout=120,
        first_token_timeout=5,
        jev_config=jev_config,
    )


def test_router_jev_no_retry_raises_once_without_fallback(monkeypatch):
    """Jev 判不切：只调一次上游、无 fallback 事件、异常只抛一次。
    用 400 模糊错误（401 这类精确的可直接程序化，根本到不了 Jev）。"""
    calls = []

    async def fake_acompletion(**kwargs):
        calls.append(kwargs)
        raise _ambiguous_400("odd provider failure")

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(_provider_answers(overflow=0.95, filtered=0.05))
    )
    router = _router(count=2, jev_config=_JEV_ON)

    async def _run():
        texts, fallbacks, error = [], [], None
        try:
            async for item in router.chat_stream_with_stop(user_prompt="你好"):
                if isinstance(item, tuple) and item[0] == "fallback":
                    fallbacks.append(item[1])
                elif isinstance(item, str):
                    texts.append(item)
        except BaseException as exc:  # noqa: BLE001
            error = exc
        return texts, fallbacks, error

    texts, fallbacks, error = anyio.run(_run)
    assert isinstance(error, litellm_exceptions.BadRequestError)
    assert texts == [] and fallbacks == []
    assert len(calls) == 1
    assert router.attempts == 1


def test_router_jev_unavailable_still_falls_back(monkeypatch):
    """Jev 挂了：400 模糊错误回退启发式判 True，照样切到备用家成功。"""
    pending = [_ambiguous_400("unsupported parameter"), _Stream([_Chunk("你"), _Chunk("好")])]

    async def fake_acompletion(**kwargs):
        behavior = pending.pop(0)
        if isinstance(behavior, BaseException):
            raise behavior
        return behavior

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    monkeypatch.setattr(
        jev_module, "a_ask_jev", _fake_ask_factory(error=TimeoutError("jev timeout"))
    )
    router = _router(count=2, jev_config=_JEV_ON)

    async def _run():
        texts, fallbacks, error = [], [], None
        try:
            async for item in router.chat_stream_with_stop(user_prompt="你好"):
                if isinstance(item, tuple) and item[0] == "fallback":
                    fallbacks.append(item[1])
                elif isinstance(item, str):
                    texts.append(item)
        except BaseException as exc:  # noqa: BLE001
            error = exc
        return texts, fallbacks, error

    texts, fallbacks, error = anyio.run(_run)
    assert error is None
    assert "".join(texts) == "你好"
    assert len(fallbacks) == 1
    assert router.provider_used["id"] == "prov_2"


def test_router_without_jev_config_unchanged(monkeypatch):
    """未配 Jev 的旧构造方式行为不变（纯启发式）。"""
    pending = [_auth_error(), _Stream([_Chunk("好")])]

    async def fake_acompletion(**kwargs):
        behavior = pending.pop(0)
        if isinstance(behavior, BaseException):
            raise behavior
        return behavior

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    router = _router(count=2)

    async def _run():
        texts, error = [], None
        try:
            async for item in router.chat_stream_with_stop(user_prompt="你好"):
                if isinstance(item, str):
                    texts.append(item)
        except BaseException as exc:  # noqa: BLE001
            error = exc
        return texts, error

    texts, error = anyio.run(_run)
    assert error is None and "".join(texts) == "好"


# ---- 7. 管理后台：配置校验、脱敏、测试接口 ----


def _reset_jev_rows():
    from app.database import SessionLocal
    from app.models import AppConfig

    defaults = {
        "jev_enabled": "false",
        "jev_base_url": "https://api.typesafe.ai/v1/systemone",
        "jev_api_key": "",
        "jev_model": "jev-latest",
        "jev_timeout": "4",
    }
    db = SessionLocal()
    try:
        for key, value in defaults.items():
            row = db.get(AppConfig, key)
            if row is None:
                db.add(AppConfig(key=key, value=value))
            else:
                row.value = value
        db.commit()
    finally:
        db.close()


def test_admin_jev_config_validation_and_masking():
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app

    client = TestClient(admin_app)
    try:
        # 启用但缺 Key → 400（按最终合并值判断）
        res = client.put(
            "/api/admin/config",
            json={"jev_enabled": True, "jev_base_url": "https://jev.example.invalid", "jev_model": "typesafe/jev"},
        )
        assert res.status_code == 400, res.text
        # 非法端点 → 400
        res = client.put("/api/admin/config", json={"jev_base_url": "ftp://x"})
        assert res.status_code == 400, res.text
        # 超时越界 → 422（pydantic 层拦截）
        res = client.put("/api/admin/config", json={"jev_timeout": 999})
        assert res.status_code == 422, res.text
        # 配齐 → 200，GET 回显脱敏 Key 与解析字段
        res = client.put(
            "/api/admin/config",
            json={
                "jev_enabled": True,
                "jev_base_url": "https://jev.example.invalid",
                "jev_api_key": "sk-test-1234567890",
                "jev_model": "custom/decision",
                "jev_timeout": 5,
            },
        )
        assert res.status_code == 200, res.text
        cfg = client.get("/api/admin/config").json()["config"]
        assert cfg["jev_enabled"] == "true"
        assert cfg["jev_base_url"] == "https://jev.example.invalid"
        assert cfg["jev_model"] == "custom/decision"
        assert cfg["jev_timeout"] == "5"
        assert "****" in cfg["jev_api_key"] and "1234567890" not in cfg["jev_api_key"]
        # 脱敏值回送 → 保持原密钥（更新其它字段时 Key 不变）
        masked = cfg["jev_api_key"]
        res = client.put("/api/admin/config", json={"jev_api_key": masked, "jev_timeout": 6})
        assert res.status_code == 200, res.text
        cfg2 = client.get("/api/admin/config").json()["config"]
        assert cfg2["jev_api_key"] == masked
        assert cfg2["jev_timeout"] == "6"
    finally:
        _reset_jev_rows()


def test_admin_jev_test_endpoint(monkeypatch):
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app

    async def fake_probe(jev_cfg):
        assert jev_cfg["model"] == "custom/decision"
        return True, 123

    monkeypatch.setattr(jev_module, "a_probe_jev", fake_probe)
    client = TestClient(admin_app)
    res = client.post(
        "/api/admin/jev/test",
        json={"base_url": "https://jev.example.invalid", "api_key": "k", "model": "custom/decision"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "ok" and res.json()["latency_ms"] == 123

    async def failing_probe(jev_cfg):
        raise RuntimeError("connect failed")

    monkeypatch.setattr(jev_module, "a_probe_jev", failing_probe)
    res = client.post("/api/admin/jev/test", json={"model": "x"})
    assert res.status_code == 502, res.text


def test_resolve_llm_settings_includes_jev_with_clamped_timeout():
    from app.database import SessionLocal
    from app.services.runtime_config import get_config_map, parse_jev_settings

    db = SessionLocal()
    try:
        from app.services.runtime_config import resolve_llm_settings

        cfg = resolve_llm_settings(db)
        jev = cfg["jev"]
        assert jev["model"] == "jev-latest"
        assert jev["base_url"] == "https://api.typesafe.ai/v1/systemone"
        assert 2 <= jev["timeout"] <= 30
        # 越界值被钳制
        raw = dict(get_config_map(db), jev_timeout="9999")
        assert parse_jev_settings(raw)["timeout"] == 30
        raw["jev_timeout"] = "not-a-number"
        assert parse_jev_settings(raw)["timeout"] == 4
    finally:
        db.close()
