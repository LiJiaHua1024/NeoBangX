"""线路镜像配置：地址规范化、校验与开关语义。

线路镜像是「两条线路互为镜像」，靠 origin 全等比对来识别对端（前端拿
`location.origin` 与配置值比较，桥接页拿 `event.origin` 与配置值比较），
所以地址一旦规范化不彻底就会静默不工作 —— 这类问题在运行时极难排查，
绝大部分边界都在这里拦下来。
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.services.runtime_config import (
    MAX_MIRROR_ORIGINS,
    get_config_map,
    normalize_origin,
    parse_mirror_settings,
    parse_origins,
    serialize_mirror_origins,
    validate_mirror_origins,
)


def _set_mirror_config(db, *, enabled: bool, origins: str) -> None:
    from app.models import AppConfig

    for key, value in (("mirror_enabled", "true" if enabled else "false"), ("mirror_origins", origins)):
        row = db.get(AppConfig, key)
        if row is None:
            db.add(AppConfig(key=key, value=value))
        else:
            row.value = value
    db.commit()


# ---------------- 地址规范化 ----------------

def test_normalize_origin_accepts_plain_origins():
    assert normalize_origin("https://www.example.com") == "https://www.example.com"
    assert normalize_origin("http://192.168.1.10:8000") == "http://192.168.1.10:8000"
    # 主机大小写归一（浏览器给出的 origin 也一律小写）
    assert normalize_origin("HTTPS://WWW.Example.COM") == "https://www.example.com"


def test_normalize_origin_strips_default_ports_and_trailing_slash():
    """默认端口与末尾斜杠必须归一，否则与 location.origin / event.origin 比不中。"""
    assert normalize_origin("https://www.example.com:443") == "https://www.example.com"
    assert normalize_origin("http://www.example.com:80") == "http://www.example.com"
    assert normalize_origin("https://www.example.com/") == "https://www.example.com"
    # 非默认端口保留
    assert normalize_origin("https://www.example.com:8443") == "https://www.example.com:8443"


def test_normalize_origin_rejects_paths_and_extras():
    """带路径 / 查询 / 片段 / 用户信息的一律拒绝：event.origin 永远不含这些部分。"""
    for bad in (
        "https://www.example.com/app",
        "https://www.example.com/?a=1",
        "https://www.example.com/#x",
        "https://user:pw@www.example.com",
        "ftp://www.example.com",
        "www.example.com",
        "https://",
        "",
        None,
    ):
        assert normalize_origin(bad) is None, bad


def test_normalize_origin_rejects_bad_port_and_overlong_value():
    assert normalize_origin("https://www.example.com:abc") is None
    assert normalize_origin("https://www.example.com:99999") is None
    assert normalize_origin("https://" + "a" * 300 + ".com") is None


def test_normalize_origin_rejects_non_ascii_hostname():
    """中文域名等 IDN 直接拒绝：浏览器 event.origin 是 punycode，Python 侧保留
    原样，放行必然在运行时不匹配、镜像静默失效，不如写入口报错让管理员换 punycode。"""
    assert normalize_origin("https://例子.com") is None
    assert normalize_origin("https://例 子.com:8000") is None
    assert normalize_origin("https://xn--fsq.com") == "https://xn--fsq.com"


def test_normalize_origin_handles_ipv6_literal():
    assert normalize_origin("http://[::1]:8000") == "http://[::1]:8000"
    assert normalize_origin("http://[::1]:80") == "http://[::1]"


# ---------------- 列表解析（读取侧，容错） ----------------

def test_parse_origins_accepts_json_comma_and_newline_forms():
    """三种写法都要认：管理后台存 JSON，.env 里写逗号或换行更顺手。"""
    want = ["https://a.example.com", "https://b.example.com"]
    assert parse_origins(json.dumps(want)) == want
    assert parse_origins("https://a.example.com,https://b.example.com") == want
    assert parse_origins("https://a.example.com\nhttps://b.example.com") == want
    assert parse_origins(want) == want


def test_parse_origins_dedupes_and_caps():
    assert parse_origins("https://a.example.com,https://a.example.com") == ["https://a.example.com"]
    many = "https://a.example.com,https://b.example.com,https://c.example.com"
    assert len(parse_origins(many)) == MAX_MIRROR_ORIGINS


def test_parse_origins_drops_invalid_entries_silently():
    """读取侧容错：库里存了脏值不该让整个页面起不来，丢弃即可。"""
    assert parse_origins("https://a.example.com,不是地址,https://b.example.com") == [
        "https://a.example.com",
        "https://b.example.com",
    ]
    assert parse_origins("") == []
    assert parse_origins(None) == []
    assert parse_origins("[not json") == []


# ---------------- 写入侧校验（严格，报错给管理员看） ----------------

def test_validate_mirror_origins_returns_normalized_list():
    assert validate_mirror_origins(["https://a.example.com:443/", "http://b.example.com"]) == [
        "https://a.example.com",
        "http://b.example.com",
    ]


def test_validate_mirror_origins_rejects_invalid_duplicate_and_too_many():
    with pytest.raises(ValueError, match="不合法"):
        validate_mirror_origins(["https://a.example.com", "not-an-origin"])
    with pytest.raises(ValueError, match="重复"):
        validate_mirror_origins(["https://a.example.com", "https://a.example.com/"])
    with pytest.raises(ValueError, match="最多"):
        validate_mirror_origins(["https://a.example.com", "https://b.example.com", "https://c.example.com"])


def test_serialize_roundtrip():
    text = serialize_mirror_origins(["https://a.example.com:443"])
    assert text == '["https://a.example.com"]'
    assert parse_origins(text) == ["https://a.example.com"]


# ---------------- 开关语义 ----------------

def test_parse_mirror_settings_states():
    off = parse_mirror_settings({"mirror_enabled": "false", "mirror_origins": '["https://a.example.com","https://b.example.com"]'})
    assert off["enabled"] is False and off["ready"] is False and off["reason"] == "disabled"

    # 开着但只配了一条：前端无法确定对端，视为未就绪（而不是拿唯一一条当对端）
    half = parse_mirror_settings({"mirror_enabled": "true", "mirror_origins": "https://a.example.com"})
    assert half["enabled"] is True and half["ready"] is False and half["reason"] == "need_two_origins"

    full = parse_mirror_settings({"mirror_enabled": "TRUE", "mirror_origins": "https://a.example.com,https://b.example.com"})
    assert full["ready"] is True and full["reason"] == ""
    assert full["origins"] == ["https://a.example.com", "https://b.example.com"]

    empty = parse_mirror_settings({})
    assert empty["enabled"] is False and empty["origins"] == []


# ---------------- 管理接口读写 ----------------

def test_admin_config_roundtrip_and_validation():
    """经管理接口保存后能读回；开启但地址不足两条时当场拒绝。"""
    db = SessionLocal()
    try:
        _set_mirror_config(db, enabled=False, origins="")
    finally:
        db.close()

    client = TestClient(admin_app)

    # 只开开关、不给地址 → 拒绝
    res = client.put("/api/admin/config", json={"mirror_enabled": True})
    assert res.status_code == 400
    assert "线路地址" in res.json()["detail"]

    # 地址不合法 → 拒绝并说明原因
    res = client.put("/api/admin/config", json={"mirror_enabled": True, "mirror_origins": ["https://a.example.com/app"]})
    assert res.status_code == 400
    assert "不合法" in res.json()["detail"]

    # 正常保存（地址带默认端口与斜杠，应被归一）
    res = client.put(
        "/api/admin/config",
        json={"mirror_enabled": True, "mirror_origins": ["https://a.example.com:443/", "http://192.168.1.10:8000"]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mirror"]["ready"] is True
    assert body["config"]["mirror_origins"] == ["https://a.example.com", "http://192.168.1.10:8000"]

    # 读回一致
    got = client.get("/api/admin/config")
    assert got.status_code == 200
    assert got.json()["config"]["mirror_origins"] == ["https://a.example.com", "http://192.168.1.10:8000"]
    assert got.json()["mirror"]["enabled"] is True

    # 只改地址不改开关时，「最终值」校验同样生效：先关掉再清空地址
    assert client.put("/api/admin/config", json={"mirror_enabled": False, "mirror_origins": []}).status_code == 200
    assert client.get("/api/admin/config").json()["mirror"]["ready"] is False

    db = SessionLocal()
    try:
        cfg = get_config_map(db)
    finally:
        db.close()
    assert cfg["mirror_enabled"] == "false"
