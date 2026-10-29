import asyncio
import json
from typing import Annotated, Literal

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy import select, update, func, delete

from app.config import settings
from app.database import SessionLocal
from app.models import UsageCode, utcnow
from app.routers.chat import _get_providers_for_model_sync, _load_cfg
from app.routers.tools import build_tool_groups, get_prompt_loader, _resolve_prompt_filename
from app.services.free_access import is_free_model
from app.services.usage_code import code_from_payload
from app.services.runtime_config import find_model_entry
from . import runner, store, titles
from .models import (WorkspaceTask as Task, WorkspaceRun as Run, WorkspaceEntry as Entry,
                     WorkspaceChunk as Chunk, WorkspaceEvent as Event, WorkspaceMaterial as Material,
                     WorkspaceVersion as Version, WorkspaceNote as Note, WorkspaceTemplate as Template)
from .instructions import DEFAULT_BEHAVIOR, DEFAULT_PROMPT, REVIEW_POLICY
from .settings import load_settings, search_available
from .tools import catalog, parse_upload, tool_schemas, execute_readonly

router = APIRouter(prefix="/api/workspace", tags=["agent-workspace"])


def identity(authorization: Annotated[str | None, Header()] = None):
    # 额度耗尽后仍能读取和导出自己的任务；新执行在事务中校验额度。
    try:
        if not authorization or not authorization.startswith("Bearer "):
            raise ValueError()
        data = jwt.decode(authorization[7:], settings.jwt_secret, algorithms=["HS256"])
        with SessionLocal() as db:
            # 不能只看 `sub`：SQLite 会复用 rowid，已删除使用码的旧令牌
            # 会变成后来占用同号那个人的令牌。code_from_payload 会比对码值。
            # 工作台只认带 sub 的令牌：没有主体的凭证等同于无效。
            row = code_from_payload(db, data) if data.get("sub") else None
            if not row or not row.is_enabled:
                raise ValueError()
            return row.id
    except (ValueError, TypeError, KeyError, jwt.InvalidTokenError):
        raise HTTPException(401, "请登录有效使用码；原有任务仍保留") from None


Owner = Annotated[int, Depends(identity)]


class TaskConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal: str = Field("", max_length=30000)
    prompt: str = Field(DEFAULT_PROMPT, max_length=100000)
    behavior: str = Field(DEFAULT_BEHAVIOR, max_length=30000)
    model: str = Field("", max_length=200)
    template_id: str = Field("", max_length=80)
    materials: list[str] = Field(default_factory=list, max_length=50)
    tools: list[Literal["material_search", "regex", "vocabulary", "web_search"]] = Field(default_factory=lambda: ["material_search", "regex", "vocabulary"])
    teaching_tools: dict[str, str] = Field(default_factory=dict, max_length=30)
    review: bool = True
    review_prompt: str = Field(REVIEW_POLICY, max_length=30000)
    auto_improve: bool = False
    review_rounds: int = Field(1, ge=1, le=3)

    @field_validator("teaching_tools")
    @classmethod
    def validate_teaching_tools(cls, value):
        if any(len(k)>100 or len(v)>100000 for k,v in value.items()):
            raise ValueError("教学工具名称或提示词过长")
        return value


class TaskWrite(BaseModel):
    config: TaskConfig = Field(default_factory=TaskConfig)
    title: str = Field("新任务", min_length=1, max_length=200)
    revision: int = Field(1, ge=1)


class RunWrite(BaseModel):
    request_key: str = Field(min_length=8, max_length=80)
    mode: Literal["execute", "continue", "review", "revise", "tool_test"] = "execute"
    instruction: str = Field("", max_length=30000)
    base_version: str = Field("", max_length=40)
    teaching_tool: str = Field("", max_length=100)


class NoteWrite(BaseModel):
    text: str = Field("", max_length=30000)
    apply_config: bool = False


class AnswerWrite(BaseModel):
    request_key: str = Field(min_length=8, max_length=80)
    selected: list[str] = Field(default_factory=list, max_length=20)
    custom: str = Field("", max_length=4000)
    skipped: bool = False


class VersionWrite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=2_000_000)
    parent_id: str = Field("", max_length=40)
    request_key: str = Field(min_length=8, max_length=80)


class Adoption(BaseModel):
    expected: str = Field("", max_length=40)


class MaterialWrite(BaseModel):
    name: str = Field("粘贴材料", min_length=1, max_length=250)
    content: str = Field(min_length=1, max_length=2_000_000)


class TemplateWrite(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["prompt", "tool"] = "prompt"
    config: TaskConfig


def official_templates():
    loader = get_prompt_loader()
    result = []
    for group in build_tool_groups(loader):
        for tool in group.get("tools", []):
            # 图片工具与专有课件协议由原页面运行，不伪装为通用文本工具。
            if str(tool["id"]) in {"13", "32", "33"}:
                continue
            prompt = loader.get(_resolve_prompt_filename(str(tool["id"])))
            if prompt:
                result.append({"id": str(tool["id"]), "name": tool["name"], "prompt": prompt})
    return result


class Login(BaseModel):
    code: str = Field(min_length=4, max_length=100)


@router.post("/login")
def login(body: Login):
    from app.services.usage_code import get_code_by_value, issue_token
    with SessionLocal() as db:
        row = get_code_by_value(db, body.code)
        if not row or not row.is_enabled:
            raise HTTPException(401, "使用码不存在或已停用")
        return {"token": issue_token(row)}


def _agent_models(cfg: dict) -> list[dict]:
    """Agent 工作台的模型清单：勾了「Agent」用途、未禁用、且至少绑定一个启用的 Provider。

    与用户端的口径刻意分开：用户端看 user_usable，Agent 只看 agent_usable，
    两者互不继承 —— 管理员可以为 Agent 单独挑一组模型。
    """
    return [m for m in cfg.get("models") or []
            if m.get("enabled", True) and m.get("agent_usable")
            and _get_providers_for_model_sync(cfg, m["id"])]


def _agent_model_entry(cfg: dict, model: str) -> dict:
    """开新执行前校验该模型确实属于 Agent 清单，并返回它的配置项。"""
    if not model:
        raise HTTPException(403, "还没有任何模型勾选「Agent」用途，请联系管理员在模型管理里开启")
    entry = find_model_entry(cfg.get("models") or [], model)
    if entry is None:
        raise HTTPException(400, f"模型不可用：{model}")
    if not entry.get("enabled", True):
        raise HTTPException(400, f"模型已禁用：{model}")
    if not entry.get("agent_usable"):
        raise HTTPException(403, f"模型「{entry.get('name') or model}」未勾选「Agent」用途，不能在工作台执行")
    if not _get_providers_for_model_sync(cfg, model):
        raise HTTPException(400, f"模型不可用：{model} 未绑定可用 Provider")
    return entry


@router.get("/catalog")
def get_catalog(owner: Owner):
    cfg, policy = _load_cfg(), load_settings()
    models = _agent_models(cfg)
    with SessionLocal() as db:
        templates = [{"id": r.id, "name": r.name, "kind": r.kind, "config": store.decode(r.config)}
                     for r in db.scalars(select(Template).where(Template.owner == owner).order_by(Template.created_at.desc()))]
        code = db.get(UsageCode, owner)
        user = code.to_public_dict()
        user["id"] = owner
    # 默认模型必须在自己给出的列表里：管理员只绑定部分 provider 时，
    # 原样返回配置里的默认值会让新任务被钉在一个选择器里不存在的模型上。
    offered = {m["id"] for m in models}
    default_model = cfg.get("default_model") if cfg.get("default_model") in offered else (models[0]["id"] if models else "")
    return {"enabled": policy.enabled, "models": models, "default_model": default_model,
            "official_templates": official_templates(), "templates": templates, "tools": catalog(),
            "defaults": TaskConfig().model_dump(), "user": user,
            "limits": {"steps": policy.max_steps, "tokens": policy.max_tokens, "seconds": policy.max_seconds},
            "billing": "每次执行或独立审阅预扣 1 次；没有产出成果的失败或停止会退回，已产出成果则按次计费；免费模型不扣次数。",
            "retention": "任务、材料和过程保留至主动删除；使用相同使用码的设备可以访问。"}


@router.get("/tasks")
def list_tasks(owner: Owner, q: str = "", offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    with SessionLocal() as db:
        stmt = select(Task).where(Task.owner == owner)
        if q:
            stmt = stmt.where(Task.title.contains(q, autoescape=True))
        rows = db.scalars(stmt.order_by(Task.updated_at.desc()).offset(offset).limit(limit+1)).all()
        return {"tasks": [store.task_dict(r) for r in rows[:limit]], "has_more": len(rows)>limit}


@router.post("/tasks", status_code=201)
def create_task(body: TaskWrite, owner: Owner):
    config = body.config.model_dump()
    if config["materials"]:
        raise HTTPException(400, "请先创建任务再添加材料")
    with SessionLocal() as db:
        row = Task(id=store.uid(), owner=owner, title=body.title, config=store.encode(config))
        db.add(row)
        db.commit()
        return store.task_dict(row, True)


@router.get("/tasks/{task_id}")
def get_task(task_id: str, owner: Owner):
    return store.task_detail(owner, task_id)


@router.put("/tasks/{task_id}")
def put_task(task_id: str, body: TaskWrite, owner: Owner):
    return store.update_task(owner, task_id, body.revision, body.config.model_dump(), body.title)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, owner: Owner):
    with SessionLocal() as db:
        task = store.owned(db, task_id, owner)
        if task.status in store.ACTIVE:
            raise HTTPException(409, "请先停止任务，等待停止完成后再删除")
        db.delete(task)
        db.commit()
    return {"deleted": True}


@router.post("/tasks/{task_id}/copy", status_code=201)
def copy_task(task_id: str, owner: Owner):
    with SessionLocal() as db:
        original = store.owned(db, task_id, owner)
        config = store.decode(original.config)
        task = Task(id=store.uid(), owner=owner, title=(original.title + "（副本）")[:200], config="{}")
        db.add(task)
        db.flush()
        ids, material_map = [], {}
        for m in db.scalars(select(Material).where(Material.task_id == task_id)):
            clone = Material(id=store.uid(), task_id=task.id, name=m.name, content=m.content, original=m.original, media_type=m.media_type)
            db.add(clone)
            material_map[m.id] = clone.id
            if m.id in config.get("materials", []):
                ids.append(clone.id)
        config["materials"] = ids
        task.config = store.encode(config)
        db.commit()
        return {**store.task_dict(task, True), "material_map": material_map}


# 材料配额：单任务条数、单文件字节、每用户总量（按解析文本 + 原始文件计）。
MAX_MATERIALS_PER_TASK = 50
MAX_MATERIAL_BYTES = 100 * 1024 * 1024
MAX_USER_MATERIAL_BYTES = 2 * 1024 * 1024 * 1024


def add_material(owner, task_id, name, text, original=None, media_type="text/plain"):
    size = func.coalesce(func.length(Material.content), 0) + func.coalesce(func.length(Material.original), 0)
    with SessionLocal() as db:
        task = store.owned(db, task_id, owner)
        # 配额在同一事务里校验：并发上传不能绕过上限。
        count = db.scalar(select(func.count()).select_from(Material).where(Material.task_id == task_id))
        if count >= MAX_MATERIALS_PER_TASK:
            raise HTTPException(400, f"每个任务最多 {MAX_MATERIALS_PER_TASK} 条材料，请先删除不用的材料")
        used = db.scalar(select(func.coalesce(func.sum(size), 0)).select_from(Material)
                         .join(Task, Material.task_id == Task.id).where(Task.owner == owner))
        incoming = len(text.encode()) + (len(original) if original else 0)
        if used + incoming > MAX_USER_MATERIAL_BYTES:
            raise HTTPException(413, "材料总量已超过 2 GB，请删除不再使用的任务或材料")
        row = Material(id=store.uid(), task_id=task_id, name=name, content=text, original=original, media_type=media_type)
        db.add(row)
        db.flush()
        # 新材料不修改正在编辑的 config；前端显式保存选中材料，避免上传覆盖编辑。
        store.event(db, task_id, "material", store.material_dict(row))
        db.commit()
        return store.material_dict(row)


@router.post("/tasks/{task_id}/materials")
def paste_material(task_id: str, body: MaterialWrite, owner: Owner):
    return add_material(owner, task_id, body.name, body.content)


@router.post("/tasks/{task_id}/upload")
async def upload_material(task_id: str, owner: Owner, file: UploadFile = File(...)):
    await asyncio.to_thread(store.task_detail, owner, task_id)
    data = await file.read(MAX_MATERIAL_BYTES + 1)
    if len(data) > MAX_MATERIAL_BYTES:
        raise HTTPException(413, "文件超过 100 MB，请拆分后上传")
    name = (file.filename or "material.txt").replace("\\", "/").split("/")[-1][:250]
    try:
        text = await asyncio.to_thread(parse_upload, name, data)
    except Exception as exc:
        raise HTTPException(422, f"解析失败：{str(exc)[:200]}") from exc
    return await asyncio.to_thread(add_material, owner, task_id, name, text, data, file.content_type or "application/octet-stream")


@router.get("/tasks/{task_id}/materials/{material_id}")
def get_material(task_id: str, material_id: str, owner: Owner, original: bool = False):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        row = db.get(Material, material_id)
        if not row or row.task_id != task_id:
            raise HTTPException(404, "材料不存在")
        if original:
            return Response(row.original or row.content.encode(), media_type="application/octet-stream",
                            headers={"Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff"})
        return store.material_dict(row, True)


@router.post("/tasks/{task_id}/runs", status_code=202)
def start_run(task_id: str, body: RunWrite, owner: Owner):
    task, policy, cfg = store.task_detail(owner, task_id), load_settings(), _load_cfg()
    with SessionLocal() as db:
        previous = db.scalar(select(Run).where(Run.task_id == task_id, Run.request_key == body.request_key))
        if previous:
            old = store.decode(previous.snapshot)
            if previous.mode != body.mode or old.get("instruction") != body.instruction or old.get("base_version") != body.base_version or old.get("teaching_tool", "") != body.teaching_tool:
                raise HTTPException(409, "请求编号已用于其他执行")
            return store.run_dict(previous)
    if not policy.enabled:
        raise HTTPException(403, "Agent 工作台暂未开启")
    config = task["config"]
    if body.mode == "tool_test" and body.teaching_tool not in config.get("teaching_tools", {}):
        raise HTTPException(400, "请先在本任务启用要试运行的教学工具")
    if body.mode in {"review", "revise"} and not body.base_version:
        raise HTTPException(400, "请先选择要审阅或修订的成果版本")
    model = config.get("model") or cfg.get("default_model")
    entry = _agent_model_entry(cfg, model)
    if "web_search" in config["tools"] and not search_available(policy):
        raise HTTPException(409, "网页搜索未接入，请关闭开关或联系管理员")
    templates = {t["id"]: t for t in official_templates() if t["id"] in config.get("teaching_tools", {}) or t["id"] == config.get("template_id")}
    snapshot = {"model": model, "limits": policy.model_dump(include={"max_steps", "max_tokens", "output_tokens", "max_seconds"}),
                "templates": templates, "base_adopted": task["adopted_version"], "expected_revision": task["revision"],
                "teaching_tool": body.teaching_tool}
    run = store.create_run(owner, task_id, body.request_key, body.mode, body.instruction, body.base_version, snapshot, not is_free_model(entry), entry)
    # 用户第一次开始工作时就命名，不等待执行结束；只入队一次，失败不影响开始。
    if body.mode == "execute" and not task["runs"]:
        titles.enqueue_agent_title(owner, task_id, instruction=body.instruction,
                                   tool_names=[t.get("name", "") for t in templates.values()])
    return run


def answer_instruction(ask, selected, custom, skipped):
    lines = []
    if ask.get("header"):
        lines.append(f"关于「{ask['header']}」")
    lines.append(f"问题：{ask.get('question', '')}")
    if skipped:
        lines.append("回答：已跳过，不提供这项信息。")
    else:
        parts = []
        if selected:
            parts.append("、".join(selected))
        if custom:
            parts.append(f"补充：{custom}")
        lines.append("回答：" + "；".join(parts))
    return "\n".join(lines)


@router.post("/tasks/{task_id}/entries/{entry_id}/answer", status_code=202)
def answer_question(task_id: str, entry_id: str, body: AnswerWrite, owner: Owner):
    with SessionLocal() as db:
        task = store.owned(db, task_id, owner)
        adopted = task.adopted_version
        row = db.get(Entry, entry_id)
        if not row or row.task_id != task_id or row.label != "ask_user":
            raise HTTPException(404, "提问不存在")
        details = store.decode(row.details)
        ask = details.get("ask") or {"question": details.get("question", ""), "options": [], "multi_select": False}
        labels = [str(item.get("label", "")) for item in ask.get("options") or [] if item.get("label")]
        selected = list(dict.fromkeys(str(label).strip() for label in body.selected if str(label).strip()))
        custom = body.custom.strip()
        if body.skipped:
            selected, custom = [], ""
        else:
            unknown = [label for label in selected if label not in labels]
            if unknown:
                raise HTTPException(400, "所选选项不属于这个问题")
            if len(selected) > 1 and not ask.get("multi_select"):
                raise HTTPException(400, "这个问题只能选择一个选项")
            if not selected and not custom:
                raise HTTPException(400, "请选择一个选项或填写回答")
        answer = {"selected": selected, "custom": custom, "skipped": body.skipped}
        instruction = answer_instruction(ask, selected, custom, body.skipped)
        if row.status == "done":
            previous = db.scalar(select(Run).where(Run.task_id == task_id, Run.request_key == body.request_key))
            if previous and details.get("answer") == answer:
                return {"run": {**store.run_dict(previous), "instruction": instruction},
                        "entry": store.entry_dict(row)}
            raise HTTPException(409, "这个问题已经回答")
        if row.status != "waiting" or not row.run_id:
            raise HTTPException(409, "这个问题已不再等待回答")
        run = db.get(Run, row.run_id)
        if not run or run.status != "waiting":
            raise HTTPException(409, "这个问题已不再等待回答")
    created = start_run(task_id, RunWrite(request_key=body.request_key, mode="continue",
                                          instruction=instruction, base_version=adopted), owner)
    try:
        entry = store.answer_question(entry_id, answer)
    except Exception:
        # 回答没能落库（并发抢答、条目被清理等）：把刚创建的轮次收掉并退回预扣，
        # 否则用户被扣了一次费却停在"等待回答"，只能手动刷新重试。
        store.finish_run(created["id"], "stopped", "回答未能落库，本轮已取消")
        raise
    return {"run": {**created, "instruction": instruction}, "entry": entry}


@router.post("/tasks/{task_id}/stop")
def stop_run(task_id: str, owner: Owner):
    queued = False
    with SessionLocal() as db:
        db.execute(update(Task).where(Task.id == task_id, Task.owner == owner).values(updated_at=Task.updated_at))
        task = store.owned(db, task_id, owner)
        row = db.get(Run, task.active_run) if task.active_run else None
        if not row or row.status not in store.ACTIVE:
            # 等待补充（waiting）与已结束的轮次没有在途执行，如实告诉页面没停到东西。
            return {"received": False, "status": task.status}
        queued = row.status == "queued"
        row.stop = True
        # 排队中的轮次也先置 stopping：claim_run 只领取 queued，条件更新会失败，不会被误领。
        row.status = "stopping"
        task.status = "stopping"
        store.event(db, task_id, "run", store.run_dict(row))
        value = store.run_dict(row)
        run_id = row.id
        db.commit()
    if queued:
        # 排队中还没有在途调用：直接落终态并退回预扣，不必等 worker 槽位。
        store.finish_run(run_id, "stopped", "已取消尚未开始的执行")
        with SessionLocal() as db:
            row = db.get(Run, run_id)
            if row:
                value = store.run_dict(row)
    # 进程内立即取消在途模型调用；跨进程/重启时由心跳读取上面的 stop 标记兜底。
    runner.request_stop(run_id)
    return {"received": True, "status": value["status"], "run": value}


@router.post("/tasks/{task_id}/notes")
def add_note(task_id: str, body: NoteWrite, owner: Owner):
    with SessionLocal() as db:
        db.execute(update(Task).where(Task.id == task_id, Task.owner == owner).values(updated_at=Task.updated_at))
        task = store.owned(db, task_id, owner)
        if task.status not in store.ACTIVE or not task.active_run:
            raise HTTPException(409, "本轮已结束，请开始新一轮")
        if not body.text.strip() and not body.apply_config:
            raise HTTPException(400, "请输入补充要求")
        note = Note(task_id=task_id, run_id=task.active_run, text=body.text,
                    config=task.config if body.apply_config else "")
        db.add(note)
        db.flush()
        # 客户端靠 run_id 找对应回合；缺了它补充要求就不会出现在对话里。
        value = {"id": note.id, "run_id": note.run_id, "text": note.text or "应用新提示词与工具配置", "applied": False}
        store.event(db, task_id, "note", value)
        db.commit()
        return value


@router.get("/tasks/{task_id}/events")
def events(task_id: str, owner: Owner, after: int = Query(0, ge=0)):
    with SessionLocal() as db:
        task = store.owned(db, task_id, owner)
        rows = db.scalars(select(Event).where(Event.task_id == task_id, Event.id > after).order_by(Event.id).limit(200)).all()
        return {"events": [{"id": e.id, "kind": e.kind, "data": store.decode(e.data)} for e in rows],
                "cursor": rows[-1].id if rows else after, "has_more": len(rows) == 200,
                "task": store.task_dict(task)}


@router.get("/tasks/{task_id}/entries")
def list_entries(task_id: str, owner: Owner, offset: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=1000)):
    """步骤元数据，供对话恢复；正文仍按游标单独读取，避免把大段内容塞进列表。

    真分页：条目只追加不修改顺序，偏移量对已存在的行稳定；客户端按 `has_more`
    翻页，长任务最早的步骤不会再被截掉。
    """
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        rows = db.scalars(select(Entry).where(Entry.task_id == task_id)
                          .order_by(Entry.created_at, Entry.id).offset(offset).limit(limit + 1)).all()
        more = len(rows) > limit
        page = rows[:limit]
        return {"entries": [store.entry_dict(r) for r in page], "has_more": more,
                "offset": offset + len(page)}


@router.get("/tasks/{task_id}/entries/{entry_id}/content")
def entry_content(task_id: str, entry_id: str, owner: Owner, kind: str = "output", after: int = Query(0, ge=0), download: bool = False):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        row = db.get(Entry, entry_id)
        if not row or row.task_id != task_id:
            raise HTTPException(404, "步骤不存在")
        stmt = select(Chunk).where(Chunk.entry_id == entry_id, Chunk.kind == kind, Chunk.id > after).order_by(Chunk.id)
        if download:
            content = "".join(r.content for r in db.scalars(stmt))
            return Response(content, media_type="text/plain", headers={"Content-Disposition": "attachment; filename=agent-log.txt"})
        rows = db.scalars(stmt.limit(24)).all()
        return {"chunks": [{"id": r.id, "text": r.content} for r in rows], "cursor": rows[-1].id if rows else after,
                "has_more": len(rows) == 24, "status": row.status, "details": store.decode(row.details)}


@router.get("/tasks/{task_id}/runs/{run_id}")
def run_snapshot(task_id: str, run_id: str, owner: Owner):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        row = db.get(Run, run_id)
        if not row or row.task_id != task_id:
            raise HTTPException(404, "执行记录不存在")
        return store.run_dict(row, True)


@router.get("/tasks/{task_id}/versions/{version_id}")
def get_version(task_id: str, version_id: str, owner: Owner):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        row = db.get(Version, version_id)
        if not row or row.task_id != task_id:
            raise HTTPException(404, "成果不存在")
        return store.version_dict(row, True)


@router.post("/tasks/{task_id}/versions")
def edit_version(task_id: str, body: VersionWrite, owner: Owner):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        # 父版本要先确认属于本任务：交给 save_version 的话会抛裸 ValueError → 500。
        if body.parent_id:
            parent = db.get(Version, body.parent_id)
            if not parent or parent.task_id != task_id:
                raise HTTPException(404, "基准版本不存在或不属于此任务")
    return store.save_version(task_id, "", "manual:"+body.request_key, body.title, body.content, body.parent_id, "manual")


@router.post("/tasks/{task_id}/versions/{version_id}/adopt")
def adopt_version(task_id: str, version_id: str, body: Adoption, owner: Owner):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        version = db.get(Version, version_id)
        if not version or version.task_id != task_id or not version.complete:
            raise HTTPException(400, "只能采用本任务完整的成果版本")
        result = db.execute(update(Task).where(Task.id == task_id, Task.adopted_version == body.expected)
                            .values(adopted_version=version_id, updated_at=utcnow()))
        if result.rowcount != 1:
            raise HTTPException(409, "当前版本已在其他窗口更改，请重新比较")
        store.event(db, task_id, "adopt", {"version_id": version_id})
        db.commit()
    return {"adopted_version": version_id}


@router.post("/templates")
def save_template(body: TemplateWrite, owner: Owner):
    config = body.config.model_dump()
    config["materials"] = []
    with SessionLocal() as db:
        row = Template(id=store.uid(), owner=owner, name=body.name, kind=body.kind, config=store.encode(config))
        db.add(row)
        db.commit()
        return {"id": row.id, "name": row.name, "kind": row.kind, "config": config}


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, owner: Owner):
    with SessionLocal() as db:
        row = db.get(Template, template_id)
        if not row or row.owner != owner:
            raise HTTPException(404, "模板不存在")
        db.delete(row)
        db.commit()
    return {"deleted": True}


class ToolTest(BaseModel):
    name: str
    arguments: dict


class ReviewDecision(BaseModel):
    ignored: list[int] = Field(default_factory=list, max_length=100)


@router.post("/tasks/{task_id}/reviews/{entry_id}")
def review_decision(task_id: str, entry_id: str, body: ReviewDecision, owner: Owner):
    with SessionLocal() as db:
        store.owned(db, task_id, owner)
        row = db.get(Entry, entry_id)
        if not row or row.task_id != task_id or row.kind != "review":
            raise HTTPException(404, "审阅不存在")
        details = store.decode(row.details)
        if any(i < 0 or i >= details.get("issues", 0) for i in body.ignored):
            raise HTTPException(422, "意见序号无效")
        details["ignored"] = sorted(set(body.ignored))
        row.details = store.encode(details)
        store.event(db, task_id, "entry", store.entry_dict(row))
        db.commit()
    return {"ignored": details["ignored"]}


@router.post("/tasks/{task_id}/tool-test")
async def test_tool(task_id: str, body: ToolTest, owner: Owner):
    from jsonschema import validate, ValidationError
    task = await asyncio.to_thread(store.task_detail, owner, task_id)
    tool = next((t["function"] for t in tool_schemas(task["config"]) if t["function"]["name"] == body.name), None)
    if not tool or body.name not in {"search_material", "read_material", "check_vocabulary", "web_search"}:
        raise HTTPException(400, "此工具未启用或不能独立试运行")
    try:
        validate(body.arguments, tool["parameters"])
        return await execute_readonly(task_id, task["config"], body.name, body.arguments)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)[:300]) from exc
