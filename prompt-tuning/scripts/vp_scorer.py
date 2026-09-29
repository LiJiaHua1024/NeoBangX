# -*- coding: utf-8 -*-
"""试卷可视化全解：窄问题评分器（Jev 系决策模型）。

把"这份全解好不好"拆成 12 个"看一眼就能判定"的二值问题，全部 noul 类型
（respan/span-01-lite 只吃 noul；typesafe/jev 三类都吃），因此两台仪器都能跑、结果可交叉验证。

分两组：
  原题四维（每题一次调用）：key_match / answer_defensible / evidence_enough /
                            pitfall_specific / pitfall_independent / pattern_reusable / reason_matches
  迁移块（每块一次调用）：transfer_homotype / transfer_mechanism / transfer_copy(反向) /
                          transfer_deception / transfer_redline

用法：
  uv run python vp_scorer.py --rounds v0,v1 --config jev_config.json
  uv run python vp_scorer.py --round v0 --config scorer_config.json --files c1_reading_b_q01
结果：work/vp_score[_jev]/<round>/*.json
"""
from __future__ import annotations

import paths
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter

import vp_parse as vp
from scorer import ask, parse_answer, load_config

CORE_CHECKS = {
    "answer_defensible": {
        "type": "noul",
        "instructions": "上面这道题的参考答案是否唯一、站得住（没有第二个同样正确的答案）？",
        "criteria": {"true": "答案唯一无争议", "false": "存在双解或争议"},
    },
    "evidence_enough": {
        "type": "noul",
        "instructions": "本题给出的证据（EVIDENCE + 推理）是否足以直接推出该答案，而不需要读者自己补充原文里没有的信息？",
        "criteria": {"true": "证据充分", "false": "证据不足或需要臆测"},
    },
    "pitfall_specific": {
        "type": "noul",
        "instructions": "易错点的描述是否具体到“学生看到哪个词→产生什么错误联想→在哪一步偏离文本”，而不是‘粗心’‘理解偏差’这类空话？",
        "criteria": {"true": "具体可还原", "false": "空泛"},
    },
    "pitfall_independent": {
        "type": "noul",
        "instructions": "本题给出的两条（或三条）易错点是否相互独立——掌握其中一条不会自动避免另一条？",
        "criteria": {"true": "相互独立", "false": "重复或包含关系"},
    },
    "pattern_reusable": {
        "type": "noul",
        "instructions": "本题归纳的考点范式（PATTERN_NAME + PATTERN_STEPS）能否不加修改地直接套用到本题下面那道迁移题上，并把它做对？",
        "criteria": {"true": "可直接套用", "false": "套不上或需要临时加规则"},
    },
    "reason_matches": {
        "type": "noul",
        "instructions": "本题的推理与干扰项分析，是否与题面及原文事实一致（没有说错原文、没有张冠李戴）？",
        "criteria": {"true": "与事实一致", "false": "存在与原文不符之处"},
    },
}

TRANSFER_SHARED = {
    "transfer_homotype": {
        "type": "noul",
        "instructions": "上面的迁移题与原题是否同型（同为有选项选择题，或同为无选项填空；选项池规模也一致）？",
        "criteria": {"true": "同型", "false": "题型/形式不一致"},
    },
    "transfer_mechanism": {
        "type": "noul",
        "instructions": "把迁移题的伪装拆掉后，它考查的核心机制是否与原题归纳的考点范式是同一个（没有滑向别的知识点）？",
        "criteria": {"true": "同一机制", "false": "考查了别的知识点"},
    },
    "transfer_copy": {
        "type": "noul",
        "instructions": "这道迁移题与原题相比，是否属于换皮或复述（话题、情境、框架句、设问角度、干扰项逻辑基本照搬，只换了几个词）？",
        "criteria": {"true": "是换皮/复述", "false": "是真正的新题"},
    },
    "transfer_redline": {
        "type": "noul",
        "instructions": "这道迁移题的难度是否只来自情境、设问与干扰项伪装（词汇在高中常规范围、句子不过长、背景不陌生），而没有靠生词/超长句/陌生背景制造难度？",
        "criteria": {"true": "符合红线", "false": "靠生词/长句/陌生背景"},
    },
}

TRANSFER_CHOICE = {
    "transfer_deception": {
        "type": "noul",
        "instructions": "这道迁移题的错误选项对半懂的学生是否有真实吸引力（需要动脑才能排除，而不是一眼排除）？",
        "criteria": {"true": "有真实吸引力", "false": "容易排除"},
    },
}

TRANSFER_BLANK = {
    "transfer_blank_unique": {
        "type": "noul",
        "instructions": "这道填空题的标准答案是否唯一（不存在同样可接受的第二种填法或词形）？",
        "criteria": {"true": "答案唯一", "false": "存在双解"},
    },
    "transfer_blank_target": {
        "type": "noul",
        "instructions": "这道填空题是否只考原题那一个考点（没有顺带考别的语法点让人两头为难）？",
        "criteria": {"true": "只考同一考点", "false": "夹带其他考点"},
    },
}

TRANSFER_CHECKS = {**TRANSFER_SHARED, **TRANSFER_CHOICE, **TRANSFER_BLANK}
INVERTED = {"transfer_copy"}
SCHEMA = "s2"   # 检查项口径版本：改过检查项就把它 +1


def core_state(q, passage, material, key_block: str) -> str:
    f = q["fields"]
    get = lambda k: (f.get(k) or [""])[0]  # noqa: E731
    parts = [
        "【原题（试卷中本题）】",
        get("STEM"),
        get("OPTIONS"),
        "",
        "【本题所属语篇】",
        passage or "（无）",
        "",
        "【该题参考答案】",
        get("ANSWER"),
        "",
        "【AI 给出的证据】",
        get("EVIDENCE"),
        "",
        "【AI 给出的推理】",
        get("REASON"),
        "",
        "【AI 给出的干扰项分析】",
        get("DISTRACTOR"),
        "",
        "【AI 给出的易错点】",
        get("PITFALLS"),
        "",
        "【AI 归纳的考点范式】",
        get("PATTERN_NAME"),
        get("PATTERN_STEPS"),
    ]
    if q["transfers"]:
        t = q["transfers"][0]
        parts += ["", "【本题的迁移题（第 1 道，范式是否套得上就看它）】",
                  t.get("TRANSFER_PASSAGE", ""), t.get("TRANSFER_STEM", ""),
                  t.get("TRANSFER_OPTIONS", ""), "迁移题答案：" + (t.get("TRANSFER_ANSWER") or "")]
    if key_block:
        parts += ["", "【试卷材料所附答案】", key_block]
    return "\n".join(parts)


def transfer_state(q, passage, t, bi: int) -> str:
    f = q["fields"]
    return "\n".join([
        "【原题】", (f.get("STEM") or [""])[0], (f.get("OPTIONS") or [""])[0],
        "原题答案：" + (f.get("ANSWER") or [""])[0],
        "",
        "【原题所属语篇】", passage or "（无）",
        "",
        "【原题归纳的考点范式】", (f.get("PATTERN_NAME") or [""])[0],
        (f.get("PATTERN_STEPS") or [""])[0],
        "",
        f"【该题的迁移题（第 {bi} 道）】",
        t.get("TRANSFER_PASSAGE", ""), t.get("TRANSFER_STEM", ""),
        t.get("TRANSFER_OPTIONS", ""), "迁移题答案：" + (t.get("TRANSFER_ANSWER") or ""),
    ])


def find_key(material: str, nums: list[int]) -> str:
    """从材料里摘出涉及本题题号的参考答案行（材料未附答案则返回空）。"""
    i = material.find("参考答案")
    if i < 0:
        return ""
    tail = material[i:]
    lines = [ln.strip() for ln in tail.splitlines()[1:]]
    hits = [ln for ln in lines if any(str(n) in ln for n in nums)]
    return "\n".join(hits)


def score_file(cfg: dict, round_name: str, stem: str, case: dict) -> list[dict]:
    md = (paths.outputs_dir() / round_name / f"{stem}.md").read_text(encoding="utf-8")
    d = vp.parse(md)
    sub = "vp_score_jev" if not cfg["model"].startswith("respan") else "vp_score"
    out_dir = paths.work_dir() / sub / round_name
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    nums = [q["num"] for q in d["questions"] if q["num"] is not None]
    key_block = find_key(case.get("material", ""), nums)

    jobs = []
    for q in d["questions"]:
        if q["num"] is None or q["qtype"] == "writing":
            continue
        jobs.append((q["num"], "core", 0, q, d["passages"].get(q["passage_ref"], ""), None, CORE_CHECKS))
        tchecks = TRANSFER_SHARED | (TRANSFER_CHOICE if q["qtype"] == "choice" else TRANSFER_BLANK)
        for bi, t in enumerate(q["transfers"], 1):
            jobs.append((q["num"], "transfer", bi, q, d["passages"].get(q["passage_ref"], ""), t, tchecks))

    for num, kind, bi, q, passage, t, checks in jobs:
        # 文件名带 SCHEMA：题型分组的检查项变过就换文件名，避免复用旧口径的缓存
        out = out_dir / f"{stem}.q{num:02d}.{kind}{bi or ''}.{SCHEMA}.json"
        if out.exists():
            rows.append(json.loads(out.read_text(encoding="utf-8")))
            continue
        state = (transfer_state(q, passage, t, bi) if kind == "transfer"
                 else core_state(q, passage, case.get("material", ""), key_block))
        try:
            answers = ask(cfg, state, checks)
        except Exception as e:  # noqa: BLE001
            print(f"  {stem} q{num} {kind}{bi or ''}: {e}")
            continue
        rec = {"round": round_name, "file": stem, "num": num, "kind": kind, "block": bi,
               "scores": {k: parse_answer(checks[k]["type"], v or {}) for k, v in answers.items()}}
        out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        rows.append(rec)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", default="")
    ap.add_argument("--round", default="")
    ap.add_argument("--files", default="")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--config", default="jev_config.json")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    rounds = [r.strip() for r in (args.rounds or args.round).split(",") if r.strip()]
    if not rounds:
        raise SystemExit("需要 --round 或 --rounds")
    cfg = load_config(args.config)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    sub = "vp_score_jev" if not cfg["model"].startswith("respan") else "vp_score"
    print(f"评分器：model={cfg['model']} 轮次={rounds}")

    for round_name in rounds:
        d = paths.outputs_dir() / round_name
        if not d.exists():
            print(f"{round_name}: 无输出目录")
            continue
        stems = ([s.strip() for s in args.files.split(",")] if args.files
                 else sorted(f.stem for f in d.glob("*.md")))
        todo = [(round_name, s, cases[s.rsplit("_q", 1)[0]]) for s in stems
                if s.rsplit("_q", 1)[0] in cases and (d / f"{s}.md").exists()]
        print(f"--- {round_name}: {len(todo)} 个文件 ---")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = [pool.submit(score_file, cfg, r, s, c) for r, s, c in todo]
            done = 0
            for fu in as_completed(futs):
                try:
                    fu.result(); done += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  失败: {e}")
            print(f"  {done}/{len(todo)} 个文件完成")

    print("\n== 汇总（noul 均值，越高越好；transfer_copy 越低越好）==")
    for round_name in rounds:
        dd = paths.work_dir() / sub / round_name
        files = sorted(dd.glob(f"*.{SCHEMA}.json"))
        if not files:
            continue
        core: dict[str, list[float]] = {}
        tr: dict[str, list[float]] = {}
        for f in files:
            rec = json.loads(f.read_text(encoding="utf-8"))
            bucket = core if rec["kind"] == "core" else tr
            for k, v in rec["scores"].items():
                if v is not None:
                    bucket.setdefault(k, []).append(v)
        print(f"  {round_name}（{len(files)} 单元）")
        for name, agg in (("原题四维", core), ("迁移块", tr)):
            if not agg:
                continue
            print(f"    {name}: " + "  ".join(
                f"{k}={sum(v)/len(v):.2f}(n={len(v)})" for k, v in sorted(agg.items()) if v))
            fails = {k: sum(1 for v in vs if (v > 0.5 if k in INVERTED else v < 0.5)) / max(len(vs), 1)
                     for k, vs in sorted(agg.items()) if vs}
            print("      问题率: " + "  ".join(f"{k}={fails[k]:.0%}" for k in fails))


if __name__ == "__main__":
    main()
