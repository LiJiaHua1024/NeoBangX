"""持久化标题任务：幂等入队、后台执行与状态恢复。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import timedelta
from time import monotonic

from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import TitleJob, utcnow
from app.services.llm_router import EmptyResponseError, is_retryable

logger = logging.getLogger(__name__)

TITLE_JOB_PENDING = "pending"
TITLE_JOB_RUNNING = "running"
TITLE_JOB_SUCCEEDED = "succeeded"
TITLE_JOB_FAILED = "failed"
TITLE_JOB_MAX_ATTEMPTS = 3
TITLE_JOB_RETENTION_DAYS = 7
TITLE_JOB_POLL_SECONDS = 0.5
TITLE_JOB_CONCURRENCY = 2
TITLE_JOB_CLEANUP_SECONDS = 3600

_wake_event: asyncio.Event | None = None


class TitleJobConflictError(ValueError):
    """同一幂等 ID 被用于不同 payload。"""


class TitleJobPermanentError(RuntimeError):
    """重试也不会改善的任务错误。"""


@dataclass(frozen=True)
class TitleJobWork:
    id: int
    code_id: int
    client_job_id: str
    history_id: str
    tool_id: str
    input_text: str
    output_text: str
    model: str
    ip: str
    user_agent: str
    fingerprint: str
    device_summary: str
    attempts: int


def title_payload_hash(
    *,
    history_id: str,
    tool_id: str,
    input_text: str,
    output_text: str,
    model: str,
) -> str:
    payload = json.dumps(
        [history_id, tool_id, input_text, output_text, model],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _clip_error(exc: BaseException | str) -> str:
    text = " ".join(str(exc).split()) or exc.__class__.__name__
    return text[:500]


def _job_status(job: TitleJob) -> dict:
    return {
        "job_id": job.client_job_id,
        "history_id": job.history_id,
        "status": job.status,
        "title": job.title or "",
        "payload_hash": job.payload_hash or "",
    }


def find_title_job(
    *,
    code_id: int,
    client_job_id: str,
    payload_hash: str,
) -> dict | None:
    """查询已接受任务；配置变化或限流后仍可安全重试同一幂等 ID。"""
    with SessionLocal() as db:
        job = (
            db.query(TitleJob)
            .filter(
                TitleJob.code_id == code_id,
                TitleJob.client_job_id == client_job_id,
            )
            .first()
        )
        if job is None:
            return None
        if job.payload_hash != payload_hash:
            raise TitleJobConflictError("同一标题任务 ID 不能提交不同内容")
        return _job_status(job)


def enqueue_title_job(
    *,
    code_id: int,
    client_job_id: str,
    history_id: str,
    tool_id: str,
    input_text: str,
    output_text: str,
    model: str,
    ip: str = "",
    user_agent: str = "",
    fingerprint: str = "",
    device_summary: str = "",
) -> tuple[dict, bool]:
    """幂等创建任务，返回 ``(状态, 是否新建)``。"""
    payload_hash = title_payload_hash(
        history_id=history_id,
        tool_id=tool_id,
        input_text=input_text,
        output_text=output_text,
        model=model,
    )
    with SessionLocal() as db:
        existing = (
            db.query(TitleJob)
            .filter(
                TitleJob.code_id == code_id,
                TitleJob.client_job_id == client_job_id,
            )
            .first()
        )
        if existing is not None:
            if existing.payload_hash != payload_hash:
                raise TitleJobConflictError("同一标题任务 ID 不能提交不同内容")
            return _job_status(existing), False

        job = TitleJob(
            code_id=code_id,
            client_job_id=client_job_id,
            history_id=history_id,
            tool_id=tool_id,
            input_text=input_text,
            output_text=output_text,
            model=model or "",
            payload_hash=payload_hash,
            ip=ip,
            user_agent=user_agent,
            fingerprint=fingerprint,
            device_summary=device_summary,
            status=TITLE_JOB_PENDING,
            attempts=0,
        )
        db.add(job)
        try:
            db.commit()
        except IntegrityError:
            # 同一幂等 ID 的并发重复提交：另一请求已经落库，按 payload 校验后复用。
            db.rollback()
            existing = (
                db.query(TitleJob)
                .filter(
                    TitleJob.code_id == code_id,
                    TitleJob.client_job_id == client_job_id,
                )
                .first()
            )
            if existing is None:
                raise
            if existing.payload_hash != payload_hash:
                raise TitleJobConflictError("同一标题任务 ID 不能提交不同内容")
            return _job_status(existing), False
        db.refresh(job)
        return _job_status(job), True


def get_title_job_statuses(code_id: int, job_ids: Iterable[str]) -> list[dict]:
    ids = list(dict.fromkeys(str(value).strip() for value in job_ids if str(value).strip()))
    if not ids:
        return []
    with SessionLocal() as db:
        rows = (
            db.query(TitleJob)
            .filter(TitleJob.code_id == code_id, TitleJob.client_job_id.in_(ids))
            .all()
        )
        by_id = {row.client_job_id: _job_status(row) for row in rows}
    return [
        by_id.get(
            job_id,
            {
                "job_id": job_id,
                "history_id": "",
                "status": "missing",
                "title": "",
                "payload_hash": "",
            },
        )
        for job_id in ids
    ]


def recover_running_title_jobs(exclude_ids: Iterable[int] | None = None) -> int:
    """恢复上次进程退出或状态落库失败时遗留在 running 的任务。"""
    excluded = {int(value) for value in (exclude_ids or [])}
    with SessionLocal() as db:
        query = db.query(TitleJob).filter(TitleJob.status == TITLE_JOB_RUNNING)
        if excluded:
            query = query.filter(~TitleJob.id.in_(excluded))
        rows = query.all()
        now = utcnow()
        for job in rows:
            if job.attempts >= TITLE_JOB_MAX_ATTEMPTS:
                job.status = TITLE_JOB_FAILED
                job.error_message = "服务重启前任务未完成"
                job.input_text = ""
                job.output_text = ""
                job.completed_at = now
            else:
                job.status = TITLE_JOB_PENDING
                job.next_attempt_at = now
            job.updated_at = now
        db.commit()
        return len(rows)


def claim_next_title_job() -> TitleJobWork | None:
    """认领一个到期任务，并持久化递增后的尝试次数。"""
    now = utcnow()
    with SessionLocal() as db:
        job = (
            db.query(TitleJob)
            .filter(
                TitleJob.status == TITLE_JOB_PENDING,
                TitleJob.next_attempt_at <= now,
            )
            .order_by(TitleJob.next_attempt_at.asc(), TitleJob.id.asc())
            .first()
        )
        if job is None:
            return None
        next_attempt = int(job.attempts or 0) + 1
        work = TitleJobWork(
            id=job.id,
            code_id=job.code_id,
            client_job_id=job.client_job_id,
            history_id=job.history_id,
            tool_id=job.tool_id,
            input_text=job.input_text,
            output_text=job.output_text,
            model=job.model,
            ip=job.ip,
            user_agent=job.user_agent,
            fingerprint=job.fingerprint,
            device_summary=job.device_summary,
            attempts=next_attempt,
        )
        updated = (
            db.query(TitleJob)
            .filter(TitleJob.id == job.id, TitleJob.status == TITLE_JOB_PENDING)
            .update(
                {
                    TitleJob.status: TITLE_JOB_RUNNING,
                    TitleJob.attempts: next_attempt,
                    TitleJob.next_attempt_at: now,
                    TitleJob.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        if not updated:
            db.rollback()
            return None
        db.commit()
        return work


def mark_title_job_succeeded(job_id: int, title: str) -> None:
    now = utcnow()
    with SessionLocal() as db:
        job = db.get(TitleJob, job_id)
        if job is None:
            return
        job.status = TITLE_JOB_SUCCEEDED
        job.title = title[:128]
        job.error_message = ""
        job.input_text = ""
        job.output_text = ""
        job.completed_at = now
        job.updated_at = now
        db.commit()


def mark_title_job_retry_or_failed(
    job_id: int,
    *,
    error: BaseException | str,
    retryable: bool,
    delay_seconds: float,
) -> None:
    now = utcnow()
    with SessionLocal() as db:
        job = db.get(TitleJob, job_id)
        if job is None:
            return
        job.error_message = _clip_error(error)
        job.updated_at = now
        if retryable and job.attempts < TITLE_JOB_MAX_ATTEMPTS:
            job.status = TITLE_JOB_PENDING
            job.next_attempt_at = now + timedelta(seconds=max(0, delay_seconds))
            db.commit()
            return
        job.status = TITLE_JOB_FAILED
        job.input_text = ""
        job.output_text = ""
        job.completed_at = now
        db.commit()


def release_title_job(job_id: int) -> None:
    """worker 被取消时释放认领，避免任务永久卡在 running。"""
    now = utcnow()
    with SessionLocal() as db:
        job = db.get(TitleJob, job_id)
        if job is None or job.status != TITLE_JOB_RUNNING:
            return
        if job.attempts >= TITLE_JOB_MAX_ATTEMPTS:
            job.status = TITLE_JOB_FAILED
            job.error_message = "任务因服务停止而未完成"
            job.input_text = ""
            job.output_text = ""
            job.completed_at = now
        else:
            job.status = TITLE_JOB_PENDING
            job.next_attempt_at = now
        job.updated_at = now
        db.commit()


def purge_terminal_title_jobs() -> int:
    cutoff = utcnow() - timedelta(days=TITLE_JOB_RETENTION_DAYS)
    with SessionLocal() as db:
        deleted = (
            db.query(TitleJob)
            .filter(
                TitleJob.status.in_((TITLE_JOB_SUCCEEDED, TITLE_JOB_FAILED)),
                TitleJob.completed_at.is_not(None),
                TitleJob.completed_at < cutoff,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(deleted)


def _exception_status(exc: BaseException) -> int | None:
    for candidate in (
        getattr(exc, "status_code", None),
        getattr(exc, "code", None),
        getattr(getattr(exc, "response", None), "status_code", None),
    ):
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        if 100 <= value <= 599:
            return value
    return None


def is_title_retryable(exc: BaseException) -> bool:
    """标题任务层重试分类；单次尝试内部仍由 LLMRouter 做 Provider fallback。"""
    if isinstance(exc, TitleJobPermanentError):
        return False
    if isinstance(exc, EmptyResponseError):
        return True
    if not is_retryable(exc):  # type: ignore[arg-type]
        return False

    status = _exception_status(exc)
    if status is not None:
        if status in {400, 401, 402, 403, 404, 405, 409, 422}:
            return False
        return status in {408, 425, 429} or status >= 500

    name = exc.__class__.__name__.lower()
    message = str(exc).lower()
    permanent_markers = (
        "authentication",
        "permission",
        "notfound",
        "badrequest",
        "未绑定任何可用 provider",
        "模型不可用",
        "模型已禁用",
        "未配置",
    )
    return not any(marker in name or marker in message for marker in permanent_markers)


def _retry_delay(exc: BaseException, attempts: int) -> float:
    response = getattr(exc, "response", None)
    headers = getattr(exc, "headers", None) or getattr(response, "headers", None)
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is None and headers is not None:
        retry_after = headers.get("retry-after") or headers.get("Retry-After")
    try:
        if retry_after is not None:
            return min(30.0, max(0.0, float(retry_after)))
    except (TypeError, ValueError):
        pass
    return min(8.0, float(2 ** max(0, attempts - 1)))


def wake_title_job_worker() -> None:
    event = _wake_event
    if event is not None:
        event.set()


async def _execute_title_job(
    executor: Callable[[TitleJobWork], Awaitable[str]],
    work: TitleJobWork,
) -> None:
    try:
        title = await executor(work)
    except asyncio.CancelledError:
        await asyncio.to_thread(release_title_job, work.id)
        raise
    except Exception as exc:  # noqa: BLE001 - worker 必须把任何失败都写回任务状态
        retryable = is_title_retryable(exc)
        logger.warning(
            "标题任务失败：job=%s attempt=%s/%s retryable=%s error=%s",
            work.client_job_id,
            work.attempts,
            TITLE_JOB_MAX_ATTEMPTS,
            retryable,
            exc,
        )
        await asyncio.to_thread(
            mark_title_job_retry_or_failed,
            work.id,
            error=exc,
            retryable=retryable,
            delay_seconds=_retry_delay(exc, work.attempts),
        )
    else:
        await asyncio.to_thread(mark_title_job_succeeded, work.id, title)


async def run_title_job_worker(
    executor: Callable[[TitleJobWork], Awaitable[str]],
    *,
    poll_seconds: float = TITLE_JOB_POLL_SECONDS,
    concurrency: int = TITLE_JOB_CONCURRENCY,
) -> None:
    """应用生命周期内运行标题 worker；重启后从数据库继续未完成任务。"""
    global _wake_event

    await asyncio.to_thread(recover_running_title_jobs)
    await asyncio.to_thread(purge_terminal_title_jobs)
    _wake_event = asyncio.Event()
    task_error = asyncio.Event()
    active: set[asyncio.Task] = set()
    last_cleanup = monotonic()

    def _task_done(task: asyncio.Task) -> None:
        active.discard(task)
        if task.cancelled():
            return
        try:
            error = task.exception()
        except asyncio.CancelledError:
            return
        if error is not None:
            logger.error("标题 worker 子任务异常，等待恢复该任务: %r", error)
            task_error.set()
        if _wake_event is not None:
            _wake_event.set()

    try:
        while True:
            now = monotonic()
            if now - last_cleanup >= TITLE_JOB_CLEANUP_SECONDS:
                await asyncio.to_thread(purge_terminal_title_jobs)
                last_cleanup = now
            if task_error.is_set() and not active:
                await asyncio.to_thread(recover_running_title_jobs)
                task_error.clear()

            claimed = 0
            while len(active) < max(1, concurrency):
                work = await asyncio.to_thread(claim_next_title_job)
                if work is None:
                    break
                task = asyncio.create_task(_execute_title_job(executor, work))
                active.add(task)
                task.add_done_callback(_task_done)
                claimed += 1
            if claimed:
                continue

            timeout = poll_seconds
            if task_error.is_set() or _wake_event.is_set():
                _wake_event.clear()
                timeout = 0.01
            try:
                await asyncio.wait_for(_wake_event.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                pass
    finally:
        _wake_event = None
        for task in list(active):
            task.cancel()
        if active:
            await asyncio.gather(*active, return_exceptions=True)
