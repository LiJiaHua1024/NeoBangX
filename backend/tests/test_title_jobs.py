"""持久标题任务的状态机、API 与 worker 回归测试。"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.database import SessionLocal
from app.main import app
from app.models import TitleJob, UsageCode
from app.services import title_jobs
from app.services.title_jobs import (
    TITLE_JOB_FAILED,
    TITLE_JOB_PENDING,
    TITLE_JOB_RUNNING,
    TITLE_JOB_SUCCEEDED,
    TitleJobConflictError,
    TitleJobPermanentError,
    enqueue_title_job,
    get_title_job_statuses,
    recover_running_title_jobs,
    run_title_job_worker,
)


@pytest.fixture(autouse=True)
def _clean_title_jobs():
    db = SessionLocal()
    try:
        db.query(TitleJob).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(TitleJob).delete()
        db.commit()
    finally:
        db.close()


def _make_code() -> UsageCode:
    db = SessionLocal()
    try:
        code = UsageCode(
            code="NBXJ-TITLE-" + uuid.uuid4().hex[:8].upper(),
            quota=-1,
            used_count=0,
            is_enabled=True,
            note="title job test",
        )
        db.add(code)
        db.commit()
        db.refresh(code)
        db.expunge(code)
        return code
    finally:
        db.close()


def _enqueue(code_id: int, job_id: str = "title_test_job_1", **overrides):
    params = {
        "code_id": code_id,
        "client_job_id": job_id,
        "history_id": "history_1",
        "tool_id": "1",
        "input_text": "读一篇短文并分析语言特点",
        "output_text": "文章使用了很多被动句。",
        "model": "",
    }
    params.update(overrides)
    return enqueue_title_job(**params)


def _row(job_id: str) -> TitleJob:
    db = SessionLocal()
    try:
        row = db.query(TitleJob).filter(TitleJob.client_job_id == job_id).one()
        db.expunge(row)
        return row
    finally:
        db.close()


async def _run_until_terminal(job_id: str, executor, monkeypatch, timeout: float = 2.0) -> None:
    monkeypatch.setattr(title_jobs, "_retry_delay", lambda _exc, _attempts: 0)
    task = asyncio.create_task(run_title_job_worker(executor, poll_seconds=0.01, concurrency=1))
    try:
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.01)
            if _row(job_id).status in {TITLE_JOB_SUCCEEDED, TITLE_JOB_FAILED}:
                return
        raise AssertionError("标题 worker 未在测试期限内进入终态")
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_enqueue_is_idempotent_and_rejects_payload_reuse() -> None:
    code = _make_code()
    first, created = _enqueue(code.id)
    second, created_again = _enqueue(code.id)

    assert created is True
    assert created_again is False
    assert first == second
    with pytest.raises(TitleJobConflictError):
        _enqueue(code.id, input_text="另一份内容")
    with pytest.raises(TitleJobConflictError):
        _enqueue(code.id, history_id="another_history")

    row = _row("title_test_job_1")
    assert row.status == TITLE_JOB_PENDING
    assert row.input_text.startswith("读一篇短文")


def test_title_job_api_enforces_owner_and_returns_batch_status() -> None:
    owner = _make_code()
    other = _make_code()
    app.dependency_overrides[deps.get_current_code] = lambda: owner
    client = TestClient(app)
    payload = {
        "job_id": "title_api_job_1",
        "history_id": "history_api_1",
        "tool_id": "1",
        "input": "分析这篇文章",
        "output": "文章结构清晰。",
    }
    try:
        response = client.post("/api/chat/title-jobs", json=payload)
        assert response.status_code == 202
        assert response.json()["created"] is True
        assert response.json()["status"] == TITLE_JOB_PENDING

        repeated = client.post("/api/chat/title-jobs", json=payload)
        assert repeated.status_code == 202
        assert repeated.json()["created"] is False

        conflict = client.post(
            "/api/chat/title-jobs",
            json={**payload, "output": "不同内容"},
        )
        assert conflict.status_code == 409

        status = client.post(
            "/api/chat/title-jobs/status",
            json={"job_ids": ["title_api_job_1", "title_missing_job"]},
        )
        assert status.status_code == 200
        jobs = status.json()["jobs"]
        assert jobs[0]["history_id"] == "history_api_1"
        assert jobs[1]["status"] == "missing"

        app.dependency_overrides[deps.get_current_code] = lambda: other
        foreign = client.post(
            "/api/chat/title-jobs/status",
            json={"job_ids": ["title_api_job_1"]},
        )
        assert foreign.json()["jobs"][0]["status"] == "missing"
    finally:
        app.dependency_overrides.pop(deps.get_current_code, None)
        client.close()


def test_accepted_job_can_be_replayed_after_config_or_rate_limit_changes(monkeypatch) -> None:
    from app.routers import chat as chat_router

    code = _make_code()
    app.dependency_overrides[deps.get_current_code] = lambda: code
    client = TestClient(app)
    payload = {
        "job_id": "title_replay_job",
        "history_id": "history_replay",
        "tool_id": "1",
        "input": "分析标题",
        "output": "分析正文",
    }
    try:
        assert client.post("/api/chat/title-jobs", json=payload).status_code == 202
        monkeypatch.setattr(
            chat_router,
            "enforce_rate_limit",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("不应限流")),
        )
        monkeypatch.setattr(chat_router, "_resolve_prompt_filename", lambda _tool_id: "")
        replay = client.post("/api/chat/title-jobs", json=payload)
        assert replay.status_code == 202
        assert replay.json()["created"] is False
    finally:
        app.dependency_overrides.pop(deps.get_current_code, None)
        client.close()


def test_worker_success_clears_payload_and_exposes_title(monkeypatch) -> None:
    code = _make_code()
    _enqueue(code.id, job_id="title_success_job")
    calls = []

    async def executor(work):
        calls.append(work.client_job_id)
        return "语言特点分析"

    asyncio.run(_run_until_terminal("title_success_job", executor, monkeypatch))
    row = _row("title_success_job")
    assert calls == ["title_success_job"]
    assert row.status == TITLE_JOB_SUCCEEDED
    assert row.title == "语言特点分析"
    assert row.input_text == ""
    assert row.output_text == ""


def test_worker_retries_retryable_failures_exactly_three_times(monkeypatch) -> None:
    code = _make_code()
    _enqueue(code.id, job_id="title_retry_job")
    calls = []

    async def executor(_work):
        calls.append(1)
        raise RuntimeError("temporary upstream failure")

    asyncio.run(_run_until_terminal("title_retry_job", executor, monkeypatch))
    row = _row("title_retry_job")
    assert calls == [1, 1, 1]
    assert row.attempts == 3
    assert row.status == TITLE_JOB_FAILED
    assert row.input_text == ""
    assert row.output_text == ""


def test_worker_recovers_when_failure_state_write_temporarily_errors(monkeypatch) -> None:
    code = _make_code()
    _enqueue(code.id, job_id="title_state_retry_job")
    calls = []
    original_mark = title_jobs.mark_title_job_retry_or_failed
    writes = []

    async def executor(_work):
        calls.append(1)
        raise RuntimeError("temporary upstream failure")

    def flaky_mark(*args, **kwargs):
        writes.append(1)
        if len(writes) == 1:
            raise RuntimeError("temporary database failure")
        return original_mark(*args, **kwargs)

    monkeypatch.setattr(title_jobs, "mark_title_job_retry_or_failed", flaky_mark)
    asyncio.run(_run_until_terminal("title_state_retry_job", executor, monkeypatch))
    row = _row("title_state_retry_job")
    assert row.status == TITLE_JOB_FAILED
    assert row.attempts == 3
    assert len(calls) == 3


def test_worker_does_not_retry_permanent_failure(monkeypatch) -> None:
    code = _make_code()
    _enqueue(code.id, job_id="title_permanent_job")
    calls = []

    async def executor(_work):
        calls.append(1)
        raise TitleJobPermanentError("model disabled")

    asyncio.run(_run_until_terminal("title_permanent_job", executor, monkeypatch))
    row = _row("title_permanent_job")
    assert calls == [1]
    assert row.attempts == 1
    assert row.status == TITLE_JOB_FAILED


def test_running_job_is_recovered_after_restart() -> None:
    code = _make_code()
    _enqueue(code.id, job_id="title_restart_job")
    db = SessionLocal()
    try:
        row = db.query(TitleJob).filter(TitleJob.client_job_id == "title_restart_job").one()
        row.status = TITLE_JOB_RUNNING
        row.attempts = 1
        db.commit()
    finally:
        db.close()

    assert recover_running_title_jobs() == 1
    db = SessionLocal()
    try:
        row = db.query(TitleJob).filter(TitleJob.client_job_id == "title_restart_job").one()
        assert row.status == TITLE_JOB_PENDING
        assert row.attempts == 1
    finally:
        db.close()


def test_status_lookup_only_returns_owned_jobs() -> None:
    owner = _make_code()
    other = _make_code()
    _enqueue(owner.id, job_id="title_owned_job")
    statuses = get_title_job_statuses(other.id, ["title_owned_job"])
    assert statuses == [
        {
            "job_id": "title_owned_job",
            "history_id": "",
            "status": "missing",
            "title": "",
            "payload_hash": "",
        }
    ]
