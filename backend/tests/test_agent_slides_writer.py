import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent_workspace import store
from app.agent_workspace.models import WorkspaceTask
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.schema import normalize_deck
from app.agent_workspace.slides.writer import generate_deck, outline

FIX = Path(__file__).parent / "fixtures" / "slides"


class FakeRunner:
    task_id = "task"

    def __init__(self, raw):
        self.raw = raw
        self.calls = []

    async def call(self, label, messages, **kwargs):
        self.calls.append((label, messages, kwargs))
        return SimpleNamespace(content=self.raw), "entry-1"


def test_generate_deck_accepts_valid_json_and_returns_scene():
    raw = (FIX / "reading.json").read_text(encoding="utf-8")
    runner = FakeRunner(raw)
    deck, scene, warnings, content = asyncio.run(generate_deck(
        runner, title="The Kiosk", instruction="阅读课", materials=[{"id": "m1", "name": "结果", "content": raw}],
        blueprint="reading", theme="paper"))
    assert deck["blueprint"] == "reading"
    assert len(scene["slides"]) == 11
    assert content == raw
    assert runner.calls[0][2]["response_format"]["type"] == "json_schema"
    assert "第 1 页" in outline(deck)


def test_generate_deck_rejects_missing_required_pages():
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    raw["slides"] = [s for s in raw["slides"] if s["layout"] != "task"]
    runner = FakeRunner(json.dumps(raw))
    with pytest.raises(Exception):
        asyncio.run(generate_deck(runner, title="x", instruction="", materials=[{"id": "m", "name": "x", "content": "x" * 100}],
                                  blueprint="reading", theme="paper"))


def test_save_slides_version_atomically_stores_scene(workspace_code):
    owner, _token = workspace_code("SLIDES-", quota=2)
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    deck = normalize_deck(raw)
    scene = compile_deck(deck)
    with store.SessionLocal() as db:
        task = WorkspaceTask(id=store.uid(), owner=owner, title="测试演示", config="{}")
        db.add(task)
        db.commit()
        task_id = task.id
    version = store.save_slides_version(task_id, "", "deck-test", "测试演示", deck, scene,
                                        provenance={"slide_count": len(scene["slides"]),
                                                    "blueprint": "reading", "theme": "paper",
                                                    "warnings": []})
    assert version["kind"] == "slides"
    assert version["slide_count"] == 11
    rend = store.rendition(version["id"], full=True)
    assert rend["scene"]["title"] == deck["title"]
    assert store.rendition(version["id"], full=False)["has_pptx"] is False
    with store.SessionLocal() as db:
        from app.agent_workspace.models import WorkspaceTask as T
        db.delete(db.get(T, task_id))
        db.commit()
