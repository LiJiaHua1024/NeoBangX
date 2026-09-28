"""多模型盲做统计：同一批题由池内各模型盲答（不看答案），量化陷阱的实际杀伤率。

用法：uv run python blind_student.py --round v17 --files c1_reading_inference_q10,c2_cloze_verb_q10,c4_sevenchoosefive_q10
结果存 work/student/{round}/{file}.{model}.json，可断点续跑。
"""
from __future__ import annotations
import argparse, json, re, time
from pathlib import Path

import httpx
from hack_check import key_letter
from qparse import item_num, section_text, split_items

HERE = Path(__file__).parent
PROMPT = """你是高中英语学习者，按自己的水平如实作答以下题目。只依据题目判断，不要猜出题人意图。
只输出 JSON：{"answers":{"1":"B","2":"C",...}}

材料：
"""


def key_map(round_name: str, stem: str) -> dict[int, str]:
    md = (HERE / "outputs" / round_name / f"{stem}.md").read_text(encoding="utf-8")
    keys = {}
    for ab in split_items(section_text(md, "## 四、答案 + 解析")):
        n = item_num(ab.splitlines()[0]); k = key_letter(ab)
        if n is not None and k:
            keys[n] = k
    return keys


def call(cfg, model, prompt):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 8192, "stream": False}
    last = None
    for _ in range(3):
        try:
            r = httpx.post(cfg["base_url"].rstrip("/") + "/chat/completions",
                           headers={"Authorization": f"Bearer {cfg['api_key']}"},
                           json=body, timeout=300)
            d = r.json()
            if d.get("choices"):
                return d["choices"][0]["message"]["content"]
            last = d
        except Exception as e:
            last = e
        time.sleep(4)
    raise RuntimeError(f"{model}: {last}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--files", required=True, help="逗号分隔，不带 .md")
    ap.add_argument("--models", default="", help="留空用池")
    args = ap.parse_args()
    cfg = json.loads((HERE / "api_config.json").read_text(encoding="utf-8"))
    models = [m for m in args.models.split(",") if m] or cfg["judge_pool"]
    out_dir = HERE / "work" / "student" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)

    for stem in [s.strip() for s in args.files.split(",") if s.strip()]:
        blind = (HERE / "outputs" / args.round / "blind" / f"{stem}.md")
        if not blind.exists():
            print(f"{stem}: 无 blind 文件，跳过"); continue
        keys = key_map(args.round, stem)
        text = blind.read_text(encoding="utf-8")
        for model in models:
            out = out_dir / f"{stem}.{model.replace('/', '_')}.json"
            if out.exists():
                continue
            try:
                raw = call(cfg, model, PROMPT + text)
            except Exception as e:
                print(f"  {stem} [{model}] 失败: {e}"); continue
            m = re.search(r"\{[\s\S]*\}", raw)
            try:
                data = json.loads(m.group(0)) if m else {}
            except Exception:
                data = {}
            ans = {int(k): str(v).strip().upper()[:1] for k, v in (data.get("answers") or {}).items()}
            hit = sum(1 for n, k in keys.items() if ans.get(n) == k)
            rec = {"round": args.round, "file": stem, "model": model,
                   "correct": hit, "total": len(keys),
                   "wrong": sorted(n for n, k in keys.items() if ans.get(n) != k)}
            out.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  {stem} [{model}]: {hit}/{len(keys)}  错题 {rec['wrong']}")


if __name__ == "__main__":
    main()
