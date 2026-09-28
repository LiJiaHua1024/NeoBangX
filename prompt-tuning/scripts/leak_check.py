"""方法论-题干泄漏查重：方法论中的 3-gram（跨词）与各迁移题题干/选项的 3-gram 重合度。

用法：uv run python leak_check.py --round v8
"""
from __future__ import annotations

import paths
import argparse
import json
import re
from pathlib import Path

from qparse import section_text, split_items

HERE = Path(__file__).parent

def norm_words(text: str) -> list[str]:
    text = re.sub(r"\*\*|__|`|[#*>\|]", " ", text)
    text = re.sub(r"^\s*\d+[.、．]", " ", text, flags=re.M)
    return re.findall(r"[a-z']+", text.lower())

def ngrams(words: list[str], n: int = 3) -> set[tuple[str, ...]]:
    if len(words) < n:
        return set()
    return {tuple(words[i:i+n]) for i in range(len(words) - n + 1)}

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--n", type=int, default=3)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    files = sorted((paths.outputs_dir() / args.round).glob("*.md"))
    print(f"{'文件':<34}{'方法论gram':>8}{'题面gram':>8}{'泄漏':>6}{'泄漏举例'}")
    total_leak = 0
    for f in files:
        md = f.read_text(encoding="utf-8")
        case_id = f.stem.rsplit("_q", 1)[0]
        if case_id not in cases:
            continue
        orig_g = ngrams(norm_words(cases[case_id]["question"]), args.n)
        m_sec = section_text(md, "## 二、方法论")
        q_sec = section_text(md, "## 三、迁移题")
        # 题面：题干+选项（不含选项字母行也行，一并算）
        m_g = ngrams(norm_words(m_sec), args.n)
        q_g = ngrams(norm_words(q_sec), args.n)
        leak = (m_g & q_g) - orig_g  # 豁免原题自带的表述（方法论必须讲原题）
        total_leak += len(leak)
        sample = sorted(leak)[:3]
        sample_s = "; ".join(" ".join(x) for x in sample) if leak else "-"
        print(f"{f.stem:<34}{len(m_g):>8}{len(q_g):>8}{len(leak):>6}{sample_s[:60]}")
    print(f"\n总泄漏 gram 数：{total_leak}")

if __name__ == "__main__":
    main()
