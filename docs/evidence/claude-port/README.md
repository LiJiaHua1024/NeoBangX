# Claude 风格 Agent 工作台 · 验收证据

对应实现与取舍见 [CLAUDE_STYLE_PORT.md](../../CLAUDE_STYLE_PORT.md)。

## 截图

所有截图来自隔离后端（`backend/tests/workspace_browser_server.py`）与 Chromium 141 无头渲染，接口与状态均来自假模型或测试接口，不使用真实模型。

| 文件 | 视口 | 主题 | 状态 |
| --- | --- | --- | --- |
| `home-light-1440x900.png` / `home-dark-1440x900.png` | 1440×900 | 浅色 / 深色 | 新任务空态、材料 chip、目标与开始按钮 |
| `conversation-light-1440x1240.png` / `conversation-dark-1440x1240.png` | 1440×1240 | 浅色 / 深色 | 与上游截图同视口：侧栏 + 对话，隐藏工作区，用户目标、思考折叠、工具行、长成果折叠、审阅行、成果卡片 |
| `conversation-light-1920x1080.png` | 1920×1080 | 浅色 | 大屏三栏 |
| `conversation-light-1024x768.png` | 1024×768 | 浅色 | 单主区 + 抽屉入口 |
| `tablet-light-768x1024.png` | 768×1024 | 浅色 | 平板单主区 |
| `workspace-overlay-light-1280x800.png` | 1280×800 | 浅色 | 工作区浮层与遮罩 |
| `workspace-prompt-light-1440x1000.png` / `workspace-prompt-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 提示词编辑、模板、自动保存 |
| `workspace-materials-light-1440x1000.png` | 1440×1000 | 浅色 | 材料上传与选中 |
| `workspace-tools-light-1440x1000.png` | 1440×1000 | 浅色 | 工具开关、教学工具、审阅设置 |
| `workspace-results-light-1440x1000.png` / `workspace-results-dark-1440x1000.png` | 1440×1000 | 浅色 / 深色 | 版本、成果正文与操作 |
| `review-modal-light-1440x1000.png` | 1440×1000 | 浅色 | 审阅意见、忽略与生成候选稿 |
| `mobile-chat-light-390x844.png` / `mobile-chat-dark-390x844.png` | 390×844 | 浅色 / 深色 | 手机单栏、输入卡片、对话与底部切换 |
| `mobile-workspace-light-390x844.png` / `mobile-workspace-dark-390x844.png` | 390×844 | 浅色 / 深色 | 手机工作区 |
| `mobile-drawer-light-390x844.png` | 390×844 | 浅色 | 任务抽屉（关闭按钮、底部切换让位） |

## 对照

`compare-light.png`、`compare-dark.png` 把上游 `docs/screenshots/claude-conversation-{light,dark}.png`（固定提交 `1e7acc5b`）与本次 `/agent` 的 1440×1240 截图并排。上游没有右侧工作区，因此对照图使用隐藏工作区的对话状态。

差异属于宿主业务适配：侧栏任务按更新时间分组、保留材料/成果/工具工作区、输入卡片保留附件与额度状态、思考/工具行来自真实执行记录。字体、颜色、圆角、层级、正文宽度、表格、代码、折叠、等待行、滚动跟随与动效参数按上游。

## 自动化与性能

- `browser-report.json`：最近一次 `node tools/test-claude-agent-browser.mjs` 的 15 组场景全部通过，0 个浏览器错误。
- `performance.json`：200 条轨迹 + 30 万字符成果、12,428 个 DOM 节点下，40 次工作区页签切换 p95 为 110 ms、最大 113 ms（Ubuntu 22.04，Chromium 141 无头软件渲染，无 GPU）。
- 同一场景下 200 条步骤完整保留，30 万字符成果导出 SHA-256 与种子值一致，分页单页正文 ≤ 13,000 字符。
- 20 万字符以上思考：折叠计数、展开全文、阅读器搜索、下载完整文本；30 万字符成果：分页、导出、原文末行保留。
- 交互视频与 trace 由验收脚本写在 `.debug/claude-port/<run>/video/` 与 `trace.zip`，不提交到仓库。最近一次 trace 含 1,295 个 screencast 帧、599 个 DOM 快照、264 组动作、0 个 console error；已抽取帧与快照检查等待行动画、输入卡片、阅读器、冲突态与长文滚动。

## 启动项目

```bash
cd backend
# 依赖已同步时可直接启动；DATA_DIR 可指向新的空目录
DATA_DIR=/tmp/neobangx-data \
  .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# 浏览器打开 http://<host>:8000/agent
```

本次在 Ubuntu 22.04 上用上述命令启动，`/agent` 与 `/static/agent/claude/tokens.css` 均返回 200。普通工具页与 `/admin` 未改版，仍需各自的原有配置。

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
