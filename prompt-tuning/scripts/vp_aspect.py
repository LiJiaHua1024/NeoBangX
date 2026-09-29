# -*- coding: utf-8 -*-
"""试卷可视化全解：单维度盲评（A/B 二选一，正反双顺序）。

与 ab_aspect.py 同法，但载荷换成整卷类输出（题干+四维+迁移块原样，匿名、无版本痕迹），
维度换成这个 prompt 真正在意的五个方面。

用法：uv run python vp_aspect.py --round-a v1 --round-b v0 --aspects transfer,deception,fidelity
结果：work/abaspect_vp/{A-vs-B}/{case}_q{n}.{aspect}.json
"""
from __future__ import annotations

import paths
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from math import comb

import httpx

ASPECTS = {
    "transfer": "迁移真实性（迁移题与原题、迁移题与迁移题之间是否真的不同；有没有换皮把同一道题换个词重出）",
    "deception": "迁移题的迷惑性（错误选项是否有真实吸引力、需要动脑排除；正确项是否不显眼、不能靠表面特征猜出）",
    "pattern": "考点范式质量（归纳的解题步骤是否具体可操作、能否直接套用到本题的迁移题上）",
    "fidelity": "照录与格式（题干选项是否照录原文、SVG 式的分隔标签格式是否规范、能否被前端逐题解析渲染）",
    "overall": "作为课堂投影用全解的整体可用性",
}


def load_config(path: str) -> dict:
    return json.loads(paths.config_file(path).read_text(encoding="utf-8"))


def slim(path, case: dict) -> str:
    """载荷：题号范围说明 + 输出的正文（匿名，无版本痕迹）。"""
    md = path.read_text(encoding="utf-8")
    return (f"（下面是一份试卷可视化全解，试卷切片为：{case.get('name', '')}。"
            f"请只针对这一个方面比较两份。）\n\n" + md)


def ask(cfg: dict, state: str, aspect_key: str) -> str | None:
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    if cfg.get("referer"):
        headers["HTTP-Referer"] = cfg["referer"]
    if cfg.get("title"):
        headers["X-OpenRouter-Title"] = cfg["title"]
    body = {
        "model": cfg["model"],
        "state": state,
        "questions": {
            aspect_key: {
                "type": "choice",
                "instructions": (f"两份匿名试卷可视化全解（版本 A 和版本 B）对比，"
                                 f"在【{ASPECTS[aspect_key]}】这一个方面，哪一份更好？只评这一个方面。"),
                "criteria": {"A": "版本 A 更好", "B": "版本 B 更好", "tie": "两份差不多"},
            }
        },
    }
    for attempt in range(4):
        try:
            with httpx.Client(timeout=180) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                return ((r.json().get("answers") or {}).get(aspect_key) or {}).get("choice")
            if r.status_code == 400:
                return None
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2 * (attempt + 1))
    return None


def judge_pair(cfg, tag, case_id, count, ra, rb, aspect, case, fa, fb) -> dict:
    out_dir = paths.work_dir() / "abaspect_vp" / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{case_id}_q{count:02d}.{aspect}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    ta, tb = slim(fa, case), slim(fb, case)

    def one(first_is_a: bool) -> str | None:
        state = "【版本 A】\n" + (ta if first_is_a else tb) + "\n\n【版本 B】\n" + (tb if first_is_a else ta)
        pick = ask(cfg, state, aspect)
        if pick is None:
            return None
        if pick == "tie":
            return "tie"
        if first_is_a:
            return ra if pick == "A" else rb
        return rb if pick == "A" else ra

    v1 = one(True)
    time.sleep(0.3)
    v2 = one(False)
    if v1 is None or v2 is None:
        verdict = "error"
    elif v1 == "tie" or v2 == "tie":
        verdict = v1 if v1 == v2 else "noise"
    elif v1 == v2:
        verdict = v1
    else:
        verdict = "noise"
    rec = {"tag": tag, "case": case_id, "count": count, "aspect": aspect,
           "order1": v1, "order2": v2, "verdict": verdict}
    out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round-a", required=True)
    ap.add_argument("--round-b", required=True)
    ap.add_argument("--aspects", default="transfer,deception,pattern,fidelity,overall")
    ap.add_argument("--counts", default="1")
    ap.add_argument("--cases", default="all")
    ap.add_argument("--config", default="jev_config.json")
    ap.add_argument("--workers", type=int, default=4)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)

    cfg = load_config(args.config)
    tag = f"{args.round_a}-vs-{args.round_b}"
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]
    aspects = [a.strip() for a in args.aspects.split(",") if a.strip()]
    counts = [int(c) for c in args.counts.split(",")]

    jobs = []
    for cid in case_ids:
        for n in counts:
            fa = paths.outputs_dir() / args.round_a / f"{cid}_q{n:02d}.md"
            fb = paths.outputs_dir() / args.round_b / f"{cid}_q{n:02d}.md"
            if not (fa.exists() and fb.exists()):
                continue
            for asp in aspects:
                jobs.append((cfg, tag, cid, n, args.round_a, args.round_b, asp, cases[cid], fa, fb))
    print(f"单维度盲评：{len(jobs)} 组（{tag}，每组合正反两次判定）")
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(judge_pair, *j) for j in jobs]
        for fu in as_completed(futs):
            try:
                results.append(fu.result())
            except Exception as e:  # noqa: BLE001
                print(f"  失败: {e}")

    print(f"\n== 汇总（{tag}；只认正反顺序一致的票）==")
    ra, rb = args.round_a, args.round_b
    for asp in aspects:
        rs = [r for r in results if r.get("aspect") == asp]
        wa = sum(1 for r in rs if r["verdict"] == ra)
        wb = sum(1 for r in rs if r["verdict"] == rb)
        tie = sum(1 for r in rs if r["verdict"] == "tie")
        noise = sum(1 for r in rs if r["verdict"] in ("noise", "error"))
        line = f"  {asp:<10}: {ra} {wa}胜 / {rb} {wb}胜 / 一致平 {tie} / 顺序矛盾 {noise}"
        nd = wa + wb
        if nd:
            k = min(wa, wb)
            p = min(1.0, sum(comb(nd, i) for i in range(k + 1)) * 2 / 2 ** nd)
            line += f"  | 胜率 {wa/nd:.0%}，符号检验 p={p:.3f}"
        print(line)


if __name__ == "__main__":
    main()
