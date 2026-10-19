"""Jev 决策模型：用明确规则判定 Provider 错误是否值得重试，替代启发式关键词匹配。

Jev 是什么
----------
Jev 是 TypeSafe 的决策模型（System One 系列旗舰模型，见
https://docs.typesafe.ai/introduction），不是聊天模型，而是一个只做
「窄判定」的决策模型：调用方把待判定的事实拼成 `state`（一段文本），把要问的
问题拼成 `questions`（每题含 `type` + `instructions` + `criteria`），一次 POST
到 System One 端点（官方 `https://api.typesafe.ai/v1/systemone`，header
`Authorization: Bearer <TYPESAFE_API_KEY>`），拿回 `answers` 里每题的概率/选项。
官方模型名如 `jev-latest`（默认）、`jev-1.13.0`、`jev-preview`。
同一请求体协议的 decisions 兼容端点（如 Command Code 网关、`typesafe/jev`
这类中转命名）同样可用，直接填在管理后台的自定义端点里即可。
本仓库的用法先例见 `prompt-tuning/scripts/scorer.py`（noul 七项检查）与
`ab_aspect.py`（choice 盲评），协议细节与之完全一致。

- 请求：`POST {base_url}`，body `{"model": ..., "state": ..., "questions": {...}}`，
  header `Authorization: Bearer {api_key}`（`base_url` 即完整端点地址）。
  官方示例 body 为 `{"state": ..., "model": "jev-latest", "questions": {...}}`。
- 回答：`{"model": "jev-1.13.0", "answers": {"should_retry": {"type": "noul", "noul": 0.87}}, "usage": {...}}`，
  noul > 0.5 视为肯定；choice/score 形态同样兼容（取概率最大的选项）。

在本后端的位置
--------------
之前 `llm_router.is_retryable` 靠异常类名/错误文案的关键词匹配决定「要不要切
下一家 Provider」，规则模糊且容易误判。现在规则被写成自然语言交给 Jev 判定，
启发式只保留为「Jev 不可用时的立刻回退」（超时、报错、回包无法解析、未启用，
一律不重试 Jev 本身，直接回退，不阻塞主流程）。

时序保证（前端为什么不会收到多次错误/突变）
--------------------------------------------
调用方（`LLMRouter.chat` / `chat_stream_with_stop`）在判定完成前不产生任何
SSE 事件：Jev 判定是 `await` 住的，后台先等 Jev（最多 `timeout` 秒），拿到结论
后要么 `yield ("fallback", ...)` 继续试下一家，要么 raise 由 `chat.py` 统一转成
**唯一**的 terminal `event: error`。判定期间前端停留在加载/切换进度态，只是晚
几秒收到结论，不存在「先收到一个错误、又变成另一个」的突变。

三层判定（按顺序）：
1. 精确程序化：异常类名（litellm 已解析）、数字 HTTP 状态码、空响应/超时、
   自抛配置错误 —— 语义完全确定，直接返回，不问 Jev（省一次往返与费用）。
   关键词模糊匹配不属于这一层，那是 Jev 的活。
2. Jev 判定：只问真正模糊的（400/422、无状态码、文案不明），多道 Noul 一次并行问。
3. 启发式回退：Jev 不可用（超时/报错/回包无法解析、未启用）立刻回退，不重试 Jev。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.services.decision import SOURCE_HEURISTIC, DecisionSpec, decide

logger = logging.getLogger(__name__)

# state 里错误原文的截断长度：给足判定信息，又不把网关长堆栈全塞进计费
_MAX_ERROR_CHARS = 1200

# 「换任何 Provider 结果都一样」的错误：命中就不切换，直接抛出，免得白等后面的家。
# 其余失败一律切换 —— 401/403（key 失效、欠费）、404（该家没有这个模型）、
# 400/422（该家不支持某个参数）都是「某一家自己的问题」，正是备用家该顶上的场景，
# 与管理后台优先级链「首位优先，失败自动 fallback 到下一位」的语义一致。
# （从 llm_router 整体搬迁至此，llm_router.is_retryable 原样委托，保证旧测试与调用方不动。）
_NON_RETRYABLE_CLASSES = {"ContextWindowExceededError", "ContentPolicyViolationError"}
_NON_RETRYABLE_KEYWORDS = (
    # 上下文超限
    "context length",
    "context_length_exceeded",
    "context window",
    "maximum context",
    "too many tokens",
    "prompt is too long",
    "input is too long",
    "reduce the length",
    # 内容审核
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
    # 国内网关的中文措辞（与上面两条同义）：报错解读的机械分类复用同一张表，
    # 少这两条会让「输入过长」这类中文报错落到 unknown，白白重试
    "上下文",
    "输入过长",
)

# 精确可判定的异常类（litellm 已按协议解析好的类名，非关键词模糊匹配）。
# 命中即直接程序化判定，不问 Jev：这类错误语义明确，问也是浪费一次往返。
# 模糊的（如 BadRequestError / UnprocessableEntityError / 无状态码的通用异常）
# 才值得问 Jev —— 关键词启发式最不靠谱的正是这一块。
_CERTAIN_NON_RETRYABLE_CLASSES = frozenset(_NON_RETRYABLE_CLASSES)
_CERTAIN_RETRYABLE_CLASSES = frozenset({
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "RateLimitError",
    "ServiceUnavailableError",
    "BadGatewayError",
    "InternalServerError",
    "GatewayTimeout",
    "Timeout",
    "APIConnectionError",
    "APIError",
})

# Provider 切换里"性质存疑、必须看文案"的状态码：400/422 可能是参数不支持
# （值得切），也可能是上下文超限的另一种包装（不值得切）——只好问 Jev。
# 除此之外的已知状态码语义都明确（ key / 配额 / 模型归属 / 限流 / 服务端），
# 全是"某一家自己的问题"，直接切。
_PROVIDER_AMBIGUOUS_STATUSES = frozenset({400, 422})

# 413 单独列出：请求体自身过大是请求的性质、与哪家无关，换谁都一样，直接不切。
_PROVIDER_CERTAIN_FALSE_STATUSES = frozenset({413})

# 标题任务的状态码表（与旧启发式同义，纯程序化）：4xx 永久失败，
# 408/425/429 与 5xx 稍后重试。413 同上：同样的超大载荷稍后重试也一样失败。
_TITLE_CERTAIN_FALSE_STATUSES = frozenset({400, 401, 402, 403, 404, 405, 409, 413, 422})
_TITLE_CERTAIN_TRUE_STATUSES = frozenset({408, 425, 429})

# 我们自己抛出的配置类错误（文案是我们写的，语义完全确定，重试也不会好）
_SELF_RAISED_PERMANENT_MARKERS = (
    "未绑定任何可用 provider",
    "模型不可用",
    "模型已禁用",
    "未配置",
)


def _is_timeout_class(exc: BaseException) -> bool:
    return "timeout" in (exc.__class__.__name__ or "").lower()


def _certain_provider_verdict(exc: BaseException) -> bool | None:
    """Provider 切换的精确程序化判定。确定返回 True/False，拿不准返回 None（去问 Jev）。

    确定性只来自三处非模糊信号：litellm 解析好的异常类名、数字 HTTP 状态码、
    空响应/超时（该家没干活）。绝不做文案关键词匹配 —— 那是 Jev 的活。
    """
    from app.services.llm_router import EmptyResponseError

    if isinstance(exc, EmptyResponseError) or _is_timeout_class(exc):
        return True
    name = exc.__class__.__name__ or ""
    if name in _CERTAIN_NON_RETRYABLE_CLASSES:
        return False
    status = _exception_status(exc)
    if status is not None:
        if status in _PROVIDER_CERTAIN_FALSE_STATUSES:
            return False
        if status in _PROVIDER_AMBIGUOUS_STATUSES:
            return None
        return True
    if name in _CERTAIN_RETRYABLE_CLASSES:
        return True
    return None


def _certain_title_verdict(exc: BaseException) -> bool | None:
    """标题任务的精确程序化判定。确定返回 True/False，拿不准返回 None（去问 Jev）。"""
    if exc.__class__.__name__ == "TitleJobPermanentError":
        return False
    from app.services.llm_router import EmptyResponseError

    if isinstance(exc, EmptyResponseError):
        return True
    name = exc.__class__.__name__ or ""
    if name in _CERTAIN_NON_RETRYABLE_CLASSES:
        return False
    status = _exception_status(exc)
    if status is not None:
        if status in _TITLE_CERTAIN_FALSE_STATUSES:
            return False
        if status in _TITLE_CERTAIN_TRUE_STATUSES or status >= 500:
            return True
        return None
    message = str(exc).lower()
    if any(marker in message for marker in _SELF_RAISED_PERMANENT_MARKERS):
        return False
    return None


def heuristic_is_retryable(exc: Exception) -> bool:
    """程序化回退判定：默认切换；只有上下文超限与内容审核这两类不切。"""
    name = exc.__class__.__name__ or ""
    if name in _NON_RETRYABLE_CLASSES:
        return False
    msg = str(exc).lower()
    if any(keyword in msg for keyword in _NON_RETRYABLE_KEYWORDS):
        return False
    return True


def _exception_status(exc: BaseException) -> int | None:
    for candidate in (
        getattr(exc, "status_code", None),
        getattr(exc, "code", None),
        getattr(getattr(exc, "response", None), "status_code", None),
    ):
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        if 100 <= value <= 599:
            return value
    return None


def heuristic_is_title_retryable(exc: BaseException) -> bool:
    """标题任务层程序化回退判定（同步版，供 Jev 不可用时回退）。

    单次尝试内部仍由 LLMRouter 做 Provider fallback；这里决定的是「整个任务
    过一阵再重试一次」还是「直接判永久失败」。4xx（除 408/429）与配置类错误
    重试也不会好，转永久失败；5xx/限流/超时/空响应值得稍后重试。
    """
    from app.services.llm_router import EmptyResponseError

    name = exc.__class__.__name__ or ""
    if name == "TitleJobPermanentError":
        return False
    if isinstance(exc, EmptyResponseError):
        return True
    if not heuristic_is_retryable(exc):
        return False

    status = _exception_status(exc)
    if status is not None:
        if status in {400, 401, 402, 403, 404, 405, 409, 422}:
            return False
        return status in {408, 425, 429} or status >= 500

    message = str(exc).lower()
    permanent_markers = (
        "authentication",
        "permission",
        "notfound",
        "badrequest",
        "未绑定任何可用 provider",
        "模型不可用",
        "模型已禁用",
        "未配置",
    )
    return not any(marker in name.lower() or marker in message for marker in permanent_markers)


# 发给 Jev 的问题（英文，见下注释）。
#
# 写法遵循 TypeSafe 官方最佳实践（https://docs.typesafe.ai/primitives/noul）：
# 1. 每题只做一个 snap judgment（"a knowledgeable person makes in a second"），
#    不把多条件塞进一道题："Is the customer angry and asking for a refund?" 是反例，
#    拆成两道 Noul、组合逻辑写在代码里才是正例。之前"一道大题列完所有规则"的写法
#    正好犯了这条，已拆掉。
# 2. 高值恒为 yes：问题都按肯定句写，绝不反转（"Is the message free of personal
#    data?" 是反例），否则阈值代码极易读反。
# 3. 边界无歧义：每题配 criteria 写清 true/false 各指什么；instructions 写完整问题
#   （question ID 不会发给模型，不能依赖它传意）。
# 4. 同一次 state 需要的几道题放在 ONE request 里并行问（加题几乎不增加耗时，
#    只多花问题 token）；组合（与/或/阈值）写在下面代码里，改权重只改代码不改提示词。
# 5. 全英文：Jev 对英文支持最好，state 与 instructions 统一用英文（错误原文保持原样）。
Q_IS_CONTEXT_OVERFLOW = {
    "type": "noul",
    "instructions": (
        "Given `http_status` and `error_message`, did this request fail because "
        "the input exceeds the model's context window or token limit?"
    ),
    "criteria": {
        "true": "The error states the input is too long, the context length was exceeded, or the prompt must be shortened.",
        "false": "The error is about anything else: authentication, a missing model, rate limits, server errors, content filtering, or network problems.",
    },
}

Q_IS_CONTENT_FILTERED = {
    "type": "noul",
    "instructions": (
        "Given `http_status` and `error_message`, was this request or its response "
        "blocked by content moderation, safety filtering, or responsible-AI policy?"
    ),
    "criteria": {
        "true": "The error states content was filtered, blocked, or flagged by a content policy, safety system, or moderation.",
        "false": "The error is about anything else: length limits, authentication, a missing model, rate limits, server errors, or network problems.",
    },
}

Q_IS_PERMANENT_REQUEST_ERROR = {
    "type": "noul",
    "instructions": (
        "Given `http_status` and `error_message`, is this task itself invalid, "
        "unauthorized, or misconfigured, so that retrying the identical task later "
        "would fail the same way?"
    ),
    "criteria": {
        "true": "Invalid credentials, permission denied, model not found, invalid request parameters, unpaid bills, or an unconfigured/disabled model. HTTP 4xx errors other than rate limiting (429) and request timeout (408) belong here.",
        "false": "A temporary condition (rate limiting, timeouts, server errors, network issues, empty responses), a length-limit or filtering problem, or anything unclear.",
    },
}

Q_IS_TRANSIENT = {
    "type": "noul",
    "instructions": (
        "Given `http_status` and `error_message`, is this a temporary condition "
        "that may resolve if the identical task is retried later?"
    ),
    "criteria": {
        "true": "Rate limiting (HTTP 429), request timeout (408), server-side 5xx errors, timeouts, network interruptions, or empty responses.",
        "false": "Invalid, unauthorized, or misconfigured requests, length-limit or content-filtering failures, or anything unclear.",
    },
}

# Provider 切换：只问"换谁都一样"的两类（其余默认值得切，见下阈值注释）
PROVIDER_QUESTIONS = {
    "is_context_overflow": Q_IS_CONTEXT_OVERFLOW,
    "is_content_filtered": Q_IS_CONTENT_FILTERED,
}

# 标题任务稍后重试：两类否决 + 永久错误 + 瞬态确认，四题同一次并行问
TITLE_QUESTIONS = {
    "is_context_overflow": Q_IS_CONTEXT_OVERFLOW,
    "is_content_filtered": Q_IS_CONTENT_FILTERED,
    "is_permanent_request_error": Q_IS_PERMANENT_REQUEST_ERROR,
    "is_transient": Q_IS_TRANSIENT,
}

# 阈值（官方依据：https://docs.typesafe.ai/primitives/noul#reading-a-noul ——
# "Where to set the threshold depends on the cost of being wrong"）。
# Provider 侧：漏掉一次本可成功的切换（false-no）远比白试一家（false-yes）贵，
# 所以只有当 Jev 比较确信（> 0.7）是"换谁都一样"时才不切；拿不准一律切。
PROVIDER_RETRY_SUPPRESS_THRESHOLD = 0.7
# 标题任务侧：后台任务掉一次可稍后补，但旧规则即"拿不准就不重试"，沿用：
# 瞬态必须明确（> 0.5），且三类否决必须明确不成立（< 0.5）。
TITLE_TRANSIENT_THRESHOLD = 0.5


def _clip(text: str, limit: int = _MAX_ERROR_CHARS) -> str:
    collapsed = " ".join(str(text or "").split())
    return collapsed[:limit] if len(collapsed) > limit else collapsed


def build_provider_retry_state(
    exc: BaseException,
    *,
    model_id: str = "",
    provider_label: str = "",
    provider_index: int = 0,
    provider_total: int = 0,
) -> dict:
    """拼给 Jev 的 state（结构化 dict，英文键）。

    官方建议（https://docs.typesafe.ai/primitives#reference-specific-fields）：
    state 有多个部分时用结构化对象，问题里用反引号路径点名要判定的部分
    （如 `error_message`），模型才知道看哪里。只含判定需要的事实，
    不含密钥与网关地址。
    """
    status = _exception_status(exc)
    state: dict[str, object] = {
        "exception_class": exc.__class__.__name__,
        "http_status": status if status is not None else "unknown",
        "error_message": _clip(exc) or exc.__class__.__name__,
    }
    if model_id:
        state["model"] = model_id
    if provider_label:
        state["failed_provider"] = provider_label
    if provider_total:
        state["attempt"] = f"provider {provider_index} of {provider_total} failed"
    return state


def build_title_retry_state(exc: BaseException) -> dict:
    status = _exception_status(exc)
    return {
        "exception_class": exc.__class__.__name__,
        "http_status": status if status is not None else "unknown",
        "error_message": _clip(exc) or exc.__class__.__name__,
    }


def parse_jev_answer(spec_type: str, ans: Any) -> float | str | None:
    """兼容 noul / choice / score 三种回包（与 prompt-tuning scorer.parse_answer 同口径）。"""
    if not isinstance(ans, dict):
        return None
    if spec_type == "noul":
        value = ans.get("noul")
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
    if spec_type == "choice":
        choice = ans.get("choice")
        return choice if choice in ("A", "B", "tie") else None
    probs = ans.get("probabilities") or {}
    if isinstance(probs, dict) and probs:
        try:
            return max(probs.values())
        except (TypeError, ValueError):
            return None
    return None


def _jev_enabled(jev_cfg: dict | None) -> bool:
    return bool(jev_cfg and jev_cfg.get("enabled"))


def _jev_usable(jev_cfg: dict | None) -> bool:
    """Jev 是否配齐到可以发请求：启用 + 有地址 + 有 Key + 有模型名。"""
    if not _jev_enabled(jev_cfg):
        return False
    assert jev_cfg is not None
    return bool(
        (jev_cfg.get("base_url") or "").strip()
        and (jev_cfg.get("api_key") or "").strip()
        and (jev_cfg.get("model") or "").strip()
    )


async def a_ask_jev(
    jev_cfg: dict,
    state: str | dict,
    questions: dict,
    *,
    referer: str = "",
    title: str = "",
) -> dict:
    """调一次 Jev decisions 接口，返回原始 answers 字典。

    只试一次、不重试 Jev 本身：任何失败（超时/非 200/回包无 answers）都直接抛给
    调用方转入启发式回退。超时由配置 `jev_timeout` 控制。
    """
    base_url = (jev_cfg.get("base_url") or "").strip()
    timeout = jev_cfg.get("timeout") or 4
    try:
        timeout_value = float(timeout)
    except (TypeError, ValueError):
        timeout_value = 4.0
    body = {"model": (jev_cfg.get("model") or "").strip(), "state": state, "questions": questions}
    headers = {
        "Authorization": f"Bearer {(jev_cfg.get('api_key') or '').strip()}",
        "Content-Type": "application/json",
    }
    if referer:
        headers["HTTP-Referer"] = referer
    if title:
        headers["X-Title"] = title
    async with httpx.AsyncClient(timeout=timeout_value) as client:
        resp = await client.post(base_url, headers=headers, json=body)
        if resp.status_code != 200:
            raise RuntimeError(f"Jev 返回 HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise RuntimeError(f"Jev 回包不是合法 JSON: {resp.text[:200]}") from exc
    answers = (data or {}).get("answers")
    if not isinstance(answers, dict):
        raise RuntimeError("Jev 回包缺少 answers 字段")
    return answers


def _noul_value(answers: dict, question_key: str) -> float | None:
    """取一道 Noul 题的概率值；缺失/非法返回 None（调用方回退启发式）。"""
    parsed = parse_jev_answer("noul", answers.get(question_key))
    if parsed is None:
        return None
    try:
        return float(parsed)
    except (TypeError, ValueError):
        return None


def _ask_jev(cfg: dict, state: Any, questions: dict) -> Any:
    """转一次 Jev 请求。

    刻意包一层而不是把 `a_ask_jev` 直接交给 `DecisionSpec.ask`：函数体里对模块全局
    的查找发生在调用时，测试 monkeypatch `jev_judge.a_ask_jev` 才能照旧生效。
    """
    return a_ask_jev(cfg, state, questions)


def _combine_provider(answers: dict) -> bool | None:
    """Provider 切换：任一否决题超过阈值才不切；回包缺题返回 None（转兜底）。"""
    overflow = _noul_value(answers, "is_context_overflow")
    filtered = _noul_value(answers, "is_content_filtered")
    if overflow is None or filtered is None:
        return None
    return not (
        overflow > PROVIDER_RETRY_SUPPRESS_THRESHOLD
        or filtered > PROVIDER_RETRY_SUPPRESS_THRESHOLD
    )


def _combine_title(answers: dict) -> bool | None:
    """标题任务：瞬态必须明确成立，且三类否决必须明确不成立；缺题返回 None。"""
    transient = _noul_value(answers, "is_transient")
    negatives = [
        _noul_value(answers, key)
        for key in ("is_context_overflow", "is_content_filtered", "is_permanent_request_error")
    ]
    if transient is None or any(value is None for value in negatives):
        return None
    return transient > TITLE_TRANSIENT_THRESHOLD and all(
        value < TITLE_TRANSIENT_THRESHOLD for value in negatives  # type: ignore[operator]
    )


# 两处判定的全部可变部分（问题、规则、兜底、回包解析）集中在这里；
# 「精确 → Jev → 兜底」的编排由 app.services.decision.decide 负责，不再各写一遍。
PROVIDER_DECISION = DecisionSpec(
    key="provider_retry",
    questions=PROVIDER_QUESTIONS,
    certain=_certain_provider_verdict,
    heuristic=heuristic_is_retryable,
    combine=_combine_provider,
    ask=_ask_jev,
    usable=_jev_usable,
    build_state=build_provider_retry_state,
)

TITLE_DECISION = DecisionSpec(
    key="title_retry",
    questions=TITLE_QUESTIONS,
    certain=_certain_title_verdict,
    heuristic=heuristic_is_title_retryable,
    combine=_combine_title,
    ask=_ask_jev,
    usable=_jev_usable,
    build_state=build_title_retry_state,
)


async def a_judge_provider_retry(
    exc: BaseException,
    jev_cfg: dict | None,
    *,
    model_id: str = "",
    provider_label: str = "",
    provider_index: int = 0,
    provider_total: int = 0,
) -> bool | None:
    """问 Jev「换下一家是否有可能成功」。返回 None 表示 Jev 不可用，调用方必须回退启发式。

    三层：精确可判定的（异常类/状态码/空响应/超时）直接程序化返回，不问 Jev；
    模糊的（400/422/无状态码）两道否决题一次并行问，只有 Jev 比较确信是
    "换谁都一样"（任一否决题 > 阈值）才不切，拿不准一律切。
    """
    result = await decide(
        PROVIDER_DECISION,
        exc,
        jev_cfg,
        model_id=model_id,
        provider_label=provider_label,
        provider_index=provider_index,
        provider_total=provider_total,
    )
    # 旧契约：只有「精确判定」或「Jev 给了结论」才返回 bool；
    # 走了兜底就返回 None，把最终决定权留给调用方的启发式入口。
    return result.verdict if result.source != SOURCE_HEURISTIC else None


async def a_should_retry_provider(
    exc: Exception,
    jev_cfg: dict | None = None,
    **context: Any,
) -> bool:
    """Provider 切换总入口：Jev 优先，不可用立刻回退启发式。永远返回 bool，不抛异常。"""
    result = await decide(PROVIDER_DECISION, exc, jev_cfg, **context)
    return result.verdict


async def a_judge_title_retry(exc: BaseException, jev_cfg: dict | None) -> bool | None:
    """问 Jev「标题任务稍后重试是否有可能成功」。None 表示不可用，调用方回退启发式。

    三层：精确可判定的（永久错误类/状态码表/空响应/自抛配置错误）直接程序化返回；
    模糊的（无状态码、文案不明）四道题一次并行问：瞬态必须明确成立，且三类否决
    必须明确不成立，才值得稍后重试；拿不准一律不重试（沿用旧规则）。
    """
    result = await decide(TITLE_DECISION, exc, jev_cfg)
    return result.verdict if result.source != SOURCE_HEURISTIC else None


async def a_should_retry_title(exc: BaseException, jev_cfg: dict | None = None) -> bool:
    """标题任务重试总入口：Jev 优先，不可用立刻回退启发式。永远返回 bool，不抛异常。"""
    if exc.__class__.__name__ == "TitleJobPermanentError":
        return False
    result = await decide(TITLE_DECISION, exc, jev_cfg)
    return result.verdict


async def a_probe_jev(jev_cfg: dict) -> tuple[bool, int]:
    """管理后台「测试连接」用：发一道无意义的 noul 题，只验证端点通、回包可解析。

    返回 (parsed_retryable, latency_ms)。任何失败直接抛给调用方转 502。
    """
    from time import monotonic

    if not (jev_cfg.get("base_url") or "").strip():
        raise RuntimeError("尚未填写 Jev 端点地址")
    if not (jev_cfg.get("api_key") or "").strip():
        raise RuntimeError("尚未填写 Jev API Key")
    if not (jev_cfg.get("model") or "").strip():
        raise RuntimeError("尚未填写 Jev 模型名")
    started = monotonic()
    answers = await a_ask_jev(
        jev_cfg,
        {"probe": "connectivity check; no real judgment needed, just verify the endpoint and response format"},
        {
            "probe_ok": {
                "type": "noul",
                "instructions": "This is a connectivity probe. Answer yes.",
                "criteria": {"true": "The probe reached a working endpoint.", "false": "The probe failed."},
            }
        },
    )
    latency_ms = int((monotonic() - started) * 1000)
    decided = _noul_value(answers, "probe_ok")
    if decided is None:
        raise RuntimeError(f"Jev 回包无法解析：{answers}")
    return decided > 0.5, latency_ms


def load_jev_config_sync() -> dict | None:
    """在线程池里读一次 Jev 配置（供标题 worker 等没有 cfg 上下文的路径使用）。"""
    try:
        from app.database import SessionLocal
        from app.services.runtime_config import resolve_llm_settings

        with SessionLocal() as db:
            cfg = resolve_llm_settings(db)
        jev_cfg = cfg.get("jev")
        return dict(jev_cfg) if isinstance(jev_cfg, dict) else None
    except Exception as e:  # noqa: BLE001
        logger.warning("读取 Jev 配置失败，按未启用处理: %s", e)
        return None


# ---------------------------------------------------------------------------
# 对外复用面：给「用同一套 Jev + 兜底骨架、但规则不同」的调用方用
# （目前是 app.services.error_explain 的报错解读重试判定）。
# 这里只做别名，实现仍在上面各处——加一处新判定不必把 Jev 协议再抄一遍。
# ---------------------------------------------------------------------------

# Jev 是否配齐到可以发请求（启用 + 地址 + Key + 模型名）
jev_usable = _jev_usable
# 发一次 Jev decisions 请求（只试一次，失败抛给 decision.decide 转兜底）
ask_jev_decision = _ask_jev
# 取一道 Noul 题的概率值（缺失/非法返回 None）
noul_value = _noul_value
# 错误原文截断（state 里给足判定信息，又不把网关长堆栈全塞进计费）
clip_error = _clip
# 从异常里取数字 HTTP 状态码
exception_status = _exception_status
# 「换谁都一样」的关键词表（上下文超限 / 内容审核），机械兜底与分类复用同一张表
NON_RETRYABLE_KEYWORDS = _NON_RETRYABLE_KEYWORDS
