"""Map a compiled scene graph to a native, editable PowerPoint deck.

Every text line is already broken in compile.py, so PPTX gets one paragraph
per visual line and `word_wrap=False`: PowerPoint cannot reflow the design.
Position, size, colour, weight and letter spacing map 1:1 from the scene.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt
from lxml import etree

ROOT = Path(__file__).parent
OUT = ROOT / "out"
PX = 9525  # 1 design px = 1/96 in = 9525 EMU

FONTS = {
    "serif": ("Times New Roman", "宋体"),
    "sans": ("Arial", "微软雅黑"),
}
ALIGN = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}
ANCHOR = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE, "bottom": MSO_ANCHOR.BOTTOM}


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value.lstrip("#").upper())


def add_alpha(srgb, opacity: float):
    if opacity >= 1 or srgb is None:
        return
    for old in srgb.findall(qn("a:alpha")):
        srgb.remove(old)
    alpha = etree.SubElement(srgb, qn("a:alpha"))
    alpha.set("val", str(int(round(opacity * 100000))))


def fill_alpha(shape, opacity: float):
    spPr = shape._element.spPr
    solid = spPr.find(qn("a:solidFill"))
    if solid is not None:
        add_alpha(solid.find(qn("a:srgbClr")), opacity)


def line_alpha(shape, opacity: float):
    spPr = shape._element.spPr
    ln = spPr.find(qn("a:ln"))
    if ln is not None:
        solid = ln.find(qn("a:solidFill"))
        if solid is not None:
            add_alpha(solid.find(qn("a:srgbClr")), opacity)


def strip_style(shape):
    """A shape's p:style adds theme shadows/effects that an empty effectLst does
    not always override in LibreOffice; all fill/line values are explicit here."""
    style = shape._element.find(qn("p:style"))
    if style is not None:
        shape._element.remove(style)


def add_rect(slide, p):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if p.get("r") else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(kind, Emu(int(p["x"] * PX)), Emu(int(p["y"] * PX)),
                                   Emu(int(p["w"] * PX)), Emu(int(p["h"] * PX)))
    strip_style(shape)
    shape.shadow.inherit = False
    if p.get("r") and shape.adjustments:
        shape.adjustments[0] = min(0.5, p["r"] / max(1, min(p["w"], p["h"])))
    if p.get("fill"):
        shape.fill.solid()
        shape.fill.fore_color.rgb = rgb(p["fill"])
        fill_alpha(shape, p.get("opacity", 1))
    else:
        shape.fill.background()
    if p.get("stroke"):
        shape.line.color.rgb = rgb(p["stroke"])
        shape.line.width = Pt(max(0.5, p["sw"] * 0.75))
        line_alpha(shape, p.get("opacity", 1))
    else:
        shape.line.fill.background()
    return shape


def add_ellipse(slide, p):
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, Emu(int((p["cx"] - p["rx"]) * PX)),
                                   Emu(int((p["cy"] - p["ry"]) * PX)),
                                   Emu(int(p["rx"] * 2 * PX)), Emu(int(p["ry"] * 2 * PX)))
    strip_style(shape)
    shape.shadow.inherit = False
    if p.get("fill"):
        shape.fill.solid()
        shape.fill.fore_color.rgb = rgb(p["fill"])
        fill_alpha(shape, p.get("opacity", 1))
    else:
        shape.fill.background()
    if p.get("stroke"):
        shape.line.color.rgb = rgb(p["stroke"])
        shape.line.width = Pt(max(0.5, p["sw"] * 0.75))
        line_alpha(shape, p.get("opacity", 1))
    else:
        shape.line.fill.background()
    return shape


def add_line(slide, p):
    shape = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Emu(int(p["x1"] * PX)),
                                       Emu(int(p["y1"] * PX)), Emu(int(p["x2"] * PX)),
                                       Emu(int(p["y2"] * PX)))
    strip_style(shape)
    shape.line.color.rgb = rgb(p["stroke"])
    shape.line.width = Pt(max(0.5, p["sw"] * 0.75))
    line_alpha(shape, p.get("opacity", 1))
    return shape


def style_run(run, data, family, size, letter_spacing, opacity, accent=False):
    latin, ea = FONTS[family]
    run.text = data["text"]
    font = run.font
    font.size = Pt(size * 0.75)
    font.bold = data.get("weight", 400) >= 600
    font.italic = bool(data.get("italic"))
    font.name = latin
    font.color.rgb = rgb(data["color"])
    rPr = run._r.get_or_add_rPr()
    rPr.set("lang", "zh-CN")
    rPr.set("altLang", "en-US")
    rPr.set("dirty", "0")
    if letter_spacing:
        rPr.set("spc", str(int(round(letter_spacing * 75))))
    # 中文字体必须写 <a:ea>，只设 font.name 会让 PowerPoint 用西文字体排中文
    ea_el = rPr.find(qn("a:ea"))
    if ea_el is None:
        ea_el = etree.SubElement(rPr, qn("a:ea"))
    ea_el.set("typeface", ea)
    cs_el = rPr.find(qn("a:cs"))
    if cs_el is None:
        cs_el = etree.SubElement(rPr, qn("a:cs"))
    cs_el.set("typeface", ea)
    solid = rPr.find(qn("a:solidFill"))
    if solid is not None and opacity < 1:
        add_alpha(solid.find(qn("a:srgbClr")), opacity)


def add_text(slide, p):
    box = slide.shapes.add_textbox(Emu(int(p["x"] * PX)), Emu(int(p["y"] * PX)),
                                   Emu(int(p["w"] * PX)), Emu(int(p["h"] * PX)))
    tf = box.text_frame
    tf.word_wrap = False
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = ANCHOR[p.get("valign", "top")]
    for i, line in enumerate(p["lines"]):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = ALIGN[p.get("align", "left")]
        para.line_spacing = Pt(p["line_height"] * 0.75)
        para.space_before = Pt(0)
        para.space_after = Pt(0)
        for data in line["runs"]:
            run = para.add_run()
            style_run(run, data, p["family"], p["size"], p.get("letter_spacing", 0),
                      p.get("opacity", 1))
    return box


def build(scene: dict, notes: dict | None = None) -> Presentation:
    prs = Presentation()
    prs.slide_width = Emu(1280 * PX)
    prs.slide_height = Emu(720 * PX)
    blank = prs.slide_layouts[6]
    for slide_data in scene["slides"]:
        slide = prs.slides.add_slide(blank)
        for p in slide_data["primitives"]:
            if p["type"] == "rect":
                add_rect(slide, p)
            elif p["type"] == "ellipse":
                add_ellipse(slide, p)
            elif p["type"] == "line":
                add_line(slide, p)
            elif p["type"] == "text":
                add_text(slide, p)
        note = (notes or {}).get(slide_data["index"])
        if note:
            slide.notes_slide.notes_text_frame.text = note
    prs.core_properties.title = scene["title"]
    return prs


def main():
    scene = json.loads((OUT / "scene.json").read_text(encoding="utf-8"))
    deck = json.loads((ROOT / "deck.json").read_text(encoding="utf-8"))
    notes = {i: s["notes"] for i, s in enumerate(deck["slides"]) if s.get("notes")}
    prs = build(scene, notes)
    path = OUT / "deck.pptx"
    prs.save(path)
    print("wrote", path, path.stat().st_size)


if __name__ == "__main__":
    main()
