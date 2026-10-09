import asyncio
import json
import re
from contextlib import aclosing
from pathlib import Path

import pytest

from app.services.prompt_loader import PromptLoader
from app.services.visual_paper import parse_custom_visual_paper
from app.services.visual_paper_parallel import (
    PARALLELISM, QuestionBlocks, plan_explanations, question_complete, question_missing, stream_explanations,
)

LOADER = PromptLoader(Path(__file__).resolve().parents[2] / "prompts")


def skeleton(count=8):
    return (f"@@TOTAL@@ {count}\n@@PAPER@@ Test\n@@GROUP@@ grammar|Grammar|\n"
            "@@PASSAGE_DEF@@ P1\nFull shared passage.\n" + "".join(
                f"@@Q@@ {n}\n@@PASSAGE_REF@@ P1\n@@STEM@@\nBlank {n}\n@@END_Q@@\n"
                for n in range(1, count + 1)) + "@@KEY@@\nTeacher supplied key.\n")


def analysis(no):
    return (f"@@Q@@ {no}\n@@QTYPE@@ blank\n@@ANSWER@@ is\n@@EVIDENCE@@ Full shared passage.\n"
            "@@REASON@@ Reason\n@@DISTRACTOR@@ 无（非选择题）\n@@PITFALLS@@ Trap::Explanation\n"
            "@@PATTERN_NAME@@ Pattern\n@@PATTERN_STEPS@@ Step\n@@TRANSFER_PASSAGE@@ Context\n"
            "@@TRANSFER_STEM@@ Blank\n@@TRANSFER_ANSWER@@ is\n@@TRANSFER_EXPL@@ Explanation\n@@END_Q@@\n")


def requested_nos(prompt):
    return re.search(r"本次只为这些题号生成完整讲解：([\d,]+)。", prompt)[1].split(",")


def test_plan_retains_shared_context_and_limits_scope():
    raw = skeleton() + "@@GROUP@@ reading|Unrelated|\n@@Q@@ 9\n@@STEM@@\nUnrelated text\n@@END_Q@@\n"
    jobs = plan_explanations(raw, LOADER, 1, ["2", "5", "8"])
    assert len(jobs) == 1
    assert jobs[0].nos == ["2", "5", "8"]
    assert "Blank 1" in jobs[0].material  # 同篇其他题作上下文
    assert "Full shared passage." in jobs[0].material
    assert "Teacher supplied key." in jobs[0].material
    assert "Unrelated text" not in jobs[0].material
    assert "只为这些题号生成完整讲解：2,5,8" in jobs[0].prompt
    assert len(plan_explanations(skeleton(), LOADER, 5)) == 8
    assert plan_explanations(skeleton() + "\n【续写指令】only 2", LOADER, 1) == []
    with pytest.raises(ValueError):
        plan_explanations(skeleton(), LOADER, 1, ["99"])
    with pytest.raises(ValueError):
        plan_explanations(skeleton(), LOADER, 1, ["2", "2"])
    broken = skeleton().replace("@@PASSAGE_REF@@ P1", "@@PASSAGE_REF@@ P404")
    assert plan_explanations(broken, LOADER, 1) == []


def test_block_isolation_rejects_structure_foreign_duplicate_and_unclosed_questions():
    blocks = QuestionBlocks(["1", "2"])
    raw = ("@@GROUP@@ reading|Malicious|\n@@Q@@ 99\n@@ANSWER@@ bad\n@@END_Q@@\n"
           "@@Q@@\n1\n@@STEM@@ changed\n@@ANSWER@@ is\n@@REASON@@ content @@Q@@ 99\n@@END_Q@@\n"
           + analysis("1") + "@@Q@@ 2\n@@ANSWER@@ half")
    result = []
    for char in raw:  # 包括标签中间断块
        result.extend(blocks.feed(char))
    result.extend(blocks.feed("", final=True))
    assert len(result) == 1
    no, block = result[0]
    assert no == "1"
    assert "@@STEM@@" not in block and "@@GROUP@@" not in block and "@@Q@@ 99" not in block
    assert "@@ANSWER@@ is" in block


def test_bounded_concurrency_out_of_order_and_partial_failure():
    async def run():
        jobs = plan_explanations(skeleton(11), LOADER, 1)
        active = peak = 0
        started = asyncio.Event()
        emitted = []

        class Fake:
            async def chat_stream_with_stop(self, *, user_prompt, usage_out, **kwargs):
                nonlocal active, peak
                nos = requested_nos(user_prompt)
                job = next(j for j in jobs if set(nos) <= set(j.nos))
                active += 1
                peak = max(peak, active)
                if active == PARALLELISM:
                    started.set()
                try:
                    await asyncio.wait_for(started.wait(), 1)
                    if job.id == "1":
                        await asyncio.sleep(.03)
                    if job.id == "2":
                        raise RuntimeError("upstream https://secret.example failed")
                    for no in nos:
                        for chunk in [analysis(no)[:25], analysis(no)[25:]]:
                            await asyncio.sleep(0)
                            yield chunk
                    usage_out.update(prompt_tokens=10, completion_tokens=20, total_tokens=30)
                finally:
                    active -= 1

        async for event, payload in stream_explanations(
            jobs, build_llm=Fake, stop_event=asyncio.Event(), transfer_count=1, stream_kwargs={}, retry_delay=0,
        ):
            emitted.append((event, payload))
        assert peak == PARALLELISM and active == 0
        assert jobs[1].state == "error"
        assert all(j.state == "done" for j in [jobs[0], *jobs[2:]])
        tokens = [p for e, p in emitted if e == "token"]
        assert "@@Q@@ 7" in tokens[0]  # 后面的任务先交付，不能被首个慢任务挡住
        data = parse_custom_visual_paper(skeleton(11) + "".join(tokens))
        qs = data["groups"][0]["questions"]
        assert [q["no"] for q in qs] == [str(n) for n in range(1, 12)]
        assert sum(question_complete(q, 1) for q in qs) == 8
        assert "secret.example" not in json.dumps(emitted)

    asyncio.run(run())


@pytest.mark.parametrize("close", [False, True])
def test_stop_or_disconnect_cancels_waiting_calls_and_does_not_launch_queue(close):
    async def run():
        jobs = plan_explanations(skeleton(15), LOADER, 1)
        stop = asyncio.Event()
        entered, closed = [], []
        all_started = asyncio.Event()

        class Fake:
            async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
                entered.append(user_prompt)
                if len(entered) == PARALLELISM:
                    all_started.set()
                try:
                    await asyncio.Event().wait()  # 永不吐首 token，必须靠取消结束
                    yield "unreachable"
                finally:
                    closed.append(user_prompt)

        async with aclosing(stream_explanations(
            jobs, build_llm=Fake, stop_event=stop, transfer_count=1, stream_kwargs={},
        )) as stream:
            if close:
                await anext(stream)
                await asyncio.wait_for(all_started.wait(), 1)
            else:
                async def consume():
                    async for _ in stream:
                        pass
                consumer = asyncio.create_task(consume())
                await asyncio.wait_for(all_started.wait(), 1)
                stop.set()
                await asyncio.wait_for(consumer, 1)
        assert len(entered) == len(closed) == PARALLELISM
        assert all(j.state == "cancelled" for j in jobs)

    asyncio.run(run())


def test_truncated_and_empty_streams_are_incomplete_not_done():
    async def run():
        jobs = plan_explanations(skeleton(2), LOADER, 1, ["1", "2"])

        class Fake:
            async def chat_stream_with_stop(self, **kwargs):
                yield "@@Q@@ 1\n@@ANSWER@@ is\n@@END_Q@@\n@@Q@@ 2\n@@ANSWER@@ lost"

        tokens = []
        async for event, payload in stream_explanations(
            jobs, build_llm=Fake, stop_event=asyncio.Event(), transfer_count=1, stream_kwargs={}, max_attempts=1,
        ):
            if event == "token":
                tokens.append(payload)
        assert len(tokens) == 1 and "lost" not in tokens[0]
        assert jobs[0].state == "incomplete" and jobs[0].completed == []

    asyncio.run(run())


@pytest.mark.parametrize("finish,throws,complete", [("stop", False, True), (None, False, True), ("length", False, False), ("content_filter", False, False), ("stop", True, False)])
def test_missing_end_marker_only_salvaged_on_complete_normal_eof(finish, throws, complete):
    async def run():
        jobs = plan_explanations(skeleton(1), LOADER, 1)
        class Fake:
            async def chat_stream_with_stop(self, *, usage_out, **kwargs):
                usage_out["finish_reason"] = finish
                yield analysis("1").removesuffix("@@END_Q@@\n")
                if throws:
                    raise RuntimeError("connection lost")
        tokens = [p async for e, p in stream_explanations(
            jobs, build_llm=Fake, stop_event=asyncio.Event(), transfer_count=1,
            stream_kwargs={}, max_attempts=1,
        ) if e == "token"]
        assert bool(tokens) == complete
        assert (jobs[0].state == "done") == complete
    asyncio.run(run())


def test_embedded_blank_stem_is_complete_but_seven_choice_requires_seven_options():
    q = parse_custom_visual_paper(skeleton(1) + analysis("1").replace("@@TRANSFER_STEM@@ Blank\n", ""))["groups"][0]["questions"][0]
    assert question_complete(q, 1)
    q["options"] = [{"label": label, "text": label} for label in "ABCDEFG"]
    q["transfers"][0]["stem"] = "Select a sentence."
    q["transfers"][0]["options"] = q["options"][:4]
    assert question_missing(q, 1) == ["迁移 1：选项不足（4/7）"]


@pytest.mark.parametrize("group_id,labels", [("cloze7", "ABCDEFG"), ("cloze", "ABCD"), ("grammar", "")])
@pytest.mark.parametrize("stem_tag", ["@@TRANSFER_STEM@@\n", ""])
def test_embedded_questions_complete_without_independent_stem(group_id, labels, stem_tag):
    options = "\n".join(f"{label}. Option {label}" for label in labels)
    raw = skeleton(1).replace("grammar|Grammar", f"{group_id}|Embedded").replace(
        "@@STEM@@\nBlank 1", f"@@STEM@@\n@@OPTIONS@@\n{options}")
    transfer = (f"@@TRANSFER_PASSAGE@@ New context with (1) ____.\n{stem_tag}"
                f"@@TRANSFER_OPTIONS@@\n{options}\n@@TRANSFER_ANSWER@@ 1: A\n@@TRANSFER_EXPL@@ Reason\n")
    block = analysis("1").split("@@TRANSFER_PASSAGE@@")[0] + transfer * 2 + "@@END_Q@@\n"
    q = parse_custom_visual_paper(raw + block)["groups"][0]["questions"][0]
    assert len(q["transfers"]) == 2
    assert question_complete(q, 2, group_id)
    if labels:
        assert question_missing(q, 2, "reading") == ["迁移 1：题干", "迁移 2：题干"]
        q["transfers"][0]["options"].pop()
        assert "选项不足" in question_missing(q, 2, group_id)[0]
    q["transfers"][1].update(passage="", stem="", answer="", explanation="")
    missing = question_missing(q, 2, group_id)
    assert all(f"迁移 2：{field}" in missing for field in ("语篇", "答案", "解析"))

    async def run():
        jobs = plan_explanations(raw, LOADER, 2)
        class Fake:
            async def chat_stream_with_stop(self, **kwargs):
                yield block
        async for _ in stream_explanations(jobs, build_llm=Fake, stop_event=asyncio.Event(),
                                            transfer_count=2, stream_kwargs={}, retry_delay=0):
            pass
        assert jobs[0].state == "done"
        assert jobs[0].completed == ["1"]
        assert len(jobs[0].attempts) == 1  # 无独立题干不能触发自动重试。
    asyncio.run(run())


def test_retries_only_missing_questions_rotate_provider_and_preserve_completed():
    async def run():
        jobs = plan_explanations(skeleton(3), LOADER, 1)
        calls, providers, emitted = [], [], []
        class Fake:
            def __init__(self):
                self.providers = [{"id": "a"}, {"id": "b"}]
            async def chat_stream_with_stop(self, *, user_prompt, usage_out, **kwargs):
                nos = requested_nos(user_prompt)
                calls.append(nos)
                self.provider_used = self.providers[0]
                providers.append(self.provider_used["id"])
                usage_out.update(total_tokens=10)
                if len(calls) == 1:
                    yield analysis("1") + "@@Q@@ 2\n@@ANSWER@@ half\n@@END_Q@@\n"
                else:
                    assert "上次未通过" in user_prompt
                    yield analysis("1").replace("Reason", "MUST NOT OVERWRITE") + analysis(nos[0])
        async for event in stream_explanations(jobs, build_llm=Fake, stop_event=asyncio.Event(),
                                               transfer_count=1, stream_kwargs={}, retry_delay=0):
            emitted.append(event)
        assert calls == [["1", "2", "3"], ["2"], ["3"]]
        assert providers == ["a", "b", "a"]
        assert jobs[0].state == "done" and jobs[0].usage["total_tokens"] == 30
        body = "".join(p for e, p in emitted if e == "token")
        assert body.count("@@Q@@ 1\n") == 1 and "MUST NOT OVERWRITE" not in body
        assert any(e == "visual_task" and p["state"] == "retrying" for e, p in emitted)
    asyncio.run(run())


@pytest.mark.parametrize("limit", [1, 5])
def test_configured_concurrency_bounds_actual_requests(limit):
    async def run():
        jobs = plan_explanations(skeleton(15), LOADER, 1)
        active = peak = 0
        entered = asyncio.Event()
        class Fake:
            async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
                nonlocal active, peak
                active += 1
                peak = max(peak, active)
                if active == limit:
                    entered.set()
                try:
                    await asyncio.wait_for(entered.wait(), 1)
                    for no in requested_nos(user_prompt):
                        yield analysis(no)
                finally:
                    active -= 1
        async for _ in stream_explanations(jobs, build_llm=Fake, stop_event=asyncio.Event(),
                                           transfer_count=1, stream_kwargs={}, concurrency=limit):
            pass
        assert peak == limit and active == 0
        assert all(j.state == "done" for j in jobs)
    asyncio.run(run())


def test_fallback_is_scoped_to_task_and_cleared_only_by_its_own_body():
    async def run():
        jobs = plan_explanations(skeleton(6), LOADER, 1)
        blocked = asyncio.Event()
        release = asyncio.Event()
        emitted = []
        class Fake:
            async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
                nos = requested_nos(user_prompt)
                if nos[0] == "1":
                    yield ("fallback", {"failed_index": 1, "next_index": 2, "total": 2, "reason": "timeout"})
                    blocked.set()
                    await release.wait()
                else:
                    await blocked.wait()
                for no in nos:
                    yield analysis(no)
        async for event, payload in stream_explanations(jobs, build_llm=Fake, stop_event=asyncio.Event(),
                                                        transfer_count=1, stream_kwargs={}):
            emitted.append((event, payload))
            if event == "token" and "@@Q@@ 4" in payload:
                assert jobs[0].fallback["reason"] == "timeout"
                release.set()
        states = [p for e, p in emitted if e == "visual_task" and p["id"] == "1"]
        first = next(i for i, p in enumerate(states) if p["fallback"])
        assert states[first + 1]["fallback"] is None
        assert all(j.state == "done" for j in jobs)
    asyncio.run(run())


@pytest.mark.parametrize("stop_in_backoff", [False, True])
def test_nonretryable_error_or_stop_in_backoff_does_not_call_again(stop_in_backoff):
    async def run():
        jobs = plan_explanations(skeleton(1), LOADER, 1)
        stop = asyncio.Event()
        calls = 0
        class Fake:
            async def chat_stream_with_stop(self, **kwargs):
                nonlocal calls
                calls += 1
                raise RuntimeError("temporary failure" if stop_in_backoff else "context_length_exceeded")
                yield ""
        async def consume():
            async for event, payload in stream_explanations(jobs, build_llm=Fake, stop_event=stop,
                                                            transfer_count=1, stream_kwargs={}, retry_delay=30):
                if event == "visual_task" and payload["state"] == "retrying":
                    stop.set()
        await asyncio.wait_for(consume(), 1)
        assert calls == 1
        assert jobs[0].state == ("cancelled" if stop_in_backoff else "error")
    asyncio.run(run())


@pytest.fixture
def api(monkeypatch):
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from app import deps
    from app.database import SessionLocal
    from app.main import app
    from app.models import UsageCode
    from app.routers import chat, tools

    with SessionLocal() as db:
        code = UsageCode(code=f"VP-{uuid4().hex}", quota=100, used_count=0, is_enabled=True)
        db.add(code)
        db.commit()
        db.refresh(code)
        db.expunge(code)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(code=code, reason="")
    app.dependency_overrides[tools.get_prompt_loader] = lambda: LOADER
    logs, charges = [], []
    def log(**kwargs):
        logs.append(kwargs)
        return len(logs)
    monkeypatch.setattr(chat, "_log_llm_call", log)
    def charge(**kwargs):
        charges.append(kwargs)
        return kwargs["units"]
    monkeypatch.setattr(chat, "_charge_usage", charge)
    monkeypatch.setattr(chat, "enforce_rate_limit", lambda **kwargs: None)
    try:
        yield TestClient(app), chat, logs, charges
    finally:
        app.dependency_overrides.clear()


def events(response):
    result = []
    for frame in response.text.replace("\r", "").split("\n\n"):
        lines = frame.splitlines()
        event = next((line[7:] for line in lines if line.startswith("event: ")), "")
        data = next((line[6:] for line in lines if line.startswith("data: ")), "")
        if event:
            result.append((event, json.loads(data) if data.startswith(('"', '{')) else data))
    return result


def test_route_partial_failure_logs_each_call_and_charges_once(api, monkeypatch):
    client, chat, logs, charges = api

    class Fake:
        async def chat_stream_with_stop(self, *, user_prompt, usage_out, **kwargs):
            if set(requested_nos(user_prompt)) & {"4", "5", "6"}:
                raise RuntimeError("secret upstream error")
            for no in ["1", "2", "3"]:
                yield analysis(no)
            usage_out.update(prompt_tokens=10, completion_tokens=20, total_tokens=30)

    monkeypatch.setattr(chat, "_build_llm", lambda *args, **kwargs: Fake())
    response = client.post("/api/chat/stream", json={
        "tool_id": "13", "input": skeleton(6), "request_id": "vp-partial",
        "visual_question_nos": [str(n) for n in range(1, 7)],
    })
    assert response.status_code == 200
    emitted = events(response)
    assert ("done", "[DONE]") in emitted
    assert not any(e == "error" for e, p in emitted)
    stage = next(p for e, p in emitted if e == "stage")
    assert stage["parallel"] and stage["reuse_framework"] and stage["concurrency"] == 2
    assert any(e == "visual_task" and p["state"] == "error" for e, p in emitted)
    assert "secret upstream" not in response.text
    assert len(charges) == 1 and charges[0]["units"] == 1
    assert len(logs) == 9  # 汇总 + 成功任务一次 + 失败任务首轮一次和两轮逐题补全
    parent = next(row for row in logs if row["request_id"] == "vp-partial")
    assert parent["status"] == "error" and parent["units"] == 1 and parent["usage"] == {}
    assert parent["counts_for_free_limit"] is True
    assert sum(row["usage"].get("total_tokens", 0) for row in logs) == 30
    assert all(row["units"] == 0 for row in logs if row is not parent)
    assert all(row["counts_for_free_limit"] is False for row in logs if row is not parent)
    assert all(row["parent_log_id"] == 1 for row in logs if row is not parent)
    assert "vp-partial" not in chat._stop_events


@pytest.mark.parametrize("marks_variant", ["normal", "letter_heading", "extra_key"])
def test_initial_framework_enters_parallel_and_keeps_order(api, monkeypatch, marks_variant):
    client, chat, logs, charges = api
    raw = "Passage starts here.\n" + "\n".join(f"{n}. Blank {n}" for n in range(1, 8))
    if marks_variant == "letter_heading":
        raw = "A\n" + raw

    class Fake:
        def __init__(self, framework=False):
            self.framework = framework

        async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
            if self.framework:
                anchor = "A" if marks_variant == "letter_heading" else "Passage starts"
                yield f"@@TOTAL@@ 7\n@@MARK GROUP grammar|Grammar@@ {anchor}\n@@MARK PASSAGE P1@@ Passage starts\n"
                for n in range(1, 8):
                    yield f"@@MARK Q {n}@@ {n}. Blank {n}\n"
                if marks_variant == "extra_key":
                    yield "@@MARK KEY@@ 参考答案\n"
            else:
                for n in range(7, 0, -1):  # 故意逆序、越过本任务范围；输出门卫只允许自己的题
                    yield analysis(str(n))

    monkeypatch.setattr(chat, "_build_llm", lambda *args, **kwargs: Fake(kwargs.get("chores", False)))
    response = client.post("/api/chat/stream", json={"tool_id": "13", "input": raw})
    emitted = events(response)
    assert any(e == "stage" and p.get("parallel") for e, p in emitted)
    transitions = [p for e, p in emitted if e == "stage" and p.get("name") == "explain"]
    assert len(transitions) == 1 and transitions[0]["framework"] and not transitions[0].get("reset")
    boundary = next(i for i, (e, p) in enumerate(emitted) if e == "stage" and p.get("name") == "explain")
    framework = "".join(p for e, p in emitted[:boundary] if e == "token")
    assert len(parse_custom_visual_paper(framework)["groups"][0]["questions"]) == 7
    output = "".join(p for e, p in emitted if e == "token")
    paper = parse_custom_visual_paper(output)
    questions = paper["groups"][0]["questions"]
    assert [q["no"] for q in questions] == [str(n) for n in range(1, 8)]
    assert all(question_complete(q, 1) for q in questions)
    assert len(charges) == 1
    assert len(logs) == 5  # 汇总、3 个精讲任务、框架
    assert sum(row["counts_for_free_limit"] is True for row in logs) == 1
    assert sum(row["counts_for_free_limit"] is False for row in logs) == 4


@pytest.mark.parametrize("mode", ["error", "incomplete"])
def test_all_parallel_calls_fail_without_charging_or_counting_free_use(api, monkeypatch, mode):
    client, chat, logs, charges = api

    class Fake:
        async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
            if mode == "incomplete":
                for no in requested_nos(user_prompt):
                    yield f"@@Q@@ {no}\n@@ANSWER@@ half\n@@END_Q@@\n"
                return
            raise RuntimeError("secret upstream failure")

    monkeypatch.setattr(chat, "_build_llm", lambda *args, **kwargs: Fake())
    response = client.post("/api/chat/stream", json={
        "tool_id": "13", "input": skeleton(6), "request_id": "vp-all-failed",
        "visual_question_nos": [str(n) for n in range(1, 7)],
    })
    assert any(e == "error" for e, _ in events(response))
    assert "secret upstream" not in response.text
    assert charges == []
    assert len(logs) == 15  # 汇总 + 两个任务各一次首轮、两轮各三次单题补全
    assert all(row["status"] == "error" and row["counts_for_free_limit"] is False for row in logs)


def test_invalid_selection_rejected_before_upstream_and_charge(api, monkeypatch):
    client, chat, logs, charges = api
    def unexpected(*args, **kwargs):
        pytest.fail("invalid selection must never call a model")
    monkeypatch.setattr(chat, "_build_llm", unexpected)
    for selected in [["99"], ["1", "1"], []]:
        response = client.post("/api/chat/stream", json={
            "tool_id": "13", "input": skeleton(), "visual_question_nos": selected,
        })
        assert response.status_code in (400, 422)
    assert charges == []


def test_stop_in_framework_does_not_call_explain_model(api, monkeypatch):
    client, chat, logs, charges = api

    class Fake:
        def __init__(self, framework):
            self.framework = framework

        async def chat_stream_with_stop(self, *, stop_event, **kwargs):
            assert self.framework, "stopped framework must not start explain"
            yield "@@TOTAL@@ 7\n"
            stop_event.set()

    monkeypatch.setattr(chat, "_build_llm", lambda *args, **kwargs: Fake(kwargs.get("chores", False)))
    response = client.post("/api/chat/stream", json={"tool_id": "13", "input": "Original paper"})
    assert ("done", "[CANCELLED]") in events(response)
    assert all(row["status"] == "cancelled" for row in logs)


def test_legacy_continuation_preserves_work_order_without_rebuilding_framework(api, monkeypatch):
    client, chat, logs, charges = api
    prompts = []

    class Fake:
        async def chat_stream_with_stop(self, *, user_prompt, **kwargs):
            prompts.append(user_prompt)
            yield analysis("4")

    def build(*args, **kwargs):
        assert not kwargs.get("chores"), "legacy continuation must keep its work order"
        return Fake()

    monkeypatch.setattr(chat, "_build_llm", build)
    brief = "【续写指令】1,2,3 已完成，只为第 4 题输出讲解。"
    response = client.post("/api/chat/stream", json={"tool_id": "13", "input": "Original paper\n\n" + brief})
    emitted = events(response)
    assert ("done", "[DONE]") in emitted
    assert not any(e in {"stage", "visual_task"} for e, _ in emitted)
    assert len(prompts) == len(charges) == len(logs) == 1
    assert brief in prompts[0]
