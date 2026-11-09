import asyncio
import json
from pathlib import Path

import pytest

from app.agent_workspace import llm, runner, store
from app.agent_workspace.api import TaskConfig
from app.agent_workspace.models import WorkspaceMaterial, WorkspaceTask
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.schema import normalize_deck
from app.database import SessionLocal

FIX = Path(__file__).parent / "fixtures" / "slides"


def test_review_slides_uses_outline_and_reports_kind(workspace_code, monkeypatch):
    owner, _ = workspace_code("PPTREV-", quota=5)
    deck = normalize_deck(json.loads((FIX / "reading.json").read_text(encoding="utf-8")))
    scene = compile_deck(deck)
    with SessionLocal() as db:
        task = WorkspaceTask(id=store.uid(), owner=owner, title="阅读 PPT",
                             config=store.encode(TaskConfig(goal="阅读", output="slides",
                                                            model="test", review=True).model_dump()))
        db.add(task)
        db.flush()
        m = WorkspaceMaterial(id=store.uid(), task_id=task.id, name="结果", content="x" * 500)
        db.add(m)
        cfg = store.decode(task.config); cfg["materials"] = [m.id]; task.config = store.encode(cfg)
        db.commit()
        task_id, material_id = task.id, m.id
    version = store.save_slides_version(task_id, "", "review-deck", "阅读 PPT", deck, scene,
                                        provenance={"materials": [material_id], "slide_count": 11,
                                                    "blueprint": "reading", "theme": "paper"})
    snapshot = {"model": "test", "limits": {"max_steps": 4, "max_tokens": 200000,
                "output_tokens": 16000, "max_seconds": 60, "context_budget": 262144,
                "keep_tail_steps": 4, "provider_attempts": 1, "retry_wait_cap_seconds": 30,
                "switch_compaction_ratio": 0.5}, "templates": {}, "expected_revision": 1}
    run = store.create_run(owner, task_id, "review-run-1", "review", "", version["id"], snapshot, False,
                           {"id": "test"})
    seen = {}
    async def model(cfg, name, messages, schemas, budget, emit, **kwargs):
        seen["messages"] = messages
        return llm.ModelResult(content=json.dumps({"summary": "结构完整", "issues": [{
            "quote": "第 1 页", "problem": "开场略快", "evidence": "课堂时间",
            "fix": "放慢开场", "certainty": "confirmed"}]}))
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    asyncio.run(runner.execute_run(run["id"], model))
    assert "演示文稿" in seen["messages"][0]["content"]
    assert '"version_kind": "slides"' in seen["messages"][1]["content"]
    with SessionLocal() as db:
        from app.agent_workspace.models import WorkspaceEntry
        entry = db.query(WorkspaceEntry).filter(WorkspaceEntry.run_id == run["id"],
                                                WorkspaceEntry.kind == "review").first()
        assert entry and json.loads(entry.details)["version_kind"] == "slides"
