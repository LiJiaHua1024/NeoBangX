# 可运行的研究原型

这是生成 `../sample-deck.pptx` 和 `../*.png` 的源码。它是研究原型，不是生产代码：没有接入 `/agent`，没有单元测试，版式/主题也是最小集合。

## 依赖

- Python 3.10+
- `python-pptx`、`Pillow`、`fonttools`、`brotli`
- 可选：`playwright`（只用于把 SVG 预览截成 PNG）
- 可选：LibreOffice（只用于把 PPTX 转 PDF/PNG 做对比）

```bash
uv venv .venv
uv pip install --python .venv/bin/python python-pptx pillow fonttools brotli
# 预览截图
npm install playwright
npx playwright install chromium
```

## 运行

```bash
# 1. 下载并裁剪 Noto Serif SC / Noto Sans SC（只保留 deck 用到的字）
python prepare_fonts.py

# 2. 语义稿 -> scene -> SVG -> PPTX
python compile.py
python render_svg.py
python render_pptx.py

# 3. 可选：把预览截成 out/slide-XX.png
node shot.mjs
```

产物：

- `out/scene.json`：编译后的场景图；
- `out/preview.html`：所有页的 SVG 预览；
- `out/viewer.html`：可键盘翻页的放映页；
- `out/deck.pptx`：原生 PPTX。

## 文件

| 文件 | 作用 |
| --- | --- |
| `deck.json` | 9 页《荷塘月色》语义稿（内容、版式 id、主题、备注） |
| `textfit.py` | 字体度量、中文断行、标点禁则、自动缩字号 |
| `compile.py` | 版式函数：把语义稿编译成 1280×720 场景图 |
| `render_svg.py` | 场景图 → SVG / 预览页 / 放映页 |
| `render_pptx.py` | 场景图 → python-pptx 原生对象 |
| `prepare_fonts.py` | 从 Google Fonts 取 Noto CJK 子集并实例化字重 |
| `shot.mjs` | Playwright 截图 |

## 注意

- 预览字体是 Noto CJK 子集，PPTX 里写的是宋体/微软雅黑。两者字形接近但不完全相同，真实 PowerPoint/WPS 的字体回退要另做验收。
- 文本在编译阶段已经断行；PPTX 使用 `wrap="none"`，所以 PowerPoint 不会二次折行。用户手动改长文本会溢出，需要“重排本页”或重新生成。
- `p:style` 被显式删除，避免主题 `effectRef` 给卡片带阴影；这是 LibreOffice 与 PowerPoint 都容易踩的坑。
- 字体文件不提交（`.gitignore` 排除了 `fonts/`、`out/`），运行 `prepare_fonts.py` 会自动下载。
