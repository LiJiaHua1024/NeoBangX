# Agent PPT 原型证据

这是 `docs/AGENT_PPT_RESEARCH.md` 配套的研究原型，不是生产代码，也没有接入 `/agent` 的接口或界面。

## 文件

| 文件 | 说明 |
| --- | --- |
| `deck.json` | 9 页《荷塘月色》语文课件的语义稿：内容、版式 id、主题、演讲者备注 |
| `sample-deck.pptx` | 由同一份语义稿生成的原生 PPTX，文字/形状均可编辑，含演讲者备注 |
| `cover.png` | SVG 预览的封面（1280×720） |
| `all-slides.png` | 9 页总览 |
| `themes.png` | 墨 / 青 / 夜 / 赭四套主题的封面与内容页对比 |
| `compare-cover.png` | 上：SVG 预览；下：PPTX 经 LibreOffice 渲染（封面） |
| `compare-content.png` | 上：SVG 预览；下：PPTX 经 LibreOffice 渲染（三卡片页） |
| `compare-quote.png` | 上：SVG 预览；下：PPTX 经 LibreOffice 渲染（引文页） |

## 生产管线

```
 deck.json（模型只写内容 + 选版式 + 选主题）
        │
        ├─ compile.py   文本测量 → 断行 → 坐标/字号/颜色 → scene.json
        │
        ├─ render_svg.py  scene → SVG 预览 / 放映页
        └─ render_pptx.py scene → python-pptx 原生对象
```

原型的关键取舍：

- 模型不写 HTML/CSS，也不写坐标。版式、字号、留白和配色由代码里的设计系统决定。
- 文本在编译阶段按真实字体度量断行，HTML/SVG 与 PPTX 使用同一组断行结果，避免两端重新排版。
- PPTX 的每个视觉行是一个段落，`wrap="none"`，所以 PowerPoint 不会把已经排好的行重新折行。
- 中文用 `<a:ea typeface="宋体">`（正文为微软雅黑），西文分别用 Times New Roman / Arial。

可运行源码在 [`prototype/`](prototype/)，运行方式见其 README；本文档只保留产物和对比。

## 复现

原型依赖 Python 3.10+、`python-pptx`、`Pillow`、`fonttools`，预览截图用 Playwright。字体是从 Google Fonts 按用字裁剪的 Noto Serif SC / Noto Sans SC 子集，只用于本机预览和对比；PPTX 文件里写的是用户机器上常见的宋体/微软雅黑。

LibreOffice 对比渲染时用 fontconfig 把「宋体 / 微软雅黑」临时别名到 Noto 字体，因此对比图中的字形接近，但真实 Windows PowerPoint / WPS 的字体回退会略有差别。生产验收必须在真实 PowerPoint 和 WPS 上再看一遍。

## 原型指标（本机）

- 9 页编译 0.34 s，SVG 0.15 s，PPTX 0.42 s。
- PPTX 约 59 KB，9 页，全部为原生文本/形状，无整页截图。
- 无文本溢出告警。
- SVG 预览与 LibreOffice 渲染的逐页像素差：MAE 1.4–4.1 / 255；差异大于 40 的像素占 1.4%–3.4%，主要来自字体抗锯齿、行距和少量基线差异。

## 已知局限

- 只有 9 种版式、4 套主题，没有图表、表格、图片和动画。
- 没有逐页可视化编辑器；修订目前应通过重新生成或改语义稿完成。
- 真实 PowerPoint / WPS 的字体度量、换行与 LibreOffice 不完全一致；生产前要做真机验收。
- `wrap="none"` 保证版式稳定，但用户手动把某行改很长时会溢出而不是自动换行。
