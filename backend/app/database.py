"""SQLite 数据库连接与会话管理。"""

import logging
import os
import time
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _ensure_data_dir() -> Path:
    data_dir = Path(settings.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _build_engine():
    _ensure_data_dir()
    db_path = Path(settings.data_dir) / "neobangx.db"
    url = f"sqlite:///{db_path.resolve().as_posix()}"
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        # admin 进程与主站进程共享同一个库，写锁竞争时显式等待而非立刻报错
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """创建表结构，并为已有表补齐新增列（轻量 schema 演进）。"""
    # 延迟导入，避免循环导入
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """为持久卷上的旧表补新增列。

    仅支持加列这一最常见演进；改名/删列/改类型需要手工迁移。
    注意：SQLite 的 ADD COLUMN 无法携带非常量默认值，这里一律以
    可空列添加（ORM 侧的 Python 默认值会在写入时生效）。
    """
    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {col["name"] for col in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing:
                continue
            col_type = column.type.compile(engine.dialect)
            quoted = engine.dialect.identifier_preparer.quote(column.name)
            ddl = text(f"ALTER TABLE {table.name} ADD COLUMN {quoted} {col_type}")
            with engine.begin() as conn:
                conn.execute(ddl)
            logger.warning(
                "Schema 演进：已为表 %s 补增列 %s (%s)；如该列语义上不可为空，请手工回填数据",
                table.name, column.name, col_type,
            )


@contextmanager
def bootstrap_lock(timeout: float = 15.0) -> Generator[None, None, None]:
    """跨进程引导锁：两个 uvicorn 进程同时首启时串行化 seed / bootstrap。

    基于 O_CREAT|O_EXCL 抢占数据目录下的锁文件；超时视为遇到残留锁
    （如上次启动崩溃遗留），接管并继续，避免永久卡死。
    """
    lock_path = _ensure_data_dir() / ".bootstrap.lock"
    fd: int | None = None
    deadline = time.monotonic() + timeout
    while fd is None:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if time.monotonic() >= deadline:
                logger.warning("Bootstrap lock 等待超时（%s），按残留锁处理并继续", lock_path)
                try:
                    os.unlink(lock_path)
                except OSError:
                    pass
                deadline = time.monotonic() + timeout
            else:
                time.sleep(0.2)
        except OSError:
            # 文件系统不支持独占创建时退化为无锁（与旧行为一致）
            break
    try:
        yield
    finally:
        if fd is not None:
            try:
                os.close(fd)
            finally:
                try:
                    os.unlink(lock_path)
                except OSError:
                    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
