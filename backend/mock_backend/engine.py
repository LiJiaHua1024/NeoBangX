"""SSE 场景引擎：唯一的帧构造处。

前端（frontend/script.js `_streamChat` / `consumeSSE`）的硬约束在这里集中满足：

- 每帧必须是 ``event: <name>`` + ``data: <payload>`` + 空行；
- ``token`` 的 data 是 **JSON 编码的字符串**（换行以 \\n 转义单行传输）；
- ``reasoning`` 的 data 是 ``{"t": "...", "n": token 数}``；
- 流**必须**以 ``done`` 帧收尾（``[DONE]`` 或 ``[CANCELLED]``），
  否则前端判「生成中断，内容可能不完整」。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Iterable

from mock_backend import content as content_mod


@dataclass
class StreamStats:
    reasoning: int = 0
    token: int = 0
    chars: int = 0
    fallback: int = 0
    error: bool = False
    terminal: str = ""
    stopped: bool = False


def sse_frame(event: str, data: str) -> str:
    """一帧 SSE。data 必须是单行——换行/引号一律先 JSON 编码再进来。"""
    return f"event: {event}\ndata: {data}\n\n"


def approx_tokens(text: str) -> int:
    """token 数的粗略估计（真实后端用 litellm tokenizer，这里只供前端展示）。"""
    return max(1, (len(text) + 1) // 2) if text else 0


def _split(text: str, size: int) -> list[str]:
    if not text:
        return []
    size = max(1, int(size or 1))
    return [text[i:i + size] for i in range(0, len(text), size)]


async def stream_frames(
    *,
    plan: Any,
    req: dict,
    input_text: str,
    tool_id: str,
    stop_event: asyncio.Event | None = None,
    stats: StreamStats | None = None,
    is_disconnected: Callable[[], Any] | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """按执行计划产出 (event, data) 帧序列。

    ``fault="truncate"`` 时直接停止产出且不发终止帧，从而复现「流被掐断」。
    """
    stats = stats or StreamStats()
    model = str(req.get("model") or "")

    if plan.pre_delay_ms:
        await asyncio.sleep(plan.pre_delay_ms / 1000)

    # ---- 推理片段 ----
    reasoning = content_mod.reasoning_text(plan)
    if reasoning:
        for piece in _split(reasoning, 48):
            if await _should_stop(stop_event, is_disconnected):
                stats.stopped = True
                stats.terminal = "[CANCELLED]"
                yield ("done", "[CANCELLED]")
                return
            if plan.reasoning_delay_ms:
                await asyncio.sleep(plan.reasoning_delay_ms / 1000)
            stats.reasoning += 1
            yield ("reasoning", json.dumps({"t": piece, "n": approx_tokens(piece)}, ensure_ascii=False))

    # ---- 正文 ----
    body = content_mod.build_content(plan.content, plan, req, input_text, tool_id)
    if plan.max_chars and len(body) > plan.max_chars:
        body = body[: plan.max_chars]
    tokens = _split(body, plan.chunk_chars)
    fallback_points = sorted(int(p) for p in (plan.fallback_at or ()))

    for index, token in enumerate(tokens, start=1):
        if await _should_stop(stop_event, is_disconnected):
            stats.stopped = True
            stats.terminal = "[CANCELLED]"
            yield ("done", "[CANCELLED]")
            return
        while fallback_points and fallback_points[0] <= index:
            fallback_points.pop(0)
            stats.fallback += 1
            yield ("fallback", json.dumps({
                "failed_index": stats.fallback,
                "total": stats.fallback + 1,
                "next_index": stats.fallback + 2,
                "reason": "timeout" if stats.fallback == 1 else "unavailable",
            }, ensure_ascii=False))
        if plan.delay_ms:
            await asyncio.sleep(plan.delay_ms / 1000)
        stats.token += 1
        stats.chars += len(token)
        yield ("token", json.dumps(token, ensure_ascii=False))

        fault_due = False
        if plan.fault_at and index >= plan.fault_at:
            fault_due = True
        if plan.fault_chars and stats.chars >= plan.fault_chars:
            fault_due = True
        if fault_due and plan.fault:
            if plan.fault == "error":
                stats.error = True
                yield ("error", json.dumps(
                    {"message": "生成失败，请稍后重试", "model": model or "mock/mock-flash"},
                    ensure_ascii=False,
                ))
                return
            if plan.fault == "truncate":
                # 不发终止帧：前端会判「生成中断，内容可能不完整」
                return

    # ---- 收尾 ----
    if plan.finish == "cancel":
        stats.terminal = "[CANCELLED]"
        yield ("done", "[CANCELLED]")
        return
    # 只声明了 fault=truncate 而没给触发点：发完全部内容后直接断流。
    # 试卷的 paper-mid-truncate 走这条——内容本身就是截断的半道题。
    if plan.fault == "truncate" and not plan.fault_at and not plan.fault_chars:
        return
    stats.terminal = "[DONE]"
    yield ("done", "[DONE]")


async def _should_stop(stop_event: asyncio.Event | None, is_disconnected: Callable | None) -> bool:
    if stop_event is not None and stop_event.is_set():
        return True
    if is_disconnected is not None:
        try:
            result = is_disconnected()
            if asyncio.iscoroutine(result):
                result = await result
            return bool(result)
        except Exception:
            return False
    return False


def stats_summary(stats: StreamStats) -> str:
    """写进请求日志的一行摘要。"""
    parts = [f"token×{stats.token}", f"chars={stats.chars}"]
    if stats.reasoning:
        parts.append(f"reasoning×{stats.reasoning}")
    if stats.fallback:
        parts.append(f"fallback×{stats.fallback}")
    if stats.error:
        parts.append("error")
    parts.append(f"terminal={stats.terminal or '无(断流)'}")
    if stats.stopped:
        parts.append("stopped")
    return " / ".join(parts)
