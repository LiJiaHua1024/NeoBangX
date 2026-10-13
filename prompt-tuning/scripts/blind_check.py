"""阅读理解设问：盲做一致率（池内模型盲做 A/B 两版，与标注答案比对；一致错=可疑双解/错键）。

用法：
  uv run python blind_check.py --round v0 --suite 阅读理解设问
结果：work/blind/<round>/<stem>.<ver>.<model>.json + 汇总。
"""
from __future__ import annotations

import paths
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

QNUM_RE = re.compile(r"^\s*(\d+)[.、]\s+\S", re.M)
KEY_RE = re.compile(r"答案[^A-Da-d]{0,6}([A-Da-d])")


def split_versions(md: str) -> dict[str, str]:
    m_a = re.search(r"^#+\s*(?:版本\s*)?A\b.*$", md, re.M)
    m_b = re.search(r"^#+\s*(?:版本\s*)?B\b.*$", md, re.M)
    m_j = re.search(r"^#+\s*鉴别指引", md, re.M)
    out = {}
    if m_a:
        out["A"] = md[m_a.start(): m_b.start() if m_b else len(md)]
    if m_b:
        out["B"] = md[m_b.start(): m_j.start() if m_j else len(md)]
    return out


def parse_version(block: str) -> tuple[str, dict[str, str]]:
    """返回（去答案题面，题号→标注答案）。说明行从题面剥离。"""
    parts = re.split(r"(?m)^(?=\s*\d+[.、]\s)", block)
    face, keys = [], {}
    for p in parts:
        m = QNUM_RE.search(p)
        if not m:
            continue
        num = m.group(1)
        lines = p.splitlines()
        keep = []
        for ln in lines:
            if KEY_RE.search(ln) or re.search(r"证据|干扰|为什么错|解析|说明", ln) or ln.lstrip().startswith("|"):
                if num not in keys and KEY_RE.search(ln):
                    keys[num] = KEY_RE.search(ln).group(1).upper()
                continue
            keep.append(ln)
        face.append("\n".join(keep).strip())
        if num not in keys:
            km = KEY_RE.search(p)
            if km:
                keys[num] = km.group(1).upper()
    return "\n\n".join(face), keys


def call_llm(cfg: dict, model: str, prompt: str) -> dict | None:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": cfg.get("judge_max_tokens", 8192), "stream": False}
    for attempt in range(3):
        try:
            with httpx.Client(timeout=240) as client:
                resp = client.post(cfg["base_url"].rstrip("/") + "/chat/completions",
                                   headers={"Authorization": f"Bearer {cfg['api_key']}"},
                                   json=body)
                if resp.status_code == 429:
                    time.sleep(5 * (attempt + 1))
                    continue
                if resp.status_code >= 500:
                    time.sleep(2 * (attempt + 1))
                    continue
                resp.raise_for_status()
                text = resp.json()["choices"][0]["message"]["content"] or ""
                m = re.search(r"\{[^{}]*\}", text, re.S)
                return json.loads(m.group(0)) if m else None
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--models", default="", help="逗号分隔；默认 judge_pool 取前二")
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)

    cfg = json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))
    models = ([m.strip() for m in args.models.split(",") if m.strip()]
              or cfg.get("judge_pool", [])[:2])
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    out_dir = paths.outputs_dir() / args.round
    work = paths.work_dir() / "blind" / args.round
    work.mkdir(parents=True, exist_ok=True)

    jobs = []
    for f in sorted(out_dir.glob("*.md")):
        md = f.read_text(encoding="utf-8")
        material = cases.get(f.stem.split("_q")[0], {}).get("material", "")
        for ver, block in split_versions(md).items():
            face, keys = parse_version(block)
            if not keys:
                continue
            prompt = (f"你是高中生，做下面的英语阅读理解题（每题单选）。先读语篇再作答。\n\n"
                      f"<material>\n{material}\n</material>\n\n{face}\n\n"
                      f'只输出一行 JSON，键为题号、值为选项字母：{{"1":"A","2":"B",...}}')
            for model in models:
                jobs.append((f.stem, ver, model, prompt, keys))

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(call_llm, cfg, m, p): (s, v, m, k) for s, v, m, p, k in jobs}
        for fut in as_completed(futs):
            stem, ver, model, keys = futs[fut]
            ans = fut.result()
            got = {str(k): str(v).upper() for k, v in (ans or {}).items()}
            hit = sum(1 for n, k in keys.items() if got.get(n) == k)
            rec = {"stem": stem, "ver": ver, "model": model, "keys": keys,
                   "answers": got, "hit": hit, "total": len(keys)}
            (work / f"{stem}.{ver}.{model.split('/')[-1]}.json").write_text(
                json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append(rec)
            print(f"  {stem} v{ver} {model.split('/')[-1]}: {hit}/{len(keys)}")

    ok = sum(r["hit"] for r in results)
    tot = sum(r["total"] for r in results)
    print(f"\n== blind {args.round}: 总一致 {ok}/{tot} = {ok / tot:.0%}" if tot else "无数据")
    for ver in ("A", "B"):
        rs = [r for r in results if r["ver"] == ver]
        if rs:
            o = sum(r["hit"] for r in rs)
            t = sum(r["total"] for r in rs)
            print(f"  版本{ver}: {o}/{t} = {o / t:.0%}")
    print("明细 work/blind/")


if __name__ == "__main__":
    main()
