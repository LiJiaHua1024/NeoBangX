"""管理后台 API（仅内网管理端口暴露，无需登录）。"""

from __future__ import annotations

import logging
import re
import secrets as secrets_lib
from datetime import datetime, timezone

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, desc, func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Device, LogPayload, UsageCode, UsageLog
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
    MINERU_MODES,
    MINERU_MODELS,
    REASONING_EFFORTS,
    get_config_map,
    get_config_value,
    mask_config,
    parse_models,
    resolve_llm_settings,
    serialize_models,
    set_config_values,
)
from app.services.usage_code import create_codes, write_jwt_secret_file

logger = logging.getLogger(__name__)

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
    chores_only: bool = Field(False, description="仅用于 Chores，不在 8000 用户端展示")
    enabled: bool = Field(True, description="是否启用，禁用后用户端与 Chores 均不可用")


class ConfigUpdateRequest(BaseModel):
    default_model: Optional[str] = None
    models: Optional[List[ModelEntry]] = None
    chores_model: Optional[str] = None
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


class ProviderBinding(BaseModel):
    provider_id: str = Field(..., min_length=1, max_length=64)
    provider_model_id: str = Field("", max_length=256, description="该 Provider 下实际的 LiteLLM 模型 ID，留空回退逻辑 model_id")


class ModelProvidersUpdateRequest(BaseModel):
    map: dict[str, List[str]] = Field(..., description="model_id -> 有序 provider_id 列表（兼容）")


class SingleModelProvidersRequest(BaseModel):
    ordered_provider_ids: List[str] = Field(default_factory=list, description="该模型的有序 Provider 列表，首位优先（兼容）")
    bindings: Optional[List[ProviderBinding]] = Field(None, description="该模型的有序绑定（含 provider_model_id），优先于 ordered_provider_ids")


class ProviderTestRequest(BaseModel):
    model: Optional[str] = Field(None, max_length=128, description="用于测试的模型，不填则用该 Provider 绑定的首个模型")
    prompt: Optional[str] = Field(None, max_length=2000, description="测试 prompt")
    provider_model_id: Optional[str] = Field(None, max_length=256, description="指定测试时使用的 provider_model_id")


@router.get("/stats")
async def stats(db: Annotated[Session, Depends(get_db)]):
    total_codes = db.query(func.count(UsageCode.id)).scalar() or 0
    enabled_codes = (
        db.query(func.count(UsageCode.id)).filter(UsageCode.is_enabled.is_(True)).scalar()
        or 0
    )
    total_logs = db.query(func.count(UsageLog.id)).scalar() or 0
    total_used = db.query(func.coalesce(func.sum(UsageCode.used_count), 0)).scalar() or 0
    try:
        total_devices = db.query(func.count(Device.id)).scalar() or 0
    except Exception:
        total_devices = 0
    return {
        "total_codes": total_codes,
        "enabled_codes": enabled_codes,
        "total_logs": total_logs,
        "total_used": int(total_used),
        "total_devices": int(total_devices),
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
    device: str = "",
    db: Optional[Session] = None,
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
    if device and device.strip():
        query = _filter_by_device(query, device.strip(), db)
    return query


def _filter_by_device(query, device: str, db: Optional[Session]):
    """按设备筛选日志：短码 / 备注 / 自动昵称 / 全哈希模糊匹配。

    纯数字视为 device_id 精确匹配；否则先在 devices 表中找候选 id，
    再与 usage_logs.fingerprint 模糊匹配取并集。db 为空时退化为仅指纹匹配。
    """
    like = f"%{device}%"
    device_ids: list[int] = []
    if db is not None:
        try:
            q = db.query(Device.id).filter(
                or_(
                    Device.short_code.ilike(like),
                    Device.note.ilike(like),
                    Device.auto_name.ilike(like),
                    Device.fingerprint.ilike(like),
                )
            )
            device_ids = [row[0] for row in q.all()]
        except Exception:
            device_ids = []
    conditions = [UsageLog.fingerprint.ilike(like)]
    if device.strip().isdigit():
        conditions.append(UsageLog.device_id == int(device.strip()))
    if device_ids:
        conditions.append(UsageLog.device_id.in_(device_ids))
    return query.filter(or_(*conditions))


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
    device: str = Query("", description="按设备筛选（短码/备注/昵称/指纹模糊，数字按设备 ID）"),
):
    query = _apply_log_filters(
        db.query(UsageLog),
        code=code, tool_id=tool_id, model=model, status=status, start=start, end=end, provider=provider,
        device=device, db=db,
    )
    row = query.with_entities(
        func.count(UsageLog.id).label("total"),
        func.coalesce(func.sum(case((status_matches("success"), 1), else_=0)), 0).label("success"),
        func.coalesce(func.sum(case((status_matches("cancelled"), 1), else_=0)), 0).label("cancelled"),
        func.coalesce(func.sum(case((status_matches("error"), 1), else_=0)), 0).label("error"),
        func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
        func.avg(UsageLog.duration_ms).label("avg_duration_ms"),
        func.count(func.distinct(UsageLog.device_id)).label("distinct_devices"),
    ).one()
    return {
        "total": int(row.total),
        "success": int(row.success),
        "cancelled": int(row.cancelled),
        "error": int(row.error),
        "total_tokens": int(row.total_tokens),
        "avg_duration_ms": round(float(row.avg_duration_ms)) if row.avg_duration_ms is not None else None,
        "distinct_devices": int(row.distinct_devices or 0),
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
    device: str = Query("", description="按设备筛选（短码/备注/昵称/指纹模糊，数字按设备 ID）"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    query = _apply_log_filters(
        db.query(UsageLog),
        code=code, tool_id=tool_id, model=model, status=status, start=start, end=end, provider=provider,
        device=device, db=db,
    )

    total = query.count()
    rows = (
        query.order_by(desc(UsageLog.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [r.to_dict() for r in rows]
    _attach_devices(db, items)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


def _attach_devices(db: Session, items: list[dict]) -> None:
    """为日志项批量挂载 device 摘要（避免 N+1，缺失则挂 None）。"""
    ids = sorted({i.get("device_id") for i in items if i.get("device_id")})
    if not ids:
        for i in items:
            i["device"] = None
        return
    try:
        rows = db.query(Device).filter(Device.id.in_(ids)).all()
    except Exception:
        for i in items:
            i["device"] = None
        return
    by_id = {d.id: d.to_dict() for d in rows}
    for i in items:
        i["device"] = by_id.get(i.get("device_id"))


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
    device = db.get(Device, row.device_id) if row.device_id else None
    data["device"] = device.to_dict() if device is not None else None
    return data


class UpdateDeviceRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=255, description="设备备注（全局，不传则不变，空串则清空）")
    color: Optional[str] = Field(
        None, max_length=64,
        description="徽章色点：不传则不变，空串则恢复自动颜色，#rgb/#rrggbb 则设为自选颜色",
    )


_DEVICE_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _normalize_device_color(custom: str) -> str:
    """#rgb 展开为 #rrggbb 并统一小写，前端各主题下展示一致。"""
    custom = custom.strip().lower()
    if len(custom) == 4:
        custom = "#" + "".join(ch * 2 for ch in custom[1:])
    return custom


@router.get("/devices")
async def list_devices(
    db: Annotated[Session, Depends(get_db)],
    q: str = Query("", description="按短码/备注/昵称/指纹搜索"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    query = db.query(Device)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Device.short_code.ilike(like),
                Device.note.ilike(like),
                Device.auto_name.ilike(like),
                Device.fingerprint.ilike(like),
            )
        )
    total = query.count()
    rows = (
        query.order_by(desc(Device.last_seen_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    ids = [d.id for d in rows]
    code_counts: dict[int, int] = {}
    last_info: dict[int, dict] = {}
    if ids:
        try:
            for device_id, count in (
                db.query(UsageLog.device_id, func.count(func.distinct(UsageLog.code)))
                .filter(UsageLog.device_id.in_(ids))
                .group_by(UsageLog.device_id)
                .all()
            ):
                code_counts[int(device_id)] = int(count)
        except Exception:
            code_counts = {}
        try:
            max_ids = dict(
                db.query(UsageLog.device_id, func.max(UsageLog.id))
                .filter(UsageLog.device_id.in_(ids))
                .group_by(UsageLog.device_id)
                .all()
            )
            if max_ids:
                for log in (
                    db.query(UsageLog).filter(UsageLog.id.in_(list(max_ids.values()))).all()
                ):
                    if log.device_id is not None:
                        last_info[int(log.device_id)] = {
                            "last_ip": log.ip or "",
                            "last_code": log.code or "",
                            "last_log_at": log.created_at.isoformat() if log.created_at else None,
                        }
        except Exception:
            last_info = {}
    items = []
    for d in rows:
        item = d.to_dict()
        item["code_count"] = code_counts.get(d.id, 0)
        info = last_info.get(d.id, {})
        item["last_ip"] = info.get("last_ip", "")
        item["last_code"] = info.get("last_code", "")
        item["last_log_at"] = info.get("last_log_at")
        items.append(item)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.patch("/devices/{device_id}")
async def update_device(
    device_id: int,
    req: UpdateDeviceRequest,
    db: Annotated[Session, Depends(get_db)],
):
    row = db.get(Device, device_id)
    if not row:
        raise HTTPException(status_code=404, detail="设备不存在")
    if req.note is not None:
        row.note = req.note.strip()[:255]
    if req.color is not None:
        custom = req.color.strip()
        if not custom:
            from app.services.device_fingerprint import color_for

            row.color = color_for(row.fingerprint)
        elif _DEVICE_COLOR_RE.fullmatch(custom):
            row.color = _normalize_device_color(custom)
        else:
            raise HTTPException(status_code=400, detail="颜色格式不合法（仅支持 #rgb / #rrggbb）")
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.get("/config")
async def get_admin_config(db: Annotated[Session, Depends(get_db)]):
    cfg = get_config_map(db)
    masked = mask_config(cfg)
    # 模型列表以结构化形式返回（兼容旧逗号格式自动升级，含 chores_only）
    masked["models"] = parse_models(cfg.get("models", ""))
    # 多 Provider 聚合信息
    try:
        from app.services.provider_config import get_model_provider_details

        providers = list_providers(db, mask=True)
        model_provider_map = get_model_provider_map(db)
        model_provider_details = get_model_provider_details(db)
        llm_cfg = resolve_llm_settings(db)
        available_model_ids = list(llm_cfg.get("available_model_ids") or [])
    except Exception:
        providers = []
        model_provider_map = {}
        model_provider_details = {}
        available_model_ids = []
    return {
        "config": masked,
        "keys": CONFIG_KEYS,
        "reasoning_efforts": sorted(REASONING_EFFORTS),
        "has_llm_api_key": False,
        "has_chores_api_key": False,
        "providers": providers,
        "model_provider_map": model_provider_map,
        "model_provider_details": model_provider_details,
        "available_model_ids": available_model_ids,
    }


@router.put("/config")
async def update_admin_config(
    req: ConfigUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
):
    raw = req.model_dump(exclude_unset=True)
    updates: dict[str, str] = {}
    # 预解析 models 供 default/chores 校验（若本次同时提交 models）
    pending_models = None
    if "models" in raw and raw["models"] is not None:
        # 校验 thinking 取值后序列化
        for item in raw["models"]:
            effort = item.get("reasoning_effort")
            if effort and effort not in REASONING_EFFORTS:
                raise HTTPException(
                    status_code=400,
                    detail=f"非法思考强度：{effort}",
                )
        pending_models = parse_models(serialize_models([m.model_dump() if hasattr(m, "model_dump") else m for m in raw["models"]]))
    for key, value in raw.items():
        if value is None:
            continue
        if key == "log_payload":
            updates[key] = "true" if value else "false"
            continue
        if key == "models":
            updates[key] = serialize_models([m.model_dump() if hasattr(m, "model_dump") else m for m in value])
            continue
        if key == "default_model":
            dm = str(value or "").strip()
            if dm:
                # 校验 default_model 不可为仅 Chores / 已禁用模型
                check_models = pending_models if pending_models is not None else parse_models(get_config_map(db).get("models", ""))
                hit = next((m for m in check_models if m["id"] == dm), None)
                if not hit:
                    raise HTTPException(status_code=400, detail=f"默认模型不存在：{dm}")
                if hit.get("chores_only"):
                    raise HTTPException(status_code=400, detail="默认模型不可为仅 Chores 模型")
                if not hit.get("enabled", True):
                    raise HTTPException(status_code=400, detail=f"默认模型已禁用：{dm}")
            updates[key] = str(value)
            continue
        if key == "chores_model":
            cm = str(value or "").strip()
            if cm:
                check_models = pending_models if pending_models is not None else parse_models(get_config_map(db).get("models", ""))
                hit = next((m for m in check_models if m["id"] == cm), None)
                if not hit:
                    raise HTTPException(status_code=400, detail=f"Chores 模型不存在：{cm}")
                if not hit.get("enabled", True):
                    raise HTTPException(status_code=400, detail=f"Chores 模型已禁用：{cm}")
            updates[key] = str(value)
            continue
        updates[key] = str(value)

    # 最终一致性校验：仅改 models（禁用某模型）但未同步改 default/chores 时拦截，
    # 避免存量 default/chores 指向已禁用模型（与仅 Chores 同理）。
    try:
        _old_cfg = get_config_map(db)
    except Exception:
        _old_cfg = {}
    _final_models = pending_models if pending_models is not None else parse_models(_old_cfg.get("models", ""))
    if "default_model" in raw:
        _final_default = str(raw.get("default_model") or "").strip()
    else:
        _final_default = (_old_cfg.get("default_model") or "").strip()
    if "chores_model" in raw:
        _final_chores = str(raw.get("chores_model") or "").strip()
    else:
        _final_chores = (_old_cfg.get("chores_model") or "").strip()
    if _final_models:
        if _final_default:
            _hit = next((m for m in _final_models if m["id"] == _final_default), None)
            if _hit is not None and not _hit.get("enabled", True):
                raise HTTPException(status_code=400, detail=f"默认模型已禁用：{_final_default}，请先切换默认模型再禁用")
        if _final_chores:
            _hit = next((m for m in _final_models if m["id"] == _final_chores), None)
            if _hit is not None and not _hit.get("enabled", True):
                raise HTTPException(status_code=400, detail=f"Chores 模型已禁用：{_final_chores}，请先切换 Chores 模型再禁用")

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
    from app.services.provider_config import get_model_provider_details

    prov = db.get(LlmProvider, provider_id)
    if not prov:
        raise HTTPException(status_code=404, detail="Provider 不存在")
    # 选取测试模型
    model = (req.model or "").strip()
    provider_model_id = (req.provider_model_id or "").strip()
    if not model:
        # 取该 Provider 绑定的首个模型
        mp_map = get_model_provider_map(db)
        for mid, pids in mp_map.items():
            if provider_id in pids:
                model = mid
                break
        if not model:
            from app.services.runtime_config import get_config_map, parse_models

            cfg = get_config_map(db)
            models = parse_models(cfg.get("models", ""))
            if models:
                model = models[0]["id"]
    if not model:
        raise HTTPException(status_code=400, detail="无可用测试模型，请先为该 Provider 绑定模型")
    # 若未指定 provider_model_id，尝试从绑定细节中取
    if not provider_model_id:
        try:
            details = get_model_provider_details(db)
            for item in details.get(model, []):
                if item.get("provider_id") == provider_id:
                    provider_model_id = item.get("provider_model_id") or model
                    break
        except Exception:
            pass
    actual_model = provider_model_id or model
    prompt = (req.prompt or "Hello").strip() or "Hello"
    llm = LLMService(
        api_key=prov.api_key or "",
        default_model=actual_model,
        base_url=prov.base_url or "",
        max_tokens=16,
        timeout=15,
    )
    started = monotonic()
    try:
        out = await llm.chat(user_prompt=prompt, model=actual_model, max_tokens=16)
        latency = int((monotonic() - started) * 1000)
        return {"status": "ok", "model": model, "provider_model_id": actual_model, "latency_ms": latency, "output": out[:200]}
    except Exception as e:
        latency = int((monotonic() - started) * 1000)
        raise HTTPException(status_code=502, detail=f"测试失败（{latency}ms）：{e}") from e


# ---- 多 Provider 聚合：Model → Provider 优先级 ----

@router.get("/model-providers")
async def get_model_providers_api(db: Annotated[Session, Depends(get_db)]):
    from app.services.provider_config import get_model_provider_details

    return {
        "map": get_model_provider_map(db),
        "details": get_model_provider_details(db),
        "providers": list_providers(db, mask=True),
    }


@router.put("/model-providers")
async def put_model_providers_api(req: ModelProvidersUpdateRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        updated = set_model_provider_map(db, req.map)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"map": updated}


@router.get("/models/{model_id:path}/providers")
async def get_single_model_providers_api(model_id: str, db: Annotated[Session, Depends(get_db)]):
    # 返回该模型的有序 provider 列表（model_id 含 /，需用 :path），含 provider_model_id
    from app.services.provider_config import get_model_provider_details

    details = get_model_provider_details(db)
    bindings = details.get(model_id, [])
    providers = list_providers(db, mask=True)
    by_id = {p["id"]: p for p in providers}
    ordered = []
    pids = []
    for item in bindings:
        pid = item.get("provider_id")
        pids.append(pid)
        if pid in by_id:
            entry = dict(by_id[pid])
            entry["provider_model_id"] = item.get("provider_model_id") or model_id
            ordered.append(entry)
    # 兼容：若 details 为空但 map 有，用 map 回退
    if not bindings:
        mp_map = get_model_provider_map(db)
        pids = mp_map.get(model_id, [])
        ordered = [by_id[pid] for pid in pids if pid in by_id]
        # 为兼容补充 provider_model_id
        for o in ordered:
            o["provider_model_id"] = model_id
    return {"model_id": model_id, "ordered_provider_ids": pids, "providers": ordered, "bindings": bindings}


@router.put("/models/{model_id:path}/providers")
async def put_single_model_providers_api(model_id: str, req: SingleModelProvidersRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        # 优先使用 bindings（含 provider_model_id），兼容旧 ordered_provider_ids
        if req.bindings is not None:
            payload = [{"provider_id": b.provider_id, "provider_model_id": b.provider_model_id or model_id} for b in req.bindings]
            ordered = set_providers_for_single_model(db, model_id, payload)
            # 返回细节
            from app.services.provider_config import get_model_provider_details

            details = get_model_provider_details(db).get(model_id, [])
            return {"model_id": model_id, "ordered_provider_ids": ordered, "bindings": details}
        else:
            ordered = set_providers_for_single_model(db, model_id, req.ordered_provider_ids)
    except ValueError as e:
        msg = str(e)
        code = 404 if "不存在" in msg else 400
        raise HTTPException(status_code=code, detail=msg) from None
    return {"model_id": model_id, "ordered_provider_ids": ordered}


# ---- MinerU 文档解析配置 ----

class MineruUpdateRequest(BaseModel):
    mode: Optional[str] = Field(None, description="precision=精准解析API（推荐）| agent=轻量解析API")
    model: Optional[str] = Field(None, description="pipeline（推荐）| vlm，仅精准模式有效")
    token: Optional[str] = Field(None, max_length=2048, description="精准模式 Token；已配置下传空/**** 表示不修改")


def _mineru_token_masked(raw: str) -> str:
    if not raw:
        return ""
    if len(raw) <= 8:
        return "****"
    return raw[:4] + "****" + raw[-4:]


@router.get("/mineru")
async def get_mineru_config(db: Annotated[Session, Depends(get_db)]):
    mode = (get_config_value(db, "mineru_mode", "precision") or "precision").strip() or "precision"
    if mode not in MINERU_MODES:
        mode = "precision"
    model = (get_config_value(db, "mineru_model", "pipeline") or "pipeline").strip() or "pipeline"
    if model not in MINERU_MODELS:
        model = "pipeline"
    token = (get_config_value(db, "mineru_token", "") or "").strip()
    return {
        "mode": mode,
        "model": model,
        "has_token": bool(token),
        "token_masked": _mineru_token_masked(token),
    }


@router.put("/mineru")
async def put_mineru_config(req: MineruUpdateRequest, db: Annotated[Session, Depends(get_db)]):
    raw = req.model_dump(exclude_unset=True)
    updates: dict[str, str] = {}
    if "mode" in raw and raw["mode"] is not None:
        mode = str(raw["mode"] or "").strip()
        if mode not in MINERU_MODES:
            raise HTTPException(status_code=400, detail=f"非法解析模式：{mode}（仅支持 precision / agent）")
        updates["mineru_mode"] = mode
    if "model" in raw and raw["model"] is not None:
        model = str(raw["model"] or "").strip()
        if model not in MINERU_MODELS:
            raise HTTPException(status_code=400, detail=f"非法模型版本：{model}（仅支持 pipeline / vlm）")
        updates["mineru_model"] = model
    if "token" in raw and raw["token"] is not None:
        token_in = str(raw["token"] or "")
        # 已配置下传空/**** 表示不修改（与 Provider 的 **** 约定一致）
        existing = (get_config_value(db, "mineru_token", "") or "").strip()
        if token_in == "" or token_in.strip() == "" or "****" in token_in:
            if existing and (token_in == "" or "****" in token_in):
                pass  # 不修改
            elif not existing and not token_in.strip():
                pass  # 本就为空
            else:
                updates["mineru_token"] = ""
        else:
            from app.services.mineru import extract_mineru_token

            token_value, token_source = extract_mineru_token(token_in)
            if not token_value:
                raise HTTPException(status_code=400, detail="未能识别出有效的 Token：请粘贴 MinerU Token 单行，或 Access Key / Secret Key 两行格式")
            logger.info("mineru token updated (source=%s)", token_source)
            updates["mineru_token"] = token_value
    # 精准模式要求 Token 非空（以前后端合并值为准）
    final_mode = updates.get("mineru_mode") or (get_config_value(db, "mineru_mode", "precision") or "precision").strip()
    if "mineru_token" in updates:
        final_token = updates["mineru_token"]
    else:
        final_token = (get_config_value(db, "mineru_token", "") or "").strip()
    if final_mode == "precision" and not final_token:
        raise HTTPException(status_code=400, detail="精准解析 API 需要填写 MinerU Token（可在 MinerU API 管理页获取），或切换为 Agent 轻量解析 API")
    if updates:
        set_config_values(db, updates)
    return await get_mineru_config(db)


@router.post("/mineru/test")
async def test_mineru_token(db: Annotated[Session, Depends(get_db)]):
    """一键测试精准 Token 是否可用：最小 file-urls/batch 探活，不实际上传（无扣费）。"""
    from time import monotonic

    from app.services.mineru import MinerUError, probe_precision_token

    token = (get_config_value(db, "mineru_token", "") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="尚未填写 MinerU Token，无法测试")
    started = monotonic()
    try:
        latency = await probe_precision_token(token=token)
        return {"status": "ok", "latency_ms": int(latency)}
    except MinerUError as e:
        raise HTTPException(status_code=e.http_status, detail=e.user_message) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"测试失败：{e}") from e
