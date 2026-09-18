"""试卷可视化全解：多道迁移块的解析 / 归一化、语篇编号复用，以及 Prompt 变量渲染。"""

from pathlib import Path

from app.services.prompt_loader import PromptLoader
from app.services.visual_paper import (
    normalize_visual_paper,
    parse_custom_visual_paper,
    validate_visual_paper,
)

# 迁移标签整块重复：这是"每题 N 道迁移"在文本契约里的唯一表达方式
_QUESTION_HEAD = """@@TOTAL@@ 1
@@PAPER@@ 测试卷
@@NOTICE@@ 
@@GROUP@@ reading|阅读理解 A篇|细节定位
@@Q@@ 1
@@QTYPE@@
choice
@@PASSAGE@@
Some English passage.
@@STEM@@
What does the author suggest?
@@OPTIONS@@
A. One
B. Two
C. Three
D. Four
@@ANSWER@@
B
@@EVIDENCE@@
Para 1: Some English passage.
@@REASON@@
定位首段
@@DISTRACTOR@@
A 项原词重现
@@PITFALLS@@
原词重现::学生看到同词就选，忽略上下文
@@PATTERN_NAME@@
细节定位
@@PATTERN_STEPS@@
定位关键词
比对原文
"""


def _transfer_block(idx: int, answer: str = "C") -> str:
    return f"""@@TRANSFER_PASSAGE@@
Transfer passage {idx}.
@@TRANSFER_STEM@@
Transfer stem {idx}?
@@TRANSFER_OPTIONS@@
A. a{idx}
B. b{idx}
C. c{idx}
D. d{idx}
@@TRANSFER_ANSWER@@
{answer}
@@TRANSFER_EXPL@@
解析 {idx}
"""


def _raw(*blocks: str, end: bool = True) -> str:
    text = _QUESTION_HEAD + "".join(blocks)
    return text + ("@@END_Q@@\n" if end else "")


def test_parse_repeated_transfer_blocks():
    data = parse_custom_visual_paper(_raw(_transfer_block(1, "C"), _transfer_block(2, "A")))
    q = data["groups"][0]["questions"][0]
    assert [t["answer"] for t in q["transfers"]] == ["C", "A"]
    assert [t["stem"] for t in q["transfers"]] == ["Transfer stem 1?", "Transfer stem 2?"]
    assert q["transfers"][1]["passage"] == "Transfer passage 2."
    assert q["transfers"][1]["options"][0] == {"label": "A", "text": "a2"}
    assert "transfer" not in q
    ok, errors = validate_visual_paper(data)
    assert ok, errors


def test_parse_block_without_passage_still_splits():
    """模型省略第二块的 TRANSFER_PASSAGE 直接写 STEM：字段重复即按新块切分。"""
    blocks = _transfer_block(1, "A") + "@@TRANSFER_STEM@@\nOnly stem?\n@@TRANSFER_ANSWER@@\nB\n"
    q = parse_custom_visual_paper(_raw(blocks))["groups"][0]["questions"][0]
    assert [t["stem"] for t in q["transfers"]] == ["Transfer stem 1?", "Only stem?"]
    assert [t["answer"] for t in q["transfers"]] == ["A", "B"]


def test_parse_stray_repeated_field_does_not_corrupt_block():
    """同一块里重复输出 EXPL：切出的空壳块（无 passage/stem/选项/答案）被丢弃。"""
    blocks = _transfer_block(1, "A") + "@@TRANSFER_EXPL@@\n重复的解析\n"
    q = parse_custom_visual_paper(_raw(blocks))["groups"][0]["questions"][0]
    assert len(q["transfers"]) == 1
    assert q["transfers"][0]["explanation"] == "解析 1"


def test_parse_single_transfer_block_unchanged():
    """单块输出（题量 1）与改造前的口径完全一致。"""
    data = parse_custom_visual_paper(_raw(_transfer_block(1, "D")))
    q = data["groups"][0]["questions"][0]
    assert len(q["transfers"]) == 1
    assert q["transfers"][0]["answer"] == "D"
    assert q["transfers"][0]["explanation"] == "解析 1"


def test_parse_without_transfer_and_truncated_question():
    """没输出迁移块时为空数组；无 @@END_Q@@ 的残片整题丢弃（组壳保留）。"""
    data = parse_custom_visual_paper(_raw())
    assert data["groups"][0]["questions"][0]["transfers"] == []
    truncated = parse_custom_visual_paper(_raw(_transfer_block(1), end=False))
    assert truncated["groups"][0]["questions"] == []


# ---- 语篇编号复用（@@PASSAGE_DEF@@ 声明一次 + @@PASSAGE_REF@@ 逐题引用） ----

def _def(ref: str, text: str) -> str:
    return f"@@PASSAGE_DEF@@ {ref}\n{text}\n"


def _ref_question(no: int, ref: str, qtype: str = "choice") -> str:
    return f"""@@Q@@ {no}
@@QTYPE@@ {qtype}
@@PASSAGE_REF@@ {ref}
@@STEM@@
Stem {no}?
@@OPTIONS@@
A. One
B. Two
@@ANSWER@@
A
@@EVIDENCE@@
{ref} evidence
@@REASON@@
理由 {no}
@@DISTRACTOR@@
干扰 {no}
@@PITFALLS@@
手法{no}::描述{no}
@@PATTERN_NAME@@
范式{no}
@@PATTERN_STEPS@@
步骤{no}
@@END_Q@@
"""


def _paper(body: str) -> str:
    return "@@TOTAL@@ 2\n@@PAPER@@ 测试卷\n@@NOTICE@@ \n" + body


def _questions(raw: str) -> list[dict]:
    return [q for g in parse_custom_visual_paper(raw)["groups"] for q in g["questions"]]


def test_passage_def_shared_by_same_group_questions():
    """同一篇只声明一次，后续题写编号：两题都拿到全文，正文只出现一遍。"""
    raw = _paper(
        "@@GROUP@@ reading|阅读理解 B篇|细节定位\n"
        + _def("P1", "Shared passage text.")
        + _ref_question(21, "P1")
        + _ref_question(22, "P1")
    )
    qs = _questions(raw)
    assert [q["passage"] for q in qs] == ["Shared passage text."] * 2
    assert [q["passageRef"] for q in qs] == ["P1", "P1"]
    assert not any(q.get("passageUnresolved") for q in qs)


def test_passage_ref_resolves_across_groups_and_out_of_order():
    """完形填空拆成多组共用同一编号；定义写在引用之后也能对上（收尾统一解析）。"""
    raw = _paper(
        "@@GROUP@@ cloze|完形填空|语境\n"
        + _ref_question(41, "P7")
        + "@@GROUP@@ cloze|完形填空（续）|语境\n"
        + _ref_question(42, "P7")
        + _def("P7", "Cloze passage text.")
    )
    assert [q["passage"] for q in _questions(raw)] == ["Cloze passage text."] * 2


def test_unresolved_ref_is_flagged_not_filled_with_other_passage():
    """编号没有对应声明：标记未解析并留空，绝不顶上一篇别的语篇。"""
    raw = _paper(
        "@@GROUP@@ reading|阅读理解 B篇|细节定位\n"
        + _def("P1", "First passage.")
        + _ref_question(21, "P1")
        + _ref_question(22, "P2")
    )
    qs = _questions(raw)
    assert qs[0]["passage"] == "First passage."
    assert qs[1]["passage"] == ""
    assert qs[1]["passageUnresolved"] is True
    assert qs[1]["passageRef"] == "P2"


def test_writing_ref_dash_means_no_passage():
    raw = _paper(
        "@@GROUP@@ writing_app|应用文写作|要点齐全\n" + _ref_question(61, "-", qtype="writing")
    )
    q = _questions(raw)[0]
    assert q["passage"] == ""
    assert q["passageRef"] == ""
    assert not q.get("passageUnresolved")


def test_duplicate_def_keeps_first_declaration():
    """同一编号被重复声明（模型重发全文）：保留首个，后写的忽略。"""
    raw = _paper(
        "@@GROUP@@ reading|阅读理解 B篇|细节定位\n"
        + _def("P1", "Original text.")
        + _ref_question(21, "P1")
        + _def("P1", "Duplicated text.")
        + _ref_question(22, "P1")
    )
    assert [q["passage"] for q in _questions(raw)] == ["Original text."] * 2


def test_legacy_inline_passage_still_parsed():
    """旧记录的内联 @@PASSAGE@@ 不受新契约影响，且不会被误标未解析。"""
    q = parse_custom_visual_paper(_raw(_transfer_block(1)))["groups"][0]["questions"][0]
    assert q["passage"] == "Some English passage."
    assert q["passageRef"] == ""
    assert not q.get("passageUnresolved")


def test_legacy_placeholder_inherits_previous_passage():
    """旧记录的「同上」仍沿用同组上一题正文（只作为历史兼容路径存在）。"""
    raw = _paper(
        "@@GROUP@@ reading|阅读理解 B篇|细节定位\n"
        "@@Q@@ 21\n@@QTYPE@@ choice\n@@PASSAGE@@\nFirst passage.\n@@END_Q@@\n"
        "@@Q@@ 22\n@@QTYPE@@ choice\n@@PASSAGE@@\n同上\n@@END_Q@@\n"
    )
    assert [q["passage"] for q in _questions(raw)] == ["First passage."] * 2


def test_ref_wins_over_inherited_placeholder_passage():
    """继承来的正文只是猜测：本题另有编号引用时以引用为准，避免显示错误的语篇。"""
    raw = _paper(
        "@@GROUP@@ reading|阅读理解 B篇|细节定位\n"
        "@@Q@@ 21\n@@QTYPE@@ choice\n@@PASSAGE@@\nFirst passage.\n@@END_Q@@\n"
        "@@Q@@ 22\n@@QTYPE@@ choice\n@@PASSAGE@@\n同上\n@@PASSAGE_REF@@ P9\n@@END_Q@@\n"
        + _def("P9", "Referenced passage.")
    )
    qs = _questions(raw)
    assert qs[0]["passage"] == "First passage."
    assert qs[1]["passage"] == "Referenced passage."


def test_normalize_upgrades_legacy_single_transfer():
    """旧记录/旧 JSON 里的单数 transfer 升级为数组，且不再保留旧字段。"""
    legacy_q = {
        "no": "1",
        "qtype": "choice",
        "stem": "s",
        "options": [],
        "reference": {"evidence": "", "reason": "", "distractor": ""},
        "pitfalls": [],
        "pattern": {"name": "范式", "steps": ["一步"]},
        "transfer": {"passage": "legacy", "stem": "legacy stem", "options": [], "answer": "A", "explanation": ""},
    }
    data = {
        "paper": {"title": "t"},
        "notice": "",
        "answerMap": {},
        "groups": [{"id": "reading", "title": "阅读", "intro": "", "questions": [legacy_q]}],
    }
    ok, errors = validate_visual_paper(data)
    assert ok, errors
    q = normalize_visual_paper(data)["groups"][0]["questions"][0]
    assert len(q["transfers"]) == 1
    assert q["transfers"][0]["passage"] == "legacy"
    assert "transfer" not in q


def test_normalize_drops_transfers_for_writing():
    data = {
        "paper": {"title": "t"},
        "notice": "",
        "answerMap": {},
        "groups": [{
            "id": "writing_app",
            "title": "写作",
            "intro": "",
            "questions": [{
                "no": "1",
                "qtype": "writing",
                "stem": "s",
                "options": [],
                "transfers": [{"passage": "x", "stem": "", "options": [], "answer": "", "explanation": ""}],
            }],
        }],
    }
    q = normalize_visual_paper(data)["groups"][0]["questions"][0]
    assert q["transfers"] == []


def test_prompt_loader_variable_rendering(tmp_path: Path):
    (tmp_path / "demo.md").write_text(
        "量：{{transfer_count}}；输入：{{user_input}}；未知名：{{unknown}}", encoding="utf-8"
    )
    loader = PromptLoader(tmp_path)
    # 显式传值（PromptLoader 按文件名去扩展名缓存）
    assert loader.render("demo", "材料", {"transfer_count": 3}) == (
        "量：3；输入：材料；未知名：{{unknown}}"
    )
    # 未传值 → 回落默认 1，不把裸占位符送给模型
    assert loader.render("demo", "材料").startswith("量：1；")
    # 用户输入里的同名占位符不被二次扫描替换
    assert loader.render("demo", "{{transfer_count}}").startswith("量：1；输入：{{transfer_count}}；")
