"""管理后台「Agent 运行全解」：把一轮执行还原成可逐步播放的步骤序列。

只读、无副作用，供管理端日志详情调用。两点刻意的取舍：

- 不返回 run.snapshot 全文（里面还有任务配置与官方模板，体积大且与本次复盘无关），
  只挑模型、预算、Provider、用量这些能解释「这一轮怎么跑的」字段。
- 正文（尤其是每一步完整上下文，可达 1 MB）不塞进报告，按页从
  workspace_chunks 读：管理页面只渲染当前页，切步即丢弃。
"""
from __future__ import annotations

from sqlalchemy import func, select

from app.models import Device, utcnow
from app.services.free_access import AGENT_TOOL_ID

from .models import (
    WorkspaceChunk as Chunk,
    WorkspaceEntry as Entry,
    WorkspaceRun as Run,
    WorkspaceTask as Task,
    WorkspaceVersion as Version,
)
from .store import decode

# 步骤正文的种类（与 runner / store 写入的 chunk kind 一一对应）。
TEXT_KINDS = ("prompt", "input", "output", "reasoning", "arguments", "review")
# 单次最多返回的字符数：约 128K 字，足以一次给完整段输出，又不至于把页面拖死。
TEXT_PAGE_MAX = 131072
TEXT_PAGE_DEFAULT = 16384


class ReportNotFound(LookupError):
    """日志 / 运行记录 / 步骤不存在。"""


class ReportUnavailable(ValueError):
    """这条日志不是 Agent 轮次，或请求的正文种类不合法。"""


def _json(value):
    try:
        data = decode(value) if value else {}
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _iso(value):
    return value.isoformat() if value else None


def _sizes(db, entry_ids):
    """算出所有步骤各类正文的字数（不信 details.chars：它可能滞后）。

    按 900 个 ID 一批：SQLite 的绑定变量有上限，异常长的旧轮次也不能在这里炸。
    """
    sizes: dict[str, dict[str, int]] = {}
    ids = list(entry_ids)
    for start in range(0, len(ids), 900):
        rows = db.execute(
            select(Chunk.entry_id, Chunk.kind, func.sum(func.length(Chunk.content)))
            .where(Chunk.entry_id.in_(ids[start:start + 900]))
            .group_by(Chunk.entry_id, Chunk.kind)
        ).all()
        for entry_id, kind, total in rows:
            if not kind:
                continue
            sizes.setdefault(entry_id, {})[kind] = int(total or 0)
    return sizes


def _run_versions(db, run_id):
    rows = db.execute(
        select(Version.id, Version.title, func.length(Version.content), Version.complete, Version.origin)
        .where(Version.run_id == run_id)
        .order_by(Version.created_at)
    ).all()
    return [{"id": row[0], "title": row[1], "chars": int(row[2] or 0),
             "complete": bool(row[3]), "origin": row[4]} for row in rows]


def _base_version(db, version_id):
    if not version_id:
        return None
    row = db.execute(
        select(Version.id, Version.title, func.length(Version.content)).where(Version.id == version_id)
    ).first()
    return {"id": row[0], "title": row[1], "chars": int(row[2] or 0)} if row else None


def _task_goal(task):
    config = _json(task.config) if task is not None else {}
    return str(config.get("goal") or "")[:4000]


def _entries(db, run):
    rows = db.scalars(
        select(Entry).where(Entry.run_id == run.id).order_by(Entry.created_at, Entry.id)
    ).all()
    sizes = _sizes(db, [row.id for row in rows])
    entries = []
    summary = {"entries": 0, "model_calls": 0, "tool_calls": 0, "reviews": 0,
               "compactions": 0, "waiting": 0, "text_chars": 0}
    for row in rows:
        details = _json(row.details)
        offset_ms = max(0, int((row.created_at - run.created_at).total_seconds() * 1000)) if run.created_at else 0
        entry_sizes = sizes.get(row.id, {})
        summary["entries"] += 1
        summary["text_chars"] += sum(entry_sizes.values())
        if row.kind == "model":
            summary["model_calls"] += 1
        elif row.kind == "review":
            summary["reviews"] += 1
        elif row.kind == "tool":
            summary["tool_calls"] += 1
        elif row.kind == "compaction":
            summary["compactions"] += 1
        if row.status == "waiting":
            summary["waiting"] += 1
        entries.append({
            "id": row.id,
            "kind": row.kind,
            "label": row.label,
            "status": row.status,
            "created_at": _iso(row.created_at),
            "offset_ms": offset_ms,
            "details": details,
            "text_sizes": entry_sizes,
        })
    return entries, summary


def run_report(db, log):
    """一条 Agent 使用日志对应的完整复盘；运行记录已被级联清掉时返回 None。"""
    if not log.request_id:
        return None
    run = db.get(Run, log.request_id)
    if run is None:
        return None
    task = db.get(Task, run.task_id)
    snapshot = _json(run.snapshot)
    limits = snapshot.get("limits") if isinstance(snapshot.get("limits"), dict) else {}
    usage = snapshot.get("usage") if isinstance(snapshot.get("usage"), dict) else {}
    switches = snapshot.get("switches") if isinstance(snapshot.get("switches"), list) else []
    entries, summary = _entries(db, run)
    device = db.get(Device, log.device_id) if log.device_id else None
    if run.finished_at is not None:
        duration_ms = int((run.finished_at - run.created_at).total_seconds() * 1000)
    else:
        duration_ms = int((utcnow() - run.created_at).total_seconds() * 1000)
    return {
        "log": log.to_dict(),
        "device": device.to_dict() if device is not None else None,
        "task": {
            "id": task.id if task is not None else "",
            "title": task.title if task is not None else "",
            "goal": _task_goal(task),
        },
        "run": {
            "id": run.id,
            "mode": run.mode,
            "status": run.status,
            "step": int(run.step or 0),
            "tokens": int(run.tokens or 0),
            "error": run.error or "",
            "created_at": _iso(run.created_at),
            "started_at": _iso(run.started_at),
            "finished_at": _iso(run.finished_at),
            "duration_ms": max(0, duration_ms),
            "live": run.finished_at is None,
            "model": snapshot.get("model") or "",
            "provider": snapshot.get("provider") or snapshot.get("preferred_provider") or "",
            "preferred_provider": snapshot.get("preferred_provider") or "",
            "switches": switches,
            "instruction": snapshot.get("instruction") or "",
            "base_version": _base_version(db, snapshot.get("base_version")),
            "usage": {
                "prompt": int(usage.get("prompt") or 0),
                "cached": int(usage.get("cached") or 0),
                "completion": int(usage.get("completion") or 0),
                "cached_reported": bool(usage.get("cached_reported")),
            },
            "limits": {key: limits.get(key) for key in (
                "max_tokens", "max_steps", "output_tokens", "max_seconds",
                "context_budget", "keep_tail_steps") if limits.get(key) is not None},
            "versions": _run_versions(db, run.id),
        },
        "summary": summary,
        "entries": entries,
    }


def resolve_log(db, log_id):
    from app.models import UsageLog

    row = db.get(UsageLog, log_id)
    if row is None:
        raise ReportNotFound("日志不存在")
    if row.tool_id != AGENT_TOOL_ID:
        raise ReportUnavailable("这条日志不是 Agent 工作台轮次")
    return row


def _entry(db, log, entry_id):
    row = db.get(Entry, entry_id)
    if row is None or row.run_id != log.request_id:
        raise ReportNotFound("步骤不存在或不属于本轮")
    return row


def resolve_entry(db, log_id, entry_id):
    log = resolve_log(db, log_id)
    return log, _entry(db, log, entry_id)


def text_page(db, entry, kind, offset=0, limit=TEXT_PAGE_DEFAULT):
    """读取某一步某类正文的一页；该步骤没有这类正文时返回 None。"""
    if kind not in TEXT_KINDS:
        raise ReportUnavailable("不支持的正文类型")
    total = db.scalar(
        select(func.coalesce(func.sum(func.length(Chunk.content)), 0))
        .where(Chunk.entry_id == entry.id, Chunk.kind == kind)
    )
    total = int(total or 0)
    if total <= 0:
        return None
    limit = max(1, min(int(limit or TEXT_PAGE_DEFAULT), TEXT_PAGE_MAX))
    offset = max(0, min(int(offset or 0), total))
    # 先只读长度定位起始块，再加载覆盖本页的少量块：整段上下文可能有
    # 数百块，没必要每翻一页都把它们全部读进内存。
    rows = db.execute(
        select(Chunk.id, func.length(Chunk.content))
        .where(Chunk.entry_id == entry.id, Chunk.kind == kind)
        .order_by(Chunk.id)
    ).all()
    consumed = 0
    index = 0
    while index < len(rows) and consumed + int(rows[index][1] or 0) <= offset:
        consumed += int(rows[index][1] or 0)
        index += 1
    skip = offset - consumed
    wanted = skip + limit
    parts = []
    loaded = 0
    for chunk_id, _size in rows[index:]:
        text = db.scalar(select(Chunk.content).where(Chunk.id == chunk_id)) or ""
        parts.append(text)
        loaded += len(text)
        if loaded >= wanted:
            break
    return {"text": "".join(parts)[skip:skip + limit], "total": total, "offset": offset, "limit": limit}


def entry_text(db, entry, kind):
    """整段正文，供复制 / 下载。"""
    if kind not in TEXT_KINDS:
        raise ReportUnavailable("不支持的正文类型")
    return "".join(db.scalars(
        select(Chunk.content).where(Chunk.entry_id == entry.id, Chunk.kind == kind).order_by(Chunk.id)
    ).all())
