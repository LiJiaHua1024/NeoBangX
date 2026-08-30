"""SQLAlchemy 数据模型。"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """带时区语义的 DateTime。

    SQLite 不保存时区偏移，原生 DateTime(timezone=True) 读回是 naive 值，
    isoformat() 无 Z/+00:00 后缀，前端 new Date() 会按浏览器本地时区
    解析导致整体时间偏移。这里写入时统一转 naive UTC 存储（兼容既有数据），
    读回时补回 UTC 时区。
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class UsageCode(Base):
    """使用码。"""

    __tablename__ = "usage_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    code_type: Mapped[str] = mapped_column(String(16), nullable=False)  # admin | user
    quota: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # -1 = 无限
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(timezone=True), default=utcnow)

    @property
    def remaining(self) -> int | None:
        """剩余次数；无限额度返回 None。"""
        if self.quota < 0:
            return None
        return max(0, self.quota - self.used_count)

    @property
    def is_exhausted(self) -> bool:
        if self.quota < 0:
            return False
        return self.used_count >= self.quota

    def to_public_dict(self) -> dict:
        return {
            "code": self.code,
            "code_type": self.code_type,
            "quota": self.quota,
            "used_count": self.used_count,
            "remaining": self.remaining,
            "is_enabled": self.is_enabled,
            "is_exhausted": self.is_exhausted,
            "is_unlimited": self.quota < 0,
        }

    def to_admin_dict(self) -> dict:
        data = self.to_public_dict()
        data.update(
            {
                "id": self.id,
                "note": self.note,
                "created_at": self.created_at.isoformat() if self.created_at else None,
            }
        )
        return data


class UsageLog(Base):
    """使用日志。

    元数据（状态、耗时、tokens、客户端信息）始终记录；
    原始输入 / 渲染 Prompt / 输出存于 LogPayload，受 log_payload 开关控制。
    """

    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    tool_id: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(timezone=True), default=utcnow, index=True
    )
    # 请求结果：success | cancelled | error
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    error_message: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # 本次请求实际扣减的额度次数（辅助类调用 / 迁移单卡为 0）。
    # 旧库经 ALTER 补列后存量为 NULL，语义是「未保存」而非「未扣费」，
    # 因此 to_dict 保留 None 交给前端显示为「—」，不能收敛成 0。
    units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    def to_dict(self) -> dict:
        # 旧库经自动迁移补列后，存量行的可空列读回为 None，统一收敛为展示默认值；
        # status 的收敛规则与 request_log.status_matches 保持一致，
        # duration_ms / tokens / units 属于「当时没记录」，保持 None
        return {
            "id": self.id,
            "code_id": self.code_id,
            "code": self.code,
            "tool_id": self.tool_id,
            "tool_name": self.tool_name,
            "model": self.model,
            "request_id": self.request_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "status": self.status or "success",
            "error_message": self.error_message or "",
            "duration_ms": self.duration_ms,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "ip": self.ip or "",
            "user_agent": self.user_agent or "",
            "units": self.units,
        }


class LogPayload(Base):
    """使用日志的原始数据（1:1，受「记录原始输入/输出」开关控制写入）。"""

    __tablename__ = "log_payloads"

    log_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("usage_logs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    input: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output: Mapped[str] = mapped_column(Text, nullable=False, default="")


class AppConfig(Base):
    """运行时配置（键值对，由管理后台维护）。"""

    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
