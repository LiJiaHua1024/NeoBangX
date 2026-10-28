"""工作台专用原生工具流适配器；不改变普通工具的调用链。"""
import asyncio
import inspect
import logging
from dataclasses import dataclass, field

from litellm import acompletion

from app.routers.chat import _build_llm
from app.services.llm import extract_reasoning_from_delta, strip_reasoning_kwargs, is_reasoning_param_error
from app.services import provider_health
from app.services.llm_router import LLMRouter, is_retryable
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


async def complete(cfg, model, messages, tools, max_tokens, emit, response_format=None):
    llm = _build_llm(cfg, model)
    # 与主站同一套熔断顺序：已经 OPEN 的 provider 沉底，不再每次先打一遍挂掉的那家。
    providers = llm.ordered_providers() if isinstance(llm, LLMRouter) else [None]
    if not providers:
        raise ValueError("模型没有可用的服务连接")
    last_error = None
    model_settings = find_model_entry(cfg.get("models", []), model) or {}
    options = {"reasoning_effort": model_settings.get("reasoning_effort"),
               "extra_body": model_settings.get("extra_body"), "response_format": response_format}
    for provider in providers:
        provider_id = ((provider or {}).get("id") or "").strip() if provider else ""
        if provider_id and not provider_health.claim_attempt(provider_id):
            # HALF_OPEN 的探测名额已被并发请求占用：跳过这一家，别一起打过去。
            continue
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
                            index = int(raw_index) if raw_index is not None else None
                        except (TypeError, ValueError):
                            index = None
                        if index is None:
                            index = len(calls) if get(raw, "id") else (max(calls) if calls else 0)
                        call = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
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
            return result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = exc
            if provider is not None:
                llm._settle_failure(provider, exc)
            if received or ended:
                result.calls = [calls[i] for i in sorted(calls)]
                raise PartialResponseError(result, exc) from exc
            if not is_retryable(exc):
                raise
        finally:
            await _close_stream(stream)
    if last_error is not None:
        # 保留原始异常类型：error_details 才能把超时、断连、鉴权失败分开，
        # 也才不会被一律记成"模型服务调用失败"。
        raise last_error
    raise RuntimeError("所有模型连接均不可用，请稍后重试")
