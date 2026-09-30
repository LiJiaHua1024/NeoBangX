"""Goodhart 补偿检测：错因保真（问题A）+ 硬否定/剧情模板（问题B）。

背景（2026-09-29 用户实测反馈，两个 Jev 类判定之外仍需我方仪器复核）：
  A. 迁移题开始与原错因脱钩——"已经变成了其他的题"，不再是迁移；
  B. 模型在严苛负向规则下代偿（古德哈特定律）：为让答案"绝对无争议"，
     在语篇里写显性硬否定句（stayed low / failed to / never / only after）
     替学生排除干扰项；剧情套固定公式（旧表态→转变→数据暴涨→本人解释）。

跑在已有输出上（不重新生成），结果存 work/goodhart/<tag>/<round>/。
机械部分对题面做硬否定句与"数据暴涨"模板的标记词密度统计，跨轮对比。

用法：
  uv run python goodhart_check.py --rounds v0,v11,v17
  uv run python goodhart_check.py --rounds v17 --files c1_reading_inference_q03
"""
from __future__ import annotations

import paths
import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import scorer

CHECKS = {
    "cause_same": {
        "type": "noul",
        "instructions": "忽略表面话题的差异：这道迁移题拆掉伪装后考查的核心能力，是否与原题错因分析中\"学生该做而没做的那一步\"是同一个？（如果它实际上在考另一类知识或另一种能力，选 false）",
        "criteria": {"true": "同一错因", "false": "已经变成另一类题"},
    },
    "trap_live": {
        "type": "noul",
        "instructions": "一个带着原错因所述旧习惯的学生（不掌握错因分析里缺失的那一步）来做这道迁移题，会做错吗？（旧习惯在这道题里是否仍有真实吸引力）",
        "criteria": {"true": "会做错（陷阱活着）", "false": "旧习惯帮不上忙也害不了他"},
    },
    "hard_negation": {
        "type": "noul",
        "instructions": "题面里是否有一句显性的\"硬否定\"或降格陈述——直接写明某做法无效、某数据下降、某事从未/不再发生、\"记录只写事实不写感受\"这类替读者关掉某种解读的句子——其作用是替学生排除某个干扰项？（正常的转折叙事不算；关键是\"为答案服务、替读者排除解读\"）",
        "criteria": {"true": "存在这种句子", "false": "没有"},
    },
    "template_plot": {
        "type": "noul",
        "instructions": "这道题的语篇情节是否套用一个可见的固定公式（例如：旧表态或常规做法→出现转变→数据翻倍/明显变化→本人解释），像按配方写的而不是自然叙事？（与原题剧情同构也算）",
        "criteria": {"true": "是模板化剧情", "false": "情节自然"},
    },
    "answer_serving": {
        "type": "noul",
        "instructions": "这个语篇是否像\"为了证明正确答案而写\"——几乎所有细节都在把答案钉死，读起来说教或不自然，缺少与考点无关的真实感细节？",
        "criteria": {"true": "是证明型语篇", "false": "是自然语篇"},
    },
}

# 反向指标：均值越低越好（true=有问题）
INVERTED = {"hard_negation", "template_plot", "answer_serving"}

# 机械标记词（相对比较用，非绝对判定）
NEG_MARKS = [
    r"\bnever\b", r"\bno longer\b", r"\bfail(ed|s|ing)? to\b",
    r"\bstay(ed|s)? (low|flat|silent|closed|empty|small|unchanged)\b",
    r"\bremain(ed|s)? (low|closed|empty|unsold|unused|unopened|untouched)\b",
    r"\bonly after\b", r"\bnot until\b", r"\brefus(ed|es|ing) to\b",
    r"\bdoes not (describe|mention|say|record|explain|show)\b",
    r"\bit does not\b", r"\bthere (is|was) no (record|evidence|sign|indication)\b",
    r"\bwithout (any|ever)\b",
]
DATA_MARKS = [
    r"\btwice (as|the)\b", r"\bmore than twice\b", r"\bdouble(d)?\b", r"\btripled?\b",
    r"\b(two|three|four|ten) times (as|more)\b",
    r"\b(fell|dropped|declined) by \w+ percent\b",
    r"\b(rose|grew|increased|climbed|jumped|surged) (by|to)\b",
    r"\b\w+ percent\b",
]
NEG_RE = re.compile("|".join(NEG_MARKS))
DATA_RE = re.compile("|".join(DATA_MARKS))


def goodhart_file(cfg: dict, round_name: str, stem: str, case: dict) -> list[dict]:
    md = (paths.outputs_dir() / round_name / f"{stem}.md").read_text(encoding="utf-8")
    tag = "respan" if cfg["model"].startswith("respan") else "jev"
    out_dir = paths.work_dir() / "goodhart" / tag / round_name
    out_dir.mkdir(parents=True, exist_ok=True)
    state_head = (f"【原题】\n{case['question']}\n\n"
                  f"【已确认的本质错因】\n{case['cause']}\n")
    rows = []
    for num, q_block, a_block in scorer.question_units(md):
        out = out_dir / f"{stem}.q{num:02d}.json"
        if out.exists():
            rows.append(json.loads(out.read_text(encoding="utf-8")))
            continue
        state = (f"{state_head}\n【迁移题（第 {num} 题）】\n{q_block}\n\n"
                 f"【该题答案与解析】\n{a_block}")
        try:
            answers = scorer.ask(cfg, state, CHECKS)
        except Exception as e:  # noqa: BLE001
            print(f"  {stem} q{num}: {e}")
            continue
        rec = {"round": round_name, "file": stem, "num": num,
               "scores": {k: scorer.parse_answer(v["type"], answers.get(k) or {})
                          for k, v in CHECKS.items()}}
        out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        rows.append(rec)
    return rows


def mechanical(rounds: list[str]) -> None:
    print("\n== 机械标记（题面部分，每千词命中数）==")
    for round_name in rounds:
        d = paths.outputs_dir() / round_name
        if not d.exists():
            continue
        neg = data = 0
        words = 0
        n = 0
        for f in sorted(d.glob("*.md")):
            md = f.read_text(encoding="utf-8")
            sec = md.split("## 三、迁移题")[-1].split("## 四、")[0] if "## 三、迁移题" in md else md
            low = sec.lower()
            w = len(re.findall(r"[a-z]+", low))
            if not w:
                continue
            neg += len(NEG_RE.findall(low))
            data += len(DATA_RE.findall(low))
            words += w
            n += 1
        if words:
            print(f"  {round_name}（{n} 文件 / {words} 词）: "
                  f"硬否定={neg / words * 1000:.1f}/千词  数据模板={data / words * 1000:.1f}/千词")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", default="v17")
    ap.add_argument("--files", default="", help="逗号分隔文件名（不带 .md），默认全量")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--config", default="")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    rounds = [r.strip() for r in args.rounds.split(",") if r.strip()]
    cfg = scorer.load_config(args.config)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    print(f"Goodhart 检测：model={cfg['model']} 轮次={rounds}")

    for round_name in rounds:
        d = paths.outputs_dir() / round_name
        if not d.exists():
            print(f"{round_name}: 无输出目录")
            continue
        stems = ([s.strip() for s in args.files.split(",")] if args.files
                 else sorted(f.stem for f in d.glob("*.md")))
        jobs = []
        for stem in stems:
            case_id = stem.rsplit("_q", 1)[0]
            if case_id in cases and (d / f"{stem}.md").exists():
                jobs.append((cfg, round_name, stem, cases[case_id]))
        print(f"--- {round_name}: {len(jobs)} 个文件 ---")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(goodhart_file, *job) for job in jobs]
            done = 0
            for fut in as_completed(futures):
                try:
                    fut.result()
                    done += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  失败: {e}")
            print(f"  {done}/{len(jobs)} 个文件完成")

    print("\n== 汇总（noul 均值；cause 同向越高越好，后三项反向越低越好）==")
    tag = "respan" if cfg["model"].startswith("respan") else "jev"
    for round_name in rounds:
        dd = paths.work_dir() / "goodhart" / tag / round_name
        files = sorted(dd.glob("*.json"))
        if not files:
            continue
        agg: dict[str, list[float]] = {k: [] for k in CHECKS}
        for f in files:
            rec = json.loads(f.read_text(encoding="utf-8"))
            for k, v in rec["scores"].items():
                if v is not None:
                    agg[k].append(v)
        print(f"  {round_name}（{len(files)} 题）")
        for k, vs in agg.items():
            if not vs:
                continue
            bad = sum(1 for v in vs if (v > 0.5 if k in INVERTED else v < 0.5)) / len(vs)
            print(f"    {k}: mean={sum(vs) / len(vs):.2f} 问题率={bad:.0%} n={len(vs)}")
    mechanical(rounds)


if __name__ == "__main__":
    main()
