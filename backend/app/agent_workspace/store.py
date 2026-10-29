"""短事务存储。过程正文只追加；轮询事件不包含大段正文。"""
import json
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, update, func, or_

from app.database import SessionLocal
from app.models import UsageCode, UsageLog, utcnow
from app.services.free_access import AGENT_TOOL_ID
from .models import (WorkspaceTask as Task, WorkspaceRun as Run, WorkspaceEntry as Entry,
                     WorkspaceChunk as Chunk, WorkspaceEvent as Event, WorkspaceMaterial as Material,
                     WorkspaceVersion as Version, WorkspaceNote as Note)

ACTIVE = {"queued", "running", "stopping"}


def uid():
    return uuid.uuid4().hex


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def decode(value):
    return json.loads(value)


def owned(db, task_id, owner):
    row = db.get(Task, task_id)
    if not row or row.owner != owner:
        raise HTTPException(404, "任务不存在")
    return row


def event(db, task_id, kind, data):
    db.add(Event(task_id=task_id, kind=kind, data=encode(data)))


def task_dict(row, full=False):
    value = {"id": row.id, "title": row.title, "revision": row.revision, "status": row.status,
             "active_run": row.active_run, "adopted_version": row.adopted_version,
             "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat()}
    if full:
        value["config"] = decode(row.config)
    return value


def entry_dict(row):
    return {"id": row.id, "run_id": row.run_id, "kind": row.kind, "label": row.label,
            "status": row.status, "details": decode(row.details), "created_at": row.created_at.isoformat()}


def version_dict(row, full=False):
    value = {"id": row.id, "run_id": row.run_id, "parent_id": row.parent_id, "title": row.title,
             "origin": row.origin, "complete": row.complete, "chars": len(row.content),
             "created_at": row.created_at.isoformat()}
    if full:
        value["content"] = row.content
        value["provenance"] = decode(row.provenance or "{}")
    return value


def material_dict(row, full=False):
    value = {"id": row.id, "name": row.name, "chars": len(row.content), "has_original": bool(row.original)}
    if full:
        value["content"] = row.content
    return value


def run_dict(row, full=False, with_instruction=False):
    value = {"id": row.id, "status": row.status, "mode": row.mode, "step": row.step,
             "tokens": row.tokens, "error": row.error, "created_at": row.created_at.isoformat(),
             "finished_at": row.finished_at.isoformat() if row.finished_at else None}
    if full:
        value["snapshot"] = decode(row.snapshot)
    elif with_instruction:
        # 只给需要展示的少数轮次解码快照；普通轮次的事件不读大配置。
        snapshot = decode(row.snapshot)
        value["instruction"] = snapshot.get("instruction", "")
        value["base_version"] = snapshot.get("base_version", "")
    return value


INSTRUCTION_MODES = {"continue", "review", "revise", "tool_test"}


def _run_row(row):
    """任务详情里的轮次列表项：只有少数模式需要展示当轮指令。"""
    value = {"id": row["id"], "status": row["status"], "mode": row["mode"], "step": row["step"],
             "tokens": row["tokens"], "error": row["error"], "created_at": row["created_at"].isoformat(),
             "finished_at": row["finished_at"].isoformat() if row["finished_at"] else None}
    usage = row["usage"]
    if usage:
        try:
            value["usage"] = decode(usage)
        except (TypeError, ValueError):
            pass
    if row["mode"] in INSTRUCTION_MODES:
        value["instruction"] = row["instruction"] or ""
        value["base_version"] = row["base_version"] or ""
    return value


def task_detail(owner, task_id):
    with SessionLocal() as db:
        row = owned(db, task_id, owner)
        value = task_dict(row, True)
        value["materials"] = [dict(m) for m in db.execute(select(Material.id, Material.name,
            func.length(Material.content).label("chars"), Material.original.is_not(None).label("has_original"))
            .where(Material.task_id == task_id)).mappings()]
        value["versions"] = [{**dict(v), "created_at": v["created_at"].isoformat()} for v in db.execute(select(
            Version.id, Version.run_id, Version.parent_id, Version.title, Version.origin, Version.complete,
            func.length(Version.content).label("chars"), Version.created_at)
            .where(Version.task_id == task_id).order_by(Version.created_at)).mappings()]
        # 快照整份是配置与官方提示词全文：只用 json_extract 取需要的两个字段，
        # 避免每个轮次再懒加载一次 snapshot（长任务上线性变慢）。
        value["runs"] = [_run_row(dict(r)) for r in db.execute(select(
            Run.id, Run.status, Run.mode, Run.step, Run.tokens, Run.error, Run.created_at, Run.finished_at,
            func.json_extract(Run.snapshot, "$.instruction").label("instruction"),
            func.json_extract(Run.snapshot, "$.base_version").label("base_version"),
            func.json_extract(Run.snapshot, "$.usage").label("usage"),
        ).where(Run.task_id == task_id).order_by(Run.created_at)).mappings()]
        # 对话恢复需要补充要求；过程正文仍不进入任务详情。
        value["notes"] = [{"id": r.id, "run_id": r.run_id, "text": r.text,
                           "applied": bool(r.applied), "config": bool(r.config)}
                          for r in db.scalars(select(Note).where(Note.task_id == task_id).order_by(Note.id))]
        return value


def update_task(owner, task_id, revision, config, title=None):
    with SessionLocal() as db:
        row = owned(db, task_id, owner)
        ids = config.get("materials", [])
        valid = set(db.scalars(select(Material.id).where(Material.task_id == task_id)))
        if not set(ids) <= valid:
            raise HTTPException(400, "材料不属于此任务")
        values = {"config": encode(config), "revision": revision + 1, "updated_at": utcnow()}
        # 自动标题可能比页面轮询更早完成：旧页面回传未修改的“新任务”时保留已生成的标题。
        if title is not None and not (title == "新任务" and row.title != "新任务"):
            values["title"] = title
        result = db.execute(update(Task).where(Task.id == task_id, Task.revision == revision).values(**values))
        if result.rowcount != 1:
            raise HTTPException(409, "任务已在其他窗口更新，你的修改仍保留，请比较后保存")
        event(db, task_id, "config", {"revision": revision + 1})
        db.commit()
    return task_detail(owner, task_id)


def create_run(owner, task_id, key, mode, instruction, base_version, snapshot, paid, model_entry=None):
    with SessionLocal() as db:
        # SQLite 写锁串行化同任务创建与扣费；幂等请求在扣费之前返回。
        db.execute(update(Task).where(Task.id == task_id, Task.owner == owner).values(updated_at=Task.updated_at))
        task = owned(db, task_id, owner)
        old = db.scalar(select(Run).where(Run.task_id == task_id, Run.request_key == key))
        if old:
            old_snapshot = decode(old.snapshot)
            if old.mode != mode or old_snapshot.get("instruction") != instruction or old_snapshot.get("base_version") != base_version or old_snapshot.get("teaching_tool", "") != snapshot.get("teaching_tool", ""):
                raise HTTPException(409, "请求编号已用于其他执行")
            return run_dict(old)
        if snapshot.get("expected_revision", task.revision) != task.revision:
            raise HTTPException(409, "任务配置刚刚变更，请重新确认后开始")
        if task.status in ACTIVE:
            raise HTTPException(409, "此任务已有执行中的步骤，请补充要求或先停止")
        active_count = db.scalar(select(func.count()).select_from(Run).join(Task, Run.task_id == Task.id).where(Task.owner == owner, Run.status.in_(ACTIVE)))
        if active_count >= 2:
            raise HTTPException(429, "同时最多执行两个任务")
        if not paid:
            # Agent 免费模型用自己的一套限额：按「执行轮次」计数，且只统计工作台的行。
            # 主站的 free_limits 按模型调用计次、窗口更紧（常有分钟级），直接套过来会让
            # 一次正常的多轮任务几乎每步都撞 429；两个池子分开后主站额度也不会被轮次吃掉。
            from app.services.free_access import (
                FREE_LIMIT_WINDOWS, _counted_status_clause, agent_free_limits_of,
            )
            for window, limit in agent_free_limits_of(model_entry).items():
                if not limit:
                    continue
                label, seconds = FREE_LIMIT_WINDOWS[window]
                used = db.scalar(select(func.count()).select_from(UsageLog).where(
                    UsageLog.code_id == owner, UsageLog.model == snapshot["model"],
                    UsageLog.tool_id == AGENT_TOOL_ID,
                    UsageLog.created_at >= utcnow()-timedelta(seconds=seconds), _counted_status_clause()))
                if used >= limit:
                    raise HTTPException(429, f"免费模型在 Agent 工作台{label}最多执行 {limit} 轮，请稍后再试")
        # 任务级 Provider 粘性：沿用上一轮实际成功的那一家，缓存和行为都不重开一局。
        last_run = db.scalar(select(Run).where(Run.task_id == task_id).order_by(Run.created_at.desc()).limit(1))
        preferred = ""
        if last_run is not None:
            last_snapshot = decode(last_run.snapshot)
            preferred = last_snapshot.get("provider") or last_snapshot.get("preferred_provider") or ""
        snapshot = {**snapshot, "config": decode(task.config), "revision": task.revision,
                    "instruction": instruction, "base_version": base_version,
                    "preferred_provider": preferred}
        if base_version:
            version = db.get(Version, base_version)
            if not version or version.task_id != task_id:
                raise HTTPException(404, "成果版本不存在")
        if paid:
            result = db.execute(update(UsageCode).where(UsageCode.id == owner, UsageCode.is_enabled.is_(True),
                (UsageCode.quota < 0) | (UsageCode.used_count < UsageCode.quota))
                .values(used_count=UsageCode.used_count + 1))
            if result.rowcount != 1:
                raise HTTPException(403, "额度不足，无法开始新一轮；已有成果仍可查看")
        run = Run(id=uid(), task_id=task_id, request_key=key, mode=mode, snapshot=encode(snapshot), charged=paid)
        db.add(run)
        code = db.get(UsageCode, owner)
        # 预留限额与入队在同一事务中，跨进程/重启均不能绕过。
        db.add(UsageLog(code_id=owner, code=code.code, tool_id=AGENT_TOOL_ID, tool_name="Agent 工作台",
                        model=snapshot["model"], request_id=run.id, status="running", units=1 if paid else 0,
                        counts_for_free_limit=not paid))
        task.active_run, task.status, task.updated_at = run.id, "queued", utcnow()
        db.flush()
        event(db, task_id, "run", run_dict(run))
        db.commit()
        return run_dict(run)


def find_entry(run_id, key):
    """只查不建：用于沿用在升级前用旧幂等键落库的步骤，避免重启后重复执行。"""
    with SessionLocal() as db:
        row = db.scalar(select(Entry).where(Entry.run_id == run_id, Entry.key == key))
        return entry_dict(row) if row else None


def start_entry(task_id, run_id, key, kind, label, details=None):
    with SessionLocal() as db:
        row = db.scalar(select(Entry).where(Entry.run_id == run_id, Entry.key == key))
        if row:
            return entry_dict(row)
        row = Entry(id=uid(), task_id=task_id, run_id=run_id, key=key, kind=kind,
                    label=label[:300], details=encode(details or {}))
        db.add(row)
        db.flush()
        event(db, task_id, "entry", entry_dict(row))
        db.commit()
        return entry_dict(row)


def append_chunks(entry_id, parts, extra=None):
    with SessionLocal() as db:
        row = db.get(Entry, entry_id)
        details = decode(row.details)
        counts = details.setdefault("chars", {})
        for kind, content in parts.items():
            if not content:
                continue
            # 单行也要分块，避免单条无限长的 SSE/JSON/DOM 文本节点。
            for offset in range(0, len(content), 4096):
                db.add(Chunk(entry_id=entry_id, kind=kind, content=content[offset:offset + 4096]))
            counts[kind] = counts.get(kind, 0) + len(content)
        details.update(extra or {})
        row.details = encode(details)
        event(db, row.task_id, "entry", entry_dict(row))
        db.commit()


def finish_entry(entry_id, status="done", details=None):
    with SessionLocal() as db:
        row = db.get(Entry, entry_id)
        row.status = status
        row.details = encode({**decode(row.details), **(details or {})})
        event(db, row.task_id, "entry", entry_dict(row))
        db.commit()


def finish_tool(entry_id, result):
    # 返回内容与 done 状态一次提交，避免崩溃重放时拼接两个 JSON 文档。
    with SessionLocal() as db:
        row = db.get(Entry, entry_id)
        if row.status == "done":
            return
        full = encode(result)
        for offset in range(0, len(full), 4096):
            db.add(Chunk(entry_id=entry_id, kind="output", content=full[offset:offset+4096]))
        details = decode(row.details)
        details.setdefault("chars", {})["output"] = len(full)
        row.details, row.status = encode(details), "done"
        event(db, row.task_id, "entry", entry_dict(row))
        db.commit()


def answer_question(entry_id, answer):
    """回答等待中的提问：写入回答、结束提问条目和旧轮，返回更新后的条目。"""
    with SessionLocal() as db:
        row = db.get(Entry, entry_id)
        if not row or row.label != "ask_user":
            raise HTTPException(404, "提问不存在")
        details = decode(row.details)
        run = db.get(Run, row.run_id)
        if row.status == "done":
            return entry_dict(row)
        if row.status != "waiting" or not run or run.status != "waiting":
            raise HTTPException(409, "这个问题已不再等待回答")
        payload = encode({"question": details.get("question", ""), "answer": answer})
        for offset in range(0, len(payload), 4096):
            db.add(Chunk(entry_id=entry_id, kind="output", content=payload[offset:offset + 4096]))
        details["answer"] = answer
        details["answered_at"] = utcnow().isoformat()
        details.setdefault("chars", {})["output"] = len(payload)
        row.details, row.status = encode(details), "done"
        run.status, run.error, run.finished_at, run.lease = "completed", "", utcnow(), None
        event(db, row.task_id, "entry", entry_dict(row))
        event(db, row.task_id, "run", run_dict(run))
        db.commit()
        return entry_dict(row)


def conversation_history(task_id, current_run):
    with SessionLocal() as db:
        runs = db.scalars(select(Run).where(Run.task_id == task_id, Run.id != current_run).order_by(Run.created_at)).all()
        history = []
        for run in runs:
            snapshot = decode(run.snapshot)
            if snapshot.get("instruction"):
                history.append({"role": "user", "content": snapshot["instruction"]})
            for note in db.scalars(select(Note).where(Note.run_id == run.id).order_by(Note.id)):
                if note.text:
                    history.append({"role": "user", "content": note.text})
            # 恢复上一轮最后的说明/询问。旧工具上下文按材料、成果、步骤记录读取。
            messages = decode(run.messages)
            final = next((m.get("content") for m in reversed(messages) if m["role"] == "assistant" and m.get("content")), "")
            if final:
                history.append({"role": "assistant", "content": final})
            for entry in db.scalars(select(Entry).where(Entry.run_id == run.id, Entry.status == "waiting")):
                question = decode(entry.details).get("question")
                if question:
                    history.append({"role": "assistant", "content": question})
        return history


def entry_text(entry_id, kind):
    with SessionLocal() as db:
        return "".join(db.scalars(select(Chunk.content).where(Chunk.entry_id == entry_id, Chunk.kind == kind).order_by(Chunk.id)))


def review_data(task_id, entry_id):
    """已完成审阅的意见与用户忽略的序号（从 0 起）。不属于本任务、未完成或无法解析时报错。"""
    with SessionLocal() as db:
        row = db.get(Entry, entry_id)
        if not row or row.task_id != task_id or row.kind != "review":
            raise ValueError("审阅记录不存在或不属于本任务")
        if row.status != "done":
            raise ValueError("该审阅没有得出完整结论，不能引用其中的意见")
        details = decode(row.details)
        text = "".join(db.scalars(select(Chunk.content).where(Chunk.entry_id == entry_id, Chunk.kind == "review").order_by(Chunk.id)))
    try:
        data = decode(text)
        issues = data["issues"]
    except (ValueError, KeyError, TypeError):
        raise ValueError("审阅意见无法读取") from None
    return {"summary": data.get("summary", ""), "issues": issues, "version_id": details.get("version_id", ""),
            "ignored": set(details.get("ignored", []))}


def save_version(task_id, run_id, key, title, content, parent_id="", origin="agent", complete=True, provenance=None):
    with SessionLocal() as db:
        # 幂等工具写入；重复执行不产生多个相同版本。
        db.execute(update(Task).where(Task.id == task_id).values(updated_at=Task.updated_at))
        old = db.scalar(select(Version).where(Version.task_id == task_id, Version.key == key))
        if old:
            return version_dict(old)
        if parent_id:
            parent = db.get(Version, parent_id)
            if not parent or parent.task_id != task_id:
                raise ValueError("基准版本不属于此任务")
            if provenance is None:
                provenance = decode(parent.provenance or "{}")
        row = Version(id=uid(), task_id=task_id, run_id=run_id, key=key, title=title[:200],
                      content=content, parent_id=parent_id, origin=origin, complete=complete, provenance=encode(provenance or {}))
        db.add(row)
        db.flush()
        task = db.get(Task, task_id)
        if not task.adopted_version and complete:
            task.adopted_version = row.id
        task.updated_at = utcnow()
        event(db, task_id, "version", version_dict(row))
        db.commit()
        return version_dict(row)


def checkpoint(run_id, messages, step, tokens, snapshot=None):
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        row.messages, row.step, row.tokens = encode(messages), step, tokens
        if snapshot is not None:
            row.snapshot = encode(snapshot)
        row.lease = utcnow() + timedelta(seconds=90)
        event(db, row.task_id, "run", run_dict(row))
        db.commit()


def take_notes(run_id):
    with SessionLocal() as db:
        rows = db.scalars(select(Note).where(Note.run_id == run_id, Note.applied.is_(False)).order_by(Note.id)).all()
        return [{"id": r.id, "text": r.text, "config": decode(r.config) if r.config else None} for r in rows]


def apply_notes(run_id, notes, snapshot, messages):
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        run.snapshot, run.messages = encode(snapshot), encode(messages)
        for note in notes:
            row = db.get(Note, note["id"])
            row.applied = True
            event(db, run.task_id, "note", {"id": row.id, "run_id": row.run_id, "text": row.text, "applied": True})
        db.commit()


def load_run(run_id):
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        task = db.get(Task, row.task_id)
        return {**run_dict(row, True), "task_id": row.task_id, "owner": task.owner,
                "started_at": row.started_at,
                "messages": decode(row.messages), "stop": row.stop,
                "versions": list(db.scalars(select(Version.id).where(Version.run_id == run_id).order_by(Version.created_at)))}


def heartbeat(run_id):
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        if not row:
            return True
        row.lease = utcnow() + timedelta(seconds=90)
        stop = row.stop
        db.commit()
        return stop


def take_compact_request(run_id):
    """消费一次「立即压缩上下文」的请求；没有请求时返回 False。"""
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        if not row or not row.compact_requested:
            return False
        row.compact_requested = False
        db.commit()
        return True


def stop_requested(run_id):
    """只读检查停止标记，用于覆盖「接口已提交、运行任务还没注册」的窗口。"""
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        return bool(row and row.stop)


def claim_run():
    with SessionLocal() as db:
        row = db.scalar(select(Run).where(Run.status == "queued").order_by(Run.created_at).limit(1))
        if not row:
            return None
        result = db.execute(update(Run).where(Run.id == row.id, Run.status == "queued")
                            # 每次领取都重开墙钟预算：崩溃/重启后恢复的轮次沿用旧的 started_at
                            # 会让 max_seconds 立刻为负，一次模型调用都发不出去。
                            .values(status="running", started_at=utcnow(), lease=utcnow() + timedelta(seconds=90)))
        if result.rowcount != 1:
            db.rollback()
            return None
        task = db.get(Task, row.task_id)
        task.status = "running"
        db.refresh(row)
        event(db, task.id, "run", run_dict(row))
        db.commit()
        return row.id


def recover_runs():
    stopped = []
    with SessionLocal() as db:
        # 排队中就被停止的轮次没有 lease（NULL），而 SQL 里 `NULL < now` 恒为 NULL：
        # 只写 `Run.lease < utcnow()` 会让它们永远收不了尾，卡在"正在停止"。
        rows = db.scalars(select(Run).where(
            Run.status.in_({"running", "stopping"}),
            or_(Run.lease.is_(None), Run.lease < utcnow()))).all()
        for row in rows:
            if row.stop:
                # 用户已经要求停止：这是"停止的第二段提交失败"留下的孤儿，直接落终态，
                # 不能再排队（会重新跑起来），也不能留着不退额度。
                stopped.append(row.id)
                continue
            row.status, row.lease = "queued", None
            task = db.get(Task, row.task_id)
            if task is not None:
                task.status = "queued"
                event(db, task.id, "run", run_dict(row))
        db.commit()
    for run_id in stopped:
        finish_run(run_id, "stopped", "已按停止请求结束")


def _settle_log(db, run_id, status, error, *, units=None, tokens=None, created_at=None, usage=None):
    """把本轮在主站使用日志里的记录改成终态。

    `units`/`tokens` 为 None 时保持原值；`usage` 是原始 prompt/completion/cached
    （预算口径是"未命中 + 输出"，日志要能看出真实用量与缓存命中，两者分开记）。
    """
    log = db.scalar(select(UsageLog).where(UsageLog.request_id == run_id, UsageLog.tool_id == AGENT_TOOL_ID))
    if not log:
        return
    log.status = "error" if status == "failed" else "cancelled" if status == "stopped" else "success"
    log.error_message = error[:500]
    if usage:
        prompt = int(usage.get("prompt") or 0)
        completion = int(usage.get("completion") or 0)
        cached = int(usage.get("cached") or 0)
        if prompt or completion:
            log.prompt_tokens = prompt
            log.completion_tokens = completion
            log.total_tokens = prompt + completion
            # 只有上游真上报过命中才写；没上报时保持 NULL（"没上报"≠"没命中"）
            log.cached_tokens = cached if usage.get("cached_reported") else None
    elif tokens is not None:
        log.total_tokens = tokens
    if units is not None:
        log.units = units
    if status == "failed":
        log.counts_for_free_limit = False
    if created_at is not None:
        log.duration_ms = int((utcnow()-created_at).total_seconds()*1000)


def finish_run(run_id, status, error=""):
    with SessionLocal() as db:
        # 状态、退款与终态事件同一事务，重启后可重复调用。
        db.execute(update(Run).where(Run.id == run_id).values(step=Run.step))
        row = db.get(Run, run_id)
        if row is None:
            # 使用码被删除后任务与本轮会被级联清掉，但在途 worker 仍在收尾：
            # 只把主站计费记录改成终态，不写工作台事件（外键目标已经不存在）。
            _settle_log(db, run_id, status, error)
            db.commit()
            return
        if row.status not in ACTIVE:
            return
        if status == "completed" and db.scalar(select(Note.id).where(Note.run_id == run_id, Note.applied.is_(False)).limit(1)):
            status, error = "waiting", "本轮结束时收到新的补充要求，内容已保存，请继续执行"
        row.status, row.error, row.finished_at, row.lease = status, error[:1000], utcnow(), None
        task = db.get(Task, row.task_id)
        if task is None:
            # 任务被单独清理（级联未生效的老库）：同样只收尾计费记录。
            _settle_log(db, run_id, status, error, units=1 if row.charged else 0,
                        tokens=row.tokens, created_at=row.created_at, usage=decode(row.snapshot).get("usage"))
            db.commit()
            return
        task.status, task.active_run, task.updated_at = status, "", utcnow()
        # 未产出任何成果的失败/停止要退款；`incomplete` 里"一步都没走"的（恢复后预算已耗尽）
        # 同样退，否则用户被扣了一次却什么都没得到。
        refundable = status in {"failed", "stopped"} or (status == "incomplete" and not row.step)
        if row.charged and refundable:
            # 已经产出过版本的轮次不再退额度：否则"等成果落库再点停止"可以无限白嫖。
            delivered = db.scalar(select(Version.id).where(Version.run_id == run_id).limit(1))
            if not delivered:
                db.execute(update(UsageCode).where(UsageCode.id == task.owner, UsageCode.used_count > 0)
                           .values(used_count=UsageCode.used_count - 1))
                row.charged = False
        # 取消可能落在步骤创建与步骤 try 之间，留下 status=running 的步骤。
        # 终态时统一收尾，并把更新推给正在轮询的页面。
        for entry in db.scalars(select(Entry).where(Entry.run_id == run_id, Entry.status == "running")):
            details = decode(entry.details)
            details["error"] = details.get("error") or (
                "本轮已停止，步骤未完成" if status in {"stopped", "interrupted"}
                else "执行失败，步骤未完成" if status == "failed"
                else "执行结束，步骤未完成"
            )
            entry.status = "interrupted"
            entry.details = encode(details)
            event(db, task.id, "entry", entry_dict(entry))
        _settle_log(db, run_id, status, error, units=1 if row.charged else 0,
                    tokens=row.tokens, created_at=row.created_at, usage=decode(row.snapshot).get("usage"))
        event(db, task.id, "run", run_dict(row))
        db.commit()


def requeue_run(run_id):
    with SessionLocal() as db:
        row = db.get(Run, run_id)
        if row and row.status in ACTIVE:
            row.status, row.lease = "queued", None
            db.get(Task, row.task_id).status = "queued"
            db.commit()
