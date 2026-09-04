"""试卷可视化全解的校验与归一化，支持自定义分隔格式（B方案）与 JSON 兼容。"""

from __future__ import annotations

import json
import re
from typing import Any

ALLOWED_GROUP_IDS = {"reading", "cloze7", "cloze", "grammar", "writing_app", "writing_cont", "other"}

# 增量友好的自定义分隔格式标签
# 单行值标签：tag 行内含值  @@TOTAL@@ 26
# 多行内容标签：tag 独占一行，内容至下一标签
SINGLE_VALUE_TAGS = {"TOTAL", "PAPER", "NOTICE", "GROUP", "Q", "QTYPE"}
ALLOWED_QTYPES = {"choice", "blank", "writing"}
# 选项标号：阅读/完形为 A-D，七选五为 A-G，按原文照录
OPT_LABEL_RE = re.compile(r"^([A-Ga-g])\s*[\.、:：\)）]?\s*(.*)$")
MULTILINE_TAGS = {
    "PASSAGE", "STEM", "OPTIONS", "ANSWER", "EVIDENCE", "REASON", "DISTRACTOR",
    "PITFALLS", "PATTERN_NAME", "PATTERN_STEPS",
    "TRANSFER_PASSAGE", "TRANSFER_STEM", "TRANSFER_OPTIONS", "TRANSFER_ANSWER", "TRANSFER_EXPL",
    "WRITING_POINTS", "WRITING_OUTLINE", "WRITING_SAMPLE",
}
ALL_TAGS = SINGLE_VALUE_TAGS | MULTILINE_TAGS | {"END_Q"}

# 兼容两种写法：@@TAG@@ 内容 与 @@TAG=内容（部分模型会输出后者，含义相同）
TAG_RE = re.compile(r"^@@([A-Z_]+)(@@|=)\s*(.*)$")

def _is_nonempty_str(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""

# ========== 旧 JSON 解析（保留兼容历史） ==========

def _try_parse_json(raw: str) -> tuple[dict | None, str]:
    if not raw or not raw.strip():
        return None, "empty output"
    text = raw.strip()
    fenced = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    candidates: list[str] = []
    if fenced:
        candidates.extend([c.strip() for c in fenced if c.strip()])
    candidates.append(text)
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(text[first_brace : last_brace + 1])
    for cand in candidates:
        cand = cand.strip()
        if not cand:
            continue
        try:
            data = json.loads(cand)
            if isinstance(data, dict):
                return data, ""
        except json.JSONDecodeError:
            continue
        decoder = json.JSONDecoder()
        for i, ch in enumerate(cand):
            if ch != "{":
                continue
            try:
                val, _ = decoder.raw_decode(cand[i:])
                if isinstance(val, dict):
                    return val, ""
            except json.JSONDecodeError:
                continue
    return None, "no valid JSON found"

# ========== 自定义分隔格式解析 ==========

def parse_custom_visual_paper(raw: str) -> dict | None:
    """解析 B 方案的自定义分隔格式，返回与 JSON 同构的 dict。

    增量友好：仅当遇到 @@END_Q@@ 时才提交一道题；截断导致无 END_Q 的题被丢弃，已完成题保留。
    若 raw 中无任何 @@TAG@@，返回 None 供调用方回退 JSON。
    """
    if not raw or "@@" not in raw:
        return None
    lines = raw.splitlines()
    # 状态
    total_declared: int | None = None
    paper_title = ""
    notice = ""
    groups: list[dict] = []
    current_group: dict | None = None
    current_q: dict | None = None
    current_field: str | None = None
    field_buf: list[str] = []

    def flush_field():
        nonlocal current_field, field_buf, current_q
        if current_field is None or current_q is None:
            field_buf = []
            current_field = None
            return
        content = "\n".join(field_buf).strip()
        # 去除首尾空行，但保留内部换行
        field_buf = []
        cf = current_field
        current_field = None
        # 将内容写入 current_q 的对应键
        if cf == "PASSAGE":
            # 同上占位容错：若为 "<同上A篇语篇>" 等或空，直接复用同组上一题的语篇
            stripped = content.strip()
            is_placeholder = False
            if not stripped:
                is_placeholder = True
            elif re.match(r"^\s*[<＜]?\s*(同上|见上|略|—+|同\s*A\s*篇).*?[>＞]?\s*$", stripped):
                is_placeholder = True
            elif "同上" in stripped and len(stripped) < 30:
                is_placeholder = True
            if is_placeholder and current_group is not None and current_group.get("questions"):
                # 复用同组上一题的 passage
                prev_passage = current_group["questions"][-1].get("passage", "") if current_group["questions"] else ""
                if prev_passage:
                    content = prev_passage
            current_q["passage"] = content
        elif cf == "STEM":
            current_q["stem"] = content
        elif cf == "OPTIONS":
            # 每行一个选项，形如 "A. text"；非选择题此段为空
            opts = []
            for line in content.splitlines():
                line = line.strip()
                if not line:
                    continue
                # 匹配 "A. xxx" 或 "A: xxx" 或 "A xxx"（标号可至 G，覆盖七选五）
                m = OPT_LABEL_RE.match(line)
                if m:
                    label = m.group(1).upper()
                    text = m.group(2).strip()
                    opts.append({"label": label, "text": text})
                else:
                    # 若无法匹配，作为纯文本选项（兼容）
                    opts.append({"label": "", "text": line})
            current_q["_raw_options"] = opts  # 暂存，后面转为 options
        elif cf == "ANSWER":
            current_q["_answer_raw"] = content.strip()
        elif cf == "EVIDENCE":
            current_q["_evidence_raw"] = content.strip()
        elif cf == "REASON":
            current_q["_reason_raw"] = content.strip()
        elif cf == "DISTRACTOR":
            current_q["_distractor_raw"] = content.strip()
        elif cf == "PITFALLS":
            pits = []
            for line in content.splitlines():
                line = line.strip()
                if not line:
                    continue
                # 去除行首序号 "1. " "1、" 等
                line = re.sub(r"^[\d\.\、\)\）\s]+", "", line)
                if "::" in line:
                    title, desc = line.split("::", 1)
                    pits.append({"title": title.strip(), "desc": desc.strip()})
                elif "：" in line or ":" in line:
                    # 兼容中文冒号
                    parts = re.split(r"[：:]", line, maxsplit=1)
                    if len(parts) == 2:
                        pits.append({"title": parts[0].strip(), "desc": parts[1].strip()})
                    else:
                        pits.append({"title": line, "desc": ""})
                else:
                    pits.append({"title": line, "desc": ""})
            current_q["_pitfalls_raw"] = pits
        elif cf == "PATTERN_NAME":
            current_q["_pattern_name_raw"] = content.strip()
        elif cf == "PATTERN_STEPS":
            steps = [l.strip() for l in content.splitlines() if l.strip()]
            # 去除序号
            cleaned = []
            for s in steps:
                s = re.sub(r"^[\d\.\、\)\）\s]+", "", s)
                if s:
                    cleaned.append(s)
            current_q["_pattern_steps_raw"] = cleaned
        elif cf == "TRANSFER_PASSAGE":
            current_q["_transfer_passage_raw"] = content
        elif cf == "TRANSFER_STEM":
            current_q["_transfer_stem_raw"] = content.strip()
        elif cf == "TRANSFER_OPTIONS":
            opts = []
            for line in content.splitlines():
                line = line.strip()
                if not line:
                    continue
                m = OPT_LABEL_RE.match(line)
                if m:
                    label = m.group(1).upper()
                    text = m.group(2).strip()
                    opts.append({"label": label, "text": text})
                else:
                    opts.append({"label": "", "text": line})
            current_q["_transfer_options_raw"] = opts
        elif cf == "TRANSFER_ANSWER":
            current_q["_transfer_answer_raw"] = content.strip()
        elif cf == "TRANSFER_EXPL":
            current_q["_transfer_expl_raw"] = content.strip()
        elif cf == "WRITING_POINTS":
            points = [l.strip() for l in content.splitlines() if l.strip()]
            # 去除序号
            points = [re.sub(r"^[\d\.\、\)\）\s]+", "", p) for p in points]
            current_q["_writing_points_raw"] = points
        elif cf == "WRITING_OUTLINE":
            current_q["_writing_outline_raw"] = content.strip()
        elif cf == "WRITING_SAMPLE":
            current_q["_writing_sample_raw"] = content
        else:
            # 未知字段忽略
            pass

    def commit_question():
        nonlocal current_q, current_group, groups
        if current_q is None or current_group is None:
            return
        # flush 当前字段（若截断前未遇下一标签，field_buf 可能仍有内容）
        if current_field is not None and field_buf:
            flush_field()
        # 组装 question 对象（与 JSON 同构）
        no = current_q.get("no", "")
        # 构建 options
        options = current_q.get("_raw_options", [])
        # 构建 pitfalls
        pitfalls = current_q.get("_pitfalls_raw", [])
        # 构建 pattern
        pattern_name = current_q.get("_pattern_name_raw", "")
        pattern_steps = current_q.get("_pattern_steps_raw", [])
        # 构建 reference
        reference = {
            "evidence": current_q.get("_evidence_raw", ""),
            "reason": current_q.get("_reason_raw", ""),
            "distractor": current_q.get("_distractor_raw", ""),
        }
        pattern = {"name": pattern_name, "steps": pattern_steps} if pattern_name or pattern_steps else {"name": "", "steps": []}
        # 题型：优先模型声明的 QTYPE，缺失时按组与选项推断（兼容旧输出）
        qtype = (current_q.get("qtype") or "").strip().lower()
        if qtype not in ALLOWED_QTYPES:
            if current_group.get("id") in ("writing_app", "writing_cont"):
                qtype = "writing"
            elif options:
                qtype = "choice"
            else:
                qtype = "blank"
        # 判断写作题
        is_writing = qtype == "writing" or current_group.get("id") in ("writing_app", "writing_cont")
        if is_writing:
            qtype = "writing"
        transfer = None
        writingGuide = None
        if is_writing:
            writingGuide = {
                "points": current_q.get("_writing_points_raw", []),
                "outline": current_q.get("_writing_outline_raw", ""),
                "sample": current_q.get("_writing_sample_raw", ""),
            }
            # 若全空则设空
            if not writingGuide["points"] and not writingGuide["outline"] and not writingGuide["sample"]:
                writingGuide = {"points": [], "outline": "", "sample": ""}
        else:
            # 非写作：构建 transfer
            t_pass = current_q.get("_transfer_passage_raw", "")
            t_stem = current_q.get("_transfer_stem_raw", "")
            t_opts = current_q.get("_transfer_options_raw", [])
            t_ans = current_q.get("_transfer_answer_raw", "")
            t_expl = current_q.get("_transfer_expl_raw", "")
            # 仅当至少有 passage 或 stem 时才视为有效 transfer，否则为 None（允许部分题无迁移？但 spec 要求必有，容错）
            if t_pass or t_stem or t_opts or t_ans:
                transfer = {
                    "passage": t_pass or "",
                    "stem": t_stem or "",
                    "options": t_opts or [],
                    "answer": t_ans or "",
                    "explanation": t_expl or "",
                }
            else:
                transfer = None
        # 构建最终 question
        q_obj = {
            "no": str(no).strip(),
            "qtype": qtype,
            "passage": current_q.get("passage", ""),
            "stem": current_q.get("stem", ""),
            "options": options,
            "answer": current_q.get("_answer_raw", "") or None,
            "reference": reference,
            "pitfalls": pitfalls,
            "pattern": pattern,
            "transfer": transfer,
            "writingGuide": writingGuide,
        }
        # 写作题 answer 为 null，已在上面处理
        if is_writing and not q_obj["answer"]:
            q_obj["answer"] = None
        # 若 answer 为空字符串则转为 None（写作）或保留空？
        if q_obj["answer"] == "":
            q_obj["answer"] = None if is_writing else ""
        current_group["questions"].append(q_obj)
        # 重置 current_q
        current_q = None

    # 逐行解析
    for raw_line in lines:
        line = raw_line.rstrip("\r")
        m = TAG_RE.match(line.strip())
        if m:
            tag = m.group(1)
            value = m.group(3).strip()
            if m.group(2) == "@@" and value.startswith("="):
                value = value[1:].strip()
            # 先 flush 前一字段
            if current_field is not None:
                flush_field()
            if tag == "TOTAL":
                try:
                    total_declared = int(re.search(r"\d+", value).group()) if re.search(r"\d+", value) else None
                except:
                    total_declared = None
            elif tag == "PAPER":
                paper_title = value
            elif tag == "NOTICE":
                notice = value
            elif tag == "GROUP":
                # flush 前一组的不完整题（若有）
                if current_q is not None:
                    # 未遇 END_Q 的题丢弃
                    current_q = None
                    current_field = None
                    field_buf = []
                parts = [p.strip() for p in value.split("|")]
                gid = parts[0].strip() if len(parts) > 0 else "other"
                if gid not in ALLOWED_GROUP_IDS:
                    # 兼容中文标题误作 id，尝试映射
                    gid = "other"
                    # 若 parts 长度为 2，说明 id 缺失
                    if len(parts) == 2:
                        title = parts[0]
                        intro = parts[1]
                    else:
                        title = parts[1] if len(parts) > 1 else gid
                        intro = parts[2] if len(parts) > 2 else ""
                else:
                    title = parts[1] if len(parts) > 1 else gid
                    intro = parts[2] if len(parts) > 2 else ""
                current_group = {"id": gid, "title": title, "intro": intro, "questions": []}
                groups.append(current_group)
            elif tag == "Q":
                # 若上一题未 END_Q，丢弃
                if current_q is not None:
                    current_q = None
                    current_field = None
                    field_buf = []
                no = value.strip() or "1"
                current_q = {"no": no}
                # 确保有组
                if current_group is None:
                    current_group = {"id": "other", "title": "未分组", "intro": "", "questions": []}
                    groups.append(current_group)
            elif tag == "QTYPE":
                if current_q is not None:
                    v = value.strip().lower()
                    current_q["qtype"] = v if v in ALLOWED_QTYPES else v
            elif tag == "END_Q":
                # 提交当前题
                commit_question()
                current_field = None
                field_buf = []
            elif tag in MULTILINE_TAGS:
                current_field = tag
                field_buf = []
                # 若 value 非空（同行有内容），视为首行内容
                if value:
                    field_buf.append(value)
            else:
                # 未知标签，视为普通内容（容错）
                if current_field is not None:
                    field_buf.append(line)
                continue
        else:
            # 非标签行：属于当前字段的内容
            if current_field is not None and current_q is not None:
                field_buf.append(line)
            else:
                # 不在任何字段内，忽略（可能是空行）
                continue

    # 结束时若有未提交的题（无 END_Q），丢弃（保证已提交的都是完整题）
    # 不 commit 不完整题

    if not groups and total_declared is None and not paper_title and not notice:
        return None

    # 计算 answerMap
    answerMap = {}
    for g in groups:
        for q in g["questions"]:
            ans = q.get("answer")
            if ans:
                answerMap[str(q.get("no"))] = str(ans)
            elif q.get("writingGuide") is not None:
                answerMap[str(q.get("no"))] = "见范文"
    # 组装最终 dict（与 JSON 同构）
    result = {
        "paper": {"title": paper_title, "subject": "英语", "year": ""},
        "notice": notice,
        "answerMap": answerMap,
        "groups": groups,
        "total": total_declared,  # 额外字段，供前端进度条
    }
    # 若 groups 为空且 total 为 0，视为例外空
    return result

def try_parse_visual_paper(raw: str) -> tuple[dict | None, str]:
    """统一入口：优先尝试自定义分隔格式，其次 JSON。"""
    if not raw or not raw.strip():
        return None, "empty output"
    # 若包含自定义标签，优先走自定义解析
    if re.search(r"@@[A-Z_]+(@@|=)", raw):
        data = parse_custom_visual_paper(raw)
        if data is not None:
            # 即使 groups 为空但 total 为 0 也是合法（例外）
            if data.get("groups") is not None:
                return data, ""
            # 否则回退 JSON
        # 若自定义解析得到空但 raw 中有标签，说明格式错误
        # 仍尝试 JSON 回退
    data, err = _try_parse_json(raw)
    if data is not None:
        return data, ""
    # 若 raw 中有自定义标签但解析为 None，尝试返回自定义解析的空结果（用于显示 notice）
    # 已在上面处理
    return None, err or "no valid custom or JSON found"


def validate_visual_paper(data: Any) -> tuple[bool, list[str]]:
    """校验是否符合契约（兼容 JSON 与自定义格式的同构 dict）。"""
    errors: list[str] = []
    if not isinstance(data, dict):
        return False, ["root must be object"]
    paper = data.get("paper")
    if not isinstance(paper, dict):
        errors.append("paper must be object")
    else:
        if not _is_nonempty_str(paper.get("title")):
            groups = data.get("groups")
            if isinstance(groups, list) and len(groups) > 0:
                errors.append("paper.title required when groups non-empty")
    if "notice" not in data or not isinstance(data["notice"], str):
        errors.append("notice must be string")
    am = data.get("answerMap")
    if not isinstance(am, dict):
        errors.append("answerMap must be object")
    groups = data.get("groups")
    if not isinstance(groups, list):
        errors.append("groups must be array")
        return False, errors
    for gi, g in enumerate(groups):
        if not isinstance(g, dict):
            errors.append(f"groups[{gi}] must be object")
            continue
        gid = g.get("id")
        if gid not in ALLOWED_GROUP_IDS:
            errors.append(f"groups[{gi}].id must be one of {ALLOWED_GROUP_IDS}")
        if not _is_nonempty_str(g.get("title")):
            errors.append(f"groups[{gi}].title required")
        if not isinstance(g.get("intro"), str):
            errors.append(f"groups[{gi}].intro must be string")
        qs = g.get("questions")
        if not isinstance(qs, list):
            errors.append(f"groups[{gi}].questions must be array")
            continue
        for qi, q in enumerate(qs):
            prefix = f"groups[{gi}].questions[{qi}]"
            if not isinstance(q, dict):
                errors.append(f"{prefix} must be object")
                continue
            if not _is_nonempty_str(q.get("no")):
                errors.append(f"{prefix}.no required")
            qt = q.get("qtype")
            if qt is not None and qt not in ("choice", "blank", "writing"):
                errors.append(f"{prefix}.qtype must be choice|blank|writing")
            if not isinstance(q.get("stem"), str):
                errors.append(f"{prefix}.stem must be string")
            opts = q.get("options")
            if not isinstance(opts, list):
                errors.append(f"{prefix}.options must be array")
            else:
                for oi, o in enumerate(opts):
                    if not isinstance(o, dict) or not _is_nonempty_str(o.get("label")) or not isinstance(o.get("text"), str):
                        errors.append(f"{prefix}.options[{oi}] must be {{label,text}}")
            ans = q.get("answer")
            if ans is not None and not isinstance(ans, str):
                errors.append(f"{prefix}.answer must be string or null")
            ref = q.get("reference")
            if not isinstance(ref, dict):
                errors.append(f"{prefix}.reference must be object")
            else:
                for k in ("evidence", "reason", "distractor"):
                    if not isinstance(ref.get(k), str):
                        errors.append(f"{prefix}.reference.{k} must be string")
            pits = q.get("pitfalls")
            if not isinstance(pits, list):
                errors.append(f"{prefix}.pitfalls must be array")
            else:
                if len(pits) > 3:
                    errors.append(f"{prefix}.pitfalls max 3")
                for pi, p in enumerate(pits):
                    if not isinstance(p, dict) or not isinstance(p.get("title"), str) or not isinstance(p.get("desc"), str):
                        errors.append(f"{prefix}.pitfalls[{pi}] must be {{title,desc}}")
            pat = q.get("pattern")
            if not isinstance(pat, dict):
                errors.append(f"{prefix}.pattern must be object")
            else:
                if not _is_nonempty_str(pat.get("name")):
                    errors.append(f"{prefix}.pattern.name required")
                steps = pat.get("steps")
                if not isinstance(steps, list) or not all(isinstance(s, str) and s.strip() for s in steps):
                    errors.append(f"{prefix}.pattern.steps must be string array")
            tr = q.get("transfer")
            is_writing = g.get("id") in ("writing_app", "writing_cont")
            if is_writing:
                if tr is not None:
                    errors.append(f"{prefix}.transfer must be null for writing")
            else:
                if tr is not None and not isinstance(tr, dict):
                    errors.append(f"{prefix}.transfer must be object or null")
                elif isinstance(tr, dict):
                    for k in ("passage", "stem", "answer", "explanation"):
                        if not isinstance(tr.get(k), str):
                            errors.append(f"{prefix}.transfer.{k} must be string")
                    topts = tr.get("options")
                    if not isinstance(topts, list):
                        errors.append(f"{prefix}.transfer.options must be array")
            wg = q.get("writingGuide")
            if is_writing:
                if wg is not None and not isinstance(wg, dict):
                    errors.append(f"{prefix}.writingGuide must be object or null")
    return (len(errors) == 0), errors

def normalize_visual_paper(data: dict) -> dict:
    """归一化：补齐缺失字段、截断超长、确保写作题 transfer 为 null。"""
    out = json.loads(json.dumps(data, ensure_ascii=False))
    if "paper" not in out or not isinstance(out["paper"], dict):
        out["paper"] = {"title": "", "subject": "英语", "year": ""}
    else:
        out["paper"].setdefault("title", "")
        out["paper"].setdefault("subject", "英语")
        out["paper"].setdefault("year", "")
    out.setdefault("notice", "")
    out.setdefault("answerMap", {})
    out.setdefault("groups", [])
    out.setdefault("total", None)
    def trunc(s: str, n: int) -> str:
        return s if len(s) <= n else s[:n] + "…"
    for g in out["groups"]:
        g.setdefault("intro", "")
        g["intro"] = trunc(str(g.get("intro", "")), 200)
        for q in g.get("questions", []):
            # 补齐 qtype（兼容旧输出）
            if q.get("qtype") not in ("choice", "blank", "writing"):
                if g.get("id") in ("writing_app", "writing_cont"):
                    q["qtype"] = "writing"
                elif isinstance(q.get("options"), list) and len(q["options"]) > 0:
                    q["qtype"] = "choice"
                else:
                    q["qtype"] = "blank"
            gid = g.get("id")
            if gid in ("writing_app", "writing_cont"):
                q["transfer"] = None
                if q.get("writingGuide") is None:
                    q["writingGuide"] = {"points": [], "outline": "", "sample": ""}
            else:
                q.setdefault("transfer", None)
                if q.get("writingGuide") is None:
                    q["writingGuide"] = None
            if isinstance(q.get("passage"), str):
                q["passage"] = trunc(q["passage"], 4000)
            if isinstance(q.get("stem"), str):
                q["stem"] = trunc(q["stem"], 1000)
            ref = q.get("reference")
            if isinstance(ref, dict):
                for k in ("evidence", "reason", "distractor"):
                    if isinstance(ref.get(k), str):
                        ref[k] = trunc(ref[k], 800)
            for p in q.get("pitfalls", []) or []:
                if isinstance(p.get("desc"), str):
                    p["desc"] = trunc(p["desc"], 500)
            pat = q.get("pattern")
            if isinstance(pat, dict) and isinstance(pat.get("steps"), list):
                pat["steps"] = [trunc(str(s), 300) for s in pat["steps"][:5]]
            tr = q.get("transfer")
            if isinstance(tr, dict) and isinstance(tr.get("passage"), str):
                tr["passage"] = trunc(tr["passage"], 800)
    # 若 total 未声明，推算
    if out.get("total") is None:
        cnt = sum(len(g.get("questions", [])) for g in out["groups"])
        out["total"] = cnt if cnt else None
    # 若 answerMap 为空，推算
    if not out["answerMap"]:
        am = {}
        for g in out["groups"]:
            for q in g["questions"]:
                ans = q.get("answer")
                if ans:
                    am[str(q.get("no"))] = str(ans)
                elif q.get("writingGuide") is not None:
                    am[str(q.get("no"))] = "见范文"
        out["answerMap"] = am
    return out
