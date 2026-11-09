# 生产引擎样片

由 `backend/app/agent_workspace/slides/` 直接编译 `tests/fixtures/slides/*.json` 生成，不是研究原型的截图：

| 文件 | 说明 |
| --- | --- |
| `sample-reading.pptx` | 11 页双语阅读课；每页中文 notes；Paper 主题 |
| `sample-continuation.pptx` | 9 页双语读后续写；Paper 主题 |
| `agent-viewer.png` | Agent 结果页：版本「PPT · 11 页」、缩略图、备注、下载、全屏 |
| `fullscreen.png` | 幻灯片全屏预览 |
| `result-card.png` | 主站结果卡：PPT 状态、预览、下载、在 Agent 中修改 |
| `main-preview.png` | 主站结果页的「预览」：主站 Liquid Glass 模态、缩略图、翻页、备注、下载 |
| `agent-output-choice.png` | Agent「提示词」页的成果形式：文档 / 演示文稿（自绘二选一） |
| `tool-switch.png` | 普通工具 composer 的「生成 PPT」胶囊开关（未选中性、选中整颗主题色） |

生产字体：PPTX Georgia/Arial + 宋体/微软雅黑；度量用 `slides/assets/font_metrics.json`，不下载字体。真实 PowerPoint/WPS 仍需人工验收。
