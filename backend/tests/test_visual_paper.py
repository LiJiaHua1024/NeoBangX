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


def test_parse_drifted_main_tags_inside_transfer_block():
    """迁移块里的标签漂移：模型把迁移选项/答案/证据写成主题的 @@OPTIONS@@/@@ANSWER@@/@@EVIDENCE@@
    （实测多类模型都漂）。这些内容要改道进当前迁移草稿，原题已收的选项/答案/证据不得被覆盖。"""
    blocks = (
        "@@TRANSFER_PASSAGE@@\nTransfer passage 1.\n"
        "@@TRANSFER_STEM@@\nDrifted stem 1?\n"
        "@@OPTIONS@@\nA. drift-a1\nB. drift-b1\nC. drift-c1\nD. drift-d1\n"
        "@@ANSWER@@\nC\n"
        "@@EVIDENCE@@\nTransfer passage 1.\n"
        "@@TRANSFER_EXPL@@\n解析 1\n"
        "@@TRANSFER_PASSAGE@@\nTransfer passage 2.\n"
        "@@TRANSFER_STEM@@\nDrifted stem 2?\n"
        "@@OPTIONS@@\nA. drift-a2\nB. drift-b2\nC. drift-c2\nD. drift-d2\n"
        "@@ANSWER@@\nA\n"
        "@@TRANSFER_EXPL@@\n解析 2\n"
    )
    q = parse_custom_visual_paper(_raw(blocks))["groups"][0]["questions"][0]
    # 原题四维保持原值，不被任何迁移块顶掉
    assert [o["text"] for o in q["options"]] == ["One", "Two", "Three", "Four"]
    assert q["answer"] == "B"
    assert q["reference"]["evidence"] == "Para 1: Some English passage."
    # 漂移内容各自落进对应的迁移块
    assert [t["answer"] for t in q["transfers"]] == ["C", "A"]
    assert [t["options"][0]["text"] for t in q["transfers"]] == ["drift-a1", "drift-a2"]
    assert [len(t["options"]) for t in q["transfers"]] == [4, 4]
    assert [t["explanation"] for t in q["transfers"]] == ["解析 1", "解析 2"]
    data = parse_custom_visual_paper(_raw(blocks))
    ok, errors = validate_visual_paper(data)
    assert ok, errors


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


# ========== 续写轮次（input 已是 @@TAG@@ 文档再追加讲解）的合并语义 ==========

_SKELETON = """@@TOTAL@@ 1
@@PAPER@@ 测试卷
@@GROUP@@ reading|阅读理解 A 篇|
@@Q@@ 24
@@QTYPE@@ choice
@@PASSAGE_REF@@ -
@@STEM@@
Why did BART start the kiosk program?
@@OPTIONS@@
A. One
B. Two
C. Three
D. Four
@@END_Q@@
"""


def _transfer_text(passage: str, answer: str) -> str:
    return (
        "@@TRANSFER_PASSAGE@@\n"
        f"{passage}\n"
        "@@TRANSFER_STEM@@\n"
        "Transfer stem?\n"
        "@@TRANSFER_ANSWER@@\n"
        f"{answer}\n"
        "@@TRANSFER_EXPL@@\n"
        "解析\n"
    )


def test_group_redeclaration_reuses_existing_group():
    """续写轮次模型重发 @@GROUP@@ 头（字面常与骨架略有出入：空格、导语有无），
    必须复用既有分组——否则重开的题并回原组，新组沦为底部 0 题空分组。"""
    cont = (
        "@@GROUP@@ reading|阅读理解A篇|信息匹配类应用文，考查细节定位\n"
        "@@Q@@ 24\n@@ANSWER@@\nB\n@@END_Q@@\n"
    )
    data = parse_custom_visual_paper(_SKELETON + cont)
    assert len(data["groups"]) == 1, f"重声明不得新建分组：{[g['title'] for g in data['groups']]}"
    g = data["groups"][0]
    assert g["title"] == "阅读理解 A 篇"
    assert g["questions"][0]["answer"] == "B"
    # 原组没有导语时，重声明带来的导语补上
    assert g["intro"] == "信息匹配类应用文，考查细节定位"


def test_group_redeclaration_different_title_still_new_group():
    """同 id 不同标题仍是合法拆分（完形可按叙事分组），照旧新建。"""
    cont = "@@GROUP@@ reading|完形填空第二部分|\n@@Q@@ 25\n@@ANSWER@@\nC\n@@END_Q@@\n"
    data = parse_custom_visual_paper(_SKELETON + cont)
    assert [g["title"] for g in data["groups"]] == ["阅读理解 A 篇", "完形填空第二部分"]
    assert [len(g["questions"]) for g in data["groups"]] == [1, 1]


def test_group_intro_not_overwritten_on_reopen():
    """续写轮次重发的 @@GROUP_INTRO@@ 让位给第一轮写好的导语。"""
    pass1 = "@@GROUP_INTRO@@ 第一轮导语\n@@Q@@ 24\n@@ANSWER@@\nB\n@@END_Q@@\n"
    pass2 = "@@GROUP_INTRO@@ 第二轮导语\n@@Q@@ 24\n@@ANSWER@@\nC\n@@END_Q@@\n"
    data = parse_custom_visual_paper(_SKELETON + pass1 + pass2)
    assert data["groups"][0]["intro"] == "第一轮导语"
    assert data["groups"][0]["questions"][0]["answer"] == "C"


def test_reopen_transfer_replaced_by_new_blocks():
    """同号重开且模型重写了迁移块：整体替换旧块，不得新旧叠加翻倍。"""
    pass1 = (
        "@@GROUP_INTRO@@ g\n"
        "@@Q@@ 24\n@@ANSWER@@\nB\n@@PATTERN_STEPS@@\ns\n"
        + _transfer_text("Old passage.", "A")
        + "@@END_Q@@\n"
    )
    pass2 = (
        "@@Q@@ 24\n@@ANSWER@@\nC\n@@PATTERN_STEPS@@\ns2\n"
        + _transfer_text("New passage.", "D")
        + "@@END_Q@@\n"
    )
    data = parse_custom_visual_paper(_SKELETON + pass1 + pass2)
    q = data["groups"][0]["questions"][0]
    assert q["answer"] == "C"
    assert len(q["transfers"]) == 1, f"重写后迁移块应整体替换，实际 {len(q['transfers'])} 块"
    assert q["transfers"][0]["passage"] == "New passage."


def test_reopen_without_transfer_keeps_old_blocks():
    """同号重开但模型没重写迁移块：沿用重开前持有的旧块，不得清空。"""
    pass1 = (
        "@@Q@@ 24\n@@ANSWER@@\nB\n@@PATTERN_STEPS@@\ns\n"
        + _transfer_text("Old passage.", "A")
        + "@@END_Q@@\n"
    )
    pass2 = "@@Q@@ 24\n@@ANSWER@@\nC\n@@END_Q@@\n"
    data = parse_custom_visual_paper(_SKELETON + pass1 + pass2)
    q = data["groups"][0]["questions"][0]
    assert len(q["transfers"]) == 1
    assert q["transfers"][0]["passage"] == "Old passage."


def test_paper_and_notice_empty_value_not_overwrite():
    """续写轮次模型偶尔重发空 @@PAPER@@/@@NOTICE@@：空值不得抹掉已有内容。"""
    doc = _SKELETON.replace(
        "@@PAPER@@ 测试卷\n", "@@PAPER@@ 测试卷\n@@NOTICE@@ AI 判断，建议核对\n"
    )
    cont = "@@PAPER@@\n@@NOTICE@@ \n@@Q@@ 24\n@@ANSWER@@\nB\n@@END_Q@@\n"
    data = parse_custom_visual_paper(doc + cont)
    assert data["paper"]["title"] == "测试卷"
    assert data["notice"] == "AI 判断，建议核对"


def test_stray_fields_after_early_endq_reopened_into_committed_question():
    """实测（log-300）：模型把 @@END_Q@@ 提前写在 OPTIONS 之后，ANSWER/迁移块全落在
    第一个 END_Q 之后。这些字段只可能属于刚提交的题，重开并入而不是静默丢弃。"""
    doc = _SKELETON + (
        "@@Q@@ 24\n@@QTYPE@@ choice\n@@STEM@@\nRecent activities?\n@@OPTIONS@@\nA. x\nB. y\n@@END_Q@@\n"
        "@@ANSWER@@\nA\n@@EVIDENCE@@\nPara 2: evidence.\n"
        "@@TRANSFER_PASSAGE@@\nStray transfer.\n@@TRANSFER_ANSWER@@\nC\n@@TRANSFER_EXPL@@\n路径\n@@END_Q@@\n"
    )
    data = parse_custom_visual_paper(doc)
    qs = data["groups"][0]["questions"]
    assert [q["no"] for q in qs] == ["24"], "不得新建第二道 24"
    q = qs[0]
    assert q["answer"] == "A"
    assert q["reference"]["evidence"] == "Para 2: evidence."
    assert len(q["transfers"]) == 1
    assert q["transfers"][0]["passage"] == "Stray transfer."
