"""管理后台 API（仅内网管理端口暴露，无需登录）。"""

from __future__ import annotations

import secrets as secrets_lib

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import UsageCode, UsageLog
from app.services.runtime_config import (
    CONFIG_KEYS,
    REASONING_EFFORTS,
    get_config_map,
    mask_config,
    parse_models,
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


@router.get("/logs")
async def list_logs(
    db: Annotated[Session, Depends(get_db)],
    code: str = Query("", description="按使用码筛选"),
    tool_id: str = Query("", description="按工具 ID 筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    query = db.query(UsageLog)
    if code:
        query = query.filter(UsageLog.code.ilike(f"%{code.strip()}%"))
    if tool_id:
        query = query.filter(UsageLog.tool_id == tool_id.strip())

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


@router.get("/config")
async def get_admin_config(db: Annotated[Session, Depends(get_db)]):
    cfg = get_config_map(db)
    masked = mask_config(cfg)
    # 模型列表以结构化形式返回（兼容旧逗号格式自动升级）
    masked["models"] = parse_models(cfg.get("models", ""))
    return {
        "config": masked,
        "keys": CONFIG_KEYS,
        "reasoning_efforts": sorted(REASONING_EFFORTS),
        "has_llm_api_key": bool(cfg.get("llm_api_key")),
        "has_chores_api_key": bool(cfg.get("chores_api_key")),
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
        return {"config": masked, "updated": []}

    cfg = set_config_values(db, updates)
    masked = mask_config(cfg)
    masked["models"] = parse_models(cfg.get("models", ""))
    return {
        "config": masked,
        "updated": list(updates.keys()),
    }
