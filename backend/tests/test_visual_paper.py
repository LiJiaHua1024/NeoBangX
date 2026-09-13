"""试卷可视化全解：多道迁移块的解析 / 归一化，以及 Prompt 变量渲染。"""

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
