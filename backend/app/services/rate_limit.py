"""不扣额度端点的进程内滑动窗口限速。

主体用 identity 字符串（见 free_access.identity_key）：有码按码、无码按
浏览器指纹、再退回 IP。纯内存计数，进程重启即清空、多进程不共享 ——
与停止事件、免费模型在途计数一样，依赖主站单进程部署。
"""

from __future__ import annotations

from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException

from app.services.free_access import ANON_IDENTITY

# bucket -> (最大次数, 窗口秒)
RATE_LIMITS: dict[str, tuple[int, int]] = {
    "analyze": (10, 60),
    "title": (30, 60),
    "vocab": (60, 60),
    # PDF 云端解析（MinerU）按次计费，匿名调用额外设一道闸
    "parse": (10, 300),
}

_buckets: dict[tuple[str, str], deque] = defaultdict(deque)

# 键数量上限：键含客户端可控的指纹/IP，正常请求只访问自己的键，过期键不会被动清理，
# 长期运行（或被伪造指纹刷）会让字典单调增长。超过阈值时扫一遍，丢掉已空的键。
_MAX_KEYS = 4096


def _sweep(now: float) -> None:
    """丢掉所有窗口都已过期的键（只删空 deque，不影响任何仍在窗口内的计数）。"""
    for key in list(_buckets):
        hits = _buckets[key]
        window = RATE_LIMITS.get(key[1], (0, 0))[1]
        while hits and now - hits[0] > window:
            hits.popleft()
        if not hits:
            _buckets.pop(key, None)


def enforce_rate_limit(identity: str, bucket: str) -> None:
    """在窗口内累计一次命中，超限抛 429。"""
    limit, window = RATE_LIMITS[bucket]
    key = (identity or ANON_IDENTITY, bucket)
    now = monotonic()
    hits = _buckets[key]
    while hits and now - hits[0] > window:
        hits.popleft()
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    hits.append(now)
    if len(_buckets) > _MAX_KEYS:
        _sweep(now)
