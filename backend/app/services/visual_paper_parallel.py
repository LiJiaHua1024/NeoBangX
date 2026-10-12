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

    def progress(self) -> dict:
        return {"id": self.id, "nos": self.nos, "state": self.state, "completed": self.completed.copy(),
                "active_nos": self.active_nos.copy(), "attempt": self.attempt, "max_attempts": MAX_ATTEMPTS,
                "issues": self.issues.copy(), "fallback": self.fallback, "retry_reason": self.retry_reason}


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


def _attempt_prompt(job, nos, questions):
    base = job.prompt.split("\n\n【并行任务】", 1)[0]
    lines = ["\n\n【并行任务】", f"本次只为这些题号生成完整讲解：{','.join(nos)}。其他题只作同篇上下文，不输出。"]
    for no in nos:
        count = len(questions[no].get("options") or [])
        if count:
            lines.append(f"第 {no} 题的原题选项池共 {count} 项；每道迁移必须保留同型的 {count} 项完整选项池，不能缩成四选一。")
        if job.issues.get(no):
            lines.append(f"第 {no} 题上次未通过：{'、'.join(job.issues[no])}。重新输出该题完整讲解，特别核对这些缺失项。")
    lines.append("每题的最后一行必须为 @@END_Q@@，包括本次输出的最后一道题。不要省略结束标记。")
    return base + "\n".join(lines)


async def stream_explanations(jobs, *, build_llm, stop_event, transfer_count, stream_kwargs,
                              concurrency=PARALLELISM, max_attempts=MAX_ATTEMPTS, retry_delay=0.5):
    """有界并发；只重试缺失题，最多三轮。停止/断连回收请求和重试等待。"""
    concurrency = max(1, min(16, concurrency))
    queue = asyncio.Queue(maxsize=concurrency * 4)
    pending = iter(jobs)

    async def worker():
        for job in pending:
            if stop_event.is_set():
                return
            job.started = monotonic()
            # material 解析放在 try 内：它一旦返回 None，下一行 original["groups"] 会抛
            # TypeError 跳出 for 循环，worker_done 再也不发，主生成器在 queue.get() 上
            # 永久挂起，而该 job 停在 pending、管理台和前端都看不到失败提示。
            # 当前 group_material 的契约保证不会发生，但这是唯一一个「一触发就挂死」
            # 的点，加防护比依赖契约稳。
            try:
                original = parse_custom_visual_paper(job.material)
                if original is None:
                    raise ValueError("组材料解析失败")
                # key 用归一化题号：与 QuestionBlocks.allowed / blocks.feed 返回的
                # no 同口径，否则 "01" 与 "1" 会在 publish 的查找上对不上
                questions = {_norm_no(q["no"]): q for g in original["groups"] for q in g["questions"]}
                question_groups = {_norm_no(q["no"]): g["id"] for g in original["groups"] for q in g["questions"]}
            except Exception as exc:
                logger.exception("可视化精讲：组材料解析失败，job 标记为 error")
                job.state, job.error = "error", f"组材料解析失败：{exc}"
                job.attempts.append({"nos": list(job.nos), "round": 0, "state": "error",
                                     "error": str(exc), "prompt": "", "raw": [], "usage": {},
                                     "llm": None, "elapsed": 0})
                continue
            blocked = set()
            previous_provider = None
            try:
                for round_no in range(1, max_attempts + 1):
                    missing = [n for n in job.nos if n not in job.completed and n not in blocked]
                    if not missing or stop_event.is_set():
                        break
                    job.attempt = round_no
                    if round_no > 1:
                        job.state, job.active_nos, job.fallback = "retrying", missing, None
                        job.retry_reason = "正在补全未完成的讲解"
                        await queue.put(("visual_task", job.progress()))
                        await asyncio.sleep(retry_delay * (2 ** (round_no - 2)))
                    # 首轮按计划分片，后续拆为单题，避免某一长题再次拖累同批其他题。
                    batches = [missing] if round_no == 1 else [[no] for no in missing]
                    for nos in batches:
                        if stop_event.is_set():
                            break
                        job.state, job.active_nos, job.fallback = "running", nos, None
                        await queue.put(("visual_task", job.progress()))
                        blocks = QuestionBlocks(nos)
                        call = {"nos": nos, "round": round_no, "prompt": _attempt_prompt(job, nos, questions),
                                "raw": [], "usage": {}, "llm": None, "elapsed": 0, "error": "", "state": "running"}
                        job.attempts.append(call)
                        call_started = monotonic()
                        # queue.put 是让出点：停止可能恰好落在这里。此时 job.state 已是
                        # running，直接 break 会把它留给 finally 兜底成 cancelled；同时要把
                        # 本次调用记成 cancelled，否则分片日志会记成未发生的 ERROR。
                        if stop_event.is_set():
                            call["state"] = "cancelled"
                            break

                        async def publish(items, *, terminal=False):
                            for no, block in items:
                                if no in job.completed:
                                    continue
                                expected = questions[no]
                                qtype = "writing" if expected['qtype'] == "writing" else "choice" if expected.get("options") else "blank"
                                block = re.sub(r"^@@QTYPE@@[^\n]*\n", "", block, flags=re.MULTILINE)
                                # 题号行用正则替换：block 里是模型写的原样题号（可能带
                                # 前导零/空格），与归一化后的 no 不一定字面相同
                                block = re.sub(r"^@@Q@@[^\n]*\n", f"@@Q@@ {no}\n@@QTYPE@@ {qtype}\n", block, count=1, flags=re.MULTILINE)
                                parsed = parse_custom_visual_paper(job.material + block)
                                question = next(q for g in parsed["groups"] for q in g["questions"] if _norm_no(q["no"]) == no)
                                issues = question_missing(question, transfer_count, question_groups[no])
                                # 每次调用独立验收。残缺重试块不能进入共享文档，
                                # 否则前端会把不同版本的材料、答案和解析拼成伪完整题。
                                job.issues[no] = issues
                                if issues:
                                    await queue.put(("visual_task", job.progress()))
                                    continue
                                job.completed.append(no)
                                await queue.put(("token", block))
                                await queue.put(("visual_task", job.progress()))

                        try:
                            job.llm = call["llm"] = build_llm()
                            providers = getattr(job.llm, "providers", None)
                            # 出正文后不能拼接另一通道；新请求只为缺失题换通道重做。
                            # 排序结果只作本次调用的局部参数传下去：就地改 llm.providers
                            # 会写到一个共享列表（chat.py 让首个 worker 复用主 llm 对象），
                            # 多个 worker 并发排序时互相干扰，分片日志的 provider 归属
                            # 也会记成最后写入者。
                            providers_override = None
                            if previous_provider and providers and len(providers) > 1:
                                providers_override = sorted(providers, key=lambda p: p.get("id") == previous_provider)
                            # 记下本次实际使用的通道顺序：既供分片日志归属，也让
                            # 「避开上一家」的策略可被验证
                            call["providers"] = [p.get("id") for p in (providers_override or providers or [])]
                            async with aclosing(job.llm.chat_stream_with_stop(
                                user_prompt=call["prompt"], stop_event=stop_event, usage_out=call["usage"],
                                providers_override=providers_override, **stream_kwargs,
                            )) as upstream:
                                async for item in upstream:
                                    if stop_event.is_set():
                                        break
                                    if isinstance(item, tuple):
                                        if item[0] == "fallback":
                                            job.fallback = item[1]
                                            await queue.put(("visual_task", job.progress()))
                                        continue
                                    if job.fallback:
                                        job.fallback = None
                                        await queue.put(("visual_task", job.progress()))
                                    call["raw"].append(item)
                                    job.raw.append(item)
                                    await publish(blocks.feed(item))
                                if not stop_event.is_set():
                                    await publish(blocks.feed("", final=True))
                                    if blocks.no and blocks.no not in blocks.seen and call["usage"].get("finish_reason") not in {"length", "content_filter"}:
                                        await publish([(blocks.no, "\n".join(blocks.lines) + "\n@@END_Q@@\n")], terminal=True)
                            call["state"] = "cancelled" if stop_event.is_set() else "done" if all(n in job.completed for n in nos) else "incomplete"
                            if call["state"] == "incomplete":
                                call["error"] = "讲解未完整，已记录具体缺失项"
                        except asyncio.CancelledError:
                            if stop_event.is_set() or asyncio.current_task().cancelling():
                                call["state"] = "cancelled"
                                raise
                            # 上游可独立抛出 CancelledError，但未取消当前 worker。
                            # 将它作为单次调用失败重试，避免拖垮其他分片。
                            call["state"], call["error"] = "error", "上游讲解请求异常取消"
                        except Exception as exc:
                            call["state"], call["error"] = "error", str(exc)
                            # 不再把整批题号一网打尽地屏蔽：异常不带题号信息，
                            # 同批里没出错的题本该还有机会。交给完整三轮重试，
                            # 由 job.completed 自然收敛（撞 content_filter 时多等两轮，
                            # 但不会让健康题被无辜放弃）。
                            if not is_retryable(exc):
                                logger.info("可视化精讲：不可重试错误转为按题重试，不整批屏蔽：%s", exc)
                        finally:
                            call["elapsed"] = monotonic() - call_started
                            # 只用「实际成功」的那家：last_provider 每轮都赋值（含失败的
                            # 那家），拿它排序会把刚失败的通道提到最前，等于原地重试，
                            # 与「换通道重做」的意图相反。本轮没有成功产出时保持上一轮
                            # 的 previous_provider 不变（首次全失败则仍为 None，不排序）。
                            used = getattr(job.llm, "provider_used", None)
                            if used and used.get("id"):
                                previous_provider = used.get("id")
                            for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cached_tokens"):
                                if call["usage"].get(key) is not None:
                                    job.usage[key] = job.usage.get(key, 0) + call["usage"][key]
                            if call["usage"].get("estimated"):
                                job.usage["estimated"] = True
                            for no in nos:
                                if no not in job.completed and not job.issues.get(no):
                                    job.issues[no] = ["未返回完整讲解"]
                            call["issues"] = {n: job.issues.get(n, []).copy() for n in nos if n not in job.completed}
                            job.error = call["error"]
                    if all(n in job.completed for n in job.nos):
                        break
                job.state = "cancelled" if stop_event.is_set() else "done" if len(job.completed) == len(job.nos) else (
                    "error" if job.attempts and job.attempts[-1]["state"] == "error" else "incomplete")
                if job.state == "done":
                    job.error = ""
            except asyncio.CancelledError:
                job.state = "cancelled"
                raise
            except Exception as exc:
                job.state, job.error = "error", str(exc)
            finally:
                job.elapsed = monotonic() - job.started
                job.active_nos, job.fallback = [], None
            await queue.put(("visual_task", job.progress()))

    workers = [asyncio.create_task(worker()) for _ in range(min(concurrency, len(jobs)))]
    stop_wait = asyncio.create_task(stop_event.wait())
    next_item = None
    try:
        remaining = set(workers)
        while (remaining or not queue.empty()) and not stop_event.is_set():
            next_item = asyncio.create_task(queue.get())
            await asyncio.wait([next_item, stop_wait, *remaining], return_when=asyncio.FIRST_COMPLETED)
            if stop_event.is_set():
                break
            finished = {task for task in remaining if task.done()}
            for task in finished:
                # 监听任务本身的结束，不能依赖 worker 在正常路径发送结束哨兵。
                # 非用户停止的取消/崩溃必须退出等待，由路由保存已有结果并报告失败。
                if task.cancelled():
                    raise RuntimeError("并发讲解任务异常取消")
                if task.exception() is not None:
                    raise RuntimeError("并发讲解任务异常结束") from task.exception()
            remaining -= finished
            if next_item.done():
                event, payload = next_item.result()
                next_item = None
                yield event, payload
            else:
                next_item.cancel()
                await asyncio.gather(next_item, return_exceptions=True)
                next_item = None
    finally:
        tasks = workers + [stop_wait] + ([next_item] if next_item else [])
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for job in jobs:
            if job.state in {"pending", "running", "retrying"}:
                job.state = "cancelled"
