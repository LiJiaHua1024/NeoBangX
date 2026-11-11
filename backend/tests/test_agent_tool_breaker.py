"""工具失败熔断：任何连续失败都必须有界。

来源：2026-11 事故——create_presentation 对不可行动的错误连续失败 15+ 次，
每次全量重新生成整份 deck，烧掉 40 万+ tokens。这里锁住：系统性失败快速熔断、
可行动失败宽限但有界、相同调用原样重试立即熔断、成功清零、熔断后 tool 配对完整。
"""
import asyncio
import json

from app.agent_workspace import llm, runner, store
from app.agent_workspace.api import TaskConfig
from app.agent_workspace.models import WorkspaceMaterial, WorkspaceTask
from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.database import SessionLocal


def test_systemic_failures_trip_the_breaker_fast():
    obj = runner.Runner("run-x")
    obj.snapshot = {}
    obj._record_tool_failure("create_presentation", '{"a": 1}', "err1", systemic=True)
    obj._record_tool_failure("create_presentation", '{"b": 2}', "err2", systemic=True)
    assert not obj.terminal_tool_error
    obj._record_tool_failure("create_presentation", '{"c": 3}', "err3", systemic=True)
    assert "create_presentation" in obj.terminal_tool_error and "连续失败" in obj.terminal_tool_error


def test_actionable_failures_get_more_headroom_but_stay_bounded():
    obj = runner.Runner("run-x")
    obj.snapshot = {}
    for i in range(runner.TOOL_ACTIONABLE_LIMIT - 1):
        obj._record_tool_failure("revise_document", json.dumps({"i": i}), f"err{i}", systemic=False)
    assert not obj.terminal_tool_error
    obj._record_tool_failure("revise_document", '{"i": 99}', "err", systemic=False)
    assert obj.terminal_tool_error


def test_identical_args_trip_the_breaker_even_with_distinct_errors():
    """原样重试是事故形态：错误文本可以轮换（got 'int' / got 'list'），
    但相同工具+相同参数连续失败就该停。"""
    obj = runner.Runner("run-x")
    obj.snapshot = {}
    obj._record_tool_failure("create_presentation", '{"same": true}', "got 'int'", systemic=True)
    obj._record_tool_failure("create_presentation", '{"same": true}', "got 'list'", systemic=True)
    assert "相同调用连续 2 次" in obj.terminal_tool_error


def test_success_resets_the_streak():
    obj = runner.Runner("run-x")
    obj.snapshot = {}
    obj._record_tool_failure("create_presentation", '{"a": 1}', "err", systemic=True)
    assert "create_presentation" in obj.snapshot["tool_failures"]
    obj._reset_tool_failure("create_presentation")
    assert "create_presentation" not in obj.snapshot["tool_failures"]


def test_failure_classification():
    """参数校验类 ValueError 是可行动失败；生成问题与崩溃类异常是系统性失败。"""
    systemic = runner._failure_is_systemic
    assert systemic(ValueError("材料不在本轮范围内")) is False
    assert systemic(TypeError("expected string or bytes-like object, got 'int'")) is True
    assert systemic(KeyError("prompts")) is True
    from app.agent_workspace.slides.schema import DeckError
    from app.agent_workspace.slides.writer import DeckGenerationError
    assert systemic(DeckError("缺少必选页", kind="structural")) is False
    assert systemic(DeckGenerationError("deck JSON 不合法", kind="generation")) is True


def test_persistent_generation_failure_stops_the_run_instead_of_retrying_forever(
        workspace_code, monkeypatch):
    owner, _token = workspace_code("LOOP-", quota=10)
    save_settings(WorkspaceSettings(slides_enabled=True))
    try:
        with SessionLocal() as db:
            task = WorkspaceTask(id=store.uid(), owner=owner, title="循环保护",
                                 config=store.encode(TaskConfig(
                                     goal="生成 PPT", output="slides", model="test",
                                     review=False).model_dump()))
            db.add(task)
            db.flush()
            material = WorkspaceMaterial(id=store.uid(), task_id=task.id, name="试卷",
                                         content="短材料。")
            db.add(material)
            cfg = store.decode(task.config)
            cfg["materials"] = [material.id]
            task.config = store.encode(cfg)
            db.commit()
            task_id, material_id = task.id, material.id
        snapshot = {"model": "test",
                    "limits": {"max_steps": 12, "max_tokens": 200000, "output_tokens": 16000,
                               "max_seconds": 120, "context_budget": 262144, "keep_tail_steps": 4,
                               "provider_attempts": 1, "retry_wait_cap_seconds": 30,
                               "switch_compaction_ratio": 0.5},
                    "templates": {}, "expected_revision": 1}
        run = store.create_run(owner, task_id, "loop-key-1", "execute", "", "", snapshot,
                               False, {"id": "test"})
        monkeypatch.setattr(runner, "_load_cfg", lambda: {})
        calls = {"agent": 0, "writer": 0}

        async def model(cfg, name, messages, schemas, budget, emit, **kwargs):
            if schemas:  # 调度步：每次都发起 create_presentation
                calls["agent"] += 1
                return llm.ModelResult(calls=[{
                    "id": f"c{calls['agent']}", "type": "function",
                    "function": {"name": "create_presentation",
                                 "arguments": json.dumps({"title": "PPT", "instruction": "整卷分析",
                                                          "material_ids": [material_id],
                                                          "blueprint": "reading"})}}])
            calls["writer"] += 1  # 写作步：永远返回无法解析的输出
            return llm.ModelResult(content="这 不 是 JSON")

        asyncio.run(runner.execute_run(run["id"], model))
        state = store.load_run(run["id"])
        assert state["status"] == "incomplete"
        assert "连续失败" in (state.get("error") or "")
        assert calls["agent"] <= runner.TOOL_FAILURE_LIMIT, "熔断后不许再发起同样的全量生成"
        # 熔断发生在失败结果入上下文之后：tool 配对必须完整，续跑不会挂
        for i, message in enumerate(state["messages"]):
            if message.get("tool_calls"):
                answered = sum(1 for x in state["messages"][i + 1:] if x.get("role") == "tool")
                assert answered >= len(message["tool_calls"])
    finally:
        save_settings(WorkspaceSettings(slides_enabled=False))
