"""上下文压缩：确定性、可预算、对前缀缓存友好。

为什么不用模型写摘要
--------------------
摘要调用本身要读一遍完整上下文（贵），而且每次压缩的措辞都不一样——下一次
压缩的输入就变了，缓存更难命中。这里改成"机械摘要"：只从消息与工具调用里
抽取结构化事实（调用了什么工具、参数、返回多大、产出了哪一版），措辞固定，
同样的输入永远得到逐字节相同的输出。

为什么切点必须在 HEAD 之后
--------------------------
供应商的前缀缓存按"从头开始逐字节相同"命中。改动第 N 条消息，前 N-1 条仍然
命中；所以压缩只能"从中间切"：保留 HEAD（system + 任务上下文），把中间一段换成
摘要，再原样保留最近的 TAIL。绝不能重写 HEAD —— 那等于把整段前缀作废。
"""
from __future__ import annotations

import json

# 摘要的总长度上限（字符）：约 1.5k tokens，够写清"哪一步做了什么"，又不至于喧宾夺主
DIGEST_MAX_CHARS = 6000
# 单条工具参数摘要 / assistant 结论保留多少字符
TOOL_ARGS_KEEP = 120
ASSISTANT_KEEP = 160

DIGEST_HEADER = (
    "【较早步骤已压缩】下面是这些步骤的机械摘要，完整原文见对应步骤详情。"
    "需要材料原文时请用 read_material / search_material 重新取，不要凭记忆引用。"
)


def units(messages: list[dict]) -> list[list[dict]]:
    """把 HEAD 之后的 messages 拆成不可再分的单元。

    一个单元是「一条 user 消息」或「一条 assistant + 它之后的全部 tool 结果」。
    压缩只按单元丢弃，绝不把一次工具调用和它的结果拆开（拆开会破坏
    tool_call_id 的配对，上游会直接报错）。
    """
    result: list[list[dict]] = []
    for message in messages[2:]:
        role = message.get("role")
        if role == "tool" and result:
            result[-1].append(message)
        else:
            result.append([message])
    return result


def is_note(unit: list[dict]) -> bool:
    """用户补充要求：压缩时必须整段保留（丢了就是丢需求）。"""
    return bool(unit) and unit[0].get("role") == "user"


def _short(value, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"


def _tool_line(message: dict) -> str:
    content = message.get("content")
    size = len(content) if isinstance(content, str) else 0
    return f" → 返回 {size:,} 字符"


def _assistant_lines(message: dict) -> list[str]:
    lines: list[str] = []
    for call in message.get("tool_calls") or []:
        function = (call or {}).get("function") or {}
        name = function.get("name") or "工具"
        arguments = function.get("arguments") or ""
        lines.append(f"- 调用 {name}({_short(arguments, TOOL_ARGS_KEEP)})")
    content = (message.get("content") or "").strip()
    if content:
        lines.append(f"- 结论：{_short(content, ASSISTANT_KEEP)}")
    return lines


def render_digest(dropped: list[list[dict]], start_step: int = 1) -> str:
    """把被丢掉的单元渲染成固定格式的摘要（确定性：不含时间戳/随机量）。"""
    lines: list[str] = []
    for offset, unit in enumerate(dropped):
        step = start_step + offset
        head = unit[0]
        if is_note(unit):
            continue
        for message in unit:
            if message.get("role") != "assistant":
                continue
            for line in _assistant_lines(message):
                lines.append(f"- 步骤 {step}：{line[2:]}")
        tool_messages = [m for m in unit if m.get("role") == "tool"]
        if tool_messages:
            sizes = "、".join(f"{len(m.get('content') or ''):,}" for m in tool_messages)
            lines.append(f"- 步骤 {step}：工具返回合计 {sizes} 字符")
    if not lines:
        return ""
    text = DIGEST_HEADER + "\n" + "\n".join(lines)
    if len(text) > DIGEST_MAX_CHARS:
        text = text[:DIGEST_MAX_CHARS] + "\n- （更早的步骤已省略，见步骤详情）"
    return text


def plan_cut(messages: list[dict], *, keep_tail: int, target_tokens: int, count_tokens) -> tuple[list[dict], dict] | None:
    """算出一个压缩方案；不需要压缩（没有可丢的单元）时返回 None。

    保留：HEAD + 被丢弃单元里的全部用户补充要求 + 摘要 + 最近 keep_tail 个单元。
    如果这样仍然超目标，就从前面继续多丢几个单元；实在不行再截断摘要。
    """
    head = messages[:2]
    all_units = units(messages)
    if len(all_units) <= keep_tail:
        return None
    notes = [message for unit in all_units[:-keep_tail] if is_note(unit) for message in unit]
    keep_from = len(all_units) - keep_tail
    while True:
        tail = [message for unit in all_units[keep_from:] for message in unit]
        digest = render_digest(all_units[:keep_from])
        candidate = list(head) + list(notes)
        if digest:
            candidate.append({"role": "user", "content": digest})
        candidate.extend(tail)
        if count_tokens(candidate) <= target_tokens:
            break
        if keep_from <= 0:
            # 连"摘要 + 最近几步"都放不下：这不是压缩能解决的问题（目标太小或
            # 最近一步本身过大），交回调用方按硬顶处理，别把原文又原样拷一遍。
            return None
        keep_from -= 1
        notes = [message for unit in all_units[:keep_from] if is_note(unit) for message in unit]
    if keep_from <= 0:
        # 一个单元都没丢掉：这不是压缩，别把原文原样交回去
        return None
    stats = {
        "dropped_units": keep_from,
        "kept_units": len(all_units) - keep_from,
        "kept_notes": len(notes),
        "digest_chars": len(digest) if digest else 0,
    }
    return candidate, stats
