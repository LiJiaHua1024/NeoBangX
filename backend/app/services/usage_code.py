"""使用码生成、校验与额度扣减。"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import UsageCode

logger = logging.getLogger(__name__)

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
    units: int = 1,
) -> UsageCode:
    """生成成功后扣减额度（日志由 services.request_log 统一记录）。

    扣减使用单条条件 UPDATE（used_count + units <= quota 才生效），
    并发提交下也不会把 used_count 写超 quota；额度不足时抛 403。
    管理员码与无限额度码不扣减。
    """
    if units < 1:
        raise ValueError("扣减次数必须至少为 1")

    row = db.get(UsageCode, code.id)
    if row is None:
        raise HTTPException(status_code=401, detail="使用码不存在")

    if row.code_type != "admin" and row.quota >= 0:
        result = db.execute(
            update(UsageCode)
            .where(
                UsageCode.id == row.id,
                UsageCode.used_count + units <= UsageCode.quota,
            )
            .values(used_count=UsageCode.used_count + units)
        )
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=403, detail="额度已用尽")

    db.commit()
    db.refresh(row)
    return row


def ensure_bootstrap_admin(db: Session) -> UsageCode | None:
    """若库中没有任何使用码，自动创建一把管理员码。

    管理员码不写入日志（容器日志可能被集中采集），改为落到数据目录下的
    bootstrap_admin.txt，由运维查看后妥善保存。
    """
    count = db.query(UsageCode).count()
    if count > 0:
        return None
    codes = create_codes(db, code_type="admin", quota=-1, count=1, note="系统初始化管理员码")
    admin = codes[0]
    _write_bootstrap_secret(admin.code)
    return admin


def _write_bootstrap_secret(code_value: str) -> None:
    path = Path(settings.data_dir) / "bootstrap_admin.txt"
    try:
        path.write_text(f"{code_value}\n（初始管理员使用码，请妥善保存；此文件可手动删除。）\n", encoding="utf-8")
        logger.info("初始管理员使用码已写入 %s（请查看后妥善保存）", path.resolve())
    except OSError as exc:
        logger.error("初始管理员使用码写入文件失败（%s），请直接查询 usage_codes 表获取", exc)


# ---------------- JWT 密钥一键轮换 ----------------
# 约定：数据卷中的 jwt_secret.txt 由管理后台「一键生成」写入；
# 仅当配置仍为源码默认值时，启动过程才会加载它——显式设置的环境变量 /
# .env 始终优先，不会被该文件覆盖。

JWT_SECRET_FILENAME = "jwt_secret.txt"


def write_jwt_secret_file(value: str) -> Path:
    path = Path(settings.data_dir) / JWT_SECRET_FILENAME
    try:
        path.write_text(value + "\n", encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"密钥文件写入失败：{exc}") from exc
    return path


def apply_jwt_secret_override() -> bool:
    """密钥仍为默认值时应用数据卷中的轮换密钥；返回是否已生效。

    在两个应用的 lifespan 最先调用，保证后续签发/验票用同一把密钥。
    """
    if not settings.jwt_secret_is_default:
        return False
    path = Path(settings.data_dir) / JWT_SECRET_FILENAME
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    if not value:
        return False
    settings.jwt_secret = value
    logger.info("已从 %s 加载轮换后的 JWT 密钥", path)
    return True
