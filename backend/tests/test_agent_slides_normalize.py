"""归一化回归：事故形态的 deck（类型错位 / 缺字段）必须干净地编译。

来源：2026-11 事故——writer 把 passage 写成段落数组、minutes 写成数字、漏掉
prompts，编译层直接把 TypeError/KeyError 裸抛进工具结果（"expected string or
bytes-like object, got 'int'"、"'prompts'"），对调度层毫无行动价值，只能盲目
重试。这些用例锁住边界归一化：错误形状在进编译层之前被消化。
"""
import json
from pathlib import Path

import pytest

from app.agent_workspace.slides.check import check
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.metrics import as_text
from app.agent_workspace.slides.schema import (LAYOUTS, SLIDE_FIELDS, normalize_deck,
                                               render_layout_guide)

FIX = Path(__file__).parent / "fixtures" / "slides"


def base_deck():
    return json.loads((FIX / "reading.json").read_text(encoding="utf-8"))


def test_layout_guide_is_generated_from_the_field_contract():
    """字段说明由契约渲染：layout 与字段都不许漂移。"""
    guide = render_layout_guide()
    assert set(SLIDE_FIELDS) == LAYOUTS
    for layout, entries in SLIDE_FIELDS.items():
        line = next((l for l in guide.splitlines() if l.startswith(layout + ":")), None)
        assert line, f"字段说明缺少 {layout}"
        for entry in entries:
            assert entry[0] in line, f"{layout} 的字段 {entry[0]} 没进字段说明"
        if layout in {"passage", "questions", "exam"}:
            assert "staged:true" in line


def test_accident_shapes_compile_without_throwing():
    """事故形态逐条：数组当文本、数字当文本、缺字段——编译通过且不溢出。"""
    deck = base_deck()
    for slide in deck["slides"]:
        if slide["layout"] == "passage":
            slide["passage"] = ["Para one.", "Para two."]      # 段落列表而非整段文本
        if slide["layout"] == "summary":
            slide["minutes"] = 30                              # 数字而非文本
        if slide["layout"] == "pre_reading":
            slide.pop("prompts", None)                         # 缺 prompts（曾 KeyError 'prompts'）
        if slide["layout"] == "text_structure":
            slide["stages"][0]["quote"] = 42                   # 对象值里的数字
            slide["stages"][0].pop("signal", None)             # 对象里缺字段
    data = normalize_deck(deck)
    scene = compile_deck(data)
    errors, _warnings = check(scene)
    assert not errors, errors

    by_layout = {s["layout"]: s for s in data["slides"]}
    assert by_layout["passage"]["passage"] == "Para one.\nPara two."
    assert by_layout["summary"]["minutes"] == "30"
    assert by_layout["pre_reading"]["prompts"] == []
    assert by_layout["text_structure"]["stages"][0]["quote"] == "42"
    assert by_layout["text_structure"]["stages"][0]["signal"] == ""


def test_scalar_and_nested_shapes_flatten_predictably():
    deck = base_deck()
    for slide in deck["slides"]:
        if slide["layout"] == "pre_reading":
            slide["prompts"] = "单一问题被写成了字符串"       # str → 单元素列表
        if slide["layout"] == "questions":
            slide["items"] = ["没有对象，只有问题文本"]        # 标量 → 兜底键
        if slide["layout"] == "task":
            slide["support"] = [["嵌套", "列表"], "展平"]      # 嵌套列表 → 展平
        if slide["layout"] == "cover":
            slide["meta"] = 20                                 # 数字 → 文本
            slide["unknown_extra"] = {"a": [1, 2]}             # 未知字段叶子 str 化
    data = normalize_deck(deck)
    scene = compile_deck(data)
    errors, _ = check(scene)
    assert not errors, errors

    by_layout = {s["layout"]: s for s in data["slides"]}
    assert by_layout["pre_reading"]["prompts"] == ["单一问题被写成了字符串"]
    fallback = by_layout["questions"]["items"][0]
    assert fallback["question"] == "没有对象，只有问题文本"
    assert fallback["level"] == "" and fallback["support"] == ""
    assert by_layout["task"]["support"] == ["嵌套", "列表", "展平"]
    assert by_layout["cover"]["meta"] == "20"
    assert by_layout["cover"]["unknown_extra"] == {"a": ["1", "2"]}


def test_bool_flags_survive_normalization():
    """correct/staged 是标志位：字符串 "false" 不许变成真，布尔不许被转文本。"""
    deck = base_deck()
    deck["slides"] = [dict(s) for s in deck["slides"]]
    deck["slides"].append({"layout": "exam", "title": "题", "stem": "题干",
                           "options": [{"key": "A", "text": "对", "correct": True},
                                       {"key": "B", "text": "错", "correct": "false"}],
                           "answer": "A", "evidence": "e", "why": "w", "trap": "t",
                           "staged": "false"})
    data = normalize_deck(deck)
    options = data["slides"][-1]["options"]
    assert options[0]["correct"] is True
    assert options[1]["correct"] is False
    assert data["slides"][-1].get("staged") is False
    compile_deck(data)


def test_as_text_defensive_conversion():
    assert as_text("x") == "x"
    assert as_text(30) == "30"
    assert as_text(["a", 2]) == "a\n2"
    assert as_text(None) == ""
    assert as_text(True) == "true"
