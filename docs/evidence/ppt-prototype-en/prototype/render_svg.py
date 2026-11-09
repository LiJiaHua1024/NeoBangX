"""Render a compiled scene graph to SVG and a small standalone viewer."""
from __future__ import annotations

import html
import json
from pathlib import Path

from PIL import ImageFont

from textfit import FAMILY_FILES, FONTS

ROOT = Path(__file__).parent
OUT = ROOT / "out"
STACK = {
    "serif": '"Gelasio","Noto Serif SC",Georgia,"Times New Roman",serif',
    "sans": '"Arimo","Noto Sans SC",Arial,"Liberation Sans",sans-serif',
}

CSS = """
@font-face{font-family:'Noto Serif SC';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,SERIF400) format('woff2')}
"""


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def font_metrics(family: str, weight: int, size: int, text: str = ""):
    weight = min(700, max(400, (weight // 100) * 100))
    if any("\u4e00" <= ch <= "\u9fff" for ch in text):
        from textfit import CJK_FILES
        path = FONTS / CJK_FILES[(family, weight)]
    else:
        path = FONTS / FAMILY_FILES[(family, weight)]
    f = ImageFont.truetype(str(path), size)
    return f.getmetrics()


def render_slide(slide: dict, theme: dict) -> str:
    parts = [f'<svg class="slide-svg" viewBox="0 0 1280 720" width="1280" height="720" '
             f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="第 {slide["index"] + 1} 页">']
    for p in slide["primitives"]:
        kind = p["type"]
        if kind == "rect":
            attrs = [f'x="{p["x"]}"', f'y="{p["y"]}"', f'width="{p["w"]}"', f'height="{p["h"]}"']
            if p.get("r"):
                attrs.append(f'rx="{p["r"]}"')
            attrs.append(f'fill="{p["fill"] or "none"}"')
            if p.get("stroke"):
                attrs += [f'stroke="{p["stroke"]}"', f'stroke-width="{p["sw"]}"']
            if p.get("opacity", 1) != 1:
                attrs.append(f'opacity="{p["opacity"]}"')
            parts.append("<rect " + " ".join(attrs) + "/>")
        elif kind == "ellipse":
            attrs = [f'cx="{p["cx"]}"', f'cy="{p["cy"]}"', f'rx="{p["rx"]}"', f'ry="{p["ry"]}"',
                     f'fill="{p["fill"] or "none"}"']
            if p.get("stroke"):
                attrs += [f'stroke="{p["stroke"]}"', f'stroke-width="{p["sw"]}"']
            if p.get("opacity", 1) != 1:
                attrs.append(f'opacity="{p["opacity"]}"')
            parts.append("<ellipse " + " ".join(attrs) + "/>")
        elif kind == "line":
            attrs = [f'x1="{p["x1"]}"', f'y1="{p["y1"]}"', f'x2="{p["x2"]}"', f'y2="{p["y2"]}"',
                     f'stroke="{p["stroke"]}"', f'stroke-width="{p["sw"]}"']
            if p.get("opacity", 1) != 1:
                attrs.append(f'opacity="{p["opacity"]}"')
            parts.append("<line " + " ".join(attrs) + "/>")
        elif kind == "text":
            parts.extend(render_text(p))
    parts.append("</svg>")
    return "\n".join(parts)


def render_text(p: dict) -> list[str]:
    lines = p["lines"]
    if not lines:
        return []
    size = p["size"]
    lh = p["line_height"]
    top = p["y"]
    if p["valign"] == "middle":
        top += (p["h"] - len(lines) * lh) / 2
    elif p["valign"] == "bottom":
        top += p["h"] - len(lines) * lh
    # A line with Chinese uses CJK metrics; a Latin line uses the Latin face.
    line_text = "".join(r["text"] for r in lines[0]["runs"])
    ascent, descent = font_metrics(p["family"], 400, size, line_text)
    baseline = (lh - (ascent + descent)) / 2 + ascent
    if p["align"] == "center":
        x, anchor = p["x"] + p["w"] / 2, "middle"
    elif p["align"] == "right":
        x, anchor = p["x"] + p["w"], "end"
    else:
        x, anchor = p["x"], "start"
    out = []
    for i, line in enumerate(lines):
        y = top + i * lh + baseline
        tspans = []
        for run in line["runs"]:
            attrs = [f'fill="{run["color"]}"']
            if run.get("weight", 400) >= 600:
                attrs.append('font-weight="600"')
            elif run.get("weight", 400) >= 500:
                attrs.append('font-weight="500"')
            if run.get("italic"):
                attrs.append('font-style="italic"')
            tspans.append(f'<tspan {" ".join(attrs)}>{esc(run["text"])}</tspan>')
        style = (f'font-family:{STACK[p["family"]]};font-size:{size}px;'
                 f'letter-spacing:{p["letter_spacing"]}px')
        opacity = f' opacity="{p["opacity"]}"' if p.get("opacity", 1) != 1 else ""
        out.append(f'<text x="{x}" y="{y:.1f}" text-anchor="{anchor}" '
                   f"style='{style}'{opacity}>" + "".join(tspans) + "</text>")
    return out


def build_preview(scene: dict) -> str:
    theme = scene["theme"]
    fonts_css = (ROOT / "fonts" / "fonts.css").read_text(encoding="utf-8")
    slides = []
    for slide in scene["slides"]:
        slides.append(f'<div class="slide" data-index="{slide["index"]}">'
                      + render_slide(slide, theme) + "</div>")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{esc(scene["title"])} · 预览</title>
<style>
{fonts_css}
html,body{{margin:0;background:#1b1b1b}}
body{{padding:40px;display:flex;flex-direction:column;gap:40px;align-items:flex-start}}
.slide{{width:1280px;height:720px;background:white;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)}}
.slide-svg{{display:block;width:1280px;height:720px}}
</style></head><body>
{"".join(slides)}
</body></html>"""


def build_viewer(scene: dict) -> str:
    theme = scene["theme"]
    fonts_css = (ROOT / "fonts" / "fonts.css").read_text(encoding="utf-8")
    slides = []
    for slide in scene["slides"]:
        slides.append(f'<section class="slide" data-index="{slide["index"]}">'
                      + render_slide(slide, theme) + "</section>")
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(scene["title"])}</title>
<style>
{fonts_css}
:root{{--w:1280;--h:720}}
*{{box-sizing:border-box}}
html,body{{margin:0;height:100%;background:#0d0d0d;overflow:hidden}}
#stage{{position:fixed;inset:0;display:grid;place-items:center}}
.slide{{display:none;width:min(100vw,calc(100vh * 16 / 9));aspect-ratio:16/9;background:white;
  box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden}}
.slide.active{{display:block}}
.slide-svg{{display:block;width:100%;height:100%}}
#hud{{position:fixed;left:24px;bottom:20px;color:#aaa;font:12px/1.4 system-ui,sans-serif;
  letter-spacing:.08em;opacity:.8}}
#bar{{position:fixed;left:0;bottom:0;height:2px;background:#c8a24a;transition:width .2s}}
@media print{{#hud,#bar{{display:none}} html,body{{background:white;overflow:visible}}
  #stage{{position:static;display:block}} .slide{{display:block;width:100%;box-shadow:none;page-break-after:always}}}}
</style></head><body>
<div id="stage">{"".join(slides)}</div>
<div id="hud"><span id="page">1</span> / {len(scene["slides"])} &nbsp;·&nbsp; ← → 翻页</div>
<div id="bar" style="width:{100 / len(scene['slides']):.3f}%"></div>
<script>
const slides=[...document.querySelectorAll('.slide')];let i=0;
function show(n){{i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle('active',k===i));
  document.getElementById('page').textContent=i+1;document.getElementById('bar').style.width=((i+1)/slides.length*100)+'%';}}
addEventListener('keydown',e=>{{if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key))show(i+1);
  if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key))show(i-1);if(e.key==='Home')show(0);if(e.key==='End')show(slides.length-1);}});
addEventListener('click',e=>show(e.clientX>innerWidth/2?i+1:i-1));
show(0);
</script></body></html>"""


def main():
    scene = json.loads((OUT / "scene.json").read_text(encoding="utf-8"))
    (OUT / "preview.html").write_text(build_preview(scene), encoding="utf-8")
    (OUT / "viewer.html").write_text(build_viewer(scene), encoding="utf-8")
    print("wrote preview.html viewer.html", len(scene["slides"]))


if __name__ == "__main__":
    main()
