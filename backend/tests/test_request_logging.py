"""使用日志增强（元数据 / 原始数据开关 / 保留清理）的回归测试。

覆盖：客户端信息提取、token 用量提取、日志写入与截断、保留期清理、
流式端点的端到端留痕（成功 / 异常 / 开关）、管理台日志接口。
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import deps
from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.main import app
from app.models import LogPayload, UsageCode, UsageLog
from app.routers import chat as chat_router
from app.routers import tools as tools_router
from app.routers.admin import _apply_log_filters
from app.services import llm as llm_module
from app.services.llm import LLMService, estimate_missing_usage, extract_usage
from app.services.migration import MIGRATION_TOOL_ID, MIGRATION_TOOL_NAME
from app.services.prompt_loader import PromptLoader
from app.services.request_log import (
    MAX_ERROR_CHARS,
    MAX_PAYLOAD_CHARS,
    STATUS_ERROR,
    STATUS_SUCCESS,
    current_retention_days,
    get_client_info,
    purge_expired_logs,
    record_usage_log,
)
from app.services.runtime_config import parse_log_settings, set_config_values

TEST_TOOL_ID = "25"  # 自由对话
FREE_CHAT_PROMPT = "你是助手。\n\n{{user_input}}"


def _request_stub(headers=None, host="10.1.2.3"):
    return SimpleNamespace(
        headers=dict(headers or {}),
        client=SimpleNamespace(host=host) if host is not None else None,
    )


def _make_code(db, code, *, quota=100):
    row = UsageCode(
        code=code, code_type="user", quota=quota, used_count=0, is_enabled=True, note="测试"
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.expunge(row)  # 会话关闭后仍需读取 id/code
    return row


def _logs_for(code_id):
    db = SessionLocal()
    try:
        return db.query(UsageLog).filter(UsageLog.code_id == code_id).order_by(UsageLog.id).all()
    finally:
        db.close()


def _set_payload_flag(enabled):
    db = SessionLocal()
    try:
        set_config_values(db, {"log_payload": "true" if enabled else "false"})
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _payload_disabled():
    """原始数据开关默认关闭，用例结束后复原，避免污染其它测试。"""
    _set_payload_flag(False)
    yield
    _set_payload_flag(False)


# ---------------- 客户端信息 ----------------

def test_client_info_prefers_x_real_ip():
    ip, ua = get_client_info(
        _request_stub(
            {
                "x-real-ip": "203.0.113.7",
                "x-forwarded-for": "198.51.100.1, 203.0.113.7",
                "user-agent": "pytest-agent",
            },
            host="127.0.0.1",
        )
    )
    assert ip == "203.0.113.7"
    assert ua == "pytest-agent"


def test_client_info_falls_back_to_first_xff_hop():
    ip, _ua = get_client_info(
        _request_stub({"x-forwarded-for": "198.51.100.9 , 10.0.0.1"}, host="127.0.0.1")
    )
    assert ip == "198.51.100.9"


def test_client_info_falls_back_to_direct_socket():
    ip, ua = get_client_info(_request_stub({}, host="127.0.0.1"))
    assert ip == "127.0.0.1"
    assert ua == ""


def test_client_info_truncates_and_handles_missing_request():
    ip, ua = get_client_info(_request_stub({"user-agent": "u" * 400}, host=None))
    assert ip == ""
    assert len(ua) == 255
    assert get_client_info(None) == ("", "")


# ---------------- token 用量提取 ----------------

def test_extract_usage_only_takes_numeric_fields():
    out = {}
    extract_usage(
        SimpleNamespace(prompt_tokens=11, completion_tokens=22, total_tokens=33, model="x"),
        out,
    )
    assert out == {"prompt_tokens": 11, "completion_tokens": 22, "total_tokens": 33}

    partial = {}
    extract_usage(SimpleNamespace(prompt_tokens=None, completion_tokens=5), partial)
    assert partial == {"completion_tokens": 5}
    extract_usage(None, partial)
    assert partial == {"completion_tokens": 5}


def test_stream_requests_usage_from_provider():
    service = LLMService(api_key="k", default_model="m")
    stream_kwargs = service._build_kwargs(
        None, [{"role": "user", "content": "x"}], None, None, None, True
    )
    plain_kwargs = service._build_kwargs(
        None, [{"role": "user", "content": "x"}], None, None, None, False
    )
    assert stream_kwargs["stream_options"] == {"include_usage": True}
    assert "stream_options" not in plain_kwargs


def test_chat_stream_with_stop_keeps_trailing_usage_chunk(monkeypatch):
    """litellm 的 usage 块是「空 choices + usage」的最后分块，必须提取而非丢弃。"""

    def _chunk(content=None, usage=None):
        choices = (
            [] if content is None else [SimpleNamespace(delta=SimpleNamespace(content=content))]
        )
        return SimpleNamespace(choices=choices, usage=usage)

    async def _stream():
        for text in ("你好", "世界"):
            yield _chunk(content=text)
        yield _chunk()  # 无 usage 的 keep-alive 分块
        yield _chunk(usage=SimpleNamespace(prompt_tokens=7, completion_tokens=3, total_tokens=10))

    async def fake_acompletion(**_kwargs):
        return _stream()

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)

    async def scenario():
        service = LLMService(api_key="k", default_model="m")
        usage = {}
        tokens = [
            t async for t in service.chat_stream_with_stop(user_prompt="p", usage_out=usage)
        ]
        return tokens, usage

    tokens, usage = asyncio.run(scenario())
    assert tokens == ["你好", "世界"]
    assert usage == {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}


# ---------------- 未回传 usage 时的本地估算 ----------------

ESTIMATE_MESSAGES = [
    {"role": "user", "content": "请把这段话改写成一般过去时：She goes to school by bus."},
]


def test_estimate_missing_usage_fills_only_missing_fields():
    out: dict = {}
    estimate_missing_usage(ESTIMATE_MESSAGES, "She went to school by bus.", "test-model", out)
    assert out["estimated"] is True
    assert out["prompt_tokens"] > 0
    assert out["completion_tokens"] > 0
    assert out["total_tokens"] == out["prompt_tokens"] + out["completion_tokens"]

    # 供应商部分回传：只补缺失字段，已有值原样保留
    partial = {"completion_tokens": 7}
    estimate_missing_usage(ESTIMATE_MESSAGES, "She went to school by bus.", "test-model", partial)
    assert partial["completion_tokens"] == 7
    assert partial["total_tokens"] == partial["prompt_tokens"] + 7
    assert partial["estimated"] is True

    # 三个字段齐全时不做任何事，也不打估算标记
    full = {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    estimate_missing_usage(ESTIMATE_MESSAGES, "x", "test-model", full)
    assert full == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}


def test_estimate_missing_usage_swallows_errors(monkeypatch):
    """估算只是日志的兜底，自身失败绝不能外抛影响主请求。"""

    def _boom(**_kwargs):
        raise RuntimeError("tokenizer unavailable")

    monkeypatch.setattr(llm_module.litellm, "token_counter", _boom)
    out: dict = {}
    estimate_missing_usage(ESTIMATE_MESSAGES, "ok", "m", out)
    assert out == {}


def test_chat_estimates_usage_when_provider_sends_none(monkeypatch):
    async def fake_acompletion(**_kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Hello there."))],
            usage=None,
        )

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)

    async def scenario():
        service = LLMService(api_key="k", default_model="m")
        usage: dict = {}
        await service.chat(user_prompt="说声你好", usage_out=usage)
        return usage

    usage = asyncio.run(scenario())
    assert usage["estimated"] is True
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


def test_chat_stream_estimates_when_usage_chunk_missing(monkeypatch):
    """网关全程不回传 usage 分块：按实际流出的文本估算，日志不缺数。"""

    def _chunk(content=None):
        choices = (
            [] if content is None else [SimpleNamespace(delta=SimpleNamespace(content=content))]
        )
        return SimpleNamespace(choices=choices, usage=None)

    async def _stream():
        yield _chunk("你好")
        yield _chunk("，世界")

    async def fake_acompletion(**_kwargs):
        return _stream()

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)

    async def scenario():
        service = LLMService(api_key="k", default_model="m")
        usage: dict = {}
        tokens = [
            t async for t in service.chat_stream_with_stop(user_prompt="p", usage_out=usage)
        ]
        return tokens, usage

    tokens, usage = asyncio.run(scenario())
    assert tokens == ["你好", "，世界"]
    assert usage["estimated"] is True
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


def test_chat_stream_estimates_after_mid_stream_stop(monkeypatch):
    """用户中途停止时同样收不到 usage 分块，估算覆盖到已流出部分。"""

    def _chunk(content):
        return SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content=content))], usage=None
        )

    async def _stream():
        yield _chunk("你好")
        yield _chunk("，世界")

    async def fake_acompletion(**_kwargs):
        return _stream()

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)

    async def scenario():
        service = LLMService(api_key="k", default_model="m")
        stop_event = asyncio.Event()
        usage: dict = {}
        received = []
        async for token in service.chat_stream_with_stop(
            user_prompt="p", stop_event=stop_event, usage_out=usage
        ):
            received.append(token)
            stop_event.set()  # 第一片到达后立即停止
        return received, usage

    received, usage = asyncio.run(scenario())
    assert received == ["你好"]
    assert usage["estimated"] is True
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


# ---------------- 日志写入 ----------------

def test_record_usage_log_writes_metadata_without_payload():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-OFF0-0001")
    finally:
        db.close()

    log_id = record_usage_log(
        code_id=code.id,
        code=code.code,
        tool_id="25",
        tool_name="自由对话",
        model="test/model",
        request_id="req-off",
        status=STATUS_SUCCESS,
        duration_ms=1234,
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        ip="203.0.113.1",
        user_agent="pytest",
        units=1,
        input_text="秘密输入",
        rendered_prompt="秘密 Prompt",
        output_text="秘密输出",
        log_payload=False,
    )
    assert log_id is not None

    db = SessionLocal()
    try:
        row = db.get(UsageLog, log_id)
        assert row.status == "success"
        assert row.duration_ms == 1234
        assert row.total_tokens == 15
        assert row.ip == "203.0.113.1"
        assert row.units == 1
        assert row.error_message == ""
        assert db.get(LogPayload, log_id) is None
    finally:
        db.close()


def test_record_usage_log_persists_and_clips_payload():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-ON00-0002")
    finally:
        db.close()

    long_output = "输出" * (MAX_PAYLOAD_CHARS // 2 + 10)  # 超出截断上限
    log_id = record_usage_log(
        code_id=code.id,
        code=code.code,
        tool_id="25",
        tool_name="自由对话",
        model="test/model",
        status=STATUS_ERROR,
        error_message="e" * (MAX_ERROR_CHARS + 50),
        units=0,
        input_text="用户输入",
        rendered_prompt="渲染后的 Prompt",
        output_text=long_output,
        log_payload=True,
    )

    db = SessionLocal()
    try:
        row = db.get(UsageLog, log_id)
        assert row.status == "error"
        assert len(row.error_message) == MAX_ERROR_CHARS
        payload = db.get(LogPayload, log_id)
        assert payload.input == "用户输入"
        assert payload.prompt == "渲染后的 Prompt"
        assert len(payload.output) == MAX_PAYLOAD_CHARS
    finally:
        db.close()


def test_record_usage_log_swallows_write_failures():
    """写库异常必须被吞掉：日志绝不能拖垮正在生成的主请求。"""
    assert record_usage_log(code_id=1, code="x", units="不是数字") is None


def test_record_usage_log_persists_estimated_flag():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-EST0-0010")
    finally:
        db.close()

    estimated_id = record_usage_log(
        code_id=code.id,
        code=code.code,
        model="test/model",
        usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8, "estimated": True},
    )
    exact_id = record_usage_log(
        code_id=code.id,
        code=code.code,
        model="test/model",
        usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
    )

    db = SessionLocal()
    try:
        assert db.get(UsageLog, estimated_id).tokens_estimated is True
        assert db.get(UsageLog, exact_id).tokens_estimated is False
    finally:
        db.close()


def test_parse_log_settings_accepts_common_truthy_forms():
    assert parse_log_settings({"log_payload": "TRUE", "log_retention_days": "30"}) == (True, 30)
    assert parse_log_settings({"log_payload": "on", "log_retention_days": " 0 "}) == (True, 0)
    assert parse_log_settings({"log_payload": "false", "log_retention_days": "abc"}) == (False, 0)
    assert parse_log_settings({}) == (False, 0)


# ---------------- 保留清理 ----------------

def _aged_log(db, *, code_id, code, days_ago, with_payload=False):
    log = UsageLog(
        code_id=code_id,
        code=code,
        status=STATUS_SUCCESS,
        created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )
    db.add(log)
    db.commit()
    if with_payload:
        db.add(LogPayload(log_id=log.id, input="i", prompt="p", output="o"))
        db.commit()
    return log.id


def test_purge_expired_logs_removes_old_rows_and_payloads():
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-AGE0-0003")
        old_id = _aged_log(
            db, code_id=code.id, code=code.code, days_ago=40, with_payload=True
        )
        fresh_id = _aged_log(db, code_id=code.id, code=code.code, days_ago=1, with_payload=True)

        assert purge_expired_logs(db, 30) == 1
        assert db.get(UsageLog, old_id) is None
        assert db.get(LogPayload, old_id) is None
        assert db.get(UsageLog, fresh_id) is not None
        assert db.get(LogPayload, fresh_id) is not None

        # days<=0 表示永久保留：一条都不能删
        assert purge_expired_logs(db, 0) == 0
        assert db.get(UsageLog, fresh_id) is not None
    finally:
        db.close()


def test_current_retention_days_reads_config():
    db = SessionLocal()
    try:
        set_config_values(db, {"log_retention_days": "7"})
        assert current_retention_days(db) == 7
        set_config_values(db, {"log_retention_days": "0"})
        assert current_retention_days(db) == 0
    finally:
        db.close()


# ---------------- 流式端点端到端 ----------------

class _FakeStreamLLM:
    def __init__(self, tokens, usage=None, error=None, chat_reply=None):
        self.tokens = list(tokens)
        self.usage = usage or {}
        self.error = error
        self.chat_reply = chat_reply

    async def chat_stream_with_stop(self, *, user_prompt, usage_out=None, **_kwargs):
        for token in self.tokens:
            if self.error:
                raise self.error
            yield token
        if usage_out is not None:
            usage_out.update(self.usage)

    async def chat(self, **kwargs):
        """非流式路径（标题生成 / 错因分析）。"""
        usage_out = kwargs.get("usage_out")
        if usage_out is not None:
            usage_out.update(self.usage)
        return self.chat_reply


class _StreamHarness:
    """替换 LLM 与使用码来源，让 /api/chat/stream 在测试中可预期。"""

    def __init__(self):
        self.code = None
        self.llm = None


@pytest.fixture
def stream(tmp_path):
    """返回 (client, harness)：harness.code / harness.llm 在发请求前设置。"""
    loader_dir = tmp_path / "prompts"
    loader_dir.mkdir()
    (loader_dir / "自由对话.md").write_text(FREE_CHAT_PROMPT, encoding="utf-8")
    (loader_dir / "智能错题迁移.md").write_text(FREE_CHAT_PROMPT, encoding="utf-8")
    loader = PromptLoader(loader_dir)  # 临时目录：避免 prompts_dir 相对路径依赖运行目录
    harness = _StreamHarness()

    app.dependency_overrides[deps.get_current_code] = lambda: harness.code
    app.dependency_overrides[tools_router.get_prompt_loader] = lambda: loader
    original_build_llm = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: harness.llm
    try:
        yield TestClient(app), harness
    finally:
        chat_router._build_llm = original_build_llm
        app.dependency_overrides.clear()


def _post_stream(client, tool_id=TEST_TOOL_ID, input_text="hello", **kwargs):
    payload = {"tool_id": tool_id, "input": input_text}
    return client.post(
        "/api/chat/stream",
        json=payload,
        headers={"X-Real-IP": "203.0.113.55", "User-Agent": "pytest-stream"},
        **kwargs,
    )


def test_stream_records_metadata_only_when_payload_disabled(stream):
    client, harness = stream
    harness.llm = _FakeStreamLLM(
        ["你", "好"],
        usage={"prompt_tokens": 21, "completion_tokens": 9, "total_tokens": 30},
    )
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-S001-0004")
    finally:
        db.close()
    harness.code = code

    response = _post_stream(client, input_text="学生输入")
    assert response.status_code == 200
    assert "[DONE]" in response.text
    assert json_tokens(response.text) == ["你", "好"]

    rows = _logs_for(code.id)
    assert len(rows) == 1
    data = rows[0].to_dict()
    assert data["status"] == "success"
    assert data["tool_id"] == TEST_TOOL_ID
    assert data["tool_name"] == "自由对话"
    assert data["prompt_tokens"] == 21
    assert data["completion_tokens"] == 9
    assert data["total_tokens"] == 30
    assert data["units"] == 1
    assert data["duration_ms"] >= 0
    assert data["ip"] == "203.0.113.55"  # 转发头优先于 TestClient 直连地址
    assert data["user_agent"] == "pytest-stream"

    db = SessionLocal()
    try:
        assert db.get(LogPayload, rows[0].id) is None
        assert db.get(UsageCode, code.id).used_count == 1
    finally:
        db.close()


def json_tokens(body):
    """从 SSE 文本里还原 token 事件负载（数据经 JSON 编码）。"""
    tokens = []
    block_seen = False
    for line in body.splitlines():
        if line.startswith("event:"):
            block_seen = line[6:].strip() == "token"
        elif line.startswith("data:") and block_seen:
            tokens.append(json.loads(line[5:].strip()))
    return tokens


def test_stream_records_payload_when_enabled(stream):
    client, harness = stream
    harness.llm = _FakeStreamLLM(["答案", "内容"])
    _set_payload_flag(True)
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-S002-0005")
    finally:
        db.close()
    harness.code = code

    response = _post_stream(client, input_text="把这段改成英文")
    assert response.status_code == 200

    row = _logs_for(code.id)[0]
    db = SessionLocal()
    try:
        payload = db.get(LogPayload, row.id)
        assert payload is not None
        assert payload.input == "把这段改成英文"
        assert payload.output == "答案内容"  # 分块按到达顺序累积
        assert payload.prompt == FREE_CHAT_PROMPT.replace("{{user_input}}", "把这段改成英文")
    finally:
        db.close()


def test_stream_records_error_status_without_charging(stream):
    client, harness = stream
    harness.llm = _FakeStreamLLM(["x"], error=RuntimeError("上游 500"))
    _set_payload_flag(True)
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-S003-0006")
    finally:
        db.close()
    harness.code = code

    response = _post_stream(client, input_text="boom")
    # SSE 已建连，错误以 error 事件下发而非 HTTP 状态码
    assert response.status_code == 200
    assert "生成失败" in response.text

    row = _logs_for(code.id)[0]
    assert row.status == "error"
    assert "上游 500" in row.error_message
    assert row.units == 0

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 0
    finally:
        db.close()


# ---------------- 迁移批次：每卡一条日志，整批只扣一次 ----------------

def test_migration_batch_logs_one_row_per_card(stream):
    client, harness = stream
    harness.llm = _FakeStreamLLM(["卡", "片"])
    _set_payload_flag(True)
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-M001-0009", quota=10)
    finally:
        db.close()
    harness.code = code

    batch_id = "batch-1"
    for index in (0, 1):
        response = client.post(
            "/api/chat/stream",
            json={
                "tool_id": MIGRATION_TOOL_ID,
                "input": f"第{index}题",
                "batch_id": batch_id,
                "batch_size": 2,
                "batch_index": index,
            },
        )
        assert response.status_code == 200
        assert "[DONE]" in response.text

    rows = _logs_for(code.id)
    assert len(rows) == 2  # 每张卡各留一条，不再有批次级汇总行
    assert [r.tool_id for r in rows] == [MIGRATION_TOOL_ID] * 2
    assert [r.tool_name for r in rows] == [MIGRATION_TOOL_NAME] * 2
    # 扣费集中在整批最后一卡：2 张卡 → 1 次额度
    assert [r.units for r in rows] == [0, 1]

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code.id).used_count == 1
        assert [db.get(LogPayload, r.id).input for r in rows] == ["第0题", "第1题"]
    finally:
        db.close()


# ---------------- 标题生成 ----------------

def test_title_generation_logs_without_charging(stream):
    client, harness = stream
    harness.llm = _FakeStreamLLM(
        [],
        chat_reply='"试卷分析"',
        usage={"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
    )
    _set_payload_flag(True)
    db = SessionLocal()
    try:
        code = _make_code(db, "NBXU-LOG-T001-0007")
    finally:
        db.close()
    harness.code = code

    response = client.post(
        "/api/chat/title",
        json={"tool_id": TEST_TOOL_ID, "input": "读篇短文", "output": "一篇长分析"},
        headers={"X-Real-IP": "203.0.113.66"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "试卷分析"

    row = _logs_for(code.id)[0]
    assert row.tool_id == "title"
    assert row.tool_name == "标题生成"
    assert row.status == "success"
    assert row.units == 0
    assert row.total_tokens == 5
    assert row.ip == "203.0.113.66"

    db = SessionLocal()
    try:
        payload = db.get(LogPayload, row.id)
        assert "一篇长分析" in payload.prompt
        assert payload.output == '"试卷分析"'
        assert db.get(UsageCode, code.id).used_count == 0
    finally:
        db.close()


# ---------------- 管理台接口 ----------------

@pytest.fixture
def admin_client():
    return TestClient(admin_app)


def _seed_admin_logs(suffix):
    """种一成一错两条日志（成功的带原始数据，失败的没有）。"""
    db = SessionLocal()
    try:
        code = _make_code(db, f"NBXU-LOG-A{suffix}-0008")
    finally:
        db.close()
    code_id = code.id
    ok = record_usage_log(
        code_id=code_id,
        code=code.code,
        tool_id="25",
        tool_name="自由对话",
        model="deepseek-v3",
        status=STATUS_SUCCESS,
        duration_ms=1000,
        usage={"total_tokens": 40},
        ip="192.0.2.10",
        units=1,
        input_text="原始输入",
        rendered_prompt="原始 Prompt",
        output_text="原始输出",
        log_payload=True,
    )
    bad = record_usage_log(
        code_id=code_id,
        code=code.code,
        tool_id="title",
        tool_name="标题生成",
        model="qwen-turbo",
        status=STATUS_ERROR,
        error_message="上游超时",
        duration_ms=200,
        units=0,
    )
    return code.code, ok, bad


def test_admin_logs_list_and_filters(admin_client):
    code, ok_id, bad_id = _seed_admin_logs("D001")

    listed = admin_client.get("/api/admin/logs", params={"code": code})
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 2
    assert {item["id"] for item in body["items"]} == {ok_id, bad_id}

    only_errors = admin_client.get(
        "/api/admin/logs", params={"code": code, "status": "error"}
    ).json()
    assert [item["id"] for item in only_errors["items"]] == [bad_id]

    by_tool = admin_client.get("/api/admin/logs", params={"code": code, "tool_id": "25"}).json()
    assert [item["id"] for item in by_tool["items"]] == [ok_id]

    by_model = admin_client.get(
        "/api/admin/logs", params={"code": code, "model": "deepseek"}
    ).json()
    assert [item["id"] for item in by_model["items"]] == [ok_id]

    assert admin_client.get(
        "/api/admin/logs", params={"code": code, "status": "nope"}
    ).status_code == 400
    assert admin_client.get(
        "/api/admin/logs", params={"code": code, "start": "not-a-date"}
    ).status_code == 400


def test_admin_logs_date_range_filter(admin_client):
    code, ok_id, bad_id = _seed_admin_logs("D002")
    today = datetime.now(timezone.utc)
    tomorrow = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = (today - timedelta(days=1)).strftime("%Y-%m-%d")

    future = admin_client.get(
        "/api/admin/logs", params={"code": code, "start": tomorrow}
    ).json()
    assert future["total"] == 0

    window = admin_client.get(
        "/api/admin/logs", params={"code": code, "start": yesterday, "end": tomorrow}
    ).json()
    assert {item["id"] for item in window["items"]} == {ok_id, bad_id}

    summary = admin_client.get(
        "/api/admin/logs/summary", params={"code": code, "start": today.strftime("%Y-%m-%d")}
    ).json()
    assert summary["total"] == 2


def test_admin_logs_summary(admin_client):
    code, _ok, _bad = _seed_admin_logs("D003")
    summary = admin_client.get("/api/admin/logs/summary", params={"code": code}).json()
    assert summary["total"] == 2
    assert summary["success"] == 1
    assert summary["error"] == 1
    assert summary["cancelled"] == 0
    assert summary["total_tokens"] == 40
    assert summary["avg_duration_ms"] == 600

    filtered = admin_client.get(
        "/api/admin/logs/summary", params={"code": code, "status": "success"}
    ).json()
    assert filtered["total"] == 1
    assert filtered["avg_duration_ms"] == 1000


def test_admin_log_detail_exposes_payload(admin_client):
    code, ok_id, bad_id = _seed_admin_logs("D004")

    detail = admin_client.get(f"/api/admin/logs/{ok_id}").json()
    assert detail["id"] == ok_id
    assert detail["code"] == code
    assert detail["payload"] == {
        "input": "原始输入",
        "prompt": "原始 Prompt",
        "output": "原始输出",
    }

    without = admin_client.get(f"/api/admin/logs/{bad_id}").json()
    assert without["payload"] is None
    assert without["error_message"] == "上游超时"

    assert admin_client.get("/api/admin/logs/99999999").status_code == 404


def test_admin_purge_endpoint(admin_client):
    code, ok_id, _bad = _seed_admin_logs("D005")
    db = SessionLocal()
    try:
        code_id = db.get(UsageLog, ok_id).code_id
        old_id = _aged_log(db, code_id=code_id, code=code, days_ago=90, with_payload=True)
    finally:
        db.close()

    result = admin_client.post("/api/admin/logs/purge", json={"days": 30}).json()
    assert result["days"] == 30
    assert result["deleted"] == 1

    db = SessionLocal()
    try:
        assert db.get(UsageLog, old_id) is None
        assert db.get(LogPayload, old_id) is None
        assert db.get(UsageLog, ok_id) is not None  # 今天的日志不受影响
    finally:
        db.close()

    # days=0 是永久保留，绝不能清空
    zero = admin_client.post("/api/admin/logs/purge", json={"days": 0}).json()
    assert zero["days"] == 0
    assert zero["deleted"] == 0
    db = SessionLocal()
    try:
        assert db.get(UsageLog, ok_id) is not None
        # 缺省走配置值
        set_config_values(db, {"log_retention_days": "0"})
    finally:
        db.close()
    default = admin_client.post("/api/admin/logs/purge", json={}).json()
    assert default["days"] == 0
    assert default["deleted"] == 0


def test_admin_purge_keeps_payloads_of_surviving_logs(admin_client):
    _code, ok_id, _bad = _seed_admin_logs("D006")
    admin_client.post("/api/admin/logs/purge", json={"days": 365})
    db = SessionLocal()
    try:
        assert db.get(LogPayload, ok_id) is not None
    finally:
        db.close()


def test_admin_config_roundtrips_log_settings(admin_client):
    response = admin_client.put(
        "/api/admin/config", json={"log_payload": True, "log_retention_days": 14}
    )
    assert response.status_code == 200
    assert set(response.json()["updated"]) == {"log_payload", "log_retention_days"}

    cfg = admin_client.get("/api/admin/config").json()["config"]
    assert parse_log_settings(cfg) == (True, 14)

    admin_client.put("/api/admin/config", json={"log_payload": False, "log_retention_days": 0})
    cfg = admin_client.get("/api/admin/config").json()["config"]
    assert parse_log_settings(cfg) == (False, 0)


def test_admin_config_rejects_negative_retention(admin_client):
    assert admin_client.put("/api/admin/config", json={"log_retention_days": -1}).status_code == 422
    assert admin_client.put("/api/admin/config", json={"log_retention_days": 999999}).status_code == 422


# ---------------- 旧库兼容：ALTER 补列后的 NULL 存量行 ----------------
#
# _add_missing_columns() 以「可空、无默认值」的方式加列，所以升级前写入的日志行
# 在新字段上读回是 NULL。列表筛选、聚合统计与详情展示必须给出同一个答案，
# 否则会出现「详情写着成功、筛成功却查不到」这类自相矛盾。

LEGACY_USAGE_LOGS_DDL = """
CREATE TABLE usage_logs (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL,
    code VARCHAR(32) NOT NULL,
    tool_id VARCHAR(16) NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    model VARCHAR(128) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL
)
"""


@pytest.fixture
def legacy_session(tmp_path, monkeypatch):
    """按升级前的真实表结构建库并插入一行旧日志，再跑一次真实启动顺序的 schema 演进。"""
    import app.database as database
    from app.database import Base

    engine = create_engine(
        f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    with engine.begin() as conn:
        conn.execute(text(LEGACY_USAGE_LOGS_DDL))
        conn.execute(
            text(
                "INSERT INTO usage_logs (code_id, code, tool_id, tool_name, model,"
                " request_id, created_at) VALUES (7, 'NBXU-LEGACY-0001', '1',"
                " '语篇深度分析', 'openrouter/google/gemini-2.0-flash', 'legacy-1', :now)"
            ),
            {"now": datetime.now(timezone.utc).replace(tzinfo=None).strftime(
                "%Y-%m-%d %H:%M:%S.%f"
            )},
        )

    # 与 init_db() 同序：create_all 建出 log_payloads 等新表（已存在的 usage_logs 跳过），
    # 再由 _add_missing_columns 为旧表补列 —— 存量行的新字段因此全是 NULL
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(database, "engine", engine)
    database._add_missing_columns()

    session = Session(bind=engine)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_legacy_row_reads_null_metadata(legacy_session):
    row = legacy_session.query(UsageLog).one()
    assert row.status is None and row.units is None and row.duration_ms is None

    data = row.to_dict()
    assert data["status"] == "success"  # 与筛选规则一致的收敛
    assert data["units"] is None  # 「未保存」不等于「未扣费」
    assert data["duration_ms"] is None
    assert data["total_tokens"] is None
    assert data["ip"] == ""


def test_legacy_row_matches_success_filter(legacy_session):
    def filtered(status):
        return _apply_log_filters(
            legacy_session.query(UsageLog),
            code="", tool_id="", model="", status=status, start=None, end=None,
        ).all()

    assert [r.id for r in filtered("success")] == [1]
    assert filtered("cancelled") == []
    assert filtered("error") == []
    assert len(filtered("")) == 1  # 不带筛选时同样能看到


def test_legacy_summary_adds_up_to_total(admin_client, legacy_session, monkeypatch):
    """聚合口径必须与列表一致：成功+停止+异常 == 总数，旧行不能凭空消失。"""
    from app.database import get_db

    admin_app.dependency_overrides[get_db] = lambda: legacy_session
    try:
        summary = admin_client.get("/api/admin/logs/summary").json()
        listed = admin_client.get("/api/admin/logs", params={"status": "success"}).json()
        detail = admin_client.get("/api/admin/logs/1").json()
    finally:
        admin_app.dependency_overrides.clear()

    assert summary["total"] == 1
    assert summary["success"] == 1
    assert summary["cancelled"] == 0
    assert summary["error"] == 0
    assert summary["success"] + summary["cancelled"] + summary["error"] == summary["total"]
    assert summary["total_tokens"] == 0
    assert summary["avg_duration_ms"] is None

    assert [item["id"] for item in listed["items"]] == [1]
    assert detail["status"] == "success"
    assert detail["units"] is None
    assert detail["payload"] is None


def test_legacy_purge_still_covers_old_rows(legacy_session):
    """保留清理按 created_at 判定，旧行（无 status）也必须能被正常清掉。"""
    legacy_session.query(UsageLog).update(
        {"created_at": datetime.now(timezone.utc) - timedelta(days=40)}
    )
    legacy_session.commit()
    assert purge_expired_logs(legacy_session, 30) == 1
    assert legacy_session.query(UsageLog).count() == 0
