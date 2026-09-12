"""FastAPI 依赖：认证与数据库会话。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UsageCode
from app.services.usage_code import get_active_code_from_token, resolve_code_lenient

# 使用码不可用原因 -> (HTTP 状态码, 文案)；与严格依赖的报错逐字保持一致
_CODE_ERRORS: dict[str, tuple[int, str]] = {
    "missing": (401, "请先输入使用码"),
    "invalid": (401, "无效的登录凭证"),
    "expired": (401, "登录已过期，请重新输入使用码"),
    "unknown": (401, "使用码不存在"),
    "disabled": (403, "使用码已被禁用"),
    "exhausted": (403, "额度已用尽"),
}


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="请先输入使用码")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="无效的 Authorization 头")
    return parts[1].strip()


def _extract_bearer_lenient(authorization: Optional[str]) -> str:
    """宽松取 Bearer 原文：缺失/格式非法一律返回空串，交由原因码处理。"""
    if not authorization:
        return ""
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return ""
    return parts[1].strip()


@dataclass(frozen=True)
class CodeContext:
    """可缺失的使用码上下文。

    code 非空表示使用码当前可用；否则 reason 说明不可用原因，
    调用方可据此决定放行（免费模型无码可用）或抛 error()。
    """

    code: UsageCode | None = None
    reason: str = "missing"

    @property
    def ok(self) -> bool:
        return self.code is not None

    def error(self) -> HTTPException:
        status_code, detail = _CODE_ERRORS.get(self.reason, (401, "请先输入使用码"))
        return HTTPException(status_code=status_code, detail=detail)


def get_current_code(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
) -> UsageCode:
    token = _extract_bearer(authorization)
    return get_active_code_from_token(db, token)


def get_code_context(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
) -> CodeContext:
    """可选认证：无码/失效码不报错，只在后续判定失败时报对应错误。"""
    token = _extract_bearer_lenient(authorization)
    code, reason = resolve_code_lenient(db, token)
    return CodeContext(code=code, reason=reason)


def get_optional_code(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
) -> Optional[UsageCode]:
    if not authorization:
        return None
    try:
        token = _extract_bearer(authorization)
        return get_active_code_from_token(db, token)
    except HTTPException:
        return None
