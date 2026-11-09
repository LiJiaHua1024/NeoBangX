"""Deck writer: one model call turns a teaching result into deck JSON.

The writer never sees a browser. It gets the source material, the blueprint
contract and a layout catalog; the compiler/checker is the visual guard.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .blueprints import BLUEPRINTS
from .check import check
from .compile import compile_deck
from .schema import DeckError, normalize_deck
from .themes import THEMES

MAX_SOURCE_CHARS = 80000

DECK_WRITER_SYSTEM = """你是 NeoBangX 的课堂演示文稿写作者。你只做一件事：把已经生成好的英语教学结果，整理成一份可直接上课的 PPT 内容稿。

硬规则：
1. 只使用来源材料里的事实、引文、答案和例子；不重新出题，不补写原文，不虚构学生答案。引文逐字保留；来源没有的内容宁可不写。
2. slide 是双语的：教学指令、审题、注释、错因、任务说明、出口票用中文；英语语篇、问题、选项、词块、例句、范文、sentence frames 用英文。不要逐字翻译整段英文。
3. 每一页都要有中文 speaker notes，写教师怎么讲、答案是什么、大概几分钟；notes 不重复整页正文。
4. 按给定 blueprint 的页数和必选页组织；先保证教学链完整，再加装饰性页。页数不够时删可选页，不删答案/任务/出口票。
5. 视觉由固定版式决定：你只填内容，不写坐标、颜色、HTML、Markdown 表格或图片。每页只表达一个教学动作。
6. 输出必须是符合给定 JSON schema 的 JSON；不要 markdown fence，不要解释。
"""

LAYOUT_GUIDE = """可用 layout 与字段（只填需要的字段；文本里的 **粗体** 和 ==强调色== 可用）：

cover: kicker, title（可含换行）, subtitle, question, meta
objectives: kicker, title, lead, items[{level,objective,criterion}], target
pre_reading: kicker, title, lead, provocation, prompts[3], note, frames, focus
text_structure: kicker, title, stages[3]{label,title,quote,ref,signal}, takeaway
passage: kicker, title, source, passage, first_read[3], annotations[4]{label,text}, takeaway, staged:true
language: kicker, title, items[4]{chunk,meaning,example}, task
questions: kicker, title, items[3]{level,question,support,answer}, staged:true
task: kicker, title, brief[4]{label,text}, support, criteria[3], model, outline
summary: kicker, title, takeaways[3], closure, model, prompts[2], selfcheck, minutes, handin
story: kicker, title, story, prompts[3], starters[2], note
six_w: kicker, title, items[6]{label,text,evidence}, prompt
plot: kicker, title, nodes[6]{event,emotion,evidence}, note
plan: kicker, title, label, note, paragraphs[2]{label,function,points[3],emotional}, clues
support: kicker, title, items[4]{label,chunks,model}, note
writing: kicker, title, starters[2], checklist[3], skeleton, prewrite[3], meta
model: kicker, title, label, text, highlights[], notice[2], annotations[3]{label,text}
closing: kicker, title, body, checklist[3], quote, source, homework, peer
grammar: kicker, title, rows[{label,left,right}], trap, note
exam: kicker, title, meta, stem, options[4]{key,text,correct}, answer, evidence, why, trap, pattern, staged:true"""

DECK_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "teaching_deck",
        "strict": False,
        "schema": {
            "type": "object",
            "required": ["format", "design", "blueprint", "title", "slides"],
            "properties": {
                "format": {"type": "string", "const": "nbx-slides/1"},
                "design": {
                    "type": "object",
                    "required": ["pack", "theme", "design_version"],
                    "properties": {
                        "pack": {"type": "string"},
                        "theme": {"type": "string", "enum": sorted(THEMES)},
                        "design_version": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "blueprint": {"type": "string", "enum": sorted(BLUEPRINTS)},
                "title": {"type": "string"},
                "subtitle": {"type": "string"},
                "meta": {"type": "object"},
                "slides": {
                    "type": "array", "minItems": 1, "maxItems": 20,
                    "items": {
                        "type": "object",
                        "required": ["layout"],
                        "properties": {
                            "layout": {"type": "string", "enum": [
                                "cover", "objectives", "pre_reading", "text_structure", "passage",
                                "language", "questions", "task", "summary", "story", "six_w",
                                "plot", "plan", "support", "writing", "model", "closing",
                                "grammar", "exam",
                            ]},
                            "title": {"type": "string"},
                            "kicker": {"type": "string"},
                            "notes": {"type": "string"},
                            "notes_prompt": {"type": "string"},
                            "notes_reveal": {"type": "string"},
                            "staged": {"type": "boolean"},
                        },
                        "additionalProperties": True,
                    },
                },
            },
            "additionalProperties": True,
        },
    },
}


def _schema_unsupported(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(token in text for token in ("response_format", "json_schema", "json schema",
                                            "structured output", "not supported", "unsupported"))


async def _call_writer(runner, messages, source):
    try:
        return await runner.call("演示文稿写作", messages, role="writer",
                                 source=source, response_format=DECK_SCHEMA)
    except Exception as exc:
        if not _schema_unsupported(exc):
            raise
        # Some OpenAI-compatible providers reject response_format. One plain
        # JSON attempt is cheaper than failing the whole deck.
        messages = messages + [{"role": "user", "content":
            "当前模型不支持结构化输出；请只返回符合前面字段说明的 JSON，不要 markdown fence。"}]
        return await runner.call("演示文稿写作（纯 JSON）", messages, role="writer",
                                 source=source, response_format=None)


class DeckGenerationError(ValueError):
    def __init__(self, message: str, errors: list[str] | None = None):
        super().__init__(message)
        self.errors = errors or [message]


def _strip_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        raise DeckGenerationError("写作者没有返回 JSON")
    return text[a:b + 1]


def _source_text(materials: list[dict]) -> str:
    parts = []
    for m in materials:
        content = str(m.get("content") or "")
        parts.append(f"【{m.get('name') or '材料'}】\n{content}")
    source = "\n\n".join(parts)
    if len(source) > MAX_SOURCE_CHARS:
        raise DeckGenerationError(f"来源材料 {len(source)} 字，超过单次生成上限 {MAX_SOURCE_CHARS} 字；请分段生成")
    return source


def _user_prompt(*, title: str, instruction: str, source: str, blueprint: str,
                 theme: str, base_deck: dict | None, repair: list[str] | None) -> str:
    bp = BLUEPRINTS[blueprint]
    lines = [
        f"成果标题：{title}",
        f"blueprint：{blueprint}（{bp['name']}）",
        f"主题：{theme}",
        f"展开后页数：{bp['min_pages']}–{bp['max_pages']} 页；必选页：{', '.join(sorted(bp['required']))}",
        f"用户要求：{instruction or '按来源材料组织一堂完整的课'}",
        "",
        LAYOUT_GUIDE,
        "",
        "来源材料：",
        source,
    ]
    if base_deck:
        lines += ["", "当前 deck（请保留仍然正确的页面和事实，按修改要求重做整份）：",
                  json.dumps(base_deck, ensure_ascii=False)[:60000]]
    if repair:
        lines += ["", "上一版已被编译器拒绝，必须修复以下问题后重新输出完整 JSON：",
                  "\n".join(f"- {e}" for e in repair)]
    lines += ["", "现在只输出 deck JSON。"]
    return "\n".join(lines)


def deck_provenance(*, blueprint: str, theme: str, instruction: str, material_ids: list[str],
                    source: str, base_version: str = "") -> dict:
    return {
        "blueprint": blueprint, "theme": theme, "instruction": instruction,
        "materials": material_ids, "base_version": base_version,
        "source_chars": len(source),
        "writer": {"system": "deck-writer-v1",
                   "source_sha256": hashlib.sha256(source.encode()).hexdigest()[:16]},
    }


async def generate_deck(runner, *, title: str, instruction: str, materials: list[dict],
                        blueprint: str, theme: str, base_deck: dict | None = None,
                        base_version: str = "") -> tuple[dict, dict, list[str], str]:
    """Return (normalized deck, scene, warnings, raw_content)."""
    if blueprint not in BLUEPRINTS:
        raise DeckError(f"未知 blueprint：{blueprint}")
    if theme not in THEMES:
        raise DeckError(f"未知主题：{theme}")
    source = _source_text(materials)
    user = _user_prompt(title=title, instruction=instruction, source=source, blueprint=blueprint,
                        theme=theme, base_deck=base_deck, repair=None)
    messages = [{"role": "system", "content": DECK_WRITER_SYSTEM},
                {"role": "user", "content": user}]
    result, entry = await _call_writer(runner, messages, f"deck:{base_version or 'new'}")
    raw = result.content or ""
    deck, scene, warnings, raw = _accept(raw, title=title, blueprint=blueprint, theme=theme)
    errors = [w for w in warnings if w.startswith("ERROR:")]
    if not errors:
        return deck, scene, warnings, raw

    # One repair only. Keep the same source and append the exact compiler errors.
    repair = [e[7:] for e in errors if e.startswith("ERROR:")]
    messages = [{"role": "system", "content": DECK_WRITER_SYSTEM},
                {"role": "user", "content": _user_prompt(
                    title=title, instruction=instruction, source=source, blueprint=blueprint,
                    theme=theme, base_deck=base_deck, repair=repair)},
                {"role": "assistant", "content": raw},
                {"role": "user", "content": "请修复上面列出的排版/结构错误，重新输出完整 JSON。只输出 JSON。"}]
    result, entry = await _call_writer(runner, messages,
                                       f"deck:{base_version or 'new'}:repair")
    raw = result.content or ""
    deck, scene, warnings, raw = _accept(raw, title=title, blueprint=blueprint, theme=theme)
    errors = [w for w in warnings if w.startswith("ERROR:")]
    if errors:
        raise DeckGenerationError("演示文稿排版未通过检查", [e[7:] for e in errors])
    return deck, scene, warnings, raw


def _accept(raw: str, *, title: str, blueprint: str, theme: str):
    try:
        data = json.loads(_strip_json(raw))
        data["title"] = data.get("title") or title
        data.setdefault("blueprint", blueprint)
        data.setdefault("design", {"pack": "builtin", "theme": theme, "design_version": "2026-11"})
        deck = normalize_deck(data)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise DeckGenerationError(f"deck JSON 不合法：{exc}") from exc
    scene = compile_deck(deck)
    errors, warnings = check(scene)
    messages = [f"ERROR: 第 {n} 页 {label} 实测 {width:.2f}×框宽 / {height:.2f}×框高"
                for n, label, width, height, _ in errors]
    messages += [f"WARN: 第 {n} 页 {label} 接近边界 {width:.2f}×{height:.2f}"
                 for n, label, width, height, _ in warnings]
    for i, slide in enumerate(deck["slides"]):
        if not str(slide.get("notes") or "").strip():
            messages.append(f"WARN: 第 {i + 1} 页缺少中文备注")
    messages += [f"WARN: {w}" for w in scene.get("warnings", [])]
    return deck, scene, messages, raw


DECK_REVIEW_POLICY = """你是英语课堂演示文稿的审阅者。按下面五条给意见，只输出 REVIEW_SCHEMA 的 JSON：
1. 教学功能：是否覆盖这堂课的目标、文本证据、答案、任务和出口票；有没有“好看但不上课”的页。
2. 信息效率：有没有空页、重复页、只有口号没有内容；payload 是否足够。
3. 可读性：标题/正文/注释层级是否清楚；中英混排是否自然；有没有把答案印在问题页。
4. 一致性：引文是否逐字、时态是否一致、术语/人物/情节是否前后一致。
5. 版式适配：内容是否适合该 layout；有没有明显该拆页/删页的地方。
每条 issue 的 quote 写“第 N 页 + 原文”，problem 写教学上的问题，evidence 写来源依据，fix 写具体怎么改。
这是演示文稿：修改必须建议调用 revise_presentation，不要建议 revise_document。
"""


def _flatten(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        out = []
        for item in value:
            out.extend(_flatten(item))
        return out
    if isinstance(value, dict):
        out = []
        for key, item in value.items():
            if key in {"layout", "notes", "staged"}:
                continue
            out.extend(_flatten(item))
        return out
    return []


def outline(deck: dict, include_notes: bool = True) -> str:
    """Compact human/agent-readable outline used by read_presentation and review."""
    lines = [f"{deck.get('title', '')} · {deck.get('blueprint', '')} · {len(deck.get('slides', []))} 页"]
    for i, slide in enumerate(deck.get("slides", []), 1):
        head = slide.get("title") or slide.get("kicker") or slide.get("layout", "")
        lines.append(f"\n第 {i} 页 · {slide.get('layout', '')} · {head}")
        for key, value in slide.items():
            if key in {"layout", "title", "kicker", "notes", "staged"}:
                continue
            text = " / ".join(x.strip() for x in _flatten(value) if x.strip())
            if text:
                lines.append(f"{key}: {text[:1500]}")
        if include_notes and slide.get("notes"):
            lines.append(f"notes: {str(slide['notes'])[:1500]}")
    return "\n".join(lines)[:40000]


def deck_warnings(scene: dict, check_warnings: list[str] | None = None) -> list[str]:
    out = list(scene.get("warnings") or [])
    out += list(check_warnings or [])
    return out
