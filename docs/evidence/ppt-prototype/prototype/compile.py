"""Compile a semantic deck into a 1280×720 scene graph.

The scene graph is the single source of truth for both renderers:
- render_svg.py turns it into an SVG preview;
- render_pptx.py maps each primitive to a native PowerPoint object.

All text is measured and line-broken here, so the preview and the exported
deck cannot disagree about where lines break.
"""
from __future__ import annotations

import json
from pathlib import Path

from textfit import fit

W, H = 1280, 720
L, R = 72, 72
CONTENT_W = W - L - R

THEMES = {
    "ink": {
        "name": "墨",
        "mood": "文学 · 纸墨 · 朱砂",
        "bg": "#F7F2E7", "surface": "#FFFCF5", "ink": "#1C1B18", "muted": "#736B5E",
        "line": "#DDD2BF", "accent": "#A33B2B", "accent_soft": "#E9D0C5",
        "dark": "#151A17", "dark_ink": "#F3EEE1", "dark_muted": "#A9A292",
        "dark_line": "#33403A", "dark_accent": "#D9785F",
        "serif": "serif", "sans": "sans", "title_weight": 700,
    },
    "jade": {
        "name": "青",
        "mood": "理性 · 青瓷 · 留白",
        "bg": "#EEF3EF", "surface": "#F9FCF9", "ink": "#14211C", "muted": "#607069",
        "line": "#CBD9D1", "accent": "#2F6B57", "accent_soft": "#CFE1D8",
        "dark": "#0F1F1A", "dark_ink": "#EAF2EC", "dark_muted": "#9FB3A9",
        "dark_line": "#2A443A", "dark_accent": "#8FC7AF",
        "serif": "sans", "sans": "sans", "title_weight": 500,
    },
    "night": {
        "name": "夜",
        "mood": "冷静 · 深蓝 · 金色",
        "bg": "#F2F4F7", "surface": "#FFFFFF", "ink": "#101828", "muted": "#667085",
        "line": "#D9DEE8", "accent": "#9A7B2F", "accent_soft": "#EADDBB",
        "dark": "#0B1220", "dark_ink": "#E8EDF5", "dark_muted": "#9AA6B8",
        "dark_line": "#26344A", "dark_accent": "#E4C27A",
        "serif": "serif", "sans": "sans", "title_weight": 700,
    },
    "clay": {
        "name": "赭",
        "mood": "人文 · 陶土 · 暖沙",
        "bg": "#F7F0E8", "surface": "#FFFBF6", "ink": "#241C18", "muted": "#7B6A5E",
        "line": "#E3D3C4", "accent": "#B4552D", "accent_soft": "#EFD3C2",
        "dark": "#201614", "dark_ink": "#F5E9DF", "dark_muted": "#B7A395",
        "dark_line": "#453029", "dark_accent": "#E08B62",
        "serif": "serif", "sans": "sans", "title_weight": 700,
    },
}


class Scene:
    def __init__(self, theme: dict, slide: dict, index: int, total: int, deck: dict):
        self.t = theme
        self.s = slide
        self.index = index
        self.total = total
        self.deck = deck
        self.prims: list[dict] = []
        self.warnings: list[str] = []
        self._page = f"{index + 1:02d} / {total:02d}"

    # ---------- primitives ----------
    def rect(self, x, y, w, h, fill=None, r=0, stroke=None, sw=1, opacity=1):
        self.prims.append({"type": "rect", "x": x, "y": y, "w": w, "h": h, "r": r,
                           "fill": fill, "stroke": stroke, "sw": sw, "opacity": opacity})

    def ellipse(self, cx, cy, rx, ry, fill=None, stroke=None, sw=1, opacity=1):
        self.prims.append({"type": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry,
                           "fill": fill, "stroke": stroke, "sw": sw, "opacity": opacity})

    def line(self, x1, y1, x2, y2, stroke, sw=1, opacity=1):
        self.prims.append({"type": "line", "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                           "stroke": stroke, "sw": sw, "opacity": opacity})

    def text(self, x, y, w, h, value, *, family="sans", size=24, min_size=12, weight=400,
             color=None, accent=None, line_height=1.6, align="left", valign="top",
             max_lines=None, letter_spacing=0, opacity=1, label=""):
        color = color or self.t["ink"]
        accent = accent or self.t["accent"]
        fitted = fit(value, box_w=w, box_h=h, family=family, weight=weight, color=color,
                     accent=accent, size=size, min_size=min_size, line_height=line_height,
                     align=align, max_lines=max_lines, label=label or value[:12])
        if fitted.overflow:
            self.warnings.extend(fitted.warnings)
        self.prims.append({
            "type": "text", "x": x, "y": y, "w": w, "h": h,
            "lines": [{"runs": [r.__dict__ for r in line.runs], "width": round(line.width, 1)}
                      for line in fitted.lines],
            "size": fitted.size, "line_height": fitted.line_height, "align": align,
            "valign": valign, "letter_spacing": letter_spacing, "opacity": opacity,
            "family": family,
        })

    # ---------- shared parts ----------
    def bg(self, dark=False):
        self.rect(0, 0, W, H, fill=self.t["dark"] if dark else self.t["bg"])

    def kicker(self, text, dark=False, y=50, color=None):
        c = color or (self.t["dark_accent"] if dark else self.t["accent"])
        self.rect(L, y + 5, 6, 6, fill=c)
        self.text(L + 16, y, 600, 18, text, family="sans", size=12, min_size=11, weight=500,
                  color=c, line_height=1.4, valign="top", max_lines=1,
                  letter_spacing=1.4 if text.isascii() else 0, label="kicker")

    def title(self, text, dark=False, y=86, w=1000, size=44, color=None, max_lines=2):
        self.text(L, y, w, 124, text, family=self.t["serif"], size=size, min_size=28,
                  weight=self.t["title_weight"], color=color or (self.t["dark_ink"] if dark else self.t["ink"]),
                  line_height=1.18, max_lines=max_lines, label="title")

    def footer(self, dark=False, left=None):
        c = self.t["dark_muted"] if dark else self.t["muted"]
        left = left or f'{self.deck["title"]} · {self.deck["meta"]["subject"]}'
        self.text(L, 676, 700, 16, left, size=10, min_size=10, weight=400, color=c,
                  line_height=1.4, max_lines=1, label="footer")
        self.text(W - R - 120, 676, 120, 16, self._page, size=10, min_size=10, weight=500,
                  color=c, line_height=1.4, align="right", max_lines=1, label="page")

    def seal(self, x, y, size, text, dark=False):
        self.rect(x, y, size, size, fill=self.t["dark_accent"] if dark else self.t["accent"], r=4)
        self.text(x, y + size * 0.13, size, size * 0.74, text, family=self.t["serif"],
                  size=int(size * 0.52), min_size=10, weight=700, color=self.t["dark"] if dark else self.t["bg"],
                  line_height=1.0, align="center", valign="middle", max_lines=1, label="seal")

    # ---------- layouts ----------
    def cover(self):
        t = self.t
        self.bg(dark=True)
        # 月轮：两个同心圆，半透明，成为整册的视觉母题
        self.ellipse(1006, 150, 300, 300, fill=t["dark_accent"], opacity=0.12)
        self.ellipse(1006, 150, 300, 300, stroke=t["dark_accent"], sw=1, opacity=0.28)
        self.ellipse(1006, 150, 218, 218, stroke=t["dark_accent"], sw=1, opacity=0.14)
        self.kicker(self.s.get("kicker", ""), dark=True, y=56)
        self.text(L, 168, 820, 240, self.s["title"], family=t["serif"], size=104, min_size=64,
                  weight=t["title_weight"], color=t["dark_ink"], line_height=1.2, max_lines=1,
                  label="cover-title")
        self.text(L, 400, 760, 60, self.s.get("subtitle", ""), family=t["serif"], size=25,
                  min_size=18, weight=400, color=t["dark_muted"], line_height=1.5, max_lines=1,
                  label="cover-subtitle")
        self.line(L, 500, L + 168, 500, t["dark_accent"], sw=1, opacity=0.45)
        self.seal(L, 536, 44, self.s.get("seal", "课"), dark=True)
        self.text(L + 62, 544, 600, 26, self.s.get("meta", ""), size=13, min_size=11, weight=400,
                  color=t["dark_muted"], line_height=1.4, max_lines=1, letter_spacing=0.8,
                  label="cover-meta")
        self.text(W - R - 120, 676, 120, 16, "01", size=10, min_size=10, weight=500,
                  color=t["dark_muted"], line_height=1.4, align="right", label="page")

    def agenda(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "本课脉络"))
        self.title(self.s["title"])
        # 右侧巨大的页码幽灵字，做版式锚点
        self.text(980, 100, 240, 260, "05", family=t["serif"], size=220, min_size=220,
                  weight=700, color=t["accent"], line_height=1.0, align="right", opacity=0.055,
                  max_lines=1, label="ghost")
        items = self.s["items"]
        top = 244
        gap = 74
        for i, item in enumerate(items):
            y = top + i * gap
            self.text(L, y - 2, 52, 40, f"{i + 1:02d}", family=t["serif"], size=30, min_size=24,
                      weight=600, color=t["accent"], line_height=1.1, max_lines=1, label="agenda-num")
            self.text(L + 72, y, 300, 34, item["title"], family=t["serif"], size=23, min_size=18,
                      weight=600, color=t["ink"], line_height=1.2, max_lines=1, label="agenda-title")
            self.text(L + 380, y + 4, 620, 28, item["note"], size=14, min_size=12, weight=400,
                      color=t["muted"], line_height=1.4, max_lines=1, label="agenda-note")
            if i < len(items) - 1:
                self.line(L, y + 54, W - R, y + 54, t["line"], sw=1, opacity=0.75)
        self.footer()

    def section(self):
        t = self.t
        self.bg(dark=True)
        self.ellipse(1080, 500, 240, 240, stroke=t["dark_accent"], sw=1, opacity=0.18)
        self.ellipse(1080, 500, 168, 168, stroke=t["dark_accent"], sw=1, opacity=0.10)
        self.kicker(self.s.get("kicker", ""), dark=True, y=56)
        self.text(L, 120, 520, 260, self.s.get("number", ""), family=t["serif"], size=210,
                  min_size=140, weight=700, color=t["dark_accent"], line_height=1.0, opacity=0.30,
                  max_lines=1, label="section-num")
        self.title(self.s["title"], dark=True, y=360, w=760, size=62, max_lines=1)
        self.text(L, 466, 720, 70, self.s.get("subtitle", ""), family=t["serif"], size=20,
                  min_size=15, weight=400, color=t["dark_muted"], line_height=1.7, max_lines=2,
                  label="section-sub")
        self.footer(dark=True)

    def points(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", ""))
        self.title(self.s["title"])
        if self.s.get("lead"):
            self.text(L, 206, 900, 30, self.s["lead"], size=16, min_size=13, weight=400,
                      color=t["muted"], line_height=1.5, max_lines=1, label="lead")
        items = self.s["items"][:3]
        gap = 40
        cw = (CONTENT_W - gap * (len(items) - 1)) // len(items)
        top, ch = 262, 300
        for i, item in enumerate(items):
            x = L + i * (cw + gap)
            self.rect(x, top, cw, ch, fill=t["surface"], r=16, stroke=t["line"], sw=1)
            self.text(x + 26, top + 24, 60, 18, f"{i + 1:02d}", size=12, min_size=10, weight=600,
                      color=t["accent"], line_height=1.3, max_lines=1, letter_spacing=1.2,
                      label="card-num")
            self.text(x + 26, top + 58, cw - 52, 72, item["title"], family=t["serif"], size=27,
                      min_size=20, weight=600, color=t["ink"], line_height=1.25, max_lines=2,
                      label="card-title")
            self.text(x + 26, top + 132, cw - 52, 142, item["body"], size=15, min_size=12,
                      weight=400, color=t["muted"], line_height=1.8, max_lines=6,
                      label="card-body")
        if self.s.get("takeaway"):
            self.text(L, 610, CONTENT_W, 28, self.s["takeaway"], family=t["serif"], size=17,
                      min_size=13, weight=400, color=t["ink"], line_height=1.5, max_lines=1,
                      label="takeaway")
        self.footer()

    def process(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", ""))
        self.title(self.s["title"])
        steps = self.s["steps"]
        gap = 24
        cw = (CONTENT_W - gap * (len(steps) - 1)) // len(steps)
        cy = 284
        last_cx = L + (len(steps) - 1) * (cw + gap) + 26
        self.line(L + 26, cy, last_cx, cy, t["line"], sw=1)
        for i, step in enumerate(steps):
            x = L + i * (cw + gap)
            cx = x + 26
            self.ellipse(cx, cy, 26, 26, fill=t["bg"], stroke=t["accent"], sw=1.2)
            self.text(cx - 26, cy - 15, 52, 30, f"{i + 1}", family=t["serif"], size=17,
                      min_size=13, weight=600, color=t["accent"], line_height=1.2,
                      align="center", valign="middle", max_lines=1, label="step-num")
            self.text(x, cy + 56, cw - 8, 40, step["title"], family=t["serif"], size=21,
                      min_size=16, weight=600, color=t["ink"], line_height=1.3, max_lines=2,
                      label="step-title")
            self.text(x, cy + 106, cw - 12, 92, step["body"], size=14, min_size=11, weight=400,
                      color=t["muted"], line_height=1.75, max_lines=4, label="step-body")
        if self.s.get("note"):
            self.text(L, 566, CONTENT_W, 34, self.s["note"], family=t["serif"], size=20,
                      min_size=15, weight=400, color=t["ink"], line_height=1.5, max_lines=1,
                      label="process-note")
        self.footer()

    def quote(self):
        t = self.t
        self.bg(dark=True)
        self.kicker(self.s.get("kicker", ""), dark=True, y=50)
        self.text(L - 8, 34, 260, 260, "“", family=t["serif"], size=230, min_size=230, weight=700,
                  color=t["dark_accent"], line_height=1.0, opacity=0.26, max_lines=1, label="quote-mark")
        self.text(L + 52, 186, 1000, 260, self.s["quote"], family=t["serif"], size=42,
                  min_size=26, weight=500, color=t["dark_ink"], line_height=1.65, max_lines=6,
                  label="quote-body")
        self.text(L + 52, 430, 700, 24, self.s.get("source", ""), size=13, min_size=11,
                  weight=500, color=t["dark_accent"], line_height=1.4, max_lines=1,
                  letter_spacing=0.8, label="quote-source")
        self.text(L + 52, 488, 860, 96, self.s.get("note", ""), size=16, min_size=13, weight=400,
                  color=t["dark_muted"], line_height=1.9, max_lines=4, label="quote-note")
        self.ellipse(1080, 500, 96, 96, stroke=t["dark_accent"], sw=1, opacity=0.22)
        self.footer(dark=True)

    def compare(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", ""))
        self.title(self.s["title"])
        cols = [self.s["left"], self.s["right"]]
        gap = 48
        cw = (CONTENT_W - gap) // 2
        top, ch = 238, 340
        for i, col in enumerate(cols):
            x = L + i * (cw + gap)
            self.rect(x, top, cw, ch, fill=t["surface"], r=16, stroke=t["line"], sw=1)
            self.text(x + 30, top + 26, cw - 60, 20, col["label"], size=12, min_size=10,
                      weight=600, color=t["accent"], line_height=1.4, max_lines=1,
                      letter_spacing=1.2, label="compare-label")
            self.text(x + 30, top + 56, cw - 60, 48, col["title"], family=t["serif"], size=28,
                      min_size=20, weight=600, color=t["ink"], line_height=1.25, max_lines=1,
                      label="compare-title")
            self.text(x + 30, top + 112, cw - 60, 100, col["quote"], family=t["serif"], size=21,
                      min_size=15, weight=400, color=t["ink"], line_height=1.6, max_lines=3,
                      label="compare-quote")
            self.text(x + 30, top + 214, cw - 60, 96, col["body"], size=15, min_size=11,
                      weight=400, color=t["muted"], line_height=1.8, max_lines=4,
                      label="compare-body")
        if self.s.get("takeaway"):
            self.text(L, 612, CONTENT_W, 52, self.s["takeaway"], family=t["serif"], size=18,
                      min_size=13, weight=400, color=t["ink"], line_height=1.5, max_lines=2,
                      label="compare-takeaway")
        self.footer()

    def stats(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", ""))
        self.title(self.s["title"])
        items = self.s["items"][:3]
        gap = 44
        cw = (CONTENT_W - gap * (len(items) - 1)) // len(items)
        top = 266
        for i, item in enumerate(items):
            x = L + i * (cw + gap)
            self.text(x, top, cw, 150, item["value"], family=t["serif"], size=122, min_size=76,
                      weight=600, color=t["accent"], line_height=1.0, max_lines=1,
                      label="stat-value")
            self.text(x, top + 150, cw, 32, item["label"], family=t["serif"], size=21,
                      min_size=16, weight=600, color=t["ink"], line_height=1.3, max_lines=1,
                      label="stat-label")
            self.text(x, top + 192, cw, 50, item["note"], size=13, min_size=11, weight=400,
                      color=t["muted"], line_height=1.7, max_lines=3, label="stat-note")
        if self.s.get("note"):
            self.text(L, 566, CONTENT_W, 30, self.s["note"], family=t["serif"], size=18,
                      min_size=14, weight=400, color=t["ink"], line_height=1.5, max_lines=1,
                      label="stats-note")
        self.footer()

    def closing(self):
        t = self.t
        self.bg(dark=True)
        self.ellipse(1060, 120, 250, 250, fill=t["dark_accent"], opacity=0.05)
        self.ellipse(1060, 120, 250, 250, stroke=t["dark_accent"], sw=1, opacity=0.22)
        self.kicker(self.s.get("kicker", ""), dark=True, y=56)
        self.text(L, 140, 900, 100, self.s["title"], family=t["serif"], size=62, min_size=40,
                  weight=t["title_weight"], color=t["dark_ink"], line_height=1.15, max_lines=1,
                  label="closing-title")
        self.text(L, 252, 760, 96, self.s.get("body", ""), size=17, min_size=13, weight=400,
                  color=t["dark_muted"], line_height=1.85, max_lines=4, label="closing-body")
        for i, item in enumerate(self.s.get("items", [])[:3]):
            y = 396 + i * 54
            self.text(L, y, 44, 22, f"{i + 1:02d}", family=t["serif"], size=12, min_size=10,
                      weight=600, color=t["dark_accent"], line_height=1.3, max_lines=1,
                      letter_spacing=1.2, label="closing-num")
            self.text(L + 48, y - 3, 760, 30, item, size=16, min_size=12, weight=400,
                      color=t["dark_ink"], line_height=1.5, max_lines=1, label="closing-item")
        self.text(L, 600, 700, 26, self.s.get("foot", ""), family=t["serif"], size=17,
                  min_size=13, weight=400, color=t["dark_accent"], line_height=1.4, max_lines=1,
                  label="closing-foot")
        self.footer(dark=True)

    def build(self) -> list[dict]:
        getattr(self, self.s["layout"])()
        return self.prims


def compile_deck(deck: dict) -> dict:
    theme = THEMES[deck["theme"]]
    total = len(deck["slides"])
    slides, warnings = [], []
    for i, slide in enumerate(deck["slides"]):
        scene = Scene(theme, slide, i, total, deck)
        prims = scene.build()
        warnings.extend(f"第 {i + 1} 页 {w}" for w in scene.warnings)
        slides.append({"index": i, "layout": slide["layout"], "primitives": prims})
    return {
        "format": "nbx-scene",
        "version": 1,
        "size": {"width": W, "height": H},
        "theme": deck["theme"],
        "theme_name": theme["name"],
        "title": deck["title"],
        "slides": slides,
        "warnings": warnings,
    }


def main():
    root = Path(__file__).parent
    (root / "out").mkdir(exist_ok=True)
    deck = json.loads((root / "deck.json").read_text(encoding="utf-8"))
    scene = compile_deck(deck)
    (root / "out" / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=1), encoding="utf-8")
    print("slides", len(scene["slides"]), "warnings", scene["warnings"])


if __name__ == "__main__":
    main()
