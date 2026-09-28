"""盲测解题：把生成结果里的迁移题抽出来（不含答案），让同一个模型独立作答，
再与生成结果自带的答案比对——不一致说明答案有问题或题目有歧义。

用法：
  uv run python solve.py --round v0
结果写入 work/solve_{round}.json，并在终端打印差异摘要。
"""
from __future__ import annotations

import paths
import argparse
import json
import random
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from qparse import (answer_matches, extract_key, extract_question_block,
                    is_multi_blank, item_num, section_text, split_items)

HERE = Path(__file__).parent


def load_config() -> dict:
    return json.loads(paths.config_file("api_config.json").read_text(encoding="utf-8"))


def section_text(md: str, start_heading: str) -> str:
    idx = md.find(start_heading)
    if idx < 0:
        return ""
    body = md[idx + len(start_heading):]
    nxt = body.find("\n## ")
    return body[:nxt] if nxt >= 0 else body


def split_items(section: str) -> list[str]:
    lines = section.splitlines()
    starts = [i for i, ln in enumerate(lines)
              if re.match(r"^\s*\**\s*(?:第\s*)?(\d{1,2})\s*(?:题)?\s*[.、．:]", ln)
              or re.match(r"^\s*\**\s*(?:第\s*)?(\d{1,2})\s*题\s*\**\s*$", ln)
              or re.match(r"^\s*\**(\d{1,2})\**\s*$", ln)]
    blocks = []
    for k, i in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(lines)
        blocks.append("\n".join(lines[i:end]))
    return blocks


def extract_question_block(block: str) -> str | None:
    """取题干+选项（用于盲测），丢弃解析文字。"""
    lines = block.splitlines()
    out = [lines[0]]
    for ln in lines[1:]:
        if re.match(r"^\s*[A-G]\s*[.、．]", ln):
            out.append(ln.strip())
        elif re.match(r"^\s*\d{1,2}\s*[.、．]", ln):
            break
        else:
            # 题干行：遇到明显解析性内容（长中文说明）就停
            if len(re.sub(r"[A-Za-z0-9 .,'\"()\-_？?！!,.;:。；：、\n]", "", ln)) > 40:
                break
            out.append(ln)
    return "\n".join(out).strip() or None


def extract_key(block: str) -> str:
    """从答案+解析块里抠出标准答案（第一行）。"""
    first = block.splitlines()[0].strip()
    m = re.match(r"^\s*\**\s*(\d{1,2})\s*[.、．]\s*\**\s*(.+)$", first)
    return (m.group(2) if m else first).strip()


SOLVER_PROMPT = """你是高中英语学习者。下面每道题都标有 num= 编号，题干完整。请独立作答全部题目。只依据题目本身判断，不要猜测出题人意图，不要参考任何"标准答案"。
全部作答后，只输出 JSON（不要其他文字），num 必须使用题目标注的编号：
{"answers":[{"num":1,"answer":"B","brief":"一句话理由"}]}

题目：
"""


def call_llm(cfg: dict, prompt: str) -> str:
    pool = cfg.get("judge_pool") or [cfg.get("judge_model") or cfg["model"]]
    body = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": cfg.get("judge_max_tokens", 32768),
        "stream": False,
    }
    last_err = None
    for attempt in range(3):
        model = random.choice(pool)  # 每次盲测随机抽模型，避免单一家族的解题偏好
        body["model"] = model
        try:
            with httpx.Client(timeout=300) as client:
                resp = client.post(
                    cfg["base_url"].rstrip("/") + "/chat/completions",
                    headers={"Authorization": f"Bearer {cfg['api_key']}"},
                    json=body,
                )
                if resp.status_code >= 500:
                    last_err = f"HTTP {resp.status_code}"
                    import time
                    time.sleep(3 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            last_err = f"HTTP {e.response.status_code}"
            import time
            time.sleep(3 * (attempt + 1))
        except (httpx.TimeoutException, httpx.TransportError) as e:
            last_err = f"{type(e).__name__}: {e}"
            import time
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"盲测调用失败（重试 3 次后）：{last_err}")


def parse_solver(raw: str) -> dict[int, dict]:
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}
    out = {}
    for item in data.get("answers", []):
        try:
            out[int(item["num"])] = {"answer": str(item.get("answer", "")).strip(),
                                     "brief": str(item.get("brief", "")).strip()}
        except (TypeError, ValueError):
            continue
    return out


def norm_key(key: str) -> list[str]:
    """把标准答案拆成可接受的变体列表。"""
    k = re.sub(r"[`*_\s]+", " ", key).strip().lower()
    variants = [k]
    for sep in ("/", "或", "；", ";", "、"):
        if sep in k:
            variants = [v.strip(" .。") for v in k.split(sep)]
            break
    return [v for v in variants if v]


def answer_matches(solver_ans: str, key: str) -> bool:
    sa = solver_ans.strip().lower()
    if not sa or not key:
        return False
    # 字母答案
    km = re.match(r"^([a-g])\b", norm_key(key)[0]) if norm_key(key) else None
    sm = re.match(r"^([a-g])\b", sa)
    if km and sm:
        return km.group(1) == sm.group(1)
    if km and not sm:
        return False
    # 文本答案：solver 的答案要命中某个变体
    for v in norm_key(key):
        if v and (v in sa or sa in v):
            return True
    return False


def solve_file(cfg: dict, md_file: Path, cases: dict) -> dict | None:
    md = md_file.read_text(encoding="utf-8")
    case_id = md_file.stem.rsplit("_q", 1)[0]
    if case_id not in cases:
        return None
    q_sec = section_text(md, "## 三、迁移题")
    a_sec = section_text(md, "## 四、答案 + 解析")
    q_blocks = split_items(q_sec)
    a_blocks = split_items(a_sec)
    if not q_blocks:
        return {"stem": md_file.stem, "error": "没解析到题目"}
    blind: list[tuple[int, str]] = []
    keys: dict[int, str] = {}
    for qb in q_blocks:
        num = item_num_of(qb)
        if num is None:
            continue
        extracted = extract_question_block(qb)
        if extracted:
            blind.append((num, extracted))
    # 答案区无编号时（常见于单题输出）：把首个非空行当作全部题目的答案
    if not a_blocks and q_blocks:
        first = next((ln for ln in a_sec.splitlines() if ln.strip()), "")
        for qb in q_blocks:
            num = item_num_of(qb)
            if num is not None:
                keys[num] = extract_key("\n" + first)
    for ab in a_blocks:
        num = item_num_of(ab)
        if num is not None:
            keys[num] = extract_key(ab)
    if not keys:
        return {"stem": md_file.stem, "error": "没解析到答案"}
    if is_multi_blank(q_sec):
        # 多空语篇：整段三区发给盲测模型，让它按题号逐空作答
        import re as _re
        clean = _re.sub(r"\*\*|__|`", "", q_sec).strip()
        prompt_items = "（下面这组题里有带编号空白的多空语篇：空白编号即题号，选项池共享；另有独立小题。请按题号全部作答）\n\n" + clean
    else:
        prompt_items = "\n\n".join(f"【num={num}】\n{text}" for num, text in sorted(blind))
    raw = call_llm(cfg, SOLVER_PROMPT + prompt_items)
    solved = parse_solver(raw)
    rows = []
    for num, key in sorted(keys.items()):
        s = solved.get(num)
        ans = (s or {}).get("answer", "").strip()
        comparable = bool(key and ans)
        rows.append({
            "num": num,
            "key": key,
            "solver": ans,
            "solver_brief": (s or {}).get("brief", ""),
            "match": (answer_matches(ans, key) if comparable else None),
        })
    return {"stem": md_file.stem, "rows": rows, "raw_solver": raw[:2000]}


def item_num_of(block: str) -> int | None:
    lines = block.splitlines()
    return item_num(lines[0]) if lines else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cfg = load_config()
    out_dir = paths.outputs_dir() / args.round
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    files = sorted(out_dir.glob("*.md"))
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(solve_file, cfg, f, cases): f for f in files}
        for fut in as_completed(futures):
            f = futures[fut]
            try:
                r = fut.result()
                if r:
                    results.append(r)
                    bad = [row for row in r["rows"] if row["match"] is False]
                    print(f"  [{f.name}] {len(r['rows'])} 题, 不一致 {len(bad)}")
            except Exception as e:  # noqa: BLE001
                print(f"  [{f.name}] 失败: {e}")
    (paths.work_dir()).mkdir(exist_ok=True)
    out = paths.work_dir() / f"solve_{args.round}.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(r.get("rows", [])) for r in results)
    mism = sum(1 for r in results for row in r.get("rows", []) if row["match"] is False)
    print(f"\n共 {total} 题盲测，与所附答案不一致 {mism} 题 → {out}")


if __name__ == "__main__":
    main()
