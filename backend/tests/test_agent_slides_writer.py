import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent_workspace import store
from app.agent_workspace.models import WorkspaceTask
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.schema import DeckError, expanded_count, normalize_deck
from app.agent_workspace.slides.writer import generate_deck, outline

FIX = Path(__file__).parent / "fixtures" / "slides"


class FakeRunner:
    """按调用次序返回结果；条目是 str 或 (content, finish_reason)，只有一份时每次都返回它。"""

    task_id = "task"

    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    async def call(self, label, messages, **kwargs):
        self.calls.append((label, messages, kwargs))
        item = self.results[min(len(self.calls) - 1, len(self.results) - 1)]
        raw, finish = item if isinstance(item, tuple) else (item, "stop")
        return SimpleNamespace(content=raw, finish_reason=finish), "entry-1"


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


def test_generate_deck_repairs_structural_error_in_one_retry():
    """缺必选页这类结构错误也要走一次修复，而不是直接把工具调用打死。"""
    good = (FIX / "reading.json").read_text(encoding="utf-8")
    bad = json.loads(good)
    bad["slides"] = [s for s in bad["slides"] if s.get("layout") != "task"]
    runner = FakeRunner(json.dumps(bad, ensure_ascii=False), good)
    deck, scene, warnings, _ = asyncio.run(generate_deck(
        runner, title="x", instruction="", materials=[{"id": "m", "name": "x", "content": "x" * 100}],
        blueprint="reading", theme="paper"))
    assert len(runner.calls) == 2
    repair_prompt = runner.calls[1][1][1]["content"]
    assert "必选页" in repair_prompt and "task" in repair_prompt
    assert len(scene["slides"]) == 11


def test_generate_deck_rejects_when_repair_fails():
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    raw["slides"] = [s for s in raw["slides"] if s["layout"] != "task"]
    runner = FakeRunner(json.dumps(raw))
    with pytest.raises(Exception) as exc:
        asyncio.run(generate_deck(runner, title="x", instruction="", materials=[{"id": "m", "name": "x", "content": "x" * 100}],
                                  blueprint="reading", theme="paper"))
    assert len(runner.calls) == 2  # 初稿 + 一次修复，之后如实失败
    assert "必选页" in str(exc.value)


def test_page_budget_error_guides_units_check():
    """超页数的报错要指向 units 口径，否则调度层只会删页数重试到天荒地老。"""
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    deck["blueprint"] = "generic_lesson"
    deck["slides"] = deck["slides"] * 2  # 18 raw / 22 expanded，单单元上限 16
    runner = FakeRunner(json.dumps(deck, ensure_ascii=False))
    with pytest.raises(Exception) as exc:
        asyncio.run(generate_deck(runner, title="x", instruction="全卷分析", materials=[{"id": "m", "name": "x", "content": "x" * 100}],
                                  blueprint="generic_lesson", theme="paper"))
    message = str(exc.value)
    assert "units=1" in message and "核对 units" in message
    assert len(runner.calls) == 2  # 修复机会用完后才失败


def test_whole_paper_deck_fits_scaled_budget():
    """整卷多语篇合并在一份演示文稿里：units 声明语篇数后页数预算扩展。"""
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    deck["blueprint"] = "generic_lesson"
    deck["units"] = 6
    deck["slides"] = deck["slides"] * 3  # 27 raw / 33 expanded，单单元超限、6 单元在预算内
    data = normalize_deck(deck)
    assert data["units"] == 6
    assert expanded_count(data) == 33


def test_generate_deck_continues_truncated_json():
    """大 deck 触及单次输出上限时接着写完，不从头重写。"""
    full = (FIX / "reading.json").read_text(encoding="utf-8")
    cut = full.index('"slides"')
    runner = FakeRunner((full[:cut], "length"), (full[cut:], "stop"))
    deck, scene, warnings, content = asyncio.run(generate_deck(
        runner, title="x", instruction="", materials=[{"id": "m", "name": "x", "content": "x" * 100}],
        blueprint="reading", theme="paper"))
    assert len(runner.calls) == 2
    assert runner.calls[1][0] == "演示文稿写作（续写 1）"
    assert len(scene["slides"]) == 11
    assert content == full


def test_too_many_slides_rejected_with_actionable_message():
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    raw["slides"] = raw["slides"] * 9  # 81 页，超过绝对上限
    with pytest.raises(DeckError) as exc:
        normalize_deck(raw)
    assert "绝对上限" in str(exc.value)


def test_expanded_page_budgets_match_contract():
    """预算契约：单单元用 blueprint 区间，每多一个单元 +3/+10，units 封顶 12。"""
    from app.agent_workspace.slides.blueprints import page_budget
    assert page_budget("generic_lesson", 1) == (1, 16)
    assert page_budget("generic_lesson", 6) == (16, 66)
    assert page_budget("reading", 2) == (10, 26)
    assert page_budget("generic_lesson", 99) == page_budget("generic_lesson", 12)
    deck = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    deck["blueprint"] = "generic_lesson"  # 9 raw / 11 expanded，单单元区间内
    assert expanded_count(normalize_deck(deck)) == 11


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
