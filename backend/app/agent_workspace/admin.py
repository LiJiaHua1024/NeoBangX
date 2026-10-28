"""仅由独立的内网管理服务挂载。"""
import asyncio
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError
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
        saved = load_settings()
        # 令牌绑定到它被保存时的那台主机：换地址就必须重新输入，
        # 否则"改地址 + 令牌留空"会把已保存的密钥发给新填的任意主机。
        if saved.mcp_token and urlsplit(body.mcp_url).netloc != urlsplit(saved.mcp_url).netloc:
            raise HTTPException(422, "MCP 地址已变更，请重新填写令牌")
        data["mcp_token"] = saved.mcp_token
    return WorkspaceSettings(**data)


@router.get("")
def get_settings():
    return admin_settings()


def _validate_and_save(cfg):
    if cfg.mcp_enabled:
        if not cfg.mcp_url or not cfg.mcp_tool or not cfg.mcp_schema:
            raise HTTPException(422, "请先测试连接、选择搜索工具，再开启网页搜索")
        try:
            Draft202012Validator.check_schema(cfg.mcp_schema)
            Draft202012Validator(cfg.mcp_schema).validate({**cfg.mcp_arguments, cfg.mcp_query_field: "测试查询"})
        except Exception:
            raise HTTPException(422, "查询字段或固定参数不符合所选工具的输入格式") from None
    return save_settings(cfg)


@router.put("")
def put_settings(body: SettingsWrite):
    """整文档替换：未传的字段回落到默认值（保留是为了兼容既有调用方）。"""
    return _validate_and_save(resolved(body))


@router.patch("")
def patch_settings(body: dict):
    """只改传过来的字段：`{"enabled": false}` 不会把预算与 MCP 配置一起清空。"""
    if not isinstance(body, dict):
        raise HTTPException(422, "请求体需为 JSON 对象")
    clear_token = bool(body.get("clear_token"))
    current = admin_settings()
    current.pop("has_token", None)
    current.pop("mcp_token", None)
    merged = {**current, **{key: value for key, value in body.items() if key != "clear_token"}}
    unknown = set(merged) - set(WorkspaceSettings.model_fields)
    if unknown:
        raise HTTPException(422, f"未知字段：{', '.join(sorted(unknown))}")
    if clear_token:
        merged["mcp_token"] = ""
    elif not merged.get("mcp_token"):
        # 与 PUT 同一口径：令牌绑定到保存时的主机，换地址必须重新填。
        saved = load_settings()
        if saved.mcp_token and urlsplit(merged.get("mcp_url", "")).netloc != urlsplit(saved.mcp_url).netloc:
            raise HTTPException(422, "MCP 地址已变更，请重新填写令牌")
        merged["mcp_token"] = saved.mcp_token
    try:
        cfg = WorkspaceSettings(**merged)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors())) from None
    return _validate_and_save(cfg)


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
