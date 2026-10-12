"""有界并行精讲：共享组内材料，独立解析上游流，只提交归属明确的完整题块。"""

from __future__ import annotations

import asyncio
import logging
import re
from contextlib import aclosing
from dataclasses import dataclass, field
from time import monotonic

from app.services.visual_paper import TAG_LINE_RE, parse_custom_visual_paper
from app.services.llm_router import is_retryable
from app.services.async_cleanup import await_cleanup

logger = logging.getLogger(__name__)

PARALLELISM = 3
MAX_ATTEMPTS = 3
ANALYSIS_TAGS = {
    "QTYPE", "ANSWER", "EVIDENCE", "REASON", "DISTRACTOR", "PITFALLS",
    "PATTERN_NAME", "PATTERN_STEPS", "TRANSFER_PASSAGE", "TRANSFER_STEM",
    "TRANSFER_OPTIONS", "TRANSFER_ANSWER", "TRANSFER_EXPL", "WRITING_POINTS",
    "WRITING_OUTLINE", "WRITING_SAMPLE",
    # 阶段二允许为分组补写一句话导语；白名单漏了它，模型一输出就被静默丢弃，
    # 而单流解析器是保留的——两条路径对同一输入给出不同结果
    "GROUP_INTRO",
}
# 骨架自带的结构性标签。工单里不该出现它们；万一出现（模型把原题结构搬过来），
# 要拦住它自己的正文，但不能把后面本该保留的分析字段一起断掉。
STRUCTURE_TAGS = {"STEM", "OPTIONS", "PASSAGE_REF", "PASSAGE_DEF", "PASSAGE", "GROUP", "GROUP_INTRO", "TOTAL", "PAPER", "NOTICE", "KEY"}


def question_missing(q: dict, transfer_count: int, group_id: str = "") -> list[str]:
    """返回可解释的缺失项；与前端共用口径，不把答案存在当作全解完成。"""
    def text(v):
        return isinstance(v, str) and bool(v.strip())

    def texts(v):
        return isinstance(v, list) and bool(v) and all(text(x) for x in v)

    if q.get("qtype") == "writing":
        guide = q.get("writingGuide") or {}
        return [label for key, label in (("points", "写作要点"), ("outline", "写作框架"), ("sample", "范文"))
                if not (texts(guide.get(key)) if key == "points" else text(guide.get(key)))]
    ref, pattern = q.get("reference") or {}, q.get("pattern") or {}
    pits, transfers = q.get("pitfalls") or [], q.get("transfers") or []
    missing = []
    if not text(q.get("answer")): missing.append("参考答案")
    for key, label in (("evidence", "原文依据"), ("reason", "解题推理"), ("distractor", "干扰项分析")):
        if not text(ref.get(key)): missing.append(label)
    if not pits or not all(text(p.get("title")) and text(p.get("desc")) for p in pits): missing.append("易错点")
    if not text(pattern.get("name")) or not texts(pattern.get("steps")): missing.append("考点范式")
    choice = q.get("qtype") == "choice" or bool(q.get("options"))
    embedded = group_id in {"cloze7", "cloze", "grammar"}
    if len(transfers) < transfer_count: missing.append(f"迁移题数量（{len(transfers)}/{transfer_count}）")
    for index, t in enumerate(transfers, 1):
        prefix = f"迁移 {index}："
        # 是否有选项与是否有独立设问是两回事；按原题所属组判定，不能靠模型省略题干来豁免。
        if not text(t.get("stem")) and not embedded and (choice or not text(t.get("passage"))): missing.append(prefix + "题干")
        if (choice or (embedded and not text(t.get("stem")))) and not text(t.get("passage")): missing.append(prefix + "语篇")
        for key, label in (("answer", "答案"), ("explanation", "解析")):
            if not text(t.get(key)): missing.append(prefix + label)
        if choice:
            options = t.get("options") or []
            expected = len(q.get("options") or []) or 2
            if len(options) < expected or not all(text(o.get("label")) and text(o.get("text")) for o in options):
                missing.append(prefix + f"选项不足（{len(options)}/{expected}）")
    return missing


def question_complete(q: dict, transfer_count: int, group_id: str = "") -> bool:
    return not question_missing(q, transfer_count, group_id)


def _guard(value: str) -> str:
    # 逐个 @ 后都插零宽空格：只在串首插一个时，长度 >=3 的串仍残留 2 个连续 @，
    # 会被 TAG_FIND_RE 当成标签，导致语篇正文被截断。
    return re.sub(r"[＠@]", lambda m: m[0] + "\u200b", str(value or ""))


def group_material(paper: dict, group: dict) -> str:
    """保留同组所有题以支持完形/七选五联动；别组正文不占上下文。答案区原样保留。"""
    lines = [f"@@PAPER@@ {_guard(paper.get('paper', {}).get('title', ''))}",
             f"@@GROUP@@ {group['id']}|{_guard(group['title'])}|"]
    passages = {}
    for q in group["questions"]:
        passage = q.get("passage") or ""
        if passage and passage not in passages:
            ref = f"P{len(passages) + 1}"
            passages[passage] = ref
            lines.extend([f"@@PASSAGE_DEF@@ {ref}", _guard(passage)])
        lines.extend([f"@@Q@@ {q['no']}", f"@@QTYPE@@ {q['qtype']}",
                      f"@@PASSAGE_REF@@ {passages.get(passage, '-')}",
                      "@@STEM@@", _guard(q.get("stem", "")), "@@OPTIONS@@"])
        lines.extend(f"{o['label']}. {_guard(o['text'])}" for o in q.get("options", []))
        lines.append("@@END_Q@@")
    if paper.get("paperKey"):
        lines.extend(["@@KEY@@", _guard(paper["paperKey"])])
    return "\n".join(lines) + "\n"


@dataclass
class ExplainJob:
    id: str
    nos: list[str]
    material: str
    prompt: str
    state: str = "pending"
    completed: list[str] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    raw: list[str] = field(default_factory=list)
    error: str = ""
    started: float = 0
    elapsed: float = 0
    llm: object = None
    attempts: list = field(default_factory=list)
    issues: dict = field(default_factory=dict)
    active_nos: list = field(default_factory=list)
    attempt: int = 0
    fallback: dict | None = None
    retry_reason: str = ""
    question_states: dict = field(default_factory=dict)
    max_attempts: int = MAX_ATTEMPTS

    def progress(self) -> dict:
        return {"id": self.id, "nos": self.nos, "state": self.state, "completed": self.completed.copy(),
                "active_nos": self.active_nos.copy(), "attempt": self.attempt, "max_attempts": self.max_attempts,
                "issues": {no: items.copy() for no, items in self.issues.items()}, "fallback": self.fallback,
                "question_states": {no: {**info, "fallback": info["fallback"].copy() if info.get("fallback") else None}
                                    for no, info in self.question_states.items()},
                "retry_reason": self.retry_reason if self.state in {"running", "retrying"} else ""}


def explanation_concurrency(jobs, configured: int) -> int:
    """请求槽位按题数封顶；初始 Job 数不能限制后续拆单的并发。"""
    total = sum(len(job.nos) for job in jobs)
    return min(configured, total) if configured > 0 else total


async def _cancel_and_wait(tasks) -> bool:
    """隔离回收协程，重复取消调用者不能再取消正在关闭连接的子任务。

    返回回收期间是否收到新的取消；调用者先完成状态/用量结算，再传播取消。
    """
    async def cleanup():
        for task in tasks:
            if not task.done() and not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    _, cancelled = await await_cleanup(asyncio.create_task(cleanup()))
    return cancelled


def _norm_no(s: str) -> str:
    """题号归一化：只比数字、去掉前导零。模型写 "01"/" 1" 与 "1" 是同一题，
    不归一化会被判越界丢弃、白烧三轮重试；前端发 "1" 而骨架是 "01" 时也会 400。"""
    d = re.sub(r"\D", "", str(s)).lstrip("0")
    return d or "0"


WORK_ORDER_MARK = "【续写指令】"


def split_work_order(raw: str) -> tuple[str, bool]:
    """把「材料正文」与「续写工单」分开。返回 (正文, 是否带工单)。

    路由用行首匹配判定「这是旧历史+续写工单」，规划用双换行切分正文。两端口径
    不一致时，单换行拼接的骨架会被路由认作续写、而规划切不开——工单整段进解析
    材料，截断半题时污染末字段。这里统一成一处，两端都调它。
    """
    if WORK_ORDER_MARK not in raw:
        return raw, False
    # 工单标记可能被一个或多个换行引导；按它第一次出现的位置切开
    idx = raw.find(WORK_ORDER_MARK)
    body = raw[:idx].rstrip("\n")
    return body, True


def plan_explanations(raw: str, loader, transfer_count: int, selected: list[str] | None = None) -> list[ExplainJob]:
    # 老客户端的自然语言工单仍交给原来的单流处理，不能把其剩余题清单猜成全卷。
    body, has_order = split_work_order(raw)
    if selected is None and has_order:
        return []
    raw = body
    paper = parse_custom_visual_paper(raw)
    if not paper:
        return []
    questions = [q for g in paper["groups"] for q in g["questions"]]
    nos = [q["no"] for q in questions]
    # 按题过滤，不再「一题坏整卷返回 []」：题号非数字或语篇引用未解析的题退出并行
    # （交给单流/续写处理），健康题照常并行。旧逻辑一题中招就整卷静默降级单流。
    usable = [q for q in questions
              if re.fullmatch(r"\d{1,3}", q["no"]) and not q.get("passageUnresolved")]
    if not usable:
        return []
    usable_nos = [q["no"] for q in usable]
    if len(set(usable_nos)) != len(usable_nos):
        return []
    if selected is not None:
        norm_selected = [_norm_no(s) for s in selected]
        norm_usable = {_norm_no(n) for n in usable_nos}
        if len(set(norm_selected)) != len(norm_selected) or not set(norm_selected) <= norm_usable:
            raise ValueError("待补全题号为空、重复或不属于当前试卷")
    # 归一化后的集合用于挑题；写回工单的题号保留骨架原样（显示与序列化都不变）
    wanted = {_norm_no(s) for s in selected} if selected else {_norm_no(n) for n in usable_nos}
    jobs = []
    # 迁移题量越大，单次处理原题越少，降低单任务撞输出上限的概率。
    # tc>=3 时退化为单题一片；tc 为 0 时按 1 计，避免 3//0 在 max() 求值前抛错。
    size = max(1, 3 // (transfer_count or 1))
    for group in paper["groups"]:
        # 全链路统一用归一化题号：挑题、工单、QuestionBlocks.allowed、publish 查找
        # 都基于它，"01" 与 "1" 才是同一题。序列化回骨架时按原样题号匹配（见下方映射）
        targets = [_norm_no(q["no"]) for q in group["questions"] if _norm_no(q["no"]) in wanted]
        if not targets:
            continue
        material = group_material(paper, group)
        for offset in range(0, len(targets), size):
            subset = targets[offset:offset + size]
            prompt = loader.render("试卷可视化全解精讲", material, {"transfer_count": transfer_count})
            if prompt is None:
                return []
            prompt += (
                "\n\n【并行任务】\n"
                f"本次只为这些题号生成完整讲解：{','.join(subset)}。其他题只作同篇上下文，不输出。\n"
                "按并行工单契约输出 @@Q@@ 到 @@END_Q@@ 的完整讲解块。\n"
            )
            jobs.append(ExplainJob(str(len(jobs) + 1), subset, material, prompt))
    return jobs


class QuestionBlocks:
    """每个流自持缓冲；白名单过滤结构改写/越界题号，半题永不进入共享文档。"""

    def __init__(self, nos: list[str]):
        # allowed 用归一化题号：模型写 "01"/" 1" 与 "1" 是同一题，
        # 不归一化会被判越界整块丢弃、白烧三轮重试
        self.allowed = {_norm_no(n) for n in nos}
        self.seen: set[str] = set()
        self.buffer = ""
        self.no = ""
        self.lines: list[str] = []
        self.keep = False
        self.pending_no = False

    def feed(self, chunk: str, final: bool = False) -> list[tuple[str, str]]:
        self.buffer += chunk
        lines = self.buffer.split("\n")
        self.buffer = "" if final else lines.pop()
        out = []
        for line in lines:
            m = TAG_LINE_RE.match(line.strip())
            if m:
                tag, value = m[1].upper(), m[3].strip()
                if tag == "Q":
                    # 题号归一化后再比 allowed：模型写 "01"/" 1" 与 "1" 是同一题，
                    # 不归一化会被判越界、整块丢弃、白烧三轮重试
                    norm = _norm_no(value) if value else ""
                    self.no = norm if norm in self.allowed else ""
                    self.lines = [f"@@Q@@ {self.no}"] if self.no else []
                    self.keep = False
                    self.pending_no = not value
                elif tag == "END_Q":
                    if self.no and self.no not in self.seen and len(self.lines) > 1:
                        self.seen.add(self.no)
                        out.append((self.no, "\n".join(self.lines) + "\n@@END_Q@@\n"))
                    elif self.lines and not self.no:
                        # 收尾时仍没有有效题号：这块无法归属，只能丢。留一条日志，
                        # 否则重试轮次白烧三轮也看不出是题号没写上。
                        logger.warning("QuestionBlocks 丢弃无题号题块（%d 行）", len(self.lines))
                    self.no, self.lines, self.keep, self.pending_no = "", [], False, False
                else:
                    # 标签行本身不是题号：题号只可能紧跟在 @@Q@@ 之后的正文行。
                    # 不清这个标志的话，@@Q@@ 后紧跟 @@QTYPE@@ 时后续内容会因 keep=False
                    # 被整段丢弃，整题静默蒸发。
                    self.pending_no = False
                    if tag in ANALYSIS_TAGS:
                        # 题号还没补上（裸 @@Q@@）也先收着：等下一行补号后再决定上报，
                        # 否则紧跟标签的写法会让整题蒸发。END_Q 时 no 仍为空才丢弃。
                        self.keep = True
                    elif tag in STRUCTURE_TAGS:
                        # 结构性标签：断当前字段收集，但不牵连后面的分析字段
                        self.keep = False
                    else:
                        self.keep = False
                    if self.keep:
                        self.lines.append(f"@@{tag}@@" + (f" {_guard(value)}" if value else ""))
            elif self.pending_no:
                value = line.strip()
                if value:
                    norm = _norm_no(value)
                    self.no = norm if norm in self.allowed else ""
                    # 题号有效：保留裸 @@Q@@ 之后暂存下来的分析字段，只把题号行补上；
                    # 题号越界时整块作废（与旧行为一致）
                    self.lines = [f"@@Q@@ {self.no}"] + self.lines if self.no else []
                    self.pending_no = False
            elif self.keep:
                # 防止被正文中的行内标签重新打开其他题；正常标签均在行首。
                self.lines.append(_guard(line))
        return out


def _attempt_prompt(job, nos, questions, issues=None):
    issues = job.issues if issues is None else issues
    base = job.prompt.split("\n\n【并行任务】", 1)[0]
    lines = ["\n\n【并行任务】", f"本次只为这些题号生成完整讲解：{','.join(nos)}。其他题只作同篇上下文，不输出。"]
    for no in nos:
        count = len(questions[no].get("options") or [])
        if count:
            lines.append(f"第 {no} 题的原题选项池共 {count} 项；每道迁移必须保留同型的 {count} 项完整选项池，不能缩成四选一。")
        if issues.get(no):
            lines.append(f"第 {no} 题上次未通过：{'、'.join(issues[no])}。重新输出该题完整讲解，特别核对这些缺失项。")
    lines.append("每题的最后一行必须为 @@END_Q@@，包括本次输出的最后一道题。不要省略结束标记。")
    return base + "\n".join(lines)


async def stream_explanations(jobs, *, build_llm, stop_event, transfer_count, stream_kwargs,
                              concurrency=PARALLELISM, max_attempts=MAX_ATTEMPTS, retry_delay=0.5):
    """请求级限流；首轮合批，缺失题独立重试。共享 Job 仅由事件消费端更新。"""
    if not jobs:
        return
    limit = max(1, explanation_concurrency(jobs, concurrency))
    slots = asyncio.Semaphore(limit)
    queue = asyncio.Queue(maxsize=limit * 4)
    calls = []
    collected = set()
    ended = set()

    for job in jobs:
        job.max_attempts = max_attempts
        job.question_states = {
            no: {"state": "done" if no in job.completed else "pending", "attempt": 0,
                 "fallback": None, "retry_reason": ""}
            for no in job.nos
        }

    async def emit(kind, job, payload=None):
        await queue.put((kind, job, payload))

    def register_call(job, call):
        if not any(existing is call for existing in job.attempts):
            job.attempts.append(call)

    def collect_call(job, call):
        register_call(job, call)
        if id(call) in collected:
            return
        collected.add(id(call))
        job.raw.extend(call["raw"])
        for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cached_tokens"):
            if call["usage"].get(key) is not None:
                job.usage[key] = job.usage.get(key, 0) + call["usage"][key]
        if call["usage"].get("estimated"):
            job.usage["estimated"] = True
        for no in call["nos"]:
            if no not in job.completed:
                job.issues[no] = call["issues"].get(no, ["未返回完整讲解"]).copy()

    def refresh(job):
        states = job.question_states
        job.attempt = max((info["attempt"] for info in states.values()), default=0)
        job.active_nos = [no for no, info in states.items() if info["state"] == "running"]
        job.fallback = next((info["fallback"] for info in states.values()
                             if info["state"] == "running" and info["fallback"]), None)
        job.retry_reason = "正在补全未完成的讲解" if any(
            info["retry_reason"] for info in states.values()) else ""
        if id(job) not in ended:
            if job.active_nos:
                job.state = "running"
            elif any(info["state"] == "retrying" or (
                info["state"] == "pending" and info["attempt"] > 1) for info in states.values()):
                job.state = "retrying"
            else:
                # 题块验收后上游可能尚未关闭；终态由协调协程的结束事件确认。
                job.state = "running" if all(no in job.completed for no in job.nos) else "pending"
        if job.state in {"done", "error", "incomplete", "cancelled"}:
            job.active_nos, job.fallback, job.retry_reason = [], None, ""

    def reduce_event(item):
        kind, job, payload = item
        output = []
        if kind == "job_start":
            job.started = payload
        elif kind in {"waiting", "retry_wait", "call_start"}:
            if kind == "call_start":
                register_call(job, payload)
            state = {"waiting": "pending", "retry_wait": "retrying", "call_start": "running"}[kind]
            for no in payload["nos"]:
                if no not in job.completed:
                    job.question_states[no].update(
                        state=state, attempt=payload["round"], fallback=None,
                        retry_reason="正在补全未完成的讲解" if payload["round"] > 1 else "")
        elif kind == "fallback":
            nos, fallback = payload
            for no in nos:
                if no not in job.completed:
                    job.question_states[no]["fallback"] = fallback
        elif kind == "block":
            no, block, issues = payload
            if no in job.completed:
                return []
            job.issues[no] = issues
            if not issues:
                job.completed.append(no)
                job.question_states[no].update(state="done", fallback=None, retry_reason="")
                output.append(("token", block))
        elif kind == "call_finish":
            collect_call(job, payload)
            for no in payload["nos"]:
                if no not in job.completed:
                    state = "retrying" if payload["round"] < max_attempts else payload["state"]
                    job.question_states[no].update(
                        state=state, fallback=None,
                        retry_reason="正在补全未完成的讲解" if state == "retrying" else "")
        elif kind == "job_error":
            collect_call(job, payload)
            job.state, job.error = "error", payload["error"]
            for no in job.nos:
                if no not in job.completed:
                    job.question_states[no].update(state="error", fallback=None, retry_reason="")
            ended.add(id(job))
            job.elapsed = monotonic() - job.started
        elif kind == "job_finish":
            ended.add(id(job))
            failed = [no for no in job.nos if no not in job.completed]
            # 结束事件在生产端确认；不能因消费它时别的 Job 被停止而改写终态。
            job.state = "done" if not failed else (
                "error" if any(job.question_states[no]["state"] == "error" for no in failed) else "incomplete")
            job.error = "" if not failed else next(
                (call["error"] for call in reversed(job.attempts)
                 if call["error"] and any(no in failed for no in call["nos"])), "讲解未完整")
            job.elapsed = monotonic() - job.started
        refresh(job)
        output.append(("visual_task", job.progress()))
        return output

    async def run_request(job, nos, round_no, questions, question_groups, previous=None):
        previous = previous or {}
        await emit("waiting", job, {"nos": nos, "round": round_no})
        # 排队和退避不占槽位；槽位覆盖建连、读流和关闭上游的整个生命周期。
        async with slots:
            if stop_event.is_set():
                return None
            call = {"nos": nos.copy(), "round": round_no,
                    "prompt": _attempt_prompt(job, nos, questions, previous.get("issues", {})),
                    "raw": [], "usage": {}, "llm": None, "elapsed": 0, "error": "", "state": "running",
                    "completed": [], "issues": {no: items.copy() for no, items in previous.get("issues", {}).items()
                                              if no in nos}, "provider_id": None}
            calls.append((job, call))
            call_started = monotonic()
            blocks = QuestionBlocks(nos)
            fallback = None

            async def publish(items):
                for no, block in items:
                    if no in call["completed"]:
                        continue
                    expected = questions[no]
                    qtype = "writing" if expected["qtype"] == "writing" else "choice" if expected.get("options") else "blank"
                    block = re.sub(r"^@@QTYPE@@[^\n]*\n", "", block, flags=re.MULTILINE)
                    block = re.sub(r"^@@Q@@[^\n]*\n", f"@@Q@@ {no}\n@@QTYPE@@ {qtype}\n",
                                   block, count=1, flags=re.MULTILINE)
                    parsed = parse_custom_visual_paper(job.material + block)
                    question = next(q for g in parsed["groups"] for q in g["questions"] if _norm_no(q["no"]) == no)
                    issues = question_missing(question, transfer_count, question_groups[no])
                    # 每次请求独立验收，残缺版本永不进入共享文档。
                    call["issues"][no] = issues
                    await emit("block", job, (no, block, issues))
                    if not issues:
                        call["completed"].append(no)

            try:
                await emit("call_start", job, call)
                if stop_event.is_set():
                    call["state"] = "cancelled"
                else:
                    llm = call["llm"] = build_llm()
                    providers = getattr(llm, "providers", None)
                    previous_provider = previous.get("provider_id")
                    providers_override = None
                    if previous_provider and providers and len(providers) > 1:
                        providers_override = sorted(providers, key=lambda p: p.get("id") == previous_provider)
                    call["providers"] = [p.get("id") for p in (providers_override or providers or [])]
                    async with aclosing(llm.chat_stream_with_stop(
                        user_prompt=call["prompt"], stop_event=stop_event, usage_out=call["usage"],
                        providers_override=providers_override, **stream_kwargs,
                    )) as upstream:
                        async for item in upstream:
                            if stop_event.is_set():
                                break
                            if isinstance(item, tuple):
                                if item[0] == "fallback":
                                    fallback = item[1]
                                    await emit("fallback", job, (nos, fallback))
                                continue
                            if fallback:
                                fallback = None
                                await emit("fallback", job, (nos, None))
                            call["raw"].append(item)
                            await publish(blocks.feed(item))
                        if not stop_event.is_set():
                            await publish(blocks.feed("", final=True))
                            if blocks.no and blocks.no not in blocks.seen and call["usage"].get("finish_reason") not in {"length", "content_filter"}:
                                await publish([(blocks.no, "\n".join(blocks.lines) + "\n@@END_Q@@\n")])
                    call["state"] = "cancelled" if stop_event.is_set() else (
                        "done" if all(no in call["completed"] for no in nos) else "incomplete")
                    if call["state"] == "incomplete":
                        call["error"] = "讲解未完整，已记录具体缺失项"
            except asyncio.CancelledError:
                if stop_event.is_set() or asyncio.current_task().cancelling():
                    call["state"] = "cancelled"
                    raise
                # 上游自行抛出的取消与真正的任务取消分开处理。
                call["state"], call["error"] = "error", "上游讲解请求异常取消"
            except Exception as exc:
                call["state"], call["error"] = "error", str(exc)
                if not is_retryable(exc):
                    logger.info("可视化精讲：不可重试错误转为按题重试，不整批屏蔽：%s", exc)
            finally:
                call["elapsed"] = monotonic() - call_started
                used = getattr(call["llm"], "provider_used", None) or getattr(call["llm"], "last_provider", None)
                call["provider_id"] = used.get("id") if used else previous.get("provider_id")
                call["issues"] = {
                    no: call["issues"].get(no) or ["未返回完整讲解"]
                    for no in nos if no not in call["completed"]
                }
        # 关闭连接后立即释放请求槽位，日志/进度队列的背压不阻塞其他请求。
        # 真正取消时不在 finally 中等待有界队列，由消费端统一补收调用记录。
        await emit("call_finish", job, call)
        return call

    async def retry_question(job, no, first, questions, question_groups):
        previous = first
        for round_no in range(2, max_attempts + 1):
            if stop_event.is_set():
                return
            await emit("retry_wait", job, {"nos": [no], "round": round_no})
            await asyncio.sleep(retry_delay * (2 ** (round_no - 2)))
            result = await run_request(job, [no], round_no, questions, question_groups, previous)
            if result is None or no in result["completed"]:
                return
            previous = result

    async def coordinate(job):
        children = []
        try:
            await emit("job_start", job, monotonic())
            original = parse_custom_visual_paper(job.material)
            if original is None:
                raise ValueError("组材料解析失败")
            questions = {_norm_no(q["no"]): q for g in original["groups"] for q in g["questions"]}
            question_groups = {_norm_no(q["no"]): g["id"] for g in original["groups"] for q in g["questions"]}
            nos = [no for no in job.nos if no not in job.completed]
            if nos and max_attempts > 0:
                first = await run_request(job, nos, 1, questions, question_groups)
                if first is None or stop_event.is_set():
                    return
                # 各题独立推进；gather 只等待 Job 收尾，不形成重试轮次屏障。
                children = [asyncio.create_task(retry_question(job, no, first, questions, question_groups))
                            for no in nos if no not in first["completed"]]
                await asyncio.gather(*children)
            if stop_event.is_set():
                return
            await emit("job_finish", job)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("可视化精讲：任务协调失败")
            call = {"nos": list(job.nos), "round": 0, "state": "error", "error": str(exc),
                    "prompt": "", "raw": [], "usage": {}, "llm": None, "elapsed": 0,
                    "issues": {no: ["组材料解析或任务调度失败"] for no in job.nos}}
            calls.append((job, call))
            await emit("job_error", job, call)
        finally:
            # gather 的子任务异常/取消不会自动回收所有兄弟任务，显式关闭。
            for child in children:
                if not child.done() and not child.cancelling():
                    child.cancel()
            await asyncio.gather(*children, return_exceptions=True)

    workers = [asyncio.create_task(coordinate(job)) for job in jobs]
    stop_wait = asyncio.create_task(stop_event.wait())
    next_item = None
    try:
        remaining = set(workers)
        while remaining or not queue.empty():
            next_item = asyncio.create_task(queue.get())
            await asyncio.wait([next_item, stop_wait, *remaining], return_when=asyncio.FIRST_COMPLETED)
            finished = {task for task in remaining if task.done()}
            failure = cause = None
            if not stop_event.is_set():
                for task in finished:
                    if task.cancelled():
                        failure = RuntimeError("并发讲解任务异常取消")
                        break
                    if task.exception() is not None:
                        failure, cause = RuntimeError("并发讲解任务异常结束"), task.exception()
                        break
            if stop_event.is_set() or failure is not None:
                if await _cancel_and_wait(workers):
                    raise asyncio.CancelledError
                # 停止与异常退出都保留已入队的完整题块；回收后不再有新事件。
                if next_item.done():
                    for output in reduce_event(next_item.result()):
                        yield output
                    next_item = None
                while not queue.empty():
                    for output in reduce_event(queue.get_nowait()):
                        yield output
                if failure is not None and not stop_event.is_set():
                    raise failure from cause
                break
            remaining -= finished
            if next_item.done():
                for output in reduce_event(next_item.result()):
                    yield output
                next_item = None
            else:
                next_item.cancel()
                await asyncio.gather(next_item, return_exceptions=True)
                next_item = None
    finally:
        tasks = workers + [stop_wait] + ([next_item] if next_item else [])
        cancelled = await _cancel_and_wait(tasks)
        # 取消可能中断 call_finish 入队；每次请求的用量和日志仍只汇总一次。
        for job, call in calls:
            collect_call(job, call)
        for job in jobs:
            if id(job) not in ended:
                job.state = "cancelled"
                ended.add(id(job))
                job.elapsed = monotonic() - job.started if job.started else 0
                for no, info in job.question_states.items():
                    if no not in job.completed:
                        info["state"] = "cancelled"
            for info in job.question_states.values():
                info["fallback"], info["retry_reason"] = None, ""
            refresh(job)
        if cancelled:
            raise asyncio.CancelledError
