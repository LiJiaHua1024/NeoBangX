"""假 LLM 上游：OpenAI 兼容的 /v1/{scenario}/chat/completions。

把真实后端的 provider 指到这里，就能在不花一分钱的前提下走完整真实链路：
多 provider 备用切换、首块超时 fallback、计费扣次、使用日志、管理后台统计。

provider 配置示例（管理后台 → 模型与线路，或最省事的 backend/.env）::

    LLM_BASE_URL=http://127.0.0.1:9900/v1/happy
    LLM_API_KEY=fake
    LLM_MODEL=openai/gpt-4o-mini

测 fallback 链时配三家，优先级从高到低：/v1/timeout（挂住）→ /v1/error（500）
→ /v1/happy（正常）。首块超时用 FIRST_TOKEN_TIMEOUT=3 缩短等待。
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from mock_backend import content as content_mod
from mock_backend.scenarios import StreamPlan

router = APIRouter()

# 上游场景 -> 行为
_UPSTREAM_SCENARIOS = {
    "happy": {"content": "generic"},
    "slow": {"content": "generic", "delay_ms": 120, "chunk_chars": 6},
    "long": {"content": "long", "delay_ms": 4, "chunk_chars": 24},
    "reasoning": {"content": "generic", "reasoning_chars": 600},
    "paper": {"content": "paper", "paper_questions": 5, "chunk_chars": 8},
    "migration": {"content": "migration", "reasoning_chars": 200},
    # 故障类
    "timeout": {"hang": True},
    "error": {"http_status": 500},
    "empty": {"content": "empty"},
    "mid-error": {"content": "generic", "fault": "truncate", "fault_at": 8, "chunk_chars": 6},
}


def _resolve_scenario(scenario: str, request: Request, body: dict) -> str:
    if scenario in _UPSTREAM_SCENARIOS:
        return scenario
    header = request.headers.get("x-mock-scenario") or ""
    if header:
        name = header.split(";")[0].strip().split()[0] if header.strip() else ""
        if name in _UPSTREAM_SCENARIOS:
            return name
    model = str(body.get("model") or "")
    for name in _UPSTREAM_SCENARIOS:
        if name in model:
            return name
    return "happy"


def _last_user_text(body: dict) -> str:
    for message in reversed(list(body.get("messages") or [])):
        if isinstance(message, dict) and message.get("role") == "user":
            return str(message.get("content") or "")
    return ""


def _reply(body: dict, scenario: str) -> tuple[str, str]:
    """返回 (正文, 推理片段)。"""
    plan = StreamPlan(**_UPSTREAM_SCENARIOS.get(scenario, {}))
    req = {"tool_id": "upstream", "model": body.get("model"), "input": _last_user_text(body)}
    reasoning = content_mod.reasoning_text(plan)
    return content_mod.build_content(plan.content, plan, req, _last_user_text(body), "upstream"), reasoning


def _chunk(model: str, delta: dict, finish_reason: str | None = None, usage: dict | None = None) -> str:
    payload: dict[str, Any] = {
        "id": "chatcmpl-mock",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    if usage is not None:
        payload["usage"] = usage
    return json.dumps(payload, ensure_ascii=False)


async def _stream(request: Request, scenario: str, body: dict) -> Any:
    plan = StreamPlan(**_UPSTREAM_SCENARIOS.get(scenario, {}))
    model = str(body.get("model") or "mock-model")
    text, reasoning = _reply(body, scenario)
    chunk_chars = max(1, int(plan.chunk_chars or 6))
    delay = plan.delay_ms / 1000

    async def gen():
        yield f"data: {_chunk(model, {'role': 'assistant'})}\n\n"
        for piece in _pieces(reasoning, 64):
            yield f"data: {_chunk(model, {'reasoning_content': piece})}\n\n"
            if delay:
                await asyncio.sleep(delay)
        for index, piece in enumerate(_pieces(text, chunk_chars), start=1):
            if await request.is_disconnected():
                return
            if delay:
                await asyncio.sleep(delay)
            yield f"data: {_chunk(model, {'content': piece})}\n\n"
            if plan.fault == "truncate" and index >= int(plan.fault_at or 0):
                # 不发 [DONE] 就结束：真实后端会把它当成「已出正文后失败」
                return
        usage = {
            "prompt_tokens": max(1, len(json.dumps(body.get("messages") or [], ensure_ascii=False)) // 4),
            "completion_tokens": max(1, len(text) // 2),
            "total_tokens": 0,
        }
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        yield f"data: {_chunk(model, {}, 'stop', usage)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


def _pieces(text: str, size: int) -> list[str]:
    if not text:
        return []
    return [text[i:i + size] for i in range(0, len(text), size)]


@router.get("/v1/models")
async def list_models() -> dict:
    return {
        "object": "list",
        "data": [
            {"id": name, "object": "model", "created": 0, "owned_by": "mock-backend"}
            for name in _UPSTREAM_SCENARIOS
        ],
    }


async def _chat_completions(scenario: str, request: Request) -> Any:
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    resolved = _resolve_scenario(scenario, request, body)
    behaviour = _UPSTREAM_SCENARIOS.get(resolved, {})

    if behaviour.get("hang"):
        # 挂住不吐首块：等真实后端的 first_token_timeout 掐掉这条连接
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            pass
        return JSONResponse({"error": {"message": "timeout", "type": "timeout"}}, status_code=504)

    if behaviour.get("http_status"):
        return JSONResponse(
            {"error": {"message": f"假上游场景 {resolved}：模拟上游故障", "type": "server_error"}},
            status_code=int(behaviour["http_status"]),
        )

    if body.get("stream"):
        return await _stream(request, resolved, body)

    text, reasoning = _reply(body, resolved)
    message: dict[str, Any] = {"role": "assistant", "content": text}
    if reasoning:
        message["reasoning_content"] = reasoning
    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": str(body.get("model") or "mock-model"),
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": 64,
            "completion_tokens": max(1, len(text) // 2),
            "total_tokens": 64 + max(1, len(text) // 2),
        },
    }


@router.post("/v1/{scenario}/chat/completions")
async def chat_completions_scoped(scenario: str, request: Request) -> Any:
    return await _chat_completions(scenario, request)


@router.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Any:
    return await _chat_completions("", request)


def add_upstream_routes(app) -> None:
    app.include_router(router)
