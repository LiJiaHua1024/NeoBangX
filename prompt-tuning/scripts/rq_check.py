"""阅读理解设问：机械检查（结构块 / 题量 / 选项 / 答案证据 / 鉴别指引 / AB 伪双版查重）。

用法：
  uv run python rq_check.py --round v0 --suite 阅读理解设问
结果：work/rqcheck/<stem>.json + 汇总表。
"""
from __future__ import annotations

import paths
import argparse
import difflib
import json
import re

OPTION_RE = re.compile(r"^\s*([A-D])[.、)]\s*\S", re.M)
QNUM_RE = re.compile(r"^\s*(\d+)[.、]\s+\S", re.M)
STEM_RE = re.compile(r"^\s*\d+[.、]\s+(.+)$", re.M)


def split_versions(md: str) -> dict[str, str]:
    m_a = re.search(r"^#+\s*(?:版本\s*)?A\b.*$", md, re.M)
    m_b = re.search(r"^#+\s*(?:版本\s*)?B\b.*$", md, re.M)
    m_j = re.search(r"^#+\s*鉴别指引", md, re.M)
    blocks = {}
    if m_a:
        blocks["A"] = md[m_a.start(): m_b.start() if m_b else len(md)]
    if m_b:
        blocks["B"] = md[m_b.start(): m_j.start() if m_j else len(md)]
    blocks["tail"] = md[m_j.start():] if m_j else ""
    blocks["head"] = md[: m_a.start()] if m_a else md
    return blocks


def stems_of(block: str) -> list[str]:
    return [re.sub(r"\s+", " ", s).strip().lower() for s in STEM_RE.findall(block)]


def check(stem: str, md: str, material: str) -> dict:
    blocks = split_versions(md)
    res = {"stem": stem, "checks": {}}

    res["checks"]["blocks"] = {
        "ok": all(k in blocks for k in ("A", "B")) and bool(blocks["tail"]),
        "has_A": "A" in blocks, "has_B": "B" in blocks,
        "has_鉴别指引": bool(blocks["tail"]),
        "has_结构速览": bool(re.search(r"语篇结构|结构速览", blocks["head"]))}

    mat_words = len(re.findall(r"[A-Za-z]+", material))
    expect = range(2, 4) if mat_words < 150 else range(4, 5)
    qn = {}
    for ver in ("A", "B"):
        b = blocks.get(ver, "")
        opts = sorted(set(OPTION_RE.findall(b)))
        answers = len(re.findall(r"答案", b))
        evid = len(re.findall(r"证据|原文|evidence", b))
        n_q = len(re.findall(r"^\s*\d+[.、]", b, re.M))
        qn[ver] = {"questions": n_q, "options": opts, "答案提及": answers, "证据提及": evid,
                   "ok": (n_q in expect and opts == list("ABCD") and answers >= n_q
                          and evid >= 1)}
    res["checks"]["questions"] = {"ok": qn["A"]["ok"] and qn["B"]["ok"],
                                  "A": qn["A"], "B": qn["B"],
                                  "rule": f"每版题量 {list(expect)}、选项 A-D、逐题答案+证据"}

    rows = len(re.findall(r"^\|(?![ :|-])", blocks["tail"], re.M))
    res["checks"]["discriminate_table"] = {"ok": rows >= 4, "rows": rows,
                                           "rule": "鉴别指引对比表 ≥4 行"}

    sa, sb = stems_of(blocks.get("A", "")), stems_of(blocks.get("B", ""))
    pairs = [(a, b, round(difflib.SequenceMatcher(None, a, b).ratio(), 2))
             for a in sa for b in sb]
    dup = sorted((p for p in pairs if p[2] > 0.75), key=lambda p: -p[2])[:5]
    res["checks"]["ab_diversity"] = {"ok": not dup, "max_similar_pairs": dup,
                                     "rule": "A/B 同位题干相似度 ≤0.75（防措辞微调伪双版）"}

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
    work = paths.work_dir() / "rqcheck"
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

    print(f"\n== rq_check {args.round}（{len(results)} 份）==")
    fails = 0
    for r in results:
        bad = [k for k, c in r["checks"].items() if not c.get("ok", True)]
        q = r["checks"].get("questions", {})
        print(f"  [{'OK ' if r['ok'] else 'FAIL'}] {r['stem']:<28} "
              f"题数 A={q.get('A', {}).get('questions')}/B={q.get('B', {}).get('questions')} "
              f"问题={bad or '无'}")
        if not r["ok"]:
            fails += 1
    print(f"通过 {len(results) - fails}/{len(results)}；明细 work/rqcheck/")


if __name__ == "__main__":
    main()
