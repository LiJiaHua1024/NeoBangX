"""计费口径：预扣的 1 次只在「本轮没有产出任何成果」的失败/停止时退回。

`create_document` 在运行中途就会提交完整版本，所以"等到成果出现再点停止"
曾经能把额度退回来，一次付费产出无限份成果。这里钉住退款的前提条件。
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.agent_workspace import api, store
from app.agent_workspace.models import WorkspaceRun, WorkspaceTask
from app.database import SessionLocal
from app.models import UsageCode, UsageLog

SNAPSHOT = {
    "model": "test",
    "limits": {"max_steps": 4, "max_tokens": 200000, "output_tokens": 16000, "max_seconds": 60},
    "templates": {},
}


def _task(owner: int) -> str:
    with SessionLocal() as db:
        row = WorkspaceTask(
            id=store.uid(),
            owner=owner,
            title="计费测试",
            config=store.encode(api.TaskConfig(goal="根据材料分析", model="test", review=False).model_dump()),
        )
        db.add(row)
        db.commit()
        return row.id


def _charged_run(owner: int, task_id: str) -> str:
    return store.create_run(owner, task_id, store.uid(), "execute", "", "", SNAPSHOT, True)["id"]


def _used(owner: int) -> int:
    with SessionLocal() as db:
        return db.get(UsageCode, owner).used_count


def _charged_flag(run_id: str) -> bool:
    with SessionLocal() as db:
        return db.get(WorkspaceRun, run_id).charged


def _log_units(run_id: str) -> int:
    with SessionLocal() as db:
        return db.scalar(select(UsageLog).where(UsageLog.request_id == run_id)).units


def _deliver(task_id: str, run_id: str) -> None:
    store.save_version(task_id, run_id, store.uid(), "成果", "完整正文", origin="agent")


@pytest.mark.parametrize("status", ["stopped", "failed"])
def test_delivered_version_is_still_charged(workspace_code, status):
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    assert _used(owner) == 1

    _deliver(task_id, run_id)
    store.finish_run(run_id, status)

    assert _used(owner) == 1, "已产出成果的轮次不退额度"
    assert _charged_flag(run_id) is True
    assert _log_units(run_id) == 1


@pytest.mark.parametrize("status", ["stopped", "failed"])
def test_failure_without_delivery_refunds(workspace_code, status):
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    assert _used(owner) == 1

    store.finish_run(run_id, status)

    assert _used(owner) == 0, "什么都没产出时应该退回预扣的那一次"
    assert _charged_flag(run_id) is False
    assert _log_units(run_id) == 0


def test_incomplete_run_neither_refunds_nor_charges_twice(workspace_code):
    """`incomplete` 是"内容已保存但未完成"：不退款，也不重复扣。"""
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)

    store.finish_run(run_id, "incomplete")

    assert _used(owner) == 1
    assert _charged_flag(run_id) is True


def test_stop_loop_cannot_mint_extra_documents(workspace_code):
    """复现原始漏洞：quota=1 时"落文档→停止"循环曾经能无限产出成果。"""
    owner, _ = workspace_code("BILL-", quota=1)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    _deliver(task_id, run_id)
    store.finish_run(run_id, "stopped")

    assert _used(owner) == 1
    with pytest.raises(HTTPException) as exc:
        _charged_run(owner, task_id)
    assert exc.value.status_code == 403
