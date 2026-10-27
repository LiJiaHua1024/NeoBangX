import asyncio
import json
import logging
import time
from contextlib import suppress

from jsonschema import validate

from app.routers.chat import _load_cfg
from app.services.llm import count_text_tokens
from app.services.prompt_loader import DEFAULT_VARIABLES
from app.services.error_explain import sanitize_error_text
from app.models import utcnow
from . import store, tools, llm, writer
from .instructions import (DEFAULT_EXECUTION_REQUEST, REVIEW_FEEDBACK, REVIEW_POLICY, REVIEW_SCHEMA,
                           REVISION_RETRY, WRITER_SYSTEM, behavior_of)
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
            self.messages = [{"role": "system", "content": behavior_of(self.config)},
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
                self.messages[0] = {"role": "system", "content": behavior_of(self.config)}
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
        title = (args.get("title") or version["title"] + " · 修订")[:200]
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
                    result, last_entry = await self.call(f"修订 · {title}" + (f" · 重试 {attempt}" if attempt else ""), messages)
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
            elif name == "revise_document":
                result = await self.revise_document(args, key)
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
