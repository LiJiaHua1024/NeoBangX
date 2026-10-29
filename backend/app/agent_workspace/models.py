from sqlalchemy import Boolean, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models import UTCDateTime, utcnow


class WorkspaceTask(Base):
    __tablename__ = "workspace_tasks"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    owner: Mapped[int] = mapped_column(ForeignKey("usage_codes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="新任务")
    config: Mapped[str] = mapped_column(Text, default="{}")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="draft")
    active_run: Mapped[str] = mapped_column(String(40), default="")
    adopted_version: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class WorkspaceRun(Base):
    __tablename__ = "workspace_runs"
    __table_args__ = (UniqueConstraint("task_id", "request_key"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    request_key: Mapped[str] = mapped_column(String(80))
    mode: Mapped[str] = mapped_column(String(24), default="execute")
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    snapshot: Mapped[str] = mapped_column(Text)
    messages: Mapped[str] = mapped_column(Text, default="[]")
    step: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    stop: Mapped[bool] = mapped_column(Boolean, default=False)
    # 用户在工作台点「压缩上下文」：由接口置位，执行器在下一步开头消费
    compact_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    charged: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str] = mapped_column(Text, default="")
    lease: Mapped[object | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)
    started_at: Mapped[object | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[object | None] = mapped_column(UTCDateTime(), nullable=True)


class WorkspaceMaterial(Base):
    __tablename__ = "workspace_materials"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(250))
    content: Mapped[str] = mapped_column(Text)
    original: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    media_type: Mapped[str] = mapped_column(String(120), default="text/plain")
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)


class WorkspaceEntry(Base):
    __tablename__ = "workspace_entries"
    __table_args__ = (UniqueConstraint("run_id", "key"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[str] = mapped_column(String(40), index=True)
    key: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(24))
    label: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(24), default="running")
    details: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)


class WorkspaceChunk(Base):
    __tablename__ = "workspace_chunks"
    __table_args__ = (Index("ix_workspace_chunks_entry_kind_id", "entry_id", "kind", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[str] = mapped_column(ForeignKey("workspace_entries.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(24))
    content: Mapped[str] = mapped_column(Text)


class WorkspaceEvent(Base):
    __tablename__ = "workspace_events"
    __table_args__ = (Index("ix_workspace_events_task_id_id", "task_id", "id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(24))
    data: Mapped[str] = mapped_column(Text)


class WorkspaceVersion(Base):
    __tablename__ = "workspace_versions"
    __table_args__ = (UniqueConstraint("task_id", "key"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    # 版本存全文：按 run_id 查"本轮是否产出过成果"（退款判定）与 load_run 不能全表扫。
    run_id: Mapped[str] = mapped_column(String(40), default="", index=True)
    key: Mapped[str] = mapped_column(String(160))
    parent_id: Mapped[str] = mapped_column(String(40), default="")
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(24), default="agent")
    complete: Mapped[bool] = mapped_column(Boolean, default=True)
    provenance: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)


class WorkspaceNote(Base):
    __tablename__ = "workspace_notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    # 补充要求每轮都要按 run_id 取一次（apply_notes / 对话恢复）。
    run_id: Mapped[str] = mapped_column(String(40), index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    config: Mapped[str] = mapped_column(Text, default="")
    applied: Mapped[bool] = mapped_column(Boolean, default=False)


class WorkspaceTemplate(Base):
    __tablename__ = "workspace_templates"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    owner: Mapped[int] = mapped_column(ForeignKey("usage_codes.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(24), default="prompt")
    config: Mapped[str] = mapped_column(Text)
    created_at: Mapped[object] = mapped_column(UTCDateTime(), default=utcnow)
