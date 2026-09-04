"""设备指纹（仅用于识别共享，不做拦截依据）的回归测试。

覆盖：指纹归一化、短码/昵称/颜色确定性、请求头提取、设备复用计数、
日志落库关联、管理台设备接口（列表/备注/日志筛选/聚合）。
"""
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.models import Device, UsageCode, UsageLog
from app.services.device_fingerprint import (
    auto_name_for,
    color_for,
    normalize_fingerprint,
    short_code_for,
)
from app.services.request_log import (
    get_fingerprint_info,
    get_or_create_device,
    record_usage_log,
)


def _request_stub(headers=None):
    return SimpleNamespace(headers=dict(headers or {}), client=None)


def _make_code(db, code, *, quota=100):
    row = UsageCode(
        code=code, code_type="user", quota=quota, used_count=0, is_enabled=True, note="测试"
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.expunge(row)
    return row


# ---------------- 归一化与派生 ----------------

def test_normalize_fingerprint():
    assert normalize_fingerprint(None) == ""
    assert normalize_fingerprint("") == ""
    assert normalize_fingerprint("  ") == ""
    assert normalize_fingerprint("abc123XYZ-_") == "abc123XYZ-_"
    assert normalize_fingerprint("x" * 129) == ""
    assert normalize_fingerprint("a b") == ""
    assert normalize_fingerprint("<script>") == ""


def test_short_code_format_and_determinism():
    code = short_code_for("deadbeef" * 8)
    assert code.startswith("FP-")
    assert len(code) == len("FP-XXXX-XXXX")
    assert short_code_for("deadbeef" * 8) == code
    assert short_code_for("different-fingerprint") != code


def test_auto_name_and_color_determinism():
    fp = "thumbmark-hash-001"
    assert auto_name_for(fp) == auto_name_for(fp)
    assert "·" in auto_name_for(fp)
    assert color_for(fp) == color_for(fp)
    assert color_for(fp).startswith("hsl(")


# ---------------- 请求头提取 ----------------

def test_get_fingerprint_info():
    fp, summary = get_fingerprint_info(_request_stub({
        "x-client-fingerprint": "abc123",
        "x-client-fp-summary": '{"os":"Windows"}',
    }))
    assert fp == "abc123"
    assert summary == '{"os":"Windows"}'


def test_get_fingerprint_info_missing_or_invalid():
    assert get_fingerprint_info(_request_stub({})) == ("", "")
    assert get_fingerprint_info(None) == ("", "")
    # 非法指纹丢弃，但摘要保留与否不影响主流程（这里摘要仍返回，写日志时无指纹则忽略）
    fp, _ = get_fingerprint_info(_request_stub({"x-client-fingerprint": "a b"}))
    assert fp == ""


# ---------------- 设备复用 ----------------

def test_get_or_create_device_reuses_and_counts():
    db = SessionLocal()
    try:
        first = get_or_create_device(db, "fp-reuse-001", '{"os":"Win"}')
        db.commit()
        assert first is not None
        first_id = first.id
        assert first.seen_count == 1
        assert first.short_code.startswith("FP-")

        second = get_or_create_device(db, "fp-reuse-001", '{"os":"Win"}')
        db.commit()
        assert second.id == first_id
        assert second.seen_count == 2
    finally:
        db.close()


def test_get_or_create_device_invalid_returns_none():
    db = SessionLocal()
    try:
        assert get_or_create_device(db, "", "") is None
        assert get_or_create_device(db, "has space", "") is None
    finally:
        db.close()


# ---------------- 日志落库 ----------------

def test_record_usage_log_with_fingerprint_links_device():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-FP-T1-0001")
    finally:
        db.close()
    log_id = record_usage_log(
        code_id=code.id, code=code.code, tool_id="25",
        fingerprint="fp-log-link-001", device_summary='{"os":"Win"}',
    )
    db = SessionLocal()
    try:
        log = db.get(UsageLog, log_id)
        assert log.fingerprint == "fp-log-link-001"
        assert log.device_id is not None
        device = db.get(Device, log.device_id)
        assert device.fingerprint == "fp-log-link-001"
        assert device.seen_count >= 1
    finally:
        db.close()


def test_record_usage_log_without_fingerprint():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-FP-T2-0001")
    finally:
        db.close()
    log_id = record_usage_log(code_id=code.id, code=code.code, tool_id="25")
    db = SessionLocal()
    try:
        log = db.get(UsageLog, log_id)
        assert log.device_id is None
        assert log.fingerprint == ""
    finally:
        db.close()


# ---------------- 管理台接口 ----------------

def test_admin_devices_list_patch_and_log_filter():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-FP-T3-0001")
    finally:
        db.close()
    record_usage_log(
        code_id=code.id, code=code.code, tool_id="25",
        fingerprint="fp-admin-001", device_summary='{"os":"Mac"}',
    )
    record_usage_log(
        code_id=code.id, code=code.code, tool_id="25",
        fingerprint="fp-admin-002",
    )

    client = TestClient(admin_app)
    listed = client.get("/api/admin/devices", params={"q": "fp-admin-001"})
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] >= 1
    item = next(i for i in body["items"] if i["fingerprint"] == "fp-admin-001")
    assert item["short_code"].startswith("FP-")
    assert item["code_count"] >= 1

    patched = client.patch(
        f"/api/admin/devices/{item['id']}", json={"note": "张老师电脑"}
    )
    assert patched.status_code == 200
    assert patched.json()["note"] == "张老师电脑"

    # 按备注能筛到日志
    logs = client.get("/api/admin/logs", params={"device": "张老师"})
    assert logs.status_code == 200
    assert logs.json()["total"] >= 1

    # 按短码能筛到日志，且列表项挂载 device
    by_short = client.get(
        "/api/admin/logs", params={"device": item["short_code"]}
    ).json()
    assert by_short["total"] >= 1
    assert by_short["items"][0]["device"]["id"] == item["id"]

    # 聚合带 distinct_devices
    summary = client.get(
        "/api/admin/logs/summary", params={"code": code.code}
    ).json()
    assert summary["distinct_devices"] >= 2

    # 详情带 device
    detail = client.get(f"/api/admin/logs/{by_short['items'][0]['id']}").json()
    assert detail["device"]["id"] == item["id"]


def test_admin_devices_patch_404():
    client = TestClient(admin_app)
    resp = client.patch("/api/admin/devices/999999999", json={"note": "x"})
    assert resp.status_code == 404


def test_admin_devices_patch_color():
    from app.services.device_fingerprint import color_for

    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-FP-T4-0001")
    finally:
        db.close()
    record_usage_log(
        code_id=code.id, code=code.code, tool_id="25", fingerprint="fp-color-001"
    )
    client = TestClient(admin_app)
    item = client.get("/api/admin/devices", params={"q": "fp-color-001"}).json()["items"][0]
    auto_color = color_for("fp-color-001")
    assert item["color"] == auto_color

    # 自选颜色（大小写/#rgb 归一化）
    updated = client.patch(
        f"/api/admin/devices/{item['id']}", json={"color": "#ABC"}
    ).json()
    assert updated["color"] == "#aabbcc"
    assert updated["note"] == item["note"]  # 未传 note 则不变

    # 非法颜色拒绝
    bad = client.patch(f"/api/admin/devices/{item['id']}", json={"color": "red"})
    assert bad.status_code == 400
    bad2 = client.patch(f"/api/admin/devices/{item['id']}", json={"color": "#12345"})
    assert bad2.status_code == 400

    # 空串恢复自动颜色
    reset = client.patch(f"/api/admin/devices/{item['id']}", json={"color": ""}).json()
    assert reset["color"] == auto_color
