# Agent 生成英语教学 PPT：设计系统与调优记录

版本：v2 研究稿  
日期：2026-11-08  
范围：英语教学课件的设计系统、设计时调优流程、运行时快路径。未接入 `/agent` 生产代码。  
配套证据：`docs/evidence/ppt-prototype-en/`（阅读课 11 页、读后续写 9 页、语法/试题 3 页，含 PPTX 与对比图）。  
相关文档：`docs/AGENT_PPT_RESEARCH.md`（市场路线与工程架构；其中语文样例只验证渲染链路，英语设计以本文为准）。

## 0. 结论

1. **美学在“设计时”调，不在“运行时”调。** 我们（写代码的 Agent）可以花很长时间做生成—评审—修改；产品里的 Agent 只做一次内容生成 + 确定性编译，最多一次修复重试。它不是不给美学留时间，而是把美学固化进了版式、字号、内容预算和写作规范。
2. **教学 PPT 的美学不是 keynote 美学。** 一屏一个数字、大片留白，适合发布会，不适合讲评课/阅读课/语法课。教学 PPT 要“编辑级的秩序 + 课本级的信息效率”：标题有结论、每页 3–6 个可教单元、答案/证据/支架在位、没有无意义的空底。
3. **设计系统 v2 的硬规则：**
   - 字号阶梯 84 / 44 / 24 / 18 / 16 / 13 / 11；学生要读的内容不低于 16px，标签不低于 12px；
   - 内容底线 y≈640：页面底部五分之一不能习惯性空着；
   - 需要“先想再揭晓”的页面，编译成 **prompt 页 + reveal 页** 两张静态幻灯片，不用动画；
   - PPTX 用 Georgia / Arial，预览和度量用 metric-compatible 的 Gelasio / Arimo，保证换行和 fit 在导出后不漂移；
   - 主题只有 Paper / Chalk 两套，分别服务阅读写作与语法/试题，不混在同一份 deck 里。
4. **第一轮独立评审没有通过：** 两位评审分别给出 6.78 / 10 与 7.56 / 10（权重不同），都低于 8.2 的门槛。主要问题不是“丑”，而是“像作品集，不像上课的 deck”：9–14px 的正文、习惯性空底、答案和问题同屏、引文不精确、时态/术语漂移。v2 正是按这些意见重做的；第二轮评审结果见 §5.4。
5. **样片必须是双语，而不是全英文。** 中国英语课堂的讲解、指令、审题、错因分析大多是中文，语篇、问题、例句、范文是英文。最终样片是“中文教学指令/注释 + 英文语篇/例句”，并用中文标签、中文注释、中文出口票验证混排下的换行、字体和溢出。
6. **溢出不靠人眼碰运气。** 编译器用真实字体度量、8% 横向安全余量、16px payload 地板；另有 `layout_check.py` 做保守检查（测到才报错，标签/装饰不误报）。样片第 5 页曾出现正文 95% 宽、94% 高的贴边溢出，已加宽/降字号并复检到 0 warning。

## 1. 两个 Agent，必须分开看

| | 设计时的 Agent（我们） | 运行时的 Agent（产品） |
| --- | --- | --- |
| 目标 | 把“什么算好看、什么算好教”变成可复用的系统 | 在一次任务里生成一份可用的 deck |
| 时间 | 可以长：生成多版、渲染、独立评审、迭代 | 必须短：一次写作 + 编译 + 最多一次修复 |
| 评审 | 独立的教师/设计评审，带 rubric 和截图 | 确定性检查：schema、溢出、字号、密度、必修节点 |
| 产出 | 版式、字号、主题、写作规范、golden deck | deck JSON → scene → SVG/PPTX |
| 失败处理 | 改设计系统，重跑评审 | 返回 warning，让 writer 改内容；不改版式 |

Anthropic 那篇文章的 generator/evaluator 循环，是一个**设计时 harness**，不是运行时功能。它用 5–15 轮、最长四小时，把主观的“好看”变成可评分的 criteria，再用独立 evaluator 逼 generator 进步。这个成本在产品运行时不可接受，但我们在设计阶段可以承担；承担完之后，把结论固化成代码和提示词，运行时就不需要再“想 aesthetics”。

## 2. 从文章借什么、不借什么

### 2.1 文章做了什么

- **Generator + evaluator 分离**：生成者自己评自己会过度宽容；独立 evaluator 更可靠。
- **四条 criteria**：design quality（整体感/气质）、originality（是否有自定义决策，而非模板/AI 套路）、craft（排版/间距/对比度）、functionality（可用性）。
- **权重偏向 design quality + originality**：因为模型在 craft/functionality 上通常已经及格，真正缺的是品味和胆量。
- **few-shot 校准**：用带详细分数的样例校准 evaluator，减少评分漂移。
- **evaluator 看真实页面**：用 Playwright 导航、截图、研究实现，而不是只看静态截图。
- **措辞会塑形**：比如“museum quality”会把设计推向某一种收敛。
- **迭代不是线性变好**：有时中间一轮比最后一轮更好；generator 要在“继续打磨”与“换方向”之间做策略判断。
- **evaluator 是否值得，取决于任务是否超出模型 solo 能力**：任务在能力边界内时，evaluator 是过度开销；在边界外才真正有 lift。

### 2.2 为什么不能照搬到运行时

- 一次 5–15 轮、每轮截图/评审，会把 10 页 deck 的生成从几十秒推到几十分钟；用户不会等。
- 运行时没有 Playwright/Chromium（我们的生产镜像也没有），截图评审本身不可用。
- 运行时 evaluator 仍然可能“宽容”，需要持续校准；这会把运维成本带进产品。
- 教学 deck 的版式空间已经被设计系统约束；模型的任务是“选对版式 + 填对内容”，不是从零设计。此时视觉任务在模型 solo 能力之内，evaluator 的边际收益低。

### 2.3 我们怎么用

**设计时：**

1. 定 rubric（§3），用样例校准“好/坏”的边界。
2. 生成多个版式/主题/密度变体，渲染成 SVG/PPTX/截图。
3. 让独立的评审（教师 persona + 设计 director persona）按 rubric 打分，指出具体页码和缺陷。
4. 根据反馈改设计系统，而不是改单页；重跑评审，直到稳定过线。
5. 把 winning decisions 冻结成：字号阶梯、内容预算、版式坐标、prompt/reveal 规则、写作提示词、golden deck。
6. 设计系统变更时，重跑 golden deck 评审；这是离线回归，不进生产请求。

**运行时：**

- writer 一次生成 deck JSON；
- compiler 校验 blueprint/版式/字数，做文本测量和 fit，输出 warnings；
- 有 schema/溢出/密度 warning 时，最多一次内容修复；
- 渲染 SVG/PPTX；
- 不做截图、不做视觉 evaluator、不做 5–15 轮。

这就是“美学能力在线，但不跑特别长时间”的具体含义：**把长时间的美学工作前置到设计阶段，把运行时的美学变成约束。**

## 3. 教学 PPT 的评分标准

文章的四条 criteria 是为 frontend 设计的；教学 PPT 要重新配权重。我们用的 rubric：

| 维度 | 权重 | 关注点 |
| --- | --- | --- |
| Teaching function | 30% | 这一页有没有明确的教学动作（引出/示范/讲解/检查/对比/练习/总结）？内容是否完整（答案、证据、支架、评价标准）？老师会不会真的在课堂上用？ |
| Information efficiency | 25% | 内容量是否合适？不是一屏一个数字的发布会，也不是一屏塞满的讲义；3–6 个可教单元；卡片/框内没有大片死区。 |
| Projector readability & craft | 20% | 学生要读的内容 ≥16px，标注 ≥13px；标题 32–48px；行长、行距、对比度、对齐、不溢出。 |
| Visual coherence & identity | 15% | 一套主题、一个强调色、一致的字体/边距/标签；没有 AI 套路（渐变、阴影、装饰条、紫色卡片）。 |
| Originality / fit of layout | 10% | 版式是否服务于这一页的教学动作（语篇注释栏、情节曲线、语法矩阵、试题分析），而不是每页同一套卡片。 |

**通过线：** 单页 ≥7.5，整份 ≥8.2；任何一页出现“学生要读的内容 <16px”“答案与问题同屏且无揭晓设计”“引文被改写”“时态/术语自相矛盾”，即使平均分高也不能过。

**校准用语：**

- 用“textbook quality / editorial clarity / classroom-ready”，不要用“museum quality”。
- “Museum quality”会把设计推向发布会的空；教学 deck 要的是“课本页的秩序”，不是“海报的留白”。
- 评分时先问“我能不能拿这一页上课”，再问“它好不好看”。

## 4. 设计系统 v2

### 4.1 字体与字号

**PPTX 字体：**

- 标题：Georgia（serif）；
- 正文/标签：Arial（sans）；
- 中文备注/注释：宋体、微软雅黑（只在需要中文的 run 上写 `<a:ea>`）。

**预览与度量字体：**

- Georgia 的 metric-compatible 开源替代：**Gelasio**；
- Arial 的 metric-compatible 开源替代：**Arimo**；
- 中文预览/度量：原型期用 **Noto Serif SC / Noto Sans SC**；PPTX 写 **宋体 / 微软雅黑**（`<a:ea>`）。
- **生产实现（2026-11）**：服务端不下载/打包大字体；用提交在 `backend/app/agent_workspace/slides/assets/font_metrics.json` 的 Arial/Georgia 兼容字宽表 + CJK 1em 估算。预览用系统 Georgia/Arial/宋体/雅黑，PPTX 用同名系统字体；8% 余量吸收差异。Gelasio/Arimo/Noto 只用于原型对比。
- 中文 run 必须声明 `lang="zh-CN"`，英文 run 声明 `en-US`，否则 PowerPoint/WPS 可能用错字体。

这样预览、文本测量、PPTX 的字宽基本一致，换行和 auto-fit 不会因为导出而漂移。此前用 Source Serif 4 / Inter 做预览，PPTX 用 Georgia/Arial，虽然好看，但同一个文本框在两端会差 1–2 行；metric-compatible 字体是更工程化的选择。

**字号阶梯（设计 px，导出 ×0.75 = pt）：**

| 用途 | 字号 | 说明 |
| --- | --- | --- |
| 封面标题 | 84 | 两行以内，手动断行优先 |
| 内容页标题 | 44（dense/exam 40） | 一句结论，不写“以下是……” |
| 卡片/分段标题 | 22–24 | 比正文高一级 |
| 正文 | 18 | 学生主要阅读层 |
| 密集正文 | 17 | 语篇/表格/计划 |
| 注释/证据/答案 | 16 | 不低于 16 |
| 辅助说明/模型句 | 15–16 | 不低于 15 |
| 标签/kicker | 12–13 | 不再用 9–11px 承载含义 |
| 页脚/页码 | 11 | 仅导航，不承载教学内容 |

**红线：** 学生要读的正文、答案、criteria、model 句不低于 16px；标签不低于 12px。任何 `fit` 把 payload 缩到 15px 以下，编译器必须报 warning，writer 要删内容或拆页，不能靠缩小字号解决。字号地板是硬锁：`Scene.text` 会直接把 payload 的 `min_size` 提到 16，放不下就返回 overflow，而不是悄悄变小。

### 4.2 画布、密度与“内容底线”

- 16:9，1280×720 设计空间；左右边距 64，内容宽 1152；页脚 678。
- **内容底线 y≈640**：一页的教学内容（正文、答案、任务、清单、模型句）要在 640 之前出现；底部不能习惯性空着。封面/章节/引文/结束页可以例外，但一节课里 focus 页不超过 20–25%。
- 三档密度：

| 档位 | 页面 | 规则 |
| --- | --- | --- |
| Focus | cover、section、quote、closing | 可以少；一页一个动作；不承担密集内容 |
| Standard | objectives、pre-reading、text structure、language、questions、task、summary、six W、plan、support、writing | 3–6 个可教单元；卡片/表格按内容定高，不留半张空卡 |
| Dense | passage first-read/reveal、model、grammar matrix、exam analysis | 6–10 个单元；连续不超过 2 页；靠栏目、标签、编号维持秩序 |

- 不用“一屏一个数字”的发布会逻辑；`stats` 只用于三个关键数字，不用于普通内容页。
- 卡片高度由内容决定；如果卡片底部空了 >80px，要么减高度，要么放教学内容（答案、sentence frame、model、checklist），不要留白撑版面。

### 4.3 主题

首版两套，按课型分，不混用：

| 主题 | 适用 | 背景/墨色/强调 | 标题 |
| --- | --- | --- | --- |
| **Paper** | 阅读、读后续写、写作 | 暖纸 `#F6F1E7` / 墨 `#191713` / 赭红 `#9B3A2C` | Georgia / Gelasio，serif |
| **Chalk** | 语法、试题分析、讲评 | 冷白 `#F3F5F7` / 深蓝 `#12202B` / 青 `#1E6B74` | Arial / Arimo，sans |

- 深色页用 `dark` token：Paper 用深墨绿黑，Chalk 用深蓝黑；封面、章节、结束页使用。
- 不在同一份 deck 里混 Paper 和 Chalk。语法/试题的 Chalk 是独立 artifact，不跟阅读课 deck 拼在一起。
- 主题是数据；换主题不重新生成内容。P1 先做两套，后续可加。

### 4.4 版式目录

v2 实现了 19 种（含 prompt/reveal 变体），首版产品可先取其中 10–12 种：

| 版式 | 教学动作 | 关键点 |
| --- | --- | --- |
| `cover` | 进入文本/任务 | 标题、副标题、lesson question、meta；内容 motif（书架/地平线），不用通用圆环 |
| `objectives` | 交代目标 | 3 条 SOLO 层级；objective 18px + criterion 16px 在同一列；底部 `TODAY'S TARGET` |
| `pre_reading` | 读前激活 | 左侧 provocation 卡，右侧 3 个问题；sentence frames + listen-for 在底部 |
| `text_structure` | 结构梳理 | 3 张阶段卡；quote 17px；signal 词在卡内；底部一句 takeaway |
| `passage`（first read） | 首次阅读 | 正文 19px，右侧 first-reading 问题；不显示注释 |
| `passage`（reveal） | 细读 | 正文 18px + 右侧 4 条注释 16px；底部一句 so-what |
| `language` | 语言聚焦 | 4 行表：chunk / meaning / example；16px；mini-task + answer |
| `questions`（prompt） | 提问 | 3 个层级问题 + support；答案不显示；底部 think note |
| `questions`（reveal） | 核对 | 同一版式显示 17px 答案 + sentence frame |
| `task` | 产出任务 | RAFT + time；language support + criteria + model pitch + pitch outline |
| `summary` | 出口票 | 3 条 takeaway + exit ticket（2 prompts、model、self-check、3 minutes）+ closure 句 |
| `story` | 读后续写原文 | 全文 18px + as-you-read 问题 + paragraph starters |
| `six_w` | 审题 | 2×3 格：Who/What/When-Where/Why/How/Conflict；每条带原文 evidence；底部“你准备回收哪条线索？” |
| `plot` | 情节/情绪线 | 6 个节点，横轴 P1/P2；事件 16、情绪 15、evidence 14；y 轴标 emotional intensity |
| `plan` | 两段规划 | P1/P2 功能 + 3 个 beats 16px + emotional vector；“ONE POSSIBLE PLAN”、tense note、pay-off clues |
| `support` | 语言支架 | 4 行表：function / chunks / model；chunks 17、model 15；dialogue 带 M/O 说话人 |
| `model` | 范文 | 19px 模型段 + 3 条 16px 注释；标注 “ONE POSSIBLE VERSION — COMPARE, DON'T COPY”；[1][2][3] 与注释对应 |
| `writing` | 写作任务 | 两个 starter（24px，居中）+ checklist 16 + P1/P2 skeleton + before-you-write 3 问 |
| `closing` | 收束 | 3 条 before-you-hand-in + attributed quote + homework；不是装饰性 bookend |
| `grammar` | 语法对比 | 2 列 × 4 行（Form/Meaning/Use/Signals）+ 跨列 TRAP + quick check 答案 |
| `exam`（prompt/reveal） | 试题分析 | prompt 页只有题干/选项 + THINK；reveal 页给 answer/evidence/why/trap/pattern；正确项 ✓ |

### 4.5 Prompt / reveal：不要用动画，用两张静态页

课堂节奏常常需要“先让学生想，再揭晓”。PowerPoint 动画在 WPS/不同版本/导出 PDF 里都不可靠，而且 python-pptx 不直接支持。我们的做法：

- deck JSON 里给需要揭晓的版式标 `staged: true`；
- 编译器把这一页展开成两张：`reveal: false`（问题/原文/题干）和 `reveal: true`（答案/注释/分析）；
- 两张页共享同一版式与坐标，翻页即揭晓；PPTX 是静态的，可编辑、可打印、在 PowerPoint/WPS 表现一致；
- 页数会增加（阅读课 9 个内容页 → 11 张），blueprint 的页数范围要把 reveal 页算进去；
- 老师控制节奏，学生看不到“跳到答案”的动画依赖。

这是“教学功能”对“技术便利”的一次取舍：两张静态页比一段 OOXML 动画更土，但更可靠、更可编辑，也更符合课堂。

### 4.6 编译器的确定性守卫与溢出检查

运行时不做视觉评审，但要做确定性检查：

- **schema/blueprint**：版式 id、字段、条数、必选节点；
- **文本 fit**：真实字体度量、断行、自动 fit；payload 不得低于 16px；
- **安全余量**：payload 只用框宽的 92%、框高的 98%；标签用 96% 宽。这样 PowerPoint/WPS 换字体后也不会贴边溢出；
- **密度预算**：每个版式有最低字符数/单元数，低于阈值报“内容偏少”；
- **溢出**：任何文本框放不下时返回页码和字段，交给 writer 删内容/拆页；
- **引文/时态**：编译器不能判断语义，但 writer 提示词和审阅会检查“引文逐字、时态一致、答案在位”；
- **一次修复**：schema/溢出/密度 warning 触发一次 writer 修复；仍不过就如实返回警告，不静默缩字号或截断。

**为什么不用“截图 + 视觉模型”做运行时检查：**

- 慢、贵、依赖 Playwright/Chromium；
- 视觉模型本身会误判，且难以证明“没有溢出”；
- 我们的文本在编译时已经断行，PPTX 设 `wrap="none"`，溢出是**可测量**的，不需要猜。

**设计/CI 用的 `layout_check.py`：**

- 生产实现是 `backend/app/agent_workspace/slides/check.py` 的 `check(scene)`；原型 `layout_check.py` 只作参考。
- 读 scene，对每个文本图元检查：实测行宽/框宽、行数×行高/框高、是否越出安全区；
- 如果文字位于卡片内，逐行检查是否越过卡片边缘（这能抓到“文字压到卡片边框/盖住相邻内容”）；
- 两两检查文本行框是否相交（>8px² 才报），抓错位/重叠；标签和装饰不参与 warning；
- **error** 只在实测超过框（含 1px 容差）时报；**warning** 只在 payload 使用 >94% 框宽（或多行 >97% 框高）时报；
- 标签、页码、装饰点不参与 warning；短标签本来就接近框宽，避免误报；
- 检查器与编译器共用同一套字体度量；三份样片当前 `0 errors, 0 warnings`；
- 真实页面还可以用 SVG `getBBox()` 或 PPTX→PDF 的文本 span bbox 做更严格的渲染检查；这是 CI/设计时工具，不是用户请求的同步步骤；
- 最终仍要在真实 PowerPoint/WPS 上验收：LibreOffice 通过不等于 PowerPoint 通过。

**样片第 5 页的溢出与修复：**

- 首读正文曾用 19px / 760px 宽，实测行宽 95%、文本高 94%；在 PowerPoint/WPS 换字体后就会越界覆盖。
- 修复：正文改为 17px / 840px，右栏缩到 252px，payload 8% 安全余量；底部加“先读一遍，标出转折句。”
- 复检：`layout_check.py` 0 error/0 warning；LibreOffice 渲染确认正文在框内；Preview/PPTX 对比见 `docs/evidence/ppt-prototype-en/compare-reading.png`。

原型里这些检查把 11 页阅读 deck、9 页续写 deck、3 页 gallery 都跑到 0 warning；阈值是按当前版式调的，真实任务需要继续校准。

### 4.7 英语课件的特殊性

- **slide 是双语的**：中文教学指令、审题、错因、注释、task brief；英文语篇、问题、例句、范文、sentence frames。notes 用中文，放答案、时间、板书、分层提示。不是“全英文讲解”，也不是“全中文翻译”。
- **引文逐字**：阅读/续写 deck 的核心是“引用证据”。如果模型把 “Most people walked past it without looking up” 缩成 “Walked past without looking up”，它就在教学生做错事。写作提示词要求逐字引用；省略用省略号。
- **时态纪律**：读后续写的 plan 用 present simple 做 synopsis，正式写作/范文用 past simple；必须在 plan 页标注，否则学生会混。
- **术语一致**：BEFORE/TURN/AFTER 在结构页和细读页用同一套词；情绪线用 anxiety/hesitation/hope/resolve/relief/connection，plan 页复用同一套。
- **中文只做辅助**：需要中文释义/语法说明时，用 16px 的注释层，不把中文正文混进英文段落的主阅读层。
- **别用中文排版规则排英文**：英文按词断行，行长控制在约 45–75 字符；不要用宋体排英文正文。

## 5. 设计时调优记录

### 5.1 第一版（v1）与本轮评审

v1 是 19 张：阅读 9、续写 8、语法/试题 2。它已经避免了常见的 AI slop（无紫色渐变、无阴影、无装饰条），有 Source Serif 4 / Inter 的编辑感，但两位独立评审都没让它过：

- 教师视角：6.78 / 10；设计 director 视角：7.56 / 10；通过线 8.2。
- 主要问题：
  1. **字号地板失守**：标签 9–10px，答案/criteria 13–14px，语篇证据 11px。投影到教室后排基本看不见。
  2. **底部五分之一习惯性空着**：目标页 145px、任务页 125px、出口票左侧 247px、结束页 193px。
  3. **没有揭晓设计**：问题和答案同屏，正确选项预先高亮；老师没法“先让学生想”。
  4. **续写 deck 没有原文**：六 W 和情节线引用原文，但学生看不到故事；计划还替学生把结尾写完了。
  5. **教学链自相矛盾**：语言页的填空四个 chunk 都填不进去；语法页的 TRAP 把现在完成时的错句放在过去时列；出口票考了没教的 “turn into”；model 的开头就是写作 starter 的续写；plan 用现在时、范文用过去时不说明。
  6. **引文不精确**：多处省略/改写了原文，和“引用证据”的教学目标冲突。

这些不是“审美偏好”，而是“能不能上课”的问题。

### 5.2 v2 改了什么

- **字号阶梯重做**：84/44/24/18/16/13/11；payload 不低于 16，标签 12–13；答案 16、criteria 16、model 19/16。
- **内容底线**：所有标准页在 640 前有教学内容；卡片按内容定高；空出来的地方放 sentence frames、answer key、pitch outline、closure 句、homework，而不是留白。
- **prompt/reveal**：passage、questions、exam 三类页面自动展开为两张；答案/注释/分析只在 reveal 页出现；正确项只在 reveal 页打 ✓。
- **续写 deck 加原文页**：全文 18px + as-you-read 问题 + paragraph starters；六 W 的 evidence 有出处；计划标 “ONE POSSIBLE PLAN”，P2 改成 relational beat，不再用 thematic summary。
- **写作顺序**：先写（writing task），再看 model（“ONE POSSIBLE VERSION — COMPARE, DON'T COPY”），避免 model 提前给出答案。
- **字体保真**：PPTX 用 Georgia/Arial，预览/度量用 Gelasio/Arimo；换行和 fit 在两端基本一致。
- **教学链修复**：语言 mini-task 改成 “I was ______” → just passing by；语法 TRAP 改成跨列两行 + quick check 答案；出口票用教过的 chunk + model + self-check；plan 标 tense note；术语统一。
- **封面/结束页**：封面用书架/地平线 motif + lesson question + level meta；结束页用 before-you-hand-in + attributed quote + homework，不是装饰性收尾。

### 5.3 v2 的证据

| 指标 | v2 |
| --- | --- |
| 阅读 deck | 11 页（9 个内容页 + 2 个 reveal 页） |
| 续写 deck | 9 页（含原文、写作、model、closing） |
| 语法/试题 | 3 页（语法 + 试题 prompt/reveal） |
| 编译 | 0.19 s（11 页） |
| SVG | 0.11 s |
| PPTX | 0.55 s |
| PPTX 大小 | 阅读 54 KB、续写 50 KB、gallery 35 KB |
| 密度/字号 warning | 0（三份 deck） |
| 布局检查 | `0 errors, 0 warnings`（payload 8% 余量、16px 地板） |
| 预览 vs PPTX | 字体 metric-compatible；line break 稳定；像素差主要来自 Arimo vs Liberation Sans 的字形抗锯齿 |

视觉证据：

- `docs/evidence/ppt-prototype-en/reading-sheet.png`（双语阅读 11 页）
- `docs/evidence/ppt-prototype-en/continuation-sheet.png`（双语续写 9 页）
- `docs/evidence/ppt-prototype-en/gallery-sheet.png`（Chalk 语法/试题）
- `docs/evidence/ppt-prototype-en/compare-reading.png`（第 5 页：预览 vs PPTX，溢出已修复）
- `docs/evidence/ppt-prototype-en/compare-continuation.png`（model 页：预览 vs PPTX）
- `docs/evidence/ppt-prototype-en/sample-reading.pptx`
- `docs/evidence/ppt-prototype-en/sample-continuation.pptx`
- `docs/evidence/ppt-prototype-en/sample-gallery.pptx`

### 5.4 第二轮评审（delta review）

第二轮只复核关键页，两位评审的结论有分歧，但指向同一批具体问题：

- **设计 director：** 阅读 8.28、续写 8.34、gallery 8.08；整体 8.28（阅读/续写）。“ship reading and continuation, conditional on a 13px label sweep”；gallery 作为 Chalk 独立 artifact 可以，但不该和 Paper 阅读 deck 混在同一份。
- **英语教师：** 关键页平均 7.55（从约 6.8 提升），仍判“one more pass”。剩余问题不是大字失败，而是：C3 的 WHAT 引了 bus 的句子、C4 的光在 P1/P2 之间映射不清；R5/R11/C2 的局部空底；C6/C7/R9/R11/C2/C4 还有 14–15px 的尾巴；R7/G1 把答案印在题面上。
- **评审后的最后一轮修复（已做）：** C3 的 WHAT 改为 ferry/fog 证据并去掉 “lonely”；C4 的光归 P1、P2 只留 connection，并加 P1/P2 分界；R5 加宽正文到 760、右栏加 3 分钟 timer；R11 加 ticket check；C2 starters 16px；C4 evidence 16px；R7/G1 去掉题面答案；G2 加 answer frame；所有 label 提到 13px。
- **诚实结论：** 设计 director 在最后一轮修复前已经给出 8.28/8.34；教师给 7.55 时，最后一轮的 source map / dead rail / type tail 修复还没发生。按设计 director 的口径，阅读和续写可以进入 P1；按教师的口径，还需要一次真实课堂试用才能确认。**真正的通过标准不是评审分数，而是 20 个真实教学任务里教师愿不愿意直接用/改一改就用。**
- **双语版是结构确认后的新变量：** 上述评审看的是英文 v2；最终样片加入了中文教学指令/注释（双语）。版式、字号地板和 8% 余量没有变，`layout_check.py` 仍是 0 error/0 warning，但双语混排会改变行数与阅读节奏，需要下一轮教师评审重新看；不要用英文版的分数直接替代双语版的验收。

gallery 的 8.08 不作为阅读/续写 deck 的一部分；Chalk 主题是否保留，取决于产品是否要做“语法/试题”单独主题。首版建议保留 Chalk 作为独立主题，但不与 Paper deck 混排。

## 5.5 生产实现状态（2026-11）

已落地：

- `backend/app/agent_workspace/slides/`：schema、blueprints、themes、metrics、compile、check、pptx、writer；字宽表 `assets/font_metrics.json`。
- Agent 工具：`create_presentation`、`revise_presentation`、`read_presentation`；`TaskConfig.output`（document/slides）；`Runner` 的 `presentation` 模式；slides 版本/场景/备注/PPTX。
- 工作台 API：`GET .../versions/{id}/scene`、`GET .../export?format=pptx`、`POST .../theme`。
- 工具页：`POST /api/presentations/from-tool`、`GET /api/presentations/{task_id}`、`GET .../scene`、`GET .../export`、`DELETE`；通用工具 composer 的「生成 PPT」开关、历史卡片、轮询、预览、下载。
- 前端：`frontend/agent/slides.mjs` + `claude/slides.css`；结果页幻灯片查看器（缩略图/键盘/全屏/备注/主题/下载）。
- **Agent 启用方式**：任务「提示词」页 → 成果形式 → 演示文稿（自绘二选一，不是原生 select）；结果页自动进入幻灯片查看器。
- **主站启用/预览**：通用工具 composer 的「生成 PPT」胶囊（未选中性、选中整颗主题色，参考后台模型用途胶囊）；结果卡完成后点「预览」打开主站 Liquid Glass 模态（缩略图/翻页/备注/下载）。没有原生 checkbox/select/input。
- UI 约束：主站和 Agent 各自使用自己的设计 token；新控件全为 button/自定义面板，静态测试 `frontend/tests/ppt-ui-native-controls.test.js` 防回归。
- 数据：`WorkspaceVersion.kind`、`WorkspaceTask.origin/source_*`、`WorkspaceRendition`、`WorkspaceSettings.slides_enabled`。
- 测试：`tests/test_agent_slides_*` 共 21 项；后端全量 990 passed；前端 375 passed；生产 deck 经 LibreOffice 渲染验证。

默认关闭：`slides_enabled=false`。管理员在 Agent 后台开启后才显示 PPT 入口；已有 slides 版本始终可查看/导出。上线前仍需：真实 PowerPoint/WPS 验收、20 个真实教学任务、双语教师评审；命题类与可视化试卷尚未接入。

## 5.6 v2.1 修复：整卷材料与失败循环（2026-11-11）

真实任务暴露了一个不可用级失败：用户给一整张试卷（阅读 A–D、七选五、完形，6 个语篇），任务模板要求逐篇分析、合并在同一份 PPT 里交付，但页数区间只按单堂课标定（通用课上限 12 页），调度 Agent 生成的 27 页整卷 deck 反复被拒，删页重试 7 次、烧掉约 10 万 tokens 后被用户手动停止。逐条归因与修复：

1. **页数预算不随内容量扩展（根因）**：预期行为是整卷所有语篇的分析装进一份演示文稿，单课区间必然装不下。修复：deck 顶层新增 `units`（教学单元数＝语篇/专题数，写作者声明，封顶 12），页数区间变为 `blueprint 区间 + (units−1)×(3/10)`（下限 +3、上限 +10/单元）；`MAX_SLIDES` 从 20 提到 80 作绝对安全网。例：generic_lesson ×6 = 16–66 页，当时的 27 页 deck 落在预算内。
2. **结构错误不走修复**：`generate_deck` 里 schema/blueprint/页数错误直接抛异常终结整个工具调用，只有排版溢出有一次修复机会——与 §4.6「schema/溢出/密度 warning 触发一次修复」的设计不一致。修复：结构错误与溢出统一走同一次修复，修复失败才如实报错。
3. **错误信息没有出路**：「通用课展开后 27 页，要求 1-12 页」不含恢复指引，调度层只会继续删页数。修复：所有校验错误带恢复指引（核对 units/补必选页/删可选页/换 blueprint），排版失败把前 3 条错误摘要写进 message（调度层只看得到 message）。
4. **计页口径没告诉写作者**：校验按「staged 页 ×2」计展开页数，但写作者 prompt 没说，模型按原始页数估。修复：system prompt、layout guide、user prompt 三处显式写明。
5. **单课区间太紧**：阅读课样片展开 11 页、上限 14，可选页稍多就顶死。单单元区间加余量：reading 7–14→7–16、continuation 8–12→8–14、writing 7–12→7–14、grammar/vocabulary 3–10→3–12、exam_review 3–16→3–20（staged 试题页 ×2）、writing_feedback 3–12→3–14、generic_lesson 1–12→1–16。
6. **大 deck 撞输出上限即截断**：40 页 deck 的 JSON 约 2 万多 tokens，触及单次输出上限后 JSON 被截断、整次调用作废。修复：写作者链路加「有限续写」（与文档生成同模式）：`finish_reason=length` 时最多续写 3 段把 JSON 接完，续写调用不带 response_format（结构化输出会逼模型重起完整 JSON，接不上前半）；续写后仍不完整时，修复指令要求压缩内容。
7. **非常规课型引导缺失**：语篇结构/主旨分析类模板没有 questions/task 环节，agent 选 reading 必然缺必选页。修复：工具描述明确「语篇结构、主旨分析等非常规课用 generic_lesson」。

写作者 system prompt 按《Prompt Engineering Guide for Coding Agents》整体重写（版本号 deck-writer-v1→v2）：范围/取材/双语/页数/备注/输出六块契约，多语篇合并与 units 机制，材料即数据的注入防线，user prompt 长材料后重申契约。审阅 prompt 补「不为提意见制造问题」阈值。新增回归测试：结构错误一次修复、修复失败如实报错、超页数报错指向 units、整卷 units=6 落入扩展预算、截断续写、绝对上限友好报错、预算公式契约。

## 6. 运行时快路径

```
工具结果 / 任务材料 / 教学提示词
        │
        ▼
[writer]  blueprint + 版式目录 + 内容预算 + 主题 + 引文/时态规则
        │  deck JSON（一次生成）
        ▼
[validate] schema + blueprint 必选节点 + 页数范围
        │
        ▼
[compile] 文本测量 → 断行 → fit → prompt/reveal 展开 → scene
        │  warnings（溢出/字号/密度）
        ├── 有 warning：一次 writer 修复
        ▼
[render] SVG 预览 / 原生 PPTX
```

- 一次 writer 调用，输出约 3–6k tokens（10 页 deck）。
- 编译 + 渲染 < 1 s；模型时间是主要成本。
- 不做截图、不做 Playwright、不做 5–15 轮视觉评审。
- 可选：异步的内容审阅（教学准确性/覆盖度），不阻塞首屏，也不做视觉迭代。
- 设计系统/版式/主题变更时，跑离线 golden deck 评审；这是开发的回归，不是用户的等待。

**什么时候需要重新开设计时 loop：**

- 新增版式/主题/学科；
- 换模型后，writer 的内容能力明显变化；
- 真实教师反馈“这页没法上”；
- 第二轮评审发现剩余问题属于系统而非单页。

## 7. 对 P1 的影响

### 7.1 建议锁定

- 交付物：`.pptx`；文档是内容源，PPT 是课堂交付；不做 HTML/PDF。
- 首批课型：阅读、读后续写/读写整合、写作、语法、词汇、试卷讲评、作文批改（7 类 blueprint）。
- 版式：10–12 种（从 v2 的 19 种里取高频），prompt/reveal 作为一等机制。
- 主题：Paper / Chalk 两套；不混用。
- 字体：PPTX Georgia/Arial + 宋体/微软雅黑；预览/度量 Gelasio/Arimo + Noto Serif/Sans SC。
- 双语：中文教学指令/注释 + 英文语篇/例句；notes 中文。
- 溢出：payload 8% 横向余量、16px 地板、`layout_check.py` 0 error/0 warning；真实 PowerPoint/WPS 另测。
- 修改：不做应用内编辑器；下载后在 PowerPoint/WPS 改；应用内做预览、让 Agent 改、可选换主题。
- 入口：工具页“生成 PPT”开关 + Agent 成果类型；共用同一套任务/版本/导出。
- 图表/表格/图片：不做图表、不做图片；语法矩阵是固定版式，不是任意数据表格；真正的数据表/图表 P1.5/P2。

### 7.2 需要确认

1. 7 类 blueprint 是否覆盖首批工具？有没有漏掉的课型？
2. 开关打开后是“文档 + PPT”，还是只出 PPT？建议保留文档，它是 deck 的内容源。
3. 试卷可视化全解的 PPT 化是否走独立“一题一页”适配，而不是套阅读课 blueprint？
4. P1 是否接受“没有应用内编辑器”，下载后外部修改？
5. 第二轮评审的剩余问题，是否按“只改具体页”处理，不再重做系统？

## 8. 参考资料

1. Anthropic, *Harness design for long-running apps*：<https://www.anthropic.com/research/harness-design-long-running-apps>
2. Anthropic 官方 pptx skill（pptxgenjs + OOXML + QA）：<https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md>
3. Presenton（JSON 场景模板 + 浏览器导出）：<https://github.com/presenton/presenton>
4. PPT Master（SVG → DrawingML）：<https://github.com/hugohe3/ppt-master>
5. GordenPPTSkill（中文原生模板 + python-pptx）：<https://github.com/GordenSun/GordenPPTSkill>
6. html-to-editable-pptx（HTML → 可编辑 PPTX 的工程量）：<https://github.com/Hasasasa/html-to-editable-pptx>
7. PPTAgent（参考稿 + 编辑式生成 + PPTEval）：<https://arxiv.org/abs/2501.03936>
8. V2EX 讨论（HTML 好看但 PPTX 必需、模板限制、AI 味）：<https://www.v2ex.com/t/1211441>
9. Kimi 的 14 种 PPT skills：<https://www.kimi.com/zh-cn/resources/ppt-skills-for-agents>
10. frontend-slides（HTML 演示 skill）：<https://github.com/zarazhangrui/frontend-slides>
