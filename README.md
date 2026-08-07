# NeoBangX

NeoBangX —— 面向中学英语教师的 AI 辅助教学平台。

> 版本：v1.2
> 核心变更：引入使用码系统、管理后台、后端 SQLite 数据存储与智能错题迁移。

---

## 1. 功能概览

- **26 个中学英语教学 AI 工具**：新增独家功能“智能错题迁移”，覆盖语篇分析、教学设计、命题辅助、作文批改、试卷讲评等。
- **使用码系统**：使用码即登录凭据，无需注册；无码不可用，按次计费，用完锁定。
- **管理后台**：内网访问，生成/管理使用码、查看使用日志、配置 LLM API。
- **流式生成**：SSE 打字机效果，生成过程可中止。
- **历史 / 收藏**：存于浏览器 localStorage。
- **多主题切换**：毛玻璃 / 科技感视觉风格。

---

## 2. 技术栈

| 层 | 选型 |
| --- | --- |
| 后端框架 | FastAPI |
| Python | 3.13 |
| 包管理 | UV |
| LLM 统一层 | LiteLLM |
| 数据库 | SQLite |
| 前端 JS | Alpine.js |
| 前端 CSS | Tailwind CSS v4（浏览器端编译） |
| 容器 | Docker + Supervisor |

---

## 3. 项目目录结构

```
/NeoBangX
├── backend/
│   ├── app/
│   │   ├── main.py              # 主站服务入口（:8000）
│   │   ├── admin_main.py        # 管理后台服务入口（:8001）
│   │   ├── config.py            # pydantic-settings 配置
│   │   ├── database.py          # SQLite 连接
│   │   ├── models.py            # SQLAlchemy 数据模型
│   │   ├── deps.py              # 认证依赖
│   │   ├── routers/
│   │   │   ├── tools.py         # 工具元数据 API
│   │   │   ├── chat.py          # 流式调用 + 标题生成
│   │   │   ├── auth.py          # 使用码激活 / 状态
│   │   │   └── admin.py         # 管理后台 API
│   │   └── services/
│   │       ├── llm.py           # LiteLLM 调用
│   │       ├── migration.py     # 智能错题迁移规则与错因解析
│   │       ├── prompt_loader.py # Prompt 加载
│   │       ├── usage_code.py    # 使用码生成/校验/扣次
│   │       └── runtime_config.py# 运行时配置管理
│   ├── data/                    # SQLite 数据目录（运行时创建）
│   ├── pyproject.toml
│   └── .env.example
├── frontend/                    # 主站前端（Alpine.js + Tailwind v4，纯静态）
├── admin-frontend/              # 管理后台前端
├── prompts/                     # 26 个工具 Prompt 文件
├── Dockerfile
├── docker-compose.yml
├── supervisord.conf             # Docker 内双进程管理
├── README.md
└── docs/
    └── API_CONTRACT.md           # 前后端 API 契约
```

---

## 4. 本地开发

### 4.1 环境准备

- 安装 Python 3.13
- 安装 UV：[https://docs.astral.sh/uv/](https://docs.astral.sh/uv/)
- 准备 LLM API Key（推荐 OpenRouter：[https://openrouter.ai/keys](https://openrouter.ai/keys)）

### 4.2 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`，填入 `OPENROUTER_API_KEY` 或 `LLM_API_KEY` 等。

> 该文件为**唯一**配置入口，本地开发与 Docker 部署共用同一份（见 [5. Docker 部署](#5-docker-部署)）。

### 4.3 安装依赖并启动

```bash
cd backend
uv sync

# 启动主站（端口 8000）
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 另开一个终端启动管理后台（端口 8001）
uv run uvicorn app.admin_main:app --host 0.0.0.0 --port 8001 --reload
```

### 4.4 访问服务

- 主站：http://localhost:8000/
- 主站 API 文档：http://localhost:8000/docs
- 管理后台：http://localhost:8001/
- 管理后台 API 文档：http://localhost:8001/docs

### 4.5 初始管理员使用码

首次启动时，如果数据库中没有任何使用码，后端会自动创建一个 **管理员使用码（NBXA-...，无限额度）**，并打印到日志中。请妥善保存，使用该码即可登录管理后台生成更多使用码。

---

## 5. Docker 部署

### 5.1 构建并运行

配置统一使用 `backend/.env`（与本地开发共用）：

```bash
# 1. 首次部署：生成配置文件并填入 API Key
cd backend
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY / CHORES_API_KEY 等

# 2. 构建并启动（在项目根目录执行）
cd ..
docker-compose up --build -d
```

### 5.2 更新部署

```bash
git pull
docker-compose up --build -d
```

> 注意：Docker 构建时会将 `backend/.env` 写入镜像，因此**修改 `.env` 后需重新构建**（`--build`）才生效。管理后台中修改的配置（模型、API Key 等）存储在 SQLite 数据卷中，重建容器不会丢失。

### 5.3 端口说明

| 端口 | 用途 | 公网暴露 |
|------|------|----------|
| 8000 | 主站服务 + 前端 | 通过 FRP/Nginx 暴露 |
| 8001 | 管理后台 | **仅内网访问，不映射到公网** |

### 5.4 访问服务

- 主站：http://localhost:8000/
- 管理后台：http://localhost:8001/

### 5.5 停止服务

```bash
docker-compose down
```

---

## 6. 配置项说明

配置统一由 `backend/.env` 提供（本地开发与 Docker 部署共用）。读取优先级：环境变量 > `.env` 文件 > 默认值；Docker 部署时无额外环境变量注入，直接读取构建进镜像的 `backend/.env`。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `APP_HOST` | `0.0.0.0` | 主站监听地址 |
| `APP_PORT` | `8000` | 主站监听端口 |
| `ADMIN_HOST` | `0.0.0.0` | 管理后台监听地址 |
| `ADMIN_PORT` | `8001` | 管理后台监听端口 |
| `PROMPTS_DIR` | `../prompts` | Prompt 文件目录 |
| `STATIC_DIR` | `../frontend` | 主站静态文件目录 |
| `ADMIN_STATIC_DIR` | `../admin-frontend` | 管理后台静态文件目录 |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `JWT_SECRET` | `neobangx-dev-secret-change-me` | JWT 密钥（生产务必修改） |
| `JWT_EXPIRE_DAYS` | `365` | JWT 有效期 |
| `OPENROUTER_API_KEY` | 空 | 兼容旧版的 OpenRouter API Key |
| `DEFAULT_MODEL` | `openrouter/google/gemini-2.0-flash` | 默认模型 |
| `MODELS` | `openrouter/google/gemini-2.0-flash` | 可用模型列表，逗号分隔 |
| `LLM_API_KEY` | 空 | 主 AI API Key（优先级高于 OPENROUTER_API_KEY） |
| `LLM_BASE_URL` | 空 | 主 AI Base URL |
| `LLM_MODEL` | 空 | 主 AI 模型（留空则使用 DEFAULT_MODEL） |
| `CHORES_API_KEY` | 空 | Chores AI API Key（标题生成等轻量任务） |
| `CHORES_BASE_URL` | 空 | Chores AI Base URL |
| `CHORES_MODEL` | 空 | Chores AI 模型（留空则回退主 AI） |
| `MAX_TOKENS` | `4096` | 最大输出 token 数 |
| `TIMEOUT` | `120` | LLM 调用超时时间（秒） |
| `SSE_RETRY_TIMEOUT` | `30000` | SSE 客户端重连时间（毫秒） |

---

## 7. 使用码系统

### 7.1 使用码类型

| 类型前缀 | 说明 | 额度 |
|----------|------|------|
| `NBXA` | 管理员码 | 无限额度 |
| `NBXU` | 普通用户码 | 1/3/5/10/50/100 次等 |

### 7.2 使用码格式

示例：

```
NBXU-3XXX-XXXX-XXXX
```

### 7.3 计量规则

- 每次工具生成扣减 1 次额度。
- 管理员码不计额度，但仍记录使用日志。
- 额度用完后直接锁定，无法继续使用。

### 7.4 使用流程

1. 管理后台生成使用码。
2. 用户在主站首页或左下角输入使用码并验证。
3. 使用码信息保存于浏览器，后续自动携带。
4. 额度用完时提示重新获取使用码。

---

## 8. API 契约

完整接口文档见 `docs/API_CONTRACT.md`。

核心接口：

- `POST /api/auth/activate` — 验证使用码，返回 JWT
- `GET /api/auth/me` — 当前使用码状态
- `GET /api/tools/` — 工具元数据 + 模型列表
- `POST /api/chat/migration/analyze` — 非流式错因分析（不扣费）
- `POST /api/chat/migration/quota` — 最终生成额度预检查（不扣费）
- `POST /api/chat/stream` — 流式调用（需 Authorization）
- `POST /api/chat/stop` — 中止生成
- `POST /api/chat/title` — 生成历史标题
- `GET /api/admin/stats` — 管理后台统计
- `GET /api/admin/codes` — 使用码列表
- `POST /api/admin/codes` — 生成使用码
- `PATCH /api/admin/codes/{id}` — 启用/禁用/修改额度
- `GET /api/admin/logs` — 使用日志
- `GET /api/admin/config` — 查看配置
- `PUT /api/admin/config` — 更新配置

---

## 9. 数据存储

| 数据 | 存储位置 |
|------|----------|
| 使用码信息 | 后端 SQLite |
| 使用日志 | 后端 SQLite |
| LLM / API 配置 | 后端 SQLite（管理后台维护） |
| 历史记录 | 浏览器 localStorage |
| 收藏 | 浏览器 localStorage |
| 主题 | 浏览器 localStorage |

---

## 10. 下一步 Prompt 补全清单

以下 **14 个工具** 的 Prompt 需要后续人工补全或打磨。其中 9 个为后端生成的简单初版，5 个为基于原始指令的部分覆盖版本。

### 9 个完全无原始 Prompt 的工具

| 工具 ID | 工具名称 | 当前 Prompt 状态 | 应实现的功能描述 | Prompt 文件路径 |
|---------|----------|----------------|------------------|----------------|
| 2 | 言说策略分析 | 简单初版 | 输入语篇，识别并分析“怎么说”的策略：修辞手法、语气变化、衔接与过渡、逻辑推进、情态/态度标记，输出分项策略清单及对阅读与写作教学的启示 | `prompts/言说策略分析.md` |
| 8 | 语法情境教学 | 简单初版 | 输入目标语法点 + 学段，输出情境化教学方案：真实语境例句、交际任务、典型错误预测、形成性练习与评价标准 | `prompts/语法情境教学.md` |
| 9 | 英文写作教学 | 简单初版 | 覆盖记叙/议论/概要等通用文体；输入文体 + 学段，输出结构支架、过程性范文、升格路径、常见问题清单 | `prompts/英文写作教学.md` |
| 10 | 学生作文批改 | 简单初版 | 输入学生作文，输出 5 维度评分、逐段点评、错误归类表、升格版 | `prompts/学生作文批改.md` |
| 12 | 试卷重点题讲评 | 简单初版 | 输入错题或重题，输出错因诊断、解题范式拆解、变式训练题、迁移应用题 | `prompts/试卷重点题讲评.md` |
| 13 | 试卷可视化全解 | 简单初版 | 输入整卷，输出课堂投影版结构化解析：题干与答案可分步显示、分题型分组、答案可隐藏 | `prompts/试卷可视化全解.md` |
| 21 | 辅助完形填空命题 | 简单初版 | 输入语篇（280-320 词），输出设空方案、4 选 1 选项、答案、解析、考点标签 | `prompts/辅助完形填空命题.md` |
| 22 | 试题解读分析 | 简单初版 | 输入单题或整卷，输出选材立意、能力考查维度、教学反拨启示、课标对标分析 | `prompts/试题解读分析.md` |
| 23 | 英语试题 Bug 侦察 | 简单初版 | 输入试题文本，输出 bug 清单：拼写/标点/中式英语/语法错误/逻辑漏洞/题干歧义/文化不当，逐条标注位置 + 改写建议 | `prompts/英语试题 Bug 侦察.md` |

### 5 个部分覆盖原始 Prompt 的工具

| 工具 ID | 工具名称 | 当前 Prompt 状态 | 应实现的功能描述 | Prompt 文件路径 |
|---------|----------|----------------|------------------|----------------|
| 4 | 课文语言点讲解 | 部分覆盖 | 基于语篇结构化知识讲解语言点（词汇、语法、句法、文化背景等） | `prompts/课文语言点讲解.md` |
| 6 | 词汇分类教学 | 部分覆盖 | 词汇分类 + 功能化教学材料 | `prompts/词汇分类教学.md` |
| 7 | 词块提取与讲解 | 部分覆盖 | 高价值词块提取 + 讲解 + 操练活动 | `prompts/词块提取与讲解.md` |
| 20 | 阅读理解设问 2 | 部分覆盖 | 阅读理解设问的另一变体，与“阅读理解设问 1”形成互补 | `prompts/阅读理解设问 2.md` |
| 25 | 自由对话 | 部分覆盖 | 通用 LLM 对话入口，提示词调试 | `prompts/自由对话.md` |

---

## 11. 注意事项

1. **安全**：生产环境务必修改 `JWT_SECRET`；管理后台 8001 仅内网访问，不映射到公网。
2. **密钥**：妥善保管 `backend/.env` 中的 API Key，不要提交到 Git。该文件会被构建进 Docker 镜像，请注意镜像的访问权限。
3. **使用码**：首次启动后，立即从日志中复制初始管理员码，登录管理后台生成更多用户码。
4. **Prompt**：当前 Prompt 文件为占位版本，后续需人工补全 14 个待补工具。
5. **历史/收藏**：清理浏览器数据会丢失历史记录与收藏。

---

## 12. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-07-24 | 阶段一：后端 API + 25 工具 Prompt + demo 前端 |
| 1.1.0 | 2026-07-28 | 阶段一补充：使用码系统、管理后台、后端 SQLite、双端口部署 |
| 1.2.0 | 2026-08-07 | 新增独家功能“智能错题迁移”：错因确认、并行迁移卡片、批量操作与分阶段计费 |
