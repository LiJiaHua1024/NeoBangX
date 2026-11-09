"""Deterministic text measurement, wrapping and fitting.

The same wrapped lines are later emitted to SVG and PPTX, so the preview and
the exported deck break lines in the same place. Widths come from the actual
Noto CJK outlines used by the preview; production can ship the same fonts or a
precomputed advance table.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont

FONTS = Path(__file__).parent / "fonts"
FAMILY_FILES = {
    ("serif", 400): "serif-400.ttf",
    ("serif", 500): "serif-400.ttf",
    ("serif", 600): "serif-600.ttf",
    ("serif", 700): "serif-700.ttf",
    ("sans", 400): "sans-400.ttf",
    ("sans", 500): "sans-500.ttf",
    ("sans", 600): "sans-500.ttf",
    ("sans", 700): "sans-700.ttf",
}

# 行首禁则 / 行尾禁则：按中文排版的常见子集处理，避免标点悬在行首。
NO_START = set("，。、；：？！）】》」』”’…·%,.;:?!)]}")
NO_END = set("（【《「『“‘([{")
CJK = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]")
SPACE = re.compile(r"\s")
MARKUP = re.compile(r"(\*\*.+?\*\*|==.+?==)")


@dataclass
class Run:
    text: str
    weight: int = 400
    color: str = ""
    italic: bool = False
    font: str = "sans"


@dataclass
class Line:
    runs: list[Run]
    width: float


@dataclass
class Fitted:
    lines: list[Line]
    size: int
    line_height: int
    overflow: bool = False
    warnings: list[str] = field(default_factory=list)


@lru_cache(maxsize=512)
def _font(family: str, weight: int, size: int):
    weight = min(700, max(400, (weight // 100) * 100))
    path = FONTS / FAMILY_FILES[(family, weight)]
    return ImageFont.truetype(str(path), size)


def advance(text: str, family: str, weight: int, size: int) -> float:
    return _font(family, weight, size).getlength(text)


def parse_markup(text: str, base: Run, accent: str) -> list[Run]:
    """`**粗体**` 与 `==强调色==`，其余按基础样式。"""
    runs: list[Run] = []
    for part in MARKUP.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            runs.append(Run(part[2:-2], min(700, base.weight + 200), base.color, base.italic, base.font))
        elif part.startswith("==") and part.endswith("==") and len(part) > 4:
            runs.append(Run(part[2:-2], min(700, base.weight + 100), accent, base.italic, base.font))
        else:
            runs.append(Run(part, base.weight, base.color, base.italic, base.font))
    return runs


@dataclass
class Cluster:
    text: str
    run: Run
    width: float
    break_after: bool = True


def _clusters(runs: list[Run], size: int) -> list[Cluster]:
    """把富文本切成可断行的簇；英文按词，中文按字，标点跟随相邻字。"""
    raw: list[Cluster] = []
    for run in runs:
        text = run.text
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\n":
                raw.append(Cluster("\n", run, 0.0, True))
                i += 1
                continue
            if SPACE.match(ch):
                # 空格并入前一个簇，避免行尾悬挂空格
                if raw:
                    raw[-1].text += ch
                    raw[-1].width += advance(ch, run.font, run.weight, size)
                    raw[-1].break_after = True
                else:
                    raw.append(Cluster(ch, run, advance(ch, run.font, run.weight, size), True))
                i += 1
                continue
            if CJK.match(ch):
                raw.append(Cluster(ch, run, advance(ch, run.font, run.weight, size), True))
                i += 1
                continue
            # 拉丁词：一直吃到空格、中文或标点
            j = i
            while j < len(text) and not SPACE.match(text[j]) and not CJK.match(text[j]):
                j += 1
            word = text[i:j]
            raw.append(Cluster(word, run, advance(word, run.font, run.weight, size), False))
            i = j

    # 英文词末若是空格已经并进来了；词与词之间的断开交给空格簇。
    for idx, cluster in enumerate(raw):
        if cluster.text and cluster.text[-1] in NO_END:
            cluster.break_after = False
        if any(c in NO_START for c in cluster.text):
            # “他说：“……””这类：标点所在簇整体不放到行首
            if idx:
                raw[idx - 1].break_after = False
    return raw


def wrap_runs(runs: list[Run], width: float, size: int) -> list[Line]:
    clusters = _clusters(runs, size)
    lines: list[list[Cluster]] = []
    current: list[Cluster] = []
    current_width = 0.0

    def flush():
        nonlocal current, current_width
        if current:
            lines.append(current)
            current = []
            current_width = 0.0

    for idx, cluster in enumerate(clusters):
        if cluster.text == "\n":
            flush()
            continue
        cw = cluster.width
        if current and current_width + cw > width:
            # 行首禁则：本簇以禁则标点开头时，把上一簇也带到下一行
            if any(c in NO_START for c in cluster.text) and len(current) > 1:
                moved = current.pop()
                flush()
                current = [moved, cluster]
                current_width = moved.width + cw
                continue
            flush()
        current.append(cluster)
        current_width += cw
        # 英文单词后没有空格时，不断开；下一个簇开始新词时由宽度决定
        if not cluster.break_after and idx + 1 < len(clusters):
            continue

    flush()

    # 避免最后一行只剩一两个字：从上一行尾部搬少量字过来（中文断行尤其实用）。
    if len(lines) >= 2:
        threshold = width * 0.26
        moved = 0
        while (moved < 8 and lines[-1] and sum(c.width for c in lines[-1]) < threshold
               and len(lines[-2]) > 1):
            candidate = lines[-2][-1]
            if any(ch in NO_START for ch in candidate.text) or candidate.text.endswith(tuple(NO_END)):
                break
            lines[-1].insert(0, lines[-2].pop())
            moved += 1

    result: list[Line] = []
    for line_clusters in lines:
        line_runs: list[Run] = []
        for cluster in line_clusters:
            if line_runs and (line_runs[-1].weight == cluster.run.weight
                              and line_runs[-1].color == cluster.run.color
                              and line_runs[-1].italic == cluster.run.italic
                              and line_runs[-1].font == cluster.run.font):
                line_runs[-1].text += cluster.text
            else:
                line_runs.append(Run(cluster.text, cluster.run.weight, cluster.run.color,
                                     cluster.run.italic, cluster.run.font))
        result.append(Line(line_runs, sum(c.width for c in line_clusters)))
    return result


def fit(text: str, *, box_w: float, box_h: float, family: str = "sans", weight: int = 400,
        color: str = "#111111", accent: str = "#A63D2F", size: int = 24, min_size: int = 12,
        line_height: float = 1.6, align: str = "left", max_lines: int | None = None,
        label: str = "") -> Fitted:
    """按字号从大到小试排，直到行数与高度都放得下；放不下时返回最小字号并标记。"""
    base = Run("", weight, color, False, family)
    runs = parse_markup(text, base, accent)
    chosen = None
    for candidate in range(size, min_size - 1, -1):
        lines = wrap_runs(runs, box_w, candidate)
        lh = round(candidate * line_height)
        if max_lines and len(lines) > max_lines:
            continue
        if lines and len(lines) * lh <= box_h + 0.5:
            chosen = Fitted(lines, candidate, lh)
            break
    if chosen is None:
        lines = wrap_runs(runs, box_w, min_size)
        lh = round(min_size * line_height)
        chosen = Fitted(lines, min_size, lh, overflow=True)
        chosen.warnings.append(
            f"{label or text[:16]} 在 {box_w:.0f}×{box_h:.0f} 内仍可能溢出（{len(lines)} 行）")
    return chosen
