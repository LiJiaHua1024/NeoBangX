import asyncio
import logging
from typing import AsyncGenerator, Optional

import litellm
from litellm import acompletion

logger = logging.getLogger(__name__)


def extract_usage(usage, out: dict) -> None:
    """从 litellm 的 usage 对象提取 token 计数到 out；字段缺失时静默跳过。"""
    if usage is None:
        return
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = getattr(usage, key, None)
        if isinstance(value, (int, float)):
            out[key] = int(value)


def estimate_missing_usage(
    messages: list, completion_text: str, model: str, out: dict | None
) -> None:
    """供应商未回传（或部分回传）usage 时，按本地 tokenizer 估算补齐缺失字段。

    采用 litellm.token_counter（底层 tiktoken cl100k，词表随 litellm 内置、
    完全离线）：对 OpenAI 系模型精确，对其它模型（Qwen/GLM/DeepSeek 等）
    是同量级近似，用于用量统计足够。已在流中途停止、网关不回传 usage 等
    场景下保证 token 数不缺数；补齐过的 dict 会带上 estimated=True 供
    管理台区分精确值与估算值。任何估算失败都不应影响主请求。
    """
    if out is None:
        return
    missing = [key for key in ("prompt_tokens", "completion_tokens", "total_tokens") if key not in out]
    if not missing:
        return
    try:
        if "prompt_tokens" in missing:
            out["prompt_tokens"] = litellm.token_counter(model=model, messages=messages)
        if "completion_tokens" in missing:
            out["completion_tokens"] = litellm.token_counter(model=model, text=completion_text or "")
        if "total_tokens" in missing:
            out["total_tokens"] = out.get("prompt_tokens", 0) + out.get("completion_tokens", 0)
        out["estimated"] = True
    except Exception as e:
        logger.warning("Token usage estimation failed: %s", e)


class LLMService:
    """LiteLLM 调用封装

    提供非流式和流式两种调用方式，支持通过 model / api_key / base_url 参数切换不同后端。
    2026 年主流模型不再按任务调整 temperature / top_p，保持默认即可获得最佳性能。

    thinking 控制：
    - reasoning_effort：LiteLLM 统一推理强度参数（none/minimal/low/medium/high），
      由 LiteLLM 自动映射到各家供应商；none 表示关闭思考。
    - thinking_budget：显式思考 token 预算，优先级高于 reasoning_effort。
    - 两者都为空时不传任何参数，行为由供应商默认策略决定。
    """

    def __init__(
        self,
        api_key: str,
        default_model: str,
        base_url: str = "",
        max_tokens: int = 4096,
        timeout: int = 120,
    ):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url
        self.max_tokens = max_tokens
        self.timeout = timeout

        # 设置 LiteLLM 日志级别
        litellm.set_verbose = False
        # 供应商不支持的参数（如 reasoning_effort）自动丢弃而非报错
        litellm.drop_params = True

    def _get_model(self, model: Optional[str]) -> str:
        return model or self.default_model

    def _get_messages(self, system_prompt: Optional[str], user_prompt: str) -> list:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})
        return messages

    def _build_kwargs(
        self,
        model: Optional[str],
        messages: list,
        api_key: Optional[str],
        base_url: Optional[str],
        max_tokens: Optional[int],
        stream: bool,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        response_format: Optional[dict] = None,
    ) -> dict:
        kwargs = {
            "model": self._get_model(model),
            "messages": messages,
            "max_tokens": max_tokens or self.max_tokens,
            "timeout": self.timeout,
            "api_key": api_key or self.api_key,
            "stream": stream,
        }
        # LiteLLM 使用 api_base 指定自定义 endpoint（如 OpenAI 兼容服务）
        effective_base_url = base_url or self.base_url
        if effective_base_url:
            kwargs["api_base"] = effective_base_url
        # thinking 控制：显式预算优先，其次统一推理强度；都为空则交由供应商默认
        if thinking_budget and thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        elif reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        if stream:
            # 请求供应商在流末尾返回 token 用量；不支持的供应商由
            # litellm.drop_params 自动丢弃该参数，不会引发报错
            kwargs["stream_options"] = {"include_usage": True}
        if response_format:
            kwargs["response_format"] = response_format
        return kwargs

    async def chat(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_tokens: Optional[int] = None,
        messages: Optional[list[dict]] = None,
        usage_out: Optional[dict] = None,
        response_format: Optional[dict] = None,
    ) -> str:
        """非流式调用，返回完整字符串；传入 usage_out 时回填 token 用量。"""
        request_messages = messages or self._get_messages(system_prompt, user_prompt)
        kwargs = self._build_kwargs(
            model, request_messages, api_key, base_url, max_tokens, stream=False,
            response_format=response_format,
        )

        try:
            response = await acompletion(**kwargs)
            content = response.choices[0].message.content or ""
            if usage_out is not None:
                extract_usage(getattr(response, "usage", None), usage_out)
                # 供应商没回传 usage 时按实际请求 / 响应估算，保证日志不缺数
                estimate_missing_usage(request_messages, content, kwargs["model"], usage_out)
            return content
        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            raise

    async def chat_stream(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_tokens: Optional[int] = None,
    ) -> AsyncGenerator[str, None]:
        """流式调用，逐 token 返回文本片段"""
        messages = self._get_messages(system_prompt, user_prompt)
        kwargs = self._build_kwargs(model, messages, api_key, base_url, max_tokens, stream=True)

        try:
            response = await acompletion(**kwargs)
            async for chunk in response:
                # 部分网关（OpenRouter / one-api 类）会发空 choices 的
                # keep-alive 或 usage 分块，直接跳过避免 IndexError 打断整条流
                if not getattr(chunk, "choices", None):
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content
        except asyncio.CancelledError:
            logger.info("LLM stream cancelled by client")
            raise
        except Exception as e:
            logger.error(f"LLM stream error: {e}")
            raise

    async def chat_stream_with_stop(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_tokens: Optional[int] = None,
        stop_event: Optional[asyncio.Event] = None,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        usage_out: Optional[dict] = None,
        response_format: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        """支持中止的流式调用

        当 stop_event 被 set 时，停止生成并退出。
        传入 usage_out 时，流末尾的 usage 分块（空 choices）会被提取而非丢弃。
        """
        messages = self._get_messages(system_prompt, user_prompt)
        kwargs = self._build_kwargs(
            model, messages, api_key, base_url, max_tokens, stream=True,
            reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
            response_format=response_format,
        )

        streamed_parts: list[str] = []
        try:
            response = await acompletion(**kwargs)
            async for chunk in response:
                if stop_event and stop_event.is_set():
                    logger.info("LLM stream stopped by stop_event")
                    break
                if not getattr(chunk, "choices", None):
                    # keep-alive / usage 分块：提取 token 用量后跳过
                    if usage_out is not None and getattr(chunk, "usage", None):
                        extract_usage(chunk.usage, usage_out)
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    streamed_parts.append(delta.content)
                    yield delta.content
        except asyncio.CancelledError:
            logger.info("LLM stream cancelled by client")
            raise
        except Exception as e:
            logger.error(f"LLM stream error: {e}")
            raise
        finally:
            if usage_out is not None:
                # 中途停止 / 断开 / 异常时收不到末尾 usage 分块，
                # 用已实际流出的文本估算，cancelled 的请求同样不缺数
                estimate_missing_usage(messages, "".join(streamed_parts), kwargs["model"], usage_out)
