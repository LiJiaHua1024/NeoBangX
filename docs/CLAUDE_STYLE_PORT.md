# Claude 风格移植 · 实施与验收记录

## 1 来源与固定版本

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/Nwflower/dsh-claude-style |
| 固定提交 | `1e7acc5be061be06cd3850962abd3ad103259bfd` |
| 上游版本 | `0.19.3`（`chore(release): 0.19.3`，2026-10-25） |
| 本地参考克隆 | `/home/lijiahua/src/refs/dsh-claude-style` |
| 上游运行验证 | `npm install && npm run build` 通过；`npm run smoke` 51 个页面用例中 2 个上游自身的动效断言失败（详见第 9 节），构建、装载、样式与其余行为用例通过 |
| 上游许可证 | 代码 MIT；钠渲染引擎 PolyForm Shield 1.0.0；Inter / Noto Serif / JetBrains Mono 为 SIL OFL 1.1；Anthropic Sans/Serif/Mono 与 Clawd 角色不适用 MIT |

上游把实现分成浏览器半边、宿主半边、契约、引擎、资源和测试六部分。浏览器半边共 331 个源文件、约 5.3 万行。它不是独立页面，而是对 DeepSeek Harness Web GUI 的 CSS/DOM 覆盖层：功能以 `features/<name>` 组织，视觉规则以 `theme/tokens.json` 为唯一来源，构建时把令牌解析成字面量并生成 `docs/STYLE.md` 的令牌表。

本次移植的目标宿主是 NeoBangX 的 `/agent` 工作台及其内部页面，不是 DSH 页面。因此移植的是**上游的设计令牌、字体、组件外观、状态、交互与滚动/流式渲染行为**，不是插件的宿主选择器与 React 注入机制。凡因宿主接口不同而改写的部分，在第 5 节逐条记录。

## 2 范围

范围内：

- `/agent` 的任务列表、对话/轨迹、输入卡片、工作区（提示词、材料、工具、成果）、任务菜单、主题切换、登录、用量与政策弹窗、审阅、版本比较、个人模板库、旧版归档、材料全文阅读、长文本阅读器。
- 双主题（Claude 浅色 / 深色），从桌面大屏到手机的单栏适配。
- 现有真实业务：提示词与材料配置、工具开关与教学工具、执行/停止/补充、后台继续、成果版本与采用、导出、审阅与忽略意见、跨窗口冲突、空目标直接执行。
- 长内容：20 万字符思考、30 万字符成果、200 个步骤；不得截断，不得以删除内容换流畅。

范围外：

- 普通工具页、管理后台（`/admin`、`admin-frontend`）保持原样。
- 上游针对 DSH 宿主的私有路由、账号服务、模型目录、计费、设置页、插件市场、壁纸插件互操作、Windows 标题栏与页面缩放。
- 上游的 DeepSeek 配色卡与 Deepy 小鲸鱼（未复制；Clawd 螃蟹帧图按用户要求复制，版权见第 8 节）。

## 3 上游资产与功能的对应清单

状态：`port` 表示按上游实现移植或等价实现；`adapt` 表示保留体验、按宿主改造；`n/a` 表示宿主没有对应物，记录理由。

### 3.1 令牌、字体与基础

| 上游 | 内容 | 本次处理 |
| --- | --- | --- |
| `theme/tokens.json` | 颜色卡、色阶、字号、圆角、动效、层级 | port：取 Claude 卡的浅/深值，落到 `frontend/agent/claude/tokens.css`；不使用上游构建期解析器，值直接写成 CSS 变量 |
| `theme/typography.css` | Anthropic Sans/Serif/Mono、正文 serif、CJK 回落、代码字体 | port：字体文件复制到 `frontend/agent/fonts/`，`@font-face` 与字体栈照抄；正文（Markdown）用 serif，界面用 sans，代码用 mono |
| `theme/chrome.css` | 画布/侧栏底色、0.5px 分隔线、窗口 chrome、右侧栏卡片 | adapt：同样的底色与 0.5px 线；右侧栏卡片改为工作区卡片 |
| `theme/sidebar.css` | 品牌 lockup、新会话行、面板行、任务行、时间、分区标签 | port/adapt：保留 280px 侧栏、28px 行高、13px/11px 字阶、圆形加号、悬停 6px 圆角；品牌换成 NeoBangX |
| `shared/motion.css`、`tokens.json` motion | 120/150/250/320ms、ease、距离、缩放、减少动效 | port：同名时长/曲线写入变量；所有动效在 `prefers-reduced-motion` 下关闭 |
| `sodium`（D78） | 运行时重写宿主里昂贵的 `:has()` 间隔选择器，减少样式重算 | adapt：NeoBangX 自己拥有样式表，不需要运行时改写；直接写成有界的子选择器，并对长列表/长文启用 `content-visibility`、`contain` 和分帧渲染，达到同一目的（见 5.6） |
| `shared/popover.css`、`segment-control.css`、`sliding-pill.css` | 弹层、分段控件、滑动高亮 | port：菜单/弹层 12px、行 6px、100ms 停留；分段控件滑动高亮 |
| `theme/third-party.css` | 第三方插件适配 | n/a：NeoBangX 不加载 DSH 插件 |

### 3.2 会话与消息

| 上游 | 内容 | 本次处理 |
| --- | --- | --- |
| `features/conversation-width` | 对话正文三档宽度 | adapt：工作台默认 752px 正文；大屏可读性优先，工作区另占一栏 |
| `features/view-tabs` | 对话 / 轨迹标签条 | port：标题栏中央的「对话 / 轨迹」；轨迹保留原有完整步骤记录 |
| `features/chat-fold` | 思考折叠、过程组计数摘要、消息折叠、折叠滑轨 | port：思考折叠显示字数并流式计数；工具调用折叠；长回答折叠「展开全文」；折叠动画与高度测量自实现 |
| `features/chat-follow` | 流式跟随、向上阅读保持、回到最新、过程组追赶 | port：滚动锚点与 `ResizeObserver` 跟随；用户向上滚动即释放；回到底部按钮；流式增长用 `scrollTop` 平滑追赶，减少动效时直接落位 |
| `features/chat-reveal` | 流式文字渐入 | adapt：块级增量 Markdown 渲染 + 120ms 渐入；不做逐字符擦除（会在长文上重排） |
| `features/chat-wait` | 等待行、发光带、三点动画、时长 | port：等待行文字、三点动画、耗时与 token |
| `features/chat-send` | 发送动画（消息飞入） | adapt：保留消息进入的 320ms 过冲与发送后的落位；不做跨层飞行动画（会增加长会话的合成层） |
| `features/chat-files` | 文件行、附件、差异 | adapt：材料行与版本差异；差异用现有 worker 的逐行比较，样式按 Claude 的删除/新增色 |
| `features/context-stats` | 上下文计量、token、缓存 | adapt：保留本轮 tokens、步骤、状态；不伪造缓存/费用数据 |
| `features/model`、`features/effort` | 模型/推理档选择器 | port/adapt：模型选择器按上游改为平铺弹层（卡片壳、行节奏、选中勾、250ms 生长、键盘与 Escape）；行内数据全部来自 NeoBangX 自己的模型配置：`description`、`aa_index` 评级、`is_free` / `free_no_code` 标签，不复制上游厂商 logo 与描述表。上游第一级 +「更多模型」第二级/搜索在扁平小目录里合并为一张可滚动平铺卡，不做提供方分组；不显示不存在的推理档 |
| `features/caret` | 输入光标接管：原生光标透明、绘制 2px 竖线、80ms 位移、1000ms 闪烁 | port：`frontend/agent/caret.mjs` 用隐藏镜像测量 textarea 光标，位移/闪烁/减少动效按上游；测量失败立即交还原生光标 |
| `features/turn-nav`、`features/sidebar-peek` | 回合导航、侧栏预览 | n/a：工作台有独立「轨迹」页与常驻侧栏；不引入第二个导航层 |
| `features/search` | 全局搜索面板 | adapt：保留任务搜索输入；不伪造跨会话全文搜索 |

### 3.3 工作台

| 上游 | 内容 | 本次处理 |
| --- | --- | --- |
| `features/workspace` | 侧栏工作区/归档分段 | adapt：NeoBangX 的任务列表按「今天 / 过去 7 天 / 更早」分组；运行中任务带呼吸点；保留搜索、加载更多、复制/删除 |
| `features/home`、`hero-menu`、`home-ripple` | 新会话首页、问候、用量卡、涟漪 | adapt：新任务显示「这次想完成什么？」的首页式空态与单行输入卡片；不做用量图表（工作台没有该数据） |
| `features/composer` | 输入卡片、附件、工具栏、底部状态条、焦点态 | port：对话态单行 14px 圆角输入卡片、卡片内 `↵` 发送/停止、卡片下方 28px 工具行（模型入口在右端）、1px 边框与焦点双环、附件 chip 移到卡片上方；空目标仍可直接执行 |
| `features/session-title` | 标题就地重命名 | port：标题输入框无边框，聚焦时显示 1px 蓝环；名称即时保存 |
| `features/account`、`settings` | 账号抽屉、设置页 | adapt：账号入口保留「切换使用码」；主题切换改为浅色/深色/跟随系统三段控件；不引入设置页 |
| `features/header-band` | 顶部栏 | adapt：任务标题、状态、对话/轨迹、主题、任务菜单、工作区开关 |
| `features/brand` | 品牌 lockup | adapt：使用 NeoBangX 现有的闪电标记与名称，排布、字号、serif 字体按上游；不复制 Claude 商标作为产品品牌 |
| `features/mascot`、`deepy`、`crab` | 角色动画 | port：Clawd 帧图与帧表复制到 `frontend/agent/mascot/crab/`，WAAPI steps 播放；按真实任务状态切换思考/打字/完成/失败/睡眠，点击有反应；Deepy 未复制（业务品牌不是 DeepSeek） |
| `features/rightbar-fit`、`view-tabs` 宿主窗口逻辑 | 宿主右栏像素换算 | n/a：直接使用 CSS 像素与 ResizeObserver |

### 3.4 内部页面

| 现有页面/层 | 本次处理 |
| --- | --- |
| 登录弹窗 | Claude 居中对话框、输入框、错误文字 |
| 我的提示词与工具（模板库） | Claude 弹层 + 卡片行；保留用于当前任务/新建任务/删除 |
| 旧版任务归档 | 列表弹层，只读，保留完整 JSON 阅读与下载 |
| 审阅意见 | 弹层内意见卡、证据、忽略/复核/生成候选稿 |
| 版本比较 | 全屏阅读器内的逐行差异；保留共同首尾与完整变更段 |
| 材料全文 / 长思考 / 完整成果 | 阅读器：分页、搜索、跳转、下载；正文不截断，页大小与 DOM 上限按 200k/300k 压测 |
| 政策、预算、保留说明 | 弹层内条目化说明 |
| 跨窗口冲突 | 顶部提示条 + 比较与处理弹层 |
| 任务操作菜单 | 复制/删除/重命名 |
| 移动端任务抽屉 | 全屏抽屉，焦点回到入口 |

## 4 现有业务契约

移植不改变下列行为；后端只增加读取接口，不改变执行语义：

- 目标留空直接执行：`POST /runs` 不需要目标；`DEFAULT_EXECUTION_REQUEST` 不变。
- 关闭网页后台继续：worker 与任务状态机不变；前端轮询恢复。
- 提示词、行为说明、材料选择、工具开关、教学工具、审阅设置、模型选择照旧保存到 `config`，`revision` 冲突处理不变。
- 执行、停止、补充要求、应用新配置、审阅、修订、工具试运行、采用版本、手动编辑、导出 Markdown/Word 全部保留。
- 成果版本始终保留原稿；自动修订只产生候选稿。
- 长思考、完整输出、完整成果不截断；新增的流式读取只读，不改变存储。

新增后端接口：

- `GET /api/workspace/tasks/{id}/entries?after=<id>&limit=...`：按创建顺序返回步骤元数据（不含正文），用于恢复对话与轨迹。正文仍走已有的 `/entries/{entry_id}/content?kind=...&after=...`，每块 4096 字符、每次最多 24 块，保持「轮询事件不含大段正文」的约束。
- `task_detail` 增加 `notes` 列表（每条任务的补充要求与配置应用记录），用于刷新后恢复对话中的用户消息；不改变写入路径。

## 5 必要适配与理由

### 5.1 主题

上游主题是 DSH 插件的两套配色卡与宿主令牌。NeoBangX 普通工具页使用五套「宣纸/青瓷/曜石/墨翠/悠空」主题，本次不改。`/agent` 使用独立的 `nbx_agent_theme`（`light` / `dark` / `system`），默认跟随系统，首次进入按 `prefers-color-scheme` 决定；URL `#agent-theme=light|dark` 可强制，便于截图对照。理由：Claude 浅色/深色是本次验收对象，若继续映射五套主题，颜色与材质必然偏离上游；独立键也避免影响普通工具页。

### 5.2 品牌

保留 NeoBangX 的闪电标记与名称，仅采用上游的品牌排布（18px 标记 + serif 字标 + 顶部 20px 内边距）。不复制 Claude 字标/星芒作为产品品牌，避免把宿主产品改名；上游的星芒形状只作为“助手身份”的抽象图形出现在 AI 消息的极简标记中（可选，默认不显示），不使用其商标文字。

### 5.3 布局

上游是「侧栏 + 单对话」；NeoBangX 的业务要求同时阅读提示词、材料、工具和成果。保留右侧工作区，但按上游的卡片语言重绘：8px 内缩、16px 圆角、1px 边框、无玻璃模糊；对话正文 752px 居中；侧栏 280px。理由：业务对象不能塞进对话气泡；右侧卡片是上游「右侧栏卡片」规则的自然延伸。

### 5.4 流式内容

上游由宿主 React 流式写入；NeoBangX 的轮询事件刻意不含大段正文。新增 `entries` 列表接口与复用按游标读取的 `content` 接口：运行中的步骤每 350ms 拉一次新增块，完成后停止；历史步骤在进入视口或展开时读取。这样既保留“事件轻量”的原有设计，又能显示真实流式输出。

### 5.5 长内容

- 思考与工具输出默认折叠，标题实时显示字符数；展开时按块加载，全部内容进入 DOM，不抽样、不省略。
- 长回答超过 8,000 字符时折叠为前 1,200 字符 + 「展开全文」；展开后完整渲染。
- 成果在成果页完整渲染；30 万字符按顶层 Markdown 块分帧追加，配 `content-visibility: auto`，页面仍可通过分页/跳转定位任意段。
- 200 个步骤：对话只加载可视区附近的步骤正文（`IntersectionObserver`），轨迹保留全部 200 行元数据；不删除任何步骤。
- 所有 `backdrop-filter` 只用于对话框/菜单，不用于长列表和大面板（上游 Sodium 的目的之一）。

### 5.6 Sodium

上游 Sodium 不改内容，只把宿主样式表中会触发全页重算的选择器改写成有界形式。NeoBangX 的样式表由本仓库拥有，因此：

- 对话项间距用 `.turn > * + *`，不使用 `:has()` 全页匹配；会话项加 `contain: layout style`，远的整轮才用 `content-visibility: auto`。流式中的思考/工具行不加 `content-visibility`，因为高度估计会随后续渲染变化，跟随会抖。
- 流式 Markdown 用块级增量渲染与 120ms 批处理；不在每个 token 上重排整篇。
- 滚动跟随用 `transform`/原生滚动，不在滚动事件里读取布局；每帧合并一次。
- 这些是 Sodium 在宿主上的等价结果；运行时重写器本身不需要，记录为 n/a。

### 5.7 设备

- ≥1440：侧栏 + 对话 + 工作区三栏，工作区可拖拽 360–680px。
- 1100–1439：侧栏 + 对话，工作区变为右侧浮层卡片（8px 内缩）。
- 768–1099：单主区，顶部「对话 / 工作区」切换；侧栏抽屉。
- <768：单栏，顶部菜单 + 标题；底部「对话 / 工作区」分段；输入卡片吸底并适配安全区；触控目标 ≥44px。
- 软键盘：`visualViewport` 更新 `--vh`，输入卡片跟随可见视口；提示词编辑时不叠加聊天输入。

### 5.8 角色

用户明确要求把 Claude 的角色图搬过来，因此本次复制 **Clawd**（Claude Code 的像素螃蟹）的帧图与帧表，而不是继续用抽象标记代替：

- 帧图逐帧复制自上游 `packages/assets/src/mascot/crab/`，播放器按 `mascot-player.ts` 的 WAAPI `steps()` 方式移植；80ms/帧、透明边距 1 格、裁切盒与帧表全部照抄（`frontend/agent/mascot.mjs`）。
- 角色只表达真实状态：`task.status` + 最新步骤类型决定思考 / 打字 / 完成 / 失败 / 空闲；60 秒无操作会睡，点击/拖动有反应，页面切到轨迹或手机工作区时隐藏。
- 减少动效时停在帧表指定的静止帧；点击仍是唯一触发器，与上游一致。
- 不使用 Deepy：NeoBangX 不是 DeepSeek 品牌，搬入小鲸鱼会制造错误的品牌关系。
- Clawd 是 Anthropic 的角色，帧图不适用 MIT；许可与替换要求见第 8 节。

## 6 设计令牌（Claude 卡）

浅色：画布 `#FFFFFF`，侧栏 `#FAFAFA`，正文 `#161616`，次要 `#70686A`，三级 `#91888A`，边框 `#E9E9E9` / `#DEDEDE` / `#CFCFCF`，分隔 `rgba(22,22,22,.05)`，强调 `#D97757`，用户气泡 `#F4F2F3`，表格头 `#F4F4F4`，行内代码 `#943333`，链接 `#184F95`。

深色：画布 `#191919`，侧栏 `#1F1F1F`，正文 `#FDFDFD`，次要 `#BEB6B8`，三级 `#9C9395`，边框 `rgba(255,255,255,.09/.18/.30)`，分隔 `rgba(255,255,255,.06)`，强调 `#D97757`，用户气泡 `rgba(255,255,255,.06)`，表格头 `#282828`，行内代码 `#E8A08A`，链接 `#8AB4F8`。

字体：Anthropic Sans Web Text / Inter 回落用于界面；Anthropic Serif Web Text / Noto Serif 回落用于对话正文与标题；Anthropic Mono Web / JetBrains Mono 用于代码。中文回落到 Noto Sans SC / Source Han Sans SC / PingFang SC / Microsoft YaHei。

圆角：4 / 8 / 16；弹层 12，行 6，输入卡片 14，分段 7，按钮 pill 9999。

动效：反馈 120ms，揭示 120ms，弹层 150ms，打开 250ms，发送 320ms，滑轨 240ms，滚动跟随 240ms，光标位移 80ms，光标闪烁 1000ms；曲线见 `tokens.css`。`prefers-reduced-motion` 下光标位移/闪烁与页面动效一起停。

## 7 实施状态

- [x] 固定上游提交、建立来源清单
- [x] 复制字体与许可
- [x] 设计令牌与基础样式
- [x] 侧栏与顶栏
- [x] 对话、流式、折叠、跟随
- [x] 输入卡片（单行卡片、`↵` 发送、工具行、模型入口）
- [x] 输入光标平滑位移与闪烁
- [x] 模型选择器（平铺、自有描述、AA 评级、免费/免码标签、选中勾、生长动效）
- [x] Clawd 角色与真实任务状态
- [x] 工作区四页
- [x] 弹层与内部页面
- [x] 响应式与移动端
- [x] 后端 entries/notes 接口与终态步骤收尾
- [x] 浏览器验收与截图/录屏/trace
- [x] 回归测试与提交

## 8 许可与来源说明

- 上游代码：MIT。移植的 CSS 结构、选择器写法、交互参数与文案来自固定提交；衍生文件在文件头注明来源。
- 钠（Sodium）：PolyForm Shield 1.0.0。本次未复制其运行时代码，只复现其性能目标；此说明保留上游许可归属。
- 字体：Inter、Noto Serif、JetBrains Mono 为 SIL OFL 1.1，许可证见 `frontend/agent/fonts/OFL.txt`。Anthropic Sans/Serif/Mono 是 Anthropic 的字体，上游明确说明“仅供个人使用、不随 MIT 发布”；本仓库复制自上游的仓库副本，仅用于个人项目的界面复刻，不随包再分发。若用于商业分发，需替换为 OFL 字体。
- 角色：Clawd 是 Anthropic 的角色。本次按用户要求复制了上游 `packages/assets/src/mascot/crab/` 的帧图与 `sheets.ts` 的帧表；这些帧图不在上游 MIT 覆盖范围内，上游明确标注为 Anthropic 角色形象。它们只用于个人界面复刻，商业分发前必须替换或取得授权。说明见 `frontend/agent/mascot/NOTICE.md`。Deepy 由 calmly-eating-bugs 绘制，本次未复制。
- 模型 logo 与描述：本次不复制上游的厂商字标或 `model-descriptions.json`。选择器只读 NeoBangX 自己的 `description`、`aa_index`、`is_free` / `free_no_code`；评级表与主站 `frontend/script.js` 共用同一套 AA 打击级别（Agent 侧副本在 `frontend/agent/rating.mjs`，由一致性测试守护）。
- 图标：界面其余图标沿用 NeoBangX 原有 Lucide 风格图标集。

## 9 验收证据

最近一次完整验收：`node tools/test-claude-agent-browser.mjs`，16 组场景全部通过，0 个浏览器错误（`.debug/claude-port/2026-10-26T04-12-58-008Z/`）。提交到仓库的证据在 `docs/evidence/claude-port/`：

- 16 组场景：登录、双主题持久化、输入卡片/平滑光标/模型选择器/Clawd、空目标执行与刷新恢复、20 万字符以上思考、长成果折叠、审阅忽略、版本编辑/比较/采用/导出、工作区配置、补充要求刷新恢复、失败/停止、跨窗口冲突、10 种视口、1440×1240 双主题、200 步 + 30 万字符、减少动效。
- 200 条轨迹 + 30 万字符成果、12,439 个 DOM 节点时，40 次页签切换 p95 111.7 ms、最大 139.3 ms（软件渲染，无 GPU）。
- 30 万字符导出 SHA-256 与测试种子一致；20 万字符以上思考展开 715 ms 内完成，阅读器搜索与下载全文正常。
- 录屏与 trace 在 `.debug/claude-port/<run>/video/` 与 `trace.zip`（未提交）。最近一次 trace 含 2,004 个 screencast 帧、743 个 DOM 快照、333 组动作，0 个 console error；已抽取录屏帧与 trace 快照检查等待行动画、输入卡片、模型选择器、Clawd、阅读器、冲突态与长文滚动。
- 对照图：`docs/evidence/claude-port/compare-{light,dark}.png`，上游固定提交与本次 1440×1240 对话并排。
- 逐项截图与说明：`docs/evidence/claude-port/README.md`。

在实际浏览器中检查过的关键点：

- 同视口（1440×1240）浅色/深色对话；浅色 1920、1440、1366、1280、1024、768、390、360、844×390 无横向溢出。
- 流式内容在底部时保持跟随；向上滚动后 `scrollTop` 在后续流式增长中保持不变，「有新进展」浮在输入卡片上方，点击回到底部。
- 思考折叠从 0 字实时计数，本次验收 334,665 字符全部进入 DOM 并可搜索；另做 499,500 字符手动压测，展开 715 ms、滚动约 61 fps。长回答折叠后「展开全文」完整渲染到 `最终内容 END`。
- 工作区 200 条步骤全部保留，成果分 33 页，单页 11,534 字符；导出 810,041 字节、哈希一致。
- 停止/失败不会丢已收到内容；停止后错误提示与工具状态可读；自动修订只生成候选稿。
- 移动端抽屉打开时底部切换让位、关闭按钮可点、焦点回到菜单；手机工作区仍可编辑提示词、材料、工具和成果。
- 主题菜单在手机工作区之上可点，浅色/深色/跟随系统三项状态正确。

## 10 上游运行观察

- `npm install`、`npm run build`（`lib/client.js` 944,738 字节）通过。
- `npm run smoke` 在 Chromium 141（软件渲染，Ubuntu 22.04，无 GPU）上运行 51 个页面用例，49 通过，2 个失败均为上游自身的等待行动画/宽度断言（`chat-wait` 的换轨形变与文字交换宽度），与本次移植无关；构建、字体路由、样式装载、拆解、折叠、跟随、发送、文件、上下文统计等用例通过。
- 上游截图（`docs/screenshots/claude-home-light.png`、`claude-conversation-light/dark.png`）作为视觉对照基准；本次在相同视口 1440×900/1440×1240 下截图对照。

## 11 验收命令

```bash
# 隔离后端（假模型，独立临时数据库）
cd backend && .venv/bin/python tests/workspace_browser_server.py

# 浏览器验收
LD_LIBRARY_PATH=$HOME/.local/pwlibs/usr/lib/x86_64-linux-gnu \
  node tools/test-claude-agent-browser.mjs
```

Playwright 浏览器：`~/.cache/ms-playwright/chromium-1194`。系统缺少的 `libnss3/libnspr4/libgbm1/libwayland-server0` 通过 `apt-get download` 解包到 `~/.local/pwlibs`，以 `LD_LIBRARY_PATH` 注入；不修改系统包。

## 12 待联调与限制

- 软件渲染环境（SwiftShader，无独立显卡；Chromium 141 headless）：滚动帧率、长列表合成层数量与真实硬件不同；不冒充硬件加速结果。验收 p95 111.7 ms、最大 139.3 ms 是该环境下的数字。
- 真实模型 API、真实文件解析、真机触控和 iOS 软键盘未在本服务器验证；假模型只覆盖接口契约、流式分块与错误/停止路径，不评估真实模型质量或真实文档解析。IE/旧版 Safari 未验证。
- 上游 `smoke` 的两个失败项已记录，不作为本移植的通过依据。
- Anthropic 字体只作个人使用；商业分发前需替换。
