# 英语教学 PPT v2 证据（双语版）

这是 `docs/AGENT_PPT_TEACHING_DESIGN.md` 的配套证据。研究原型，不是生产代码，也没有接入 `/agent`。

## 文件

| 文件 | 说明 |
| --- | --- |
| `sample-reading.pptx` | 11 页双语阅读课：中文教学指令/注释 + 英文语篇/问题/例句；含 prompt/reveal 两页 |
| `sample-continuation.pptx` | 9 页双语读后续写：英文原文/范文 + 中文审题、计划、支架、检查 |
| `sample-gallery.pptx` | 3 页语法/试题：Chalk 主题，独立 artifact |
| `reading-sheet.png` / `continuation-sheet.png` / `gallery-sheet.png` | 逐页总览 |
| `compare-reading.png` | 上：SVG 预览；下：PPTX 经 LibreOffice 渲染（第 5 页，之前溢出的页面） |
| `compare-continuation.png` | 上：SVG 预览；下：PPTX 经 LibreOffice 渲染（model 页） |
| `deck-*.json` | 三份语义稿 |
| `prototype/` | 可运行源码，见其 README |

## 溢出检查

- `layout_check.py` 是保守的布局检查器：只对**学生要读的 payload** 报告 >94% 的接近边界，>100% 才报 error；标签/页码/装饰点不参与 warning，避免误报。
- 编译器对 payload 使用 **8% 水平安全余量 + 2% 垂直余量**，并把 payload 字号下限锁在 16px；放不下时返回 warning，让 writer 删内容/拆页，而不是静默缩字号。
- 检查器还做卡片边缘越界和文本行两两相交（>8px² 才报）；三份 deck 当前：`0 errors, 0 warnings`。
- 第 5 页曾出现明显溢出：首读正文 95% 宽、94% 高；已改为 840px 宽、17px、8% 余量，并在底部加“先读一遍，标出转折句”。PPTX 渲染确认不再越界。

## 指标（本机）

- 阅读 11 页、续写 9 页、gallery 3 页；密度/字号检查 0 warning。
- 编译 0.2 s、SVG 0.1 s、PPTX 0.6 s（11 页）。
- PPTX：阅读 54 KB、续写 50 KB、gallery 35 KB；全部原生文本/形状，无整页截图。
- 字体：PPTX 用 Georgia/Arial + 宋体/微软雅黑；预览/度量用 Gelasio/Arimo + Noto Serif/Sans SC（拉丁 metric-compatible）。
- LibreOffice 渲染时 Georgia→Gelasio、Arial→Liberation Sans、宋体/微软雅黑→Noto；预览与 PPTX 的换行和 fit 基本一致。

## 注意

- 原型内容是人写的，writer 尚未接入；这验证设计/编译/渲染/检查链路，不验证模型生成质量。
- 真实 Windows PowerPoint / WPS 仍需真机验收；LibreOffice 通过不等于 PowerPoint 通过。
- 文本在编译时已断行，PPTX 设 `wrap="none"`；用户手动把某行改很长会溢出，需要“重排本页”或重新生成。
- 字体文件不提交；运行 `prototype/prepare_fonts_en.py` 自动下载。
