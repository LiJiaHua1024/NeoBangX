import asyncio
import json
import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from time import monotonic
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.database import SessionLocal
from app.deps import get_current_code
from app.models import UsageCode
from app.routers.tools import _resolve_prompt_filename, get_prompt_loader
from app.services.llm import LLMService
from app.services.llm_router import LLMRouter
from app.services.migration import (
    MIGRATION_ANALYSIS_PROMPT_NAME,
    MIGRATION_MORE_ANALYSIS_PROMPT_NAME,
    MIGRATION_TOOL_ID,
    MIGRATION_TOOL_NAME,
    migration_charge_units,
    parse_error_causes,
)
from app.services.prompt_loader import PromptLoader
from app.services.provider_config import get_model_provider_map, get_providers_for_model
from app.services.request_log import (
    STATUS_CANCELLED,
    STATUS_ERROR,
    STATUS_SUCCESS,
    get_client_info,
    record_usage_log,
)
from app.services.runtime_config import find_model_entry, resolve_llm_settings
from app.services.usage_code import assert_can_generate, consume_quota
from app.services.vocab_check import check_over_words

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# 用于支持 SSE 请求中止的全局事件字典
# key: request_id, value: (asyncio.Event, 发起该流的 code.id)
# 停止请求必须校验属主，否则任何持码者都能掐断他人生成。
_stop_events: dict[str, tuple[asyncio.Event, int]] = {}

# 不扣额度端点的进程内滑动窗口限速：bucket -> (最大次数, 窗口秒)
_RATE_LIMITS = {"analyze": (10, 60), "title": (30, 60), "vocab": (60, 60)}
_rate_buckets: dict[tuple[int, str], deque] = defaultdict(deque)


def _enforce_rate_limit(code_id: int, bucket: str) -> None:
    limit, window = _RATE_LIMITS[bucket]
    now = monotonic()
    hits = _rate_buckets[(code_id, bucket)]
    while hits and now - hits[0] > window:
        hits.popleft()
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    hits.append(now)


def _load_cfg() -> dict:
    """在独立短会话中解析 LLM 配置。同步函数，供 to_thread 调用，
    避免阻塞 IO 占住事件循环；会话即用即关，不随 SSE 流存续。"""
    with SessionLocal() as db:
        return resolve_llm_settings(db)


def _validate_model(cfg: dict, model: Optional[str]) -> None:
    """客户端指定的模型必须已绑定可用 Provider，防止任意模型直达上游。"""
    if not model:
        return
    # 先校验模型是否在全局目录
    if find_model_entry(cfg["models"], model) is None:
        raise HTTPException(status_code=400, detail=f"模型不可用：{model}")
    # 再校验该模型是否至少有一个 enabled Provider 绑定
    available = cfg.get("available_model_ids")
    if available is not None and model not in available:
        raise HTTPException(status_code=400, detail=f"模型不可用：{model} 未绑定可用 Provider")
    # 兜底：若没有 available 集合（旧逻辑），则按旧方式已通过 find_model_entry


@dataclass
class _MigrationBatch:
    code_id: int
    expected: int
    charge_units: int
    created_at: float = field(default_factory=monotonic)
    completed: set[int] = field(default_factory=set)
    failed: bool = False


# 批量迁移请求需要在全部卡片成功后才扣费。主站当前为单进程部署，
# 这里沿用停止事件的进程内协调方式；额度实际扣减仍在独立数据库会话中完成。
_migration_batches: dict[str, _MigrationBatch] = {}
_migration_reserved: dict[int, int] = {}
_MIGRATION_BATCH_TTL = 30 * 60


def _get_providers_for_model_sync(cfg: dict, model_id: str) -> list[dict]:
    """基于 cfg 中的 providers 与 model_provider_details 计算该模型可用 Provider 链（含 provider_model_id）。"""
    providers = cfg.get("providers") or []
    mp_map = cfg.get("model_provider_map") or {}
    details = cfg.get("model_provider_details") or {}
    if not providers:
        if cfg.get("llm_api_key") or cfg.get("llm_base_url"):
            return [{
                "id": "prov_legacy",
                "name": "主服务（兼容）",
                "base_url": cfg.get("llm_base_url") or "",
                "api_key": cfg.get("llm_api_key") or "",
                "enabled": True,
                "provider_model_id": model_id,
            }]
        return []
    providers_by_id = {p["id"]: p for p in providers}
    # 优先使用 detailed（含 provider_model_id），回退到简单 map
    detail_list = details.get(model_id)
    if detail_list is not None:
        chain: list[dict] = []
        for item in detail_list:
            pid = item.get("provider_id")
            p = providers_by_id.get(pid)
            if p and p.get("enabled"):
                merged = dict(p)
                merged["provider_model_id"] = (item.get("provider_model_id") or "").strip() or model_id
                merged["priority"] = item.get("priority", 0)
                chain.append(merged)
        return chain
    # 兼容旧：仅有 map
    ordered_ids = mp_map.get(model_id) or []
    if not ordered_ids and not mp_map:
        # 旧数据全量可用，回退 provider_model_id 为逻辑 id
        return [{**p, "provider_model_id": model_id} for p in providers if p.get("enabled")]
    chain = []
    for pid in ordered_ids:
        p = providers_by_id.get(pid)
        if p and p.get("enabled"):
            merged = dict(p)
            merged["provider_model_id"] = model_id
            chain.append(merged)
    return chain


def _build_llm(cfg: dict, model: Optional[str] = None, chores: bool = False) -> LLMRouter | LLMService:
    """根据模型与 chores 标志构建聚合 Router（优先）或回退单 LLMService。"""
    # 若没有多 Provider 配置，回退旧单 LLMService 行为
    providers = cfg.get("providers") or []
    mp_map = cfg.get("model_provider_map") or {}
    # 兼容：providers 为空时走旧单 Provider
    if not providers and not mp_map:
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

    # 多 Provider 聚合路径
    # chores 与非 chores 复用同一模型优先级链，仅 max_tokens 不同
    target_model = model or (cfg["chores_model"] if chores else cfg["llm_model"])
    if not target_model:
        target_model = cfg.get("default_model") or ""
    chain = _get_providers_for_model_sync(cfg, target_model)
    if not chain:
        # 若该模型未绑定，尝试对 chores 用默认模型的链兜底？此处直接返回空 Router，上层会校验 400
        chain = []
    max_tokens = min(cfg["max_tokens"], 256) if chores else cfg["max_tokens"]
    # 即使 chain 为空也构造 Router，上层 _validate_model 会拦截；构造时允许空以便错误提示更精准
    router = LLMRouter(
        providers_for_model=chain,
        default_model=target_model,
        max_tokens=max_tokens,
        timeout=cfg["timeout"],
    )
    return router


def _log_llm_call(
    *,
    code: UsageCode,
    tool_id: str,
    tool_name: str,
    model: str,
    status: str,
    started: float,
    usage: dict | None,
    client: tuple[str, str],
    log_payload: bool,
    request_id: str = "",
    error_message: str = "",
    units: int = 0,
    input_text: str = "",
    rendered_prompt: str = "",
    output_text: str = "",
    provider_id: str = "",
    provider_name: str = "",
    fallback_attempts: int | None = None,
) -> None:
    """统一落一条 LLM 调用日志。同步函数，供 asyncio.to_thread 调用。

    元数据始终记录；原始输入 / 渲染 Prompt / 输出仅在 log_payload 开启时落库。
    """
    record_usage_log(
        code_id=code.id,
        code=code.code,
        tool_id=tool_id or "",
        tool_name=tool_name or "",
        model=model or "",
        request_id=request_id or "",
        status=status,
        error_message=error_message,
        duration_ms=int((monotonic() - started) * 1000),
        usage=usage or {},
        ip=client[0],
        user_agent=client[1],
        units=units,
        input_text=input_text,
        rendered_prompt=rendered_prompt,
        output_text=output_text,
        log_payload=log_payload,
        provider_id=provider_id or "",
        provider_name=provider_name or "",
        fallback_attempts=fallback_attempts,
    )


class ChatRequest(BaseModel):
    tool_id: str = Field(..., max_length=64, description="工具 ID，对应 /api/tools/ 返回的工具 id")
    input: str = Field(..., min_length=1, max_length=50000, description="用户输入文本（上限按整卷 + 解析版的粘贴体量放宽）")
    model: Optional[str] = Field(None, max_length=128, description="模型 ID，为空则使用默认模型")
    request_id: Optional[str] = Field(None, max_length=128, description="客户端生成的请求 ID，用于停止生成")
    batch_id: Optional[str] = Field(None, max_length=128, description="智能错题迁移批次 ID")
    batch_size: Optional[int] = Field(None, ge=1, description="批次内错因卡片总数")
    batch_index: Optional[int] = Field(None, ge=0, description="当前错因在批次中的序号")


class MigrationAnalyzeRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=5000, description="题干")
    standard_answer: str = Field(default="", max_length=5000, description="标准答案")
    student_answers: str = Field(default="", max_length=10000, description="学生错误作答或错误选项分布")
    error_cause: str = Field(default="", max_length=2000, description="老师填写的错因，可为空")
    feedback_history: list[Annotated[str, StringConstraints(min_length=1, max_length=2000)]] = Field(
        default_factory=list,
        max_length=20,
        description="历次再讨论反馈，必须完整传递",
    )
    analysis_history: list["MigrationAnalysisMessage"] = Field(
        default_factory=list,
        max_length=40,
        description="错因分析对话历史，More 请求会在其末尾追加 user 消息",
    )
    continue_generation: bool = Field(
        default=False,
        description="是否基于 analysis_history 继续生成更多错因",
    )
    model: Optional[str] = Field(None, max_length=128, description="模型 ID")


class MigrationAnalysisMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=10000)


class MigrationQuotaRequest(BaseModel):
    cause_count: int = Field(..., ge=1, description="选中的错因数量")


class ChatPreviewRequest(BaseModel):
    tool_id: str = Field(..., max_length=64)
    input: str = Field(..., min_length=1, max_length=50000)


class StopRequest(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=160)


class TitleRequest(BaseModel):
    tool_id: str = Field(..., max_length=64, description="工具 ID")
    input: str = Field(..., min_length=1, max_length=20000, description="用户输入文本")
    output: str = Field(default="", max_length=40000, description="模型已生成的输出，用于辅助生成更准确的标题")
    model: Optional[str] = Field(None, max_length=128, description="Chores AI 模型 ID，为空则使用后端配置")


TITLE_SYSTEM_PROMPT = (
    "你是一个标题生成助手。请根据工具名称、用户输入和模型输出，"
    "生成一个简短的中文标题（不超过 15 个字），准确概括主题。"
    "只输出标题，不要解释、不要引号、不要多余内容。"
)


def _cleanup_migration_batches() -> None:
    now = monotonic()
    expired = [
        batch_id
        for batch_id, batch in _migration_batches.items()
        if now - batch.created_at > _MIGRATION_BATCH_TTL
    ]
    for batch_id in expired:
        batch = _migration_batches.pop(batch_id)
        _release_migration_reservation(batch)


def _release_migration_reservation(batch: _MigrationBatch) -> None:
    reserved = _migration_reserved.get(batch.code_id, 0) - batch.charge_units
    if reserved > 0:
        _migration_reserved[batch.code_id] = reserved
    else:
        _migration_reserved.pop(batch.code_id, None)


def _register_migration_batch(
    req: ChatRequest,
    code: UsageCode,
) -> _MigrationBatch | None:
    has_batch_fields = any(
        value is not None for value in (req.batch_id, req.batch_size, req.batch_index)
    )
    if not has_batch_fields:
        if req.tool_id == MIGRATION_TOOL_ID:
            raise HTTPException(status_code=400, detail="智能错题迁移必须通过批次请求生成")
        return None
    if req.tool_id != MIGRATION_TOOL_ID:
        raise HTTPException(status_code=400, detail="批量参数仅适用于智能错题迁移")
    if not req.batch_id or req.batch_size is None or req.batch_index is None:
        raise HTTPException(status_code=400, detail="智能错题迁移批量参数不完整")
    if req.batch_index >= req.batch_size:
        raise HTTPException(status_code=400, detail="智能错题迁移批次序号无效")

    _cleanup_migration_batches()
    charge_units = migration_charge_units(req.batch_size)
    batch = _migration_batches.get(req.batch_id)
    if batch:
        if (
            batch.code_id != code.id
            or batch.expected != req.batch_size
            or batch.charge_units != charge_units
        ):
            raise HTTPException(status_code=400, detail="智能错题迁移批次参数不一致")
        return batch

    remaining = code.remaining
    reserved = _migration_reserved.get(code.id, 0)
    if remaining is not None and remaining - reserved < charge_units:
        raise HTTPException(
            status_code=403,
            detail={
                "message": "额度不足，无法生成本次智能错题迁移",
                "required": charge_units,
                "remaining": max(0, remaining - reserved),
            },
        )

    batch = _MigrationBatch(
        code_id=code.id,
        expected=req.batch_size,
        charge_units=charge_units,
    )
    _migration_batches[req.batch_id] = batch
    _migration_reserved[code.id] = reserved + charge_units
    return batch


def _finish_migration_stream(
    *,
    batch_id: str,
    batch_index: int,
    code_id: int,
    success: bool,
) -> bool:
    """标记一张卡片完成，返回是否应由当前请求完成整批扣费。"""
    batch = _migration_batches.get(batch_id)
    if not batch or batch.code_id != code_id:
        return False

    if not success:
        batch.failed = True
    batch.completed.add(batch_index)
    if batch.failed:
        _migration_batches.pop(batch_id, None)
        _release_migration_reservation(batch)
        return False
    if len(batch.completed) < batch.expected:
        return False

    _migration_batches.pop(batch_id, None)
    _release_migration_reservation(batch)
    return True


def _migration_prompt_input(req: MigrationAnalyzeRequest) -> str:
    payload = {
        "题干": req.question,
        "标准答案": req.standard_answer,
        "学生错误作答或错误选项分布": req.student_answers,
        "老师填写的错因（可能为空；为空时必须自主分析）": req.error_cause,
        "历次再讨论反馈（必须全部吸收）": req.feedback_history,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _migration_analysis_messages(
    req: MigrationAnalyzeRequest,
    prompt: str,
    loader: PromptLoader,
) -> list[dict[str, str]]:
    if not req.continue_generation:
        return [{"role": "user", "content": prompt}]

    history = [
        {"role": message.role, "content": message.content.strip()}
        for message in req.analysis_history
        if message.content.strip()
    ]
    if not history or history[-1]["role"] != "assistant":
        raise HTTPException(status_code=400, detail="More 请求缺少有效的错因分析历史")
    more_prompt = loader.get(MIGRATION_MORE_ANALYSIS_PROMPT_NAME)
    if more_prompt is None:
        raise HTTPException(status_code=404, detail="智能错题迁移 More Prompt 不存在")
    history.append({"role": "user", "content": more_prompt})
    return history


class VocabCheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50000, description="待排查的英语文本")


@router.post("/vocab/check")
async def check_vocabulary(
    req: VocabCheckRequest,
    code: Annotated[UsageCode, Depends(get_current_code)],
):
    """机械排查超标词:分词 + 课标词表集合匹配,毫秒级返回,不扣减额度。"""
    _enforce_rate_limit(code.id, "vocab")
    try:
        # 正则分词是纯 CPU 计算，放线程池执行，避免大文本阻塞事件循环
        result = await asyncio.to_thread(check_over_words, req.text)
    except Exception as exc:
        logger.error("Vocabulary check error: %s", exc)
        raise HTTPException(status_code=500, detail="词汇排查失败，请稍后重试") from exc
    return result


@router.post("/migration/analyze")
async def analyze_migration_causes(
    req: MigrationAnalyzeRequest,
    request: Request,
    code: Annotated[UsageCode, Depends(get_current_code)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """非流式分析智能错题迁移的错因，不扣减额度。"""
    _enforce_rate_limit(code.id, "analyze")
    prompt = loader.render(
        MIGRATION_ANALYSIS_PROMPT_NAME,
        _migration_prompt_input(req),
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="智能错题迁移错因分析 Prompt 不存在")

    messages = _migration_analysis_messages(req, prompt, loader)
    cfg = await asyncio.to_thread(_load_cfg)
    _validate_model(cfg, req.model)
    llm = _build_llm(cfg, model=req.model, chores=False)
    model_used = req.model or cfg["llm_model"]
    client_ip, user_agent = get_client_info(request)
    started = monotonic()
    usage: dict = {}
    log_payload_enabled = bool(cfg.get("log_payload"))

    async def _record(status: str, output_text: str, error_message: str = "") -> None:
        prov_id = ""
        prov_name = ""
        attempts = None
        try:
            if isinstance(llm, LLMRouter) and llm.provider_used:
                prov_id = llm.provider_used.get("id", "")
                prov_name = llm.provider_used.get("name", "")
                attempts = llm.attempts
        except Exception:
            pass
        await asyncio.to_thread(
            _log_llm_call,
            code=code,
            tool_id="migration_analyze",
            tool_name="错因分析",
            model=model_used,
            status=status,
            started=started,
            usage=usage,
            client=(client_ip, user_agent),
            log_payload=log_payload_enabled,
            error_message=error_message,
            input_text=_migration_prompt_input(req),
            rendered_prompt=prompt,
            output_text=output_text,
            provider_id=prov_id,
            provider_name=prov_name,
            fallback_attempts=attempts,
        )

    try:
        raw = await llm.chat(user_prompt=prompt, messages=messages, model=req.model, usage_out=usage)
    except Exception as exc:
        logger.error("Migration cause analysis error: %s", exc)
        await _record(STATUS_ERROR, "", str(exc))
        raise HTTPException(status_code=500, detail="错因分析失败，请稍后重试") from exc

    causes = parse_error_causes(raw)
    if not causes and not req.continue_generation:
        await _record(STATUS_ERROR, raw, "模型未返回可确认的错因")
        raise HTTPException(status_code=502, detail="模型未返回可确认的错因，请重试")
    await _record(STATUS_SUCCESS, raw)
    return {
        "causes": [
            {"id": f"cause_{index}", "label": cause}
            for index, cause in enumerate(causes)
        ],
        "analysis_history": [
            *messages,
            {"role": "assistant", "content": raw},
        ],
    }


@router.post("/migration/quota")
async def check_migration_quota(
    req: MigrationQuotaRequest,
    code: Annotated[UsageCode, Depends(get_current_code)],
):
    """生成最终迁移结果前预检查本次所需额度，不扣费。"""
    required = migration_charge_units(req.cause_count)
    remaining = code.remaining
    if remaining is not None and remaining < required:
        raise HTTPException(
            status_code=403,
            detail={
                "message": "额度不足，无法生成本次智能错题迁移",
                "required": required,
                "remaining": remaining,
            },
        )
    return {
        "can_generate": True,
        "required": required,
        "remaining": remaining,
        "cause_count": req.cause_count,
    }


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
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """流式调用工具，返回 SSE 事件流。"""
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

    migration_batch = _register_migration_batch(req, code)

    # 配置读取走短会话 + 线程池：不随 SSE 流占住连接池会话，也不阻塞事件循环
    cfg = await asyncio.to_thread(_load_cfg)
    _validate_model(cfg, req.model)
    llm = _build_llm(cfg, model=req.model, chores=False)
    tool_name = prompt_filename
    if req.tool_id == MIGRATION_TOOL_ID:
        # 日志展示用名称：迁移请求统一显示工具名而非底层 prompt 文件名
        tool_name = MIGRATION_TOOL_NAME
    code_id = code.id
    base_request_id = req.request_id or f"{req.tool_id}_{id(request)}"
    request_id = base_request_id
    existing = _stop_events.get(base_request_id)
    if existing is not None and existing[1] != code_id:
        # 同毫秒撞名时不覆盖他人注册（属主校验收口在 /stop）
        request_id = f"{base_request_id}_{code_id}"
    stop_event = asyncio.Event()
    _stop_events[request_id] = (stop_event, code_id)
    model_used = req.model or cfg["llm_model"]
    # 从模型列表中查找该模型的 thinking 配置；未配置则交由供应商默认
    model_entry = find_model_entry(cfg["models"], model_used)
    reasoning_effort = model_entry.get("reasoning_effort") if model_entry else None
    thinking_budget = model_entry.get("thinking_budget") if model_entry else None
    # 日志元数据：客户端信息与原始数据开关（开关随请求读取，改配置即时生效）
    client_ip, user_agent = get_client_info(request)
    log_payload_enabled = bool(cfg.get("log_payload"))

    async def event_generator():
        charged = False
        migration_finished = False
        client_disconnected = False
        status = STATUS_SUCCESS
        error_message = ""
        units = 0
        output_parts: list[str] = []
        usage: dict = {}
        started = monotonic()
        try:
            async for token in llm.chat_stream_with_stop(
                user_prompt=prompt,
                model=req.model,
                stop_event=stop_event,
                reasoning_effort=reasoning_effort,
                thinking_budget=thinking_budget,
                usage_out=usage,
            ):
                output_parts.append(token)
                if await request.is_disconnected():
                    logger.info(f"Client disconnected: {request_id}")
                    client_disconnected = True
                    break
                # JSON 编码 token：SSE 按行分帧会丢失尾部换行符，
                # 编码后换行以 \n 转义形式单行传输，前端 JSON.parse 无损还原
                yield {"event": "token", "data": json.dumps(token, ensure_ascii=False)}

            if migration_batch:
                # 智能错题迁移只有整批卡片全部自然完成才扣费；手动停止或断开不扣费。
                success = not client_disconnected and not stop_event.is_set()
                should_charge = _finish_migration_stream(
                    batch_id=req.batch_id or "",
                    batch_index=req.batch_index or 0,
                    code_id=code_id,
                    success=success,
                )
                migration_finished = True
                # 额度在整批最后一卡完成时一次性扣减；单卡日志不扣费（units=0）
                if should_charge and success:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=code_id,
                        units=migration_batch.charge_units,
                        request_id=req.batch_id or request_id,
                    )
                if not success:
                    status = STATUS_CANCELLED
                yield {
                    "event": "done",
                    "data": "[DONE]" if success else "[CANCELLED]",
                }
            else:
                # 保持现有工具的计费行为：流正常收尾（包括用户停止/断开）后扣 1 次。
                if client_disconnected or stop_event.is_set():
                    status = STATUS_CANCELLED
                if not charged:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=code_id,
                        units=1,
                        request_id=request_id,
                    )
                    charged = True
                yield {"event": "done", "data": "[DONE]"}
        except asyncio.CancelledError:
            logger.info(f"Stream cancelled: {request_id}")
            status = STATUS_CANCELLED
            if migration_batch:
                if not migration_finished:
                    _finish_migration_stream(
                        batch_id=req.batch_id or "",
                        batch_index=req.batch_index or 0,
                        code_id=code_id,
                        success=False,
                    )
                    migration_finished = True
                yield {"event": "done", "data": "[CANCELLED]"}
            else:
                if not charged:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=code_id,
                        units=1,
                        request_id=request_id,
                    )
                    charged = True
                yield {"event": "done", "data": "[CANCELLED]"}
        except Exception as e:
            logger.error(f"Stream error for {request_id}: {e}")
            status = STATUS_ERROR
            error_message = str(e)
            # 原始异常可能内嵌上游网关地址/供应商报错，不回传给终端用户
            yield {
                "event": "error",
                "data": json.dumps({"message": "生成失败，请稍后重试"}, ensure_ascii=False),
            }
        finally:
            if migration_batch and not migration_finished:
                _finish_migration_stream(
                    batch_id=req.batch_id or "",
                    batch_index=req.batch_index or 0,
                    code_id=code_id,
                    success=False,
                )
            _stop_events.pop(request_id, None)
            # 成功、停止、异常统一留痕：元数据始终记录，原始数据受开关控制
            prov_id = ""
            prov_name = ""
            attempts = None
            try:
                if isinstance(llm, LLMRouter) and llm.provider_used:
                    prov_id = llm.provider_used.get("id", "")
                    prov_name = llm.provider_used.get("name", "")
                    attempts = llm.attempts
            except Exception:
                pass
            await asyncio.to_thread(
                _log_llm_call,
                code=code,
                tool_id=req.tool_id,
                tool_name=tool_name,
                model=model_used,
                request_id=request_id,
                status=status,
                started=started,
                usage=usage,
                client=(client_ip, user_agent),
                log_payload=log_payload_enabled,
                error_message=error_message,
                units=units,
                input_text=req.input,
                rendered_prompt=prompt,
                output_text="".join(output_parts),
                provider_id=prov_id,
                provider_name=prov_name,
                fallback_attempts=attempts,
            )

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        # sse-starlette 的 ping 单位是「秒」；配置值为毫秒，需换算
        ping=max(1, settings.sse_retry_timeout // 1000),
    )


def _charge_usage(*, code_id: int, units: int = 1, request_id: str = "") -> int:
    """在独立会话中扣减额度（日志由 _log_llm_call 统一记录）。

    同步函数，经 to_thread 调用。返回实际扣减的次数；
    并发超发被拒或写库失败时返回 0——内容已交付无法回收，
    但必须显式留痕而非静默吞掉。
    """
    db = SessionLocal()
    try:
        row = db.get(UsageCode, code_id)
        if row is None:
            return 0
        consume_quota(db, row, units=units)
        return units
    except HTTPException as e:
        logger.warning(
            "额度扣减被拒绝(%s)：code_id=%s units=%s request=%s —— 本次生成未计费",
            e.detail, code_id, units, request_id,
        )
        return 0
    except Exception:
        logger.exception("Failed to charge usage for %s", request_id)
        return 0
    finally:
        db.close()


@router.post("/stop")
async def stop_stream(
    req: StopRequest,
    code: Annotated[UsageCode, Depends(get_current_code)],
):
    """中止当前使用码自己发起的 SSE 流。"""
    entry = _stop_events.get(req.request_id)
    if entry is not None and entry[1] == code.id:
        entry[0].set()
        return {"status": "stopped", "request_id": req.request_id}
    # 不存在或不属于本人：统一返回 not_found，不泄露他人流的存在性
    return {"status": "not_found", "request_id": req.request_id}


@router.post("/title")
async def generate_title(
    req: TitleRequest,
    request: Request,
    code: Annotated[UsageCode, Depends(get_current_code)],
):
    """为一次生成结果生成简短标题。不扣减额度。"""
    _enforce_rate_limit(code.id, "title")
    tool_name = _resolve_prompt_filename(req.tool_id)
    if not tool_name:
        raise HTTPException(status_code=404, detail=f"Tool {req.tool_id} not found")

    user_prompt = (
        f"工具：{tool_name}\n\n"
        f"用户输入：{req.input[:600]}\n\n"
        f"模型输出摘要：{req.output[:800]}\n\n"
        "请生成标题："
    )

    cfg = await asyncio.to_thread(_load_cfg)
    _validate_model(cfg, req.model)
    llm = _build_llm(cfg, model=req.model, chores=True)
    model_used = req.model or cfg["chores_model"]
    client_ip, user_agent = get_client_info(request)
    started = monotonic()
    usage: dict = {}
    log_payload_enabled = bool(cfg.get("log_payload"))

    async def _record(status: str, output_text: str, error_message: str = "") -> None:
        prov_id = ""
        prov_name = ""
        attempts = None
        try:
            if isinstance(llm, LLMRouter) and llm.provider_used:
                prov_id = llm.provider_used.get("id", "")
                prov_name = llm.provider_used.get("name", "")
                attempts = llm.attempts
        except Exception:
            pass
        await asyncio.to_thread(
            _log_llm_call,
            code=code,
            tool_id="title",
            tool_name="标题生成",
            model=model_used,
            status=status,
            started=started,
            usage=usage,
            client=(client_ip, user_agent),
            log_payload=log_payload_enabled,
            error_message=error_message,
            input_text=req.input,
            rendered_prompt=user_prompt,
            output_text=output_text,
            provider_id=prov_id,
            provider_name=prov_name,
            fallback_attempts=attempts,
        )

    try:
        raw = await llm.chat(
            system_prompt=TITLE_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            model=req.model,
            max_tokens=64,
            usage_out=usage,
        )
    except Exception as e:
        logger.error(f"Title generation error: {e}")
        await _record(STATUS_ERROR, "", str(e))
        raise HTTPException(status_code=500, detail="标题生成失败，请稍后重试")

    title = raw.strip().strip('"').strip("'").split("\n")[0][:40]
    await _record(STATUS_SUCCESS, raw)
    return {"title": title}
