"""管理后台「Agent 运行记录」：把一轮执行还原成可逐条检查的日志。

只读、无副作用，供管理端日志详情调用。三点刻意的取舍：

- 不返回 run.snapshot 全文（里面还有任务配置与官方模板，体积大且与本次复盘无关），
  只挑模型、预算、Provider、限制、任务配置摘要这些能解释「这一轮怎么跑的」字段。
- 正文（尤其是每一步完整上下文，可达 1 MB）不塞进报告，按页从
  workspace_chunks 读：管理页面只渲染当前页，切步即丢弃。
- 旧轮次没有逐条耗时（duration_ms 是后来才记的），按「下一条开始时间」估算并标注，
  不让老数据在页面上显示成 0 秒。
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


def _as(value, default):
    """json_extract 返回的是 JSON 文本；按期望的类型解析，坏数据回落到默认值。"""
    if value is None:
        return default
    if isinstance(value, type(default)):
        return value
    try:
        data = decode(value)
    except (TypeError, ValueError):
        return default
    return data if isinstance(data, type(default)) else default


def _as_bool(value, default=False):
    """SQLite 的 JSON1 把 true/false 读成 1/0，不能按字符串解析。"""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    try:
        return bool(decode(value))
    except (TypeError, ValueError):
        return default


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


def _entries(db, run_id, run_created_at, run_end):
    rows = db.scalars(
        select(Entry).where(Entry.run_id == run_id).order_by(Entry.created_at, Entry.id)
    ).all()
    sizes = _sizes(db, [row.id for row in rows])
    offsets = [max(0, int((row.created_at - run_created_at).total_seconds() * 1000)) if run_created_at else 0
               for row in rows]
    end_ms = max(0, int((run_end - run_created_at).total_seconds() * 1000)) if (run_created_at and run_end) else 0
    entries = []
    summary = {"entries": 0, "model_calls": 0, "tool_calls": 0, "reviews": 0,
               "compactions": 0, "waiting": 0, "problems": 0, "text_chars": 0,
               "max_context_tokens": 0}
    for index, row in enumerate(rows):
        details = _json(row.details)
        offset_ms = offsets[index]
        recorded = details.get("duration_ms")
        estimated = not isinstance(recorded, (int, float)) or isinstance(recorded, bool) or recorded < 0
        if estimated:
            # 旧轮次没有逐条耗时：用下一条的开始时间兜底，最后一条用本轮结束时间。
            finished_at = offsets[index + 1] if index + 1 < len(offsets) else end_ms
            duration_ms = max(0, int(finished_at) - offset_ms)
        else:
            duration_ms = int(recorded)
        entry_sizes = sizes.get(row.id, {})
        summary["entries"] += 1
        summary["text_chars"] += sum(entry_sizes.values())
        context_tokens = details.get("context_tokens")
        if isinstance(context_tokens, (int, float)) and context_tokens > summary["max_context_tokens"]:
            summary["max_context_tokens"] = int(context_tokens)
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
        if row.status in {"failed", "interrupted", "incomplete"}:
            summary["problems"] += 1
        entries.append({
            "id": row.id,
            "key": row.key,
            "kind": row.kind,
            "label": row.label,
            "status": row.status,
            "created_at": _iso(row.created_at),
            "offset_ms": offset_ms,
            "duration_ms": duration_ms,
            "duration_estimated": estimated,
            "details": details,
            "text_sizes": entry_sizes,
        })
    return entries, summary


def run_report(db, log):
    """一条 Agent 使用日志对应的完整复盘；运行记录已被级联清掉时返回 None。

    快照里还塞着任务配置与官方模板（单个教学提示词可到 10 万字），
    绝不整列读出来：只用 json_extract 取复盘需要的几个小字段。
    """
    if not log.request_id:
        return None
    row = db.execute(
        select(
            Run.id, Run.task_id, Run.mode, Run.status, Run.step, Run.tokens, Run.error,
            Run.created_at, Run.started_at, Run.finished_at, Run.charged, Run.request_key,
            func.json_extract(Run.snapshot, "$.model").label("model"),
            func.json_extract(Run.snapshot, "$.limits").label("limits"),
            func.json_extract(Run.snapshot, "$.provider").label("provider"),
            func.json_extract(Run.snapshot, "$.preferred_provider").label("preferred_provider"),
            func.json_extract(Run.snapshot, "$.switches").label("switches"),
            func.json_extract(Run.snapshot, "$.instruction").label("instruction"),
            func.json_extract(Run.snapshot, "$.base_version").label("base_version"),
            func.json_extract(Run.snapshot, "$.usage").label("usage"),
            func.json_extract(Run.snapshot, "$.config.tools").label("config_tools"),
            func.json_extract(Run.snapshot, "$.config.review").label("config_review"),
            func.json_extract(Run.snapshot, "$.config.auto_improve").label("config_auto_improve"),
            func.json_extract(Run.snapshot, "$.config.review_rounds").label("config_review_rounds"),
            func.json_extract(Run.snapshot, "$.config.materials").label("config_materials"),
            func.json_extract(Run.snapshot, "$.teaching_tool").label("teaching_tool"),
            func.json_extract(Run.snapshot, "$.revision").label("revision"),
            func.json_extract(Run.snapshot, "$.review_state").label("review_state"),
            func.json_extract(Run.snapshot, "$.template_names").label("template_names"),
        ).where(Run.id == log.request_id)
    ).mappings().first()
    if row is None:
        return None
    # 任务标题与目标同样不整列读 config：教学工具提示词可能非常大。
    task = db.execute(
        select(Task.id, Task.title, func.json_extract(Task.config, "$.goal").label("goal"))
        .where(Task.id == row["task_id"])
    ).first()
    limits = _as(row["limits"], {})
    usage = _as(row["usage"], {})
    switches = _as(row["switches"], [])
    template_names = _as(row["template_names"], {})
    review_state = _as(row["review_state"], {})
    run_end = row["finished_at"] or utcnow()
    entries, summary = _entries(db, row["id"], row["created_at"], run_end)
    summary["switches"] = len(switches)
    device = db.get(Device, log.device_id) if log.device_id else None
    duration_ms = int((run_end - row["created_at"]).total_seconds() * 1000)
    queued_ms = None
    if row["started_at"] is not None:
        queued_ms = max(0, int((row["started_at"] - row["created_at"]).total_seconds() * 1000))
    provider = row["provider"] or row["preferred_provider"] or ""
    return {
        "log": log.to_dict(),
        "device": device.to_dict() if device is not None else None,
        "task": {
            "id": task[0] if task is not None else "",
            "title": task[1] if task is not None else "",
            "goal": str(task[2] or "")[:4000] if task is not None else "",
        },
        "run": {
            "id": row["id"],
            "mode": row["mode"],
            "status": row["status"],
            "step": int(row["step"] or 0),
            "tokens": int(row["tokens"] or 0),
            "error": row["error"] or "",
            "created_at": _iso(row["created_at"]),
            "started_at": _iso(row["started_at"]),
            "finished_at": _iso(row["finished_at"]),
            "duration_ms": max(0, duration_ms),
            "queued_ms": queued_ms,
            "live": row["finished_at"] is None,
            "charged": bool(row["charged"]),
            "request_key": row["request_key"] or "",
            "model": row["model"] or "",
            "provider": provider,
            "preferred_provider": row["preferred_provider"] or "",
            "switches": switches,
            "instruction": row["instruction"] or "",
            "base_version": _base_version(db, row["base_version"]),
            "usage": {
                "prompt": int(usage.get("prompt") or 0),
                "cached": int(usage.get("cached") or 0),
                "completion": int(usage.get("completion") or 0),
                "cached_reported": bool(usage.get("cached_reported")),
            },
            "limits": {key: limits.get(key) for key in (
                "max_tokens", "max_steps", "output_tokens", "max_seconds",
                "context_budget", "keep_tail_steps", "provider_attempts",
                "retry_wait_cap_seconds", "switch_compaction_ratio") if limits.get(key) is not None},
            "config": {
                "tools": [str(item) for item in _as(row["config_tools"], []) if item],
                "review": _as_bool(row["config_review"]),
                "auto_improve": _as_bool(row["config_auto_improve"]),
                "review_rounds": int(_as(row["config_review_rounds"], 0) or 0),
                "materials": len(_as(row["config_materials"], [])),
                "teaching_tool": row["teaching_tool"] or "",
                "revision": int(_as(row["revision"], 0) or 0),
                "review_rounds_used": int(review_state.get("rounds") or 0) if isinstance(review_state, dict) else 0,
            },
            "template_names": {str(key): str(value) for key, value in template_names.items()} if isinstance(template_names, dict) else {},
            "versions": _run_versions(db, row["id"]),
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
