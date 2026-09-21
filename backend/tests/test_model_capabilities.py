"""模型用途能力位（用户可用 / 用于 OCR / 用于 Chores）的回归测试。

覆盖三层：
1. 配置解析：三个能力位的解析、旧 chores_only 的迁移路径、序列化往返；
2. 管理端校验：未禁用模型至少要勾一项、default/chores/ocr 三个指向与能力位一致；
3. 用户端可见性：未勾「用户可用」的模型不出现在 /api/tools/，也不进 available_model_ids。
"""
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.services.provider_config import (
    create_provider,
    delete_provider,
    set_providers_for_single_model,
)
from app.services.runtime_config import (
    get_config_map,
    has_any_capability,
    parse_capabilities,
    parse_models,
    resolve_llm_settings,
    serialize_models,
    set_config_values,
)

TEST_PROVIDER_ID = "prov_capability_test"

USER_MODEL = "test/cap-user"
OCR_MODEL = "test/cap-ocr"
CHORES_MODEL = "test/cap-chores"


def _model_entry(model_id, **extra):
    entry = {"id": model_id, "name": model_id}
    entry.update(extra)
    return entry


@pytest.fixture
def models_config():
    """临时改写 models / default_model / chores_model / ocr_model，并绑定可用 Provider。"""
    db = SessionLocal()
    old = get_config_map(db)
    try:
        create_provider(db, name="能力位测试 Provider", provider_id=TEST_PROVIDER_ID)
    except ValueError:
        pass  # 重复运行时已存在
    bound: list[str] = []

    def apply(entries, default_model=None, chores_model="", ocr_model=""):
        updates = {"models": json.dumps(entries, ensure_ascii=False)}
        if default_model is not None:
            updates["default_model"] = default_model
        updates["chores_model"] = chores_model
        updates["ocr_model"] = ocr_model
        set_config_values(db, updates)
        for entry in entries:
            set_providers_for_single_model(db, entry["id"], [TEST_PROVIDER_ID])
            bound.append(entry["id"])

    try:
        yield apply
    finally:
        set_config_values(db, {
            "models": old.get("models", ""),
            "default_model": old.get("default_model", ""),
            "chores_model": old.get("chores_model", ""),
            "ocr_model": old.get("ocr_model", ""),
        })
        for model_id in bound:
            set_providers_for_single_model(db, model_id, [])
        delete_provider(db, TEST_PROVIDER_ID)
        db.close()


# ---------------- 配置解析与迁移 ----------------

def test_parse_capabilities_migrates_legacy_chores_only():
    """旧「仅 Chores」开关迁移成能力位：仅 Chores → 不给用户端用，但仍能做 Chores。"""
    parsed = {m["id"]: m for m in parse_models(json.dumps([
        {"id": "legacy-only", "chores_only": True},
        {"id": "legacy-normal", "chores_only": False},
        {"id": "legacy-bare"},
        {"id": "legacy-alias", "only_chores": True},
    ], ensure_ascii=False))}

    assert parsed["legacy-only"]["user_usable"] is False
    assert parsed["legacy-only"]["ocr_usable"] is False
    assert parsed["legacy-only"]["chores_usable"] is True

    for model_id in ("legacy-normal", "legacy-bare"):
        assert parsed[model_id]["user_usable"] is True
        assert parsed[model_id]["ocr_usable"] is False
        assert parsed[model_id]["chores_usable"] is True

    assert parsed["legacy-alias"]["user_usable"] is False  # 别名同样识别


def test_parse_capabilities_explicit_wins_and_roundtrips():
    """显式给出的能力位原样保留，且序列化往返后不再出现 chores_only。"""
    raw = json.dumps([
        {"id": "ocr-only", "user_usable": False, "ocr_usable": True, "chores_usable": False},
        {"id": "all-off", "user_usable": False, "ocr_usable": False, "chores_usable": False},
    ], ensure_ascii=False)
    parsed = {m["id"]: m for m in parse_models(raw)}

    assert parsed["ocr-only"]["ocr_usable"] is True
    assert parsed["ocr-only"]["user_usable"] is False
    assert parsed["ocr-only"]["chores_usable"] is False
    assert not has_any_capability(parsed["all-off"])
    assert has_any_capability(parsed["ocr-only"])

    serialized = serialize_models(list(parsed.values()))
    assert "chores_only" not in serialized
    reparsed = {m["id"]: m for m in parse_models(serialized)}
    assert reparsed["ocr-only"] == parsed["ocr-only"]


def test_parse_capabilities_comma_format_defaults():
    """旧逗号分隔格式补上默认能力位：用户可用 + Chores。"""
    parsed = parse_models("a,b")
    assert [(m["user_usable"], m["ocr_usable"], m["chores_usable"]) for m in parsed] == [
        (True, False, True),
        (True, False, True),
    ]


def test_parse_capabilities_partial_keys_use_defaults():
    """只提交部分能力位时，其余按默认值补齐（后台总是三项都发，这里兜住手工调用）。"""
    caps = parse_capabilities({"user_usable": False})
    assert caps == {"user_usable": False, "ocr_usable": False, "chores_usable": True}


# ---------------- 用户端可见性 ----------------

def test_tools_hides_models_without_user_capability(models_config):
    """未勾「用户可用」的模型（含仅 OCR 模型）不出现在用户端模型列表里。"""
    models_config(
        [
            _model_entry(USER_MODEL, user_usable=True, ocr_usable=False, chores_usable=True),
            _model_entry(OCR_MODEL, user_usable=False, ocr_usable=True, chores_usable=False),
        ],
        default_model=USER_MODEL,
    )
    data = TestClient(app).get("/api/tools/").json()
    assert [m["id"] for m in data["models"]] == [USER_MODEL]

    db = SessionLocal()
    try:
        cfg = resolve_llm_settings(db)
        assert OCR_MODEL not in cfg["available_model_ids"]
        assert USER_MODEL in cfg["available_model_ids"]
    finally:
        db.close()


# ---------------- 管理端校验 ----------------

def test_admin_rejects_model_without_any_capability(models_config):
    from app.admin_main import app as admin_app

    models_config([_model_entry(USER_MODEL)], default_model=USER_MODEL)
    response = TestClient(admin_app).put("/api/admin/config", json={
        "models": [
            {"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": True},
            {"id": "test/cap-dead", "user_usable": False, "ocr_usable": False, "chores_usable": False},
        ],
    })
    assert response.status_code == 400
    assert "未勾选任何用途" in response.json()["detail"]


def test_admin_rejects_disabled_model_without_capability(models_config):
    """禁用模型不受「至少一项」限制（三项都可以不勾）。"""
    from app.admin_main import app as admin_app

    models_config([_model_entry(USER_MODEL)], default_model=USER_MODEL)
    response = TestClient(admin_app).put("/api/admin/config", json={
        "models": [
            {"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": True},
            {"id": "test/cap-off", "enabled": False,
             "user_usable": False, "ocr_usable": False, "chores_usable": False},
        ],
    })
    assert response.status_code == 200, response.text


def test_admin_rejects_pointer_without_matching_capability(models_config):
    from app.admin_main import app as admin_app

    models_config(
        [_model_entry(USER_MODEL, user_usable=True, ocr_usable=False, chores_usable=True)],
        default_model=USER_MODEL,
    )
    client = TestClient(admin_app)

    # chores 指向未勾「用于 Chores」的模型
    response = client.put("/api/admin/config", json={
        "models": [{"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": False}],
        "chores_model": USER_MODEL,
    })
    assert response.status_code == 400
    assert "用于 Chores" in response.json()["detail"]

    # ocr 指向未勾「用于 OCR」的模型
    response = client.put("/api/admin/config", json={
        "models": [{"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": True}],
        "ocr_model": USER_MODEL,
    })
    assert response.status_code == 400
    assert "用于 OCR" in response.json()["detail"]

    # 默认模型指向未勾「用户可用」的模型
    response = client.put("/api/admin/config", json={
        "models": [{"id": OCR_MODEL, "user_usable": False, "ocr_usable": True, "chores_usable": False}],
        "default_model": OCR_MODEL,
    })
    assert response.status_code == 400
    assert "用户可用" in response.json()["detail"]


def test_admin_rejects_losing_capability_still_pointed_at(models_config):
    """已配成 OCR 模型的模型被取消「用于 OCR」时，必须同时改指向，否则拦下。"""
    from app.admin_main import app as admin_app

    models_config(
        [
            _model_entry(USER_MODEL, user_usable=True, ocr_usable=False, chores_usable=True),
            _model_entry(OCR_MODEL, user_usable=False, ocr_usable=True, chores_usable=False),
        ],
        default_model=USER_MODEL,
        ocr_model=OCR_MODEL,
    )
    response = TestClient(admin_app).put("/api/admin/config", json={
        "models": [
            {"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": True},
            # 保住 Chores 能力（否则先被「未勾选任何用途」拦下），只丢掉「用于 OCR」
            {"id": OCR_MODEL, "user_usable": False, "ocr_usable": False, "chores_usable": True},
        ],
    })
    assert response.status_code == 400
    assert "OCR 模型" in response.json()["detail"]


def test_admin_accepts_ocr_only_model_and_roundtrips(models_config):
    """仅 OCR 模型（用户端不可见）可以保存，并在配置读回时保持三个能力位。"""
    from app.admin_main import app as admin_app

    models_config([_model_entry(USER_MODEL)], default_model=USER_MODEL)
    client = TestClient(admin_app)
    response = client.put("/api/admin/config", json={
        "models": [
            {"id": USER_MODEL, "user_usable": True, "ocr_usable": False, "chores_usable": True},
            {"id": OCR_MODEL, "name": "识别专用", "user_usable": False,
             "ocr_usable": True, "chores_usable": False},
        ],
        "ocr_model": OCR_MODEL,
        "ocr_max_tokens": 12000,
    })
    assert response.status_code == 200, response.text

    config = client.get("/api/admin/config").json()["config"]
    returned = {m["id"]: m for m in config["models"]}
    assert returned[OCR_MODEL]["ocr_usable"] is True
    assert returned[OCR_MODEL]["user_usable"] is False
    assert returned[OCR_MODEL]["chores_usable"] is False
    assert config["ocr_model"] == OCR_MODEL
    assert config["ocr_max_tokens"] == "12000"

    db = SessionLocal()
    try:
        cfg = resolve_llm_settings(db)
        assert cfg["ocr_model"] == OCR_MODEL
        assert cfg["ocr_max_tokens"] == 12000
    finally:
        db.close()


def test_resolve_llm_settings_ocr_model_falls_back_on_dirty_data(models_config):
    """脏数据兜底：ocr_model 指向已禁用模型时回退默认模型，而不是把请求打死；
    回退后等于又变成「跟随默认」，ocr_model_configured 随之转假（能力校验按默认模型算）。"""
    models_config(
        [
            _model_entry(USER_MODEL, user_usable=True, ocr_usable=True, chores_usable=True),
            _model_entry(OCR_MODEL, enabled=False, user_usable=False,
                         ocr_usable=True, chores_usable=False),
        ],
        default_model=USER_MODEL,
        ocr_model=OCR_MODEL,
    )
    db = SessionLocal()
    try:
        cfg = resolve_llm_settings(db)
        assert cfg["ocr_model"] == USER_MODEL
        assert cfg["ocr_model_configured"] is False
    finally:
        db.close()


def test_resolve_llm_settings_marks_explicit_ocr_model(models_config):
    """显式配置的 OCR 模型（未禁用）保持 ocr_model_configured=True。"""
    models_config(
        [
            _model_entry(USER_MODEL, user_usable=True, ocr_usable=False, chores_usable=True),
            _model_entry(OCR_MODEL, user_usable=False, ocr_usable=True, chores_usable=False),
        ],
        default_model=USER_MODEL,
        ocr_model=OCR_MODEL,
    )
    db = SessionLocal()
    try:
        cfg = resolve_llm_settings(db)
        assert cfg["ocr_model"] == OCR_MODEL
        assert cfg["ocr_model_configured"] is True
    finally:
        db.close()


def test_resolve_llm_settings_follow_default_marks_not_configured(models_config):
    """ocr_model 留空 = 跟随默认：ocr_model_configured=False（调用方据此要求默认模型有该能力）。"""
    models_config(
        [_model_entry(USER_MODEL, user_usable=True, ocr_usable=True, chores_usable=True)],
        default_model=USER_MODEL,
        ocr_model="",
    )
    db = SessionLocal()
    try:
        cfg = resolve_llm_settings(db)
        assert cfg["ocr_model"] == USER_MODEL
        assert cfg["ocr_model_configured"] is False
    finally:
        db.close()
