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
- **免费模型与无码调用**：模型可被标记为「免费」（限额内调用不扣次数），并可额外开启「无码可用」。当所选模型同时满足两者时，`/api/chat/stream`、`/api/chat/stop`、`/api/chat/vocab/check`、`/api/chat/migration/analyze`、`/api/chat/migration/quota`、`/api/parse/file` 允许不带 token 调用（没有使用码或次数已用尽均可，等价于无码）；未满足条件时按原规则返回 401/403。免费模型的调用按使用码计数（无码时按浏览器指纹、再退回 IP），受模型级防滥用限额约束；**限额命中时若请求携带的使用码仍可用（未耗尽或无限额度），本次调用自动转为按次扣减（不返回 429）**，无码或码不可用时才 429；**生成失败（`status=error`）的调用不计入限额**，用户主动停止或中途断线（`cancelled`）照常计入。转按次计费后的调用仍计入免费限额窗口计数，因此窗口滚动前会持续按次扣减。**Agent 工作台的免费是独立子开关**（`agent_free`，缺省不勾）：主站免费不等于工作台免费，工作台只有勾了该项的模型才不扣次数；两边的防滥用限额也是两个池子——主站按模型调用计次，Agent 按执行轮次计次（`agent_free_limits`），互不占用。

---

## 2. 接口清单

### 主站接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 否 |
| GET | `/api/config` | 前端配置信息 | 否 |
| GET | `/api/tools/` | 工具元数据 + 模型列表 | 是 |
| GET | `/api/tools/models` | 可用模型列表 | 是 |
| POST | `/api/tools/search` | 按自然语言需求推荐工具（Jev 单题判定，不扣额度、不写日志） | 否 |
| POST | `/api/auth/activate` | 验证使用码，返回 JWT | 否 |
| GET | `/api/auth/me` | 当前使用码状态 | 是 |
| POST | `/api/chat/preview` | 预览最终 Prompt | 是 |
| POST | `/api/chat/vocab/check` | 机械排查超标词：分词 + 课标词表匹配（不扣费） | 可选 |
| POST | `/api/chat/migration/analyze` | 非流式分析智能错题迁移错因（不扣费） | 可选（无码需免费+无码可用模型） |
| POST | `/api/chat/migration/quota` | 预检查智能错题迁移额度（不扣费） | 可选 |
| POST | `/api/chat/stream` | 流式调用工具（SSE） | 可选（无码需免费+无码可用模型）；**工具 32（图片识别）必须携带有效使用码** |
| POST | `/api/chat/stop` | 中止流式生成（含免码的免费模型调用） | 可选 |
| POST | `/api/chat/title-jobs` | 幂等创建持久标题任务（最多尝试 3 次） | 是 |
| POST | `/api/chat/title-jobs/status` | 批量对账标题任务 | 是 |
| POST | `/api/chat/title` | 同步标题生成（旧客户端兼容） | 是 |
| GET | `/api/parse/config` | 文档解析配置（是否可用精准解析、体积上限、扫描件确认策略） | 否 |
| POST | `/api/parse/file` | 上传 PDF / Word / TXT 解析成文字（扫描件返回 409 待确认；超体积 413；缺 MinerU Token 503；解析失败 502） | 可选（无码需免费+无码可用模型） |
| POST | `/api/ocr/pair` | 建立手机扫码配对会话（返回 token 与手机页路径；请求体可选带电脑端主题 `theme` / `sky`） | 是（需有效使用码） |
| POST | `/api/ocr/pair/{token}/hello` | 手机页报到（电脑端据此显示「手机已连接」；回传 `theme` / `sky` 供手机页定色） | token 即凭证 |
| GET | `/api/ocr/pair/{token}/events` | 电脑端 SSE：等待扫码 → 已连接 → 已收到 N 张（只推状态，无终态，收尾只有过期） | token 即凭证 |
| POST | `/api/ocr/pair/{token}/upload` | 手机端直传一张照片（内存暂存，不落盘） | token 即凭证 + 按 IP 限流 |
| GET | `/api/ocr/pair/{token}/image?i=N` | 电脑端读取第 N 张原图字节（内存直出） | token 即凭证 |
| DELETE | `/api/ocr/pair/{token}` | 释放内存里的照片（清空批次、离开工具时调用） | token 即凭证 |
| GET | `/m/upload?token=...` | 手机拍照上传页（免登录，短地址便于手输兜底） | token 即凭证 |

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
| GET | `/api/admin/logs/{id}/steps` | 请求内部调用分页（框架、精讲与自动补全） |
| GET | `/api/admin/logs/{id}/payload/{part}` | 原始数据按字符分页读取 |
| GET | `/api/admin/logs/{id}/payload/{part}/download` | 下载单段原始数据全文 |
| GET | `/api/admin/devices` | 设备指纹聚合列表（短码/备注/昵称搜索） |
| GET | `/api/admin/devices/{id}` | 单设备画像详情（摘要翻译 + 使用分布 + 最近请求） |
| PATCH | `/api/admin/devices/{id}` | 更新设备备注（全局） |
| POST | `/api/admin/logs/purge` | 手动清理过期日志 |
| GET | `/api/admin/config` | 查看运行时配置 |
| PUT | `/api/admin/config` | 更新运行时配置（含日志开关与保留天数） |
| GET | `/api/admin/mirror/status` | 线路镜像可用性检测（代测两条线路的 /api/health） |

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
      "aa_index": 85,
      "reasoning_effort": null,
      "thinking_budget": null,
      "user_usable": true,
      "ocr_usable": false,
      "chores_usable": true,
      "agent_usable": false,
      "enabled": true,
      "is_free": true,
      "free_no_code": true,
      "agent_free": false,
      "free_limits": { "minute": 3, "hour": 30, "day": 0, "week": 0, "month": 0 },
      "agent_free_limits": { "minute": 0, "hour": 30, "day": 100, "week": 0, "month": 0 }
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
| `user_usable` | bool | 用户可用：出现在 8000 用户端的模型列表里（缺省 true） |
| `ocr_usable` | bool | 用于 OCR：可作为「识别图片文字」的识别模型（缺省 false） |
| `chores_usable` | bool | 用于 Chores：可作为标题生成等轻量任务的模型（缺省 true） |
| `agent_usable` | bool | Agent：出现在 `/agent` 工作台的模型列表里（缺省 **false**，只能由管理后台显式勾选） |
| `enabled` | bool | 禁用后用户端、OCR、Chores 与 Agent 全不可用，是四项用途的上一级开关（缺省 true） |
| `is_free` | bool | 免费模型：限额内调用不消耗使用码次数，用户端模型列表显示「免费」标签；限额命中后持可用使用码时转按次扣减 |
| `free_no_code` | bool | 无码可用：没有使用码或次数已用尽时仍可调用（仅在 `is_free` 为真时生效） |
| `agent_free` | bool | Agent 免费：在 `/agent` 工作台执行不扣次数（仅在 `is_free` 为真时生效，**缺省 false**） |
| `free_limits` | object | 主站防滥用限额，键为 `minute` / `hour` / `day` / `week` / `month`，0 或 -1（含负数）= 不限制；按模型调用计次 |
| `agent_free_limits` | object | Agent 防滥用限额，同一组键；按**执行轮次**计次、只统计工作台的行，与 `free_limits` 分池 |

模型用途是**四个能力位**（`user_usable` / `ocr_usable` / `chores_usable` / `agent_usable`），`enabled=false`
是它们的上一级开关。历史数据里只有旧的「仅 Chores」单开关时，读取侧自动迁移为
`user_usable=!chores_only`、`ocr_usable=false`、`chores_usable=true`；响应中不再出现
`chores_only`。`models` 为旧版逗号分隔格式时，每个模型按上述缺省值补齐
（用户可用 + 用于 Chores，不默认开放 OCR）。
**`agent_usable` 不参与任何历史迁移**：缺键一律读成 false —— Agent 的模型清单只能由管理员
显式勾选，升级后需要去「模型管理」逐个勾上「Agent」并保存（否则工作台没有可选模型）。

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
      "title": "备课与教学",
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
      "aa_index": 85,
      "is_free": true,
      "free_no_code": true
    }
  ],
  "default_model": "openrouter/google/gemini-2.5-flash",
  "max_visible_models": 5
}
```

`is_free` 表示免费模型（限额内不扣次数，限额命中后持可用使用码时转按次扣减），
`free_no_code` 表示该模型无码可用；前端据此在模型下拉中渲染「免费」与「免码」两个标签
（免码模型必然也是免费模型，两个标签并列），并在无使用码时默认选中可免码试用的模型。

`max_visible_models` 为管理后台配置的模型下拉最大显示数（`0` = 不折叠）。
`models` 已过滤掉**已禁用**与**未勾选「用户可用」**的模型，因此该数组长度就是折叠计数的基数，
前端按 `min(长度, max_visible_models)` 渲染，超出部分折叠为「展开全部」。

### POST `/api/tools/search`

按自然语言需求推荐工具。用 Jev（TypeSafe System One 决策模型）的一次 choice
题型判定把「老师的一句话」映射到最合适的工具；Jev 未启用、未配齐、超时（上限
5 秒，切到工具搜索即取 `min(jev_timeout, 5)`）、报错或回包无法解析时，立即
回退到本地关键词匹配（中文按字符 bigram 重叠打分，零新依赖）。任何情况下都
返回 200 与一份可展示的结果。

- **认证：** 否（与 `GET /api/tools/` 同理由：只做导航，未登录用户也可浏览工具）。
- **不扣额度、不写使用日志**（不污染管理后台统计与免费模型限额），但按主体
  （使用码 > 指纹 > IP）限速：`tool_search` 桶 30 次 / 60 秒，超限返回 429。
- **缓存：** 进程内缓存（TTL 600 秒，最多 256 条；键含工具目录指纹），命中
  `cached: true`，不消耗 Jev 调用。
- **后台开关：** `jev_tool_search_enabled`（管理后台「Jev 错误判定」卡片，
  字符串 `"true"`/`"false"`，缺键按 `"true"`）可单独关闭本端点的 Jev 判定，
  不影响 Jev 的错误重试判定。

**请求体：**

```json
{ "query": "帮我把这篇学生作文批改一下", "limit": 3 }
```

- `query`：自然语言需求描述（不是工具名检索词），去空白后少于 2 字返回 400
  「请多说几个字…」，最长 200 字。
- `limit`：返回条数上限，1~8，缺省 3。

**响应：**

```json
{
  "results": [
    {
      "tool_id": "10",
      "name": "学生作文批改",
      "icon": "correction",
      "description": "评分 + 修改建议 + 改进版本",
      "group_id": "teaching",
      "group_title": "备课与教学",
      "score": 0.9231,
      "source": "jev",
      "reason": "评分 + 修改建议 + 改进版本"
    }
  ],
  "fallback": false,
  "no_match": false,
  "uncertain": false,
  "cached": false,
  "latency_ms": 214,
  "jev_available": true
}
```

- `results[].source`：`"jev"`（Jev 选中）或 `"keyword"`（关键词兜底）。
- `fallback: true`：本次走了关键词兜底；`jev_available` 同时为 `false`，
  前端据此把结果标注为「按关键词匹配」。
- `no_match: true`：Jev 明确选了「以上都不合适」（候选里的兜底选项 25
  「自由对话」），返回的是关键词近邻；前端给出「没有合适的工具，试试自由对话」。
- `uncertain: true`：Jev 置信度低或前两名概率难分；前端提示「不太确定」，
  且**不触发本地兜底重选**（宁可直接展示低置信结果，不做二次猜测）。
- `results[].reason`：Jev 不生成文字，所以「为什么推荐」直接取该工具自己的
  用途描述（`description`），不是模型编的推荐语；UI 也照实展示这一点。
- 假后端（`backend/mock_backend`）打桩了同形响应，查询首行写 `#mock` 场景指令
  可演示 `fallback` / `slow` / `error` / `empty` 四种边界；测试
  `backend/tests/test_mock_backend.py` 以 `SEARCH_RESPONSE_SHAPE` 断言两端
  契约同形。

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
      "aa_index": 85,
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
  "input": "用户输入的英语语篇",
  "continue_from": "已生成但被中断的正文（只有预览续写请求时才传）"
}
```

**成功响应：**

```json
{
  "tool_id": "1",
  "prompt_filename": "语篇深度分析.md",
  "prompt": "# 系统角色\n...\n# 用户输入\n\n用户输入的英语语篇\n...",
  "messages": null
}
```

传了 `continue_from` 时 `messages` 是实际会发出去的三段消息（见 8.1），否则为 `null`。

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
| `input` | string | 否 | 用户输入文本；**除工具 32 外必填**（为空返回 400） |
| `model` | string | 否 | 模型 ID，为空则使用后端默认模型；工具 32 忽略该字段（用后台配置的 OCR 模型） |
| `request_id` | string | 否 | 客户端生成的请求 ID，用于后续调用 `/api/chat/stop` 中止生成 |
| `batch_id` | string | 否 | 智能错题迁移批次 ID；同一批卡片使用相同值 |
| `batch_size` | integer | 否 | 智能错题迁移批次内错因卡片总数 |
| `batch_index` | integer | 否 | 当前卡片在批次内的序号，从 0 开始 |
| `continue_from` | string | 否 | 已生成但被中断的正文；传入即表示本次接着它续写（见 8.1） |
| `visual_question_nos` | string[] | 否 | **工具 13**：骨架续写时待补全的题号，1–1000 项，每项为 1–3 位数字字符串；后端校验非空、无重复且均属于骨架，错误请求在模型调用与计费前拒绝；不能与 `continue_from` 同用 |
| `images` | string[] | 否 | **工具 32**：图片 data URL 列表（`data:image/jpeg;base64,...`），最多 12 张、单张 ≤3MB、合计 ≤16MB；与 `pair_token` 二选一 |
| `ocr_mode` | string | 否 | **工具 32**：`printed`（印刷试卷，默认）/ `handwritten`（手写作文），决定用哪份提示词。前端按**当前所在工具**决定：作文批改（10）→ `handwritten`，其余工具（含试卷类 12 / 13 / 14 / 23）→ `printed`；只有识别图片文字（32）与自由对话（25）两种素材都可能出现，由用户在界面里选 |
| `pair_token` | string | 否 | **工具 32**：扫码配对会话 token，图片由服务端内存直读、不再回传；与 `images` 二选一 |
| `pair_order` | integer[] | 否 | **工具 32**：扫码照片按哪个顺序送进模型（会话内下标序列）。电脑端排序、删除后只传这个序列，图片字节不重传；不传即按手机上传顺序。仅 `pair_token` 来源可用 |
| `source_lang` | string | 否 | **工具 33**：源语言名，`auto` 表示自动检测；渲染进提示词的 `{{source_lang}}`。前端送的是语言名（`简体中文` / `English (US)`）而不是语言代码，模型解析更稳 |
| `target_lang` | string | 否 | **工具 33**：目标语言名，渲染进提示词的 `{{target_lang}}`；缺省回落到 `简体中文`。续写/重试同样要带上，模型才知道接着译成什么 |

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
| `truncated` | JSON 字符串 `{"limit": 8192, "completion_tokens": 8100, "finish_reason": "length"}` | **所有工具**：本次输出撞到了上限（工具 32 用 `ocr_max_tokens`，其余用全局 `max_tokens`），结果可能不完整。判据有两条：上游回传 `finish_reason=length`（权威），或 `completion_tokens` 达到上限的 95%（供应商不回传结束原因时的兜底）。前端据此在结果区给出「继续生成」出口、把记录标成「待补全」，不静默交付半份内容（工具 13 有自己的完整性提示，不再重复展示） |
| `stage` | JSON 字符串 `{"name": "framework" \| "explain", "framework": true, "reset": false}` | **工具 13**：两阶段生成的阶段切换。`framework` = Chores 模型正在插标解析结构（此后的 `token` 是派生的 `@@TAG@@` 骨架）；`explain` = 主模型开始写讲解。`framework` 为 `false` 表示框架解析失败、已回退单阶段老路径；`reset: true` 要求丢弃本轮已发出的残缺骨架，保留续写前的正文。标记失配、漏题、输出触顶或异常时回退原卷，停止生成时保留残片。详见 12.1 |
| `explaining` | JSON 字符串 `{"model": "..."}` | 失败已经发生、后端正在把报错转写成给用户看的两句话（Chores 模型，总预算见下）。**非终态事件**：前端收到后立刻停止显示「生成中」（状态条改为「生成没有成功，正在整理说明…」、收起停止按钮），随后由 `error` 事件给出结论 |
| `done` | `[DONE]` / `[CANCELLED]` | 生成结束；`[CANCELLED]` 表示用户停止或客户端断开 |
| `visual_task` | JSON 字符串 `{"id":"1","nos":["21","22"],"active_nos":["22"],"state":"running","completed":["21"],"attempt":2,"max_attempts":3,"issues":{},"fallback":null}` | **工具 13**：题目进度。状态为 `pending` / `running` / `retrying` / `done` / `incomplete` / `error` / `cancelled`；`completed` 为完整题号，`issues` 为按题号列出的缺失字段。`fallback` 格式同全局事件且不含供应商信息，由该任务自己的正文或结束事件清除 |
| `error` | JSON 字符串 `{"message": "...", "advice": "...", "code": "provider_busy", "model": "..."}` | 生成过程中发生错误（含全部 Provider 均失败）。`message` 是给用户看的「发生了什么」，`advice` 是「该怎么做」，两者都由 Chores 模型转写（见下），**不含上游原文**；`code` 是机器可读分类（`context_overflow` / `content_blocked` / `provider_auth` / `provider_busy` / `timeout` / `network` / `unknown`）供前端选动作与后台统计——前端据此收起「注定失败的重试」（超限/内容拦截/密钥权限）并把「编辑输入」提为主按钮，后台日志表按它显示中文分类角标；`model` 供前端失败归因。**失败分类与上游结束原因随使用日志落库**（`usage_logs.error_code` / `usage_logs.finish_reason`，`finish_reason=length` 即撞输出上限），因此后台可以统计错误分布与截断率。 |

**Provider 切换（fallback）：** 同一逻辑模型可绑定多个 Provider（管理后台按优先级排序）。切换判定分三层：① 精确程序化——异常类名（litellm 已解析）、数字 HTTP 状态码、空响应/超时语义完全确定的，直接判定，不问 Jev（如 401/403/404/429/5xx 直接切；超限/审核异常类、413 直接不切；400/422 性质存疑除外）；② Jev 决策模型（管理后台「Jev 错误判定」可配：开关 + 端点 + 模型名 + 超时，默认关闭）——只问真正模糊的，一次请求内并行问两道 Noul（是否超限、是否被过滤），只有比较确信（> 0.7）是"换谁都一样"才不切，拿不准一律切；③ Jev 关闭、未配齐、超时（默认 4 秒，可配 2~30 秒）、报错或回包无法解析时**立刻回退到程序化启发式**（与 Jev 规则同义的关键词匹配），不重试 Jev、不阻塞主流程。判定是 await 住的：结论出来前不产生任何 SSE 事件，前端停留在加载/切换进度态，只是晚几秒收到结论——`error` 事件永远只发一条，不存在先收到一个错误又变成另一个的突变。流式生成中，单家 Provider 等待**第一个数据块**的上限由全局配置 `first_token_timeout`（默认 30 秒，管理后台「全局调用参数」可改）决定，超时即判该家失效并切下一家；首个数据块到达后改由 `timeout` 按块判定，不会掐断正在出字的流。**快重试（quick retry）**：失败属「确定瞬态」类（超时/空响应/429/5xx/连接类等）且本次失败很快（耗时 < 2 秒，慢速挂起绝不重试）时，先延迟约 250ms（±50% 抖动；带 `Retry-After` 则按它等待，超过 3 秒放弃快重试直接切）在**同一家**重试一次（每家每次请求最多 1 次，链尾单家同样适用；快重试的首块等待收紧到 10 秒上限），成功则继续输出、前端全程收不到任何额外事件，失败才切下一家；上下文超限/内容审核/413 类错误从不快重试。**首块总预算**（默认 45 秒）从第一家开始计时，同时约束后续家的首块等待（剩多少预算只等多少，预算耗尽后每家只给 5 秒最小机会，纯切换仍允许），全链最坏总等待接近预算而不是每家各等满 `first_token_timeout`。**进程级熔断器**（跨请求健康记忆）：某家在 60 秒窗口内被放弃的瞬态失败（快重试用尽后才算 1 次）≥2 次即熔断 OPEN 30 秒，期间后续请求把它沉到链尾（不是剔除，全链失败时仍会兜底试它）；冷却后转半开只放一个请求探测（并发请求跳过它），探测成功即恢复、失败则再次熔断并指数退避（封顶 300 秒），任意成功立即清零。熔断重排以调用方给定的通道顺序为基底（含并发执行器的 `providers_override`），只做沉底不动其余相对顺序。上述阈值当前为内置默认值，管理后台配置项可后置。已经吐出正文后再失败则不切换（避免两家内容拼接），直接以 `error` 事件结束。标题后台任务的「稍后重试还是直接失败」同样三层（状态码表先行；模糊的并行问四道：瞬态必须明确成立且三类否决明确不成立才重试），不可用时回退状态码规则。

**报错解读（error 事件的那两句话）：** 上游报错原文来自各家供应商，措辞千奇百怪；直接把它给用户看，或压成一句「生成失败，请稍后重试」，都回答不了用户真正要问的「要不要重试、换不换模型、要不要找管理员」。所以失败时后端**先**发一条 `explaining` 事件（前端立刻停止显示「生成中」，见上表），再把失败事实（工具 / 模型 / 阶段 / HTTP 状态 / 脱敏后的上游原文）交给 Chores 模型，按 `prompts/报错解释.md` 的规则转写成两句中文：第一行「发生了什么」（≤30 字），第二行「该怎么做」（≤40 字），分别填进 `message` 与 `advice`。**Chores 不可用时**（未配、报错、超时、回包不合契约）用同一套三层判定决定「要不要再试一次」（精确判定 → Jev → 机械兜底），最多尝试 3 次；仍失败则用机械映射（HTTP 状态 + 关键词 → 中文）给出同义文案，保证 `message` 与 `advice` 一定有内容、绝不抛异常。**这一步有总时长预算（默认 3 秒，单次调用上限 2 秒，剩余预算不足 1 秒就不再重试）**：解释是补充信息，不能让用户对着「正在整理说明…」干等——「每次 8 秒 × 3 次」那种写法最坏要等 24 秒，是把体验做坏的写法。同类错误命中进程内缓存（成功 1 小时、兜底文案 2 分钟），失败成批出现时不必每次都花一次调用。**推理等级**按「模型自身默认 + 管理后台工具推理规则覆盖」解析：报错解读注册为 Chores 工作 `error_explain`（「工具推理规则 → Chores 工作 → 报错解读」），关闭推理要写 `off` 还是 `none` 由你按模型配，后端只透传、不做任何硬编码；规则选「直接失败」且该模型不支持推理时，直接跳过 Chores 用机械文案（解释是补充信息，这里没有「拦下请求」可做）。发给模型的原文先脱敏（隐去 URL 与凭据），上游原文只进日志、不回传终端用户。

智能错题迁移的同一批请求共享 `batch_id`。整批价为 `max(1, floor(batch_size / 2))`，按**已交付卡片数**等比摊分：每张卡片交付时立刻扣掉摊到自己头上的那部分增量，累计摊到第 k 张的值为 `max(1, floor(charge_units × 已交付数 / batch_size))`，整批收齐时正好等于整批价。中途停止、客户端断开或只请求了部分卡片，都只是不再累加——**已产出正文的卡片照扣**，因为正文已经推给前端并写进了历史，收不回来；一个字都没产出就失败的卡片不扣费。免费模型的批次整批按 0 次结算；若生成途中部分卡片命中免费限额转为按次计费，**整批升级为付费批**并按上式扣减（额度不足支付整批时该卡返回 403 结构化 detail `{message, required, remaining}`，批次不扣费）；已升级的批次不会因限额窗口滚动再降回免费。

**日志留痕：** 无论成功、用户停止还是异常，每次 `/api/chat/stream` 调用都会在服务端留下主使用日志（见 11.6）。智能错题迁移的每张卡片各记一条日志，其 `units` 为该卡实际扣减的增量（摊分未跨过整数档位的卡片记 0）。试卷全解另记框架调用与并行精讲任务日志，计费与 token 归属见 12.1。

### 8.1 续写（`continue_from`）

生成中断（报错或用户手动停止）后，前端点「继续生成」时把**已经生成的那段正文原样回传**（字段 `continue_from`），请求体里的 `input` 仍是原始输入。后端据此把发给模型的消息组装成三段，而不是把正文拼进用户输入：

```text
[user:      原始 prompt（与首次请求逐字节相同，供应商侧前缀缓存仍命中）]
[assistant: 已中断的正文]
[user:      续写指令 prompts/继续生成.md]
```

- **指令文件解析顺序**：先找 `prompts/<工具名>续写.md`（按工具定制），不存在则回退共用的 `prompts/继续生成.md`；两个都没有时返回 **404** 且不发起调用——静默按普通重试放行会让用户点「继续生成」却拿到整篇重写。
- **计费、限额、推理强度规则、停止事件与日志**与普通请求完全一致，续写就是一次普通调用。
- **不传该字段**（或只传空白）时消息序列与从前完全一致（单条 user 消息）。
- **试卷可视化全解（id 13）不使用该字段**：它的续写指令由前端按解析出的结构拼（进度 / 板块 / 语篇编号），见 12.1。

### 8.2 图片识别（工具 32）

「识别图片文字」走同一条 `/api/chat/stream`，但请求形态与准入规则单独一套：

- **准入**：必须携带**有效使用码**（无码 401、码被禁用或额度已用尽 403）——识别是付费的视觉调用，不开放匿名入口；未过闸的请求不会走到取图那一步。
- **限流**：按主体（使用码 / 指纹 / IP）滑动窗口，`RATE_LIMITS["ocr"] = (10, 60)`，超限 429「请求过于频繁，请稍后再试」。
- **计费**：**始终不计费**——不扣使用码次数、不占免费模型防滥用额度（使用日志 `units` 恒为 0，`tool_name` 记为「识别图片文字」，`input_text` 记为 `[图片 N 张]`，便于事后核算视觉成本）。
- **模型**：用后台配置的 `ocr_model`（留空跟随默认模型），忽略请求里的 `model`；该模型必须启用且至少绑定一个可用 Provider，否则 400 并在 detail 里指明；**留空跟随默认模型时，默认模型还必须勾选「用于 OCR」**（`ocr_model_configured=false` 且默认模型无该项能力时返回 400，提示去后台指定视觉模型或为默认模型补上该项）——否则等于拿一个不认图的模型去识别，只会在上游报一堆看不懂的错。
- **消息组装**：单条 user 消息，`content` 为内容数组——先一段 `{"type":"text"}`（该模式的提示词全文），随后每张图一个 `{"type":"image_url","image_url":{"url":"data:image/…;base64,…"}}`。多张图属于同一份试卷，提示词里要求按顺序连续转录成一份文本。
- **图片校验**：只接受 `data:image/jpeg|png|webp;base64,…`；逐张做魔数嗅探（内容与声明不符即 400），拒绝 http(s) 外链与其它类型。
- **输出上限**：`max_tokens` 显式取 `ocr_max_tokens`（默认 8192）；撞上限时先发一个 `truncated` 事件再 `done`。
- **两种识别模式**对应两份提示词文件（见 12 的映射表），`ocr_mode` 非法值返回 400。选哪一种由前端按工具用途决定（服务端只认这两个取值，不做工具绑定校验）：会收到学生手写稿的只有「学生作文批改」，其余工具收到的都是原卷印刷稿；只有识别图片文字（32）与自由对话（25）由用户在界面上选。

图片的两条来源：

1. **随请求上传**（`images`）：文件选择 / 相册 / 相机拍摄，前端统一压到长边 ≤2000、JPEG 0.85 后转 data URL。
2. **扫码配对**（`pair_token`）：手机拍完直传服务器内存，电脑端预览 `GET …/image?i=N` 只下载一次，识别请求只带 token——一张照片最多过网两次（上行一次、下行预览一次），不落盘、不经电脑转手。**决策全在电脑端**：手机只负责拍与传，没有任何「我拍完了」之类的动作（`/pair/{token}/finish` 已移除）——电脑端收到第一张照片就收起配对窗口并落到「开始识别」，会话与 SSE 照旧活着，手机想拍多少张就收多少张；排序 / 删除通过 `pair_order` 表达，识别类型（按所在工具定）与开始识别都由电脑端决定，想再多拍几张只要晚点按「开始识别」即可。

送出去之前，图片可以在电脑端做一次轻度编辑：点图放大即是编辑器，能把拍歪的试卷转正、把桌面与边缘裁掉。
旋转与裁剪在同一次画布运算里完成（只重新编码一次），编辑后的字节替换掉原图，`images` 里带的始终是当前这一版——
字段形态、张数与体积上限都不变，服务端无需另设接口。裁剪结果小于原图是正常的（这正是它的目的：把无效边缘去掉，
让视觉模型把像素花在正文上）。

### 8.3 扫码配对接口（`/api/ocr/pair*`）

配对只解决「让手机把照片送上来」：手机是纯上传方，没有「我拍完了」这类动作（`/finish` 已移除），
电脑端决定何时开始识别，因此 `/events` 只推状态、没有终态。手机页配色跟随电脑端当前主题
（`paper` / `celadon` / `obsidian` / `jade` / `sora`，与前端 `THEMES` 同源）：

- **POST `/api/ocr/pair`**（需有效使用码）请求体可选 `{"theme": "jade", "sky": ""}`——`theme` 白名单之外的值一律退回默认主题 `paper`；`sky` 只有 `sora` 认（`day` / `night`），其它主题下忽略。返回的 `path` 形如 `/m/upload?token=…&theme=jade`，绝对地址仍由前端用 `location.origin` 拼。
- **POST `/api/ocr/pair/{token}/hello`** 除计数外回传 `theme` / `sky`，手机页用会话里的这份权威值最终定色（网址参数只负责首屏不闪）。
- **GET `/api/ocr/pair/{token}/events`** 推 `{state: waiting|connected, count, expires_in}`；照片每到一张推一帧，直到会话过期（推一帧 `error` 后收尾）或客户端断开。没有「完成」帧。
- `theme` 是用户可控输入，服务端只按白名单取用，绝不原样写回页面。

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

标题生成使用持久任务接口。任务一经数据库接受，便由后端 worker 独立执行；浏览器刷新、关闭或切换线路不会中止任务。

### POST `/api/chat/title-jobs`

幂等创建标题任务。`job_id` 由客户端生成，同一使用码下重复提交相同内容会返回原任务，不会重复调用模型；同一 ID 提交不同内容返回 409。

**请求头：** `Authorization: Bearer <token>`

**请求体：**

```json
{
  "job_id": "title_1750000000_ab12cd34",
  "history_id": "1750000000_ab12cd",
  "tool_id": "1",
  "input": "用户输入的英语语篇",
  "output": "模型生成的结果摘要",
  "model": null
}
```

**响应（HTTP 202）：**

```json
{
  "job_id": "title_1750000000_ab12cd34",
  "history_id": "1750000000_ab12cd",
  "status": "pending",
  "title": "",
  "created": true
}
```

任务最多执行 3 次（包含第一次）。网络错误、超时、429、5xx 和空标题会按退避策略重试；认证、参数、模型配置、上下文超限和内容审核等错误不重试。终态失败不返回错误提示，客户端继续显示原文摘要即可。

客户端会先把生成正文和本机补交日志（`nbx_title_jobs`）落盘，再异步调用本接口；因此关页时即使请求尚未送达，下次打开也会用同一 ID 补交。该本机日志不参与导入或线路镜像，镜像/导入数据中的 pending 字段不能触发新的 LLM 任务。服务端先查询已接受的同 ID 任务，再执行限流与当前配置校验，因此响应丢失后的幂等重投不受配置变化或限流影响。

### POST `/api/chat/title-jobs/status`

批量查询当前使用码下的标题任务，单次最多 100 个 ID。页面刷新后用本地持久化的 job ID 对账。

**请求体：**

```json
{
  "job_ids": ["title_1750000000_ab12cd34"]
}
```

**响应：**

```json
{
  "jobs": [
    {
      "job_id": "title_1750000000_ab12cd34",
      "history_id": "1750000000_ab12cd",
      "status": "succeeded",
      "title": "语篇深度分析",
      "payload_hash": "服务端内容指纹"
    }
  ]
}
```

`status` 可能为 `pending`、`running`、`succeeded`、`failed` 或 `missing`。

### POST `/api/chat/title`（兼容旧客户端）

旧同步接口继续保留，直接返回 `{"title": "..."}`。新前端不使用该接口。

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

列表与顶部汇总以用户请求为单位：试卷的框架、并发和补全调用通过 `parent_log_id` 关联主记录，不单独刷入列表。主记录返回 `step_count`，展示的 Token 包含内部调用；数据库只在实际调用上保存用量，避免重复计算。模型和供应商筛选同时匹配内部调用；状态、耗时、扣费显示整次请求的最终结果。旧版本框架和分片记录在启动时按请求 ID 与用户关联回主记录，保留原始数据。

`GET /api/admin/logs/{id}/steps` 返回 `{items,total,page,page_size}`，默认每页 50 条，最多 100 条。子记录包含 `parent_log_id`、`step_name`、`step_meta`（题号、尝试轮数、缺失项、结束原因），不携带大段原始数据；点击调用后复用日志详情和原始数据分页接口。日志保留期清理主记录时一并清理关联调用与原始数据。

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
| `include_summary` | 默认 `false`；设为 `true` 时额外返回 `summary`（结构同 `/logs/summary`），列表总数复用汇总计数，避免重复扫描 |

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
| `status` | `success` 正常完成 / `cancelled` 用户停止、客户端断开，或流被 `aclose` 关闭 / `error` 上游或内部异常 |
| `error_message` | 异常摘要，最长 500 字（超出截断）；正常为空串 |
| `duration_ms` | 从发起到流结束的墙钟耗时；旧数据为 `null` |
| `prompt_tokens` 等 | 供应商回传的 token 用量；未开启流式 usage 或供应商不支持时为 `null` |
| `ip` | 客户端 IP，反代后按 `X-Real-IP` > `X-Forwarded-For` 首跳 > 直连地址取值 |
| `units` | 本次请求**实际扣减**的额度次数。普通工具成功/停止 = 1（免费模型限额内为 0，限额命中转按次计费为 1）；标题生成、错因分析 = 0；智能错题迁移单卡 = 该卡摊到的增量（摊分未跨过整数档位时为 0，整批累计等于整批价）。**不变量：`status=success` 必然已扣费**，不会出现「成功却记 0 次」的幽灵行 |
| `device_id` / `fingerprint` | 浏览器设备指纹（仅用于识别共享，不做拦截依据）。`device_id` 为 `null` 表示当时无指纹（旧数据/上报失败）；`fingerprint` 为 ThumbmarkJS 全哈希冗余。列表与详情额外挂载 `device` 对象（含短码/昵称/备注/颜色/摘要），缺失时为 `null` |
| `agent_steps` / `agent_mode` / `agent_available` | 仅 `tool_id=agent` 的行：本轮已落下的步骤数、执行模式、运行记录是否还在。`agent_available=false` 表示使用码删除后级联清掉了工作台数据，前端只能回到普通详情 |
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

默认 `include_payload=true`，`payload` 为 `null` 表示该次请求未开启原始数据记录（或记录功能当时处于关闭状态）。
单段内容最长 60000 字，超出部分截断。`device` 为 `null` 表示当时无指纹。

`tool_id=agent` 的日志额外返回 `agent_available`（对应 `workspace_runs` 是否还在；删除使用码会级联清理，
此时只能看元数据）。管理后台使用 `include_payload=false` 仅读取元数据：此时 `payload` 恒为 `null`，额外返回 `payload_sizes`（如 `{"input": 60000, "prompt": 60000, "output": 12000}`）；未记录原始数据时 `payload_sizes` 为 `null`。长度统计在数据库内完成，响应不携带原始数据全文。

#### GET `/api/admin/logs/{log_id}/payload/{part}`

`part` 只能为 `input` / `prompt` / `output`。`offset` 为从 0 开始的 Unicode 字符偏移，默认 0；`limit` 默认为 4096，范围 1–8192。返回 `{"text": "当前页内容", "total": 60000, "offset": 0, "limit": 4096}`。偏移超出全文时 `text` 为空字符串；日志或原始数据不存在时返回 404；参数无效时返回 422。

#### GET `/api/admin/logs/{log_id}/payload/{part}/download`

返回该段完整记录，类型为 `text/plain; charset=utf-8`，下载文件名为 `log-{log_id}-{part}.txt`。用于主动复制全文或下载，不受分页限制。日志或原始数据不存在时返回 404；`part` 无效时返回 422。

### 11.6.1 Agent 运行全解

Agent 工作台的一轮执行在 `usage_logs` 里只有**一条**记录（`tool_id="agent"`，
`request_id` 即 `workspace_runs.id`），过程细节在 `workspace_*` 表。这三个接口
把一轮执行还原成可逐步查看的步骤序列，供管理后台的「运行全解」使用。

Agent 轮次**不写**主站 `log_payloads`，所以日志详情的 `payload` 恒为 `null`；
每一步的上下文、工具参数与输出都从 `workspace_chunks` 按需读取。
接口只读，不提供删除 / 重跑 / 修改。

#### GET `/api/admin/logs/{log_id}/agent-run`

- 404：日志不存在。
- 400：日志的 `tool_id` 不是 `agent`。
- 404：日志存在的，但对应运行记录已被删除（删除使用码会级联清理工作台数据）。

**响应（节选）：**

```json
{
  "log": { "id": 1, "tool_id": "agent", "status": "success", "...": "同日志详情 to_dict" },
  "device": { "id": 7, "short_code": "FP-AB12-CD34", "...": "同设备摘要" },
  "task": { "id": "eef4450a…", "title": "高二英语·读后续写专项讲评", "goal": "…" },
  "run": {
    "id": "d879894a…", "mode": "execute", "status": "completed", "step": 5, "tokens": 128000,
    "error": "", "created_at": "…", "started_at": "…", "finished_at": "…", "duration_ms": 96000,
    "live": false, "model": "deepseek-v4", "provider": "openrouter", "preferred_provider": "deepseek",
    "switches": [{ "from": "deepseek", "to": "openrouter", "step": 4 }],
    "instruction": "重点讲第三段的情节推进", "base_version": { "id": "…", "title": "…", "chars": 1024 },
    "usage": { "prompt": 182000, "cached": 141000, "completion": 12800, "cached_reported": true },
    "limits": { "max_tokens": 2000000, "max_steps": 40, "output_tokens": 32000, "max_seconds": 3600,
                "context_budget": 262144, "keep_tail_steps": 4 },
    "versions": [{ "id": "…", "title": "读后续写讲评稿", "chars": 12000, "complete": true, "origin": "agent" }]
  },
  "summary": { "entries": 5, "model_calls": 2, "tool_calls": 1, "reviews": 1, "compactions": 1,
               "waiting": 0, "text_chars": 51234 },
  "entries": [
    {
      "id": "…", "kind": "model", "label": "执行步骤 1", "status": "done",
      "created_at": "…", "offset_ms": 1200,
      "details": { "usage": { "prompt_tokens": 45210, "completion_tokens": 3220 },
                   "cached_tokens": 38000, "provider_id": "deepseek", "attempts": 1,
                   "context_tokens": 45210, "finish_reason": "stop" },
      "text_sizes": { "prompt": 8452, "output": 620, "reasoning": 120 }
    }
  ]
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `run.tokens` | 本轮**计费口径**消耗（未命中缓存的输入 + 输出），不是原始 token 总数 |
| `run.usage` | 原始上报用量；`cached_reported=false` 表示上游没回传命中信息，前端显示「未上报」而不是 0 |
| `run.live` | `finished_at` 为空即为运行中，前端会轮询刷新 |
| `run.switches` | Provider 切换记录 `{from,to,step}`；只在换过家时出现 |
| `entries[].kind` | `model` / `review` / `tool` / `compaction`（步骤序列按创建时间升序） |
| `entries[].offset_ms` | 相对本轮开始的时间偏移，前端显示为 `+12.3s` |
| `entries[].details` | 步骤原始详情：`usage`、`provider_id`、`attempts`、`cached_tokens`、`error`、压缩统计、提问/回答等 |
| `entries[].text_sizes` | 各类正文的字数（按 chunk 求和），决定前端显示哪些页签；正文不在这里返回 |

#### GET `/api/admin/logs/{log_id}/agent-run/entries/{entry_id}/text`

- `kind` 必填：`prompt` / `input` / `output` / `reasoning` / `arguments` / `review`；其它值 400。
- `offset` 为从 0 开始的 Unicode 字符偏移；`limit` 默认 16384，服务端夹到 1–131072。
- 日志不存在、步骤不属于该轮，返回 404；该步骤没有这类正文返回 404。

```json
{ "text": "当前页内容", "total": 8452, "offset": 0, "limit": 16384 }
```

#### GET `/api/admin/logs/{log_id}/agent-run/entries/{entry_id}/download`

`kind` 同上一接口；返回该步骤该类正文的全文，`text/plain; charset=utf-8`，
文件名 `agent-run-{log_id}-{entry_id}-{kind}.txt`。没有正文时 404。

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
    "models": [
      {
        "id": "openrouter/google/gemini-2.0-flash",
        "name": "Gemini 2.0 Flash",
        "description": "",
        "aa_index": 85,
        "reasoning_effort": null,
        "thinking_budget": null,
        "user_usable": true,
        "ocr_usable": false,
        "chores_usable": true,
        "agent_usable": false,
        "enabled": true,
        "is_free": true,
        "free_no_code": true,
        "agent_free": false,
        "free_limits": { "minute": 0, "hour": 0, "day": 0, "week": 0, "month": 0 },
        "agent_free_limits": { "minute": 0, "hour": 0, "day": 0, "week": 0, "month": 0 }
      }
    ],
    "chores_model": "",
    "ocr_model": "",
    "ocr_max_tokens": "8192",
    "max_tokens": "4096",
    "timeout": "120",
    "first_token_timeout": "30",
    "max_visible_models": "5",
    "log_payload": "false",
    "log_retention_days": "0",
    "tool_reasoning_rules": [],
    "mirror_enabled": "false",
    "mirror_origins": [],
    "mirror_banner_enabled": "true",
    "jev_enabled": "false",
    "jev_base_url": "https://api.typesafe.ai/v1/systemone",
    "jev_api_key": "sk-t****7890",
    "jev_model": "jev-latest",
    "jev_timeout": "4",
    "jev_tool_search_enabled": "true"
  },
  "keys": [ ... ],
  "reasoning_efforts": ["high", "low", "medium", "minimal", "none"],
  "providers": [ ... ],
  "model_provider_map": { ... },
  "available_model_ids": [ ... ]
}
```

`config` 中的 `models` / `tool_reasoning_rules` / `mirror_origins` 已在服务端
从存储字符串还原为对象或数组，前端无需二次解析；模型的四项用途能力位恒存在。
`log_payload` 以字符串 `"true"` / `"false"` 存储；`log_retention_days` 为
天数字符串，`"0"` 表示永久保留。`jev_api_key` 回显为脱敏值（含 `****`），
保存时原样送回表示不修改（与 Provider Key 的约定一致）；`jev_enabled` 同为
字符串开关。`jev_tool_search_enabled` 为字符串开关（缺键按 `"true"`），单独
关掉「描述需求找工具」（`POST /api/tools/search` 的 Jev 判定），不影响 Jev 的
错误重试判定。`mirror_banner_enabled` 为线路故障全局横幅开关（字符串 `"true"` /
`"false"`，缺键按 `"true"`），随 `PUT /api/admin/config` 落盘。旧的单 URL 配置键（`llm_base_url` / `llm_api_key` /
`llm_model` / `chores_base_url` / `chores_api_key`）已不再由配置读写，仅作为环境变量兜底存在。

### 11.8 更新配置

#### PUT `/api/admin/config`

**请求体：**

```json
{
  "default_model": "openrouter/google/gemini-2.0-flash",
  "models": [
    {
      "id": "openrouter/google/gemini-2.0-flash",
      "name": "Gemini 2.0 Flash",
      "user_usable": true,
      "ocr_usable": false,
      "chores_usable": true,
      "agent_usable": false,
      "enabled": true
    }
  ],
  "ocr_model": "",
  "ocr_max_tokens": 8192,
  "max_tokens": 4096,
  "max_visible_models": 5,
  "log_payload": true,
  "log_retention_days": 30
}
```

说明：`models` 是结构化数组（字段见上表），整体替换存储值；未出现在请求体中的键保持不变。
`log_retention_days` 取值范围 `0 ~ 36500`，越界返回 422。
`max_visible_models` 为用户端模型下拉的最大显示数，取值范围 `0 ~ 50`
（`0` = 不折叠，保持全量显示），越界返回 422；只统计勾选了「用户可用」
且未禁用的模型。该值经 `GET /api/tools/` 下发到前端。
`ocr_model` 为「识别图片文字」使用的视觉模型，留空跟随默认模型；`ocr_max_tokens`
为它的单次输出上限（取值范围 `256 ~ 32768`，默认 8192，整卷转录更吃这个预算）。
两项日志配置与 OCR 配置**保存后即时生效**（主站在每次请求时读取），无需重启。

`visual_paper_concurrency` 为每次试卷精讲请求的并发上限，默认 3，API 接受整数且不设数值上限；正整数限制同时发起的请求数，0 或负数（如 -1）表示不限并发，按实际分片任务数启动。模型条目也支持同名字段：`null` 或缺省表示跟随全局默认，整数表示该模型自定义。管理台「高级设置」与模型编辑菜单均可调整。保存后对新请求即时生效，进行中的请求使用启动时的配置快照；重试和备用通道同样占用该并发槽位。

`models` 为结构化数组（管理端提交 `ModelEntry` 列表），每项字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 必填，LiteLLM 格式模型 ID |
| `name` / `description` | string | 用户端展示名与描述 |
| `aa_index` | number\|null | 打击级别指数（0-100，越大越强；模型评级已由旧的 `score` 改为本字段） |
| `reasoning_effort` / `thinking_budget` | string\|int\|null | 思考强度 / 思考 token 预算 |
| `user_usable` | bool | 用户可用：出现在 8000 用户端的模型列表里 |
| `ocr_usable` | bool | 用于 OCR：可作为「识别图片文字」的识别模型（需带视觉能力） |
| `chores_usable` | bool | 用于 Chores：可作为标题生成等轻量任务的模型 |
| `agent_usable` | bool | Agent：出现在 `/agent` 工作台的模型列表里；**缺省 false**，与 `user_usable` 互不继承 |
| `enabled` | bool | 禁用后用户端、OCR、Chores 与 Agent 全不可用（四项用途的上一级开关） |
| `is_free` | bool | 免费模型：调用不消耗次数，用户端显示「免费」标签 |
| `free_no_code` | bool | 无码可用：无使用码或次数用尽也能调用（仅免费模型生效） |
| `agent_free` | bool | Agent 免费：在工作台执行不扣次数（仅免费模型生效，缺省 `false`） |
| `free_limits` | object | 主站防滥用限额 `{minute, hour, day, week, month}`，0/-1 为不限制；按模型调用计次 |
| `agent_free_limits` | object | Agent 防滥用限额（同键），按执行轮次计次、与主站分池 |
| `chores_only` | bool | **已废弃**：仅在客户端未提交能力位时用于迁移（等价于 `user_usable=!chores_only`、`chores_usable=true`、`ocr_usable=false`） |

**校验规则**（不满足返回 400，文案指明是哪个模型 / 哪个指向）：

- 每个**未禁用**模型必须至少勾选一项用途（`用户可用` / `用于 OCR` / `用于 Chores` / `Agent`）；
- `default_model` 必须勾选「用户可用」且未禁用；
- `chores_model` 必须勾选「用于 Chores」且未禁用；
- `ocr_model` 必须勾选「用于 OCR」且未禁用（留空 = 跟随默认模型，不做校验）；
- 把某个模型改成禁用、或取消它仍被指向的那一项能力时，必须同时改掉指向，否则拦下。

管理后台的两处模型选择器（Chores / OCR）只列出勾了对应能力且未禁用的模型，其中的「跟随默认（X）」
还要求默认模型自己勾了对应能力——默认模型干不了这件事时跟随它没有意义，因此该选项不出现，并由一行
红色提示指出怎么修（为默认模型补上该项，或指定一个别的模型）。某模型的能力被取消或被禁用后，
它会立刻从列表消失，原先的指向则显示同样的红色提示。用户端模型下拉同理，只列勾选了「用户可用」
且未禁用的模型。

### 11.9 线路可用性检测

#### GET `/api/admin/mirror/status`

管理后台代测两条线路的 `/api/health`（前端不直测，避免 CORS 与混合内容误报）。
只测 DB 里已保存的 `mirror_origins`，不接受客户端传 URL。

未启用（`reason=disabled`）或地址不足两条（`reason=need_two_origins`）时直接返回
配置状态，不发起任何出站请求（`results=[]`，`summary={all_ok:true, fault_count:0}`）。

**响应：**

```json
{
  "enabled": true,
  "origins": ["https://a.example.com", "https://b.example.com"],
  "ready": true,
  "reason": "",
  "banner_enabled": true,
  "checked_at": "2026-10-14T12:00:00+00:00",
  "results": [
    {"origin": "https://a.example.com", "ok": true, "status_code": 200, "latency_ms": 123, "version": "1.2.0", "error": ""},
    {"origin": "https://b.example.com", "ok": false, "status_code": null, "latency_ms": 5001, "version": "", "error": "连接超时（5s）：对方无响应或端口不可达"}
  ],
  "summary": {"all_ok": false, "fault_count": 1}
}
```

单条探测超时 5s，两条并发，总耗时约 5s。`error` 为中文短语（超时 / 拒绝 / 解析失败 /
非 200 / 非 JSON），可直接展示给管理员。管理前端在概览卡、线路镜像页与全局横幅
中复用该接口，每 60s 轮询一次（页面隐藏时跳过）。

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
| 17 | 阅读文本改编 | `阅读文本改编.md`（改编 + 词汇真实化改造；原「阅读文本改编 2」已并入） |
| 18 | 阅读文本改编 2 | 已并入工具 17，按 `阅读文本改编.md` 处理（旧会话兼容别名） |
| 19 | 阅读理解设问 | `阅读理解设问.md`（A/B 双版本命题 + 鉴别指引，支持多篇语篇逐篇同出（含篇目切分判断与总览表）；原「阅读理解设问 2」已并入） |
| 20 | 阅读理解设问 2 | 已并入工具 19，按 `阅读理解设问.md` 处理（旧会话兼容别名） |
| 21 | 辅助完形填空命题 | `辅助完形填空命题.md` |
| 22 | 试题解读分析 | `试题解读分析.md` |
| 23 | 英语试题 Bug 侦察 | `英语试题 Bug 侦察.md` |
| 24 | 超标词排查+替换 | `超标词替换.md`（仅替换；排查由机械接口完成） |
| 25 | 自由对话 | `自由对话.md` |
| 26 | 智能错题迁移 | `智能错题迁移.md` |
| 32 | 识别图片文字 | `识别图片文字-印刷试卷.md`（`ocr_mode=printed`，默认）/ `识别图片文字-手写作文.md`（`ocr_mode=handwritten`）。用哪一份由前端按所在工具定（见 8.2），界面只在工具 32、25 与 33 里给选择 |
| 33 | 翻译 | `翻译.md`（续写指令为 `翻译续写.md`）；语言对随请求带入，见 8 的 `source_lang` / `target_lang` |
| `title` | 生成标题 | 会话/历史记录标题生成，使用 Chores 模型（供工具推理规则等配置管理） |
| `visual_framework` | 可视化试卷全解框架 | 试卷可视化全解第一阶段结构插标，使用 framework_model 或 Chores 模型（供工具推理规则等配置管理） |
| `device_profile` | 设备画像分析 | 后台设备列表生成 AI 用户画像，使用 Chores 模型（供工具推理规则等配置管理） |

### 12.1 试卷可视化全解输出格式（工具 13）

工具 13 输出不用 JSON，而是逐行 `@@TAG@@` 自定义分隔格式（增量友好：每遇 `@@END_Q@@` 即提交一道题，截断不丢已完成题）。解析在前端 `frontend/script.js` 的 `parseCustomVisualPaper`；后端 `app/services/visual_paper.py` 同时用于并行精讲的分片与完整性检查。

**两阶段生成（默认开启）：** 阶段一由 Chores 模型按 `@@MARK` 插标协议（`prompts/试卷可视化全解框架.md`）处理带行号的原卷——只输出 `@@TOTAL@@`/`@@PAPER@@` 头和 `@@MARK GROUP/PASSAGE/Q/OPTIONS/KEY/CUT@@ <锚点>` 单行指令，不转录任何原文；分组跟着语篇走，**每篇语篇一组**（阅读理解 A/B/C/D 篇各一组，标题可区分同类各篇；相邻同 id 同标题的分组由 applier 自动加序号消歧，防止解析端按「重复声明」合并）；锚点通常至少 2 字符；仅 GROUP 允许向前唯一、独占整行的 A/B/C/D 标题，Q/OPTIONS 等仍拒绝单字符、≤4 字符时优先行首匹配；后端 `visual_paper_framework.FrameworkApplier` 从上一标记处向后搜索锚点（精确 → 空白归一化 → 忽略大小写，失配丢弃并计数）在锚点前插入标记，锚点允许落在行中间（断行切开「语篇末尾与题号挤同一行」），派生出的 `@@TAG@@` 骨架逐段以 `token` 事件发给前端——语篇与题目从流式一开始就逐步上屏。阶段二以骨架为 `<material>`（`prompts/试卷可视化全解精讲.md`），主模型只输出讲解字段（`@@Q@@`/`@@QTYPE@@`/`@@ANSWER@@`/`@@EVIDENCE@@`/`@@REASON@@`/`@@DISTRACTOR@@`/`@@PITFALLS@@`/`@@PATTERN_*@@`/`@@TRANSFER_*@@`/`@@WRITING_*@@` + `@@END_Q@@`），题干、选项、语篇不再转录；解析端对同号 `@@Q@@` **重开合并**（从已提交的同号题重播种解析草稿，`@@END_Q@@` 原地更新，不新建）。`this.output` = 骨架 + 讲解 = 一份完整 `@@TAG@@` 文档，历史/打印/编辑链路无感。阶段边界发 `stage` 事件；框架解析失败或零产出时自动回退单阶段（老 prompt + 原文，无 `stage` 语义差异，`framework: false`）。阶段一模型取配置 `framework_model`（默认跟随 Chores 模型）、输出预算 `framework_max_tokens`（默认跟随全局 `max_tokens`）；开关 `visual_paper_framework`（默认开）。

框架收尾区分可恢复标记与真正结构缺失：原卷不存在答案区时忽略多余 KEY；CUT 跨过明确的答案标题时在标题处保留 KEY，防止随后回指 KEY 导致整卷回退。缺失题目/语篇锚点、歧义标题、真实答案区无法定位等仍判为结构错误。可用框架只发送一次进入精讲的 `stage`，携带完整并发任务信息，不发送清空事件。前端必须在等待精讲首题期间保持全部骨架题目和总数。

**并行精讲：** 完整框架派生后，按原卷分组切成最多 3 道原题的任务（每题迁移量越多，任务越小：`max(1, 3 // transfer_count)`）；每个任务携带所属组全部题目、完整共用语篇和原卷答案区，只为分配的题号输出。上下文通过相同材料复用，各次模型请求不共享推理状态。按全局默认或模型覆盖值限制同时在途调用；单题也走相同调度器。框架不可靠时继续走原有单阶段回退。补全请求携带 `visual_question_nos`，只处理指定缺失题。

开始并行时 `stage` 附带 `parallel: true`、`concurrency` 和初始 `tasks` 数组；`reuse_framework: true` 表示沿用已有骨架，客户端不得把旧讲解保存进骨架。每个任务独立缓冲，过滤结构改写、重复题和越界题；输出可乱序到达，展示顺序由骨架决定。正常结束时仅对所有必需字段已完整的末题补上遗漏的 `@@END_Q@@`；超限、审核终止、异常或主动停止不做此修复。进度事件不进入正文，多个任务的推理文本不会交错拼进全局推理框。

单任务失败不取消其他任务。首轮缺失或可重试异常触发自动补全，最多三轮，间隔 0.5 / 1 秒；后两轮将缺失题拆成单题，携带上轮缺项，有备用 Provider 时把上一通道移到后面。已完整题不会重做；上下文超限或内容审核异常不重试。首正文前由 Router 自动 Fallback，正文后失败由新请求重做缺失题，避免混接不同通道的半截文本。普通和全屏视图均按题显示 Fallback 与补全状态，进度以 `m/n 题` 表示。

`incomplete` 表示尝试结束仍缺题或字段，前端列出具体缺项并保留手动补全入口。七选五（cloze7）、完形填空（cloze）、语法填空（grammar）采用嵌入式设问，每空各算一道题：原题 `STEM`、迁移 `TRANSFER_STEM` 均可为空，设问由带空号的语篇承载。前后端按原题所属组判定，不依赖当前选中的组，也不把 choice 等同于必须有独立题干；阅读理解迁移仍要求题干。空题干不触发未完成、重试或续写；语篇、应有选项、答案、解析等仍需完整。兼容旧语法填空把带空句子放在 stem 的记录，不要求重生成。七选五迁移保留原题七项选项池，不能把四选一误判成完整。`[DONE]` 仅表示本轮结束；没有交付任何完整题时使用全局 `error` 并且不扣费。停止、断连或关闭生成器时取消在途调用和重试等待。一次请求中的所有自动补全不额外扣次数。主日志记录合并输出与扣费；每次实际精讲调用记录独立用量、通道、提示词、输出和缺失项（`request_id` 后缀 `_exN_aM`，`units=0`），通过父子关系归入同一次请求。

免费模型限额同样按用户请求计一次。日志的可空字段 `counts_for_free_limit` 明确计次归属：框架和并行子任务为 `false`，并行主请求成功、主动停止或部分失败但已有完整题交付时为 `true`，完全失败为 `false`。其他工具及未关联旧记录为 `null`，沿用原状态判断；启动时为旧库补列，并把已关联的旧框架和分片日志标为不重复计次。

同一篇语篇常被多道题共用，正文按编号只输出一次（这是输出 token 的最大头）：

| 标签 | 形式 | 说明 |
|------|------|------|
| `@@PASSAGE_DEF@@ <编号>` | 编号在同行，正文从下一行起 | 每篇语篇只声明一次，紧接所属分组之后；编号取 `P1`、`P2`……按语篇首次出现顺序 |
| `@@PASSAGE_REF@@ <编号>` | 单行值标签 | 每道题必写，指向本题所属语篇；写作题写 `-` |

- 同一篇语篇被拆进多个分组（如完形填空按叙事分 2-3 组）时共用同一编号，正文只在首次出现处输出。
- 解析分两趟：先收齐全部 `@@PASSAGE_DEF@@`，再把各题编号换成全文。声明写在引用之后、跨组复用、截断与续写都能正确对上。
- 编号查不到对应声明时该题标记 `passageUnresolved`（左栏告警），正文留空——绝不静默顶上一篇别的语篇；同号重复声明保留首份。
- 旧格式内联 `@@PASSAGE@@`（正文逐题内联）继续兼容：历史记录照常打开；教师只改某一道题的语篇时，序列化会为该题写内联正文，不污染同篇其他题。
- 结构 → 契约文本的回写见前端 `vpSerializeRaw`：同一篇只写一份 `@@PASSAGE_DEF@@`，其余题写 `@@PASSAGE_REF@@`。
- **续写（工具 13 不走 8.1 的 `continue_from`）**：完整骨架保存在 `visualPaper.frameworkRaw` 并随历史持久化。续写前从已解析快照重建正文，保留骨架尾部答案区、题数与教师修改，丢掉未提交的半题；发送骨架、兼容旧后端的讲解简报，以及结构化的 `visual_question_nos` 缺失题清单。后端以题号清单为范围，只补未完成题；不回传已有讲解。没有结构化题号的旧客户端仍走单流简报路径。旧记录没有完整骨架时，用原卷与续写工单走单阶段，避免重新提取框架后丢失续写范围；单阶段尾部用 `vpLastCompleteEnd` 清理。骨架必须有顶行标签才跳过阶段一，简报中提到的标签不算骨架。题块按题号重开合并，重写的迁移块整体替换；旧单流中的重复分组与提前结束标签仍由原解析器兼容。工具栏、中断卡和全屏顶栏均保留恢复入口；续写开始先显示讲解阶段，再接收服务端的任务状态。若所有题已完整、仅上轮终止事件丢失，则直接确认完成，不发送空工单。
- 历史记录：续写/重试都写回原记录（`visualPaper.historyId`），`partial` 记录「未确认写完」——用户停止、`@@TOTAL@@` 截断、题数不足、讲解未写完都算，历史列表显示「待补全」，重开时恢复续写入口。「剩余 N 题」与「已完成」判定均取**讲解口径**（`total - vpAnalyzedCount`）：两阶段下骨架一到位结构题数即满，结构口径会谎报完成、收起续写入口。

- 修改保存：手动退出修改模式和自动保存均同步更新结构骨架快照（题干、语篇、选项及原卷答案区），续写和历史重开使用保存后的内容；骨架不含已生成的讲解与迁移题。已有完整题目结构的旧单阶段记录也会在保存时建立骨架快照。

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
| 409 | 需要用户确认后重试：上传的是扫描件（需二次确认走精准解析）、手机端尚未上传照片、标题任务 ID 冲突 |
| 413 | 上传文件超过体积上限（精准解析 200MB） |
| 429 | 免费模型超出防滥用限额且无可用使用码（持可用码时自动转为扣次数），或辅助接口请求过于频繁 |
| 500 | 后端内部错误或 LLM 调用失败 |
| 502 | 文档解析服务（MinerU）调用失败 |
| 503 | 精准解析未配置（缺 MinerU Token），需管理员在后台补齐 |

---

## 15. 变更记录

> 版本号与 `README.md` 第 12 节**同序列**：本节按接口变化逐条记录（粒度更细），产品级汇总见 README。两侧都可能出现只在一侧存在的版本号（如纯前端变更只记 README）。

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
| 1.11.0 | 2026-09-18 | 试卷可视化全解（工具 13）输出格式 v2：语篇改为「`@@PASSAGE_DEF@@` 声明一次 + `@@PASSAGE_REF@@` 逐题按编号引用」，同一篇正文不再逐题重复（典型整卷省约 1 万输出 token）；解析改两趟，编号悬空时标记 `passageUnresolved` 并在左栏告警；旧内联 `@@PASSAGE@@` 与历史记录继续兼容，详见 12.1 |
| 1.12.0 | 2026-09-21 | 图片识别（工具 32「识别图片文字」）：新增 `/api/chat/stream` 的 `images` / `ocr_mode` / `pair_token` 字段与 OCR 链路（须有效使用码、始终不计费仅限流、用后台配置的 `ocr_model`、撞输出上限发 `truncated` 事件），`input` 改为对非 OCR 工具必填；`ocr_mode` 由前端按所在工具决定（作文批改用手写规则、其余用印刷规则，只有工具 32 与 25 给用户选）；模型用途改为能力位 `user_usable` / `ocr_usable` / `chores_usable`（`chores_only` 废弃但读取时自动迁移），新增配置键 `ocr_model` / `ocr_max_tokens`；新增扫码配对接口 `/api/ocr/pair*` 与手机拍照页 `/m/upload`（手机页配色跟随电脑端当前主题，见 8.3） |
| 1.13.0 | 2026-09-21 | 模型用途迁移的可用性修正：管理端「禁用模型」开关改为「启用模型」（标签此前与正向的 `enabled` 字段相反，打开开关即启用却写着"禁用"）；旧单 URL 配置迁移改为直读环境配置与库中旧键（此前从 `get_config_map` 取已被移出白名单的 `llm_base_url` / `llm_api_key`，恒为空），并会在启动时补齐已存在的空地址 Provider；静态资源改为「未版本化一律每次重验证」，避免升级后浏览器继续用旧 script.js（管理端 index.html 的资源版本串同步提升） |
| 1.14.0 | 2026-09-23 | 新增翻译工具（33「翻译」）：`/api/chat/stream` 与 `/api/chat/preview` 新增 `source_lang` / `target_lang`（渲染进 `翻译.md`，缺省回落 `auto` / `简体中文`）；`truncated` 事件的适用范围放宽到工具 33（撞全局 `max_tokens` 时前端给出「继续翻译」出口）；`ocr_mode` 的手动选择名单增加工具 33（印刷试卷与手写作文都可能来）；工具 33 走普通工具链路：须正文、按模型计费、用用户所选模型。同批：本地静态资源不再带 `?v=` 版本串（改走 `no-cache` + `etag`，升级后无需强刷即可拿到新代码），`bridge.html` 与 `index.html` 引用镜像模块的 URL 必须一致 |
| 1.15.0 | 2026-09-25 | 标题生成改为后端持久任务：新增 `title_jobs` 与 `/api/chat/title-jobs`、`/api/chat/title-jobs/status`；任务最多尝试 3 次，浏览器关闭或刷新不影响 worker；历史标题待生成时显示原文摘要 Shimmer，终态失败静默回退原文 |
| 1.16.0 | 2026-10-06 | 试卷可视化全解（工具 13）改两阶段生成：阶段一由 Chores 模型按 `@@MARK` 插标协议（`prompts/试卷可视化全解框架.md`）在带行号的原卷上标出语篇/题目/选项/答案区，分组跟着语篇走（每篇一组，阅读理解 A/B/C/D 篇各自独立；GROUP 锚点必须落在本组第一题的标记之前——语篇在前的题型与 PASSAGE 同锚正文首行，写作两节锚在各自要求行且应用文/读后续写各自成组），读后续写的材料原文（含两段开头语）挂回本题展示，后端 `visual_paper_framework.FrameworkApplier` 按锚点（支持行中定位断行、短锚点行首优先、单字符拒收）派生出 `@@TAG@@` 骨架逐段流给前端，结构从流式一开始就逐步上屏；阶段二（`prompts/试卷可视化全解精讲.md`）材料换成骨架，主模型只输出讲解字段（题干/选项/语篇不再转录），解析端对同号 `@@Q@@` 重开合并。新增 SSE `stage` 事件（见 7）、标签 `@@KEY@@`（卷末答案区）与 `@@GROUP_INTRO@@`（分组导语）；续写输入携带骨架时后端跳过阶段一。进度条改两段式：浅色条为第一轮结构解析，跑完留作背景，深色条在其上展示第二轮讲解进度；进度行单一状态文案按阶段切换（解析结构 N/M → 撰写讲解 N/M），不再出现双计数。框架解析失败或产出为零时自动回退单阶段老路径（`@@TOTAL@@`/`@@PAPER@@` 头部重复对解析无害）；模型口头声明的总题数不可靠（实测 47 题报成 51，总数虚高让 UI 显示不存在的余题），applier 收尾按实际派生的题号数补一行 `@@TOTAL@@` 校正，解析端后者生效。配置键：`visual_paper_framework`（默认开）、`framework_model`（默认跟随 chores 模型）、`framework_max_tokens`（默认跟随全局 `max_tokens`，不受 chores 256 钳制）；阶段一单记一条使用日志（`tool_name`「试卷可视化全解·框架」，`request_id` 加 `_fw` 后缀，`units` 恒 0），与主记录分列，便于核对锚点命中率 |
| 1.17.0 | 2026-10-07 | 工具推理规则支持 Chores 系列工作：管理端工具注册表新增 `chores` 分组（含「生成标题」`title`、「可视化试卷全解框架」`visual_framework`、「设备画像分析」`device_profile` 与「报错解读」`error_explain`）；标题生成任务与试卷可视化全解阶段一（框架解析）及后台设备画像执行时均按配置的推理规则（`reasoning_effort`）与不支持处理策略（`fallback`/`fail`）应用推理强度 |
| 1.18.0 | 2026-10-15 | 描述需求找工具：新增 `POST /api/tools/search`（无需使用码，不扣额度不写日志，`tool_search` 桶 30 次/60 秒限速）；Jev choice 单题判定（~70-500ms）映射 32 个工具并允许「以上都不合适」，未配齐/超时（上限 5s）/报错立即回退本地关键词 bigram 匹配；进程内缓存（TTL 600s、键含工具目录指纹）；新增配置键 `jev_tool_search_enabled`（缺键按开，可单独关闭搜索的 Jev 判定）；前端在侧栏与移动顶部提供「描述需求找工具」入口（输入停顿 500ms 自动搜、内容变化中断重发、查找中可见进度环、空态/兜底/不确定状态文案）；假后端打桩同形响应（`#mock` 场景 fallback/slow/error/empty） |
| 1.19.0 | 2026-10-19 | 前端行为变化（无接口变更）：生成中断（切工具 / 回首页 / 新建题目 / 查看历史 / 关页刷新）先落盘残文再作废在途流，关页走 `pagehide` 并把停止通知用 `keepalive` 送出，从 bfcache 回来不会卡在「生成中」；历史卡片键盘可达（`role="button"` + `tabindex` + 读屏名，Enter / 空格打开、↑↓ 移动焦点） |
| 1.20.0 | 2026-10-19 | 撞输出上限改为**所有工具**都发 `truncated`（原先只对工具 32/33 发，其余工具把半份内容当完整结果交付且没有续写入口），载荷补 `completion_tokens` 与 `finish_reason`，前端据此在结果区给「继续生成」出口、把记录标成「待补全」；`error` 事件改为「Chores 模型转写的两句话 + 机器可读分类」：新增 `advice` 与 `code` 字段，`message` 不再是固定的「生成失败，请稍后重试」，失败时先发一条 `explaining` 非终态事件让前端立刻停止显示「生成中」（新增提示词 `prompts/报错解释.md`，注册为 Chores 工作 `error_explain` 以便按模型配推理等级；Chores 不可用时按「精确判定 → Jev → 机械兜底」决定要不要再试，总时长预算 3 秒，仍失败则用机械文案兜底，同类错误走进程内缓存）；失败分类 `error_code` 与上游结束原因 `finish_reason` 随使用日志落库，前端按 `code` 收起注定失败的重试、后台日志表据此显示「截断」与分类角标；Jev 的「精确 → Jev → 兜底」三层骨架抽成 `app/services/decision.py`，Provider 切换判定、标题任务重试判定与报错解读共用同一套编排 |
| 1.21.0 | 2026-10-29 | 模型用途新增第四项「Agent」（`agent_usable`，**缺省 false**）：`/api/workspace/catalog` 只返回勾了该项、未禁用、且至少绑定一个启用 Provider 的模型，`default_model` 不在清单内时回退为清单第一个；`POST /tasks/{id}/runs` 同口径校验（未勾 403、未绑 Provider 400、清单为空 403 并提示联系管理员）。`agent_usable` 不参与任何历史迁移，与 `user_usable` 互不继承；管理后台模型编辑弹窗「用途」新增 Agent 项（默认不勾），模型列表的用途徽章同步显示。用户端／OCR／Chores 的可见性与校验口径不变 |
| 1.22.0 | 2026-10-29 | 免费模型能力拆成主站 / 工作台两个开关：新增 `agent_free`（缺省 false，仅 `is_free` 为真时生效）——未勾的模型在 `/agent` 按普通模型每轮扣 1 次，勾了才不扣；新增 `agent_free_limits`（同一组窗口键），按**执行轮次**计数且只统计 `tool_id="agent"` 的行；主站 `free_limits` 计数改为排除工作台的行，两个池子互不占用（避免分钟级窗口卡死多轮任务）。`/api/workspace/catalog` 的 `models` 原样带出 `is_free` / `agent_free`，管理后台模型编辑弹窗新增「Agent 免费」开关与「Agent 防滥用限额」面板 |
| 1.23.0 | 2026-10-29 | Agent 执行策略：Provider 任务级粘住（同一家最多 3 次尝试、退避 + Retry-After，用尽才换、换家不切回；断流时同家重跑本步一次）；上下文压缩阈值 262144 tokens（去掉 9 万硬顶，保留 HEAD 与最近 N 步、中间段换确定性摘要、用户补充要求全文保留，压缩后 1.25 倍兜底）；轮 token 预算改为「未命中缓存的输入 + 输出」（默认 2,000,000），使用日志仍按原始 prompt/completion/cached 记录；步骤详情新增 `provider_id` / `attempts` / `cached_tokens`；新增 `POST /api/workspace/tasks/{id}/compact` 与 `kind="compaction"` 步骤；Agent 设置新增 `context_budget` / `keep_tail_steps` / `provider_attempts` / `retry_wait_cap_seconds` / `switch_compaction_ratio` |
| 1.24.0 | 2026-10-29 | 管理后台新增 **Agent 运行全解**：`GET /api/admin/logs/{log_id}/agent-run` 返回任务、预算、用量、Provider 切换、压缩与步骤列表（正文只给字数）；新增步骤正文分页 `/text` 与全文 `/download`（`prompt` / `input` / `output` / `reasoning` / `arguments` / `review`）；日志列表 Agent 行新增 `agent_steps` / `agent_mode` / `agent_available`。Agent 轮次不写主站 `log_payloads`，正文从 `workspace_chunks` 按需读取，不新增表结构 |

---

## 16 Agent 工作台（`/api/workspace`）

工作台使用与主站相同的使用码 JWT，请求头 `Authorization: Bearer <token>`。除登录外均需要有效使用码。

### 16.1 页面与登录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/agent`、`/agent/tasks/{id}` | 工作台页面（服务端返回同一单页，路由由前端解析） |
| POST | `/api/workspace/login` | 使用码换 JWT |
| GET | `/api/workspace/catalog` | 模型、官方模板、个人模板、工具、默认配置、额度与上限 |

`catalog.models` 只包含**勾选了「Agent」用途、未禁用、且至少绑定一个启用的 Provider** 的模型
（`agent_usable=true`），与用户端的 `user_usable` 互不继承；`default_model` 落在这份清单之外时
回退为清单第一个，清单为空则为空串。开新执行（`POST /tasks/{id}/runs`）用未勾「Agent」的模型
返回 403，未绑定 Provider 返回 400，清单为空时的 403 文案会提示联系管理员。定稿后的清单口径见
[5. 模型列表](#5-模型列表) 的字段说明。

**计费与限额：** 一轮（执行 / 审阅 / 修订 / 工具试运行）预扣 1 次，只有勾了 `agent_free` 的
模型不扣；`agent_free_limits` 按轮次计次且只统计 `tool_id="agent"` 的使用日志行，主站的
`free_limits` 也把这类行排除在外 —— 两边互不消耗。超限返回 429「免费模型在 Agent 工作台每小时
最多执行 N 轮」。`catalog` 的 `models` 原样带出 `is_free` / `agent_free`，工作台模型选择器据此
显示「免费」或「主站免费」。

**Provider 粘性与重试：** 每一轮记一个首选 Provider（任务级继承，新任务按优先级重选）。
调用链把它排在最前，失败后**先在同一家重试**（默认 3 次尝试、1s/4s 退避；`Retry-After`
≤60s 按它等待，超过则不再等），用尽才换下一家；401/403/404 立即换家（重试改不了配置），
上下文超限/内容审核/413 既不重试也不换家。换家后本任务**不再自动切回**（切回等于再废一次
缓存），切换记录进 `run.snapshot.switches`。断流（已收到部分内容后报错）时，若内容 < 2000 字符、
时间与预算允许且属瞬态故障，会在同一家**重跑本步一次**（prompt 未变，缓存全部命中）。

**上下文压缩：** 估算上下文超过 `context_budget`（默认 262144 tokens）时，在下一步之前压缩：
保留 `messages[0:2]`（system + 任务上下文）逐字节不变、保留最近 `keep_tail_steps` 步原文、
保留全部用户补充要求，把中间段换成确定性摘要（工具名/参数/返回大小/版本号，不含模型生成的
自由文本）。压缩后仍超过 1.25 倍阈值才报错。改配置（工具表变化）与用户手动「压缩上下文」
也会触发一次。压缩本身记一条 `kind="compaction"` 的步骤（含 before/after/丢弃单元数）。

**用量口径：** 轮次 `tokens` 是**预算消耗**＝未命中缓存的输入 + 输出；每一步的
`details.usage` 保留上游原始 `prompt_tokens` / `completion_tokens`，`details.cached_tokens`
为命中的前缀 tokens（`null` = 上游未上报）。使用日志在轮次结束按真实用量写
`prompt_tokens` / `completion_tokens` / `cached_tokens`，`total_tokens = prompt + completion`。

### 16.2 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace/tasks?q=&offset=&limit=` | 任务列表；`q` 只匹配标题 |
| POST | `/api/workspace/tasks` | 新建任务；`config` 必须符合 `TaskConfig`，新任务不能预选材料 |
| GET | `/api/workspace/tasks/{id}` | 任务详情：配置、材料元数据、成果版本、执行轮次、补充要求 |
| PUT | `/api/workspace/tasks/{id}` | 以 `revision` 乐观锁保存配置与标题；冲突返回 409 |
| DELETE | `/api/workspace/tasks/{id}` | 删除任务（执行中返回 409） |
| POST | `/api/workspace/tasks/{id}/copy` | 复制任务与材料，返回 `material_map` |

任务详情的 `notes` 为补充要求与配置应用记录（`id`、`run_id`、`text`、`applied`、`config`），用于刷新后恢复对话中的用户消息；过程正文不进入任务详情。

### 16.3 材料

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/workspace/tasks/{id}/materials` | 粘贴材料正文 |
| POST | `/api/workspace/tasks/{id}/upload` | 上传并解析文件（单文件 100 MB、单任务 50 条、每用户合计 2 GB） |
| GET | `/api/workspace/tasks/{id}/materials/{material_id}` | 读取解析文本；`?original=true` 下载原文件 |

### 16.4 执行与过程

> Agent 任务标题按使用码单独限流（`agent_title`，30 次/分）；超限只跳过自动命名，不影响任务开始。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/workspace/tasks/{id}/runs` | 创建执行轮次；`request_key` 幂等 |
| POST | `/api/workspace/tasks/{id}/stop` | 立即停止当前轮次；返回 `{received, status, run?}`，`received=false` 表示没有可停止的轮次 |
| POST | `/api/workspace/tasks/{id}/compact` | 给当前轮次挂一次「立即压缩上下文」：执行器在下一步开头压缩（没有执行中的轮次返回 409） |
| POST | `/api/workspace/tasks/{id}/notes` | 补充要求，或 `apply_config=true` 在下一步应用新配置 |
| GET | `/api/workspace/tasks/{id}/events?after=` | 增量事件（`run` / `entry` / `note` / `version` / `adopt` / `material` / `config` / `title`）；**不含大段正文**。`note` 载荷含 `run_id`，客户端据此把补充要求挂到对应回合 |
| GET | `/api/workspace/tasks/{id}/entries` | 步骤元数据列表（按创建时间），用于恢复对话与轨迹；不含正文 |
| GET | `/api/workspace/tasks/{id}/entries/{entry_id}/content?kind=&after=&download=` | 按游标读取某一步的正文块；块大小 4096 字符，单次最多 24 块；`kind` 为 `reasoning` / `output` / `input` / `arguments` / `prompt` / `review` |
| GET | `/api/workspace/tasks/{id}/runs/{run_id}` | 单轮配置快照 |

轮询事件只携带步骤元数据与字符计数，正文通过 `entries/{entry_id}/content` 按游标读取；这样 20 万字符思考与 30 万字符成果不会挤进事件响应。

**停止语义：** 运行中的轮次由服务进程内的取消信号立即中断在途模型调用，页面先把状态置为 `stopping`；排队中的轮次还没有在途调用，直接落为 `stopped` 并退回预扣，不等待 worker 槽位。取消后最多等 3 秒收尾，超时也先落终态（已收到的正文仍会补写）；跨进程或进程重启时由 0.75 秒的 DB `stop` 标记兜底。`waiting`（等待补充）不是执行中，不能停止，接口返回 `received=false`，其出口是回答或跳过。响应同时给出 `status` 与 `run`（停止瞬间或已终态），前端据此直接落状态。

### 16.5 成果

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace/tasks/{id}/versions/{version_id}` | 读取完整成果正文 |
| POST | `/api/workspace/tasks/{id}/versions` | 手动编辑，保存为新版本 |
| POST | `/api/workspace/tasks/{id}/versions/{version_id}/adopt` | 采用版本；`expected` 乐观锁 |

### 16.6 审阅、工具与模板

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/workspace/tasks/{id}/reviews/{entry_id}` | 记录被忽略的审阅意见 |
| POST | `/api/workspace/tasks/{id}/tool-test` | 只读工具试运行 |
| POST | `/api/workspace/templates` | 保存个人提示词/工具模板 |
| DELETE | `/api/workspace/templates/{template_id}` | 删除个人模板 |

### 16.7 错误

沿用主站的 `{"detail": "..."}`；常见状态码：401 登录失效、404 任务/材料/步骤不存在、409 配置冲突或执行中删除、422 参数校验失败、429 并发/免费额度限制。
