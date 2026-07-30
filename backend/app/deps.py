"""FastAPI 依赖：认证与数据库会话。"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UsageCode
from app.services.usage_code import get_active_code_from_token


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="请先输入使用码")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="无效的 Authorization 头")
    return parts[1].strip()


def get_current_code(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
) -> UsageCode:
    token = _extract_bearer(authorization)
    return get_active_code_from_token(db, token)


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
