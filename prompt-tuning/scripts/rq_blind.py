"""盲做测量（设问）：切出无答案题面，让池内模型像考生一样作答，统计
正确率 / 犹豫率 / 干扰项被选分布——迷惑性达标线：
正确率 55-85%、犹豫率 ≥30%、无全对全自信（否则"对的太对、错的太错"）。

用法：
  uv run python rq_blind.py --round v0 --solvers opencode-zen/space-bunny-free,opencode-zen/ling-3.1-flash-free
结果：work/blind/<round>/<stem>.<solver>.json + 汇总
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


def clean_paper(md: str) -> tuple[str, dict]:
    """返回（无答案题面, {unit_id: 标注答案}）。"""
    paper_parts, keys = [], {}
    for tag in ("A", "B"):
        body = mc.version_body(md, tag)
        qs = mc.q_stem_opts(body)
        if not qs:
            continue
        paper_parts.append(f"### 版本 {tag}")
        for q in qs:
            keys[f"{tag.lower()}{q['num']}"] = q["answer"]
            paper_parts.append(f"{q['num']}. {q['stem'].split(' 答案')[0].strip()}")
            for k in sorted(q["opts"]):
                paper_parts.append(f"{k}. {q['opts'][k]}")
            paper_parts.append("")
    return "\n".join(paper_parts), keys


def call_chat(cfg: dict, model: str, prompt: str) -> str:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": cfg.get("judge_max_tokens", 8192), "stream": False}
    last = None
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
            if text.strip():
                return text
            last = "空正文"
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"chat 调用失败: {last}")


PROMPT = """你是高三学生考生。下面是一套阅读理解题（每题 A/B/C/D 四选一）。
像真考试一样作答：不确定也要选出最可能的一个。

{paper}

只输出一行 JSON 数组，每题一项：[{{"id":"版本字母+题号如A1","pick":"A-D","conf":1-5,"hesitated":true/false}}]
conf=作答信心（1=纯猜，5=完全确定）；hesitated=你是否在两个选项之间犹豫过。不要输出其他内容。"""


def solve_one(cfg, solver, stem, paper, keys, out_dir):
    out = out_dir / f"{stem}.{solver.split('/')[-1]}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    text = call_chat(cfg, solver, PROMPT.format(paper=paper))
    m = re.search(r"\[[\s\S]*\]", text)
    picks = json.loads(m.group(0)) if m else []
    rows = []
    for p in picks:
        uid = re.sub(r"[^A-Za-z0-9]", "", str(p.get("id", ""))).lower()
        rows.append({"id": uid, "pick": str(p.get("pick", "")).upper(),
                     "conf": p.get("conf"), "hesitated": bool(p.get("hesitated")),
                     "correct": keys.get(uid) == str(p.get("pick", "")).upper(),
                     "key": keys.get(uid)})
    rec = {"stem": stem, "solver": solver, "rows": rows}
    out.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--solvers", default="opencode-zen/space-bunny-free,opencode-zen/ling-3.1-flash-free")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    if paths.suite() != "阅读理解设问":
        raise SystemExit("盲做测量只支持 阅读理解设问")
    cfg = json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))
    out_dir = paths.work_dir() / "blind" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    for f in sorted((paths.outputs_dir() / args.round).glob("*.md")):
        paper, keys = clean_paper(f.read_text(encoding="utf-8"))
        for solver in [s.strip() for s in args.solvers.split(",") if s.strip()]:
            jobs.append((cfg, solver, f.stem, paper, keys, out_dir))
    print(f"盲做任务 {len(jobs)} 个")
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(solve_one, *j): j[1] for j in jobs}
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
                print(f"  {futs[fut]}: ok")
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut]}: 失败 {e}")

    rows = [r for rec in results for r in rec["rows"] if r["key"]]
    n = len(rows)
    if not n:
        print("无有效作答")
        return
    acc = sum(1 for r in rows if r["correct"]) / n
    hes = sum(1 for r in rows if r["hesitated"]) / n
    conf_rows = [r for r in rows if isinstance(r["conf"], (int, float))]
    mean_conf = sum(r["conf"] for r in conf_rows) / max(1, len(conf_rows))
    dist: dict[str, int] = {}
    for r in rows:
        if not r["correct"]:
            dist[r["pick"]] = dist.get(r["pick"], 0) + 1
    picked_wrong = sum(dist.values())
    print(f"\n== 盲做汇总（{args.round}，{n} 题次）==")
    print(f"  正确率 {acc:.0%}（目标 55-85%）  犹豫率 {hes:.0%}（目标 ≥30%）  平均信心 {mean_conf:.1f}/5")
    print(f"  干扰项被选分布 {dist}（错选 {picked_wrong} 次）")
    if acc > 0.95 and hes < 0.15:
        print("  ⚠ 对的太对、错的太错：迷惑性不足")
    if picked_wrong == 0:
        print("  ⚠ 无人错选：干扰项缺乏杀伤力")


if __name__ == "__main__":
    main()