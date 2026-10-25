"""工作台专用原生工具流适配器；不改变普通工具的调用链。"""
import asyncio
import inspect
from dataclasses import dataclass, field

from litellm import acompletion

from app.routers.chat import _build_llm
from app.services.llm import extract_reasoning_from_delta, strip_reasoning_kwargs, is_reasoning_param_error
from app.services.llm_router import LLMRouter, is_retryable
from app.services.runtime_config import find_model_entry


def get(value, key, default=None):
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


@dataclass
class ModelResult:
    content: str = ""
    calls: list = field(default_factory=list)
    finish_reason: str = "stop"
    tokens: int = 0
    usage: dict = field(default_factory=dict)


class PartialResponseError(RuntimeError):
    def __init__(self, result, cause):
        super().__init__("模型流中断，已保存收到的内容；可继续执行")
        self.result, self.cause = result, cause


async def complete(cfg, model, messages, tools, max_tokens, emit, response_format=None):
    llm = _build_llm(cfg, model)
    providers = llm.providers if isinstance(llm, LLMRouter) else [None]
    if not providers:
        raise ValueError("模型没有可用的服务连接")
    last_error = None
    model_settings = find_model_entry(cfg.get("models", []), model) or {}
    options = {"reasoning_effort": model_settings.get("reasoning_effort"),
               "extra_body": model_settings.get("extra_body"), "response_format": response_format}
    for provider in providers:
        if provider is None:
            kwargs = llm._build_kwargs(model, messages, None, None, max_tokens, stream=True,
                                       **options)
        else:
            kwargs = llm._build_kwargs(provider, model, messages, max_tokens, stream=True,
                                       **options)
        if tools:
            kwargs.update(tools=tools, tool_choice="auto")
        result, calls, received, ended = ModelResult(), {}, False, False
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
                        index = get(raw, "index", 0)
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
                raise ValueError("模型连接结束但没有结束标记，不能当作完整结果")
            if result.finish_reason not in {"stop", "tool_calls", "length", "max_tokens", "end_turn"}:
                raise ValueError("模型未正常完成输出：" + result.finish_reason)
            if not result.content and not result.calls:
                raise ValueError("模型没有返回正文或工具调用")
            if provider is not None:
                llm._settle_success(provider)
            return result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = exc
            if provider is not None:
                llm._settle_failure(provider, exc)
            if received:
                result.calls = [calls[i] for i in sorted(calls)]
                raise PartialResponseError(result, exc) from exc
            if not is_retryable(exc):
                raise
        finally:
            close = getattr(stream, "aclose", None)
            if close:
                value = close()
                if inspect.isawaitable(value):
                    await value
    raise RuntimeError("所有模型连接均不可用，请稍后重试") from last_error
