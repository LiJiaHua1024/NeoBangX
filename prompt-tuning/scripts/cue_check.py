"""表面线索检测：正确项是否靠"绝对化词/长度"这类非语义线索可被识别。"""
from __future__ import annotations
import paths
import argparse, re
from pathlib import Path
from hack_check import options_of, key_letter
from qparse import item_num, section_text, split_items

ABS = re.compile(r"\b(all|never|only|must|always|every|no|none|fully|completely|entirely|"
                 r"abandon\w*|force\w*|superior|mainly|plans?|intends?|future|from now on)\b", re.I)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    tot_abs_c = tot_abs_w = 0
    longest_correct = 0
    total_q = 0
    for f in sorted((paths.outputs_dir() / args.round).glob("*.md")):
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
            letters = "ABCDEFG"[:len(opts)]
            total_q += 1
            lens = [len(t) for t in opts]
            if lens[letters.index(k)] == max(lens) and lens.count(max(lens)) == 1:
                longest_correct += 1
            for L, t in zip(letters, opts):
                if ABS.search(t):
                    if L == k:
                        tot_abs_c += 1
                    else:
                        tot_abs_w += 1
    print(f"{args.round}: 有选项的题 {total_q}")
    print(f"  绝对化/极端词选项：正确 {tot_abs_c} / 干扰 {tot_abs_w}"
          + ("  ← 越接近 0 正确越可被'见绝对化词就排除'利用" if tot_abs_c <= 1 else "  ← 双向出现，线索失效"))
    print(f"  正确项为唯一最长项：{longest_correct}/{total_q}")


if __name__ == "__main__":
    main()
