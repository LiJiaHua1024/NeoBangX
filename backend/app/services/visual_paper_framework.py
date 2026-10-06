"""试卷可视化全解·阶段一（框架标注）：把 Chores 模型的插标指令应用到原卷，流式派生 @@TAG@@ 骨架文档。

协议（与 prompts/试卷可视化全解框架.md 一一对应）：

- Chores 模型先输出 @@TOTAL@@ / @@PAPER@@ 两行头，再逐条输出单行插标指令：
  ``@@MARK <类型>[ <参数>]@@ <锚点>``，锚点是从原卷逐字抄的一小段文字。
- applier 用「正向游标」定位锚点：从上一个标记位置向后找，先精确匹配、
  再空白归一化、最后忽略大小写；找不到就丢弃该条并计数，绝不着墨。
- 标记插在锚点之前；锚点允许落在行中间——applier 在匹配点断行，
  从而切开「语篇末尾和题号挤同一行」「题干和选项挤同一行」这类排版。
  原文内容一个字都不由模型输出，骨架正文全部来自原卷。

标记类型与区域语义（区域 = 上一个锚点到本锚点之间的原文）：

- ``GROUP id|title``  分组头，区域是板块标题等噪声，丢弃
- ``PASSAGE Pn``      语篇开始，区域是语篇正文
- ``Q n``             单题开始，区域是题干（题干首行剥掉与题号一致的卷面号）
- ``Q n-m``           区间声明（空在语篇里的题，如语法填空）：立即生成 n..m 的空题块，
                      纯声明、不改变当前区域
- ``OPTIONS``         选项开始，区域是选项行；无开题时收进组池，随组内后续题目重复附带
- ``OPTIONS n-m``     共享选项池（七选五）：区域是池子，收口时生成 n..m 各一块
- ``KEY``             卷末答案/解析区开始，区域原样保留（供阶段二核对答案）
- ``CUT``             当前区域在此提前收口，其后内容按噪声丢弃（语篇后的「阅读下列短文…」等）

在定向输出之外，applier 还做几件确定性防御：选项行按标号拆成一行一项、
折行并入上一项；题干尾部连续选项样式的行并回选项（模型漏发 OPTIONS 标记时自救）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from app.services.visual_paper import ALLOWED_GROUP_IDS

# 单行插标指令：@@MARK 类型[ 参数]@@ 锚点。类型与参数之间容许下划线漂移（MARK_OPTIONS）。
MARK_LINE_RE = re.compile(
    r"^[＠@]{2,}\s*MARK[\s_]+(GROUP|PASSAGE|Q|OPTIONS|KEY|CUT)\b[^＠@]*[＠@]{2,}[ \t]*(.*)$",
    re.IGNORECASE,
)
# 类型与参数拆分：@@MARK Q 24@@ → args="Q 24"。MARK 与收尾 @@ 之间整段取 args。
MARK_ARGS_RE = re.compile(
    r"^[＠@]{2,}\s*MARK[\s_]+(GROUP|PASSAGE|Q|OPTIONS|KEY|CUT)\s+([^＠@]+)[＠@]{2,}[ \t]*(.*)$",
    re.IGNORECASE,
)
# 头部行：@@TOTAL@@ 25 / @@PAPER@@ 标题（容忍 = 与冒号收尾的家规漂移）
HEADER_LINE_RE = re.compile(
    r"^[＠@]{2,}\s*(TOTAL|PAPER)\s*(?:[＠@]{2,}|=|＝|[:：]{1,2})[ \t]*(.*)$",
    re.IGNORECASE,
)
# 题干首行的卷面题号：(24) / 24. / 24、 / 24．——纯数字后无标点不剥，防止误伤以年份等开头的题干
STEM_LEAD_NO_RE = re.compile(r"^\s*(?:[\(（]\s*0*(\d{1,3})\s*[\)）]|0*(\d{1,3})\s*[\.、．])\s*")
# 选项行开头（题干尾部自救判定用）
OPT_LABEL_START_RE = re.compile(r"^\s*[A-G][\.、:：\)）]\s*")
# 选项行内的标号切分点：行首或空格后的 A-G（含括号包法）。只认大写，避开 e.g. / i.e. 这类小写缩写
OPT_LABEL_SPLIT_RE = re.compile(r"(?:^|(?<=\s))(?:[（(]([A-G])[\)）]|([A-G])[\.、:：\)）])[ \t]*")
# 选项行自带的题号前缀（完形填空的 "21. A. hoped B. wanted" 一行）
OPT_LEAD_NO_RE = re.compile(r"^\s*[\(（]?\d{1,3}[\)）]?\s*[\.、．]\s*")
_Q_RANGE_SEPS = str.maketrans({"～": "-", "—": "-", "–": "-", "~": "-"})


@dataclass
class FrameworkStats:
    marks_total: int = 0
    marks_applied: int = 0
    marks_skipped: int = 0
    questions: int = 0
    passages: int = 0
    pools: int = 0

    def as_dict(self) -> dict:
        return {
            "marks_total": self.marks_total,
            "marks_applied": self.marks_applied,
            "marks_skipped": self.marks_skipped,
            "questions": self.questions,
            "passages": self.passages,
            "pools": self.pools,
        }

    @property
    def ok(self) -> bool:
        """骨架是否值得交给阶段二：至少解析出一道题，且命中了不止一两条标记
        （只命中一两处的骨架大概率是锚点大面积失配，不如回退老路径）。"""
        return self.questions >= 1 and self.marks_applied >= 3


def _trim_blank_edges(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]


def _parse_range(args: str) -> Optional[tuple[int, int]]:
    a = args.strip().translate(_Q_RANGE_SEPS)
    m = re.fullmatch(r"(\d{1,3})\s*-\s*(\d{1,3})", a)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    return (lo, hi) if lo <= hi else (hi, lo)


def _parse_q_no(args: str, anchor: str) -> Optional[str]:
    a = args.strip()
    m = re.search(r"\d{1,3}", a)
    if m:
        return str(int(m.group()))
    # 容错：题号忘写进参数时，从锚点开头的 "24. xxx" 里取
    m = re.match(r"^\s*[\(（]?(\d{1,3})[\)）]?\s*[\.、．]", anchor.strip())
    if m:
        return str(int(m.group(1)))
    return None


def _parse_group_args(args: str) -> tuple[str, str]:
    parts = [p.strip() for p in args.strip().split("|")]
    gid = parts[0] if parts and parts[0] else "other"
    if gid not in ALLOWED_GROUP_IDS:
        # 兼容中文标题误作 id：整段当标题，id 落到 other
        return "other", (parts[0] if parts and parts[0] else "其他")
    title = parts[1] if len(parts) > 1 and parts[1] else gid
    return gid, title


def _parse_passage_ref(args: str) -> str:
    a = args.strip()
    if not a:
        return ""
    m = re.match(r"^[Pp]\s*[-.]?\s*(\d+)$", a)
    if m:
        return f"P{int(m.group(1))}"
    if re.fullmatch(r"\d+", a):
        return f"P{int(a)}"
    return a


class FrameworkApplier:
    """增量应用 Chores 模型的插标指令，产出经典 @@TAG@@ 骨架文档。

    用法：构造时传入原卷全文，流式 ``feed(token)``，结束时 ``finish()``；
    两个方法的返回值都是「新增的骨架文本」（可能为空串），调用方逐段推给前端。
    """

    def __init__(self, raw_text: str):
        self._lines: list[str] = raw_text.splitlines()
        # 游标 = 上一个锚点的切点，既是锚点搜索起点，也是当前区域的左边界
        self._cut: tuple[int, int] = (0, 0)
        self._region: str = "noise"          # noise | passage | stem | options | key
        self._question: Optional[dict] = None  # {"no", "options", "options_emitted"}
        self._group: Optional[dict] = None
        self._group_pool: Optional[list[str]] = None
        self._group_seq: dict[str, int] = {}   # 每个板块 id 已声明的分组数（消歧用）
        self._last_group_key: Optional[tuple[str, str]] = None
        # 开组时的语篇状态：读后续写的材料语篇在组内声明（要求行在前、原文在后），
        # 组内有没有自己的语篇以此为基准判断
        self._group_passage_ref = ""
        self._passage_ref = ""
        self._last_no: Optional[int] = None
        self._options_range: Optional[tuple[int, int]] = None
        # 区间 Q 声明的题块延后派生：等到所属语篇正文收口再发出，
        # 否则要么拿错 PASSAGE_REF（语篇还没声明），要么把语篇正文的收集打断
        self._pending_q_ranges: list[tuple[int, int]] = []
        self._last_mark: Optional[tuple[str, str, int, int]] = None
        self._buf = ""
        self._pending: list[str] = []        # 待取走的派生行
        self._all: list[str] = []            # 全量骨架（阶段二的 material）
        self.stats = FrameworkStats()

    # ---------- 增量入口 ----------

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            self._feed_line(line)
        return self._take()

    def finish(self) -> str:
        if self._buf.strip():
            self._feed_line(self._buf)
            self._buf = ""
        self._close_region(self._region_text(len(self._lines), 0))
        self._close_question()
        if self._pending_q_ranges:
            self._flush_pending_q_ranges()
        return self._take()

    def _take(self) -> str:
        if not self._pending:
            return ""
        text = "\n".join(self._pending) + "\n"
        self._pending = []
        return text

    @property
    def skeleton_text(self) -> str:
        return "\n".join(self._all)

    # ---------- 指令行识别 ----------

    def _feed_line(self, line: str) -> None:
        stripped = line.strip()
        if not stripped:
            return
        m = MARK_ARGS_RE.match(stripped)
        if m:
            self._apply_mark(m.group(1).upper(), m.group(2).strip(), m.group(3))
            return
        # 容错：@@MARK Q@@ 24. xxx（类型有、参数忘写）——参数空但整体仍是 MARK 行
        m = MARK_LINE_RE.match(stripped)
        if m:
            self._apply_mark(m.group(1).upper(), "", m.group(2))
            return
        h = HEADER_LINE_RE.match(stripped)
        if h:
            value = h.group(2).strip()
            self._emit([f"@@{h.group(1).upper()}@@ {value}".rstrip()])
        # 其余输出（解释、闲聊、误吐的正文）一律忽略

    # ---------- 锚点定位 ----------

    def _find_anchor(self, anchor: str) -> Optional[tuple[int, int]]:
        a = anchor.strip()
        if not a:
            return self._cut  # 空锚点：就地插标（协议要求必填，这里兜底不炸）
        if len(a) < 2:
            # 单字符锚点（篇标 "A"、孤立数字）几乎必然误配到正文/选项标号里，直接拒收
            return None
        # 短锚点先只认行首（"B篇" 这类篇标通常独占一行或顶行首），
        # 失败再回退全文匹配；长锚点保持原来的任意位置匹配
        if len(a) <= 4:
            pos = self._search(a, _line_start_matcher(a))
            if pos is not None:
                return pos
        pos = self._search(a, lambda line, start: line.find(a, start))
        if pos is not None:
            return pos
        # 空白归一化：模型抄锚点时多打了空格/换行拼行
        tokens = [t for t in a.split() if t]
        if tokens:
            pattern = r"\s+".join(re.escape(t) for t in tokens)
            pos = self._search(a, lambda line, start: _regex_search(pattern, line, start))
            if pos is not None:
                return pos
            # 忽略大小写再兜一层
            pos = self._search(
                a, lambda line, start: _regex_search(pattern, line, start, ignore_case=True)
            )
        return pos

    def _search(self, anchor: str, matcher) -> Optional[tuple[int, int]]:
        """从游标行:列起向后逐行找；matcher 返回命中列号或 -1。"""
        cl, cc = self._cut
        if cl < len(self._lines):
            hit = matcher(self._lines[cl], cc)
            if hit >= 0:
                return (cl, hit)
        for i in range(cl + 1, len(self._lines)):
            hit = matcher(self._lines[i], 0)
            if hit >= 0:
                return (i, hit)
        return None

    # ---------- 区域内容 ----------

    def _region_text(self, new_line: int, new_col: int) -> list[str]:
        """上一个切点 → 新切点之间的原文，作为当前区域的内容。"""
        cl, cc = self._cut
        out: list[str] = []
        if cl >= len(self._lines):
            return out
        if cl == new_line:
            seg = self._lines[cl][cc:new_col] if new_col >= cc else self._lines[cl][cc:]
            if seg.strip():
                out.append(seg)
            return out
        head = self._lines[cl][cc:]
        if head.strip():
            out.append(head.rstrip())
        for i in range(cl + 1, min(new_line, len(self._lines))):
            out.append(self._lines[i])
        if new_line < len(self._lines):
            tail = self._lines[new_line][:new_col]
            if tail.strip():
                out.append(tail.rstrip())
        return out

    # ---------- 标记应用 ----------

    def _apply_mark(self, mtype: str, args: str, anchor: str) -> None:
        self.stats.marks_total += 1
        pos = self._find_anchor(anchor)
        if pos is None:
            self.stats.marks_skipped += 1
            return
        # 同型同参且命中同一位置 = 重复指令，跳过（同位置不同类型是合法的：Q 与 OPTIONS 同锚）
        if self._last_mark is not None:
            lt, la, ll, lc = self._last_mark
            if lt == mtype and la == args and (ll, lc) == pos:
                self.stats.marks_skipped += 1
                return
        if mtype == "Q":
            rng = _parse_range(args)
            if rng is not None:
                # 区间声明：空在语篇里的题（语法填空等）。纯声明——不收口区域、
                # 不推进游标，锚点即使打在语篇中间也不会把正文截断
                self.stats.marks_applied += 1
                self._pending_q_ranges.append(rng)
                self._set_last_no(rng[1])
                return
        closed_kind = self._region
        # 语篇标记在本题收口时到达（读后续写：要求行在前、材料原文在后）：
        # 先更新语篇状态，收题的延迟引用才挂得上；正文行的落位不受影响
        pending_passage_ref = None
        if mtype == "PASSAGE":
            pending_passage_ref = _parse_passage_ref(args) or f"P{self.stats.passages + 1}"
            if (self._group or {}).get("id") == "writing_cont" and self._question is not None:
                self._passage_ref = pending_passage_ref
        self._close_region(self._region_text(*pos))
        if self._question is not None and mtype != "OPTIONS":
            self._close_question()
        if closed_kind == "passage" and self._pending_q_ranges:
            # 语篇正文刚收口：此时挂起的区间题块所属语篇已确定，派生才拿到正确引用
            self._flush_pending_q_ranges()
        self._cut = pos
        self._last_mark = (mtype, args, pos[0], pos[1])
        self.stats.marks_applied += 1
        if mtype == "GROUP":
            gid, title = _parse_group_args(args)
            # 同 id 同标题的相邻分组会被解析端当成「重复声明」合并成一组——
            # 分组跟着语篇走之后，那就是把两篇并回一组。自动追加序号消歧。
            if self._last_group_key == (gid, title):
                self._group_seq[gid] = self._group_seq.get(gid, 1) + 1
                title = f"{title}（第{self._group_seq[gid]}组）"
            else:
                self._group_seq[gid] = self._group_seq.get(gid, 0) + 1
            self._last_group_key = (gid, title)
            self._group = {"id": gid, "title": title}
            # 记下本组开组时的语篇状态：组内后来声明过新语篇，才算这个组的材料
            self._group_passage_ref = self._passage_ref
            self._group_pool = None
            self._emit([f"@@GROUP@@ {gid}|{title}|"])
            self._region = "noise"
        elif mtype == "PASSAGE":
            ref = pending_passage_ref
            self._passage_ref = ref
            self.stats.passages += 1
            self._emit([f"@@PASSAGE_DEF@@ {ref}"])
            self._region = "passage"
        elif mtype == "Q":
            no = _parse_q_no(args, anchor) or self._next_no()
            self._question = {"no": no, "options": None, "options_emitted": False}
            self._set_last_no(no)
            ref_line = self._passage_ref_line()
            if ref_line is None:
                # 读后续写：材料语篇印在要求行之后，引用延迟到收题再定
                self._emit([f"@@Q@@ {no}"])
            else:
                self._emit([f"@@Q@@ {no}", ref_line])
            self.stats.questions += 1
            self._region = "stem"
        elif mtype == "OPTIONS":
            rng = _parse_range(args)
            if rng is not None:
                self._options_range = rng
            elif self._question is not None:
                self._emit(["@@OPTIONS@@"])
            self._region = "options"
        elif mtype == "KEY":
            self._emit(["@@KEY@@"])
            self._region = "key"
        else:  # CUT
            self._region = "noise"

    # ---------- 区域收口 ----------

    def _close_region(self, content: list[str]) -> None:
        kind = self._region
        self._region = "noise"
        content = _trim_blank_edges(content)
        if not content:
            return
        if kind == "passage":
            self._emit(content)
        elif kind == "stem":
            if self._question is not None:
                stem_lines, rescued = self._clean_stem(content, self._question["no"])
                if rescued and not self._question.get("options"):
                    self._question["options"] = rescued
                if stem_lines:
                    self._emit(["@@STEM@@"] + stem_lines)
        elif kind == "options":
            opts = self._normalize_options(content)
            if self._options_range is not None:
                lo, hi = self._options_range
                self._options_range = None
                if opts:
                    self._group_pool = opts
                    self.stats.pools += 1
                    self._emit_q_blocks(lo, hi, pool=opts)
                else:
                    self.stats.marks_skipped += 1
            elif self._question is not None:
                if opts:
                    self._question["options"] = opts
                    self._question["options_emitted"] = True
                    self._emit(opts)
            elif opts:
                # 池子印在题目前（共享池）：收进组池，随组内题目重复附带
                self._group_pool = opts
                self.stats.pools += 1
        elif kind == "key":
            self._emit(content)

    def _close_question(self) -> None:
        q = self._question
        self._question = None
        if q is None:
            return
        gid = self._group["id"] if self._group else ""
        if gid == "writing_cont" and self._passage_ref and self._passage_ref != self._group_passage_ref:
            # 读后续写：材料语篇（故事原文+开头语）在本组内声明过——收题时才确定归属，
            # 此刻的语篇就是本题的材料；组内没声明过则按「无独立语篇」处理
            self._emit([f"@@PASSAGE_REF@@ {self._passage_ref}"])
        if not q.get("options_emitted"):
            opts = q.get("options") or self._group_pool
            if opts:
                self._emit(["@@OPTIONS@@"] + opts)
        self._emit(["@@END_Q@@"])

    def _flush_pending_q_ranges(self) -> None:
        ranges, self._pending_q_ranges = self._pending_q_ranges, []
        for lo, hi in ranges:
            self._emit_q_blocks(lo, hi, pool=None)

    # ---------- 派生辅助 ----------

    def _emit(self, lines: list[str]) -> None:
        self._pending.extend(lines)
        self._all.extend(lines)

    def _passage_ref_line(self) -> Optional[str]:
        gid = self._group["id"] if self._group else ""
        if gid == "writing_app":
            # 应用文没有语篇材料
            return "@@PASSAGE_REF@@ -"
        if gid == "writing_cont":
            # 读后续写的材料语篇印在要求行之后，引用延迟到收题再定（见 _close_question）
            return None
        return f"@@PASSAGE_REF@@ {self._passage_ref or '-'}"

    def _next_no(self) -> str:
        return str((self._last_no or 0) + 1)

    def _set_last_no(self, no) -> None:
        try:
            self._last_no = int(re.sub(r"\D", "", str(no)) or self._last_no or 0)
        except ValueError:
            pass

    def _emit_q_blocks(self, lo: int, hi: int, pool: Optional[list[str]]) -> None:
        for k in range(lo, hi + 1):
            lines = [f"@@Q@@ {k}"]
            ref_line = self._passage_ref_line()
            if ref_line is not None:
                lines.append(ref_line)
            if pool:
                lines += ["@@OPTIONS@@"] + pool
            lines.append("@@END_Q@@")
            self._emit(lines)
            self.stats.questions += 1

    def _clean_stem(self, lines: list[str], no: str) -> tuple[list[str], list[str]]:
        """题干清理：剥卷面题号 + 尾部选项行自救。返回 (题干行, 自救出的选项行)。"""
        lines = list(lines)
        no_digits = re.sub(r"\D", "", str(no))
        if lines and no_digits:
            m = STEM_LEAD_NO_RE.match(lines[0])
            if m:
                lead = m.group(1) or m.group(2)
                if lead is not None and lead.lstrip("0") == no_digits.lstrip("0"):
                    rest = lines[0][m.end():]
                    lines = lines[1:]
                    if rest.strip():
                        lines.insert(0, rest)
                    elif not lines:
                        lines = []
        # 尾部连续 ≥2 行选项样式 = 模型漏发 OPTIONS 标记，把选项从题干里接回来
        i = len(lines)
        while i > 0 and OPT_LABEL_START_RE.match(lines[i - 1]):
            i -= 1
        if len(lines) - i >= 2:
            return lines[:i], lines[i:]
        return lines, []

    @staticmethod
    def _normalize_options(lines: list[str]) -> list[str]:
        """选项归一：剥题号前缀、按标号拆成一行一项、折行并入上一项。"""
        out: list[str] = []
        for raw in lines:
            line = OPT_LEAD_NO_RE.sub("", raw.rstrip())
            if not line.strip():
                continue
            matches = list(OPT_LABEL_SPLIT_RE.finditer(line))
            if not matches:
                if out:
                    out[-1] = out[-1].rstrip() + " " + line.strip()
                else:
                    out.append(line.strip())
                continue
            for i, m in enumerate(matches):
                label = m.group(1) or m.group(2)
                start = m.end()
                end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
                text = line[start:end].strip().lstrip("．.、:：)） ")
                if text:
                    out.append(f"{label}. {text}")
        return out


def render_numbered_lines(text: str) -> str:
    """把原卷渲染成带行号的材料（阶段一输入）：每行「行号 | 原文」。

    行号只是给模型定位用的参照；插标指令的锚点抄的是原文本身，不含行号前缀。
    """
    lines = text.splitlines()
    width = max(3, len(str(len(lines))))
    return "\n".join(f"{i:>{width}} | {line}" for i, line in enumerate(lines, 1))


def _regex_search(pattern: str, line: str, start: int, ignore_case: bool = False) -> int:
    flags = re.IGNORECASE if ignore_case else 0
    if start > 0:
        line = line[start:]
    m = re.search(pattern, line, flags)
    return (m.start() + start) if m else -1


def _line_start_matcher(anchor: str):
    """短锚点的行首匹配：只认「剥掉行首空白后以锚点开头」的行，命中即该行首个非空白处。"""
    def matcher(line: str, start: int) -> int:
        if start > 0:
            line = line[start:]
        stripped = line.lstrip()
        if stripped.startswith(anchor):
            return (len(line) - len(stripped)) + start
        return -1
    return matcher
