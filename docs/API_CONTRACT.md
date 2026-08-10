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
- **认证**：除 `/api/auth/activate`、`/api/health`、`/api/config`、`/api/tools/` 外，主站所有接口需在请求头携带 `Authorization: Bearer <token>`。token 通过 `POST /api/auth/activate` 获取。

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
| POST | `/api/chat/vocab/check` | 机械排查超标词：分词 + 课标词表匹配（不扣费） | 是 |
| POST | `/api/chat/migration/analyze` | 非流式分析智能错题迁移错因（不扣费） | 是 |
| POST | `/api/chat/migration/quota` | 预检查智能错题迁移额度（不扣费） | 是 |
| POST | `/api/chat/stream` | 流式调用工具（SSE） | 是 |
| POST | `/api/chat/stop` | 中止流式生成 | 是 |
| POST | `/api/chat/title` | 为生成结果生成标题 | 是 |

### 管理后台接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/admin/stats` | 统计概览 |
| GET | `/api/admin/codes` | 使用码列表 |
| POST | `/api/admin/codes` | 生成使用码 |
| PATCH | `/api/admin/codes/{id}` | 更新使用码（启用/禁用/备注/额度） |
| GET | `/api/admin/logs` | 使用日志列表 |
| GET | `/api/admin/config` | 查看运行时配置 |
| PUT | `/api/admin/config` | 更新运行时配置 |

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
    "code_type": "user",
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
    "code_type": "user",
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
  "models": ["openrouter/google/gemini-2.0-flash"],
  "default_model": "openrouter/google/gemini-2.0-flash",
  "app_name": "NeoBangX",
  "version": "1.2.0",
  "slogan": "Bang助教学，大有可AI",
  "auth_required": true
}
```

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
  "models": ["openrouter/google/gemini-2.0-flash"],
  "default_model": "openrouter/google/gemini-2.0-flash"
}
```

### GET `/api/tools/models`

返回可用模型列表。

**响应：**

```json
{
  "models": [
    {
      "id": "openrouter/google/gemini-2.0-flash",
      "label": "openrouter/google/gemini-2.0-flash"
    }
  ],
  "default_model": "openrouter/google/gemini-2.0-flash"
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

请求体只需提供选中的错因数量 `cause_count`。扣费次数为 `max(1, floor(cause_count / 2))`，预检查不扣费；最终卡片全部成功后由批次流式请求统一扣减。

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
| `done` | `[DONE]` | 生成正常结束 |
| `error` | JSON 字符串 `{"message": "..."}` | 生成过程中发生错误 |

智能错题迁移的同一批请求共享 `batch_id`。后端只有在 `batch_size` 张卡片全部自然完成后，才按 `max(1, floor(batch_size / 2))` 扣减一次额度；任一卡片失败或被停止时不扣减。

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
| `code_type` | `admin` 或 `user` |
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
      "code_type": "user",
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
  "code_type": "user",
  "quota": 10,
  "count": 5,
  "note": "某校教研组"
}
```

说明：`code_type` 为 `admin` 时 `quota` 自动为无限。

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

### 11.5 使用日志

#### GET `/api/admin/logs`

**查询参数：**

| 参数 | 说明 |
|------|------|
| `code` | 按使用码筛选 |
| `tool_id` | 按工具 ID 筛选 |
| `page` | 页码 |
| `page_size` | 每页数量 |

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
      "created_at": "2026-07-28T12:00:00+00:00"
    }
  ]
}
```

### 11.6 查看配置

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
    "timeout": "120"
  },
  "keys": [ ... ],
  "has_llm_api_key": true,
  "has_chores_api_key": false
}
```

### 11.7 更新配置

#### PUT `/api/admin/config`

**请求体：**

```json
{
  "default_model": "openrouter/google/gemini-2.0-flash",
  "models": "model1,model2",
  "llm_api_key": "sk-...",
  "max_tokens": 4096
}
```

说明：API Key 字段若含 `****` 则视为未修改；留空字符串则清除密钥。

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
