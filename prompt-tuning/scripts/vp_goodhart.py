"""整卷类 Goodhart 补偿检测：把智能错题迁移 suite 的 goodhart_check 思路搬到 @@TAG@@ 输出上。

检查项（noul；前三项同向越高越好，最后一项反向）：
  point_same     迁移题与原题是否仍考同一个考点（拆掉伪装后范式步骤能解）——问题 A 的判定
  trap_live      学生若按原题的易错习惯（跳过范式对应步骤）做，是否会做错——陷阱是否活着
  hard_negation  迁移语篇是否用显性硬否定句替学生排除干扰——问题 B 的判定（反向）
  template_plot  迁移语篇情节是否套固定公式/与原题剧情同构（反向）

用法：
  uv run python vp_goodhart.py --suite 试卷可视化全解 --rounds v3,v4
"""
from __future__ import annotations

import paths
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import vp_parse as vp
import vp_scorer as vps

CHECKS = {
    "point_same": {
        "type": "noul",
        "instructions": "忽略话题域的差异：这道迁移题拆掉伪装后，考查的考点是否与原题相同（按给出的范式步骤走能解出它）？如果它实际在考别的知识或能力，选 false。",
        "criteria": {"true": "同一考点", "false": "变成另一类题"},
    },
    "trap_live": {
        "type": "noul",
        "instructions": "一个带着原题易错习惯的学生（不按范式走、按原先的直觉判断）来做这道迁移题，会做错吗？",
        "criteria": {"true": "会做错（陷阱活着）", "false": "旧习惯帮不上忙也害不了他"},
    },
    "hard_negation": {
        "type": "noul",
        "instructions": "迁移题的语篇或题干里，是否有一句显性的\"硬否定\"或降格陈述——直接写明某做法无效、某数据下降、某事从未/不再发生、\"记录只写事实不写感受\"这类替读者关掉某种解读的句子——作用是替学生排除某个干扰项？（正常转折叙事不算；关键是\"为答案服务\"）",
        "criteria": {"true": "存在这种句子", "false": "没有"},
    },
    "template_plot": {
        "type": "noul",
        "instructions": "迁移题的语篇情节是否套用一个可见的固定公式（例如：旧表态或常规做法→出现转变→数据翻倍/明显变化→本人解释），像按配方写的而不是自然叙事？（与原题剧情同构也算）",
        "criteria": {"true": "是模板化剧情", "false": "情节自然"},
    },
}
INVERTED = {"hard_negation", "template_plot"}


def goodhart_file(cfg: dict, round_name: str, stem: str, case: dict) -> list[dict]:
    md = (paths.outputs_dir() / round_name / f"{stem}.md").read_text(encoding="utf-8")
    d = vp.parse(md)
    tag = "respan" if cfg["model"].startswith("respan") else "jev"
    out_dir = paths.work_dir() / "vp_goodhart" / (tag + "_expl") / round_name
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for q in d.get("questions", []):
        ref = (q["fields"].get("PASSAGE_REF") or [""])[0]
        passage = d.get("passages", {}).get(ref, "")
        for bi, t in enumerate(q.get("transfers", []), 1):
            out = out_dir / f"{stem}.q{q['num']:02d}.{bi}.json"
            if out.exists():
                rows.append(json.loads(out.read_text(encoding="utf-8")))
                continue
            state = vps.transfer_state(q, passage, t, bi)
            expl = t.get("TRANSFER_EXPL", "")
            if expl:
                state += "\n\n【迁移题答案与解析（含钓鱼路径还原）】\n" + expl
            try:
                answers = vps.ask(cfg, state, CHECKS)
            except Exception as e:  # noqa: BLE001
                print(f"  {stem} q{q['num']}.{bi}: {e}")
                continue
            rec = {"round": round_name, "file": stem, "num": q["num"], "bi": bi,
                   "scores": {k: vps.parse_answer(v["type"], answers.get(k) or {})
                              for k, v in CHECKS.items()}}
            out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            rows.append(rec)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", default="v4")
    ap.add_argument("--files", default="")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--config", default="")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    rounds = [r.strip() for r in args.rounds.split(",") if r.strip()]
    cfg = vps.load_config(args.config)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    print(f"vp Goodhart 检测：model={cfg['model']} 轮次={rounds}")

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

    print("\n== 汇总（noul 均值；point_same/trap_live 同向越高越好，后两项反向）==")
    tag = ("respan" if cfg["model"].startswith("respan") else "jev") + "_expl"
    for round_name in rounds:
        dd = paths.work_dir() / "vp_goodhart" / tag / round_name
        files = sorted(dd.glob("*.json"))
        if not files:
            continue
        agg: dict[str, list[float]] = {k: [] for k in CHECKS}
        for f in files:
            rec = json.loads(f.read_text(encoding="utf-8"))
            for k, v in rec["scores"].items():
                if v is not None:
                    agg[k].append(v)
        print(f"  {round_name}（{len(files)} 个迁移块）")
        for k, vs in agg.items():
            if not vs:
                continue
            bad = sum(1 for v in vs if (v > 0.5 if k in INVERTED else v < 0.5)) / len(vs)
            print(f"    {k}: mean={sum(vs) / len(vs):.2f} 问题率={bad:.0%} n={len(vs)}")


if __name__ == "__main__":
    main()
