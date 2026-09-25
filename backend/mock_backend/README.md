# NeoBangX 假后端（测试专用）

**只用于测试，不属于生产代码。** Dockerfile 只 `COPY backend/app`，这个目录不会进镜像。

> 两份文档分工不同：
> - **本文件**写给人——完整场景表、控制台、镜像双线路、浏览器人工验收清单、已知差异、维护约定；
> - [docs/MOCK_BACKEND_TESTING.md](../../docs/MOCK_BACKEND_TESTING.md) 写给自动化测试的 Agent——起服务 → 设场景 → 驱动页面 → 断言 → 复位的操作闭环和常用配方。

它解决一个问题：前端改动要在浏览器里验证，但被测路径（比如"生成到一半中断"）逼着你真调一次 LLM——既烧钱又慢。假后端把 LLM 整条链路换成本地可控的桩，浏览器直连它就能测前端，**不需要真实后端、不需要 SQLite、不需要任何 API Key**。

同一个进程还兼任第二个角色：**OpenAI 兼容的假 LLM 上游**，真实后端的 provider 可以指向它，从而零成本走完整真实链路（多通道 fallback、首块超时、计费扣次、使用日志）。

---

## 1. 快速开始

```bash
cd backend
uv run python -m mock_backend.main
# → http://127.0.0.1:8000/  就是完整可点的前端
```

控制台（切场景、看请求日志、改额度）：

```bash
# 浏览器打开
http://127.0.0.1:8000/__mock__/
```

常用参数（`--help` 看全部）：

| 参数 | 作用 |
| --- | --- |
| `--port 8002` | 换端口。真实后端正占着 8000 时用它 |
| `--scenario slow` | 改默认场景 |
| `--quota 5` | 假额度 5 次；留空或 `unlimited` = 无限 |
| `--mirror-origin http://localhost:8000` | 开启线路镜像并把对端指向别处，可重复 |
| `--pdf-mode no-token` | `/api/parse/file` 的默认分支 |
| `--no-upstream` | 不暴露 `/v1/*` 假上游 |
| `--static-dir DIR` | 换前端目录（默认仓库根下 `frontend/`） |

默认只监听 `127.0.0.1`，不会暴露到局域网。

---

## 2. 场景：怎么让假后端演一次"故障"

按优先级从高到低，共五种触发方式：

| 优先级 | 方式 | 示例 | 适合谁 |
| --- | --- | --- | --- |
| 1 | **输入框魔术指令**（首行） | `#mock mid-error at=30` | 浏览器里手工测，不碰前端 |
| 2 | 请求头 | `X-Mock-Scenario: mid-error;at=30` | curl / 自动化脚本 |
| 3 | 查询串 | `POST /api/chat/stream?mock=mid-error` | curl 测非流式接口 |
| 4 | 粘性场景 | `POST /__mock__/scenario` | 想让"接下来几次"都用某场景 |
| 5 | 模型名 / CLI 默认 | 选「假模型 · 慢速」即慢速流 | 不想记指令时 |

魔术指令的两种写法：

```text
#mock mid-error at=30 delay=200
#mock {"scenario":"mid-error","at":30,"delay_ms":200}
```

常用参数（等号左边是短别名，右边是 `StreamPlan` 字段名）：

| 别名 | 字段 | 含义 |
| --- | --- | --- |
| `at` | `fault_at` | 第 N 个 token 帧后触发故障 |
| `chars` | `max_chars` | 正文长度上限 |
| `delay` | `delay_ms` | 每个 token 帧间隔（毫秒） |
| `pre` | `pre_delay_ms` | 首块前延迟 |
| `reasoning` | `reasoning_chars` | 思考片段长度 |
| `chunk` | `chunk_chars` | 每帧字符数 |
| `fallback` | `fallback_at` | 在第 N 帧前插入 fallback 事件，可写多个 |
| `questions` / `done` | `paper_questions` / `paper_done` | 试卷总题数 / 实际发几题 |
| `causes` / `more` | `cause_count` / `more_cause_count` | 错因分析返回条数 |
| `pdf` | `pdf_mode` | PDF 分支 |
| `transfers` | `transfer_count` | 每题的迁移题量 |

组合示例：

```text
#mock mid-error at=50 delay=20          # 慢速出 50 帧后报错
#mock paper questions=8 done=3          # 8 题只发 3 题
#mock long chunk=12                     # 长文，每帧 12 字（更快）
#mock slow delay=300 max_chars=120      # 慢慢吐 120 字，方便点停止
```

> 预设是**整体替换**的：高层选了新预设就从干净默认值开始，不残留低层预设的参数。只给参数不给名字时（`#mock at=30`）才叠加在当前预设上。

---

## 3. 场景清单

完整清单可随时从 `GET /__mock__/scenarios` 读，或看控制台页面。

### 流式输出

| 场景 | 假后端行为 | 前端被验证的部分 |
| --- | --- | --- |
| `happy` | 思考片段 → 约 600 字课件正文 → `done` | 正常渲染、字数、状态条、历史落库 |
| `fast` | 无延迟无思考 | 瞬时完成 |
| `slow` | 每 token 间隔 100ms，正文 180 字 | 流式追加渲染、tok/s、思考计时 |
| `stall` | 首块前等 20s | 思考动画、等待态 |
| `long` | 4000+ 字 | 「查看更多」折叠阈值、渲染性能 |
| `reasoning-heavy` | 超长思考后接正文 | 思考面板展开/收起、tok/s |
| `reasoning-only` | 只出思考不出正文 | 空正文边界 |
| `mid-error` | 出 30 个 token 后发 `event: error` | 错误卡、`failedModel`、「换个模型重试」弹窗 |
| `mid-truncate` | 出 30 个 token 后**直接断流** | 「生成中断，内容可能不完整」+ `truncated` 标记 |
| `fallback` / `fallback-chain` | 先发 1~2 次 `event: fallback` 再出正文 | 「备用通道切换」方格面板逐格点亮 |
| `fallback-fail` | fallback 之后 error | 全链失败卡 + toast |
| `cancel` | 慢速流（约 9 秒） | **点「停止」**→ 停止提示条 +「继续生成」+ 历史标 `partial` |
| `cancel-now` | 不发正文，直接 `[CANCELLED]` | 「已停止」界面态 |
| `empty` | 立即 `done` 且无正文 | 空结果边界 |
| `sentinel` | 只回 `@@CONTINUE_DONE@@` | 续写哨兵被剥离、不误标完成 |
| `echo` | 正文是请求回执 | 核对前端实际发出的参数 |

### HTTP 层与门禁

| 场景 | 前端行为 |
| --- | --- |
| `http-401` | 未登录→弹使用码弹窗；已登录→清登录态，错误卡不给重试 |
| `http-403` | 额度已用尽 |
| `http-403-quota` | 结构化 `detail`（`required`/`remaining`）→ 迁移批次额度不足，不清登录态 |
| `http-429` | 「调用频次限制」，隐藏重试/续写按钮 |
| `http-500` | 服务器错误 |
| `bad-model` | 400 模型不可用 → 换模型重试 |

### 工具专属

| 场景 | 说明 |
| --- | --- |
| `paper` | 合法整卷 5 题：阅读理解 A 篇（`@@PASSAGE_DEF@@/REF@@` 语篇复用）、七选五（A–G）、语法填空、读后续写，每题带迁移块 |
| `paper-partial` | 只发 3 题即 `done`，但 `@@TOTAL@@` 仍是 5 → 进度条停 3/5、出现「继续生成」条 |
| `paper-mid-truncate` | 1 题后断流 → 隐藏重试卡、只留续写条 |
| `paper-resume` | 按输入里的【续写指令】简报续写剩余题目 |
| `migration` | 迁移卡正文（批量并发） |
| `migration-analyze` / `migration-more` | 错因分析返回 3 条 / 继续分析再追加 3 条 |
| `migration-quota-short` | 错因数超过额度 → 迁移批次 403 |
| `vocab` | 超标词替换流（超标词排查本身走真实 3500 词表，见 `/api/chat/vocab/check`） |
| `title` | 标题生成正文场景；`/api/chat/title-jobs` 另会在内存中异步完成标题，便于查看 Shimmer 与刷新对账 |

### PDF 解析

| 场景 | 分支 |
| --- | --- |
| `pdf-ok` | 成功，返回一段可直接喂给试卷工具的试卷原文 |
| `pdf-scanned-pre` | 409 `scanned_suspected` / `pre_check` |
| `pdf-scanned-post` | 409 `scanned_suspected` / `post_parse` |
| `pdf-too-large` | 413 `too_large` |
| `pdf-corrupt` | 422 `corrupt` |
| `pdf-no-token` | 503 `token_missing` |
| `pdf-empty` | 409 首次解析为空 |
| `pdf-truncated` | 成功但被截断（`truncated=true`） |

上传时也可以直接**靠文件名触发**：`scanned.pdf` / `large.pdf` / `corrupt.pdf` / `empty.pdf` / `truncated.pdf`，比切场景更快。

### 系统

| 场景 | 说明 |
| --- | --- |
| 额度 | `--quota 3` 或控制台设置；`/api/auth/me` 的剩余次数逐次递减 |
| 镜像 | 两个实例互报 origin，见第 6 节 |

### 图片识别（工具 32）与扫码配对

工具 `32`「识别图片文字」在假后端里会**忽略场景内容**，按 `ocr_mode` 返回固定转录文本
（前端按所在工具决定这个值：作文批改用手写、其余用印刷，见 `docs/API_CONTRACT.md` 8.2）：

- `printed`（默认）→ 一份带空格的印刷试卷 Markdown（`## 第三部分 语言知识运用`…）；
- `handwritten` → 一篇带 `[ILLEGIBLE]` / `[OBSCURED]` 的手写作文。

准入规则与真实后端一致：**必须有有效使用码**（无码 401，额度用尽 403），且必须带
`images` 或 `pair_token` 之一（都没有 400）——用来核对前端有没有把图片和模式带对。

扫码配对端点也做了最小镜像（内存会话，够把前端流程走通）：

```
POST   /api/ocr/pair                     建会话（需使用码）→ {token, path, expires_in, max_images}
POST   /api/ocr/pair/{token}/hello       手机页报到（回传 theme / sky，供手机页定色）
POST   /api/ocr/pair/{token}/upload      手机直传（multipart，不校验图片魔数）
GET    /api/ocr/pair/{token}/image?i=N   电脑端读第 N 张
GET    /api/ocr/pair/{token}/events      SSE（假后端按秒轮询重发状态，时序与真后端一致）
DELETE /api/ocr/pair/{token}             释放会话
GET    /m/upload?token=...               手机拍照页（真实前端文件，与真后端同一个页面）
```

建会话的请求体可带电脑端当前主题（`{"theme": "jade", "sky": ""}`），假后端与真后端一样只认
白名单、白名单外退回 `paper`，并把 `theme` 附在返回的 `path` 上——所以用假后端也能核对手机页
有没有跟着电脑换皮（换主题后重新扫码即可）。

请求里的 `pair_order`（电脑端排好的图片顺序）假后端接受但忽略——它的转录文本是固定的，
顺序不影响结果，够前端把参数发出来核对即可。

手机扫码后打开 `/m/upload`，每拍一张立刻上传，电脑端弹窗实时看到进度；**第一张到达时电脑端的
配对窗口会自动收起**并落到「开始识别」，之后手机继续拍摄的照片会继续进批次，什么时候点「开始识别」
由电脑端决定。整条链路不花钱、不需要真实的视觉模型。

---

## 4. 控制台与控制端点

控制台页面 `GET /__mock__/`：切场景、设参数、看请求日志（含完整请求体）、改额度、一键重置。

程序化入口：

```
GET    /__mock__/state        当前场景/粘性/额度/镜像配置/上游开关
GET    /__mock__/scenarios    场景清单（含每个场景覆盖的参数）
POST   /__mock__/scenario     {"scenario":"mid-error","params":{"at":5},"times":1}
DELETE /__mock__/scenario     清除粘性场景
POST   /__mock__/quota        {"quota":5}（null = 无限）
GET    /__mock__/requests     请求日志 JSON
DELETE /__mock__/requests     清空日志
POST   /__mock__/reset        重置全部状态
```

请求日志每条包含：时间、方法、路径、是否带 `Authorization`、指纹头、解析出的场景、HTTP 状态，以及 SSE 流的帧统计（`token×30 / chars=60 / reasoning×4 / fallback×1 / terminal=[DONE]`）和完整请求体。**自动化测试靠它断言"前端到底发了什么"**——比如续写时 `continue_from` 是否就是残文、迁移卡是否带了正确的 `batch_index`。

---

## 5. 假 LLM 上游（让真实后端零成本跑起来）

暴露 `POST /v1/{scenario}/chat/completions`（OpenAI 兼容，流式发 `delta.content` / `delta.reasoning_content`，末帧带 `usage` 与 `data: [DONE]`）和 `GET /v1/models`。

### 最省事：单 provider

```bash
# backend/.env（临时）
LLM_BASE_URL=http://127.0.0.1:9900/v1/happy
LLM_API_KEY=fake
LLM_MODEL=openai/gpt-4o-mini

# 正常启动真实后端
uv run uvicorn app.main:app --port 8000
```

### 测真实的多通道 fallback

管理后台 → 模型与线路，给同一个模型配三个 provider，优先级从高到低：

| base_url | 行为 |
| --- | --- |
| `http://127.0.0.1:9900/v1/timeout` | 挂住不吐首块 |
| `http://127.0.0.1:9900/v1/error` | 返回 500 |
| `http://127.0.0.1:9900/v1/happy` | 正常流式 |

把 `FIRST_TOKEN_TIMEOUT` 调小（如 3 秒）缩短等待。然后正常用前端：应看到「备用通道切换 1/3 → 2/3」面板，管理后台的使用日志里能看到逐家失败摘要与最终命中的那家——这条链路以前只能靠真烧钱复现。

上游场景：`happy` / `slow` / `long` / `reasoning` / `paper` / `migration` / `timeout` / `error` / `empty` / `mid-error`。默认从路径取，也支持 `X-Mock-Scenario` 头和模型名包含场景名。

---

## 6. 线路镜像（双线路）测试

镜像需要两个 origin 同时在线。两种办法：

```bash
# 办法一：两个端口
uv run python -m mock_backend.main --port 8000 --mirror-origin http://127.0.0.1:8002
uv run python -m mock_backend.main --port 8002 --mirror-origin http://127.0.0.1:8000
# 分别开 http://127.0.0.1:8000/ 和 http://127.0.0.1:8002/

# 办法二：一个进程，用 localhost 与 127.0.0.1 当两个 origin
uv run python -m mock_backend.main --port 8000 --mirror-origin http://localhost:8000
# 分别开 http://127.0.0.1:8000/ 和 http://localhost:8000/
```

两条线路的 localStorage 互相独立，隐藏 iframe 桥接页（`/static/bridge.html`）由假后端静态托管，所以历史/收藏/偏好的推送、合并、墓碑都能真实演练。

---

## 7. 浏览器验收清单（人工）

按你的习惯，这些步骤留给你自己点，这里只列"该看到什么"：

| # | 操作 | 预期 |
| --- | --- | --- |
| 1 | 打开 `/`，左侧选「语篇深度分析」，输入框打 `#mock happy` + 任意文字，Ctrl+Enter | 思考面板出现并自动收起；正文含标题/列表/表格/公式/代码块；状态条显示字数与模型 |
| 2 | 输入 `#mock cancel` 后执行，约 1 秒后点「停止」 | 出现停止提示条与「继续生成」；历史条目标为中断 |
| 3 | 点「继续生成」 | 在原记录上追加内容，历史不新增条目 |
| 4 | 输入 `#mock mid-error at=30` 后执行 | 错误卡出现，含「换个模型重试」「编辑输入」 |
| 5 | 输入 `#mock mid-truncate at=30` 后执行 | 文案为「生成中断，内容可能不完整，请重试」 |
| 6 | 模型下拉切到「假模型 · 慢速」，随便输入执行 | 慢速流式，tok/s 明显小于 1 |
| 7 | 输入 `#mock fallback-chain` 后执行 | 「备用通道切换」方格子从 1/3 亮到 2/3 再出正文 |
| 8 | 输入 `#mock long` 后执行 | 长文出现「查看更多」折叠 |
| 9 | 选「试卷可视化全解」，输入 `#mock paper` 后执行 | 解卷出 5 题，进度条到 5/5；可打印、导出单文件 |
| 10 | 输入 `#mock paper-partial` 后执行，再点「继续生成」 | 进度条从 3/5 走到 5/5，续写按钮消失 |
| 11 | 输入 `#mock paper-mid-truncate` 后执行 | 只出现续写条，不出现重试卡 |
| 12 | 选「智能错题迁移」，走完四步 | 错因列表、批量卡片并发生成、「停止全部生成」 |
| 13 | 选「超标词排查+替换」 | 超标词高亮、一键替换 |
| 14 | 上传 `scanned.pdf` / `large.pdf` / `corrupt.pdf` | 分别弹 409 / 413 / 422 提示 |
| 15 | 控制台把额度设为 1，用付费模型连跑两次 | 第二次弹「额度已用尽」 |
| 16 | 按第 6 节起两个实例，在 A 线路收藏一条 | B 线路刷新后出现同一条收藏 |

---

## 8. 与真实后端的已知差异

有意简化、测试时不会误判的地方：

- **没有数据库**：使用码、设备、使用日志、LLM 配置全部在进程内存里，重启即清零。
- **`/api/tools/` 的 `prompt_loaded` 恒为 true**：真实后端会检查 `prompts/*.md` 是否存在。
- **`/api/chat/preview` 返回的是输入原文**，不是渲染后的完整 Prompt。
- **token 数是粗略估计**（`len/2`），真实后端用 litellm tokenizer。
- **不做限流**：`enforce_rate_limit`、免费额度在途计数都没有。
- **不实现管理后台**：`admin-frontend` 需要另行打桩。
- **`/api/parse/file` 只按文件名与场景分支返回**，不真的解析 PDF。
- **不校验 tool_id 与提示词的对应关系**，只校验 tool_id 是否存在。

---

## 9. 维护约定

**改了前后端协议，必须同步这里**，否则假后端会悄悄失配。具体是：

1. `app/routers/tools.py` 的工具目录变了 → 改 `catalog.py`，`tests/test_mock_backend.py::test_tool_catalog_matches_real_backend` 会失败提醒你；
2. `/api/chat/stream` 的 SSE 事件或字段变了 → 改 `engine.py`（帧构造只有这一处），并改 `test_mock_backend.py` 里的 `_parse_sse`（它是 `frontend/script.js` 解析器的 Python 复刻）；
3. 试卷 `@@TAG@@` 契约变了 → 改 `paper.py`，`test_paper_fixtures_pass_real_validator` 用真实校验器兜底；
4. 新增接口 → 在 `main.py` 补桩，并补一条契约测试。

自测：

```bash
cd backend
uv run pytest tests/test_mock_backend.py -q
```
