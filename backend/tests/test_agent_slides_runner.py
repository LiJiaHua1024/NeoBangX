import asyncio
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent_workspace import llm, runner, store
from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.agent_workspace.api import TaskConfig
from app.agent_workspace.api import router as workspace_router
from app.agent_workspace.models import WorkspaceMaterial, WorkspaceTask
from app.database import SessionLocal

FIX = Path(__file__).parent / "fixtures" / "slides"


def _make_task(owner):
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    with SessionLocal() as db:
        task = WorkspaceTask(id=store.uid(), owner=owner, title="阅读课 PPT",
                             config=store.encode(TaskConfig(goal="阅读课", output="slides",
                                                            model="test", review=False).model_dump()))
        db.add(task)
        db.flush()
        m = WorkspaceMaterial(id=store.uid(), task_id=task.id, name="工具结果",
                              content=json.dumps(deck, ensure_ascii=False))
        db.add(m)
        cfg = store.decode(task.config)
        cfg["materials"] = [m.id]
        task.config = store.encode(cfg)
        db.commit()
        return task.id, m.id, deck


def test_presentation_run_saves_scene_and_exports(workspace_code, monkeypatch):
    owner, token = workspace_code("PPTRUN-", quota=5)
    save_settings(WorkspaceSettings(slides_enabled=True))
    task_id, material_id, deck = _make_task(owner)
    snapshot = {"model": "test",
                "limits": {"max_steps": 4, "max_tokens": 200000, "output_tokens": 16000,
                           "max_seconds": 60, "context_budget": 262144, "keep_tail_steps": 4,
                           "provider_attempts": 1, "retry_wait_cap_seconds": 30,
                           "switch_compaction_ratio": 0.5},
                "templates": {}, "presentation": {"title": "阅读课 PPT", "instruction": "阅读课",
                                                  "material_ids": [material_id], "blueprint": "reading",
                                                  "theme": "paper"}, "expected_revision": 1}
    run = store.create_run(owner, task_id, "presentation-key-1", "presentation", "", "", snapshot, False,
                           {"id": "test"})
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    raw = json.dumps(deck, ensure_ascii=False)
    async def model(cfg, name, messages, schemas, budget, emit, **kwargs):
        await emit("output", raw)
        return llm.ModelResult(content=raw)
    asyncio.run(runner.execute_run(run["id"], model))
    detail = store.task_detail(owner, task_id)
    assert detail["status"] == "completed"
    slides = [v for v in detail["versions"] if v.get("kind") == "slides"]
    assert len(slides) == 1
    version_id = slides[0]["id"]
    assert slides[0]["slide_count"] == 11
    rend = store.rendition(version_id, full=True)
    assert rend["scene"]["title"] == deck["title"]
    from app.agent_workspace import tools
    outline = asyncio.run(tools.execute_readonly(task_id, store.task_detail(owner, task_id)["config"],
                                                 "read_presentation", {"version_id": version_id}))
    assert outline["kind"] == "slides" and outline["slides"] == 11
    assert "第 1 页" in outline["outline"]

    app = FastAPI(); app.include_router(workspace_router)
    client = TestClient(app, headers={"Authorization": "Bearer " + token})
    scene = client.get(f"/api/workspace/tasks/{task_id}/versions/{version_id}/scene")
    assert scene.status_code == 200, scene.text
    assert len(scene.json()["scene"]["slides"]) == 11
    export = client.get(f"/api/workspace/tasks/{task_id}/versions/{version_id}/export?format=pptx")
    assert export.status_code == 200, export.text
    assert export.content[:2] == b"PK"
    assert "attachment" in export.headers["content-disposition"]
    themed = client.post(f"/api/workspace/tasks/{task_id}/versions/{version_id}/theme",
                         json={"theme": "chalk"})
    assert themed.status_code == 200, themed.text
    assert themed.json()["kind"] == "slides"
    new_id = themed.json()["id"]
    scene2 = client.get(f"/api/workspace/tasks/{task_id}/versions/{new_id}/scene")
    assert scene2.status_code == 200
    assert scene2.json()["scene"]["theme"] == "chalk"
    save_settings(WorkspaceSettings(slides_enabled=False))
