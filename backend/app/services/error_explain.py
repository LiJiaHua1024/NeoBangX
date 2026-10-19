"""把上游报错翻译成「一句中文解释 + 一句该怎么做」。

为什么交给 Chores 模型
----------------------
报错原文来自各家供应商，同一件事的措辞千奇百怪（"输入太长"就有十几种写法），
关键词表迟早会漏；而用户要的是一句能懂的话。所以规则写在 `prompts/报错解释.md` 里，
由廉价模型做这一步转写。关键词表保留下来只做**最后的机械兜底**，不再当主力。

Chores 不可用时怎么办（复用 app.services.decision 的三层骨架）
------------------------------------------------------------
1. 调 Chores 失败 → 用同一套「精确判定 → Jev → 机械兜底」决定**要不要再试一次**，
   最多 `MAX_ATTEMPTS` 次（默认 3）；Jev 不可用就退回状态码 / 异常类名判断；
2. 判定说别再试、或次数用完 → 用机械映射给一句话（状态码 + 关键词 → 中文），
   保证用户永远拿得到解释，而不是一句「生成失败」；
3. 机械映射也判不出来 → 通用兜底文案。

不变量
------
- 本模块**永不抛异常**：解释失败绝不能把错误事件本身也搞丢。
- 有硬超时（`TIMEOUT_SECONDS`）：解释是给人看的补充信息，不许把主链路拖住。
- 发给模型前先脱敏（隐去 URL 与凭据）；上游原文不直接回传给用户。
- 同类错误命中缓存：失败常成批出现，不必每次都花一次调用。
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from time import monotonic
from typing import Any

from app.services.decision import DecisionSpec, decide
from app.services.jev_judge import (
    Q_IS_PERMANENT_REQUEST_ERROR,
    Q_IS_TRANSIENT,
    ask_jev_decision,
    clip_error,
    exception_status,
    jev_usable,
    noul_value,
)

logger = logging.getLogger(__name__)

# 提示词文件名（prompts/报错解释.md）
EXPLAIN_PROMPT_NAME = "报错解释"

# 最多尝试次数（含首次）
MAX_ATTEMPTS = 3
# 解释这一步的**总时长预算**（秒）：这是给人看的补充信息，不能拖住错误提示。
# 之所以要总预算而不是「每次 8 秒 × 3 次」：那样最坏会让用户对着「生成中」等 24 秒，
# 而失败其实早就发生了。总预算把最坏等待压到 3 秒上下。
TOTAL_BUDGET_SECONDS = 3.0
# 单次调用上限（取剩余预算与此值的较小者）：Chores 写两句话通常 1~2 秒
ATTEMPT_TIMEOUT_SECONDS = 2.0
# 剩余预算低于这个值就不再重试（重试也来不及出结果，不如直接给兜底文案）
MIN_RETRY_BUDGET_SECONDS = 1.0
# 「要不要重试」那一步（可能问 Jev）也要吃预算，给它一个更短的上限
RETRY_DECISION_TIMEOUT_SECONDS = 1.5
# 解释只用一两句话，给足余量又不浪费
EXPLAIN_MAX_TOKENS = 220
# 缓存：同一类错误只问一次
CACHE_TTL_SECONDS = 3600.0
CACHE_MAX_ENTRIES = 128

# 机器可读分类（进日志与使用日志，也给前端选文案用）
CODE_CONTEXT_OVERFLOW = "context_overflow"
CODE_CONTENT_BLOCKED = "content_blocked"
CODE_PROVIDER_AUTH = "provider_auth"
CODE_PROVIDER_BUSY = "provider_busy"
CODE_TIMEOUT = "timeout"
CODE_NETWORK = "network"
CODE_UNKNOWN = "unknown"

# 机械兜底文案：分类 -> (发生了什么, 该怎么做)。
# 措辞与 prompts/报错解释.md 的判断顺序一致，模型不可用时用户看到的仍是同一套说法。
_MECHANICAL: dict[str, tuple[str, str]] = {
    CODE_CONTEXT_OVERFLOW: (
        "材料太长了，模型一次读不完",
        "把原文拆成两段分别处理，或换一个能读更长的模型",
    ),
    CODE_CONTENT_BLOCKED: (
        "这段内容被模型服务拦下了",
        "删掉可能敏感的段落，或换个说法再试一次",
    ),
    CODE_PROVIDER_AUTH: (
        "模型服务配置有问题，不是你的操作有误",
        "请联系管理员处理，重试也不会好",
    ),
    CODE_PROVIDER_BUSY: (
        "模型服务暂时繁忙",
        "等一两分钟再试，或换一个模型",
    ),
    CODE_TIMEOUT: (
        "这次响应太慢，超时了",
        "直接重试；已经生成的部分可以接着往下写",
    ),
    CODE_NETWORK: (
        "网络连接中断了",
        "检查网络后重试；已经生成的内容已保留",
    ),
    CODE_UNKNOWN: (
        "这次没有生成成功",
        "稍后重试一次；持续出现请联系管理员",
    ),
}

# 关键词表：与 jev_judge 里「换谁都一样」那张表同源（下面有测试守着不许漂）。
# 只用于**机械兜底**的分类，不参与 Chores 调用。
_CONTEXT_MARKERS = (
    "context length",
    "context_length_exceeded",
    "context window",
    "maximum context",
    "too many tokens",
    "prompt is too long",
    "input is too long",
    "reduce the length",
    "上下文",
    "输入过长",
)
_FILTER_MARKERS = (
    "content policy",
    "content_policy",
    "content management policy",
    "content filter",
    "content_filter",
    "response was filtered",
    "prompt was filtered",
    "responsible ai",
    "moderation",
    "内容审核",
    "违规内容",
)

_URL_RE = re.compile(r"https?://\S+", re.I)
_CRED_RE = re.compile(r"(?i)\b(?:sk|pk|api[-_]?key|bearer|token)[-_:=\s]*[A-Za-z0-9\-_.]{8,}")


@dataclass(frozen=True)
class FailureExplanation:
    """给用户看的解释：第一行发生了什么，第二行该怎么做。"""

    message: str
    advice: str
    code: str
    source: str  # chores | fallback | cache


def sanitize_error_text(text: str, limit: int = 600) -> str:
    """脱敏后再交给模型：隐去链接与凭据，并截断。"""
    out = _URL_RE.sub("[链接已隐去]", str(text or ""))
    out = _CRED_RE.sub("[凭据已隐去]", out)
    return clip_error(out, limit)


def classify_failure(*, exc: BaseException | None = None, status: int | None = None, raw_message: str = "") -> str:
    """机械分类：给兜底文案与缓存键用。判不出来返回 unknown。"""
    text = f"{exc or ''} {raw_message or ''}".lower()
    if any(marker in text for marker in _CONTEXT_MARKERS):
        return CODE_CONTEXT_OVERFLOW
    if any(marker in text for marker in _FILTER_MARKERS):
        return CODE_CONTENT_BLOCKED
    resolved = status if status is not None else (exception_status(exc) if exc is not None else None)
    name = (exc.__class__.__name__ if exc is not None else "") or ""
    lowered = name.lower()
    if resolved in (401, 402, 403):
        return CODE_PROVIDER_AUTH
    if resolved == 429 or (resolved is not None and resolved >= 500):
        return CODE_PROVIDER_BUSY
    if resolved == 408 or "timeout" in lowered:
        return CODE_TIMEOUT
    if "connection" in lowered or isinstance(exc, (TimeoutError, ConnectionError)):
        return CODE_NETWORK
    return CODE_UNKNOWN


def mechanical_explanation(code: str) -> FailureExplanation:
    message, advice = _MECHANICAL.get(code, _MECHANICAL[CODE_UNKNOWN])
    return FailureExplanation(message=message, advice=advice, code=code, source="fallback")


def parse_explanation(text: str) -> tuple[str, str] | None:
    """解析模型的回包：契约是两行纯文本。

    刻意不用 JSON：这里要的是一句给人看的话，行数就是天然分隔，解析失败还有机械兜底
    顶着（见模块开头的不变量），没必要为此引入 JSON mode 与它对模型的额外要求。
    """
    lines = []
    for raw in str(text or "").splitlines():
        line = raw.strip().lstrip("-•*#").strip()
        line = re.sub(r"^\d+[.、)]\s*", "", line).strip()
        if line:
            lines.append(line)
    if not lines:
        return None
    message = lines[0][:60]
    if len(message) < 4:
        return None
    advice = lines[1][:80] if len(lines) > 1 else _MECHANICAL[CODE_UNKNOWN][1]
    return message, advice


# ---------------------------------------------------------------------------
# 缓存：失败常常成批出现（同一家上游抖一下就是一片 5xx），同一类错误只问一次
# ---------------------------------------------------------------------------

_CACHE: dict[str, tuple[float, float, FailureExplanation]] = {}
# 兜底文案的缓存时间短得多：Chores 可能只是临时抽风，过一会儿就该重新尝试它
FALLBACK_CACHE_TTL_SECONDS = 120.0


def cache_key(code: str, exc: BaseException | None, raw_message: str) -> str:
    return f"{code}|{exc.__class__.__name__ if exc is not None else ''}|{sanitize_error_text(raw_message, 120)}"


def cache_get(key: str) -> FailureExplanation | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    created, ttl, value = entry
    if monotonic() - created > ttl:
        _CACHE.pop(key, None)
        return None
    return value


def cache_put(key: str, value: FailureExplanation, ttl: float = CACHE_TTL_SECONDS) -> None:
    _CACHE[key] = (monotonic(), ttl, value)
    if len(_CACHE) > CACHE_MAX_ENTRIES:
        oldest = sorted(_CACHE.items(), key=lambda item: item[1][0])[: len(_CACHE) - CACHE_MAX_ENTRIES]
        for stale, _ in oldest:
            _CACHE.pop(stale, None)


def clear_cache() -> None:
    """清空缓存（测试与运维用）。"""
    _CACHE.clear()


# ---------------------------------------------------------------------------
# 「要不要再试一次」的判定：与 Provider 切换 / 标题任务重试同一套骨架
# ---------------------------------------------------------------------------

EXPLAIN_QUESTIONS = {
    "is_transient": Q_IS_TRANSIENT,
    "is_permanent_request_error": Q_IS_PERMANENT_REQUEST_ERROR,
}


def _certain_explain_verdict(exc: BaseException) -> bool | None:
    """精确判定：状态码与异常类名能定的直接定，定不了（None）去问 Jev。"""
    status = exception_status(exc)
    if status is not None:
        if status in (408, 425, 429) or status >= 500:
            return True
        if 400 <= status < 500:
            return False
    lowered = (exc.__class__.__name__ or "").lower()
    if "timeout" in lowered or "connection" in lowered:
        return True
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    return None


def _heuristic_explain_retryable(exc: BaseException) -> bool:
    """机械兜底：只有「确定是永久错误」才不重试。

    与 Provider 切换那边的口径相反（那里拿不准就不切）：解释调用便宜、无副作用、
    不影响用户已经拿到的正文，多试一次比让用户只看到一句干巴巴的兜底话更划算。
    """
    verdict = _certain_explain_verdict(exc)
    return True if verdict is None else verdict


def _combine_explain(answers: dict) -> bool | None:
    transient = noul_value(answers, "is_transient")
    permanent = noul_value(answers, "is_permanent_request_error")
    if transient is None or permanent is None:
        return None
    return transient > 0.5 and permanent < 0.5


def _build_explain_state(exc: BaseException, **context: object) -> dict:
    status = exception_status(exc)
    return {
        "exception_class": exc.__class__.__name__,
        "http_status": status if status is not None else "unknown",
        "error_message": clip_error(exc) or exc.__class__.__name__,
        "attempt": context.get("attempt", 1),
    }


EXPLAIN_RETRY_DECISION = DecisionSpec(
    key="error_explain_retry",
    questions=EXPLAIN_QUESTIONS,
    certain=_certain_explain_verdict,
    heuristic=_heuristic_explain_retryable,
    combine=_combine_explain,
    ask=ask_jev_decision,
    usable=jev_usable,
    build_state=_build_explain_state,
)


async def _try_explain(
    llm: Any,
    model: str,
    prompt: str,
    code: str,
    jev_cfg: dict | None,
    reasoning_effort: str | None = None,
    extra_body: dict | None = None,
) -> FailureExplanation | None:
    """在总预算内尽力拿一次 Chores 转写；拿不到返回 None（由调用方走机械兜底）。

    预算是**总时长**而不是单次：每次尝试的超时取「剩余预算」与单次上限的较小者，
    剩余预算不够重试就直接放弃。用户等的是「失败了、该怎么办」，不是这句补充说明，
    所以宁可少试一次，也不能让他对着「生成中」干等。
    """
    deadline = monotonic() + TOTAL_BUDGET_SECONDS
    for attempt in range(1, MAX_ATTEMPTS + 1):
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        try:
            text = await asyncio.wait_for(
                llm.chat(
                    user_prompt=prompt,
                    model=model,
                    max_tokens=EXPLAIN_MAX_TOKENS,
                    reasoning_effort=reasoning_effort,
                    extra_body=extra_body,
                ),
                timeout=min(remaining, ATTEMPT_TIMEOUT_SECONDS),
            )
            parsed = parse_explanation(text)
            if parsed is None:
                raise ValueError("解释回包不符合两行契约")
            return FailureExplanation(parsed[0], parsed[1], code, "chores")
        except Exception as error:  # noqa: BLE001 - 解释失败绝不能影响错误事件本身
            remaining = deadline - monotonic()
            logger.warning(
                "报错解释第 %s/%s 次失败（剩余预算 %.1fs）：%s",
                attempt, MAX_ATTEMPTS, max(0.0, remaining), error,
            )
            if attempt >= MAX_ATTEMPTS or remaining < MIN_RETRY_BUDGET_SECONDS:
                break
            # 值不值得再试：Jev 优先，不可用立刻回退机械判定（同一套骨架）。
            # 这一步同样受预算约束——Jev 的配置超时可达 30 秒，在解释路径上必须压住
            try:
                verdict = await asyncio.wait_for(
                    decide(EXPLAIN_RETRY_DECISION, error, jev_cfg, attempt=attempt),
                    timeout=min(remaining, RETRY_DECISION_TIMEOUT_SECONDS),
                )
            except Exception as decision_error:  # noqa: BLE001
                logger.warning("报错解释的重试判定超时/失败，按不再重试处理: %s", decision_error)
                break
            if not verdict.verdict:
                logger.info("报错解释不再重试（判定来源 %s %s）", verdict.source, verdict.detail)
                break
    return None


async def explain_failure(
    llm: Any | None,
    model: str,
    *,
    prompt: str | None,
    exc: BaseException | None = None,
    status: int | None = None,
    raw_message: str = "",
    tool_name: str = "",
    stage: str = "",
    jev_cfg: dict | None = None,
    reasoning_effort: str | None = None,
    extra_body: dict | None = None,
) -> FailureExplanation:
    """把失败翻译成给用户看的两句话。**永不抛异常**，最差也有机械兜底。

    llm 为 None（Chores 不可用）时直接走兜底；prompt 为空同理——
    宁可给一句机械文案，也不能让错误事件等一个注定失败的调用。
    reasoning_effort / extra_body 由调用方按「模型默认 + 工具推理规则」解析好传进来，
    本模块只负责透传（关推理各家写法不同，不在这里做任何硬编码）。
    """
    code = classify_failure(exc=exc, status=status, raw_message=raw_message)
    key = cache_key(code, exc, raw_message)
    hit = cache_get(key)
    if hit is not None:
        return FailureExplanation(hit.message, hit.advice, hit.code, "cache")

    if llm is not None and prompt:
        try:
            # 外层再兜一层硬上限：预算逻辑万一有疏漏（某次调用不响应取消等），
            # 也不能让错误事件无限期等下去
            explanation = await asyncio.wait_for(
                _try_explain(llm, model, prompt, code, jev_cfg, reasoning_effort, extra_body),
                timeout=TOTAL_BUDGET_SECONDS + 1.0,
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("报错解释超出预算，改用机械文案: %s", error)
            explanation = None
        if explanation is not None:
            cache_put(key, explanation)
            return explanation

    fallback = mechanical_explanation(code)
    cache_put(key, fallback, ttl=FALLBACK_CACHE_TTL_SECONDS)
    return fallback

