# 基础镜像钉死 digest（tag@sha256:…）。
# 缘故：`python:3.13-slim` 之类是可移动标签，BuildKit 的缓存键依赖「解析后的镜像 ID」，
# 所以每次构建都得先把 tag 解析成 digest——这步联网、不进本地缓存，既慢（实测 ~1.2s）
# 又会撞 Docker Hub 未登录的匿名拉取限流（429 Too Many Requests）。
# digest 不可变，命中本地内容库后完全离线，构建也稳定可复现。
# 升级基础镜像：`docker buildx imagetools inspect python:3.13-slim` 取新的 index digest 替换。
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

# 安装 UV 包管理器与 Supervisor。uv 同样钉死（当前 0.13.1），不再用每天都会变的 :latest。
COPY --from=ghcr.io/astral-sh/uv:0.13.1@sha256:4a1f3666816dafadd20ceb71eac9a7d56d7ef30279f7d64048519ab901ada336 /uv /bin/uv
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
# 为空 = 常规运行（不热重载）。开发模式由 docker-compose.dev.yml 覆盖成
# " --reload …"。supervisord 要求被引用的变量必须已定义，所以在这里给个默认值。
ENV UVICORN_RELOAD=""

# 启动 Supervisor 同时管理主站与管理后台
CMD ["supervisord", "-c", "/app/supervisord.conf"]
