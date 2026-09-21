import asyncio
import base64
import binascii
import json
import logging
import re
from dataclasses import dataclass, field
from time import monotonic
from typing import Annotated, Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.database import SessionLocal
from app.deps import CodeContext, get_code_context, get_current_code
from app.models import UsageCode
from app.routers.ocr import normalize_image_mime, pair_image_data_urls, sniff_image_mime
from app.routers.tools import (
    CONTINUE_PROMPT_NAME,
    DEFAULT_OCR_MODE,
    OCR_MAX_IMAGES,
    OCR_MODES,
    OCR_TOOL_ID,
    OCR_TOOL_NAME,
    _resolve_continue_prompt_filename,
    _resolve_prompt_filename,
    get_prompt_loader,
    resolve_ocr_prompt_filename,
)
from app.services.free_access import (
    identity_key,
    is_free_model,
    is_free_open,
    register_free_use,
)
from app.services.llm import LLMService, count_text_tokens
from app.services.llm_router import DEFAULT_FIRST_TOKEN_TIMEOUT, LLMRouter
from app.services.migration import (
    MIGRATION_ANALYSIS_PROMPT_NAME,
    MIGRATION_MORE_ANALYSIS_PROMPT_NAME,
    MIGRATION_TOOL_ID,
    MIGRATION_TOOL_NAME,
    migration_charge_units,
    parse_error_causes,
)
from app.services.model_capabilities import supports_reasoning
from app.services.prompt_loader import PromptLoader
from app.services.provider_config import get_model_provider_map, get_providers_for_model
from app.services.rate_limit import enforce_rate_limit
from app.services.request_log import (
    STATUS_CANCELLED,
    STATUS_ERROR,
    STATUS_SUCCESS,
    get_client_info,
    get_fingerprint_info,
    record_usage_log,
)
from app.services.runtime_config import (
    find_model_entry,
    find_tool_reasoning_rule,
    resolve_llm_settings,
)
from app.services.usage_code import consume_quota
from app.services.vocab_check import check_over_words

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# 用于支持 SSE 请求中止的全局事件字典
# key: request_id, value: (asyncio.Event, 发起该流的属主标识)
# 属主标识形如 "code:12"（持码）或 "fp:xxx"/"ip:1.2.3.4"（匿名免费调用）；
# 停止请求必须校验属主，否则任何人都能掐断他人的生成。
_stop_events: dict[str, tuple[asyncio.Event, str]] = {}

# 免码调用（免费模型无码可用）在使用日志里的占位使用码
ANON_CODE_LABEL = "（免码）"


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
    entry = find_model_entry(cfg["models"], model)
    if entry is None:
        raise HTTPException(status_code=400, detail=f"模型不可用：{model}")
    # 禁用模型在用户端与 Chores 均不可选（语义上区别于仅 Chores）
    if not entry.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"模型已禁用：{model}")
    # 再校验该模型是否至少有一个 enabled Provider 绑定
    available = cfg.get("available_model_ids")
    if available is not None and model not in available:
        raise HTTPException(status_code=400, detail=f"模型不可用：{model} 未绑定可用 Provider")
    # 兜底：若没有 available 集合（旧逻辑），则按旧方式已通过 find_model_entry


def _identity_for(request: Request, code: UsageCode | None) -> str:
    """限流/限额主体：有码按码、无码按浏览器指纹、再退回 IP。"""
    fp_hash, _ = get_fingerprint_info(request)
    client_ip, _ = get_client_info(request)
    return identity_key(code_id=code.id if code else None, fingerprint=fp_hash, ip=client_ip)


def _owner_key(request: Request, code: UsageCode | None) -> str:
    """SSE 流属主标识，用于 /stop 校验归属。"""
    return f"code:{code.id}" if code else _identity_for(request, None)


def _ensure_model_access(ctx: CodeContext, entry: dict | None) -> None:
    """免费模型的无码放行判定。

    有可用使用码一律放行（是否扣次数由调用方按模型是否免费决定）；
    无码或码不可用时，仅「免费 + 无码可用」的模型放行，
    其余按不可用原因返回 401/403（文案与严格依赖完全一致）。
    """
    if ctx.ok or is_free_open(entry):
        return
    raise ctx.error()


def _load_continue_prompt(loader: PromptLoader, tool_id: str) -> str | None:
    """取该工具的续写指令：优先「<工具名>续写」，回退到共用的「继续生成」。

    两个文件都没有（或内容为空）时返回 None，调用方必须报错而不是按普通重试放行——
    静默降级的话，用户点了「继续生成」拿到的会是一篇从头重写的内容。
    """
    override = loader.get(_resolve_continue_prompt_filename(tool_id))
    if override and override.strip():
        return override
    shared = loader.get(CONTINUE_PROMPT_NAME)
    return shared if (shared and shared.strip()) else None


def _continue_messages(prompt: str, continue_from: str, continue_prompt: str) -> list[dict]:
    """续写请求的消息序列：原始 prompt → 上一次的残文 → 续写指令。

    首条与首次请求逐字节相同，供应商侧的前缀缓存仍然命中；残文以 assistant
    身份出现而不是拼进 prompt 文本，模型才知道那是「自己已经写出来的」。
    """
    return [
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": continue_from},
        {"role": "user", "content": continue_prompt},
    ]


# ---------------- 图片识别（OCR） ----------------

# 单张与整批体积闸门：前端已按长边 2000 / JPEG 0.85 压过一轮，这里挡的是绕过前端直调接口
OCR_MAX_IMAGE_BYTES = 3 * 1024 * 1024
OCR_MAX_TOTAL_BYTES = 16 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:([a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+);base64,(.*)$", re.S)


def _decode_image_data_url(raw: str) -> tuple[str, int]:
    """校验一条图片 data URL，返回 (规范 mime, 解码后字节数)。

    只解开头一小段做魔数嗅探、按 base64 长度核算体积：图片本体最终原样交给上游解码，
    这里要保证的是「别把非图片、超大体量或外链放进请求」。
    """
    match = _DATA_URL_RE.match((raw or "").strip())
    if not match:
        raise HTTPException(
            status_code=400, detail="图片格式不正确：只接受 data:image/…;base64 形式的图片"
        )
    declared = normalize_image_mime(match.group(1))
    if declared is None:
        raise HTTPException(status_code=400, detail="只支持 JPG / PNG / WebP 图片")
    payload = re.sub(r"\s+", "", match.group(2))
    if not payload:
        raise HTTPException(status_code=400, detail="图片内容为空，请重新选择")
    padding = len(payload) - len(payload.rstrip("="))
    size = (len(payload) // 4) * 3 - padding
    if size <= 0:
        raise HTTPException(status_code=400, detail="图片内容为空，请重新选择")
    if size > OCR_MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"单张图片超过 {OCR_MAX_IMAGE_BYTES // 1024 // 1024}MB，请换小一点的图再试",
        )
    try:
        head = base64.b64decode(payload[:24] + "=" * (-len(payload[:24]) % 4))
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="图片内容无法解析，请重新选择图片") from exc
    if sniff_image_mime(head) != declared:
        raise HTTPException(status_code=400, detail="图片内容与声明的格式不符，请重新选择图片")
    return declared, size


def _resolve_ocr_images(
    images: Optional[list[str]],
    pair_token: Optional[str],
    pair_order: Optional[list[int]] = None,
) -> list[str]:
    """确定本次识别的图片（data URL 列表）：随请求上传，或取自扫码配对会话。

    扫码来源可以带 pair_order：那是电脑端排好序、并可能删过几张之后的下标序列，
    重排与删除只改顺序、不重传字节。
    """
    pair = (pair_token or "").strip()
    raws = [str(item or "") for item in (images or [])]
    if pair and raws:
        raise HTTPException(status_code=400, detail="图片只能来自一处：随请求上传，或走扫码配对")
    if pair:
        return pair_image_data_urls(pair, pair_order)
    if pair_order:
        raise HTTPException(status_code=400, detail="图片顺序仅适用于扫码拍到的照片")
    if not raws:
        raise HTTPException(status_code=400, detail="没有收到图片，请先选择或拍摄图片")
    if len(raws) > OCR_MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"一次最多识别 {OCR_MAX_IMAGES} 张图片")
    total = 0
    for raw in raws:
        _, size = _decode_image_data_url(raw)
        total += size
    if total > OCR_MAX_TOTAL_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"图片总量超过 {OCR_MAX_TOTAL_BYTES // 1024 // 1024}MB，请减少张数",
        )
    return [raw.strip() for raw in raws]


def _validate_ocr_model(cfg: dict, model: str) -> None:
    """OCR 模型的可用性校验。

    不能复用 _validate_model：那里的 available_model_ids 只含「用户可用」的模型，
    而 OCR 模型恰恰可能是用户端不可见的（只勾了「用于 OCR」）。
    """
    entry = find_model_entry(cfg["models"], model)
    if entry is None:
        raise HTTPException(
            status_code=400, detail=f"OCR 模型不存在：{model}（请在管理后台检查 OCR 模型配置）"
        )
    if not entry.get("enabled", True):
        raise HTTPException(
            status_code=400, detail=f"OCR 模型已禁用：{model}（请在管理后台检查 OCR 模型配置）"
        )
    # 留空即「跟随默认」，前提是默认模型勾选了「用于 OCR」：
    # 否则等于拿一个不认图的模型去识别，只会在上游报一堆看不懂的错
    if not cfg.get("ocr_model_configured") and not entry.get("ocr_usable", False):
        raise HTTPException(
            status_code=400,
            detail=(
                f"后台未配置 OCR 模型，默认模型「{model}」也未勾选「用于 OCR」："
                "请在管理后台指定一个视觉模型，或为默认模型勾上该项"
            ),
        )
    if not _get_providers_for_model_sync(cfg, model):
        raise HTTPException(status_code=400, detail=f"OCR 模型未绑定可用 Provider：{model}")


def _hit_output_cap(usage: dict, limit: int) -> bool:
    """输出是否撞到上限（撞上就提示结果可能不完整，不静默交付半份转录）。"""
    if not limit:
        return False
    try:
        completion = int(usage.get("completion_tokens") or 0)
    except (TypeError, ValueError):
        return False
    return completion >= limit * 0.95


@dataclass
class _MigrationBatch:
    # 属主：持码时为 code.id，免码调用统一为 0（batch_id 由客户端随机生成，不会互串）
    owner_id: int
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
    # 禁用模型直接返回空链（用户端与 Chores 均不可用，区别于仅 Chores 仍可用于 Chores）
    try:
        _entry = find_model_entry(cfg.get("models") or [], model_id)
        if _entry is not None and not _entry.get("enabled", True):
            return []
    except Exception:
        pass
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
        first_token_timeout=cfg.get("first_token_timeout") or DEFAULT_FIRST_TOKEN_TIMEOUT,
    )
    return router


def _mark_usage_context(
    request: Request,
    *,
    code: Optional[UsageCode],
    tool_id: str,
    tool_name: str,
    model: str,
    request_id: str = "",
) -> None:
    """把本次调用的业务上下文挂到请求上。

    仅供 main.py 的全局未捕获异常处理器兜底留痕：异常在路由里被吞成 500 时，
    使用日志仍能标出是哪个使用码、哪个工具、哪个模型出的问题。
    """
    request.state.usage_meta = {
        "code": code,
        "tool_id": tool_id,
        "tool_name": tool_name,
        "model": model,
        "request_id": request_id,
    }


def _router_log_fields(llm) -> tuple[str, str, Optional[int]]:
    """使用日志的 Provider 归属：成功记命中的那家，失败记最后尝试的那家。

    多 Provider 全链失败时 provider_used 为空，必须回落到 last_provider，
    否则日志里既看不到是哪家挂的，也看不到总共试了几家。
    """
    if not isinstance(llm, LLMRouter):
        return "", "", None
    provider = llm.reported_provider
    if not provider:
        return "", "", llm.attempts or None
    return (
        provider.get("id", "") or "",
        provider.get("name", "") or "",
        llm.attempts or None,
    )


def _final_error_message(llm, status: str, base: str) -> str:
    """错误信息落库口径。

    - 逐家失败摘要里已含最终抛出的异常，所以有摘要时以摘要为准，不再重复拼接；
    - 但若调用方另有业务侧结论（如「模型未返回可确认的错因」），它比摘要更贴切，
      拼在前面一起记，避免被逐家摘要盖掉；
    - 成功但发生过备用切换的也留一条尾注，便于后台发现长期不健康的那家。
    """
    if not isinstance(llm, LLMRouter):
        return base
    summary = llm.failure_summary()
    if not summary:
        return base
    if status == STATUS_SUCCESS:
        return f"备用切换：{summary}"
    last_error = llm.attempt_errors[-1][1] if llm.attempt_errors else ""
    if base and last_error and base[:60] not in last_error:
        return f"{base} ｜ {summary}"
    return summary


def _log_llm_call(
    *,
    code: UsageCode | None,
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
    fingerprint: str = "",
    device_summary: str = "",
) -> None:
    """统一落一条 LLM 调用日志。同步函数，供 asyncio.to_thread 调用。

    元数据始终记录；原始输入 / 渲染 Prompt / 输出仅在 log_payload 开启时落库。
    指纹仅用于识别共享，不做拦截依据：缺失/非法时按无指纹记录，绝不影响主请求。
    code 为 None 表示免码调用（免费模型无码可用），记 code_id=0 + `（免码）`
    占位，便于管理后台把匿名用量与真实使用码区分开。
    """
    record_usage_log(
        code_id=code.id if code else 0,
        code=code.code if code else ANON_CODE_LABEL,
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
        fingerprint=fingerprint or "",
        device_summary=device_summary or "",
    )


class ChatRequest(BaseModel):
    tool_id: str = Field(..., max_length=64, description="工具 ID，对应 /api/tools/ 返回的工具 id")
    input: str = Field(
        "",
        max_length=50000,
        description="用户输入文本（上限按整卷 + 解析版的粘贴体量放宽）；OCR 工具不需要文字，"
        "其余工具为空时在路由内报 400",
    )
    model: Optional[str] = Field(None, max_length=128, description="模型 ID，为空则使用默认模型")
    request_id: Optional[str] = Field(None, max_length=128, description="客户端生成的请求 ID，用于停止生成")
    batch_id: Optional[str] = Field(None, max_length=128, description="智能错题迁移批次 ID")
    batch_size: Optional[int] = Field(None, ge=1, description="批次内错因卡片总数")
    batch_index: Optional[int] = Field(None, ge=0, description="当前错因在批次中的序号")
    transfer_count: Optional[int] = Field(
        None, ge=1, le=5, description="试卷可视化全解：每道笔试题的迁移训练题量（默认 1）"
    )
    continue_from: Optional[str] = Field(
        None,
        max_length=200000,
        description="已生成但被中断的正文。传入即表示本次接着它续写：该文本作为上一条 "
        "assistant 消息回传，末尾再追加一条续写指令（prompts/继续生成.md）",
    )
    images: Optional[list[str]] = Field(
        None,
        max_length=OCR_MAX_IMAGES,
        description="图片识别：图片 data URL 列表（data:image/jpeg;base64,...），与 pair_token 二选一",
    )
    ocr_mode: Optional[str] = Field(
        None,
        max_length=32,
        description="图片识别模式：printed=印刷试卷 / handwritten=手写作文（前端按所在工具决定，见 API 契约 8.2）",
    )
    pair_token: Optional[str] = Field(
        None, max_length=64, description="图片识别：扫码配对会话 token，图片由服务器内存直接读取"
    )
    pair_order: Optional[list[int]] = Field(
        None,
        max_length=OCR_MAX_IMAGES,
        description="图片识别：扫码照片按哪个顺序送进模型（会话内下标序列）。"
        "电脑端排序、删除后只传这个序列，不重传图片字节",
    )


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
    transfer_count: Optional[int] = Field(
        None, ge=1, le=5, description="试卷可视化全解：每道笔试题的迁移训练题量（默认 1）"
    )
    continue_from: Optional[str] = Field(
        None, max_length=200000, description="预览续写请求时传入被中断的正文"
    )


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
    # 免费模型批次不占额度（charge_units=0），不能走减法：
    # 否则会把同一属主其它批次的预留一起清掉
    if batch.charge_units <= 0:
        return
    reserved = _migration_reserved.get(batch.owner_id, 0) - batch.charge_units
    if reserved > 0:
        _migration_reserved[batch.owner_id] = reserved
    else:
        _migration_reserved.pop(batch.owner_id, None)


def _register_migration_batch(
    req: ChatRequest,
    *,
    owner_id: int,
    remaining: int | None,
    free: bool,
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
    # 免费模型不扣次数，整批也不占额度预留
    charge_units = 0 if free else migration_charge_units(req.batch_size)
    batch = _migration_batches.get(req.batch_id)
    if batch:
        if batch.owner_id != owner_id or batch.expected != req.batch_size:
            raise HTTPException(status_code=400, detail="智能错题迁移批次参数不一致")
        if charge_units > batch.charge_units:
            # 免费批生成途中命中免费限额：整批升级为付费批（同批计费口径必须一致）
            delta = charge_units - batch.charge_units
            reserved = _migration_reserved.get(owner_id, 0)
            if remaining is not None and remaining - reserved < delta:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "message": "额度不足，无法生成本次智能错题迁移",
                        "required": charge_units,
                        "remaining": max(0, remaining - reserved),
                    },
                )
            batch.charge_units = charge_units
            _migration_reserved[owner_id] = reserved + delta
        # charge_units 更小（窗口滚动后又有免费卡）不回退，整批仍按付费结算
        return batch

    if charge_units > 0:
        reserved = _migration_reserved.get(owner_id, 0)
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
        owner_id=owner_id,
        expected=req.batch_size,
        charge_units=charge_units,
    )
    _migration_batches[req.batch_id] = batch
    if charge_units > 0:
        _migration_reserved[owner_id] = reserved + charge_units
    return batch


def _finish_migration_stream(
    *,
    batch_id: str,
    batch_index: int,
    owner_id: int,
    success: bool,
) -> bool:
    """标记一张卡片完成，返回是否应由当前请求完成整批扣费。"""
    batch = _migration_batches.get(batch_id)
    if not batch or batch.owner_id != owner_id:
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
    request: Request,
    ctx: Annotated[CodeContext, Depends(get_code_context)],
):
    """机械排查超标词:分词 + 课标词表集合匹配,毫秒级返回,不扣减额度,无需使用码。"""
    enforce_rate_limit(_identity_for(request, ctx.code), "vocab")
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
    ctx: Annotated[CodeContext, Depends(get_code_context)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """非流式分析智能错题迁移的错因，不扣减额度。

    无码调用只在目标模型「免费 + 无码可用」时放行（前端会带上当前选中模型）。
    """
    enforce_rate_limit(_identity_for(request, ctx.code), "analyze")
    prompt = loader.render(
        MIGRATION_ANALYSIS_PROMPT_NAME,
        _migration_prompt_input(req),
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="智能错题迁移错因分析 Prompt 不存在")

    messages = _migration_analysis_messages(req, prompt, loader)
    cfg = await asyncio.to_thread(_load_cfg)
    _validate_model(cfg, req.model)
    model_used = req.model or cfg["llm_model"]
    _ensure_model_access(ctx, find_model_entry(cfg["models"], model_used))
    llm = _build_llm(cfg, model=req.model, chores=False)
    _mark_usage_context(
        request,
        code=ctx.code,
        tool_id="migration_analyze",
        tool_name="错因分析",
        model=model_used,
    )
    client_ip, user_agent = get_client_info(request)
    fp_hash, fp_summary = get_fingerprint_info(request)
    started = monotonic()
    usage: dict = {}
    log_payload_enabled = bool(cfg.get("log_payload"))

    async def _record(status: str, output_text: str, error_message: str = "") -> None:
        prov_id, prov_name, attempts = _router_log_fields(llm)
        await asyncio.to_thread(
            _log_llm_call,
            code=ctx.code,
            tool_id="migration_analyze",
            tool_name="错因分析",
            model=model_used,
            status=status,
            started=started,
            usage=usage,
            client=(client_ip, user_agent),
            log_payload=log_payload_enabled,
            error_message=_final_error_message(llm, status, error_message),
            input_text=_migration_prompt_input(req),
            rendered_prompt=prompt,
            output_text=output_text,
            provider_id=prov_id,
            provider_name=prov_name,
            fallback_attempts=attempts,
            fingerprint=fp_hash,
            device_summary=fp_summary,
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
    ctx: Annotated[CodeContext, Depends(get_code_context)],
):
    """生成最终迁移结果前预检查本次所需额度，不扣费；无码调用不校验额度。"""
    required = migration_charge_units(req.cause_count)
    remaining = ctx.code.remaining if ctx.code else None
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

    prompt = loader.render(
        prompt_filename, req.input, {"transfer_count": req.transfer_count}
    )
    if prompt is None:
        raise HTTPException(
            status_code=404,
            detail=f"Prompt file {prompt_filename}.md not found",
        )

    messages = None
    if req.continue_from and req.continue_from.strip():
        continue_prompt = _load_continue_prompt(loader, req.tool_id)
        if continue_prompt is None:
            raise HTTPException(
                status_code=404,
                detail=f"续写指令文件 {CONTINUE_PROMPT_NAME}.md 未找到，无法继续生成",
            )
        messages = _continue_messages(prompt, req.continue_from, continue_prompt)

    return {
        "tool_id": req.tool_id,
        "prompt_filename": prompt_filename + ".md",
        "prompt": prompt,
        # 续写预览：把实际会发出去的消息序列一并给出，便于核对残文与指令的拼接位置
        "messages": messages,
    }


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    request: Request,
    ctx: Annotated[CodeContext, Depends(get_code_context)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """流式调用工具，返回 SSE 事件流。

    认证规则：使用码可用时一律放行（是否扣次数取决于模型是否免费）；
    无码或码不可用时，仅「免费 + 无码可用」的模型放行，其余按原因返回 401/403。
    免费模型在限额内不扣次数；限额命中后若使用码仍可用则转为按次扣减，
    无码或码不可用才返回 429。
    图片识别（工具 32）单独一条链路：需有效使用码、始终不扣次数、只按身份限流。
    """
    is_ocr = req.tool_id == OCR_TOOL_ID
    if is_ocr:
        # 识别需要有效使用码：扫码拍照同样走这道闸，不是匿名入口。
        # 准入与限流放在最前面，不合法或超频的请求不会走到取图那一步。
        if not ctx.ok:
            raise ctx.error()
        enforce_rate_limit(_identity_for(request, ctx.code), "ocr")
        ocr_mode = (req.ocr_mode or DEFAULT_OCR_MODE).strip() or DEFAULT_OCR_MODE
        if ocr_mode not in OCR_MODES:
            raise HTTPException(status_code=400, detail=f"不支持的识别模式：{ocr_mode}")
        prompt_filename = resolve_ocr_prompt_filename(ocr_mode)
    else:
        # OCR 之外的工具仍然必须有正文：这条校验原来由字段的 min_length 承担
        if not req.input.strip():
            raise HTTPException(status_code=400, detail="请输入内容")
        prompt_filename = _resolve_prompt_filename(req.tool_id)
    if not prompt_filename:
        raise HTTPException(status_code=404, detail=f"Tool {req.tool_id} not found")

    prompt = loader.render(
        prompt_filename, req.input, {"transfer_count": req.transfer_count}
    )
    if prompt is None:
        raise HTTPException(
            status_code=404,
            detail=f"Prompt file {prompt_filename}.md not found",
        )

    # 图片识别：图片随请求上传（data URL）或来自扫码配对会话，二选一
    ocr_images: list[str] = []
    ocr_messages: Optional[list[dict]] = None
    if is_ocr:
        ocr_images = _resolve_ocr_images(req.images, req.pair_token, req.pair_order)
        ocr_messages = [
            {
                "role": "user",
                "content": [{"type": "text", "text": prompt}]
                + [{"type": "image_url", "image_url": {"url": url}} for url in ocr_images],
            }
        ]

    # 续写：首条消息与首次请求完全一致，接着放残文，最后挂一条续写指令。
    # 其余逻辑（额度、推理规则、停止事件、日志）与普通请求完全一致。
    continue_messages: Optional[list[dict]] = None
    if req.continue_from and req.continue_from.strip():
        continue_prompt = _load_continue_prompt(loader, req.tool_id)
        if continue_prompt is None:
            raise HTTPException(
                status_code=404,
                detail=f"续写指令文件 {CONTINUE_PROMPT_NAME}.md 未找到，无法继续生成",
            )
        continue_messages = _continue_messages(prompt, req.continue_from, continue_prompt)

    # 配置读取走短会话 + 线程池：不随 SSE 流占住连接池会话，也不阻塞事件循环
    cfg = await asyncio.to_thread(_load_cfg)
    code = ctx.code
    if is_ocr:
        # 识别用后台配置的 OCR 模型，忽略请求里的 model（用户端根本看不到它）
        model_used = cfg.get("ocr_model") or cfg["default_model"]
        _validate_ocr_model(cfg, model_used)
        model_entry = find_model_entry(cfg["models"], model_used)
        # 始终不计费：不注册免费额度、不占额度预留、扣减次数恒为 0
        free_model = False
        charged_free = True
    else:
        _validate_model(cfg, req.model)
        model_used = req.model or cfg["llm_model"]
        # 从模型列表中查找该模型的思考配置与免费标记；未配置则交由供应商默认
        model_entry = find_model_entry(cfg["models"], model_used)
        _ensure_model_access(ctx, model_entry)
        free_model = is_free_model(model_entry)
        charged_free = free_model

    # 日志元数据：客户端信息与原始数据开关（开关随请求读取，改配置即时生效）
    client_ip, user_agent = get_client_info(request)
    fp_hash, fp_summary = get_fingerprint_info(request)
    log_payload_enabled = bool(cfg.get("log_payload"))
    owner_id = code.id if code else 0
    owner_key = f"code:{code.id}" if code else identity_key(fingerprint=fp_hash, ip=client_ip)

    # 免费模型：优先走免费额度（不扣次数）并在建立 SSE 之前过防滥用限额；
    # 限额命中时若使用码仍可用（含无限码）则转为按次计费，无码/码不可用才 429。
    # OCR 的 charged_free 在上方恒为真，不会进这里（识别始终不计费）。
    release_free_slot: Callable[[], None] = lambda: None
    if free_model:
        try:
            release_free_slot = await asyncio.to_thread(
                register_free_use,
                entry=model_entry or {},
                identity=identity_key(
                    code_id=code.id if code else None,
                    fingerprint=fp_hash,
                    ip=client_ip,
                ),
            )
        except HTTPException as exc:
            if exc.status_code != 429 or code is None or code.is_exhausted:
                raise
            charged_free = False
            logger.info(
                "免费模型限额命中，转为按次计费：model=%s code_id=%s", model_used, code.id
            )
    # 日志展示用名称：迁移与识别都用工具名而不是底层 prompt 文件名
    # （识别有印刷/手写两份提示词，按文件名记会让同一个工具在日志里分成两条）
    if is_ocr:
        tool_name = OCR_TOOL_NAME
    elif req.tool_id == MIGRATION_TOOL_ID:
        tool_name = MIGRATION_TOOL_NAME
    else:
        tool_name = prompt_filename
    # 挂上业务上下文：路由内若有未捕获异常，全局处理器据此补一条使用日志
    _mark_usage_context(
        request,
        code=code,
        tool_id=req.tool_id,
        tool_name=tool_name,
        model=model_used,
        request_id=req.request_id or "",
    )

    try:
        migration_batch = _register_migration_batch(
            req,
            owner_id=owner_id,
            remaining=code.remaining if code else None,
            free=charged_free,
        )
    except BaseException:
        release_free_slot()
        raise

    # OCR 用后台配置的模型（上面已解析成 model_used），其余工具沿用请求里选的模型
    llm = _build_llm(cfg, model=model_used, chores=False)
    base_request_id = req.request_id or f"{req.tool_id}_{id(request)}"
    request_id = base_request_id
    existing = _stop_events.get(base_request_id)
    if existing is not None and existing[1] != owner_key:
        # 同毫秒撞名时不覆盖他人注册（属主校验收口在 /stop）
        request_id = f"{base_request_id}_{owner_id}"
    stop_event = asyncio.Event()
    _stop_events[request_id] = (stop_event, owner_key)
    reasoning_effort = model_entry.get("reasoning_effort") if model_entry else None
    thinking_budget = model_entry.get("thinking_budget") if model_entry else None
    # 免费额度命中的调用不扣次数；转为按次计费时扣 1 次（迁移批次按 charge_units 结算）
    quota_units = 0 if charged_free else 1
    # 工具推理规则：按列表顺序取第一条命中该工具的规则，强制覆盖思考强度
    tool_rule = find_tool_reasoning_rule(cfg.get("tool_reasoning_rules") or [], req.tool_id)
    if tool_rule is not None:
        # 支持性按首选 Provider 的实际模型 ID 判定（provider_model_id 可与逻辑 ID 不同）
        provider_chain = getattr(llm, "providers", None) or []
        actual_model = (provider_chain[0].get("provider_model_id") if provider_chain else "") or model_used
        supported = supports_reasoning(actual_model)
        if supported is False and tool_rule.get("on_unsupported") == "fail":
            # 在注册停止事件、建立 SSE 之前拦截，走 HTTP 错误路径（前端错误卡自带换模型重试）
            _stop_events.pop(request_id, None)
            release_free_slot()
            raise HTTPException(
                status_code=400,
                detail=(
                    f"当前模型「{model_used}」不支持推理强度「{tool_rule['reasoning_effort']}」，"
                    "本次生成已被工具推理规则拦截，可更换模型重试"
                ),
            )
        if supported is not False:
            # 明确支持或能力未知（未知时交由 litellm.drop_params 兜底，不会报错）时应用规则强度；
            # 同时清掉模型级思考预算，避免 budget 优先级高于档位而架空规则
            reasoning_effort = tool_rule.get("reasoning_effort")
            thinking_budget = None
    # 试卷可视化全解使用自定义分隔格式，无需 JSON mode，兼容性更强（忠于原始模型配置，不强制覆盖 reasoning/max_tokens）
    visual_response_format = None

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
            async for item in llm.chat_stream_with_stop(
                user_prompt=prompt,
                # OCR 走多模态消息序列（指令 + N 张图片），续写走残文序列，其余为 prompt 单条
                messages=ocr_messages or continue_messages,
                model=model_used,
                max_tokens=cfg["ocr_max_tokens"] if is_ocr else None,
                stop_event=stop_event,
                reasoning_effort=reasoning_effort,
                thinking_budget=thinking_budget,
                usage_out=usage,
                response_format=visual_response_format,
            ):
                # 推理过程单独透出：不计入正文、不写日志 output、不参与用量估算；
                # 事件为 {t, n}，n 为 litellm tokenizer 逐 delta 计得的 token 数，
                # 前端据此累加展示 tok 与 tok/s；测试用的旧式 FakeLLM 仍 yield 纯 str，视为 token。
                if isinstance(item, tuple) and item and item[0] == "reasoning":
                    reasoning_text = item[1] if len(item) > 1 else ""
                    if not reasoning_text:
                        continue
                    if await request.is_disconnected():
                        logger.info(f"Client disconnected: {request_id}")
                        client_disconnected = True
                        break
                    yield {"event": "reasoning", "data": json.dumps(
                        {"t": reasoning_text, "n": count_text_tokens(reasoning_text, model_used)},
                        ensure_ascii=False,
                    )}
                    continue
                if isinstance(item, tuple) and item and item[0] == "fallback":
                    # 切换备用 Provider：把进度透给前端（只有序号与总数，不含 Provider 名称），
                    # 用户据此知道自己在等第几个通道，而不是对着空界面干等
                    yield {"event": "fallback", "data": json.dumps(item[1], ensure_ascii=False)}
                    continue
                token = item
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
                    owner_id=owner_id,
                    success=success,
                )
                migration_finished = True
                # 额度在整批最后一卡完成时一次性扣减；单卡日志不扣费（units=0）
                if should_charge and success:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=owner_id,
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
                # 保持现有工具的计费行为：流正常收尾（包括用户停止/断开）后扣 1 次；
                # 免费额度内 quota_units=0 不扣，命中限额转按次计费时扣 1 次，OCR 恒为 0。
                if client_disconnected or stop_event.is_set():
                    status = STATUS_CANCELLED
                # 整卷转录很容易撞输出上限：撞上了要明说，别让人拿着半份试卷往下走
                if is_ocr and _hit_output_cap(usage, cfg["ocr_max_tokens"]):
                    yield {
                        "event": "truncated",
                        "data": json.dumps({"limit": cfg["ocr_max_tokens"]}, ensure_ascii=False),
                    }
                if not charged:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=owner_id,
                        units=quota_units,
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
                        owner_id=owner_id,
                        success=False,
                    )
                    migration_finished = True
                yield {"event": "done", "data": "[CANCELLED]"}
            else:
                if not charged:
                    units = await asyncio.to_thread(
                        _charge_usage,
                        code_id=owner_id,
                        units=quota_units,
                        request_id=request_id,
                    )
                    charged = True
                yield {"event": "done", "data": "[CANCELLED]"}
        except Exception as e:
            logger.error(f"Stream error for {request_id}: {e}")
            status = STATUS_ERROR
            error_message = str(e)
            # 原始异常可能内嵌上游网关地址/供应商报错，不回传给终端用户；
            # model 供前端失败归因：禁用真正执行失败的模型，而非其当前选中的模型
            yield {
                "event": "error",
                "data": json.dumps(
                    {"message": "生成失败，请稍后重试", "model": model_used},
                    ensure_ascii=False,
                ),
            }
        finally:
            if migration_batch and not migration_finished:
                _finish_migration_stream(
                    batch_id=req.batch_id or "",
                    batch_index=req.batch_index or 0,
                    owner_id=owner_id,
                    success=False,
                )
            _stop_events.pop(request_id, None)
            # 释放免费模型的在途占位（重复调用安全）
            release_free_slot()
            # 成功、停止、异常统一留痕：元数据始终记录，原始数据受开关控制
            prov_id, prov_name, attempts = _router_log_fields(llm)
            # 先置位再落库：to_thread 会同步把写库任务提交进线程池，
            # 全局异常处理器据此跳过，避免同一次请求被记两条
            request.state.usage_logged = True
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
                error_message=_final_error_message(llm, status, error_message),
                units=units,
                # OCR 的输入是图片：正文留空，日志里记张数，便于核对视觉调用量
                input_text=req.input if not is_ocr else f"[图片 {len(ocr_images)} 张]",
                rendered_prompt=prompt,
                output_text="".join(output_parts),
                provider_id=prov_id,
                provider_name=prov_name,
                fallback_attempts=attempts,
                fingerprint=fp_hash,
                device_summary=fp_summary,
            )
            # 批次缓存只在注册新批次时被动清理，若此后再无迁移请求，过期批次与
            # 额度预留会一直留在内存里；每次生成收尾顺手扫一遍，代价可忽略
            _cleanup_migration_batches()

    return EventSourceResponse(
        event_generator(),
        media_type="text/event-stream",
        # sse-starlette 的 ping 单位是「秒」；配置值为毫秒，需换算
        ping=max(1, settings.sse_retry_timeout // 1000),
    )


def _charge_usage(*, code_id: int, units: int = 1, request_id: str = "") -> int:
    """在独立会话中扣减额度（日志由 _log_llm_call 统一记录）。

    同步函数，经 to_thread 调用。返回实际扣减的次数；
    units <= 0（免费模型、免码调用、迁移单卡）直接返回 0，不碰数据库；
    并发超发被拒或写库失败时返回 0——内容已交付无法回收，
    但必须显式留痕而非静默吞掉。
    """
    if units <= 0:
        return 0
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
    request: Request,
    ctx: Annotated[CodeContext, Depends(get_code_context)],
):
    """中止当前调用方自己发起的 SSE 流（含免码的免费模型调用）。"""
    owner = _owner_key(request, ctx.code)
    entry = _stop_events.get(req.request_id)
    if entry is not None and entry[1] == owner:
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
    """为一次生成结果生成简短标题。不扣减额度，仅登录用户可用。"""
    enforce_rate_limit(f"code:{code.id}", "title")
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
    _mark_usage_context(
        request,
        code=code,
        tool_id="title",
        tool_name="标题生成",
        model=model_used,
    )
    client_ip, user_agent = get_client_info(request)
    fp_hash, fp_summary = get_fingerprint_info(request)
    started = monotonic()
    usage: dict = {}
    log_payload_enabled = bool(cfg.get("log_payload"))

    async def _record(status: str, output_text: str, error_message: str = "") -> None:
        prov_id, prov_name, attempts = _router_log_fields(llm)
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
            error_message=_final_error_message(llm, status, error_message),
            input_text=req.input,
            rendered_prompt=user_prompt,
            output_text=output_text,
            provider_id=prov_id,
            provider_name=prov_name,
            fallback_attempts=attempts,
            fingerprint=fp_hash,
            device_summary=fp_summary,
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
