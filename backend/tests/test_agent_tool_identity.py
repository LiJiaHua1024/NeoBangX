"""工具调用的幂等键：provider 的 `tool_call.id` 不能当唯一标识。

模型（或厂商兼容层）重复同一个 id、或干脆不发 id 时，旧实现把两次不同调用
映射到同一个步骤 entry，第二次直接命中 `done` 把第一次的输出还回去。
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.agent_workspace import api, llm, runner, store
from app.database import SessionLocal

SETTINGS = {"model": "test", "review": False, "tools": ["material_search"]}


def _task_with_materials(owner: int, texts=("材料一的正文", "材料二的正文")) -> tuple[str, list[str]]:
    with SessionLocal() as db:
        from app.agent_workspace.models import WorkspaceTask

        row = WorkspaceTask(
            id=store.uid(),
            owner=owner,
            title="工具幂等测试",
            config=store.encode(api.TaskConfig(goal="读材料", **SETTINGS).model_dump()),
        )
        db.add(row)
        db.commit()
        task_id = row.id
    ids = [api.add_material(owner, task_id, f"材料{index}.txt", text)["id"] for index, text in enumerate(texts, 1)]
    task = store.task_detail(owner, task_id)
    store.update_task(owner, task_id, task["revision"], {**task["config"], "materials": ids})
    return task_id, ids


def _start(owner: int, task_id: str) -> str:
    snapshot = {"model": "test", "limits": {"max_steps": 6, "max_tokens": 200000, "output_tokens": 16000, "max_seconds": 60}, "templates": {}}
    return store.create_run(owner, task_id, store.uid(), "execute", "", "", snapshot, True)["id"]


def _tool_messages(messages) -> list[dict]:
    return [m for m in messages if m.get("role") == "tool"]


def _entry_keys(run_id: str) -> list[str]:
    from app.agent_workspace.models import WorkspaceEntry
    from sqlalchemy import select

    with SessionLocal() as db:
        return sorted(row.key for row in db.scalars(
            select(WorkspaceEntry).where(WorkspaceEntry.run_id == run_id)) if row.kind == "tool")


@pytest.mark.parametrize("call_id", ["dup-id", ""])
def test_same_or_missing_call_id_runs_every_call(workspace_code, monkeypatch, call_id):
    owner, _ = workspace_code("TOOL-", quota=10)
    task_id, materials = _task_with_materials(owner)
    run_id = _start(owner, task_id)
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    seen = []

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        seen.append(list(messages))
        if len(seen) == 1:
            return llm.ModelResult(calls=[
                {"id": call_id, "type": "function",
                 "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[0]})}},
                {"id": call_id, "type": "function",
                 "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[1]})}},
            ])
        return llm.ModelResult(content="两次都读到了。")

    asyncio.run(runner.execute_run(run_id, model))

    results = [json.loads(m["content"]) for m in _tool_messages(seen[1])]
    assert len(results) == 2
    assert results[0]["text"] == "材料一的正文"
    assert results[1]["text"] == "材料二的正文", "第二次调用拿回了第一次的结果"
    assert len(_entry_keys(run_id)) == 2


def test_resume_keeps_running_the_call_that_already_finished(workspace_code, monkeypatch):
    """同一条 assistant 消息里的多个调用，重放时只补没跑过的那几个，键不能串。"""
    owner, _ = workspace_code("TOOL-", quota=10)
    task_id, materials = _task_with_materials(owner)
    run_id = _start(owner, task_id)
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    calls, seen = [], []

    async def model(cfg, model, messages, schemas, budget, emit, **kwargs):
        seen.append(list(messages))
        calls.append(1)
        if len(calls) == 1:
            return llm.ModelResult(calls=[
                {"id": "same", "type": "function",
                 "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[0]})}},
                {"id": "same", "type": "function",
                 "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[1]})}},
            ])
        return llm.ModelResult(content="读完。")

    # 第一轮只跑到第一个调用就"崩掉"：检查点里留下 assistant 消息与一条 tool 结果。
    job = runner.Runner(run_id, model)
    asyncio.run(job.load())
    job.messages.append({"role": "assistant", "content": None, "tool_calls": [
        {"id": "same", "type": "function",
         "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[0]})}},
        {"id": "same", "type": "function",
         "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[1]})}},
    ]})
    asyncio.run(job.checkpoint())
    job.messages.append({"role": "tool", "tool_call_id": "same", "content": json.dumps({"text": "材料一的正文"})})
    asyncio.run(job.checkpoint())

    asyncio.run(runner.execute_run(run_id, model))
    results = [json.loads(m["content"]) for m in _tool_messages(seen[0])]
    assert [r["text"] for r in results] == ["材料一的正文", "材料二的正文"]


def test_legacy_tool_key_is_reused_after_upgrade(workspace_code):
    """升级前用 `tool:<provider id>` 落库的步骤不能被重跑一遍。"""
    owner, _ = workspace_code("TOOL-", quota=10)
    task_id, materials = _task_with_materials(owner)
    run_id = _start(owner, task_id)
    with SessionLocal() as db:
        from app.agent_workspace.models import WorkspaceTask

        store.task_detail(owner, task_id)
        assert db.get(WorkspaceTask, task_id) is not None
    legacy = store.start_entry(task_id, run_id, "tool:legacy-1", "tool", "read_material")
    store.finish_tool(legacy["id"], {"text": "升级前的结果"})

    job = runner.Runner(run_id)
    asyncio.run(job.load())
    result = asyncio.run(job.tool_call(
        {"id": "legacy-1", "function": {"name": "read_material", "arguments": json.dumps({"material_id": materials[0]})}},
        key="tool:2:0"))
    assert result["text"] == "升级前的结果"
