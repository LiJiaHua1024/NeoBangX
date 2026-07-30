import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal, init_db
from app.routers import auth, chat, tools
from app.services.runtime_config import seed_config_from_env
from app.services.usage_code import ensure_bootstrap_admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NeoBangX backend starting...")
    init_db()
    db = SessionLocal()
    try:
        seed_config_from_env(db)
        admin = ensure_bootstrap_admin(db)
        if admin:
            logger.warning(
                "已自动创建初始管理员使用码（请妥善保存）：%s",
                admin.code,
            )
    finally:
        db.close()

    logger.info(f"Prompts dir: {settings.prompts_dir.resolve()}")
    logger.info(f"Static dir: {settings.static_dir.resolve()}")
    logger.info(f"Data dir: {settings.data_dir.resolve()}")
    logger.info(f"Default model: {settings.default_model}")
    yield
    logger.info("NeoBangX backend shutting down...")


app = FastAPI(
    title="NeoBangX Backend",
    description="NeoBangX 后端 API（v1.1 使用码系统）",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tools.router)
app.include_router(chat.router)
app.include_router(auth.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.1.0"}


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

    return {
        "models": llm_cfg["models"],
        "default_model": llm_cfg["default_model"],
        "app_name": "NeoBangX",
        "version": "1.1.0",
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
        "version": "1.1.0",
    }
