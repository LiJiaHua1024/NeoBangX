# 用假后端测前端（Agent 操作手册）

> 面向自动化测试的 Agent。这是**操作闭环**：起服务 → 设场景 → 驱动页面 → 断言 → 复位。
> 场景的完整语义、控制台页面、镜像双线路、浏览器人工验收清单、与真实后端的已知差异，见
> [backend/mock_backend/README.md](../backend/mock_backend/README.md)——那份是写给人看的，这份是给你抄的。
>
> **场景清单不要信本文档**：随时 `GET /__mock__/scenarios` 拿实时 JSON，那才是唯一事实源。

---

## 1. 什么时候用它

| 目的 | 用什么 |
| --- | --- |
| 测前端 UI / 交互 / 渲染 / 状态机 | **假后端**（本文档） |
| 测真实后端的 fallback、计费、日志、限流 | 真实后端 + 假后端兼任的**假 LLM 上游**（第 6 节） |
| 测镜像合并算法本身 | `node frontend/tests/nbx-mirror*.test.js`，不需要服务 |

假后端不碰数据库、不碰 LLM API Key，一次请求毫秒级返回（除了 `slow`/`stall` 这类故意演慢的场景）。

---

## 2. 启动

```bash
cd backend
uv run python -m mock_backend.main --port 8002
```

`--port` 按需换：真实后端通常占着 8000。起完之后：

- 前端本体：`http://127.0.0.1:8002/`
- 控制台（人看的）：`http://127.0.0.1:8002/__mock__/`

常用参数：`--scenario slow`（改默认场景）、`--quota 5`（假额度）、`--mirror-origin http://localhost:8002`（开镜像）、`--no-upstream`（关 `/v1/*`）。

默认只监听 `127.0.0.1`。静态资源带 `no-store`，改完 `frontend/` 下的文件刷新即生效。

---

## 3. 标准闭环

```python
import httpx
BASE = "http://127.0.0.1:8002"

# 1) 复位：清掉上一个用例留下的粘性场景、额度、请求日志
httpx.post(f"{BASE}/__mock__/reset")
httpx.delete(f"{BASE}/__mock__/scenario")
httpx.delete(f"{BASE}/__mock__/requests")

# 2) 设场景（三种方式任选，优先级见第 4 节）
#    方式 A：粘性场景，管接下来 N 次请求
httpx.post(f"{BASE}/__mock__/scenario",
           json={"scenario": "mid-error", "params": {"at": 30}, "times": 1})
#    方式 B：请求头，只影响这一条请求
#    headers = {"X-Mock-Scenario": "mid-error;at=30"}
#    方式 C：输入首行魔术指令（走浏览器时最省事）
#    在输入框里打：#mock mid-error at=30

# 3) 驱动浏览器（Playwright / 你自己的工具）……

# 4) 断言：读请求日志，核对前端到底发了什么
log = httpx.get(f"{BASE}/__mock__/requests").json()["requests"]
stream_calls = [r for r in log if r["path"] == "/api/chat/stream"]
assert stream_calls[-1]["body"]["tool_id"] == "1"
assert stream_calls[-1]["summary"].startswith("token×30")
```

**每个用例结束都做第 1 步**。粘性场景和额度是进程内状态，不复位会串到下一个用例。

---

## 4. 场景触发优先级

从高到低：**输入首行 `#mock` 指令** > 请求头 `X-Mock-Scenario` > 查询串 `?mock=` > 粘性场景 > 模型名 > CLI `--scenario` > 默认 `happy`。

预设是**整体替换**的（高层选新预设就从干净默认值开始，不残留低层参数）；只给参数不给名字时才叠加，例如 `#mock mid-error at=30` 是在 `mid-error` 预设上把触发点改成第 30 帧。

```bash
# 请求头形式（curl）
curl -N -X POST "$BASE/api/chat/stream" \
  -H 'Content-Type: application/json' \
  -H 'X-Mock-Scenario: mid-error;at=30' \
  -d '{"tool_id":"1","input":"任意","model":"mock/mock-flash"}'
```

---

## 5. 断言：`/__mock__/requests` 每条记录有什么

| 字段 | 用途 |
| --- | --- |
| `path` / `method` | 这次调用打了哪个端点 |
| `scenario` | 假后端**实际解析出**的场景（不等同于你设的那个，可以用来验证优先级） |
| `body` | 完整请求体。`continue_from` 超长，只记长度；其余原样 |
| `summary` | SSE 帧统计：`token×30 / chars=60 / reasoning×4 / fallback×1 / terminal=[DONE]` |
| `status` | HTTP 状态码 |
| `authorization` / `fingerprint` | 是否带了 token / 指纹头 |

`summary` 的 `terminal` 是最有用的断言点：

| `terminal` 值 | 含义 | 对应前端表现 |
| --- | --- | --- |
| `[DONE]` | 正常收尾 | 生成完成 |
| `[CANCELLED]` | 被 `/api/chat/stop` 停掉，或 `finish=cancel` | 停止提示条 + 「继续生成」 |
| `无(断流)` | 没发终止帧就结束了 | 「生成中断，内容可能不完整，请重试」 |
| `无(断流)` + 有 `error` | 发了 `event: error` | 错误卡 + 「换个模型重试」 |

---

## 6. 常用配方

### 测「回答中断」——三条不同的代码路径，都要测

```python
# a) 用户主动停止：慢速流 + 调 /api/chat/stop
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "slow"})
# 浏览器里点「停止」→ 前端会 abort fetch 并 POST /api/chat/stop
# 断言：日志里 terminal=[CANCELLED]；页面出现停止提示条与「继续生成」

# b) 后端中途报错（已出正文）
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "mid-error", "params": {"at": 30}})
# 断言：summary 含 error；页面出现错误卡，failedModel 被禁用

# c) 连接被掐断（无终止帧）
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "mid-truncate", "params": {"at": 30}})
# 断言：terminal=无(断流)；文案是「生成中断，内容可能不完整」
```

### 测「继续生成」

```python
# 先跑一次正常生成，再点「继续生成」
# 断言：第二条 /api/chat/stream 的 body 里 continue_from 长度 > 0，
#       且历史记录没有新增条目（前端写回 activeHistoryId）
```

### 测多通道 fallback（真实后端 + 假上游）

```bash
# backend/.env 临时指向假上游（无需任何真实 Key）
LLM_BASE_URL=http://127.0.0.1:8002/v1/happy
LLM_API_KEY=fake
LLM_MODEL=openai/gpt-4o-mini

# 管理后台给同一模型配三个 provider，优先级从高到低：
#   /v1/timeout  挂住不吐首块   （把 FIRST_TOKEN_TIMEOUT 调到 3 秒缩短等待）
#   /v1/error    返回 500
#   /v1/happy    正常流式
# 断言：前端出现「备用通道切换 1/3 → 2/3」面板；管理后台使用日志有逐家失败摘要
```

### 测试卷工具（tool 13）

```python
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "paper"})          # 整卷 5 题
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "paper-partial"})  # 3/5 题 + 续写条
httpx.post(f"{BASE}/__mock__/scenario", json={"scenario": "paper-mid-truncate"})  # 断流，只留续写条
# paper-resume 不需要手动设：检测到输入里的【续写指令】简报就自动续写剩余题目
```

### 测 PDF 失败分支

上传时**靠文件名触发**最快，不用切场景：`scanned.pdf`(409) / `large.pdf`(413) / `corrupt.pdf`(422) / `empty.pdf`(409 post_parse) / `truncated.pdf`(截断)。其余分支用 `X-Mock-Scenario: pdf-no-token`(503) 等。

### 测额度

```python
httpx.post(f"{BASE}/__mock__/quota", json={"quota": 1})
# 用付费模型（mock/mock-pro）连跑两次 → 第二次 403「额度已用尽」
# 注意：免费模型（mock/mock-flash）在额度耗尽后仍然放行，与真实后端语义一致
```

### 测线路镜像

```bash
uv run python -m mock_backend.main --port 8000 --mirror-origin http://localhost:8000
# 分别开 http://127.0.0.1:8000/ 和 http://localhost:8000/（两个 origin，一个进程就够）
```

---

## 7. 别踩这些

- **`/api/chat/stream` 的 `tool_id` 必须存在**，否则 404。迁移工具（`26`）必须带 `batch_id`/`batch_size`/`batch_index`，否则 400。
- **默认模型 `mock/mock-flash` 是免费且免码的**，未登录也能跑。要测使用码门禁就切到 `mock/mock-pro`。
- **`/api/parse/file` 只按文件名和场景分支返回**，不真的解析 PDF。
- **管理后台（8001）没有打桩**，`admin-frontend` 不要指向假后端。
- 假后端的 `prompt_loaded` 恒为 true、token 数是粗略估计、没有限流——需要这些真实行为时上真实后端。

---

## 8. 相关文档

- [backend/mock_backend/README.md](../backend/mock_backend/README.md)：完整场景表、控制台、已知差异、维护约定
- [docs/API_CONTRACT.md](./API_CONTRACT.md)：真实后端接口契约
- [README.md](../README.md) 第 4.6 节：假后端入口说明
