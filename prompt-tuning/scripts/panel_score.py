"""迷惑性多模型评委面板（阅读理解设问）：同一窄问题并发给全部评委，逐评委留痕。
不随机分配——每个评委评每道题，暴露单一评委偏差（如 Jev 直觉过准）。

评委：jev（jev-latest，decisions 接口）+ ling / mimo / bunny（本地 chat，同题同判据）。
用法：
  uv run python panel_score.py --round v1 --suite 阅读理解设问
  uv run python panel_score.py --round v2 --judges jev,ling,mimo
结果：work/panel/<round>/<stem>.<unit>.json + 汇总（面板均值 / 逐评委均值 / 多数达标）
"""
from __future__ import annotations

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import paths
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

import mech_check as mc
import suite_score as ss

CHAT_JUDGE_MODELS = {
    "ling": "opencode-zen/ling-3.1-flash-free",
    "mimo": "opencode-zen/mimo-v2.6-flash-free",
    "bunny": "opencode-zen/space-bunny-free",
}

# 与 suite_score.RQ_CHECKS 同口径，取迷惑性核心 5 项
ITEMS = {
    "answer_unique": ("标注的正确答案是否唯一，没有第二个同样站得住的选项？", "唯一无争议", "存在双解或争议"),
    "trap_attractive": ("干扰项对只掌握一半知识的学生是否有真实吸引力（选错时会真的选到它们）？", "有真实吸引力", "一眼能排除"),
    "hesitation": ("做这道题时是否需要在两个选项之间权衡犹豫，而不是一眼定案？", "需要犹豫权衡", "一眼定案"),
    "no_absurd": ("四个选项是否都在认真作答的范围内（没有一眼荒谬、纯凑数的错误选项）？", "无荒谬凑数项", "存在一眼荒谬项"),
    "shape_giveaway": ("如果不懂文章，能否只靠选项表面特征（正确项更长、绝对化词、措辞复述原文）认出正确项？", "能靠表面认出", "认不出"),
}
INVERTED = {"shape_giveaway"}


def judge_jev(state: str) -> dict | None:
    cfg = json.loads(paths.config_file("jev_config.json").read_text(encoding="utf-8"))
    if cfg.get("model") != "jev-latest":
        return None
    questions = {k: {"type": "noul", "instructions": v[0], "criteria": {"true": v[1], "false": v[2]}}
                 for k, v in ITEMS.items()}
    body = {"model": cfg["model"], "state": state, "questions": questions}
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                ans = r.json().get("answers", {})
                return {k: (float((ans.get(k) or {}).get("noul"))
                            if (ans.get(k) or {}).get("noul") is not None else None) for k in ITEMS}
            if r.status_code == 400:
                return None
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2 * (attempt + 1))
    return None


PROMPT = """你是英语命题审题人。给定语篇与一道阅读理解题（含选项、标注答案、解析），对下列二值判定各给一个 0~1 的概率（1=完全符合 true 侧，0=完全符合 false 侧）。

{state}

判定项：
1. answer_unique：{q1}（true={t1} / false={f1}）
2. trap_attractive：{q2}（true={t2} / false={f2}）
3. hesitation：{q3}（true={t3} / false={f3}）
4. no_absurd：{q4}（true={t4} / false={f4}）
5. shape_giveaway：{q5}（true={t5} / false={f5}）

只输出一行 JSON，如：{{"answer_unique":0.9,"trap_attractive":0.6,"hesitation":0.3,"no_absurd":0.8,"shape_giveaway":0.2}}"""


def judge_chat(model: str, state: str) -> dict | None:
    cfg = json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))
    fmt = {}
    for i, (k, v) in enumerate(ITEMS.items(), 1):
        fmt[f"q{i}"], fmt[f"t{i}"], fmt[f"f{i}"] = v
    body = {"model": model, "messages": [{"role": "user", "content": PROMPT.format(state=state, **fmt)}],
            "max_tokens": cfg.get("judge_max_tokens", 8192), "stream": False}
    for attempt in range(3):
        try:
            with httpx.Client(timeout=300) as client:
                r = client.post(cfg["base_url"].rstrip("/") + "/chat/completions",
                                headers={"Authorization": f"Bearer {cfg['api_key']}"}, json=body)
            if r.status_code >= 500:
                time.sleep(3 * (attempt + 1))
                continue
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"] or ""
            m = re.search(r"\{[^{}]*\}", text, re.S)
            if m:
                d = json.loads(m.group(0))
                out = {}
                for k in ITEMS:
                    v = d.get(k)
                    try:
                        out[k] = max(0.0, min(1.0, float(v))) if v is not None else None
                    except (TypeError, ValueError):
                        out[k] = None
                return out
            return None
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
    return None

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--judges", default="jev,ling,mimo,bunny")
    ap.add_argument("--workers", type=int, default=6)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    if paths.suite() != "阅读理解设问":
        raise SystemExit("面板评分只支持 阅读理解设问")
    judges = [j.strip() for j in args.judges.split(",") if j.strip()]
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    out_dir = paths.work_dir() / "panel" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)

    units = []
    for f in sorted((paths.outputs_dir() / args.round).glob("*.md")):
        md = f.read_text(encoding="utf-8")
        material = cases.get(f.stem.split("_q")[0], {}).get("material", "")
        for unit_id, block in ss.rq_units(md):
            state = f"【语篇】\n{material}\n\n【本题（含选项与标注答案、解析）】\n{block}"
            units.append((f.stem, unit_id, state))
    jobs = [(stem, uid, j, state) for stem, uid, state in units for j in judges]
    print(f"面板任务 {len(jobs)}（{len(units)} 题次 × {len(judges)} 评委）")

    def run_one(stem, uid, judge, state):
        out = out_dir / f"{stem}.{uid}.{judge}.json"
        if out.exists():
            rec = json.loads(out.read_text(encoding="utf-8"))
            if rec.get("scores"):  # 失败记录（scores 为空）不作缓存，重试
                return rec
        scores = judge_jev(state) if judge == "jev" else judge_chat(CHAT_JUDGE_MODELS[judge], state)
        rec = {"stem": stem, "unit": uid, "judge": judge, "scores": scores}
        if scores:
            out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        return rec

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(run_one, *j): j for j in jobs}
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut][:3]}: 失败 {e}")

    recs = [r for r in results if r.get("scores")]
    print(f"\n== 面板汇总（{args.round}，有效 {len(recs)}/{len(jobs)}）==")
    print(f"{'项':<15}{'面板均值':>8}  逐评委  " + " ".join(f"{j:>6}" for j in judges) + "  多数达标")
    for k in ITEMS:
        vals, per = [], {}
        for j in judges:
            js = [r["scores"][k] for r in recs if r["judge"] == j and r["scores"].get(k) is not None]
            per[j] = sum(js) / len(js) if js else None
            vals += js
        if not vals:
            continue
        mean = sum(vals) / len(vals)
        ok = sum(1 for v in vals if (v < 0.5 if k in INVERTED else v >= 0.5))
        maj = ok >= (len(vals) + 1) // 2
        cells = " ".join(f"{per[j]:6.2f}" if per[j] is not None else "     -" for j in judges)
        mark = " ↓反向" if k in INVERTED else ""
        print(f"{k:<15}{mean:8.2f}  {cells}  {ok}/{len(vals)} {'✅' if maj else '❌'}{mark}")


if __name__ == "__main__":
    main()