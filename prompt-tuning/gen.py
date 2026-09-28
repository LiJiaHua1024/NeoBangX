"""批量生成迁移题：渲染 prompt 模板 + 调用 deepseek/deepseek-flash。

用法：
  uv run python gen.py --round v0 --prompt "../prompts/智能错题迁移.md" --counts 1,3,5,10
  uv run python gen.py --round v2 --prompt "prompts_v2/v2.md" --counts 1,3,5,10 --cases c1_reading_inference
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

HERE = Path(__file__).parent


def load_config() -> dict:
    cfg = json.loads((HERE / "api_config.json").read_text(encoding="utf-8"))
    for key in ("base_url", "api_key", "model"):
        if not cfg.get(key):
            sys.exit(f"api_config.json 缺少 {key}")
    return cfg


def compose_user_input(case: dict, count: int) -> str:
    """完全复刻前端 migrationBuildInput 的拼装格式。"""
    return "\n".join([
        "【原题干】",
        case["question"].strip(),
        "",
        "【标准答案】",
        case["standard_answer"].strip(),
        "",
        "【学生错误作答 / 错误选项分布】",
        case["student_answers"].strip(),
        "",
        "【已经确认的本质错因】",
        case["cause"].strip(),
        "",
        "【迁移题量】",
        str(count),
        "",
        "请严格围绕这一个本质错因完成全部四个部分。",
    ])


def render_prompt(template: str, user_input: str) -> str:
    return template.replace("{{user_input}}", user_input)


def call_llm(cfg: dict, prompt: str) -> tuple[str, dict]:
    body = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": cfg.get("max_tokens", 8192),
        "stream": False,
    }
    last_err = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=300) as client:
                resp = client.post(
                    cfg["base_url"].rstrip("/") + "/chat/completions",
                    headers={"Authorization": f"Bearer {cfg['api_key']}"},
                    json=body,
                )
                if resp.status_code >= 500:
                    last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
                    time.sleep(3 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                choice = data["choices"][0]
                meta = {
                    "finish_reason": choice.get("finish_reason"),
                    "usage": data.get("usage"),
                    "model": data.get("model"),
                }
                return choice["message"]["content"], meta
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(3 * (attempt + 1))
        except httpx.HTTPStatusError as e:
            last_err = f"HTTP {e.response.status_code}: {e.response.text[:300]}"
            if e.response.status_code == 400:
                break  # 请求本身有问题，重试无意义
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"调用失败（重试 3 次后）：{last_err}")


def run_one(cfg: dict, prompt_file: Path, case_id: str, case: dict, count: int, out_dir: Path) -> dict:
    stem = f"{case_id}_q{count:02d}"
    out_file = out_dir / f"{stem}.md"
    meta_file = out_dir / f"{stem}.meta.json"
    if out_file.exists() and meta_file.exists():
        return {"stem": stem, "skipped": True}

    template = prompt_file.read_text(encoding="utf-8")
    prompt = render_prompt(template, compose_user_input(case, count))
    t0 = time.time()
    output, meta = call_llm(cfg, prompt)
    meta.update({"case": case_id, "count": count, "elapsed_s": round(time.time() - t0, 1),
                 "prompt_chars": len(prompt)})
    out_file.write_text(output, encoding="utf-8")
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"stem": stem, "skipped": False, "elapsed_s": meta["elapsed_s"],
            "finish_reason": meta["finish_reason"], "out_chars": len(output)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True, help="轮次名，也是输出子目录名")
    ap.add_argument("--prompt", required=True, help="prompt 模板文件路径")
    ap.add_argument("--counts", default="1,3,5,10", help="逗号分隔的题量档位")
    ap.add_argument("--cases", default="all", help="逗号分隔的案例 ID，或 all")
    args = ap.parse_args()

    cfg = load_config()
    prompt_file = Path(args.prompt).resolve()
    if not prompt_file.exists():
        sys.exit(f"prompt 文件不存在：{prompt_file}")
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]
    counts = [int(c) for c in args.counts.split(",")]
    out_dir = HERE / "outputs" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs = [(cfg, prompt_file, cid, cases[cid], n, out_dir) for cid in case_ids for n in counts]
    print(f"共 {len(jobs)} 个生成任务 → {out_dir}")
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(run_one, *job): job[2] for job in jobs}
        for fut in as_completed(futures):
            try:
                r = fut.result()
                results.append(r)
                flag = "跳过(已存在)" if r.get("skipped") else \
                    f"{r['elapsed_s']}s finish={r['finish_reason']} {r['out_chars']}字"
                print(f"  [{futures[fut]}] {r['stem']}: {flag}")
            except Exception as e:  # noqa: BLE001
                print(f"  [{futures[fut]}] 失败: {e}")
                results.append({"stem": "?", "error": str(e)})
    ok = sum(1 for r in results if not r.get("error"))
    print(f"完成 {ok}/{len(jobs)}")


if __name__ == "__main__":
    main()
