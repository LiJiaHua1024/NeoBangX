"""图片识别（工具 32）的回归测试。

覆盖：多模态消息组装、使用码准入（无码 401 / 额度用尽 403）、限流 429、
始终不计费、OCR 模型取自后台配置、图片参数的各类 400、撞输出上限时的截断提示。
"""
import base64
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.database import SessionLocal
from app.main import app
from app.models import UsageCode, UsageLog
from app.routers import chat as chat_router
from app.routers import tools as tools_router
from app.routers.tools import OCR_TOOL_ID, OCR_TOOL_NAME
from app.services.prompt_loader import PromptLoader
from app.services.provider_config import (
    create_provider,
    delete_provider,
    set_providers_for_single_model,
)
from app.services.runtime_config import get_config_map, set_config_values

TEST_PROVIDER_ID = "prov_ocr_test"
CHAT_PROMPT = "普通工具的提示词。\n\n{{user_input}}\n"
PRINTED_PROMPT = "PRINTED-PROMPT：把试卷转录为 Markdown。\n"
HANDWRITTEN_PROMPT = "HANDWRITTEN-PROMPT：按最终状态转录。\n"

USER_MODEL = "test/ocr-user-model"
OCR_MODEL = "test/ocr-vision-model"


def _jpeg_data_url(size: int = 256) -> str:
    payload = b"\xff\xd8\xff\xe0" + b"\x00" * size
    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


class _CapturingLLM:
    """记录本次调用参数，并按构造时给的 usage 回填用量。"""

    def __init__(self, tokens=("转录", "结果"), usage=None):
        self.tokens = list(tokens)
        self.usage = usage
        self.calls: list[dict] = []
        self.providers: list[dict] = []

    async def chat_stream_with_stop(self, **kwargs):
        self.calls.append(kwargs)
        for token in self.tokens:
            yield token
        usage_out = kwargs.get("usage_out")
        if usage_out is not None and self.usage:
            usage_out.update(self.usage)


@pytest.fixture
def llm():
    """把 LLM 换成捕获实现，返回 (fake, client)。"""
    fake = _CapturingLLM()
    original = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: fake
    try:
        yield fake
    finally:
        chat_router._build_llm = original


@pytest.fixture
def loader():
    """提示词走临时目录：普通工具 + 两份 OCR 提示词。"""
    from pathlib import Path
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    (tmp / "自由对话.md").write_text(CHAT_PROMPT, encoding="utf-8")
    (tmp / "识别图片文字-印刷试卷.md").write_text(PRINTED_PROMPT, encoding="utf-8")
    (tmp / "识别图片文字-手写作文.md").write_text(HANDWRITTEN_PROMPT, encoding="utf-8")
    instance = PromptLoader(tmp)
    app.dependency_overrides[tools_router.get_prompt_loader] = lambda: instance
    try:
        yield instance
    finally:
        app.dependency_overrides.pop(tools_router.get_prompt_loader, None)


@pytest.fixture
def ocr_models():
    """配置：一个用户端可见模型 + 一个仅 OCR 模型。"""
    db = SessionLocal()
    old = get_config_map(db)
    models = [
        {"id": USER_MODEL, "name": "用户模型", "user_usable": True,
         "ocr_usable": False, "chores_usable": True},
        {"id": OCR_MODEL, "name": "识别专用", "user_usable": False,
         "ocr_usable": True, "chores_usable": False},
    ]
    try:
        create_provider(db, name="OCR 测试 Provider", provider_id=TEST_PROVIDER_ID)
    except ValueError:
        pass
    set_config_values(db, {
        "models": json.dumps(models, ensure_ascii=False),
        "default_model": USER_MODEL,
        "ocr_model": OCR_MODEL,
        "ocr_max_tokens": "8192",
    })
    for model in models:
        set_providers_for_single_model(db, model["id"], [TEST_PROVIDER_ID])
    try:
        yield
    finally:
        set_config_values(db, {
            "models": old.get("models", ""),
            "default_model": old.get("default_model", ""),
            "ocr_model": old.get("ocr_model", ""),
            "ocr_max_tokens": old.get("ocr_max_tokens", ""),
        })
        for model in models:
            set_providers_for_single_model(db, model["id"], [])
        delete_provider(db, TEST_PROVIDER_ID)
        db.close()


def _make_code(*, quota=5, used=0, enabled=True):
    db = SessionLocal()
    try:
        row = UsageCode(
            code=f"NBXU-OCR-{uuid4().hex[:12].upper()}",
            quota=quota,
            used_count=used,
            is_enabled=enabled,
            note="OCR 测试",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        db.expunge(row)
        return row
    finally:
        db.close()


def _as_code(code, reason=""):
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=code, reason=reason
    )


def _as_anonymous(reason="missing"):
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=None, reason=reason
    )


def _post(client, *, tool_id=OCR_TOOL_ID, **payload):
    body = {"tool_id": tool_id}
    body.update(payload)
    return client.post("/api/chat/stream", json=body)


def _content_parts(call: dict) -> list[dict]:
    """取出本次调用里 user 消息的内容数组。"""
    messages = call["messages"]
    return messages[0]["content"]


# ---------------- 多模态与模型选择 ----------------

def test_ocr_sends_multimodal_messages_with_prompt_text(llm, loader, ocr_models):
    """图片按 image_url 逐个送入，指令在前；模型取自后台配置而非请求。"""
    _as_code(_make_code())
    client = TestClient(app)

    response = _post(
        client,
        images=[_jpeg_data_url(), _jpeg_data_url()],
        ocr_mode="printed",
        model="some/other-model",  # 必须被忽略
    )
    assert response.status_code == 200, response.text
    assert "[DONE]" in response.text

    call = llm.calls[-1]
    assert call["model"] == OCR_MODEL
    parts = _content_parts(call)
    assert parts[0] == {"type": "text", "text": PRINTED_PROMPT}
    images = [p for p in parts if p["type"] == "image_url"]
    assert len(images) == 2
    assert images[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert call["max_tokens"] == 8192


def test_ocr_handwritten_uses_essay_prompt(llm, loader, ocr_models):
    _as_code(_make_code())
    client = TestClient(app)

    response = _post(client, images=[_jpeg_data_url()], ocr_mode="handwritten")
    assert response.status_code == 200, response.text
    assert _content_parts(llm.calls[-1])[0]["text"] == HANDWRITTEN_PROMPT


def test_ocr_mode_defaults_to_printed(llm, loader, ocr_models):
    _as_code(_make_code())
    response = _post(TestClient(app), images=[_jpeg_data_url()])
    assert response.status_code == 200
    assert _content_parts(llm.calls[-1])[0]["text"] == PRINTED_PROMPT


# ---------------- 准入与限流 ----------------

def test_ocr_requires_usable_code(llm, loader, ocr_models):
    """匿名不可用：识别是付费视觉调用，不开放无码入口。"""
    _as_anonymous()
    response = _post(TestClient(app), images=[_jpeg_data_url()])
    assert response.status_code == 401
    assert "使用码" in response.json()["detail"]
    assert llm.calls == []


def test_ocr_rejects_exhausted_code(llm, loader, ocr_models):
    """额度已用尽的码不算「有效使用码」。"""
    _as_anonymous(reason="exhausted")
    response = _post(TestClient(app), images=[_jpeg_data_url()])
    assert response.status_code == 403
    assert "额度已用尽" in response.json()["detail"]
    assert llm.calls == []


def test_ocr_never_consumes_quota(llm, loader, ocr_models):
    """始终不计费：调用后 used_count 不变，使用日志 units=0。"""
    code = _make_code(quota=5, used=0)
    _as_code(code)
    response = _post(TestClient(app), images=[_jpeg_data_url()])
    assert response.status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0
        row = (
            db.query(UsageLog)
            .filter(UsageLog.code_id == code.id)
            .order_by(UsageLog.id.desc())
            .first()
        )
        assert row is not None
        assert row.units == 0
        assert row.tool_id == OCR_TOOL_ID
        assert row.tool_name == OCR_TOOL_NAME
        assert row.model == OCR_MODEL
    finally:
        db.close()


def test_ocr_rate_limited(llm, loader, ocr_models):
    """限流：同一主体 60 秒内第 11 次识别被拒。"""
    from app.services.rate_limit import RATE_LIMITS, _buckets

    _buckets.clear()
    limit = RATE_LIMITS["ocr"][0]
    _as_code(_make_code())
    client = TestClient(app)

    for _ in range(limit):
        assert _post(client, images=[_jpeg_data_url()]).status_code == 200
    blocked = _post(client, images=[_jpeg_data_url()])
    assert blocked.status_code == 429
    assert "频繁" in blocked.json()["detail"]
    _buckets.clear()


# ---------------- 参数校验 ----------------

def test_ocr_requires_images(llm, loader, ocr_models):
    _as_code(_make_code())
    response = _post(TestClient(app))
    assert response.status_code == 400
    assert "没有收到图片" in response.json()["detail"]


def test_ocr_rejects_two_sources(llm, loader, ocr_models):
    _as_code(_make_code())
    response = _post(TestClient(app), images=[_jpeg_data_url()], pair_token="whatever")
    assert response.status_code == 400
    assert "只能来自一处" in response.json()["detail"]


def test_ocr_rejects_bad_data_url(llm, loader, ocr_models):
    _as_code(_make_code())
    client = TestClient(app)

    # 外链：不能被当成远程图片交给上游
    external = _post(client, images=["https://example.com/a.jpg"])
    assert external.status_code == 400
    assert "data:image" in external.json()["detail"]

    # 非图片类型
    pdf = _post(client, images=["data:application/pdf;base64,JVBERi0xLjQK"])
    assert pdf.status_code == 400
    assert "JPG" in pdf.json()["detail"]

    # 内容与声明不符（魔数嗅探）
    fake = _post(client, images=["data:image/jpeg;base64," + base64.b64encode(b"not an image").decode()])
    assert fake.status_code == 400
    assert "不符" in fake.json()["detail"]


def test_ocr_rejects_unknown_mode_and_too_many_images(llm, loader, ocr_models):
    _as_code(_make_code())
    client = TestClient(app)

    mode = _post(client, images=[_jpeg_data_url()], ocr_mode="unknown")
    assert mode.status_code == 400
    assert "识别模式" in mode.json()["detail"]

    many = _post(client, images=[_jpeg_data_url() for _ in range(20)])
    assert many.status_code == 422  # 字段级 max_length 直接挡下


def test_non_ocr_tool_still_requires_input(llm, loader, ocr_models):
    """回归护栏：input 字段放开后，普通工具的空输入仍要报 400。"""
    _as_code(_make_code())
    response = _post(TestClient(app), tool_id="25", input="")
    assert response.status_code == 400
    assert "请输入内容" in response.json()["detail"]


# ---------------- 跟随默认模型的前提 ----------------

def test_ocr_follow_default_requires_default_capability(llm, loader, ocr_models):
    """ocr_model 留空 = 跟随默认模型，前提是默认模型勾选了「用于 OCR」；
    不满足时明确报错，而不是拿一个不认图的模型去识别。"""
    _as_code(_make_code())
    client = TestClient(app)

    db = SessionLocal()
    try:
        # 留空 + 默认模型（USER_MODEL）未勾「用于 OCR」
        set_config_values(db, {"ocr_model": "", "default_model": USER_MODEL})
    finally:
        db.close()

    blocked = _post(client, images=[_jpeg_data_url()])
    assert blocked.status_code == 400
    assert "未勾选「用于 OCR」" in blocked.json()["detail"]
    assert llm.calls == []

    # 为默认模型勾上该能力后，跟随默认即成立
    db = SessionLocal()
    try:
        set_config_values(db, {"models": json.dumps([
            {"id": USER_MODEL, "name": "用户模型", "user_usable": True,
             "ocr_usable": True, "chores_usable": True},
            {"id": OCR_MODEL, "name": "识别专用", "user_usable": False,
             "ocr_usable": True, "chores_usable": False},
        ], ensure_ascii=False)})
    finally:
        db.close()

    ok = _post(client, images=[_jpeg_data_url()])
    assert ok.status_code == 200, ok.text
    assert llm.calls[-1]["model"] == USER_MODEL


def test_ocr_explicit_model_skips_default_capability_check(llm, loader, ocr_models):
    """显式配了 ocr_model 时按它自己校验，与默认模型有没有该项能力无关。"""
    _as_code(_make_code())
    client = TestClient(app)
    response = _post(client, images=[_jpeg_data_url()])
    assert response.status_code == 200, response.text
    assert llm.calls[-1]["model"] == OCR_MODEL


# ---------------- 扫码配对来源 ----------------
def test_ocr_reads_images_from_pair_session(llm, loader, ocr_models):
    """扫码来源：手机只上传一次，OCR 请求只带 token，图片由服务器内存直读。"""
    from app.routers import ocr as ocr_router

    ocr_router._sessions.clear()
    _as_code(_make_code())
    client = TestClient(app)
    token = client.post("/api/ocr/pair").json()["token"]
    raw = b"\xff\xd8\xff\xe0" + b"\x22" * 64
    uploaded = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("page.jpg", raw, "image/jpeg")},
    )
    assert uploaded.status_code == 200

    try:
        response = _post(client, pair_token=token, ocr_mode="printed")
        assert response.status_code == 200, response.text
        images = [p for p in _content_parts(llm.calls[-1]) if p["type"] == "image_url"]
        assert len(images) == 1
        payload = images[0]["image_url"]["url"].split(",", 1)[1]
        assert base64.b64decode(payload) == raw
    finally:
        ocr_router._sessions.clear()


def test_ocr_unknown_pair_token_is_404(llm, loader, ocr_models):
    from app.routers import ocr as ocr_router

    ocr_router._sessions.clear()
    _as_code(_make_code())
    response = _post(TestClient(app), pair_token="does-not-exist")
    assert response.status_code == 404
    assert "配对" in response.json()["detail"]


def test_ocr_pair_order_controls_image_sequence(llm, loader, ocr_models):
    """扫码来源的排序/删除由电脑端决定：请求带 pair_order，服务端按它取图。"""
    from app.routers import ocr as ocr_router

    ocr_router._sessions.clear()
    _as_code(_make_code())
    client = TestClient(app)
    token = client.post("/api/ocr/pair").json()["token"]
    for index in (1, 2):
        client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": (f"{index}.jpg", b"\xff\xd8\xff\xe0" + bytes([index]) * 32, "image/jpeg")},
        )

    try:
        response = _post(client, pair_token=token, pair_order=[1], ocr_mode="printed")
        assert response.status_code == 200, response.text
        images = [p for p in _content_parts(llm.calls[-1]) if p["type"] == "image_url"]
        # 只送了第 2 张（下标 1）：删掉的那张不会进模型
        assert len(images) == 1
        assert base64.b64decode(images[0]["image_url"]["url"].split(",", 1)[1])[-1] == 2
    finally:
        ocr_router._sessions.clear()


def test_ocr_pair_order_requires_pair_source(llm, loader, ocr_models):
    _as_code(_make_code())
    response = _post(TestClient(app), images=[_jpeg_data_url()], pair_order=[0])
    assert response.status_code == 400
    assert "图片顺序" in response.json()["detail"]


# ---------------- 截断提示 ----------------

def test_ocr_warns_when_output_hits_cap(llm, loader, ocr_models):
    """输出撞到上限时多发一个 truncated 事件，不静默交付半份转录。"""
    fake = _CapturingLLM(usage={"prompt_tokens": 100, "completion_tokens": 8000, "total_tokens": 8100})
    original = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: fake
    _as_code(_make_code())
    try:
        response = _post(TestClient(app), images=[_jpeg_data_url()])
    finally:
        chat_router._build_llm = original
    assert response.status_code == 200
    assert "event: truncated" in response.text
    assert response.text.index("truncated") < response.text.index("[DONE]")
