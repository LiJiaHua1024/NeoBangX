"""PPT 桩的演示文稿素材：固定一份语法课 deck，走真实编译链路出 scene 与 PPTX。

假后端不需要模拟「模型写 deck」这一段——那属于被替换掉的 LLM 链路；
但 scene 与 .pptx 必须是真的，前端的预览渲染、翻页、备注、下载才有东西可验。
素材借的是 golden deck（`assets/mock-deck.json`，与 backend/tests/fixtures/slides/grammar.json
同一份），编译、检查、导出全部调用真实实现，不是手搓的假 JSON。
"""

from __future__ import annotations

import json
from pathlib import Path

from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.pptx import build_pptx
from app.agent_workspace.slides.schema import normalize_deck

DECK_PATH = Path(__file__).parent / "assets" / "mock-deck.json"

_cache: dict = {}


def _build() -> dict:
    if not _cache:
        deck = normalize_deck(json.loads(DECK_PATH.read_text(encoding="utf-8")))
        scene = compile_deck(deck)
        _cache["scene"] = scene
        _cache["pptx"] = build_pptx(scene)
    return _cache


def scene() -> dict:
    return _build()["scene"]


def pptx() -> bytes:
    return _build()["pptx"]
