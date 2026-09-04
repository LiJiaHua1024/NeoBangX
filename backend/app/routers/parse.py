"""PDF 云端解析代理（MinerU）：预检 409 → is_ocr=false → 空结果 409 → is_ocr=true 重试。"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_code, get_optional_code
from app.models import UsageCode
from app.services.mineru import (
    EMPTY_CHARS_THRESHOLD,
    MinerUError,
    get_mineru_settings,
    parse_pdf_agent,
    parse_pdf_precision,
)
from app.services.pdf_scan_check import check_pdf_scanned
from app.services.runtime_config import resolve_llm_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/parse", tags=["parse"])

# 与 ChatRequest.input 上限对齐（chat.py 同值），超长截断
MAX_PARSE_CHARS = 50000

AGENT_MAX_BYTES = 10 * 1024 * 1024
PRECISION_MAX_BYTES = 200 * 1024 * 1024
MIN_NONEMPTY_FILE_BYTES = 10 * 1024

SCAN_PRE_MESSAGE = "该 PDF 很有可能是拍照或扫描版，建议先确认。"
SCAN_POST_MESSAGE = "首次解析结果为空，更可能是扫描件。"


def _unsupported_detail(filename: str) -> dict:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower() or "未知"
    return {
        "message": f"暂不支持“{ext}”格式。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。",
        "kind": "unsupported",
    }


@router.get("/config")
async def parse_config(db: Annotated[Session, Depends(get_db)]):
    """公开：告诉前端当前 PDF 是否可用、走哪种模式、大小上限（不泄露 token）。"""
    try:
        llm_cfg = resolve_llm_settings(db)
        mineru = llm_cfg.get("mineru") or {}
        mode = mineru.get("mode") or "precision"
        model = mineru.get("model") or "pipeline"
        has_token = bool(mineru.get("has_token"))
    except Exception:
        mode, model, has_token = "precision", "pipeline", False
    limit_mb = 200 if mode == "precision" else 10
    pdf_enabled = True if mode == "agent" else has_token
    return {
        "pdf_enabled": pdf_enabled,
        "mode": mode,
        "model": model,
        "needs_token": mode == "precision" and not has_token,
        "limits": {"precision_mb": 200, "agent_mb": 10, "current_mb": limit_mb},
    }


@router.post("/file")
async def parse_file(
    db: Annotated[Session, Depends(get_db)],
    code: Annotated[UsageCode, Depends(get_current_code)],
    file: UploadFile = File(...),
    confirm_scanned: bool = Form(False),
):
    filename = (file.filename or "").strip() or "document.pdf"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext != "pdf":
        raise HTTPException(status_code=400, detail=_unsupported_detail(filename))

    settings = get_mineru_settings(db)
    mode = settings["mode"]
    model = settings["model"]
    token = settings["token"]
    limit_bytes = PRECISION_MAX_BYTES if mode == "precision" else AGENT_MAX_BYTES
    limit_mb = 200 if mode == "precision" else 10

    try:
        content = await file.read()
    except Exception as e:
        logger.warning("parse read upload failed: %s", e)
        raise HTTPException(status_code=422, detail={
            "message": "文件读取失败，请重试。",
            "kind": "corrupt",
        }) from e
    size = len(content or b"")
    if size == 0:
        raise HTTPException(status_code=422, detail={
            "message": "文件无法读取，可能已损坏、被加密或为空。请重新导出一次 PDF 后再试。",
            "kind": "corrupt",
        })
    if size > limit_bytes:
        mb = size / (1024 * 1024)
        raise HTTPException(status_code=413, detail={
            "message": f"文件超过 {limit_mb}MB（当前{mb:.1f}MB）。精准模式上限200MB，轻量模式上限10MB；过大请拆分或让管理员切换为精准模式。",
            "kind": "too_large",
        })
    if mode == "precision" and not token:
        raise HTTPException(status_code=503, detail={
            "message": "PDF 解析尚未配置（缺少 MinerU Token）。请联系管理员在管理后台 → 文档解析中填写。",
            "kind": "token_missing",
        })

    # Step 0：扫描预检（未确认时）
    scan_evidence: dict = {}
    if not confirm_scanned:
        try:
            scan = await asyncio.to_thread(check_pdf_scanned, content)
        except Exception as e:
            logger.warning("scan check thread failed: %s", e)
            scan = {"is_scanned": False, "confidence": 0.0, "evidence": {}}
        scan_evidence = scan.get("evidence") or {}
        if scan.get("is_scanned"):
            logger.info("parse scan suspected pre_check file=%s size=%s conf=%s ev=%s",
                        filename, size, scan.get("confidence"), scan_evidence)
            raise HTTPException(status_code=409, detail={
                "message": SCAN_PRE_MESSAGE,
                "kind": "scanned_suspected",
                "stage": "pre_check",
                "scan_evidence": scan_evidence,
            })

    # 调 MinerU：首次 is_ocr=false，确认后 is_ocr=true（只做一次）
    is_ocr = bool(confirm_scanned)
    try:
        if mode == "precision":
            total = 360.0 if is_ocr else 300.0
            result = await parse_pdf_precision(
                file_bytes=content, filename=filename, token=token,
                model_version=model, is_ocr=is_ocr, timeout_total=total,
            )
        else:
            total = 240.0 if is_ocr else 180.0
            result = await parse_pdf_agent(
                file_bytes=content, filename=filename, is_ocr=is_ocr, timeout_total=total,
            )
        text, images_removed = result.text, result.images_removed
    except MinerUError as e:
        logger.warning("parse mineru failed mode=%s ocr=%s kind=%s detail=%s", mode, is_ocr, e.kind, e.detail)
        raise HTTPException(status_code=e.http_status, detail={"message": e.user_message, "kind": e.kind}) from e
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("parse unexpected mode=%s ocr=%s", mode, is_ocr)
        raise HTTPException(status_code=502, detail={
            "message": "解析失败，请重试一次，仍失败请换一份 PDF 或联系管理员。",
            "kind": "parse_failed",
        }) from e

    stripped = (text or "").strip()
    if len(stripped) < EMPTY_CHARS_THRESHOLD:
        if not confirm_scanned and size > MIN_NONEMPTY_FILE_BYTES:
            # 首次空结果 → 二次弹窗（不算失败）
            logger.info("parse empty post_parse mode=%s size=%s", mode, size)
            raise HTTPException(status_code=409, detail={
                "message": SCAN_POST_MESSAGE,
                "kind": "scanned_suspected",
                "stage": "post_parse",
                "scan_evidence": {"first_chars": len(stripped)},
            })
        raise HTTPException(status_code=502, detail={
            "message": "解析结果为空，该文件很可能是清晰度不足的拍照/扫描件。建议换文字版 PDF 或 Word 后再试。",
            "kind": "empty",
        })

    truncated = False
    if len(text) > MAX_PARSE_CHARS:
        text = text[:MAX_PARSE_CHARS]
        truncated = True
    if confirm_scanned:
        logger.info("parse scan confirmed mode=%s ocr=true size=%s", mode, size)
    return {
        "filename": filename,
        "text": text,
        "chars": len(text),
        "truncated": truncated,
        "mode": mode,
        "model": model,
        "is_ocr": is_ocr,
        "scan_warned": bool(confirm_scanned),
        "images_removed": images_removed,
    }
