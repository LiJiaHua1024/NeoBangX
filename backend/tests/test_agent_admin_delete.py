"""管理端删除使用码：有在途轮次时拒绝，删除后 worker 收尾不能崩。

工作台的每个表都用 `ondelete="CASCADE"` 挂在 `usage_codes.id` 上，
管理员一次删除会把该用户的全部任务、材料、成果一起销毁。
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.admin_main import app as admin_app
from app.agent_workspace import api, store
from app.agent_workspace.models import WorkspaceRun, WorkspaceTask
from app.database import SessionLocal
from app.models import UsageLog


def _task(owner: int) -> str:
    with SessionLocal() as db:
        row = WorkspaceTask(id=store.uid(), owner=owner, title="待删任务",
                            config=store.encode(api.TaskConfig(goal="分析", model="test", review=False).model_dump()))
        db.add(row)
        db.commit()
        return row.id


def _run(owner: int, task_id: str) -> str:
    snapshot = {"model": "test", "limits": {"max_steps": 2, "max_tokens": 1000, "output_tokens": 500, "max_seconds": 30}, "templates": {}}
    return store.create_run(owner, task_id, store.uid(), "execute", "", "", snapshot, True)["id"]


def test_delete_code_with_active_run_is_rejected(workspace_code):
    owner, _ = workspace_code("DEL-", quota=5)
    run_id = _run(owner, _task(owner))

    client = TestClient(admin_app)
    assert client.delete(f"/api/admin/codes/{owner}").status_code == 409
    with SessionLocal() as db:
        assert db.get(WorkspaceRun, run_id) is not None

    store.finish_run(run_id, "stopped")
    assert client.delete(f"/api/admin/codes/{owner}").status_code == 200
    with SessionLocal() as db:
        assert db.get(WorkspaceRun, run_id) is None


def test_finish_run_survives_cascade_deleted_task(workspace_code):
    """绕过 409 直接删库也不会让 worker 抛异常、丢失计费终态。"""
    owner, _ = workspace_code("DEL-", quota=5)
    run_id = _run(owner, _task(owner))
    with SessionLocal() as db:
        db.delete(db.get(WorkspaceTask, db.get(WorkspaceRun, run_id).task_id))
        db.commit()
        assert db.get(WorkspaceRun, run_id) is None  # 级联删掉了本轮

    store.finish_run(run_id, "stopped")  # 不抛异常
    with SessionLocal() as db:
        log = db.scalar(select(UsageLog).where(UsageLog.request_id == run_id))
        assert log is not None and log.status == "cancelled", "在途 worker 收尾时仍要落计费终态"
