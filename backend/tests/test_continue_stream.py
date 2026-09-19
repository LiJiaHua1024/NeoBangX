"""通用续写（continue_from）的后端协议测试。

续写请求的消息序列必须是 [原始 prompt, 残文(assistant), 续写指令]：
残文必须以 assistant 身份出现，模型才知道那是「自己已经写出来的」；
首条消息保持与首次请求逐字节一致，供应商侧的前缀缓存才能继续命中。
"""
import pytest


# ---- 假的 litellm 流式对象（与 test_llm_router_fallback 同一套最小实现） ----


class _Delta:
    def __init__(self, content=None):
        self.content = content


class _Choice:
    def __init__(self, delta):
        self.delta = delta


class _Chunk:
    def __init__(self, content=None):
        self.choices = [_Choice(_Delta(content))] if content is not None else []
        self.usage = None


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
    """替换 litellm.acompletion，并记录每次调用收到的 kwargs（含 messages）。"""
    from app.services import llm_router as router_module

    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return stream

    fake.calls = calls
    monkeypatch.setattr(router_module, "acompletion", fake)
    return fake


def _router():
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
        max_tokens=128,
        timeout=120,
        first_token_timeout=5,
    )


def _post_stream(monkeypatch, payload):
    """按测试用使用码调用 /api/chat/stream，返回原始响应。"""
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from app.models import UsageCode
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "_build_llm", lambda *_a, **_k: _router())
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=UsageCode(
            id=999_331,
            code="NBXU-CONTINUE-TEST",
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


# ---- 端点级：消息序列 ----


def test_continue_stream_passes_partial_as_assistant_message(monkeypatch):
    """续写：首条仍是原始 prompt，残文单独作为 assistant 消息，指令挂在最后。"""
    from app.routers.tools import get_prompt_loader

    fake = _install_acompletion(monkeypatch, _Stream([_Chunk("接着写完的后半段")]))
    response = _post_stream(
        monkeypatch,
        {
            "tool_id": "25",
            "input": "我的问题",
            "request_id": "continue_case",
            "continue_from": "前半段还没写完的正文",
        },
    )

    assert response.status_code == 200
    assert "接着写完的后半段" in response.text

    messages = fake.calls[0]["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert "我的问题" in messages[0]["content"]
    assert messages[1]["content"] == "前半段还没写完的正文"
    # 末尾必须是磁盘上的共用续写指令，而不是把残文混进首条 prompt 里
    instruction = get_prompt_loader().get("继续生成")
    assert instruction and instruction.strip()
    assert messages[2]["content"] == instruction


@pytest.mark.parametrize("continue_from", [None, "   "])
def test_stream_without_continue_keeps_single_user_message(monkeypatch, continue_from):
    """不传（或只传空白）continue_from：仍是单条 user 消息，行为与从前一致。"""
    fake = _install_acompletion(monkeypatch, _Stream([_Chunk("答复")]))
    payload = {"tool_id": "25", "input": "你好", "request_id": "plain_case"}
    if continue_from is not None:
        payload["continue_from"] = continue_from
    response = _post_stream(monkeypatch, payload)

    assert response.status_code == 200
    messages = fake.calls[0]["messages"]
    assert [m["role"] for m in messages] == ["user"]


# ---- 指令文件解析：专属覆盖 → 共用回退 ----


def test_continue_prompt_prefers_tool_specific_file():
    from app.routers.chat import _load_continue_prompt

    class _Loader:
        def __init__(self, files):
            self.files = files

        def get(self, name):
            return self.files.get(name)

    loader = _Loader({"自由对话续写": "专属续写指令", "继续生成": "共用续写指令"})
    assert _load_continue_prompt(loader, "25") == "专属续写指令"
    # 没有专属文件的工具和未知工具都回退到共用那份
    assert _load_continue_prompt(loader, "1") == "共用续写指令"
    assert _load_continue_prompt(loader, "99") == "共用续写指令"
    # 专属文件是空白（占位未补全）时等同于没有，继续往下回退
    blank = _Loader({"自由对话续写": "\n  \n", "继续生成": "共用续写指令"})
    assert _load_continue_prompt(blank, "25") == "共用续写指令"
    assert _load_continue_prompt(_Loader({"继续生成": ""}), "25") is None


def test_missing_continue_prompt_returns_404(monkeypatch):
    """共用指令文件缺失必须报错：静默按普通重试放行会让「继续生成」变成整篇重写。"""
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "CONTINUE_PROMPT_NAME", "不存在的续写指令")
    response = _post_stream(
        monkeypatch,
        {"tool_id": "25", "input": "你好", "continue_from": "残文"},
    )

    assert response.status_code == 404
    assert "续写指令文件" in response.json()["detail"]
