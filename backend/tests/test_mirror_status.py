"""线路镜像可用性检测：状态接口与横幅开关。

探活只测 DB 里已保存的两条线路（不接受客户端传 URL）；未启用 / 地址不足
两条时直接返回空结果，不发起任何出站请求。
"""
import json

import httpx
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.routers import admin as admin_module
from app.services.runtime_config import parse_mirror_settings


def _set_mirror(db, *, enabled: bool, origins: str, banner: str | None = None) -> None:
    from app.models import AppConfig

    pairs = [
        ("mirror_enabled", "true" if enabled else "false"),
        ("mirror_origins", origins),
    ]
    if banner is not None:
        pairs.append(("mirror_banner_enabled", banner))
    for key, value in pairs:
        row = db.get(AppConfig, key)
        if row is None:
            db.add(AppConfig(key=key, value=value))
        else:
            row.value = value
    db.commit()


def _reset_mirror() -> None:
    db = SessionLocal()
    try:
        _set_mirror(db, enabled=False, origins="", banner="true")
    finally:
        db.close()


def test_disabled_returns_empty_without_probing(monkeypatch):
    _reset_mirror()
    called = []

    async def _boom(_origin):
        called.append(_origin)
        raise AssertionError("disabled 时不应探测")

    monkeypatch.setattr(admin_module, "_probe_mirror_origin", _boom)
    client = TestClient(admin_app)
    res = client.get("/api/admin/mirror/status")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enabled"] is False
    assert body["reason"] == "disabled"
    assert body["results"] == []
    assert body["summary"] == {"all_ok": True, "fault_count": 0}
    assert called == []


def test_need_two_origins_returns_empty_without_probing(monkeypatch):
    db = SessionLocal()
    try:
        _set_mirror(db, enabled=True, origins="https://a.example.com")
    finally:
        db.close()
    try:
        called = []

        async def _boom(_origin):
            called.append(_origin)
            raise AssertionError("地址不足时不应探测")

        monkeypatch.setattr(admin_module, "_probe_mirror_origin", _boom)
        client = TestClient(admin_app)
        res = client.get("/api/admin/mirror/status")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["enabled"] is True
        assert body["ready"] is False
        assert body["reason"] == "need_two_origins"
        assert body["results"] == []
        assert called == []
    finally:
        _reset_mirror()


def test_ready_reports_mixed_results(monkeypatch):
    db = SessionLocal()
    try:
        _set_mirror(
            db,
            enabled=True,
            origins=json.dumps(["https://a.example.com", "https://b.example.com"]),
        )
    finally:
        db.close()
    try:
        async def _fake_probe(origin):
            if "a.example" in origin:
                return {"origin": origin, "ok": True, "status_code": 200, "latency_ms": 12, "version": "1.2.0", "error": ""}
            return {"origin": origin, "ok": False, "status_code": None, "latency_ms": 11, "version": "", "error": "连接被拒绝：对方服务未启动或端口未监听"}

        monkeypatch.setattr(admin_module, "_probe_mirror_origin", _fake_probe)
        client = TestClient(admin_app)
        res = client.get("/api/admin/mirror/status")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ready"] is True
        assert len(body["results"]) == 2
        assert body["summary"] == {"all_ok": False, "fault_count": 1}
        bad = [r for r in body["results"] if not r["ok"]][0]
        assert bad["origin"] == "https://b.example.com"
        assert bad["error"]
    finally:
        _reset_mirror()


def test_banner_switch_roundtrip():
    _reset_mirror()
    try:
        client = TestClient(admin_app)
        # 先关掉再读回（与 mirror_enabled 同为布尔开关，走同一落盘路径）
        res = client.put("/api/admin/config", json={"mirror_banner_enabled": False})
        assert res.status_code == 200, res.text
        assert res.json()["mirror"]["banner_enabled"] is False

        got = client.get("/api/admin/config")
        assert got.json()["config"]["mirror_banner_enabled"] == "false"

        status = client.get("/api/admin/mirror/status")
        assert status.json()["banner_enabled"] is False

        # 老库缺键时按默认开启（升级后横幅不静默消失）
        assert parse_mirror_settings({}).get("banner_enabled") is True
    finally:
        _reset_mirror()


def test_probe_error_mapping():
    assert "超时" in admin_module._mirror_probe_error(httpx.TimeoutException("t"))
    assert "拒绝" in admin_module._mirror_probe_error(httpx.ConnectError("connection refused"))
    assert "解析" in admin_module._mirror_probe_error(httpx.ConnectError("[Errno -2] Name or service not known"))
