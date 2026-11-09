"""Build Latin + CJK font subsets for the bilingual teaching prototype.

Latin: Gelasio / Arimo (metric-compatible with the PPTX's Georgia / Arial).
CJK: Noto Serif SC / Noto Sans SC (preview/metrics; PPTX uses 宋体 / 微软雅黑).
"""
import base64
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

import brotli  # noqa: F401
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).parent
FONTS = ROOT / "fonts"
FONTS.mkdir(exist_ok=True)

LATIN = {
    "serif": ("Gelasio", [400, 600, 700]),
    "sans": ("Arimo", [400, 500, 600, 700]),
}
CJK = {
    "serif": ("Noto Serif SC", [400, 700]),
    "sans": ("Noto Sans SC", [400, 500, 700]),
}
ASCII = "".join(chr(c) for c in range(32, 127)) + "“”‘’—–…→←↑↓•✓×"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"


def collect_text():
    chars = set(ASCII)
    for path in sorted(ROOT.glob("deck-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))

        def walk(value):
            if isinstance(value, str):
                chars.update(value)
            elif isinstance(value, dict):
                for v in value.values():
                    walk(v)
            elif isinstance(value, list):
                for v in value:
                    walk(v)

        walk(data)
    return "".join(sorted(chars))


TEXT = collect_text()


def fetch_variable(family, text):
    spec = family.replace(" ", "+") + ":wght@400;700"
    url = "https://fonts.googleapis.com/css2?family=" + spec + "&text=" + urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=60).read().decode()
    src = re.search(r"url\((https://[^)]+)\)", css)
    if not src:
        raise SystemExit(f"no font url for {family}: {css[:300]}")
    return urllib.request.urlopen(src.group(1), timeout=60).read()


def fix_names(font, family, weight):
    style = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}.get(weight, "Regular")
    full = f"{family} {style}" if style != "Regular" else family
    ps = family.replace(" ", "") + "-" + style
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22):
            name.removeNames(nameID=rec.nameID, platformID=rec.platformID,
                             platEncID=rec.platEncID, langID=rec.langID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(family, 1, pid, eid, lid)
        name.setName(style, 2, pid, eid, lid)
        name.setName(f"{full}-v1", 3, pid, eid, lid)
        name.setName(full, 4, pid, eid, lid)
        name.setName(ps, 6, pid, eid, lid)
        name.setName(family, 16, pid, eid, lid)
        name.setName(style, 17, pid, eid, lid)
    font["OS/2"].usWeightClass = weight
    head = font["head"]
    os2 = font["OS/2"]
    if weight >= 600:
        head.macStyle |= 1
        os2.fsSelection = (os2.fsSelection & ~(1 << 6)) | (1 << 5)
    else:
        head.macStyle &= ~1
        os2.fsSelection = (os2.fsSelection & ~(1 << 5)) | (1 << 6)


def emit(prefix, family, weights, text):
    variable = fetch_variable(family, text)
    var_path = FONTS / f"{prefix}-var.woff2"
    var_path.write_bytes(variable)
    for weight in weights:
        font = TTFont(var_path)
        instantiateVariableFont(font, {"wght": weight}, inplace=True)
        fix_names(font, family, weight)
        stem = f"{prefix}-{weight}"
        ttf = FONTS / f"{stem}.ttf"
        font.flavor = None
        font.save(ttf)
        font.flavor = "woff2"
        woff2 = FONTS / f"{stem}.woff2"
        font.save(woff2)
        print(stem, woff2.stat().st_size)
        yield (
            "@font-face{font-family:'%s';font-style:normal;font-weight:%d;"
            "font-display:block;src:url(data:font/woff2;base64,%s) format('woff2')}"
            % (family, weight, base64.b64encode(woff2.read_bytes()).decode())
        )


def main():
    css_parts = []
    for key, (family, weights) in LATIN.items():
        css_parts.extend(emit(key, family, weights, ASCII))
    for key, (family, weights) in CJK.items():
        css_parts.extend(emit("cjk-" + key, family, weights, TEXT))
    (FONTS / "fonts.css").write_text("\n".join(css_parts), encoding="utf-8")
    print("css", (FONTS / "fonts.css").stat().st_size, "chars", len(TEXT))


if __name__ == "__main__":
    main()
