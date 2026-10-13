"""阅读文本改编：机械检查（结构块 / 词数 / 注释格式 / 表格 / 重复词）。

用法：
  uv run python ra_check.py --round v0 --suite 阅读文本改编
结果：work/racheck/<stem>.json + 汇总表。
"""
from __future__ import annotations

import paths
import argparse
import json
import re
from pathlib import Path

CJK = r"\u4e00-\u9fff"
EN_STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is",
           "are", "was", "were", "be", "been", "it", "its", "that", "this",
           "with", "as", "at", "by", "from", "but", "not", "his", "her", "they"}


def material_words(material: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", material))


def split_blocks(md: str) -> dict[str, str]:
    """按标题切出改编后文本 / 说明 / 命题建议三块（容错：标题写法略有出入也认）。"""
    def find(pat: str) -> int:
        m = re.search(pat, md, re.M)
        return m.start() if m else -1

    i_text = find(r"^#+ .*改编后文本") or find(r"^改编后文本")
    i_note = find(r"^#+ .*改造说明") or find(r"^#+ .*改编.*说明") or find(r"^改造清单")
    i_tips = find(r"^#+ .*命题建议") or find(r"^命题建议")
    idx = sorted([i for i in (i_text, i_note, i_tips) if i >= 0])
    blocks = {}
    names = []
    for name, i in (("text", i_text), ("note", i_note), ("tips", i_tips)):
        if i >= 0:
            names.append((i, name))
    names.sort()
    for n, (i, name) in enumerate(names):
        end = names[n + 1][0] if n + 1 < len(names) else len(md)
        blocks[name] = md[i:end]
    return blocks


def check(stem: str, md: str, material: str) -> dict:
    blocks = split_blocks(md)
    res = {"stem": stem, "checks": {}}

    missing = [n for n in ("text", "note", "tips") if n not in blocks]
    res["checks"]["blocks"] = {"ok": not missing, "missing": missing}

    text = blocks.get("text", "")
    words = len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text))
    mw = material_words(material)
    target_short = mw < 300
    if target_short:
        ok = words <= 300
    else:
        ok = 280 <= words <= 360
    res["checks"]["word_count"] = {"ok": ok, "words": words, "material_words": mw,
                                   "note": "短素材不应扩写" if target_short else "目标 300-340"}

    bad_ann = re.findall(r"[A-Za-z]\([^)\n]{0,20}[" + CJK + r"][^)\n]{0,20}\)", text)
    good_ann = re.findall(r"\s\([^)\n]{0,20}[" + CJK + r"][^)\n]{0,20}\)", text)
    res["checks"]["annotation_format"] = {"ok": not bad_ann, "bad": bad_ann[:3],
                                          "good_count": len(good_ann),
                                          "rule": "词 (中文) 之间留一个空格"}

    note = blocks.get("note", "")
    rows = len(re.findall(r"^\|(?![ :|-])", note, re.M))
    res["checks"]["transform_table"] = {"ok": rows >= 3, "rows": rows, "rule": "改造清单 ≥3 行"}

    words_l = re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())
    freq = {}
    for w in words_l:
        if w not in EN_STOP and len(w) > 3:
            freq[w] = freq.get(w, 0) + 1
    top = sorted(freq.items(), key=lambda kv: -kv[1])[:5]
    res["checks"]["repeat_words"] = {"ok": not top or top[0][1] <= 4, "top": top,
                                     "rule": "实义词出现 ≤4 次（同义替换）"}

    res["ok"] = all(c.get("ok", True) for c in res["checks"].values())
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)

    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    out_dir = paths.outputs_dir() / args.round
    work = paths.work_dir() / "racheck"
    work.mkdir(parents=True, exist_ok=True)

    results = []
    for f in sorted(out_dir.glob("*.md")):
        stem = f.stem
        cid = stem.split("_q")[0]
        material = cases.get(cid, {}).get("material", "")
        res = check(stem, f.read_text(encoding="utf-8"), material)
        (work / f"{stem}.json").write_text(
            json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
        results.append(res)

    print(f"\n== ra_check {args.round}（{len(results)} 份）==")
    fails = 0
    for r in results:
        bad = [k for k, c in r["checks"].items() if not c.get("ok", True)]
        wc = r["checks"].get("word_count", {})
        flag = "OK " if r["ok"] else "FAIL"
        print(f"  [{flag}] {r['stem']:<28} 词数={wc.get('words')} 素材={wc.get('material_words')}"
              f" 问题={bad or '无'}")
        if not r["ok"]:
            fails += 1
    print(f"通过 {len(results) - fails}/{len(results)}；明细 work/racheck/")


if __name__ == "__main__":
    main()
