"""管理后台服务入口（默认 :8001，仅内网访问）。"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal, init_db
from app.routers import admin
from app.services.runtime_config import seed_config_from_env
from app.services.usage_code import ensure_bootstrap_admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NeoBangX admin backend starting on port %s...", settings.admin_port)
    init_db()
    db = SessionLocal()
    try:
        seed_config_from_env(db)
        admin_code = ensure_bootstrap_admin(db)
        if admin_code:
            logger.warning(
                "已自动创建初始管理员使用码（请妥善保存）：%s",
                admin_code.code,
            )
    finally:
        db.close()
    yield
    logger.info("NeoBangX admin backend shutting down...")


app = FastAPI(
    title="NeoBangX Admin",
    description="NeoBangX 管理后台 API（内网访问，无需登录）",
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

app.include_router(admin.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "admin", "version": "1.1.0"}


admin_static = Path(settings.admin_static_dir)
if admin_static.exists():
    app.mount("/static", StaticFiles(directory=admin_static), name="admin-static")


@app.get("/")
async def root():
    index_path = admin_static / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {
        "message": "NeoBangX admin is running. Visit /docs for API documentation.",
        "version": "1.1.0",
    }
