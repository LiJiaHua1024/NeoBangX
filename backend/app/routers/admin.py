"""管理后台 API（仅内网管理端口暴露，无需登录）。"""

from __future__ import annotations

import secrets as secrets_lib
from datetime import datetime, timezone

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, desc, func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import LogPayload, UsageCode, UsageLog
from app.services.provider_config import (
    create_provider,
    delete_provider,
    get_model_provider_map,
    get_providers_for_model,
    list_providers,
    set_model_provider_map,
    set_providers_for_single_model,
    update_provider,
)
from app.services.request_log import (
    current_retention_days,
    purge_expired_logs,
    status_matches,
)
from app.services.runtime_config import (
    CONFIG_KEYS,
    REASONING_EFFORTS,
    get_config_map,
    mask_config,
    parse_models,
    resolve_llm_settings,
    serialize_models,
    set_config_values,
)
from app.services.usage_code import create_codes, write_jwt_secret_file

router = APIRouter(prefix="/api/admin", tags=["admin"])


class CreateCodeRequest(BaseModel):
    code_type: str = Field("user", description="admin | user")
    quota: int = Field(10, description="额度；admin 自动为无限")
    count: int = Field(1, ge=1, le=200, description="生成数量")
    note: str = Field("", max_length=255)


class UpdateCodeRequest(BaseModel):
    is_enabled: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=255)
    quota: Optional[int] = Field(None, description="仅普通用户码可改额度")


class ModelEntry(BaseModel):
    id: str = Field(..., min_length=1, description="LiteLLM 格式模型 ID")
    name: str = Field("", max_length=100, description="显示名称，留空回退模型 ID")
    description: str = Field("", max_length=200, description="用户端展示的模型描述，替代模型 ID 显示")
    score: Optional[float] = Field(None, ge=0, le=10, description="推荐评分 0-10，用户端以红绿圆环展示")
    reasoning_effort: Optional[str] = Field(
        None, description="思考强度：none/minimal/low/medium/high；空为供应商默认"
    )
    thinking_budget: Optional[int] = Field(
        None, ge=1, description="思考 token 预算，优先于 reasoning_effort"
    )


class ConfigUpdateRequest(BaseModel):
    default_model: Optional[str] = None
    models: Optional[List[ModelEntry]] = None
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_model: Optional[str] = None
    chores_model: Optional[str] = None
    chores_base_url: Optional[str] = None
    chores_api_key: Optional[str] = None
    max_tokens: Optional[int] = None
    timeout: Optional[int] = None
    log_payload: Optional[bool] = Field(None, description="是否记录原始输入/输出数据")
    log_retention_days: Optional[int] = Field(None, ge=0, le=36500, description="日志保留天数，0=永久")


class ProviderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    base_url: str = Field("", max_length=512, description="OpenAI 兼容 Base URL，可留空")
    api_key: str = Field("", max_length=2048, description="API Key")
    enabled: bool = Field(True)


class ProviderUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    base_url: Optional[str] = Field(None, max_length=512)
    api_key: Optional[str] = Field(None, max_length=2048)
    enabled: Optional[bool] = None


class ModelProvidersUpdateRequest(BaseModel):
    map: dict[str, List[str]] = Field(..., description="model_id -> 有序 provider_id 列表")


class SingleModelProvidersRequest(BaseModel):
    ordered_provider_ids: List[str] = Field(default_factory=list, description="该模型的有序 Provider 列表，首位优先")


class ProviderTestRequest(BaseModel):
    model: Optional[str] = Field(None, max_length=128, description="用于测试的模型，不填则用该 Provider 绑定的首个模型")
    prompt: Optional[str] = Field(None, max_length=2000, description="测试 prompt")


@router.get("/stats")
async def stats(db: Annotated[Session, Depends(get_db)]):
    total_codes = db.query(func.count(UsageCode.id)).scalar() or 0
    enabled_codes = (
        db.query(func.count(UsageCode.id)).filter(UsageCode.is_enabled.is_(True)).scalar()
        or 0
    )
    total_logs = db.query(func.count(UsageLog.id)).scalar() or 0
    total_used = db.query(func.coalesce(func.sum(UsageCode.used_count), 0)).scalar() or 0
    return {
        "total_codes": total_codes,
        "enabled_codes": enabled_codes,
        "total_logs": total_logs,
        "total_used": int(total_used),
        "security": {
            "jwt_secret_is_default": settings.jwt_secret_is_default,
        },
    }


@router.post("/jwt-secret/rotate")
async def rotate_jwt_secret():
    """一键生成新的 JWT 随机密钥：写入数据卷 jwt_secret.txt 并在本进程立即生效。

    主站(8000)进程需重启后才会加载新密钥（重启前仍用旧密钥验票，
    重启后旧登录态全部失效，老师需重新输入使用码）。若之后在 .env /
    环境变量中显式设置了 JWT_SECRET，环境配置优先，此文件自动失效。
    """
    value = secrets_lib.token_urlsafe(48)
    path = write_jwt_secret_file(value)
    settings.jwt_secret = value  # 管理后台进程立即生效
    return {
        "status": "rotated",
        "file": str(path),
        "requires_restart": True,
    }


@router.get("/codes")
async def list_codes(
    db: Annotated[Session, Depends(get_db)],
    q: str = Query("", description="按使用码或备注搜索"),
    code_type: str = Query("", description="admin | user，空为全部"),
    enabled: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = db.query(UsageCode)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (UsageCode.code.ilike(like)) | (UsageCode.note.ilike(like))
        )
    if code_type in ("admin", "user"):
        query = query.filter(UsageCode.code_type == code_type)
    if enabled is not None:
        query = query.filter(UsageCode.is_enabled.is_(enabled))

    total = query.count()
    rows = (
        query.order_by(desc(UsageCode.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [r.to_admin_dict() for r in rows],
    }


@router.post("/codes")
async def create_code_api(
    req: CreateCodeRequest,
    db: Annotated[Session, Depends(get_db)],
):
    codes = create_codes(
        db,
        code_type=req.code_type,
        quota=req.quota,
        count=req.count,
        note=req.note,
    )
    return {
        "count": len(codes),
        "items": [c.to_admin_dict() for c in codes],
    }


@router.patch("/codes/{code_id}")
async def update_code(
    code_id: int,
    req: UpdateCodeRequest,
    db: Annotated[Session, Depends(get_db)],
):
    row = db.get(UsageCode, code_id)
    if not row:
        raise HTTPException(status_code=404, detail="使用码不存在")

    if req.is_enabled is not None:
        row.is_enabled = req.is_enabled
    if req.note is not None:
        row.note = req.note
    if req.quota is not None:
        if row.code_type == "admin":
            row.quota = -1
        else:
            if req.quota < 1:
                raise HTTPException(status_code=400, detail="额度至少为 1")
            if req.quota < row.used_count:
                raise HTTPException(
                    status_code=400,
                    detail=f"额度不能小于已用次数（{row.used_count}）",
                )
            row.quota = req.quota

    db.commit()
    db.refresh(row)
    return row.to_admin_dict()


@router.delete("/codes/{code_id}")
async def delete_code(
    code_id: int,
    db: Annotated[Session, Depends(get_db)],
):
    row = db.get(UsageCode, code_id)
    if not row:
        raise HTTPException(status_code=404, detail="使用码不存在")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": code_id}


LOG_STATUSES = ("success", "cancelled", "error")


def _parse_log_date(value: str, name: str) -> datetime:
    """解析筛选日期为 naive UTC。接受 ISO 时间串或 YYYY-MM-DD；纯日期按零点处理。"""
    raw = value.strip()
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"日期参数 {name} 格式不合法：{value}") from None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _apply_log_filters(
    query,
    *,
    code: str,
    tool_id: str,
    model: str,
    status: str,
    start: Optional[str],
    end: Optional[str],
    provider: str = "",
):
    if code:
        query = query.filter(UsageLog.code.ilike(f"%{code.strip()}%"))
    if tool_id:
        query = query.filter(UsageLog.tool_id == tool_id.strip())
    if model:
        query = query.filter(UsageLog.model.ilike(f"%{model.strip()}%"))
    if provider:
        like = f"%{provider.strip()}%"
        query = query.filter(
            (UsageLog.provider_id.ilike(like)) | (UsageLog.provider_name.ilike(like))
        )
    if status:
        if status not in LOG_STATUSES:
            raise HTTPException(status_code=400, detail=f"非法状态筛选：{status}")
        query = query.filter(status_matches(status))
    if start:
        query = query.filter(UsageLog.created_at >= _parse_log_date(start, "start"))
    if end:
        query = query.filter(UsageLog.created_at < _parse_log_date(end, "end"))
    return query


# 注意：/logs/summary 与 /logs/purge 必须先于 /logs/{log_id} 声明，
# 否则会被路径参数吞掉。
@router.get("/logs/summary")
async def logs_summary(
    db: Annotated[Session, Depends(get_db)],
    code: str = Query("", description="按使用码筛选"),
    tool_id: str = Query("", description="按工具 ID 筛选"),
    model: str = Query("", description="按模型筛选（模糊）"),
    status: str = Query("", description="success | cancelled | error，空为全部"),
    start: Optional[str] = Query(None, description="起始时间（ISO，含）"),
    end: Optional[str] = Query(None, description="结束时间（ISO，不含）"),
    provider: str = Query("", description="按 Provider 筛选（模糊，匹配 id 或名称）"),
):
    query = _apply_log_filters(
        db.query(UsageLog),
        code=code, tool_id=tool_id, model=model, status=status, start=start, end=end, provider=provider,
    )
    row = query.with_entities(
        func.count(UsageLog.id).label("total"),
        func.coalesce(func.sum(case((status_matches("success"), 1), else_=0)), 0).label("success"),
        func.coalesce(func.sum(case((status_matches("cancelled"), 1), else_=0)), 0).label("cancelled"),
        func.coalesce(func.sum(case((status_matches("error"), 1), else_=0)), 0).label("error"),
        func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
        func.avg(UsageLog.duration_ms).label("avg_duration_ms"),
    ).one()
    return {
        "total": int(row.total),
        "success": int(row.success),
        "cancelled": int(row.cancelled),
        "error": int(row.error),
        "total_tokens": int(row.total_tokens),
        "avg_duration_ms": round(float(row.avg_duration_ms)) if row.avg_duration_ms is not None else None,
    }


class PurgeLogsRequest(BaseModel):
    days: Optional[int] = Field(
        None, ge=0, description="覆盖保留天数；缺省使用 log_retention_days 配置，0=不清理",
    )


@router.post("/logs/purge")
async def purge_logs(
    req: PurgeLogsRequest,
    db: Annotated[Session, Depends(get_db)],
):
    days = req.days if req.days is not None else current_retention_days(db)
    deleted = purge_expired_logs(db, days)
    return {"status": "purged", "days": days, "deleted": deleted}


@router.get("/logs")
async def list_logs(
    db: Annotated[Session, Depends(get_db)],
    code: str = Query("", description="按使用码筛选"),
    tool_id: str = Query("", description="按工具 ID 筛选"),
    model: str = Query("", description="按模型筛选（模糊）"),
    status: str = Query("", description="success | cancelled | error，空为全部"),
    start: Optional[str] = Query(None, description="起始时间（ISO，含）"),
    end: Optional[str] = Query(None, description="结束时间（ISO，不含）"),
    provider: str = Query("", description="按 Provider 筛选（模糊）"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    query = _apply_log_filters(
        db.query(UsageLog),
        code=code, tool_id=tool_id, model=model, status=status, start=start, end=end, provider=provider,
    )

    total = query.count()
    rows = (
        query.order_by(desc(UsageLog.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [r.to_dict() for r in rows],
    }


@router.get("/logs/{log_id}")
async def log_detail(
    log_id: int,
    db: Annotated[Session, Depends(get_db)],
):
    row = db.get(UsageLog, log_id)
    if not row:
        raise HTTPException(status_code=404, detail="日志不存在")
    data = row.to_dict()
    payload = db.get(LogPayload, log_id)
    data["payload"] = (
        {"input": payload.input, "prompt": payload.prompt, "output": payload.output}
        if payload is not None
        else None
    )
    return data


@router.get("/config")
async def get_admin_config(db: Annotated[Session, Depends(get_db)]):
    cfg = get_config_map(db)
    masked = mask_config(cfg)
    # 模型列表以结构化形式返回（兼容旧逗号格式自动升级）
    masked["models"] = parse_models(cfg.get("models", ""))
    # 多 Provider 聚合信息
    try:
        providers = list_providers(db, mask=True)
        model_provider_map = get_model_provider_map(db)
        llm_cfg = resolve_llm_settings(db)
        available_model_ids = list(llm_cfg.get("available_model_ids") or [])
    except Exception:
        providers = []
        model_provider_map = {}
        available_model_ids = []
    return {
        "config": masked,
        "keys": CONFIG_KEYS,
        "reasoning_efforts": sorted(REASONING_EFFORTS),
        "has_llm_api_key": bool(cfg.get("llm_api_key")),
        "has_chores_api_key": bool(cfg.get("chores_api_key")),
        "providers": providers,
        "model_provider_map": model_provider_map,
        "available_model_ids": available_model_ids,
    }


@router.put("/config")
async def update_admin_config(
    req: ConfigUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
):
    raw = req.model_dump(exclude_unset=True)
    updates: dict[str, str] = {}
    for key, value in raw.items():
        if value is None:
            continue
        # 布尔开关统一存小写字符串，parse_log_settings 按此解析
        if key == "log_payload":
            updates[key] = "true" if value else "false"
            continue
        # 模型列表：校验 thinking 取值后序列化为 JSON 存储
        if key == "models":
            for item in value:
                effort = item.get("reasoning_effort")
                if effort and effort not in REASONING_EFFORTS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"非法思考强度：{effort}",
                    )
            updates[key] = serialize_models(value)
            continue
        # 脱敏占位符不覆盖真实密钥
        if key in ("llm_api_key", "chores_api_key") and isinstance(value, str):
            if "****" in value or value.strip() == "":
                # 空字符串允许清除；含 **** 的视为未修改
                if "****" in value:
                    continue
        updates[key] = str(value)

    if not updates:
        cfg = get_config_map(db)
        masked = mask_config(cfg)
        masked["models"] = parse_models(cfg.get("models", ""))
        try:
            providers = list_providers(db, mask=True)
            model_provider_map = get_model_provider_map(db)
        except Exception:
            providers = []
            model_provider_map = {}
        return {"config": masked, "providers": providers, "model_provider_map": model_provider_map, "updated": []}

    cfg = set_config_values(db, updates)
    # 若 models 发生变更，清理悬空的 model_provider 绑定
    if "models" in updates:
        try:
            from app.services.provider_config import ensure_model_provider_consistency

            ensure_model_provider_consistency(db)
        except Exception:
            pass
    masked = mask_config(cfg)
    masked["models"] = parse_models(cfg.get("models", ""))
    try:
        providers = list_providers(db, mask=True)
        model_provider_map = get_model_provider_map(db)
    except Exception:
        providers = []
        model_provider_map = {}
    return {
        "config": masked,
        "providers": providers,
        "model_provider_map": model_provider_map,
        "updated": list(updates.keys()),
    }


# ---- 多 Provider 聚合：Provider CRUD ----

@router.get("/providers")
async def list_providers_api(db: Annotated[Session, Depends(get_db)]):
    return {"providers": list_providers(db, mask=True)}


@router.post("/providers")
async def create_provider_api(req: ProviderCreateRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        # 处理脱敏占位不覆盖
        api_key = req.api_key
        if "****" in api_key:
            api_key = ""
        prov = create_provider(db, name=req.name, base_url=req.base_url, api_key=api_key, enabled=req.enabled)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return prov.to_dict(mask_key=True)


@router.patch("/providers/{provider_id}")
async def patch_provider_api(provider_id: str, req: ProviderUpdateRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        # api_key 含 **** 视为未修改，由 provider_config 处理
        prov = update_provider(
            db,
            provider_id,
            name=req.name,
            base_url=req.base_url,
            api_key=req.api_key,
            enabled=req.enabled,
        )
    except ValueError as e:
        msg = str(e)
        code = 404 if "不存在" in msg else 400
        raise HTTPException(status_code=code, detail=msg) from None
    return prov.to_dict(mask_key=True)


@router.delete("/providers/{provider_id}")
async def delete_provider_api(provider_id: str, db: Annotated[Session, Depends(get_db)]):
    try:
        delete_provider(db, provider_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from None
    return {"status": "deleted", "id": provider_id}


@router.post("/providers/{provider_id}/test")
async def test_provider_api(provider_id: str, req: ProviderTestRequest, db: Annotated[Session, Depends(get_db)]):
    from time import monotonic

    from app.models import LlmProvider
    from app.services.llm import LLMService

    prov = db.get(LlmProvider, provider_id)
    if not prov:
        raise HTTPException(status_code=404, detail="Provider 不存在")
    # 选取测试模型
    model = (req.model or "").strip()
    if not model:
        # 取该 Provider 绑定的首个模型
        mp_map = get_model_provider_map(db)
        # 逆查：找到第一个包含该 provider 的模型
        for mid, pids in mp_map.items():
            if provider_id in pids:
                model = mid
                break
        if not model:
            # 回退：取全局默认模型
            from app.services.runtime_config import get_config_map, parse_models

            cfg = get_config_map(db)
            models = parse_models(cfg.get("models", ""))
            if models:
                model = models[0]["id"]
    if not model:
        raise HTTPException(status_code=400, detail="无可用测试模型，请先为该 Provider 绑定模型")
    prompt = (req.prompt or "Hello").strip() or "Hello"
    llm = LLMService(
        api_key=prov.api_key or "",
        default_model=model,
        base_url=prov.base_url or "",
        max_tokens=16,
        timeout=15,
    )
    started = monotonic()
    try:
        out = await llm.chat(user_prompt=prompt, model=model, max_tokens=16)
        latency = int((monotonic() - started) * 1000)
        return {"status": "ok", "model": model, "latency_ms": latency, "output": out[:200]}
    except Exception as e:
        latency = int((monotonic() - started) * 1000)
        raise HTTPException(status_code=502, detail=f"测试失败（{latency}ms）：{e}") from e


# ---- 多 Provider 聚合：Model → Provider 优先级 ----

@router.get("/model-providers")
async def get_model_providers_api(db: Annotated[Session, Depends(get_db)]):
    return {"map": get_model_provider_map(db), "providers": list_providers(db, mask=True)}


@router.put("/model-providers")
async def put_model_providers_api(req: ModelProvidersUpdateRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        updated = set_model_provider_map(db, req.map)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"map": updated}


@router.get("/models/{model_id:path}/providers")
async def get_single_model_providers_api(model_id: str, db: Annotated[Session, Depends(get_db)]):
    # 返回该模型的有序 provider 列表（model_id 含 /，需用 :path）
    mp_map = get_model_provider_map(db)
    pids = mp_map.get(model_id, [])
    providers = list_providers(db, mask=True)
    by_id = {p["id"]: p for p in providers}
    ordered = [by_id[pid] for pid in pids if pid in by_id]
    return {"model_id": model_id, "ordered_provider_ids": pids, "providers": ordered}


@router.put("/models/{model_id:path}/providers")
async def put_single_model_providers_api(model_id: str, req: SingleModelProvidersRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        ordered = set_providers_for_single_model(db, model_id, req.ordered_provider_ids)
    except ValueError as e:
        msg = str(e)
        code = 404 if "不存在" in msg else 400
        raise HTTPException(status_code=code, detail=msg) from None
    return {"model_id": model_id, "ordered_provider_ids": ordered}
