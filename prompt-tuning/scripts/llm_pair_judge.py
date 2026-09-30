"""直调 LLM 盲评 A/B（Jev 判不动的能力型维度用）：池内模型逐对评审，同模型正反双序。

与 ab_aspect.py 的差别：ab_aspect 走 Jev decisions 接口（窄判定）；本脚本直接调
api_config.json 里的 judge_pool（多个家族的普通 chat 模型，排除生成模型本身以防
自我偏好），让大模型通读两份匿名题组后给选择。同一条目的正反两序用同一个模型，
顺序矛盾的票记 noise（与 ab_aspect 的口径一致）。

用法：
  uv run python llm_pair_judge.py --round-a v17 --round-b v18c --aspects deception,overall
  uv run python llm_pair_judge.py --round-a v17 --round-b v18c --prep-only   # 只生成载荷
结果：work/llmab/payloads/{stem}.{ver}.txt + work/llmab/{tag}/{stem}.{aspect}.json
"""
from __future__ import annotations

import paths
import argparse
import json
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

ASPECTS = {
    "deception": "迷惑性（错误选项是否都有真实吸引力、需要动脑排除；正确项是否不显眼、不能靠表面特征猜出）",
    "overall": "作为错题迁移练习的整体可用性（题面质量、语篇自然度、答案解析的可读与可用）",
    "causefit": "错因贴合（所有题是否都紧贴给定的本质错因、按旧习惯做会掉进陷阱；有没有哪题跑偏成别的考点的题）",
    "natural": "语篇自然度（语篇读起来是否像自然叙事或真实语料，而不是为了证明答案而拼装的）",
    "transfer": "迁移真实性（题与原题、题与题之间是否真的不同；有没有换皮或同义转述）",
}


def load_config() -> dict:
    return json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))


def slim(round_name: str, stem: str, cause: str) -> str | None:
    f = paths.outputs_dir() / round_name / f"{stem}.md"
    if not f.exists():
        return None
    md = f.read_text(encoding="utf-8")
    i = md.find("## 三、迁移题")
    body = md[i:] if i > 0 else md
    return "（两份题组针对的本质错因：" + cause + "）\n\n" + body


def call_llm(cfg: dict, model: str, prompt: str) -> dict | None:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": cfg.get("judge_max_tokens", 8192), "stream": False}
    for attempt in range(3):
        try:
            with httpx.Client(timeout=240) as client:
                resp = client.post(cfg["base_url"].rstrip("/") + "/chat/completions",
                                   headers={"Authorization": f"Bearer {cfg['api_key']}"}, json=body)
                if resp.status_code >= 500:
                    time.sleep(2 * (attempt + 1))
                    continue
                resp.raise_for_status()
                text = resp.json()["choices"][0]["message"]["content"] or ""
                m = re.search(r"\{[^{}]*\}", text, re.S)
                if m:
                    try:
                        d = json.loads(m.group(0))
                        if d.get("pick") in ("A", "B", "tie"):
                            return d
                    except json.JSONDecodeError:
                        pass
                return None
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return None


def judge_pair(cfg: dict, tag: str, stem: str, aspect: str, model: str,
               pa: Path, pb: Path, ra: str, rb: str) -> dict:
    out_dir = paths.work_dir() / "llmab" / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}.{aspect}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    ta, tb = pa.read_text(encoding="utf-8"), pb.read_text(encoding="utf-8")

    def one(first_is_a: bool) -> str | None:
        va, vb = (ta, tb) if first_is_a else (tb, ta)
        prompt = (
            f"你是英语命题审题人。下面两份匿名错题迁移练习（版本 A 与版本 B）针对同一个本质错因、"
            f"由不同方案生成。只评一个维度：【{ASPECTS[aspect]}】。\n\n"
            f"只输出一行 JSON：{{\"pick\": \"A\"|\"B\"|\"tie\", \"reason\": \"不超过25字的理由\"}}\n\n"
            f"【版本 A】\n{va}\n\n【版本 B】\n{vb}")
        d = call_llm(cfg, model, prompt)
        if not d:
            return None
        pick = d["pick"]
        if pick == "tie":
            return "tie"
        return ra if pick == "A" else rb

    r1 = one(True)
    time.sleep(0.5)
    r2 = one(False)
    if r1 is None or r2 is None:
        verdict = "error"
    elif r1 == "tie" or r2 == "tie":
        verdict = r1 if r1 == r2 else "noise"
    elif r1 == r2:
        verdict = r1
    else:
        verdict = "noise"
    rec = {"stem": stem, "aspect": aspect, "model": model,
           "order1": r1, "order2": r2, "verdict": verdict}
    out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round-a", default="v17")
    ap.add_argument("--round-b", default="v18c")
    ap.add_argument("--aspects", default="deception,overall")
    ap.add_argument("--counts", default="1,3,5,10")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--prep-only", action="store_true")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)

    cfg = load_config()
    pool = cfg.get("judge_pool") or [cfg.get("judge_model") or cfg["model"]]
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    counts = [int(c) for c in args.counts.split(",")]

    pay_dir = paths.work_dir() / "llmab" / "payloads"
    pay_dir.mkdir(parents=True, exist_ok=True)
    jobs, pairs = [], []
    for cid in cases:
        for n in counts:
            stem = f"{cid}_q{n:02d}"
            ta = slim(args.round_a, stem, cases[cid]["cause"])
            tb = slim(args.round_b, stem, cases[cid]["cause"])
            if not ta or not tb:
                continue
            pa = pay_dir / f"{stem}.{args.round_a}.txt"
            pb = pay_dir / f"{stem}.{args.round_b}.txt"
            pa.write_text(ta, encoding="utf-8")
            pb.write_text(tb, encoding="utf-8")
            for asp in [a.strip() for a in args.aspects.split(",") if a.strip()]:
                model = random.choice(pool)
                pairs.append((stem, asp, model))
                jobs.append((cfg, f"{args.round_a}-vs-{args.round_b}", stem, asp, model, pa, pb,
                             args.round_a, args.round_b))
    print(f"载荷就绪：{len(list(pay_dir.glob('*.txt')))} 个文件；评审任务 {len(jobs)} 组")
    if args.prep_only:
        print("（--prep-only：不调用模型）")
        for stem, asp, model in pairs:
            print(f"  {stem} {asp} -> {model}")
        return

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as poolx:
        futures = [poolx.submit(judge_pair, *j) for j in jobs]
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  失败: {e}")

    print(f"\n== 汇总（{args.round_a} vs {args.round_b}，池内 LLM 直评，只认正反一致票）==")
    for asp in [a.strip() for a in args.aspects.split(",") if a.strip()]:
        rs = [r for r in results if r["aspect"] == asp]
        wa = sum(1 for r in rs if r["verdict"] == args.round_a)
        wb = sum(1 for r in rs if r["verdict"] == args.round_b)
        noise = sum(1 for r in rs if r["verdict"] in ("noise", "error"))
        n_dec = wa + wb
        line = f"  {asp:<10}: {args.round_a} {wa} / {args.round_b} {wb} / 顺序矛盾 {noise}"
        if n_dec:
            from math import comb
            k = min(wa, wb)
            p = min(1.0, sum(comb(n_dec, i) for i in range(k + 1)) * 2 / 2 ** n_dec)
            line += f"  | p={p:.3f}"
        print(line)


if __name__ == "__main__":
    main()
