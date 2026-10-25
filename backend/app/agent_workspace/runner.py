import asyncio
import json
import logging
import re
import time
from contextlib import suppress

from jsonschema import validate

from app.routers.chat import _load_cfg
from app.services.llm import count_text_tokens
from app.services.prompt_loader import DEFAULT_VARIABLES
from app.services.error_explain import sanitize_error_text
from app.models import utcnow
from . import store, tools, llm
from .instructions import DEFAULT_EXECUTION_REQUEST, REVIEW_POLICY, REVIEW_SCHEMA
from .settings import load_settings

log = logging.getLogger(__name__)


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
        self.step = 0
        self.created_versions = []
        self.current_entry = None
        self.cancel_reason = ("interrupted", "execution_cancelled", "后台执行被取消，已收到的内容已保存")

    async def load(self):
        self.run = await asyncio.to_thread(store.load_run, self.id)
        self.task_id = self.run["task_id"]
        self.snapshot = self.run["snapshot"]
        self.config = self.snapshot["config"]
        self.cfg = await asyncio.to_thread(_load_cfg)
        self.limits = self.snapshot["limits"]
        self.step, self.tokens = self.run["step"], self.run["tokens"]
        self.created_versions = self.run["versions"]
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
            self.messages = [{"role": "system", "content": self.config["behavior"]},
                             {"role": "user", "content": store.encode(context)}]
            await self.checkpoint()

    async def checkpoint(self):
        await asyncio.to_thread(store.checkpoint, self.id, self.messages, self.step, self.tokens, self.snapshot)

    async def flush(self):
        if self.current_entry and self.buffers:
            parts, self.buffers = {k: "".join(v) for k, v in self.buffers.items()}, {}
            await asyncio.to_thread(store.append_chunks, self.current_entry, parts)
        self.last_flush = time.monotonic()

    async def emit(self, kind, text):
        self.buffers.setdefault(kind, []).append(text)
        if time.monotonic() - self.last_flush > 0.35:
            await self.flush()

    async def call(self, label, messages, schemas=None, review=False):
        self.last_call_entry = None
        if self.step >= self.limits["max_steps"]:
            raise BudgetReached("已达到本轮步骤上限，已有成果保留，可继续执行")
        context_tokens = await asyncio.to_thread(count_text_tokens, store.encode({"messages": messages, "tools": schemas or []}), self.snapshot["model"])
        remaining = self.limits["max_tokens"] - self.tokens - context_tokens
        if remaining < 256:
            raise BudgetReached("已达到本轮 token 预算，已有成果已保留")
        # 不通过截掉材料来适配窗口。超限时保留任务并要求缩小选材。
        if context_tokens > 90000:
            raise BudgetReached("本次上下文过长，请分篇选材后继续；材料与成果没有删减")
        self.step += 1
        output_limit = min(self.limits["output_tokens"], remaining)
        entry = await asyncio.to_thread(store.start_entry, self.task_id, self.id, store.uid(),
                                        "review" if review else "model", label,
                                        {"model": self.snapshot["model"], "config_revision": self.snapshot["revision"],
                                         "output_tokens": output_limit})
        self.current_entry = entry["id"]
        self.last_call_entry = entry["id"]
        await asyncio.to_thread(store.append_chunks, entry["id"], {"prompt": store.encode({"messages": messages, "tools": schemas or []})})
        self.tokens += context_tokens
        try:
            result = await self.model_call(self.cfg, self.snapshot["model"], messages, schemas,
                                           output_limit,
                                           self.emit, response_format=REVIEW_SCHEMA if review else None)
            await self.flush()
            thinking = await asyncio.to_thread(store.entry_text, entry["id"], "reasoning") if not result.tokens else ""
            self.tokens += (result.tokens - context_tokens) if result.tokens else await asyncio.to_thread(count_text_tokens, result.content + store.encode(result.calls) + thinking, self.snapshot["model"])
            details = {"usage": result.usage, "finish_reason": result.finish_reason}
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
            if isinstance(exc, llm.PartialResponseError) and exc.result.tokens:
                self.tokens += exc.result.tokens - context_tokens
            else:
                self.tokens += await asyncio.to_thread(count_text_tokens, partial, self.snapshot["model"])
            if isinstance(exc, asyncio.CancelledError):
                status, code, message = self.cancel_reason
                details = {"error_code": code, "error": message}
            else:
                details = llm.error_details(exc)
                status = "failed" if details["error_code"] in {"empty_response", "model_finish_error"} else "interrupted"
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
                self.snapshot["config"] = self.config
                self.snapshot["revision"] += 1
                self.messages[0] = {"role": "system", "content": self.config["behavior"]}
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
        material = "\n\n".join(f'<material id="{m["id"]}" name={json.dumps(m["name"], ensure_ascii=False)}>\n{m["content"]}\n</material>' for m in rows)
        template = self.config["prompt"]
        if args.get("teaching_tool"):
            template = self.config.get("teaching_tools", {}).get(args["teaching_tool"])
            if template is None:
                raise ValueError("此教学工具未在本任务中启用")
        values = {**DEFAULT_VARIABLES, "user_input": material}
        prompt = re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m[1], m[0]), template)
        if "{{user_input}}" not in template:
            prompt += "\n\n" + material
        base = args.get("base_version") or self.snapshot.get("base_version") or ""
        if base:
            previous = await asyncio.to_thread(tools.document, self.task_id, base)
            prompt += "\n\n<previous_version>\n" + previous["content"] + "\n</previous_version>"
        prompt += "\n\n本次目标：" + self.config["goal"] + "\n本次修改或生成要求：" + args["instruction"]
        messages = [{"role": "system", "content": self.config["behavior"]}, {"role": "user", "content": prompt}]
        content, complete, last_entry = "", False, ""
        # 有限续写，单纯触及输出上限不能变成成功或从头重写。
        for part in range(4):
            try:
                result, last_entry = await self.call(args["title"] + (f" · 续写 {part}" if part else ""), messages)
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
                      "materials": selected, "teaching_tool": args.get("teaching_tool", ""), "config_revision": self.snapshot["revision"]}
        version = await asyncio.to_thread(store.save_version, self.task_id, self.id, key, args["title"], content, base, "agent", complete, provenance)
        self.created_versions.append(version["id"])
        return {**version, "entry_id": last_entry}

    async def tool_call(self, call):
        name, raw = call["function"]["name"], call["function"]["arguments"]
        key = "tool:" + call["id"]
        entry = await asyncio.to_thread(store.start_entry, self.task_id, self.id, key, "tool", name)
        if entry["status"] == "done":
            full = await asyncio.to_thread(store.entry_text, entry["id"], "output")
            return self.result_view(full, entry["id"])
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
            elif name == "patch_document":
                base = await asyncio.to_thread(tools.document, self.task_id, args["version_id"])
                old = args["old"]
                if not old or base["content"].count(old) != 1:
                    raise ValueError("原文不能唯一定位，未修改；请提供更完整且逐字一致的片段")
                content = base["content"].replace(old, args["new"], 1)
                result = await asyncio.to_thread(store.save_version, self.task_id, self.id, key,
                                                 base["title"], content, base["id"], "agent", base["complete"])
                self.created_versions.append(result["id"])
            elif name == "ask_user":
                await asyncio.to_thread(store.append_chunks, entry["id"], {"output": args["question"]})
                await asyncio.to_thread(store.finish_entry, entry["id"], "waiting", {"question": args["question"]})
                raise WaitingForUser()
            else:
                result = await tools.execute_readonly(self.task_id, self.config, name, args)
            full = store.encode(result)
            await asyncio.to_thread(store.finish_tool, entry["id"], result)
            # 完整结果另存，模型收到有明确范围说明的结果视图。
            return self.result_view(full, entry["id"])
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
                   "instruction": self.snapshot.get("instruction", ""), "materials": rows, "draft": version,
                   "generation_requirements": version["provenance"]}
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
            return data
        except Exception:
            # 原始审阅全文保留供阅读，无法解析不能误报通过。
            await asyncio.to_thread(store.finish_entry, entry_id, "failed", {"error": "审阅格式无法解析，原文可在详情查看", "version_id": version_id})
            if self.run["mode"] == "review":
                raise ValueError("审阅格式无法解析，未得出审阅结论") from None
            return None

    def compact(self):
        # 只删除完整的 assistant/tool 组。完整原始调用保存在步骤指令与输出中。
        if count_text_tokens(store.encode(self.messages), self.snapshot["model"]) < 50000:
            return
        tail = self.messages[2:]
        groups = []
        for message in tail:
            if message["role"] == "assistant" or message["role"] == "user" or not groups:
                groups.append([])
            groups[-1].append(message)
        if len(groups) > 8:
            summary = "较早执行记录已外化到步骤详情。已产生的成果版本：" + ", ".join(self.created_versions)
            # 用户补充保持全文，避免压掉新要求。
            notes = [m for group in groups[:-8] for m in group if m["role"] == "user"]
            self.messages = self.messages[:2] + notes + [{"role": "user", "content": summary}] + [m for group in groups[-8:] for m in group]

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
            for index in range(len(self.messages)-1, -1, -1):
                message = self.messages[index]
                if message["role"] == "assistant":
                    completed = {m.get("tool_call_id") for m in self.messages[index+1:] if m["role"] == "tool"}
                    pending = [c for c in message.get("tool_calls", []) if c["id"] not in completed]
                    break
            if pending:
                for call in pending:
                    result = await self.tool_call(call)
                    self.messages.append({"role": "tool", "tool_call_id": call["id"], "content": store.encode(result)})
                    await self.checkpoint()
                continue
            if self.step >= self.limits["max_steps"]:
                raise BudgetReached("已达到本轮步骤上限，已有成果保留，可继续执行")
            await self.notes()
            self.compact()
            result, entry_id = await self.call(f"执行步骤 {self.step+1}", self.messages, tools.tool_schemas(self.config))
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
            if self.config.get("review") and self.created_versions:
                version_id = self.created_versions[-1]
                for review_no in range(self.config.get("review_rounds", 1)):
                    review = await self.review(version_id)
                    if not review or not review["issues"] or not self.config.get("auto_improve"):
                        break
                    confirmed = [i for i in review["issues"] if i["certainty"] == "confirmed"]
                    if not confirmed:
                        break
                    version = await self.create_document({"title": "候选修订", "instruction": "先核实以下意见，只有材料支持时才修改；保留其他内容：\n"+store.encode(confirmed),
                                                          "material_ids": self.config["materials"], "base_version": version_id}, f"improve:{review_no}")
                    version_id = version["id"]
                if self.config.get("auto_improve") and version_id != self.created_versions[0]:
                    await self.review(version_id)
                await self.checkpoint()
            if await asyncio.to_thread(store.take_notes, self.id):
                await self.notes()
                continue
            return


async def execute_run(run_id, model_call=None):
    runner = Runner(run_id, model_call)
    run = await asyncio.to_thread(store.load_run, run_id)
    if run["stop"]:
        await asyncio.to_thread(store.finish_run, run_id, "stopped")
        return
    job = asyncio.create_task(runner.execute())
    try:
        elapsed = (utcnow() - run["started_at"]).total_seconds() if run["started_at"] else 0
        deadline = time.monotonic() + run["snapshot"]["limits"]["max_seconds"] - elapsed
        while not job.done():
            if await asyncio.to_thread(store.heartbeat, run_id):
                runner.cancel_reason = ("stopped", "user_stop", "用户已停止本轮执行，已收到的内容已保存")
                job.cancel()
                with suppress(asyncio.CancelledError):
                    await job
                await asyncio.to_thread(store.finish_run, run_id, "stopped")
                return
            if time.monotonic() >= deadline:
                runner.cancel_reason = ("incomplete", "time_limit", "达到本轮时长上限，已收到的内容已保存")
                job.cancel()
                with suppress(asyncio.CancelledError):
                    await job
                raise BudgetReached("达到本轮时长上限，已有内容已保存")
            await asyncio.wait({job}, timeout=0.75)
        await job
        await asyncio.to_thread(store.finish_run, run_id, "completed")
    except WaitingForUser:
        await asyncio.to_thread(store.finish_run, run_id, "waiting")
    except BudgetReached as exc:
        await asyncio.to_thread(store.finish_run, run_id, "incomplete", str(exc))
    except asyncio.CancelledError:
        runner.cancel_reason = ("interrupted", "worker_shutdown", "后台工作进程停止，本轮将重新排队；当前步骤可能需要重新执行")
        job.cancel()
        with suppress(asyncio.CancelledError):
            await job
        await asyncio.to_thread(store.requeue_run, run_id)
        raise
    except Exception as exc:
        log.exception("Agent 工作台执行失败 run=%s", run_id)
        await asyncio.to_thread(store.finish_run, run_id, "failed", sanitize_error_text(str(exc))[:500])


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
