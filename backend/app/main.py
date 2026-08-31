import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal, bootstrap_lock, init_db
from app.routers import auth, chat, tools
from app.services.request_log import (
    current_retention_days,
    purge_expired_logs_standalone,
)
from app.services.runtime_config import seed_config_from_env
from app.services.usage_code import apply_jwt_secret_override, ensure_bootstrap_admin

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
    # 双进程可能同时首启：用文件锁串行化引导，避免 seed 冲突 / 重复管理员码
    with bootstrap_lock():
        db = SessionLocal()
        try:
            seed_config_from_env(db)
            admin = ensure_bootstrap_admin(db)
            if admin:
                logger.info(
                    "已自动创建初始管理员使用码，内容见数据目录下 bootstrap_admin.txt"
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
    if available:
        models = [m for m in llm_cfg["models"] if m["id"] in available]
        if not models:
            models = llm_cfg["models"]
    else:
        models = llm_cfg["models"]
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
