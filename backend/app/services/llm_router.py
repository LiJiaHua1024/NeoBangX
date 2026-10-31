"""LLM Router：按模型的 Provider 优先级链自动 fallback。

Provider 切换判定由 Jev 决策模型优先执行（见 `app.services.jev_judge`），
规则以自然语言写在判定问题里；Jev 不可用时立刻回退到程序化启发式，
`is_retryable` 即该同步回退入口（保持旧名供测试与调用方使用）。
判定是 `await` 住的：流式路径在结论出来前不产生任何 SSE 事件，前端只是
多等一会儿，不会收到多次错误或突变的消息。
"""

from __future__ import annotations

import asyncio
import copy
import logging
import math
import random
from time import monotonic
from typing import Any, AsyncGenerator, AsyncIterator, Optional

import litellm
from litellm import acompletion

from app.services import provider_health
from app.services.jev_judge import a_should_retry_provider, heuristic_is_retryable
from app.services.llm import (
    estimate_missing_usage,
    extract_reasoning_from_delta,
    extract_usage,
    has_reasoning_params,
    is_reasoning_param_error,
    strip_reasoning_kwargs,
)
from app.services.output_guard import EndSponsorFilter, strip_end_sponsor

logger = logging.getLogger(__name__)

# 单家 Provider 等待「第一个数据块」的秒数上限（管理后台可改，见 first_token_timeout）。
# 超时即判该家失效并切下一家：优先级链上后面的家若能干活，用户不必陪着失效的家干等。
DEFAULT_FIRST_TOKEN_TIMEOUT = 30

# ---- 快重试（quick retry）与首块总预算 ----
# 「失败得快才原地重试，失败得慢（挂起型）直接切下一家」，准入见 _plan_quick_retry。
DEFAULT_QUICK_RETRY_DELAY_MS = 250.0
# 快速失败的判定阈值：本次失败耗时低于它才算「快」，默认 2 秒
DEFAULT_FAST_FAIL_MS = 2000.0
# 快重试的首块等待收紧上限：第一次都没扛住，第二次给它更短的预算
DEFAULT_QUICK_RETRY_TIMEOUT = 10.0
# 整条 fallback 链的首块总预算：从第一家开始计时，同时约束后续家的等待，
# 全链最坏总等待接近它而不是每家各等满 first_token_timeout
DEFAULT_TOTAL_FIRST_TOKEN_BUDGET = 45.0

# Retry-After 超过这个秒数就放弃快重试、直接切下一家：等 30 秒不如让后面的家
# 顶上；便宜家的恢复交给熔断器的 HALF_OPEN 探测，不在单次请求里干等。
_RETRY_AFTER_MAX_WAIT = 3.0
# 首块总预算耗尽后仍给后续家的最小首块等待（秒）：纯切换不禁止（见
# _effective_first_token_timeout），但每家只给一小截机会。
_BUDGET_FLOOR = 5.0

# 单家错误摘要的长度上限：多家串起来要能塞进使用日志的 500 字 error_message
_MAX_ATTEMPT_ERROR_CHARS = 110

# 「换任何 Provider 结果都一样」的错误判定主体已搬迁至 `app.services.jev_judge`
# （Jev 优先、启发式回退）。此处保留同名同步入口：纯启发式，供测试与无需 Jev 的调用方使用。
_NON_RETRYABLE_CLASSES = {"ContextWindowExceededError", "ContentPolicyViolationError"}
_NON_RETRYABLE_KEYWORDS = (
    # 上下文超限
    "context length",
    "context_length_exceeded",
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
    """该异常是否应切换到下一 Provider（同步启发式回退入口）。

    默认切换；只有上下文超限与内容审核这两类「换谁都一样」的错误不切 ——
    再试下一家必然同样失败，只会把用户的等待拖得更长。
    Jev 启用时实际走 `LLMRouter._should_retry`（Jev 优先、失败回退到本函数）。
    """
    return heuristic_is_retryable(exc)


async def a_is_retryable(exc: Exception, jev_cfg: dict | None = None, **context: Any) -> bool:
    """该异常是否应切换到下一 Provider（Jev 优先、不可用立刻回退启发式）。"""
    return await a_should_retry_provider(exc, jev_cfg, **context)


def _is_timeout_error(exc: Exception) -> bool:
    """是否属于「等待超时」：前端据此区分「响应超时」与「通道不可用」。"""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    return "timeout" in (exc.__class__.__name__ or "").lower()


def _retry_after_seconds(exc: BaseException) -> Optional[float]:
    """从异常上尽力取 Retry-After（秒）；取不到或不认识的形态返回 None。

    litellm 的 HTTP 类异常带 `response`（httpx.Response），header 可从中取；
    超时/连接类错误没有 response。HTTP-date 形态不解析（退回默认抖动延迟）。
    """
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        raw = headers.get("retry-after")
        if raw is None:
            raw = headers.get("Retry-After")
    except Exception:  # noqa: BLE001
        return None
    if raw is None:
        return None
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if value < 0 or value != value:  # 负数 / NaN
        return None
    return value


def retry_after_seconds(exc: BaseException) -> Optional[float]:
    """上游给的 Retry-After 秒数（取不到返回 None）。

    公开给 Agent 适配层复用：它需要在同一家 Provider 上等待重试，
    等待时长必须尊重上游的限速提示，而不是自己拍一个延迟。
    """
    return _retry_after_seconds(exc)


def _count_breaker_skipped(providers: list[dict]) -> int:
    """链里当前被熔断（OPEN、将沉底）的家数。"""
    return sum(
        1 for provider in providers
        if provider_health.is_open(((provider or {}).get("id") or "").strip())
    )


def _non_negative(value: Any, default: float) -> float:
    """构造参数清洗：非法值回退默认，合法值（含 0，0 有关闭语义）原样保留。"""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


async def _chunks_from(first_chunk, iterator: AsyncIterator):
    """把首块与剩余迭代器拼回一条流，供上层统一 for 循环消费。"""
    yield first_chunk
    async for chunk in iterator:
        yield chunk


class LLMRouter:
    """按模型优先级链的聚合路由。

    providers_for_model: 已按该模型的 priority 排序且仅含 enabled 的 Provider 列表
        每项为 dict {id, name, base_url, api_key, enabled, ...}。构造时按
        `provider_health` 的熔断状态重排：熔断 OPEN 中的沉底，其余保持原顺序。
    """

    def __init__(
        self,
        providers_for_model: list[dict],
        default_model: str,
        max_tokens: int = 4096,
        timeout: int = 120,
        first_token_timeout: float = DEFAULT_FIRST_TOKEN_TIMEOUT,
        jev_config: dict | None = None,
        quick_retry_delay_ms: float = DEFAULT_QUICK_RETRY_DELAY_MS,
        fast_fail_ms: float = DEFAULT_FAST_FAIL_MS,
        quick_retry_timeout: float = DEFAULT_QUICK_RETRY_TIMEOUT,
        total_first_token_budget: float = DEFAULT_TOTAL_FIRST_TOKEN_BUDGET,
    ):
        self.providers = list(providers_for_model or [])
        self.default_model = default_model
        self.max_tokens = max_tokens
        self.timeout = timeout
        # Jev 判定配置（管理后台可配）：None/未启用时直接走启发式，不碰网络
        self.jev_config = dict(jev_config) if isinstance(jev_config, dict) else None
        # 下限取 0.05 秒只为便于测试注入极小值；配置层限制在 5~600 秒
        try:
            self.first_token_timeout = max(0.05, float(first_token_timeout or DEFAULT_FIRST_TOKEN_TIMEOUT))
        except (TypeError, ValueError):
            self.first_token_timeout = float(DEFAULT_FIRST_TOKEN_TIMEOUT)
        # ---- 快重试与首块总预算（均可注入，管理后台可配可后置）----
        # fast_fail_ms=0 表示关闭快重试（失败耗时 < 0 不可能成立）
        self.quick_retry_delay_ms = _non_negative(quick_retry_delay_ms, DEFAULT_QUICK_RETRY_DELAY_MS)
        self.fast_fail_ms = _non_negative(fast_fail_ms, DEFAULT_FAST_FAIL_MS)
        self.quick_retry_timeout = _non_negative(quick_retry_timeout, DEFAULT_QUICK_RETRY_TIMEOUT)
        # total_first_token_budget <= 0 表示不限总预算
        self.total_first_token_budget = _non_negative(total_first_token_budget, DEFAULT_TOTAL_FIRST_TOKEN_BUDGET)
        self.provider_used: Optional[dict] = None
        # 最后尝试的那家：全链失败时用它给日志归属（provider_used 只在成功时赋值）
        self.last_provider: Optional[dict] = None
        # 逐家失败摘要 [(显示名, 错误)]，全链失败时写进使用日志，便于定位是哪家挂的。
        # 口径与 attempts 一致（每家一条）：快重试的两次失败合并成一条，快重试
        # 直接成功则不留痕（没有发生切换，不给健康的第一家挂「备用切换」尾注）。
        self.attempt_errors: list[tuple[str, str]] = []
        self.attempts: int = 0
        # 状态上报：快重试次数、被熔断沉底/跳过的家数（按最近一次调用计）
        self.quick_retries: int = 0
        self.breaker_skipped: int = 0
        self._chain_started: float = monotonic()
        self._last_error: Optional[Exception] = None
        litellm.set_verbose = False
        litellm.drop_params = True
        # 熔断重排放在字段初始化之后：breaker_skipped 按构造时的健康状态计
        self.providers = self._ordered_providers(self.providers)

    def _get_model(self, model: Optional[str]) -> str:
        return model or self.default_model

    def _provider_label(self, provider: dict) -> str:
        """日志里的 Provider 标识：直接显示备注名称，无名时才回退到 ID。"""
        name = (provider.get("name") or "").strip()
        pid = (provider.get("id") or "").strip()
        return name or pid or "未知 Provider"

    def _remember_failure(self, provider: dict, exc: Exception, *, quick_retried: bool = False) -> None:
        """记下这一家为什么失败，供最终的使用日志留痕。

        每家只记一条（快重试的两次失败合并）：attempt_errors 的序号与
        fallback_attempts「尝试家数」的口径保持一致，后台数日志不会数错家数。
        """
        detail = " ".join(str(exc).split()) or exc.__class__.__name__
        if quick_retried:
            detail = f"快重试后仍失败: {detail}"
        self.attempt_errors.append(
            (self._provider_label(provider), detail[:_MAX_ATTEMPT_ERROR_CHARS])
        )

    def _retry_key(self, provider: dict) -> str:
        """快重试去重键：每家每次调用最多快重试一次。"""
        return (provider.get("id") or "").strip() or self._provider_label(provider)

    def _settle_success(self, provider: dict) -> None:
        """成功结算：记入使用日志归属，并清零该家的熔断记忆。"""
        self.provider_used = provider
        provider_health.record_success((provider.get("id") or "").strip())

    def _settle_failure(self, provider: dict, exc: Exception) -> None:
        """失败结算（该家本次已被放弃）：瞬态失败计入熔断记忆，非瞬态不计。

        快重试场景由调用方保证只在「最终放弃」时调用一次（首败与重试败
        合并一笔），单次网络抖动不会双记把便宜家熔掉。
        """
        provider_health.record_failure((provider.get("id") or "").strip(), exc)

    def _ordered_providers(self, providers: Optional[list[dict]] = None) -> list[dict]:
        """按熔断健康状态重排链：OPEN 中的沉底，其余保持原相对顺序。

        `providers_override`（并发执行器「避开上一家」的局部顺序）作为基底时
        两套语义同时保留：override 的先后是基底顺序，熔断中的仍然沉底。
        breaker_skipped 记本次调用里被熔断压下去的家数。
        """
        base = self.providers if providers is None else providers
        self.breaker_skipped = _count_breaker_skipped(base)
        return provider_health.apply_breaker_order(base)

    def ordered_providers(self) -> list[dict]:
        """按熔断健康状态排好序的 provider 链。

        给 Agent 原生工具流适配器用：它自己挑 provider 走流式工具调用，
        必须复用同一套「OPEN 沉底」的顺序，否则每次调用都会先打已经挂掉的那一家。
        """
        return self._ordered_providers()

    def _budget_left(self) -> float:
        """首块总预算剩余（秒）；<=0 的配置表示不限，返回 math.inf。"""
        if self.total_first_token_budget <= 0:
            return math.inf
        return self.total_first_token_budget - (monotonic() - self._chain_started)

    def _effective_first_token_timeout(self, *, quick: bool = False) -> float:
        """本次尝试的「建连 + 首块」等待上限（秒）。

        首块总预算同时约束后续家的等待：第一家挂满 30 秒后第二家只剩多少预算
        就只等多少，全链最坏总等待接近预算而不是每家各等满 first_token_timeout；
        预算耗尽后仍给 _BUDGET_FLOOR 的最小机会（纯切换不禁止）。快重试再叠加
        quick_retry_timeout 收紧：第一次都没扛住，第二次给更短的预算。
        """
        left = self._budget_left()
        if left == math.inf:
            allowed = math.inf
        else:
            allowed = left if left > 0 else _BUDGET_FLOOR
        limit = min(self.first_token_timeout, allowed)
        if quick:
            limit = min(limit, self.quick_retry_timeout)
        return max(limit, 0.05)

    def _plan_quick_retry(
        self,
        exc: Exception,
        provider: dict,
        *,
        attempt_elapsed: float,
        attempt_timeout: float,
        quick_retried: set[str],
    ) -> Optional[float]:
        """决定是否同一家快重试；返回等待秒数，None 表示不重试（走 fallback 判定）。

        准入（全部满足）：
        1. 错误确定瞬态（该家自己的问题，重试才有意义；上下文超限/审核/413
           与模糊 400/422 一律不快重试）；
        2. 失败得快（耗时 < fast_fail_ms）——「吃掉大半等待预算的超时」就是
           挂起本身，直接切下一家，绝不原地重试；
        3. 该 Provider 本次调用还没快重试过（每家每次调用最多 1 次）；
        4. 首块总预算还有余量。

        等待：默认 quick_retry_delay_ms ± 50% 抖动；错误带 Retry-After 时按它
        等待，但它超过 _RETRY_AFTER_MAX_WAIT 就整个放弃快重试（等不如切）。
        """
        if self.fast_fail_ms <= 0:
            return None
        key = self._retry_key(provider)
        if key in quick_retried:
            return None
        if attempt_elapsed * 1000.0 >= self.fast_fail_ms:
            return None
        if _is_timeout_error(exc) and attempt_timeout > 0 and attempt_elapsed >= attempt_timeout * 0.5:
            return None
        if not provider_health.is_transient_failure(exc):
            return None
        if self._budget_left() <= 0:
            return None
        retry_after = _retry_after_seconds(exc)
        if retry_after is not None:
            return retry_after if retry_after <= _RETRY_AFTER_MAX_WAIT else None
        return self.quick_retry_delay_ms / 1000.0 * random.uniform(0.5, 1.5)

    async def _should_retry(self, exc: Exception, provider: dict, idx: int, total: int, model_id: str = "") -> bool:
        """该失败是否值得切下一家：Jev 优先判定，不可用立刻回退启发式。

        调用方在结论出来前不 yield 任何事件（Jev 往返期间前端停留在加载态），
        结论出来后要么 fallback 要么 raise，terminal error 永远只发一次。
        """
        return await a_should_retry_provider(
            exc,
            self.jev_config,
            model_id=model_id or self.default_model,
            provider_label=self._provider_label(provider),
            provider_index=idx + 1,
            provider_total=total,
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
        extra_body: Optional[dict] = None,
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

        merged_extra_body = {}
        if extra_body and isinstance(extra_body, dict):
            merged_extra_body.update(copy.deepcopy(extra_body))

        if thinking_budget and thinking_budget > 0:
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            merged_extra_body.setdefault("thinking_budget", thinking_budget)
            if "reasoning" not in merged_extra_body:
                merged_extra_body["reasoning"] = {"max_tokens": thinking_budget}
        elif reasoning_effort:
            # 直接透传用户配置的 reasoning_effort，不按厂商硬编码篡改值
            kwargs["reasoning_effort"] = reasoning_effort
            allowed = kwargs.setdefault("allowed_openai_params", [])
            if "reasoning_effort" not in allowed:
                allowed.append("reasoning_effort")
            # 同时兜底写入 extra_body（若未被用户显式覆盖），适配纯透传 extra_body 的网关
            if "reasoning_effort" not in merged_extra_body:
                merged_extra_body["reasoning_effort"] = reasoning_effort
            if "reasoning" not in merged_extra_body:
                merged_extra_body["reasoning"] = {"effort": reasoning_effort}

        if merged_extra_body:
            kwargs["extra_body"] = merged_extra_body

        if stream:
            kwargs["stream_options"] = {"include_usage": True}
        if response_format:
            kwargs["response_format"] = response_format
        return kwargs

    async def _open_stream(
        self, kwargs: dict, first_token_timeout: Optional[float] = None
    ) -> tuple[object, Optional[AsyncIterator]]:
        """发起流式请求并等到第一个数据块（正文或推理片段都算）。

        「建连 + 首块」共享 first_token_timeout 预算；首块一到即交还给 litellm 的
        timeout（按块读超时）约束，正在出字的流不会被这段限时掐断。
        first_token_timeout：本次尝试的首块等待上限（快重试与总预算收紧时传入
        更小值），缺省用构造参数。
        返回 (response, 数据块迭代器)；上游直接返回空流时迭代器为 None。
        """
        if first_token_timeout is None:
            timeout = self.first_token_timeout
        else:
            timeout = max(0.05, float(first_token_timeout))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        response = await asyncio.wait_for(
            acompletion(**kwargs), timeout=timeout
        )
        remaining = deadline - loop.time()
        if remaining <= 0:
            await self._aclose_stream(response)
            raise asyncio.TimeoutError("等待首个数据块超时")
        iterator = response.__aiter__()
        try:
            first_chunk = await asyncio.wait_for(iterator.__anext__(), timeout=remaining)
        except StopAsyncIteration:
            return response, None
        except asyncio.CancelledError:
            await self._aclose_stream(response)
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
        extra_body: Optional[dict] = None,
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
        self._chain_started = monotonic()
        providers = self._ordered_providers()
        quick_retried: set[str] = set()
        for idx, provider in enumerate(providers):
            self.attempts = idx + 1
            self.last_provider = provider
            if not provider_health.claim_attempt((provider.get("id") or "").strip()):
                self.breaker_skipped += 1
                logger.info("LLM chat skip: provider=%s 熔断半开探测中，本次不让探测", self._provider_label(provider))
                continue
            kwargs = self._build_kwargs(
                provider, model_id, request_messages, max_tokens, stream=False,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
                extra_body=extra_body, response_format=response_format,
            )
            attempt_started = monotonic()
            try:
                try:
                    response = await acompletion(**kwargs)
                except Exception as e:
                    if has_reasoning_params(kwargs) and is_reasoning_param_error(e):
                        logger.warning(
                            "Provider %s 拒绝推理参数，自动剥离推理参数在当前 Provider 原地重试: %s",
                            self._provider_label(provider), e,
                        )
                        kwargs = strip_reasoning_kwargs(kwargs)
                        response = await acompletion(**kwargs)
                    else:
                        raise

                content = response.choices[0].message.content or ""
                if not str(content).strip():
                    raise EmptyResponseError(f"{self._provider_label(provider)} 返回空响应")
                if usage_out is not None:
                    extract_usage(getattr(response, "usage", None), usage_out)
                    estimate_missing_usage(request_messages, content, kwargs["model"], usage_out)
                self._settle_success(provider)
                # 用量估算用原文（更接近计费），但吐给调用方的正文剥掉结尾赞助块
                return strip_end_sponsor(content)
            except Exception as e:
                self._last_error = e
                attempt_elapsed = monotonic() - attempt_started
                provider_exc: Exception = e
                # 快重试：失败得快且确定瞬态，同家再试一次（每家每次调用最多一次）。
                # 重试成功不留失败痕迹——没有发生切换，不给健康的第一家挂「备用切换」尾注。
                delay = self._plan_quick_retry(
                    e, provider, attempt_elapsed=attempt_elapsed,
                    attempt_timeout=self.timeout, quick_retried=quick_retried,
                )
                if delay is not None:
                    quick_retried.add(self._retry_key(provider))
                    self.quick_retries += 1
                    logger.warning(
                        "LLM chat quick retry: model=%s provider=%s 失败 %.0fms，%.0fms 后同家重试: %s",
                        model_id, self._provider_label(provider), attempt_elapsed * 1000, delay * 1000, e,
                    )
                    await asyncio.sleep(delay)
                    retry_kwargs = dict(kwargs)
                    # 快重试超时收紧：第一次都没扛住，第二次给它更短的预算
                    retry_kwargs["timeout"] = min(self.timeout, self.quick_retry_timeout)
                    try:
                        response = await acompletion(**retry_kwargs)
                        content = response.choices[0].message.content or ""
                        if not str(content).strip():
                            raise EmptyResponseError(f"{self._provider_label(provider)} 返回空响应")
                        if usage_out is not None:
                            extract_usage(getattr(response, "usage", None), usage_out)
                            estimate_missing_usage(request_messages, content, retry_kwargs["model"], usage_out)
                        self._settle_success(provider)
                        logger.info(
                            "LLM chat quick retry recovered: model=%s provider=%s",
                            model_id, self._provider_label(provider),
                        )
                        return strip_end_sponsor(content)
                    except Exception as retry_exc:  # noqa: BLE001
                        provider_exc = retry_exc
                        self._last_error = retry_exc
                # 该家最终被放弃：快重试的两次失败合并记一次，再计入熔断记忆
                last_exc = provider_exc
                self._remember_failure(provider, provider_exc, quick_retried=provider_exc is not e)
                self._settle_failure(provider, provider_exc)
                # 判断是否可重试到下一 Provider（Jev 优先、不可用回退启发式；
                # await 期间不产生任何事件，前端停留在加载态等结论）
                if idx < len(providers) - 1 and await self._should_retry(provider_exc, provider, idx, len(providers), model_id):
                    logger.warning(
                        "LLM chat fallback: model=%s provider=%s 失败，将尝试下一优先级: %s",
                        model_id, self._provider_label(provider), provider_exc,
                    )
                    continue
                # 不可重试或已无下一家
                logger.error(f"LLM chat error (provider={self._provider_label(provider)}): {provider_exc}")
                raise provider_exc
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
        extra_body: Optional[dict] = None,
        usage_out: Optional[dict] = None,
        response_format: Optional[dict] = None,
        providers_override: Optional[list[dict]] = None,
    ) -> AsyncGenerator[str | tuple[str, str] | tuple[str, dict], None]:
        """聚合路由的流式调用。

        providers_override：本次调用使用的通道顺序。并发执行器要「避开上一家重试」，
        旧做法是就地改 self.providers——那是一个共享列表，多个 worker 并发持有同一
        个 router 实例时会互相干扰，分片日志的 provider 归属也会记成最后写入者。
        改为传局部顺序，不动共享状态。

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
        self._chain_started = monotonic()
        # providers_override（并发执行器「避开上一家」的局部顺序）作为基底，
        # 熔断 OPEN 中的仍然沉底：两套语义同时保留
        providers = self._ordered_providers(providers_override or None)
        quick_retried: set[str] = set()
        for idx, provider in enumerate(providers):
            self.attempts = idx + 1
            self.last_provider = provider
            if not provider_health.claim_attempt((provider.get("id") or "").strip()):
                self.breaker_skipped += 1
                logger.info("LLM stream skip: provider=%s 熔断半开探测中，本次不让探测", self._provider_label(provider))
                continue
            kwargs = self._build_kwargs(
                provider, model_id, base_messages, max_tokens, stream=True,
                reasoning_effort=reasoning_effort, thinking_budget=thinking_budget,
                extra_body=extra_body, response_format=response_format,
            )
            # 每家最多快重试一次：retry_pending 标记当前这轮是快重试建连
            retry_pending = False
            while True:
                yielded_any = False
                streamed_parts: list[str] = []
                # 结尾赞助块过滤器：按尝试各自新建，快重试/fallback 时自动重置
                guard = EndSponsorFilter()
                response: object | None = None
                # 首块等待按总预算与快重试收紧，见 _effective_first_token_timeout
                first_token_timeout = self._effective_first_token_timeout(quick=retry_pending)
                attempt_started = monotonic()
                try:
                    try:
                        response, chunks = await self._open_stream(kwargs, first_token_timeout=first_token_timeout)
                    except Exception as e:
                        if has_reasoning_params(kwargs) and is_reasoning_param_error(e):
                            logger.warning(
                                "Provider %s 流式建连拒绝推理参数，自动剥离推理参数在当前 Provider 原地重试: %s",
                                self._provider_label(provider), e,
                            )
                            kwargs = strip_reasoning_kwargs(kwargs)
                            response, chunks = await self._open_stream(kwargs, first_token_timeout=first_token_timeout)
                        else:
                            raise

                    if chunks is not None:
                        async for chunk in chunks:
                            if stop_event and stop_event.is_set():
                                logger.info("LLM stream stopped by stop_event")
                                break
                            if not getattr(chunk, "choices", None):
                                if usage_out is not None and getattr(chunk, "usage", None):
                                    extract_usage(chunk.usage, usage_out)
                                continue
                            if usage_out is not None and getattr(chunk.choices[0], "finish_reason", None):
                                usage_out["finish_reason"] = chunk.choices[0].finish_reason
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
                                # 用量估算仍用原文（更接近计费），只对吐给调用方的正文过滤
                                streamed_parts.append(content)
                                filtered = guard.feed(content)
                                if filtered:
                                    yielded_any = True
                                    yield filtered
                    # 收尾：吐掉被过滤器扣住的残留（普通结尾照常输出，赞助块整段丢弃）
                    tail = guard.flush()
                    if tail:
                        yielded_any = True
                        yield tail
                    # 流结束：用户停止按正常收尾；否则要求至少产出过正文，
                    # 空响应（上游既没报错也没给正文）算该家失效，交给下面的 fallback 逻辑
                    stopped = bool(stop_event and stop_event.is_set())
                    if not yielded_any and not stopped:
                        raise EmptyResponseError(
                            f"{self._provider_label(provider)} 未返回任何正文"
                        )
                    if usage_out is not None:
                        estimate_missing_usage(base_messages, "".join(streamed_parts), kwargs["model"], usage_out)
                    self._settle_success(provider)
                    return
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self._last_error = e
                    attempt_elapsed = monotonic() - attempt_started
                    await self._aclose_stream(response)
                    response = None
                    # 若已吐出首 token，则既不快重试也不 fallback，直接抛
                    if yielded_any:
                        logger.error(f"LLM stream error after yield (provider={self._provider_label(provider)}): {e}")
                        self._settle_failure(provider, e)
                        raise
                    provider_exc: Exception = e
                    # 快重试：失败得快且确定瞬态，同家再建连一次（每家每次调用最多一次）。
                    # 快重试期间不 yield 任何事件（含 fallback 通知），前端停留在加载态等结论。
                    delay = self._plan_quick_retry(
                        e, provider, attempt_elapsed=attempt_elapsed,
                        attempt_timeout=first_token_timeout, quick_retried=quick_retried,
                    )
                    if delay is not None and not retry_pending:
                        quick_retried.add(self._retry_key(provider))
                        self.quick_retries += 1
                        retry_pending = True
                        logger.warning(
                            "LLM stream quick retry: model=%s provider=%s 失败 %.0fms，%.0fms 后同家重试: %s",
                            model_id, self._provider_label(provider), attempt_elapsed * 1000, delay * 1000, e,
                        )
                        await asyncio.sleep(delay)
                        continue
                    # 该家最终被放弃：快重试的两次失败合并记一次，再计入熔断记忆
                    last_exc = provider_exc
                    self._remember_failure(provider, provider_exc, quick_retried=retry_pending)
                    self._settle_failure(provider, provider_exc)
                    # 首 token 前失败且可重试且有下一家，则 fallback
                    # （Jev 判定期间不 yield，前端停留在加载/切换进度态等结论）
                    if idx < len(providers) - 1 and await self._should_retry(provider_exc, provider, idx, len(providers), model_id):
                        if isinstance(provider_exc, EmptyResponseError):
                            reason = "empty"
                        elif _is_timeout_error(provider_exc):
                            reason = "timeout"
                        else:
                            reason = "unavailable"
                        logger.warning(
                            "LLM stream fallback (%s): model=%s provider=%s 失败，切下一优先级: %s",
                            reason, model_id, self._provider_label(provider), provider_exc,
                        )
                        yield ("fallback", {
                            "failed_index": idx + 1,
                            "total": len(providers),
                            "next_index": idx + 2,
                            "reason": reason,
                        })
                        break
                    logger.error(f"LLM stream error (provider={self._provider_label(provider)}): {provider_exc}")
                    raise provider_exc
                finally:
                    await self._aclose_stream(response)
                    if usage_out is not None and (yielded_any or idx == len(providers) - 1 or (stop_event and stop_event.is_set())):
                        estimate_missing_usage(base_messages, "".join(streamed_parts), kwargs["model"], usage_out)
        if last_exc:
            raise last_exc
        raise RuntimeError("LLM stream 无可用 Provider")
