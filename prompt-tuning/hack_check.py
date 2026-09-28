"""邪修捷径检测：学生不懂考点、只靠规律就能利用的模式。

三类可机械量化的作弊模式：
1. 选项词角色固化：某词在题组内出现 >=N 次且"从未当正确项"（见它就排除）或"总当正确项"（见它就选）
2. 选项组复用：任意两题的选项词集合 Jaccard >= 0.75（同一套选项换语境反复用）
3. 题干模板复用：任意两题题干共享 >=60 字符的长公共片段（同一句式骨架换名词）

用法：uv run python hack_check.py --round v11
"""
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

from check import longest_common_substr, normalize
from qparse import item_num, section_text, split_items

HERE = Path(__file__).parent

OPT_RE = re.compile(r"(?:^|[ \t　])([A-G])[ \t　]*[.、．][ \t　]*([^\n]+)", re.M)
LINE_OPT_RE = re.compile(r"^\s*(?:[A-G]|[a-g])\s*[.、．]")
WORD_RE = re.compile(r"[a-z]+")


def options_of(block: str) -> list[str]:
    """抽取一块内的选项文本（兼容行内 a. x b. y 与分行 A. x）。"""
    parts = []
    for m in OPT_RE.finditer(block):
        text = m.group(2).strip()
        text = re.split(r"(?:^|[ \t　])[A-G][ \t　]*[.、．]", text)[0].strip()
        if text:
            parts.append(text)
    return parts


KEY_PATTERNS = [
    re.compile(r"答案[:：]?[ \t　]*\**([A-G])\b"),                       # 答案：B / 答案 B
    re.compile(r"^\s*\**\s*\d{1,2}[.、．][ \t　]*\**([A-G])\b", re.M),   # 1. B（word）
]


def key_letter(block: str) -> str | None:
    for pat in KEY_PATTERNS:
        m = pat.search(block)
        if m:
            return m.group(1)
    return None


def analyze(path: Path, min_occ: int) -> dict | None:
    md = path.read_text(encoding="utf-8")
    q_blocks = split_items(section_text(md, "## 三、迁移题"))
    a_blocks = split_items(section_text(md, "## 四、答案 + 解析"))
    keys = {}
    for ab in a_blocks:
        num = item_num(ab.splitlines()[0])
        k = key_letter(ab)
        if num is not None and k:
            keys[num] = k
    q_opts = []
    stems = []
    for qb in q_blocks:
        num = item_num(qb.splitlines()[0])
        if num is None:
            continue
        body = "\n".join(ln for ln in qb.splitlines()
                         if not OPT_RE.match(ln) and not LINE_OPT_RE.match(ln))
        stems.append((num, normalize(body)))
        opts = options_of(qb)
        if len(opts) < 3:
            continue
        letters = "ABCDEFG"[:len(opts)]
        q_opts.append((num, dict(zip(letters, opts)), keys.get(num)))

    # 1. 词角色固化（只统计单词选项）
    role = defaultdict(lambda: {"correct": 0, "wrong": 0})
    for num, opts, correct in q_opts:
        for letter, text in opts.items():
            words = set(WORD_RE.findall(text.lower()))
            if len(words) != 1:
                continue
            w = words.pop()[:5]   # 粗暴词干归并：practice/practiced/practicing -> pract
            if not correct:
                continue
            if letter == correct:
                role[w]["correct"] += 1
            else:
                role[w]["wrong"] += 1
    hacks = {w: dict(c) for w, c in role.items()
             if (c["correct"] + c["wrong"]) >= min_occ
             and (c["correct"] == 0 or c["wrong"] == 0)}

    # 2. 选项组复用
    reuse = []
    for i in range(len(q_opts)):
        for j in range(i + 1, len(q_opts)):
            si = {normalize(t) for t in q_opts[i][1].values()}
            sj = {normalize(t) for t in q_opts[j][1].values()}
            if not si or not sj:
                continue
            jac = len(si & sj) / len(si | sj)
            if jac >= 0.75:
                reuse.append((q_opts[i][0], q_opts[j][0], round(jac, 2)))

    # 3. 题干模板复用
    tmpl = []
    for i in range(len(stems)):
        for j in range(i + 1, len(stems)):
            lcs = longest_common_substr(stems[i][1], stems[j][1])
            if lcs >= 60:
                tmpl.append((stems[i][0], stems[j][0], lcs))

    return {"file": path.name, "questions": len(q_opts), "hacks": hacks, "reuse": reuse, "tmpl": tmpl}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--min-occ", type=int, default=3)
    args = ap.parse_args()
    files = sorted((HERE / "outputs" / args.round).glob("*.md"))
    flagged = 0
    total = 0
    for f in files:
        r = analyze(f, args.min_occ)
        if not r or r["questions"] < 2:
            continue
        total += 1
        if r["hacks"] or r["reuse"] or r["tmpl"]:
            flagged += 1
            print(f"\n{r['file']}（{r['questions']} 题）")
            if r["hacks"]:
                print("  [角色固化]", "; ".join(
                    f"{w}: 正确{c['correct']}/错误{c['wrong']}" for w, c in sorted(r["hacks"].items())))
            if r["reuse"]:
                print("  [选项组复用]", r["reuse"][:6])
            if r["tmpl"]:
                print("  [题干模板]", r["tmpl"][:6])
    print(f"\n== {args.round}: {flagged}/{total} 个文件存在可疑捷径模式 ==")


if __name__ == "__main__":
    main()
