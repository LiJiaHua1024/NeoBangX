"""LLM Router 多 Provider fallback 的回归测试。

全部在内存里完成：把 llm_router.acompletion 换成脚本化的假实现，
不发起网络请求，也不依赖数据库与 HTTP 客户端。

覆盖：
1. is_retryable 判定：默认切换，只有上下文超限与内容审核不切；
2. 流式 fallback：首选 401/5xx、首块超时、空响应都能切到备用家；
3. 不切换：上下文超限直接抛；已吐过正文后失败直接抛；
4. 全链失败：last_provider / attempt_errors / attempts 足以在日志里定位是哪家挂的；
5. 切换事件：failed_index / total / next_index / reason 供前端展示进度。
"""
import asyncio

import anyio
import httpx
import pytest
from litellm import exceptions as litellm_exceptions

from app.services import llm_router as router_module
from app.services.llm_router import (
    EmptyResponseError,
    LLMRouter,
    is_retryable,
)

# ---- 假的 litellm 流式对象 ----


class _Delta:
    def __init__(self, content=None, reasoning=None):
        self.content = content
        if reasoning is not None:
            self.reasoning_content = reasoning


class _Choice:
    def __init__(self, delta):
        self.delta = delta


class _Chunk:
    """一个流式数据块；content/reasoning 都为空时视为只带 usage 的收尾块。"""

    def __init__(self, content=None, reasoning=None, usage=None):
        has_delta = content is not None or reasoning is not None
        self.choices = [_Choice(_Delta(content, reasoning))] if has_delta else []
        self.usage = usage


class _Stream:
    """脚本化的上游流：可延迟首块、可在末尾抛错。"""

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


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.anyio
async def test_stream_preserves_finish_reason_for_truncation_validation(monkeypatch, legacy):
    from app.services import llm as llm_module
    from app.services.llm import LLMService
    end = _Chunk("")
    end.choices[0].finish_reason = "length"
    end.choices[0].delta = None
    response = _Stream([_Chunk("body"), end])
    async def fake_acompletion(**kwargs):
        return response
    monkeypatch.setattr(llm_module if legacy else router_module, "acompletion", fake_acompletion)
    service = LLMService(api_key="k", default_model="test") if legacy else _router(count=1)
    usage = {}
    output = [item async for item in service.chat_stream_with_stop(user_prompt="test", usage_out=usage)]
    assert output == ["body"]
    assert usage["finish_reason"] == "length"
    assert response.closed


class _Message:
    def __init__(self, content):
        self.content = content


class _NonStreamResponse:
    """非流式响应：只用得到 choices[0].message.content。"""

    def __init__(self, content):
        self.choices = [type("_C", (), {"message": _Message(content)})()]
        self.usage = None


_HTTP_REQUEST = httpx.Request("POST", "https://example.invalid/v1/chat/completions")
_HTTP_403 = httpx.Response(403, request=_HTTP_REQUEST)


def _auth_error():
    return litellm_exceptions.AuthenticationError(
        message="invalid api key", llm_provider="openai", model="test-model"
    )


def _permission_error():
    return litellm_exceptions.PermissionDeniedError(
        message="no permission", model="test-model", llm_provider="openai", response=_HTTP_403
    )


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


def _router(count=2, first_token_timeout=5):
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
        first_token_timeout=first_token_timeout,
        # 本文件聚焦 fallback 语义：关闭快重试（fast_fail_ms=0），
        # 快重试的专门覆盖见 test_quick_retry_breaker.py
        fast_fail_ms=0,
    )


@pytest.mark.parametrize("before_first", [False, True])
def test_cancellation_closes_upstream_even_before_first_token(monkeypatch, before_first):
    async def run():
        waiting = asyncio.Event()
        class HangingStream(_Stream):
            async def _gen(self):
                if not before_first:
                    yield _Chunk(content="partial")
                waiting.set()
                await asyncio.Event().wait()

        stream = HangingStream()
        _install(monkeypatch, [stream])
        async def consume():
            async for _ in _router(count=1).chat_stream_with_stop(user_prompt="test"):
                pass
        task = asyncio.create_task(consume())
        await asyncio.wait_for(waiting.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert stream.closed
    asyncio.run(run())


def test_legacy_service_closes_upstream_on_generator_close(monkeypatch):
    from app.services import llm as llm_module
    async def run():
        stream = _Stream([_Chunk(content="partial"), _Chunk(content="unused")])
        async def completion(**kwargs):
            return stream
        monkeypatch.setattr(llm_module, "acompletion", completion)
        llm = llm_module.LLMService(api_key="fake", default_model="test-model")
        result = llm.chat_stream_with_stop(user_prompt="test")
        assert await anext(result) == "partial"
        await result.aclose()
        assert stream.closed
    asyncio.run(run())


def _run_stream(router, stop_event=None, continue_prompt=None):
    """跑一遍流式调用，返回 (正文, 推理, 切换事件, 异常)。"""

    async def _run():
        texts, reasonings, fallbacks, error = [], [], [], None
        try:
            async for item in router.chat_stream_with_stop(
                user_prompt="你好", stop_event=stop_event, continue_prompt=continue_prompt
            ):
                if isinstance(item, tuple):
                    if item[0] == "reasoning":
                        reasonings.append(item[1])
                    elif item[0] == "fallback":
                        fallbacks.append(item[1])
                else:
                    texts.append(item)
        except BaseException as exc:  # noqa: BLE001 - 测试需要拿到异常本身做断言
            error = exc
        return texts, reasonings, fallbacks, error

    return anyio.run(_run)


# ---- 1. 判定表 ----


@pytest.mark.parametrize(
    "name,exc,expected",
    [
        ("401 鉴权失败", _auth_error(), True),
        ("403 无权限/欠费", _permission_error(), True),
        ("404 该家没有这个模型", litellm_exceptions.NotFoundError(
            message="model not found", llm_provider="openai", model="test-model"
        ), True),
        ("400 参数被拒", litellm_exceptions.BadRequestError(
            message="unsupported parameter", llm_provider="openai", model="test-model"
        ), True),
        ("402 欠费", litellm_exceptions.APIError(
            status_code=402, message="Insufficient Balance",
            llm_provider="openai", model="test-model"
        ), True),
        ("429 限流", litellm_exceptions.RateLimitError(
            message="rate limit", llm_provider="openai", model="test-model"
        ), True),
        ("502 网关错误", _gateway_error(), True),
        ("503 服务不可用", litellm_exceptions.ServiceUnavailableError(
            message="unavailable", llm_provider="openai", model="test-model"
        ), True),
        ("等待超时", asyncio.TimeoutError("等超时了"), True),
        ("连接被对端掐断", httpx.RemoteProtocolError("peer closed connection"), True),
        ("上下文超限（异常类）", _context_window_error(), False),
        ("上下文超限（文案）", litellm_exceptions.BadRequestError(
            message="This model's maximum context length is 8192 tokens",
            llm_provider="openai", model="test-model"
        ), False),
        ("内容审核（异常类）", litellm_exceptions.ContentPolicyViolationError(
            message="filtered", llm_provider="openai", model="test-model"
        ), False),
        ("内容审核（文案）", litellm_exceptions.BadRequestError(
            message="The response was filtered due to content policy",
            llm_provider="openai", model="test-model"
        ), False),
    ],
)
def test_is_retryable_table(name, exc, expected):
    """默认切换；只有「换谁都一样」的上下文超限与内容审核不切。"""
    assert is_retryable(exc) is expected, name


# ---- 2. 流式 fallback ----


def test_stream_falls_back_to_next_provider_on_auth_error(monkeypatch):
    """首选 401（key 失效）应切备用家，而不是直接把错误甩给用户。"""
    fake = _install(monkeypatch, [
        _auth_error(),
        _Stream([_Chunk("你"), _Chunk("好"), _Chunk(usage=object())]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router)

    assert error is None
    assert "".join(texts) == "你好"
    assert len(fake.calls) == 2
    assert router.provider_used["id"] == "prov_2"
    assert router.attempts == 2
    assert fallbacks == [
        {"failed_index": 1, "total": 2, "next_index": 2, "reason": "unavailable"}
    ]


def test_stream_falls_back_when_first_chunk_times_out(monkeypatch):
    """首块超过 first_token_timeout 即判该家失效，并关掉废弃的上游流。"""
    slow = _Stream([_Chunk("迟")], first_delay=0.5)
    _install(monkeypatch, [slow, _Stream([_Chunk("备用家答复")])])
    router = _router(count=2, first_token_timeout=0.1)

    texts, _, fallbacks, error = _run_stream(router)

    assert error is None
    assert "".join(texts) == "备用家答复"
    assert slow.closed is True
    assert fallbacks[0]["reason"] == "timeout"
    assert router.provider_used["id"] == "prov_2"


def test_stream_falls_back_on_empty_response(monkeypatch):
    """上游只回空流（既没报错也没正文）也算该家失效，不能当成功交付空答案。"""
    _install(monkeypatch, [_Stream([]), _Stream([_Chunk("兜底内容")])])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router)

    assert error is None
    assert "".join(texts) == "兜底内容"
    assert fallbacks[0]["reason"] == "empty"


def test_stream_keeps_reasoning_and_switches_when_no_content(monkeypatch):
    """只吐了推理、没有正文：仍算该家失效（推理片段不构成交付物）。"""
    _install(monkeypatch, [
        _Stream([_Chunk(reasoning="先想想", usage=None)]),
        _Stream([_Chunk("正文在此")]),
    ])
    router = _router(count=2)

    texts, reasonings, fallbacks, error = _run_stream(router)

    assert error is None
    assert reasonings == ["先想想"]
    assert "".join(texts) == "正文在此"
    assert fallbacks[0]["failed_index"] == 1


# ---- 3. 不该切换的情形 ----


def test_stream_does_not_switch_on_context_window_error(monkeypatch):
    """上下文超限换哪家都一样，直接抛，别让用户白等备用家。"""
    fake = _install(monkeypatch, [_context_window_error(), _Stream([_Chunk("不该到这")])])
    router = _router(count=2)

    _, _, fallbacks, error = _run_stream(router)

    assert isinstance(error, litellm_exceptions.ContextWindowExceededError)
    assert len(fake.calls) == 1
    assert fallbacks == []
    assert router.attempts == 1
    assert router.provider_used is None


CONTINUE_PROMPT = "上面那条 assistant 消息写到一半被打断了，从断点接着往下写，不要重复。"


def test_stream_without_continue_prompt_still_raises_after_first_content(monkeypatch):
    """没有续写指令（提示词文件缺失 / 老调用方）：保持旧行为，已吐正文后直接抛。"""
    fake = _install(monkeypatch, [
        _Stream([_Chunk("半")], error=_gateway_error()),
        _Stream([_Chunk("不该到这")]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router)

    assert texts == ["半"]
    assert isinstance(error, litellm_exceptions.BadGatewayError)
    assert fallbacks == []
    assert len(fake.calls) == 1
    assert router.midstream_resumes == 0


def test_stream_continues_after_first_content(monkeypatch):
    """已吐正文后断流：带残文同家续写，输出连续、无事件、日志留痕。"""
    fake = _install(monkeypatch, [
        _Stream([_Chunk("半")], error=_gateway_error()),
        _Stream([_Chunk("后半")]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["半", "后半"]
    assert error is None
    assert fallbacks == []
    assert router.midstream_resumes == 1
    assert router.provider_used["id"] == "prov_1"
    assert router.last_resume_error.startswith("litellm.BadGatewayError")
    # 续写消息：原 prompt → 残文（assistant）→ 续写指令
    sent = fake.calls[1]["messages"]
    assert sent[0] == {"role": "user", "content": "你好"}
    assert sent[1] == {"role": "assistant", "content": "半"}
    assert sent[2] == {"role": "user", "content": CONTINUE_PROMPT}


def test_stream_continues_on_next_provider_after_same_provider_breaks(monkeypatch):
    """同一家只续写一次：再断就静默带残文换下一家，绝不再发 fallback 事件。"""
    _install(monkeypatch, [
        _Stream([_Chunk("甲")], error=_gateway_error()),
        _Stream([_Chunk("乙")], error=_gateway_error()),
        _Stream([_Chunk("丙")]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["甲", "乙", "丙"]
    assert error is None
    assert fallbacks == []
    assert router.midstream_resumes == 2
    assert router.attempts == 2
    assert router.provider_used["id"] == "prov_2"


def test_stream_continue_done_sentinel_is_not_leaked(monkeypatch):
    """续写只回「其实已经写完」标记：标记不能拼进成品，且按成功收尾。"""
    _install(monkeypatch, [
        _Stream([_Chunk("半")], error=_gateway_error()),
        _Stream([_Chunk("@@CONTINUE"), _Chunk("_DONE@@")]),
    ])
    router = _router(count=1)

    texts, _, _, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["半"]
    assert error is None


def test_stream_does_not_continue_on_context_window_error(monkeypatch):
    """上下文超限换谁都一样：不续写，直接把错误交给上层。"""
    _install(monkeypatch, [
        _Stream([_Chunk("半")], error=_context_window_error()),
        _Stream([_Chunk("不该到这")]),
    ])
    router = _router(count=2)

    texts, _, _, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["半"]
    assert isinstance(error, litellm_exceptions.ContextWindowExceededError)
    assert router.midstream_resumes == 0


def test_stream_does_not_continue_on_midstream_client_error(monkeypatch):
    """中途 4xx（429 除外）：litellm 的策略就是直接抛，自动续写也跟随。"""
    bad = litellm_exceptions.BadRequestError(
        message="invalid request", llm_provider="openai", model="test-model"
    )
    _install(monkeypatch, [
        _Stream([_Chunk("半")], error=bad),
        _Stream([_Chunk("不该到这")]),
    ])
    router = _router(count=2)

    texts, _, _, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["半"]
    assert isinstance(error, litellm_exceptions.BadRequestError)
    assert router.midstream_resumes == 0


def test_stream_continue_empty_response_moves_to_next_provider(monkeypatch):
    """续写一个字都没吐：算该家这次续写失效，换下一家接着续，不把半篇当成功。"""
    _install(monkeypatch, [
        _Stream([_Chunk("半")], error=_gateway_error()),
        _Stream([]),
        _Stream([_Chunk("收尾")]),
    ])
    router = _router(count=2)

    texts, _, fallbacks, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert texts == ["半", "收尾"]
    assert error is None
    assert fallbacks == []
    assert router.midstream_resumes == 2
    assert router.provider_used["id"] == "prov_2"


def test_stream_continue_respects_stop_event(monkeypatch):
    """用户已经停了：不再发起续写请求。"""
    stop_event = anyio.Event()

    class _BreakAfterStop(_Stream):
        async def _gen(self):
            yield _Chunk("半")
            stop_event.set()
            raise _gateway_error()

    fake = _install(monkeypatch, [_BreakAfterStop([_Chunk("半")]), _Stream([_Chunk("不该到这")])])
    router = _router(count=2)

    texts, _, _, error = _run_stream(
        router, stop_event=stop_event, continue_prompt=CONTINUE_PROMPT
    )

    assert texts == ["半"]
    assert isinstance(error, litellm_exceptions.BadGatewayError)
    assert router.midstream_resumes == 0
    assert len(fake.calls) == 1


def test_stream_continue_has_a_global_cap(monkeypatch):
    """续写次数用尽后把错误交回上层，不无限重打上游。"""
    script = [_Stream([_Chunk("x")], error=_gateway_error()) for _ in range(6)]
    fake = _install(monkeypatch, script)
    router = _router(count=3)
    router.max_midstream_resumes = 1

    texts, _, _, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    # 原请求 + 1 次续写请求；第二次断流时上限已到，直接抛
    assert texts == ["x", "x"]
    assert len(fake.calls) == 2
    assert isinstance(error, litellm_exceptions.BadGatewayError)
    assert router.midstream_resumes == 1


def test_stream_continue_carries_sponsor_tail(monkeypatch):
    """断点落在赞助块候选中间：候选要带进续写，广告别漏到正文里。"""
    _install(monkeypatch, [
        _Stream([_Chunk("正文"), _Chunk("\n\n--")], error=_gateway_error()),
        _Stream([_Chunk("- \nSponsored by X\n")]),
    ])
    router = _router(count=1)

    texts, _, _, error = _run_stream(router, continue_prompt=CONTINUE_PROMPT)

    assert error is None
    assert "".join(texts) == "正文\n"


# ---- 4. 全链失败时的日志归属 ----


def test_all_providers_failed_keeps_attempt_trail(monkeypatch):
    """全链失败时日志必须能看出「试了几家、最后是哪家、各家什么错」。"""
    _install(monkeypatch, [_auth_error(), _gateway_error()])
    router = _router(count=2)

    _, _, fallbacks, error = _run_stream(router)

    assert isinstance(error, litellm_exceptions.BadGatewayError)
    assert router.attempts == 2
    assert router.provider_used is None
    assert router.reported_provider["id"] == "prov_2"
    assert router.last_provider["id"] == "prov_2"
    assert len(fallbacks) == 1  # 只有切到第 2 家那一次；第 2 家失败后不再有下一家
    summary = router.failure_summary()
    assert "通道1" in summary and "通道2" in summary
    assert "prov_1" not in summary and "prov_2" not in summary
    assert "AuthenticationError" in summary and "BadGatewayError" in summary


def test_stop_event_is_not_treated_as_failure(monkeypatch):
    """用户点停止导致的提前结束不算该家失效，也不触发切换。"""
    _install(monkeypatch, [_Stream([_Chunk("内容")]), _Stream([_Chunk("不该到这")])])
    router = _router(count=2)
    stop_event = anyio.Event()
    stop_event.set()

    texts, _, fallbacks, error = _run_stream(router, stop_event=stop_event)

    assert error is None
    assert texts == []
    assert fallbacks == []
    assert router.provider_used["id"] == "prov_1"
    assert router.attempt_errors == []


# ---- 5. 非流式同样切换 ----


def test_chat_falls_back_on_permission_denied(monkeypatch):
    """非流式（错因分析/标题）也能因 403 切到备用家。"""
    fake = _install(monkeypatch, [_permission_error(), _NonStreamResponse("分析结果")])
    router = _router(count=2)

    result = anyio.run(
        lambda: router.chat(user_prompt="题干", model="test-model")
    )

    assert result == "分析结果"
    assert len(fake.calls) == 2
    assert router.provider_used["id"] == "prov_2"
    assert router.attempts == 2


def test_chat_falls_back_on_empty_non_stream_response(monkeypatch):
    """非流式空正文必须切备用 Provider，不能把空字符串当标题成功。"""
    fake = _install(monkeypatch, [_NonStreamResponse(""), _NonStreamResponse("备用标题")])
    router = _router(count=2)

    result = anyio.run(lambda: router.chat(user_prompt="标题", model="test-model"))

    assert result == "备用标题"
    assert len(fake.calls) == 2
    assert router.provider_used["id"] == "prov_2"
    assert router.attempts == 2


def test_empty_response_error_is_retryable():
    """空响应异常本身必须被判为可切换，否则等于静默交付空答案。"""
    assert is_retryable(EmptyResponseError("空响应")) is True


# ---- 6. 错误信息落库口径 ----


def _router_with_failures(*exceptions):
    router = _router(count=len(exceptions))
    for index, exc in enumerate(exceptions):
        router.attempts = index + 1
        router.last_provider = router.providers[index]
        router._remember_failure(router.providers[index], exc)
    return router


def test_error_message_prefers_attempt_summary_over_duplicate_exception():
    """上游异常本身已在摘要里：不要再把同一句话拼一遍。"""
    from app.routers.chat import _final_error_message

    auth = _auth_error()
    router = _router_with_failures(auth)
    message = _final_error_message(router, "error", str(auth))

    assert message == router.failure_summary()
    assert "通道1" in message
    assert message.count("AuthenticationError") == 1


def test_error_message_keeps_business_conclusion():
    """调用方另有业务结论（如「模型未返回可确认的错因」）时不能被摘要盖掉。"""
    from app.routers.chat import _final_error_message

    router = _router_with_failures(_gateway_error())
    message = _final_error_message(router, "error", "模型未返回可确认的错因")

    assert message.startswith("模型未返回可确认的错因 ｜ ")
    assert "通道1" in message


def test_error_message_marks_successful_fallback():
    """成功但发生过切换：错误信息位置留尾注，便于后台发现长期不健康的那家。"""
    from app.routers.chat import _final_error_message

    router = _router_with_failures(_auth_error())
    message = _final_error_message(router, "success", "")

    assert message.startswith("备用切换：")


# ---- 7. 端点级：fallback 事件与日志归属 ----

TEST_TOOL_ID = "25"  # 自由对话


def _active_code():
    from app.models import UsageCode

    return UsageCode(
        id=999_222,
        code="NBXU-FALLBACK-TEST",
        quota=3,
        used_count=0,
        is_enabled=True,
    )


def _wait_usage_log(request_id, timeout=5.0):
    """等生成器 finally 里的落库线程把行写完（TestClient 返回时可能刚好在收尾）。"""
    import time

    from app.database import SessionLocal
    from app.models import UsageLog

    deadline = time.monotonic() + timeout
    while True:
        db = SessionLocal()
        try:
            row = (
                db.query(UsageLog)
                .filter(UsageLog.request_id == request_id)
                .order_by(UsageLog.id.desc())
                .first()
            )
        finally:
            db.close()
        if row is not None or time.monotonic() > deadline:
            return row
        time.sleep(0.05)


def test_stream_endpoint_forwards_fallback_event_and_logs_provider(monkeypatch):
    """首选 401 → 备用成功：SSE 要发 fallback 事件，日志要写清是哪家、试了几家。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.routers import chat as chat_router

    _install(monkeypatch, [
        _auth_error(),
        _Stream([_Chunk("备用家的答复")]),
    ])
    router = _router(count=2)
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: router)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=_active_code(), reason=""
    )
    try:
        response = TestClient(app).post(
            "/api/chat/stream",
            json={
                "tool_id": TEST_TOOL_ID,
                "input": "你好",
                "request_id": "fallback_endpoint_case",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: fallback" in response.text
    assert '"failed_index": 1' in response.text and '"total": 2' in response.text
    assert '"reason": "unavailable"' in response.text
    assert "event: done" in response.text

    row = _wait_usage_log("fallback_endpoint_case")
    assert row is not None
    assert row.status == "success"
    assert row.provider_id == "prov_2"
    assert row.fallback_attempts == 2
    # 发生过切换：成功行也留下「哪家失败过」的尾注，便于后台发现长期不健康的那家
    assert row.error_message.startswith("备用切换：")


def test_stream_endpoint_reports_timeout_fallback(monkeypatch):
    """静置等不到首块（超时）触发的切换，前端同样必须收到 fallback 事件。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.routers import chat as chat_router

    slow = _Stream([_Chunk("太慢了")], first_delay=1.0)
    _install(monkeypatch, [slow, _Stream([_Chunk("备用家的答复")])])
    router = _router(count=2, first_token_timeout=0.1)
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: router)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=_active_code(), reason=""
    )
    try:
        response = TestClient(app).post(
            "/api/chat/stream",
            json={
                "tool_id": TEST_TOOL_ID,
                "input": "你好",
                "request_id": "timeout_fallback_case",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: fallback" in response.text
    assert '"reason": "timeout"' in response.text
    assert "备用家的答复" in response.text
    assert slow.closed is True


def test_stream_endpoint_logs_all_provider_failures(monkeypatch):
    """全链失败：日志行必须能定位到各家的错误，而不是只留一句「生成失败」。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.routers import chat as chat_router

    _install(monkeypatch, [_auth_error(), _gateway_error()])
    router = _router(count=2)
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: router)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=_active_code(), reason=""
    )
    try:
        response = TestClient(app).post(
            "/api/chat/stream",
            json={
                "tool_id": TEST_TOOL_ID,
                "input": "你好",
                "request_id": "fallback_all_failed_case",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: error" in response.text

    row = _wait_usage_log("fallback_all_failed_case")
    assert row is not None
    assert row.status == "error"
    assert row.provider_id == "prov_2"  # 最后尝试的那家
    assert row.fallback_attempts == 2
    assert "通道1" in row.error_message and "通道2" in row.error_message
    assert "BadGatewayError" in row.error_message


def test_stream_endpoint_silently_continues_after_midstream_break(monkeypatch):
    """中途断流：SSE 里只有连续正文，没有 fallback / error，日志留一条续写尾注。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.routers import chat as chat_router

    _install(monkeypatch, [
        _Stream([_Chunk("前半")], error=_gateway_error()),
        _Stream([_Chunk("后半")]),
    ])
    router = _router(count=2)
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: router)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=_active_code(), reason=""
    )
    try:
        response = TestClient(app).post(
            "/api/chat/stream",
            json={
                "tool_id": TEST_TOOL_ID,
                "input": "你好",
                "request_id": "midstream_continue_endpoint_case",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: fallback" not in response.text
    assert "event: error" not in response.text
    assert "event: explaining" not in response.text
    assert "event: done" in response.text
    assert '"前半"' in response.text and '"后半"' in response.text

    row = _wait_usage_log("midstream_continue_endpoint_case")
    assert row is not None
    assert row.status == "success"
    assert row.fallback_attempts == 1        # 只试了一家：续写不算换家
    assert row.error_message.startswith("中途断流续写×1")


def test_build_kwargs_direct_passthrough():
    """验证 extra_body 与 reasoning_effort 直接透传，不再做按模型/网关打地鼠篡改。"""
    router = _router(count=1)
    prov = router.providers[0]

    # 1. 传入 reasoning_effort='off'（Command Code 规范）：原样透传且放行 allowed_openai_params
    kw_off = router._build_kwargs(
        prov, "cmdc-model", [{"role": "user", "content": "hi"}], max_tokens=100,
        stream=False, reasoning_effort="off",
    )
    assert kw_off["reasoning_effort"] == "off"
    assert "reasoning_effort" in kw_off.get("allowed_openai_params", [])
    assert kw_off["extra_body"]["reasoning_effort"] == "off"

    # 2. 传入 reasoning_effort='instant'（水星 Mercury 规范）：原样透传
    kw_inst = router._build_kwargs(
        prov, "mercury-2.5", [{"role": "user", "content": "hi"}], max_tokens=100,
        stream=False, reasoning_effort="instant",
    )
    assert kw_inst["reasoning_effort"] == "instant"
    assert kw_inst["extra_body"]["reasoning_effort"] == "instant"

    # 3. 传入自定义 extra_body：原样合并且拥有最高优先级
    custom_extra = {"reasoning": {"effort": "custom-val"}, "anthropic_beta": ["thinking-2025"]}
    kw_custom = router._build_kwargs(
        prov, "custom-model", [{"role": "user", "content": "hi"}], max_tokens=100,
        stream=False, reasoning_effort="off", extra_body=custom_extra,
    )
    assert kw_custom["extra_body"]["reasoning"] == {"effort": "custom-val"}
    assert kw_custom["extra_body"]["anthropic_beta"] == ["thinking-2025"]


@pytest.mark.anyio
async def test_chat_auto_heals_on_reasoning_error_within_same_provider(monkeypatch):
    """当首个 Provider 报 reasoning_effort 枚举或参数不支持时，自动剥离推理参数原地重试，不切备用 Provider。"""
    import copy
    from litellm import exceptions as litellm_exceptions

    class DummyResponse:
        def __init__(self, content):
            self.choices = [type("Choice", (), {"message": type("Msg", (), {"content": content})()})()]
            self.usage = None

    calls = []

    async def fake_acompletion(**kwargs):
        calls.append(copy.deepcopy(kwargs))
        # 第一次调用（带 reasoning_effort）：模拟 Command Code 报 400 Invalid option
        if kwargs.get("reasoning_effort") == "none":
            raise litellm_exceptions.BadRequestError(
                message='OpenAIException - Invalid option: expected one of "off"|"low"|"medium"|"high"|"xhigh"',
                model="test-model",
                llm_provider="openai",
            )
        # 第二次调用（已自愈剥离推理参数）：成功响应
        return DummyResponse("这是自愈重试成功的回答")

    monkeypatch.setattr("app.services.llm_router.acompletion", fake_acompletion)

    router = _router(count=2)
    result = await router.chat(
        user_prompt="你好",
        reasoning_effort="none",
    )

    assert result == "这是自愈重试成功的回答"
    assert router.provider_used["id"] == "prov_1"  # 依然是第 1 家，没切换到 prov_2
    assert len(calls) == 2
    # 第一次带推理参数
    assert calls[0].get("reasoning_effort") == "none"
    # 第二次已被安全剥离
    assert "reasoning_effort" not in calls[1]
    assert "extra_body" not in calls[1] or "reasoning_effort" not in calls[1].get("extra_body", {})


@pytest.mark.anyio
async def test_stream_auto_heals_on_reasoning_error_within_same_provider(monkeypatch):
    """流式建连时上游拒绝推理参数，在当前 Provider 原地剥离参数重试建连，平滑输出。"""
    import copy
    from litellm import exceptions as litellm_exceptions

    stream_attempts = []

    async def fake_acompletion(**kwargs):
        stream_attempts.append(copy.deepcopy(kwargs))
        if kwargs.get("reasoning_effort"):
            raise litellm_exceptions.BadRequestError(
                message="unrecognized request argument: reasoning_effort",
                model="test-model",
                llm_provider="openai",
            )
        return _Stream([_Chunk("自愈"), _Chunk("流式"), _Chunk("成功")])

    monkeypatch.setattr("app.services.llm_router.acompletion", fake_acompletion)

    router = _router(count=2)
    chunks = []
    async for item in router.chat_stream_with_stop(
        user_prompt="测试流式自愈",
        reasoning_effort="off",
    ):
        if isinstance(item, str):
            chunks.append(item)

    assert "".join(chunks) == "自愈流式成功"
    assert router.provider_used["id"] == "prov_1"
    assert len(stream_attempts) == 2
    assert stream_attempts[0].get("reasoning_effort") == "off"
    assert "reasoning_effort" not in stream_attempts[1]
