"""快重试（quick retry）+ 进程级熔断器（provider_health）的回归测试。

覆盖：熔断器单元（阈值触发、沉底排序、HALF_OPEN 单探测、指数退避、非瞬态不计）、
快重试准入与行为（快速瞬态才重试；挂起/永久错误/预算耗尽绝不重试；每家最多 1 次；
链尾单家同样能重试；成功不留失败痕迹、失败只记一笔熔断）、Retry-After 处理、
首块总预算（约束后续家等待、耗尽禁快重试）、熔断集成（跨请求沉底、冷却恢复、
与 providers_override 共存、HALF_OPEN 探测互斥）、SSE 事件（快重试期间零事件、
耗尽后只发一次 terminal error）。

全部在内存里完成：把 llm_router.acompletion 换成脚本化的假实现。
"""
import time

import anyio
import httpx
import pytest
from litellm import exceptions as litellm_exceptions

from app.services import llm_router as router_module
from app.services import provider_health
from app.services.llm_router import LLMRouter

# ---- 假的 litellm 流式对象（与 test_llm_router_fallback 同一套最小实现） ----


class _Delta:
    def __init__(self, content=None, reasoning=None):
        self.content = content
        if reasoning is not None:
            self.reasoning_content = reasoning


class _Choice:
    def __init__(self, delta):
        self.delta = delta


class _Chunk:
    def __init__(self, content=None, reasoning=None, usage=None):
        has_delta = content is not None or reasoning is not None
        self.choices = [_Choice(_Delta(content, reasoning))] if has_delta else []
        self.usage = usage


class _Stream:
    def __init__(self, chunks=None, *, error=None, first_delay=0.0):
        self._chunks = list(chunks or [])
        self._error = error
        self._first_delay = first_delay
        self.closed = False

    async def _gen(self):
        if self._first_delay:
            await anyio.sleep(self._first_delay)
        for chunk in self._chunks:
            yield chunk
        if self._error is not None:
            raise self._error

    def __aiter__(self):
        return self._gen()

    async def aclose(self):
        self.closed = True


class _Message:
    def __init__(self, content):
        self.content = content


class _NonStreamResponse:
    def __init__(self, content):
        self.choices = [type("_C", (), {"message": _Message(content)})()]
        self.usage = None


# ---- 异常构造 ----

_HTTP_REQUEST = httpx.Request("POST", "https://example.invalid/v1/chat/completions")


def _gateway_error():
    return litellm_exceptions.BadGatewayError(
        message="bad gateway", llm_provider="openai", model="test-model"
    )


def _context_window_error():
    return litellm_exceptions.ContextWindowExceededError(
        message="This model's maximum context length is 8192 tokens",
        llm_provider="openai",
        model="test-model",
    )


def _content_policy_error():
    return litellm_exceptions.ContentPolicyViolationError(
        message="filtered", llm_provider="openai", model="test-model"
    )


def _payload_too_large_error():
    return litellm_exceptions.APIError(
        status_code=413, message="payload too large",
        llm_provider="openai", model="test-model",
    )


def _rate_limit_error(retry_after: str):
    response = httpx.Response(429, headers={"Retry-After": retry_after}, request=_HTTP_REQUEST)
    return litellm_exceptions.RateLimitError(
        message="rate limit", llm_provider="openai", model="test-model", response=response
    )


# ---- 装配 ----


def _install(monkeypatch, script):
    """按顺序消费 script（_Stream / _NonStreamResponse / 异常实例）替换 acompletion。"""
    pending = list(script)
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        behavior = pending.pop(0)
        if isinstance(behavior, BaseException):
            raise behavior
        return behavior

    fake.calls = calls
    monkeypatch.setattr(router_module, "acompletion", fake)
    return fake


def _router(count=2, cls=LLMRouter, **overrides):
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
    params = dict(
        default_model="test-model",
        max_tokens=128,
        timeout=120,
        first_token_timeout=5,
        # 抖动延迟清零：快重试立即执行，测试不等真时间（延迟语义由 Retry-After 用例覆盖）
        quick_retry_delay_ms=0,
    )
    params.update(overrides)
    return cls(providers_for_model=providers, **params)


def _run_stream(router, providers_override=None):
    """跑一遍流式调用，返回 (正文, 推理, 切换事件, 异常, 全部产出项)。"""

    async def _run():
        texts, reasonings, fallbacks, events, error = [], [], [], [], None
        try:
            async for item in router.chat_stream_with_stop(
                user_prompt="你好", providers_override=providers_override
            ):
                events.append(item)
                if isinstance(item, tuple):
                    if item[0] == "reasoning":
                        reasonings.append(item[1])
                    elif item[0] == "fallback":
                        fallbacks.append(item[1])
                else:
                    texts.append(item)
        except BaseException as exc:  # noqa: BLE001 - 测试需要拿到异常本身做断言
            error = exc
        return texts, reasonings, fallbacks, error, events

    return anyio.run(_run)


class _Clock:
    """可控单调时钟：整体替换 provider_health._now 做时间旅行。"""

    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(provider_health, "_now", c)
    return c


# ---- 1. 熔断器单元 ----


def test_breaker_opens_after_threshold_and_sinks_order():
    providers = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    provider_health.record_failure("a", _gateway_error())
    assert provider_health.is_open("a") is False  # 1 次还不够
    provider_health.record_failure("a", _gateway_error())
    assert provider_health.is_open("a") is True

    ordered = provider_health.apply_breaker_order(providers)
    assert [p["id"] for p in ordered] == ["b", "c", "a"]  # 熔断沉底，其余保持原顺序
    assert [p["id"] for p in providers] == ["a", "b", "c"]  # 不改传入列表


def test_breaker_ignores_non_transient_failures():
    """上下文超限/内容审核/413/模糊 400 是请求的问题，不计 Provider 健康。"""
    for _ in range(5):
        provider_health.record_failure("a", _context_window_error())
        provider_health.record_failure("a", _content_policy_error())
        provider_health.record_failure("a", _payload_too_large_error())
        provider_health.record_failure("a", litellm_exceptions.BadRequestError(
            message="odd provider failure", llm_provider="openai", model="test-model"
        ))
    assert provider_health.is_open("a") is False
    assert provider_health.snapshot().get("a", {}).get("failures", 0) == 0


def test_success_resets_state_and_order():
    provider_health.record_failure("a", _gateway_error())
    provider_health.record_failure("a", _gateway_error())
    assert provider_health.is_open("a") is True

    provider_health.record_success("a")
    assert provider_health.is_open("a") is False
    assert provider_health.snapshot()["a"]["failures"] == 0
    assert [p["id"] for p in provider_health.apply_breaker_order([{"id": "a"}, {"id": "b"}])] == ["a", "b"]


def test_half_open_allows_single_probe_and_success_closes(clock):
    provider_health.record_failure("a", _gateway_error())
    provider_health.record_failure("a", _gateway_error())
    clock.advance(31)  # 冷却结束 → HALF_OPEN

    assert provider_health.is_open("a") is False
    assert provider_health.claim_attempt("a") is True  # 第一个请求拿探测权
    assert provider_health.claim_attempt("a") is False  # 并发的第二个请求不让探

    provider_health.record_success("a")  # 探测成功
    assert provider_health.snapshot()["a"]["state"] == "closed"
    assert provider_health.claim_attempt("a") is True


def test_half_open_probe_failure_reopens_with_backoff(clock):
    provider_health.record_failure("a", _gateway_error())
    provider_health.record_failure("a", _gateway_error())
    assert provider_health.snapshot()["a"]["open_for"] == pytest.approx(30, abs=1)

    clock.advance(31)
    assert provider_health.claim_attempt("a") is True
    provider_health.record_failure("a", _gateway_error())  # 探测失败 → 再次 OPEN 并退避
    assert provider_health.snapshot()["a"]["open_for"] == pytest.approx(60, abs=1)


def test_backoff_caps_and_probe_claim_expires(clock):
    for _ in range(10):
        provider_health.record_failure("a", _gateway_error())
    assert provider_health.snapshot()["a"]["open_for"] <= provider_health.OPEN_MAX_SECONDS + 0.01

    clock.advance(provider_health.OPEN_MAX_SECONDS + 1)
    assert provider_health.claim_attempt("a") is True
    assert provider_health.claim_attempt("a") is False
    clock.advance(provider_health.PROBE_CLAIM_TTL_SECONDS + 1)  # 探测请求一去不回：TTL 自愈
    assert provider_health.claim_attempt("a") is True


# ---- 2. 快重试：准入与行为 ----


def test_quick_retry_recovers_and_stays_on_first_provider(monkeypatch):
    """快速 5xx：留在第一家快重试成功，不触碰第二家（验收 1）。"""
    fake = _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("快"), _Chunk("回来了")])])
    router = _router(count=2)

    started = time.monotonic()
    texts, _, fallbacks, error, _ = _run_stream(router)
    elapsed = time.monotonic() - started

    assert error is None
    assert "".join(texts) == "快回来了"
    assert elapsed < 2  # 验收：总耗时 < 2 秒
    assert fallbacks == []  # 没有切换，前端不知道发生过失败
    assert len(fake.calls) == 2  # 一次原调用 + 一次同家快重试
    assert router.provider_used["id"] == "prov_1"
    assert router.attempts == 1  # 尝试家数仍是 1 家
    assert router.quick_retries == 1
    assert router.attempt_errors == []  # 快重试成功不留失败痕迹


def test_quick_retry_recovers_non_stream(monkeypatch):
    """非流式（错因分析/标题）同样快重试恢复。"""
    fake = _install(monkeypatch, [_gateway_error(), _NonStreamResponse("快重试成功的回答")])
    router = _router(count=2)

    result = anyio.run(lambda: router.chat(user_prompt="题干", model="test-model"))

    assert result == "快重试成功的回答"
    assert len(fake.calls) == 2
    assert router.provider_used["id"] == "prov_1"
    assert router.quick_retries == 1
    assert router.attempt_errors == []


def test_hang_timeout_never_quick_retries(monkeypatch):
    """挂起超时是「失败得慢」：绝不原地重试，只等一次超时就切下一家（验收 2）。"""
    slow = _Stream([_Chunk("迟")], first_delay=3)
    fake = _install(monkeypatch, [slow, _Stream([_Chunk("备用家答复")])])
    router = _router(count=2, first_token_timeout=0.3)

    started = time.monotonic()
    texts, _, fallbacks, error, _ = _run_stream(router)
    elapsed = time.monotonic() - started

    assert error is None
    assert "".join(texts) == "备用家答复"
    assert fallbacks and fallbacks[0]["reason"] == "timeout"
    assert len(fake.calls) == 2  # 第二个 call 是备用家，不是快重试
    assert router.quick_retries == 0
    assert elapsed < 1.5  # 总等待只有一次 0.3s 超时，没有第二次干等


def test_quick_retry_exhausted_switches_and_records_single_failure(monkeypatch):
    """快重试也失败：切第二家，该家只记一笔熔断失败、一条失败摘要（验收 3）。"""
    fake = _install(monkeypatch, [
        _gateway_error(), _gateway_error(), _Stream([_Chunk("备用家答复")]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error, _ = _run_stream(router)

    assert error is None
    assert "".join(texts) == "备用家答复"
    assert fallbacks and fallbacks[0]["reason"] == "unavailable"
    assert len(fake.calls) == 3  # 首败 + 快重试 + 备用家
    assert router.quick_retries == 1
    assert router.attempts == 2  # 尝试家数：2 家（快重试不加家数）
    assert router.provider_used["id"] == "prov_2"
    assert len(router.attempt_errors) == 1  # 同家两次失败合并成一条
    assert "快重试后仍失败" in router.attempt_errors[0][1]
    assert provider_health.snapshot()["prov_1"]["failures"] == 1  # 熔断只记一笔


def test_quick_retry_at_most_once_per_provider(monkeypatch):
    """同一 Provider 每次调用快重试不超过 1 次（验收 4）。"""
    fake = _install(monkeypatch, [
        _gateway_error(), _gateway_error(), _Stream([_Chunk("备用家答复")]),
    ])
    router = _router(count=2)

    _run_stream(router)

    assert router.quick_retries == 1  # 第二次快速失败直接切，不再重试
    assert len(fake.calls) == 3


@pytest.mark.parametrize(
    "exc_factory",
    [_context_window_error, _content_policy_error, _payload_too_large_error],
    ids=["context-window", "content-policy", "payload-413"],
)
def test_permanent_errors_never_quick_retry(monkeypatch, exc_factory):
    """上下文超限/内容审核/413 从不快重试，也从不切下一家（验收 4）。"""
    fake = _install(monkeypatch, [exc_factory(), _Stream([_Chunk("不该到这")])])
    router = _router(count=2)

    _, _, fallbacks, error, _ = _run_stream(router)

    assert error is not None
    assert fallbacks == []
    assert len(fake.calls) == 1
    assert router.quick_retries == 0


def test_last_provider_also_gets_quick_retry(monkeypatch):
    """链尾单家没有下一家可切，快重试是唯一挽救：必须允许（修复点 B）。"""
    fake = _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("单家也救回来了")])])
    router = _router(count=1)

    texts, _, fallbacks, error, _ = _run_stream(router)

    assert error is None
    assert "".join(texts) == "单家也救回来了"
    assert fallbacks == []
    assert len(fake.calls) == 2
    assert router.quick_retries == 1
    assert router.provider_used["id"] == "prov_1"


def test_quick_retry_emits_no_events_before_recovery(monkeypatch):
    """流式快重试期间前端收不到任何事件，恢复后只有正常正文（验收 7）。"""
    _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("稳"), _Chunk("了")])])
    router = _router(count=2)

    texts, _, fallbacks, error, events = _run_stream(router)

    assert error is None
    assert events == ["稳", "了"]  # 除正文外什么都没发：无 fallback 通知、无 reasoning
    assert texts == ["稳", "了"] and fallbacks == []


def test_exhausted_quick_retry_raises_single_terminal_error(monkeypatch):
    """单家快重试耗尽：只抛一次异常（端点只发一条 terminal error），无 fallback 事件。"""
    fake = _install(monkeypatch, [_gateway_error(), _gateway_error()])
    router = _router(count=1)

    texts, _, fallbacks, error, events = _run_stream(router)

    assert isinstance(error, litellm_exceptions.BadGatewayError)
    assert texts == [] and fallbacks == [] and events == []
    assert len(fake.calls) == 2
    assert router.quick_retries == 1


def test_quick_retry_recovery_leaves_no_fallback_note(monkeypatch):
    """快重试成功没有发生切换：成功日志不挂「备用切换」尾注（修复点 C）。"""
    from app.routers.chat import _final_error_message

    _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("回来了")])])
    router = _router(count=2)
    _run_stream(router)

    assert router.attempt_errors == []
    assert _final_error_message(router, "success", "") == ""


# ---- 3. 首块总预算与 Retry-After ----


class _TimeoutSpyRouter(LLMRouter):
    """把每次建连实际使用的首块等待上限记下来，供断言预算收紧。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.seen_timeouts = []

    async def _open_stream(self, kwargs, first_token_timeout=None):
        self.seen_timeouts.append(first_token_timeout)
        return await super()._open_stream(kwargs, first_token_timeout=first_token_timeout)


def test_total_budget_blocks_quick_retry(monkeypatch):
    """首块总预算耗尽后禁止任何快重试（纯切换仍允许）。"""
    fake_now = [0.0]
    monkeypatch.setattr(router_module, "monotonic", lambda: fake_now[0])
    state = {"calls": 0}

    async def fake_acompletion(**kwargs):
        state["calls"] += 1
        if state["calls"] == 1:
            fake_now[0] += 0.1  # 这次失败花了 100ms，把 50ms 的总预算耗尽
            raise _gateway_error()
        return _NonStreamResponse("备用家答复")

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    router = _router(count=2, total_first_token_budget=0.05)

    result = anyio.run(lambda: router.chat(user_prompt="题干", model="test-model"))

    assert result == "备用家答复"
    assert state["calls"] == 2  # 第二个 call 是备用家，不是快重试
    assert router.quick_retries == 0


def test_budget_clamps_later_attempts_first_token_timeout(monkeypatch):
    """预算同时约束后续家的首块等待：第一家挂满后第二家只等剩余预算（修复点 F）。"""
    _install(monkeypatch, [
        _Stream([_Chunk("迟")], first_delay=3),
        _Stream([_Chunk("迟")], first_delay=3),
        _Stream([_Chunk("赶上了")]),
    ])
    router = _router(
        count=3, cls=_TimeoutSpyRouter, first_token_timeout=1.0,
        total_first_token_budget=1.2, fast_fail_ms=0,
    )

    texts, _, fallbacks, error, _ = _run_stream(router)

    assert error is None and "".join(texts) == "赶上了"
    assert len(fallbacks) == 2
    seen = router.seen_timeouts
    assert seen[0] == pytest.approx(1.0, abs=0.05)  # 第一家：min(首块上限, 预算)
    assert 0.05 <= seen[1] <= 0.35  # 第二家：只剩约 0.2s 预算
    assert seen[2] == pytest.approx(1.0, abs=0.05)  # 预算耗尽后仍给最小机会，纯切换不禁止


def test_quick_retry_uses_tightened_timeout(monkeypatch):
    """快重试的首块等待收紧到 quick_retry_timeout：第一次没扛住，第二次给更短预算。"""
    _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("回来了")])])
    router = _router(count=1, cls=_TimeoutSpyRouter, first_token_timeout=5, quick_retry_timeout=0.3)

    texts, _, _, error, _ = _run_stream(router)

    assert error is None and "".join(texts) == "回来了"
    assert router.seen_timeouts[0] == pytest.approx(5, abs=0.01)
    assert router.seen_timeouts[1] <= 0.31
    assert router.quick_retries == 1


def test_retry_after_within_limit_delays_quick_retry(monkeypatch):
    """Retry-After 在容许范围内：按它等待后同家快重试。"""
    _install(monkeypatch, [_rate_limit_error("0.2"), _Stream([_Chunk("限流过了")])])
    router = _router(count=1)

    started = time.monotonic()
    texts, _, _, error, _ = _run_stream(router)
    elapsed = time.monotonic() - started

    assert error is None and "".join(texts) == "限流过了"
    assert router.quick_retries == 1
    assert elapsed >= 0.2  # 等了 Retry-After，不是 0 延迟


def test_retry_after_beyond_limit_abandons_quick_retry(monkeypatch):
    """Retry-After 太长（30s）：放弃快重试直接切，不在单次请求里干等（修复点 G）。"""
    fake = _install(monkeypatch, [_rate_limit_error("30"), _Stream([_Chunk("备用家答复")])])
    router = _router(count=2)

    texts, _, fallbacks, error, _ = _run_stream(router)

    assert error is None and "".join(texts) == "备用家答复"
    assert fallbacks and fallbacks[0]["reason"] == "unavailable"
    assert len(fake.calls) == 2
    assert router.quick_retries == 0


# ---- 4. 熔断集成 ----


def test_breaker_sinks_failing_provider_for_later_requests(monkeypatch, clock):
    """两次被放弃的瞬态失败后，后续请求把这家沉底；冷却后恢复（验收 5）。"""
    fake = _install(monkeypatch, [
        _gateway_error(), _Stream([_Chunk("备用1")]),
        _gateway_error(), _Stream([_Chunk("备用2")]),
        _Stream([_Chunk("备用3")]),
    ])
    for expected in ("备用1", "备用2"):
        texts, *_ = _run_stream(_router(count=2, fast_fail_ms=0))
        assert "".join(texts) == expected

    assert provider_health.is_open("prov_1") is True

    router = _router(count=2, fast_fail_ms=0)  # 第三个请求
    assert [p["id"] for p in router.providers] == ["prov_2", "prov_1"]  # 熔断沉底
    assert router.breaker_skipped == 1
    texts, *_ = _run_stream(router)
    assert "".join(texts) == "备用3"
    assert len(fake.calls) == 5  # 第三个请求只调 1 次：prov_1 没再被撞

    clock.advance(31)  # 30s 冷却结束 → HALF_OPEN，恢复尝试
    assert provider_health.snapshot()["prov_1"]["state"] == "half_open"
    router = _router(count=2, fast_fail_ms=0)
    assert [p["id"] for p in router.providers] == ["prov_1", "prov_2"]
    assert provider_health.claim_attempt("prov_1") is True  # 放一个请求去探测
    assert provider_health.claim_attempt("prov_1") is False  # 其余请求仍不碰它


def test_breaker_sinks_open_provider_even_with_override(monkeypatch):
    """熔断与 providers_override 共存：override 顺序是基底，熔断中的仍沉底（验收 6）。"""
    router = _router(count=3, fast_fail_ms=0)
    provider_health.record_failure("prov_2", _gateway_error())
    provider_health.record_failure("prov_2", _gateway_error())

    # 模拟 visual_paper 的「上次失败的 prov_1 排到链尾」override：[prov_2, prov_3, prov_1]
    override = [router.providers[1], router.providers[2], router.providers[0]]
    _install(monkeypatch, [_Stream([_Chunk("第三家先上")]), _Stream([_Chunk("第一家先上")])])

    texts, *_ = _run_stream(router, providers_override=override)
    assert "".join(texts) == "第三家先上"  # prov_2 熔断沉底，override 基底里 prov_3 最先
    assert router.provider_used["id"] == "prov_3"
    assert router.breaker_skipped == 1

    texts, *_ = _run_stream(router, providers_override=[router.providers[0], router.providers[1], router.providers[2]])
    assert "".join(texts) == "第一家先上"  # override 基底顺序照旧生效
    assert router.provider_used["id"] == "prov_1"


def test_half_open_probe_claim_skips_concurrent_request(monkeypatch, clock):
    """HALF_OPEN 只放一个探测：已被别的请求占坑时，本请求直接跳过这家（修复点 E）。"""
    provider_health.record_failure("prov_1", _gateway_error())
    provider_health.record_failure("prov_1", _gateway_error())
    clock.advance(31)  # HALF_OPEN
    assert provider_health.claim_attempt("prov_1") is True  # 另一个请求先占了探测坑

    fake = _install(monkeypatch, [_Stream([_Chunk("备用家答复")])])
    router = _router(count=2, fast_fail_ms=0)
    texts, *_ = _run_stream(router)

    assert "".join(texts) == "备用家答复"
    assert len(fake.calls) == 1  # prov_1 没被尝试
    assert router.provider_used["id"] == "prov_2"
    assert router.breaker_skipped == 1  # 被探测占坑跳过也算熔断跳过


# ---- 5. 端点级：SSE 事件 ----


def test_stream_endpoint_quick_retry_emits_no_fallback_events(monkeypatch):
    """端点级：快重试静默完成，SSE 只有正文与 done（验收 7）。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.models import UsageCode
    from app.routers import chat as chat_router

    _install(monkeypatch, [_gateway_error(), _Stream([_Chunk("快重试后的答复")])])
    router = _router(count=2)  # 快重试开启（默认 fast_fail_ms=2000）
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: router)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=UsageCode(id=999_224, code="NBXU-QUICKRETRY-TEST", quota=3, used_count=0, is_enabled=True),
        reason="",
    )
    try:
        response = TestClient(app).post(
            "/api/chat/stream",
            json={"tool_id": "25", "input": "你好", "request_id": "quick_retry_endpoint_case"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: fallback" not in response.text
    assert "event: error" not in response.text
    assert "快重试后的答复" in response.text
    assert "event: done" in response.text