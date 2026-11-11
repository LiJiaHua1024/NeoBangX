"""Strict, small schema for the deck JSON written by the deck writer.

The LLM-facing JSON Schema is intentionally flat (one slide object with optional
fields); this module performs the semantic checks the model cannot be trusted
with: known layouts, blueprint requirements, page budget, text sizes and hard
length caps. Keeping this separate from compile.py means a bad deck is rejected
before any version is saved.

字段契约（SLIDE_FIELDS）是内容字段形状的唯一事实源：writer 看到的字段说明由
render_layout_guide() 从这里渲染，normalize_slide() 也按它做宽容归一化——模型把
passage 写成段落数组、把 minutes 写成数字、漏掉 prompts，都在进编译层之前被
展平/补默认值。编译层因此永远拿得到它假定的形状，TypeError/KeyError 不会再裸
抛到工具结果里。
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .blueprints import BLUEPRINTS, MAX_UNITS, REVEAL_LAYOUTS, page_budget
from .themes import THEMES

# ---------------------------------------------------------------------------
# 字段契约
# ---------------------------------------------------------------------------
# 条目形状（顺序即写作者看到的顺序）：
#   ("name",)                  文本
#   ("name", n)                文本列表，n 为条数提示（None 表示不限条数）
#   ("name", n, {key: kind})   对象列表；键的 kind：None=文本，整数=文本列表
#                              （该键的条数提示），"flag"=布尔标志（不转文本）

SLIDE_FIELDS: dict[str, list[tuple]] = {
    "cover": [("kicker",), ("title",), ("tag",), ("subtitle",), ("question",), ("meta",)],
    "objectives": [("kicker",), ("title",), ("lead",),
                   ("items", 3, {"level": None, "objective": None, "criterion": None}),
                   ("target",)],
    "pre_reading": [("kicker",), ("title",), ("lead",), ("provocation",), ("prompts", 3),
                    ("note",), ("frames",), ("focus",)],
    "text_structure": [("kicker",), ("title",),
                       ("stages", 3, {"label": None, "title": None, "quote": None,
                                      "ref": None, "signal": None}),
                       ("takeaway",)],
    "passage": [("kicker",), ("title",), ("source",), ("passage",), ("highlight",),
                ("first_read", 3), ("annotations", 4, {"label": None, "text": None}),
                ("takeaway",)],
    "language": [("kicker",), ("title",),
                 ("items", 4, {"chunk": None, "meaning": None, "example": None}),
                 ("task",), ("answer",)],
    "questions": [("kicker",), ("title",),
                  ("items", 3, {"level": None, "question": None, "support": None,
                                "answer": None})],
    "task": [("kicker",), ("title",), ("brief", 4, {"label": None, "text": None}),
             ("support", 3), ("criteria", 3), ("model",), ("outline",)],
    "summary": [("kicker",), ("title",), ("takeaways", 3), ("closure",), ("ticket_check",),
                ("handin",), ("model",), ("prompts", 2), ("selfcheck",), ("minutes",)],
    "story": [("kicker",), ("title",), ("story",), ("prompts", 3), ("starters", 2), ("note",)],
    "six_w": [("kicker",), ("title",), ("items", 6, {"label": None, "text": None,
                                                     "evidence": None}),
              ("prompt",)],
    "plot": [("kicker",), ("title",), ("nodes", 6, {"event": None, "emotion": None,
                                                    "evidence": None}),
             ("note",)],
    "plan": [("kicker",), ("title",), ("label",), ("note",),
             ("paragraphs", 2, {"label": None, "function": None, "points": 3,
                                "emotional": None}),
             ("clues",)],
    "support": [("kicker",), ("title",), ("items", 4, {"label": None, "chunks": None,
                                                       "model": None}),
                ("note",)],
    "writing": [("kicker",), ("title",), ("starters", 2), ("checklist", 3), ("skeleton",),
                ("prewrite", 3), ("meta",)],
    "model": [("kicker",), ("title",), ("label",), ("text",), ("highlights", None),
              ("notice", 2), ("annotations", 3, {"label": None, "text": None})],
    "closing": [("kicker",), ("title",), ("body",), ("checklist", 3), ("quote",),
                ("attribution",), ("source",), ("homework",), ("peer",)],
    "grammar": [("kicker",), ("title",), ("rows", None, {"label": None, "left": None,
                                                         "right": None}),
                ("trap",), ("note",)],
    "exam": [("kicker",), ("title",), ("meta",), ("stem",),
             ("options", 4, {"key": None, "text": None, "correct": "flag"}),
             ("answer",), ("evidence",), ("why",), ("trap",), ("pattern",)],
}

# 少数字段需要一句形状提示，渲染进 writer 的字段说明
FIELD_NOTES = {("cover", "title"): "（可含换行）"}

# slide 级公共字段：随 layout 归一化为文本
BASE_TEXT_FIELDS = ("notes", "notes_prompt", "notes_reveal")

LAYOUTS = set(SLIDE_FIELDS)

# 绝对安全网，真正的页数契约是 blueprint×units 的区间校验。
MAX_SLIDES = 80
MAX_TITLE = 200
MAX_NOTES = 4000


def render_layout_guide() -> str:
    """从字段契约渲染 writer 看到的字段说明；契约改了说明必跟着改。"""
    lines = ["可用 layout 与字段（只填需要的字段；文本里的 **粗体** 和 ==强调色== 可用；"
             "passage/questions/exam 标 staged:true 时展开为「提问页＋揭晓页」两张，计入页数）：",
             "字段形状：无括号=单个文本；[n]=文本列表写 n 条左右；[]=文本列表条数不限；"
             "{…}=对象列表，键为文本，键[n]=该键是文本列表。",
             ""]
    for layout, entries in SLIDE_FIELDS.items():
        parts = [_render_entry(entry, layout) for entry in entries]
        if layout in REVEAL_LAYOUTS:
            parts.append("staged:true")
        lines.append(f"{layout}: " + ", ".join(parts))
    return "\n".join(lines)


def _render_entry(entry: tuple, layout: str) -> str:
    name = entry[0]
    if len(entry) == 1:
        return name + FIELD_NOTES.get((layout, name), "")
    if len(entry) == 2:
        return f"{name}[{entry[1]}]" if entry[1] else f"{name}[]"
    count, keys = entry[1], entry[2]
    head = f"{name}[{count}]" if count else name
    inner = ",".join(k if kind is None or kind == "flag" else f"{k}[{kind}]"
                     for k, kind in keys.items())
    return f"{head}{{{inner}}}"


# ---------------------------------------------------------------------------
# 归一化：任意形状 → 编译层假定的形状
# ---------------------------------------------------------------------------

def to_text(value: Any) -> str:
    """任意形状 → 文本：标量 str()，列表/对象递归展平后用换行连接。"""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "\n".join(t for t in (to_text(v) for v in value) if t)
    if isinstance(value, dict):
        return "\n".join(t for t in (to_text(v) for v in value.values()) if t)
    return str(value)


def _flag(value: Any) -> bool:
    """布尔标志（staged/reveal/correct）：字符串 "false" 不算真。"""
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y", "是"}
    return bool(value)


def _field_value(value: Any) -> Any:
    # 布尔是标志位，保持原样；渲染层自己会转文本。
    return value if isinstance(value, bool) else to_text(value)


def _text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (int, float, bool)):
        return [to_text(value)]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_text_list(item))
        return out
    text = to_text(value)
    return [text] if text else []


# 对象列表里混进标量时，优先放进这些键（按「最可能是正文」排序）
_ITEM_FALLBACK_KEYS = ("text", "title", "objective", "question", "quote", "meaning",
                       "chunks", "label")


def _item_list(value: Any, keys: dict) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        value = [value]
    out = []
    for raw in value:
        if not isinstance(raw, dict):
            text = to_text(raw)
            target = next((k for k in _ITEM_FALLBACK_KEYS if k in keys),
                          next(iter(keys), "text"))
            item = {k: (False if kind == "flag" else [] if kind is not None else "")
                    for k, kind in keys.items()}
            item[target] = text
            out.append(item)
            continue
        item = {}
        for key, kind in keys.items():
            if kind == "flag":
                item[key] = _flag(raw.get(key))
            elif kind is not None:
                item[key] = _text_list(raw.get(key))
            else:
                item[key] = _field_value(raw.get(key))
        for key, value_ in raw.items():
            if key not in item:
                item[key] = _plain(value_)
        out.append(item)
    return out


def _plain(value: Any) -> Any:
    """未知字段：保留结构与布尔，标量叶子转文本，渲染层永远拿得到文本。"""
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    return value


def normalize_slide(slide: dict) -> dict:
    """按字段契约把一页展平成编译层假定的形状；未知字段保留并做叶子 str 化。"""
    entries = SLIDE_FIELDS.get(slide.get("layout"), [])
    out: dict[str, Any] = {"layout": slide.get("layout")}
    known = {"layout", "staged", "reveal"}
    for entry in entries:
        name = entry[0]
        known.add(name)
        if len(entry) == 1:
            out[name] = _field_value(slide.get(name))
        elif len(entry) == 2:
            out[name] = _text_list(slide.get(name))
        else:
            out[name] = _item_list(slide.get(name), entry[2])
    for name in BASE_TEXT_FIELDS:
        known.add(name)
        out[name] = to_text(slide.get(name))
    if "staged" in slide:
        out["staged"] = _flag(slide.get("staged"))
    if "reveal" in slide:
        out["reveal"] = _flag(slide.get("reveal"))
    for key, value in slide.items():
        if key not in known:
            out[key] = _plain(value)
    return out


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
    """kind=structural 的错误可以靠改 instruction/units/blueprint 修复；
    kind=generation 的错误是 writer 输出问题，调用方原样重试没有意义。"""

    def __init__(self, message: str, details: list[str] | None = None,
                 kind: str = "generation"):
        super().__init__(message)
        self.details = details or [message]
        self.kind = kind


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
    if "title" in raw:
        raw["title"] = to_text(raw["title"])
    if "subtitle" in raw:
        raw["subtitle"] = to_text(raw["subtitle"])
    if "meta" in raw and not isinstance(raw["meta"], dict):
        raw["meta"] = {"text": to_text(raw["meta"])} if raw["meta"] else {}
    if not raw.get("blueprint"):
        raw["blueprint"] = _infer_blueprint(raw.get("slides") or [])
    # 页数/单元数超界时先给带出路的错误，而不是让 pydantic 抛没有数字的"结构不合法"。
    slides = raw.get("slides")
    if not isinstance(slides, list) or not slides:
        raise DeckError("slides 必须是非空数组")
    if len(slides) > MAX_SLIDES:
        raise DeckError(f"slides 有 {len(slides)} 页，超过单份演示文稿的绝对上限 {MAX_SLIDES} 页；"
                        f"请压缩每个语篇的页数；内容确实超出时可分多次调用生成")
    for i, slide in enumerate(slides):
        if not isinstance(slide, dict):
            raise DeckError(f"第 {i + 1} 页必须是对象")
        if slide.get("layout") not in SLIDE_FIELDS:
            raise DeckError(f"第 {i + 1} 页 layout 未知：{slide.get('layout')!r}")
    # 字段形状归一化：错误类型/缺字段在这里消化，编译层只管画。
    raw["slides"] = [normalize_slide(slide) for slide in slides]
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
            data[key] = _plain(value)
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
                        f"补上对应版式的页面，或改用必选页更少的 blueprint", kind="structural")
    units = deck_units(deck)
    lo, hi = page_budget(blueprint, units)
    count = expanded_count(deck)
    if count > hi:
        raise DeckError(f"{bp['name']} 展开后 {count} 页，超过 units={units} 时的上限 {hi} 页"
                        f"（staged:true 按 2 页计）；核对 units 是否等于覆盖的语篇数，"
                        f"或删可选页精简内容", kind="structural")
    if count < lo:
        raise DeckError(f"{bp['name']} 展开后 {count} 页，低于 units={units} 时的下限 {lo} 页；"
                        f"请补齐必选页和教学环节", kind="structural")
    if deck.get("design", {}).get("theme") not in THEMES:
        raise DeckError("未知主题")
