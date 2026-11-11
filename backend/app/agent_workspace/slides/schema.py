"""Strict, small schema for the deck JSON written by the deck writer.

The LLM-facing JSON Schema is intentionally flat (one slide object with optional
fields); this module performs the semantic checks the model cannot be trusted
with: known layouts, blueprint requirements, page budget, text sizes and hard
length caps. Keeping this separate from compile.py means a bad deck is rejected
before any version is saved.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .blueprints import BLUEPRINTS, MAX_UNITS, REVEAL_LAYOUTS, page_budget
from .themes import THEMES

LAYOUTS = {
    "cover", "objectives", "pre_reading", "text_structure", "passage",
    "language", "questions", "task", "summary", "story", "six_w", "plot",
    "plan", "support", "writing", "model", "closing", "grammar", "exam",
}

# 绝对安全网，真正的页数契约是 blueprint×units 的区间校验。
MAX_SLIDES = 80
MAX_TITLE = 200
MAX_NOTES = 4000


class Design(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pack: str = "builtin"
    theme: str = "paper"
    design_version: str = "2026-11"


class Deck(BaseModel):
    # The prototype deck carries presentation hints such as `motif`; allow
    # top-level extras, while each slide's required fields are checked by the
    # compiler and the LLM schema.
    model_config = ConfigDict(extra="allow")
    format: str = "nbx-slides/1"
    design: Design = Field(default_factory=Design)
    blueprint: str = "reading"
    units: int = Field(1, ge=1)
    title: str = Field(..., min_length=1, max_length=MAX_TITLE)
    subtitle: str = Field("", max_length=300)
    meta: dict[str, Any] = Field(default_factory=dict)
    slides: list[dict[str, Any]] = Field(..., min_length=1, max_length=MAX_SLIDES)

    @field_validator("slides")
    @classmethod
    def check_slides(cls, slides):
        for i, slide in enumerate(slides):
            if not isinstance(slide, dict):
                raise ValueError(f"第 {i + 1} 页必须是对象")
            layout = slide.get("layout")
            if layout not in LAYOUTS:
                raise ValueError(f"第 {i + 1} 页 layout 未知：{layout!r}")
            if len(str(slide.get("title", ""))) > MAX_TITLE:
                raise ValueError(f"第 {i + 1} 页标题过长")
            if len(str(slide.get("notes", ""))) > MAX_NOTES:
                raise ValueError(f"第 {i + 1} 页备注过长")
            if slide.get("staged") and layout not in REVEAL_LAYOUTS:
                raise ValueError(f"第 {i + 1} 页不支持 staged：{layout}")
        return slides


class DeckError(ValueError):
    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.details = details or [message]


def _raw_theme(raw: dict) -> str:
    design = raw.get("design")
    if isinstance(design, dict) and design.get("theme"):
        return str(design["theme"])
    return str(raw.get("theme") or "paper")


def normalize_deck(raw: dict) -> dict:
    """Accept both the production `design` object and the prototype top-level
    `theme`; return a plain dict ready for compile.compile_deck."""
    if not isinstance(raw, dict):
        raise DeckError("deck 必须是 JSON 对象")
    raw = dict(raw)
    theme = _raw_theme(raw)
    if theme not in THEMES:
        raise DeckError(f"未知主题：{theme!r}")
    design = raw.get("design")
    if not isinstance(design, dict):
        design = {"pack": "builtin", "theme": theme, "design_version": "2026-11"}
    else:
        design = {**design, "theme": theme}
    raw["design"] = design
    raw["theme"] = theme
    raw.setdefault("format", "nbx-slides/1")
    if not raw.get("blueprint"):
        raw["blueprint"] = _infer_blueprint(raw.get("slides") or [])
    # 页数/单元数超界时先给带出路的错误，而不是让 pydantic 抛没有数字的"结构不合法"。
    slides = raw.get("slides")
    if not isinstance(slides, list) or not slides:
        raise DeckError("slides 必须是非空数组")
    if len(slides) > MAX_SLIDES:
        raise DeckError(f"slides 有 {len(slides)} 页，超过单份演示文稿的绝对上限 {MAX_SLIDES} 页；"
                        f"请压缩每个语篇的页数；内容确实超出时可分多次调用生成")
    units = raw.get("units")
    if units is None and isinstance(raw.get("meta"), dict):
        units = raw["meta"].get("units")
        if units is not None:
            raw["units"] = units
    if units is not None and (isinstance(units, bool) or not isinstance(units, int) or units < 1):
        raise DeckError("units 必须是不小于 1 的整数（本演示文稿覆盖的语篇/专题数）")
    try:
        deck = Deck.model_validate(raw)
    except ValidationError as exc:
        raise DeckError("deck 结构不合法", [str(e) for e in exc.errors()]) from exc
    data = deck.model_dump()
    for key, value in raw.items():
        if key not in data:
            data[key] = value
    data["theme"] = deck.design.theme
    # Preserve layout-specific fields Pydantic does not know about.
    data["slides"] = raw["slides"]
    _validate_blueprint(data)
    return data


def _infer_blueprint(slides: list) -> str:
    layouts = {s.get("layout") for s in slides if isinstance(s, dict)}
    if layouts & {"story", "six_w", "plan"}:
        return "continuation"
    if "grammar" in layouts:
        return "grammar"
    if "exam" in layouts:
        return "exam_review"
    if "questions" in layouts and "model" in layouts and "writing" not in layouts:
        return "writing_feedback"
    if layouts & {"passage", "text_structure", "pre_reading"}:
        return "reading"
    if layouts & {"writing", "model"}:
        return "writing"
    if "language" in layouts:
        return "vocabulary"
    return "generic_lesson"


def expanded_count(deck: dict) -> int:
    return sum(2 if s.get("staged") and s.get("layout") in REVEAL_LAYOUTS else 1
               for s in deck["slides"])


def deck_units(deck: dict) -> int:
    """写作者声明的教学单元数；缺失或非法时按 1 处理，预算按 MAX_UNITS 封顶。"""
    try:
        units = int(deck.get("units") or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(units, MAX_UNITS))


def _validate_blueprint(deck: dict):
    blueprint = deck.get("blueprint", "reading")
    bp = BLUEPRINTS.get(blueprint)
    if not bp:
        raise DeckError(f"未知 blueprint：{blueprint!r}")
    layouts = {s.get("layout") for s in deck["slides"]}
    missing = [x for x in bp["required"] if x not in layouts]
    if missing:
        raise DeckError(f"缺少 {bp['name']} 必选页：{', '.join(missing)}；"
                        f"补上对应版式的页面，或改用必选页更少的 blueprint")
    units = deck_units(deck)
    lo, hi = page_budget(blueprint, units)
    count = expanded_count(deck)
    if count > hi:
        raise DeckError(f"{bp['name']} 展开后 {count} 页，超过 units={units} 时的上限 {hi} 页"
                        f"（staged:true 按 2 页计）；核对 units 是否等于覆盖的语篇数，"
                        f"或删可选页精简内容")
    if count < lo:
        raise DeckError(f"{bp['name']} 展开后 {count} 页，低于 units={units} 时的下限 {lo} 页；"
                        f"请补齐必选页和教学环节")
    if deck.get("design", {}).get("theme") not in THEMES:
        raise DeckError("未知主题")
