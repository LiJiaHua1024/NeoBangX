"""单维度盲评（A/B 二选一）：就一个方面问"哪份更好"，正反两个顺序各问一次。

- 载荷：错因一句话 + 迁移题 + 答案解析（匿名，无版本痕迹）
- 问题：choice 三选一（A 更好 / B 更好 / 差不多），每次只问一个维度
- 位置偏差控制：同一对正反顺序各一次，两次指向同一版本才算"一致票"；不一致记为 noise
- 支持自定义 provider/model（默认 typesafe/jev；--config 可切 scorer_config.json 用免费版）

用法：uv run python ab_aspect.py --round-a v17 --round-b v0 --aspects transfer,deception,overall
结果：work/abaspect/{tag}/{case}_q{n}.{aspect}.json
"""
from __future__ import annotations

import argparse
import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

HERE = Path(__file__).parent
ASPECTS = {
    "transfer": "迁移真实性（题与原题、题与题之间是否真的不同；有没有换皮或同义转述）",
    "deception": "迷惑性（错误选项是否都有真实吸引力、需要动脑排除；正确项是否不显眼、不能靠表面特征猜出）",
    "answers": "答案质量（答案是否正确、唯一，有没有双解或争议）",
    "overall": "作为错题迁移练习的整体可用性",
}


def load_config(path: str) -> dict:
    return json.loads((HERE / path).read_text(encoding="utf-8"))


def slim(path: Path, cause: str) -> str:
    md = path.read_text(encoding="utf-8")
    i = md.find("## 三、迁移题")
    body = md[i:] if i > 0 else md
    return "（两份题组针对的本质错因：" + cause + "）\n\n" + body


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
                "instructions": f"两份匿名错题迁移练习（版本 A 和版本 B）对比，在【{ASPECTS[aspect_key]}】这一个方面，哪一份更好？只评这一个方面。",
                "criteria": {"A": "版本 A 更好", "B": "版本 B 更好", "tie": "两份差不多"},
            }
        },
    }
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                ans = (r.json().get("answers") or {}).get(aspect_key) or {}
                return ans.get("choice")
            if r.status_code == 400:
                return None
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2 * (attempt + 1))
    return None


def judge_pair(cfg: dict, tag: str, case_id: str, count: int, ra: str, rb: str,
               aspect: str, cause: str, fa: Path, fb: Path) -> dict:
    out_dir = HERE / "work" / "abaspect" / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{case_id}_q{count:02d}.{aspect}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    ta, tb = slim(fa, cause), slim(fb, cause)

    def one(first_is_a: bool) -> str | None:
        state = ("【版本 A】\n" + (ta if first_is_a else tb) + "\n\n【版本 B】\n" + (tb if first_is_a else ta))
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
    ap.add_argument("--aspects", default="transfer,deception,overall")
    ap.add_argument("--counts", default="1,3,5,10")
    ap.add_argument("--cases", default="all")
    ap.add_argument("--config", default="jev_config.json")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    cfg = load_config(args.config)
    tag = f"{args.round_a}-vs-{args.round_b}"
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]
    aspects = [a.strip() for a in args.aspects.split(",") if a.strip()]
    counts = [int(c) for c in args.counts.split(",")]

    jobs = []
    for cid in case_ids:
        for n in counts:
            fa = HERE / "outputs" / args.round_a / f"{cid}_q{n:02d}.md"
            fb = HERE / "outputs" / args.round_b / f"{cid}_q{n:02d}.md"
            if not (fa.exists() and fb.exists()):
                continue
            for asp in aspects:
                jobs.append((cfg, tag, cid, n, args.round_a, args.round_b, asp,
                             cases[cid]["cause"], fa, fb))
    print(f"单维度盲评：{len(jobs)} 组（{tag}，每个含正反两次判定）")
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(judge_pair, *j) for j in jobs]
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  失败: {e}")

    print(f"\n== 汇总（{tag}；只认正反顺序一致的票）==")
    ra, rb = args.round_a, args.round_b
    for asp in aspects:
        rs = [r for r in results if r["aspect"] == asp]
        win_a = sum(1 for r in rs if r["verdict"] == ra)
        win_b = sum(1 for r in rs if r["verdict"] == rb)
        tie = sum(1 for r in rs if r["verdict"] == "tie")
        noise = sum(1 for r in rs if r["verdict"] in ("noise", "error"))
        n_dec = win_a + win_b
        line = f"  {asp:<10}: {ra} {win_a}胜 / {rb} {win_b}胜 / 一致平 {tie} / 顺序矛盾 {noise}"
        if n_dec:
            from math import comb
            k = min(win_a, win_b)
            p = min(1.0, sum(comb(n_dec, i) for i in range(k + 1)) * 2 / 2 ** n_dec)
            line += f"  | 胜率 {win_a/n_dec:.0%}，符号检验 p={p:.3f}"
        print(line)


if __name__ == "__main__":
    main()
