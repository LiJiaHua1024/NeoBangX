"""使用码生成、校验与额度扣减。"""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models import UsageCode, UsageLog

ALPHABET = string.ascii_uppercase + string.digits
# 去掉易混淆字符
ALPHABET = ALPHABET.replace("0", "").replace("O", "").replace("1", "").replace("I", "")

CODE_PREFIX = {
    "admin": "NBXA",
    "user": "NBXU",
}


def _segment(n: int = 4) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def generate_code(code_type: str) -> str:
    """生成形如 NBXU-XXXX-XXXX-XXXX 的使用码。"""
    prefix = CODE_PREFIX.get(code_type)
    if not prefix:
        raise ValueError(f"未知使用码类型: {code_type}")
    return f"{prefix}-{_segment()}-{_segment()}-{_segment()}"


def normalize_code(raw: str) -> str:
    return (raw or "").strip().upper().replace(" ", "")


def create_codes(
    db: Session,
    *,
    code_type: str = "user",
    quota: int = 10,
    count: int = 1,
    note: str = "",
) -> list[UsageCode]:
    if code_type not in CODE_PREFIX:
        raise HTTPException(status_code=400, detail="code_type 必须是 admin 或 user")
    if count < 1 or count > 200:
        raise HTTPException(status_code=400, detail="批量数量需在 1–200 之间")
    if code_type == "admin":
        quota = -1
    elif quota < 1:
        raise HTTPException(status_code=400, detail="普通用户码额度至少为 1")

    created: list[UsageCode] = []
    for _ in range(count):
        # 极低碰撞概率，仍做唯一性保护
        for _attempt in range(20):
            code = generate_code(code_type)
            exists = db.query(UsageCode).filter(UsageCode.code == code).first()
            if not exists:
                break
        else:
            raise HTTPException(status_code=500, detail="生成使用码失败，请重试")

        row = UsageCode(
            code=code,
            code_type=code_type,
            quota=quota,
            used_count=0,
            is_enabled=True,
            note=note or "",
        )
        db.add(row)
        created.append(row)

    db.commit()
    for row in created:
        db.refresh(row)
    return created


def get_code_by_value(db: Session, code: str) -> UsageCode | None:
    return db.query(UsageCode).filter(UsageCode.code == normalize_code(code)).first()


def activate_code(db: Session, raw_code: str) -> tuple[UsageCode, str]:
    """验证使用码并签发 JWT。"""
    code = get_code_by_value(db, raw_code)
    if not code:
        raise HTTPException(status_code=401, detail="使用码无效")
    if not code.is_enabled:
        raise HTTPException(status_code=403, detail="使用码已被禁用")
    if code.is_exhausted:
        raise HTTPException(status_code=403, detail="额度已用尽")

    token = issue_token(code)
    return code, token


def issue_token(code: UsageCode) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(code.id),
        "code": code.code,
        "code_type": code.code_type,
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="登录已过期，请重新输入使用码") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="无效的登录凭证") from exc


def get_active_code_from_token(db: Session, token: str) -> UsageCode:
    payload = decode_token(token)
    code_id = payload.get("sub")
    code_value = payload.get("code")
    row = None
    if code_id:
        try:
            row = db.get(UsageCode, int(code_id))
        except (TypeError, ValueError):
            row = None
    if row is None and code_value:
        row = get_code_by_value(db, code_value)
    if row is None:
        raise HTTPException(status_code=401, detail="使用码不存在")
    if not row.is_enabled:
        raise HTTPException(status_code=403, detail="使用码已被禁用")
    if row.is_exhausted:
        raise HTTPException(status_code=403, detail="额度已用尽")
    return row


def assert_can_generate(code: UsageCode) -> None:
    if not code.is_enabled:
        raise HTTPException(status_code=403, detail="使用码已被禁用")
    if code.is_exhausted:
        raise HTTPException(status_code=403, detail="额度已用尽")


def consume_quota(
    db: Session,
    code: UsageCode,
    *,
    tool_id: str = "",
    tool_name: str = "",
    model: str = "",
    request_id: str = "",
    units: int = 1,
) -> UsageCode:
    """生成成功后扣减额度并写日志。管理员码不扣额度但仍记日志。"""
    if units < 1:
        raise ValueError("扣减次数必须至少为 1")

    # 重新加载，避免并发脏写
    row = db.get(UsageCode, code.id)
    if row is None:
        raise HTTPException(status_code=401, detail="使用码不存在")

    if row.code_type != "admin" and row.quota >= 0:
        if row.used_count + units > row.quota:
            raise HTTPException(status_code=403, detail="额度已用尽")
        row.used_count += units

    log = UsageLog(
        code_id=row.id,
        code=row.code,
        tool_id=tool_id or "",
        tool_name=tool_name or "",
        model=model or "",
        request_id=request_id or "",
    )
    db.add(log)
    db.commit()
    db.refresh(row)
    return row


def ensure_bootstrap_admin(db: Session) -> UsageCode | None:
    """若库中没有任何使用码，自动创建一把管理员码。"""
    count = db.query(UsageCode).count()
    if count > 0:
        return None
    codes = create_codes(db, code_type="admin", quota=-1, count=1, note="系统初始化管理员码")
    return codes[0]
