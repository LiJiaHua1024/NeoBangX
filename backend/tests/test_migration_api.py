from fastapi.testclient import TestClient

from app import deps
from app.main import app
from app.models import UsageCode
from app.routers import chat as chat_router


class FakeLLM:
    def __init__(self, responses=None):
        self.prompt = ""
        self.messages = []
        self.responses = list(responses or ['{"causes":["忽略转折信号","凭表面词义作答"]}'])

    async def chat(self, *, user_prompt, messages=None, **_kwargs):
        self.prompt = user_prompt
        self.messages.append(messages or [])
        return self.responses.pop(0)


def _active_code():
    # 瞬态码：仅供 get_current_code 覆盖使用，不落库。
    # id 必须取自增序列够不到的大数，避免与其它测试落库的真实行串扰
    #（曾用 id=11，新增测试文件后恰好撞上真实 code 行导致串库）。
    return UsageCode(
        id=999_111,
        code="NBXU-TEST-TEST-TEST",
        code_type="user",
        quota=3,
        used_count=0,
        is_enabled=True,
    )


def test_analyze_is_non_streaming_and_keeps_all_feedback(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: fake)
    app.dependency_overrides[deps.get_current_code] = _active_code
    try:
        client = TestClient(app)
        response = client.post(
            "/api/chat/migration/analyze",
            json={
                "question": "Choose the best answer.",
                "standard_answer": "B",
                "student_answers": "Most students chose A.",
                "error_cause": "可能忽略转折",
                "feedback_history": ["不要只写粗心", "拆开不同机制"],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert [cause["label"] for cause in response.json()["causes"]] == [
        "忽略转折信号",
        "凭表面词义作答",
    ]
    assert "不要只写粗心" in fake.prompt
    assert "拆开不同机制" in fake.prompt


def test_more_appends_user_message_to_analysis_history(monkeypatch):
    fake = FakeLLM([
        '{"causes":["忽略转折信号","凭表面词义作答"]}',
        '{"causes":["没有核对指代关系"]}',
    ])
    monkeypatch.setattr(chat_router, "_build_llm", lambda *_args, **_kwargs: fake)
    app.dependency_overrides[deps.get_current_code] = _active_code
    try:
        client = TestClient(app)
        first = client.post(
            "/api/chat/migration/analyze",
            json={"question": "Choose the best answer."},
        )
        second = client.post(
            "/api/chat/migration/analyze",
            json={
                "question": "Choose the best answer.",
                "analysis_history": first.json()["analysis_history"],
                "continue_generation": True,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["causes"][0]["label"] == "没有核对指代关系"
    more_messages = fake.messages[1]
    assert more_messages[0]["role"] == "user"
    assert more_messages[-2]["role"] == "assistant"
    assert more_messages[-1]["role"] == "user"
    assert "More" in more_messages[-1]["content"]


def test_quota_precheck_does_not_consume_code():
    code = _active_code()
    app.dependency_overrides[deps.get_current_code] = lambda: code
    try:
        client = TestClient(app)
        response = client.post("/api/chat/migration/quota", json={"cause_count": 4})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["required"] == 2
    assert code.used_count == 0
