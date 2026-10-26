# Claude 风格 Agent 工作台 · 验收证据

对应实现与取舍见 [CLAUDE_STYLE_PORT.md](../../CLAUDE_STYLE_PORT.md)。

## 截图

所有截图来自隔离后端（`backend/tests/workspace_browser_server.py`）与 Chromium 141 无头渲染，接口与状态均来自假模型或测试接口，不使用真实模型。测试目录使用一个完成态任务，避免把验收脚本自己创建的空白任务带进截图。

| 文件 | 视口 | 主题 | 状态 |
| --- | --- | --- | --- |
| `home-light-1440x900.png` / `home-dark-1440x900.png` | 1440×900 | 浅色 / 深色 | 新任务空态、单行输入卡片、`↵` 发送键、工具行右端的模型入口、Clawd |
| `conversation-light-1440x1240.png` / `conversation-dark-1440x1240.png` | 1440×1240 | 浅色 / 深色 | 与上游截图同视口：隐藏工作区，用户目标、思考折叠预览、平面工具行、长成果折叠、审阅行、成果卡片、Clawd 完成态 |
| `conversation-light-1440x1000.png` | 1440×1000 | 浅色 | 对话：平面思考/工具行、长思考折叠预览、长成果折叠、成果卡片 |
| `steps-flat-light-1440x1000.png` / `steps-flat-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 完成态：24px 平面步骤行，无边框、无卡片底色、无尾部状态字；思考折成一句预览 |
| `waiting-window-light-1440x1000.png` / `waiting-window-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 运行中：三套加载动作之一、橙色 4px 点、1500ms 遮罩高光带；思考只占 4 行窗口 |
| `wait-loader-rotated-light-1440x1000.png` | 1440×1000 | 浅色 | 等待行 10s 换班后：动作已从上一套换到另一套，点逐个交接 |
| `reasoning-expanded-light-1440x1000.png` | 1440×1000 | 浅色 | 完成态展开思考：正文从第一行开始，24px 行距，最多 400px 内滚动，不再有「查看全文与搜索」 |
| `conversation-light-1920x1080.png` | 1920×1080 | 浅色 | 大屏 |
| `conversation-light-1024x768.png` | 1024×768 | 浅色 | 单主区 + 抽屉入口 |
| `tablet-light-768x1024.png` | 768×1024 | 浅色 | 平板单主区 |
| `model-picker-light-1440x1000.png` / `model-picker-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 模型选择器：平铺列表、自有描述、AA 评级、免费/免码标签、选中勾；最后一行是无描述测试模型，单行内容在 42px 行内上下居中；无厂商 logo、无分组 |
| `task-row-menu-light-1440x1000.png` | 1440×1000 | 浅色 | 任务行「…」菜单：190px 宽、两项、红色删除；不再被拉成整行 |
| `template-select-light-1440x1000.png` | 1440×1000 | 浅色 | 模板自绘下拉：30px 行、橙色选中勾、可滚动；不弹浏览器原生列表 |
| `composer-caret-light-1440x1000.png` | 1440×1000（裁 820×236） | 浅色 | 输入卡片、2px 橙色绘制光标（`#D97757`）、`↵`、工具行、Clawd |
| `clawd-thinking-light-1440x1000.png` | 1440×1000（裁 820×260） | 浅色 | Clawd 思考帧（气泡） |
| `workspace-overlay-light-1280x800.png` | 1280×800 | 浅色 | 工作区浮层与遮罩 |
| `workspace-prompt-light-1440x1000.png` / `workspace-prompt-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 提示词编辑、模板、自动保存 |
| `workspace-materials-light-1440x1000.png` | 1440×1000 | 浅色 | 材料上传与选中 |
| `workspace-tools-light-1440x1000.png` | 1440×1000 | 浅色 | 工具开关、教学工具、审阅设置 |
| `workspace-results-light-1440x1000.png` / `workspace-results-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 版本、成果正文与操作 |
| `review-modal-light-1440x1000.png` | 1440×1000 | 浅色 | 审阅意见、忽略与生成候选稿 |
| `mobile-chat-light-390x844.png` / `mobile-chat-dark-390x844.png` | 390×844 | 浅色 / 深色 | 手机单栏、输入卡片、材料 chip、Clawd、底部切换 |
| `mobile-model-picker-light-390x844.png` | 390×844 | 浅色 | 手机模型选择器（340px 卡片，8px 间距） |
| `mobile-workspace-light-390x844.png` / `mobile-workspace-dark-390x844.png` | 390×844 | 浅色 / 深色 | 手机工作区 |
| `mobile-drawer-light-390x844.png` | 390×844 | 浅色 | 任务抽屉（关闭按钮、底部切换让位） |

## 对照

`compare-light.png`、`compare-dark.png` 把上游 `docs/screenshots/claude-conversation-{light,dark}.png`（固定提交 `1e7acc5b`）与本次 `/agent` 的 1440×1240 完成态截图并排。两边都隐藏工作区；上游是 Markdown 渲染示例，NeoBangX 是假模型的完成态任务，业务内容不同，只对照版式、字体、颜色、步骤行与折叠。上游没有右侧工作区，NeoBangX 的三栏形态放在工作区截图里。

差异属于宿主业务适配：侧栏任务按更新时间分组、保留材料/成果/工具工作区、空目标直接执行、真实执行记录与审阅。输入卡片、`↵`、工具行高度、模型入口位置、字体、颜色、圆角、层级、正文宽度、表格、代码、折叠、等待行、滚动跟随与动效参数按上游。

## 自动化与性能

- `browser-report.json`：最近一次 `node tools/test-claude-agent-browser.mjs` 的 **20 组场景全部通过，0 个浏览器错误**。直接操作包括：`↵` 按钮、Shift+Enter 换行、橙色绘制光标（80ms 位移、1000ms 闪烁）、等待行三套动作与 10s 换班、平面思考/工具行与 4 行思考窗口、模型平铺列表/自有描述/评级/标签/键盘/选中/单行垂直居中、Clawd 帧变化、190px 任务菜单、模板自绘下拉。
- `performance.json`：200 条轨迹 + 30 万字符成果、12,683 个 DOM 节点下，40 次工作区页签切换 p95 为 124.7 ms、最大 270.9 ms（Ubuntu 22.04，Chromium 141 无头软件渲染且并行录屏）。
- 同一场景下 200 条步骤完整保留，30 万字符成果导出 SHA-256 与种子值一致，分页单页正文 ≤ 13,000 字符。
- 20 万字符以上思考：运行中只以末尾约 1,800 字符的 4 行窗口出现；展开后全文进入 DOM、从第一行开始、阅读器搜索与下载完整；30 万字符成果：分页、导出、原文末行保留。
- 交互视频与 trace 由验收脚本写在 `.debug/claude-port/<run>/video/` 与 `trace.zip`，不提交到仓库。最近一次 trace 含 2,192 个 screencast 帧、930 个 DOM 快照、423 组动作；已抽取帧与快照检查等待行动画、平面步骤行、输入卡片、模型选择器、自绘下拉与任务菜单、阅读器、冲突态与长文滚动。

## 启动项目

```bash
cd backend
# 依赖已同步时可直接启动；DATA_DIR 可指向新的空目录
DATA_DIR=/tmp/neobangx-data \
  .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# 浏览器打开 http://<host>:8000/agent
```

本次在 Ubuntu 22.04 上用上述命令启动，`/agent`、`/static/agent/claude/tokens.css`、`/static/agent/caret.mjs`、`/static/agent/model-picker.mjs` 均返回 200。普通工具页与 `/admin` 未改版，仍需各自的原有配置。

## 复现验收

```bash
# 安装浏览器依赖（只需一次；本机没有 root 时解包到 ~/.local/pwlibs）
npx playwright install chromium

# 一条命令启动隔离后端并跑完全部浏览器场景
LD_LIBRARY_PATH=$HOME/.local/pwlibs/usr/lib/x86_64-linux-gnu \
  node tools/test-claude-agent-browser.mjs

# 只启服务，手工打开 http://127.0.0.1:8765/agent（使用码 WORKSPACE-TEST）
cd backend && .venv/bin/python tests/workspace_browser_server.py
```

结论以实际打开截图、视频帧与 trace 为准；生成文件本身不构成验证。
