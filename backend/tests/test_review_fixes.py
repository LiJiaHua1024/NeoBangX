"""本次代码审查修复项的回归测试。

覆盖：连字符复合词排查、错因 JSON 解析健壮性、原子额度扣减、
时区往返、模型白名单校验。
"""
import pytest
from fastapi import HTTPException

from app.database import SessionLocal
from app.models import UsageCode, UsageLog
from app.services.migration import parse_error_causes
from app.services.usage_code import consume_quota
from app.services.vocab_check import check_over_words


# ---------------- 超标词排查：连字符 ----------------

def test_hyphenated_compound_words_are_split_and_checked():
    """连字符复合词不再整体跳过：拆段排查并计数。"""
    result = check_over_words("Cyber-bullying is bad.")
    over = [w["word"] for w in result["over_words"]]
    assert "bullying" in over
    assert "cyber" in over
    # cyber / bullying / is / bad 全部计入总词数（原实现连字符词整体跳过，只计 2 个）
    assert result["total_words"] == 4


def test_wordlist_hyphen_entries_still_pass_fast_path():
    """词表自带的连字符词条（e-mail 等）走快路径直接放行，不产生误报。"""
    result = check_over_words("I sent an e-mail.")
    assert result["over_words"] == []
    assert result["total_words"] == 4


# ---------------- 错因解析健壮性 ----------------

def test_parse_error_causes_unknown_json_key_extracts_values():
    """JSON 键名变体（error_cause_list）应提取内容，而不是把整段原始 JSON 当错因。"""
    raw = '{"error_cause_list": ["忽略转折词", "词义理解偏差"]}'
    assert parse_error_causes(raw) == ["忽略转折词", "词义理解偏差"]


def test_parse_error_causes_camel_case_key():
    assert parse_error_causes('{"errorCauses": ["粗心大意"]}') == ["粗心大意"]


def test_parse_error_causes_strips_trailing_bold_markers():
    """LLM 常见的加粗编号列表不应在标签尾部残留 **。"""
    raw = '**1. 审题不清**\n**2. 过度依赖直译**'
    assert parse_error_causes(raw) == ["审题不清", "过度依赖直译"]


def test_parse_error_causes_empty_structured_result_returns_empty():
    assert parse_error_causes('{"causes": []}') == []


def test_parse_error_causes_plain_text_fallback_kept():
    assert parse_error_causes("1. 审题不清\n2. 直译") == ["审题不清", "直译"]


# ---------------- 原子额度扣减 ----------------

def _fresh_code(db, *, code="NBXU-TEST-QUOTA-ATOMIC", quota=3):
    row = UsageCode(code=code, code_type="user", quota=quota, used_count=0, is_enabled=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_consume_quota_conditional_update_rejects_overdraft():
    db = SessionLocal()
    try:
        row = _fresh_code(db, quota=3)
        consume_quota(db, row, units=2)
        db.refresh(row)
        assert row.used_count == 2

        # 2 + 2 > 3：条件 UPDATE 不命中，必须拒绝且不改变 used_count
        with pytest.raises(HTTPException) as exc_info:
            consume_quota(db, row, units=2)
        assert exc_info.value.status_code == 403
        db.refresh(row)
        assert row.used_count == 2

        # 恰好扣满仍允许
        consume_quota(db, row, units=1)
        db.refresh(row)
        assert row.used_count == 3
    finally:
        db.query(UsageCode).filter(UsageCode.code == "NBXU-TEST-QUOTA-ATOMIC").delete()
        db.commit()
        db.close()


def test_consume_quota_admin_code_never_deducted():
    db = SessionLocal()
    try:
        row = UsageCode(
            code="NBXA-TEST-QUOTA-ADMIN",
            code_type="admin",
            quota=-1,
            used_count=0,
            is_enabled=True,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        consume_quota(db, row, units=5)
        db.refresh(row)
        assert row.used_count == 0  # 管理员码只记日志不扣减
    finally:
        db.query(UsageCode).filter(UsageCode.code == "NBXA-TEST-QUOTA-ADMIN").delete()
        db.commit()
        db.close()


# ---------------- 时区往返 ----------------

def test_datetime_roundtrip_preserves_utc_timezone():
    from datetime import datetime, timedelta, timezone

    db = SessionLocal()
    log = None
    try:
        log = UsageLog(code_id=-1, code="NBXU-TZ-CHECK", tool_id="t")
        db.add(log)
        db.commit()
        db.refresh(log)
        assert log.created_at.tzinfo is not None
        assert log.created_at.utcoffset().total_seconds() == 0
        # 序列化结果带 UTC 偏移，前端 new Date 才能按本地时区正确显示
        assert "+00:00" in log.created_at.isoformat()
        # 非 UTC 时区的写入被归一化存储为 UTC
        log.created_at = datetime(2026, 1, 2, 11, 4, 5, tzinfo=timezone(timedelta(hours=8)))
        db.commit()
        db.refresh(log)
        assert log.created_at == datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    finally:
        if log is not None:
            db.delete(log)
            db.commit()
        db.close()


# ---------------- 模型白名单 ----------------

def test_validate_model_rejects_model_outside_configured_list():
    from app.routers.chat import _validate_model

    cfg = {"models": [{"id": "openrouter/google/gemini-2.0-flash"}]}
    _validate_model(cfg, None)
    _validate_model(cfg, "openrouter/google/gemini-2.0-flash")
    with pytest.raises(HTTPException):
        _validate_model(cfg, "some-other-provider/very-expensive-model")


# ---------------- JWT 密钥一键轮换 ----------------

def test_apply_jwt_secret_override_loads_rotated_file(tmp_path, monkeypatch):
    """默认密钥 + 数据卷存在 jwt_secret.txt 时，启动加载逻辑应生效。"""
    from app.config import DEFAULT_JWT_SECRET, settings
    from app.services.usage_code import write_jwt_secret_file

    monkeypatch.setattr(settings, "jwt_secret", DEFAULT_JWT_SECRET)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    assert settings.jwt_secret_is_default
    path = write_jwt_secret_file("rotated-secret-value")
    assert path.exists()

    from app.services.usage_code import apply_jwt_secret_override
    assert apply_jwt_secret_override() is True
    assert settings.jwt_secret == "rotated-secret-value"
    assert not settings.jwt_secret_is_default


def test_apply_jwt_secret_override_skips_explicit_config(tmp_path, monkeypatch):
    """已显式配置非默认密钥时，数据卷文件不生效（环境配置优先）。"""
    from app.config import settings

    monkeypatch.setattr(settings, "jwt_secret", "my-explicit-secret")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "jwt_secret.txt").write_text("stale-file-secret\n", encoding="utf-8")

    from app.services.usage_code import apply_jwt_secret_override
    assert apply_jwt_secret_override() is False
    assert settings.jwt_secret == "my-explicit-secret"


def test_rotate_endpoint_writes_file_and_flips_flag(tmp_path, monkeypatch):
    """一键轮换端点：写入数据卷文件并让本进程的默认密钥标记翻转。"""
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app
    from app.config import DEFAULT_JWT_SECRET, settings

    monkeypatch.setattr(settings, "jwt_secret", DEFAULT_JWT_SECRET)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    with TestClient(admin_app) as client:  # 触发 lifespan 后 stats 才有安全标记
        before = client.get("/api/admin/stats").json()
        assert before["security"]["jwt_secret_is_default"] is True

        resp = client.post("/api/admin/jwt-secret/rotate")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "rotated"
        assert body["requires_restart"] is True

        after = client.get("/api/admin/stats").json()
        assert after["security"]["jwt_secret_is_default"] is False

    secret_file = tmp_path / "jwt_secret.txt"
    assert secret_file.exists()
    assert secret_file.read_text(encoding="utf-8").strip() == settings.jwt_secret
