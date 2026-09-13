import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal, bootstrap_lock, init_db
from app.routers import auth, chat, parse, tools
from app.services.request_log import (
    STATUS_ERROR,
    current_retention_days,
    get_client_info,
    purge_expired_logs_standalone,
    record_usage_log,
)
from app.services.runtime_config import seed_config_from_env
from app.services.usage_code import apply_jwt_secret_override, ensure_bootstrap_code

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _log_retention_loop() -> None:
    """每日按 log_retention_days 清理过期使用日志（0 = 永久保留）。"""
    while True:
        await asyncio.sleep(24 * 3600)
        try:
            days = await asyncio.to_thread(_current_retention_days)
            if days > 0:
                deleted = await asyncio.to_thread(purge_expired_logs_standalone, days)
                if deleted:
                    logger.info("日志保留清理：已删除 %s 条超过 %s 天的日志", deleted, days)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("每日日志保留清理任务失败")


def _current_retention_days() -> int:
    db = SessionLocal()
    try:
        return current_retention_days(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NeoBangX backend starting...")
    init_db()
    apply_jwt_secret_override()  # 密钥仍为默认值时，加载管理后台一键轮换生成的密钥文件
    if settings.jwt_secret_is_default:
        logger.warning(
            "JWT 密钥仍为源码默认值，任何知道源码的人都能伪造登录票据！"
            "请在 backend/.env 设置 JWT_SECRET 并重启服务。"
        )
    # 双进程可能同时首启：用文件锁串行化引导，避免 seed 冲突 / 重复初始使用码
    with bootstrap_lock():
        db = SessionLocal()
        try:
            seed_config_from_env(db)
            bootstrap_code = ensure_bootstrap_code(db)
            if bootstrap_code:
                logger.info(
                    "已自动创建初始使用码（无限额度），内容见数据目录下 bootstrap_code.txt"
                )
        finally:
            db.close()

    # 日志保留策略：启动时清一次过期日志，并注册每日后台清理任务
    try:
        days = await asyncio.to_thread(_current_retention_days)
        if days > 0:
            deleted = await asyncio.to_thread(purge_expired_logs_standalone, days)
            if deleted:
                logger.info("日志保留清理：已删除 %s 条超过 %s 天的日志", deleted, days)
    except Exception:
        logger.exception("启动时执行日志保留清理失败")
    retention_task = asyncio.create_task(_log_retention_loop())

    logger.info(f"Prompts dir: {settings.prompts_dir.resolve()}")
    logger.info(f"Static dir: {settings.static_dir.resolve()}")
    logger.info(f"Data dir: {settings.data_dir.resolve()}")
    logger.info(f"Default model: {settings.default_model}")
    if not Path(settings.static_dir).exists():
        logger.warning(
            "主站静态目录不存在：%s —— 访问 / 将只返回提示 JSON，前端页面不可用。"
            "容器部署请检查 STATIC_DIR 是否被 .env 中的相对路径覆盖",
            Path(settings.static_dir).resolve(),
        )
    if not Path(settings.prompts_dir).exists():
        logger.warning(
            "Prompt 目录不存在：%s —— 所有工具将无法生成。"
            "容器部署请检查 PROMPTS_DIR 是否被 .env 中的相对路径覆盖",
            Path(settings.prompts_dir).resolve(),
        )
    yield
    retention_task.cancel()
    logger.info("NeoBangX backend shutting down...")


app = FastAPI(
    title="NeoBangX Backend",
    description="NeoBangX 后端 API（v1.2 智能错题迁移）",
    version="1.2.0",
    lifespan=lifespan,
)

# 前端由本应用同源静态托管，无需跨域；通配 CORS 只会放大 CSRF/DNS rebinding 风险

app.include_router(tools.router)
app.include_router(chat.router)
app.include_router(auth.router)
app.include_router(parse.router)


def _unhandled_usage_log_kwargs(request: Request, exc: Exception) -> dict | None:
    """把未捕获异常整理成一条使用日志的参数。

    只有路由已挂上业务上下文（见 chat.py `_mark_usage_context`）才返回参数，
    其余路径（健康检查、静态资源等）的崩溃不进使用日志，免得把日志灌脏。
    """
    meta = getattr(request.state, "usage_meta", None)
    if not isinstance(meta, dict) or not meta:
        return None
    code = meta.get("code")
    ip, user_agent = get_client_info(request)
    frames = traceback.extract_tb(exc.__traceback__) if exc.__traceback__ else []
    where = ""
    if frames:
        last = frames[-1]
        # 完整 traceback 已在 stdout；日志行里只留最有用的落点，避免 500 字被栈帧吃满
        where = f" @ {Path(last.filename).name}:{last.lineno} {last.name}"
    return {
        "code_id": code.id if code else 0,
        "code": code.code if code else chat.ANON_CODE_LABEL,
        "tool_id": str(meta.get("tool_id") or ""),
        "tool_name": str(meta.get("tool_name") or ""),
        "model": str(meta.get("model") or ""),
        "request_id": str(meta.get("request_id") or ""),
        "status": STATUS_ERROR,
        "error_message": f"未捕获异常 {type(exc).__name__}: {exc}{where}",
        "ip": ip,
        "user_agent": user_agent,
        "units": 0,
    }


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """兜底留痕：未捕获异常不再只留在 stdout。

    业务类 HTTPException（鉴权/额度/校验等预期内拒绝）有自己的处理器，不会走到这里；
    这里只处理真正的 500，并在 SSE 生成器还没来得及落库时补一条 error 日志，
    让「前端看到报错、后台一条记录都没有」不再发生。
    """
    logger.exception("Unhandled error: %s %s", request.method, request.url.path)
    if not getattr(request.state, "usage_logged", False):
        kwargs = _unhandled_usage_log_kwargs(request, exc)
        if kwargs is not None:
            try:
                await asyncio.to_thread(record_usage_log, **kwargs)
            except Exception:
                logger.exception("记录未捕获异常的使用日志失败")
    return JSONResponse({"detail": "服务器内部错误，请稍后重试"}, status_code=500)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.2.0"}


@app.get("/api/config")
async def get_config():
    """返回前端需要的配置信息（不返回 API Key）。"""
    from app.database import SessionLocal
    from app.services.runtime_config import resolve_llm_settings

    db = SessionLocal()
    try:
        llm_cfg = resolve_llm_settings(db)
    finally:
        db.close()

    available = llm_cfg.get("available_model_ids")
    # 禁用模型任何情况下都不回退暴露
    def _user_visible(models):
        return [m for m in models if m.get("enabled", True) and not m.get("chores_only")]

    if available:
        models = [m for m in llm_cfg["models"] if m["id"] in available]
        if not models:
            models = _user_visible(llm_cfg["models"])
    else:
        fallback = _user_visible(llm_cfg["models"])
        models = fallback if fallback else []
    return {
        "models": models,
        "default_model": llm_cfg["default_model"],
        "app_name": "NeoBangX",
        "version": "1.2.0",
        "slogan": "Bang助教学，大有可AI",
        "auth_required": True,
    }


static_path = Path(settings.static_dir)
if static_path.exists():
    app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.get("/")
async def root():
    index_path = static_path / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {
        "message": "NeoBangX backend is running. Visit /docs for API documentation.",
        "version": "1.2.0",
    }
