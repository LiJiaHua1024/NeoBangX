"""流水线评分：把"这道题好不好"拆成一系列极窄的二值判定（适合 respan/span-01-lite 类模型）。

每个题三步（每步 1 次调用，含若干 noul 窄问题）：
  P1 逐选项可填性（不看答案）：每个选项单独问"填入语境是否成立" → 客观推导答案唯一性
  P2 逐选项质量：每个选项问"是否属于凑数项（一眼荒谬/与考点无关）"
  P3 题级检查：语境换皮、解析一致性、三类难度负荷（生词/长句/背景）、组内重复

用法：uv run python pipeline.py --rounds v17,v0 [--workers 6]
结果存 work/pipe/{round}/{file}.q{num}.json（可断点续跑），最后打印聚合统计。
"""
from __future__ import annotations

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from hack_check import options_of, key_letter
from qparse import item_num, section_text, split_items

HERE = Path(__file__).parent
LETTERS = "ABCDEFG"


def load_config(path: str = "") -> dict:
    return json.loads((HERE / (path or "scorer_config.json")).read_text(encoding="utf-8"))


def ask(cfg: dict, state: str, questions: dict) -> dict:
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    if cfg.get("referer"):
        headers["HTTP-Referer"] = cfg["referer"]
    if cfg.get("title"):
        headers["X-OpenRouter-Title"] = cfg["title"]
    body = {"model": cfg["model"], "state": state, "questions": questions}
    last = None
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                return r.json().get("answers", {})
            last = f"HTTP {r.status_code}: {r.text[:160]}"
            if r.status_code == 400:
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"pipeline 调用失败: {last}")


def noul(instructions: str, yes: str, no: str) -> dict:
    return {"type": "noul", "instructions": instructions, "criteria": {"true": yes, "false": no}}


def get(answers: dict, key: str) -> float | None:
    v = (answers.get(key) or {}).get("noul")
    return float(v) if v is not None else None


def process_question(cfg: dict, round_name: str, stem: str, num: int,
                     q_block: str, a_block: str, original: str) -> dict:
    tag = "pipe" if cfg["model"].startswith("respan") else "pipe_jev"
    out_dir = HERE / "work" / tag / round_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}.q{num:02d}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))

    opts = options_of(q_block)
    letters = LETTERS[:len(opts)]
    key = key_letter(a_block)
    # 去答案标记的题面（用于 P1）
    stem_wo = re.sub(r"\*\*|__|`", "", q_block)
    stem_wo = re.sub(r"(?m)^\s*(?:答案|Answer)[:：].*$", "", stem_wo)

    rec: dict = {"round": round_name, "file": stem, "num": num, "key": key, "options": dict(zip(letters, opts))}

    if len(opts) < 2:
        # 无选项题（语法填空等）：只做 P3 题级检查
        p3only = {
            "context_reuse": noul("上面的迁移题，其情境（人物、事件、场合）是否与原题明显重合、属于换皮？",
                                  "明显重合或换皮", "是新语境"),
            "explanation_ok": noul("答案与解析里的排除理由，是否与题面事实一致（没有说错原文、没有张冠李戴）？",
                                   "一致", "存在不一致"),
            "vocab_load": noul("这道题里有没有会影响目标学生理解、且不属于考点的超纲生词？",
                               "有超纲生词", "没有"),
            "structure_load": noul("这道题里有没有明显超出高中常规、妨碍理解的长难句或复杂结构？",
                                   "有", "没有"),
            "background_load": noul("这道题的背景知识是否陌生到会妨碍目标学生作答？",
                                    "会妨碍", "不会妨碍"),
        }
        a3 = ask(cfg, "【原题】" + original + "\n\n【迁移题】" + q_block
                 + "\n\n【答案与解析】" + a_block, p3only)
        rec["checks"] = {k: get(a3, k) for k in p3only}
        rec["fit"] = {}
        rec["fit_count"] = 0
        rec["filler_like"] = []
        rec["plausible"] = {}
        out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        return rec

    # P1 逐选项可填性（按题型自适应问法：填空 vs 选择/推断）
    is_fill = "___" in q_block or "____" in q_block or "（ ）" in q_block
    if is_fill:
        tpl = "把选项 {L}“{t}”填进上面题目的空格后，句子或语篇在语义上是否成立、讲得通？"
    else:
        tpl = "选项 {L}“{t}”如果是这道题的答案，是否站得住——有文本或语义依据、不是误读？"
    p1 = {f"fit_{L}": noul(tpl.format(L=L, t=t),
                            "站得住", "站不住或明显别扭") for L, t in zip(letters, opts)}
    a1 = ask(cfg, stem_wo, p1)
    rec["fit"] = {L: get(a1, f"fit_{L}") for L in letters}
    fits = [L for L in letters if (rec["fit"].get(L) or 0) >= 0.5]
    rec["fit_count"] = len(fits)
    rec["alt_fit"] = [L for L in fits if L != key]

    # P2 逐选项候选合理性（越低越像凑数项；对这四个选项同样适用）
    p2 = {f"plausible_{L}": noul(
        f"一个不懂考点的学生看到选项 {L}“{t}”时，它看起来是否像一个说得通的候选，值得认真思考、不能一眼排除？",
        "看起来说得通", "一眼就能排除") for L, t in zip(letters, opts)}
    a2 = ask(cfg, stem_wo, p2)
    rec["plausible"] = {L: get(a2, f"plausible_{L}") for L in letters}
    rec["filler_like"] = [L for L in letters if (rec["plausible"].get(L) or 1) < 0.5]

    # P3 题级检查
    p3 = {
        "context_reuse": noul("上面的迁移题，其情境（人物、事件、场合）是否与原题明显重合、属于换皮？",
                              "明显重合或换皮", "是新语境"),
        "explanation_ok": noul("答案与解析里的排除理由，是否与题面事实一致（没有说错原文、没有张冠李戴）？",
                               "一致", "存在不一致"),
        "vocab_load": noul("这道题里有没有会影响目标学生理解、且不属于考点的超纲生词？",
                           "有超纲生词", "没有"),
        "structure_load": noul("这道题里有没有明显超出高中常规、妨碍理解的长难句或复杂结构？",
                               "有", "没有"),
        "background_load": noul("这道题的背景知识是否陌生到会妨碍目标学生作答？",
                                "会妨碍", "不会妨碍"),
        "duplicate": noul("这道题与本题组里的其他题目相比，是不是实质上的同一道题（只换了词、结构照旧）？",
                          "是重复题", "不是重复题"),
        "answer_guessable": noul("如果只看选项的表面形状（长度、措辞、绝对化词），能否明显猜出正确项？",
                                 "能猜到", "猜不到"),
    }
    a3 = ask(cfg, f"【原题】{original}\n\n【迁移题】{q_block}\n\n【答案与解析】{a_block}", p3)
    rec["checks"] = {k: get(a3, k) for k in p3}

    out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", required=True)
    ap.add_argument("--cases", default="all")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--config", default="")
    args = ap.parse_args()
    cfg = load_config(args.config)
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]

    for round_name in [r.strip() for r in args.rounds.split(",") if r.strip()]:
        d = HERE / "outputs" / round_name
        if not d.exists():
            print(f"{round_name}: 无输出"); continue
        jobs = []
        for cid in case_ids:
            for f in sorted(d.glob(f"{cid}_q*.md")):
                md = f.read_text(encoding="utf-8")
                q_blocks = split_items(section_text(md, "## 三、迁移题"))
                a_blocks = split_items(section_text(md, "## 四、答案 + 解析"))
                ans = {}
                for ab in a_blocks:
                    n = item_num(ab.splitlines()[0])
                    if n is not None:
                        ans[n] = ab
                for qb in q_blocks:
                    n = item_num(qb.splitlines()[0])
                    if n is None or n not in ans:
                        continue
                    jobs.append((cfg, round_name, f.stem, n, qb, ans[n], cases[cid]["question"]))
        print(f"--- {round_name}: {len(jobs)} 题 ---")
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(process_question, *j) for j in jobs]
            for fut in as_completed(futures):
                try:
                    fut.result()
                    done += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  失败: {e}")
        print(f"  {done}/{len(jobs)}")

    # 聚合
    print("\n== 聚合（v = noul 均值；filler 数为每题均值；fit>1 = 多个选项都能填通）==")
    for round_name in [r.strip() for r in args.rounds.split(",") if r.strip()]:
        tag = "pipe" if cfg["model"].startswith("respan") else "pipe_jev"
        dd = HERE / "work" / tag / round_name
        files = sorted(dd.glob("*.json"))
        if not files:
            continue
        recs = [json.loads(f.read_text(encoding="utf-8")) for f in files]
        n = len(recs)
        def mean(vals):
            vals = [v for v in vals if v is not None]
            return sum(vals) / len(vals) if vals else None
        chk = lambda k: mean([r["checks"].get(k) for r in recs])
        fills = sum(len(r["filler_like"]) for r in recs) / n
        plausible_dist = mean([mean([v for k2, v in r["plausible"].items() if k2 != r["key"]])
                               for r in recs])
        multi_fit = sum(1 for r in recs if r["fit_count"] > 1) / n
        key_not_fit = sum(1 for r in recs if r["key"] and (r["fit"].get(r["key"]) or 0) < 0.5) / n
        print(f"  {round_name}（{n} 题）:")
        print(f"    多选项可站住率={multi_fit:.0%}  正确答案站不住率={key_not_fit:.0%}  "
              f"像凑数项的选项={fills:.2f}/题  干扰项平均吸引力={plausible_dist:.2f}")
        print("    " + "  ".join(f"{k}={chk(k):.2f}" for k in
              ["context_reuse", "explanation_ok", "vocab_load", "structure_load",
               "background_load", "duplicate", "answer_guessable"]))


if __name__ == "__main__":
    main()
