"""撞输出上限（truncated 事件）的后端协议测试。

背景：这个事件原先只对 OCR（工具 32）与翻译（工具 33）发，别的工具撞上限时以
`[DONE]` 正常收尾——前端因此把它当完整结果，既不标「待补全」也不给「继续生成」
入口（用户只能整篇重来，或者把半份内容直接打印出去）。

要守住的三件事：
1. 任何工具撞上限都发 truncated，且发生在 [DONE] 之前；
2. 判定同时认两条信号：上游的 `finish_reason=length`（权威）与
   `completion_tokens` 达到上限 95%（供应商不回传 finish_reason 时的兜底）；
3. 没撞上限时绝不能多发这个事件（否则每条结果都提示「可能不完整」）。
"""
import pytest


# ---- 假的 litellm 流式对象（与 test_continue_stream 同一套最小实现） ----


class _Delta:
    def __init__(self, content=None):
        self.content = content


class _Choice:
    def __init__(self, delta, finish_reason=None):
        self.delta = delta
        self.finish_reason = finish_reason


class _Usage:
    def __init__(self, completion_tokens, prompt_tokens=10):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = prompt_tokens + completion_tokens


class _Chunk:
    def __init__(self, content=None, finish_reason=None, usage=None, with_choices=True):
        self.choices = [_Choice(_Delta(content), finish_reason)] if with_choices else []
        self.usage = usage


class _Stream:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    async def _gen(self):
        for chunk in self._chunks:
            yield chunk

    def __aiter__(self):
        return self._gen()

    async def aclose(self):
        pass


def _install_acompletion(monkeypatch, stream):
    from app.services import llm_router as router_module

    async def fake(**_kwargs):
        return stream

    monkeypatch.setattr(router_module, "acompletion", fake)


def _router(max_tokens: int = 128):
    from app.services.llm_router import LLMRouter

    providers = [
        {
            "id": "prov_1",
            "name": "通道1",
            "base_url": "",
            "api_key": "test-key",
            "enabled": True,
            "provider_model_id": "test-model",
        }
    ]
    return LLMRouter(
        providers_for_model=providers,
        default_model="test-model",
        max_tokens=max_tokens,
        timeout=120,
        first_token_timeout=5,
    )


def _post_stream(monkeypatch, payload, max_tokens: int = 128):
    """按测试用使用码调用 /api/chat/stream，返回原始响应。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.models import UsageCode
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _router(max_tokens))
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=UsageCode(
            id=999_777,
            code="NBXU-TRUNC-TEST",
            quota=3,
            used_count=0,
            is_enabled=True,
        ),
        reason="",
    )
    try:
        return TestClient(app).post("/api/chat/stream", json=payload)
    finally:
        app.dependency_overrides.clear()


# ---- 用例 ----


@pytest.mark.parametrize(
    "finish_reason,completion_tokens,expected",
    [
        # 上游明说 length（权威信号）：即使用量看着很小也要提示
        ("length", 1, True),
        # 供应商不回传 finish_reason，但用量贴到上限：靠 95% 兜底也要提示
        ("stop", 10**6, True),
        # 正常收尾：绝不能多发
        ("stop", 1, False),
        (None, 1, False),
    ],
)
def test_truncated_event_for_plain_tool(monkeypatch, finish_reason, completion_tokens, expected):
    """普通工具（工具 1）撞上限同样要发 truncated，没撞就不许发。"""
    _install_acompletion(
        monkeypatch,
        _Stream([
            _Chunk("半篇讲解"),
            _Chunk(None, finish_reason=finish_reason),
            _Chunk(usage=_Usage(completion_tokens), with_choices=False),
        ]),
    )
    response = _post_stream(monkeypatch, {"tool_id": "1", "input": "一段语篇", "request_id": "trunc_case"})
    assert response.status_code == 200, response.text
    has_event = "event: truncated" in response.text
    assert has_event is expected, response.text
    if expected:
        # 提示必须早于终止帧，否则前端收尾时已经把它当成完成
        assert response.text.index("event: truncated") < response.text.index("[DONE]")
        assert "finish_reason" in response.text


def test_truncated_payload_carries_diagnosis(monkeypatch):
    """事件载荷要能定位问题：上限、实际用量、上游结束原因。"""
    import json

    _install_acompletion(
        monkeypatch,
        _Stream([
            _Chunk("半篇讲解"),
            _Chunk(None, finish_reason="length"),
            _Chunk(usage=_Usage(200), with_choices=False),
        ]),
    )
    response = _post_stream(monkeypatch, {"tool_id": "1", "input": "一段语篇", "request_id": "trunc_payload"})
    assert response.status_code == 200, response.text
    marker = response.text.index("event: truncated")
    data_line = response.text[marker:].split("data: ", 1)[1].split("\n", 1)[0]
    payload = json.loads(data_line)
    # 上限取运行时配置（cfg["max_tokens"]），这里只断言它被如实带上
    assert payload["limit"] and payload["limit"] > 0
    assert payload["finish_reason"] == "length"
    assert payload["completion_tokens"] == 200
