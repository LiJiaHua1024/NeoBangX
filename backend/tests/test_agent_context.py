"""上下文压缩与预算口径：HEAD 不动、备注不丢、缓存命中不算未命中。"""
from __future__ import annotations

import asyncio
import json

from sqlalchemy import select

from app.agent_workspace import api, context, llm, runner, store
from app.agent_workspace.instructions import behavior_of
from app.agent_workspace.models import WorkspaceEntry, WorkspaceTask
from app.database import SessionLocal
from app.models import UsageLog


def _task(owner: int, *, review: bool = False) -> str:
    with SessionLocal() as db:
        row = WorkspaceTask(
            id=store.uid(), owner=owner, title="上下文测试",
            config=store.encode(api.TaskConfig(goal="分析材料", model="test", review=review).model_dump()),
        )
        db.add(row)
        db.commit()
        return row.id


def _run(owner: int, task_id: str, **limits) -> str:
    snapshot = {
        "model": "test",
        "limits": {"max_steps": 6, "max_tokens": 200000, "output_tokens": 4096,
                   "max_seconds": 120, **limits},
        "templates": {},
    }
    return store.create_run(owner, task_id, store.uid(), "execute", "", "", snapshot, True)["id"]


def _entries(run_id: str):
    with SessionLocal() as db:
        return [store.entry_dict(row) for row in db.scalars(
            select(WorkspaceEntry).where(WorkspaceEntry.run_id == run_id).order_by(WorkspaceEntry.created_at))]


# ---------------- 纯函数 ----------------

def test_units_keep_tool_results_with_their_call():
    messages = [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "ctx"},
        {"role": "user", "content": "补充要求"},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": "c1", "function": {"name": "read_material", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "数据"},
    ]
    units = context.units(messages)
    assert [unit[0]["role"] for unit in units] == ["user", "assistant"]
    assert len(units[1]) == 2, "工具结果必须跟它的调用留在同一个单元里"
    assert context.is_note(units[0]) and not context.is_note(units[1])


def test_digest_is_deterministic_and_names_tools():
    unit = [{"role": "assistant", "content": None,
             "tool_calls": [{"id": "c1", "function": {"name": "read_material",
                                                     "arguments": json.dumps({"material_id": "m1"})}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "x" * 1200}]
    first = context.render_digest([unit])
    second = context.render_digest([unit])
    assert first == second, "摘要必须逐字节稳定，否则每次压缩都会换掉前缀"
    assert "read_material" in first and "m1" in first
    assert "1,200" in first


def test_plan_cut_keeps_head_and_user_notes():
    head = [{"role": "system", "content": "S"}, {"role": "user", "content": "CTX"}]
    messages = head + [
        {"role": "assistant", "content": "旧结论" * 50},
        {"role": "user", "content": "请保持 800 字"},
        {"role": "assistant", "content": "较新结论"},
        {"role": "assistant", "content": "最新结论"},
    ]
    count = lambda msgs: sum(len(m.get("content") or "") + 10 for m in msgs)
    plan = context.plan_cut(messages, keep_tail=2, target_tokens=400, count_tokens=count)

    assert plan is not None
    new_messages, stats = plan
    assert new_messages[0] is head[0] and new_messages[1] is head[1]
    assert "请保持 800 字" in [m.get("content") for m in new_messages], "用户补充要求必须原文保留"
    assert any("较早步骤已压缩" in (m.get("content") or "") for m in new_messages[2:])
    assert stats["dropped_units"] >= 1
    assert count(new_messages) <= 400


def test_plan_cut_is_a_noop_when_there_is_nothing_to_drop():
    messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "c"},
                {"role": "assistant", "content": "a"}]
    assert context.plan_cut(messages, keep_tail=4, target_tokens=10,
                            count_tokens=lambda msgs: 999) is None


# ---------------- 预算口径 ----------------

def test_budget_counts_uncached_prompt_and_completion(workspace_code):
    owner, _ = workspace_code("CTX-", quota=5)
    run_id = _run(owner, _task(owner))

    async def model(cfg, model_name, messages, schemas, budget, emit, **kwargs):
        return llm.ModelResult(content="完成", usage={"prompt_tokens": 1000, "completion_tokens": 50,
                                                     "total_tokens": 1050}, cached_tokens=900)

    asyncio.run(runner.execute_run(run_id, model))

    saved = store.load_run(run_id)
    assert saved["tokens"] == 150, "只计未命中(1000-900) + 输出(50)"
    usage = saved["snapshot"]["usage"]
    assert (usage["prompt"], usage["cached"], usage["completion"]) == (1000, 900, 50)
    assert usage["cached_reported"] is True

    with SessionLocal() as db:
        log = db.scalar(select(UsageLog).where(UsageLog.request_id == run_id))
        # 日志记真实用量，方便核对缓存命中率；预算口径与日志口径分开
        assert (log.prompt_tokens, log.completion_tokens, log.cached_tokens) == (1000, 50, 900)
        assert log.total_tokens == 1050


def test_missing_cache_report_counts_as_uncached(workspace_code):
    """上游没上报命中信息时按未命中算（保守），不能当成命中。"""
    owner, _ = workspace_code("CTX-", quota=5)
    run_id = _run(owner, _task(owner))

    async def model(cfg, model_name, messages, schemas, budget, emit, **kwargs):
        return llm.ModelResult(content="完成", usage={"prompt_tokens": 800, "completion_tokens": 20,
                                                     "total_tokens": 820})

    asyncio.run(runner.execute_run(run_id, model))
    assert store.load_run(run_id)["tokens"] == 820


# ---------------- 断流重跑本步 ----------------

def test_partial_stream_retries_the_same_step_once(workspace_code):
    owner, _ = workspace_code("CTX-", quota=5)
    run_id = _run(owner, _task(owner))
    calls = []

    async def model(cfg, model_name, messages, schemas, budget, emit, **kwargs):
        calls.append(kwargs.get("preferred"))
        if len(calls) == 1:
            partial = llm.ModelResult(content="半截", usage={"prompt_tokens": 100,
                                                          "completion_tokens": 5,
                                                          "total_tokens": 105})
            raise llm.PartialResponseError(partial, asyncio.TimeoutError())
        return llm.ModelResult(content="最终成果")

    asyncio.run(runner.execute_run(run_id, model))

    saved = store.load_run(run_id)
    assert saved["status"] == "completed"
    entries = _entries(run_id)
    model_entries = [e for e in entries if e["kind"] == "model"]
    assert len(model_entries) == 2
    assert model_entries[0]["status"] == "interrupted"
    assert "断流重试" in model_entries[1]["label"]
    assert calls[0] == calls[1], "重跑必须留在同一家 Provider 上"


# ---------------- 压缩 ----------------

def test_compaction_keeps_head_and_records_an_entry(workspace_code):
    owner, _ = workspace_code("CTX-", quota=5)
    task_id = _task(owner)
    run_id = _run(owner, task_id, context_budget=4000, keep_tail_steps=1)
    calls = []

    async def model(cfg, model_name, messages, schemas, budget, emit, **kwargs):
        calls.append(1)
        if len(calls) <= 5:
            return llm.ModelResult(
                content="甲" * 900,
                calls=[{"id": f"call_{len(calls)}", "type": "function",
                        "function": {"name": "search_material", "arguments": json.dumps({"query": "x"})}}],
            )
        return llm.ModelResult(content="最终成果")

    asyncio.run(runner.execute_run(run_id, model))

    entries = _entries(run_id)
    compactions = [e for e in entries if e["kind"] == "compaction"]
    assert compactions, "超过 context_budget 必须压缩一次"
    details = compactions[0]["details"]
    assert details["before"] > details["after"]

    messages = store.load_run(run_id)["messages"]
    assert messages[0]["content"] == behavior_of(api.TaskConfig(goal="分析材料", model="test",
                                                                review=False).model_dump()), \
        "HEAD（system）不能被压缩改写"
    assert any("较早步骤已压缩" in (m.get("content") or "") for m in messages)
