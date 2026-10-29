"""计费口径：预扣的 1 次只在「本轮没有产出任何成果」的失败/停止时退回。

`create_document` 在运行中途就会提交完整版本，所以"等到成果出现再点停止"
曾经能把额度退回来，一次付费产出无限份成果。这里钉住退款的前提条件。
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.agent_workspace import api, store
from app.agent_workspace.models import WorkspaceRun, WorkspaceTask
from app.database import SessionLocal
from app.models import UsageCode, UsageLog, utcnow

SNAPSHOT = {
    "model": "test",
    "limits": {"max_steps": 4, "max_tokens": 200000, "output_tokens": 16000, "max_seconds": 60},
    "templates": {},
}


def _task(owner: int, model: str = "test") -> str:
    with SessionLocal() as db:
        row = WorkspaceTask(
            id=store.uid(),
            owner=owner,
            title="计费测试",
            config=store.encode(api.TaskConfig(goal="根据材料分析", model=model, review=False).model_dump()),
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


def test_incomplete_run_that_did_work_is_not_refunded(workspace_code):
    """`incomplete` 且已经跑过步骤：内容已保存，不退款也不重复扣。"""
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    with SessionLocal() as db:
        db.get(WorkspaceRun, run_id).step = 2
        db.commit()

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


def test_recover_runs_settles_a_stop_that_never_reached_its_second_commit(workspace_code):
    """`stop_run` 第二段提交失败会把轮次留在 `stopping` 且 lease 为 NULL：
    恢复时必须落终态并退款，否则任务删不掉、额度也拿不回来。"""
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        row.status, row.stop, row.lease = "stopping", True, None
        db.get(WorkspaceTask, task_id).status = "stopping"
        db.commit()

    store.recover_runs()

    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        assert row.status == "stopped"
        assert db.get(WorkspaceTask, task_id).status == "stopped"
    assert _used(owner) == 0, "没产出成果的停止要退额度"
    assert _charged_flag(run_id) is False


def test_recover_runs_requeues_a_crashed_run_without_stop_request(workspace_code):
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        row.status, row.lease = "running", None
        db.commit()

    store.recover_runs()

    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        assert row.status == "queued" and row.lease is None
        assert db.get(WorkspaceTask, task_id).status == "queued"
    assert _used(owner) == 1


def test_resumed_run_gets_a_fresh_wall_clock_budget(workspace_code):
    """崩溃后恢复的轮次沿用旧的 started_at，会让 max_seconds 立刻为负、一步都跑不了。"""
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    long_ago = utcnow() - timedelta(days=3)
    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        row.status, row.started_at, row.lease = "queued", long_ago, None
        db.commit()
    store.claim_run()
    with SessionLocal() as db:
        row = db.get(WorkspaceRun, run_id)
        assert row.status == "running"
        assert (utcnow() - row.started_at).total_seconds() < 60, "领取时应重置墙钟起点"
    store.finish_run(run_id, "stopped")


def test_incomplete_run_without_any_step_refunds(workspace_code):
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    assert _used(owner) == 1
    store.finish_run(run_id, "incomplete", "达到本轮时长上限，已收到的内容已保存")
    assert _used(owner) == 0, "一步都没走的 incomplete 要退额度"
    assert _charged_flag(run_id) is False


def test_incomplete_run_with_steps_keeps_the_charge(workspace_code):
    owner, _ = workspace_code("BILL-", quota=5)
    task_id = _task(owner)
    run_id = _charged_run(owner, task_id)
    with SessionLocal() as db:
        db.get(WorkspaceRun, run_id).step = 3
        db.commit()
    store.finish_run(run_id, "incomplete")
    assert _used(owner) == 1, "已经跑过步骤的轮次不退"


# ---------------- 免费模型与 Agent 免费 ----------------

def _cfg(model: str, **entry) -> dict:
    """只够开新执行的一份配置：模型要勾 Agent、要有启用的 Provider。"""
    return {
        "models": [{"id": model, "name": model, "enabled": True, "agent_usable": True, **entry}],
        "providers": [{"id": "p_bill", "name": "计费测试 Provider", "enabled": True,
                       "base_url": "", "api_key": "k"}],
        "model_provider_map": {model: ["p_bill"]},
        "default_model": model,
    }


@pytest.fixture
def quiet_titles(monkeypatch):
    """开新执行会顺手排一个标题任务；这些用例只关心计费，别让标题链路掺进来。"""
    monkeypatch.setattr(api.titles, "enqueue_agent_title", lambda *args, **kwargs: None)


def test_main_site_free_model_is_charged_in_agent(workspace_code, monkeypatch, quiet_titles):
    """主站免费不等于工作台免费：没勾 agent_free 时，一轮仍扣 1 次。"""
    owner, _ = workspace_code("BILL-", quota=5)
    monkeypatch.setattr(api, "_load_cfg", lambda: _cfg("free/model", is_free=True))
    task_id = _task(owner, model="free/model")

    run_id = api.start_run(task_id, api.RunWrite(request_key=store.uid(), mode="execute"), owner)["id"]

    assert _used(owner) == 1
    assert _log_units(run_id) == 1


def test_agent_free_model_does_not_charge(workspace_code, monkeypatch, quiet_titles):
    owner, _ = workspace_code("BILL-", quota=5)
    monkeypatch.setattr(api, "_load_cfg", lambda: _cfg("free/model", is_free=True, agent_free=True))
    task_id = _task(owner, model="free/model")

    run_id = api.start_run(task_id, api.RunWrite(request_key=store.uid(), mode="execute"), owner)["id"]

    assert _used(owner) == 0
    assert _log_units(run_id) == 0


def test_agent_free_limits_count_runs_not_main_site_calls(workspace_code, monkeypatch, quiet_titles):
    """Agent 限额按轮次计、与主站分池：主站那一套分钟级限额既不吃轮次，也不被轮次吃掉。"""
    from app.services.free_access import register_free_use

    owner, _ = workspace_code("BILL-", quota=5)
    entry = _cfg("free/model", is_free=True, agent_free=True,
                 free_limits={"minute": 1}, agent_free_limits={"hour": 1})
    monkeypatch.setattr(api, "_load_cfg", lambda: entry)
    first = _task(owner, model="free/model")
    api.start_run(first, api.RunWrite(request_key=store.uid(), mode="execute"), owner)

    # 主站限额 1 次/分钟：这一轮不能算进主站的窗口（否则这里会 429）
    release = register_free_use(entry=entry["models"][0], identity=f"code:{owner}")
    release()

    # Agent 限额 1 轮/小时：第二轮要被拦下，且文案说清是 Agent 的限额
    second = _task(owner, model="free/model")
    with pytest.raises(HTTPException) as exc:
        api.start_run(second, api.RunWrite(request_key=store.uid(), mode="execute"), owner)
    assert exc.value.status_code == 429
    assert "Agent" in str(exc.value.detail)


def test_agent_run_does_not_consume_main_site_free_limit(workspace_code, monkeypatch, quiet_titles):
    """反过来也要成立：工作台的轮次不进主站的免费次数窗口。"""
    from app.services.free_access import register_free_use

    owner, _ = workspace_code("BILL-", quota=5)
    entry = _cfg("free/model", is_free=True, agent_free=True, free_limits={"minute": 1})
    monkeypatch.setattr(api, "_load_cfg", lambda: entry)
    task_id = _task(owner, model="free/model")
    api.start_run(task_id, api.RunWrite(request_key=store.uid(), mode="execute"), owner)

    # 主站窗口还能正常放行（若 Agent 行被算进来，这里会 429）
    release = register_free_use(entry=entry["models"][0], identity=f"code:{owner}")
    release()
