"""管理后台使用码接口：重置已用次数。

覆盖 POST /api/admin/codes/{id}/reset-usage：清零计数并恢复剩余额度、
未知 id 报 404、只影响目标码且使用日志保留、管理员码重置为无副作用的 no-op。
"""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.models import UsageCode, UsageLog
from app.services.request_log import record_usage_log
from app.services.usage_code import activate_code


def _make_code(db, *, quota=5, used=0, code_type="user", code=None):
    row = UsageCode(
        code=code or f"NBXU-RST-{uuid4().hex[:8].upper()}",
        code_type=code_type,
        quota=-1 if code_type == "admin" else quota,
        used_count=used,
        is_enabled=True,
        note="重置用量测试",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.expunge(row)
    return row


def test_reset_usage_clears_counter_and_restores_quota():
    db = SessionLocal()
    try:
        code = _make_code(db, quota=5, used=5)
        assert code.is_exhausted is True
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.post(f"/api/admin/codes/{code.id}/reset-usage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["used_count"] == 0
    assert body["remaining"] == 5
    assert body["is_exhausted"] is False

    db = SessionLocal()
    try:
        row = db.get(UsageCode, code.id)
        assert row.used_count == 0
        # 用尽的码重置后重新可用
        activated, token = activate_code(db, code.code)
        assert activated.id == code.id
        assert token
    finally:
        db.close()


def test_reset_usage_unknown_code_404():
    client = TestClient(admin_app)
    resp = client.post("/api/admin/codes/999999999/reset-usage")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "使用码不存在"


def test_reset_usage_only_touches_target_code_and_keeps_logs():
    db = SessionLocal()
    try:
        target = _make_code(db, quota=10, used=3)
        other = _make_code(db, quota=10, used=2)
    finally:
        db.close()

    record_usage_log(code_id=target.id, code=target.code, tool_id="25", units=1)

    client = TestClient(admin_app)
    resp = client.post(f"/api/admin/codes/{target.id}/reset-usage")
    assert resp.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, target.id).used_count == 0
        assert db.get(UsageCode, other.id).used_count == 2
        # 日志不属于「用量计数」，重置不清日志
        logs = db.query(UsageLog).filter(UsageLog.code_id == target.id).all()
        assert len(logs) == 1
    finally:
        db.close()


def test_reset_usage_admin_code_is_noop():
    db = SessionLocal()
    try:
        admin = _make_code(db, code_type="admin")
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.post(f"/api/admin/codes/{admin.id}/reset-usage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["used_count"] == 0
    assert body["is_unlimited"] is True
    assert body["quota"] == -1
