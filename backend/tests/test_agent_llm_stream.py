"""流式工具调用分片的装配：provider 不给 `index`、或 index 类型混杂时不能串台。"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.agent_workspace import llm


def _complete(monkeypatch, chunks):
    from app.services.llm import LLMService

    monkeypatch.setattr(llm, "_build_llm", lambda *_: LLMService(api_key="test", default_model="test"))

    async def stream(**kwargs):
        async def gen():
            for chunk in chunks:
                yield chunk

        return gen()

    monkeypatch.setattr(llm, "acompletion", stream)
    return asyncio.run(llm.complete({}, "test", [], [], 512, AsyncMock()))


def _final(reason="tool_calls"):
    return {"choices": [{"delta": {}, "finish_reason": reason}]}


def test_stream_without_index_splits_calls(monkeypatch):
    """两个并行调用都不带 index：带新 id 的分片各自成一个调用。"""
    result = _complete(monkeypatch, [
        {"choices": [{"delta": {"tool_calls": [{"id": "call_a", "type": "function", "function": {
            "name": "read_material", "arguments": '{"material_id":"m1"}'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"id": "call_b", "type": "function", "function": {
            "name": "read_document", "arguments": '{"version_id":"v1"}'}}]}}]},
        _final(),
    ])
    assert [c["function"]["name"] for c in result.calls] == ["read_material", "read_document"]
    assert [c["function"]["arguments"] for c in result.calls] == ['{"material_id":"m1"}', '{"version_id":"v1"}']


def test_stream_without_index_continues_last_call(monkeypatch):
    """没有 index 也没有新 id 的分片是上一个调用的续写。"""
    result = _complete(monkeypatch, [
        {"choices": [{"delta": {"tool_calls": [{"id": "call_a", "type": "function", "function": {
            "name": "read_material", "arguments": '{"material_'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"function": {"arguments": 'id":"m1"}'}}]}}]},
        _final(),
    ])
    assert len(result.calls) == 1
    assert result.calls[0]["function"]["arguments"] == '{"material_id":"m1"}'


@pytest.mark.parametrize("bad_index", [None, "1", 1])
def test_stream_mixed_index_types(monkeypatch, bad_index):
    """int / None / 字符串混着来时不抛 TypeError，且仍然分出两个调用。"""
    result = _complete(monkeypatch, [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_a", "function": {
            "name": "read_material", "arguments": "{}"}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": bad_index, "id": "call_b", "function": {
            "name": "ask_user", "arguments": '{"question":"q"}'}}]}}]},
        _final(),
    ])
    assert [c["id"] for c in result.calls] == ["call_a", "call_b"]


# ---- provider 顺序与错误分类 ----


def _router(monkeypatch):
    from app.services.llm_router import LLMRouter

    providers = [{"id": f"prov_{i}", "name": f"通道{i}", "base_url": f"http://p{i}",
                  "api_key": "k", "enabled": True, "provider_model_id": "test"}
                 for i in (1, 2)]
    router = LLMRouter(providers_for_model=providers, default_model="test", max_tokens=128,
                       timeout=120, first_token_timeout=5, fast_fail_ms=0)
    monkeypatch.setattr(llm, "_build_llm", lambda *_: router)
    return router


def test_breaker_open_provider_is_tried_last(monkeypatch):
    from app.services import provider_health
    from litellm import exceptions as litellm_exceptions

    _router(monkeypatch)
    order = []

    async def stream(**kwargs):
        order.append(kwargs.get("base_url") or kwargs.get("api_base"))

        async def gen():
            yield {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}

        return gen()

    monkeypatch.setattr(llm, "acompletion", stream)
    # 第一家连续瞬态失败（502）后被熔断沉底。
    gateway = lambda: litellm_exceptions.BadGatewayError(message="bad gateway", llm_provider="openai", model="test")
    provider_health.record_failure("prov_1", gateway())
    provider_health.record_failure("prov_1", gateway())
    assert provider_health.is_open("prov_1") is True

    result = asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock()))
    assert result.content == "ok"
    assert order == ["http://p2"], "熔断中的通道不应再被先打一遍"


def test_timeout_and_auth_keep_their_error_code(monkeypatch):
    _router(monkeypatch)

    async def timeout_stream(**kwargs):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(llm, "acompletion", timeout_stream)
    with pytest.raises(asyncio.TimeoutError) as exc:
        asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock()))
    assert llm.error_details(exc.value)["error_code"] == "model_timeout"

    class AuthError(Exception):
        status_code = 401

    async def auth_stream(**kwargs):
        raise AuthError("invalid api key")

    monkeypatch.setattr(llm, "acompletion", auth_stream)
    with pytest.raises(AuthError) as exc:
        asyncio.run(llm.complete({}, "test", [], [], 128, AsyncMock()))
    details = llm.error_details(exc.value)
    assert details["error_code"] == "model_auth"
    assert "凭证" in details["error"]
