"""报错解读（error_explain）的回归测试。

覆盖：
1. 机械分类与兜底文案：状态码 / 关键词各分支；关键词表与 jev_judge 同源不许漂；
2. 回包解析：两行契约、单行补建议、脏格式（列表符号 / 序号 / 标题符）也能读；
3. Chores 调用：成功即用；失败按「Jev + 机械兜底」决定要不要再试，最多 MAX_ATTEMPTS 次；
4. 兜底保证：Chores 不可用或一直失败时用户仍拿到中文解释（本模块永不抛异常）；
5. 缓存：同类错误只问一次；兜底文案缓存时间更短（Chores 可能只是临时抽风）；
6. 脱敏：链接与凭据不进 prompt（那正是上游原文不回传给用户的原因）；
7. 推理等级：模型默认 + 「工具推理规则 → Chores 工作 → 报错解读」覆盖，原样透传不硬编码。
"""
from pathlib import Path
from time import monotonic

import anyio
import pytest

from app.routers.tools import ERROR_EXPLAIN_TOOL_ID
from app.services import error_explain as module
from app.services.error_explain import (
    CODE_CONTENT_BLOCKED,
    CODE_CONTEXT_OVERFLOW,
    CODE_PROVIDER_AUTH,
    CODE_PROVIDER_BUSY,
    CODE_TIMEOUT,
    CODE_UNKNOWN,
    MAX_ATTEMPTS,
    TOTAL_BUDGET_SECONDS,
    classify_failure,
    explain_failure,
    mechanical_explanation,
    parse_explanation,
    sanitize_error_text,
)

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "报错解释.md"


class _FakeLLM:
    """按脚本回复的假 Chores 模型；脚本用尽后一直抛错。"""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def chat(self, **kwargs):
        self.calls.append(kwargs)
        if not self.replies:
            raise RuntimeError("假模型：没有更多回复")
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        return reply


class _HttpError(Exception):
    """带 HTTP 状态码的假异常（chat.py 的 helper 从异常里取状态码，不单独收 status 参数）。"""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@pytest.fixture(autouse=True)
def _clean_cache():
    module.clear_cache()
    yield
    module.clear_cache()


# ---------------- 1. 机械分类 ----------------


@pytest.mark.parametrize(
    "exc,status,expected",
    [
        (RuntimeError("This model's maximum context length is 8192 tokens"), None, CODE_CONTEXT_OVERFLOW),
        (RuntimeError("输入过长，请缩短后重试"), None, CODE_CONTEXT_OVERFLOW),
        (RuntimeError("response was filtered by content policy"), None, CODE_CONTENT_BLOCKED),
        (RuntimeError("违规内容，已被拦截"), None, CODE_CONTENT_BLOCKED),
        (RuntimeError("invalid api key"), 401, CODE_PROVIDER_AUTH),
        (RuntimeError("insufficient balance"), 402, CODE_PROVIDER_AUTH),
        (RuntimeError("slow down"), 429, CODE_PROVIDER_BUSY),
        (RuntimeError("bad gateway"), 502, CODE_PROVIDER_BUSY),
        (TimeoutError("read timeout"), None, CODE_TIMEOUT),
        (RuntimeError("something odd"), 408, CODE_TIMEOUT),
        (RuntimeError("something odd"), None, CODE_UNKNOWN),
    ],
)
def test_classify_failure(exc, status, expected):
    assert classify_failure(exc=exc, status=status, raw_message=str(exc)) == expected


def test_keyword_tables_stay_in_sync_with_jev():
    """分类用的关键词必须与 jev_judge「换谁都一样」那张表同源，否则两处会各判一套。"""
    from app.services.jev_judge import NON_RETRYABLE_KEYWORDS

    for marker in module._CONTEXT_MARKERS + module._FILTER_MARKERS:
        assert marker in NON_RETRYABLE_KEYWORDS, f"{marker} 不在 jev_judge 的关键词表里"


def test_mechanical_explanation_always_has_two_lines():
    for code in (CODE_CONTEXT_OVERFLOW, CODE_CONTENT_BLOCKED, CODE_PROVIDER_AUTH, CODE_PROVIDER_BUSY, CODE_TIMEOUT, CODE_UNKNOWN):
        item = mechanical_explanation(code)
        assert item.message and item.advice
        assert item.source == "fallback"
        assert item.code == code


# ---------------- 2. 回包解析 ----------------


def test_parse_two_lines():
    assert parse_explanation("材料太长了，模型一次读不完\n把原文拆成两段分别处理") == (
        "材料太长了，模型一次读不完",
        "把原文拆成两段分别处理",
    )


def test_parse_single_line_gets_generic_advice():
    message, advice = parse_explanation("模型服务暂时繁忙")
    assert message == "模型服务暂时繁忙"
    assert advice, "只有一行时要补一句通用建议，不能让错误卡空着第二行"


@pytest.mark.parametrize(
    "raw",
    [
        "- 材料太长了，模型一次读不完\n- 把原文拆成两段分别处理",
        "1. 材料太长了，模型一次读不完\n2. 把原文拆成两段分别处理",
        "## 材料太长了，模型一次读不完\n\n把原文拆成两段分别处理",
    ],
)
def test_parse_tolerates_markdown_noise(raw):
    message, _advice = parse_explanation(raw)
    assert message.startswith("材料太长了")


@pytest.mark.parametrize("raw", ["", "   ", "\n\n", "a", "哦"])
def test_parse_rejects_garbage(raw):
    assert parse_explanation(raw) is None


# ---------------- 6. 脱敏 ----------------


def test_sanitize_strips_links_and_credentials():
    raw = "upstream https://gw.example.com/v1/chat?trace=1 failed with key sk-abcdefgh12345678"
    out = sanitize_error_text(raw)
    assert "https://" not in out
    assert "sk-abcdefgh12345678" not in out
    assert "[链接已隐去]" in out and "[凭据已隐去]" in out


# ---------------- 提示词文件 ----------------


def test_prompt_file_exists_with_required_placeholders():
    text = PROMPT_PATH.read_text(encoding="utf-8")
    for name in ("user_input", "tool", "model", "stage", "status"):
        assert "{{%s}}" % name in text, f"提示词缺少占位符 {{{{{name}}}}}（chat.py 会传它）"


def test_prompt_file_keeps_output_contract_and_fallthrough():
    """提示词必须写明输出契约与「看不出原因时怎么办」——这两块掉了模型就会自由发挥。"""
    text = PROMPT_PATH.read_text(encoding="utf-8")
    assert "两行" in text
    assert "不要编造" in text
    assert "简体中文" in text


# ---------------- 3./4. Chores 调用与兜底 ----------------


def _explain(llm, **kwargs):
    return anyio.run(
        lambda: explain_failure(llm, "chores-model", prompt="PROMPT", **kwargs)
    )


def test_chores_success_is_used():
    llm = _FakeLLM(["材料太长了，模型一次读不完\n把原文拆成两段分别处理"])
    result = _explain(llm, exc=RuntimeError("maximum context length exceeded"))
    assert result.source == "chores"
    assert result.message == "材料太长了，模型一次读不完"
    assert result.advice == "把原文拆成两段分别处理"
    assert result.code == CODE_CONTEXT_OVERFLOW
    assert len(llm.calls) == 1
    assert llm.calls[0]["max_tokens"] and llm.calls[0]["model"] == "chores-model"


def test_retries_then_succeeds():
    """第一次抽风（未知错误 → 机械判定允许再试），第二次拿到回包。"""
    llm = _FakeLLM([RuntimeError("boom"), "模型服务暂时繁忙\n等一两分钟再试"])
    result = _explain(llm, exc=_HttpError("bad gateway"))
    assert result.source == "chores"
    assert len(llm.calls) == 2


def test_gives_up_after_max_attempts_then_falls_back():
    llm = _FakeLLM([RuntimeError("boom")] * (MAX_ATTEMPTS + 2))
    result = _explain(llm, exc=_HttpError("bad gateway"))
    assert len(llm.calls) == MAX_ATTEMPTS, "最多尝试 MAX_ATTEMPTS 次"
    assert result.source == "fallback"
    assert result.code == CODE_PROVIDER_BUSY
    assert result.message and result.advice


def test_permanent_error_does_not_retry():
    """Chores 报的是永久错误（401/403）时重试也没用：只试一次就走兜底。"""
    class _Unauthorized(Exception):
        status_code = 401

    llm = _FakeLLM([_Unauthorized("invalid api key")])
    result = _explain(llm, exc=RuntimeError("invalid api key"), status=401)
    assert len(llm.calls) == 1
    assert result.source == "fallback"
    assert result.code == CODE_PROVIDER_AUTH
    assert "管理员" in result.advice


def test_unparseable_reply_counts_as_failure():
    llm = _FakeLLM(["", "", ""])
    result = _explain(llm, exc=TimeoutError("read timeout"))
    assert len(llm.calls) == MAX_ATTEMPTS
    assert result.source == "fallback"
    assert result.code == CODE_TIMEOUT


def test_missing_llm_or_prompt_goes_straight_to_fallback():
    assert _explain(None, exc=RuntimeError("x"), status=429).source == "fallback"
    # 换个错误签名（chat.py 会把原文作为 raw_message 传进来，缓存键因此不同）
    empty_prompt = anyio.run(
        lambda: explain_failure(
            _FakeLLM([]), "m", prompt=None, exc=RuntimeError("y"), status=503, raw_message="y"
        )
    )
    assert empty_prompt.source == "fallback"
    assert empty_prompt.code == CODE_PROVIDER_BUSY


def test_never_raises_even_if_llm_raises_baseexception_subclass():
    class _Weird(Exception):
        pass

    llm = _FakeLLM([_Weird("odd")] * 5)
    result = _explain(llm, exc=_Weird("odd"))
    assert result.message and result.advice, "无论如何都要给用户一句话"


# ---------------- 5. 缓存 ----------------


def test_cache_hit_avoids_second_call():
    llm = _FakeLLM(["材料太长了，模型一次读不完\n把原文拆成两段分别处理"])
    first = _explain(llm, exc=RuntimeError("maximum context length exceeded"))
    second = _explain(llm, exc=RuntimeError("maximum context length exceeded"))
    assert first.source == "chores"
    assert second.source == "cache"
    assert len(llm.calls) == 1, "同类错误只问一次"


def test_fallback_cache_expires_sooner():
    llm = _FakeLLM([RuntimeError("boom")] * 10)
    _explain(llm, exc=_HttpError("bad gateway"))
    key = module.cache_key(CODE_PROVIDER_BUSY, _HttpError("bad gateway"), "")
    entry = module._CACHE[key]
    assert entry[1] == module.FALLBACK_CACHE_TTL_SECONDS
    assert entry[1] < module.CACHE_TTL_SECONDS


# ---------------- 总时长预算 ----------------


def test_total_budget_caps_the_wait():
    """解释的总耗时必须有上限：用户等的是「失败了、该怎么办」，不是这句补充说明。

    曾经的写法是「每次 8 秒 × 最多 3 次」，最坏会让用户对着「生成中」等 24 秒——
    而失败其实早就发生了。
    """
    class _SlowLLM:
        def __init__(self):
            self.calls = 0

        async def chat(self, **_kwargs):
            self.calls += 1
            await anyio.sleep(5)  # 远超总预算
            return "永远到不了这里"

    llm = _SlowLLM()
    started = monotonic()
    result = _explain(llm, exc=_HttpError("bad gateway"))
    elapsed = monotonic() - started
    assert result.source == "fallback"
    assert result.message and result.advice
    assert llm.calls >= 1
    assert elapsed < TOTAL_BUDGET_SECONDS + 1.0, f"等了 {elapsed:.1f}s，超出总预算"
    assert elapsed < 5.0, "单次调用超时也必须被总预算压住"


def test_slow_decision_cannot_blow_the_budget(monkeypatch):
    """连「要不要重试」那一步（可能问 Jev，配置超时可达 30 秒）也得受预算约束。"""
    async def _slow_decide(*_args, **_kwargs):
        await anyio.sleep(10)
        raise AssertionError("不该走到这里")

    monkeypatch.setattr(module, "decide", _slow_decide)

    class _FailingLLM:
        async def chat(self, **_kwargs):
            raise RuntimeError("boom")

    started = monotonic()
    result = _explain(_FailingLLM(), exc=_HttpError("bad gateway"))
    elapsed = monotonic() - started
    assert result.source == "fallback"
    assert elapsed < TOTAL_BUDGET_SECONDS + 1.0, f"等了 {elapsed:.1f}s，判定那一步没受预算约束"


# ---------------- 7. chat.py 侧：脱敏、兜底与推理等级 ----------------


class _FakeLoader:
    def __init__(self):
        self.calls = []

    def render(self, name, user_input, variables=None):
        self.calls.append({"name": name, "user_input": user_input, "variables": variables or {}})
        return f"PROMPT::{name}"


def test_chat_helper_sanitizes_before_prompt(monkeypatch):
    """上游原文里的网关地址与凭据不能进 prompt（也不该进用户界面）。"""
    from app.routers import chat as chat_router

    loader = _FakeLoader()
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _FakeLLM([]))
    cfg = {"chores_model": "chores-x", "jev": None, "models": [], "tool_reasoning_rules": []}
    exc = RuntimeError("boom at https://gw.example.com/v1?trace=1 key=sk-abcdefgh12345678")
    result = anyio.run(
        lambda: chat_router._explain_failure_for_user(
            cfg, loader, exc=exc, tool_name="语篇深度分析", model="m1"
        )
    )
    sent = loader.calls[0]["user_input"]
    assert "https://" not in sent
    assert "sk-abcdefgh12345678" not in sent
    assert loader.calls[0]["variables"]["tool"] == "语篇深度分析"
    assert result.message and result.advice, "Chores 用不了也要给用户一句话"


def test_chat_helper_applies_tool_reasoning_rule(monkeypatch):
    """报错解读的推理等级要能被管理后台的工具推理规则覆盖，并原样透传。

    有些模型关推理写 off、有些写 none，所以这里只断言「配置值被原样送到模型调用」，
    代码里不做任何硬编码改写。
    """
    from app.routers import chat as chat_router

    seen = {}

    class _LLM:
        async def chat(self, **kwargs):
            seen.update(kwargs)
            return "材料太长了，模型一次读不完\n把原文拆成两段分别处理"

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _LLM())
    monkeypatch.setattr(chat_router, "supports_reasoning", lambda _model: True)
    cfg = {
        "chores_model": "chores-x",
        "jev": None,
        "models": [{"id": "chores-x", "reasoning_effort": "low", "extra_body": {"vendor_flag": 1}}],
        "tool_reasoning_rules": [
            {
                "id": "r_explain",
                "tool_ids": [ERROR_EXPLAIN_TOOL_ID],
                "reasoning_effort": "off",
                "on_unsupported": "fallback",
            }
        ],
    }
    result = anyio.run(
        lambda: chat_router._explain_failure_for_user(
            cfg, _FakeLoader(), exc=_HttpError("bad gateway")
        )
    )
    assert result.source == "chores"
    assert seen["reasoning_effort"] == "off", "工具规则要覆盖模型默认值"
    assert seen["extra_body"] == {"vendor_flag": 1}, "模型自带的 extra_body 也要一起传下去"


def test_chat_helper_falls_back_to_model_default_effort(monkeypatch):
    """没配工具规则时，用该模型自己的默认推理强度（与主流程同一个口径）。"""
    from app.routers import chat as chat_router

    seen = {}

    class _LLM:
        async def chat(self, **kwargs):
            seen.update(kwargs)
            return "模型服务暂时繁忙\n等一两分钟再试"

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _LLM())
    cfg = {
        "chores_model": "chores-x",
        "jev": None,
        "models": [{"id": "chores-x", "reasoning_effort": "none"}],
        "tool_reasoning_rules": [],
    }
    result = anyio.run(
        lambda: chat_router._explain_failure_for_user(
            cfg, _FakeLoader(), exc=_HttpError("bad gateway")
        )
    )
    assert result.source == "chores"
    assert seen["reasoning_effort"] == "none"


def test_chat_helper_skips_chores_when_rule_says_fail(monkeypatch):
    """规则配「直接失败」且模型不支持推理 → 不调用 Chores，直接用机械文案。

    解释只是补充信息，这里没有「拦下请求」可做，跳过就是它的语义；
    关键是别白花一次注定失败的调用，更别让错误卡空着。
    """
    from app.routers import chat as chat_router

    called = []

    class _LLM:
        async def chat(self, **kwargs):
            called.append(kwargs)
            return "不该被调用"

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _LLM())
    monkeypatch.setattr(chat_router, "supports_reasoning", lambda _model: False)
    cfg = {
        "chores_model": "chores-x",
        "jev": None,
        "models": [{"id": "chores-x"}],
        "tool_reasoning_rules": [
            {
                "id": "r_explain",
                "tool_ids": [ERROR_EXPLAIN_TOOL_ID],
                "reasoning_effort": "high",
                "on_unsupported": "fail",
            }
        ],
    }
    result = anyio.run(
        lambda: chat_router._explain_failure_for_user(
            cfg, _FakeLoader(), exc=_HttpError("bad gateway")
        )
    )
    assert called == [], "规则说直接失败就不该再调 Chores"
    assert result.source == "fallback"
    assert result.message and result.advice


def test_chat_helper_survives_broken_loader(monkeypatch):
    """连提示词都取不到时也不能抛：退回机械文案。"""
    from app.routers import chat as chat_router

    class _Boom:
        def render(self, *args, **kwargs):
            raise RuntimeError("loader broke")

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _FakeLLM([]))

    class _ServerError(Exception):
        status_code = 503

    result = anyio.run(
        lambda: chat_router._explain_failure_for_user(
            {"chores_model": "c", "jev": None}, _Boom(), exc=_ServerError("x")
        )
    )
    assert result.source == "fallback"
    assert result.message and result.advice




