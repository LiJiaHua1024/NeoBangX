"""MCP 传输层：字节上限在拼行之前生效，错误按原因细分。"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.agent_workspace import mcp
from app.agent_workspace.settings import WorkspaceSettings


def _cfg(**overrides):
    return WorkspaceSettings(mcp_url="https://mcp.example.com/sse", **overrides)


class _Stream(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def _client(handler):
    transport = httpx.MockTransport(handler)
    return mcp.MCPClient(_cfg(), transport=transport)


class _CountingStream(httpx.AsyncByteStream):
    """一次 1 MB、不换行；记录服务端到底被读走了多少块。"""

    def __init__(self, chunks):
        self.chunks = chunks
        self.yielded = 0

    async def __aiter__(self):
        for chunk in self.chunks:
            self.yielded += 1
            yield chunk


def test_oversized_sse_is_rejected_before_joining_lines():
    """单行超大时不能先整行进内存再判断：按原始字节累计到上限就停止读取。"""
    stream = _CountingStream([b"data: " + b"x" * (1024 * 1024)] * 24)

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=stream)

    async def run():
        client = _client(handler)
        try:
            await client.rpc("tools/call", {"name": "t", "arguments": {}})
        finally:
            await client.http.aclose()

    with pytest.raises(mcp.MCPProtocolError) as exc:
        asyncio.run(run())
    assert "过大" in str(exc.value)
    assert exc.value.kind == "protocol"
    assert stream.yielded < 24, "超限后应立即停止读取，而不是先把整整一行的剩余部分读完"


def test_sse_reply_is_parsed_from_streamed_chunks():
    body = b'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_Stream([body[:10], body[10:]]))

    async def run():
        client = _client(handler)
        try:
            return await client.rpc("tools/call", {"name": "t", "arguments": {}})
        finally:
            await client.http.aclose()

    assert asyncio.run(run()) == {"ok": True}


def test_transport_errors_are_distinguishable():
    def handler(request):
        raise httpx.ConnectError("boom")

    async def run():
        client = _client(handler)
        try:
            await client.rpc("initialize", {})
        finally:
            await client.http.aclose()

    with pytest.raises(httpx.ConnectError):
        asyncio.run(run())


def test_call_tool_maps_unknown_failures_to_transport(monkeypatch):
    class Broken:
        async def __aenter__(self):
            raise httpx.ConnectError("boom")

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(mcp, "connection", lambda cfg: Broken())
    with pytest.raises(mcp.MCPTransportError) as exc:
        asyncio.run(mcp.call_tool(_cfg(), "search", {"query": "x"}))
    assert exc.value.kind == "transport"


def test_call_tool_hands_tool_errors_back_to_the_caller(monkeypatch):
    class Broken:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def rpc(self, method, params):
            return {"isError": True, "content": [{"type": "text", "text": "bad url"}]}

    monkeypatch.setattr(mcp, "connection", lambda cfg: Broken())
    result = asyncio.run(mcp.call_tool(_cfg(), "extract", {"url": "https://x"}))
    assert result["isError"] is True
    assert result["content"][0]["text"] == "bad url"
