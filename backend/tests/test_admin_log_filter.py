"""管理后台「使用日志 · 高级筛选表达式」回归测试。

覆盖前端语法解析后下推的 AST：字段包含 / 排除（- / n）、枚举、数值比较、
OR 分组、自由文本、日期，以及非法输入的 400 与列表 / 汇总口径一致性。
"""
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.models import UsageCode, UsageLog
from app.services.request_log import STATUS_CANCELLED, STATUS_ERROR, STATUS_SUCCESS, record_usage_log


def _ast(*groups):
    """构造与前端 parseLogFilter 输出一致的 AST JSON。"""
    return json.dumps({"v": 1, "g": [list(g) for g in groups]}, ensure_ascii=False)


def _c(f, o, v, n=False):
    return {"f": f, "o": o, "v": v, "n": n}


@pytest.fixture
def client():
    return TestClient(admin_app)


@pytest.fixture
def seeded():
    """每个用例一个独立使用码，避免与其它日志用例互相污染。"""
    code = "NBXU-FLT-" + uuid.uuid4().hex[:10].upper()
    db = SessionLocal()
    try:
        row = UsageCode(code=code, quota=100, used_count=0, is_enabled=True, note="筛选测试")
        db.add(row)
        db.commit()
        db.refresh(row)
        code_id = row.id
    finally:
        db.close()

    def add(tool_id, tool_name, model, status, *, usage, duration_ms, units, ip="192.0.2.10"):
        return record_usage_log(
            code_id=code_id, code=code, tool_id=tool_id, tool_name=tool_name,
            model=model, status=status, usage=usage, duration_ms=duration_ms,
            units=units, ip=ip,
        )

    ids = {
        "chat": add("25", "自由对话", "deepseek-v3", STATUS_SUCCESS,
                    usage={"total_tokens": 40}, duration_ms=1000, units=1),
        "title": add("title", "标题生成", "qwen-turbo", STATUS_SUCCESS,
                     usage={"total_tokens": 5}, duration_ms=200, units=0),
        "agent": add("agent", "Agent 工作台", "gpt-4o", STATUS_ERROR,
                     usage={"total_tokens": 3000}, duration_ms=15000, units=1),
        "visual": add("13", "试卷可视化全解", "gpt-4o", STATUS_SUCCESS,
                      usage={"total_tokens": 800}, duration_ms=4000, units=1),
        "cancel": add("26", "智能错题迁移", "deepseek-v3", STATUS_CANCELLED,
                      usage={"total_tokens": 100}, duration_ms=300, units=0),
        # 未上报 token 的行：验证「排除」对 NULL 不会误杀
        "unknown": add("27", "无用量上报", "deepseek-v3", STATUS_SUCCESS,
                       usage={}, duration_ms=500, units=1),
    }
    yield code, ids
    # 收尾：只清自己名下的数据
    db = SessionLocal()
    try:
        db.query(UsageLog).filter(UsageLog.code == code).delete(synchronize_session=False)
        db.query(UsageCode).filter(UsageCode.code == code).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _ids(resp):
    assert resp.status_code == 200, resp.text
    return [item["id"] for item in resp.json()["items"]]


def test_exclude_title_generation(client, seeded):
    """用户的核心场景：-tool:title 过滤掉所有标题生成任务。"""
    code, ids = seeded
    expr = _ast([_c("tool", "contains", "title", n=True)])
    resp = client.get("/api/admin/logs", params={"code": code, "expr": expr, "page_size": 100})
    got = _ids(resp)
    assert resp.json()["filter_applied"] is True
    assert ids["title"] not in got
    assert set(got) == {ids[k] for k in ("chat", "agent", "visual", "cancel", "unknown")}
    summary = client.get("/api/admin/logs/summary", params={"code": code, "expr": expr}).json()
    assert summary["total"] == 5
    # 没带表达式时不回显 true，前端据此判断后端是否为新版
    plain = client.get("/api/admin/logs", params={"code": code}).json()
    assert plain["filter_applied"] is False


def test_status_enum_and_numeric_compare(client, seeded):
    code, ids = seeded
    err = _ids(client.get("/api/admin/logs", params={"code": code, "expr": _ast([_c("status", "eq", "error")])}))
    assert err == [ids["agent"]]
    big = _ids(client.get("/api/admin/logs", params={"code": code, "expr": _ast([_c("tokens", "gt", 2000)])}))
    assert big == [ids["agent"]]
    fast = _ids(client.get("/api/admin/logs", params={"code": code, "expr": _ast([_c("duration", "lt", 1000)])}))
    assert set(fast) == {ids["title"], ids["cancel"], ids["unknown"]}


def test_or_groups_and_free_text(client, seeded):
    code, ids = seeded
    expr = _ast([_c("status", "eq", "error")], [_c("tool", "contains", "title")])
    got = _ids(client.get("/api/admin/logs", params={"code": code, "expr": expr}))
    assert set(got) == {ids["agent"], ids["title"]}
    free = _ids(client.get("/api/admin/logs", params={"code": code, "expr": _ast([_c("free", "contains", "deepseek")])}))
    assert set(free) == {ids["chat"], ids["cancel"], ids["unknown"]}


def test_negation_keeps_null_rows(client, seeded):
    """-tokens>2000 必须保留「未上报 token」的行（CASE ... ELSE 的语义）。"""
    code, ids = seeded
    got = _ids(client.get("/api/admin/logs", params={"code": code, "expr": _ast([_c("tokens", "gt", 2000, n=True)])}))
    assert ids["unknown"] in got
    assert ids["agent"] not in got


def test_list_and_summary_share_the_same_filter(client, seeded):
    code, _ = seeded
    expr = _ast([_c("tool", "contains", "title", n=True), _c("units", "eq", 1)])
    listed = client.get("/api/admin/logs", params={"code": code, "expr": expr, "include_summary": True}).json()
    summary = client.get("/api/admin/logs/summary", params={"code": code, "expr": expr}).json()
    assert listed["total"] == summary["total"]
    assert listed["summary"] == summary


@pytest.mark.parametrize("expr,detail", [
    ("not-json", "筛选表达式格式不合法"),
    (json.dumps({"v": 9, "g": []}), "筛选表达式版本不支持"),
    (_ast([_c("nope", "eq", "x")]), "筛选字段不支持"),
    (_ast([_c("status", "eq", "nope")]), "状态值不合法"),
    (_ast([_c("tokens", "eq", "abc")]), "不是有效数字"),
    (_ast([_c("tool", "contains", "")]), "筛选值不能为空或过长"),
])
def test_invalid_expression_returns_400(client, seeded, expr, detail):
    code, _ = seeded
    resp = client.get("/api/admin/logs", params={"code": code, "expr": expr})
    assert resp.status_code == 400
    assert detail in resp.json()["detail"]
