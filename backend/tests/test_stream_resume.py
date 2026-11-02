"""生成中断后的续接：服务端缓冲、按序号补发、归属校验与续接窗口。

背景：生成本来长在 HTTP 响应里，连接一断就跟着收掉（半篇内容写成 cancelled），
客户端只能看到「生成中断」再手点「继续生成」。改动后生成活在 StreamSession 里，
连接只是它的读者：掉线后生成继续，客户端回来按 `since` 补发缺口。

这条用例守的是协议与生命周期：
1. 只补发缺口（不重复、不丢字），事件带 SSE id；
2. 空闲时发 tick 保活帧，且 tick 不算事件、不占序号；
3. 结束后缓冲保留 ttl，迟到的读者仍能拿到尾部与终止帧；
4. 归属（码 / 指纹）不对一律 404，缓冲不完整给 410；
5. 掉线后生成不立刻死：续接窗口内继续跑完，客户端回来补齐全文。
"""
from __future__ import annotations

import asyncio
import json

import pytest


# ------------------------------------------------------------------ 单元：缓冲

def _session(stop_event=None, **kwargs):
    from app.services.stream_hub import StreamSession

    return StreamSession(
        "s1", None, "fp:test", stop_event or asyncio.Event(), **kwargs
    )


def test_replay_only_sends_events_after_since():
    async def run():
        session = _session()
        session.publish("token", json.dumps("前半"))
        session.publish("token", json.dumps("后半"))
        session.publish("done", "[DONE]")
        session.finish()
        got = [item async for item in session.stream_from(1)]
        # 第一条是 attach 时给的 resume 元信息，之后才是缺口
        assert got[0]["event"] == "resume"
        replay = [item for item in got if item["event"] != "resume"]
        assert [item["event"] for item in replay] == ["token", "done"]
        assert [item["id"] for item in replay] == ["2", "3"]
        assert json.loads(replay[0]["data"]) == "后半"
        assert session.last_seq == 3

    asyncio.run(run())


def test_tick_keeps_connection_alive_without_consuming_seq():
    async def run():
        session = _session(tick_interval=0.01)
        ticks = []
        agen = session.stream_from(0)
        assert (await agen.__anext__())["event"] == "resume"
        for _ in range(2):
            item = await agen.__anext__()
            assert item["event"] == "tick"
            ticks.append(item)
        await agen.aclose()
        # tick 没有 id：它不属于事件序列，重放时也不该出现
        assert all("id" not in item for item in ticks)
        assert session.last_seq == 0

    asyncio.run(run())


def test_finished_session_serves_tail_then_ends():
    async def run():
        session = _session(ttl=60)
        agen = session.stream_from(0)
        assert (await agen.__anext__())["event"] == "resume"
        session.publish("token", json.dumps("a"))
        session.publish("done", "[DONE]")
        session.finish()
        rest = [item async for item in agen]
        assert [item["event"] for item in rest] == ["token", "done"]

    asyncio.run(run())


def test_resume_rejected_when_buffer_incomplete():
    from app.services.stream_hub import ResumeUnavailable

    async def run():
        session = _session()
        session.publish("token", json.dumps("a"))
        session._resumable = False  # 模拟缓冲溢出
        assert session.can_resume_from(0) is False
        with pytest.raises(ResumeUnavailable):
            [item async for item in session.stream_from(0)]
        # 已经跟到队尾的读者仍可以接着看，只是补不了历史
        assert session.can_resume_from(session.last_seq) is True

    asyncio.run(run())


def test_missing_terminal_event_is_filled():
    async def run():
        session = _session()
        session.publish("token", json.dumps("a"))
        session.finish()
        session.publish("token", json.dumps("late"))  # finish 之后的写入应被忽略
        got = [item async for item in session.stream_from(0)]
        assert [item["event"] for item in got if item["event"] != "resume"] == [
            "token",
            "done",
        ]
        assert got[-1]["data"] == "[CANCELLED]"
        assert got[-1]["id"] == "2"

    asyncio.run(run())


def test_attach_starts_pump_and_detach_after_grace_stops_it():
    async def run():
        stop_event = asyncio.Event()
        session = _session(stop_event=stop_event, grace=0.05, max_buffer_bytes=64 * 1024)
        started = asyncio.Event()

        async def source():
            started.set()
            yield {"event": "token", "data": json.dumps("a")}
            await asyncio.Event().wait()  # 一直写，直到被停
            yield {"event": "token", "data": json.dumps("b")}

        session.bind_source(source())
        agen = session.stream_from(0)
        await agen.__anext__()  # resume 元信息
        await asyncio.wait_for(started.wait(), 1)
        assert session.started

        # 读者离开：窗口内先不停
        await agen.aclose()
        assert session.subscribers == 0
        await asyncio.sleep(0.01)
        assert not stop_event.is_set()
        # 窗口过完没人回来才停
        await _until(stop_event.is_set, timeout=2)
        assert stop_event.is_set()

    asyncio.run(run())


async def _until(predicate, timeout=1.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("等待条件超时")
        await asyncio.sleep(0.01)


# ------------------------------------------------------------------ 端点

def _code_context(code_id=990_124, value="NBXU-RESUME-E2E"):
    from app import deps
    from app.models import UsageCode

    return deps.CodeContext(
        code=UsageCode(
            id=code_id, code=value, quota=100, used_count=0, is_enabled=True
        ),
        reason="",
    )


def _scope(method, path, query=b"", body=None):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query,
        "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1234),
        "server": ("test", 80),
    }
    if body is not None:
        scope["_body"] = body
    return scope


async def _call(scope, body=b"", on_body=None):
    """把一次 ASGI 调用整段收下来，返回 (状态码, 文本)。on_body(chunk) 可中断。"""
    from app.main import app

    sent_body = []
    status = {"code": 0}
    first = {"done": False}

    async def receive():
        if not first["done"]:
            first["done"] = True
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        if message["type"] == "http.response.start":
            status["code"] = message["status"]
        elif message["type"] == "http.response.body":
            chunk = message.get("body", b"")
            sent_body.append(chunk)
            if on_body is not None:
                await on_body(chunk)

    await asyncio.wait_for(app(scope, receive, send), 10)
    return status["code"], b"".join(sent_body).decode("utf-8")


def _install(monkeypatch, llm_factory):
    """替换路由的 LLM 与认证；返回 app。"""
    from app import deps
    from app.main import app
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "_build_llm", lambda *a, **k: llm_factory())
    app.dependency_overrides[deps.get_code_context] = lambda: _code_context()
    return app


def _reset(app):
    from app.services import stream_hub

    app.dependency_overrides.clear()
    stream_hub.reset_for_tests()


def test_resume_endpoint_replays_and_rejects_foreign_owner(monkeypatch):
    from app.services import stream_hub

    class NoLLM:
        def chat_stream_with_stop(self, **_kwargs):
            raise AssertionError("续接不应发起新的生成")

    app = _install(monkeypatch, NoLLM)

    async def run():
        session = stream_hub.open_session(
            "resume-endpoint", "code:990124:NBXU-RESUME-E2E", "ip:127.0.0.1",
            asyncio.Event(), ttl=60,
        )
        session.publish("token", json.dumps("前半"))
        session.publish("todo", "x")
        session.finish()

        status, text = await _call(_scope("GET", "/api/chat/stream/resume-endpoint", b"since=1"))
        assert status == 200
        # since=1：第 1 个事件（前半）不再补发，只补后面的缺口与终止帧
        assert json.dumps("前半") not in text
        assert "event: todo" in text and "id: 2" in text
        assert "event: done" in text

        # 换一把码来续接：404，且不泄露内容
        from app import deps
        from app.models import UsageCode

        app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
            code=UsageCode(id=991_999, code="NBXU-OTHER", quota=100, used_count=0,
                           is_enabled=True),
            reason="",
        )
        status, text = await _call(
            _scope("GET", "/api/chat/stream/resume-endpoint", b"since=0")
        )
        assert status == 404 and "前半" not in text

    try:
        asyncio.run(run())
    finally:
        _reset(app)


def test_disconnect_keeps_generation_and_resume_fills_the_gap(monkeypatch):
    """真实链路：POST 吐到一半被掐断，GET 续接把缺口补齐（含终止帧）。"""
    from app.services import stream_hub

    gate = asyncio.Event()
    produced = []

    async def source(_kwargs):
        yield "第一段"
        produced.append("第一段")
        await gate.wait()
        yield "第二段"
        produced.append("第二段")

    class FakeLLM:
        def chat_stream_with_stop(self, **kwargs):
            return source(kwargs)

    app = _install(monkeypatch, FakeLLM)
    request_id = "resume-e2e"
    body = json.dumps({"tool_id": "1", "input": "材料", "request_id": request_id}).encode()

    async def run():
        disconnect = asyncio.Event()
        first_token = asyncio.Event()

        async def on_body(chunk):
            if json.dumps("第一段", ensure_ascii=False).encode() in chunk:
                first_token.set()
                disconnect.set()
                await asyncio.Event().wait()  # 发送处被取消，模拟客户端拔线

        async def receive():
            if not getattr(receive, "sent", False):
                receive.sent = True  # type: ignore[attr-defined]
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] != "http.response.body":
                return
            await on_body(message.get("body", b""))

        scope = _scope("POST", "/api/chat/stream")
        await asyncio.wait_for(app(scope, receive, send), 5)
        # 连接断了，但生成没有跟着死：它还在等 gate
        await asyncio.sleep(0.05)
        assert produced == ["第一段"]

        # 客户端随后回来：先让上游把剩下的写完
        gate.set()
        await _until(
            lambda: stream_hub.get_session(request_id) is not None
            and stream_hub.get_session(request_id).done,
            timeout=5,
        )

        status, text = await _call(
            _scope("GET", f"/api/chat/stream/{request_id}", b"since=1")
        )
        assert status == 200
        assert json.dumps("第二段", ensure_ascii=False) in text
        assert "event: done" in text and "[DONE]" in text
        assert json.dumps("第一段", ensure_ascii=False) not in text

    try:
        asyncio.run(run())
    finally:
        gate.set()
        _reset(app)


def test_duplicate_post_attaches_instead_of_starting_a_second_generation(monkeypatch):
    """首连就断：客户端带同一个 request_id 重发 POST，应接回在途生成。

    否则一次网络抖动会变成两次模型调用、两次计费，用户还可能看到两份内容。
    """
    from app.services import stream_hub

    gate = asyncio.Event()
    produced = []

    async def source(_kwargs):
        yield "第一段"
        produced.append("第一段")
        await gate.wait()
        yield "第二段"
        produced.append("第二段")

    class FakeLLM:
        def chat_stream_with_stop(self, **kwargs):
            return source(kwargs)

    app = _install(monkeypatch, FakeLLM)
    request_id = "resume-duplicate-post"
    body = json.dumps({"tool_id": "1", "input": "材料", "request_id": request_id}).encode()

    async def run():
        disconnect = asyncio.Event()

        async def on_body(chunk):
            if json.dumps("第一段", ensure_ascii=False).encode() in chunk:
                disconnect.set()
                await asyncio.Event().wait()  # 首连在拿到响应头后被掐断

        async def receive():
            if not getattr(receive, "sent", False):
                receive.sent = True  # type: ignore[attr-defined]
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body":
                await on_body(message.get("body", b""))

        await asyncio.wait_for(app(_scope("POST", "/api/chat/stream"), receive, send), 5)
        await asyncio.sleep(0.05)
        assert produced == ["第一段"]

        # 重发同一个请求：不能重新开一轮生成
        async def on_body2(chunk):
            if json.dumps("第一段", ensure_ascii=False).encode() in chunk:
                gate.set()

        async def receive2():
            if not getattr(receive2, "sent", False):
                receive2.sent = True  # type: ignore[attr-defined]
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()

        async def send2(message):
            if message["type"] == "http.response.body":
                await on_body2(message.get("body", b""))

        scope = _scope("POST", "/api/chat/stream")
        await asyncio.wait_for(app(scope, receive2, send2), 5)
        assert produced == ["第一段", "第二段"], "应以同一条生成补齐，而不是重跑一次"

    try:
        asyncio.run(run())
    finally:
        gate.set()
        _reset(app)
