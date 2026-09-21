"""假后端入口：FastAPI app + 命令行参数。

启动::

    cd backend
    uv run python -m mock_backend.main                     # 127.0.0.1:8000
    uv run python -m mock_backend.main --port 8002 --mirror-origin http://localhost:8000
    uv run python -m mock_backend.main --scenario slow --quota 5

可用 ``python -m mock_backend.main --help`` 看全部参数。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from mock_backend import catalog, paper as paper_mod, panel, upstream
from mock_backend.engine import StreamStats, sse_frame, stats_summary, stream_frames
from mock_backend.scenarios import SCENARIOS, resolve_plan
from mock_backend.state import STATE

logger = logging.getLogger("mock_backend")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC_DIR = REPO_ROOT / "frontend"

# 进程级默认值：由 main() 按命令行参数写入，控制面与场景解析都读它
DEFAULT_SCENARIO = "happy"
DEFAULT_PDF_MODE = "ok"

# 进行中的 SSE 流：request_id -> stop event（真实后端同样是进程内协调）
_STREAMS: dict[str, asyncio.Event] = {}


# ---------------------------------------------------------------- 请求模型


class ChatBody(BaseModel):
    """与 app/routers/chat.py 的 ChatRequest 同构（字段名即契约）。"""

    tool_id: str = Field(..., max_length=64)
    input: str = Field(..., min_length=1, max_length=50000)
    model: str | None = Field(None, max_length=128)
    request_id: str | None = Field(None, max_length=128)
    batch_id: str | None = Field(None, max_length=128)
    batch_size: int | None = Field(None, ge=1)
    batch_index: int | None = Field(None, ge=0)
    transfer_count: int | None = Field(None, ge=1, le=5)
    continue_from: str | None = Field(None, max_length=200000)


class MigrationAnalyzeBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=5000)
    standard_answer: str = ""
    student_answers: str = ""
    error_cause: str = ""
    feedback_history: list[str] = Field(default_factory=list)
    analysis_history: list[dict] = Field(default_factory=list)
    continue_generation: bool = False
    model: str | None = None


class StopBody(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=160)


class QuotaBody(BaseModel):
    cause_count: int = Field(..., ge=1)


# ---------------------------------------------------------------- 工具函数


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    parts = header.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return ""


def _fingerprint(request: Request) -> str:
    return request.headers.get("x-client-fingerprint") or ""


def _model_entry(model_id: str) -> dict | None:
    for m in catalog.MODELS:
        if m["id"] == model_id:
            return m
    return None


def _make_token(code: str) -> str:
    """假 JWT：前端只负责存储与回传，不解析内容。"""
    payload = base64.urlsafe_b64encode(
        json.dumps({"code": code, "iat": int(time.time())}, ensure_ascii=False).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"{payload}.mock-signature"


def _plan_for(request: Request, *, input_text: str = "", model: str = "") -> tuple[Any, list[str], str]:
    """按优先级解析场景；粘性场景只在真的取到时消耗一次。"""
    sticky = STATE.take_sticky()
    return resolve_plan(
        input_text=input_text,
        header=request.headers.get("x-mock-scenario") or "",
        query=request.query_params.get("mock") or "",
        model=model,
        default_scenario=DEFAULT_SCENARIO,
        sticky=sticky,
    )


def _auth_gate(request: Request, model_id: str) -> None:
    """复刻真实后端的门禁。

    - 带 token：付费模型才校验使用码额度；免费模型在免费额度内不扣次数，
      使用码耗尽也照样放行（与 app/routers/chat.py 的语义一致）；
    - 无 token：仅「免费 + 免码」模型放行，其余 401。
    """
    entry = _model_entry(model_id)
    free = bool(entry and entry.get("is_free"))
    if _bearer(request):
        if not free and STATE.quota is not None and max(0, STATE.quota - STATE.used) <= 0:
            raise HTTPException(status_code=403, detail="额度已用尽")
        return
    if free and entry and entry.get("free_no_code"):
        return
    raise HTTPException(status_code=401, detail="请先输入使用码")


def _note(rec: Any, **kwargs: Any) -> None:
    STATE.annotate(rec, **kwargs)


# ---------------------------------------------------------------- app 工厂


def create_app(
    *,
    static_dir: Path | None = None,
    default_scenario: str = "happy",
    upstream_enabled: bool = True,
) -> FastAPI:
    static_dir = Path(static_dir) if static_dir else DEFAULT_STATIC_DIR

    app = FastAPI(title="NeoBangX Mock Backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )

    @app.middleware("http")
    async def no_store(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.startswith("/static/") or path.startswith("/__mock__"):
            response.headers["Cache-Control"] = "no-store, must-revalidate"
        return response

    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # ---- 页面 ----
    @app.get("/")
    async def index() -> Any:
        index_path = static_dir / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return {"message": "NeoBangX mock backend", "static_dir": str(static_dir)}

    # ---- 基础 ----
    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok", "version": "1.2.0", "mock": True}

    @app.get("/api/config")
    async def config() -> dict:
        return {
            "models": [dict(m) for m in catalog.MODELS],
            "default_model": catalog.DEFAULT_MODEL,
            "app_name": catalog.APP_NAME,
            "version": catalog.APP_VERSION,
            "slogan": catalog.SLOGAN,
            "auth_required": True,
            "mirror": {"enabled": STATE.mirror_enabled, "origins": list(STATE.mirror_origins)},
        }

    @app.get("/api/tools/")
    async def tools() -> dict:
        return catalog.tools_payload()

    @app.get("/api/tools/models")
    async def tool_models() -> dict:
        return catalog.models_payload()

    # ---- 认证 ----
    @app.post("/api/auth/activate")
    async def activate(request: Request) -> dict:
        body = await _json_body(request)
        code = str(body.get("code") or "").strip()
        if not code:
            raise HTTPException(status_code=400, detail="请输入使用码")
        upper = code.upper()
        if "EMPTY" in upper or "EXHAUST" in upper:
            STATE.quota = 0
            STATE.used = 0
        elif "UNLIMITED" in upper or "INFINITE" in upper:
            STATE.quota = None
        return {"token": _make_token(code), "user": STATE.user_payload(code)}

    @app.get("/api/auth/me")
    async def me(request: Request) -> dict:
        if not _bearer(request):
            raise HTTPException(status_code=401, detail="请先输入使用码")
        return {"user": STATE.user_payload("MOCK-CODE")}

    # ---- PDF 解析 ----
    @app.get("/api/parse/config")
    async def parse_config() -> dict:
        return {
            "pdf_enabled": True,
            "mode": "precision",
            "model": "pipeline",
            "needs_token": False,
            "limits": {"precision_mb": 200, "agent_mb": 10, "current_mb": 200},
        }

    @app.post("/api/parse/file")
    async def parse_file(request: Request, file: UploadFile) -> Any:
        plan, _, _ = _plan_for(request)
        # 没被场景覆盖时用命令行 --pdf-mode 指定的分支
        mode = str(plan.pdf_mode or DEFAULT_PDF_MODE)
        if plan.pdf_mode == "ok" and DEFAULT_PDF_MODE != "ok":
            mode = DEFAULT_PDF_MODE
        filename = (file.filename or "document.pdf").strip()
        content = await file.read()
        size = len(content or b"")
        lower = filename.lower()
        rec = STATE.record(
            ts=time.time(), method="POST", path="/api/parse/file",
            authorization=bool(_bearer(request)), fingerprint=_fingerprint(request),
            scenario=plan.scenario, body={"filename": filename, "size": size},
        )

        # 文件名关键字优先：上传 scanned.pdf / large.pdf / corrupt.pdf 即触发对应分支
        if "scanned" in lower or mode == "scanned-pre":
            _note(rec, status=409, summary="scanned pre_check")
            raise HTTPException(status_code=409, detail={
                "message": "该 PDF 很有可能是拍照或扫描版，建议先确认。",
                "kind": "scanned_suspected", "stage": "pre_check",
                "scan_evidence": {"images": 1, "text_chars": 12},
            })
        if "large" in lower or size > 10 * 1024 * 1024 or mode == "too-large":
            _note(rec, status=413, summary="too_large")
            raise HTTPException(status_code=413, detail={
                "message": "文件超过 10MB（当前 12.0MB）。精准模式上限200MB，轻量模式上限10MB。",
                "kind": "too_large",
            })
        if "corrupt" in lower or size == 0 or mode == "corrupt":
            _note(rec, status=422, summary="corrupt")
            raise HTTPException(status_code=422, detail={
                "message": "文件无法读取，可能已损坏、被加密或为空。请重新导出一次 PDF 后再试。",
                "kind": "corrupt",
            })
        if mode == "no-token":
            _note(rec, status=503, summary="token_missing")
            raise HTTPException(status_code=503, detail={
                "message": "PDF 解析尚未配置（缺少 MinerU Token）。请联系管理员在管理后台 → 文档解析中填写。",
                "kind": "token_missing",
            })
        if "empty" in lower or mode == "empty":
            _note(rec, status=409, summary="scanned post_parse")
            raise HTTPException(status_code=409, detail={
                "message": "首次解析结果为空，更可能是扫描件。",
                "kind": "scanned_suspected", "stage": "post_parse",
                "scan_evidence": {"first_chars": 0},
            })

        text = paper_mod.SAMPLE_EXAM_TEXT
        truncated = False
        if mode == "truncated" or "truncated" in lower:
            text = text[:100]
            truncated = True
        _note(rec, status=200, summary=f"ok chars={len(text)}")
        return {
            "filename": filename,
            "text": text,
            "chars": len(text),
            "truncated": truncated,
            "mode": "precision",
            "model": "pipeline",
            "is_ocr": False,
            "scan_warned": False,
            "images_removed": 0,
        }

    # ---- 词汇 ----
    @app.post("/api/chat/vocab/check")
    async def vocab_check(request: Request) -> Any:
        from app.services.vocab_check import check_over_words

        body = await _json_body(request)
        text = str(body.get("text") or "")
        if not text.strip():
            raise HTTPException(status_code=422, detail="text 不能为空")
        result = check_over_words(text)
        STATE.record(
            ts=time.time(), method="POST", path="/api/chat/vocab/check",
            authorization=bool(_bearer(request)), fingerprint=_fingerprint(request),
            scenario="vocab", body={"chars": len(text)},
            summary=f"total={result.get('total_words')} over={len(result.get('over_words') or [])}",
        )
        return result

    # ---- 迁移 ----
    @app.post("/api/chat/migration/quota")
    async def migration_quota(request: Request) -> Any:
        body = await _json_body(request)
        count = int(body.get("cause_count") or 1)
        required = max(1, count // 2)
        remaining = None if STATE.quota is None else max(0, STATE.quota - STATE.used)
        if remaining is not None and remaining < required:
            raise HTTPException(status_code=403, detail={
                "message": "额度不足，无法生成本次智能错题迁移",
                "required": required, "remaining": remaining,
            })
        return {
            "can_generate": True, "required": required,
            "remaining": remaining, "cause_count": count,
        }

    @app.post("/api/chat/migration/analyze")
    async def migration_analyze(request: Request) -> Any:
        from app.services.migration import parse_error_causes

        body = MigrationAnalyzeBody(**(await _json_body(request)))
        plan, _, _ = _plan_for(request, input_text=body.question)
        _auth_gate(request, body.model or catalog.DEFAULT_MODEL)
        count = plan.more_cause_count if body.continue_generation else plan.cause_count
        raw = json.dumps([f"错因 {i + 1}：{_cause_label(i)}" for i in range(count)], ensure_ascii=False)
        causes = parse_error_causes(raw)
        history = [dict(m) for m in body.analysis_history if isinstance(m, dict)]
        if not history:
            history = [{"role": "user", "content": body.question}]
        history.append({"role": "assistant", "content": raw})
        STATE.record(
            ts=time.time(), method="POST", path="/api/chat/migration/analyze",
            authorization=bool(_bearer(request)), fingerprint=_fingerprint(request),
            scenario=plan.scenario,
            body={"continue": body.continue_generation, "history": len(body.analysis_history)},
            summary=f"causes={len(causes)}",
        )
        return {
            "causes": [{"id": f"cause_{i}", "label": c} for i, c in enumerate(causes)],
            "analysis_history": history,
        }

    # ---- 预览 / 标题 ----
    @app.post("/api/chat/preview")
    async def preview(request: Request) -> Any:
        body = await _json_body(request)
        tool_id = str(body.get("tool_id") or "")
        filename = catalog.PROMPT_FILENAMES.get(tool_id, "")
        if not filename:
            raise HTTPException(status_code=404, detail=f"Tool {tool_id} not found")
        input_text = str(body.get("input") or "")
        prompt = f"【假后端】工具 {tool_id}（{filename}.md）的提示词未加载，这里返回原始输入：\n\n{input_text}"
        messages = None
        if body.get("continue_from"):
            messages = [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": str(body.get("continue_from") or "")},
                {"role": "user", "content": "【假后端】续写指令（真实后端读 prompts/继续生成.md）"},
            ]
        return {"tool_id": tool_id, "prompt_filename": filename + ".md", "prompt": prompt, "messages": messages}

    @app.post("/api/chat/title")
    async def title(request: Request) -> Any:
        if not _bearer(request):
            raise HTTPException(status_code=401, detail="请先输入使用码")
        body = await _json_body(request)
        text = str(body.get("input") or "").strip()
        head = text.replace("\n", " ")[:15] or "未命名"
        return {"title": head}

    # ---- 流式生成 ----
    @app.post("/api/chat/stream")
    async def chat_stream(request: Request, body: ChatBody) -> Any:
        tool = catalog.find_tool(body.tool_id)
        if not tool:
            raise HTTPException(status_code=404, detail=f"Tool {body.tool_id} not found")
        if body.tool_id == catalog.MIGRATION_TOOL and not (
            body.batch_id and body.batch_size is not None and body.batch_index is not None
        ):
            raise HTTPException(status_code=400, detail="智能错题迁移必须通过批次请求生成")

        plan, warnings, stripped_input = _plan_for(request, input_text=body.input, model=body.model or "")
        req = body.model_dump()
        req["tool_name"] = tool["name"]

        rec = STATE.record(
            ts=time.time(), method="POST", path="/api/chat/stream",
            authorization=bool(_bearer(request)), fingerprint=_fingerprint(request),
            scenario=plan.scenario, body={k: v for k, v in req.items() if k != "continue_from"} | {
                "continue_from 长度": len(body.continue_from or ""),
                "input 长度": len(body.input or ""),
            },
        )
        for warning in warnings:
            logger.warning("[mock] %s", warning)

        if plan.http_status:
            detail = plan.http_detail or f"假后端场景 {plan.scenario}"
            _note(rec, status=int(plan.http_status), summary=f"HTTP {plan.http_status}")
            raise HTTPException(status_code=int(plan.http_status), detail=detail)

        _auth_gate(request, body.model or catalog.DEFAULT_MODEL)
        model_id = body.model or catalog.DEFAULT_MODEL
        entry = _model_entry(model_id) or {}
        free = bool(entry.get("is_free"))
        if not free:
            STATE.consume(1)

        request_id = body.request_id or f"{body.tool_id}_{int(time.time() * 1000)}"
        stop_event = asyncio.Event()
        _STREAMS[request_id] = stop_event
        stats = StreamStats()

        async def frames() -> Any:
            try:
                async for event, data in stream_frames(
                    plan=plan,
                    req=req,
                    input_text=stripped_input,
                    tool_id=body.tool_id,
                    stop_event=stop_event,
                    stats=stats,
                    is_disconnected=request.is_disconnected,
                ):
                    yield sse_frame(event, data)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[mock] 流生成失败")
                yield sse_frame("error", json.dumps(
                    {"message": "生成失败，请稍后重试", "model": model_id}, ensure_ascii=False))
            finally:
                _STREAMS.pop(request_id, None)
                _note(rec, summary=stats_summary(stats))

        return StreamingResponse(frames(), media_type="text/event-stream")

    @app.post("/api/chat/stop")
    async def stop(body: StopBody) -> dict:
        event = _STREAMS.get(body.request_id)
        if event is not None:
            event.set()
            return {"status": "stopped", "request_id": body.request_id}
        return {"status": "not_found", "request_id": body.request_id}

    # ---- 控制面 ----
    if upstream_enabled:
        upstream.add_upstream_routes(app)
    panel.add_control_routes(app, default_scenario=default_scenario, upstream_enabled=upstream_enabled)

    return app


def _cause_label(index: int) -> str:
    labels = [
        "细节定位失当，被原词重现的干扰项牵着走",
        "主旨概括以偏概全，把局部细节当全文观点",
        "推理过度，把或然当必然",
        "忽视题干限定词，答非所问",
        "词汇障碍导致语篇衔接断裂",
        "缺乏结构意识，找不到论证模板",
    ]
    return labels[index % len(labels)]


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


# ---------------------------------------------------------------- CLI


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m mock_backend.main",
        description="NeoBangX 测试用假后端：托管前端 + 打桩主站 API + SSE 场景引擎 + 假 LLM 上游",
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1（不对外暴露）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口，默认 8000")
    parser.add_argument("--static-dir", default="", help="前端目录，默认仓库根下的 frontend/")
    parser.add_argument("--scenario", default="happy", help=f"默认场景，可选：{', '.join(sorted(SCENARIOS))}")
    parser.add_argument("--quota", default="", help="假额度次数；留空或 unlimited = 无限")
    parser.add_argument("--mirror-origin", action="append", default=[], help="线路镜像对端 origin，可重复；给了即开启镜像")
    parser.add_argument("--no-upstream", action="store_true", help="不暴露 /v1/* 假 LLM 上游")
    parser.add_argument("--pdf-mode", default="ok", help="/api/parse/file 默认分支：ok/scanned-pre/too-large/corrupt/no-token/empty/truncated")
    parser.add_argument("--verbose", action="store_true", help="打印每个请求的详情")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    global DEFAULT_SCENARIO, DEFAULT_PDF_MODE
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    DEFAULT_SCENARIO = args.scenario
    DEFAULT_PDF_MODE = args.pdf_mode
    static_dir = Path(args.static_dir) if args.static_dir else DEFAULT_STATIC_DIR
    if not static_dir.exists():
        logger.warning("前端目录不存在：%s —— 访问 / 只会返回 JSON", static_dir)

    if args.quota:
        STATE.quota = None if args.quota.strip().lower() in ("unlimited", "-1") else int(args.quota)
    if args.mirror_origin:
        STATE.mirror_enabled = True
        STATE.mirror_origins = [o.strip() for o in args.mirror_origin if o.strip()]

    app = create_app(
        static_dir=static_dir,
        default_scenario=args.scenario,
        upstream_enabled=not args.no_upstream,
    )
    logger.info(
        "假后端启动：http://%s:%s  (frontend=%s, 默认场景=%s, 假上游=%s, 额度=%s)",
        args.host, args.port, static_dir, args.scenario,
        "关" if args.no_upstream else "开",
        "无限" if STATE.quota is None else STATE.quota,
    )
    if STATE.mirror_origins:
        logger.info("线路镜像已开启，对端：%s", ", ".join(STATE.mirror_origins))
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main(sys.argv[1:])
