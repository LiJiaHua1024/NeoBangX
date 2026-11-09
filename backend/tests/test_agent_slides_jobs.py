import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.database import SessionLocal
from app.agent_workspace.models import WorkspaceRun, WorkspaceTask
from app.agent_workspace import llm, runner
from app.routers import presentations


@pytest.fixture
def client(workspace_code, monkeypatch):
    owner, token = workspace_code("PPTJOB-", quota=5)
    cfg = {"default_model": "test", "models": [{"id": "test", "enabled": True, "agent_usable": True}]}
    monkeypatch.setattr(presentations, "_load_cfg", lambda: cfg)
    monkeypatch.setattr(presentations, "_agent_models", lambda c: c["models"])
    monkeypatch.setattr(presentations, "_agent_model_entry", lambda c, m: c["models"][0])
    monkeypatch.setattr(presentations, "is_agent_free", lambda entry: False)
    app = FastAPI()
    app.include_router(presentations.router)
    save_settings(WorkspaceSettings(slides_enabled=True))
    c = TestClient(app, headers={"Authorization": "Bearer " + token})
    c.owner = owner
    yield c
    save_settings(WorkspaceSettings(slides_enabled=False))


def _body(tool="15", output="x" * 500, key="ppt-request-1", history="hist-1"):
    return {"request_key": key, "tool_id": tool, "tool_name": "阅读课教学设计",
            "history_id": history, "title": "阅读课", "input": "原文", "output": output,
            "theme": "paper"}


def test_from_tool_creates_hidden_presentation_run(client):
    r = client.post("/api/presentations/from-tool", json=_body())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "queued"
    assert data["blueprint"] == "reading"
    with SessionLocal() as db:
        task = db.get(WorkspaceTask, data["task_id"])
        assert task.origin == "tool" and task.source_tool == "15"
        assert json.loads(task.config)["output"] == "slides"
        run = db.get(WorkspaceRun, data["run_id"])
        assert run.mode == "presentation"
        assert json.loads(run.snapshot)["presentation"]["blueprint"] == "reading"


def test_from_tool_is_idempotent_for_same_output(client):
    a = client.post("/api/presentations/from-tool", json=_body(key="ppt-request-a", history="h1")).json()
    b = client.post("/api/presentations/from-tool", json=_body(key="ppt-request-b", history="h1")).json()
    assert a["task_id"] == b["task_id"]


def test_from_tool_rejects_unsupported_tool_and_short_output(client):
    assert client.post("/api/presentations/from-tool", json=_body(tool="13")).status_code == 400
    body = _body(output="short")
    assert client.post("/api/presentations/from-tool", json=body).status_code == 422


def test_job_completes_and_exports(client, monkeypatch):
    data = client.post("/api/presentations/from-tool", json=_body()).json()
    deck = json.loads((Path(__file__).parent / "fixtures" / "slides" / "reading.json").read_text())
    async def model(cfg, name, messages, schemas, budget, emit, **kwargs):
        raw = json.dumps(deck, ensure_ascii=False)
        await emit("output", raw)
        return llm.ModelResult(content=raw)
    monkeypatch.setattr(runner, "_load_cfg", lambda: {})
    asyncio.run(runner.execute_run(data["run_id"], model))
    r = client.get(f"/api/presentations/{data['task_id']}")
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "completed"
    assert job["version"]["slides"] == 11
    scene = client.get(f"/api/presentations/{data['task_id']}/scene")
    assert scene.status_code == 200, scene.text
    assert len(scene.json()["scene"]["slides"]) == 11
    export = client.get(f"/api/presentations/{data['task_id']}/export")
    assert export.status_code == 200, export.text
    assert export.content[:2] == b"PK"


def test_job_status_and_owner_guard(client):
    data = client.post("/api/presentations/from-tool", json=_body()).json()
    r = client.get(f"/api/presentations/{data['task_id']}")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued"
    # A code from another owner must not read it.
    from app.database import SessionLocal
    from app.models import UsageCode
    from app.services.usage_code import issue_token
    with SessionLocal() as db:
        other = UsageCode(code="OTHER-" + data["task_id"][:8], quota=2, is_enabled=True)
        db.add(other)
        db.commit()
        token = issue_token(other)
    r = client.get(f"/api/presentations/{data['task_id']}", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 404
