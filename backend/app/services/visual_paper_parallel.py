"""有界并行精讲：共享组内材料，独立解析上游流，只提交归属明确的完整题块。"""

from __future__ import annotations

import asyncio
import re
from contextlib import aclosing
from dataclasses import dataclass, field
from time import monotonic

from app.services.visual_paper import TAG_LINE_RE, parse_custom_visual_paper
from app.services.llm_router import is_retryable

PARALLELISM = 3
MAX_ATTEMPTS = 3
ANALYSIS_TAGS = {
    "QTYPE", "ANSWER", "EVIDENCE", "REASON", "DISTRACTOR", "PITFALLS",
    "PATTERN_NAME", "PATTERN_STEPS", "TRANSFER_PASSAGE", "TRANSFER_STEM",
    "TRANSFER_OPTIONS", "TRANSFER_ANSWER", "TRANSFER_EXPL", "WRITING_POINTS",
    "WRITING_OUTLINE", "WRITING_SAMPLE",
}


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
    return re.sub(r"[＠@]{2,}", lambda m: m[0][0] + "\u200b" + m[0][1:], str(value or ""))


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


def plan_explanations(raw: str, loader, transfer_count: int, selected: list[str] | None = None) -> list[ExplainJob]:
    # 老客户端的自然语言工单仍交给原来的单流处理，不能把其剩余题清单猜成全卷。
    if selected is None and "【续写指令】" in raw:
        return []
    raw = raw.split("\n\n【续写指令】", 1)[0]
    paper = parse_custom_visual_paper(raw)
    if not paper:
        return []
    questions = [q for g in paper["groups"] for q in g["questions"]]
    nos = [q["no"] for q in questions]
    if not nos or any(not re.fullmatch(r"\d{1,3}", n) or q.get("passageUnresolved") for n, q in zip(nos, questions)):
        return []
    if len(set(nos)) != len(nos):
        return []
    if selected is not None and (not selected or len(set(selected)) != len(selected) or not set(selected) <= set(nos)):
        raise ValueError("待补全题号为空、重复或不属于当前试卷")
    wanted = set(selected) if selected is not None else set(nos)
    jobs = []
    # 迁移题量越大，单次处理原题越少，降低单任务撞输出上限的概率。
    size = max(1, 3 // transfer_count)
    for group in paper["groups"]:
        targets = [q["no"] for q in group["questions"] if q["no"] in wanted]
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
        self.allowed = set(nos)
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
                    self.no = value if value in self.allowed else ""
                    self.lines = [f"@@Q@@ {self.no}"] if self.no else []
                    self.keep = False
                    self.pending_no = not value
                elif tag == "END_Q":
                    if self.no and self.no not in self.seen and len(self.lines) > 1:
                        self.seen.add(self.no)
                        out.append((self.no, "\n".join(self.lines) + "\n@@END_Q@@\n"))
                    self.no, self.lines, self.keep, self.pending_no = "", [], False, False
                else:
                    self.keep = bool(self.no) and tag in ANALYSIS_TAGS
                    if self.keep:
                        self.lines.append(f"@@{tag}@@" + (f" {_guard(value)}" if value else ""))
            elif self.pending_no:
                value = line.strip()
                if value:
                    self.no = value if value in self.allowed else ""
                    self.lines = [f"@@Q@@ {self.no}"] if self.no else []
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
            original = parse_custom_visual_paper(job.material)
            questions = {q["no"]: q for g in original["groups"] for q in g["questions"]}
            question_groups = {q["no"]: g["id"] for g in original["groups"] for q in g["questions"]}
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

                        async def publish(items, *, terminal=False):
                            for no, block in items:
                                if no in job.completed:
                                    continue
                                expected = questions[no]
                                qtype = "writing" if expected['qtype'] == "writing" else "choice" if expected.get("options") else "blank"
                                block = re.sub(r"^@@QTYPE@@[^\n]*\n", "", block, flags=re.MULTILINE)
                                block = block.replace(f"@@Q@@ {no}\n", f"@@Q@@ {no}\n@@QTYPE@@ {qtype}\n", 1)
                                parsed = parse_custom_visual_paper(job.material + block)
                                question = next(q for g in parsed["groups"] for q in g["questions"] if q["no"] == no)
                                issues = question_missing(question, transfer_count, question_groups[no])
                                # 正常 EOF 漏结束标记只修复结构上已完整的题，半题和超限截断不能冒充成功。
                                if terminal and issues:
                                    continue
                                job.issues[no] = issues
                                if not issues:
                                    job.completed.append(no)
                                await queue.put(("token", block))
                                await queue.put(("visual_task", job.progress()))

                        try:
                            job.llm = call["llm"] = build_llm()
                            providers = getattr(job.llm, "providers", None)
                            # 出正文后不能拼接另一通道；新请求只为缺失题换通道重做。
                            if previous_provider and providers and len(providers) > 1:
                                job.llm.providers = sorted(providers, key=lambda p: p.get("id") == previous_provider)
                            async with aclosing(job.llm.chat_stream_with_stop(
                                user_prompt=call["prompt"], stop_event=stop_event, usage_out=call["usage"], **stream_kwargs,
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
                            call["state"] = "cancelled"
                            raise
                        except Exception as exc:
                            call["state"], call["error"] = "error", str(exc)
                            if not is_retryable(exc):
                                blocked.update(nos)
                        finally:
                            call["elapsed"] = monotonic() - call_started
                            used = getattr(job.llm, "provider_used", None) or getattr(job.llm, "last_provider", None) or {}
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
        await queue.put(("worker_done", None))

    workers = [asyncio.create_task(worker()) for _ in range(min(concurrency, len(jobs)))]
    stop_wait = asyncio.create_task(stop_event.wait())
    next_item = None
    try:
        remaining = len(workers)
        while remaining and not stop_event.is_set():
            next_item = asyncio.create_task(queue.get())
            await asyncio.wait([next_item, stop_wait], return_when=asyncio.FIRST_COMPLETED)
            if stop_event.is_set():
                break
            event, payload = next_item.result()
            next_item = None
            if event == "worker_done":
                remaining -= 1
            else:
                yield event, payload
    finally:
        tasks = workers + [stop_wait] + ([next_item] if next_item else [])
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for job in jobs:
            if job.state in {"pending", "running", "retrying"}:
                job.state = "cancelled"
