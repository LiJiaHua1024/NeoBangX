"""仅由独立的内网管理服务挂载。"""
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from jsonschema import Draft202012Validator

from .settings import WorkspaceSettings, load_settings, save_settings, admin_settings
from .mcp import connection, search, MCPError

router = APIRouter(prefix="/api/admin/agent", tags=["admin-agent"])


class SettingsWrite(WorkspaceSettings):
    # 空值保留旧令牌，清空必须显式选择。
    clear_token: bool = False


def resolved(body):
    data = body.model_dump(exclude={"clear_token"})
    if not body.mcp_token and not body.clear_token:
        data["mcp_token"] = load_settings().mcp_token
    return WorkspaceSettings(**data)


@router.get("")
def get_settings():
    return admin_settings()


@router.put("")
def put_settings(body: SettingsWrite):
    cfg = resolved(body)
    if cfg.mcp_enabled:
        if not cfg.mcp_url or not cfg.mcp_tool or not cfg.mcp_schema:
            raise HTTPException(422, "请先测试连接、选择搜索工具，再开启网页搜索")
        try:
            Draft202012Validator.check_schema(cfg.mcp_schema)
            Draft202012Validator(cfg.mcp_schema).validate({**cfg.mcp_arguments, cfg.mcp_query_field: "测试查询"})
        except Exception:
            raise HTTPException(422, "查询字段或固定参数不符合所选工具的输入格式") from None
    return save_settings(cfg)


@router.post("/connect")
async def connect(body: SettingsWrite):
    cfg = resolved(body)
    try:
        async with connection(cfg) as client:
            items = await client.list_tools()
        return {"tools": [{"name": t["name"], "description": t.get("description", ""),
                           "inputSchema": t.get("inputSchema", {})} for t in items]}
    except Exception as exc:
        # 不透传 HTTP 客户端异常中的 URL/凭据。
        raise HTTPException(502, str(exc) if isinstance(exc, MCPError) else "MCP 连接失败，请检查地址、令牌和网络") from None


class SearchTest(BaseModel):
    settings: SettingsWrite
    query: str = Field(min_length=1, max_length=1000)


@router.post("/search")
async def test_search(body: SearchTest):
    try:
        return await search(resolved(body.settings), body.query)
    except Exception as exc:
        raise HTTPException(502, str(exc) if isinstance(exc, MCPError) else "搜索失败，请检查配置与服务状态") from None
