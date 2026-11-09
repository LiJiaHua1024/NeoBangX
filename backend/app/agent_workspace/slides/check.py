"""Conservative overflow checker for a compiled scene.

Why a ratio check instead of only "does it fit":
- PowerPoint/WPS can substitute a slightly wider font; a line that uses 99% of
  its box is a real deployment risk even if it fits today.
- This catches near-limit lines before they become a visible overflow.
- Errors are only reported when the measured width/height actually exceeds the
  box (tolerance included); warnings are for tight lines, not failures.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

WARN_RATIO = 0.94
ERR_RATIO = 1.0
TOL = 1.0
SAFE = (40, 40, 1240, 700)
# Labels are short by design; a 0.96 line in a 13px label is not a teaching
# payload overflow. They still fail on a measured >box error.
LABELISH = {"kicker", "label", "footer", "page", "cover-tag", "cover-meta",
            "passage-source", "ref", "signal", "note", "story-label", "story-note",
            "story-prompt-num", "plot-axis", "plot-p1", "plot-p2", "prompt-num",
            "first-read-num", "first-read-timer", "first-read-note", "think-num",
            "think-note", "plan-num", "answer-mark", "option-key", "option-check",
            "homework", "selfcheck", "minutes", "dot", "passage-takeaway",
            "answer-frame"}


def line_boxes(p):
    lines = p.get("lines") or []
    n = len(lines)
    lh = p.get("line_height", 0)
    top = p["y"]
    if p.get("valign") == "middle":
        top += (p["h"] - n * lh) / 2
    elif p.get("valign") == "bottom":
        top += p["h"] - n * lh
    for i, line in enumerate(lines):
        w = line.get("width", 0)
        if p.get("align") == "center":
            x = p["x"] + (p["w"] - w) / 2
        elif p.get("align") == "right":
            x = p["x"] + p["w"] - w
        else:
            x = p["x"]
        yield (x, top + i * lh, w, lh, i)


def check(scene: dict):
    errors, warnings = [], []
    for slide in scene["slides"]:
        n = slide["index"] + 1
        text_boxes = []
        rects = [r for r in slide["primitives"] if r["type"] == "rect" and r["w"] * r["h"] < 0.75 * 1280 * 720]
        for p in slide["primitives"]:
            if p["type"] != "text" or not p.get("lines"):
                continue
            label = p.get("label") or "text"
            text = "".join(r["text"] for line in p["lines"] for r in line["runs"]).strip()
            if not text:
                continue
            maxw = max(line["width"] for line in p["lines"])
            wr = maxw / max(1.0, p["w"])
            th = len(p["lines"]) * p["line_height"]
            hr = th / max(1.0, p["h"])
            item = (n, label, round(wr, 3), round(hr, 3), text[:36])
            if maxw > p["w"] + TOL or th > p["h"] + 4:
                errors.append(item)
            elif label not in LABELISH and (wr > WARN_RATIO or (len(p["lines"]) > 1 and hr > 0.97)):
                warnings.append(item)
            x, y, w, h = p["x"], p["y"], p["w"], p["h"]
            if x < SAFE[0] or y < SAFE[1] or x + w > SAFE[2] or y + h > SAFE[3]:
                warnings.append((n, label + " · safe-area", round(wr, 3), round(hr, 3), text[:36]))
            # If the text sits inside a card, every visual line must stay inside
            # that card with a small padding. This is the "text crosses the card
            # edge" check that a pure box-width check misses.
            contains = [r for r in rects
                        if r["x"] <= x + w / 2 <= r["x"] + r["w"]
                        and r["y"] <= y + h / 2 <= r["y"] + r["h"]]
            if contains:
                card = min(contains, key=lambda r: r["w"] * r["h"])
                over = []
                for bx, by, bw, bh, _ in line_boxes(p):
                    if bx < card["x"] - 2 or bx + bw > card["x"] + card["w"] + 2:
                        over.append("h")
                    if by < card["y"] - 2 or by + bh > card["y"] + card["h"] + 2:
                        over.append("v")
                if over:
                    warnings.append((n, label + " · card-edge", round(wr, 3), round(hr, 3), text[:36]))
            text_boxes.append((p, label, text))
        # Text-text collision: use visual line boxes, not the full text frame.
        for i in range(len(text_boxes)):
            pi, li, ti = text_boxes[i]
            for j in range(i + 1, len(text_boxes)):
                pj, lj, tj = text_boxes[j]
                for ax, ay, aw, ah, _ in line_boxes(pi):
                    for bx, by, bw, bh, _ in line_boxes(pj):
                        ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
                        iy = max(0, min(ay + ah, by + bh) - max(ay, by))
                        if ix * iy > 8:
                            warnings.append((n, f"{li} × {lj} · text-overlap",
                                             round(max(ax + aw, bx + bw) - min(ax, bx), 1),
                                             round(max(ay + ah, by + bh) - min(ay, by), 1),
                                             (ti[:16] + " / " + tj[:16])))
                            break
                    else:
                        continue
                    break
    return errors, warnings


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "out" / "scene.json"
    scene = json.loads(path.read_text(encoding="utf-8"))
    errors, warnings = check(scene)
    print(f"scene: {scene['title']} · {len(scene['slides'])} slides")
    if errors:
        print("\nERRORS (measured overflow):")
        for e in errors:
            print("  slide %02d  %-18s  width %.2f  height %.2f  %r" % e)
    if warnings:
        print("\nWARNINGS (tight; review before shipping):")
        for w in warnings:
            print("  slide %02d  %-18s  width %.2f  height %.2f  %r" % w)
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
