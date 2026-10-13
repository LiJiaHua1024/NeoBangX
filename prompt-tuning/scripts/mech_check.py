"""机械检查（秒级、免费）：阅读文本改编 / 阅读理解设问 两 suite 通用。

用法：
  uv run python mech_check.py --round v0 --suite 阅读理解设问
  uv run python mech_check.py --round v0            # suite 唯一时自动识别
输出：work/mech/<round>/<stem>.json + 汇总表
"""
from __future__ import annotations

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import paths
import argparse
import difflib
import json
import re
from pathlib import Path

STOP = set("the a an and or of to in on for with is are was were be been it its this that these those "
           "as at by from not no but they he she we you i his her their our your which who whom whose "
           "what when where why how than then there here if because while so more most very can will "
           "would should could may might must do does did done have has had".split())

RA_BLOCKS = ["改编后文本", "改编与词汇改造说明", "命题建议"]


def english_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)


def content_word_repeat(text: str) -> tuple[str, int]:
    ws = [w.lower() for w in english_words(text) if w.lower() not in STOP and len(w) > 3]
    if not ws:
        return "", 0
    from collections import Counter
    return Counter(ws).most_common(1)[0]


def section(md: str, *names: str) -> str:
    """取标题（行首 #，名字为子串）到下一个同级/更高级标题之间的文本。"""
    lines = md.splitlines()
    start, level = None, 2
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith("#") and any(n in l for n in names):
            start, level = i, len(s) - len(s.lstrip("#"))
            break
    if start is None:
        for i, l in enumerate(lines):
            s = l.strip()
            if s.startswith("**") and s.endswith("**") and any(n in l for n in names):
                start, level = i, 99
                break
    if start is None:
        return ""
    j = len(lines)
    for k in range(start + 1, len(lines)):
        s = lines[k].strip()
        if s.startswith("#"):
            if len(s) - len(s.lstrip("#")) <= level:
                j = k
                break
        elif level >= 99 and s.startswith("**") and s.endswith("**"):
            j = k
            break
    return "\n".join(lines[start + 1:j])


def section_until(md: str, start: str, *ends: str) -> str:
    """从含 start 的标题切到含任一 ends 的标题（忽略层级，兜底用）。"""
    lines = md.splitlines()
    i0 = None
    for i, l in enumerate(lines):
        if l.strip().startswith("#") and start in l:
            i0 = i
            break
    if i0 is None:
        return ""
    for k in range(i0 + 1, len(lines)):
        if lines[k].strip().startswith("#") and any(e in lines[k] for e in ends):
            return "\n".join(lines[i0 + 1:k])
    return "\n".join(lines[i0 + 1:])


def check_ra(md: str, case_id: str) -> dict:
    r: dict = {"suite": "阅读文本改编", "issues": [], "warns": []}
    for b in RA_BLOCKS:
        if b not in md:
            (r["issues"] if b != "命题建议" else r["warns"]).append(f"缺输出块:{b}")
    body = section(md, "改编后文本")
    if len(english_words(body)) < 50:  # 输出把文章标题写成 H1 会截断，按名称兜底
        body = section_until(md, "改编后文本", "改编与词汇改造说明", "命题建议")
    if not body:
        r["issues"].append("取不到改编后文本正文")
        return r
    n = len(english_words(body))
    r["word_count"] = n
    if "short" in case_id:  # 例外分支：不强行扩写
        if n > 340:
            r["warns"].append(f"短素材扩写过多:{n}词")
    else:
        if not (300 <= n <= 340):
            (r["issues"] if (n < 280 or n > 360) else r["warns"]).append(f"词数越界:{n}")
    bad1 = re.findall(r"[A-Za-z]\([^)]*[一-鿿][^)]*\)", body)
    bad2 = re.findall(r"[A-Za-z][ ]?[（][^）]*[一-鿿][^）]*[）]", body)
    if bad1 or bad2:
        r["issues"].append(f"注释格式:{(bad1 + bad2)[:3]}")
    tbl = [l for l in md.splitlines() if l.strip().startswith("|")]
    r["table_rows"] = max(0, len(tbl) - 2)
    if "改造清单" in md and len(tbl) < 4:
        r["warns"].append("改造清单表格过小")
    w, cnt = content_word_repeat(body)
    r["repeat"] = [w, cnt]
    if cnt >= 5:
        r["warns"].append(f"高频重复词:{w}×{cnt}")
    paras = [p for p in body.split("\n\n") if p.strip()]
    if len(paras) < 3:
        r["warns"].append(f"段落数偏少:{len(paras)}")
    return r

def version_body(md: str, tag: str) -> str:
    """取「版本 X」标题到「另一版本/鉴别指引」之间的全部文本（容忍内部任意子标题）。"""
    lines = md.splitlines()
    idx = {}
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith("#"):
            if "版本 A" in l:
                idx.setdefault("A", i)
            elif "版本 B" in l:
                idx.setdefault("B", i)
            elif "鉴别指引" in l:
                idx.setdefault("END", i)
    if tag not in idx:
        return ""
    marks = sorted([v for k, v in idx.items() if v > idx[tag]])
    j = marks[0] if marks else len(lines)
    return "\n".join(lines[idx[tag] + 1:j])


def q_stem_opts(block: str) -> list[dict]:
    """切成 [{num, stem, opts, answer}]；兼容 ###/** 题号、A1/B1 式题号、- A. 式选项、独立答案块。"""
    qs, cur = [], None
    for raw0 in block.splitlines():
        for raw in re.split(r"(?<=[a-z,;:!?)\"”])(?=[A-D][\.、．。])", raw0):
            l = raw.lstrip("# *- ").strip()
            m_ans = re.match(r"(\d+)[\.、]\s*答案[:：]?\s*([A-D])", l)
            if m_ans:  # 独立答案块（如「1. 答案 B（…）」）不算新题
                for q in qs:
                    if q["num"] == int(m_ans.group(1)) and not q["answer"]:
                        q["answer"] = m_ans.group(2)
                if cur is not None:
                    cur["stem"] += " " + l
                continue
            m = re.match(r"(\d+)[\.、]\s*(.+)", l)
            m_id = re.match(r"^([AB])(\d+)$", l)
            om = re.match(r"\*{0,2}([A-D])\*{0,2}[\.、．。):：]\s*(.+)", l)
            if (m and not om) or m_id:
                num = int(m.group(1)) if (m and not om) else int(m_id.group(2))
                cur = {"num": num, "stem": m.group(2) if (m and not om) else "", "opts": {}, "answer": ""}
                qs.append(cur)
            elif om and cur is not None:
                cur["opts"][om.group(1)] = om.group(2)
            elif cur is not None:
                am = re.search(r"答案[:：]?\s*([A-D])", l)
                if am and not cur["answer"]:
                    cur["answer"] = am.group(1)
                cur["stem"] += " " + l.strip()
    return [q for q in qs if q["opts"]]


def check_rq(md: str, case_id: str) -> dict:
    r: dict = {"suite": "阅读理解设问", "issues": [], "warns": []}
    va, vb = version_body(md, "A"), version_body(md, "B")
    if not va:
        r["issues"].append("缺版本A")
    if not vb:
        r["issues"].append("缺版本B")
    if "语篇结构速览" not in md:
        r["warns"].append("缺语篇结构速览")
    if "鉴别指引" not in md:
        r["issues"].append("缺鉴别指引")
    else:
        rows = [l for l in section(md, "鉴别指引").splitlines() if l.strip().startswith("|")]
        if len(rows) < 5:
            r["warns"].append(f"鉴别指引行数少:{len(rows) - 2}")
    short = "short" in case_id
    vers = {}
    for tag, body in (("A", va), ("B", vb)):
        qs = q_stem_opts(body)
        vers[tag] = qs
        want = (1, 3) if short else (4, 4)
        if not (want[0] <= len(qs) <= want[1]):
            (r["warns"] if short else r["issues"]).append(f"版本{tag}题数:{len(qs)}")
        for q in qs:
            if len(q["opts"]) != 4:
                r["issues"].append(f"版本{tag}第{q['num']}题选项数:{len(q['opts'])}")
            if not q["answer"]:
                r["warns"].append(f"版本{tag}第{q['num']}题缺显式答案")
        for q in qs:
            if q["answer"] in q["opts"] and len(q["opts"]) == 4:
                lens = {k: len(v) for k, v in q["opts"].items()}
                others = [v for k, v in lens.items() if k != q["answer"]]
                if others and lens[q["answer"]] > 1.4 * (sum(others) / len(others)):
                    r["warns"].append(f"版本{tag}第{q['num']}题正确项长度露底")
    r["ab_sim"] = []
    if vers["A"] and vers["B"]:
        for qa in vers["A"]:
            for qb in vers["B"]:
                ratio = difflib.SequenceMatcher(None, qa["stem"].lower(), qb["stem"].lower()).ratio()
                if ratio > 0.72:
                    r["ab_sim"].append([qa["num"], qb["num"], round(ratio, 2)])
        if r["ab_sim"]:
            r["issues"].append(f"A/B题干高度相似:{r['ab_sim']}")
    return r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    out_dir = paths.work_dir() / "mech" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted((paths.outputs_dir() / args.round).glob("*.md"))
    if not files:
        raise SystemExit(f"{args.round} 下没有输出")
    is_ra = paths.suite() == "阅读文本改编"
    print(f"== 机械检查 {paths.suite()} / {args.round}（{len(files)} 份）==")
    ok = 0
    for f in files:
        md = f.read_text(encoding="utf-8")
        case_id = f.stem.split("_q")[0]
        r = check_ra(md, case_id) if is_ra else check_rq(md, case_id)
        (out_dir / f"{f.stem}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        flag = "✅" if not r["issues"] else "❌"
        ok += 0 if r["issues"] else 1
        extra = f" 词数{r['word_count']}" if "word_count" in r else f" 相似{r.get('ab_sim')}"
        print(f" {flag} {f.stem}{extra}")
        for it in r["issues"]:
            print(f"     [问题] {it}")
        for w in r["warns"]:
            print(f"     [警告] {w}")
    print(f"\n结构完整率：{ok}/{len(files)}")


if __name__ == "__main__":
    main()