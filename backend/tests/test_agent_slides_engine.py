import io
import json
from pathlib import Path

import pytest
from pptx import Presentation

from app.agent_workspace.slides.check import check
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.metrics import advance, fit
from app.agent_workspace.slides.pptx import build_pptx
from app.agent_workspace.slides.schema import DeckError, normalize_deck

FIX = Path(__file__).parent / "fixtures" / "slides"


def deck(name):
    return normalize_deck(json.loads((FIX / f"{name}.json").read_text(encoding="utf-8")))


@pytest.mark.parametrize("name,pages", [("reading", 11), ("continuation", 9), ("grammar", 3)])
def test_golden_decks_compile_check_and_export(name, pages):
    d = deck(name)
    scene = compile_deck(d)
    assert len(scene["slides"]) == pages
    errors, warnings = check(scene)
    assert not errors, errors
    assert not warnings, warnings
    data = build_pptx(scene)
    assert data[:2] == b"PK"
    prs = Presentation(io.BytesIO(data))
    assert len(prs.slides) == pages
    text = "\n".join(shape.text for slide in prs.slides for shape in slide.shapes if shape.has_text_frame)
    notes = "\n".join(slide.notes_slide.notes_text_frame.text for slide in prs.slides)
    if name in {"reading", "continuation"}:
        assert any("\u4e00" <= ch <= "\u9fff" for ch in text)
    assert any("\u4e00" <= ch <= "\u9fff" for ch in notes)
    assert all(not shape.shape_type == 13 for slide in prs.slides for shape in slide.shapes)  # no pictures


def test_cjk_advance_is_one_em_and_latin_uses_table():
    assert advance("中", "sans", 400, 18) == pytest.approx(18)
    assert advance("Hello", "sans", 400, 18) > 30


def test_payload_has_eight_percent_slack_and_sixteen_px_floor():
    fitted = fit("A" * 200, box_w=200, box_h=80, size=18, min_size=16,
                 label="body", width_ratio=0.92)
    assert fitted.size == 16
    assert fitted.overflow is True
    assert fitted.warnings


def test_staged_slides_expand_and_keep_notes():
    d = deck("reading")
    scene = compile_deck(d)
    reveals = [s for s in scene["slides"] if s["layout"] == "passage"]
    assert [s["reveal"] for s in reveals] == [False, True]
    assert all(s["notes"] for s in reveals)


def test_missing_required_reading_page_is_rejected():
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    raw["blueprint"] = "reading"
    raw["slides"] = [s for s in raw["slides"] if s["layout"] != "task"]
    with pytest.raises(DeckError):
        normalize_deck(raw)


def test_unknown_layout_is_rejected():
    raw = json.loads((FIX / "reading.json").read_text(encoding="utf-8"))
    raw["slides"][0]["layout"] = "hero"
    with pytest.raises(DeckError):
        normalize_deck(raw)
