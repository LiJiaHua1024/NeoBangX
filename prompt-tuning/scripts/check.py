"""程序化检查生成结果的结构与"同义转述"信号。

检查项：
1. 四个固定标题是否齐全、顺序正确
2. 题目数量是否等于要求档位（按「三、迁移题」中的题号计数）
3. 答案数量是否等于题数（按「四、答案 + 解析」逐题计数）
4. 语境重复信号：题干与原题干之间的长公共片段（疑似换皮/复用原题语境）
5. 题与题之间区分度信号：两两题干的最长公共子串长度

用法：
  uv run python check.py --round v0
"""
from __future__ import annotations

import paths
import argparse
import json
import re
import unicodedata
from pathlib import Path

from qparse import HEADINGS, is_multi_blank, question_numbers, section_text, split_questions

HERE = Path(__file__).parent


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def longest_common_substr(a: str, b: str) -> int:
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    best = 0
    for ca in a:
        cur = [0] * (len(b) + 1)
        for j, cb in enumerate(b, 1):
            if ca == cb:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


QUESTION_LINE = re.compile(
    r"^\s*\**\s*(question\s*[:：]?|what|which|why|how|who|whom|whose|where|when|according to|"
    r"it can be inferred|the writer|the author|choose|complete|fill|decide|判断|选出|填入|"
    r"读下面|阅读下面|从每题|请从)", re.I)
QUESTION_TAIL = re.compile(r"(most probably mean|best fits the blank|best completes|best fills)")


def passage_of(block: str) -> str:
    """去掉选项行与设问行，只留语篇/句子本体——换皮检测看这里。"""
    lines = []
    for ln in block.splitlines():
        if re.match(r"^\s*[A-G]\s*[.、．]", ln):
            continue
        if (QUESTION_LINE.match(ln) or QUESTION_TAIL.search(ln)) and len(ln) < 150:
            continue
        lines.append(ln)
    return normalize("\n".join(lines))


def check_file(md: str, wanted: int, original_question: str) -> dict:
    r: dict = {}
    pos = [md.find("## " + h) for h in HEADINGS]
    r["headings_ok"] = all(p >= 0 for p in pos) and pos == sorted(pos)
    if not r["headings_ok"]:
        return r

    q_sec = section_text(md, "## 三、迁移题")
    a_sec = section_text(md, "## 四、答案 + 解析")
    qs = split_questions(q_sec)
    ans = split_questions(a_sec)
    nums = question_numbers(q_sec)
    r["multi_blank"] = is_multi_blank(q_sec)
    r["q_count"] = len(qs) if not r["multi_blank"] else len(nums)
    r["ans_count"] = len(ans)
    r["count_ok"] = r["q_count"] == wanted
    r["answers_ok"] = (len(ans) == len(nums) and [a["num"] for a in ans] == nums) if r["multi_blank"] \
        else (len(ans) == wanted and [a["num"] for a in ans] == [q["num"] for q in qs])

    r["question_numbers"] = nums
    r["numbers_ok"] = nums == list(range(1, len(nums) + 1))

    # 选项数量检查（统计块内出现过的选项字母；兼容行内多选项格式与共享选项池）
    bad_options = []
    if r["multi_blank"]:
        letters = set(re.findall(r"(?:^|[\s　])([A-G])\s*[.、．]", q_sec))
        if letters and len(letters) < 4:
            bad_options = [0]
    else:
        for q in qs:
            letters = set(re.findall(r"(?:^|[\s　])([A-G])\s*[.、．]", q["block"]))
            if letters and len(letters) not in (4, 7):
                bad_options.append(q["num"])
    r["bad_option_questions"] = bad_options

    # 语境重复：每道题语篇本体与原题语篇本体的最长公共子串
    orig = passage_of(original_question)
    overlaps = []
    for q in qs:
        lcs = longest_common_substr(orig, passage_of(q["block"]))
        overlaps.append({"num": q["num"], "lcs_with_original": lcs})
    r["overlap_with_original"] = overlaps
    r["max_lcs_with_original"] = max((o["lcs_with_original"] for o in overlaps), default=0)

    # 题与题之间的区分度（多空语篇共享一个语篇，不做题间比较）
    if r["multi_blank"]:
        r["pair_lcs"] = []
    else:
        stems = [passage_of(q["block"]) for q in qs]
        nums2 = [q["num"] for q in qs]
        pair_lcs = []
        for i in range(len(stems)):
            for j in range(i + 1, len(stems)):
                lcs = longest_common_substr(stems[i], stems[j])
                pair_lcs.append({"pair": f"{nums2[i]}-{nums2[j]}", "lcs": lcs})
        r["pair_lcs"] = sorted(pair_lcs, key=lambda x: -x["lcs"])[:8]
    return r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    out_dir = paths.outputs_dir() / args.round
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    report = {}
    for md_file in sorted(out_dir.glob("*.md")):
        case_id = md_file.stem.rsplit("_q", 1)[0]
        wanted = int(md_file.stem.rsplit("_q", 1)[1])
        if case_id not in cases:
            continue
        md = md_file.read_text(encoding="utf-8")
        report[md_file.stem] = check_file(md, wanted, cases[case_id]["question"])
    (paths.work_dir()).mkdir(exist_ok=True)
    (paths.work_dir() / f"check_{args.round}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'文件':<32}{'标题':<4}{'题数':<10}{'答案':<6}{'题号':<6}{'选项':<6}{'原题重叠':<10}{'题间最大':<8}")
    for k, r in report.items():
        print(f"{k:<32}{'OK' if r.get('headings_ok') else 'BAD':<4}"
              f"{r.get('q_count', '?'):<10}"
              f"{'OK' if r.get('answers_ok') else 'BAD':<6}"
              f"{'OK' if r.get('numbers_ok') else str(r.get('question_numbers')):<6}"
              f"{'OK' if not r.get('bad_option_questions') else str(r['bad_option_questions']):<6}"
              f"{r.get('max_lcs_with_original', '?'):<10}"
              f"{(r.get('pair_lcs') or [{'lcs': '-'}])[0]['lcs']:<8}")
    print(f"\n完整报告：work/check_{args.round}.json")


if __name__ == "__main__":
    main()
