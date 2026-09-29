# -*- coding: utf-8 -*-
"""汇总出报告用的表：机械检查 + 决策模型评分 + 单维度盲评（含统计量）。

数字一律从 runs/<suite>/work/ 的原始 JSON 现算，不手抄。

用法：uv run python vp_report.py --rounds v0,v1,v2,v2_r2
      uv run python vp_report.py --rounds v0,v1,v2 --pairs v1-vs-v0,v2-vs-v0
输出：work/vp_report.json 与控制台表格
"""
from __future__ import annotations

import paths
import argparse
import glob
import json
import math
from collections import defaultdict

INVERTED = {"transfer_copy"}
MECH_KEYS = ["transfer_pool_mismatch", "transfer_len", "ans_position", "length_cue",
             "shape_cue", "evidence_not_found", "pattern_leak", "answer_wrong",
             "transfer_dup", "stem_not_verbatim", "option_not_verbatim", "total_mismatch",
             "ref_dangling", "transfer_count", "tag_seq", "writing_branch", "code_fence",
             "tag_format", "value_broken", "inline_content", "q_num_bad", "q_num_dup"]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def sign_test(a: int, b: int) -> float:
    n = a + b
    if n == 0:
        return 1.0
    k = min(a, b)
    return min(1.0, sum(math.comb(n, i) for i in range(k + 1)) * 2 / 2 ** n)


def mech(round_name: str) -> dict:
    p = paths.work_dir() / f"vp_check_{round_name}.json"
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    kinds: dict[str, int] = defaultdict(int)
    n_files = len(d)
    n_q = sum(x["n_q"] for x in d.values())
    n_blocks = sum(sum(x["transfer_blocks"]) for x in d.values())
    letters, long_correct, single_letters = [], 0, 0
    for x in d.values():
        for it in x["issues"]:
            kinds[it.split("]")[0].strip("[")] += 1
        letters.extend(x["transfer_ans_letters"])
        if x.get("longest_correct_rate") is not None:
            n_single = len(x["transfer_ans_letters"])
            single_letters += n_single
            long_correct += round(x["longest_correct_rate"] * n_single)
    # 答案字母最大集中度
    top = ""
    if letters:
        from collections import Counter
        c = Counter(letters)
        k, v = c.most_common(1)[0]
        top = f"{k} {v}/{len(letters)}"
    return {"files": n_files, "questions": n_q, "transfer_blocks": n_blocks,
            "issues_total": sum(kinds.values()), "issues": dict(sorted(kinds.items(), key=lambda x: -x[1])),
            "letters": "".join(letters), "letter_top": top,
            "longest_correct_rate": round(long_correct / single_letters, 2) if single_letters else None,
            "longest_n": single_letters}


def scores(round_name: str) -> dict:
    sub = "vp_score_jev"
    files = glob.glob(str(paths.work_dir() / sub / round_name / "*.s2.json"))
    if not files:
        return {}
    core: dict[str, list[float]] = defaultdict(list)
    tr: dict[str, list[float]] = defaultdict(list)
    for f in files:
        rec = json.loads(open(f, encoding="utf-8").read())
        b = core if rec["kind"] == "core" else tr
        for k, v in rec["scores"].items():
            if v is not None:
                b[k].append(v)
    out = {}
    for name, agg in (("core", core), ("transfer", tr)):
        out[name] = {k: {"mean": round(sum(v) / len(v), 3), "n": len(v),
                         "fail": round(sum(1 for x in v if (x > 0.5 if k in INVERTED else x < 0.5)) / len(v), 3)}
                     for k, v in sorted(agg.items()) if v}
    return out


def aspects(tag: str) -> dict:
    d = paths.work_dir() / "abaspect_vp" / tag
    if not d.exists():
        return {}
    res = defaultdict(lambda: {"A": 0, "B": 0, "tie": 0, "noise": 0})
    ra, rb = tag.split("-vs-")
    for f in d.glob("*.json"):
        rec = json.loads(f.read_text(encoding="utf-8"))
        v = rec["verdict"]
        key = rec["aspect"]
        if v == ra:
            res[key]["A"] += 1
        elif v == rb:
            res[key]["B"] += 1
        elif v == "tie":
            res[key]["tie"] += 1
        else:
            res[key]["noise"] += 1
    out = {}
    for k, c in res.items():
        n = c["A"] + c["B"]
        lo, hi = wilson(c["A"], n) if n else (0, 0)
        out[k] = {**c, "pair": tag, "n_decided": n,
                  "win_rate_A": round(c["A"] / n, 3) if n else None,
                  "ci95": [round(lo, 3), round(hi, 3)] if n else None,
                  "p_sign": round(sign_test(c["A"], c["B"]), 4) if n else None}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", required=True)
    ap.add_argument("--pairs", default="")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    rounds = [r.strip() for r in args.rounds.split(",") if r.strip()]
    pairs = [p.strip() for p in args.pairs.split(",") if p.strip()]

    out: dict = {"suite": paths.suite(), "mech": {}, "score": {}, "aspect": {}}
    print("== 机械检查 ==")
    for r in rounds:
        m = mech(r)
        out["mech"][r] = m
        if not m:
            print(f"  {r}: 无数据")
            continue
        print(f"  {r}: {m['files']} 文件 / {m['questions']} 题 / {m['transfer_blocks']} 迁移块 / "
              f"问题 {m['issues_total']} 项 {m['issues']}")
        print(f"       迁移答案字母：{m['letters']}（最集中 {m['letter_top']}）"
              f"  正确项最长率 {m['longest_correct_rate']}（n={m['longest_n']}）")
    print("\n== 决策模型评分（问题率）==")
    for r in rounds:
        s = scores(r)
        out["score"][r] = s
        if not s:
            print(f"  {r}: 无数据")
            continue
        print(f"  {r}")
        for grp, label in (("core", "原题四维"), ("transfer", "迁移块")):
            if grp in s:
                print(f"    {label}: " + "  ".join(
                    f"{k}={v['fail']:.0%}(n={v['n']})" for k, v in s[grp].items()))
    if pairs:
        print("\n== 单维度盲评（只认正反顺序一致的票）==")
        for p in pairs:
            a = aspects(p)
            out["aspect"][p] = a
            if not a:
                print(f"  {p}: 无数据")
                continue
            for k, v in a.items():
                print(f"  {p} {k}: A {v['A']}胜 / B {v['B']}胜 / 平 {v['tie']} / 矛盾 {v['noise']}"
                      f"  → 胜率 {v['win_rate_A']}，CI95 {v['ci95']}，符号检验 p={v['p_sign']}")
    paths.work_dir().mkdir(parents=True, exist_ok=True)
    (paths.work_dir() / "vp_report.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完整汇总：work/vp_report.json")


if __name__ == "__main__":
    main()
