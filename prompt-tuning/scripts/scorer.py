"""全量评分器：调用 respan/span-01-lite（OpenRouter decisions 接口）对生成结果做窄判定评分。

设计原则（按模型特性）：
- 只问"看一眼就能判定"的窄问题（二值概率 noul），不问需要多步推理的问题
- 每题一次调用，原子检查项互不纠缠；状态里给全原题、迁移题、答案与解析
- 免费 + 快 → 支持全量跑（所有轮次、所有文件），结果可断点续跑

检查项（均为 noul，>0.5 视为通过）：
  answer_unique     答案唯一无争议
  distractor_trace  每个干扰项都有具体错误点（非凑数/荒谬）
  shape_guessable   [反向] 不懂语言、只看选项形状也能猜出正确项（>0.5 视为露底）
  context_reuse     迁移题情境与原题明显重合/换皮（>0.5 视为换皮）
  explanation_ok    解析的排除理由与题面事实一致

用法：
  uv run python scorer.py --round v17                 # 单轮全量
  uv run python scorer.py --rounds v17,v11,v0         # 多轮对比
  uv run python scorer.py --round v17 --files c1_reading_inference_q10
配置：scorer_config.json（base_url / api_key / model，支持任何同格式的 provider 与自定义模型名）
"""
from __future__ import annotations

import paths
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from qparse import item_num, section_text, split_items

HERE = Path(__file__).parent
CHECKS = {
    "answer_unique": {
        "type": "noul",
        "instructions": "上面这道迁移题的正确答案是否唯一、没有第二个同样站得住的选项？",
        "criteria": {"true": "答案唯一且无争议", "false": "存在双解或合理争议"},
    },
    "distractor_trace": {
        "type": "noul",
        "instructions": "这道迁移题的每个错误选项是否都有一个具体可指出的错误点（不是一眼荒谬、与考点无关的凑数项）？",
        "criteria": {"true": "每个干扰项都有具体错误点", "false": "存在凑数或荒谬干扰项"},
    },
    "trap_attractive": {
        "type": "noul",
        "instructions": "这道题的干扰项对半懂的学生是否有真实吸引力（而不是不费力就能排除干净）？",
        "criteria": {"true": "有真实吸引力", "false": "容易排除"},
    },
    "shape_guessable": {
        "type": "noul",
        "instructions": "如果一个学生完全不懂英语，只看四个选项的表面形状（长度、措辞、绝对化词、位置），能否明显猜出正确项？",
        "criteria": {"true": "能明显猜到", "false": "猜不到"},
    },
    "context_reuse": {
        "type": "noul",
        "instructions": "这道迁移题的情境（人物、事件、场合）是否与上面的原题明显重合，属于换皮而非新语境？",
        "criteria": {"true": "明显重合或换皮", "false": "是新语境"},
    },
    "explanation_ok": {
        "type": "noul",
        "instructions": "答案与解析中给出的排除理由，是否与题面的事实一致（没有说错原文、没有张冠李戴）？",
        "criteria": {"true": "理由与题面一致", "false": "存在与题面不符的理由"},
    },
    "difficulty_by_target": {
        "type": "noul",
        "instructions": "这道题的难度是否来自考点本身（词汇、句子结构都在高中常规范围内），而没有靠生词、超长句或陌生背景制造难度？",
        "criteria": {"true": "难度来自考点", "false": "靠生词/长句/陌生背景"},
    },
}

# 反向指标：> 0.5 表示存在问题（均值越低越好）
INVERTED = {"shape_guessable", "context_reuse"}


def parse_answer(spec_type: str, ans: dict) -> float | None:
    """兼容 noul / choice / score 三种返回（choice/score 取分布最大概率）。"""
    if not isinstance(ans, dict):
        return None
    if spec_type == "noul":
        v = ans.get("noul")
        return float(v) if v is not None else None
    probs = ans.get("probabilities") or {}
    if spec_type == "choice":
        return max(probs.values()) if probs else None
    if spec_type == "score":
        return max(probs.values()) if probs else None
    return None


def load_config(path: str = "") -> dict:
    p = paths.config_file(path or "scorer_config.json")
    if not p.exists():
        raise SystemExit(f"缺少配置 {p.name}（base_url / api_key / model）")
    return json.loads(p.read_text(encoding="utf-8"))


def ask(cfg: dict, state: str, questions: dict) -> dict:
    body = {"model": cfg["model"], "state": state, "questions": questions}
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    if cfg.get("referer"):
        headers["HTTP-Referer"] = cfg["referer"]
    if cfg.get("title"):
        headers["X-OpenRouter-Title"] = cfg["title"]
    last = None
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                return r.json().get("answers", {})
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code == 400:
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"评分调用失败: {last}")


def question_units(md: str) -> list[tuple[int, str, str]]:
    """返回 [(题号, 题干+选项, 答案+解析)]。"""
    q_blocks = split_items(section_text(md, "## 三、迁移题"))
    a_blocks = split_items(section_text(md, "## 四、答案 + 解析"))
    ans = {}
    for ab in a_blocks:
        n = item_num(ab.splitlines()[0])
        if n is not None:
            ans[n] = ab
    units = []
    for qb in q_blocks:
        n = item_num(qb.splitlines()[0])
        if n is None or n not in ans:
            continue
        units.append((n, qb, ans[n]))
    return units


def score_file(cfg: dict, round_name: str, stem: str, original: str) -> list[dict]:
    md = (paths.outputs_dir() / round_name / f"{stem}.md").read_text(encoding="utf-8")
    out_dir = paths.work_dir() / ("score" if cfg["model"].startswith("respan") else "score_jev") / round_name
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for num, q_block, a_block in question_units(md):
        out = out_dir / f"{stem}.q{num:02d}.json"
        if out.exists():
            rows.append(json.loads(out.read_text(encoding="utf-8")))
            continue
        state = (f"【原题】\n{original}\n\n【迁移题（第 {num} 题）】\n{q_block}\n\n"
                 f"【该题答案与解析】\n{a_block}")
        try:
            answers = ask(cfg, state, CHECKS)
        except Exception as e:  # noqa: BLE001
            print(f"  {stem} q{num}: {e}")
            continue
        rec = {"round": round_name, "file": stem, "num": num,
               "scores": {k: parse_answer(CHECKS[k]["type"], v or {}) for k, v in answers.items()}}
        out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        rows.append(rec)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", default="", help="逗号分隔轮次；或用 --round")
    ap.add_argument("--round", default="")
    ap.add_argument("--files", default="", help="逗号分隔文件名（不带 .md），默认全量")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--config", default="", help="评分器配置文件名（默认 scorer_config.json，可换 jev_config.json）")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    rounds = [r.strip() for r in (args.rounds or args.round).split(",") if r.strip()]
    if not rounds:
        raise SystemExit("需要 --round 或 --rounds")
    cfg = load_config(args.config)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    print(f"评分器：model={cfg['model']} 轮次={rounds}")

    for round_name in rounds:
        d = paths.outputs_dir() / round_name
        if not d.exists():
            print(f"{round_name}: 无输出目录"); continue
        stems = ([s.strip() for s in args.files.split(",")] if args.files
                 else sorted(f.stem for f in d.glob("*.md")))
        jobs = []
        for stem in stems:
            case_id = stem.rsplit("_q", 1)[0]
            if case_id not in cases:
                continue
            if not (d / f"{stem}.md").exists():
                continue
            jobs.append((round_name, stem, cases[case_id]["question"]))
        print(f"--- {round_name}: {len(jobs)} 个文件 ---")
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(score_file, cfg, r, s, o) for r, s, o in jobs]
            done = 0
            for fut in as_completed(futures):
                try:
                    fut.result()
                    done += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  失败: {e}")
            print(f"  {done}/{len(jobs)} 个文件完成")

    # 汇总
    print("\n== 汇总（noul 均值，越高越符合；shape_guessable/context_reuse 越低越好）==")
    for round_name in rounds:
        d = paths.work_dir() / ("score" if cfg["model"].startswith("respan") else "score_jev") / round_name
        files = sorted(d.glob("*.json"))
        if not files:
            continue
        agg = {k: [] for k in CHECKS}
        for f in files:
            rec = json.loads(f.read_text(encoding="utf-8"))
            for k, v in rec["scores"].items():
                if v is not None:
                    agg[k].append(v)
        print(f"  {round_name}（{len(files)} 题）: " + "  ".join(
            f"{k}={sum(v)/len(v):.2f}(n={len(v)})" for k, v in agg.items() if v))
        # 失败率（反向指标 >0.5 为失败，其余 <0.5 为失败）
        fails = {k: sum(1 for v in vs if (v > 0.5 if k in INVERTED else v < 0.5))
                 for k, vs in agg.items() if vs}
        print("    问题率: " + "  ".join(
            f"{k}={fails[k]/max(len(agg[k]),1):.0%}" for k in fails))


if __name__ == "__main__":
    main()
