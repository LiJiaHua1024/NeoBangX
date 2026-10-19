"""三层决策骨架：精确程序化 → Jev 判定 → 机械兜底。

为什么抽出来
------------
「先做语义完全确定的程序化判定（异常类名 / HTTP 状态码 / 自抛配置错误），
确定不了再问 Jev，Jev 不可用（未启用、未配齐、超时、报错、回包无法解析）
立刻回退到机械规则」——这套骨架原本在 Provider 切换判定与标题任务重试判定里
各写了一遍，第三处（报错解读的降级判定）又要同一形状。规则各不相同，骨架完全相同，
所以把骨架抽到这里，规则由调用方以 `DecisionSpec` 传进来。

本模块只做编排，不碰网络、不读配置、不认识 litellm：`ask` / `usable` 都由调用方
注入（分别是「怎么问 Jev」与「Jev 是否配齐」），因此可以在测试里直接替换。

不变量（改动时别破坏）
----------------------
1. `decide()` **永不抛异常**：任何意外都退回 `spec.heuristic`，主链路不会因为
   决策层出事而失败。
2. 精确判定命中时**不问 Jev**：省一次往返与费用（省下来的正是最贵的那条路）。
3. Jev 只试一次，本模块不重试 Jev；要不要重试由调用方按 `DecisionResult.source`
   决定（报错解读那条链路就是靠它决定「换个办法再试」）。
4. `source` 如实说明结论来自哪一层，供日志与观测使用——排查「为什么这次没切换」
   时，第一眼要看的就是它。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# 结论来自哪一层
SOURCE_CERTAIN = "certain"      # 精确程序化判定
SOURCE_JEV = "jev"              # Jev 判定
SOURCE_HEURISTIC = "heuristic"  # 机械兜底


@dataclass(frozen=True)
class DecisionSpec:
    """一次判定的全部可变部分。规则写在这里，编排逻辑留在 `decide()`。"""

    # 观测用标识（日志里区分是哪一处判定）
    key: str
    # 发给 Jev 的题面（题 id -> 题目定义）
    questions: dict
    # 精确程序化判定：True/False 直接采信，None = 拿不准，去问 Jev
    certain: Callable[[BaseException], bool | None]
    # 机械兜底（Jev 不可用、报错、回包无法解析时用）
    heuristic: Callable[[BaseException], bool]
    # Jev 回包 -> 结论；None = 回包无法解析（转兜底）
    combine: Callable[[dict], bool | None]
    # 怎么问 Jev：async (jev_cfg, state, questions) -> answers
    ask: Callable[[dict, Any, dict], Awaitable[dict]]
    # Jev 是否配齐可用： (jev_cfg | None) -> bool
    usable: Callable[[dict | None], bool]
    # state 构造（结构化事实，英文键）；缺省直接用异常本身
    build_state: Callable[..., Any] | None = None
    # 覆盖配置里的 jev_timeout（交互路径需要更短的上限）
    timeout: float | None = None


@dataclass(frozen=True)
class DecisionResult:
    verdict: bool
    source: str
    detail: str = ""

    @property
    def decided_by_jev(self) -> bool:
        return self.source == SOURCE_JEV

    @property
    def decided_certainly(self) -> bool:
        return self.source == SOURCE_CERTAIN


def _safe_heuristic(spec: DecisionSpec, exc: BaseException) -> bool:
    """兜底判定自身也不许抛：真出事就取「保守」的那一边。

    保守取哪一边由 spec 决定不了，所以退到最保守的 False（不做动作）：
    决策层出问题时「不做」永远比「乱做」安全——Provider 切换链上少切一家、
    报错解读上少重试一次，都是可接受的损失。
    """
    try:
        return bool(spec.heuristic(exc))
    except Exception as error:  # noqa: BLE001
        logger.warning("决策 %s 的机械兜底也失败了，按不做处理: %s", spec.key, error)
        return False


def _safe_usable(spec: DecisionSpec, jev_cfg: dict | None) -> bool:
    try:
        return bool(spec.usable(jev_cfg))
    except Exception as error:  # noqa: BLE001
        logger.warning("决策 %s 判定 Jev 可用性失败，按不可用处理: %s", spec.key, error)
        return False


def _cfg_with_timeout(jev_cfg: dict | None, timeout: float | None) -> dict:
    cfg = dict(jev_cfg or {})
    if timeout is not None:
        cfg["timeout"] = timeout
    return cfg


async def decide(
    spec: DecisionSpec,
    exc: BaseException,
    jev_cfg: dict | None = None,
    **context: Any,
) -> DecisionResult:
    """跑完三层，返回结论与来源。永不抛异常。"""
    try:
        certain = spec.certain(exc)
    except Exception as error:  # noqa: BLE001
        logger.warning("决策 %s 的精确判定抛错，转问 Jev: %s", spec.key, error)
        certain = None
    if certain is not None:
        return DecisionResult(bool(certain), SOURCE_CERTAIN)

    if not _safe_usable(spec, jev_cfg):
        return DecisionResult(_safe_heuristic(spec, exc), SOURCE_HEURISTIC, "jev-unusable")

    try:
        state = spec.build_state(exc, **context) if spec.build_state is not None else exc
        answers = await spec.ask(_cfg_with_timeout(jev_cfg, spec.timeout), state, spec.questions)
        decided = spec.combine(answers) if isinstance(answers, dict) else None
    except Exception as error:  # noqa: BLE001
        logger.warning("决策 %s 的 Jev 判定不可用，回退机械规则: %s", spec.key, error)
        return DecisionResult(_safe_heuristic(spec, exc), SOURCE_HEURISTIC, f"jev-error: {error}")

    if decided is None:
        logger.warning("决策 %s 的 Jev 回包无法解析，回退机械规则", spec.key)
        return DecisionResult(_safe_heuristic(spec, exc), SOURCE_HEURISTIC, "jev-unparseable")
    return DecisionResult(bool(decided), SOURCE_JEV)
