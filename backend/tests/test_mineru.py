"""MinerU 解析：错误码翻译、admin 校验、parse 两阶段 OCR。"""

import io
import zipfile

from fastapi.testclient import TestClient

from app import deps
from app.admin_main import app as admin_app
from app.main import app
from app.models import UsageCode
from app.routers import parse as parse_router
from app.services import mineru as mineru_svc
from app.services.mineru import MinerUError


def _active_code():
    return UsageCode(
        id=999_222,
        code="NBXU-TEST-PARSE-01",
        code_type="user",
        quota=3,
        used_count=0,
        is_enabled=True,
    )


def _client():
    app.dependency_overrides[deps.get_current_code] = _active_code
    return TestClient(app)


def _pdf_bytes() -> bytes:
    return (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF"
    )


# ---------------- 翻译表 ----------------

def test_translate_precision_codes():
    assert mineru_svc.translate_precision_code(-60005).kind == "too_large"
    assert mineru_svc.translate_precision_code(-60005).http_status == 413
    assert mineru_svc.translate_precision_code(-60006).kind == "too_many_pages"
    assert mineru_svc.translate_precision_code(-60003).kind == "corrupt"
    assert mineru_svc.translate_precision_code(-60004).kind == "corrupt"
    assert mineru_svc.translate_precision_code(-60002).kind == "unsupported"
    assert mineru_svc.translate_precision_code(-60018).kind == "quota"
    assert mineru_svc.translate_precision_code(-60009).kind == "busy"
    assert mineru_svc.translate_precision_code(-60010, "boom").kind == "parse_failed"
    assert "boom" in mineru_svc.translate_precision_code(-60010, "boom").user_message


def test_translate_agent_codes():
    assert mineru_svc.translate_agent_code(-30001).kind == "too_large"
    assert mineru_svc.translate_agent_code(-30002).kind == "unsupported"
    assert mineru_svc.translate_agent_code(-30003).kind == "too_many_pages"
    assert mineru_svc.translate_agent_code(-30004).kind == "parse_failed"


def test_translate_http_token_and_rate_limit():
    e = mineru_svc.translate_http_status(401, "A0202 invalid", "precision")
    assert e.kind == "token_invalid" and e.http_status == 502
    e = mineru_svc.translate_http_status(429, "", "agent")
    assert e.kind == "rate_limited" and e.http_status == 429
    e = mineru_svc.translate_http_status(429, "", "precision")
    assert e.kind == "quota"


# ---------------- Token 粘贴格式解析 ----------------

def test_extract_mineru_token_formats():
    ex = mineru_svc.extract_mineru_token
    # 单行 Token
    assert ex("sk-abc123")[0] == "sk-abc123"
    # 带 Bearer 前缀
    token, source = ex("Bearer sk-abc123")
    assert token == "sk-abc123" and source == "bearer"
    # 两行剪切板格式（取 Secret Key）
    token, source = ex("Access Key: grvzm812345678\nSecret Key: enb1234567890")
    assert token == "enb1234567890" and source == "secret_key"
    # 顺序颠倒同样取 Secret Key
    token, source = ex("Secret Key: enb1234567890\nAccess Key: grvzm812345678")
    assert token == "enb1234567890" and source == "secret_key"
    # 全角冒号与多余空格
    token, source = ex("  Access Key：grvzm812345678  \n  Secret Key：enb1234567890  ")
    assert token == "enb1234567890" and source == "secret_key"
    # 只有 Access Key 时兜底
    token, source = ex("Access Key: grvzm812345678")
    assert token == "grvzm812345678" and source == "access_key"
    # 空 / 整段文字 → 未识别
    assert ex("")[0] == ""
    assert ex("   ")[0] == ""
    assert ex("这是我的密钥请帮我看看")[0] == ""


def test_admin_mineru_token_two_line_format():
    _reset_mineru()
    client = TestClient(admin_app)
    r = client.put("/api/admin/mineru", json={
        "mode": "precision",
        "model": "pipeline",
        "token": "Access Key: grvzm812345678\nSecret Key: enb1234567890",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_token"] is True
    # 存储的是提取出的 Secret Key（脱敏首尾可验证）
    assert body["token_masked"].startswith("enb1") and body["token_masked"].endswith("7890")
    _reset_mineru()

def _reset_mineru():
    from app.database import SessionLocal
    from app.services.runtime_config import set_config_values

    db = SessionLocal()
    try:
        set_config_values(db, {"mineru_mode": "precision", "mineru_model": "pipeline", "mineru_token": ""})
    finally:
        db.close()


def test_admin_mineru_validation():
    _reset_mineru()
    client = TestClient(admin_app)
    # precision 无 token → 400
    r = client.put("/api/admin/mineru", json={"mode": "precision", "model": "pipeline"})
    assert r.status_code == 400
    # 非法 model → 400
    r = client.put("/api/admin/mineru", json={"mode": "precision", "model": "foo", "token": "t"})
    assert r.status_code == 400
    # 非法 mode → 400
    r = client.put("/api/admin/mineru", json={"mode": "fast"})
    assert r.status_code == 400
    # agent 可空 token → 200
    r = client.put("/api/admin/mineru", json={"mode": "agent"})
    assert r.status_code == 200
    assert r.json()["mode"] == "agent"
    # precision 有 token → 200，且 token 脱敏
    r = client.put("/api/admin/mineru", json={"mode": "precision", "model": "vlm", "token": "sk-test-1234567890"})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "vlm" and body["has_token"] is True
    assert "1234567890" not in body["token_masked"]
    # 已配置下传空表示不修改
    r = client.put("/api/admin/mineru", json={"mode": "precision"})
    assert r.status_code == 200
    assert r.json()["has_token"] is True
    _reset_mineru()


# ---------------- parse 路由 ----------------

def test_parse_rejects_non_pdf():
    _reset_mineru()
    client = _client()
    try:
        r = client.post("/api/parse/file", files={"file": ("a.docx", b"xxx")})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 400
    assert r.json()["detail"]["kind"] == "unsupported"


def test_parse_token_missing_503(monkeypatch):
    _reset_mineru()
    monkeypatch.setattr(parse_router, "check_pdf_scanned",
                        lambda b: {"is_scanned": False, "confidence": 0.0, "evidence": {}})
    client = _client()
    try:
        r = client.post("/api/parse/file", files={"file": ("a.pdf", _pdf_bytes())})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503
    assert r.json()["detail"]["kind"] == "token_missing"


def test_parse_precheck_409_without_mineru_call(monkeypatch):
    from app.database import SessionLocal
    from app.services.runtime_config import set_config_values

    db = SessionLocal()
    try:
        set_config_values(db, {"mineru_mode": "agent", "mineru_token": ""})
    finally:
        db.close()
    monkeypatch.setattr(parse_router, "check_pdf_scanned",
                        lambda b: {"is_scanned": True, "confidence": 0.92, "evidence": {"hit": 5}})

    called = {}

    async def _fake(**kw):
        called["yes"] = True
        return mineru_svc.ParseResult(text="text", is_ocr=False, mode="agent", model="pipeline")

    monkeypatch.setattr(parse_router, "parse_pdf_agent", _fake)
    client = _client()
    try:
        r = client.post("/api/parse/file", files={"file": ("a.pdf", _pdf_bytes())})
    finally:
        app.dependency_overrides.clear()
        _reset_mineru()
    assert r.status_code == 409
    assert r.json()["detail"]["stage"] == "pre_check"
    assert "yes" not in called


def test_parse_two_phase_ocr(monkeypatch):
    from app.database import SessionLocal
    from app.services.runtime_config import set_config_values

    db = SessionLocal()
    try:
        set_config_values(db, {"mineru_mode": "agent", "mineru_token": ""})
    finally:
        db.close()
    monkeypatch.setattr(parse_router, "check_pdf_scanned",
                        lambda b: {"is_scanned": False, "confidence": 0.0, "evidence": {}})
    calls = []

    async def _fake(*, file_bytes, filename, is_ocr, timeout_total=0):
        calls.append(is_ocr)
        # 首次空 → 触发 post_parse；确认后返回足够长的文本
        text = "x" if is_ocr else "  \n "
        return mineru_svc.ParseResult(text=text, is_ocr=is_ocr, mode="agent", model="pipeline")

    monkeypatch.setattr(parse_router, "parse_pdf_agent", _fake)
    # padding 让文件 > 10KB，避免被当成真空文件
    big = _pdf_bytes() + b"0" * (11 * 1024)
    client = _client()
    try:
        r1 = client.post("/api/parse/file", files={"file": ("a.pdf", big)})
        assert r1.status_code == 409, r1.text
        assert r1.json()["detail"]["stage"] == "post_parse"
        assert calls == [False]
        r2 = client.post("/api/parse/file", data={"confirm_scanned": "true"},
                         files={"file": ("a.pdf", big)})
        # "x" 仍 <50 字 → 重试后报 502 空结果
        assert r2.status_code == 502, r2.text
        assert r2.json()["detail"]["kind"] == "empty"
        assert calls == [False, True]
    finally:
        app.dependency_overrides.clear()
        _reset_mineru()


def test_parse_success_and_truncate(monkeypatch):
    from app.database import SessionLocal
    from app.services.runtime_config import set_config_values

    db = SessionLocal()
    try:
        set_config_values(db, {"mineru_mode": "agent", "mineru_token": ""})
    finally:
        db.close()
    monkeypatch.setattr(parse_router, "check_pdf_scanned",
                        lambda b: {"is_scanned": False, "confidence": 0.0, "evidence": {}})

    async def _fake(*, file_bytes, filename, is_ocr, timeout_total=0):
        assert is_ocr is False
        return mineru_svc.ParseResult(text="字" * 60000, is_ocr=False, mode="agent", model="pipeline")

    monkeypatch.setattr(parse_router, "parse_pdf_agent", _fake)
    client = _client()
    try:
        r = client.post("/api/parse/file", files={"file": ("a.pdf", _pdf_bytes())})
    finally:
        app.dependency_overrides.clear()
        _reset_mineru()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["truncated"] is True and body["chars"] == 50000


def test_clean_mineru_markdown_strips_images():
    cleaned, removed = mineru_svc.clean_mineru_markdown(
        "第一段\n![](images/72a5b687a3b3f0590e4bda86ca18b29b6d0c6e47e9814a17f89d30cac52cff0.jpg)\n第二段\n"
        '<img src="images/a.png" alt="图">\n第三段'
    )
    assert removed == 2
    assert "images/" not in cleaned
    assert "<img" not in cleaned
    assert "第一段" in cleaned and "第二段" in cleaned and "第三段" in cleaned
    # 无图片时原样返回、计数为 0
    cleaned, removed = mineru_svc.clean_mineru_markdown("纯文字\n第二行")
    assert removed == 0 and "纯文字" in cleaned
    assert mineru_svc.clean_mineru_markdown("") == ("", 0)


def test_parse_success_includes_images_removed(monkeypatch):
    from app.database import SessionLocal
    from app.services.runtime_config import set_config_values

    db = SessionLocal()
    try:
        set_config_values(db, {"mineru_mode": "agent", "mineru_token": ""})
    finally:
        db.close()
    monkeypatch.setattr(parse_router, "check_pdf_scanned",
                        lambda b: {"is_scanned": False, "confidence": 0.0, "evidence": {}})

    async def _fake(*, file_bytes, filename, is_ocr, timeout_total=0):
        return mineru_svc.ParseResult(text="正文内容足够长超过五十字" * 10 + "![](images/x.jpg)",
                                      is_ocr=False, mode="agent", model="pipeline", images_removed=1)

    monkeypatch.setattr(parse_router, "parse_pdf_agent", _fake)
    client = _client()
    try:
        r = client.post("/api/parse/file", files={"file": ("a.pdf", _pdf_bytes())})
    finally:
        app.dependency_overrides.clear()
        _reset_mineru()
    assert r.status_code == 200, r.text
    assert r.json()["images_removed"] == 1


def test_parse_config_public():
    _reset_mineru()
    client = TestClient(app)
    r = client.get("/api/parse/config")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] in ("precision", "agent")
    assert body["limits"]["current_mb"] in (10, 200)
