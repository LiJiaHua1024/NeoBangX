"""使用码认证 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_code
from app.models import UsageCode
from app.services.usage_code import activate_code

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ActivateRequest(BaseModel):
    code: str = Field(..., min_length=4, description="使用码")


@router.post("/activate")
async def activate(req: ActivateRequest, db: Annotated[Session, Depends(get_db)]):
    """验证使用码并返回 JWT。"""
    code, token = activate_code(db, req.code)
    return {
        "token": token,
        "user": code.to_public_dict(),
    }


@router.get("/me")
async def me(code: Annotated[UsageCode, Depends(get_current_code)]):
    """返回当前使用码状态（剩余额度等）。"""
    return {"user": code.to_public_dict()}
