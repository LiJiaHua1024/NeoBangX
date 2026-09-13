"""旧库 schema 迁移：usage_codes.code_type 列删除与初始使用码。

覆盖：
1. 旧表存在 code_type 列时 init_db 自动删列；历史管理员码迁移为普通码
   （无限额度保留，异常 quota 归一为 -1），普通码数据不受影响；
2. 迁移幂等：重复 init_db 不报错；迁移后 ORM 写入不再受旧 NOT NULL 列影响；
3. ensure_bootstrap_code：库中无码时创建 NBXU 前缀的无限额度码并写文件；
4. 旧库启动时补建复合索引（create_all 不会给已存在的表加索引）。
"""
from pathlib import Path

from sqlalchemy import inspect, text

from app.config import settings
from app.database import SessionLocal, engine, init_db
from app.models import UsageCode
from app.services.usage_code import create_codes, ensure_bootstrap_code


def _columns() -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns("usage_codes")}


def test_drop_legacy_code_type_migrates_rows_and_is_idempotent():
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE usage_codes ADD COLUMN code_type VARCHAR(16) NOT NULL DEFAULT 'user'"
        ))
        conn.execute(text(
            "INSERT INTO usage_codes (code, code_type, quota, used_count, is_enabled, note, created_at)"
            " VALUES"
            " ('NBXA-LEGACY-UNLIMITED', 'admin', -1, 0, 1, 'legacy', CURRENT_TIMESTAMP),"
            " ('NBXA-LEGACY-QUOTA', 'admin', 5, 0, 1, 'legacy', CURRENT_TIMESTAMP),"
            " ('NBXU-LEGACY-KEEP', 'user', 7, 2, 1, 'legacy', CURRENT_TIMESTAMP)"
        ))

    init_db()
    assert "code_type" not in _columns()

    db = SessionLocal()
    try:
        rows = {
            r.code: r
            for r in db.query(UsageCode).filter(UsageCode.code.like("NBX%-LEGACY-%")).all()
        }
        assert rows["NBXA-LEGACY-UNLIMITED"].quota == -1
        assert rows["NBXA-LEGACY-QUOTA"].quota == -1  # 防御性归一：管理员码始终无限
        assert rows["NBXU-LEGACY-KEEP"].quota == 7
        assert rows["NBXU-LEGACY-KEEP"].used_count == 2  # 数据行保留

        # 迁移后 ORM 插入不再受旧 NOT NULL 列影响
        created = create_codes(db, quota=1, count=1, note="after-migration")
        assert created[0].code.startswith("NBXU-")

        db.query(UsageCode).filter(
            UsageCode.code.like("NBX%-LEGACY-%") | (UsageCode.code == created[0].code)
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    init_db()  # 幂等重跑不报错


def test_bootstrap_code_is_unlimited_and_written_to_file():
    db = SessionLocal()
    try:
        db.query(UsageCode).delete()
        db.commit()

        row = ensure_bootstrap_code(db)
        assert row is not None
        assert row.code.startswith("NBXU-")
        assert row.quota == -1
        assert row.used_count == 0

        path = Path(settings.data_dir) / "bootstrap_code.txt"
        assert path.read_text(encoding="utf-8").startswith(row.code)

        # 库中已有码时不再生成
        assert ensure_bootstrap_code(db) is None
    finally:
        db.query(UsageCode).delete()
        db.commit()
        db.close()


def test_ensure_indexes_backfills_composite_indexes_on_legacy_db():
    """旧库启动后应补齐复合索引。

    这些索引服务于免费模型限额的按身份计数与设备列表排序（都是随数据增长会变慢的
    查询）；`create_all` 不会给已存在的表加索引，必须由 `_ensure_indexes` 显式补建，
    否则持久卷上的老库永远用不上。这里先删掉索引模拟旧库，再验证启动后恢复且幂等。
    """
    wanted = {
        "ix_usage_logs_code_model_created": ("usage_logs", ["code_id", "model", "created_at"]),
        "ix_usage_logs_fp_model_created": ("usage_logs", ["fingerprint", "model", "created_at"]),
        "ix_usage_logs_ip_model_created": ("usage_logs", ["ip", "model", "created_at"]),
        "ix_devices_last_seen_at": ("devices", ["last_seen_at"]),
    }
    with engine.begin() as conn:
        for name in wanted:
            conn.execute(text(f"DROP INDEX IF EXISTS {name}"))

    init_db()
    init_db()  # 幂等重跑不报错

    inspector = inspect(engine)
    for name, (table, columns) in wanted.items():
        indexes = {ix["name"]: list(ix["column_names"]) for ix in inspector.get_indexes(table)}
        assert name in indexes, f"{name} 未补建"
        assert indexes[name] == columns, f"{name} 列顺序与查询条件不一致：{indexes[name]}"
        assert table in inspector.get_table_names()


def test_composite_identity_index_is_used_by_free_limit_count():
    """免费限额计数应命中身份复合索引，而不是扫窗口内全部日志。

    这条查询是唯一「表增长 → 每次用户请求变慢」的链路：日志默认永久保留，
    窗口最长 30 天，没有可用索引时每个窗口都要扫窗口内所有行。
    """
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO usage_logs (code_id, code, tool_id, tool_name, model, request_id,"
            " created_at, status, error_message, ip, user_agent, units, fingerprint)"
            " VALUES (0, '', '1', 't', 'm-free', 'r', '2026-09-01 00:00:00', 'success', '',"
            " '', '', 0, 'FP-INDEX-PROBE')"
        ))
        plan = conn.execute(text(
            "EXPLAIN QUERY PLAN"
            " SELECT COUNT(usage_logs.id) FROM usage_logs"
            " WHERE created_at >= '2026-08-01 00:00:00'"
            " AND model = 'm-free' AND fingerprint = 'FP-INDEX-PROBE'"
            " AND (status IS NULL OR status != 'error')"
        )).fetchall()
    detail = " | ".join(str(row[-1]) for row in plan)
    assert "ix_usage_logs_fp_model_created" in detail, detail
