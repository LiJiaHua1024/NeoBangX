"""假后端的契约自测。

这些测试守护三件事：
1. **防漂移**——假后端的工具目录与响应键集必须和真实后端逐字段一致；
2. **SSE 帧契约**——帧格式必须能被前端 script.js 的解析器正确消费；
3. **场景语义**——每个场景真的产生它承诺的那件事（含断流、停止、fallback）。

运行：``cd backend && uv run pytest tests/test_mock_backend.py -q``
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from collections import Counter

import httpx
import pytest
from httpx import ASGITransport

from mock_backend import catalog, main as mock_main, paper as paper_mod
from mock_backend.state import STATE


@pytest.fixture(autouse=True)
def _clean_state():
    STATE.reset()
    STATE.clear_sticky()
    STATE.quota = None
    mock_main.DEFAULT_SCENARIO = "happy"
    mock_main.DEFAULT_PDF_MODE = "ok"
    yield
    STATE.reset()
    STATE.clear_sticky()


@pytest.fixture()
def client():
    app = mock_main.create_app(static_dir=mock_main.DEFAULT_STATIC_DIR)
    transport = ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://mock")


# ---------------------------------------------------------------- 防漂移


def test_tool_catalog_matches_real_backend():
    """工具目录必须与 app/routers/tools.py 逐字段一致。"""
    from app.routers.tools import (
        EXCLUSIVE_TOOLS,
        PROPOSITION_TOOLS,
        REFERENCE_TOOLS,
        TEACHING_TOOLS,
    )
    from app.services.migration import MIGRATION_TOOL_NAME

    real_groups = [
        ("exclusive", EXCLUSIVE_TOOLS),
        ("teaching", TEACHING_TOOLS),
        ("proposition", PROPOSITION_TOOLS),
        ("reference", REFERENCE_TOOLS),
    ]
    mock_groups = {g["id"]: g for g in catalog.TOOL_GROUPS}
    assert set(mock_groups) == {gid for gid, _ in real_groups}

    for gid, real_tools in real_groups:
        mock_tools = mock_groups[gid]["tools"]
        assert len(mock_tools) == len(real_tools), f"{gid} 工具数量不一致"
        for real, mock in zip(real_tools, mock_tools):
            for key in ("id", "name", "icon", "description"):
                assert mock[key] == real[key], f"{gid}/{real.get('id')} 的 {key} 不一致"

    # 迁移工具名单独校验（它是从 app.services.migration 引来的常量）
    assert mock_groups["exclusive"]["tools"][0]["name"] == MIGRATION_TOOL_NAME
    # prompt_filename 必须能在 prompts/ 下找到对应文件
    prompts_dir = mock_main.REPO_ROOT / "prompts"
    for group in catalog.TOOL_GROUPS:
        for tool in group["tools"]:
            assert (prompts_dir / tool["prompt_filename"]).exists(), tool["prompt_filename"]


def test_tools_endpoint_keys_match_real_shape(client):
    async def run():
        payload = catalog.tools_payload()
        assert set(payload) == {"groups", "models", "default_model", "max_visible_models"}
        for group in payload["groups"]:
            assert set(group) == {"id", "title", "collapsed", "tools"}
            for tool in group["tools"]:
                assert set(tool) == {
                    "id", "name", "icon", "description", "prompt_filename", "prompt_loaded",
                }
        for model in payload["models"]:
            assert set(model) == {"id", "name", "description", "score", "is_free", "free_no_code"}
        # /api/tools/models 用的是 label 而不是 name
        slim = catalog.models_payload()
        assert set(slim) == {"models", "default_model"}
        assert set(slim["models"][0]) == {"id", "label", "description", "score", "is_free", "free_no_code"}

    asyncio.run(run())


def test_config_endpoint_shape(client):
    async def run():
        r = await client.get("/api/config")
        assert r.status_code == 200
        data = r.json()
        assert set(data) == {
            "models", "default_model", "app_name", "version", "slogan", "auth_required", "mirror",
        }
        assert set(data["mirror"]) == {"enabled", "origins"}
        assert data["mirror"] == {"enabled": False, "origins": []}

    asyncio.run(run())


# ---------------------------------------------------------------- SSE 帧契约


def _parse_sse(raw: str):
    """按 frontend/script.js `_streamChat` 的同款算法解析帧。

    返回 (事件列表, 是否收到终止事件)。终止事件缺失时调用方必须按中断处理。
    """
    events: list[tuple[str, str]] = []
    saw_terminal = False
    buffer = ""
    event_name, event_data = "message", ""
    for line in raw.split("\n"):
        buffer = line
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            value = line[5:]
            if value.startswith(" "):
                value = value[1:]
            event_data = event_data + "\n" + value if event_data else value
        elif line == "":
            if event_data != "" or event_name != "message":
                if event_name == "done" or event_data in ("[DONE]", "[CANCELLED]"):
                    saw_terminal = True
                events.append((event_name, event_data))
            event_name, event_data = "message", ""
    if event_data != "" or event_name != "message":
        if event_name == "done" or event_data in ("[DONE]", "[CANCELLED]"):
            saw_terminal = True
        events.append((event_name, event_data))
    return events, saw_terminal


def _token_count(raw: str) -> int:
    return sum(1 for line in raw.split("\n") if line.startswith("event: token"))


def _stream(client, tool_id, text, *, headers=None, **extra):
    body = {"tool_id": tool_id, "input": text, "model": "mock/mock-flash", "request_id": "t"}
    body.update(extra)
    return client.post("/api/chat/stream", json=body, headers=headers or {})


def test_token_frames_are_json_encoded_strings(client):
    """token 的 data 必须是 JSON 编码字符串：换行/引号才能无损过 SSE 分行。"""
    async def run():
        r = await _stream(client, "1", "#mock fast\n城市绿廊")
        assert r.status_code == 200
        events, saw_terminal = _parse_sse(r.text)
        assert saw_terminal, "流必须以 done 帧收尾"
        tokens = [data for event, data in events if event == "token"]
        assert tokens, "至少应有一个 token 帧"
        for data in tokens:
            assert "\n" not in data, "token 的 data 必须是单行"
            assert isinstance(json.loads(data), str), "token 的 data 必须是 JSON 字符串"
        assert events[-1] == ("done", "[DONE]")

    asyncio.run(run())


def test_reasoning_frame_carries_t_and_n(client):
    async def run():
        r = await _stream(client, "1", "#mock happy\n城市绿廊")
        events, _ = _parse_sse(r.text)
        reasoning = [data for event, data in events if event == "reasoning"]
        assert reasoning, "happy 场景应带推理片段"
        for data in reasoning:
            payload = json.loads(data)
            assert isinstance(payload["t"], str) and payload["t"]
            assert isinstance(payload["n"], int) and payload["n"] > 0

    asyncio.run(run())


def test_mid_truncate_has_no_terminal_frame(client):
    """断流场景：前端必须判「生成中断，内容可能不完整」。"""
    async def run():
        r = await _stream(client, "1", "#mock mid-truncate at=20")
        assert r.status_code == 200
        events, saw_terminal = _parse_sse(r.text)
        assert not saw_terminal, "断流场景不允许出现终止帧"
        assert sum(1 for event, _ in events if event == "token") == 20

    asyncio.run(run())


def test_mid_error_frame_carries_message_and_model(client):
    async def run():
        r = await _stream(client, "1", "#mock mid-error at=20")
        events, _ = _parse_sse(r.text)
        errors = [data for event, data in events if event == "error"]
        assert len(errors) == 1
        payload = json.loads(errors[0])
        assert payload["message"] and payload["model"] == "mock/mock-flash"

    asyncio.run(run())


def test_fallback_frame_carries_progress(client):
    async def run():
        r = await _stream(client, "1", "#mock fallback")
        events, _ = _parse_sse(r.text)
        fallbacks = [json.loads(d) for event, d in events if event == "fallback"]
        assert len(fallbacks) == 1
        assert set(fallbacks[0]) == {"failed_index", "total", "next_index", "reason"}
        assert fallbacks[0]["failed_index"] == 1

    asyncio.run(run())


def test_stop_ends_stream_with_cancelled(client):
    """POST /api/chat/stop 必须让流以 [CANCELLED] 收尾。"""
    async def run():
        request_id = "stop-test-1"
        body = {"tool_id": "1", "input": "#mock slow\n停止测试",
                "model": "mock/mock-flash", "request_id": request_id}
        task = asyncio.create_task(client.post("/api/chat/stream", json=body))
        await asyncio.sleep(0.4)
        r = await client.post("/api/chat/stop", json={"request_id": request_id})
        assert r.json()["status"] == "stopped"
        response = await task
        events, saw_terminal = _parse_sse(response.text)
        assert saw_terminal
        assert events[-1] == ("done", "[CANCELLED]")

    asyncio.run(run())


def test_unknown_stop_returns_not_found(client):
    async def run():
        r = await client.post("/api/chat/stop", json={"request_id": "nope"})
        assert r.json()["status"] == "not_found"

    asyncio.run(run())


def test_http_error_scenarios_short_circuit(client):
    async def run():
        for scenario, status in [
            ("http-401", 401), ("http-403", 403), ("http-403-quota", 403),
            ("http-429", 429), ("http-500", 500), ("bad-model", 400),
        ]:
            r = await _stream(client, "1", f"#mock {scenario}")
            assert r.status_code == status, scenario
        # 结构化 403 必须带 required/remaining，前端据此区分额度不足与登录失效
        r = await _stream(client, "1", "#mock http-403-quota")
        assert set(r.json()["detail"]) >= {"message", "required", "remaining"}

    asyncio.run(run())


# ---------------------------------------------------------------- 场景优先级


def test_scenario_priority(client):
    """指令 > 请求头 > 查询串 > 粘性 > 模型 > 默认。"""
    async def run():
        # 默认
        r = await _stream(client, "1", "普通输入")
        happy_tokens = _token_count(r.text)
        assert happy_tokens > 100

        # 模型名映射：mock/mock-slow → slow（正文被 max_chars 截短，token 明显更少）
        r = await _stream(client, "1", "普通输入", model="mock/mock-slow")
        slow_tokens = _token_count(r.text)
        assert 0 < slow_tokens < happy_tokens

        # 请求头覆盖模型
        r = await _stream(client, "1", "普通输入", model="mock/mock-slow",
                          headers={"X-Mock-Scenario": "fast"})
        assert _token_count(r.text) > slow_tokens

        # 魔术指令覆盖请求头
        r = await _stream(client, "1", "#mock empty", model="mock/mock-slow",
                          headers={"X-Mock-Scenario": "fast"})
        assert _token_count(r.text) == 0

        # 粘性场景只生效一次
        await client.post("/__mock__/scenario", json={"scenario": "empty", "times": 1})
        r = await _stream(client, "1", "第一次")
        assert _token_count(r.text) == 0
        r = await _stream(client, "1", "第二次")
        assert _token_count(r.text) == happy_tokens

    asyncio.run(run())


def test_directive_json_form(client):
    async def run():
        r = await _stream(client, "1", '#mock {"scenario":"mid-error","at":3}')
        events, _ = _parse_sse(r.text)
        assert sum(1 for event, _ in events if event == "token") == 3
        assert any(event == "error" for event, _ in events)

    asyncio.run(run())


def test_unknown_scenario_is_ignored_with_warning(client):
    async def run():
        r = await _stream(client, "1", "#mock 不存在的场景")
        assert r.status_code == 200
        events, saw_terminal = _parse_sse(r.text)
        assert saw_terminal

    asyncio.run(run())


# ---------------------------------------------------------------- 试卷


def test_paper_fixtures_pass_real_validator():
    from mock_backend.scenarios import StreamPlan

    for name, plan in [
        ("full", StreamPlan(content="paper", paper_questions=5)),
        ("partial", StreamPlan(content="paper", paper_questions=5, paper_done=3)),
        ("truncate", StreamPlan(content="paper", paper_questions=5, paper_done=1, fault="truncate")),
        ("eight", StreamPlan(content="paper", paper_questions=8)),
    ]:
        text = paper_mod.build_paper(plan, {}, "")
        ok, errors = paper_mod.validate(text)
        assert ok, f"{name} 不是合法试卷：{errors[:3]}"


def test_paper_partial_keeps_declared_total():
    """partial 场景：只发 3 题，但 @@TOTAL@@ 仍是 5，前端进度条才会停在 3/5。"""
    from app.services.visual_paper import parse_custom_visual_paper

    from mock_backend.scenarios import StreamPlan

    text = paper_mod.build_paper(StreamPlan(content="paper", paper_questions=5, paper_done=3), {}, "")
    data = parse_custom_visual_paper(text)
    assert data["total"] == 5
    assert sum(len(g["questions"]) for g in data["groups"]) == 3


def test_paper_resume_continues_from_brief():
    """按【续写指令】简报续写：拼回原文后仍是合法整卷，且题号连续。"""
    from app.services.visual_paper import parse_custom_visual_paper

    from mock_backend.scenarios import StreamPlan

    first = paper_mod.build_paper(StreamPlan(content="paper", paper_questions=5, paper_done=3), {}, "")
    brief = (
        "【续写指令】你的输出会被原样追加在前面已生成内容的后面，接着往下写。\n"
        "进度：全卷 5 题，已完成 3 题（题号 1,2,3），最后一题是第 3 题，属于板块 `cloze7|七选五`。\n"
        "接着第 3 题之后的题继续写，直到写完剩余 2 题。\n"
        "板块写法：接下来的题若仍属于 `cloze7|七选五`，直接输出 `@@Q@@` 行；只有跨进新板块时，"
        "才输出新的 `@@GROUP@@ id|title|intro` 行。\n"
        "语篇写法：已用编号 P1（阅读理解 A 篇）、P2（七选五），这些语篇一律写 `@@PASSAGE_REF@@ 编号`、"
        "不要重复正文；只有遇到新语篇时，才在它首次出现处输出一次 `@@PASSAGE_DEF@@ 新编号` 加全文。\n"
        "每道笔试题仍输出 2 块迁移（写作题除外）。"
    )
    parsed = paper_mod.parse_continue_brief("试卷原文\n\n" + brief)
    assert parsed and parsed["total"] == 5 and parsed["last_no"] == "3"

    continuation = paper_mod.build_resume(parsed)
    assert "@@PASSAGE_DEF@@" not in continuation, "已声明过的语篇不能再写一遍全文"
    assert "@@TOTAL@@" not in continuation, "续写片段不该重复声明总数"

    merged = first + continuation
    ok, errors = paper_mod.validate(merged)
    assert ok, f"续写拼接后不合法：{errors[:3]}"
    data = parse_custom_visual_paper(merged)
    numbers = [q["no"] for g in data["groups"] for q in g["questions"]]
    assert numbers == ["1", "2", "3", "4", "5"]


def test_paper_stream_round_trips_through_frontend_parser(client):
    """试卷流经 SSE 分行后必须能原样还原（换行/中文都不能丢）。"""
    from app.services.visual_paper import parse_custom_visual_paper

    async def run():
        r = await _stream(client, "13", "#mock paper", transfer_count=2)
        assert r.status_code == 200
        events, saw_terminal = _parse_sse(r.text)
        assert saw_terminal
        body = "".join(json.loads(d) for event, d in events if event == "token")
        data = parse_custom_visual_paper(body)
        assert data is not None, "试卷流经 SSE 后应仍可解析"
        assert data["total"] == 5
        assert sum(len(g["questions"]) for g in data["groups"]) == 5

    asyncio.run(run())


# ---------------------------------------------------------------- 门禁与端点


def test_auth_gate(client):
    async def run():
        # 付费模型无 token → 401
        r = await _stream(client, "1", "x", model="mock/mock-pro")
        assert r.status_code == 401

        # 免费模型无 token → 放行
        r = await _stream(client, "1", "#mock fast", model="mock/mock-flash")
        assert r.status_code == 200

        # 带 token → 放行
        token = (await client.post("/api/auth/activate", json={"code": "TEST-CODE"})).json()["token"]
        r = await _stream(client, "1", "#mock fast", model="mock/mock-pro",
                          headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200

        # /api/auth/me 无 token → 401
        r = await client.get("/api/auth/me")
        assert r.status_code == 401
        r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.json()["user"]["is_unlimited"] is True

    asyncio.run(run())


def test_quota_gate(client):
    async def run():
        token = (await client.post("/api/auth/activate", json={"code": "Q-CODE"})).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        STATE.quota = 2

        # 付费模型每次消耗 1 次，第三次应被 403 拦住
        for _ in range(2):
            r = await _stream(client, "1", "#mock fast", model="mock/mock-pro", headers=headers)
            assert r.status_code == 200
        r = await _stream(client, "1", "x", model="mock/mock-pro", headers=headers)
        assert r.status_code == 403

        # 免费模型不扣次数，额度耗尽后仍可用（与真实后端语义一致）
        STATE.quota, STATE.used = 0, 0
        r = await _stream(client, "1", "#mock fast", model="mock/mock-flash", headers=headers)
        assert r.status_code == 200

    asyncio.run(run())


def test_migration_requires_batch_fields(client):
    async def run():
        r = await _stream(client, "26", "题干")
        assert r.status_code == 400
        r = await _stream(client, "26", "题干", batch_id="b1", batch_size=2, batch_index=0)
        assert r.status_code == 200

    asyncio.run(run())


def test_unknown_tool_returns_404(client):
    async def run():
        r = await _stream(client, "999", "x")
        assert r.status_code == 404

    asyncio.run(run())


def test_vocab_check_uses_real_wordlist(client):
    async def run():
        r = await client.post("/api/chat/vocab/check",
                              json={"text": "The detrimental and ubiquitous stuff was incredibly awesome."})
        assert r.status_code == 200
        data = r.json()
        assert data["total_words"] > 0
        flagged = {w["word"] for w in data["over_words"]}
        assert {"detrimental", "ubiquitous", "incredibly", "stuff"} <= flagged

    asyncio.run(run())


def test_migration_analyze_returns_causes(client):
    async def run():
        r = await client.post("/api/chat/migration/analyze", json={"question": "题干"})
        assert r.status_code == 200
        data = r.json()
        assert len(data["causes"]) == 3
        assert data["causes"][0]["id"] == "cause_0"
        assert data["analysis_history"][-1]["role"] == "assistant"

    asyncio.run(run())


def test_pdf_branches(client):
    async def run():
        def upload(name, headers=None):
            return client.post(
                "/api/parse/file",
                files={"file": (name, b"%PDF-1.4 fake", "application/pdf")},
                headers=headers or {},
            )

        r = await upload("exam.pdf")
        assert r.status_code == 200
        assert r.json()["chars"] > 1000

        for name, status, kind in [
            ("scanned.pdf", 409, "scanned_suspected"),
            ("large.pdf", 413, "too_large"),
            ("corrupt.pdf", 422, "corrupt"),
        ]:
            r = await upload(name)
            assert r.status_code == status, name
            assert r.json()["detail"]["kind"] == kind

        r = await upload("exam.pdf", headers={"X-Mock-Scenario": "pdf-no-token"})
        assert r.status_code == 503

    asyncio.run(run())


def test_control_endpoints(client):
    async def run():
        state = (await client.get("/__mock__/state")).json()
        assert state["default_scenario"] == "happy"
        assert state["upstream_enabled"] is True

        scenarios = (await client.get("/__mock__/scenarios")).json()["scenarios"]
        assert len(scenarios) > 30

        r = await client.post("/__mock__/scenario", json={"scenario": "mid-error", "times": 1})
        assert r.json()["ok"] is True
        state = (await client.get("/__mock__/state")).json()
        assert state["sticky"]["scenario"] == "mid-error"

        await client.post("/api/chat/stream", json={"tool_id": "1", "input": "x", "model": "mock/mock-flash"})
        requests = (await client.get("/__mock__/requests")).json()["requests"]
        assert requests and requests[-1]["path"] == "/api/chat/stream"
        assert requests[-1]["body"]["tool_id"] == "1"

        await client.delete("/__mock__/requests")
        assert (await client.get("/__mock__/requests")).json()["requests"] == []
        await client.delete("/__mock__/scenario")
        assert (await client.get("/__mock__/state")).json()["sticky"] is None

        page = await client.get("/__mock__/")
        assert page.status_code == 200
        assert "假后端" in page.text

    asyncio.run(run())


# ---------------------------------------------------------------- 假上游


def test_upstream_openai_shape(client):
    async def run():
        r = await client.post("/v1/happy/chat/completions",
                              json={"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]})
        assert r.status_code == 200
        data = r.json()
        assert data["object"] == "chat.completion"
        assert data["choices"][0]["message"]["content"]
        assert data["usage"]["total_tokens"] > 0

        r = await client.post("/v1/happy/chat/completions",
                              json={"model": "m", "messages": [], "stream": True})
        lines = [l for l in r.text.split("\n") if l.startswith("data:")]
        assert lines[-1].strip() == "data: [DONE]"
        chunks = [json.loads(l[5:].strip()) for l in lines[:-1]]
        assert all(c["object"] == "chat.completion.chunk" for c in chunks)
        assert chunks[0]["choices"][0]["delta"].get("role") == "assistant"
        assert chunks[-1]["choices"][0]["finish_reason"] == "stop"
        assert chunks[-1]["usage"]["total_tokens"] > 0

        r = await client.post("/v1/error/chat/completions", json={"model": "m", "messages": []})
        assert r.status_code == 500

        models = (await client.get("/v1/models")).json()["data"]
        assert {m["id"] for m in models} >= {"happy", "slow", "timeout", "error", "empty", "mid-error"}

    asyncio.run(run())


def test_upstream_reasoning_scenario_emits_reasoning_content(client):
    async def run():
        r = await client.post("/v1/reasoning/chat/completions",
                              json={"model": "m", "messages": [], "stream": True})
        assert "reasoning_content" in r.text

    asyncio.run(run())


def test_real_backend_can_use_mock_upstream():
    """端到端：真实后端把 provider 指向假上游，litellm 能正常拿到内容。"""
    import uvicorn

    from mock_backend.main import create_app

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    app = create_app(static_dir=mock_main.DEFAULT_STATIC_DIR)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.05)
        assert server.started, "假上游未能在 5 秒内启动"

        import litellm

        litellm.drop_params = True
        response = asyncio.run(litellm.acompletion(
            model="openai/gpt-4o-mini",
            api_base=f"http://127.0.0.1:{port}/v1/happy",
            api_key="fake",
            messages=[{"role": "user", "content": "城市绿廊"}],
        ))
        assert response.choices[0].message.content
    finally:
        server.should_exit = True
        thread.join(timeout=10)
