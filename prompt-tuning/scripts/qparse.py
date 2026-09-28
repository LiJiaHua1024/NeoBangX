"""共享解析工具：题号兼容 `1.` / `**1**` / `第 1 题` / `第 1 题：` / `迁移题1` 等写法。"""
from __future__ import annotations

import re

HEADINGS = ["一、本质错因总结", "二、方法论：如何避免再错", "三、迁移题", "四、答案 + 解析"]

_NUM_LINE = [
    re.compile(r"^\s*\**\s*迁移题\s*(\d{1,2})\s*题?\s*[.、．:：]?"),
    re.compile(r"^\s*\**\s*(?:第\s*)?(\d{1,2})\s*题\s*[.、．:：]"),
    re.compile(r"^\s*\**\s*(?:第\s*)?(\d{1,2})\s*题(?:\s*[.、．:：]|\s*\**\s*$)"),
    re.compile(r"^\s*\**\s*(\d{1,2})\s*[.、．:：](?!\d)"),
    re.compile(r"^\s*\**(\d{1,2})\**\s*$"),
    re.compile(r"^\s*\**\((\d{1,2})\)\**\s*$"),
]


def item_num(line: str) -> int | None:
    for pat in _NUM_LINE:
        m = pat.match(line)
        if m:
            return int(m.group(1))
    return None


def section_text(md: str, start_heading: str) -> str:
    idx = md.find(start_heading)
    if idx < 0:
        return ""
    body = md[idx + len(start_heading):]
    nxt = body.find("\n## ")
    return body[:nxt] if nxt >= 0 else body


def split_items(section: str) -> list[str]:
    lines = section.splitlines()
    starts = [i for i, ln in enumerate(lines) if item_num(ln) is not None]
    blocks = []
    for k, i in enumerate(starts):
        end = starts[k + 1] if k + 1 < len(starts) else len(lines)
        blocks.append("\n".join(lines[i:end]))
    return blocks


def split_questions(section: str) -> list[dict]:
    blocks = split_items(section)
    out = []
    for block in blocks:
        num = item_num(block.splitlines()[0])
        out.append({"num": num, "block": block})
    return out


_POOL_BLANK = re.compile(
    r"(?:^|[ \t　])(\d{1,2})[.、．][ \t　]*_{3,}"
    r"|_{2,}[ \t　]*(\d{1,2})[ \t　]*_{2,}"
    r"|\[(\d{1,2})\][ \t　]*_{2,}", re.M)
_OPT_GROUP = re.compile(r"(?:^|[ \t　])(\d{1,2})[.、．][ \t　]*\**[ \t　]*[A-G][.、．]", re.M)


def question_numbers(section: str) -> list[int]:
    """统计题号：常规编号块 + 多空语篇的空号 + 选项组编号，取并集排序。"""
    nums = [q["num"] for q in split_questions(section) if q["num"] is not None]
    for m in _POOL_BLANK.finditer(section):
        g = m.group(1) or m.group(2) or m.group(3) or m.group(4)
        if g:
            nums.append(int(g))
    nums += [int(m.group(1)) for m in _OPT_GROUP.finditer(section)]
    return sorted(set(nums))


def is_multi_blank(section: str) -> bool:
    return bool(_POOL_BLANK.search(section))


def extract_question_block(block: str) -> str | None:
    """取题干+选项（用于盲测），丢弃解析文字；输出去掉 Markdown 修饰，便于任何模型阅读。"""
    lines = block.splitlines()
    out = [lines[0]]
    inline_opt = re.compile(r"(?:^|[\s　])[A-G]\s*[.、．]")
    for ln in lines[1:]:
        if re.match(r"^\s*[A-G]\s*[.、．]", ln):
            out.append(ln.strip())
        elif len(inline_opt.findall(ln)) >= 3:   # 行内多选项格式：整行保留
            out.append(ln.strip())
        elif item_num(ln) is not None and not re.match(r"^\s*\**\s*(?:第\s*)?迁移题", ln):
            break
        else:
            if len(re.sub(r"[A-Za-z0-9 .,'\"()\-_？?！!,.;:。；：、\n]", "", ln)) > 40:
                break
            out.append(ln)
    if not out:
        return None
    text = "\n".join(out).strip()
    text = re.sub(r"\*\*|__|`", "", text)          # 去加粗/代码标记
    text = re.sub(r"^\s*(?:第\s*)?迁移?题?\s*\d{1,2}\s*题?\s*[.、．:：]?\s*", "", text)  # 题号行只留内容
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() or None


_LABEL_RE = re.compile(
    r"^\s*\**\s*(?:第\s*(\d{1,2})\s*题|迁移题\s*(\d{1,2})|(\d{1,2}))\s*[.、．:：]?\s*\**\s*(.*?)\s*$")


def extract_key(block: str) -> str:
    """从答案+解析块里抠出标准答案：兼容"编号行独立、答案在下一行""答案：X"等写法。"""
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    if not lines:
        return ""
    m = _LABEL_RE.match(lines[0])
    rest = (m.group(4) or "") if m else ""
    if re.search(r"[A-Za-z]", rest):
        key_text = rest
    else:
        # 编号行本身无答案内容 → 在后续行找
        candidates = lines[1:] if m else lines
        key_text = ""
        for ln in candidates:
            am = re.search(r"答案[:：]?\s*(.+)", ln)
            if am:
                key_text = am.group(1)
                break
            if re.search(r"[A-Za-z]", ln):
                key_text = ln
                break
        if not key_text and rest:
            key_text = rest
    key_text = key_text.strip("`*_ ")
    key_text = re.sub(r"^答案[:：]\s*", "", key_text).strip("`*_ ")
    key_text = re.split(r"[—;；]|解析", key_text)[0]
    return key_text.strip("`*_ 。.，,：: ")


def norm_key(key: str) -> list[str]:
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
    keys = norm_key(key)
    km = re.match(r"^([a-g])\b", keys[0]) if keys else None
    sm = re.match(r"^([a-g])\b", sa)
    if km and sm:
        return km.group(1) == sm.group(1)
    if km and not sm:
        return False
    for v in keys:
        if v and (v in sa or sa in v):
            return True
    return False
