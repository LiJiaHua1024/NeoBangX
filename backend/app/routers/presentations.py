"""Tool-page PPT jobs.

The ordinary tool page already has a finished teaching result. This endpoint
turns that result into a hidden Agent task/run; the existing worker compiles and
stores a slides version. No second SSE stream, no client-side screenshot loop.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.agent_workspace import store
from app.agent_workspace.api import TaskConfig, _agent_model_entry, _agent_models, _load_cfg
from app.agent_workspace.models import WorkspaceMaterial as Material
from app.agent_workspace.models import WorkspaceRun as Run
from app.agent_workspace.models import WorkspaceTask as Task
from app.agent_workspace.models import WorkspaceVersion as Version
from app.agent_workspace.settings import load_settings
from app.agent_workspace.slides.blueprints import BLUEPRINTS
from app.agent_workspace.slides.check import check as slide_check
from app.agent_workspace.slides.compile import compile_deck
from app.agent_workspace.slides.pptx import build_pptx
from app.database import SessionLocal
from app.deps import get_current_code
from app.models import UsageCode
from app.services.free_access import is_agent_free
from app.services.presentation_blueprints import blueprint_for_tool, supports_presentation

router = APIRouter(prefix="/api/presentations", tags=["presentations"])


class FromTool(BaseModel):
    request_key: str = Field(..., min_length=8, max_length=80)
    tool_id: str = Field(..., max_length=40)
    tool_name: str = Field("", max_length=120)
    history_id: str = Field(..., min_length=1, max_length=96)
    title: str = Field("", max_length=200)
    input: str = Field("", max_length=80000)
    output: str = Field(..., min_length=200, max_length=80000)
    model: str = Field("", max_length=200)
    theme: Literal["paper", "chalk"] | None = None


def _task_for(code: UsageCode, task_id: str) -> Task:
    with SessionLocal() as db:
        row = db.get(Task, task_id)
        if not row or row.owner != code.id:
            raise HTTPException(404, "PPT 任务不存在")
        return row


def _latest_slides(db, task_id: str):
    return db.query(Version).filter(Version.task_id == task_id, Version.kind == "slides").order_by(
        Version.created_at.desc()).first()


def _scene(version: Version) -> dict:
    rend = store.rendition(version.id, full=True)
    if rend and rend.get("scene"):
        return rend["scene"]
    deck = json.loads(version.content)
    scene = compile_deck(deck)
    errors, _ = slide_check(scene)
    if errors:
        raise HTTPException(422, "演示文稿排版检查未通过")
    store.save_rendition(version.id, scene, (deck.get("design") or {}).get("design_version", ""))
    return scene


def _ppt(version: Version) -> bytes:
    rend = store.rendition(version.id, full=True)
    if rend and rend.get("pptx"):
        return rend["pptx"]
    data = build_pptx(_scene(version))
    store.save_pptx(version.id, data)
    return data


@router.post("/from-tool")
def from_tool(body: FromTool, code: Annotated[UsageCode, Depends(get_current_code)]):
    policy = load_settings()
    if not policy.slides_enabled:
        raise HTTPException(403, "演示文稿功能暂未开启")
    if not supports_presentation(body.tool_id, True):
        raise HTTPException(400, "该工具暂不支持生成 PPT")
    blueprint = blueprint_for_tool(body.tool_id)
    if not blueprint:
        raise HTTPException(400, "该工具还没有对应的 PPT 结构")
    output = body.output.strip()
    if len(output) < 200:
        raise HTTPException(400, "工具结果太短，无法生成完整课堂 PPT")
    source_hash = hashlib.sha256(output.encode("utf-8")).hexdigest()[:32]
    with SessionLocal() as db:
        existing = db.query(Task).filter(
            Task.owner == code.id, Task.origin == "tool", Task.source_tool == body.tool_id,
            Task.source_ref == body.history_id, Task.source_hash == source_hash,
        ).order_by(Task.created_at.desc()).first()
        if existing:
            return _job_dict(db, existing)
    cfg = _load_cfg()
    model = body.model or cfg.get("default_model") or ""
    try:
        entry = _agent_model_entry(cfg, model)
    except HTTPException:
        # The tool page's selected model may not be enabled for Agent use.
        # Use the first Agent model instead of failing the whole export.
        candidates = _agent_models(cfg)
        if not candidates:
            raise HTTPException(403, "还没有模型勾选「Agent」用途，无法生成 PPT")
        model = candidates[0]["id"]
        entry = _agent_model_entry(cfg, model)
    theme = body.theme or BLUEPRINTS[blueprint]["theme"]
    title = (body.title.strip() or f"{body.tool_name or '工具结果'} · 课堂 PPT")[:200]
    config = TaskConfig(goal="根据已有工具结果制作课堂演示文稿", output="slides", model=model,
                        review=False, tools=[], materials=[]).model_dump()
    with SessionLocal() as db:
        task = Task(id=store.uid(), owner=code.id, title=title, config=store.encode(config),
                    origin="tool", source_tool=body.tool_id, source_ref=body.history_id,
                    source_hash=source_hash)
        db.add(task)
        db.flush()
        out_row = Material(id=store.uid(), task_id=task.id, name="工具结果", content=output)
        db.add(out_row)
        ids = [out_row.id]
        if body.input.strip():
            in_row = Material(id=store.uid(), task_id=task.id, name="原始输入", content=body.input.strip())
            db.add(in_row)
            ids.append(in_row.id)
        config["materials"] = ids
        task.config = store.encode(config)
        db.commit()
        task_id = task.id
    levels = policy.model_dump(include={"max_steps", "max_tokens", "output_tokens", "max_seconds",
                                        "context_budget", "keep_tail_steps", "provider_attempts",
                                        "retry_wait_cap_seconds", "switch_compaction_ratio"})
    snapshot = {"model": model, "limits": levels, "templates": {}, "template_names": {},
                "presentation": {"title": title, "instruction": "根据工具结果制作课堂 PPT",
                                 "material_ids": ids, "blueprint": blueprint, "theme": theme},
                "expected_revision": 1}
    try:
        run = store.create_run(code.id, task_id, body.request_key, "presentation", "", "",
                               snapshot, not is_agent_free(entry), entry)
    except Exception:
        with SessionLocal() as db:
            row = db.get(Task, task_id)
            if row:
                db.delete(row)
                db.commit()
        raise
    return {"task_id": task_id, "run_id": run["id"], "status": run["status"],
            "blueprint": blueprint, "theme": theme, "charged": bool(run.get("charged", False))}


def _job_dict(db, task: Task):
    run = db.query(Run).filter(Run.task_id == task.id).order_by(Run.created_at.desc()).first()
    version = _latest_slides(db, task.id)
    data = {"task_id": task.id, "run_id": run.id if run else "", "status": run.status if run else task.status,
            "title": task.title, "blueprint": blueprint_for_tool(task.source_tool) or ""}
    if version:
        prov = store.decode(version.provenance or "{}")
        data["version"] = {"id": version.id, "title": version.title, "kind": "slides",
                           "slides": prov.get("slide_count", 0), "theme": prov.get("theme", "paper"),
                           "warnings": prov.get("warnings", [])}
    if run and run.error:
        data["error"] = run.error
    return data


@router.get("/{task_id}")
def get_job(task_id: str, code: Annotated[UsageCode, Depends(get_current_code)]):
    _task_for(code, task_id)
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        return _job_dict(db, task)


@router.get("/{task_id}/scene")
def get_job_scene(task_id: str, code: Annotated[UsageCode, Depends(get_current_code)]):
    _task_for(code, task_id)
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        version = _latest_slides(db, task.id)
        if not version:
            raise HTTPException(409, "PPT 还没有生成完成")
        scene = _scene(version)
        prov = store.decode(version.provenance or "{}")
    return {"version_id": version.id, "title": version.title, "scene": scene,
            "warnings": prov.get("warnings", [])}


@router.get("/{task_id}/export")
def export_job(task_id: str, code: Annotated[UsageCode, Depends(get_current_code)]):
    _task_for(code, task_id)
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        version = _latest_slides(db, task.id)
        if not version:
            raise HTTPException(409, "PPT 还没有生成完成")
        data = _ppt(version)
        title = version.title
    safe = re.sub(r'[\\/:*?"<>|]+', "-", title).strip() or "slides"
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(safe + ".pptx"),
                             "Cache-Control": "private, no-store"})


@router.delete("/{task_id}")
def delete_job(task_id: str, code: Annotated[UsageCode, Depends(get_current_code)]):
    _task_for(code, task_id)
    with SessionLocal() as db:
        task = db.get(Task, task_id)
        active = db.query(Run).filter(Run.task_id == task_id, Run.status.in_(store.ACTIVE)).first()
        if active:
            raise HTTPException(409, "PPT 正在生成，请先停止再删除")
        db.delete(task)
        db.commit()
    return {"deleted": True}
