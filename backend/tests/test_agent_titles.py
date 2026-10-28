"""Agent 任务标题：紧凑上下文、默认名保护与持久任务写回。"""
from __future__ import annotations

import asyncio

import pytest

from app.agent_workspace import api, store, titles
from app.agent_workspace.models import WorkspaceEvent, WorkspaceRun, WorkspaceTask
from app.database import SessionLocal
from app.models import TitleJob, UsageCode
from app.routers import chat as chat_router
from app.services.title_jobs import TitleJobWork


@pytest.fixture
def owner():
    with SessionLocal() as db:
        row = UsageCode(code="AGENT-TITLE-" + store.uid()[:8].upper(), quota=-1, is_enabled=True)
        db.add(row)
        db.commit()
        return row.id


def _task(owner_id: int, title: str = "新任务", **config) -> WorkspaceTask:
    settings = {"model": "test", "review": False, **config}
    with SessionLocal() as db:
        row = WorkspaceTask(
            id=store.uid(),
            owner=owner_id,
            title=title,
            config=store.encode(api.TaskConfig(**settings).model_dump()),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        db.expunge(row)
        return row


def _title_job(task_id: str) -> TitleJob:
    with SessionLocal() as db:
        row = db.query(TitleJob).filter(TitleJob.history_id == task_id).one()
        db.expunge(row)
        return row


def _material(owner_id: int, task_id: str, name: str) -> str:
    return api.add_material(owner_id, task_id, name, "试卷标题行\n" + "正文内容" * 3000)["id"]


def test_context_keeps_only_key_fields_and_limits_materials(owner):
    task = _task(owner, goal="把2024新课标I卷阅读D篇做成讲评")
    ids = [_material(owner, task.id, f"材料{index}.pdf") for index in range(5)]
    with SessionLocal() as db:
        row = db.get(WorkspaceTask, task.id)
        config = store.decode(row.config)
        config["materials"] = ids
        row.config = store.encode(config)
        db.commit()

    status = titles.enqueue_agent_title(owner, task.id, tool_names=["阅读理解设问", "语篇深度分析"])
    assert status is not None and status["status"] == "pending"

    context = _title_job(task.id).input_text
    assert "2024新课标I卷阅读D篇" in context
    assert "阅读理解设问" in context
    assert "材料0.pdf" in context and "材料1.pdf" in context and "材料2.pdf" in context
    assert "材料3.pdf" not in context and "材料4.pdf" not in context
    assert "试卷标题行" in context
    assert len(context) <= titles.MAX_CONTEXT_CHARS
    # 只带开头片段，不把整份材料塞进标题上下文。
    assert len(context) < 1000


def test_context_falls_back_to_custom_prompt_without_tool(owner):
    task = _task(owner, goal="检查这篇作文", prompt="请按高考评分标准逐段批改，并给出修改建议。")
    assert titles.enqueue_agent_title(owner, task.id) is not None
    context = _title_job(task.id).input_text
    assert "请按高考评分标准逐段批改" in context


def test_enqueue_skips_manually_named_or_empty_task(owner):
    named = _task(owner, title="我自己起的名字", goal="分析阅读")
    assert titles.enqueue_agent_title(owner, named.id, tool_names=["阅读理解设问"]) is None
    with SessionLocal() as db:
        assert db.query(TitleJob).filter(TitleJob.history_id == named.id).count() == 0

    empty = _task(owner)
    assert titles.enqueue_agent_title(owner, empty.id) is None


def test_apply_only_replaces_default_title_and_emits_event(owner):
    task = _task(owner, goal="分析阅读")
    assert titles.apply_agent_title(owner, task.id, "“2024新课标I卷 阅读讲评”。") is True
    assert store.task_detail(owner, task.id)["title"] == "2024新课标I卷 阅读讲评"

    assert titles.apply_agent_title(owner, task.id, "另一个标题") is False
    assert titles.apply_agent_title(owner, task.id, "  ") is False
    renamed = _task(owner, title="用户命名", goal="分析阅读")
    assert titles.apply_agent_title(owner, renamed.id, "自动标题") is False
    assert titles.apply_agent_title(owner + 1000, task.id, "越权标题") is False

    with SessionLocal() as db:
        event = db.query(WorkspaceEvent).filter(
            WorkspaceEvent.task_id == task.id, WorkspaceEvent.kind == "title"
        ).one()
        assert store.decode(event.data)["title"] == "2024新课标I卷 阅读讲评"


def test_worker_executor_writes_generated_title_back(owner, monkeypatch):
    task = _task(owner, goal="把2024新课标I卷阅读D篇做成讲评")
    status = titles.enqueue_agent_title(owner, task.id, tool_names=["阅读理解设问"])
    assert status is not None
    row = _title_job(task.id)
    work = TitleJobWork(
        id=row.id,
        code_id=owner,
        client_job_id=row.client_job_id,
        history_id=task.id,
        tool_id=row.tool_id,
        input_text=row.input_text,
        output_text="",
        model="",
        ip="",
        user_agent="",
        fingerprint="",
        device_summary="",
        attempts=1,
    )

    async def fake_generate(**kwargs):
        assert kwargs["user_prompt"] == row.input_text
        assert kwargs["tool_name"] == "Agent 任务标题"
        return "2024新课标I卷阅读讲评"

    monkeypatch.setattr(chat_router, "_generate_title_once", fake_generate)
    title = asyncio.run(chat_router.execute_title_job(work))
    assert title == "2024新课标I卷阅读讲评"
    assert store.task_detail(owner, task.id)["title"] == "2024新课标I卷阅读讲评"


def test_start_run_enqueues_title_for_first_execution(owner):
    from app.routers.chat import _load_cfg

    cfg = _load_cfg()
    model = cfg.get("default_model") or cfg["models"][0]["id"]
    task = _task(owner, goal="整理必修一 Unit 3 的读后续写素材", model=model)
    api.start_run(task.id, api.RunWrite(request_key=store.uid(), mode="execute"), owner)

    row = _title_job(task.id)
    assert row.tool_id == titles.AGENT_TITLE_TOOL_ID
    assert "Unit 3" in row.input_text
    # 第一轮已存在后再次执行不应再生成标题任务。
    with SessionLocal() as db:
        db.query(TitleJob).filter(TitleJob.history_id == task.id).delete()
        db.commit()
    with SessionLocal() as db:
        run = db.query(WorkspaceTask).filter(WorkspaceTask.id == task.id).one()
        run.status = "completed"
        run.active_run = ""
        db.commit()
    api.start_run(task.id, api.RunWrite(request_key=store.uid(), mode="continue"), owner)
    with SessionLocal() as db:
        assert db.query(TitleJob).filter(TitleJob.history_id == task.id).count() == 0
        # 不把排队中的轮次留给后面的 worker 测试：它们会被别的用例先领走。
        run_ids = [row.id for row in db.query(WorkspaceRun).filter(WorkspaceRun.task_id == task.id)]
    for run_id in run_ids:
        store.finish_run(run_id, "stopped")
