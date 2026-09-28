"""盲测 A/B 对比：两版 prompt 的同案例输出匿名后交评审模型盲选。

用法：
  uv run python ab_test.py --round-a v10 --round-b v11 --counts 5,10 --cases all
每个 (case, count) 组一次调用：随机决定 A/B 顺序（对冲位置偏好），
输出 JSON {"better": "A"|"B"|"tie", ...}。
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

HERE = Path(__file__).parent

PROMPT = """你是高中英语命题教研员。下面有同一款出题工具产出的两份"错题迁移练习"（匿名版 A 和版 B），它们针对同一个错因、同样的题量。请从命题质量角度盲评。

评分维度（每项给 A/B/tie，并给一句理由）：
1. transfer：迁移真实性——题与原题、题与题之间是否真不同（语境、载体、设问、陷阱），有没有换皮或同义转述
2. deception：迷惑性——正确项是否不显眼、干扰项是否有真实的吸引路径、能否凭应试直觉蒙对
3. answers：答案质量——答案是否正确唯一、有没有双解
4. overall：综合哪份更好

先独立把两份的题各做一遍再评。只输出 JSON：
{"transfer": "A|B|tie", "deception": "A|B|tie", "answers": "A|B|tie", "overall": "A|B|tie", "reason": "两三句话的裁决理由"}
"""


def load_config() -> dict:
    return json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))


def call_llm(cfg: dict, model: str, prompt: str, max_tokens: int) -> str:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens, "stream": False}
    last_err = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=240) as client:
                resp = client.post(
                    cfg["base_url"].rstrip("/") + "/chat/completions",
                    headers={"Authorization": f"Bearer {cfg['api_key']}"},
                    json=body)
                if resp.status_code >= 500:
                    last_err = f"HTTP {resp.status_code}"
                    time.sleep(2 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"A/B 调用失败：{last_err}")


def extract_json(text: str) -> dict | None:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def slim(path: Path, cause: str) -> str:
    """盲评载荷瘦身：错因一句话 + 迁移题 + 答案解析（去掉错因展开与方法论）。"""
    md = path.read_text(encoding="utf-8")
    i = md.find("## 三、迁移题")
    body = md[i:] if i > 0 else md
    return "（本题组针对的本质错因：" + cause + "）\n\n" + body


def run_pair(cfg: dict, case_id: str, count: int, fa: Path, fb: Path, out: Path) -> dict:
    import json as _json
    cause = _json.loads(paths.cases_file().read_text(encoding="utf-8"))[case_id]["cause"]
    a = slim(fa, cause)
    b = slim(fb, cause)
    swapped = random.random() < 0.5
    text_a, text_b = (b, a) if swapped else (a, b)
    raw = call_llm(cfg, random.choice(cfg["judge_pool"]),
                   PROMPT + f"\n\n===== 版 A =====\n{text_a}\n\n===== 版 B =====\n{text_b}",
                   cfg["judge_max_tokens"])
    verdict = extract_json(raw) or {}
    # 把 A/B 映射回真实版本
    remap = {"A": ("B" if swapped else "A"), "B": ("A" if swapped else "B")}
    mapped = {k: (remap.get(v, v) if isinstance(v, str) and v in ("A", "B") else v)
              for k, v in verdict.items()}
    result = {"case": case_id, "count": count, "swapped": swapped,
              "verdict": mapped, "raw_len": len(raw)}
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round-a", required=True)
    ap.add_argument("--round-b", required=True)
    ap.add_argument("--counts", default="5,10")
    ap.add_argument("--cases", default="all")
    ap.add_argument("--tag", default="", help="输出子目录名，用于区分不同对比")
    ap.add_argument("--reps", type=int, default=1, help="每对独立评委数（不同模型/顺序）")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cfg = load_config()
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]
    counts = [int(c) for c in args.counts.split(",")]
    out_dir = paths.work_dir() / "ab" / (args.tag or f"{args.round_a}-vs-{args.round_b}")
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    for cid in case_ids:
        for n in counts:
            fa = paths.outputs_dir() / args.round_a / f"{cid}_q{n:02d}.md"
            fb = paths.outputs_dir() / args.round_b / f"{cid}_q{n:02d}.md"
            if not (fa.exists() and fb.exists()):
                continue
            for rep in range(args.reps):
                out = out_dir / f"{cid}_q{n:02d}.r{rep}.json"
                if not out.exists():
                    jobs.append((cid, n, fa, fb, out))
    print(f"A/B 对比任务：{len(jobs)} 组（{args.round_a} vs {args.round_b}）")
    results = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(run_pair, cfg, *j): j[0] for j in jobs}
        for fut in as_completed(futures):
            try:
                r = fut.result()
                results.append(r)
                v = r["verdict"]
                print(f"  {r['case']} q{r['count']:02d}: overall={v.get('overall')} "
                      f"(transfer={v.get('transfer')}, deception={v.get('deception')}, "
                      f"answers={v.get('answers')})")
            except Exception as e:  # noqa: BLE001
                print(f"  [{futures[fut]}] 失败: {e}")
    # 汇总
    tally = {"A": 0, "B": 0, "tie": 0}
    for dim in ("transfer", "deception", "answers", "overall"):
        c = {"A": 0, "B": 0, "tie": 0}
        for r in results:
            c[r["verdict"].get(dim, "tie")] = c.get(r["verdict"].get(dim, "tie"), 0) + 1
        tally[dim] = c
    print("\n汇总（A=" + args.round_a + ", B=" + args.round_b + "）：")
    for dim, c in tally.items():
        print(f"  {dim}: A {c.get('A', 0)} - tie {c.get('tie', 0)} - B {c.get('B', 0)}")


if __name__ == "__main__":
    main()
