"""LLM Router：按模型的 Provider 优先级链自动 fallback。"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, AsyncIterator, Optional

import litellm
from litellm import acompletion

from app.services.llm import (
    estimate_missing_usage,
    extract_reasoning_from_delta,
    extract_usage,
)

logger = logging.getLogger(__name__)

# 单家 Provider 等待「第一个数据块」的秒数上限（管理后台可改，见 first_token_timeout）。
# 超时即判该家失效并切下一家：优先级链上后面的家若能干活，用户不必陪着失效的家干等。
DEFAULT_FIRST_TOKEN_TIMEOUT = 30

# 单家错误摘要的长度上限：多家串起来要能塞进使用日志的 500 字 error_message
_MAX_ATTEMPT_ERROR_CHARS = 110

# 「换任何 Provider 结果都一样」的错误：命中就不切换，直接抛出，免得白等后面的家。
# 其余失败一律切换 —— 401/403（key 失效、欠费）、404（该家没有这个模型）、
# 400/422（该家不支持某个参数）都是「某一家自己的问题」，正是备用家该顶上的场景，
# 与管理后台优先级链「首位优先，失败自动 fallback 到下一位」的语义一致。
_NON_RETRYABLE_CLASSES = {"ContextWindowExceededError", "ContentPolicyViolationError"}
_NON_RETRYABLE_KEYWORDS = (
    # 上下文超限
    "context length",
    "context window",
    "maximum context",
    "too many tokens",
    "prompt is too long",
    "input is too long",
    "reduce the length",
    # 内容审核
    "content policy",
    "content_policy",
    "content management policy",
    "content filter",
    "content_filter",
    "response was filtered",
    "prompt was filtered",
    "responsible ai",
    "moderation",
    "内容审核",
    "违规内容",
)


class EmptyResponseError(RuntimeError):
    """上游既没报错也没吐出任何正文：按该家失效处理，可切下一家。"""


def is_retryable(exc: Exception) -> bool:
    """该异常是否应切换到下一 Provider。

    默认切换；只有上下文超限与内容审核这两类「换谁都一样」的错误不切 ——
    再试下一家必然同样失败，只会把用户的等待拖得更长。
    """
    name = exc.__class__.__name__ or ""
    if name in _NON_RETRYABLE_CLASSES:
        return False
    msg = str(exc).lower()
    if any(keyword in msg for keyword in _NON_RETRYABLE_KEYWORDS):
        return False
    return True


def _is_timeout_error(exc: Exception) -> bool:
    """是否属于「等待超时」：前端据此区分「响应超时」与「通道不可用」。"""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    return "timeout" in (exc.__class__.__name__ or "").lower()


async def _chunks_from(first_chunk, iterator: AsyncIterator):
    """把首块与剩余迭代器拼回一条流，供上层统一 for 循环消费。"""
    yield first_chunk
    async for chunk in iterator:
        yield chunk


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
        first_token_timeout: float = DEFAULT_FIRST_TOKEN_TIMEOUT,
    ):
        self.providers = list(providers_for_model or [])
        self.default_model = default_model
        self.max_tokens = max_tokens
        self.timeout = timeout
        # 下限取 0.05 秒只为便于测试注入极小值；配置层限制在 5~600 秒
        try:
            self.first_token_timeout = max(0.05, float(first_token_timeout or DEFAULT_FIRST_TOKEN_TIMEOUT))
        except (TypeError, ValueError):
            self.first_token_timeout = float(DEFAULT_FIRST_TOKEN_TIMEOUT)
        self.provider_used: Optional[dict] = None
        # 最后尝试的那家：全链失败时用它给日志归属（provider_used 只在成功时赋值）
        self.last_provider: Optional[dict] = None
        # 逐家失败摘要 [(显示名, 错误)]，全链失败时写进使用日志，便于定位是哪家挂的
        self.attempt_errors: list[tuple[str, str]] = []
        self.attempts: int = 0
        self._last_error: Optional[Exception] = None
        litellm.set_verbose = False
        litellm.drop_params = True

    def _get_model(self, model: Optional[str]) -> str:
        return model or self.default_model

    def _provider_label(self, provider: dict) -> str:
        """日志里的 Provider 标识：名称优先，附上 id 便于与后台对照。"""
        name = (provider.get("name") or "").strip()
        pid = (provider.get("id") or "").strip()
        if name and pid:
            return f"{name}({pid})"
        return name or pid or "未知 Provider"

    def _remember_failure(self, provider: dict, exc: Exception) -> None:
        """记下这一家为什么失败，供最终的使用日志留痕。"""
        detail = " ".join(str(exc).split()) or exc.__class__.__name__
        self.attempt_errors.append(
            (self._provider_label(provider), detail[:_MAX_ATTEMPT_ERROR_CHARS])
        )

    @property
    def reported_provider(self) -> Optional[dict]:
        """使用日志的 Provider 归属：成功记命中的那家，失败记最后尝试的那家。"""
        return self.provider_used or self.last_provider

    def failure_summary(self, limit: int = 480) -> str:
        """逐家失败摘要（只进使用日志，不返回给终端用户）。"""
        if not self.attempt_errors:
            return ""
        parts = [
            f"[{idx}] {label}: {err}"
            for idx, (label, err) in enumerate(self.attempt_errors, start=1)
        ]
        return " | ".join(parts)[:limit]

    def _build_kwargs(
        self,
        provider: dict,
        model: str,
        messages: list,
        max_tokens: Optional[int],
        stream: bool,
        reasoning_effort: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        response_format: Optional[dict] = None,
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
        if response_format:
            kwargs["response_format"] = response_format
        return kwargs

    async def _open_stream(self, kwargs: dict) -> tuple[object, Optional[AsyncIterator]]:
        """发起流式请求并等到第一个数据块（正文或推理片段都算）。

        「建连 + 首块」共享 first_token_timeout 预算；首块一到即交还给 litellm 的
        timeout（按块读超时）约束，正在出字的流不会被这段限时掐断。
        返回 (response, 数据块迭代器)；上游直接返回空流时迭代器为 None。
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.first_token_timeout
        response = await asyncio.wait_for(
            acompletion(**kwargs), timeout=self.first_token_timeout
        )
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError("等待首个数据块超时")
        iterator = response.__aiter__()
        try:
            first_chunk = await asyncio.wait_for(iterator.__anext__(), timeout=remaining)
        except StopAsyncIteration:
            return response, None
        except asyncio.CancelledError:
            raise
        except Exception:
            # 建连成功却没等到首块（多为超时）：顺手关掉这条连接，别让它挂在外面
            await self._aclose_stream(response)
            raise
        return response, _chunks_from(first_chunk, iterator)

    @staticmethod
    async def _aclose_stream(response: object | None) -> None:
        """切换 Provider 前尽力关掉已废弃的上游流，避免连接泄漏。"""
        if response is None:
            return
        for attr in ("aclose", "close"):
            closer = getattr(response, attr, None)
            if not callable(closer):
                continue
            try:
                result = closer()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.debug("关闭上游流失败（忽略）", exc_info=True)
            return

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
        response_format: Optional[dict] = None,
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
            self.last_provider = provider
            kwargs = self._build_kwargs(
                provider, model_id, request_messages, max_tokens, stream=False,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
                response_format=response_format,
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
                self._remember_failure(provider, e)
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
        response_format: Optional[dict] = None,
    ) -> AsyncGenerator[str | tuple[str, str] | tuple[str, dict], None]:
        """聚合路由的流式调用。

        产出三类值：
        - 正文：plain str
        - 推理：("reasoning", text)
        - 切换通知：("fallback", {failed_index, total, next_index, reason})，
          供前端展示「第 n 个通道失效、正在试第 n+1 个」，不含 Provider 名称。

        fallback 语义：首个正文 token 前的失败才切下一家；纯推理片段不计入
        yielded_any，避免「只吐了思考就被误判为已开流」。首块等待受
        first_token_timeout 限制，超时按该家失效处理。
        """
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
            self.last_provider = provider
            kwargs = self._build_kwargs(
                provider, model_id, base_messages, max_tokens, stream=True,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
                response_format=response_format,
            )
            yielded_any = False
            streamed_parts: list[str] = []
            response: object | None = None
            try:
                response, chunks = await self._open_stream(kwargs)
                if chunks is not None:
                    async for chunk in chunks:
                        if stop_event and stop_event.is_set():
                            logger.info("LLM stream stopped by stop_event")
                            break
                        if not getattr(chunk, "choices", None):
                            if usage_out is not None and getattr(chunk, "usage", None):
                                extract_usage(chunk.usage, usage_out)
                            continue
                        delta = chunk.choices[0].delta
                        if delta is None:
                            continue
                        reasoning = extract_reasoning_from_delta(delta)
                        if reasoning:
                            yield ("reasoning", reasoning)
                        content = getattr(delta, "content", None)
                        if isinstance(delta, dict):
                            content = delta.get("content", content)
                        if content:
                            yielded_any = True
                            streamed_parts.append(content)
                            yield content
                # 流结束：用户停止按正常收尾；否则要求至少产出过正文，
                # 空响应（上游既没报错也没给正文）算该家失效，交给下面的 fallback 逻辑
                stopped = bool(stop_event and stop_event.is_set())
                if not yielded_any and not stopped:
                    raise EmptyResponseError(
                        f"{self._provider_label(provider)} 未返回任何正文"
                    )
                if usage_out is not None:
                    estimate_missing_usage(base_messages, "".join(streamed_parts), kwargs["model"], usage_out)
                self.provider_used = provider
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                last_exc = e
                self._last_error = e
                self._remember_failure(provider, e)
                await self._aclose_stream(response)
                # 若已吐出首 token，则不再 fallback，直接抛
                if yielded_any:
                    logger.error(f"LLM stream error after yield (provider={provider.get('id')}): {e}")
                    raise
                # 首 token 前失败且可重试且有下一家，则 fallback
                if idx < len(self.providers) - 1 and is_retryable(e):
                    if isinstance(e, EmptyResponseError):
                        reason = "empty"
                    elif _is_timeout_error(e):
                        reason = "timeout"
                    else:
                        reason = "unavailable"
                    logger.warning(
                        "LLM stream fallback (%s): model=%s provider=%s (%s) 失败，切下一优先级: %s",
                        reason, model_id, provider.get("id"), provider.get("name"), e,
                    )
                    yield ("fallback", {
                        "failed_index": idx + 1,
                        "total": len(self.providers),
                        "next_index": idx + 2,
                        "reason": reason,
                    })
                    continue
                logger.error(f"LLM stream error (provider={provider.get('id')}): {e}")
                raise
        if last_exc:
            raise last_exc
        raise RuntimeError("LLM stream 无可用 Provider")
