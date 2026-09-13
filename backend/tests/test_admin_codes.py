"""管理后台使用码接口：重置已用次数与额度互转。

覆盖 POST /api/admin/codes/{id}/reset-usage：清零计数并恢复剩余额度、
未知 id 报 404、只影响目标码且使用日志保留、无限额度码重置不改变额度；
以及额度有限 ↔ 无限互转：改为无限清零已用、改回有限从 0 开始计数、
负数归一、0 拒绝、创建无限额度使用码。
"""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.models import UsageCode, UsageLog
from app.services.request_log import record_usage_log
from app.services.usage_code import activate_code


def _make_code(db, *, quota=5, used=0, code=None):
    row = UsageCode(
        code=code or f"NBXU-RST-{uuid4().hex[:8].upper()}",
        quota=quota,
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


def test_reset_usage_unlimited_code_keeps_quota():
    db = SessionLocal()
    try:
        unlimited = _make_code(db, quota=-1)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.post(f"/api/admin/codes/{unlimited.id}/reset-usage")
    assert resp.status_code == 200
    body = resp.json()
    assert body["used_count"] == 0
    assert body["is_unlimited"] is True
    assert body["quota"] == -1


# ---------------- 额度有限 ↔ 无限互转 ----------------


def test_update_quota_to_unlimited_clears_used():
    db = SessionLocal()
    try:
        code = _make_code(db, quota=5, used=3)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.patch(f"/api/admin/codes/{code.id}", json={"quota": -1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quota"] == -1
    assert body["used_count"] == 0
    assert body["remaining"] is None
    assert body["is_unlimited"] is True
    assert body["is_exhausted"] is False

    db = SessionLocal()
    try:
        row = db.get(UsageCode, code.id)
        assert row.quota == -1 and row.used_count == 0
        activated, token = activate_code(db, code.code)
        assert activated.id == code.id
        assert token
    finally:
        db.close()


def test_update_quota_negative_normalizes_to_unlimited():
    db = SessionLocal()
    try:
        code = _make_code(db, quota=5, used=1)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.patch(f"/api/admin/codes/{code.id}", json={"quota": -100})
    assert resp.status_code == 200
    assert resp.json()["quota"] == -1


def test_update_quota_zero_rejected():
    db = SessionLocal()
    try:
        code = _make_code(db, quota=5, used=1)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.patch(f"/api/admin/codes/{code.id}", json={"quota": 0})
    assert resp.status_code == 400
    assert "无限" in resp.json()["detail"]


def test_update_quota_from_unlimited_starts_from_zero():
    db = SessionLocal()
    try:
        # 无限码正常不累计已用；构造 used>0 的存量数据，验证改回有限时强制归零
        code = _make_code(db, quota=-1, used=4)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.patch(f"/api/admin/codes/{code.id}", json={"quota": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["quota"] == 2
    assert body["used_count"] == 0
    assert body["remaining"] == 2
    assert body["is_unlimited"] is False


def test_update_quota_below_used_rejected():
    db = SessionLocal()
    try:
        code = _make_code(db, quota=5, used=4)
    finally:
        db.close()

    client = TestClient(admin_app)
    resp = client.patch(f"/api/admin/codes/{code.id}", json={"quota": 3})
    assert resp.status_code == 400
    assert "不能小于已用次数（4）" in resp.json()["detail"]


def test_create_unlimited_code():
    client = TestClient(admin_app)
    resp = client.post(
        "/api/admin/codes",
        json={"quota": -1, "count": 1},
    )
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["quota"] == -1
    assert item["used_count"] == 0
    assert item["remaining"] is None
    assert item["is_unlimited"] is True


def test_create_quota_zero_rejected():
    client = TestClient(admin_app)
    resp = client.post(
        "/api/admin/codes",
        json={"quota": 0, "count": 1},
    )
    assert resp.status_code == 400
    assert "无限" in resp.json()["detail"]
