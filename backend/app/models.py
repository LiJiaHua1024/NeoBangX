"""SQLAlchemy 数据模型。"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

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
    """使用日志。"""

    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    tool_id: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code_id": self.code_id,
            "code": self.code,
            "tool_id": self.tool_id,
            "tool_name": self.tool_name,
            "model": self.model,
            "request_id": self.request_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AppConfig(Base):
    """运行时配置（键值对，由管理后台维护）。"""

    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
