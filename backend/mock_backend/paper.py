"""试卷可视化全解的合法 @@TAG@@ 样本生成器。

样本的合法性不靠"看起来对"，而是启动时用真实后端的
``app.services.visual_paper.validate_visual_paper`` 校验（见 README 的自检说明）。
``build_resume`` 会解析前端 vpContinueBrief() 拼出的【续写指令】简报，
按简报里的进度接着往下写，因此「续写 → 进度到 100% → 按钮消失」这条链路可完整测试。
"""

from __future__ import annotations

import re
from typing import Any

from app.services.visual_paper import parse_custom_visual_paper, validate_visual_paper

# 题型与分组 id 的合法集合来自真实解析器，这里只做引用，避免两处口径不一致
_ALLOWED_QTYPES = {"choice", "blank", "writing"}

# 五种题型形状循环使用：no>5 时取模复用，保证语篇编号与分组仍能对上
_SHAPES: list[dict] = [
    {"group": ("reading", "阅读理解 A 篇", "细节理解题，共 2 题"), "qtype": "choice", "ref": "P1", "opts": "ABCD"},
    {"group": ("reading", "阅读理解 A 篇", "细节理解题，共 2 题"), "qtype": "choice", "ref": "P1", "opts": "ABCD"},
    {"group": ("cloze7", "七选五", "语篇结构与衔接"), "qtype": "choice", "ref": "P2", "opts": "ABCDEFG"},
    {"group": ("grammar", "语法填空", "课标语法点专项"), "qtype": "blank", "ref": "", "opts": ""},
    {"group": ("writing_cont", "读后续写", "情节协同与语言协同"), "qtype": "writing", "ref": "", "opts": ""},
]

_PAPER_TITLE = "2026 届高三英语一模试卷（假后端样本）"
_NOTICE = "全卷题目由假后端生成，仅用于前端流程测试，不是真实真题。"

# ---------------------------------------------------------------- 语篇


_PASSAGES: dict[str, str] = {
    "P1": (
        "Cities once planted trees the way they hung banners: for the occasion. "
        "The plane trees along the avenue were decoration, pruned into shape each autumn "
        "and otherwise left to fend for themselves. Over the past two decades that view has "
        "quietly reversed. Planners now speak of canopy cover the way engineers speak of "
        "load-bearing walls, and the argument they make is unglamorous and measurable: "
        "a street with thirty per cent shade is several degrees cooler at four in the "
        "afternoon than a street with none.\n"
        "What changed was not affection for trees but the arrival of instruments. "
        "Once cities began logging surface temperatures, the cooling effect stopped being "
        "a matter of taste. A district that replaced a parking lot with a small wood "
        "recorded a drop of 2.3 degrees on its hottest afternoons, and the same district "
        "found its summer electricity bills falling by a margin that paid for the planting "
        "within a decade."
    ),
    "P2": (
        "Every argument has a shape, and learning to see that shape is more useful "
        "than memorising any single essay. The classical pattern begins with a claim "
        "that can be doubted, then offers evidence that could in principle have turned "
        "out otherwise.  35  Where either half is missing, what remains is only assertion. "
        "A student who writes with confidence but supplies nothing checkable has produced "
        "the first half alone. A student who piles up facts without a claim has produced "
        "the second half alone. Neither is an argument.\n"
        "The practical lesson is unromantic: before drafting, write the claim in one "
        "sentence, then list the evidence that would count against it. If nothing "
        "would count against it, the claim is not yet arguable."
    ),
}

# ---------------------------------------------------------------- 题干素材


def _stems(no: int) -> tuple[str, list[str]]:
    """返回 (stem 文本, 选项文本列表)。"""
    shape = _SHAPES[(no - 1) % len(_SHAPES)]
    gid = shape["group"][0]
    if gid == "reading":
        stem = (
            "What does the author suggest about cities' attitude towards trees?"
            if no % 2 == 1 else
            "Why does the author mention the electricity bills of the district?"
        )
        opts = [
            "They now treat trees as part of the urban infrastructure.",
            "They plant trees mainly to improve the appearance of streets.",
            "They prefer instruments to trees when measuring temperature.",
            "They plant trees only where parking lots have been removed.",
        ] if no % 2 == 1 else [
            "To prove that logging surface temperatures is expensive.",
            "To show that the benefit of planting can be measured in money.",
            "To explain why summer electricity is more costly in cities.",
            "To argue that trees should be pruned every autumn.",
        ]
        return stem, opts
    if gid == "cloze7":
        stem = "根据短文内容，从短文后的选项中选出能填入空白处的最佳选项。选项中有一项为多余选项。"
        return stem, [
            "However, the pattern is older than the essay itself.",
            "In practice, this means writing the claim first.",
            "Consequently, most students never test their own claims.",
            "The evidence must therefore be of a particular kind.",
            "Nothing in this procedure guarantees a good essay.",
            "What it does guarantee is an arguable one.",
            "Teachers have long recognised the difference.",
            "Such facts are useful but not sufficient.",
        ][:7]
    if gid == "grammar":
        return "语法填空：阅读下面短文，在空白处填入 1 个适当的单词或括号内单词的正确形式。", []
    return (
        "读后续写：阅读下面短文，根据所给情节进行续写，使之构成一个完整的故事。",
        [],
    )


def _transfers(no: int, count: int) -> list[dict]:
    """第 no 题的 count 道迁移题。"""
    out = []
    for i in range(1, count + 1):
        out.append({
            "passage": (
                f"Transfer passage {no}.{i}. Coastal towns once lit their streets with oil "
                f"lamps that a single keeper tended by hand. When electricity arrived, the "
                f"keeper's route was redesignated as a maintenance schedule, and the lamps "
                f"themselves were left in place for another thirty years."
            ),
            "stem": f"What does the author suggest about the oil lamps after electricity arrived? ({no}.{i})",
            "options": [
                "They were removed as soon as electricity arrived.",
                "They remained in use long after their purpose changed.",
                "They were tended by more keepers than before.",
                "They were redesignated as maintenance schedules.",
            ],
            "answer": "B",
            "explanation": (
                "依据第二句中的 redesignated 与 left in place for another thirty years，"
                "B 项是对这两处的同义概括；A 项与原文直接矛盾；D 项把「路线被改称为检修计划」"
                "偷换成「灯被改称」；C 项在原文中没有对应信息。"
            ),
        })
    return out


# ---------------------------------------------------------------- 构造器


class PaperBuilder:
    """增量拼装试卷文本；负责 @@GROUP@@ 只在该切换时输出一次。"""

    def __init__(self, total: int, *, suppress_group: str = "", suppress_defs: set[str] | None = None) -> None:
        self.total = total
        self.out: list[str] = []
        self.last_group: str | None = None
        self.last_def: set[str] = set()
        self.suppress_group = suppress_group
        # 续写时这些编号已在已生成内容里声明过全文，不能再写一遍 PASSAGE_DEF
        self.suppress_defs = suppress_defs or set()

    def header(self) -> None:
        self.out.append(f"@@TOTAL@@ {self.total}\n")
        self.out.append(f"@@PAPER@@ {_PAPER_TITLE}\n")
        self.out.append(f"@@NOTICE@@ {_NOTICE}\n")

    def group(self, spec: dict) -> None:
        gid, title, intro = spec["group"]
        if gid == self.last_group:
            return
        if gid == self.suppress_group:
            # 续写首题仍属同一板块：按简报约定不再重复 @@GROUP@@ 行
            self.last_group = gid
            return
        self.out.append(f"@@GROUP@@ {gid}|{title}|{intro}\n")
        self.last_group = gid

    def passage_def(self, spec: dict) -> None:
        ref = spec["ref"]
        if not ref or ref in self.last_def or ref in self.suppress_defs:
            return
        self.out.append(f"@@PASSAGE_DEF@@ {ref}\n")
        self.out.append(_PASSAGES[ref] + "\n")
        self.last_def.add(ref)

    def question(self, no: int, transfers: int = 1, *, cut: bool = False) -> None:
        spec = _SHAPES[(no - 1) % len(_SHAPES)]
        self.group(spec)
        self.passage_def(spec)
        self.out.append(f"@@Q@@ {no}\n")
        self.out.append(f"@@QTYPE@@ {spec['qtype']}\n")
        if spec["ref"]:
            self.out.append(f"@@PASSAGE_REF@@ {spec['ref']}\n")
        stem, opts = _stems(no)
        self.out.append(f"@@STEM@@\n{stem}\n")
        if spec["opts"]:
            self.out.append("@@OPTIONS@@\n")
            for label, text in zip(spec["opts"], opts):
                self.out.append(f"{label}. {text}\n")
        else:
            self.out.append("@@OPTIONS@@\n")
        if spec["qtype"] == "writing":
            self.out.append("@@WRITING_POINTS@@\n")
            self.out.append("- 第一段以 When the lights came back on 开头\n")
            self.out.append("- 第二段以 It was then that she noticed 开头\n")
            self.out.append("@@WRITING_OUTLINE@@\n")
            self.out.append("停电 → 摸黑找蜡烛 → 邻居敲门 → 决定邀请邻居共进晚餐\n")
            self.out.append("@@WRITING_SAMPLE@@\n")
            self.out.append(
                "When the lights came back on, the room looked smaller than she remembered, "
                "as though the dark had moved the walls inward while nobody was watching.\n"
            )
            # 校验器要求每题的 pattern.name 非空，写作题同样要写
            self.out.append("@@PATTERN_NAME@@\n读后续写情节协同\n")
            self.out.append("@@PATTERN_STEPS@@\n梳理原文情节线\n规划两段功能分工\n保证语言风格协同\n")
            if cut:
                self.out.append("It was then that she noticed the")
                return
            self.out.append("@@END_Q@@\n")
            return
        self.out.append("@@ANSWER@@\nB\n")
        self.out.append("@@EVIDENCE@@\nPara 2: the same district found its summer electricity bills falling.\n")
        self.out.append("@@REASON@@\n用可量化的收益说明种植的经济合理性\n")
        self.out.append("@@DISTRACTOR@@\nA 项把「现在」说成「过去」，与首段的今昔对比矛盾\n")
        self.out.append("@@PITFALLS@@\n")
        self.out.append("偷换主体::把「城市的看法」换成「仪器的功能」\n")
        self.out.append("程度失真::把「十年内回本」夸成「立刻见效」\n")
        self.out.append("@@PATTERN_NAME@@\n细节定位\n")
        self.out.append("@@PATTERN_STEPS@@\n划出唯一性最高的关键词\n带关键词回原文定位\n把区间表述与选项逐词比对\n")
        for tr in _transfers(no, transfers):
            self.out.append(f"@@TRANSFER_PASSAGE@@\n{tr['passage']}\n")
            self.out.append(f"@@TRANSFER_STEM@@\n{tr['stem']}\n")
            self.out.append("@@TRANSFER_OPTIONS@@\n")
            for label, text in zip("ABCD", tr["options"]):
                self.out.append(f"{label}. {text}\n")
            self.out.append(f"@@TRANSFER_ANSWER@@\n{tr['answer']}\n")
            self.out.append(f"@@TRANSFER_EXPL@@\n{tr['explanation']}\n")
            if cut:
                self.out.append("@@TRANSFER_EXPL@@\n解析尚未写完")
                return
        if cut:
            # 在第二块迁移中间掐断：保留半截内容，模拟真被截断的输出
            self.out.append("@@TRANSFER_PASSAGE@@\nTransfer passage 未完成")
            return
        self.out.append("@@END_Q@@\n")

    def text(self) -> str:
        return "".join(self.out)


# ---------------------------------------------------------------- 对外接口


def build_paper(plan: Any, req: dict, input_text: str) -> str:
    """按执行计划产出试卷正文；检测到【续写指令】时走续写分支。"""
    brief = parse_continue_brief(input_text or "")
    if brief:
        return build_resume(brief)
    total = int(plan.paper_questions or 5)
    done = int(plan.paper_done or 0) or total
    builder = PaperBuilder(total)
    builder.header()
    cut = plan.fault == "truncate" and done < total
    for no in range(1, done + 1):
        builder.question(no, plan.transfer_count)
    if cut:
        builder.question(done + 1, plan.transfer_count, cut=True)
    return builder.text()


_BRIEF_TOTAL_RE = re.compile(r"全卷\s*(\d+)\s*题，已完成\s*(\d+)\s*题")
_BRIEF_LAST_RE = re.compile(r"最后一题是第\s*([^\s，。]+)\s*题，属于板块\s*`([^|`]+)\|([^`]*)`")
_BRIEF_REMAIN_RE = re.compile(r"写完剩余\s*(\d+)\s*题")
_BRIEF_TRANSFER_RE = re.compile(r"仍输出\s*(\d+)\s*块迁移")
# 「语篇写法：已用编号 P1（阅读理解 A 篇）、P2（七选五），这些语篇一律写 ...」
_BRIEF_REFS_RE = re.compile(r"已用编号([^，。]*)")
_REF_TOKEN_RE = re.compile(r"\b([A-Za-z]{1,3}\d{0,2})\b")


def parse_continue_brief(text: str) -> dict | None:
    """解析前端 vpContinueBrief() 拼出的续写简报；不是续写请求则返回 None。"""
    if "【续写指令】" not in text:
        return None
    brief: dict[str, Any] = {}
    m = _BRIEF_TOTAL_RE.search(text)
    if m:
        brief["total"] = int(m.group(1))
        brief["done"] = int(m.group(2))
    m = _BRIEF_LAST_RE.search(text)
    if m:
        brief["last_no"] = m.group(1).strip()
        brief["group_id"] = m.group(2).strip()
        brief["group_title"] = m.group(3).strip()
    m = _BRIEF_REMAIN_RE.search(text)
    if m:
        brief["remaining"] = int(m.group(1))
    m = _BRIEF_TRANSFER_RE.search(text)
    if m:
        brief["transfer_count"] = int(m.group(1))
    m = _BRIEF_REFS_RE.search(text)
    if m:
        refs = []
        for token in _REF_TOKEN_RE.findall(m.group(1)):
            if token.upper() not in ("P",) and token not in refs:
                refs.append(token)
        brief["used_refs"] = refs
    return brief or None


def _as_int(value, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def build_resume(brief: dict) -> str:
    """按简报续写剩余题目。输出会被前端原样追加到已有正文之后。"""
    total = _as_int(brief.get("total"), 0)
    last_no = _as_int(brief.get("last_no"), _as_int(brief.get("done"), 0))
    if total <= 0:
        total = last_no + 3
    transfers = _as_int(brief.get("transfer_count"), 1) or 1
    next_no = last_no + 1
    used = set()
    for ref in brief.get("used_refs") or []:
        used.add(str(ref).strip().upper())
    builder = PaperBuilder(total, suppress_group=str(brief.get("group_id") or ""), suppress_defs=used)
    for no in range(next_no, total + 1):
        builder.question(no, transfers)
    return builder.text()


def validate(text: str) -> tuple[bool, list[str]]:
    """用真实校验器检查样本是否合法。"""
    data = parse_custom_visual_paper(text)
    if data is None:
        return False, ["未识别到任何 @@TAG@@"]
    return validate_visual_paper(data)


# /api/parse/file 成功时返回的「从 PDF 里解析出来的试卷原文」。
# 直接喂给试卷可视化全解工具即可跑通「上传 → 解卷」整条链路。
SAMPLE_EXAM_TEXT = """2026 届高三英语一模试卷

第一节 阅读理解 A 篇（共 2 题）

Cities once planted trees the way they hung banners: for the occasion. The plane trees
along the avenue were decoration, pruned into shape each autumn and otherwise left to
fend for themselves. Over the past two decades that view has quietly reversed. Planners
now speak of canopy cover the way engineers speak of load-bearing walls, and the argument
they make is unglamorous and measurable: a street with thirty per cent shade is several
degrees cooler at four in the afternoon than a street with none.

What changed was not affection for trees but the arrival of instruments. Once cities began
logging surface temperatures, the cooling effect stopped being a matter of taste. A district
that replaced a parking lot with a small wood recorded a drop of 2.3 degrees on its hottest
afternoons, and the same district found its summer electricity bills falling by a margin
that paid for the planting within a decade.

1. What does the author suggest about cities' attitude towards trees?
A. They now treat trees as part of the urban infrastructure.
B. They plant trees mainly to improve the appearance of streets.
C. They prefer instruments to trees when measuring temperature.
D. They plant trees only where parking lots have been removed.

2. Why does the author mention the electricity bills of the district?
A. To prove that logging surface temperatures is expensive.
B. To show that the benefit of planting can be measured in money.
C. To explain why summer electricity is more costly in cities.
D. To argue that trees should be pruned every autumn.

第二节 七选五（共 1 题）

Every argument has a shape, and learning to see that shape is more useful than memorising
any single essay. The classical pattern begins with a claim that can be doubted, then offers
evidence that could in principle have turned out otherwise.   35   Where either half is
missing, what remains is only assertion. A student who writes with confidence but supplies
nothing checkable has produced the first half alone. A student who piles up facts without a
claim has produced the second half alone. Neither is an argument.

The practical lesson is unromantic: before drafting, write the claim in one sentence, then
list the evidence that would count against it. If nothing would count against it, the claim
is not yet arguable.

A. However, the pattern is older than the essay itself.
B. In practice, this means writing the claim first.
C. Consequently, most students never test their own claims.
D. The evidence must therefore be of a particular kind.
E. Nothing in this procedure guarantees a good essay.
F. What it does guarantee is an arguable one.
G. Teachers have long recognised the difference.

第三节 语法填空（共 1 题）

阅读下面短文，在空白处填入 1 个适当的单词或括号内单词的正确形式。

Coastal towns once lit their streets with oil lamps that a single keeper tended by hand.
When electricity arrived, the keeper's route  4  (redesignate) as a maintenance schedule,
and the lamps themselves  5  (leave) in place for another thirty years.

第四节 读后续写（共 1 题）

阅读下面短文，根据所给情节进行续写，使之构成一个完整的故事。

The storm took the power line down at nine, and by ten the whole street was dark. Mei
lighted two candles and set them on the table, and for a while mother and daughter sat
watching the flames bend whenever a gust found the gap under the door. Then someone
knocked.

注意：本试卷由假后端生成，仅用于前端流程测试。
"""
