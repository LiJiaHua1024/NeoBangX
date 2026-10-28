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
    """MCP 调用失败。按原因细分，便于排查"是配置错、网络断，还是对方协议不对"。"""

    kind = "unknown"


class MCPConfigError(MCPError):
    """地址/工具/参数等配置问题：改配置能解决。"""

    kind = "config"


class MCPTransportError(MCPError):
    """连不上、超时、被对方断开：稍后重试或检查网络。"""

    kind = "transport"


class MCPProtocolError(MCPError):
    """对方返回的内容不符合预期：换服务或对齐协议版本。"""

    kind = "protocol"


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
                    raise MCPTransportError(f"MCP 请求失败（HTTP {response.status_code}）")
                session = response.headers.get("mcp-session-id")
                if session:
                    self.headers["Mcp-Session-Id"] = session
                if notification:
                    return {}
                if "text/event-stream" in response.headers.get("content-type", ""):
                    return await self._read_sse(response, payload["id"])
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise MCPProtocolError("MCP 返回内容过大，请缩小查询范围")
                    chunks.append(chunk)
                try:
                    message = json.loads(b"".join(chunks))
                except ValueError as exc:
                    raise MCPProtocolError("MCP 返回的不是合法 JSON") from exc
                if message.get("id") != payload["id"]:
                    raise MCPProtocolError("MCP 响应编号不匹配")
                return self.result(message)

    async def _read_sse(self, response, request_id):
        """按原始字节累计：先卡上限再拼行。

        原来按行累计，单行超大时整行已经进了内存才检查，峰值远高于上限。
        """
        buffer = bytearray()
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise MCPProtocolError("MCP 返回内容过大，请缩小查询范围")
            buffer.extend(chunk)
            while True:
                cut = buffer.find(b"\n\n")
                if cut < 0:
                    break
                block = bytes(buffer[:cut])
                del buffer[: cut + 2]
                message = self._parse_sse_block(block)
                if message is not None and message.get("id") == request_id:
                    return self.result(message)
        if buffer.strip():
            message = self._parse_sse_block(bytes(buffer))
            if message is not None and message.get("id") == request_id:
                return self.result(message)
        raise MCPProtocolError("MCP 流已结束但未返回本次请求结果")

    @staticmethod
    def _parse_sse_block(block):
        data = []
        for line in block.decode("utf-8", "replace").replace("\r\n", "\n").split("\n"):
            if line.startswith("data:"):
                data.append(line[5:].lstrip(" "))
        if not data:
            return None
        try:
            return json.loads("\n".join(data))
        except ValueError as exc:
            raise MCPProtocolError("MCP 返回的事件不是合法 JSON") from exc

    @staticmethod
    def result(message):
        if message.get("error"):
            # 服务错误可能回显带密钥的 URL，不直接暴露原文。
            raise MCPProtocolError(f"MCP 返回协议错误（{message['error'].get('code', 'unknown')}）")
        return message.get("result") or {}

    async def initialize(self):
        result = await self.rpc("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "NeoBangX", "version": "1.0"},
        })
        version = result.get("protocolVersion")
        if version not in PROTOCOLS:
            raise MCPProtocolError("MCP 协议版本不兼容")
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
        raise MCPProtocolError("MCP 工具目录分页过多")

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
        raise MCPConfigError("网页搜索参数与 MCP 工具不匹配，请管理员检查查询字段和固定参数") from exc
    try:
        async with connection(cfg) as client:
            result = await client.rpc("tools/call", {"name": cfg.mcp_tool, "arguments": arguments})
    except MCPError:
        raise
    except Exception:
        raise MCPTransportError("搜索服务连接失败或超时，请稍后重试或联系管理员") from None
    if result.get("isError"):
        raise MCPProtocolError("搜索服务返回工具错误，本次未获得有效搜索结果")
    return result
