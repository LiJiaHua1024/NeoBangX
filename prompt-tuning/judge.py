"""多视角评审：教师命题人 + 三类学生人设，全部直接调用 API（评审用不同家族模型防自我偏好）。

用法：
  uv run python judge.py --round v0 --teacher --students
  uv run python judge.py --round v2 --teacher --cases c1_reading_inference,c6_grammar_tense
结果写入 work/judge_{round}/，终端打印汇总。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

HERE = Path(__file__).parent
JUDGE_DIR = HERE / "work" / "judges"

PERSONAS = {
    "struggler": {
        "name": "基础薄弱生",
        "hint": "你的英语考试常年 60-70 分（满分 150）",
        "detail": "高考3500词你大概只认识一半；做题全靠找原文里出现过的词；看到三个从句以上的句子直接放弃精读；对'看起来专业/完整'的选项有莫名的信任感；近迁移（和你错过的题长得像的题）会让你安心，但换汤不换药的题你觉得没意思。"
    },
    "average": {
        "name": "中等生",
        "hint": "你英语稳定在 100 分左右",
        "detail": "3500词基本认识，长难句能拆但费劲；你积累了一套应试直觉：太绝对的选项（all/never/only）通常是错的、和原文用词一样多的选项往往是陷阱、语气最严谨完整的选项往往是对的；你做对题常常说不清为什么，凭语感。"
    },
    "ace": {
        "name": "学霸",
        "hint": "你英语常考 135+",
        "detail": "词汇语法扎实，警觉性极高，会主动怀疑'太顺的题'；你见过大量套路：原词复现陷阱、绝对化选项、过度推断；如果一道题被你 10 秒内秒杀且答案毫无悬念，你会认定它是烂题；只有让你犹豫过、或者第一次选错然后发现陷阱的题，你才承认有质量。"
    },
}


def load_config() -> dict:
    return json.loads((HERE / "api_config.json").read_text(encoding="utf-8"))


def call_llm(cfg: dict, model: str, prompt: str, max_tokens: int) -> tuple[str, str]:
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens, "stream": False}
    last_err = None
    for attempt in range(4):
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
                data = resp.json()
                choice = data["choices"][0]
                return choice["message"]["content"], choice.get("finish_reason", "?")
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"调用失败：{last_err}")


def extract_json(text: str) -> dict | None:
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    candidates = [m.group(1)] if m else []
    candidates.append(text)
    for c in candidates:
        try:
            return json.loads(c.strip())
        except json.JSONDecodeError:
            continue
    # 宽松兜底：找第一个 { 到最后一个 }
    i, j = text.find("{"), text.rfind("}")
    if 0 <= i < j:
        try:
            return json.loads(text[i:j + 1])
        except json.JSONDecodeError:
            return None
    return None


def pick_judge_model(cfg: dict) -> str:
    """每个评审任务从可用池随机抽模型：面板更多样，也避免单一家族的系统性偏好。"""
    pool = cfg.get("judge_pool") or [cfg.get("judge_model") or cfg["model"]]
    return random.choice(pool)


def judge_teacher(cfg: dict, case_id: str, case: dict, out_file: Path, round_name: str) -> dict:
    template = (JUDGE_DIR / "teacher_judge.md").read_text(encoding="utf-8")
    output = out_file.read_text(encoding="utf-8")
    case_text = json.dumps(case, ensure_ascii=False, indent=2)
    prompt = (template.replace("{case_file}", "（内嵌如下）")
              .replace("{output_file}", "（内嵌如下）")
              + "\n\n<案例文件>\n" + case_text + "\n</案例文件>\n\n<生成结果>\n" + output + "\n</生成结果>")
    model = pick_judge_model(cfg)
    raw, finish = call_llm(cfg, model, prompt, cfg["judge_max_tokens"])
    verdict = extract_json(raw)
    return {"stem": out_file.stem, "judge": "teacher", "model": model, "finish": finish,
            "verdict": verdict, "raw_len": len(raw)}


def judge_student(cfg: dict, persona_key: str, case: dict, blind_file: Path) -> dict:
    persona = PERSONAS[persona_key]
    template = (JUDGE_DIR / "student_judge.md").read_text(encoding="utf-8")
    blind = blind_file.read_text(encoding="utf-8")
    prompt = (template.replace("{persona}", persona["name"])
              .replace("{persona_hint}", persona["hint"])
              .replace("{persona_detail}", persona["detail"])
              .replace("{blind_file}", "（内嵌如下）")
              + "\n\n<你的原题>\n" + case["question"] + "\n</你的原题>\n\n<迁移练习>\n" + blind + "\n</迁移练习>")
    model = pick_judge_model(cfg)
    raw, finish = call_llm(cfg, model, prompt, cfg["judge_max_tokens"])
    verdict = extract_json(raw)
    return {"stem": blind_file.stem, "judge": f"student_{persona_key}", "model": model,
            "finish": finish, "verdict": verdict, "raw_len": len(raw)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--cases", default="all")
    ap.add_argument("--teacher", action="store_true")
    ap.add_argument("--students", action="store_true")
    ap.add_argument("--student-counts", default="", help="人设评审只跑这些题量档位，如 01,05,10；空=全部")
    args = ap.parse_args()
    if not (args.teacher or args.students):
        sys.exit("至少指定 --teacher 或 --students")

    cfg = load_config()
    out_dir = HERE / "outputs" / args.round
    blind_dir = out_dir / "blind"
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    case_ids = list(cases) if args.cases == "all" else [c.strip() for c in args.cases.split(",")]
    result_dir = HERE / "work" / f"judge_{args.round}"
    result_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    for cid in case_ids:
        for md_file in sorted(out_dir.glob(f"{cid}_q*.md")):
            if args.teacher:
                if not (result_dir / f"{md_file.stem}.teacher.json").exists():
                    jobs.append(("teacher", cid, md_file, md_file))
            if args.students:
                counts_filter = {c.strip() for c in args.student_counts.split(",") if c.strip()}
                qnum = md_file.stem.rsplit("_q", 1)[1]
                if counts_filter and qnum not in counts_filter:
                    continue
                blind = blind_dir / md_file.name
                if blind.exists():
                    for pk in PERSONAS:
                        if not (result_dir / f"{md_file.stem}.student_{pk}.json").exists():
                            jobs.append((pk, cid, blind, md_file))

    print(f"共 {len(jobs)} 个评审任务（随机模型池：{cfg.get('judge_pool')}）")
    results = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {}
        for kind, cid, src, orig in jobs:
            case = cases[cid]
            if kind == "teacher":
                futures[pool.submit(judge_teacher, cfg, cid, case, src, args.round)] = (kind, orig.name)
            else:
                futures[pool.submit(judge_student, cfg, kind, case, src)] = (kind, orig.name)
        for fut in as_completed(futures):
            kind, name = futures[fut]
            try:
                r = fut.result()
                results.append(r)
                # 逐任务写盘：部分完成也有产出，重跑自动跳过
                (result_dir / f"{r['stem']}.{r['judge']}.json").write_text(
                    json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
                ok = "JSON✓" if r["verdict"] else "JSON✗"
                print(f"  [{kind}] {name}: {ok} ({r['raw_len']}字, finish={r['finish']})")
            except Exception as e:  # noqa: BLE001
                print(f"  [{kind}] {name}: 失败 {e}")

    # 汇总教师评分
    scores = {}
    for r in results:
        if r["judge"] == "teacher" and r["verdict"] and "scores" in (r["verdict"] or {}):
            for d, v in r["verdict"]["scores"].items():
                scores.setdefault(d, []).append(v)
    print("\n教师评审均分（本轮新完成）：")
    for d, vals in sorted(scores.items()):
        print(f"  {d}: {sum(vals) / len(vals):.2f}  (n={len(vals)}, min={min(vals)})")
    print(f"\n明细目录：{result_dir}")


if __name__ == "__main__":
    main()
