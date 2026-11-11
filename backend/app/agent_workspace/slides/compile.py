"""English teaching deck compiler v2.

Design rules:
- Projector-first type scale: labels 12-13, payload 16-18, titles 40-44.
- Content floor at y=640: the bottom fifth must carry teaching payload, not air.
- Staged reveal: passage/questions/exam become prompt slide + reveal slide.
- Layouts follow the teaching move, not a universal card grid.
"""
from __future__ import annotations

import json
from pathlib import Path

from .metrics import as_text, fit
from .schema import DeckError

from .themes import CONTENT_W, H, L, R, TS, THEMES, W


class Scene:
    def __init__(self, theme, slide, index, total, deck):
        self.t = theme
        self.s = slide
        self.index = index
        self.total = total
        self.deck = deck
        self.prims = []
        self.warnings = []
        self.page = f"{index + 1:02d} / {total:02d}"

    def rect(self, x, y, w, h, fill=None, r=0, stroke=None, sw=1, opacity=1):
        self.prims.append({"type": "rect", "x": x, "y": y, "w": w, "h": h, "r": r,
                           "fill": fill, "stroke": stroke, "sw": sw, "opacity": opacity})

    def ellipse(self, cx, cy, rx, ry, fill=None, stroke=None, sw=1, opacity=1):
        self.prims.append({"type": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry,
                           "fill": fill, "stroke": stroke, "sw": sw, "opacity": opacity})

    def line(self, x1, y1, x2, y2, stroke, sw=1, opacity=1):
        self.prims.append({"type": "line", "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                           "stroke": stroke, "sw": sw, "opacity": opacity})

    def text(self, x, y, w, h, value, *, family="sans", size=18, min_size=12, weight=400,
             color=None, accent=None, line_height=1.55, align="left", valign="top",
             max_lines=None, letter_spacing=0, opacity=1, italic=False, label=""):
        value = as_text(value)
        color = color or self.t["ink"]
        accent = accent or self.t["accent"]
        # Hard floors: student-facing payload never goes below 16px; labels
        # never below 11-13. If it cannot fit, fit() returns overflow and the
        # writer must shorten/split instead of silently shrinking.
        if label in {"footer", "page"}:
            floor = 11
        elif label in {"kicker", "label", "cover-tag", "cover-meta", "passage-source",
                       "ref", "signal", "note", "story-label", "story-note",
                       "story-prompt-num", "plot-axis", "plot-p1", "plot-p2",
                       "prompt-num", "first-read-num", "first-read-timer",
                       "first-read-note", "think-num", "think-note", "plan-num",
                       "answer-mark", "option-key", "option-check", "homework",
                       "selfcheck", "minutes"}:
            floor = 13
        else:
            floor = 16
        size = max(size, floor)
        min_size = max(min_size, floor)
        width_ratio = 0.96 if label in {"footer", "page", "kicker", "label", "cover-tag",
                                        "cover-meta", "passage-source", "ref", "signal",
                                        "note", "story-label", "story-note",
                                        "story-prompt-num", "plot-axis", "plot-p1",
                                        "plot-p2", "prompt-num", "first-read-num",
                                        "first-read-timer", "first-read-note", "think-num",
                                        "think-note", "plan-num", "answer-mark", "option-key",
                                        "option-check", "homework", "selfcheck", "minutes"} else 0.92
        fitted = fit(value, box_w=w, box_h=h, family=family, weight=weight, color=color,
                     accent=accent, size=size, min_size=min_size, line_height=line_height,
                     align=align, max_lines=max_lines, label=label or value[:18],
                     width_ratio=width_ratio)
        if fitted.overflow:
            self.warnings.extend(fitted.warnings)
        if italic:
            for line in fitted.lines:
                for run in line.runs:
                    run.italic = True
        self.prims.append({
            "type": "text", "x": x, "y": y, "w": w, "h": h,
            "lines": [{"runs": [r.__dict__ for r in line.runs], "width": round(line.width, 1)}
                      for line in fitted.lines],
            "size": fitted.size, "line_height": fitted.line_height, "align": align,
            "valign": valign, "letter_spacing": letter_spacing, "opacity": opacity,
            "family": family, "label": label,
        })

    # ---------- shared ----------
    def bg(self, dark=False):
        self.rect(0, 0, W, H, fill=self.t["dark"] if dark else self.t["bg"])

    def kicker(self, text, dark=False, y=44):
        c = self.t["dark_accent"] if dark else self.t["accent"]
        self.rect(L, y + 4, 5, 5, fill=c)
        self.text(L + 14, y, 640, 20, text, family="sans", size=TS["label"], min_size=10,
                  weight=600, color=c, line_height=1.35, max_lines=1,
                  letter_spacing=1.5, label="kicker")

    def title(self, text, dark=False, y=82, w=1020, size=None, max_lines=2):
        self.text(L, y, w, 112, text, family=self.t["title_family"], size=size or TS["title"],
                  min_size=28, weight=self.t["title_weight"],
                  color=self.t["dark_ink"] if dark else self.t["ink"],
                  line_height=1.14, max_lines=max_lines, label="title")

    def footer(self, dark=False):
        c = self.t["dark_muted"] if dark else self.t["muted"]
        left = f'{self.deck["title"]} · {self.deck["meta"].get("lesson", "Lesson")}'
        self.text(L, 678, 760, 16, left, size=TS["footer"], min_size=9, weight=400,
                  color=c, line_height=1.3, max_lines=1, label="footer")
        self.text(W - R - 100, 678, 100, 16, self.page, size=TS["footer"], min_size=9,
                  weight=500, color=c, line_height=1.3, align="right", max_lines=1,
                  label="page")

    def label(self, x, y, w, text, color=None, size=None):
        self.text(x, y, w, 20, text, size=size or TS["label"], min_size=9, weight=600,
                  color=color or self.t["accent"], line_height=1.3, max_lines=1,
                  letter_spacing=1.2, label="label")

    def rule(self, x1, y, x2, opacity=0.7):
        self.line(x1, y, x2, y, self.t["line"], sw=1, opacity=opacity)

    def card(self, x, y, w, h, r=12):
        self.rect(x, y, w, h, fill=self.t["surface"], r=r, stroke=self.t["line"], sw=1)

    # ---------- cover ----------
    def cover_motif(self):
        t = self.t
        motif = self.deck.get("motif", "shelf")
        if motif == "shelf":
            self.line(896, 470, 1184, 470, t["dark_accent"], sw=1, opacity=0.55)
            books = [(996, 436, 150, 22), (1018, 408, 130, 22),
                     (986, 380, 172, 22), (1008, 352, 142, 22)]
            for i, (x, y, w, h) in enumerate(books):
                self.rect(x, y, w, h, fill=t["dark_accent"], opacity=0.10 + i * 0.04)
                self.line(x + 10, y + 5, x + w - 10, y + 5, t["dark_accent"], sw=1, opacity=0.35)
        elif motif == "horizon":
            self.line(864, 498, 1184, 498, t["dark_accent"], sw=1, opacity=0.45)
            self.ellipse(1076, 308, 92, 92, fill=t["dark_accent"], opacity=0.13)
            self.ellipse(1076, 308, 92, 92, stroke=t["dark_accent"], sw=1, opacity=0.32)
            self.ellipse(948, 498, 6, 6, fill=t["dark_accent"], opacity=0.9)
        else:
            self.ellipse(1040, 160, 260, 260, fill=t["dark_accent"], opacity=0.10)
            self.ellipse(1040, 160, 260, 260, stroke=t["dark_accent"], sw=1, opacity=0.26)

    def cover(self):
        t = self.t
        self.bg(dark=True)
        self.cover_motif()
        self.kicker(self.s.get("kicker", ""), dark=True, y=52)
        self.text(W - R - 300, 52, 300, 20, self.s.get("tag") or f"01 / {self.total:02d}",
                  size=TS["label"], min_size=10, weight=500, color=t["dark_muted"],
                  line_height=1.3, align="right", letter_spacing=1.2, label="cover-tag")
        self.text(L, 146, 780, 232, self.s["title"], family=t["title_family"], size=TS["cover"],
                  min_size=52, weight=t["title_weight"], color=t["dark_ink"],
                  line_height=1.04, max_lines=2, label="cover-title")
        self.text(L, 392, 700, 64, self.s.get("subtitle", ""), family="sans", size=22,
                  min_size=15, weight=400, color=t["dark_muted"], line_height=1.45,
                  max_lines=2, label="cover-subtitle")
        if self.s.get("question"):
            self.text(L, 476, 700, 54, self.s["question"], family="serif", size=17,
                      min_size=13, weight=400, color=t["dark_accent"], line_height=1.45,
                      max_lines=2, label="cover-question")
        self.text(L, 596, 680, 20, self.s.get("meta", ""), size=13, min_size=10, weight=500,
                  color=t["dark_muted"], line_height=1.4, max_lines=1, letter_spacing=0.6,
                  label="cover-meta")

    # ---------- reading ----------
    def objectives(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "LEARNING OBJECTIVES"))
        self.title(self.s["title"])
        if self.s.get("lead"):
            self.text(L, 194, 900, 28, self.s["lead"], size=TS["body"], min_size=13,
                      weight=400, color=t["muted"], line_height=1.4, max_lines=1, label="lead")
        top, pitch = 234, 118
        for i, item in enumerate(self.s["items"][:3]):
            y = top + i * pitch
            if i:
                self.rule(L, y - 10, W - R, 0.6)
            self.text(L, y + 2, 34, 28, f"{i + 1:02d}", family=t["title_family"], size=22,
                      min_size=14, weight=600, color=t["accent"], line_height=1.1,
                      max_lines=1, label="obj-num")
            self.label(L + 44, y + 6, 130, item["level"], size=TS["label"])
            self.text(L + 200, y - 2, 900, 40, item["objective"], size=TS["body"],
                      min_size=14, weight=500, color=t["ink"], line_height=1.35,
                      max_lines=2, label="obj-text")
            self.text(L + 200, y + 40, 900, 50, "达成：" + item["criterion"],
                      size=TS["small"], min_size=11, weight=400, color=t["muted"],
                      line_height=1.4, max_lines=2, label="obj-criterion")
        if self.s.get("target"):
            self.rule(L, 606, W - R, 0.6)
            self.label(L, 620, 140, "本课目标", size=TS["label"], color=t["muted"])
            self.text(L + 156, 616, 996, 26, self.s["target"], size=TS["small"],
                      min_size=11, weight=500, color=t["ink"], line_height=1.4,
                      max_lines=1, label="target")
        self.footer()

    def pre_reading(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "BEFORE READING"))
        self.title(self.s["title"], size=40, w=1040)
        if self.s.get("lead"):
            self.text(L, 214, 900, 28, self.s["lead"], size=TS["small"], min_size=13,
                      weight=400, color=t["muted"], line_height=1.4, max_lines=1, label="lead")
        self.card(L, 268, 560, 216, r=14)
        self.text(L + 30, 294, 500, 156, self.s.get("provocation", ""), family=t["title_family"],
                  size=29, min_size=18, weight=500, color=t["ink"], line_height=1.45,
                  max_lines=5, label="provocation")
        self.label(L + 30, 456, 300, self.s.get("note", "PAIR TALK · 60 SECONDS"), size=TS["label"])
        prompts = self.s["prompts"][:3]
        for i, prompt in enumerate(prompts):
            y = 276 + i * 104
            self.text(704, y, 28, 24, f"{i + 1:02d}", family=t["title_family"], size=12,
                      min_size=10, weight=600, color=t["accent"], line_height=1.2,
                      max_lines=1, label="prompt-num")
            self.text(742, y - 2, 474, 86, prompt, size=TS["body"], min_size=13,
                      weight=400, color=t["ink"], line_height=1.5, max_lines=3,
                      label="prompt")
        if self.s.get("frames"):
            self.label(L, 548, 160, "句型支架", size=TS["label"], color=t["muted"])
            self.text(L + 172, 544, 980, 28, self.s["frames"], size=TS["small"],
                      min_size=11, weight=500, color=t["ink"], line_height=1.4,
                      max_lines=1, label="frames")
        if self.s.get("focus"):
            self.label(L, 620, 120, "听一听", size=TS["label"], color=t["muted"])
            self.text(L + 120, 616, 1032, 26, self.s["focus"], size=TS["small"],
                      min_size=11, weight=500, color=t["ink"], line_height=1.4,
                      max_lines=1, label="focus")
        self.label(704, 600, 200, "轮流说", size=TS["label"], color=t["muted"])
        self.text(704, 622, 512, 30, "Ask and answer. Then compare your prediction.",
                  size=15, min_size=11, weight=500, color=t["ink"], line_height=1.4,
                  max_lines=1, label="turn-instruction")
        self.footer()

    def text_structure(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "HOW THE TEXT WORKS"))
        self.title(self.s["title"])
        stages = self.s["stages"][:3]
        gap = 32
        cw = (CONTENT_W - gap * 2) // 3
        top, ch = 212, 300
        for i, stage in enumerate(stages):
            x = L + i * (cw + gap)
            self.card(x, top, cw, ch, r=14)
            self.label(x + 26, top + 22, cw - 52, stage["label"], size=TS["label"])
            self.text(x + 26, top + 52, cw - 52, 62, stage["title"], family=t["title_family"],
                      size=23, min_size=16, weight=600, color=t["ink"], line_height=1.25,
                      max_lines=2, label="stage-title")
            self.text(x + 26, top + 126, cw - 52, 112, f"“{stage['quote']}”", family="serif",
                      size=TS["dense"], min_size=12, weight=400, color=t["ink"],
                      line_height=1.55, max_lines=4, label="stage-quote")
            self.text(x + 26, top + ch - 40, 90, 20, stage.get("ref", ""), size=TS["label"],
                      min_size=9, weight=500, color=t["muted"], line_height=1.3,
                      max_lines=1, label="ref")
            if stage.get("signal"):
                self.text(x + cw - 132, top + ch - 40, 110, 20, stage["signal"], size=TS["label"],
                          min_size=9, weight=600, color=t["accent"], line_height=1.3,
                          align="right", max_lines=1, label="signal")
            if i < 2:
                self.text(x + cw + 4, top + 128, 24, 28, "→", size=22, min_size=14,
                          weight=500, color=t["accent"], line_height=1.2, align="center",
                          max_lines=1, label="arrow")
        if self.s.get("takeaway"):
            self.text(L, 590, CONTENT_W, 32, self.s["takeaway"], family=t["title_family"],
                      size=TS["body"], min_size=13, weight=500, color=t["ink"],
                      line_height=1.4, max_lines=1, label="takeaway")
        self.footer()

    def passage(self):
        t = self.t
        self.bg()
        reveal = self.s.get("reveal", True)
        stage = "ANNOTATE" if reveal else "FIRST READ"
        self.kicker(self.s.get("kicker", "CLOSE READING") + "  ·  " + stage)
        self.title(self.s["title"], size=40)
        passage = self.s["passage"]
        if reveal and self.s.get("highlight") and self.s["highlight"] in passage:
            passage = passage.replace(self.s["highlight"], f"=={self.s['highlight']}==", 1)
        if reveal:
            self.text(L, 178, 680, 20, self.s.get("source", "THE TEXT"), size=TS["label"],
                      min_size=9, weight=600, color=t["muted"], line_height=1.3,
                      letter_spacing=1.2, max_lines=1, label="passage-source")
            self.text(L, 202, 700, 420, passage, family="serif", size=16, min_size=14,
                      weight=400, color=t["ink"], line_height=1.64, max_lines=18,
                      label="passage")
            self.line(784, 192, 784, 636, t["line"], sw=1, opacity=0.75)
            notes = self.s["annotations"][:4]
            for i, note in enumerate(notes):
                y = 188 + i * 108
                self.label(810, y, 406, note["label"], size=TS["label"])
                self.text(810, y + 24, 406, 76, note["text"], size=TS["annotation"],
                          min_size=12, weight=400, color=t["ink"], line_height=1.5,
                          max_lines=3, label="annotation")
                if i < len(notes) - 1:
                    self.rule(810, y + 98, W - R, 0.55)
            if self.s.get("takeaway"):
                self.text(L, 642, CONTENT_W, 22, self.s["takeaway"], size=15,
                          min_size=11, weight=500, color=t["muted"], line_height=1.4,
                          max_lines=1, label="passage-takeaway")
        else:
            self.text(L, 178, 800, 20, self.s.get("source", "THE TEXT"), size=TS["label"],
                      min_size=9, weight=600, color=t["muted"], line_height=1.3,
                      letter_spacing=1.2, max_lines=1, label="passage-source")
            self.text(L, 202, 840, 420, passage, family="serif", size=17, min_size=14,
                      weight=400, color=t["ink"], line_height=1.6, max_lines=15,
                      label="passage")
            self.line(940, 192, 940, 636, t["line"], sw=1, opacity=0.75)
            self.label(964, 188, 252, "首次阅读", size=TS["label"])
            for i, prompt in enumerate(self.s.get("first_read", [])[:3]):
                y = 218 + i * 78
                self.text(964, y, 24, 20, f"{i + 1:02d}", family=t["title_family"], size=13,
                          min_size=9, weight=600, color=t["accent"], line_height=1.3,
                          max_lines=1, label="first-read-num")
                self.text(996, y - 2, 220, 66, prompt, size=TS["small"], min_size=11,
                          weight=400, color=t["ink"], line_height=1.45, max_lines=3,
                          label="first-read")
            self.text(964, 490, 252, 24, "3 分钟 · 标出转折", size=14,
                      min_size=11, weight=600, color=t["accent"], line_height=1.4,
                      max_lines=1, label="first-read-timer")
            self.text(964, 600, 252, 40, "下一页看注释。",
                      size=14, min_size=10, weight=500, color=t["muted"],
                      line_height=1.4, max_lines=2, label="first-read-note")
            self.text(L, 620, 760, 24, "先读一遍，标出转折句。", size=16, min_size=12,
                      weight=500, color=t["muted"], line_height=1.4, max_lines=1,
                      label="first-read-task")
        self.footer()

    def language(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "LANGUAGE THAT TRAVELS"))
        self.title(self.s["title"])
        self.label(L, 190, 300, "词块 CHUNK", size=TS["label"], color=t["muted"])
        self.label(404, 190, 260, "含义 MEANING", size=TS["label"], color=t["muted"])
        self.label(704, 190, 500, "例句 EXAMPLE", size=TS["label"], color=t["muted"])
        self.rule(L, 212, W - R, 0.7)
        items = self.s["items"][:4]
        for i, item in enumerate(items):
            y = 230 + i * 84
            self.text(L, y - 4, 300, 60, item["chunk"], family="serif", size=TS["body"],
                      min_size=13, weight=600, color=t["accent"], line_height=1.35,
                      max_lines=2, label="chunk")
            self.text(404, y, 260, 64, item["meaning"], size=TS["small"], min_size=11,
                      weight=400, color=t["muted"], line_height=1.45, max_lines=3,
                      label="chunk-meaning")
            self.text(704, y, 512, 64, f"“{item['example']}”", family="serif", size=TS["small"],
                      min_size=11, weight=400, color=t["ink"], line_height=1.45,
                      max_lines=2, italic=True, label="chunk-example")
            if i < len(items) - 1:
                self.rule(L, y + 70, W - R, 0.55)
        self.text(L, 586, CONTENT_W, 26, self.s["task"], size=TS["small"], min_size=11,
                  weight=500, color=t["muted"], line_height=1.4, max_lines=1, label="task")
        if self.s.get("answer"):
            self.text(L, 616, CONTENT_W, 24, self.s["answer"], size=TS["small"], min_size=11,
                      weight=600, color=t["accent"], line_height=1.4, max_lines=1, label="answer")
        self.footer()

    def questions(self):
        t = self.t
        self.bg()
        reveal = self.s.get("reveal", True)
        stage = "ANSWERS" if reveal else "THINK"
        self.kicker(self.s.get("kicker", "QUESTION CHAIN") + "  ·  " + stage)
        self.title(self.s["title"])
        items = self.s["items"][:3]
        top, pitch = 218, 136
        for i, item in enumerate(items):
            y = top + i * pitch
            if i:
                self.rule(L, y - 10, W - R, 0.6)
            self.label(L, y + 4, 150, item["level"], size=TS["label"])
            self.text(L + 164, y - 4, 640, 58, item["question"], family="serif", size=18,
                      min_size=13, weight=500, color=t["ink"], line_height=1.35,
                      max_lines=2, label="question")
            self.text(L + 164, y + 48, 640, 24, item["support"], size=TS["small"],
                      min_size=11, weight=400, color=t["muted"], line_height=1.4,
                      max_lines=1, label="question-support")
            if reveal and item.get("answer"):
                self.text(L + 164, y + 74, 24, 24, "→", size=16, min_size=11, weight=600,
                          color=t["accent"], line_height=1.4, max_lines=1, label="answer-mark")
                self.text(L + 194, y + 74, 610, 46, item["answer"], size=TS["small"],
                          min_size=11, weight=500, color=t["ink"], line_height=1.4,
                          max_lines=2, label="question-answer")
            else:
                self.label(900, y + 4, 280, "笔记", size=TS["label"], color=t["muted"])
                self.line(900, y + 92, 1180, y + 92, t["line"], sw=1, opacity=0.8)
        if not reveal:
            self.text(L, 628, 900, 22, "Answer frame: The writer suggests that… because…", size=15,
                      min_size=11, weight=500, color=t["muted"], line_height=1.4,
                      max_lines=1, label="think-note")
        else:
            self.text(L, 628, 1100, 22, "Sentence frame: The writer suggests that… because…",
                      size=15, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                      max_lines=1, label="answer-frame")
        self.footer()

    def task(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "AFTER READING"))
        self.title(self.s["title"])
        self.card(L, 200, 640, 400, r=14)
        for i, item in enumerate(self.s["brief"][:4]):
            y = 226 + i * 84
            self.label(L + 28, y, 180, item["label"], size=TS["label"])
            self.text(L + 28, y + 20, 576, 52, item["text"], size=TS["body"], min_size=12,
                      weight=400, color=t["ink"], line_height=1.4, max_lines=2, label="brief")
        self.label(736, 200, 220, "语言支持", size=TS["label"])
        for i, frame in enumerate(self.s["support"][:3]):
            y = 230 + i * 46
            self.text(736, y, 480, 36, frame, family="serif", size=TS["body"], min_size=13,
                      weight=500, color=t["ink"], line_height=1.35, max_lines=1, label="frame")
        self.label(736, 382, 220, "成功标准", size=TS["label"])
        for i, criterion in enumerate(self.s["criteria"][:3]):
            y = 410 + i * 42
            self.text(736, y, 22, 20, "·", size=18, min_size=12, weight=600,
                      color=t["accent"], line_height=1.2, max_lines=1, label="dot")
            self.text(760, y - 2, 456, 38, criterion, size=TS["small"], min_size=11,
                      weight=400, color=t["muted"], line_height=1.4, max_lines=2,
                      label="criterion")
        if self.s.get("outline"):
            self.label(L + 28, 540, 200, "提案提纲", size=TS["label"], color=t["muted"])
            self.text(L + 28, 564, 576, 24, self.s["outline"], size=15, min_size=11,
                      weight=500, color=t["ink"], line_height=1.4, max_lines=1,
                      label="outline")
        if self.s.get("model"):
            self.label(736, 548, 220, "示例", size=TS["label"], color=t["muted"])
            self.text(736, 572, 480, 52, self.s["model"], family="serif", size=15,
                      min_size=11, weight=400, color=t["ink"], line_height=1.4,
                      max_lines=2, italic=True, label="task-model")
        self.footer()

    def summary(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "EXIT TICKET"))
        self.title(self.s["title"])
        self.label(L, 216, 220, "本课收获", size=TS["label"])
        for i, takeaway in enumerate(self.s["takeaways"][:3]):
            y = 248 + i * 70
            self.text(L, y, 32, 24, f"{i + 1:02d}", family=t["title_family"], size=14,
                      min_size=10, weight=600, color=t["accent"], line_height=1.2,
                      max_lines=1, label="takeaway-num")
            self.text(L + 42, y - 2, 560, 56, takeaway, size=TS["body"], min_size=12,
                      weight=400, color=t["ink"], line_height=1.45, max_lines=2,
                      label="takeaway")
        if self.s.get("closure"):
            self.text(L, 474, 580, 84, self.s["closure"], family=t["title_family"],
                      size=17, min_size=12, weight=500, color=t["ink"], line_height=1.45,
                      max_lines=2, label="closure")
        self.text(L, 548, 580, 24, self.s.get("ticket_check", "画出你用的词块，圈出对人的影响。"),
                  size=15, min_size=11, weight=500, color=t["accent"], line_height=1.4,
                  max_lines=1, label="ticket-check")
        self.text(L, 620, 560, 24, self.s.get("handin", "Hand in your ticket at the door."),
                  size=14, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                  max_lines=1, label="handin")
        self.card(700, 200, 516, 420, r=14)
        self.label(732, 228, 220, "出口票", size=TS["label"])
        prompts = self.s["prompts"][:2]
        for i, prompt in enumerate(prompts):
            y = 262 + i * 96
            self.text(732, y, 452, 50, prompt, size=TS["body"], min_size=11, weight=500,
                      color=t["ink"], line_height=1.4, max_lines=2, label="exit-prompt")
            self.line(732, y + 64, 1184, y + 64, t["line"], sw=1, opacity=0.8)
        if self.s.get("model"):
            self.label(732, 448, 220, "示例", size=TS["label"], color=t["muted"])
            self.text(732, 472, 452, 38, self.s["model"], family="serif", size=14,
                      min_size=10, weight=400, color=t["muted"], line_height=1.4,
                      max_lines=2, italic=True, label="exit-model")
        self.text(732, 530, 452, 22, self.s.get("selfcheck", "One sentence · one chunk · one effect"),
                  size=14, min_size=11, weight=500, color=t["accent"], line_height=1.4,
                  max_lines=1, label="selfcheck")
        self.text(732, 560, 452, 22, self.s.get("minutes", "3 minutes"), size=13,
                  min_size=10, weight=600, color=t["muted"], line_height=1.4,
                  max_lines=1, letter_spacing=0.8, label="minutes")
        self.footer()

    # ---------- continuation ----------
    def story(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "READ THE STORY"))
        self.title(self.s["title"])
        self.text(L, 178, 720, 20, "原文 THE STORY", size=TS["label"], min_size=9, weight=600,
                  color=t["muted"], line_height=1.3, letter_spacing=1.2, max_lines=1,
                  label="story-label")
        self.text(L, 202, 748, 420, self.s["story"], family="serif", size=TS["body"],
                  min_size=13, weight=400, color=t["ink"], line_height=1.68, max_lines=17,
                  label="story-text")
        self.line(836, 192, 836, 636, t["line"], sw=1, opacity=0.75)
        self.label(868, 188, 300, "边读边想", size=TS["label"])
        for i, prompt in enumerate(self.s["prompts"][:3]):
            y = 216 + i * 56
            self.text(868, y, 24, 20, f"{i + 1:02d}", family=t["title_family"], size=12,
                      min_size=10, weight=600, color=t["accent"], line_height=1.3,
                      max_lines=1, label="story-prompt-num")
            self.text(900, y - 2, 316, 50, prompt, size=15, min_size=11, weight=400,
                      color=t["ink"], line_height=1.4, max_lines=2, label="story-prompt")
        self.label(868, 400, 300, "段首句", size=TS["label"])
        for i, starter in enumerate(self.s["starters"][:2]):
            y = 428 + i * 76
            self.card(868, y, 348, 62, r=10)
            self.text(884, y + 6, 316, 50, starter, family="serif", size=16, min_size=10,
                      weight=500, color=t["ink"], line_height=1.3, max_lines=2,
                      label="story-starter")
        self.text(L, 626, 748, 22, "先读一遍，再梳理六 W。", size=14, min_size=10,
                  weight=500, color=t["muted"], line_height=1.4, max_lines=1, label="story-note")
        self.footer()

    def six_w(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "UNPACK THE STORY"))
        self.title(self.s["title"])
        items = self.s["items"][:6]
        row_h = 140
        for i, item in enumerate(items):
            col, row = i % 2, i // 2
            x = L + col * 592
            y = 194 + row * row_h
            self.label(x, y, 120, item["label"], size=TS["label"])
            self.text(x + 116, y - 4, 444, 68, item["text"], size=16, min_size=16,
                      weight=500, color=t["ink"], line_height=1.32, max_lines=3,
                      label="six-w")
            self.text(x + 116, y + 66, 444, 48, item["evidence"], family="serif",
                      size=15, min_size=11, weight=400, color=t["muted"], line_height=1.4,
                      max_lines=2, italic=True, label="six-w-evidence")
            if row < 2:
                self.rule(x, y + 124, x + 560, 0.55)
        if self.s.get("prompt"):
            self.text(L, 620, CONTENT_W, 26, self.s["prompt"], size=15, min_size=11,
                      weight=600, color=t["accent"], line_height=1.4, max_lines=1,
                      label="six-w-prompt")
        self.footer()

    def plot(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "FOLLOW THE FEELING"))
        self.title(self.s["title"])
        nodes = self.s["nodes"][:6]
        xs = [130, 340, 550, 760, 970, 1120]
        ys = [440, 392, 312, 352, 322, 300]
        self.text(L, 170, 220, 20, "情绪强度 ↑", size=12, min_size=9, weight=600,
                  color=t["muted"], line_height=1.3, letter_spacing=1.0, max_lines=1,
                  label="plot-axis")
        for i in range(len(nodes) - 1):
            self.line(xs[i], ys[i], xs[i + 1], ys[i + 1], t["accent"], sw=2, opacity=0.6)
        for i, node in enumerate(nodes):
            x, y = xs[i], ys[i]
            self.ellipse(x, y, 8, 8, fill=t["bg"], stroke=t["accent"], sw=2)
            self.text(x - 84, y - 64, 168, 34, node["event"], size=16, min_size=10,
                      weight=600, color=t["ink"], line_height=1.3, align="center",
                      max_lines=1, label="plot-event")
            self.text(x - 84, y + 16, 168, 24, node["emotion"], size=15, min_size=10,
                      weight=600, color=t["accent"], line_height=1.3, align="center",
                      max_lines=1, label="plot-emotion")
            if node.get("evidence"):
                self.text(x - 84, y + 42, 168, 44, node["evidence"], family="serif",
                          size=16, min_size=10, weight=400, color=t["muted"],
                          line_height=1.3, align="center", max_lines=2, italic=True,
                          label="plot-evidence")
        self.text(L, 196, 100, 20, "P1", size=TS["label"], min_size=9, weight=600,
                  color=t["accent"], line_height=1.3, max_lines=1, label="plot-p1")
        self.line(1044, 220, 1044, 560, t["line"], sw=1, opacity=0.45)
        self.text(1052, 196, 160, 20, "P2", size=TS["label"], min_size=9, weight=600,
                  color=t["accent"], line_height=1.3, max_lines=1, label="plot-p2")
        if self.s.get("note"):
            self.text(L, 596, CONTENT_W, 30, self.s["note"], size=15, min_size=11,
                      weight=500, color=t["muted"], line_height=1.4, max_lines=1,
                      label="plot-note")
        self.footer()

    def plan(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "PLAN THE ENDING"))
        self.title(self.s["title"])
        self.label(L, 196, 260, self.s.get("label", "一个可能的方案"), size=TS["label"])
        self.text(L, 220, 900, 24, self.s.get("note", "Plan in present simple; write in past simple."),
                  size=14, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                  max_lines=1, label="plan-note")
        cols = self.s["paragraphs"][:2]
        gap = 32
        cw = (CONTENT_W - gap) // 2
        top, ch = 252, 318
        for i, col in enumerate(cols):
            x = L + i * (cw + gap)
            self.card(x, top, cw, ch, r=14)
            self.label(x + 26, top + 20, cw - 52, col["label"], size=TS["label"])
            self.text(x + 26, top + 46, cw - 52, 32, col["function"], family="serif",
                      size=23, min_size=16, weight=600, color=t["ink"], line_height=1.2,
                      max_lines=1, label="plan-function")
            for j, point in enumerate(col["points"][:3]):
                y = top + 92 + j * 58
                self.text(x + 26, y, 24, 20, f"{j + 1}.", size=13, min_size=10,
                          weight=600, color=t["accent"], line_height=1.2, max_lines=1,
                          label="plan-num")
                self.text(x + 48, y - 2, cw - 74, 54, point, size=TS["small"], min_size=11,
                          weight=400, color=t["ink"], line_height=1.4, max_lines=3,
                          label="plan-point")
            self.text(x + 26, top + 276, cw - 52, 28, col["emotional"], size=14, min_size=10,
                      weight=600, color=t["accent"], line_height=1.4, max_lines=1,
                      label="plan-emotion")
        self.text(L, 600, 760, 24, "回收线索：" + self.s["clues"], size=TS["small"],
                  min_size=11, weight=500, color=t["ink"], line_height=1.4,
                  max_lines=1, label="clues")
        self.text(840, 600, 376, 24, "铃声还可以意味着什么？", size=15, min_size=11,
                  weight=600, color=t["accent"], line_height=1.4, align="right",
                  max_lines=1, label="plan-alt")
        self.footer()

    def support(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "LANGUAGE SUPPORT"))
        self.title(self.s["title"])
        self.label(L, 190, 120, "功能", size=TS["label"], color=t["muted"])
        self.label(200, 190, 340, "词块", size=TS["label"], color=t["muted"])
        self.label(580, 190, 600, "示例", size=TS["label"], color=t["muted"])
        self.rule(L, 212, W - R, 0.7)
        items = self.s["items"][:4]
        for i, item in enumerate(items):
            y = 230 + i * 96
            self.label(L, y + 2, 120, item["label"], size=TS["label"])
            self.text(200, y - 4, 360, 78, item["chunks"], size=TS["dense"], min_size=11,
                      weight=500, color=t["ink"], line_height=1.4, max_lines=4,
                      label="chunks")
            self.text(580, y - 2, 636, 72, item["model"], family="serif", size=16,
                      min_size=11, weight=400, color=t["muted"], line_height=1.4,
                      max_lines=3, italic=True, label="chunk-model")
            if i < len(items) - 1:
                self.rule(L, y + 82, W - R, 0.55)
        self.text(L, 620, CONTENT_W, 24,
                  self.s.get("note", "Plan in present simple; models are in past simple."),
                  size=14, min_size=11, weight=500, color=t["accent"], line_height=1.4,
                  max_lines=1, label="support-note")
        self.footer()

    def model(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "MODEL"))
        self.title(self.s["title"])
        self.label(L, 196, 360, self.s.get("label", "ONE POSSIBLE VERSION"), size=TS["label"])
        text = self.s["text"]
        for phrase in self.s.get("highlights", []):
            if phrase in text:
                text = text.replace(phrase, f"=={phrase}==", 1)
        self.text(L, 220, 688, 300, text, family="serif", size=17, min_size=13,
                  weight=400, color=t["ink"], line_height=1.7, max_lines=12,
                  label="model-text")
        if self.s.get("notice"):
            self.card(L, 438, 688, 138, r=12)
            self.label(L + 24, 456, 220, "为什么有效", size=TS["label"])
            for i, line in enumerate(self.s["notice"][:2]):
                self.text(L + 24, 482 + i * 38, 636, 32, "·  " + line, size=TS["small"],
                          min_size=11, weight=400, color=t["ink"], line_height=1.4,
                          max_lines=1, label="model-notice")
            self.text(L, 622, CONTENT_W, 24, "你会借哪一招？在自己的草稿里画出来。",
                      size=16, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                      max_lines=1, label="model-prompt")
        self.line(778, 192, 778, 636, t["line"], sw=1, opacity=0.75)
        for i, note in enumerate(self.s["annotations"][:3]):
            y = 188 + i * 152
            self.label(812, y, 380, note["label"], size=TS["label"])
            self.text(812, y + 24, 404, 112, note["text"], size=TS["annotation"],
                      min_size=11, weight=400, color=t["ink"], line_height=1.5,
                      max_lines=4, label="model-note")
        self.footer()

    def writing(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "YOUR TURN"))
        self.title(self.s["title"])
        starters = self.s["starters"][:2]
        for i, starter in enumerate(starters):
            y = 212 + i * 136
            self.card(L, y, 800, 108, r=14)
            self.label(L + 24, y + 16, 220, f"第 {i + 1} 段", size=TS["label"])
            self.text(L + 24, y + 36, 752, 62, starter, family="serif", size=24,
                      min_size=15, weight=500, color=t["ink"], line_height=1.3,
                      valign="middle", max_lines=2, label="starter")
        self.label(900, 212, 240, "检查清单", size=TS["label"])
        for i, item in enumerate(self.s["checklist"][:3]):
            y = 242 + i * 58
            self.text(900, y, 22, 20, "·", size=18, min_size=12, weight=600,
                      color=t["accent"], line_height=1.2, max_lines=1, label="dot")
            self.text(926, y - 2, 290, 50, item, size=TS["small"], min_size=11,
                      weight=400, color=t["muted"], line_height=1.4, max_lines=3,
                      label="check")
        if self.s.get("skeleton"):
            self.text(900, 428, 316, 52, self.s["skeleton"], size=15, min_size=11,
                      weight=500, color=t["ink"], line_height=1.4, max_lines=2,
                      label="skeleton")
        if self.s.get("prewrite"):
            self.card(L, 486, CONTENT_W, 108, r=12)
            self.label(L + 24, 504, 260, "写前想一想", size=TS["label"])
            for i, prompt in enumerate(self.s["prewrite"][:3]):
                self.text(L + 24 + i * 376, 532, 340, 48, f"{i + 1}.  {prompt}",
                          size=16, min_size=11, weight=400, color=t["ink"],
                          line_height=1.3, max_lines=2, label="prewrite")
        self.text(L, 620, 500, 24, self.s.get("meta", "120–150 words · 20 minutes"),
                  size=15, min_size=10, weight=600, color=t["accent"], line_height=1.4,
                  max_lines=1, letter_spacing=0.5, label="writing-meta")
        self.footer()

    def closing(self):
        t = self.t
        self.bg(dark=True)
        self.ellipse(1080, 520, 230, 230, stroke=t["dark_accent"], sw=1, opacity=0.14)
        self.kicker(self.s.get("kicker", "OVER TO YOU"), dark=True, y=52)
        self.text(L, 150, 880, 180, self.s["title"], family=t["title_family"], size=52,
                  min_size=32, weight=t["title_weight"], color=t["dark_ink"],
                  line_height=1.2, max_lines=2, label="closing-title")
        self.text(L, 330, 760, 60, self.s.get("body", ""), size=TS["body"], min_size=13,
                  weight=400, color=t["dark_muted"], line_height=1.55, max_lines=2,
                  label="closing-body")
        self.label(L, 414, 220, "交之前检查", size=TS["label"], color=t["dark_accent"])
        for i, item in enumerate(self.s.get("checklist", [])[:3]):
            y = 444 + i * 38
            self.text(L, y, 22, 20, "·", size=18, min_size=12, weight=600,
                      color=t["dark_accent"], line_height=1.2, max_lines=1, label="dot")
            self.text(L + 26, y - 2, 720, 34, item, size=TS["small"], min_size=11,
                      weight=400, color=t["dark_ink"], line_height=1.4, max_lines=1,
                      label="closing-check")
        if self.s.get("quote"):
            self.text(L, 566, 760, 28, f"“{self.s['quote']}”  — {self.s.get('attribution', 'the text')}",
                      family="serif", size=17, min_size=12, weight=400,
                      color=t["dark_accent"], line_height=1.4, max_lines=1, label="closing-quote")
        if self.s.get("peer"):
            self.text(760, 470, 420, 60, self.s["peer"], size=16, min_size=11,
                      weight=400, color=t["dark_muted"], line_height=1.45, max_lines=2,
                      label="peer-check")
        self.text(L, 612, 760, 24, self.s.get("homework", ""), size=14, min_size=11,
                  weight=500, color=t["dark_muted"], line_height=1.4, max_lines=1,
                  label="homework")
        self.footer(dark=True)

    # ---------- dense gallery ----------
    def grammar(self):
        t = self.t
        self.bg()
        self.kicker(self.s.get("kicker", "FORM · MEANING · USE"))
        self.title(self.s["title"], size=40)
        headers = ["PAST SIMPLE", "PRESENT PERFECT"]
        rows = self.s["rows"]
        x0, x1 = L, L + 592
        top = 196
        for i, h in enumerate(headers):
            x = x0 + i * 592
            self.label(x, top, 560, h, size=13)
            self.rule(x, top + 22, x + 560, 0.8)
        row_h = 80
        for r, row in enumerate(rows):
            y = top + 44 + r * row_h
            self.label(x0, y, 120, row["label"], size=TS["label"], color=t["muted"])
            self.text(x0 + 120, y - 4, 440, 66, row["left"], size=TS["dense"],
                      min_size=11, weight=400, color=t["ink"], line_height=1.4,
                      max_lines=3, label="grammar-left")
            self.text(x1 + 120, y - 4, 440, 66, row["right"], size=TS["dense"],
                      min_size=11, weight=400, color=t["ink"], line_height=1.4,
                      max_lines=3, label="grammar-right")
            if r < len(rows) - 1:
                self.rule(x0, y + 70, W - R, 0.5)
        if self.s.get("trap"):
            self.rule(L, 500, W - R, 0.8)
            self.label(L, 514, 120, "TRAP", size=TS["label"], color=t["accent"])
            self.text(L + 120, 506, 1044, 46, self.s["trap"], size=TS["small"],
                      min_size=11, weight=500, color=t["ink"], line_height=1.35,
                      max_lines=2, label="grammar-trap")
        if self.s.get("note"):
            self.text(L, 600, CONTENT_W, 28, self.s["note"], size=14, min_size=11,
                      weight=500, color=t["muted"], line_height=1.4, max_lines=1,
                      label="grammar-note")
        self.footer()

    def exam(self):
        t = self.t
        self.bg()
        reveal = self.s.get("reveal", True)
        stage = "ANSWER" if reveal else "THINK"
        self.kicker(self.s.get("kicker", "QUESTION ANALYSIS") + "  ·  " + stage)
        self.title(self.s["title"], size=40, w=980, max_lines=2)
        self.label(L, 196, 260, self.s.get("meta", "READING · QUESTION 24"), size=TS["label"])
        self.text(L, 224, 640, 76, self.s["stem"], size=18, min_size=13, weight=500,
                  color=t["ink"], line_height=1.4, max_lines=3, label="stem")
        for i, option in enumerate(self.s["options"][:4]):
            y = 322 + i * 44
            correct = reveal and option.get("correct")
            self.text(L, y, 26, 24, option["key"], size=18, min_size=11, weight=600,
                      color=t["accent"] if correct else t["muted"], line_height=1.2,
                      max_lines=1, label="option-key")
            self.text(L + 36, y - 2, 600, 40, option["text"], size=18, min_size=12,
                      weight=600 if correct else 400,
                      color=t["ink"] if correct else t["muted"], line_height=1.4,
                      max_lines=2, label="option-text")
            if correct:
                self.text(L + 600, y - 2, 34, 24, "✓", size=18, min_size=12, weight=600,
                          color=t["accent"], line_height=1.2, max_lines=1, label="option-check")
        self.line(720, 192, 720, 640, t["line"], sw=1, opacity=0.75)
        if reveal:
            self.label(752, 196, 200, "ANSWER", size=TS["label"])
            self.text(752, 220, 440, 44, self.s["answer"], family="serif", size=28,
                      min_size=18, weight=600, color=t["accent"], line_height=1.2,
                      max_lines=1, label="answer")
            self.label(752, 278, 200, "EVIDENCE", size=TS["label"])
            self.text(752, 302, 440, 84, self.s["evidence"], family="serif", size=16,
                      min_size=11, weight=400, color=t["ink"], line_height=1.45,
                      max_lines=4, italic=True, label="evidence")
            self.label(752, 398, 200, "WHY", size=TS["label"])
            self.text(752, 422, 440, 84, self.s["why"], size=16, min_size=11, weight=400,
                      color=t["ink"], line_height=1.45, max_lines=4, label="why")
            self.label(752, 518, 200, "TRAP", size=TS["label"])
            self.text(752, 542, 440, 52, self.s["trap"], size=16, min_size=11, weight=400,
                      color=t["muted"], line_height=1.4, max_lines=2, label="trap")
            self.text(L, 596, 640, 48, self.s.get("pattern", ""), size=15, min_size=11,
                      weight=500, color=t["ink"], line_height=1.4, max_lines=2,
                      label="pattern")
        else:
            self.label(752, 196, 200, "THINK", size=TS["label"])
            prompts = [
                "Where is the evidence? Underline one sentence.",
                "Which option is a trap, and why?",
                "What is the writer doing with the phrase?",
            ]
            for i, prompt in enumerate(prompts):
                y = 228 + i * 92
                self.text(752, y, 24, 20, f"{i + 1:02d}", family=t["title_family"], size=11,
                          min_size=9, weight=600, color=t["accent"], line_height=1.3,
                          max_lines=1, label="think-num")
                self.text(784, y - 2, 400, 78, prompt, size=17, min_size=11, weight=400,
                          color=t["ink"], line_height=1.45, max_lines=3, label="think-prompt")
            self.text(L, 558, 640, 24, "Your answer: ______     One reason: ____________________",
                      size=15, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                      max_lines=1, label="commit")
            self.label(752, 536, 220, "ANSWER FRAME", size=TS["label"], color=t["muted"])
            self.text(752, 560, 440, 44, "The writer suggests that… because…", size=16,
                      min_size=11, weight=500, color=t["ink"], line_height=1.4,
                      max_lines=2, label="answer-frame")
            self.text(L, 620, CONTENT_W, 22, "Answer and analysis on the next slide.",
                      size=14, min_size=11, weight=500, color=t["muted"], line_height=1.4,
                      max_lines=1, label="think-note")
        self.footer()

    def build(self):
        getattr(self, self.s["layout"])()
        return self.prims


FOCUS_LAYOUTS = {"cover", "section", "quote", "closing"}
REVEAL_LAYOUTS = {"passage", "questions", "exam"}
NON_CONTENT = {"footer", "page", "kicker", "cover-tag", "label", "ref", "arrow",
               "dot", "passage-source", "model-label", "note", "writing-meta",
               "plot-axis", "plot-p1", "plot-p2", "prompt-num", "signal",
               "first-read-num", "selfcheck", "minutes", "story-label",
               "story-prompt-num", "plan-num", "think-num"}
MIN_CHARS = {
    "objectives": 180, "pre_reading": 140, "text_structure": 160, "passage": 500,
    "language": 200, "questions": 240, "task": 220, "summary": 110, "story": 600,
    "six_w": 300, "plot": 120, "plan": 190, "support": 200, "model": 300,
    "writing": 180, "grammar": 220, "exam": 320,
}


def density_warnings(prims, layout, reveal=True):
    if layout in FOCUS_LAYOUTS:
        return []
    chars, small = 0, []
    for p in prims:
        if p["type"] != "text" or p.get("label") in NON_CONTENT:
            continue
        text = "".join(r["text"] for line in p["lines"] for r in line["runs"])
        chars += len(text)
        if p["size"] < 14:
            small.append((p.get("label", ""), p["size"]))
    out = []
    need = MIN_CHARS.get(layout, 0)
    if reveal and need and chars < need:
        out.append(f"内容偏少：{chars} 字，低于 {layout} 的 {need} 字预算")
    if small:
        out.append("正文过小：" + "、".join(f"{label} {size}px" for label, size in small[:3]))
    return out


def expand_slides(deck):
    out = []
    for slide in deck["slides"]:
        if slide.get("staged") and slide["layout"] in REVEAL_LAYOUTS:
            out.append({**slide, "reveal": False})
            out.append({**slide, "reveal": True})
        else:
            out.append({**slide, "reveal": True})
    return out


def compile_deck(deck: dict) -> dict:
    theme = THEMES[deck["theme"]]
    slides_data = expand_slides(deck)
    total = len(slides_data)
    slides, warnings = [], []
    for i, slide in enumerate(slides_data):
        scene = Scene(theme, slide, i, total, deck)
        # 每页兜底：任何渲染异常都带页码与 layout 交回去，绝不裸抛
        # TypeError/KeyError —— 那种错误文本对调用方毫无行动价值。
        try:
            prims = scene.build()
        except DeckError:
            raise
        except KeyError as exc:
            raise DeckError(f"第 {i + 1} 页（{slide['layout']}）缺少字段 {exc.args[0]!r}") from exc
        except Exception as exc:
            raise DeckError(f"第 {i + 1} 页（{slide['layout']}）渲染失败：{exc}") from exc
        reveal = slide.get("reveal", True)
        warnings.extend(f"Slide {i + 1}: {w}" for w in scene.warnings)
        warnings.extend(f"Slide {i + 1}: {w}" for w in density_warnings(prims, slide["layout"], reveal))
        notes = slide.get("notes", "")
        if not reveal and slide.get("notes_prompt"):
            notes = slide["notes_prompt"]
        if reveal and slide.get("notes_reveal"):
            notes = slide["notes_reveal"]
        slides.append({"index": i, "layout": slide["layout"], "reveal": reveal,
                       "title": slide.get("title", ""), "kicker": slide.get("kicker", ""),
                       "notes": notes, "primitives": prims})
    return {"format": "nbx-scene", "version": 1, "size": {"width": W, "height": H},
            "theme": deck["theme"], "theme_name": theme["name"], "title": deck["title"],
            "slides": slides, "warnings": warnings}


def main():
    root = Path(__file__).parent
    (root / "out").mkdir(exist_ok=True)
    import sys
    name = sys.argv[1] if len(sys.argv) > 1 else "deck-reading"
    deck = json.loads((root / f"{name}.json").read_text(encoding="utf-8"))
    scene = compile_deck(deck)
    (root / "out" / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=1), encoding="utf-8")
    (root / "out" / "deck-source.json").write_text(json.dumps(deck, ensure_ascii=False, indent=1), encoding="utf-8")
    print(name, "slides", len(scene["slides"]), "warnings", len(scene["warnings"]))
    for w in scene["warnings"]:
        print(" -", w)


if __name__ == "__main__":
    main()
