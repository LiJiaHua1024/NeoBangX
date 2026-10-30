"""Agent 的 Provider 重试与粘性：一步会决定后面好几步，所以宁可同家多试几次。

主站的重试是"快失败就换家"；Agent 反过来——先在同一家重试（退避 + Retry-After），
只有这家彻底不行了才换，而且换了之后本任务不再自动切回。
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest
from litellm import exceptions as litellm_exceptions

from app.agent_workspace import llm
from app.services import provider_health


def _router(monkeypatch):
    from app.services.llm_router import LLMRouter

    providers = [{"id": f"prov_{i}", "name": f"通道{i}", "base_url": f"http://p{i}",
                  "api_key": "k", "enabled": True, "provider_model_id": "test"}
                 for i in (1, 2)]
    router = LLMRouter(providers_for_model=providers, default_model="test", max_tokens=128,
                       timeout=120, first_token_timeout=5, fast_fail_ms=0)
    monkeypatch.setattr(llm, "_build_llm", lambda *_: router)
    monkeypatch.setattr(llm, "RETRY_DELAYS", (0.0, 0.0))
    provider_health.reset_for_tests()
    return router


def _ok_stream():
    async def gen():
        yield {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}

    return gen()


def _gateway_error():
    return litellm_exceptions.BadGatewayError(message="bad gateway", llm_provider="openai", model="test")


def _base(kwargs):
    return kwargs.get("base_url") or kwargs.get("api_base")


def test_same_provider_is_retried_before_switching(monkeypatch):
    """首家前两次 5xx：第 3 次在同一家成功，绝不落到备用家。"""
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        calls.append(_base(kwargs))
        if len(calls) < 3:
            raise _gateway_error()
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))

    assert result.content == "ok"
    assert result.provider_id == "prov_1"
    assert result.attempts == 3
    assert calls == ["http://p1"] * 3


def test_switch_only_after_the_pinned_provider_is_exhausted(monkeypatch):
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        base = _base(kwargs)
        calls.append(base)
        if base == "http://p1":
            raise _gateway_error()
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))

    assert calls == ["http://p1"] * 3 + ["http://p2"]
    assert result.provider_id == "prov_2"


def test_preferred_provider_goes_first_even_if_not_the_chain_head(monkeypatch):
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        calls.append(_base(kwargs))
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), preferred="prov_2"))

    assert calls == ["http://p2"]
    assert result.provider_id == "prov_2"


def test_auth_failure_switches_without_burning_retries(monkeypatch):
    """401 是这家的配置问题：重试改变不了，直接换一家。"""
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        base = _base(kwargs)
        calls.append(base)
        if base == "http://p1":
            raise litellm_exceptions.AuthenticationError(message="bad key", llm_provider="openai", model="test")
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))

    assert calls == ["http://p1", "http://p2"]
    assert result.provider_id == "prov_2"


def test_context_overflow_never_switches(monkeypatch):
    """上下文超限换谁都一样：既不同家重试，也不换家。"""
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        calls.append(_base(kwargs))
        raise ValueError("maximum context length exceeded")

    monkeypatch.setattr(llm, "acompletion", stream)
    with pytest.raises(ValueError):
        asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))

    assert calls == ["http://p1"]


def test_cached_tokens_are_reported_from_usage(monkeypatch):
    """命中数必须原样带出来：预算按"未命中 + 输出"算，靠它区分命中与未命中。"""
    _router(monkeypatch)

    async def stream(**kwargs):
        async def gen():
            yield {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 5,
                                            "total_tokens": 105,
                                            "prompt_tokens_details": {"cached_tokens": 80}}}
            yield {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}

        return gen()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock()))

    assert result.cached_tokens == 80
    assert result.usage["prompt_tokens"] == 100
    assert result.usage["completion_tokens"] == 5


def test_attempt_log_explains_retry_then_switch(monkeypatch):
    """复盘要能看出：哪家、第几次、什么错、等多久；这里验证链路顺序与分类。"""
    _router(monkeypatch)
    calls: list[str] = []

    async def stream(**kwargs):
        base = _base(kwargs)
        calls.append(base)
        if base == "http://p1":
            raise _gateway_error()
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))

    assert result.provider_id == "prov_2"
    assert [item["outcome"] for item in result.attempt_log] == ["retry", "retry", "switch", "success"]
    assert [item["provider"] for item in result.attempt_log] == ["prov_1", "prov_1", "prov_1", "prov_2"]
    assert result.attempt_log[0]["status"] == 502
    assert result.attempt_log[0]["error_code"] == "provider_busy"
    assert result.attempt_log[0]["wait_ms"] >= 0  # 测试里退避被压成 0
    assert result.attempt_log[-1]["provider"] == "prov_2"


def test_auth_failure_logs_switch_not_retry(monkeypatch):
    _router(monkeypatch)

    async def stream(**kwargs):
        if _base(kwargs) == "http://p1":
            raise litellm_exceptions.AuthenticationError(message="bad key", llm_provider="openai", model="test")
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=3))
    assert [item["outcome"] for item in result.attempt_log] == ["switch", "success"]
    assert result.attempt_log[0]["error_code"] == "provider_auth"


def test_success_reports_first_token_latency(monkeypatch):
    _router(monkeypatch)

    async def stream(**kwargs):
        return _ok_stream()

    monkeypatch.setattr(llm, "acompletion", stream)
    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock()))
    assert result.first_token_ms is not None
    assert result.first_token_ms >= 0


def test_failure_carries_attempt_log_for_the_runner(monkeypatch):
    """最终失败时异常上也带链路：执行器把它写进步骤详情，复盘才有据可查。"""
    _router(monkeypatch)

    async def stream(**kwargs):
        raise _gateway_error()

    monkeypatch.setattr(llm, "acompletion", stream)
    with pytest.raises(litellm_exceptions.BadGatewayError) as caught:
        asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock(), attempts=1))
    assert [item["outcome"] for item in caught.value.attempt_log] == ["switch", "error"]
