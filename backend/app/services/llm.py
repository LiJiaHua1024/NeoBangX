import asyncio
import logging
from typing import AsyncGenerator, Optional

import litellm
from litellm import acompletion

logger = logging.getLogger(__name__)


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
    ) -> str:
        """非流式调用，返回完整字符串"""
        request_messages = messages or self._get_messages(system_prompt, user_prompt)
        kwargs = self._build_kwargs(
            model, request_messages, api_key, base_url, max_tokens, stream=False,
        )

        try:
            response = await acompletion(**kwargs)
            return response.choices[0].message.content or ""
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
    ) -> AsyncGenerator[str, None]:
        """支持中止的流式调用

        当 stop_event 被 set 时，停止生成并退出。
        """
        messages = self._get_messages(system_prompt, user_prompt)
        kwargs = self._build_kwargs(
            model, messages, api_key, base_url, max_tokens, stream=True,
            reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
        )

        try:
            response = await acompletion(**kwargs)
            async for chunk in response:
                if stop_event and stop_event.is_set():
                    logger.info("LLM stream stopped by stop_event")
                    break
                # 同上：跳过空 choices 的 keep-alive / usage 分块
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
