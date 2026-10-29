"""管理后台「Agent 运行全解」接口的回归测试。

覆盖：一轮执行还原成步骤序列、正文分页（跨 chunk 边界）、种类白名单、
日志与步骤的归属校验、运行记录缺失、列表里的 Agent 摘要。
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.admin_main import app as admin_app
from app.agent_workspace import api, store
from app.agent_workspace.models import WorkspaceTask
from app.database import SessionLocal
from app.models import UsageCode, UsageLog


@pytest.fixture
def identity(workspace_code):
    return workspace_code("REPORT-", quota=20)


@pytest.fixture
def admin():
    return TestClient(admin_app)


def _task(identity, title="讲评这套卷子"):
    with SessionLocal() as db:
        row = WorkspaceTask(id=store.uid(), owner=identity[0], title=title,
                            config=store.encode(api.TaskConfig(goal="把错题讲清楚", model="test-model").model_dump()))
        db.add(row)
        db.commit()
        return store.task_dict(row, True)


def _run(identity, task, *, finish=True, key=None):
    snapshot = {
        "model": "test-model",
        "limits": {"max_steps": 8, "max_tokens": 2000000, "output_tokens": 16000,
                   "max_seconds": 600, "context_budget": 262144, "keep_tail_steps": 4},
        "provider": "prov-a",
        "preferred_provider": "prov-a",
        "switches": [{"from": "prov-a", "to": "prov-b", "step": 2}],
        "usage": {"prompt": 5000, "cached": 3000, "completion": 700, "cached_reported": True},
        "instruction": "重点讲第三题",
    }
    run = store.create_run(identity[0], task["id"], key or f"run-{uuid.uuid4().hex[:12]}",
                           "execute", "重点讲第三题", "", snapshot, True)
    if finish:
        store.finish_run(run["id"], "completed")
    else:
        # 队列里的轮次不会进入 running：用直接改状态模拟「执行中」，
        # 免得 finish_run 把测试想看的 live 状态提前收掉。
        with SessionLocal() as db:
            from app.agent_workspace.models import WorkspaceRun

            row = db.get(WorkspaceRun, run["id"])
            row.status = "running"
            db.commit()
    return run


def _log_id(run_id):
    with SessionLocal() as db:
        return db.scalar(select(UsageLog.id).where(UsageLog.request_id == run_id,
                                                   UsageLog.tool_id == "agent"))


def _model_entry(task, run, *, prompt="", output="", reasoning="", details=None):
    entry = store.start_entry(task["id"], run["id"], store.uid(), "model", "执行步骤 1",
                              {"model": "test-model", "role": "agent", "context_tokens": 5000})
    store.append_chunks(entry["id"], {"prompt": prompt, "output": output, "reasoning": reasoning})
    store.finish_entry(entry["id"], "done", details or {
        "usage": {"prompt_tokens": 5000, "completion_tokens": 700},
        "cached_tokens": 1200, "provider_id": "prov-b", "attempts": 2,
        "context_tokens": 5000, "finish_reason": "stop",
    })
    return entry["id"]


def _tool_entry(task, run, *, args='{"material_id":"m1"}', result=None):
    entry = store.start_entry(task["id"], run["id"], store.uid(), "tool", "read_material")
    store.append_chunks(entry["id"], {"input": args})
    store.finish_tool(entry["id"], result if result is not None else {"name": "卷子", "content": "题干"})
    return entry["id"]


def _compaction_entry(task, run):
    stats = {"reason": "pressure", "before": 48000, "after": 14300, "dropped_units": 6,
             "kept_units": 4, "kept_notes": 1, "digest_chars": 900}
    entry = store.start_entry(task["id"], run["id"], store.uid(), "compaction", "压缩上下文", stats)
    store.finish_entry(entry["id"], "done", stats)
    return entry["id"]


def _review_entry(task, run):
    entry = store.start_entry(task["id"], run["id"], store.uid(), "review", "开放式审阅",
                              {"version_id": "v1", "model": "test-model"})
    store.append_chunks(entry["id"], {"review": json.dumps(
        {"summary": "整体可用", "issues": []}, ensure_ascii=False)})
    store.finish_entry(entry["id"], "done", {"review_summary": "整体可用", "issues": 0})
    return entry["id"]


def _seed(identity, *, finish=True):
    task = _task(identity)
    run = _run(identity, task, finish=finish)
    prompt = json.dumps({"messages": [{"role": "system", "content": "规则"}],
                         "tools": []}, ensure_ascii=False)
    text = "0123456789" * 500
    model_id = _model_entry(task, run, prompt=prompt, output=text, reasoning="先看题目")
    _tool_entry(task, run)
    _compaction_entry(task, run)
    _review_entry(task, run)
    store.save_version(task["id"], run["id"], "v1", "讲评稿", "正文", "", "agent", True)
    return task, run, _log_id(run["id"]), model_id, prompt, text


def test_agent_run_report_shape(admin, identity):
    task, run, log_id, model_id, prompt, text = _seed(identity)
    response = admin.get(f"/api/admin/logs/{log_id}/agent-run")
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["task"] == {"id": task["id"], "title": "讲评这套卷子", "goal": "把错题讲清楚"}
    assert data["log"]["tool_id"] == "agent"
    assert data["log"]["prompt_tokens"] == 5000
    assert data["run"]["id"] == run["id"]
    assert data["run"]["model"] == "test-model"
    assert data["run"]["limits"]["max_tokens"] == 2000000
    assert data["run"]["limits"]["context_budget"] == 262144
    assert data["run"]["usage"] == {"prompt": 5000, "cached": 3000, "completion": 700,
                                    "cached_reported": True}
    assert data["run"]["switches"] == [{"from": "prov-a", "to": "prov-b", "step": 2}]
    assert data["run"]["instruction"] == "重点讲第三题"
    assert [v["title"] for v in data["run"]["versions"]] == ["讲评稿"]
    assert data["run"]["live"] is False

    kinds = [entry["kind"] for entry in data["entries"]]
    assert kinds == ["model", "tool", "compaction", "review"]
    offsets = [entry["offset_ms"] for entry in data["entries"]]
    assert offsets == sorted(offsets)
    assert data["summary"] == {"entries": 4, "model_calls": 1, "tool_calls": 1, "reviews": 1,
                               "compactions": 1, "waiting": 0, "text_chars": sum(
                                   sum(entry["text_sizes"].values()) for entry in data["entries"])}

    model = data["entries"][0]
    assert model["text_sizes"]["prompt"] == len(prompt)
    assert model["text_sizes"]["output"] == len(text)
    assert model["details"]["provider_id"] == "prov-b"
    assert model["details"]["cached_tokens"] == 1200
    assert data["entries"][1]["text_sizes"]["input"] == len('{"material_id":"m1"}')
    assert data["entries"][2]["details"]["before"] == 48000


def test_agent_run_requires_agent_log(admin, identity):
    with SessionLocal() as db:
        code = db.get(UsageCode, identity[0])
        log = UsageLog(code_id=identity[0], code=code.code, tool_id="25", tool_name="自由对话",
                       model="m", request_id="x", status="success")
        db.add(log)
        db.commit()
        log_id = log.id
    response = admin.get(f"/api/admin/logs/{log_id}/agent-run")
    assert response.status_code == 400
    assert "Agent" in response.json()["detail"]


def test_agent_run_missing_log_and_run(admin, identity):
    assert admin.get("/api/admin/logs/999999/agent-run").status_code == 404
    with SessionLocal() as db:
        code = db.get(UsageCode, identity[0])
        log = UsageLog(code_id=identity[0], code=code.code, tool_id="agent", tool_name="Agent 工作台",
                       model="m", request_id="deleted-run", status="success")
        db.add(log)
        db.commit()
        log_id = log.id
    response = admin.get(f"/api/admin/logs/{log_id}/agent-run")
    assert response.status_code == 404
    assert "运行记录" in response.json()["detail"]


def test_agent_text_paging_crosses_chunks(admin, identity):
    _task_, _run_, log_id, model_id, _prompt, text = _seed(identity)
    url = f"/api/admin/logs/{log_id}/agent-run/entries/{model_id}/text"
    page = admin.get(url, params={"kind": "output", "offset": 4000, "limit": 300})
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["text"] == text[4000:4300]
    assert body["total"] == len(text)
    assert body["offset"] == 4000

    # 跨过第一条完整页的位点（4096 字块）也能逐字对上。
    across = admin.get(url, params={"kind": "output", "offset": 4090, "limit": 20}).json()
    assert across["text"] == text[4090:4110]

    # offset 越界收敛到末尾，不能报错也不能凭空补内容。
    tail = admin.get(url, params={"kind": "output", "offset": 99999, "limit": 50}).json()
    assert tail["text"] == ""
    assert tail["total"] == len(text)

    # 超大的 limit 在服务端被夹到上限，不会把整段内容一次吐给浏览器
    huge = admin.get(url, params={"kind": "output", "offset": 0, "limit": 999999}).json()
    assert huge["limit"] == 131072


def test_agent_text_kind_and_ownership(admin, identity):
    _t, other_run, _other_log, other_entry, _p, _text = _seed(identity)
    _t2, run2, log2, _entry2, _p2, _text2 = _seed(identity)
    url = f"/api/admin/logs/{log2}/agent-run/entries/{other_entry}/text"
    assert admin.get(url, params={"kind": "output"}).status_code == 404

    text_url = f"/api/admin/logs/{log2}/agent-run/entries/{_entry2}/text"
    assert admin.get(text_url, params={"kind": "nope"}).status_code == 400
    # 模型步骤没有工具参数，压缩步骤没有任何正文。
    assert admin.get(text_url, params={"kind": "input"}).status_code == 404


def test_agent_text_download(admin, identity):
    _t, _r, log_id, model_id, _prompt, text = _seed(identity)
    response = admin.get(f"/api/admin/logs/{log_id}/agent-run/entries/{model_id}/download",
                         params={"kind": "output"})
    assert response.status_code == 200
    assert response.text == text
    assert "attachment" in response.headers["content-disposition"]


def test_agent_run_live_flag(admin, identity):
    _t, run, log_id, _m, _p, _text = _seed(identity, finish=False)
    data = admin.get(f"/api/admin/logs/{log_id}/agent-run").json()
    assert data["run"]["status"] == "running"
    assert data["run"]["live"] is True
    assert data["run"]["finished_at"] is None
    assert data["run"]["duration_ms"] >= 0


def test_log_list_attaches_agent_summary(admin, identity):
    _t, _r, log_id, _m, _p, _text = _seed(identity)
    response = admin.get("/api/admin/logs", params={"tool_id": "agent"})
    assert response.status_code == 200
    items = response.json()["items"]
    row = next(item for item in items if item["id"] == log_id)
    assert row["agent_steps"] == 4
    assert row["agent_mode"] == "execute"
    assert row["agent_available"] is True
    detail = admin.get(f"/api/admin/logs/{log_id}?include_payload=false")
    assert detail.status_code == 200
    assert detail.json()["agent_available"] is True

    with SessionLocal() as db:
        code = db.get(UsageCode, identity[0])
        log = UsageLog(code_id=identity[0], code=code.code, tool_id="agent", tool_name="Agent 工作台",
                       model="m", request_id="gone-run", status="success")
        db.add(log)
        db.commit()
    listed = admin.get("/api/admin/logs", params={"tool_id": "agent"}).json()["items"]
    gone = next(item for item in listed if item["request_id"] == "gone-run")
    assert gone["agent_available"] is False
    assert gone["agent_steps"] == 0
    gone_detail = admin.get(f"/api/admin/logs/{gone['id']}?include_payload=false")
    assert gone_detail.json()["agent_available"] is False
