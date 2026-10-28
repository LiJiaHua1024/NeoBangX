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
