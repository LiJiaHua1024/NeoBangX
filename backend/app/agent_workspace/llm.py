"""工作台专用原生工具流适配器；不改变普通工具的调用链。"""
import asyncio
import inspect
import logging
import random
import time
from dataclasses import dataclass, field

from litellm import acompletion

from app.routers.chat import _build_llm
from app.services.llm import (extract_cache_hit_tokens, extract_reasoning_from_delta,
                              is_reasoning_param_error, strip_reasoning_kwargs)
from app.services import provider_health
from app.services.llm_router import LLMRouter, is_retryable, retry_after_seconds
from app.services.runtime_config import find_model_entry

log = logging.getLogger(__name__)
CLOSE_TIMEOUT_SECONDS = 2.0


def _consume_close(task):
    if not task.cancelled():
        task.exception()


async def _close_stream(stream):
    """关闭上游流，但不要让 aclose 拖住停止；超时就 detach，由 provider 自己超时。"""
    close = getattr(stream, "aclose", None)
    if not close:
        return
    value = close()
    if not inspect.isawaitable(value):
        return
    task = asyncio.ensure_future(value)
    task.add_done_callback(_consume_close)
    _done, pending = await asyncio.wait({task}, timeout=CLOSE_TIMEOUT_SECONDS)
    if pending:
        log.warning("关闭模型流超过 %.1fs，已放弃等待", CLOSE_TIMEOUT_SECONDS)
        task.cancel()


def get(value, key, default=None):
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


@dataclass
class ModelResult:
    content: str = ""
    calls: list = field(default_factory=list)
    finish_reason: str | None = "stop"
    tokens: int = 0
    usage: dict = field(default_factory=dict)
    # 这次调用实际命中的 Provider 与尝试次数：Agent 用它维持"任务级粘住"，
    # 并在日志里说清每一步到底走了哪一家。
    provider_id: str = ""
    attempts: int = 0
    # 上游上报的输入侧缓存命中 tokens（None = 没上报，不等于没命中）
    cached_tokens: int | None = None


class ResponseError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _status_code(exc):
    """从 provider 异常里取出 HTTP 状态码；取不到返回 None。"""
    for candidate in (getattr(exc, "status_code", None), getattr(exc, "code", None),
                      getattr(getattr(exc, "response", None), "status_code", None)):
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        if 100 <= value <= 599:
            return value
    return None


def error_details(exc):
    cause = exc.cause if isinstance(exc, PartialResponseError) else exc
    if isinstance(cause, ResponseError):
        code, message = cause.code, str(cause)
    elif isinstance(cause, (TimeoutError, asyncio.TimeoutError)):
        code, message = "model_timeout", "等待模型响应超时"
    elif isinstance(cause, ConnectionError):
        code, message = "model_connection", "与模型服务的连接中断"
    elif _status_code(cause) in {401, 403}:
        # 永久性配置错误：不该被当成"可以继续"的中断，否则用户会反复点继续。
        code, message = "model_auth", "模型服务的凭证无效或无权访问，请联系管理员检查配置"
    elif _status_code(cause) == 404:
        code, message = "model_not_found", "模型或接口地址不存在，请联系管理员检查配置"
    else:
        code, message = "model_error", "模型服务调用失败"
    details = {"error_code": code, "error": message, "error_type": type(cause).__name__}
    if isinstance(exc, PartialResponseError):
        details.update(finish_reason=exc.result.finish_reason, usage=exc.result.usage)
        details["error"] += "；已收到的内容已保存"
    return details


class PartialResponseError(RuntimeError):
    def __init__(self, result, cause):
        self.result, self.cause = result, cause
        super().__init__(error_details(self)["error"])


# 同一家 Provider 的重试退避：Agent 一步的成本远高于主站一次请求，
# 宁可多等几秒也不要因为一次抖动换家（换家 = 整段前缀冷读 + 后续风格漂移）。
RETRY_DELAYS = (1.0, 4.0)
RETRY_JITTER = 0.25


def _provider_id(provider) -> str:
    return ((provider or {}).get("id") or "").strip() if provider else ""


def _permanent_provider_error(exc: BaseException) -> bool:
    """这家自己的配置坏了（Key 无效 / 接口地址不对）：重试无用，换一家才有意义。"""
    return _status_code(exc) in {401, 403, 404}


def _same_provider_delay(exc, attempt: int, attempts: int, wait_cap: float, deadline):
    """决定是否在同一家再试一次，返回等待秒数；None 表示不再重试、交给换家判定。

    只有两类失败值得原地重试：上游明确瞬态（超时/429/5xx/断连），
    以及上游"没给正文也没报错"的空响应/坏结尾（同家再要一次常常就好了）。
    鉴权/404 不重试（重试改变不了配置），上下文超限/内容审核也不重试。
    """
    if attempt + 1 >= attempts:
        return None
    if _permanent_provider_error(exc):
        return None
    if not (provider_health.is_transient_failure(exc) or isinstance(exc, ResponseError)):
        return None
    wait = retry_after_seconds(exc)
    if wait is not None:
        if wait > wait_cap:
            return None
        delay = wait
    else:
        delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
        delay *= random.uniform(1 - RETRY_JITTER, 1 + RETRY_JITTER)
    if deadline is not None and time.monotonic() + delay + 2 > deadline:
        return None
    return delay


def _prefer(providers: list[dict], preferred: str) -> list[dict]:
    """把任务粘住的 Provider 提到链首；熔断只影响其它任务，不影响本任务的粘性。"""
    if not preferred:
        return providers
    for index, provider in enumerate(providers):
        if _provider_id(provider) == preferred:
            return [providers[index], *providers[:index], *providers[index + 1:]]
    return providers


async def complete(cfg, model, messages, tools, max_tokens, emit, response_format=None,
                   preferred: str = "", attempts: int = 1, retry_wait_cap: float = 60.0,
                   deadline: float | None = None):
    """调用一次模型（流式工具调用）。

    preferred：本任务粘住的 Provider。它在链首（熔断也只影响别的任务），
    失败时先在**同一家**重试（attempts 次、指数退避、尊重 Retry-After），
    只有这家彻底不行了才换下一家 —— Agent 一步会决定后面好几步的缓存与风格，
    换家的代价远大于多等几秒。
    deadline：本轮剩余的墙钟截止（monotonic），重试等待不得越过它。
    """
    llm = _build_llm(cfg, model)
    # 与主站同一套熔断顺序：已经 OPEN 的 provider 沉底，不再每次先打一遍挂掉的那家。
    providers = llm.ordered_providers() if isinstance(llm, LLMRouter) else [None]
    if not providers:
        raise ValueError("模型没有可用的服务连接")
    providers = _prefer(providers, preferred)
    last_error = None
    model_settings = find_model_entry(cfg.get("models", []), model) or {}
    options = {"reasoning_effort": model_settings.get("reasoning_effort"),
               "extra_body": model_settings.get("extra_body"), "response_format": response_format}
    for index, provider in enumerate(providers):
        provider_id = _provider_id(provider)
        if provider_id and not provider_health.claim_attempt(provider_id):
            # HALF_OPEN 的探测名额已被并发请求占用：跳过这一家，别一起打过去。
            continue
        attempt = 0
        while True:
            if provider is None:
                kwargs = llm._build_kwargs(model, messages, None, None, max_tokens, stream=True,
                                           **options)
            else:
                kwargs = llm._build_kwargs(provider, model, messages, max_tokens, stream=True,
                                           **options)
            if tools:
                kwargs.update(tools=tools, tool_choice="auto")
            result, calls, received, ended = ModelResult(finish_reason=None), {}, False, False
            stream = None
            try:
                try:
                    stream = await asyncio.wait_for(acompletion(**kwargs), timeout=45)
                except Exception as exc:
                    if not is_reasoning_param_error(exc):
                        raise
                    stream = await asyncio.wait_for(acompletion(**strip_reasoning_kwargs(kwargs)), timeout=45)
                iterator = stream.__aiter__()
                while True:
                    try:
                        chunk = await asyncio.wait_for(anext(iterator), timeout=120)
                    except StopAsyncIteration:
                        break
                    usage = get(chunk, "usage")
                    if usage:
                        result.usage = {k: int(get(usage, k, 0) or 0) for k in ("prompt_tokens", "completion_tokens", "total_tokens")}
                        result.tokens = result.usage["total_tokens"]
                        hit = extract_cache_hit_tokens(usage)
                        if hit is not None:
                            result.cached_tokens = hit
                    choices = get(chunk, "choices", []) or []
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = get(choice, "delta")
                    if delta:
                        reasoning = extract_reasoning_from_delta(delta)
                        if reasoning:
                            received = True
                            await emit("reasoning", reasoning)
                        text = get(delta, "content") or ""
                        if text:
                            received = True
                            result.content += text
                            await emit("output", text)
                        for raw in get(delta, "tool_calls", []) or []:
                            # index 可能缺失、也可能是 None 或字符串：不能直接拿来排序或当键。
                            # 缺 index 时，带新 id 的分片视为新调用，否则续写最后一个调用。
                            raw_index = get(raw, "index", None)
                            try:
                                call_index = int(raw_index) if raw_index is not None else None
                            except (TypeError, ValueError):
                                call_index = None
                            if call_index is None:
                                call_index = len(calls) if get(raw, "id") else (max(calls) if calls else 0)
                            call = calls.setdefault(call_index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                            if get(raw, "id"):
                                call["id"] = get(raw, "id")
                            function = get(raw, "function") or {}
                            call["function"]["name"] += get(function, "name", "") or ""
                            arguments = get(function, "arguments", "") or ""
                            call["function"]["arguments"] += arguments
                            if arguments:
                                received = True
                                await emit("arguments", arguments)
                    reason = get(choice, "finish_reason")
                    if reason:
                        result.finish_reason = str(reason)
                        ended = True
                result.calls = [calls[i] for i in sorted(calls)]
                if not ended:
                    raise ResponseError("missing_finish_reason", "模型连接结束但没有返回结束标记，无法确认输出完整")
                if result.finish_reason not in {"stop", "tool_calls", "length", "max_tokens", "end_turn"}:
                    raise ResponseError("model_finish_error", "模型未正常完成输出：" + result.finish_reason)
                # 思考可能耗尽全部输出额度。把真实结束原因交给执行器处理，不能误报断流。
                if not result.content and not result.calls and result.finish_reason not in {"length", "max_tokens"}:
                    raise ResponseError("empty_response", "模型已结束响应，但没有返回正文或工具调用")
                if provider is not None:
                    llm._settle_success(provider)
                result.provider_id = provider_id
                result.attempts = attempt + 1
                return result
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_error = exc
                if received or ended:
                    # 已经吐过东西：同一家的重试会重复输出，换家会拼接两家内容，
                    # 都不行。把半截结果交回去，由执行器决定怎么继续。
                    result.calls = [calls[i] for i in sorted(calls)]
                    result.provider_id = provider_id
                    result.attempts = attempt + 1
                    if provider is not None:
                        llm._settle_failure(provider, exc)
                    raise PartialResponseError(result, exc) from exc
                delay = _same_provider_delay(exc, attempt, attempts, retry_wait_cap, deadline)
                if delay is not None:
                    attempt += 1
                    log.warning(
                        "Agent 模型调用失败，同一 Provider 重试 %d/%d：provider=%s，%.1fs 后重试：%s",
                        attempt + 1, attempts, provider_id or "默认", delay, exc,
                    )
                    await asyncio.sleep(delay)
                    continue
                if provider is not None:
                    llm._settle_failure(provider, exc)
                if index < len(providers) - 1 and is_retryable(exc):
                    log.warning("Agent 换用下一家 Provider：%s 失败，原因：%s", provider_id, exc)
                    break
                raise
            finally:
                await _close_stream(stream)
    if last_error is not None:
        # 保留原始异常类型：error_details 才能把超时、断连、鉴权失败分开，
        # 也才不会被一律记成"模型服务调用失败"。
        raise last_error
    raise RuntimeError("所有模型连接均不可用，请稍后重试")
