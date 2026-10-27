"""Agent 任务标题：第一次开始执行时，用极少量上下文交给 Chores 模型命名。

标题只需要让用户在侧栏认出这个任务，不需要读完材料或等执行结束。因此这里
只取最能决定主题的几项内容：用户目标、所选教学工具名、材料文件名和各材料
的开头片段；整段材料正文不进入标题上下文。
"""
from __future__ import annotations

import logging

from sqlalchemy import func, select

from app.database import SessionLocal
from app.services.title_jobs import enqueue_title_job

from . import store
from .instructions import DEFAULT_PROMPT
from .models import WorkspaceMaterial as Material, WorkspaceTask as Task

log = logging.getLogger(__name__)

# 仅内部使用；/api/chat/title-jobs 会因找不到同名工具提示词而拒绝这个 ID。
AGENT_TITLE_TOOL_ID = "agent_title"
DEFAULT_TASK_TITLE = "新任务"
MAX_GOAL_CHARS = 600
MAX_REQUIREMENT_CHARS = 300
MAX_PROMPT_CHARS = 160
MAX_MATERIALS = 3
MAX_MATERIAL_NAME_CHARS = 60
MAX_SNIPPET_CHARS = 120
MAX_CONTEXT_CHARS = 1400

TITLE_SYSTEM_PROMPT = (
    "你在为教师的 Agent 工作台任务命名。只根据给出的任务目标、教学工具、"
    "材料文件名和材料开头片段，写一个具体、可检索的中文标题。"
    "要求：不超过 15 个汉字；点明对象和要做的事（如“2024新课标I卷 阅读讲评”）；"
    "不使用书名号、引号、句号；不要用“任务”“材料分析”这类空泛说法；"
    "只输出标题本身，不要解释。"
)


def _one_line(text: str, limit: int) -> str:
    return " ".join((text or "").split())[:limit]


def _material_rows(task_id: str, ids: list[str]) -> list[dict]:
    """只从数据库取材料开头，不把完整正文带进标题上下文。"""
    if not ids:
        return []
    with SessionLocal() as db:
        rows = db.execute(
            select(Material.id, Material.name, func.substr(Material.content, 1, 160))
            .where(Material.task_id == task_id, Material.id.in_(ids))
        ).all()
    by_id = {row.id: {"name": row[1], "snippet": row[2]} for row in rows}
    return [by_id[item] for item in ids if item in by_id][:MAX_MATERIALS]


def build_context(config: dict, instruction: str = "", tool_names=(), materials=()) -> str:
    """拼出标题所需的最小上下文；没有任务特有信息时返回空字符串。"""
    goal = _one_line(config.get("goal", ""), MAX_GOAL_CHARS)
    requirement = _one_line(instruction, MAX_REQUIREMENT_CHARS)
    lines = []
    if goal:
        lines.append("任务目标：" + goal)
    if requirement and requirement != goal:
        lines.append("本轮要求：" + requirement)

    names = [name for name in (_one_line(name, 40) for name in tool_names) if name]
    if names:
        lines.append("教学工具：" + "、".join(list(dict.fromkeys(names))[:3]))
    else:
        prompt = config.get("prompt", "")
        if prompt and prompt != DEFAULT_PROMPT:
            lines.append("提示词开头：" + _one_line(prompt, MAX_PROMPT_CHARS))

    snippets = []
    for material in materials:
        name = _one_line(material.get("name", ""), MAX_MATERIAL_NAME_CHARS)
        snippet = _one_line(material.get("snippet", ""), MAX_SNIPPET_CHARS)
        if name:
            snippets.append(f"{name}｜{snippet}" if snippet else name)
    if snippets:
        lines.append("材料：" + "；".join(snippets))

    return "\n".join(lines)[:MAX_CONTEXT_CHARS]


def enqueue_agent_title(owner: int, task_id: str, *, instruction: str = "", tool_names=()) -> dict | None:
    """首次执行时为仍叫“新任务”的任务入队标题任务；已命名或没有依据时跳过。

    幂等：同一任务始终使用同一个 client_job_id，重复开始不会生成多个标题任务。
    """
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        if not task or task.owner != owner or task.title != DEFAULT_TASK_TITLE:
            return None
        config = store.decode(task.config)
        material_ids = list(config.get("materials") or [])
    context = build_context(config, instruction, tool_names, _material_rows(task_id, material_ids))
    if not context:
        return None
    try:
        status, _created = enqueue_title_job(
            code_id=owner,
            client_job_id=f"agent-title-{task_id}",
            history_id=task_id,
            tool_id=AGENT_TITLE_TOOL_ID,
            input_text=context,
            output_text="",
            model="",
        )
        return status
    except Exception:
        # 标题只是辅助信息，生成失败不能影响任务开始。
        log.exception("Agent 标题任务入队失败 task=%s", task_id)
        return None


def _clean_title(raw: str) -> str:
    title = (raw or "").strip()
    if not title:
        return ""
    title = title.splitlines()[0].strip().strip("\"'“”‘’")
    title = " ".join(title.split()).rstrip("。．.!！?？；;：:").strip().strip("\"'“”‘’")
    return title[:60]


def apply_agent_title(code_id: int, task_id: str, raw_title: str) -> bool:
    """写回任务标题。用户已手动改名时不覆盖，并发出轻量事件供前端同步。"""
    title = _clean_title(raw_title)
    if not title:
        return False
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        if not task or task.owner != code_id or task.title != DEFAULT_TASK_TITLE:
            return False
        task.title = title
        store.event(db, task_id, "title", {"title": title})
        db.commit()
    return True
