"""Exercise the scheduling-agent tool path, not just the direct runner method."""
import asyncio
import json
from pathlib import Path

from app.agent_workspace import llm, runner, store
from app.agent_workspace.api import TaskConfig
from app.agent_workspace.models import WorkspaceMaterial, WorkspaceTask
from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.database import SessionLocal

FIX = Path(__file__).parent / "fixtures" / "slides"


def _task(owner):
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    with SessionLocal() as db:
        task = WorkspaceTask(id=store.uid(), owner=owner, title="Agent PPT",
                             config=store.encode(TaskConfig(goal="阅读课", output="slides",
                                                            model="test", review=False, tools=[]).model_dump()))
        db.add(task); db.flush()
        m = WorkspaceMaterial(id=store.uid(), task_id=task.id, name="工具结果",
                              content=json.dumps(deck, ensure_ascii=False))
        db.add(m)
        cfg = store.decode(task.config); cfg["materials"] = [m.id]; task.config = store.encode(cfg)
        db.commit()
        return task.id, m.id


def _run(owner, task_id, key):
    snapshot = {"model": "test",
                "limits": {"max_steps": 6, "max_tokens": 300000, "output_tokens": 16000,
                           "max_seconds": 60, "context_budget": 262144, "keep_tail_steps": 4,
                           "provider_attempts": 1, "retry_wait_cap_seconds": 30,
                           "switch_compaction_ratio": 0.5},
                "templates": {}, "expected_revision": 1}
    return store.create_run(owner, task_id, key, "execute", "", "", snapshot, True, {"id": "test"})


def _fake(raw, first_call):
    calls = []
    async def model(cfg, name, messages, schemas, budget, emit, **kwargs):
        calls.append({"schemas": schemas, "kwargs": kwargs})
        if len(calls) == 1:
            return llm.ModelResult(calls=[first_call])
        if schemas is None:
            await emit("output", raw)
            return llm.ModelResult(content=raw)
        return llm.ModelResult(content="已完成")
    return model, calls


def test_agent_create_presentation_tool_saves_slides(workspace_code, monkeypatch):
    owner, _ = workspace_code("PPTAGENT-", quota=5)
    task_id, material_id = _task(owner)
    run = _run(owner, task_id, "agent-create-1")
    raw = (FIX / "reading.json").read_text(encoding="utf-8")
    call = {"id": "c1", "type": "function", "function": {
        "name": "create_presentation",
        "arguments": json.dumps({"title": "阅读课 PPT", "instruction": "做成课堂 PPT",
                                 "material_ids": [material_id], "blueprint": "reading",
                                 "theme": "paper"})}}
    model, calls = _fake(raw, call)
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    save_settings(WorkspaceSettings(slides_enabled=True))
    asyncio.run(runner.execute_run(run["id"], model))
    detail = store.task_detail(owner, task_id)
    slides = [v for v in detail["versions"] if v.get("kind") == "slides"]
    assert len(slides) == 1
    assert slides[0]["slide_count"] == 11
    assert len(calls) >= 3
    assert calls[0]["schemas"] and any(s["function"]["name"] == "create_presentation" for s in calls[0]["schemas"])
    assert calls[1]["schemas"] is None  # deck writer call
    save_settings(WorkspaceSettings(slides_enabled=False))


def test_agent_revise_presentation_tool_keeps_parent(workspace_code, monkeypatch):
    owner, _ = workspace_code("PPTAGENT-", quota=5)
    task_id, material_id = _task(owner)
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    from app.agent_workspace.slides.schema import normalize_deck
    from app.agent_workspace.slides.compile import compile_deck
    nd = normalize_deck(deck)
    base = store.save_slides_version(task_id, "", "base-deck", "阅读课 PPT", nd, compile_deck(nd),
                                     provenance={"materials": [material_id], "slide_count": 11,
                                                 "blueprint": "reading", "theme": "paper"})
    run = _run(owner, task_id, "agent-revise-1")
    call = {"id": "c2", "type": "function", "function": {
        "name": "revise_presentation",
        "arguments": json.dumps({"version_id": base["id"], "instruction": "把开场改慢一点",
                                 "title": "阅读课 PPT（修订）"})}}
    raw = json.dumps(deck, ensure_ascii=False)
    model, calls = _fake(raw, call)
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    save_settings(WorkspaceSettings(slides_enabled=True))
    asyncio.run(runner.execute_run(run["id"], model))
    detail = store.task_detail(owner, task_id)
    slides = [v for v in detail["versions"] if v.get("kind") == "slides"]
    assert len(slides) == 2
    assert slides[-1]["parent_id"] == base["id"]
    assert slides[0]["id"] == base["id"]
    save_settings(WorkspaceSettings(slides_enabled=False))
