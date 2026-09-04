"""设备画像详情接口的回归测试。"""

import json

from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.models import UsageCode
from app.services.device_profile import (
    build_profile,
    parse_summary,
    parse_user_agent,
    translate_cores,
    translate_lang,
    translate_os,
    translate_screen,
    translate_tz,
)
from app.services.request_log import record_usage_log


def _make_code(db, code):
    row = UsageCode(
        code=code, code_type="user", quota=100, used_count=0, is_enabled=True, note="画像"
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.expunge(row)
    return row


def test_parse_summary_tolerant():
    assert parse_summary(None) == {"os": "", "lang": "", "scr": "", "dpr": "", "cores": "", "tz": ""}
    assert parse_summary("not-json")["os"] == ""
    parsed = parse_summary(json.dumps({"os": "Win32", "lang": "zh-CN", "scr": "1920x1080", "dpr": 1, "cores": 8, "tz": "Asia/Shanghai"}))
    assert parsed["os"] == "Win32"
    assert parsed["tz"] == "Asia/Shanghai"


def test_translate_functions():
    value, _ = translate_os("Win32")
    assert "Windows" in value
    value, _ = translate_os("MacIntel")
    assert "macOS" in value
    value, _ = translate_lang("zh-CN")
    assert "简体中文" in value
    value, _ = translate_screen("1920x1080", "1")
    assert "1920×1080" in value and "横屏" in value
    value, _ = translate_cores("8")
    assert value.startswith("8 核")
    value, _ = translate_tz("Asia/Shanghai")
    assert "北京时间" in value
    # 未知输入原样展示，不抛错
    assert translate_os("")[0] == "未知"
    assert translate_screen("oops", "")[0] == "oops"


def test_parse_user_agent():
    parsed = parse_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    assert parsed["browser"].startswith("Chrome")
    assert "Windows" in parsed["os"]
    assert parsed["device_type"] == "桌面端"
    assert parse_user_agent("")["browser"] == "未知"


def test_build_profile_five_items_plus_browser():
    summary = parse_summary(json.dumps({"os": "Win32", "lang": "zh-CN", "scr": "1920x1080", "dpr": 1, "cores": 8, "tz": "Asia/Shanghai"}))
    items = build_profile(summary, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36")
    assert [i["key"] for i in items] == ["os", "lang", "screen", "cores", "tz", "browser"]
    assert "Windows" in items[0]["value"]
    assert "简体中文" in items[1]["value"]


def test_device_detail_endpoint():
    db = SessionLocal()
    try:
        code_a = _make_code(db, "NBXU-PROF-A001")
        code_b = _make_code(db, "NBXU-PROF-B001")
    finally:
        db.close()
    summary = json.dumps({"os": "Win32", "lang": "zh-CN", "scr": "1920x1080", "dpr": 1, "cores": 8, "tz": "Asia/Shanghai"})
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36"
    record_usage_log(code_id=code_a.id, code=code_a.code, tool_id="25", tool_name="自由对话",
                     model="m1", ip="192.168.1.10", user_agent=ua,
                     fingerprint="fp-profile-detail-001", device_summary=summary)
    record_usage_log(code_id=code_b.id, code=code_b.code, tool_id="1", tool_name="语篇分析",
                     model="m1", ip="192.168.1.11", user_agent=ua,
                     fingerprint="fp-profile-detail-001", device_summary=summary)

    client = TestClient(admin_app)
    listed = client.get("/api/admin/devices", params={"q": "fp-profile-detail-001"})
    assert listed.status_code == 200
    device_id = listed.json()["items"][0]["id"]

    resp = client.get(f"/api/admin/devices/{device_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["device"]["id"] == device_id
    assert body["summary_parsed"]["os"] == "Win32"
    labels = [i["label"] for i in body["profile"]]
    assert labels[:5] == ["操作系统", "语言", "屏幕", "CPU", "时区"]
    assert "Windows" in body["profile"][0]["value"]
    assert "简体中文" in body["profile"][1]["value"]
    assert body["stats"]["total_logs"] >= 2
    assert len(body["codes"]) == 2
    assert len(body["ips"]) == 2
    assert any("多码" in s for s in body["signals"])
    assert len(body["recent_logs"]) >= 2

    assert client.get("/api/admin/devices/999999999").status_code == 404
