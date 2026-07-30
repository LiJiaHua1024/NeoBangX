import asyncio
import json
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.database import SessionLocal, get_db
from app.deps import get_current_code
from app.models import UsageCode
from app.routers.tools import _resolve_prompt_filename, get_prompt_loader
from app.services.llm import LLMService
from app.services.prompt_loader import PromptLoader
from app.services.runtime_config import find_model_entry, resolve_llm_settings
from app.services.usage_code import assert_can_generate, consume_quota

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# 用于支持 SSE 请求中止的全局事件字典
# key: request_id, value: asyncio.Event
_stop_events: dict[str, asyncio.Event] = {}


def _build_llm(cfg: dict, chores: bool = False) -> LLMService:
    if chores:
        return LLMService(
            api_key=cfg["chores_api_key"],
            default_model=cfg["chores_model"],
            base_url=cfg["chores_base_url"],
            max_tokens=min(cfg["max_tokens"], 256),
            timeout=cfg["timeout"],
        )
    return LLMService(
        api_key=cfg["llm_api_key"],
        default_model=cfg["llm_model"],
        base_url=cfg["llm_base_url"],
        max_tokens=cfg["max_tokens"],
        timeout=cfg["timeout"],
    )


class ChatRequest(BaseModel):
    tool_id: str = Field(..., description="工具 ID，对应 /api/tools/ 返回的工具 id")
    input: str = Field(..., min_length=1, description="用户输入文本")
    model: Optional[str] = Field(None, description="模型 ID，为空则使用默认模型")
    request_id: Optional[str] = Field(None, description="客户端生成的请求 ID，用于停止生成")


class ChatPreviewRequest(BaseModel):
    tool_id: str
    input: str


class StopRequest(BaseModel):
    request_id: str


class TitleRequest(BaseModel):
    tool_id: str = Field(..., description="工具 ID")
    input: str = Field(..., description="用户输入文本")
    output: str = Field(default="", description="模型已生成的输出，用于辅助生成更准确的标题")
    model: Optional[str] = Field(None, description="Chores AI 模型 ID，为空则使用后端配置")


TITLE_SYSTEM_PROMPT = (
    "你是一个标题生成助手。请根据工具名称、用户输入和模型输出，"
    "生成一个简短的中文标题（不超过 15 个字），准确概括主题。"
    "只输出标题，不要解释、不要引号、不要多余内容。"
)


@router.post("/preview")
async def preview_prompt(
    req: ChatPreviewRequest,
    _code: Annotated[UsageCode, Depends(get_current_code)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """预览最终发送给 LLM 的完整 Prompt（调试用）"""
    prompt_filename = _resolve_prompt_filename(req.tool_id)
    if not prompt_filename:
        raise HTTPException(status_code=404, detail=f"Tool {req.tool_id} not found")

    prompt = loader.render(prompt_filename, req.input)
    if prompt is None:
        raise HTTPException(
            status_code=404,
            detail=f"Prompt file {prompt_filename}.md not found",
        )

    return {
        "tool_id": req.tool_id,
        "prompt_filename": prompt_filename + ".md",
        "prompt": prompt,
    }


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    code: Annotated[UsageCode, Depends(get_current_code)],
    db: Annotated[Session, Depends(get_db)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """流式调用工具，返回 SSE 事件流。需要有效使用码；成功生成后扣减 1 次额度。"""
    assert_can_generate(code)

    prompt_filename = _resolve_prompt_filename(req.tool_id)
    if not prompt_filename:
        raise HTTPException(status_code=404, detail=f"Tool {req.tool_id} not found")

    prompt = loader.render(prompt_filename, req.input)
    if prompt is None:
        raise HTTPException(
            status_code=404,
            detail=f"Prompt file {prompt_filename}.md not found",
        )

    cfg = resolve_llm_settings(db)
    llm = _build_llm(cfg, chores=False)
    tool_name = prompt_filename
    code_id = code.id
    request_id = req.request_id or f"{req.tool_id}_{id(request)}"
    stop_event = asyncio.Event()
    _stop_events[request_id] = stop_event
    model_used = req.model or cfg["llm_model"]
    # 从模型列表中查找该模型的 thinking 配置；未配置则交由供应商默认
    model_entry = find_model_entry(cfg["models"], model_used)
    reasoning_effort = model_entry.get("reasoning_effort") if model_entry else None
    thinking_budget = model_entry.get("thinking_budget") if model_entry else None

    async def event_generator():
        charged = False
        try:
            async for token in llm.chat_stream_with_stop(
                user_prompt=prompt,
                model=req.model,
                stop_event=stop_event,
                reasoning_effort=reasoning_effort,
                thinking_budget=thinking_budget,
            ):
                if await request.is_disconnected():
                    logger.info(f"Client disconnected: {request_id}")
                    break
                # JSON 编码 token：SSE 按行分帧会丢失尾部换行符，
                # 编码后换行以 \n 转义形式单行传输，前端 JSON.parse 无损还原
                yield {"event": "token", "data": json.dumps(token, ensure_ascii=False)}

            # 正常结束（含用户停止后的收尾）：计一次使用
            if not charged:
                _charge_usage(
                    code_id=code_id,
                    tool_id=req.tool_id,
                    tool_name=tool_name,
                    model=model_used,
                    request_id=request_id,
                )
                charged = True
            yield {"event": "done", "data": "[DONE]"}
        except asyncio.CancelledError:
            logger.info(f"Stream cancelled: {request_id}")
            if not charged:
                _charge_usage(
                    code_id=code_id,
                    tool_id=req.tool_id,
                    tool_name=tool_name,
                    model=model_used,
                    request_id=request_id,
                )
                charged = True
            yield {"event": "done", "data": "[CANCELLED]"}
        except Exception as e:
            logger.error(f"Stream error for {request_id}: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)}, ensure_ascii=False),
            }
        finally:
            _stop_events.pop(request_id, None)

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        ping=settings.sse_retry_timeout,
    )


def _charge_usage(
    *,
    code_id: int,
    tool_id: str,
    tool_name: str,
    model: str,
    request_id: str,
) -> None:
    """在独立会话中扣减额度，避免生成器生命周期问题。"""
    db = SessionLocal()
    try:
        row = db.get(UsageCode, code_id)
        if row is None:
            return
        consume_quota(
            db,
            row,
            tool_id=tool_id,
            tool_name=tool_name,
            model=model,
            request_id=request_id,
        )
    except Exception as e:
        logger.error(f"Failed to charge usage for {request_id}: {e}")
    finally:
        db.close()


@router.post("/stop")
async def stop_stream(
    req: StopRequest,
    _code: Annotated[UsageCode, Depends(get_current_code)],
):
    """中止指定 request_id 的 SSE 流。"""
    event = _stop_events.get(req.request_id)
    if event:
        event.set()
        return {"status": "stopped", "request_id": req.request_id}
    return {"status": "not_found", "request_id": req.request_id}


@router.post("/title")
async def generate_title(
    req: TitleRequest,
    _code: Annotated[UsageCode, Depends(get_current_code)],
    db: Annotated[Session, Depends(get_db)],
):
    """为一次生成结果生成简短标题。不扣减额度。"""
    tool_name = _resolve_prompt_filename(req.tool_id)
    if not tool_name:
        raise HTTPException(status_code=404, detail=f"Tool {req.tool_id} not found")

    user_prompt = (
        f"工具：{tool_name}\n\n"
        f"用户输入：{req.input[:600]}\n\n"
        f"模型输出摘要：{req.output[:800]}\n\n"
        "请生成标题："
    )

    llm = _build_llm(resolve_llm_settings(db), chores=True)
    try:
        raw = await llm.chat(
            system_prompt=TITLE_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            model=req.model,
            max_tokens=64,
        )
    except Exception as e:
        logger.error(f"Title generation error: {e}")
        raise HTTPException(status_code=500, detail=f"标题生成失败: {e}")

    title = raw.strip().strip('"').strip("'").split("\n")[0][:40]
    return {"title": title}
