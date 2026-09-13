"""SQLite 数据库连接与会话管理。"""

import logging
import os
import time
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import OperationalError
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
    """创建表结构、补齐新增列、补建索引并迁移历史数据（轻量 schema 演进）。"""
    # 延迟导入，避免循环导入
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    _ensure_indexes()
    _drop_legacy_usage_code_type()


def _ensure_indexes() -> None:
    """为旧库补建模型里声明但库里缺失的索引。

    `create_all` 只建缺失的表，不会给已存在的表加索引：新声明的索引若不显式补建，
    持久卷上的老库永远用不上（历史越大越吃亏的是按身份计数的限额查询与设备排序）。
    DDL 直接由模型元数据派生，避免与 models.py 里的声明两处维护而漂移；
    `IF NOT EXISTS` 保证幂等，双进程同时首启也不会互相冲突。
    """
    inspector = inspect(engine)
    preparer = engine.dialect.identifier_preparer
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {ix["name"] for ix in inspector.get_indexes(table.name)}
        for index in sorted(table.indexes, key=lambda ix: ix.name or ""):
            if not index.name or index.name in existing:
                continue
            columns = ", ".join(preparer.quote(column.name) for column in index.columns)
            unique = "UNIQUE " if index.unique else ""
            ddl = (
                f"CREATE {unique}INDEX IF NOT EXISTS {preparer.quote(index.name)}"
                f" ON {preparer.quote(table.name)} ({columns})"
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                logger.warning("Schema 演进：已为表 %s 补建索引 %s", table.name, index.name)
            except Exception:
                logger.exception("索引补建失败：%s", ddl)


def _drop_legacy_usage_code_type() -> None:
    """数据迁移：删除旧版 usage_codes.code_type 列（管理员码与普通码已合并）。

    旧版使用码区分 admin / user 两类；管理后台本身零登录、管理员不需要码，
    普通码也已支持无限额度，类型区分不再有意义。历史管理员码的无限额度保存
    在 quota 上（异常数据先归一为 -1），删除列后即成为普通无限额度码。
    以「列存在」为条件，幂等；新库无此列时零操作。
    """
    inspector = inspect(engine)
    if not inspector.has_table("usage_codes"):
        return
    if "code_type" not in {column["name"] for column in inspector.get_columns("usage_codes")}:
        return

    try:
        with engine.begin() as conn:
            total, admin_count = conn.execute(
                text(
                    "SELECT COUNT(*),"
                    " COALESCE(SUM(CASE WHEN code_type = 'admin' THEN 1 ELSE 0 END), 0)"
                    " FROM usage_codes"
                )
            ).one()
            # 防御性归一：历史异常数据若存在 admin 且 quota>=0，先恢复「管理员码=无限」语义
            conn.execute(
                text("UPDATE usage_codes SET quota = -1 WHERE code_type = 'admin' AND quota >= 0")
            )
            conn.execute(text("ALTER TABLE usage_codes DROP COLUMN code_type"))
    except OperationalError:
        # 双进程同时首启：另一进程可能刚完成迁移
        if "code_type" not in {
            column["name"] for column in inspect(engine).get_columns("usage_codes")
        }:
            logger.info("数据迁移：usage_codes.code_type 已由另一进程删除")
            return
        logger.exception(
            "数据迁移失败：删除 usage_codes.code_type 未成功（可能数据库被占用或 SQLite 版本过旧），"
            "请重试启动；仍失败时手工执行 ALTER TABLE usage_codes DROP COLUMN code_type"
        )
        return

    logger.warning(
        "数据迁移：已删除 usage_codes.code_type 列（共 %s 行，其中历史管理员码 %s 行，无限额度保留）",
        total,
        admin_count,
    )


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
