"""免费模型的无码访问判定与防滥用限额。

背景：模型可被标记为「免费」（不扣使用码次数），并可额外允许「无码可用」
（无使用码或次数已用尽时仍可调用）。免费调用不消耗额度，上游成本由运营方
承担，因此提供按身份的分/时/天/周/月限额作为唯一阀门。

计数口径：
- 主体为 usage_logs（每次 LLM 调用都会落库，持久且跨重启；默认保留期
  0 = 永久）。若管理员把日志保留期设得比某个窗口更短，该窗口的计数会偏小。
- 再叠加本进程内「在途请求」计数：日志在生成收尾时才写入，若不补偿，
  并发请求可以在落库前全部通过校验，把限额刷穿。进程内结构随重启清空，
  对短窗口已足够（与 chat.py 的停止事件、限流器同样依赖单进程部署）。
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Callable

from fastapi import HTTPException
from sqlalchemy import func, or_

from app.database import SessionLocal
from app.models import UsageLog
from app.services.request_log import STATUS_ERROR
from app.services.runtime_config import parse_free_limits

logger = logging.getLogger(__name__)

# 限额窗口：键 -> (中文名, 秒数)。顺序由短到长，便于命中时优先报最紧的那个。
FREE_LIMIT_WINDOWS: dict[str, tuple[str, int]] = {
    "minute": ("每分钟", 60),
    "hour": ("每小时", 3600),
    "day": ("每天", 86400),
    "week": ("每周", 7 * 86400),
    "month": ("每月", 30 * 86400),
}

# 无法识别身份（无码、无指纹、无 IP）时共用的兜底主体
ANON_IDENTITY = "anon"

# 在途请求记录的存活上限：单次生成远短于此，仅防异常路径漏掉释放
_INFLIGHT_TTL = 3600.0
_inflight: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def is_free_model(entry: dict | None) -> bool:
    """该模型是否被标记为免费（调用不扣次数）。"""
    return bool(entry and entry.get("is_free"))


def is_free_open(entry: dict | None) -> bool:
    """免费且允许无码调用（无使用码 / 次数用尽时仍可用）。"""
    return bool(entry and entry.get("is_free") and entry.get("free_no_code"))


def free_limits_of(entry: dict | None) -> dict[str, int]:
    """取模型的防滥用限额（0 = 不限制），非法/缺失一律归零。"""
    return parse_free_limits((entry or {}).get("free_limits"))


def identity_key(*, code_id: int | None = None, fingerprint: str = "", ip: str = "") -> str:
    """限额与限流的计数主体：使用码 > 浏览器指纹 > IP。

    有码时按码计数（同一码多设备共用一个额度）；无码时按指纹，
    指纹缺失再退回 IP；全都拿不到时归入 ANON_IDENTITY。
    """
    if code_id:
        return f"code:{code_id}"
    fp = (fingerprint or "").strip()
    if fp:
        return f"fp:{fp}"
    address = (ip or "").strip()
    if address:
        return f"ip:{address}"
    return ANON_IDENTITY


def _identity_filter(identity: str):
    """把 identity 还原成 usage_logs 的过滤条件。"""
    if identity.startswith("code:"):
        try:
            return UsageLog.code_id == int(identity[5:])
        except ValueError:
            return UsageLog.code_id == -1
    if identity.startswith("fp:"):
        return UsageLog.fingerprint == identity[3:]
    if identity.startswith("ip:"):
        return UsageLog.ip == identity[3:]
    # 无任何身份线索：把所有匿名调用算作同一个主体（更保守，宁严勿松）
    return UsageLog.code_id == 0


def _counted_status_clause():
    """只有真正跑失败的调用不算数，其余都计入限额。

    生成失败（error）没有产生有效产出，不该再占用户的限额；用户主动停止 /
    中途断线（cancelled）与正常完成（success）照常计入 —— 否则「快结束时按停止」
    就能无限白嫖。存量行经 ALTER 补列后 status 为 NULL，语义是升级前的成功调用，
    一并计入（SQLite 的 `status != 'error'` 对 NULL 返回 NULL，必须显式兜底）。
    """
    return or_(UsageLog.status.is_(None), UsageLog.status != STATUS_ERROR)


def _prune(entries: deque[float], now_mono: float) -> None:
    while entries and now_mono - entries[0] > _INFLIGHT_TTL:
        entries.popleft()


def _inflight_count(entries: deque[float], now_mono: float, seconds: int) -> int:
    return sum(1 for stamp in entries if now_mono - stamp <= seconds)


def register_free_use(*, entry: dict, identity: str) -> Callable[[], None]:
    """校验免费模型的防滥用限额，通过则登记一次在途调用。

    返回释放函数（生成收尾时必须调用）；未配置任何限额时返回空操作。
    超限抛 429，detail 为 {message, window, limit, retry_after}，前端直接展示 message。
    """
    limits = {key: value for key, value in free_limits_of(entry).items() if value > 0}
    if not limits:
        return _noop_release

    model_id = str(entry.get("id") or "")
    now_mono = monotonic()
    entries = _inflight[(identity, model_id)]
    _prune(entries, now_mono)

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for key in FREE_LIMIT_WINDOWS:
            limit = limits.get(key)
            if not limit:
                continue
            label, seconds = FREE_LIMIT_WINDOWS[key]
            since = now - timedelta(seconds=seconds)
            used = int(
                db.query(func.count(UsageLog.id))
                .filter(
                    UsageLog.created_at >= since,
                    UsageLog.model == model_id,
                    _identity_filter(identity),
                    _counted_status_clause(),
                )
                .scalar()
                or 0
            ) + _inflight_count(entries, now_mono, seconds)
            if used >= limit:
                logger.info(
                    "免费模型限额命中：model=%s identity=%s %s上限=%s 已用=%s",
                    model_id, identity, label, limit, used,
                )
                raise HTTPException(
                    status_code=429,
                    detail={
                        "message": f"免费模型「{entry.get('name') or model_id}」{label}最多调用 {limit} 次，请稍后再试",
                        "window": key,
                        "limit": limit,
                        "used": used,
                        # 窗口长度即等待上限（真实释放时间可能更早）
                        "retry_after": seconds,
                    },
                )
    finally:
        db.close()

    entries.append(now_mono)

    def release() -> None:
        try:
            entries.remove(now_mono)
        except ValueError:
            pass

    return release


def _noop_release() -> None:
    return None
