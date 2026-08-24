"""管理后台服务入口（默认 :8001，仅内网访问）。"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal, bootstrap_lock, init_db
from app.routers import admin
from app.services.runtime_config import seed_config_from_env
from app.services.usage_code import apply_jwt_secret_override, ensure_bootstrap_admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NeoBangX admin backend starting on port %s...", settings.admin_port)
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
            admin_code = ensure_bootstrap_admin(db)
            if admin_code:
                logger.info(
                    "已自动创建初始管理员使用码，内容见数据目录下 bootstrap_admin.txt"
                )
        finally:
            db.close()
    if not Path(settings.admin_static_dir).exists():
        logger.warning(
            "管理后台静态目录不存在：%s —— 后台页面将不可用。容器部署请检查"
            " ADMIN_STATIC_DIR 是否被 .env 中的相对路径覆盖",
            Path(settings.admin_static_dir).resolve(),
        )
    yield
    logger.info("NeoBangX admin backend shutting down...")


app = FastAPI(
    title="NeoBangX Admin",
    description="NeoBangX 管理后台 API（内网访问，无需登录）",
    version="1.2.0",
    lifespan=lifespan,
)

# admin-frontend 由本应用同源静态托管，无需跨域；通配 CORS 会让内网浏览器里
# 的任意网页跨域读写零鉴权的管理 API，必须移除。

app.include_router(admin.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "admin", "version": "1.2.0"}


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
        "version": "1.2.0",
    }
