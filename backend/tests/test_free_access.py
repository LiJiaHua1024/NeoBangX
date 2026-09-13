"""免费模型（不扣次数 / 无码可用 / 防滥用限额）的回归测试。

覆盖三层：
1. 配置解析：is_free / free_no_code / free_limits 的规范化与序列化往返；
2. 限额服务：identity 归属、窗口计数、在途占位与释放；
3. 端点行为：匿名只能调用「免费 + 无码可用」模型、免费调用不扣次数、
   次数耗尽的码仍可调用免费模型、超限返回 429；限额命中且持可用码时
   转为按次计费（迁移批次同步升级为付费批）。
"""
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import deps
from app.database import SessionLocal
from app.main import app
from app.models import UsageCode, UsageLog
from app.routers import chat as chat_router
from app.routers import tools as tools_router
from app.services.free_access import (
    identity_key,
    is_free_model,
    is_free_open,
    register_free_use,
)
from app.services.prompt_loader import PromptLoader
from app.services.provider_config import create_provider, delete_provider, set_providers_for_single_model
from app.services.request_log import STATUS_CANCELLED, STATUS_ERROR
from app.services.runtime_config import (
    get_config_map,
    parse_models,
    serialize_models,
    set_config_values,
)
from app.services.usage_code import issue_token, resolve_code_lenient

TEST_TOOL_ID = "25"  # 自由对话
FREE_CHAT_PROMPT = "你是助手。\n\n{{user_input}}\n"

FREE_MODEL_ID = "test/free-model"
FREE_CLOSED_MODEL_ID = "test/free-without-nocode"
PAID_MODEL_ID = "test/paid-model"
TEST_PROVIDER_ID = "prov_free_test"


class _FakeStreamLLM:
    def __init__(self, tokens=("你", "好")):
        self.tokens = list(tokens)

    async def chat_stream_with_stop(self, *, user_prompt, usage_out=None, **_kwargs):
        for token in self.tokens:
            yield token
        if usage_out is not None:
            usage_out.update({"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5})


def _model_entry(model_id, **extra):
    entry = {"id": model_id, "name": model_id}
    entry.update(extra)
    return entry


def _as_anonymous(reason="missing"):
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=None, reason=reason
    )


def _as_code(code, reason=""):
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=code, reason=reason
    )


def _make_code(*, quota=5, used=0, enabled=True):
    db = SessionLocal()
    try:
        # 码值唯一：会话级数据库在多个测试间共享
        row = UsageCode(
            code=f"NBXU-FREE-{uuid4().hex[:12].upper()}",
            quota=quota,
            used_count=used,
            is_enabled=enabled,
            note="免费功能测试",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        db.expunge(row)
        return row
    finally:
        db.close()


@pytest.fixture
def models_config():
    """临时改写 models / default_model，并为测试模型绑定一个可用 Provider。

    会话级数据库是所有测试共享的，收尾时必须把配置与绑定还原。
    """
    db = SessionLocal()
    old = get_config_map(db)
    try:
        create_provider(db, name="免费功能测试 Provider", provider_id=TEST_PROVIDER_ID)
    except ValueError:
        pass  # 已存在（重复运行）
    bound: list[str] = []

    def apply(entries, default_model):
        set_config_values(
            db,
            {
                "models": json.dumps(entries, ensure_ascii=False),
                "default_model": default_model,
            },
        )
        for entry in entries:
            set_providers_for_single_model(db, entry["id"], [TEST_PROVIDER_ID])
            bound.append(entry["id"])

    try:
        yield apply
    finally:
        set_config_values(
            db,
            {"models": old.get("models", ""), "default_model": old.get("default_model", "")},
        )
        for model_id in bound:
            set_providers_for_single_model(db, model_id, [])
        delete_provider(db, TEST_PROVIDER_ID)
        db.close()


@pytest.fixture
def stream(tmp_path):
    """返回 TestClient：prompt 走临时目录，LLM 换成假实现。"""
    loader_dir = tmp_path / "prompts"
    loader_dir.mkdir()
    (loader_dir / "自由对话.md").write_text(FREE_CHAT_PROMPT, encoding="utf-8")
    loader = PromptLoader(loader_dir)
    original_build_llm = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: _FakeStreamLLM()
    app.dependency_overrides[tools_router.get_prompt_loader] = lambda: loader
    try:
        yield TestClient(app)
    finally:
        chat_router._build_llm = original_build_llm
        app.dependency_overrides.clear()


def _post_stream(client, model=None, **headers):
    payload = {"tool_id": TEST_TOOL_ID, "input": "hello"}
    if model:
        payload["model"] = model
    return client.post("/api/chat/stream", json=payload, headers=headers)


# ---------------- 配置解析 ----------------

def test_parse_models_free_fields_and_roundtrip():
    parsed = parse_models(json.dumps([
        {"id": "a", "is_free": True, "free_no_code": True,
         "free_limits": {"minute": 3, "month": 100}},
        {"id": "b", "free": "true", "free_without_code": "on"},   # 兼容别名
        {"id": "c", "free_no_code": True},                        # 未标免费 → 无码开关归零
        {"id": "d", "is_free": True, "free_limits": {"minute": -1, "hour": "x", "day": 2.9}},
        {"id": "e", "free_limits": {"week": 7}},                  # 限额可独立于免费开关保存
    ], ensure_ascii=False))
    by_id = {m["id"]: m for m in parsed}

    assert by_id["a"]["is_free"] and by_id["a"]["free_no_code"]
    assert by_id["a"]["free_limits"] == {"minute": 3, "hour": 0, "day": 0, "week": 0, "month": 100}
    assert by_id["b"]["is_free"] and by_id["b"]["free_no_code"]
    assert by_id["c"]["is_free"] is False and by_id["c"]["free_no_code"] is False
    assert by_id["d"]["free_limits"] == {"minute": 0, "hour": 0, "day": 2, "week": 0, "month": 0}
    assert by_id["e"]["is_free"] is False and by_id["e"]["free_limits"]["week"] == 7
    # 序列化往返必须保留新字段，否则保存配置时会被静默剔除
    assert json.loads(serialize_models(parsed)) == parsed
    # 旧逗号格式与空配置：默认都不是免费模型
    assert [m["is_free"] for m in parse_models("m1,m2")] == [False, False]
    assert parse_models("") == []


# ---------------- 限额服务 ----------------

def test_identity_key_priority():
    assert identity_key(code_id=5, fingerprint="fp1", ip="1.2.3.4") == "code:5"
    assert identity_key(fingerprint="fp1", ip="1.2.3.4") == "fp:fp1"
    assert identity_key(ip="1.2.3.4") == "ip:1.2.3.4"
    assert identity_key() == "anon"


def test_is_free_open_requires_both_flags():
    assert is_free_model({"is_free": True}) is True
    assert is_free_open({"is_free": True, "free_no_code": False}) is False
    assert is_free_open({"is_free": True, "free_no_code": True}) is True
    assert is_free_open(None) is False


def test_limit_blocks_then_release_restores_slot():
    entry = {"id": "limit/inflight", "name": "限额模型", "is_free": True,
             "free_limits": {"minute": 2}}
    identity = "fp:limit-inflight"
    release_first = register_free_use(entry=entry, identity=identity)
    register_free_use(entry=entry, identity=identity)

    with pytest.raises(HTTPException) as exc:
        register_free_use(entry=entry, identity=identity)
    assert exc.value.status_code == 429
    assert exc.value.detail["window"] == "minute"
    assert "每分钟" in exc.value.detail["message"]

    # 释放一个在途占位后应重新放行
    release_first()
    register_free_use(entry=entry, identity=identity)()


def test_inflight_sweep_drops_expired_keys_and_keeps_live():
    """在途计数的键清理只删已过期的键：删掉活跃键会直接放穿限额。"""
    from app.services import free_access

    free_access._inflight.clear()
    now = free_access.monotonic()
    free_access._inflight[("fp:live", "m")].append(now)
    for index in range(20):
        free_access._inflight[(f"fp:stale-{index}", "m")].append(
            now - free_access._INFLIGHT_TTL - 1
        )
    assert len(free_access._inflight) == 21

    free_access._sweep_inflight(now)

    assert ("fp:live", "m") in free_access._inflight
    assert len(free_access._inflight[("fp:live", "m")]) == 1
    assert [key for key in free_access._inflight if key[0].startswith("fp:stale-")] == []
    free_access._inflight.clear()


def test_limit_counts_persisted_logs():
    """已落库的历史调用计入窗口（跨重启仍然有效）。"""
    entry = {"id": "limit/persisted", "name": "限额模型", "is_free": True,
             "free_limits": {"day": 1}}
    db = SessionLocal()
    try:
        # fingerprint 列存原始指纹，identity 里的 fp: 前缀只是计数主体的封装
        db.add(UsageLog(code_id=0, code="（免码）", model="limit/persisted",
                        fingerprint="limit-persisted", status="success", units=0))
        db.commit()
    finally:
        db.close()

    with pytest.raises(HTTPException) as exc:
        register_free_use(entry=entry, identity="fp:limit-persisted")
    assert exc.value.detail["window"] == "day"
    assert exc.value.detail["used"] == 1


def test_limit_ignores_failed_calls():
    """生成失败（error）不占用限额：失败多少次都不该把用户挡在门外。"""
    entry = {"id": "limit/failed", "name": "限额模型", "is_free": True,
             "free_limits": {"minute": 1}}
    db = SessionLocal()
    try:
        for _ in range(3):
            db.add(UsageLog(code_id=0, code="（免码）", model="limit/failed", status=STATUS_ERROR,
                            fingerprint="limit-failed", units=0))
        db.commit()
    finally:
        db.close()

    register_free_use(entry=entry, identity="fp:limit-failed")()


def test_limit_counts_cancelled_calls():
    """用户中途停止 / 断线（cancelled）照常计入，防止「快结束就停止」白嫖。"""
    entry = {"id": "limit/cancelled", "name": "限额模型", "is_free": True,
             "free_limits": {"minute": 1}}
    db = SessionLocal()
    try:
        db.add(UsageLog(code_id=0, code="（免码）", model="limit/cancelled", status=STATUS_CANCELLED,
                        fingerprint="limit-cancelled", units=1))
        db.commit()
    finally:
        db.close()

    with pytest.raises(HTTPException) as exc:
        register_free_use(entry=entry, identity="fp:limit-cancelled")
    assert exc.value.detail["used"] == 1


def test_unlimited_model_never_blocks():
    entry = {"id": "limit/unlimited", "name": "不限额模型", "is_free": True,
             "free_limits": {"minute": 0, "month": -1}}
    for _ in range(5):
        register_free_use(entry=entry, identity="fp:limit-unlimited")


# ---------------- 可选认证解析 ----------------

def test_resolve_code_lenient_reports_reason():
    good = _make_code(quota=5, used=0)
    exhausted = _make_code(quota=1, used=1)
    disabled = _make_code(quota=5, used=0, enabled=False)
    db = SessionLocal()
    try:
        assert resolve_code_lenient(db, issue_token(good))[1] == ""
        assert resolve_code_lenient(db, issue_token(exhausted))[1] == "exhausted"
        assert resolve_code_lenient(db, issue_token(disabled))[1] == "disabled"
        assert resolve_code_lenient(db, "not-a-token") == (None, "invalid")
        assert resolve_code_lenient(db, "") == (None, "missing")
    finally:
        db.close()


# ---------------- 端点行为 ----------------

def test_anonymous_can_use_free_no_code_model(stream, models_config):
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True), _model_entry(PAID_MODEL_ID)],
        FREE_MODEL_ID,
    )
    client = stream
    _as_anonymous()
    response = _post_stream(client, model=FREE_MODEL_ID, **{"X-Client-Fingerprint": "fp-anon-free"})
    assert response.status_code == 200
    assert "[DONE]" in response.text


def test_anonymous_cannot_use_paid_model(stream, models_config):
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True), _model_entry(PAID_MODEL_ID)],
        PAID_MODEL_ID,
    )
    client = stream
    _as_anonymous()
    response = _post_stream(client, model=PAID_MODEL_ID)
    assert response.status_code == 401
    assert "请先输入使用码" in response.text


def test_anonymous_cannot_use_free_model_without_no_code(stream, models_config):
    models_config([_model_entry(FREE_CLOSED_MODEL_ID, is_free=True, free_no_code=False)],
                  FREE_CLOSED_MODEL_ID)
    client = stream
    _as_anonymous()
    response = _post_stream(client, model=FREE_CLOSED_MODEL_ID)
    assert response.status_code == 401


def test_exhausted_code_falls_back_to_free_model(stream, models_config):
    """次数耗尽的码等同无码：可继续用免费（无码可用）模型，非免费模型报 403。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True), _model_entry(PAID_MODEL_ID)],
        FREE_MODEL_ID,
    )
    client = stream
    _as_anonymous(reason="exhausted")

    ok = _post_stream(client, model=FREE_MODEL_ID, **{"X-Client-Fingerprint": "fp-exhausted"})
    assert ok.status_code == 200
    assert "[DONE]" in ok.text

    blocked = _post_stream(client, model=PAID_MODEL_ID)
    assert blocked.status_code == 403
    assert "额度已用尽" in blocked.text


def test_free_model_call_does_not_consume_quota(stream, models_config):
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True), _model_entry(PAID_MODEL_ID)],
        FREE_MODEL_ID,
    )
    client = stream
    code = _make_code(quota=5, used=0)
    _as_code(code)

    response = _post_stream(client, model=FREE_MODEL_ID)
    assert response.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0
        row = db.query(UsageLog).filter(UsageLog.code_id == code.id).order_by(UsageLog.id.desc()).first()
        assert row is not None and row.units == 0 and row.model == FREE_MODEL_ID
    finally:
        db.close()


def test_paid_model_call_still_consumes_quota(stream, models_config):
    models_config([_model_entry(PAID_MODEL_ID)], PAID_MODEL_ID)
    client = stream
    code = _make_code(quota=5, used=0)
    _as_code(code)

    response = _post_stream(client, model=PAID_MODEL_ID)
    assert response.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 1
        row = db.query(UsageLog).filter(UsageLog.code_id == code.id).order_by(UsageLog.id.desc()).first()
        assert row is not None and row.units == 1
    finally:
        db.close()


def test_free_limit_hits_429_on_second_call(stream, models_config):
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True,
                      free_limits={"minute": 1})],
        FREE_MODEL_ID,
    )
    client = stream
    _as_anonymous()
    headers = {"X-Client-Fingerprint": "fp-limit-429"}

    first = _post_stream(client, model=FREE_MODEL_ID, **headers)
    assert first.status_code == 200

    second = _post_stream(client, model=FREE_MODEL_ID, **headers)
    assert second.status_code == 429
    assert "每分钟" in second.text


def test_tools_projection_exposes_free_flags(models_config):
    """用户端模型列表必须带上免费标记（否则前端无法渲染标签与免码默认选中）。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True), _model_entry(PAID_MODEL_ID)],
        FREE_MODEL_ID,
    )
    data = TestClient(app).get("/api/tools/").json()
    by_id = {m["id"]: m for m in data["models"]}
    assert by_id[FREE_MODEL_ID]["is_free"] is True
    assert by_id[FREE_MODEL_ID]["free_no_code"] is True
    assert by_id[PAID_MODEL_ID]["is_free"] is False
    assert by_id[PAID_MODEL_ID]["free_no_code"] is False


def test_tools_hides_disabled_and_chores_models(models_config):
    """用户端模型列表只含可见模型：已禁用与仅 Chores 既不展示、也不计入折叠数量。"""
    models_config(
        [
            _model_entry("test/visible-a"),
            _model_entry("test/disabled-b", enabled=False),
            _model_entry("test/chores-c", chores_only=True),
            _model_entry("test/visible-d"),
        ],
        "test/visible-a",
    )
    data = TestClient(app).get("/api/tools/").json()
    assert [m["id"] for m in data["models"]] == ["test/visible-a", "test/visible-d"]


def test_max_visible_models_roundtrip_and_clamp(models_config):
    """折叠上限：后台可读写，越界被拒，脏数据夹回合法区间（0 = 不折叠）。"""
    from app.admin_main import app as admin_app
    from app.services.runtime_config import MAX_VISIBLE_MODELS_LIMIT, resolve_llm_settings

    models_config([_model_entry(PAID_MODEL_ID)], PAID_MODEL_ID)
    db = SessionLocal()
    old_value = get_config_map(db).get("max_visible_models", "")
    try:
        # 未配置时默认 0：用户端保持全量显示
        assert TestClient(app).get("/api/tools/").json()["max_visible_models"] == 0

        client = TestClient(admin_app)
        response = client.put("/api/admin/config", json={"max_visible_models": 5})
        assert response.status_code == 200, response.text
        assert response.json()["config"]["max_visible_models"] == "5"
        assert client.get("/api/admin/config").json()["config"]["max_visible_models"] == "5"
        # 用户端接口把上限一并下发，前端据此折叠
        assert TestClient(app).get("/api/tools/").json()["max_visible_models"] == 5

        # 超出合法区间直接拒绝
        assert client.put("/api/admin/config", json={"max_visible_models": 999}).status_code == 422

        # 脏数据（负数 / 非数字 / 超上限）在解析时归一
        set_config_values(db, {"max_visible_models": "-3"})
        assert resolve_llm_settings(db)["max_visible_models"] == 0
        set_config_values(db, {"max_visible_models": "abc"})
        assert resolve_llm_settings(db)["max_visible_models"] == 0
        set_config_values(db, {"max_visible_models": "999"})
        assert resolve_llm_settings(db)["max_visible_models"] == MAX_VISIBLE_MODELS_LIMIT
    finally:
        set_config_values(db, {"max_visible_models": old_value})
        db.close()


def test_admin_config_roundtrip_keeps_free_fields(models_config):
    """管理端保存配置后免费字段必须原样保留（serialize 往返不会静默剔除）。"""
    from app.admin_main import app as admin_app

    models_config([_model_entry(FREE_MODEL_ID)], FREE_MODEL_ID)
    client = TestClient(admin_app)
    response = client.put("/api/admin/config", json={
        "models": [
            {
                "id": FREE_MODEL_ID,
                "name": "免费模型",
                "is_free": True,
                "free_no_code": True,
                "free_limits": {"minute": 3, "hour": 20, "day": 0, "week": -1, "month": 100},
            },
            {"id": PAID_MODEL_ID, "name": "收费模型", "free_no_code": True},
        ],
    })
    assert response.status_code == 200, response.text

    returned = {m["id"]: m for m in response.json()["config"]["models"]}
    assert returned[FREE_MODEL_ID]["is_free"] is True
    assert returned[FREE_MODEL_ID]["free_no_code"] is True
    # -1 / 0 都归一为 0（不限制）
    assert returned[FREE_MODEL_ID]["free_limits"] == {
        "minute": 3, "hour": 20, "day": 0, "week": 0, "month": 100,
    }
    # 未标记免费时无码开关强制归零
    assert returned[PAID_MODEL_ID]["is_free"] is False
    assert returned[PAID_MODEL_ID]["free_no_code"] is False


# ---------------- 免费限额命中转按次计费 ----------------

def _latest_log(db, code_id):
    return (
        db.query(UsageLog)
        .filter(UsageLog.code_id == code_id)
        .order_by(UsageLog.id.desc())
        .first()
    )


def test_free_limit_hit_falls_back_to_code_quota(stream, models_config):
    """免费限额命中后，持可用使用码的调用转为按次扣减，而不是 429。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True, free_limits={"minute": 1})],
        FREE_MODEL_ID,
    )
    client = stream
    code = _make_code(quota=3, used=0)
    _as_code(code)

    first = _post_stream(client, model=FREE_MODEL_ID)
    assert first.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0  # 限额内免费
        assert _latest_log(db, code.id).units == 0
    finally:
        db.close()

    second = _post_stream(client, model=FREE_MODEL_ID)
    assert second.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 1  # 达限转按次扣 1 次
        row = _latest_log(db, code.id)
        assert row.units == 1 and row.model == FREE_MODEL_ID
    finally:
        db.close()

    # 窗口内后续调用持续按次计费（付费日志同样计入免费窗口计数）
    third = _post_stream(client, model=FREE_MODEL_ID)
    assert third.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 2
    finally:
        db.close()


def test_free_limit_hit_unlimited_code_keeps_logging_one_unit(stream, models_config):
    """无限码命中免费限额后照常放行：不实扣次数，但按次计费口径记 units=1。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True, free_limits={"minute": 1})],
        FREE_MODEL_ID,
    )
    client = stream
    code = _make_code(quota=-1, used=0)
    _as_code(code)

    assert _post_stream(client, model=FREE_MODEL_ID).status_code == 200
    assert _post_stream(client, model=FREE_MODEL_ID).status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0
        assert _latest_log(db, code.id).units == 1
    finally:
        db.close()


def test_free_limit_hit_exhausted_code_still_429(stream, models_config):
    """次数耗尽的码等同无码：免费限额命中后没有付费途径，仍 429。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True, free_limits={"minute": 1})],
        FREE_MODEL_ID,
    )
    client = stream
    _as_anonymous(reason="exhausted")
    headers = {"X-Client-Fingerprint": "fp-limit-exhausted"}

    assert _post_stream(client, model=FREE_MODEL_ID, **headers).status_code == 200
    second = _post_stream(client, model=FREE_MODEL_ID, **headers)
    assert second.status_code == 429
    assert "每分钟" in second.text


def test_free_model_without_limits_never_charges(stream, models_config):
    """免费模型未配置限额时不会转按次计费（回归）。"""
    models_config(
        [_model_entry(FREE_MODEL_ID, is_free=True, free_no_code=True)],
        FREE_MODEL_ID,
    )
    client = stream
    code = _make_code(quota=3, used=0)
    _as_code(code)

    for _ in range(3):
        assert _post_stream(client, model=FREE_MODEL_ID).status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0
    finally:
        db.close()


# ---------------- 迁移批次：免费批升级付费批 ----------------

def _migration_req(batch_id, batch_size):
    return chat_router.ChatRequest(
        tool_id=chat_router.MIGRATION_TOOL_ID,
        input="迁移测试",
        batch_id=batch_id,
        batch_size=batch_size,
        batch_index=0,
    )


def test_migration_batch_upgrades_free_to_paid():
    """同批卡片先按免费登记、后因限额命中需付费：批次升级而不是 400。"""
    batch_id = f"mig_upgrade_{uuid4().hex}"
    req = _migration_req(batch_id, batch_size=4)  # charge_units = max(1, 4 // 2) = 2
    owner_id = 987_654
    try:
        free_batch = chat_router._register_migration_batch(
            req, owner_id=owner_id, remaining=10, free=True
        )
        assert free_batch.charge_units == 0

        paid_batch = chat_router._register_migration_batch(
            req, owner_id=owner_id, remaining=10, free=False
        )
        assert paid_batch is free_batch
        assert paid_batch.charge_units == 2
        assert chat_router._migration_reserved.get(owner_id) == 2

        # 付费批中夹入免费卡（窗口滚动）：不回退、不报错，整批仍按付费结算
        again = chat_router._register_migration_batch(
            req, owner_id=owner_id, remaining=10, free=True
        )
        assert again.charge_units == 2
    finally:
        batch = chat_router._migration_batches.pop(batch_id, None)
        if batch:
            chat_router._release_migration_reservation(batch)


def test_migration_batch_upgrade_rejected_when_quota_short():
    """免费批升级付费批时整批额度不足：403 结构化 detail，不误报 400。"""
    batch_id = f"mig_short_{uuid4().hex}"
    req = _migration_req(batch_id, batch_size=4)
    owner_id = 987_655
    try:
        chat_router._register_migration_batch(req, owner_id=owner_id, remaining=1, free=True)
        with pytest.raises(HTTPException) as exc:
            chat_router._register_migration_batch(
                req, owner_id=owner_id, remaining=1, free=False
            )
        assert exc.value.status_code == 403
        assert exc.value.detail["required"] == 2
        assert exc.value.detail["remaining"] == 1
    finally:
        batch = chat_router._migration_batches.pop(batch_id, None)
        if batch:
            chat_router._release_migration_reservation(batch)
