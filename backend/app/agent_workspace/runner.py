import asyncio
import json
import logging
import time

from jsonschema import validate

from app.routers.chat import _load_cfg
from app.services import provider_health
from app.services.llm import count_text_tokens
from app.services.prompt_loader import DEFAULT_VARIABLES
from app.services.error_explain import sanitize_error_text
from app.models import utcnow
from . import context, store, tools, llm, writer
from .instructions import (DEFAULT_EXECUTION_REQUEST, REVIEW_FEEDBACK, REVIEW_POLICY, REVIEW_SCHEMA,
                           REVISION_RETRY, WRITER_SYSTEM, behavior_of)
from .settings import load_settings

log = logging.getLogger(__name__)

# 同一进程内运行的轮次：停止接口直接取消这里的任务，不必等下一次心跳。
# DB 里的 stop 标记仍是跨进程/重启的兜底，心跳间隔只决定兜底的最坏延迟。
HEARTBEAT_SECONDS = 0.75
# 与 Agent 设置里的默认值保持一致（老轮次的快照没有这些键时用它兜底）
DEFAULT_CONTEXT_BUDGET = 262144
DEFAULT_PROVIDER_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_CAP = 60.0
STOP_GRACE_SECONDS = 3.0
_LOOP = None
_ACTIVE = {}
_ORPHANS = set()


def request_stop(run_id):
    """请求停止某个轮次。可在任意线程调用；本进程没有对应运行任务时返回 False。"""
    loop = _LOOP
    if loop is None or loop.is_closed():
        return False
    try:
        loop.call_soon_threadsafe(_cancel_active_run, run_id)
    except RuntimeError:
        return False
    return True


def _cancel_active_run(run_id):
    handle = _ACTIVE.get(run_id)
    if not handle:
        # 注册前的极短窗口：execute_run 启动后会复查 DB 里的 stop 标记补上。
        return
    runner, job, stop_event = handle
    runner.cancel_reason = ("stopped", "user_stop", "用户已停止本轮执行，已收到的内容已保存")
    stop_event.set()
    _request_cancel(job)


def _request_cancel(job):
    # 已经取消过的任务再 cancel 一次会打断它的收尾（第二次 CancelledError），
    # 导致已收到的正文来不及落库。
    if not job.done() and job.cancelling() == 0:
        job.cancel()


async def _cancel_and_wait(job):
    """取消运行任务并有限等待收尾；卡住时先让本轮落终态，迟到写入只会是已收到内容。"""
    _request_cancel(job)
    _done, pending = await asyncio.wait({job}, timeout=STOP_GRACE_SECONDS)
    if pending:
        log.warning("运行取消后 %.1fs 仍未收尾，先落终态", STOP_GRACE_SECONDS)
        _ORPHANS.add(job)
        job.add_done_callback(_drop_orphan)
    elif not job.cancelled():
        # 取走异常，避免任务已结束时出现 never retrieved 警告。
        job.exception()


def _consume_task(task):
    if not task.cancelled():
        task.exception()


def _drop_orphan(job):
    _ORPHANS.discard(job)
    if not job.cancelled():
        job.exception()


class WaitingForUser(Exception):
    pass


class BudgetReached(Exception):
    pass


class Runner:
    def __init__(self, run_id, model_call=None):
        self.id = run_id
        self.model_call = model_call or llm.complete
        self.buffers = {}
        self.last_flush = 0
        self.tokens = 0
        self.live_tokens = 0
        self.step = 0
        self.created_versions = []
        self.current_entry = None
        self.cancel_reason = ("interrupted", "execution_cancelled", "后台执行被取消，已收到的内容已保存")
        # Provider 粘性与缓存观测：一旦换家，本任务不再自动切回
        self.provider_id = ""
        self.switches = []
        self.usage_totals = {"prompt": 0, "cached": 0, "completion": 0, "cached_reported": False}
        self.partial_retries = 0
        self.config_changed = False
        self._token_cache: dict = {}

    async def load(self):
        self.run = await asyncio.to_thread(store.load_run, self.id)
        self.task_id = self.run["task_id"]
        self.snapshot = self.run["snapshot"]
        self.config = self.snapshot["config"]
        self.cfg = await asyncio.to_thread(_load_cfg)
        self.limits = self.snapshot["limits"]
        self.step, self.tokens = self.run["step"], self.run["tokens"]
        self.created_versions = self.run["versions"]
        self.provider_id = self.snapshot.get("provider") or self.snapshot.get("preferred_provider") or ""
        self.switches = list(self.snapshot.get("switches") or [])
        self.usage_totals = {**self.usage_totals, **(self.snapshot.get("usage") or {})}
        elapsed = (utcnow() - self.run["started_at"]).total_seconds() if self.run.get("started_at") else 0
        self.deadline = time.monotonic() + max(0.0, self.limits["max_seconds"] - elapsed)
        self.messages = self.run["messages"]
        if not self.messages:
            rows = await asyncio.to_thread(tools.materials, self.task_id, self.config["materials"])
            detail = await asyncio.to_thread(store.task_detail, self.run["owner"], self.task_id)
            history = await asyncio.to_thread(store.conversation_history, self.task_id, self.id)
            context = {"goal": self.config["goal"], "task_prompt": self.config["prompt"],
                       "instruction": self.snapshot.get("instruction", ""),
                       "base_version": self.snapshot.get("base_version", ""),
                       "materials": [{"id": m["id"], "name": m["name"], "chars": len(m["content"])} for m in rows],
                       "versions": detail["versions"], "teaching_tools": [
                           {"id": key, "name": self.snapshot.get("templates", {}).get(key, {}).get("name", key), "prompt": prompt}
                           for key, prompt in self.config.get("teaching_tools", {}).items()],
                       "previous_conversation": history}
            if not self.config["goal"].strip() and not context["instruction"].strip():
                context["instruction"] = DEFAULT_EXECUTION_REQUEST
            self.messages = [{"role": "system", "content": behavior_of(self.config)},
                             {"role": "user", "content": store.encode(context)}]
            await self.checkpoint()

    async def checkpoint(self):
        # 用量与 Provider 都随检查点落库：使用日志在轮次结束时按真实用量结算
        self.snapshot["usage"] = dict(self.usage_totals)
        await asyncio.to_thread(store.checkpoint, self.id, self.messages, self.step, self.tokens, self.snapshot)

    async def flush(self):
        if self.current_entry and self.buffers:
            parts, self.buffers = {k: "".join(v) for k, v in self.buffers.items()}, {}
            # 本轮用量只在调用结束后结算；调用进行中先给出已收到内容的估算，界面用量随输出增长。
            self.live_tokens += await asyncio.to_thread(count_text_tokens, "".join(parts.values()), self.snapshot["model"])
            await asyncio.to_thread(store.append_chunks, self.current_entry, parts, {"live_tokens": self.live_tokens})
        self.last_flush = time.monotonic()

    async def emit(self, kind, text):
        self.buffers.setdefault(kind, []).append(text)
        if time.monotonic() - self.last_flush > 0.35:
            await self.flush()

    def _message_tokens(self, message: dict) -> int:
        """单条消息的 token 数（按对象身份缓存：消息追加后不再改写，重复计费没意义）。"""
        key = id(message)
        value = self._token_cache.get(key)
        if value is None:
            value = count_text_tokens(store.encode(message), self.snapshot["model"]) + 3
            self._token_cache[key] = value
        return value

    def _context_tokens(self, messages: list[dict], schemas=None) -> int:
        """整段上下文的 token 估算：逐条缓存求和，避免每步把 256K 重新分词。"""
        total = sum(self._message_tokens(message) for message in messages)
        if schemas:
            key = ("tools", len(schemas), store.encode(schemas))
            value = self._token_cache.get(key)
            if value is None:
                value = count_text_tokens(store.encode(schemas), self.snapshot["model"])
                self._token_cache[key] = value
            total += value
        return total

    async def _compaction_reason(self) -> str:
        """决定这一步之前要不要"强制"压缩。

        - manual：用户点了「压缩上下文」；
        - frame-break：刚应用了新配置（工具表变了，前缀本来就要重算，顺手压缩不亏）；
        - cold：本轮第一步，且粘住的 Provider 正在熔断（大概率要换家，
          新家反正要冷读，先把上下文压小）。
        其余情况交给 compact() 自己按 256K 阈值判断。
        """
        if await asyncio.to_thread(store.take_compact_request, self.id):
            return "manual"
        if self.config_changed:
            self.config_changed = False
            return "frame-break"
        if self.step == 0 and self.provider_id and provider_health.is_open(self.provider_id):
            return "cold"
        return ""

    async def compact(self, reason: str = "") -> bool:
        """按需压缩上下文；返回是否真的压缩了。

        触发：reason 非空（manual / frame-break / cold）或估算超过 context_budget。
        切点永远在 HEAD 之后，HEAD 逐字节不变 —— 这段前缀的缓存不会被压缩打掉。
        """
        budget = int(self.limits.get("context_budget") or DEFAULT_CONTEXT_BUDGET)
        keep_tail = max(1, int(self.limits.get("keep_tail_steps") or 4))
        before = await asyncio.to_thread(self._context_tokens, self.messages, None)
        if not reason and before <= budget:
            return False
        if len(self.messages) <= 2 + keep_tail:
            return False
        ratio = (float(self.limits.get("switch_compaction_ratio") or 0.5)
                 if reason == "cold" else 0.7)
        target = max(8192, int(budget * ratio))
        plan = await asyncio.to_thread(
            context.plan_cut, self.messages, keep_tail=keep_tail, target_tokens=target,
            count_tokens=lambda msgs: self._context_tokens(msgs, None),
        )
        if not plan:
            return False
        new_messages, stats = plan
        after = await asyncio.to_thread(self._context_tokens, new_messages, None)
        if after >= before:
            return False
        self.messages = new_messages
        # 只保留仍在上下文里的消息的计数，避免长期运行把缓存撑大
        live = {id(message) for message in self.messages}
        self._token_cache = {key: value for key, value in self._token_cache.items()
                             if not isinstance(key, int) or key in live}
        stats.update(before=before, after=after, reason=reason or "pressure")
        await self.checkpoint()
        entry = await asyncio.to_thread(store.start_entry, self.task_id, self.id, store.uid(),
                                        "compaction", "压缩上下文", stats)
        await asyncio.to_thread(store.finish_entry, entry["id"], "done", stats)
        log.info("Agent 压缩上下文（%s）：%s → %s tokens，丢了 %s 个单元",
                 stats["reason"], before, after, stats["dropped_units"])
        return True

    def hard_context_limit(self) -> int:
        """上下文硬顶：压缩阈值之上留 25% 余量。

        256K 是「该压缩了」的线，不是「不允许」的线；真正拒绝只在压缩之后
        仍然超限时发生（材料本身太大，压缩解决不了）。
        """
        budget = int(self.limits.get("context_budget") or DEFAULT_CONTEXT_BUDGET)
        return int(budget * 1.25)

    def provider_attempts(self) -> int:
        return max(1, int(self.limits.get("provider_attempts") or DEFAULT_PROVIDER_ATTEMPTS))

    def retry_wait_cap(self) -> float:
        return float(self.limits.get("retry_wait_cap_seconds") or DEFAULT_RETRY_WAIT_CAP)

    def _charge(self, usage: dict | None, cached: int | None, context_tokens: int, output_text: str = "") -> None:
        """按「未命中缓存的输入 + 输出」计入本轮预算。

        命中缓存的输入按上游缓存价计费（通常是输入价的 10–25%），把它算成未命中
        会让长任务在缓存好好的时候也被预算掐死；反过来，上游没上报命中信息时
        一律按未命中算（保守），绝不把「不知道」当成「免费」。
        """
        usage = usage or {}
        prompt = int(usage.get("prompt_tokens") or context_tokens or 0)
        completion = int(usage.get("completion_tokens") or 0)
        if not completion and output_text:
            completion = count_text_tokens(output_text, self.snapshot["model"])
        hit = int(cached or 0)
        if hit < 0:
            hit = 0
        if hit > prompt:
            hit = prompt
        uncached = max(0, prompt - hit)
        self.tokens += uncached + completion
        totals = self.usage_totals
        totals["prompt"] = int(totals.get("prompt") or 0) + prompt
        totals["cached"] = int(totals.get("cached") or 0) + hit
        if cached is not None:
            # 区分「上报了 0」与「没上报」：日志里后者必须是 NULL
            totals["cached_reported"] = True
        totals["completion"] = int(totals.get("completion") or 0) + completion

    def _note_provider(self, provider_id: str) -> None:
        """记录这一步实际走的 Provider；换了家就记一次（本任务不再自动切回）。"""
        if not provider_id:
            return
        previous = self.provider_id
        if previous and previous != provider_id:
            self.switches.append({"from": previous, "to": provider_id, "step": self.step})
            self.snapshot["switches"] = self.switches
            log.warning("Agent 任务换用 Provider：%s → %s（第 %s 步），本任务不再切回",
                        previous, provider_id, self.step)
        self.provider_id = provider_id
        self.snapshot["provider"] = provider_id

    def _may_retry_partial(self, exc: "llm.PartialResponseError") -> bool:
        """断流后是否同家重跑本步：prompt 一字未变，重跑几乎全是缓存命中。

        只在「断流前没吐多少内容 + 时间/预算还够 + 是瞬态故障」时做一次，
        避免把一次真正的输出中断变成反复重跑。
        """
        if self.partial_retries >= 1:
            return False
        if len(exc.result.content or "") > 2000:
            return False
        if not provider_health.is_transient_failure(exc.cause):
            return False
        if time.monotonic() + 60 > self.deadline:
            return False
        if self.limits["max_tokens"] - self.tokens < 4096:
            return False
        self.partial_retries += 1
        return True

    async def call(self, label, messages, schemas=None, review=False, role="agent", source="", retry=False):
        """role 区分调度与写作者：写作者的正文进成果，对话只显示进度；source 把同一次写作的续写归到一起。

        retry=True 表示「同一步的重跑」（断流后）：不占新步数、不改 messages，
        这样前缀缓存原样命中。
        """
        self.last_call_entry = None
        if not retry and self.step >= self.limits["max_steps"]:
            raise BudgetReached("已达到本轮步骤上限，已有成果保留，可继续执行")
        context_tokens = await asyncio.to_thread(self._context_tokens, messages, schemas)
        # 预算只算「已花掉的未命中 tokens」，不再把整段上下文预扣一次：
        # 否则 256K 上下文光第一步就会被判超预算，缓存命中反而让预算纹丝不动。
        remaining = self.limits["max_tokens"] - self.tokens
        if remaining < 512:
            raise BudgetReached("已达到本轮 token 预算，已有成果已保留")
        if context_tokens > self.hard_context_limit():
            raise BudgetReached("本次上下文过长，请先压缩上下文或分篇选材后继续；材料与成果没有删减")
        if not retry:
            self.step += 1
        output_limit = min(self.limits["output_tokens"], remaining)
        entry = await asyncio.to_thread(store.start_entry, self.task_id, self.id, store.uid(),
                                        "review" if review else "model", label,
                                        {"model": self.snapshot["model"], "config_revision": self.snapshot["revision"],
                                         "output_tokens": output_limit, "role": "reviewer" if review else role,
                                         "context_tokens": context_tokens, **({"source": source} if source else {})})
        self.live_tokens = 0
        self.current_entry = entry["id"]
        self.last_call_entry = entry["id"]
        await asyncio.to_thread(store.append_chunks, entry["id"], {"prompt": store.encode({"messages": messages, "tools": schemas or []})})
        try:
            result = await self.model_call(self.cfg, self.snapshot["model"], messages, schemas,
                                           output_limit, self.emit,
                                           response_format=REVIEW_SCHEMA if review else None,
                                           preferred=self.provider_id,
                                           attempts=self.provider_attempts(),
                                           retry_wait_cap=self.retry_wait_cap(),
                                           deadline=self.deadline)
            await self.flush()
            thinking = await asyncio.to_thread(store.entry_text, entry["id"], "reasoning") if not result.usage else ""
            self._charge(result.usage, result.cached_tokens, context_tokens,
                         result.content + store.encode(result.calls) + thinking)
            self._note_provider(result.provider_id)
            details = {"usage": result.usage, "finish_reason": result.finish_reason,
                       "provider_id": result.provider_id, "attempts": result.attempts,
                       "cached_tokens": result.cached_tokens, "budget_tokens": self.tokens}
            limited = result.finish_reason in {"length", "max_tokens"}
            if limited:
                details.update(error_code="output_limit", error=f"模型达到本次输出上限（请求额度 {output_limit:,} tokens），已收到的内容已保存")
                if not result.content and not result.calls:
                    details["error"] += "；本次没有生成正文或工具调用"
            await asyncio.to_thread(store.finish_entry, entry["id"], "incomplete" if limited else "done", details)
            return result, entry["id"]
        except BaseException as exc:
            await self.flush()
            partial = "".join([await asyncio.to_thread(store.entry_text, entry["id"], kind) for kind in ("output", "reasoning", "arguments")])
            if isinstance(exc, llm.PartialResponseError):
                self._charge(exc.result.usage, exc.result.cached_tokens, context_tokens, partial)
                if exc.result.provider_id:
                    self._note_provider(exc.result.provider_id)
            else:
                self._charge(None, None, context_tokens, partial)
            if isinstance(exc, asyncio.CancelledError):
                status, code, message = self.cancel_reason
                details = {"error_code": code, "error": message}
            else:
                details = llm.error_details(exc)
                # 永久性错误（空响应、异常结束、凭证无效、模型不存在）重试也没用，落 failed；
                # 其余按可继续的中断处理，让用户能接着跑。
                status = "failed" if details["error_code"] in {
                    "empty_response", "model_finish_error", "model_auth", "model_not_found"} else "interrupted"
                if isinstance(exc, llm.PartialResponseError):
                    details.update(provider_id=exc.result.provider_id, attempts=exc.result.attempts)
            await asyncio.to_thread(store.finish_entry, entry["id"], status, details)
            raise
        finally:
            self.current_entry = None
            await self.checkpoint()

    async def notes(self):
        notes = await asyncio.to_thread(store.take_notes, self.id)
        for note in notes:
            if note["config"]:
                self.config = note["config"]
                # 模型选择固定在本轮；提示词和工具从下一步生效。
                # 不重写 messages[0]：HEAD 是前缀缓存的锚点，改它等于整段重算。
                # 新配置以追加消息的形式交给模型（下一句就是完整配置 JSON），
                # 并把这次变化当成一次"换帧"事件，在下一步顺手压缩。
                self.snapshot["config"] = self.config
                self.snapshot["revision"] += 1
                self.config_changed = True
                self.messages.append({"role": "user", "content": "从此步骤使用的新任务配置：\n" + store.encode(self.config)})
            if note["text"]:
                self.messages.append({"role": "user", "content": note["text"]})
        if notes:
            await asyncio.to_thread(store.apply_notes, self.id, notes, self.snapshot, self.messages)

    async def create_document(self, args, key):
        selected = args.get("material_ids") or self.config["materials"]
        if not set(selected) <= set(self.config["materials"]):
            raise ValueError("文档所用材料不在本轮范围内")
        rows = await asyncio.to_thread(tools.materials, self.task_id, selected)
        template = self.config["prompt"]
        if args.get("teaching_tool"):
            template = self.config.get("teaching_tools", {}).get(args["teaching_tool"])
            if template is None:
                raise ValueError("此教学工具未在本任务中启用")
        base = args.get("base_version") or self.snapshot.get("base_version") or ""
        previous = None
        if base:
            previous = (await asyncio.to_thread(tools.document, self.task_id, base))["content"]
        prompt = writer.render_prompt(template, DEFAULT_VARIABLES, rows, previous, self.config["goal"], args["instruction"])
        # 写作者独立于调度策略；system 与 prompt 记入依据，修订时逐字重建以复用前缀缓存。
        messages = [{"role": "system", "content": WRITER_SYSTEM}, {"role": "user", "content": prompt}]
        content, complete, last_entry = "", False, ""
        # 有限续写，单纯触及输出上限不能变成成功或从头重写。
        for part in range(4):
            try:
                result, last_entry = await self.call(args["title"] + (f"（续写 {part}）" if part else ""), messages,
                                                     role="writer", source=key)
            except llm.PartialResponseError as exc:
                content += exc.result.content
                if not content.strip():
                    raise
                break
            except (asyncio.CancelledError, BudgetReached):
                partial = await asyncio.to_thread(store.entry_text, self.last_call_entry, "output") if getattr(self, "last_call_entry", None) else ""
                if content or partial:
                    await asyncio.to_thread(store.save_version, self.task_id, self.id, key+":partial", args["title"], content+partial, base, "agent", False)
                raise
            content += result.content
            complete = result.finish_reason not in {"length", "max_tokens"}
            if complete:
                break
            # 没有正文可接续时，不发送空 assistant 消息反复消耗同一额度。
            if not result.content:
                break
            messages.extend([{"role": "assistant", "content": result.content},
                             {"role": "user", "content": "接着刚才未完成的位置继续，只输出后续内容，保留原定范围和结构。"}])
        if not content.strip():
            if result.finish_reason in {"length", "max_tokens"}:
                raise BudgetReached("模型达到单次输出上限，但没有生成正文；思考记录已保存。请调整管理后台 Agent 的单次输出额度或更换模型后重试")
            raise ValueError("模型未返回可用文档")
        provenance = {"requirements": template, "instruction": args["instruction"], "goal": self.config["goal"],
                      "materials": selected, "teaching_tool": args.get("teaching_tool", ""), "config_revision": self.snapshot["revision"],
                      "writer": writer.recipe(WRITER_SYSTEM, DEFAULT_VARIABLES, base, prompt, content)}
        version = await asyncio.to_thread(store.save_version, self.task_id, self.id, key, args["title"], content, base, "agent", complete, provenance)
        self.created_versions.append(version["id"])
        return {**version, "entry_id": last_entry}

    async def revision_feedback(self, args):
        """汇总交给写作者的修改意见。审阅意见按序号从存档原样取出，不经调度 Agent 转述。"""
        parts = []
        if args.get("review_id"):
            review = await asyncio.to_thread(store.review_data, self.task_id, args["review_id"])
            total = len(review["issues"])
            numbers = list(dict.fromkeys(args.get("issues") or range(1, total + 1)))
            if any(n > total for n in numbers):
                raise ValueError(f"意见序号超出范围，该审阅共 {total} 条意见")
            # 保留审阅里的原序号，写作者的逐条说明和调度看到的审阅编号一致。
            chosen = [(n, review["issues"][n - 1]) for n in numbers if n - 1 not in review["ignored"]]
            if chosen:
                parts.append("审阅意见：\n" + "\n".join(writer.format_issue(n, issue) for n, issue in chosen))
        elif args.get("issues"):
            raise ValueError("引用审阅意见序号时需要同时提供 review_id")
        request = self.snapshot.get("instruction", "").strip()
        if args.get("include_user_request") and request:
            parts.append("用户原话：\n" + request)
        if args["instruction"].strip():
            parts.append("修改要求：\n" + args["instruction"].strip())
        if not parts:
            raise ValueError("没有可执行的修改意见；所引用的意见可能已被用户忽略")
        return "\n\n".join(parts)

    async def author_messages(self, author):
        """按依据重建写作者当时的请求，并接上它的稿子。依据不能逐字重建时返回 None。"""
        provenance = author["provenance"]
        recipe = provenance["writer"]
        rows = await asyncio.to_thread(tools.materials, self.task_id, provenance.get("materials", []))
        previous = None
        if recipe.get("base_version"):
            previous = (await asyncio.to_thread(tools.document, self.task_id, recipe["base_version"]))["content"]
        prompt = writer.render_prompt(provenance.get("requirements", ""), recipe["values"], rows, previous,
                                      provenance.get("goal", ""), provenance.get("instruction", ""))
        if writer.digest(prompt) != recipe["prompt_sha256"]:
            return None
        return [{"role": "system", "content": recipe["system"]}, {"role": "user", "content": prompt},
                {"role": "assistant", "content": author["content"]}]

    async def revision_context(self, version):
        """返回 (messages, mode)：author 作者改自己的稿；edited 作者稿经用户手改；fresh 没有作者会话可重建。"""
        node = version
        for _ in range(writer.MAX_LINEAGE_DEPTH):
            if writer.authored(node):
                try:
                    messages = await self.author_messages(node)
                except (ValueError, KeyError, TypeError) as exc:
                    log.warning("修订无法重建作者会话 version=%s: %s", node["id"], exc)
                    messages = None
                if messages:
                    return messages, "author" if node["id"] == version["id"] else "edited"
                break
            if not node.get("parent_id"):
                break
            try:
                node = await asyncio.to_thread(tools.document, self.task_id, node["parent_id"])
            except ValueError:
                break
        provenance = version["provenance"]
        try:
            rows = await asyncio.to_thread(tools.materials, self.task_id, provenance.get("materials") or self.config["materials"])
        except ValueError:
            rows = await asyncio.to_thread(tools.materials, self.task_id, self.config["materials"])
        prompt = writer.render_prompt(provenance.get("requirements") or self.config["prompt"], DEFAULT_VARIABLES, rows, None, "", "", tail=False)
        if self.config["goal"].strip():
            prompt += "\n\n本次目标：" + self.config["goal"]
        return [{"role": "system", "content": WRITER_SYSTEM}, {"role": "user", "content": prompt}], "fresh"

    async def revise_document(self, args, key):
        version = await asyncio.to_thread(tools.document, self.task_id, args["version_id"])
        if not version["complete"]:
            raise ValueError("该版本尚未完整生成，不能修订；请先补全或选择完整版本")
        feedback = await self.revision_feedback(args)
        messages, mode = await self.revision_context(version)
        records = version["provenance"].get("revisions", [])
        if mode == "author":
            messages.append({"role": "user", "content": writer.revision_request(feedback, records)})
        elif mode == "edited":
            messages.append({"role": "user", "content": writer.revision_request(feedback, records, version["content"], edited_by_user=True)})
        else:
            # 新会话只有一条 user 消息：要求与材料在前，他人稿件与修改意见在后。
            messages[-1] = {"role": "user", "content": messages[-1]["content"] + "\n\n"
                            + writer.revision_request(feedback, records, version["content"])}
        # 默认标题标一次「（修订）」即可，反复修订不叠加；版本号已能区分先后。
        title = (args.get("title") or version["title"].removesuffix("（修订）") + "（修订）")[:200]
        draft, applied, failures, notes, last_entry, interrupted = version["content"], 0, [], [], "", False

        async def save(status, suffix="", label=title):
            provenance = writer.review_view(version["provenance"])
            if mode == "author":
                # 作者在自己的稿上改，新稿仍属同一作者会话；用户手改或他人稿件不冒充为作者输出。
                provenance["writer"] = {**version["provenance"]["writer"], "output_sha256": writer.digest(draft)}
            record = writer.revision_record(feedback, "\n".join(notes), applied, failures, status)
            provenance["revisions"] = (records + [record])[-writer.MAX_REVISION_RECORDS:]
            return await asyncio.to_thread(store.save_version, self.task_id, self.id, key + suffix, label[:200], draft,
                                           version["id"], "agent", True, provenance)

        try:
            for attempt in range(writer.MAX_REVISION_ATTEMPTS):
                broken = None
                try:
                    result, last_entry = await self.call(f"修订《{title}》" + (f"（重试 {attempt}）" if attempt else ""), messages,
                                                         role="writer", source=key)
                    text, limited = result.content, result.finish_reason in {"length", "max_tokens"}
                except llm.PartialResponseError as exc:
                    text, limited, broken = exc.result.content, True, exc
                    last_entry = self.last_call_entry or last_entry
                if not text.strip():
                    if broken:
                        raise broken
                    if limited:
                        raise BudgetReached("修订达到单次输出上限，但没有给出修改；思考记录已保存。请调整管理后台 Agent 的单次输出额度或更换模型后重试")
                    break
                parsed = writer.parse_edits(text, truncated=limited)
                if parsed.explanation:
                    notes.append(parsed.explanation)
                draft, count, failed = writer.apply_edits(draft, parsed.edits)
                applied += count
                failures = sorted(parsed.problems + failed)
                if broken:
                    # 连接中断时已完整收到的修改块照常生效，不在不稳定的连接上继续重试。
                    interrupted = True
                    break
                if not failures or attempt == writer.MAX_REVISION_ATTEMPTS - 1:
                    break
                messages += [{"role": "assistant", "content": text},
                             {"role": "user", "content": REVISION_RETRY.format(failures=writer.describe_failures(failures))}]
        except (asyncio.CancelledError, BudgetReached):
            if draft != version["content"]:
                saved = await save("partial", ":partial", title + "（部分修改）")
                self.created_versions.append(saved["id"])
            raise
        except Exception as exc:
            if draft == version["content"]:
                raise
            # 之前的修改块已经生效，保存下来交给调度判断，不因后续一次失败丢弃。
            error = sanitize_error_text(str(exc))[:300] or type(exc).__name__
            saved = await save("partial", ":partial", title + "（部分修改）")
            self.created_versions.append(saved["id"])
            return {**saved, "new_version": True, "applied": applied, "explanation": "\n".join(notes)[:4000],
                    "error": "修订中途出错，已保存出错前完成的修改：" + error, "entry_id": last_entry}
        info = {"applied": applied, "explanation": "\n".join(notes)[:4000] or "写作者没有给出说明",
                "unresolved": writer.describe_failures(failures), "entry_id": last_entry}
        if interrupted:
            info["notice"] = "与模型的连接中断，只应用了中断前完整收到的修改"
        if draft == version["content"]:
            return {"new_version": False, "base_version": version["id"], **info}
        saved = await save("interrupted" if interrupted else "done")
        self.created_versions.append(saved["id"])
        return {**saved, "new_version": True, **info}

    async def tool_call(self, call, key=None):
        name, raw = call["function"]["name"], call["function"]["arguments"]
        # 幂等键不能只信 provider 的 id：缺 id 时共用一个空键，第二次调用会拿回第一次的结果。
        if not key and call.get("id"):
            key = "tool:" + call["id"]
        elif not key:
            key = "tool:" + store.uid()
        if call.get("id") and key != "tool:" + call["id"]:
            # 升级前落库的同一调用用的是旧键，沿用它才不会被重复执行一次。
            legacy_key = "tool:" + call["id"]
            legacy = await asyncio.to_thread(store.find_entry, self.id, legacy_key)
            if legacy and legacy["status"] in {"done", "waiting", "interrupted", "failed"}:
                key = legacy_key
        entry = await asyncio.to_thread(store.start_entry, self.task_id, self.id, key, "tool", name)
        if entry["status"] == "done":
            full = await asyncio.to_thread(store.entry_text, entry["id"], "output")
            return self.result_view(full, entry["id"])
        if entry["status"] == "waiting":
            # 进程重启后重放同一调用：提问仍挂着，不能再写一遍。
            raise WaitingForUser()
        await asyncio.to_thread(store.append_chunks, entry["id"], {"input": raw})
        try:
            args = json.loads(raw)
            # 显式提交的工具关闭先约束尚未开始的调用；文字要求在整组工具返回后入上下文。
            pending_notes = await asyncio.to_thread(store.take_notes, self.id)
            latest_config = next((n["config"] for n in reversed(pending_notes) if n["config"]), None)
            if latest_config and name not in {t["function"]["name"] for t in tools.tool_schemas(latest_config)}:
                raise ValueError("用户已关闭此工具，尚未开始的调用已阻止")
            if latest_config and name == "search_material" and args.get("regex") and "regex" not in latest_config.get("tools", []):
                raise ValueError("用户已关闭正则工具")
            schemas = {s["function"]["name"]: s["function"] for s in tools.tool_schemas(self.config)}
            if name not in schemas:
                raise ValueError("此工具已关闭或不在本轮允许范围内")
            validate(args, schemas[name]["parameters"])
            if name == "create_document":
                result = await self.create_document(args, key)
            elif name == "revise_document":
                result = await self.revise_document(args, key)
            elif name == "ask_user":
                ask = tools.normalize_question(args)
                payload = store.encode(ask)
                await asyncio.to_thread(store.append_chunks, entry["id"], {"output": payload})
                await asyncio.to_thread(store.finish_entry, entry["id"], "waiting",
                                        {"question": ask["question"], "ask": ask, "chars": {"output": len(payload)}})
                raise WaitingForUser()
            else:
                result = await tools.execute_readonly(self.task_id, self.config, name, args)
            full = store.encode(result)
            await asyncio.to_thread(store.finish_tool, entry["id"], result)
            # 完整结果另存，模型收到有明确范围说明的结果视图。
            return self.result_view(full, entry["id"])
        except asyncio.CancelledError:
            await asyncio.to_thread(store.finish_entry, entry["id"], "interrupted",
                                    {"error": "本轮已停止，工具调用未完成"})
            raise
        except WaitingForUser:
            raise
        except BudgetReached as exc:
            await asyncio.to_thread(store.finish_entry, entry["id"], "incomplete", {"error": str(exc)})
            raise
        except Exception as exc:
            error = sanitize_error_text(str(exc))[:500]
            await asyncio.to_thread(store.finish_entry, entry["id"], "failed", {"error": error})
            return {"error": error, "unchanged": True}

    @staticmethod
    def result_view(full, entry_id):
        if len(full) <= 20000:
            return json.loads(full)
        return {"entry_id": entry_id, "preview": full[:20000], "total_chars": len(full),
                "notice": "此处为结果预览，完整结果已保存在步骤详情；可缩小查询范围获取相关内容。"}

    async def review(self, version_id):
        version = await asyncio.to_thread(tools.document, self.task_id, version_id)
        material_ids = list(dict.fromkeys(version["provenance"].get("materials", []) + self.config["materials"]))
        rows = await asyncio.to_thread(tools.materials, self.task_id, material_ids)
        payload = {"goal": self.config["goal"], "requirements": self.config["prompt"],
                   "instruction": self.snapshot.get("instruction", ""), "materials": rows, "draft": {**version, "provenance": writer.review_view(version["provenance"])},
                   "generation_requirements": writer.review_view(version["provenance"])}
        try:
            result, entry_id = await self.call("开放式审阅", [{"role": "system", "content": self.config.get("review_prompt", REVIEW_POLICY)},
                                                           {"role": "user", "content": store.encode(payload)}], review=True)
        except (BudgetReached, asyncio.CancelledError):
            raise
        except Exception as exc:
            if self.last_call_entry:
                await asyncio.to_thread(store.finish_entry, self.last_call_entry, "failed", {**llm.error_details(exc), "version_id": version_id})
            if self.run["mode"] == "review":
                raise
            return None
        if result.finish_reason in {"length", "max_tokens"}:
            raise BudgetReached("审阅达到单次输出上限，未得出完整结论；已有成果和审阅记录已保存")
        try:
            data = json.loads(result.content)
            validate(data, REVIEW_SCHEMA["json_schema"]["schema"])
            for issue in data["issues"]:
                if issue["quote"] and issue["quote"] not in version["content"]:
                    issue["certainty"] = "uncertain"
            await asyncio.to_thread(store.append_chunks, entry_id, {"review": store.encode(data)})
            await asyncio.to_thread(store.finish_entry, entry_id, "done", {"review_summary": data["summary"][:500], "issues": len(data["issues"]), "version_id": version_id})
            return {**data, "entry_id": entry_id}
        except Exception:
            # 原始审阅全文保留供阅读，无法解析不能误报通过。
            await asyncio.to_thread(store.finish_entry, entry_id, "failed", {"error": "审阅格式无法解析，原文可在详情查看", "version_id": version_id})
            if self.run["mode"] == "review":
                raise ValueError("审阅格式无法解析，未得出审阅结论") from None
            return None

    async def execute(self):
        await self.load()
        if self.run["mode"] == "tool_test":
            version = await self.create_document({"title": "教学工具试运行", "instruction": self.config["goal"],
                "teaching_tool": self.snapshot["teaching_tool"], "material_ids": self.config["materials"]}, "tool-test")
            if not version["complete"]:
                raise BudgetReached("试运行输出尚未完整，已有内容已保存")
            return
        if self.run["mode"] == "review":
            if not self.snapshot["base_version"]:
                raise ValueError("请先选择要审阅的成果版本")
            await self.review(self.snapshot["base_version"])
            await self.checkpoint()
            return
        while True:
            # 重启时优先完成检查点里尚未返回的工具调用。
            pending = []
            position = 0
            for index in range(len(self.messages)-1, -1, -1):
                message = self.messages[index]
                if message["role"] == "assistant":
                    # 按"已回了几个工具结果"判断跑到哪了：provider 的 id 可能重复或为空，
                    # 拿 id 集合去比对会把同 id 的第二个调用误判成已完成。
                    answered = sum(1 for m in self.messages[index+1:] if m["role"] == "tool")
                    pending = [(at, c) for at, c in enumerate(message.get("tool_calls", [])) if at >= answered]
                    position = index
                    break
            if pending:
                for at, call in pending:
                    # 键用「消息下标 + 调用下标」：同一 id 指向两次不同调用时不会串，
                    # 重放时下标仍然稳定（消息已随检查点落库）。
                    result = await self.tool_call(call, key=f"tool:{position}:{at}")
                    self.messages.append({"role": "tool", "tool_call_id": call["id"], "content": store.encode(result)})
                    await self.checkpoint()
                continue
            if self.step >= self.limits["max_steps"]:
                raise BudgetReached("已达到本轮步骤上限，已有成果保留，可继续执行")
            await self.notes()
            await self.compact(await self._compaction_reason())
            try:
                result, entry_id = await self.call(f"执行步骤 {self.step+1}", self.messages,
                                                   tools.tool_schemas(self.config))
            except llm.PartialResponseError as exc:
                # 断流：prompt 一字未变，同家重跑本步一次几乎全是缓存命中；
                # 只有在"没吐多少 + 时间预算够 + 是瞬态故障"时才这么做。
                if not self._may_retry_partial(exc):
                    raise
                log.warning("执行步骤断流，同 Provider 重跑本步一次：%s", exc)
                result, entry_id = await self.call(f"执行步骤 {self.step}（断流重试）", self.messages,
                                                   tools.tool_schemas(self.config), retry=True)
            if result.finish_reason in {"length", "max_tokens"}:
                if result.content:
                    await asyncio.to_thread(store.save_version, self.task_id, self.id, "partial:"+entry_id,
                                             "待补全的结果", result.content, self.snapshot.get("base_version", ""), "agent", False)
                if not result.content and not result.calls:
                    raise BudgetReached("模型达到单次输出上限，但没有生成正文或工具调用；思考记录已保存。请调整管理后台 Agent 的单次输出额度或更换模型后重试")
                raise BudgetReached("模型输出达到上限，已保存待补全内容，请继续执行")
            assistant = {"role": "assistant", "content": result.content or None}
            if result.calls:
                assistant["tool_calls"] = result.calls
            self.messages.append(assistant)
            await self.checkpoint()
            if result.calls:
                continue
            if result.content.strip() and not self.created_versions:
                version = await asyncio.to_thread(store.save_version, self.task_id, self.id, "final:"+entry_id,
                                                   "任务成果", result.content, self.snapshot.get("base_version", ""))
                self.created_versions.append(version["id"])
            if self.created_versions:
                latest = await asyncio.to_thread(tools.document, self.task_id, self.created_versions[-1])
                if not latest["complete"]:
                    raise BudgetReached("成果尚未完整生成，已有内容已保存，可继续补全")
            if await self.review_cycle():
                continue
            if await asyncio.to_thread(store.take_notes, self.id):
                await self.notes()
                continue
            return

    async def review_cycle(self):
        """审阅本轮最新的完整版本。需要调度 Agent 决定是否修订时，把意见放进对话并返回 True。

        每个版本只审一次；auto_improve 打开时最多交回 review_rounds 次，之后的新版本只审阅、只汇报。
        """
        if not (self.config.get("review") and self.created_versions):
            return False
        state = self.snapshot.setdefault("review_state", {"reviewed": [], "rounds": 0})
        version_id = self.created_versions[-1]
        if version_id in state["reviewed"]:
            return False
        review = await self.review(version_id)
        state["reviewed"].append(version_id)
        await self.checkpoint()
        rounds = self.config.get("review_rounds", 1)
        if not review or not review["issues"] or not self.config.get("auto_improve") or state["rounds"] >= rounds:
            return False
        state["rounds"] += 1
        version = await asyncio.to_thread(tools.document, self.task_id, version_id)
        issues = "\n".join(writer.format_issue(i, issue) for i, issue in enumerate(review["issues"], 1))
        self.messages.append({"role": "user", "content": REVIEW_FEEDBACK.format(
            version_id=version_id, title=version["title"], review_id=review["entry_id"], summary=review["summary"],
            issues=issues, round=state["rounds"], rounds=rounds)})
        await self.checkpoint()
        return True


async def execute_run(run_id, model_call=None):
    global _LOOP
    _LOOP = asyncio.get_running_loop()
    runner = Runner(run_id, model_call)
    run = await asyncio.to_thread(store.load_run, run_id)
    if run["stop"]:
        await asyncio.to_thread(store.finish_run, run_id, "stopped", "用户已停止本轮执行，已收到的内容已保存")
        return
    job = asyncio.create_task(runner.execute())
    stop_event = asyncio.Event()
    _ACTIVE[run_id] = (runner, job, stop_event)
    # 停止信号直接唤醒这里的等待，不必等下一次心跳超时。
    stop_wait = asyncio.create_task(stop_event.wait())
    stop_wait.add_done_callback(_consume_task)
    try:
        # 停止请求可能在 load_run 之后、注册之前到达；复查一次标记，补上这个窗口。
        if await asyncio.to_thread(store.stop_requested, run_id):
            _cancel_active_run(run_id)
        elapsed = (utcnow() - run["started_at"]).total_seconds() if run["started_at"] else 0
        deadline = time.monotonic() + run["snapshot"]["limits"]["max_seconds"] - elapsed
        while not job.done():
            if stop_event.is_set() or await asyncio.to_thread(store.heartbeat, run_id):
                runner.cancel_reason = ("stopped", "user_stop", "用户已停止本轮执行，已收到的内容已保存")
                await _cancel_and_wait(job)
                await asyncio.to_thread(store.finish_run, run_id, "stopped")
                return
            if time.monotonic() >= deadline:
                runner.cancel_reason = ("incomplete", "time_limit", "达到本轮时长上限，已收到的内容已保存")
                await _cancel_and_wait(job)
                raise BudgetReached("达到本轮时长上限，已有内容已保存")
            await asyncio.wait({job, stop_wait}, timeout=HEARTBEAT_SECONDS,
                               return_when=asyncio.FIRST_COMPLETED)
        if job.cancelled():
            # 进程内停止信号取消的是 job 本身；execute_run 没有被取消，不能走 worker 关闭的重新排队分支。
            status = "stopped" if runner.cancel_reason[0] == "stopped" else "interrupted"
            await asyncio.to_thread(store.finish_run, run_id, status, runner.cancel_reason[2])
            return
        await job
        await asyncio.to_thread(store.finish_run, run_id, "completed")
    except WaitingForUser:
        await asyncio.to_thread(store.finish_run, run_id, "waiting")
    except BudgetReached as exc:
        await asyncio.to_thread(store.finish_run, run_id, "incomplete", str(exc))
    except asyncio.CancelledError:
        runner.cancel_reason = ("interrupted", "worker_shutdown", "后台工作进程停止，本轮将重新排队；当前步骤可能需要重新执行")
        await _cancel_and_wait(job)
        await asyncio.to_thread(store.requeue_run, run_id)
        raise
    except Exception as exc:
        log.exception("Agent 工作台执行失败 run=%s", run_id)
        await asyncio.to_thread(store.finish_run, run_id, "failed", sanitize_error_text(str(exc))[:500])
    finally:
        stop_wait.cancel()
        _ACTIVE.pop(run_id, None)


async def worker():
    active = set()
    try:
        while True:
            await asyncio.to_thread(store.recover_runs)
            cfg = await asyncio.to_thread(load_settings)
            active = {t for t in active if not t.done()}
            if len(active) < cfg.concurrency:
                run_id = await asyncio.to_thread(store.claim_run)
                if run_id:
                    task = asyncio.create_task(execute_run(run_id))
                    active.add(task)
                    continue
            await asyncio.sleep(0.5)
    finally:
        for task in active:
            task.cancel()
        await asyncio.gather(*active, return_exceptions=True)
