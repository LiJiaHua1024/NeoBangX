"""窄问题评分（Jev decisions 接口，仅 jev-latest）：阅读文本改编 / 阅读理解设问。

把"这份产物好不好"拆成看一眼就能判定的 noul 二值问题；设问侧含迷惑性四项
（trap_attractive / hesitation / no_absurd / shape_giveaway——防"对的太对、错的太错"）。

用法：
  uv run python suite_score.py --round v0 --suite 阅读理解设问
结果：work/score_jev/<round>/*.json + 汇总均值
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


def noul(instructions: str, yes: str, no: str) -> dict:
    return {"type": "noul", "instructions": instructions, "criteria": {"true": yes, "false": no}}


RQ_CHECKS = {
    "answer_unique": ("标注的正确答案是否唯一，没有第二个同样站得住的选项？", "唯一无争议", "存在双解或争议"),
    "trap_attractive": ("干扰项对只掌握一半知识的学生是否有真实吸引力（选错时会真的选到它们）？", "有真实吸引力", "一眼能排除"),
    "hesitation": ("做这道题时是否需要在两个选项之间权衡犹豫，而不是一眼定案？", "需要犹豫权衡", "一眼定案"),
    "no_absurd": ("四个选项是否都在认真作答的范围内（没有一眼荒谬、纯凑数的错误选项）？", "无荒谬凑数项", "存在一眼荒谬项"),
    "shape_giveaway": ("如果不懂文章，能否只靠选项表面特征（正确项更长、绝对化词、措辞复述原文）认出正确项？", "能靠表面认出", "认不出"),
    "evidence_ok": ("答案与解析引用的文本证据是否与语篇原文一致（没有张冠李戴、编造细节）？", "证据一致", "证据有错"),
    "target_fit": ("题目的难度是否来自语篇理解能力本身（词汇句式都在高中常规范围内）？", "难度来源正确", "靠生词/偏背景"),
}
RQ_INVERTED = {"shape_giveaway"}

RA_CHECKS = {
    "structure_ok": ("改编后文本是否结构完整（有引入、展开、收束，段落逻辑清楚，不是碎片拼接）？", "结构完整", "结构有缺"),
    "main_kept": ("删减是否保住了语篇主线（核心事件/论点/逻辑链都在，只删了枝节）？", "主线完整", "主线有损"),
    "authentic_nat": ("词块/词性活用/合成词等真实化改造是否自然地道（不是为改造而改造的生硬堆砌）？", "自然地道", "生硬堆砌"),
    "in_context": ("每个改造点是否都能靠上下文推断出含义（适合出词义猜测题）？", "均可推断", "有推不出的"),
    "diff_fit": ("难度是否适合高中生（没有超出高中范围的真生僻词或超纲背景）？", "难度合适", "有超纲难点"),
    "culture_kept": ("文化内涵词是否保留得当、必要注释的格式是否规范（词与括号间有空格）？", "保留得当", "有缺失"),
    "expl_ok": ("改编说明、改造清单、命题建议是否与实际文本一致（没说错改了什么）？", "一致", "有不一致"),
}
RA_INVERTED: set[str] = set()


def ask(cfg: dict, state: str, questions: dict) -> dict:
    body = {"model": cfg["model"], "state": state, "questions": questions}
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    last = None
    for attempt in range(4):
        try:
            with httpx.Client(timeout=120) as client:
                r = client.post(cfg["base_url"], headers=headers, json=body)
            if r.status_code == 200:
                return r.json().get("answers", {})
            last = f"HTTP {r.status_code}: {r.text[:200]}"
            if r.status_code == 400:
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Jev 调用失败: {last}")


def noul_value(ans: dict) -> float | None:
    a = ans if isinstance(ans, dict) else {}
    v = a.get("noul")
    return float(v) if v is not None else None

def rq_units(md: str) -> list[tuple[str, str]]:
    """设问：切成 [(unit_id, 题块文本)]，题块含题干+选项+逐题说明。"""
    units = []
    for tag in ("A", "B"):
        body = mc.version_body(md, tag)
        cur_id, cur = None, []
        for raw in body.splitlines():
            l = raw.lstrip("# *- ").strip()
            m_ans = re.match(r"(\d+)[\.、]\s*答案[:：]?\s*([A-D])", l)
            m = re.match(r"(\d+)[\.、]\s*", l)
            m_id = re.match(r"^([AB])(\d+)$", l)
            om = re.match(r"\*{0,2}([A-D])\*{0,2}[\.、．。):：]\s*", l)
            if m_ans:
                if cur_id:
                    cur.append(raw)
            elif (m and not om) or m_id:
                if cur_id:
                    units.append((cur_id, "\n".join(cur)))
                num = m.group(1) if (m and not om) else m_id.group(2)
                cur_id, cur = f"v{tag}q{num}", [raw]
            elif cur_id:
                cur.append(raw)
        if cur_id:
            units.append((cur_id, "\n".join(cur)))
    return [u for u in units if len(u[1]) > 60]


def score_one(cfg, out_file, out_dir, stem, unit_id, state, checks, inverted, tag=""):
    out = out_dir / f"{stem}{tag}.{unit_id}.json"
    if out.exists():
        return json.loads(out.read_text(encoding="utf-8"))
    questions = {k: noul(*v) for k, v in checks.items()}
    answers = ask(cfg, state, questions)
    rec = {"stem": stem, "unit": unit_id,
           "scores": {k: noul_value(answers.get(k)) for k in checks}}
    out.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--workers", type=int, default=4)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cfg = json.loads(paths.config_file("jev_config.json").read_text(encoding="utf-8"))
    if cfg.get("model") != "jev-latest":
        raise SystemExit("只允许 jev-latest")
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    is_ra = paths.suite() == "阅读文本改编"
    checks, inverted = (RA_CHECKS, RA_INVERTED) if is_ra else (RQ_CHECKS, RQ_INVERTED)
    out_dir = paths.work_dir() / "score_jev" / args.round
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs, labels = [], []
    for f in sorted((paths.outputs_dir() / args.round).glob("*.md")):
        stem = f.stem
        case_id = stem.split("_q")[0]
        material = cases.get(case_id, {}).get("material", "")
        md = f.read_text(encoding="utf-8")
        if is_ra:
            state = f"【原始素材】\n{material}\n\n【教师的改编产物】\n{md}"
            jobs.append((cfg, f, out_dir, stem, "all", state, checks, inverted))
            labels.append(stem)
        else:
            for unit_id, block in rq_units(md):
                state = f"【语篇】\n{material}\n\n【本题（含选项与标注答案、解析）】\n{block}"
                jobs.append((cfg, f, out_dir, stem, unit_id, state, checks, inverted))
                labels.append(f"{stem}.{unit_id}")
    print(f"评分任务 {len(jobs)} 个（{paths.suite()} / {args.round}）")
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(score_one, *j): lb for j, lb in zip(jobs, labels)}
        for fut in as_completed(futs):
            try:
                rec = fut.result()
                results.append(rec)
                s = rec["scores"]
                bad = [k for k, v in s.items() if v is not None and ((v < 0.5) != (k in inverted))]
                flag = "✅" if not bad else "⚠ " + ",".join(bad)
                print(f"  {futs[fut]}: {flag}")
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut]}: 失败 {e}")

    print(f"\n== 汇总（noul 均值；反向项已标注 ↓，越低越好）==")
    for k in checks:
        vals = [r["scores"][k] for r in results if r["scores"].get(k) is not None]
        if vals:
            mark = " ↓反向" if k in inverted else ""
            good = sum(1 for v in vals if (v < 0.5 if k in inverted else v >= 0.5))
            print(f"  {k:<15}: {sum(vals)/len(vals):.2f}  达标 {good}/{len(vals)}{mark}")


if __name__ == "__main__":
    main()