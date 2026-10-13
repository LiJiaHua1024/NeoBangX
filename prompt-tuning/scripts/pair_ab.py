"""v1-vs-v0 匿名对比（不退步门禁）：Jev noul 正反双序，只认一致票。

用法：
  uv run python pair_ab.py --round-a v1 --round-b v0 --suite 阅读理解设问
结果：work/pair_ab/<a>-vs-<b>/<stem>.<aspect>.json + 汇总（胜/负/平，符号检验 p）
"""
from __future__ import annotations

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import paths
import argparse
import json
import time
from math import comb
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

ASPECTS = {
    "阅读理解设问": {
        "overall": "作为课堂/模考阅读理解题的整体可用性",
        "deception": "迷惑性与干扰性（错误选项是否有真实吸引力、做题是否需要犹豫；而非对的太对、错的太错）",
        "diversity": "版本A/B 的差异化程度（命题路径是否真正不同，而非措辞微调）",
        "natural": "题目与语篇的贴合（是否依托语篇关键节点设问，而非孤立细节）",
    },
    "阅读文本改编": {
        "overall": "作为高考阅读语篇改编的整体质量",
        "authentic": "词汇真实化改造的自然度（地道词块/活用是否自然，不生硬堆砌）",
        "fidelity": "主线与文化内涵的保留（删减是否得当、文化负载词是否保住）",
        "usable": "产物对教师的可用性（说明、改造清单、命题建议是否准确有用）",
    },
}


def noul(instructions: str, yes: str, no: str) -> dict:
    return {"type": "noul", "instructions": instructions, "criteria": {"true": yes, "false": no}}


def ask(cfg: dict, state: str, question: dict) -> float | None:
    body = {"model": cfg["model"], "state": state, "questions": {"q": question}}
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                v = (r.json().get("answers", {}).get("q") or {}).get("noul")
                return float(v) if v is not None else None
            if r.status_code == 400:
                return None
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2 * (attempt + 1))
    return None


def judge_one(cfg, out_dir, stem, aspect, ta, tb, label_a, label_b):
    out = out_dir / f"{stem}.{aspect}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    q = noul(f"只评一个维度：【{aspect}】。上面的版本 A 是否优于版本 B？",
             f"版本 A 在【{aspect}】上更好", f"版本 B 在【{aspect}】上更好或相当")
    s1 = f"【版本 A】\n{ta}\n\n【版本 B】\n{tb}"
    s2 = f"【版本 A】\n{tb}\n\n【版本 B】\n{ta}"
    v1 = ask(cfg, s1, q)   # >0.5 表示第一份更好
    time.sleep(0.3)
    v2 = ask(cfg, s2, q)   # >0.5 表示第二份更好（即原 tb）
    if v1 is None or v2 is None:
        verdict = "error"
    elif (v1 > 0.5) == (v2 <= 0.5) and (v1 > 0.5) == (v2 > 0.5 or v2 <= 0.5):
        verdict = label_a if v1 > 0.5 and v2 <= 0.5 else (label_b if v1 <= 0.5 and v2 > 0.5 else "tie")
    else:
        verdict = "noise"
    rec = {"stem": stem, "aspect": aspect, "v1": v1, "v2": v2, "verdict": verdict}
    out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round-a", required=True, help="新版本（如 v1）")
    ap.add_argument("--round-b", required=True, help="基线（v0）")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cfg = json.loads(paths.config_file("jev_config.json").read_text(encoding="utf-8"))
    if cfg.get("model") != "jev-latest":
        raise SystemExit("只允许 jev-latest")
    aspects = ASPECTS[paths.suite()]
    out_dir = paths.work_dir() / "pair_ab" / f"{args.round_a}-vs-{args.round_b}"
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    for f in sorted((paths.outputs_dir() / args.round_a).glob("*.md")):
        fb = paths.outputs_dir() / args.round_b / f.name
        if not fb.exists():
            continue
        ta, tb = f.read_text(encoding="utf-8"), fb.read_text(encoding="utf-8")
        for asp in aspects:
            jobs.append((cfg, out_dir, f.stem, asp, ta, tb, args.round_a, args.round_b))
    print(f"对比任务 {len(jobs)} 组（{args.round_a} vs {args.round_b}）")
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(judge_one, *j) for j in jobs]
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  失败: {e}")

    print(f"\n== 对比汇总（只认正反一致票）==")
    regression = False
    for asp, desc in aspects.items():
        rs = [r for r in results if r["aspect"] == asp]
        wa = sum(1 for r in rs if r["verdict"] == args.round_a)
        wb = sum(1 for r in rs if r["verdict"] == args.round_b)
        tie = sum(1 for r in rs if r["verdict"] == "tie")
        noise = sum(1 for r in rs if r["verdict"] in ("noise", "error"))
        n_dec = wa + wb
        p = ""
        if n_dec:
            k = min(wa, wb)
            pv = min(1.0, sum(comb(n_dec, i) for i in range(k + 1)) * 2 / 2 ** n_dec)
            p = f"  p={pv:.3f}"
        flag = ""
        if wb > wa:
            flag = "  ⚠ 回退"
            regression = True
        print(f"  {asp:<10}: {args.round_a} {wa} / {args.round_b} {wb} / 平 {tie} / 噪声 {noise}{p}{flag}")
    print("\n门禁：" + ("❌ 存在维度回退" if regression else "✅ 无维度回退（胜≥负）"))


if __name__ == "__main__":
    main()