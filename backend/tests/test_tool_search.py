"""「描述需求找工具」（Jev choice）的回归测试。

覆盖：
1. 题面构造：候选与工具目录逐字一致、边界描述在、末尾固定「以上都不合适」；
2. 回包解析：按概率排序、标签映射回 id、「明确弃权」与「回包读不出来」分开；
3. 关键词兜底：老师口吻的说法能命中正确的工具，纯噪声不编结果；
4. 兜底链路：Jev 未启用/未配齐/超时/报错/回包不可解析 → 200 + 关键词结果；
5. 缓存：同一句话只打一次 Jev，目录变了旧结果立即失效；
6. 端点契约：短查询 400、限速 429、不扣额度、不写使用日志。
"""
import pytest
import anyio
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import UsageCode, UsageLog
from app.services import rate_limit as rl
from app.services import tool_search as ts
from app.services.runtime_config import set_config_values


def _tools():
    return [
        {
            "id": "10", "name": "学生作文批改", "icon": "correction",
            "description": "评分 + 修改建议 + 改进版本",
            "group_id": "teaching", "group_title": "备课与教学",
        },
        {
            "id": "9", "name": "英文写作教学", "icon": "writing",
            "description": "通用写作（记叙/议论/概要）支架与范文",
            "group_id": "teaching", "group_title": "备课与教学",
        },
        {
            "id": "13", "name": "试卷可视化全解", "icon": "projector",
            "description": "整卷题目与解析的课堂投影版",
            "group_id": "teaching", "group_title": "备课与教学",
        },
        {
            "id": "33", "name": "翻译", "icon": "languages",
            "description": "原文译文对照，支持试卷、作文、文档",
            "group_id": "reference", "group_title": "通用工具",
        },
        {
            "id": "25", "name": "自由对话", "icon": "chat",
            "description": "个性化自定义需求，工具清单外的教学任务兜底",
            "group_id": "reference", "group_title": "通用工具",
        },
    ]


_JEV_ON = {
    "enabled": True,
    "base_url": "https://api.typesafe.ai/v1/systemone",
    "api_key": "test-key",
    "model": "jev-latest",
    "timeout": 4,
    "tool_search_enabled": True,
}


@pytest.fixture(autouse=True)
def _clean_state():
    ts.clear_cache()
    rl._buckets.clear()
    yield
    ts.clear_cache()
    rl._buckets.clear()


def _fake_ask(*, answers=None, error=None, calls=None):
    async def fake(jev_cfg, state, questions, **kwargs):
        if calls is not None:
            calls.append({"cfg": jev_cfg, "state": state, "questions": questions})
        if error is not None:
            raise error
        return answers

    return fake


def _answers(label, probabilities=None, confidence=None):
    probabilities = probabilities if probabilities is not None else {label: 0.9}
    return {
        ts.QUESTION_KEY: {
            "type": "choice",
            "choice": label,
            "probabilities": probabilities,
            "confidence": confidence if confidence is not None else max(probabilities.values()),
        }
    }


# ---- 1. 题面构造 ----


def test_question_covers_every_tool_and_ends_with_abstain_option():
    tools = _tools()
    question = ts.build_tool_choice_question(tools)

    assert question["type"] == "choice"
    # 候选 = 全部工具 + 一个「都不合适」；没有分组，搜索是一道覆盖全部工具的题
    assert set(question["criteria"]) == {t["name"] for t in tools} | {ts.NONE_OPTION}
    assert list(question["criteria"])[-1] == ts.NONE_OPTION
    # 问题本身必须在 instructions 里（question id 不会发给模型）
    assert "user_request" in question["instructions"]
    assert ts.NONE_OPTION in question["instructions"]


def test_question_carries_boundary_notes_for_confusable_tools():
    """作文批改 vs 写作教学：光看描述分不开，必须带上手写的边界划线与用途描述。"""
    criteria = ts.build_tool_choice_question(_tools())["criteria"]

    assert "评分 + 修改建议 + 改进版本" in criteria["学生作文批改"]
    assert ts.TOOL_BOUNDARY_NOTES["10"] in criteria["学生作文批改"]
    assert ts.TOOL_BOUNDARY_NOTES["9"] in criteria["英文写作教学"]


def test_question_tolerates_duplicate_names():
    """名字重复（理论上不该有）时先出现的胜出，不让选项被后来者顶掉。"""
    tools = _tools() + [
        {"id": "99", "name": "翻译", "icon": "x", "description": "另一个翻译",
         "group_id": "reference", "group_title": "通用工具"}
    ]
    criteria = ts.build_tool_choice_question(tools)["criteria"]
    assert "另一个翻译" not in criteria["翻译"]


# ---- 2. 回包解析 ----


def test_parse_maps_label_back_to_tool_and_ranks_by_probability():
    tools = _tools()
    answers = _answers(
        "学生作文批改",
        {"学生作文批改": 0.72, "自由对话": 0.1, "英文写作教学": 0.05},
        confidence=0.72,
    )
    tool_id, confidence, ranked, abstained = ts.parse_tool_choice_answer(answers, tools)

    assert tool_id == "10"
    assert confidence == pytest.approx(0.72)
    assert abstained is False
    assert [t["id"] for t, _ in ranked] == ["10", "25", "9"]
    # 「以上都不合适」不是工具，不进候选列表
    assert all(t["id"] for t, _ in ranked)


def test_parse_separates_explicit_abstention_from_unreadable_answer():
    tools = _tools()
    # 模型明确选了「以上都不合适」：合法结论，不是故障
    _, _, _, abstained = ts.parse_tool_choice_answer(_answers(ts.NONE_OPTION), tools)
    assert abstained is True

    # 标签认不出来（网关改写选项名）：读不出来，必须回退关键词
    tool_id, _, _, abstained = ts.parse_tool_choice_answer(_answers("未知标签"), tools)
    assert tool_id is None and abstained is False

    # 回包形状不对
    assert ts.parse_tool_choice_answer(None, tools)[0] is None
    assert ts.parse_tool_choice_answer({}, tools)[0] is None
    assert ts.parse_tool_choice_answer({ts.QUESTION_KEY: "not-a-dict"}, tools)[0] is None
    # 缺 probabilities 时退回 choice 本身，不整份丢弃
    tool_id, confidence, ranked, _ = ts.parse_tool_choice_answer(
        {ts.QUESTION_KEY: {"type": "choice", "choice": "翻译"}}, tools
    )
    assert tool_id == "33" and confidence == 0.0 and ranked == []


# ---- 3. 关键词兜底 ----


@pytest.mark.parametrize(
    "query,expected_id",
    [
        ("帮我把这篇学生作文批改一下", "10"),
        ("我想教学生怎么写议论文", "9"),
        ("把这套卷子做成课堂投影讲解", "13"),
        ("把这段课文翻译成英文", "33"),
        ("随便聊聊这个教学问题", "25"),
    ],
)
def test_keyword_search_hits_the_intended_tool(query, expected_id):
    hits = ts.keyword_search(query, _tools())
    assert hits, query
    assert hits[0][0]["id"] == expected_id, query


def test_keyword_search_returns_nothing_for_noise():
    assert ts.keyword_search("zzz", _tools()) == []
    assert ts.keyword_search("   ", _tools()) == []
    # 得分归一化在 0-1
    for tool, score in ts.keyword_search("作文批改", _tools()):
        assert 0 < score <= 1.0


# ---- 4. 兜底链路 ----


def test_jev_disabled_falls_back_to_keyword(monkeypatch):
    calls = []
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译"), calls=calls))
    off = dict(_JEV_ON, enabled=False)

    payload = anyio.run(ts.search_tools, off, "帮我把这篇学生作文批改一下", _tools(), 3)

    assert calls == []  # 未启用时一个请求都不发
    assert payload["fallback"] is True and payload["jev_available"] is False
    assert payload["results"][0]["tool_id"] == "10"
    assert payload["results"][0]["source"] == "keyword"


def test_tool_search_can_be_switched_off_without_touching_error_judgment(monkeypatch):
    """后台可以单独关掉「找工具」这一用途，Jev 的错误重试判定不受影响。"""
    calls = []
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译"), calls=calls))
    off = dict(_JEV_ON, tool_search_enabled=False)

    payload = anyio.run(ts.search_tools, off, "帮我把这篇学生作文批改一下", _tools(), 3)

    assert calls == []
    assert payload["fallback"] is True and payload["jev_available"] is False


def test_jev_unusable_config_falls_back():
    payload = anyio.run(ts.search_tools, {"enabled": True}, "作文批改", _tools(), 3)
    assert payload["fallback"] is True
    assert payload["results"][0]["tool_id"] == "10"


@pytest.mark.parametrize(
    "answers,error",
    [
        (None, RuntimeError("Jev 返回 HTTP 500")),
        (None, TimeoutError("timeout")),
        ({"other": {"type": "noul", "noul": 0.9}}, None),  # 回包缺自己那题
        ([], None),  # 回包形状不对
    ],
)
def test_jev_failure_never_breaks_search(monkeypatch, answers, error):
    async def fake(jev_cfg, state, questions, **kwargs):
        if error is not None:
            raise error
        return answers

    monkeypatch.setattr(ts, "a_ask_jev", fake)
    payload = anyio.run(
        ts.search_tools, _JEV_ON, "帮我把这篇学生作文批改一下", _tools(), 3
    )

    assert payload["fallback"] is True
    assert payload["results"][0]["tool_id"] == "10"


def test_jev_answer_is_used_and_marked_as_such(monkeypatch):
    monkeypatch.setattr(
        ts, "a_ask_jev",
        _fake_ask(answers=_answers("翻译", {"翻译": 0.81, "学生作文批改": 0.12})),
    )

    payload = anyio.run(ts.search_tools, _JEV_ON, "把这段课文翻译成英文", _tools(), 3)

    assert payload["fallback"] is False and payload["jev_available"] is True
    assert [r["tool_id"] for r in payload["results"]] == ["33", "10"]
    assert all(r["source"] == "jev" for r in payload["results"])
    # Jev 不生成文字，「为什么推荐」取工具自己的用途描述
    assert payload["results"][0]["reason"] == "原文译文对照，支持试卷、作文、文档"


def test_jev_abstention_lists_keyword_neighbours_without_forcing_a_tool(monkeypatch):
    monkeypatch.setattr(
        ts, "a_ask_jev",
        _fake_ask(answers=_answers(ts.NONE_OPTION, {ts.NONE_OPTION: 0.6, "学生作文批改": 0.2})),
    )

    payload = anyio.run(ts.search_tools, _JEV_ON, "帮我写个班会课发言稿", _tools(), 3)

    assert payload["no_match"] is True
    # 弃权时不硬推一个工具，改用关键词近邻；这句话本来就不该命中任何工具
    assert payload["results"] == []


def test_search_clamps_jev_timeout_for_interactive_use(monkeypatch):
    """后台把 jev_timeout 调到 30 秒是给错误判定用的，搜索必须自己收紧上限。"""
    seen = {}

    async def fake(jev_cfg, state, questions, **kwargs):
        seen.update(jev_cfg)
        return _answers("翻译")

    monkeypatch.setattr(ts, "a_ask_jev", fake)
    anyio.run(ts.search_tools, dict(_JEV_ON, timeout=30), "翻译", _tools(), 3)

    assert seen["timeout"] == ts.TOOL_SEARCH_TIMEOUT_MAX


# ---- 5. 缓存 ----


def test_same_query_hits_jev_only_once(monkeypatch):
    calls = []
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译"), calls=calls))

    first = anyio.run(ts.search_tools, _JEV_ON, "把这段课文翻译成英文", _tools(), 3)
    second = anyio.run(ts.search_tools, _JEV_ON, "把这段课文翻译成英文", _tools(), 3)

    assert len(calls) == 1
    assert first["cached"] is False and second["cached"] is True
    assert [r["tool_id"] for r in second["results"]] == [r["tool_id"] for r in first["results"]]
    # 空白差异视为同一句话
    anyio.run(ts.search_tools, _JEV_ON, "  把这段课文翻译成英文  ", _tools(), 3)
    assert len(calls) == 1


def test_cache_invalidates_when_catalog_changes(monkeypatch):
    calls = []
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译"), calls=calls))

    anyio.run(ts.search_tools, _JEV_ON, "翻译", _tools(), 3)
    changed = _tools()
    changed[0]["description"] = "改过的描述"
    anyio.run(ts.search_tools, _JEV_ON, "翻译", changed, 3)

    assert len(calls) == 2


def test_keyword_results_are_not_cached_by_jev_key(monkeypatch):
    """Jev 关掉时也走缓存（省的是本地计算），但绝不能因为缓存而误报「用上了 Jev」。"""
    calls = []
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译"), calls=calls))
    off = dict(_JEV_ON, enabled=False)

    first = anyio.run(ts.search_tools, off, "作文批改", _tools(), 3)
    second = anyio.run(ts.search_tools, off, "作文批改", _tools(), 3)

    assert first["jev_available"] is False and second["jev_available"] is False
    assert calls == []


# ---- 6. 端点契约 ----


def _post_search(query, limit=3, fingerprint="fp-search-test"):
    return TestClient(app).post(
        "/api/tools/search",
        json={"query": query, "limit": limit},
        headers={"X-Client-Fingerprint": fingerprint},
    )


def test_endpoint_requires_a_real_sentence():
    res = _post_search("a")
    assert res.status_code == 400
    assert "多说几个字" in res.json()["detail"]


@pytest.fixture
def jev_on_in_db():
    """把库里那套 Jev 配置临时打开（端点/Key/模型都配齐），存取原值。"""
    keys = ("jev_enabled", "jev_base_url", "jev_api_key", "jev_model")
    from app.services.runtime_config import get_config_map

    db = SessionLocal()
    try:
        old = {k: get_config_map(db).get(k, "") for k in keys}
        set_config_values(db, {
            "jev_enabled": "true",
            "jev_base_url": "https://api.typesafe.ai/v1/systemone",
            "jev_api_key": "test-key",
            "jev_model": "jev-latest",
        })
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        set_config_values(db, old)
    finally:
        db.close()


def test_endpoint_works_without_any_usage_code(monkeypatch, jev_on_in_db):
    """搜索只做导航：未登录也能用，与「无需使用码即可浏览全部工具」一致。"""
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("学生作文批改")))

    res = _post_search("帮我把这篇学生作文批改一下")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["results"][0]["tool_id"] == "10"
    assert body["results"][0]["name"] == "学生作文批改"
    assert body["results"][0]["group_title"] == "备课与教学"
    assert body["fallback"] is False
    assert isinstance(body["latency_ms"], int)


def test_endpoint_rejects_overlong_query():
    res = _post_search("作" * (ts.MAX_QUERY_CHARS + 1))
    assert res.status_code == 422  # pydantic 层先拦下超长


def test_endpoint_is_rate_limited():
    limit, _window = rl.RATE_LIMITS["tool_search"]
    for _ in range(limit):
        assert _post_search("作文批改").status_code == 200
    blocked = _post_search("作文批改")
    assert blocked.status_code == 429


def test_endpoint_neither_spends_quota_nor_writes_usage_logs(monkeypatch):
    """不扣次数、不写 log_payload/usage_logs：否则会污染后台统计与免费模型限额计数。"""
    monkeypatch.setattr(ts, "a_ask_jev", _fake_ask(answers=_answers("翻译")))

    db = SessionLocal()
    try:
        code = UsageCode(code="NBXU-SEARCH-TEST-0001", quota=5, used_count=0, is_enabled=True)
        db.add(code)
        db.commit()
        db.refresh(code)
        code_id = code.id
        logs_before = db.query(UsageLog).count()
    finally:
        db.close()

    assert _post_search("把这段课文翻译成英文").status_code == 200

    db = SessionLocal()
    try:
        assert db.get(UsageCode, code_id).used_count == 0
        assert db.query(UsageLog).count() == logs_before
        db.query(UsageCode).filter(UsageCode.id == code_id).delete()
        db.commit()
    finally:
        db.close()


def test_admin_can_toggle_tool_search_use():
    """后台开关可读写，并且不影响 Jev 本身的启用状态。"""
    from app.admin_main import app as admin_app

    client = TestClient(admin_app)
    res = client.put("/api/admin/config", json={"jev_tool_search_enabled": False})
    assert res.status_code == 200, res.text
    assert res.json()["config"]["jev_tool_search_enabled"] == "false"
    assert client.get("/api/admin/config").json()["config"]["jev_tool_search_enabled"] == "false"

    res = client.put("/api/admin/config", json={"jev_tool_search_enabled": True})
    assert res.status_code == 200
    assert res.json()["config"]["jev_tool_search_enabled"] == "true"


def test_old_config_without_the_flag_defaults_to_on():
    """老库没有这个键时，启用 Jev 即启用工具搜索（不静默把功能关掉）。"""
    from app.services.runtime_config import parse_jev_settings

    parsed = parse_jev_settings({"jev_enabled": "true"})
    assert parsed["tool_search_enabled"] is True
    assert parse_jev_settings({"jev_tool_search_enabled": "off"})["tool_search_enabled"] is False


def test_config_roundtrip_keeps_tool_search_flag():
    db = SessionLocal()
    try:
        set_config_values(db, {"jev_tool_search_enabled": "false"})
        from app.services.runtime_config import resolve_llm_settings

        assert resolve_llm_settings(db)["jev"]["tool_search_enabled"] is False
        set_config_values(db, {"jev_tool_search_enabled": "true"})
        assert resolve_llm_settings(db)["jev"]["tool_search_enabled"] is True
    finally:
        db.close()
