"""LLM Router：按模型的 Provider 优先级链自动 fallback。"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, Optional

import litellm
from litellm import acompletion

from app.services.llm import estimate_missing_usage, extract_usage

logger = logging.getLogger(__name__)


def is_retryable(exc: Exception) -> bool:
    """判断异常是否可重试（触发 fallback 到下一 Provider）。"""
    # HTTP status code
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(exc, "status", None)
    # 有些 litellm 异常把 status_code 放在 args 里
    try:
        s = int(status) if status is not None else None
        if s in (429, 500, 502, 503, 504):
            return True
        # 401/403/400 等不重试
        if s is not None and s in (400, 401, 403, 404, 422):
            return False
    except Exception:
        pass

    name = exc.__class__.__name__ or ""
    if name in ("RateLimitError", "ServiceUnavailableError", "APIConnectionError", "Timeout", "TimeoutError"):
        return True
    # 检查异常类型字符串（含 openai/httpx 的变体如 APITimeoutError/ConnectTimeout/ReadTimeout）
    name_lower = name.lower()
    if any(k in name_lower for k in ("ratelimit", "serviceunavailable", "apiconnection", "timeout", "connect")):
        return True

    msg = str(exc).lower()
    # 常见可重试文案
    if any(k in msg for k in ("timeout", "timed out", "connection", "overloaded", "overload", "try again", "rate limit", "429", "502", "503", "504", "500")):
        # 但 401/403 文案不应重试
        if any(k in msg for k in ("invalid api key", "unauthorized", "authentication", "api key")):
            # 401 鉴权错误不重试
            if "401" in msg or "unauthorized" in msg or "invalid api key" in msg:
                return False
        return True
    return False


class LLMRouter:
    """按模型优先级链的聚合路由。

    providers_for_model: 已按该模型的 priority 排序且仅含 enabled 的 Provider 列表
        每项为 dict {id, name, base_url, api_key, enabled, ...}
    """

    def __init__(
        self,
        providers_for_model: list[dict],
        default_model: str,
        max_tokens: int = 4096,
        timeout: int = 120,
    ):
        self.providers = list(providers_for_model or [])
        self.default_model = default_model
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.provider_used: Optional[dict] = None
        self.attempts: int = 0
        self._last_error: Optional[Exception] = None
        litellm.set_verbose = False
        litellm.drop_params = True

    def _get_model(self, model: Optional[str]) -> str:
        return model or self.default_model

    def _build_kwargs(
        self,
        provider: dict,
        model: str,
        messages: list,
        max_tokens: Optional[int],
        stream: bool,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
    ) -> dict:
        # provider_model_id 为该 Provider 下实际的 LiteLLM ID（可与逻辑 model 不同）
        actual_model = (provider.get("provider_model_id") or "").strip() or model
        kwargs = {
            "model": actual_model,
            "messages": messages,
            "max_tokens": max_tokens or self.max_tokens,
            "timeout": self.timeout,
            "api_key": provider.get("api_key") or "",
            "stream": stream,
        }
        base_url = (provider.get("base_url") or "").strip()
        if base_url:
            kwargs["api_base"] = base_url
        if thinking_budget and thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        elif reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        if stream:
            kwargs["stream_options"] = {"include_usage": True}
        return kwargs

    async def chat(
        self,
        *,
        model: Optional[str] = None,
        messages: Optional[list[dict]] = None,
        user_prompt: str = "",
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        usage_out: Optional[dict] = None,
    ) -> str:
        if not self.providers:
            raise RuntimeError("该模型未绑定任何可用 Provider")

        model_id = self._get_model(model)
        # 构造 messages
        if messages is not None:
            request_messages = messages
        else:
            request_messages = []
            if system_prompt:
                request_messages.append({"role": "system", "content": system_prompt})
            request_messages.append({"role": "user", "content": user_prompt})

        last_exc: Optional[Exception] = None
        for idx, provider in enumerate(self.providers):
            self.attempts = idx + 1
            kwargs = self._build_kwargs(
                provider, model_id, request_messages, max_tokens, stream=False,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
            )
            try:
                response = await acompletion(**kwargs)
                content = response.choices[0].message.content or ""
                if usage_out is not None:
                    extract_usage(getattr(response, "usage", None), usage_out)
                    estimate_missing_usage(request_messages, content, kwargs["model"], usage_out)
                self.provider_used = provider
                return content
            except Exception as e:
                last_exc = e
                self._last_error = e
                # 判断是否可重试到下一 Provider
                if idx < len(self.providers) - 1 and is_retryable(e):
                    logger.warning(
                        "LLM chat fallback: model=%s provider=%s (%s) 失败，将尝试下一优先级: %s",
                        model_id, provider.get("id"), provider.get("name"), e,
                    )
                    continue
                # 不可重试或已无下一家
                logger.error(f"LLM chat error (provider={provider.get('id')}): {e}")
                raise
        # 理论上不会到这里
        if last_exc:
            raise last_exc
        raise RuntimeError("LLM chat 无可用 Provider")

    async def chat_stream_with_stop(
        self,
        *,
        model: Optional[str] = None,
        user_prompt: str = "",
        system_prompt: Optional[str] = None,
        messages: Optional[list[dict]] = None,
        max_tokens: Optional[int] = None,
        stop_event: Optional[asyncio.Event] = None,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        usage_out: Optional[dict] = None,
    ) -> AsyncGenerator[str, None]:
        if not self.providers:
            raise RuntimeError("该模型未绑定任何可用 Provider")

        model_id = self._get_model(model)
        if messages is not None:
            base_messages = messages
        else:
            base_messages = []
            if system_prompt:
                base_messages.append({"role": "system", "content": system_prompt})
            base_messages.append({"role": "user", "content": user_prompt})

        last_exc: Optional[Exception] = None
        for idx, provider in enumerate(self.providers):
            self.attempts = idx + 1
            kwargs = self._build_kwargs(
                provider, model_id, base_messages, max_tokens, stream=True,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
            )
            yielded_any = False
            streamed_parts: list[str] = []
            try:
                response = await acompletion(**kwargs)
                async for chunk in response:
                    if stop_event and stop_event.is_set():
                        logger.info("LLM stream stopped by stop_event")
                        break
                    if not getattr(chunk, "choices", None):
                        if usage_out is not None and getattr(chunk, "usage", None):
                            extract_usage(chunk.usage, usage_out)
                        continue
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        yielded_any = True
                        streamed_parts.append(delta.content)
                        yield delta.content
                # 流正常结束（或被 stop_event 中断）
                if usage_out is not None:
                    estimate_missing_usage(base_messages, "".join(streamed_parts), kwargs["model"], usage_out)
                self.provider_used = provider
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                last_exc = e
                self._last_error = e
                # 若已吐出首 token，则不再 fallback，直接抛
                if yielded_any:
                    logger.error(f"LLM stream error after yield (provider={provider.get('id')}): {e}")
                    raise
                # 首 token 前失败且可重试且有下一家，则 fallback
                if idx < len(self.providers) - 1 and is_retryable(e):
                    logger.warning(
                        "LLM stream fallback (pre-yield): model=%s provider=%s (%s) 失败，切下一优先级: %s",
                        model_id, provider.get("id"), provider.get("name"), e,
                    )
                    continue
                logger.error(f"LLM stream error (provider={provider.get('id')}): {e}")
                raise
        if last_exc:
            raise last_exc
        raise RuntimeError("LLM stream 无可用 Provider")
