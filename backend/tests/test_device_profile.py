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
    # 基础字段必须存在且为空；实现新增字段（model / gpu / touch …）不应让本测试失效
    empty = parse_summary(None)
    for key in ("os", "lang", "scr", "dpr", "cores", "tz"):
        assert empty.get(key) == ""
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
    keys = [i["key"] for i in items]
    # 「设备识别」结论置顶，浏览器对照垫底；中间基础 5 项保持原顺序，
    # 扩展维度（touch / gpu / mem…）按上报情况插入，不参与顺序断言
    assert keys[0] == "identity"
    assert [k for k in keys if k in ("os", "lang", "screen", "cores", "tz")] == [
        "os", "lang", "screen", "cores", "tz",
    ]
    assert keys[-1] == "browser"
    by_key = {i["key"]: i["value"] for i in items}
    assert "Windows" in by_key["os"]
    assert "简体中文" in by_key["lang"]


def test_build_profile_skips_touch_when_not_reported():
    # 老日志没有 touch 字段：未上报 ≠ 无触屏，不应输出该条目
    assert "touch" not in [i["key"] for i in build_profile(parse_summary(json.dumps({"os": "Win32"})))]
    # 上报了 0 才表示确实不支持触屏
    reported = build_profile(parse_summary(json.dumps({"touch": 0})))
    assert [i["value"] for i in reported if i["key"] == "touch"] == ["无触屏"]


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
    items = {i["key"]: i for i in body["profile"]}
    labels = [i["label"] for i in body["profile"]]
    assert labels[:6] == ["设备识别", "操作系统", "语言", "屏幕", "CPU", "时区"]
    assert "Windows" in items["os"]["value"]
    assert "简体中文" in items["lang"]["value"]
    assert body["stats"]["total_logs"] >= 2
    assert len(body["codes"]) == 2
    assert len(body["ips"]) == 2
    assert any("多码" in s for s in body["signals"])
    assert len(body["recent_logs"]) >= 2

    assert client.get("/api/admin/devices/999999999").status_code == 404
