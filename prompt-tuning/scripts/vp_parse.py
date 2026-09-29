# -*- coding: utf-8 -*-
"""试卷可视化全解专用：@@TAG@@ 行协议解析器。

协议要点（来自生产 prompt 的输出契约）：
- 标签形如 @@NAME@@：开头恰好两个 @、结尾恰好两个 @；禁止三个及以上 @、禁止冒号/等号收尾
- 单行值标签（值写在同一行）：TOTAL / PAPER / NOTICE / GROUP / Q / QTYPE / PASSAGE_REF
- 多行内容标签（标签独占一行、内容从下一行起）：其余全部
- PASSAGE_DEF 介于两者之间：编号写在标签同一行，正文从下一行起
- END_Q 不取值、独占一行

解析产物 Doc（dict）：
  total/paper/notice/groups/passages/passage_def_order/questions/stray_lines
  issues: [{kind, line, detail}]  格式与顺序问题
  tags: [(name, inline, body, lineno)]  原始标签序列
"""
from __future__ import annotations

import re
import unicodedata

# 单行值标签：值必须与标签同行
VALUE_TAGS = {"TOTAL", "PAPER", "NOTICE", "GROUP", "Q", "QTYPE", "PASSAGE_REF"}
SPECIAL_TAGS = {"PASSAGE_DEF"}          # 值同行 + 正文下一行
NO_VALUE_TAGS = {"END_Q"}               # 不取值

MULTILINE_TAGS = {
    "STEM", "OPTIONS", "ANSWER", "EVIDENCE", "REASON", "DISTRACTOR", "PITFALLS",
    "PATTERN_NAME", "PATTERN_STEPS",
    "TRANSFER_PASSAGE", "TRANSFER_STEM", "TRANSFER_OPTIONS", "TRANSFER_ANSWER", "TRANSFER_EXPL",
    "WRITING_POINTS", "WRITING_OUTLINE", "WRITING_SAMPLE",
}

KNOWN_TAGS = VALUE_TAGS | SPECIAL_TAGS | NO_VALUE_TAGS | MULTILINE_TAGS

# 每道题（笔试题）应有的标签顺序；迁移块这 5 个标签重复 N 次
BASE_SEQ = ["Q", "QTYPE", "PASSAGE_REF", "STEM", "OPTIONS", "ANSWER",
            "EVIDENCE", "REASON", "DISTRACTOR", "PITFALLS",
            "PATTERN_NAME", "PATTERN_STEPS"]
TRANSFER_SEQ = ["TRANSFER_PASSAGE", "TRANSFER_STEM", "TRANSFER_OPTIONS",
                "TRANSFER_ANSWER", "TRANSFER_EXPL"]
WRITING_SEQ = ["WRITING_POINTS", "WRITING_OUTLINE", "WRITING_SAMPLE"]
# 写作题允许出现的可选解析类标签（协议未强制，出现即记录）
WRITING_OPTIONAL = ["EVIDENCE", "REASON", "DISTRACTOR", "PITFALLS", "PATTERN_NAME", "PATTERN_STEPS"]

TAG_RE = re.compile(r"^@@([A-Za-z_][A-Za-z0-9_]*)@@(.*)$")
AT_LINE = re.compile(r"^\s*@")


def norm(text: str) -> str:
    """比对用归一化：NFKC、统一引号、折叠空白、小写。"""
    t = unicodedata.normalize("NFKC", text or "")
    t = t.replace("\u2019", "'").replace("\u2018", "'")
    t = t.replace("\u201c", '"').replace("\u201d", '"')
    t = t.replace("\u2014", "--").replace("\u2013", "-")
    return re.sub(r"\s+", " ", t).strip().lower()


def inline_apostrophes(text: str) -> str:
    """把 ' 还原成 ' 之外的常见写法：仅用于宽松比对。"""
    return text.replace("\u2019", "'")


def longest_common_substr(a: str, b: str) -> int:
    if not a or not b:
        return 0
    if len(a) > len(b):
        a, b = b, a
    prev = [0] * (len(b) + 1)
    best = 0
    for ca in a:
        cur = [0] * (len(b) + 1)
        for j, cb in enumerate(b, 1):
            if ca == cb:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best = cur[j]
        prev = cur
    return best


def _classify(line: str, lineno: int) -> tuple[str, str, str, str | None]:
    """返回 (kind, name, inline, problem)。kind ∈ ok/malformed。"""
    stripped = line.rstrip("\n")
    if not AT_LINE.match(stripped):
        return "content", "", "", None
    lead = len(stripped) - len(stripped.lstrip(" "))
    if stripped[lead:] == "":
        return "content", "", "", None
    m = TAG_RE.match(stripped.strip())
    if not m:
        body = stripped.lstrip()
        if body.startswith("@@"):
            core = body[2:]
            if core.startswith("@"):
                return "malformed", "", "", "标签开头出现三个及以上 @"
            name = re.split(r"[^A-Za-z0-9_]", core, 1)[0]
            sep = core[len(name):]
            if not sep.startswith("@") and "@@" not in core:
                return "malformed", name or "?", "", "标签缺少结尾 @@"
            return "malformed", name or "?", "", f"标签结尾不合法（应为 @@）：…{body[-8:]}"
        return "malformed", "", "", "以单个 @ 开头（应为 @@）"
    name, inline = m.group(1), m.group(2)
    problem = None
    if stripped != stripped.strip():
        problem = "标签行首尾有空格"
    if name not in KNOWN_TAGS:
        problem = f"未知标签名 {name}"
    if name != name.upper():
        problem = f"标签名未大写：{name}"
    if inline[:1] in (":", "="):
        problem = f"{name} 用冒号/等号与内容分隔（应用空格）"
    return "ok", name, inline, problem


def parse(md: str) -> dict:
    lines = md.splitlines()
    doc: dict = {"total": None, "paper": "", "notice": "", "groups": [], "passages": {},
                 "passage_def_order": [], "questions": [], "stray_lines": [],
                 "issues": [], "tags": [], "has_code_fence": False, "raw": md}

    tags: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.strip().startswith("```"):
            doc["has_code_fence"] = True
        kind, name, inline, problem = _classify(line, i + 1)
        if kind == "content":
            i += 1
            continue
        if kind == "malformed":
            doc["issues"].append({"kind": "tag_format", "line": i + 1,
                                  "detail": problem or "标签格式错误", "text": line.strip()[:80]})
            i += 1
            continue
        # 合法标签：收集正文
        body_lines = []
        j = i + 1
        while j < n and not AT_LINE.match(lines[j]):
            body_lines.append(lines[j])
            j += 1
        body = "\n".join(body_lines).strip("\n")
        for bl in body_lines:
            if "@@" in bl:
                doc["issues"].append({"kind": "at_in_content", "line": i + 1,
                                      "detail": f"{name} 正文含 @@（会被误判为标签）",
                                      "text": bl.strip()[:80]})
        tags.append({"name": name, "inline": inline.strip(), "body": body, "line": i + 1})
        i = j

    doc["tags"] = [(t["name"], t["inline"], t["body"], t["line"]) for t in tags]

    # ---- 顶层值 ----
    if tags:
        if tags[0]["name"] != "TOTAL":
            doc["issues"].append({"kind": "order", "line": tags[0]["line"],
                                  "detail": f"首行标签应为 TOTAL，实际是 {tags[0]['name']}"})
    for t in tags:
        if t["name"] == "TOTAL":
            v = re.sub(r"[^0-9]", "", t["inline"])
            doc["total"] = int(v) if v else None
        elif t["name"] == "PAPER":
            doc["paper"] = t["inline"]
        elif t["name"] == "NOTICE":
            doc["notice"] = t["inline"]

    # 单行值标签的"值"必须同行：值为空而正文非空 → 换行写了
    for t in tags:
        if t["name"] in VALUE_TAGS and not t["inline"] and t["body"]:
            doc["issues"].append({"kind": "value_broken", "line": t["line"],
                                  "detail": f"{t['name']} 的值换行写了（前端读不到）"})
        if t["name"] in MULTILINE_TAGS and t["inline"]:
            doc["issues"].append({"kind": "inline_content", "line": t["line"],
                                  "detail": f"{t['name']} 是内容标签，内容不应与标签同行"})

    # ---- 分组 ----
    for t in tags:
        if t["name"] == "GROUP":
            parts = t["inline"].split("|")
            doc["groups"].append({"id": parts[0] if parts else "", "title": parts[1] if len(parts) > 1 else "",
                                  "intro": parts[2] if len(parts) > 2 else "", "n_parts": len(parts),
                                  "line": t["line"]})
    # ---- 语篇 ----
    for t in tags:
        if t["name"] == "PASSAGE_DEF":
            pid = t["inline"].strip()
            doc["passage_def_order"].append(pid)
            if pid in doc["passages"]:
                doc["issues"].append({"kind": "passage_dup", "line": t["line"],
                                      "detail": f"语篇 {pid} 被重复声明（应只声明一次）"})
            doc["passages"].setdefault(pid, t["body"])

    # ---- 逐题切块 ----
    seq = [t for t in tags]
    cur = None
    for t in seq:
        nm = t["name"]
        if nm == "Q":
            if cur is not None:
                doc["issues"].append({"kind": "missing_end_q", "line": cur["line"],
                                      "detail": f"题 {cur['num']} 没有以 @@END_Q@@ 结束"})
                doc["questions"].append(cur)
            cur = {"num": None, "line": t["line"], "tags": [], "end_q": False,
                   "block_text": ""}
            raw = t["inline"].strip()
            cur["num_raw"] = raw
            if raw.isdigit():
                cur["num"] = int(raw)
            else:
                doc["issues"].append({"kind": "q_num_bad", "line": t["line"],
                                      "detail": f"@@Q@@ 的值必须是纯数字，实际是 “{raw}”"})
                m2 = re.search(r"\d+", raw)
                cur["num"] = int(m2.group()) if m2 else None
            continue
        if cur is None:
            continue
        if nm == "END_Q":
            cur["end_q"] = True
            doc["questions"].append(cur)
            cur = None
            continue
        cur["tags"].append(t)
    if cur is not None:
        doc["issues"].append({"kind": "missing_end_q", "line": cur["line"],
                              "detail": f"题 {cur['num']} 未结束（文件可能在题中被截断）"})
        doc["questions"].append(cur)

    # 逐题整理字段
    for q in doc["questions"]:
        f: dict = {}
        order = []
        for t in q["tags"]:
            name, inline, body = t["name"], t["inline"], t["body"]
            f.setdefault(name, []).append(body if body else inline)
            order.append(name)
        q["fields"] = f
        q["order"] = order
        q["qtype"] = (f.get("QTYPE") or [""])[0].strip()
        q["passage_ref"] = (f.get("PASSAGE_REF") or [""])[0].strip()
        # 迁移块：按 TRANSFER_PASSAGE 切
        blocks, block = [], None
        for t in q["tags"]:
            name, inline, body = t["name"], t["inline"], t["body"]
            if name == "TRANSFER_PASSAGE":
                if block:
                    blocks.append(block)
                block = {"TRANSFER_PASSAGE": body}
            elif name.startswith("TRANSFER_") and block is not None:
                block[name] = body if body else inline
        if block:
            blocks.append(block)
        q["transfers"] = blocks
        # 写作三件套
        q["writing"] = {k: (f.get(k) or [""])[0] for k in WRITING_SEQ}

    # 题号重复
    nums = [q["num"] for q in doc["questions"] if q["num"] is not None]
    dup = {x for x in nums if nums.count(x) > 1}
    if dup:
        doc["issues"].append({"kind": "q_num_dup", "line": 0,
                              "detail": f"题号重复：{sorted(dup)}"})
    return doc


def tag_sequence_check(q: dict) -> list[str]:
    """检查单题的标签序列：缺什么、多什么、顺序对不对。"""
    problems = []
    order = list(q["order"])
    # 去掉迁移块（重复的 5 标签）后与基准序列比对
    n_transfer = len(q["transfers"])
    core = []
    i = 0
    seen_transfer = 0
    while i < len(order):
        if order[i] == "TRANSFER_PASSAGE":
            seen_transfer += 1
            # 跳过本块 5 个标签
            j = i
            while j < len(order) and order[j].startswith("TRANSFER_"):
                j += 1
            core.extend(TRANSFER_SEQ if seen_transfer == 1 else [])
            i = j
            continue
        core.append(order[i])
        i += 1
    is_writing = q.get("qtype") == "writing"
    base = [x for x in BASE_SEQ if x != "Q"]   # Q 是块首标签，切块时已单独取走
    if is_writing:
        expect = [x for x in base if x not in WRITING_OPTIONAL] + WRITING_SEQ
        core = [x for x in core if x in expect]
    else:
        expect = base + (TRANSFER_SEQ if n_transfer else [])
    missing = [x for x in expect if x not in core]
    extra = [x for x in core if x not in expect]
    if missing:
        problems.append(f"缺标签 {missing}")
    if extra:
        problems.append(f"多余标签 {extra}")
    if not missing and not extra and core != expect:
        problems.append(f"标签顺序不符：{'→'.join(core)}（应为 {'→'.join(expect)}）")
    # 迁移块不完整
    for bi, b in enumerate(q["transfers"], 1):
        lack = [x for x in TRANSFER_SEQ if x not in b]
        if lack:
            problems.append(f"第 {bi} 个迁移块缺 {lack}")
    return problems


if __name__ == "__main__":
    import sys
    from pathlib import Path
    p = Path(sys.argv[1])
    d = parse(p.read_text(encoding="utf-8"))
    print(f"TOTAL={d['total']} 题块={len(d['questions'])} 语篇={list(d['passages'])} 分组={len(d['groups'])}")
    for q in d["questions"]:
        print(f"  Q{q['num']} {q['qtype']} ref={q['passage_ref']} 迁移块={len(q['transfers'])} "
              f"end={q['end_q']} 问题={tag_sequence_check(q)}")
    print(f"issues({len(d['issues'])}):")
    for it in d["issues"][:40]:
        print(f"  [{it['kind']}] L{it['line']} {it['detail']}")
