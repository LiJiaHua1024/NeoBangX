"""仅由独立的内网管理服务挂载。"""
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from . import anysearch
from .settings import WorkspaceSettings, load_settings, save_settings, admin_settings
from .mcp import connection, MCPConfigError, MCPError

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
    data = admin_settings()
    # 由已保存的工具目录推导，界面上不用再存一份映射。
    data["mcp_provided"], data["mcp_missing"] = anysearch.provided(data.get("mcp_tools") or [])
    return data


def _validate_and_save(cfg):
    if cfg.mcp_enabled:
        if not cfg.mcp_url:
            raise HTTPException(422, "请先填写 AnySearch 的 MCP 地址")
        _, missing = anysearch.provided(cfg.mcp_tools)
        if missing:
            raise HTTPException(422, "网页搜索需要 AnySearch 的 search、batch_search、extract、get_sub_domains；"
                                     f"当前缺少：{'、'.join(missing)}。请重新测试连接后再保存")
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
        tools = [{"name": t["name"], "description": t.get("description", ""),
                  "inputSchema": t.get("inputSchema", {})} for t in items]
        provided, missing = anysearch.provided([item["name"] for item in tools])
        return {"tools": tools, "provided": provided, "missing": missing}
    except Exception as exc:
        # 不透传 HTTP 客户端异常中的 URL/凭据。
        # 配置类错误是管理员自己填的，用 422 让他知道改哪里；其余是连接/协议问题。
        status = 422 if isinstance(exc, MCPConfigError) else 502
        raise HTTPException(status, str(exc) if isinstance(exc, MCPError) else "MCP 连接失败，请检查地址、令牌和网络") from None


class SearchTest(BaseModel):
    settings: SettingsWrite
    query: str = Field(min_length=1, max_length=1000)


@router.post("/search")
async def test_search(body: SearchTest):
    try:
        return await anysearch.call(resolved(body.settings), "web_search", {"query": body.query})
    except MCPConfigError as exc:
        # 含 MCPToolError 与参数校验的 ValueError：改配置/改输入能解决。
        raise HTTPException(422, str(exc)) from None
    except MCPError:
        raise HTTPException(502, "搜索失败，请检查配置与服务状态") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception:
        raise HTTPException(502, "搜索失败，请检查配置与服务状态") from None
