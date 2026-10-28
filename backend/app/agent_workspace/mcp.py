"""管理端配置的 Streamable HTTP MCP；凭据不进入模型或用户端。

协议参考 https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
支持 JSON 与 SSE 响应、初始化、会话和分页工具发现。
"""
import asyncio
import json
from contextlib import asynccontextmanager

import httpx

PROTOCOLS = {"2025-06-18", "2025-03-26", "2025-11-25"}
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class MCPError(ValueError):
    pass


class MCPClient:
    def __init__(self, cfg, transport=None):
        self.cfg = cfg
        self.counter = 0
        self.headers = {"Accept": "application/json, text/event-stream"}
        if cfg.mcp_token:
            self.headers["Authorization"] = "Bearer " + cfg.mcp_token
        self.http = httpx.AsyncClient(timeout=cfg.mcp_timeout, follow_redirects=False, transport=transport)

    async def rpc(self, method, params=None, notification=False):
        self.counter += 1
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notification:
            payload["id"] = self.counter
        async with asyncio.timeout(self.cfg.mcp_timeout):
            async with self.http.stream("POST", self.cfg.mcp_url, headers=self.headers, json=payload) as response:
                if response.status_code >= 300:
                    raise MCPError(f"MCP 请求失败（HTTP {response.status_code}）")
                session = response.headers.get("mcp-session-id")
                if session:
                    self.headers["Mcp-Session-Id"] = session
                if notification:
                    return {}
                if "text/event-stream" in response.headers.get("content-type", ""):
                    lines, size = [], 0
                    async for line in response.aiter_lines():
                        size += len(line.encode("utf-8"))
                        if size > MAX_RESPONSE_BYTES:
                            raise MCPError("MCP 返回内容过大，请缩小查询范围")
                        if not line and lines:
                            message = json.loads("\n".join(lines))
                            lines = []
                            if message.get("id") == payload["id"]:
                                return self.result(message)
                        elif line.startswith("data:"):
                            lines.append(line[5:].lstrip(" "))
                    if lines:
                        message = json.loads("\n".join(lines))
                        if message.get("id") == payload["id"]:
                            return self.result(message)
                    raise MCPError("MCP 流已结束但未返回本次请求结果")
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise MCPError("MCP 返回内容过大，请缩小查询范围")
                    chunks.append(chunk)
                message = json.loads(b"".join(chunks))
                if message.get("id") != payload["id"]:
                    raise MCPError("MCP 响应编号不匹配")
                return self.result(message)

    @staticmethod
    def result(message):
        if message.get("error"):
            # 服务错误可能回显带密钥的 URL，不直接暴露原文。
            raise MCPError(f"MCP 返回协议错误（{message['error'].get('code', 'unknown')}）")
        return message.get("result") or {}

    async def initialize(self):
        result = await self.rpc("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "NeoBangX", "version": "1.0"},
        })
        version = result.get("protocolVersion")
        if version not in PROTOCOLS:
            raise MCPError("MCP 协议版本不兼容")
        self.headers["MCP-Protocol-Version"] = version
        await self.rpc("notifications/initialized", notification=True)

    async def list_tools(self):
        found, cursor = [], None
        for _ in range(20):
            result = await self.rpc("tools/list", {"cursor": cursor} if cursor else {})
            found.extend(result.get("tools") or [])
            cursor = result.get("nextCursor")
            if not cursor:
                return found
        raise MCPError("MCP 工具目录分页过多")

    async def close(self):
        if self.headers.get("Mcp-Session-Id"):
            try:
                # 停止运行时 close 也在取消路径上，DELETE 不能按默认 5s 拖住收尾。
                await self.http.delete(self.cfg.mcp_url, headers=self.headers, timeout=2)
            except httpx.HTTPError:
                pass
        await self.http.aclose()


@asynccontextmanager
async def connection(cfg, transport=None):
    client = MCPClient(cfg, transport)
    try:
        await client.initialize()
        yield client
    finally:
        await client.close()


async def search(cfg, query: str):
    from jsonschema import validate, ValidationError

    arguments = {**cfg.mcp_arguments, cfg.mcp_query_field: query}
    try:
        validate(arguments, cfg.mcp_schema)
    except ValidationError as exc:
        raise MCPError("网页搜索参数与 MCP 工具不匹配，请管理员检查查询字段和固定参数") from exc
    try:
        async with connection(cfg) as client:
            result = await client.rpc("tools/call", {"name": cfg.mcp_tool, "arguments": arguments})
    except MCPError:
        raise
    except Exception:
        raise MCPError("搜索服务连接失败或超时，请稍后重试或联系管理员") from None
    if result.get("isError"):
        raise MCPError("搜索服务返回工具错误，本次未获得有效搜索结果")
    return result
