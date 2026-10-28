"""写作者：生成与修订成果的纯函数部分。

生成时把拼 prompt 所需的一切记入版本依据；修订时按依据重建与生成请求逐字一致的前缀，
由同一位写作者在自己的稿子上按修改块局部修改。数据库与模型调用留在执行器里。
"""
import hashlib
import json
import re
from dataclasses import dataclass, field

from .instructions import REVISION_FORMAT

RECIPE_FORMAT = 1
# 修订会话：首次输出加至多两次针对失败修改块的重试。
MAX_REVISION_ATTEMPTS = 3
# 沿父版本查找作者原稿的最大层数，防止异常数据形成过长链条。
MAX_LINEAGE_DEPTH = 20
# 写进版本依据的修订记录条数与单条长度上限，只用于下一轮避免来回改。
MAX_REVISION_RECORDS = 3
RECORD_CHARS = 2000

EDIT_START = re.compile(r"<edit>\s*<old>")
EDIT_BLOCK = re.compile(r"<edit>\s*<old>(.*?)</old>\s*<new>(.*?)</new>\s*</edit>", re.S)
FENCE_LINE = re.compile(r"^\s*```[\w-]*\s*$", re.M)
# 「第 N 条：采纳」/「其他要求：采纳」——说明了要改，就必须给出修改块。
ADOPTED = re.compile(r"(?:第\s*\d+\s*条|其他要求)\s*[:：]\s*采纳")


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def material_text(rows):
    return "\n\n".join(f'<material id="{m["id"]}" name={json.dumps(m["name"], ensure_ascii=False)}>\n{m["content"]}\n</material>'
                       for m in rows)


def render_prompt(template, values, rows, previous, goal, instruction, tail=True):
    """生成请求的 user 消息。修订重建依赖它逐字稳定，改动格式会让旧版本退回新会话修订。"""
    material = material_text(rows)
    values = {**values, "user_input": material}
    prompt = re.sub(r"\{\{(\w+)\}\}", lambda m: values.get(m[1], m[0]), template)
    if "{{user_input}}" not in template:
        prompt += "\n\n" + material
    if previous is not None:
        prompt += "\n\n<previous_version>\n" + previous + "\n</previous_version>"
    if tail:
        prompt += "\n\n本次目标：" + goal + "\n本次修改或生成要求：" + instruction
    return prompt


def recipe(system, values, base_version, prompt, output):
    """模板、材料、目标与要求已在 provenance 的通用字段里，这里只补重建所需的其余部分。"""
    return {"format": RECIPE_FORMAT, "system": system, "values": dict(values), "base_version": base_version or "",
            "prompt_sha256": digest(prompt), "output_sha256": digest(output)}


def authored(version):
    """版本正文是否就是依据里记录的写作者输出（未经他人改动）。"""
    writer = version.get("provenance", {}).get("writer")
    return bool(writer and writer.get("format") == RECIPE_FORMAT and writer.get("output_sha256") == digest(version["content"]))


def review_view(provenance):
    """给审阅看的生成依据：去掉重建用的内部记录和此前的修订说明，避免干扰独立判断。"""
    return {k: v for k, v in provenance.items() if k not in {"writer", "revisions"}}


def _strip_tag_newline(text):
    if text.startswith("\r\n"):
        text = text[2:]
    elif text.startswith("\n"):
        text = text[1:]
    if text.endswith("\r\n"):
        text = text[:-2]
    elif text.endswith("\n"):
        text = text[:-1]
    return text


@dataclass
class Parsed:
    edits: list = field(default_factory=list)      # [(块序号, old, new)]
    problems: list = field(default_factory=list)   # [(块序号, 说明)]
    explanation: str = ""


def parse_edits(text, truncated=False):
    parsed = Parsed()
    starts = [m.start() for m in EDIT_START.finditer(text)]
    last_end = 0
    for number, start in enumerate(starts, 1):
        if start < last_end:
            # 落在上一个完整块内部的起始标记属于那一块的正文，不另算一块。
            continue
        match = EDIT_BLOCK.match(text, start)
        nxt = next((s for s in starts if s > start), None)
        # 缺结束标签的块会被非贪婪匹配延伸进下一块，跨过下一个起始标记的匹配不算完整。
        if match and (nxt is None or match.end() <= nxt):
            parsed.edits.append((number, _strip_tag_newline(match[1]), _strip_tag_newline(match[2])))
            last_end = match.end()
        elif truncated and nxt is None:
            parsed.problems.append((number, "输出在这一块处达到上限被截断"))
        else:
            parsed.problems.append((number, "格式不完整，需要 <edit><old>…</old><new>…</new></edit>"))
    head = text[:starts[0]] if starts else text
    parsed.explanation = FENCE_LINE.sub("", head).strip()
    # 说了"采纳"却一个修改块都没给：这是格式失败，不能当成"写作者认为无需修改"，
    # 否则调度 Agent 会向用户报告"已按意见修订"，而成果根本没变。
    if not parsed.edits and not truncated and ADOPTED.search(parsed.explanation):
        parsed.problems.append((0, "说明了采纳意见，但没有按格式给出修改块"))
    return parsed


def _near(draft, old):
    """old 定位失败时，找当前稿中与它开头或结尾一致的最长片段，给写作者一个对照位置。"""
    def longest(test):
        lo, hi = 0, len(old)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if test(mid):
                lo = mid
            else:
                hi = mid - 1
        return lo
    prefix = longest(lambda n: old[:n] in draft)
    suffix = longest(lambda n: old[len(old)-n:] in draft)
    if max(prefix, suffix) < min(6, len(old)):
        return ""
    if prefix >= suffix:
        start = draft.find(old[:prefix])
    else:
        start = max(0, draft.find(old[len(old)-suffix:]) + suffix - len(old))
    return draft[start:start + len(old) + 20][:300]


def apply_edits(draft, edits):
    """按顺序把修改块应用到草稿。返回新草稿、已应用块数与失败说明 [(块序号, 说明)]。"""
    applied, failures = 0, []
    for number, old, new in edits:
        if not old:
            failures.append((number, "old 为空，无法定位"))
            continue
        if old == new:
            continue
        count = draft.count(old)
        if count == 0 and "\r\n" in draft and "\r" not in old:
            # 手动编辑过的稿子可能是 CRLF，模型输出的是 LF。
            old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
            count = draft.count(old)
        if count == 1:
            candidate = draft.replace(old, new, 1)
            if not candidate.strip():
                # 清空整篇会被存成"最新完整版本"，用户只能手动回退。
                failures.append((number, "该修改会让成果变为空文档，已拒绝"))
                continue
            draft = candidate
            applied += 1
        elif count == 0:
            hint = _near(draft, old)
            failures.append((number, "old 在当前稿中找不到" + (f"；最接近的位置是：「{hint}」" if hint else "")))
        else:
            failures.append((number, f"old 在当前稿中出现 {count} 次，请多带上下文使它唯一"))
    return draft, applied, failures


def describe_failures(failures):
    return "\n".join(f"- 第 {n} 块：{reason}" for n, reason in failures)


def format_issue(number, issue):
    tag = "已核实" if issue.get("certainty") == "confirmed" else "待核实"
    lines = [f"{number}. [{tag}] {issue.get('problem', '').strip()}"]
    if issue.get("quote"):
        lines.append(f"   原文：「{issue['quote']}」")
    if issue.get("evidence"):
        lines.append(f"   依据：{issue['evidence']}")
    if issue.get("fix"):
        lines.append(f"   建议：{issue['fix']}")
    return "\n".join(lines)


def revision_record(feedback, explanation, applied, failures, status="done"):
    return {"status": status, "feedback": feedback[:RECORD_CHARS], "explanation": explanation[:RECORD_CHARS],
            "applied": applied, "failed": [f"第 {n} 块：{reason}" for n, reason in failures][:20]}


def revision_request(feedback, records, current=None, edited_by_user=False):
    """修订会话末尾追加的 user 消息。current 为 None 时，当前稿就是上一条 assistant 消息。"""
    parts = []
    if current is not None:
        if edited_by_user:
            parts.append("用户手动修改了你的稿子。以下是修改后的当前稿，本次修改以当前稿为准：")
        else:
            parts.append("下面是一份按上述要求写成的稿子，不是你写的。本次不重新生成，只按修改意见在这份稿子上修改：")
        parts.append("<current_draft>\n" + current + "\n</current_draft>")
    else:
        parts.append("以下是对你上面这份稿子（当前稿）的修改意见。")
    parts.append("<feedback>\n" + feedback + "\n</feedback>")
    if records:
        history = "\n\n".join(f"意见：{r.get('feedback', '')}\n处理：{r.get('explanation', '')}" for r in records[-2:])
        parts.append("<previous_rounds>\n此前已做过的修订如下。已处理过的意见不再重复修改，除非新意见明确要求。\n"
                     + history + "\n</previous_rounds>")
    parts.append(REVISION_FORMAT)
    return "\n\n".join(parts)
