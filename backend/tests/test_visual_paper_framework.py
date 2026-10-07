"""试卷可视化全解·两阶段：框架插标 applier 的派生规则，以及阶段二同号重开合并的解析。"""

from pathlib import Path

from app.services.visual_paper import parse_custom_visual_paper
from app.services.visual_paper_framework import (
    FrameworkApplier,
    render_numbered_lines,
)
# 一份最小可用的原卷：语篇末尾与题号挤同一行、选项两栏挤同一行、卷末带答案区
_RAW_PAPER = """2022年测试卷英语
第二节 阅读理解
阅读下列短文，从每题所给的A、B、C、D四个选项中，选出最佳选项。
Most people ride BART every day. The agency started a kiosk program.
And you'll never be without something to read. 24. Why did BART start the kiosk program?
A. To promote the local culture.  B. To discourage phone use.
C. To meet passengers' needs.  D. To reduce its running costs.
25. What can riders do at the kiosks?
A. Borrow books.  B. Buy tickets.
C. Print poems.  D. Attend talks.
第三节 书面表达
假定你是李华，请写一封邮件。
21-25 CBADA"""

_MARKS = """@@TOTAL@@ 3
@@PAPER@@ 2022年测试卷英语
@@MARK GROUP reading|阅读理解@@ 第二节
@@MARK PASSAGE P1@@ Most people ride BART
@@MARK CUT@@ 阅读下列短文
@@MARK Q 24@@ 24. Why did BART start
@@MARK OPTIONS@@ A. To promote the local culture.
@@MARK Q 25@@ 25. What can riders do
@@MARK OPTIONS@@ A. Borrow books.
@@MARK GROUP writing_app|书面表达@@ 第三节
@@MARK Q 26@@ 假定你是李华
@@MARK KEY@@ 21-25 CBADA"""


def _run(paper: str = _RAW_PAPER, marks: str = _MARKS):
    applier = FrameworkApplier(paper)
    text = applier.feed(marks)
    text += applier.finish()
    return text, applier


class TestFrameworkApplier:
    def test_clean_paper_full_skeleton(self):
        text, applier = _run()
        assert applier.stats.ok
        assert applier.stats.questions == 3
        assert applier.stats.passages == 1
        # 头部与分组、语篇、题目、答案区按序派生
        assert text.startswith("@@TOTAL@@ 3\n@@PAPER@@ 2022年测试卷英语\n")
        assert "@@GROUP@@ reading|阅读理解|" in text
        assert "@@PASSAGE_DEF@@ P1" in text
        assert "@@END_Q@@" in text
        assert "@@KEY@@\n21-25 CBADA" in text

    def test_midline_split_keeps_passage_whole_and_strips_qno(self):
        text, _ = _run()
        # 语篇正文保留到句号为止，题号被断行切进题干
        assert "And you'll never be without something to read.\n@@Q@@ 24" in text
        assert "@@STEM@@\nWhy did BART start the kiosk program?" in text
        # 题干里不得再出现卷面题号
        assert "24. Why did" not in text

    def test_options_normalized_one_per_line(self):
        text, _ = _run()
        assert "A. To promote the local culture.\nB. To discourage phone use." in text
        assert "C. To meet passengers' needs.\nD. To reduce its running costs." in text

    def test_writing_question_ref_and_key(self):
        text, _ = _run()
        # 写作题：PASSAGE_REF 为 -，答案区圈在 KEY 里
        assert "@@Q@@ 26\n@@PASSAGE_REF@@ -" in text
        assert "@@KEY@@" in text

    def test_continuation_writing_material_linked(self):
        """读后续写的材料语篇印在要求行之后：引用延迟到收题判定，材料挂回本题。"""
        paper = (
            "第三节 读后续写\n"
            "阅读下面材料，根据其内容和所给段落开头语续写两段。\n"
            "It was a sunny morning when the story began. The children set out early.\n"
            "Paragraph 1: The children walked on.\n"
            "第四节 应用文写作\n"
            "假定你是李华，请写一封邮件。\n"
            "参考答案与解析\n66-67 略"
        )
        marks = (
            "@@MARK GROUP writing_cont|读后续写@@ 第三节\n"
            "@@MARK Q 67@@ 阅读下面材料\n"
            "@@MARK PASSAGE P1@@ It was a sunny morning\n"
            "@@MARK GROUP writing_app|应用文写作@@ 第四节\n"
            "@@MARK Q 66@@ 假定你是李华\n"
            "@@MARK KEY@@ 参考答案"
        )
        applier = FrameworkApplier(paper)
        out = applier.feed(marks) + applier.finish()
        # 引用行在题干之后、END_Q 之前；语篇正文 = 故事 + 开头语
        assert "@@STEM@@\n阅读下面材料，根据其内容和所给段落开头语续写两段。\n@@PASSAGE_REF@@ P1\n@@END_Q@@" in out
        assert "@@PASSAGE_DEF@@ P1" in out
        assert "@@PASSAGE_REF@@ P1" in out
        # 应用文仍按无语篇处理
        assert "@@Q@@ 66\n@@PASSAGE_REF@@ -" in out
        # 端到端：材料挂回第 67 题
        from app.services.visual_paper import parse_custom_visual_paper
        data = parse_custom_visual_paper(out)
        qs = {q["no"]: q for g in data["groups"] for q in g["questions"]}
        assert qs["67"]["passage"].startswith("It was a sunny morning")
        assert "Paragraph 1:" in qs["67"]["passage"]
        assert qs["66"]["passage"] == ""

    def test_missing_anchor_skipped(self):
        marks = _MARKS.replace("@@MARK OPTIONS@@ A. Borrow books.", "@@MARK OPTIONS@@ A. 不存在的锚点")
        text, applier = _run(marks=marks)
        assert applier.stats.marks_skipped >= 1
        # 选项标记丢了：题干尾部的选项行被自救并回选项
        assert "A. Borrow books." in text

    def test_duplicate_mark_same_position_skipped(self):
        marks = _MARKS + "\n@@MARK Q 24@@ 24. Why did BART start\n"
        text, applier = _run(marks=marks)
        # 重复指令不产生第二道 24 题
        assert text.count("@@Q@@ 24") == 1
        assert applier.stats.marks_skipped >= 1

    def test_zero_marks_not_ok(self):
        applier = FrameworkApplier(_RAW_PAPER)
        applier.feed("我不理解这份试卷，无法标注。")
        applier.finish()
        assert not applier.stats.ok

    def test_fuzzy_whitespace_anchor(self):
        applier = FrameworkApplier("The quick  brown   fox jumps over.")
        applier.feed("@@MARK PASSAGE P1@@ The quick brown\n")
        applier.finish()
        assert applier.stats.marks_applied == 1
        assert "The quick  brown   fox jumps over." in applier.skeleton_text

    def test_shared_option_pool_cloze7(self):
        paper = (
            "Passage One with blanks: The first __36__ is easy. The second __37__ too.\n"
            "A. Making a choice  B. Taking turns  C. Other D\n"
            "第三节 书面表达\n假定你是李华。"
        )
        marks = (
            "@@MARK GROUP cloze7|七选五@@ Passage One\n"
            "@@MARK PASSAGE P1@@ Passage One with blanks\n"
            "@@MARK OPTIONS 36-37@@ A. Making a choice\n"
            "@@MARK GROUP writing_app|书面表达@@ 第三节\n"
            "@@MARK Q 27@@ 假定你是李华"
        )
        text, applier = FrameworkApplier(paper), None
        text = FrameworkApplier(paper)
        out = text.feed(marks) + text.finish()
        # 池子逐题重复，两块各自带完整选项
        assert out.count("@@OPTIONS@@\nA. Making a choice\nB. Taking turns\nC. Other D") == 2
        assert out.count("@@END_Q@@") == 3
        assert text.stats.questions == 3 and text.stats.pools == 1

    def test_q_range_pure_declaration_defers_to_passage(self):
        paper = (
            "第三节 语法填空\n"
            "阅读下面短文，在空白处填入1个适当的单词。\n"
            "Grammar passage with __56__ blank and __57__ blank.\n"
            "第四节 书面表达\n假定你是李华。"
        )
        marks = (
            "@@MARK GROUP grammar|语法填空@@ 第三节\n"
            "@@MARK Q 56-57@@ 阅读下面短文\n"
            "@@MARK PASSAGE P1@@ Grammar passage\n"
            "@@MARK GROUP writing_app|书面表达@@ 第四节\n"
            "@@MARK Q 58@@ 假定你是李华"
        )
        applier = FrameworkApplier(paper)
        out = applier.feed(marks) + applier.finish()
        # 区间题块在语篇正文收口后派生：引用正确，且不打断语篇收集
        assert "@@PASSAGE_DEF@@ P1\nGrammar passage with __56__ blank and __57__ blank.\n@@Q@@ 56\n@@PASSAGE_REF@@ P1" in out
        assert applier.stats.questions == 3

    def test_streaming_feed_in_chunks_matches_whole(self):
        whole, _ = _run()
        applier = FrameworkApplier(_RAW_PAPER)
        chunked = ""
        for i in range(0, len(_MARKS), 7):
            chunked += applier.feed(_MARKS[i : i + 7])
        chunked += applier.finish()
        assert chunked == whole

    def test_render_numbered_lines(self):
        out = render_numbered_lines("abc\ndef")
        assert out == "  1 | abc\n  2 | def"
        assert " 12 | x" in render_numbered_lines("\n".join(["x"] * 12))

    def test_adjacent_same_title_groups_disambiguated(self):
        """模型偷懒给两篇语篇起了相同标题：自动加序号，解析端才不会把它们并回一组。"""
        paper = "Passage A text here.\nPassage B text here."
        marks = (
            "@@MARK GROUP reading|阅读理解@@ Passage A\n"
            "@@MARK PASSAGE P1@@ Passage A\n"
            "@@MARK Q 21@@ Passage A text\n"   # 就地开题（锚点即内容）
            "@@MARK GROUP reading|阅读理解@@ Passage B\n"
            "@@MARK PASSAGE P2@@ Passage B\n"
            "@@MARK Q 25@@ Passage B text\n"
        )
        applier = FrameworkApplier(paper)
        out = applier.feed(marks) + applier.finish()
        assert "@@GROUP@@ reading|阅读理解|" in out
        assert "@@GROUP@@ reading|阅读理解（第2组）|" in out

    def test_single_char_anchor_rejected(self):
        """单字符锚点（篇标 A、孤立数字）会误配到正文与选项标号，必须拒收。"""
        paper = "Most people ride BART every day. A. To promote the culture.\nB\n"
        applier = FrameworkApplier(paper)
        applier.feed("@@MARK Q 1@@ A\n@@MARK OPTIONS@@ B\n")
        applier.finish()
        assert applier.stats.marks_skipped == 2
        assert applier.stats.marks_applied == 0

    def test_short_anchor_prefers_line_start(self):
        """短锚点优先匹配行首：上一行正文里也出现了「B篇」时，不能误配到行中。"""
        paper = "See the B篇 note here.\nB篇\nPassage B text here."
        applier = FrameworkApplier(paper)
        applier.feed("@@MARK PASSAGE P2@@ B篇\n")
        applier.finish()
        assert applier.stats.marks_applied == 1
        # 命中的是独占一行的「B篇」（行首），不是上一行正文中间那个
        assert applier.skeleton_text.strip() == "@@PASSAGE_DEF@@ P2\nB篇\nPassage B text here."


class TestStageTwoMerge:
    """骨架 + 讲解流拼接后的解析：同号重开合并、不重复提交。"""

    SKELETON = """@@TOTAL@@ 1
@@PAPER@@ 测试卷
@@GROUP@@ reading|阅读理解|
@@PASSAGE_DEF@@ P1
Some English passage.
@@Q@@ 24
@@PASSAGE_REF@@ P1
@@STEM@@
24. Why did BART start the kiosk program?
@@OPTIONS@@
A. One
B. Two
C. Three
D. Four
@@END_Q@@
"""

    ANALYSIS = """@@NOTICE@@ 
@@GROUP_INTRO@@ 考查细节定位
@@Q@@ 24
@@QTYPE@@ choice
@@ANSWER@@
B
@@EVIDENCE@@
Para 1: Some English passage.
@@END_Q@@
"""

    def test_reopen_merges_into_one_question(self):
        doc = self.SKELETON + self.ANALYSIS
        data = parse_custom_visual_paper(doc)
        qs = data["groups"][0]["questions"]
        assert len(qs) == 1
        q = qs[0]
        assert q["no"] == "24"
        assert q["stem"] == "Why did BART start the kiosk program?"
        assert q["qtype"] == "choice"
        assert q["answer"] == "B"
        assert q["reference"]["evidence"].startswith("Para 1")
        assert len(q["options"]) == 4

    def test_group_intro_and_key_collected(self):
        doc = self.SKELETON + self.ANALYSIS + "@@KEY@@\n21-25 CBADA\n"
        data = parse_custom_visual_paper(doc)
        assert data["groups"][0]["intro"] == "考查细节定位"
        assert data["paperKey"] == "21-25 CBADA"

    def test_group_intro_follows_its_group_and_qtype_not_forced(self):
        """讲解流开始时 current_group 停在骨架最后一个分组上：导语必须挂到各自分组，
        重开题的 qtype 不得被那个残组强行判成 writing。"""
        skeleton = (
            "@@TOTAL@@ 2\n@@PAPER@@ 测试卷\n"
            "@@GROUP@@ reading|阅读理解|\n"
            "@@PASSAGE_DEF@@ P1\nSome passage.\n"
            "@@Q@@ 24\n@@PASSAGE_REF@@ P1\n@@STEM@@\nWhy did BART start?\n"
            "@@OPTIONS@@\nA. One\nB. Two\nC. Three\nD. Four\n@@END_Q@@\n"
            "@@GROUP@@ writing_app|书面表达|\n"
            "@@Q@@ 25\n@@PASSAGE_REF@@ -\n@@STEM@@\n假定你是李华。\n@@END_Q@@\n"
        )
        analysis = (
            "@@NOTICE@@ \n"
            "@@GROUP_INTRO@@ 考查细节定位\n"
            "@@Q@@ 24\n@@QTYPE@@ choice\n@@ANSWER@@\nC\n@@END_Q@@\n"
            "@@GROUP_INTRO@@ 应用文审题\n"
            "@@Q@@ 25\n@@QTYPE@@ writing\n@@WRITING_SAMPLE@@\nDear\n@@END_Q@@\n"
        )
        data = parse_custom_visual_paper(skeleton + analysis)
        g_reading, g_writing = data["groups"][0], data["groups"][1]
        assert g_reading["intro"] == "考查细节定位"
        assert g_writing["intro"] == "应用文审题"
        q24 = g_reading["questions"][0]
        assert q24["qtype"] == "choice" and q24["answer"] == "C"
        q25 = g_writing["questions"][0]
        assert q25["qtype"] == "writing"

    def test_gap_fill_question_appended(self):
        # 材料里没有的题：讲解模型照老办法补全结构，走新建题路径
        analysis = "@@Q@@ 25\n@@QTYPE@@ blank\n@@PASSAGE_REF@@ -\n@@STEM@@\nFill in the blank.\n@@ANSWER@@\nis\n@@END_Q@@"
        doc = self.SKELETON + analysis
        data = parse_custom_visual_paper(doc)
        qs = data["groups"][0]["questions"]
        assert [q["no"] for q in qs] == ["24", "25"]
        assert qs[1]["qtype"] == "blank" and qs[1]["answer"] == "is"

    def test_skeleton_alone_parses_without_analysis(self):
        data = parse_custom_visual_paper(self.SKELETON)
        qs = data["groups"][0]["questions"]
        assert len(qs) == 1
        assert qs[0]["stem"] == "Why did BART start the kiosk program?"
        assert qs[0]["answer"] is None


# ---------------- 两阶段编排端到端（含日志留痕） ----------------

_REPO_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
_VISUAL_TOOL_ID = "13"


class _FakeLLM:
    def __init__(self, tokens, usage=None):
        self.tokens = list(tokens)
        self.usage = usage or {}

    async def chat_stream_with_stop(self, *, user_prompt, usage_out=None, **_kwargs):
        for token in self.tokens:
            yield token
        if usage_out is not None:
            usage_out.update(self.usage)


def test_two_stage_stream_and_logs():
    """跑通整个 SSE：framework 事件 → 骨架 token 先行 → explain 事件 → 讲解 token；
    日志落两条——主记录「试卷可视化全解」+ 阶段一「试卷可视化全解·框架」（request_id 带 _fw 后缀）。"""
    import json

    from app import deps
    from app.database import SessionLocal
    from app.main import app
    from app.models import UsageCode, UsageLog
    from app.routers import chat as chat_router
    from app.routers import tools as tools_router
    from app.services.prompt_loader import PromptLoader

    fw_fake = _FakeLLM([
        "@@TOTAL@@ 1\n",
        "@@PAPER@@ 测试卷\n",
        "@@MARK GROUP reading|阅读理解@@ Pas one\n",
        "@@MARK PASSAGE P1@@ Pas one\n",
        "@@MARK Q 1@@ Q one\n",
        "@@MARK OPTIONS@@ A. one\n",
    ])
    main_fake = _FakeLLM([
        "@@NOTICE@@ \n",
        "@@GROUP_INTRO@@ 考查细节定位\n",
        "@@Q@@ 1\n",
        "@@QTYPE@@ choice\n",
        "@@ANSWER@@\nB\n",
        "@@END_Q@@\n",
    ], usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})

    fakes = [main_fake, fw_fake]  # 主 LLM 先在 generator 外构建，阶段一在流开始后构建
    original_build_llm = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: fakes.pop(0)

    db = SessionLocal()
    try:
        code = UsageCode(code="NBXU-VP-2STG-0001", quota=100, used_count=0, is_enabled=True, note="测试")
        db.add(code)
        db.commit()
        db.refresh(code)
        db.expunge(code)
    finally:
        db.close()

    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(code=code, reason="")
    app.dependency_overrides[tools_router.get_prompt_loader] = lambda: PromptLoader(_REPO_PROMPTS_DIR)
    from app.services.runtime_config import set_config_values
    set_config_values(db, {"log_payload": "true"})  # 原始输入/输出落 LogPayload，开关打开才写
    try:
        client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(app)
        resp = client.post(
            "/api/chat/stream",
            json={"tool_id": _VISUAL_TOOL_ID, "input": "Pas one.\nQ one?\nA. one B. two"},
            headers={"X-Real-IP": "203.0.113.77", "User-Agent": "pytest-vp"},
        )
        assert resp.status_code == 200
        text = resp.text
        assert "[DONE]" in text, text[:500]
        # 阶段切换事件按序出现，且 explain 带 framework=True（骨架可用）
        assert text.index('"name": "framework"') < text.index('"name": "explain"')
        assert '"framework": true' in text
        # 骨架 token 先于讲解 token（语篇/题目立即可见，讲解随后并入）
        assert text.index("@@PASSAGE_DEF@@ P1") < text.index("@@ANSWER@@")
        assert "@@Q@@ 1" in text and "@@END_Q@@" in text
    finally:
        set_config_values(db, {"log_payload": "false"})
        chat_router._build_llm = original_build_llm
        app.dependency_overrides.clear()

    db = SessionLocal()
    try:
        logs = db.query(UsageLog).filter(UsageLog.code_id == code.id).order_by(UsageLog.id).all()
        from app.models import LogPayload
        payloads = {p.log_id: p for p in db.query(LogPayload).all()}
    finally:
        db.close()
    assert len(logs) == 2, f"应落两条日志（主 + 阶段一），实际 {[l.tool_name for l in logs]}"
    by_name = {l.tool_name: l for l in logs}
    main_row = by_name["试卷可视化全解"]
    fw_row = by_name["试卷可视化全解·框架"]
    # 主记录：request_id 原样、正常扣费
    assert not main_row.request_id.endswith("_fw")
    assert main_row.units == 1
    # 阶段一记录：request_id 带 _fw 后缀、不扣费、状态成功
    assert fw_row.request_id.endswith("_fw")
    assert fw_row.units == 0
    assert fw_row.status == "success"
    # 原始数据分离：主记录输出 = 骨架+讲解合并文档、输入 = 用户原文；
    # 阶段一输出 = Chores 模型的插标指令原文、渲染提示词里是带行号的原卷
    main_payload = payloads[main_row.id]
    fw_payload = payloads[fw_row.id]
    assert "@@PASSAGE_DEF@@ P1" in main_payload.output and "@@ANSWER@@" in main_payload.output
    assert main_payload.input == "Pas one.\nQ one?\nA. one B. two"
    assert "@@MARK PASSAGE P1@@" in fw_payload.output
    assert " 1 | Pas one." in fw_payload.prompt


class TestWritingSectionGrouping:
    """线上翻车场景：应用文/读后续写两节必须各自成组，67 不得掉进应用文组。"""

    def test_two_writing_sections_grouped_by_requirement_line(self):
        paper = (
            "第三节 写作\n"
            "第一节 应用文写作\n"
            "假定你是李华，请写一封邮件。\n"
            "第二节 读后续写\n"
            "阅读下面材料，根据其内容和所给段落开头语续写两段。\n"
            "It was a sunny morning when the story began.\n"
            "Paragraph 1: The children walked on.\n"
            "参考答案\n略"
        )
        marks = (
            "@@MARK GROUP writing_app|应用文写作@@ 第一节\n"
            "@@MARK Q 66@@ 假定你是李华\n"
            "@@MARK GROUP writing_cont|读后续写@@ 第二节\n"
            "@@MARK Q 67@@ 阅读下面材料\n"
            "@@MARK PASSAGE P1@@ It was a sunny morning\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        applier = FrameworkApplier(paper)
        out = applier.feed(marks) + applier.finish()
        # GROUP 锚在各自第一题的标记之前（第一节/第二节行）：66 归应用文、67 归读后续写
        assert out.index("@@GROUP@@ writing_app") < out.index("@@Q@@ 66")
        assert out.index("@@Q@@ 66") < out.index("@@GROUP@@ writing_cont") < out.index("@@Q@@ 67")
        q67 = out.index("@@Q@@ 67")
        # 材料语篇的引用行落在第 67 题块内（题干之后、它自己的 END_Q 之前）
        assert out.index("@@PASSAGE_REF@@ P1", q67) < out.index("@@END_Q@@", q67)
        data = parse_custom_visual_paper(out)
        groups = {g["id"]: g for g in data["groups"]}
        assert [q["no"] for q in groups["writing_app"]["questions"]] == ["66"]
        assert [q["no"] for q in groups["writing_cont"]["questions"]] == ["67"]
        # 材料语篇（故事+开头语）挂回第 67 题，应用文保持无语篇
        assert groups["writing_cont"]["questions"][0]["passage"].startswith("It was a sunny morning")
        assert "Paragraph 1:" in groups["writing_cont"]["questions"][0]["passage"]
        assert groups["writing_app"]["questions"][0]["passage"] == ""


def test_no_regression_and_unmarked_key_warn(caplog):
    """可观测性：题号大幅回跳（节名当题号）与答案区漏发 KEY 都要留告警。"""
    import logging

    paper = (
        "Q one?\nA. one B. two\n"
        "参考答案与解析\n1. B"
    )
    applier = FrameworkApplier(paper)
    with caplog.at_level(logging.WARNING, logger="app.services.visual_paper_framework"):
        applier.feed(
            "@@MARK GROUP reading|阅读理解@@ Q one\n"
            "@@MARK Q 30@@ Q one\n"
            "@@MARK OPTIONS@@ A. one\n"
            "@@MARK Q 1@@ 参考答案与解析\n"   # 题号回跳 + 锚到答案区（模型双重犯错）
        )
        applier.finish()
    assert "题号从 30 回跳" in caplog.text
    assert "未收到 KEY 标记" in caplog.text   # 答案区被粘进 Q1 的题干区域，同样该告警
    # 漏发 KEY 的常见形态：答案区粘进最后一个开着的区域（这里被并进 OPTIONS）
    applier2 = FrameworkApplier("Q one?\nA. one B. two\n参考答案与解析\n1. B")
    with caplog.at_level(logging.WARNING, logger="app.services.visual_paper_framework"):
        applier2.feed(
            "@@MARK GROUP reading|阅读理解@@ Q one\n"
            "@@MARK Q 30@@ Q one\n"
            "@@MARK OPTIONS@@ A. one\n"
        )
        applier2.finish()
    assert "未收到 KEY 标记" in caplog.text


class TestAnchorRobustness:
    """2024 II 卷实战暴露的三类锚点失配：中西文加空格、标记顺序颠倒、池尾混入节头。"""

    def test_fuzzy_anchor_tolerates_added_spaces(self):
        """模型爱在中西文边界加空格（Chris → " Chris "），逐字匹配落空时按空白归一化兜住。"""
        paper = (
            "第二节 应用文写作\n"
            "假定你是李华，上周五你们班在公园上了一堂美术课。请你给英国朋友Chris写一封邮件分享这次经历，内容包括：\n"
            "参考答案\n66 略"
        )
        marks = (
            "@@MARK GROUP writing_app|应用文写作@@ 假定你是李华\n"
            "@@MARK Q 66@@ 假定你是李华，上周五你们班在公园上了一堂美术课。"
            "请你给英国朋友 Chris 写一封邮件分享这次经历，内容包括：\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        text, applier = _run(paper, marks)
        assert applier.stats.marks_skipped == 0
        assert applier.stats.questions == 1
        assert "@@Q@@ 66" in text
        assert "请你给英国朋友Chris写一封邮件分享这次经历" in text

    def test_backward_q_reinserted_after_passage(self, caplog):
        """模型先发 PASSAGE 再发 Q（要求行印在材料之前）：Q 锚点在游标后方，回插兜底而不是丢题。"""
        import logging

        paper = (
            "第二节 读后续写\n"
            "阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。\n"
            "I met Gunter on a cold, wet and unforgettable evening in September. It was raining.\n"
            "Para 1: I ran back to Gunter and told him the bad news.\n"
            "参考答案\n67 略"
        )
        # 顺序颠倒：GROUP → PASSAGE → Q（正确顺序应为 GROUP → Q → PASSAGE）
        marks = (
            "@@MARK GROUP writing_cont|读后续写@@ 阅读下面材料\n"
            "@@MARK PASSAGE P1@@ I met Gunter\n"
            "@@MARK Q 67@@ 阅读下面材料\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        with caplog.at_level(logging.WARNING, logger="app.services.visual_paper_framework"):
            text, applier = _run(paper, marks)
        assert applier.stats.questions == 1
        assert "已回插" in caplog.text
        # 题干收进要求行 + 材料全文；悬空的 P1 引用（语篇区已被回插掏空）不再下发
        assert "@@Q@@ 67\n@@STEM@@\n阅读下面材料" in text
        assert "I met Gunter" in text
        assert "@@PASSAGE_REF@@" not in text
        data = parse_custom_visual_paper(text)
        groups = {g["id"]: g for g in data["groups"]}
        q = groups["writing_cont"]["questions"][0]
        assert q["no"] == "67"
        assert "阅读下面材料" in q["stem"] and "I met Gunter" in q["stem"]

    def test_pool_options_truncated_at_section_header(self):
        """共享选项池的尾部混入下一节大题头：选项在「第X部分/节」处截断，节名不并进最后一个选项。"""
        paper = (
            "第三节 七选五\n"
            "Overtourism Is For Real: How Can You Help?\n"
            "A. Visit during off-peak times. B. So, should we stop traveling? C. Travel for you.\n"
            "D. Can overtourism be avoided then? E. You can still find quiet places.\n"
            "F. You'll find yourself virtually alone. G. Consider giving back to communities.\n"
            "第四部分 写作（共两节，满分35分）\n"
            "阅读下面短文，从短文后的选项中选出能填入空白处的最佳选项。\n"
            "When I decided to buy a house in Europe ten years ago, I didn't think too long.\n"
            "参考答案\n36-40 BCEAGF"
        )
        marks = (
            "@@MARK GROUP cloze7|七选五@@ Overtourism\n"
            "@@MARK PASSAGE P1@@ Overtourism\n"
            "@@MARK OPTIONS 36-40@@ A. Visit during off-peak times.\n"
            "@@MARK GROUP cloze|完形填空@@ When I decided to buy a house\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        text, applier = _run(paper, marks)
        assert applier.stats.questions == 5
        assert "G. Consider giving back to communities." in text
        assert "第四部分" not in text
        assert "阅读下面短文" not in text

    def test_stem_drops_section_header_line(self):
        """夹在写作任务结尾和下一节锚点之间的节名行（第二节（满分25分））由程序确定性丢弃。"""
        paper = (
            "第一节（满分15分）\n"
            "假定你是李华，上周五你们班在公园上了一堂美术课。请你给英国朋友Chris写一封邮件分享这次经历，内容包括：\n"
            "（1）你完成的作品；\n"
            "注意：\n"
            "（1）写作词数应为80个左右；\n"
            "Dear Chris,\n"
            "I'm writing to share with you an art class I had in a park last Friday.\n"
            "Yours,\n"
            "Li Hua\n"
            "第二节（满分25分）\n"
            "阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。\n"
            "参考答案\n66-67 略"
        )
        marks = (
            "@@MARK GROUP writing_app|应用文写作@@ 假定你是李华\n"
            "@@MARK Q 66@@ 假定你是李华\n"
            "@@MARK GROUP writing_cont|读后续写@@ 阅读下面材料\n"
            "@@MARK Q 67@@ 阅读下面材料\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        text, applier = _run(paper, marks)
        assert applier.stats.questions == 2
        # 节名行不进题干；GROUP 锚点之前的节名行本来就在噪声里
        assert "第二节（满分25分）" not in text
        assert "第一节（满分15分）" not in text
        assert "假定你是李华" in text
        # 没有 CUT 时范文仍在题干里——那是模型侧的职责（见下一条用例）

    def test_cut_drops_model_essay_after_task(self):
        """任务后面印的范文靠模型发 CUT 丢弃：题干在范文首行提前收口。"""
        paper = (
            "第一节（满分15分）\n"
            "假定你是李华，上周五你们班在公园上了一堂美术课。请你给英国朋友Chris写一封邮件分享这次经历，内容包括：\n"
            "注意：\n"
            "（1）写作词数应为80个左右；\n"
            "Dear Chris,\n"
            "I'm writing to share with you an art class I had in a park last Friday.\n"
            "Yours,\n"
            "Li Hua\n"
            "第二节（满分25分）\n"
            "阅读下面材料，根据其内容和所给段落开头语续写两段，使之构成一篇完整的短文。\n"
            "参考答案\n66-67 略"
        )
        marks = (
            "@@MARK GROUP writing_app|应用文写作@@ 假定你是李华\n"
            "@@MARK Q 66@@ 假定你是李华\n"
            "@@MARK CUT@@ Dear Chris,\n"
            "@@MARK GROUP writing_cont|读后续写@@ 阅读下面材料\n"
            "@@MARK Q 67@@ 阅读下面材料\n"
            "@@MARK KEY@@ 参考答案\n"
        )
        text, applier = _run(paper, marks)
        assert applier.stats.questions == 2
        assert "Dear Chris" not in text
        assert "Yours" not in text
        assert "第二节（满分25分）" not in text
        assert "假定你是李华" in text
        data = parse_custom_visual_paper(text)
        groups = {g["id"]: g for g in data["groups"]}
        assert "写作词数应为80个左右" in groups["writing_app"]["questions"][0]["stem"]


def test_tag_input_skips_framework_and_uses_explain_prompt():
    """续写请求（输入已是 @@TAG@@ 骨架）跳过阶段一，并换用精讲提示词：
    单阶段契约会要求模型重发 @@GROUP@@/语篇正文等结构行，正是续写轮次里
    文档底部长出空分组、正文被复读的直接诱因。用量日志记「试卷可视化全解·精讲」。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.database import SessionLocal
    from app.main import app
    from app.models import UsageCode, UsageLog
    from app.routers import chat as chat_router
    from app.routers import tools as tools_router
    from app.services.prompt_loader import PromptLoader

    captured = {}

    class _RecordingLLM(_FakeLLM):
        async def chat_stream_with_stop(self, *, user_prompt, usage_out=None, **kwargs):
            captured["prompt"] = user_prompt
            async for token in super().chat_stream_with_stop(user_prompt=user_prompt, usage_out=usage_out, **kwargs):
                yield token

    fake = _RecordingLLM(["@@Q@@ 1\n@@ANSWER@@\nB\n@@END_Q@@\n"])
    original_build_llm = chat_router._build_llm
    chat_router._build_llm = lambda *_a, **_kw: fake

    db = SessionLocal()
    try:
        code = UsageCode(code="NBXU-VP-TAGPROMPT-01", quota=100, used_count=0, is_enabled=True, note="测试")
        db.add(code)
        db.commit()
        db.refresh(code)
        db.expunge(code)
    finally:
        db.close()

    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(code=code, reason="")
    app.dependency_overrides[tools_router.get_prompt_loader] = lambda: PromptLoader(_REPO_PROMPTS_DIR)
    cont_input = (
        "@@TOTAL@@ 1\n@@PAPER@@ 测试卷\n@@GROUP@@ reading|阅读理解|\n"
        "@@Q@@ 1\n@@QTYPE@@ choice\n@@STEM@@\nQ one?\n@@END_Q@@\n"
        "\n【续写指令】本次只需要为下列题号输出讲解块：1。\n"
    )
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/chat/stream",
            json={"tool_id": _VISUAL_TOOL_ID, "input": cont_input},
            headers={"X-Real-IP": "203.0.113.78", "User-Agent": "pytest-vp"},
        )
        assert resp.status_code == 200
        assert "[DONE]" in resp.text, resp.text[:500]
        # 首条 user 消息用精讲提示词渲染（续写工单条款只在精讲里有），材料携带原样输入
        prompt = captured.get("prompt") or ""
        assert "续写工单" in prompt, prompt[:300]
        assert "【续写指令】本次只需要为下列题号输出讲解块：1。" in prompt
        # 阶段一被跳过：不出现框架阶段事件
        assert '"name": "framework"' not in resp.text
    finally:
        chat_router._build_llm = original_build_llm
        app.dependency_overrides.clear()

    db = SessionLocal()
    try:
        logs = db.query(UsageLog).filter(UsageLog.code_id == code.id).order_by(UsageLog.id).all()
    finally:
        db.close()
    assert len(logs) == 1, f"续写请求只落一条主日志，实际 {len(logs)} 条"
    assert logs[0].tool_name == "试卷可视化全解精讲"
