# NeoBangX API 契约文档（v1.2）

> 版本：1.2.0
> 日期：2026-08-07
> 说明：本文档定义 NeoBangX v1.2 后端与前端的完整接口契约，包含使用码认证、管理后台 API 与智能错题迁移。

---

## 1. 通用约定

- 基础 URL：
  - 主站：`http://localhost:8000`
  - 管理后台：`http://localhost:8001`
- 所有 API 路径以 `/api` 开头
- 请求体格式：`application/json`
- 响应格式：JSON，除非特别说明为 SSE
- 字符编码：UTF-8
- **认证**：除 `/api/auth/activate`、`/api/health`、`/api/config`、`/api/tools/` 外，主站接口默认需在请求头携带 `Authorization: Bearer <token>`。token 通过 `POST /api/auth/activate` 获取。
- **免费模型与无码调用**：模型可被标记为「免费」（限额内调用不扣次数），并可额外开启「无码可用」。当所选模型同时满足两者时，`/api/chat/stream`、`/api/chat/stop`、`/api/chat/vocab/check`、`/api/chat/migration/analyze`、`/api/chat/migration/quota`、`/api/parse/file` 允许不带 token 调用（没有使用码或次数已用尽均可，等价于无码）；未满足条件时按原规则返回 401/403。免费模型的调用按使用码计数（无码时按浏览器指纹、再退回 IP），受模型级防滥用限额约束；**限额命中时若请求携带的使用码仍可用（未耗尽或无限额度），本次调用自动转为按次扣减（不返回 429）**，无码或码不可用时才 429；**生成失败（`status=error`）的调用不计入限额**，用户主动停止或中途断线（`cancelled`）照常计入。转按次计费后的调用仍计入免费限额窗口计数，因此窗口滚动前会持续按次扣减。

---

## 2. 接口清单

### 主站接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 否 |
| GET | `/api/config` | 前端配置信息 | 否 |
| GET | `/api/tools/` | 工具元数据 + 模型列表 | 是 |
| GET | `/api/tools/models` | 可用模型列表 | 是 |
| POST | `/api/auth/activate` | 验证使用码，返回 JWT | 否 |
| GET | `/api/auth/me` | 当前使用码状态 | 是 |
| POST | `/api/chat/preview` | 预览最终 Prompt | 是 |
| POST | `/api/chat/vocab/check` | 机械排查超标词：分词 + 课标词表匹配（不扣费） | 可选 |
| POST | `/api/chat/migration/analyze` | 非流式分析智能错题迁移错因（不扣费） | 可选（无码需免费+无码可用模型） |
| POST | `/api/chat/migration/quota` | 预检查智能错题迁移额度（不扣费） | 可选 |
| POST | `/api/chat/stream` | 流式调用工具（SSE） | 可选（无码需免费+无码可用模型） |
| POST | `/api/chat/stop` | 中止流式生成（含免码的免费模型调用） | 可选 |
| POST | `/api/chat/title` | 为生成结果生成标题 | 是 |

### 管理后台接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/admin/stats` | 统计概览 |
| GET | `/api/admin/codes` | 使用码列表 |
| POST | `/api/admin/codes` | 生成使用码 |
| PATCH | `/api/admin/codes/{id}` | 更新使用码（启用/禁用/备注/额度） |
| POST | `/api/admin/codes/{id}/reset-usage` | 重置使用码已用次数（日志保留） |
| GET | `/api/admin/logs` | 使用日志列表（可按状态 / 模型 / 时间筛选） |
| GET | `/api/admin/logs/summary` | 使用日志聚合统计（随筛选联动） |
| GET | `/api/admin/logs/{id}` | 单条日志详情（含原始输入 / Prompt / 输出） |
| GET | `/api/admin/devices` | 设备指纹聚合列表（短码/备注/昵称搜索） |
| GET | `/api/admin/devices/{id}` | 单设备画像详情（摘要翻译 + 使用分布 + 最近请求） |
| PATCH | `/api/admin/devices/{id}` | 更新设备备注（全局） |
| POST | `/api/admin/logs/purge` | 手动清理过期日志 |
| GET | `/api/admin/config` | 查看运行时配置 |
| PUT | `/api/admin/config` | 更新运行时配置（含日志开关与保留天数） |

---

## 3. 认证

### 3.1 使用码激活

#### POST `/api/auth/activate`

**请求体：**

```json
{
  "code": "NBXU-XXXX-XXXX-XXXX"
}
```

**成功响应：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "code": "NBXU-XXXX-XXXX-XXXX",
    "quota": 10,
    "used_count": 0,
    "remaining": 10,
    "is_enabled": true,
    "is_exhausted": false,
    "is_unlimited": false
  }
}
```

**错误响应：**

```json
{ "detail": "使用码无效" }
{ "detail": "使用码已被禁用" }
{ "detail": "额度已用尽" }
```

### 3.2 当前使用码状态

#### GET `/api/auth/me`

请求头：`Authorization: Bearer <token>`

**响应：**

```json
{
  "user": {
    "code": "NBXU-XXXX-XXXX-XXXX",
    "quota": 10,
    "used_count": 3,
    "remaining": 7,
    "is_enabled": true,
    "is_exhausted": false,
    "is_unlimited": false
  }
}
```

---

## 4. 健康检查

### GET `/api/health`

**响应：**

```json
{
  "status": "ok",
  "version": "1.2.0"
}
```

---

## 5. 前端配置信息

### GET `/api/config`

返回前端需要的配置信息（注意：不返回 API Key）。

**响应：**

```json
{
  "models": [
    {
      "id": "openrouter/google/gemini-2.5-flash",
      "name": "Gemini 2.5 Flash",
      "description": "速度快、性价比高，适合日常使用",
      "score": 8.5,
      "reasoning_effort": null,
      "thinking_budget": null,
      "chores_only": false,
      "enabled": true,
      "is_free": true,
      "free_no_code": true,
      "free_limits": { "minute": 3, "hour": 30, "day": 0, "week": 0, "month": 0 }
    }
  ],
  "default_model": "openrouter/google/gemini-2.5-flash",
  "app_name": "NeoBangX",
  "version": "1.2.0",
  "slogan": "Bang助教学，大有可AI",
  "auth_required": true
}
```

模型字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_free` | bool | 免费模型：限额内调用不消耗使用码次数，用户端模型列表显示「免费」标签；限额命中后持可用使用码时转按次扣减 |
| `free_no_code` | bool | 无码可用：没有使用码或次数已用尽时仍可调用（仅在 `is_free` 为真时生效） |
| `free_limits` | object | 防滥用限额，键为 `minute` / `hour` / `day` / `week` / `month`，0 或 -1（含负数）= 不限制 |

---

## 6. 工具元数据

### GET `/api/tools/`

返回所有工具的分组元数据、Prompt 加载状态、可用模型列表。

**响应：**

```json
{
  "groups": [
    {
      "id": "teaching",
      "title": "辅助教学功能",
      "collapsed": false,
      "tools": [
        {
          "id": "1",
          "name": "语篇深度分析",
          "icon": "document-magnifier",
          "description": "主题/文体/语言特点/观点分析",
          "prompt_filename": "语篇深度分析.md",
          "prompt_loaded": true
        }
      ]
    }
  ],
  "models": [
    {
      "id": "openrouter/google/gemini-2.5-flash",
      "name": "Gemini 2.5 Flash",
      "description": "速度快、性价比高，适合日常使用",
      "score": 8.5,
      "is_free": true,
      "free_no_code": true
    }
  ],
  "default_model": "openrouter/google/gemini-2.5-flash",
  "max_visible_models": 5
}
```

`is_free` 表示免费模型（限额内不扣次数，限额命中后持可用使用码时转按次扣减），
`free_no_code` 表示该模型无码可用；前端据此渲染「免费」标签，
并在无使用码时默认选中可免码试用的模型。

`max_visible_models` 为管理后台配置的模型下拉最大显示数（`0` = 不折叠）。
`models` 已过滤掉**已禁用**与**仅 Chores**模型，因此该数组长度就是折叠计数的基数，
前端按 `min(长度, max_visible_models)` 渲染，超出部分折叠为「展开全部」。

### GET `/api/tools/models`

返回可用模型列表。

**响应：**

```json
{
  "models": [
    {
      "id": "openrouter/google/gemini-2.5-flash",
      "label": "Gemini 2.5 Flash",
      "description": "速度快、性价比高，适合日常使用",
      "score": 8.5,
      "is_free": true,
      "free_no_code": true
    }
  ],
  "default_model": "openrouter/google/gemini-2.5-flash"
}
```

---

## 7. Prompt 预览

### POST `/api/chat/preview`

用于调试：查看某个工具最终发送给 LLM 的完整 Prompt。

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "tool_id": "1",
  "input": "用户输入的英语语篇"
}
```

**成功响应：**

```json
{
  "tool_id": "1",
  "prompt_filename": "语篇深度分析.md",
  "prompt": "# 系统角色\n...\n# 用户输入\n\n用户输入的英语语篇\n..."
}
```

### 7.1 超标词机械排查

#### POST `/api/chat/vocab/check`

对英语文本做纯机械的超标词排查：正则分词后逐词与高考课标词表（`backend/app/data/gaokao3500_words.json`，含义务教育补漏词）做集合匹配。屈折变化（复数/时态/比较级/所有格/不规则动词）与常见派生（副词 -ly、-tion/-ness/-ment/-al/-ive/-ful/-er/-en、un-/dis-/re- 前缀等）均可叠加回退，词根在表即放行；单字母大写选项标记（B. C. D.）、全大写缩写（USA）与常见头衔（Dr.）跳过。毫秒级返回，不扣减额度。

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "text": "粘贴待排查的英语文本"
}
```

**成功响应：**

```json
{
  "total_words": 111,
  "over_words": [
    {
      "word": "utilize",
      "count": 2,
      "maybe_proper": false,
      "sentences": ["In modern society, people often utilize various facilities to facilitate their daily work."],
      "pos": "v.",
      "meaning": "利用, 使用"
    }
  ]
}
```

`over_words` 按出现次数降序排列；`pos`/`meaning` 从词表回填，缺失时为空字符串；`sentences` 最多 3 条所在句子（截断 220 字符）。

### 7.2 智能错题迁移错因分析

#### POST `/api/chat/migration/analyze`

非流式分析，不扣减额度。`feedback_history` 每次必须携带从第一次 Retry 开始的全部反馈。点击 More 时，客户端还需携带上一次响应返回的 `analysis_history`，服务端会在完整历史末尾追加一条 `role: user` 消息，要求模型只补充新的错因。

**请求体：**

```json
{
  "question": "题干与选项",
  "standard_answer": "B",
  "student_answers": "多数学生选择 A",
  "error_cause": "可为空",
  "feedback_history": [],
  "analysis_history": [],
  "continue_generation": false,
  "model": "openrouter/google/gemini-2.0-flash"
}
```

**成功响应：**

```json
{
  "causes": [
    { "id": "cause_0", "label": "忽略语篇中的转折信号" }
  ],
  "analysis_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "{\"causes\":[...]}" }
  ]
}
```

### 7.3 智能错题迁移额度预检查

#### POST `/api/chat/migration/quota`

请求体只需提供选中的错因数量 `cause_count`。扣费次数为 `max(1, floor(cause_count / 2))`，预检查不扣费；最终卡片全部成功后由批次流式请求统一扣减。预检查不感知免费模型限额（限额在流内逐卡判定、命中后转按次计费），免费模型的最终额度校验以流内批次注册为准。

```json
{ "cause_count": 3 }
```

```json
{
  "can_generate": true,
  "required": 1,
  "remaining": 10,
  "cause_count": 3
}
```

---

## 8. 流式调用（SSE）

### POST `/api/chat/stream`

核心接口，所有工具的 LLM 调用都通过此接口发起，返回 SSE 事件流。

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "tool_id": "1",
  "input": "用户输入的英语语篇",
  "model": "openrouter/google/gemini-2.0-flash",
  "request_id": "1_1690123456789"
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool_id` | string | 是 | 工具 ID |
| `input` | string | 是 | 用户输入文本 |
| `model` | string | 否 | 模型 ID，为空则使用后端默认模型 |
| `request_id` | string | 否 | 客户端生成的请求 ID，用于后续调用 `/api/chat/stop` 中止生成 |
| `batch_id` | string | 否 | 智能错题迁移批次 ID；同一批卡片使用相同值 |
| `batch_size` | integer | 否 | 智能错题迁移批次内错因卡片总数 |
| `batch_index` | integer | 否 | 当前卡片在批次内的序号，从 0 开始 |

**响应：** SSE 事件流（`Content-Type: text/event-stream`）

```text
event: token
data: 这是

event: token
data: 一个

event: token
data: 片段

event: done
data: [DONE]
```

**事件类型：**

| 事件 | data 内容 | 说明 |
|------|-----------|------|
| `token` | 文本片段 | LLM 生成的内容片段 |
| `reasoning` | 推理片段（与 token 同样 JSON 编码） | 模型的思考过程，仅用于展示，不计入正文、不写日志；不支持推理的模型不发送该事件，前端回退到原有等待动画 |
| `fallback` | JSON 字符串 `{"failed_index": 1, "total": 3, "next_index": 2, "reason": "timeout"}` | 当前 Provider 失败、正在切换下一优先级（按优先级链顺序尝试）。`reason` 取值：`timeout`（首块等待超时）/ `empty`（上游未返回任何正文）/ `unavailable`（其余失败）。只用于向前端展示进度，不含 Provider 名称；单 Provider 或切换后无下一家时不发送 |
| `done` | `[DONE]` / `[CANCELLED]` | 生成结束；`[CANCELLED]` 表示用户停止或客户端断开 |
| `error` | JSON 字符串 `{"message": "...", "model": "..."}` | 生成过程中发生错误（含全部 Provider 均失败）；`model` 供前端失败归因 |

**Provider 切换（fallback）：** 同一逻辑模型可绑定多个 Provider（管理后台按优先级排序）。默认切换策略是**除「上下文超限」「内容审核」这类换谁都一样的错误外，任何 Provider 失败都切下一家**——包含 401/403（key 失效、欠费）、404（该家没有这个模型）、400/422（该家不支持某个参数）等「某一家自己的问题」。流式生成中，单家 Provider 等待**第一个数据块**的上限由全局配置 `first_token_timeout`（默认 30 秒，管理后台「全局调用参数」可改）决定，超时即判该家失效并切下一家；首个数据块到达后改由 `timeout` 按块判定，不会掐断正在出字的流。已经吐出正文后再失败则不切换（避免两家内容拼接），直接以 `error` 事件结束。

智能错题迁移的同一批请求共享 `batch_id`。后端只有在 `batch_size` 张卡片全部自然完成后，才按 `max(1, floor(batch_size / 2))` 扣减一次额度；任一卡片失败或被停止时不扣减。免费模型的批次整批按 0 次结算；若生成途中部分卡片命中免费限额转为按次计费，**整批升级为付费批**并按上式扣减（额度不足支付整批时该卡返回 403 结构化 detail `{message, required, remaining}`，批次不扣费）；已升级的批次不会因限额窗口滚动再降回免费。

**日志留痕：** 无论成功、用户停止还是异常，每次 `/api/chat/stream` 调用都会在服务端留下**一条**使用日志（见 11.6）。智能错题迁移的每张卡片各记一条日志，其 `units` 为 0；整批的扣费次数记在最后一卡的日志上。

---

## 9. 停止流式生成

### POST `/api/chat/stop`

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "request_id": "请求 ID"
}
```

**响应：**

```json
{
  "status": "stopped",
  "request_id": "请求 ID"
}
```

---

## 10. 标题生成

### POST `/api/chat/title`

使用 Chores AI 为一次生成结果生成简短中文标题。

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "tool_id": "1",
  "input": "用户输入的英语语篇",
  "output": "模型生成的结果摘要"
}
```

**响应：**

```json
{
  "title": "语篇深度分析"
}
```

---

## 11. 管理后台 API

### 11.1 统计概览

#### GET `/api/admin/stats`

**响应：**

```json
{
  "total_codes": 10,
  "enabled_codes": 8,
  "total_logs": 156,
  "total_used": 143
}
```

### 11.2 使用码列表

#### GET `/api/admin/codes`

**查询参数：**

| 参数 | 说明 |
|------|------|
| `q` | 按使用码或备注搜索 |
| `enabled` | `true` 或 `false` |
| `page` | 页码，从 1 开始 |
| `page_size` | 每页数量 |

**响应：**

```json
{
  "total": 10,
  "page": 1,
  "page_size": 20,
  "items": [
    {
      "id": 1,
      "code": "NBXU-XXXX-XXXX-XXXX",
      "quota": 10,
      "used_count": 0,
      "remaining": 10,
      "is_enabled": true,
      "is_exhausted": false,
      "is_unlimited": false,
      "note": "",
      "created_at": "2026-07-28T12:00:00+00:00"
    }
  ]
}
```

### 11.3 生成使用码

#### POST `/api/admin/codes`

**请求体：**

```json
{
  "quota": 10,
  "count": 5,
  "note": "某校教研组"
}
```

说明：`quota` 传 `-1`（任意负值均归一为 -1）表示无限额度，`0` 返回 400；新码统一 `NBXU-` 前缀。

**响应：**

```json
{
  "count": 5,
  "items": [ { ... } ]
}
```

### 11.4 更新使用码

#### PATCH `/api/admin/codes/{id}`

**请求体：**

```json
{
  "is_enabled": false,
  "note": "备注",
  "quota": 20
}
```

额度互转说明（响应为更新后的使用码对象）：

- **有限 → 无限**：传负数（归一为 `-1`），已用次数**自动清零**；
- **无限 → 有限**：传正整数，已用次数从 **0** 开始重新计数；
- 有限 → 有限：新额度不能小于已用次数（否则 400）；
- `0` 返回 400。

### 11.5 重置使用码用量

#### POST `/api/admin/codes/{id}/reset-usage`

把使用码的已用次数清零，剩余次数随之恢复为额度值。**使用日志不受影响**（只清零计数，不删除日志）。幂等操作，无请求体。

**响应：** 更新后的使用码对象（同 11.2 的 item 结构）。

```json
{
  "id": 1,
  "code": "NBXU-XXXX-XXXX-XXXX",
  "quota": 10,
  "used_count": 0,
  "remaining": 10,
  "is_enabled": true,
  "is_exhausted": false,
  "is_unlimited": false,
  "note": "",
  "created_at": "2026-07-28T12:00:00+00:00"
}
```

### 11.6 使用日志

每次 LLM 调用（主聊天流、标题生成、错因分析）都会留下**一条**日志。元数据
（状态、耗时、token 用量、客户端 IP / UA、实际扣费次数）**始终记录**；原始内容
（用户输入、渲染后的完整 Prompt、模型输出）是否入库由配置项 `log_payload`
控制，**默认关闭**。

#### GET `/api/admin/logs`

**查询参数：**

| 参数 | 说明 |
|------|------|
| `code` | 按使用码筛选（模糊匹配） |
| `tool_id` | 按工具 ID 精确筛选（`title` / `migration_analyze` / 数字 ID） |
| `model` | 按模型筛选（模糊匹配） |
| `status` | `success` \| `cancelled` \| `error`，非法值返回 400 |
| `start` | 起始时间（含）。接受 `YYYY-MM-DD` 或 ISO 时间串；纯日期按零点处理，带时区的值统一换算为 UTC |
| `end` | 结束时间（**不含**），格式同上 |
| `device` | 按设备筛选：短码 / 备注 / 自动昵称 / 全哈希模糊匹配；纯数字按设备 ID 精确匹配 |
| `page` | 页码，默认 1 |
| `page_size` | 每页数量，默认 30，最大 100 |

**响应：**

```json
{
  "total": 156,
  "page": 1,
  "page_size": 30,
  "items": [
    {
      "id": 1,
      "code_id": 2,
      "code": "NBXU-XXXX-XXXX-XXXX",
      "tool_id": "1",
      "tool_name": "语篇深度分析",
      "model": "openrouter/google/gemini-2.0-flash",
      "request_id": "1_1690123456789",
      "created_at": "2026-07-28T12:00:00+00:00",
      "status": "success",
      "error_message": "",
      "duration_ms": 8421,
      "prompt_tokens": 2959,
      "completion_tokens": 2060,
      "total_tokens": 5019,
      "ip": "192.168.1.66",
      "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
      "units": 1
    }
  ]
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `status` | `success` 正常完成 / `cancelled` 用户停止或客户端断开 / `error` 上游或内部异常 |
| `error_message` | 异常摘要，最长 500 字（超出截断）；正常为空串 |
| `duration_ms` | 从发起到流结束的墙钟耗时；旧数据为 `null` |
| `prompt_tokens` 等 | 供应商回传的 token 用量；未开启流式 usage 或供应商不支持时为 `null` |
| `ip` | 客户端 IP，反代后按 `X-Real-IP` > `X-Forwarded-For` 首跳 > 直连地址取值 |
| `units` | 本次请求**实际扣减**的额度次数。普通工具成功/停止 = 1（免费模型限额内为 0，限额命中转按次计费为 1）；标题生成、错因分析、迁移单卡 = 0；迁移整批的最后一卡 = 整批次数（免费批升级付费批后为整批付费次数） |
| `device_id` / `fingerprint` | 浏览器设备指纹（仅用于识别共享，不做拦截依据）。`device_id` 为 `null` 表示当时无指纹（旧数据/上报失败）；`fingerprint` 为 ThumbmarkJS 全哈希冗余。列表与详情额外挂载 `device` 对象（含短码/昵称/备注/颜色/摘要），缺失时为 `null` |
| `device` | 挂载的设备摘要：`{ id, fingerprint, short_code(FP-XXXX-XXXX), auto_name, display_name(备注优先), note, color, device_summary, first_seen_at, last_seen_at, seen_count }` |

**设备指纹上报（仅用于识别共享，不做拦截依据）：** 前端经 ThumbmarkJS（MIT，自托管于
`/static/vendor/`，加载失败时回退 jsDelivr CDN）计算后，在所有
`/api/chat/*` 请求上附带 `X-Client-Fingerprint: <全哈希>` 与
`X-Client-Fp-Summary: <精简设备 JSON>` 请求头。缺失/非法时按无指纹正常记录，
绝不 400；指纹可伪造，仅做展示与共享识别，绝不做鉴权/额度/限流依据。
`vocab/check` 为纯机械排查，不记日志，指纹头对其无影响。

**旧数据兼容：** 本次增强之前写入的日志行没有这些新字段（`_add_missing_columns()`
以可空、无默认值的方式 ALTER 加列，存量行读回为 `NULL`）。统一口径是：

- `status` 为 `NULL` / 空串 → 一律按 `success` 归档。列表筛选（`status=success`）、
  `/logs/summary` 聚合与详情展示三处共用同一条规则（`request_log.status_matches`），
  因此「详情写着成功」与「筛成功能查到」必然一致，且
  `success + cancelled + error == total` 恒成立。旧版本只在生成收尾并扣费后写日志，
  异常与用户停止当时不留痕，故不存在被误归类的旧行。
- `duration_ms` / `prompt_tokens` / `completion_tokens` / `total_tokens` / `units`
  为 `NULL` → 表示**当时未记录**，接口原样返回 `null`，前端显示 `—`。
  注意 `units` 不会收敛成 `0`：`0` 的含义是「本次未扣费」，与「不知道」是两回事。
- `ip` / `user_agent` / `error_message` 为 `NULL` → 返回空串，前端显示 `—`。
- `payload` 为 `null` → 该次请求未开启原始数据记录（旧数据一律如此）。

#### GET `/api/admin/logs/summary`

接受与 `/api/admin/logs` 完全相同的筛选参数（分页参数除外），返回聚合结果，
用于日志页顶部统计卡。

```json
{
  "total": 156,
  "success": 140,
  "cancelled": 6,
  "error": 10,
  "total_tokens": 411240,
  "avg_duration_ms": 8421,
  "distinct_devices": 3
}
```

`avg_duration_ms` 在没有可用耗时数据时为 `null`。
`distinct_devices` 为当前筛选下出现过的不同设备数（按码过滤时可一眼看出该码被几台设备用过）。

#### GET `/api/admin/logs/{log_id}`

返回单条日志的全部元数据字段，外加 `payload`：

```json
{
  "id": 1,
  "...": "同列表字段",
  "device": { "id": 7, "short_code": "FP-AB12-CD34", "...": "同设备字段" },
  "payload": {
    "input": "用户原始输入",
    "prompt": "渲染后发给模型的完整 Prompt",
    "output": "模型完整输出"
  }
}
```

`payload` 为 `null` 表示该次请求未开启原始数据记录（或记录功能当时处于关闭状态）。
单段内容最长 60000 字，超出部分截断。`device` 为 `null` 表示当时无指纹。

#### POST `/api/admin/logs/purge`

**请求体（可省略）：**

```json
{ "days": 30 }
```

`days` 缺省时使用配置项 `log_retention_days`；`days <= 0` 表示不清理（永久保留语义）。
原始数据随日志一并删除。

**响应：**

```json
{ "status": "purged", "days": 30, "deleted": 128 }
```

> 保留策略：`log_retention_days > 0` 时，主站进程在启动时清理一次，之后每 24 小时
> 自动清理一次过期日志。
>
> 注意：清理只删 `usage_logs` / `log_payloads`，`devices` 表保留（设备备注不丢失）。

#### GET `/api/admin/devices`

按末次活跃倒序的设备聚合列表（备注按设备全局唯一）。

**查询参数：** `q`（短码/备注/昵称/指纹模糊）、`page`（默认 1）、`page_size`（默认 20，最大 100）。

```json
{
  "total": 3,
  "page": 1,
  "page_size": 20,
  "items": [
    {
      "id": 7,
      "fingerprint": "abc123…",
      "short_code": "FP-AB12-CD34",
      "auto_name": "青鹭·3F2A",
      "display_name": "张老师电脑",
      "note": "张老师电脑",
      "color": "hsl(210 70% 45%)",
      "device_summary": "{\"os\":\"Windows\",\"scr\":\"1920x1080\"}",
      "first_seen_at": "2026-09-04T00:00:00+00:00",
      "last_seen_at": "2026-09-04T01:00:00+00:00",
      "seen_count": 12,
      "code_count": 2,
      "last_ip": "192.168.1.66",
      "last_code": "NBXU-XXXX-XXXX-XXXX",
      "last_log_at": "2026-09-04T01:00:00+00:00"
    }
  ]
}
```

#### PATCH `/api/admin/devices/{device_id}`

更新设备备注（全局，清空传空串则恢复显示自动昵称）。

```json
{ "note": "张老师电脑", "color": "#0e6e5f" }
```

`note` 不传则不变，空串则清空；`color` 不传则不变，空串则恢复自动颜色，
`#rgb` / `#rrggbb` 设为自选颜色，其它格式返回 400。

#### GET `/api/admin/devices/{device_id}`

单设备画像详情：把 `device_summary` 翻译成管理员可读的画像，并附带使用分布。
不存在返回 404。指纹可伪造，一切结论仅供参考，不做拦截依据。

```json
{
  "device": { "id": 7, "short_code": "FP-AB12-CD34", "...": "同列表设备字段" },
  "summary_parsed": { "os": "Win32", "lang": "zh-CN", "scr": "1920x1080", "dpr": "1", "cores": "8", "tz": "Asia/Shanghai" },
  "summary_raw": "{\"os\":\"Win32\",...}",
  "profile": [
    { "key": "os", "label": "操作系统", "value": "Windows（Win32）", "hint": "来自 navigator.platform，仅供参考" },
    { "key": "lang", "label": "语言", "value": "简体中文（中国大陆）（zh-CN）", "hint": "浏览器首选语言" },
    { "key": "screen", "label": "屏幕", "value": "1920×1080（横屏，16:9…）", "hint": "scr 为 CSS 逻辑分辨率…" },
    { "key": "cores", "label": "CPU", "value": "8 核（主流桌面 / 笔记本水平）", "hint": "逻辑核心（含超线程）…" },
    { "key": "tz", "label": "时区", "value": "Asia/Shanghai（北京时间，UTC+8）", "hint": "可与 IP 归属地对照…" },
    { "key": "browser", "label": "浏览器（最近一次）", "value": "Chrome 126 / Windows 10/11 64 位 / 桌面端", "hint": "由最近 UA 解析…" }
  ],
  "signals": ["多码：同一浏览器用过 2 个使用码（疑似共享 / 转借）"],
  "stats": { "total_logs": 12, "success": 11, "cancelled": 0, "error": 1, "total_tokens": 1024, "avg_duration_ms": 8000, "first_log_at": "…", "last_log_at": "…", "active_days": 3 },
  "codes": [{ "code": "NBXU-XXXX", "note": "备注", "count": 10, "last_used_at": "…" }],
  "ips": [{ "ip": "192.168.1.66", "count": 10, "last_seen_at": "…" }],
  "user_agents": [{ "user_agent": "Mozilla/5.0 …", "browser": "Chrome 126", "os": "Windows 10/11 64 位", "device_type": "桌面端", "count": 10, "last_seen_at": "…" }],
  "tools": [{ "tool_id": "25", "tool_name": "自由对话", "count": 10 }],
  "models": [{ "model": "…", "count": 10 }],
  "recent_logs": [{ "id": 1, "created_at": "…", "code": "…", "tool_id": "25", "tool_name": "…", "model": "…", "status": "success", "ip": "…", "duration_ms": 100, "total_tokens": 10 }]
}
```

### 11.7 查看配置

#### GET `/api/admin/config`

**响应：**

```json
{
  "config": {
    "default_model": "openrouter/google/gemini-2.0-flash",
    "models": "openrouter/google/gemini-2.0-flash",
    "llm_base_url": "",
    "llm_api_key": "sk-****abcd",
    "llm_model": "",
    "chores_model": "",
    "chores_base_url": "",
    "chores_api_key": "",
    "max_tokens": "4096",
    "timeout": "120",
    "max_visible_models": "5",
    "log_payload": "false",
    "log_retention_days": "0"
  },
  "keys": [ ... ],
  "has_llm_api_key": true,
  "has_chores_api_key": false
}
```

`log_payload` 以字符串 `"true"` / `"false"` 存储；`log_retention_days` 为
天数字符串，`"0"` 表示永久保留。

### 11.8 更新配置

#### PUT `/api/admin/config`

**请求体：**

```json
{
  "default_model": "openrouter/google/gemini-2.0-flash",
  "models": "model1,model2",
  "llm_api_key": "sk-...",
  "max_tokens": 4096,
  "max_visible_models": 5,
  "log_payload": true,
  "log_retention_days": 30
}
```

说明：API Key 字段若含 `****` 则视为未修改；留空字符串则清除密钥。
`log_retention_days` 取值范围 `0 ~ 36500`，越界返回 422。
`max_visible_models` 为用户端模型下拉的最大显示数，取值范围 `0 ~ 50`
（`0` = 不折叠，保持全量显示），越界返回 422；只统计用户端可见模型，
已禁用与仅 Chores 模型不计入。该值经 `GET /api/tools/` 下发到前端。
两项日志配置**保存后即时生效**（主站在每次请求时读取），无需重启。

`models` 为结构化数组（管理端提交 `ModelEntry` 列表），每项字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 必填，LiteLLM 格式模型 ID |
| `name` / `description` | string | 用户端展示名与描述 |
| `score` | number\|null | 推荐评分 0-10 |
| `reasoning_effort` / `thinking_budget` | string\|int\|null | 思考强度 / 思考 token 预算 |
| `chores_only` | bool | 仅用于 Chores，不在用户端展示 |
| `enabled` | bool | 禁用后用户端与 Chores 均不可用 |
| `is_free` | bool | 免费模型：调用不消耗次数，用户端显示「免费」标签 |
| `free_no_code` | bool | 无码可用：无使用码或次数用尽也能调用（仅免费模型生效） |
| `free_limits` | object | `{minute, hour, day, week, month}` 防滥用限额，0/-1 为不限制 |

---

## 12. 工具 ID 与 Prompt 文件映射

| 工具 ID | 工具名 | Prompt 文件名 |
|---------|--------|---------------|
| 1 | 语篇深度分析 | `语篇深度分析.md` |
| 2 | 言说策略分析 | `言说策略分析.md` |
| 3 | 语篇深度研读报告 | `语篇深度研读报告.md` |
| 4 | 课文语言点讲解 | `课文语言点讲解.md` |
| 5 | 地道表达转述释义 | `地道表达转述释义.md` |
| 6 | 词汇分类教学 | `词汇分类教学.md` |
| 7 | 词块提取与讲解 | `词块提取与讲解.md` |
| 8 | 语法情境教学 | `语法情境教学.md` |
| 9 | 英文写作教学 | `英文写作教学.md` |
| 10 | 学生作文批改 | `学生作文批改.md` |
| 11 | 辅助应用文写作 | `辅助应用文写作.md` |
| 12 | 试卷重点题讲评 | `试卷重点题讲评.md` |
| 13 | 试卷可视化全解 | `试卷可视化全解.md` |
| 14 | 榨干一套英语试卷 | `榨干一套英语试卷.md` |
| 15 | 阅读课教学设计 | `阅读课教学设计.md` |
| 16 | 读写整合教学设计 | `读写整合教学设计.md` |
| 17 | 阅读文本改编 | `阅读文本改编.md` |
| 18 | 阅读文本改编 2 | `阅读文本改编 2.md` |
| 19 | 阅读理解设问 | `阅读理解设问.md` |
| 20 | 阅读理解设问 2 | `阅读理解设问 2.md` |
| 21 | 辅助完形填空命题 | `辅助完形填空命题.md` |
| 22 | 试题解读分析 | `试题解读分析.md` |
| 23 | 英语试题 Bug 侦察 | `英语试题 Bug 侦察.md` |
| 24 | 超标词排查+替换 | `超标词替换.md`（仅替换；排查由机械接口完成） |
| 25 | 自由对话 | `自由对话.md` |
| 26 | 智能错题迁移 | `智能错题迁移.md` |

---

## 13. 模型 ID 格式

使用 LiteLLM 标准格式：

```text
openrouter/google/gemini-2.0-flash
openrouter/anthropic/claude-3.5-sonnet
openrouter/deepseek/deepseek-chat
```

---

## 14. 错误码说明

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未认证或 token 无效/过期 |
| 403 | 使用码被禁用或额度已用尽 |
| 404 | 工具或 Prompt 文件不存在 |
| 422 | 请求体验证失败 |
| 429 | 免费模型超出防滥用限额且无可用使用码（持可用码时自动转为扣次数），或辅助接口请求过于频繁 |
| 500 | 后端内部错误或 LLM 调用失败 |

---

## 15. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-07-24 | 阶段一后端 API 契约初始版本 |
| 0.2.0 | 2026-07-24 | 新增 `/api/chat/title`、模型连接配置字段 |
| 1.1.0 | 2026-07-28 | v1.1：新增使用码认证（`/api/auth/*`）、管理后台 API（`/api/admin/*`）、移除前端 API 设置字段、更新配置管理说明 |
| 1.2.0 | 2026-08-07 | 新增智能错题迁移错因分析、额度预检查与批量并行流式生成 |
| 1.3.0 | 2026-08-10 | 超标词排查改为机械实现（新增 `/api/chat/vocab/check`），替换独立为 `超标词替换.md` Prompt |
| 1.4.0 | 2026-08-30 | 使用日志增强：新增状态 / 耗时 / token 用量 / IP / UA / 扣费次数字段，原始输入与输出按 `log_payload` 开关入库，新增 `/api/admin/logs/summary`、`/api/admin/logs/{id}`、`/api/admin/logs/purge` 与 `log_retention_days` 保留策略 |
| 1.5.0 | 2026-09-04 | 设备指纹（仅用于识别共享，不做拦截依据）：前端经 ThumbmarkJS 上报 `X-Client-Fingerprint` / `X-Client-Fp-Summary`；日志新增 `device_id` / `fingerprint` 并挂载 `device`；日志筛选新增 `device` 参数、聚合新增 `distinct_devices`；新增 `/api/admin/devices` 列表与 `/api/admin/devices/{id}` 备注接口 |
| 1.5.1 | 2026-09-04 | 设备画像详情：新增 `GET /api/admin/devices/{id}`（摘要翻译 profile + 风险 signals + 使用分布 codes/ips/user_agents/tools/models + 最近请求）；管理后台设备行可点开画像抽屉，日志详情可跳转画像 |
| 1.6.0 | 2026-09-12 | 免费模型：模型新增 `is_free` / `free_no_code` / `free_limits` 字段；免费调用不扣次数并在用户端显示「免费」标签；`/api/chat/stream`、`/stop`、`/vocab/check`、`/migration/analyze`、`/migration/quota`、`/api/parse/file` 改为可选认证（免费+无码可用模型可无码调用）；免费模型按身份（使用码 > 指纹 > IP）套用分/时/天/周/月限额，超限返回 429，生成失败不计入限额；未登录用户可浏览全部工具界面，免码调用以 `（免码）` 记入使用日志 |
| 1.7.0 | 2026-09-13 | 使用码重置用量：新增 `POST /api/admin/codes/{id}/reset-usage` 把已用次数清零（剩余次数恢复，使用日志保留）；管理后台使用码操作列新增「重置用量」+ 自研确认弹窗 |
| 1.8.0 | 2026-09-13 | 使用码额度支持有限 ↔ 无限互转（改为无限清零已用；改回有限从 0 起算），生成使用码也可直接指定无限（-1）；免费模型限额命中后，持可用使用码的调用自动转为按次扣减（不再 429），迁移批次同步升级为付费批 |
| 1.9.0 | 2026-09-13 | 使用码不再区分类型：移除 code_type（数据库列在启动时自动迁移删除，历史管理员码保留无限额度，旧 NBXA 码继续有效），管理后台移除类型筛选/展示与创建类型选择；初始使用码改为无限额度普通码并写入 bootstrap_code.txt |
| 1.10.0 | 2026-09-13 | 模型下拉折叠：新增全局配置 `max_visible_models`（0~50，0 = 不折叠），`GET /api/tools/` 随模型列表下发该值，用户端下拉超出后折叠为前 N 个并提供「展开全部」；仅统计可见模型，已禁用与仅 Chores 模型不计入 |
