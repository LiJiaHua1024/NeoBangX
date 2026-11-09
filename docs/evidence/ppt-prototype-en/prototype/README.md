# 英语教学 PPT v2 研究原型

这是 `docs/AGENT_PPT_TEACHING_DESIGN.md` 的配套源码。研究原型，不是生产代码；没有接入 `/agent`。

## 依赖

- Python 3.10+
- `python-pptx`、`Pillow`、`fonttools`、`brotli`
- 可选：`playwright`（截图）
- 可选：LibreOffice（PPTX → PDF/PNG 对比）

```bash
uv venv .venv
uv pip install --python .venv/bin/python python-pptx pillow fonttools brotli
npm install playwright
npx playwright install chromium
```

## 运行

```bash
# 1. 下载并裁剪 Gelasio / Arimo（与 Georgia / Arial 字宽兼容）
python prepare_fonts_en.py

# 2. 编译某一份 deck -> out/scene.json + out/deck-source.json
python compile_en_v2.py deck-reading

# 3. 场景图 -> SVG 预览 / PPTX
python render_svg.py
python render_pptx.py

# 4. 保守检查：payload 宽度/高度、安全区、字号地板
python layout_check.py

# 5. 可选：把预览截成 out/slide-XX.png
node shot.mjs
```

换 deck：改 `compile_en_v2.py` 的参数为 `deck-continuation` 或 `deck-gallery`，再跑 `render_svg.py` / `render_pptx.py`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `deck-reading.json` | 11 页阅读课（9 个内容页 + 2 个 reveal 页） |
| `deck-continuation.json` | 9 页读后续写（含原文、六 W、情节线、计划、支架、写作、model、closing） |
| `deck-gallery.json` | 3 页语法/试题（Chalk 主题，独立 artifact） |
| `compile_en_v2.py` | 设计系统 v2：版式、字号、内容底线、prompt/reveal、密度检查 |
| `textfit.py` | 字体度量、英文按词断行、自动 fit |
| `render_svg.py` | scene → SVG 预览 / 放映页 |
| `render_pptx.py` | scene → python-pptx 原生对象（Georgia/Arial） |
| `prepare_fonts_en.py` | 下载 Gelasio / Arimo 子集 |
| `shot.mjs` | Playwright 截图 |
| `layout_check.py` | 保守的溢出/密度检查；payload >94% 宽才 warning，>100% 才 error；同时查卡片边缘越界和文本行相交 |

## 关键取舍

- **PPTX 字体是 Georgia / Arial，预览用 Gelasio / Arimo。** 它们是 metric-compatible 的开源字体，因此换行和 fit 在预览与导出之间基本一致；PPTX 不依赖用户安装冷门字体。
- **prompt/reveal 是两张静态页，不是动画。** deck JSON 标 `staged: true`，编译器自动展开；PPTX 可编辑、可打印、在 PowerPoint/WPS 表现一致。
- **字号地板**：学生要读的 payload ≥16px，标签 12–13px；放不下时报 warning，不静默缩字号。
- **安全余量**：payload 横向只用到框宽的 92%，纵向 98%；PowerPoint/WPS 字体替换时不会贴边溢出。
- **双语**：阅读/续写是“中文教学指令 + 英文语篇/例句”；CJK 用 Noto 预览/度量，PPTX 写宋体/微软雅黑。
- **内容底线**：标准页在 y≈640 前要有教学内容；编译器有最低字符数/密度检查。
- **引文逐字、时态一致、答案在位**：这些是 writer 提示词和评审的硬规则，编译器不能替模型判断语义。

## 注意

- 字体文件不提交（`.gitignore` 排除 `fonts/`、`out/`）；`prepare_fonts_en.py` 会下载。
- LibreOffice 对比时可以把 Georgia/Arial 别名到 Gelasio/Arimo；PowerPoint 真机仍要另测。
- 原型里的 deck 内容是人写的，writer 尚未接入；这验证的是设计/编译/渲染链路，不是模型生成质量。
