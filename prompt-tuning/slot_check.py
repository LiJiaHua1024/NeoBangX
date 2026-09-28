"""槽位角色检测：每个选项槽位（A/B/C/D）是否固定承担某类角色。

角色分类（按选项文本特征，粗略但可回归）：
  正确项 / 绝对化断言 / 未来计划 / 复述旧立场 / 其他干扰
输出：每个槽位的角色分布 + "固定分工"告警（某槽位某类占比 >=60% 且 n>=5）。
"""
from __future__ import annotations
import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path

from hack_check import options_of, key_letter
from qparse import item_num, section_text, split_items

TYPES = [
    ("absolute", re.compile(r"\b(all|never|only|must|always|every|no|none|fully|completely|entirely|abandon\w*|nothing)\b", re.I)),
    ("future", re.compile(r"\b(plans?|intends?|will|future|from now on|soon)\b", re.I)),
    ("oldstance", re.compile(r"\b(still|continues? to|refuses?|remains?|keeps?)\b", re.I)),
]


def classify(text: str) -> str:
    for name, pat in TYPES:
        if pat.search(text):
            return name
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    args = ap.parse_args()
    slot_role = defaultdict(Counter)
    total = 0
    for f in sorted((Path(__file__).parent / "outputs" / args.round).glob("*.md")):
        md = f.read_text(encoding="utf-8")
        q_blocks = split_items(section_text(md, "## 三、迁移题"))
        keys = {}
        for ab in split_items(section_text(md, "## 四、答案 + 解析")):
            n = item_num(ab.splitlines()[0]); k = key_letter(ab)
            if n is not None and k:
                keys[n] = k
        for qb in q_blocks:
            num = item_num(qb.splitlines()[0])
            opts = options_of(qb)
            k = keys.get(num)
            if num is None or len(opts) < 3 or not k:
                continue
            total += 1
            for L, t in zip("ABCDEFG", opts):
                if L == k:
                    slot_role[L]["CORRECT"] += 1
                else:
                    slot_role[L][classify(t)] += 1
    print(f"== {args.round}: {total} 题（含答案）的槽位角色分布 ==")
    for L in "ABCD":
        c = slot_role.get(L)
        if not c:
            continue
        n = sum(c.values())
        print(f"  {L} (n={n}): " + ", ".join(f"{k} {v}({v*100//n}%)" for k, v in c.most_common()))
    # 固定分工告警
    warn = []
    for L in "ABCD":
        c = slot_role.get(L)
        if not c:
            continue
        n = sum(c.values())
        if n >= 5:
            top, cnt = c.most_common(1)[0]
            if cnt * 100 // n >= 60:
                warn.append(f"{L} 位 {cnt*100//n}% 都是 {top}")
    print("  [固定分工告警]", "; ".join(warn) if warn else "无")


if __name__ == "__main__":
    main()
