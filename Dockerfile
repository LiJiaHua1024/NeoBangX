# 基于 Python 3.13 官方镜像
FROM python:3.13-slim

# 安装 UV 包管理器与 Supervisor
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends supervisor \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制项目文件
# 注意：不 COPY backend/.env——密钥经 docker-compose 的 env_file 在运行时注入，
# 烘焙进镜像层会随镜像分发泄露（push 到 Registry 即可被有拉取权的人提取）。
COPY backend/pyproject.toml /app/pyproject.toml
COPY backend/uv.lock /app/uv.lock
COPY backend/app /app/app
COPY prompts /app/prompts
COPY frontend /app/frontend
COPY admin-frontend /app/admin-frontend
COPY supervisord.conf /app/supervisord.conf

# 使用 UV 安装依赖
RUN uv sync --no-dev

# 暴露主站与管理后台端口
EXPOSE 8000 8001

# 设置容器内路径（覆盖 .env 中的相对路径）
ENV PROMPTS_DIR=/app/prompts
ENV STATIC_DIR=/app/frontend
ENV ADMIN_STATIC_DIR=/app/admin-frontend

# 启动 Supervisor 同时管理主站与管理后台
CMD ["supervisord", "-c", "/app/supervisord.conf"]
