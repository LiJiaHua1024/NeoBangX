"""结尾赞助块清除（output_guard）的回归测试。

上游渠道会在正文结尾追加「独占一行的水平线 + Sponsored by ...」广告块，本模块
在 LLM 出口统一剥掉它。测试覆盖两层：

1. 纯函数 `strip_end_sponsor` 与流式过滤器 `EndSponsorFilter` 本身的行为；
2. `LLMService` / `LLMRouter` 的接入是否真的生效、是否改变正常响应的流式时序。

不发起网络请求：把 acompletion 换成脚本化的假实现。
"""
import pytest

from app.services import llm as llm_module
from app.services import llm_router as router_module
from app.services.llm import LLMService
from app.services.llm_router import LLMRouter
from app.services.output_guard import EndSponsorFilter, strip_end_sponsor

# 真实的广告形态：正文 + 空行 + 水平线 + 可变文案
SAMPLE = (
    "第一段正文。\n\n第二段正文。\n\n"
    "---\n"
    "Sponsored by [Webz.io](https://platform.experientiallabs.ai/a/fxcbASHw)\n"
    "Get Started. Scale your language learning content with Webz.io's real-time news "
    "and structured global data."
)


# ---- 假的 litellm 对象 ----


class _Delta:
    def __init__(self, content=None):
        self.content = content


class _Chunk:
    def __init__(self, content=None):
        self.choices = [type("_C", (), {"delta": _Delta(content), "finish_reason": None})()] \
            if content is not None else []
        self.usage = None


class _Stream:
    def __init__(self, chunks=None):
        self._chunks = list(chunks or [])
        self.closed = False

    async def _gen(self):
        for chunk in self._chunks:
            yield chunk

    def __aiter__(self):
        return self._gen()

    async def aclose(self):
        self.closed = True


class _NonStreamResponse:
    def __init__(self, content):
        message = type("_M", (), {"content": content})()
        self.choices = [type("_C", (), {"message": message})()]
        self.usage = None


def _router(count=2):
    providers = [
        {
            "id": f"prov_{index}",
            "name": f"通道{index}",
            "base_url": "",
            "api_key": "test-key",
            "enabled": True,
            "provider_model_id": "test-model",
        }
        for index in range(1, count + 1)
    ]
    return LLMRouter(providers_for_model=providers, default_model="test-model")


def _run_filter(chunks):
    """把 chunks 逐一喂给过滤器，返回最终拼起来的输出。"""
    guard = EndSponsorFilter()
    out = [guard.feed(c) for c in chunks]
    out.append(guard.flush())
    return "".join(out)


# ---- 纯函数 strip_end_sponsor ----


def test_strip_sample_block():
    assert strip_end_sponsor(SAMPLE) == "第一段正文。\n\n第二段正文。\n"


def test_strip_only_ad_returns_empty():
    assert strip_end_sponsor("---\nSponsored by Foo") == ""


def test_strip_keeps_middle_rule():
    """正文中间的 --- 后面还有正文，不是尾巴，不能动。"""
    text = "开头\n\n---\n中间分隔\n\n结尾"
    assert strip_end_sponsor(text) == text


def test_strip_requires_sponsored():
    """只有水平线、没有 Sponsored by，不误伤。"""
    text = "正文\n\n---\n"
    assert strip_end_sponsor(text) == text


@pytest.mark.parametrize("rule", ["***", "___", "-----"])
def test_strip_accepts_other_rule_styles(rule):
    text = f"正文\n\n{rule}\nSponsored by X\nmore"
    assert strip_end_sponsor(text) == "正文\n"


def test_strip_case_insensitive_and_blank_line():
    assert strip_end_sponsor("正文\n\n---\n\nSPONSORED BY X") == "正文\n"


def test_strip_ignores_inline_dashes():
    text = "答案是 5---3\n后面还有正文"
    assert strip_end_sponsor(text) == text


def test_strip_empty():
    assert strip_end_sponsor("") == ""


# ---- 流式过滤器 EndSponsorFilter ----


def test_filter_passthrough_is_immediate():
    """普通文本零延迟直通，不做任何缓冲。"""
    guard = EndSponsorFilter()
    assert guard.feed("头条新闻") == "头条新闻"
    assert guard.feed("，继续。") == "，继续。"
    assert guard.flush() == ""


def test_filter_releases_false_positive_prefix():
    """以 S 开头先扣住（可能是 Sponsored），下一块证明不是立刻放出。"""
    guard = EndSponsorFilter()
    assert guard.feed("S") == ""
    assert guard.feed("n") == "Sn"
    assert guard.flush() == ""


def test_filter_char_by_char_matches_pure():
    """逐字符喂入（最坏拆分）与一次性处理结果一致。"""
    assert _run_filter(SAMPLE) == strip_end_sponsor(SAMPLE)


def test_filter_drops_text_after_marker():
    """命中后到流结束的内容全部丢弃。"""
    chunks = ["甲", "乙", "\n", "-", "-", "-", "\n", "Sponsored by X", "\n尾巴也不该出现"]
    assert _run_filter(chunks) == "甲乙"
    # 与非流式口径一致：紧贴水平线的那个换行属于广告块边界，一并切掉
    assert strip_end_sponsor("".join(chunks)) == "甲乙"


def test_filter_flush_without_marker_returns_all():
    guard = EndSponsorFilter()
    assert guard.feed("普通结尾") == "普通结尾"
    assert guard.flush() == ""


# ---- LLMRouter / LLMService 接入 ----


@pytest.mark.anyio
async def test_router_chat_strips_sponsor(monkeypatch):
    async def fake_acompletion(**kwargs):
        return _NonStreamResponse(SAMPLE)

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    out = await _router().chat(user_prompt="hi", model="test-model")
    assert out == strip_end_sponsor(SAMPLE)


@pytest.mark.anyio
async def test_router_stream_strips_sponsor(monkeypatch):
    stream = _Stream([_Chunk(ch) for ch in SAMPLE])

    async def fake_acompletion(**kwargs):
        return stream

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    texts = [
        item
        async for item in _router().chat_stream_with_stop(user_prompt="hi")
        if isinstance(item, str)
    ]
    assert "".join(texts) == strip_end_sponsor(SAMPLE)


@pytest.mark.anyio
async def test_router_stream_keeps_normal_output(monkeypatch):
    """正常响应既不被改动，也不会被缓冲改变首个产出。"""
    stream = _Stream([_Chunk("你"), _Chunk("好")])

    async def fake_acompletion(**kwargs):
        return stream

    monkeypatch.setattr(router_module, "acompletion", fake_acompletion)
    texts = [
        item
        async for item in _router().chat_stream_with_stop(user_prompt="hi")
        if isinstance(item, str)
    ]
    assert texts == ["你", "好"]


@pytest.mark.anyio
async def test_service_chat_strips_sponsor(monkeypatch):
    async def fake_acompletion(**kwargs):
        return _NonStreamResponse(SAMPLE)

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)
    service = LLMService(api_key="k", default_model="test-model")
    out = await service.chat(user_prompt="hi")
    assert out == strip_end_sponsor(SAMPLE)


@pytest.mark.anyio
async def test_service_stream_strips_sponsor(monkeypatch):
    stream = _Stream([_Chunk(ch) for ch in SAMPLE])

    async def fake_acompletion(**kwargs):
        return stream

    monkeypatch.setattr(llm_module, "acompletion", fake_acompletion)
    service = LLMService(api_key="k", default_model="test-model")
    texts = [
        item
        async for item in service.chat_stream_with_stop(user_prompt="hi")
        if isinstance(item, str)
    ]
    assert "".join(texts) == strip_end_sponsor(SAMPLE)
