"""进程级 Provider 健康记忆（熔断器）。

为什么需要
----------
`LLMRouter` 每个 HTTP 请求都新建实例，实例属性存不住跨请求的记忆：上一个
请求撞死在挂起的首选 Provider 上（干等满 first_token_timeout），下一个请求
还要原样再撞一次。熔断器把「这家最近一直在失败」记在进程级注册表里，
后续请求把失效的家沉到链尾，让便宜、健康的家先上——越靠前的 Provider 越
便宜，把流量留在便宜家正是这个模块的成本立场。

三态模型（标准熔断器）
----------------------
- CLOSED  正常。60 秒窗口内的失败 ≥ FAILURE_THRESHOLD 次 → OPEN。
- OPEN    open_until 之前链路排序时沉底（不是剔除：全链失败时仍可兜底试它）；
          期间再失败按 2 倍指数退避延长冷却，封顶 OPEN_MAX_SECONDS。
- HALF_OPEN  冷却结束后的探测态：只允许一个请求探测它（claim_attempt 原子
          占坑，占坑带 TTL——探测请求一去不回时靠 TTL 自愈，不把这家永久
          锁死）。探测成功 → CLOSED 并清零计数；失败 → 再次 OPEN 并退避。

记账口径（重要）
----------------
一次「失败」= 一个请求对某家 Provider 的**最终放弃**（快重试用尽后切走、
没有快重试直接切走、或全链失败收尾），**不是**每次 HTTP 尝试都记一笔——
同一次请求内快重试的首败与重试败合并只记一次，否则单次网络抖动就能攒够
阈值把自家便宜家熔掉。只有「确定瞬态」的失败计入：复用 Jev 判定层的精确
程序化结论（`_certain_provider_verdict` 为 True，即超时/空响应/429/5xx/
连接类/鉴权欠费等「这家自己的问题」）；上下文超限、内容审核、413 这类
「换谁都一样」的错误与拿不准的 400/422 一律不计——那是请求的问题，
不是这家 Provider 的健康问题。任意成功立即清零该家计数并回 CLOSED。

线程安全与作用域
----------------
请求路径在 asyncio 里，但配置读取等路径有线程池调用，注册表统一用
`threading.Lock` 保护。状态是进程级内存：主站与管理后台两个进程（或多
worker）各自独立、重启即清零——作为「快速止损」的健康记忆足够，
不做跨进程一致性；测试用 `reset_for_tests` 隔离。
"""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

# 瞬态失败的滑动窗口与熔断阈值：窗口内攒够这么多笔「被放弃的失败」就 OPEN
FAILURE_WINDOW_SECONDS = 60.0
FAILURE_THRESHOLD = 2
# OPEN 冷却时长：连续失败按 2 倍指数退避（30 → 60 → 120 → 240），封顶 300
OPEN_SECONDS = 30.0
OPEN_MAX_SECONDS = 300.0
# HALF_OPEN 探测占坑的有效期：超过视为探测请求已死，允许下一个请求重新占坑
PROBE_CLAIM_TTL_SECONDS = 120.0

_CLOSED = "closed"
_OPEN = "open"
_HALF_OPEN = "half_open"


class _ProviderState:
    __slots__ = ("failures", "state", "open_until", "consecutive_opens", "probe_claimed_at")

    def __init__(self) -> None:
        # 窗口内的失败时间戳（单调时钟）
        self.failures: list[float] = []
        self.state: str = _CLOSED
        self.open_until: float = 0.0
        self.consecutive_opens: int = 0
        self.probe_claimed_at: Optional[float] = None


_lock = threading.Lock()
_registry: dict[str, _ProviderState] = {}


def _now() -> float:
    """单调时钟；测试可整体替换做时间旅行。"""
    return time.monotonic()


def _state_for(provider_id: str) -> _ProviderState:
    return _registry.setdefault(provider_id, _ProviderState())


def _prune(state: _ProviderState, now: float) -> None:
    cutoff = now - FAILURE_WINDOW_SECONDS
    state.failures = [ts for ts in state.failures if ts > cutoff]


def _refresh(state: _ProviderState, now: float) -> None:
    """OPEN 冷却到期 → HALF_OPEN 的惰性迁移（任何查询/记账入口都先走一遍）。"""
    if state.state == _OPEN and now >= state.open_until:
        state.state = _HALF_OPEN
        state.probe_claimed_at = None


def _open_breaker(state: _ProviderState, now: float) -> None:
    state.state = _OPEN
    state.consecutive_opens += 1
    delay = min(OPEN_SECONDS * (2 ** (state.consecutive_opens - 1)), OPEN_MAX_SECONDS)
    state.open_until = now + delay
    state.probe_claimed_at = None


def is_transient_failure(exc: BaseException) -> bool:
    """该失败是否计入熔断：只认「确定瞬态」（这家自己的问题，换一家能顶上）。

    委托 Jev 判定层的精确程序化结论（`_certain_provider_verdict` 为 True）；
    拿不准的（400/422、无状态码的通用异常）保守不计，交给单次请求内的
    fallback 兜底，不让偶发的怪错误把便宜家熔掉。
    """
    from app.services.jev_judge import _certain_provider_verdict

    try:
        return _certain_provider_verdict(exc) is True
    except Exception:  # noqa: BLE001 - 健康记账绝不影响主流程
        return False


def record_success(provider_id: str) -> None:
    """该家一次成功：清零窗口计数与熔断状态，回 CLOSED。"""
    if not provider_id:
        return
    with _lock:
        state = _registry.get(provider_id)
        if state is None:
            return
        state.failures.clear()
        state.state = _CLOSED
        state.consecutive_opens = 0
        state.open_until = 0.0
        state.probe_claimed_at = None


def record_failure(provider_id: str, exc: BaseException | None = None) -> bool:
    """记一次「该家被放弃的瞬态失败」（一个请求对每家最多记一笔，调用方保证）。

    exc 用于过滤非瞬态错误；返回是否实际计入。HALF_OPEN 期间的失败视为
    探测失败：立即再次 OPEN 并按连续次数退避。
    """
    if not provider_id:
        return False
    if exc is not None and not is_transient_failure(exc):
        return False
    now = _now()
    with _lock:
        state = _state_for(provider_id)
        _refresh(state, now)
        _prune(state, now)
        state.failures.append(now)
        state.probe_claimed_at = None
        if state.state in (_HALF_OPEN, _OPEN):
            # 探测失败 / 沉底兜底尝试也失败：这家还在坏，延长冷却并退避
            _open_breaker(state, now)
        elif len(state.failures) >= FAILURE_THRESHOLD:
            _open_breaker(state, now)
        return True


def is_open(provider_id: str) -> bool:
    """当前是否处于 OPEN（会沉底）。"""
    if not provider_id:
        return False
    with _lock:
        state = _registry.get(provider_id)
        if state is None:
            return False
        _refresh(state, _now())
        return state.state == _OPEN


def apply_breaker_order(providers: list[dict]) -> list[dict]:
    """按健康状态重排链：OPEN 中的沉底，其余保持原相对顺序（稳定排序）。

    不改传入列表；`providers_override`（并发执行器「避开上一家」的局部顺序）
    作为基底时语义同样成立——override 的先后保留，熔断中的仍然沉底。
    """
    if not providers:
        return []
    with _lock:
        now = _now()
        normal: list[dict] = []
        sunk: list[dict] = []
        for provider in providers:
            provider_id = ((provider or {}).get("id") or "").strip()
            state = _registry.get(provider_id) if provider_id else None
            if state is not None:
                _refresh(state, now)
            if state is not None and state.state == _OPEN:
                sunk.append(provider)
            else:
                normal.append(provider)
        return normal + sunk


def claim_attempt(provider_id: str) -> bool:
    """本次能否尝试这家：CLOSED 与 OPEN（沉底兜底）都放行；HALF_OPEN 只放行
    一个探测请求（占坑 TTL 内有效），并发的其他请求直接跳过这家。"""
    if not provider_id:
        return True
    with _lock:
        state = _registry.get(provider_id)
        if state is None:
            return True
        now = _now()
        _refresh(state, now)
        if state.state == _HALF_OPEN:
            claimed_at = state.probe_claimed_at
            if claimed_at is not None and now - claimed_at < PROBE_CLAIM_TTL_SECONDS:
                return False
            state.probe_claimed_at = now
            return True
        return True


def reset(provider_id: str | None = None) -> int:
    """清空熔断状态（全部，或指定某家），返回被清掉的条目数。

    给管理后台的「重置熔断」用：管理员改好 Key / 换好地址之后，不该再等冷却期
    （默认 OPEN 30 秒、指数退避封顶 300 秒）——用户侧的「一直走备用通道 / 这个模型
    不可用」正是这段时间的表现。
    """
    with _lock:
        if provider_id is None:
            cleared = len(_registry)
            _registry.clear()
            return cleared
        return 1 if _registry.pop(provider_id, None) is not None else 0


def snapshot() -> dict[str, dict[str, Any]]:
    """当前健康状态快照（测试与诊断用）。"""
    with _lock:
        now = _now()
        out: dict[str, dict[str, Any]] = {}
        for provider_id, state in _registry.items():
            _refresh(state, now)
            _prune(state, now)
            out[provider_id] = {
                "state": state.state,
                "failures": len(state.failures),
                "open_for": max(0.0, state.open_until - now) if state.state == _OPEN else 0.0,
            }
        return out


def reset_for_tests() -> None:
    """清空注册表（测试隔离用）。"""
    with _lock:
        _registry.clear()
