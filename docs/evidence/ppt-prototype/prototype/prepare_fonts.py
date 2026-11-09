"""Build tiny CJK webfont subsets for the prototype deck.

Fetches one variable subset per family from Google Fonts, instantiates static
weights, and writes a CSS file with base64-embedded woff2 for the preview.
"""
import base64
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

import brotli  # noqa: F401  (fontTools needs it to read/write woff2)
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).parent
FONTS = ROOT / "fonts"
FONTS.mkdir(exist_ok=True)
DECK = json.loads((ROOT / "deck.json").read_text(encoding="utf-8"))

FAMILIES = {
    "serif": ("Noto Serif SC", [400, 600, 700]),
    "sans": ("Noto Sans SC", [400, 500, 700]),
}
EXTRA = "".join(chr(c) for c in range(32, 127))
EXTRA += "，。、；：？！“”‘’（）【】《》〈〉—…·×→←↑↓↔■□●○◆◇一二三四五六七八九十"


def collect_text():
    chars = set(EXTRA)

    def walk(value):
        if isinstance(value, str):
            chars.update(value)
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk(DECK)
    return "".join(sorted(chars))


TEXT = collect_text()
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"


def fetch_variable(family):
    spec = family.replace(" ", "+") + ":wght@400;700"
    url = ("https://fonts.googleapis.com/css2?family=" + spec + "&text="
           + urllib.parse.quote(TEXT) + "&display=swap")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    css = urllib.request.urlopen(req, timeout=60).read().decode()
    src = re.search(r"url\((https://[^)]+)\)", css)
    if not src:
        raise SystemExit(f"no font url for {family}: {css[:300]}")
    return urllib.request.urlopen(src.group(1), timeout=60).read()


def fix_names(font, family, weight):
    """Instantiated fonts keep the variable font's default name; rename them so
    fontconfig / LibreOffice see a normal family with four weights."""
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
    os2 = font["OS/2"]
    os2.usWeightClass = weight
    head = font["head"]
    if weight >= 600:
        head.macStyle |= 1
        os2.fsSelection = (os2.fsSelection & ~(1 << 6)) | (1 << 5)
    else:
        head.macStyle &= ~1
        os2.fsSelection = (os2.fsSelection & ~(1 << 5)) | (1 << 6)


def main():
    css_parts = []
    for key, (family, weights) in FAMILIES.items():
        variable = fetch_variable(family)
        var_path = FONTS / f"{key}-var.woff2"
        var_path.write_bytes(variable)
        for weight in weights:
            font = TTFont(var_path)
            instantiateVariableFont(font, {"wght": weight}, inplace=True)
            fix_names(font, family, weight)
            stem = f"{key}-{weight}"
            ttf_path = FONTS / f"{stem}.ttf"
            font.flavor = None
            font.save(ttf_path)
            font.flavor = "woff2"
            woff2_path = FONTS / f"{stem}.woff2"
            font.save(woff2_path)
            css_parts.append(
                "@font-face{font-family:'%s';font-style:normal;font-weight:%d;"
                "font-display:block;src:url(data:font/woff2;base64,%s) format('woff2')}"
                % (family, weight, base64.b64encode(woff2_path.read_bytes()).decode())
            )
            print(stem, woff2_path.stat().st_size, ttf_path.stat().st_size)
    (FONTS / "fonts.css").write_text("\n".join(css_parts), encoding="utf-8")
    print("css", (FONTS / "fonts.css").stat().st_size, "chars", len(TEXT))


if __name__ == "__main__":
    main()
