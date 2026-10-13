"""judge 实锤问题评审：池内模型按 suite 专属 rubric 找「实锤问题」，输出 P0/P1/P2 清单。

用法：
  uv run python critique.py --round v0 --suite 阅读理解设问 --models opencode-zen/mimo-v2.6-flash-free
结果：work/critique/<round>/<stem>.<model>.json + 汇总。
"""
from __future__ import annotations

import paths
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

RUBRICS = {
    "阅读文本改编": """评判一份「高考阅读文本改编」任务产出，只报**实锤问题**（拿证据、能指认），吹毛求疵和口味偏好一律不报：
- P0：结构缺失（改编后文本/改造说明/命题建议缺块）、英文文本里混入中文段落、词数严重失控（>380 或 <260，短素材例外）
- P1：文本难度明显失控（出现真生僻词且未加注、或低幼化）、改编后语篇结构破碎（无引入/收束、逻辑链断裂）、改造清单与文本对不上（列了没改、改了没列）、说明/命题建议是错的
- P2：个别表达欠地道、个别说明含糊、表格信息冗余
每个问题给一句证据（引用原文片段或指出位置）。没有问题就输出空列表，不要凑数。""",
    "阅读理解设问": """评判一份「双版本阅读理解命题」任务产出，只报**实锤问题**（拿证据、能指认），吹毛求疵和口味偏好一律不报：
- P0：结构缺失（版本A/B/鉴别指引缺块）、某题不足四个选项、答案缺失
- P1：答案与原文矛盾或在文中找不到证据支撑、某题存在两个可辩护答案（双解）、A/B 两版实质是同一套题的措辞微调、设问落在孤立细节上（数字/人名定位题）、干扰项与正确项长度差异明显可猜答案
- P2：个别干扰项迷惑性弱、个别表述欠清晰
每个问题给一句证据（引用原文片段或指出位置）。没有问题就输出空列表，不要凑数。""",
}


def call_llm(cfg: dict, model: str, prompt: str) -> list:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": cfg.get("judge_max_tokens", 8192), "stream": False}
    for attempt in range(3):
        try:
            with httpx.Client(timeout=240) as client:
                resp = client.post(cfg["base_url"].rstrip("/") + "/chat/completions",
                                   headers={"Authorization": f"Bearer {cfg['api_key']}"},
                                   json=body)
                if resp.status_code in (429, 500, 502, 503):
                    time.sleep(5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                text = resp.json()["choices"][0]["message"]["content"] or ""
                m = re.search(r"\[[\s\S]*\]", text)
                if m:
                    try:
                        items = json.loads(m.group(0))
                        return [i for i in items if isinstance(i, dict) and i.get("sev") in ("P0", "P1", "P2")]
                    except json.JSONDecodeError:
                        pass
                return []
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--models", default="", help="逗号分隔；默认 ling + mimo")
    ap.add_argument("--cases", default="all")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)

    cfg = json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))
    models = ([m.strip() for m in args.models.split(",") if m.strip()]
              or ["opencode-zen/ling-3.1-flash-free", "opencode-zen/mimo-v2.6-flash-free"])
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    out_dir = paths.outputs_dir() / args.round
    work = paths.work_dir() / "critique" / args.round
    work.mkdir(parents=True, exist_ok=True)
    rubric = RUBRICS.get(paths.suite(), RUBRICS["阅读理解设问"])

    jobs = []
    for f in sorted(out_dir.glob("*.md")):
        cid = f.stem.split("_q")[0]
        if args.cases != "all" and cid not in args.cases.split(","):
            continue
        material = cases.get(cid, {}).get("material", "")
        output = f.read_text(encoding="utf-8")
        prompt = (f"{rubric}\n\n# 语篇素材\n{material}\n\n# 任务产出\n{output}\n\n"
                  f'只输出 JSON 列表：[{{"sev":"P0|P1|P2","where":"位置","desc":"问题+证据（一句）"}}]')
        for model in models:
            jobs.append((f.stem, model, prompt))

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(call_llm, cfg, m, p): (s, m) for s, m, p in jobs}
        for fut in as_completed(futs):
            stem, model = futs[fut]
            issues = fut.result()
            (work / f"{stem}.{model.split('/')[-1]}.json").write_text(
                json.dumps(issues, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append({"stem": stem, "model": model, "issues": issues})
            print(f"  {stem} {model.split('/')[-1]}: {len(issues)} 个问题")

    print(f"\n== critique {args.round} ==")
    for sev in ("P0", "P1", "P2"):
        n = sum(1 for r in results for i in r["issues"] if i["sev"] == sev)
        print(f"  {sev}: {n}")
    for r in results:
        for i in r["issues"]:
            if i["sev"] in ("P0", "P1"):
                print(f"  [{i['sev']}] {r['stem']} {r['model'].split('/')[-1]}: "
                      f"{i.get('where', '')} {i.get('desc', '')[:80]}")
    print("明细 work/critique/")


if __name__ == "__main__":
    main()
