"""不扣额度端点的滑动窗口限速。

限速主体是进程内字典，键含客户端可控的指纹/IP：正常请求只会访问自己的键，
过期键不会被动清理，长期运行会单调增长。这里覆盖窗口判定的正确性与键清理：
清理必须只丢「窗口已全部过期」的键，误删活跃键会直接放穿限速。
"""
import pytest
from fastapi import HTTPException

from app.services import rate_limit as rl
from app.services.free_access import ANON_IDENTITY


@pytest.fixture(autouse=True)
def _clean_buckets():
    rl._buckets.clear()
    yield
    rl._buckets.clear()


def test_enforce_rate_limit_blocks_over_limit_and_isolates_identities():
    bucket = "title"
    limit, _window = rl.RATE_LIMITS[bucket]
    for _ in range(limit):
        rl.enforce_rate_limit("fp:a", bucket)
    with pytest.raises(HTTPException) as exc:
        rl.enforce_rate_limit("fp:a", bucket)
    assert exc.value.status_code == 429
    # 其它身份不受影响；同一身份的不同 bucket 各自计数
    rl.enforce_rate_limit("fp:b", bucket)
    rl.enforce_rate_limit("fp:a", "analyze")


def test_enforce_rate_limit_falls_back_to_anon_identity():
    bucket = "analyze"
    limit, _window = rl.RATE_LIMITS[bucket]
    for _ in range(limit):
        rl.enforce_rate_limit("", bucket)
    with pytest.raises(HTTPException):
        rl.enforce_rate_limit("", bucket)
    assert (ANON_IDENTITY, bucket) in rl._buckets


def test_sweep_drops_only_expired_keys():
    """超过键数量阈值时清理：已过期的键被删掉，仍在窗口内的计数原样保留。"""
    now = rl.monotonic()
    _limit, window = rl.RATE_LIMITS["title"]
    rl._buckets[("fp:live", "title")].append(now)
    rl._buckets[("fp:live", "title")].append(now)
    for index in range(rl._MAX_KEYS + 5):
        rl._buckets[(f"fp:stale-{index}", "title")].append(now - window - 1)

    rl.enforce_rate_limit("fp:trigger", "title")  # 触发阈值清理

    assert len(rl._buckets[("fp:live", "title")]) == 2
    assert [key for key in rl._buckets if key[0].startswith("fp:stale-")] == []
    assert ("fp:trigger", "title") in rl._buckets
    assert len(rl._buckets) < rl._MAX_KEYS


def test_sweep_keeps_other_buckets_of_live_identity():
    """同一身份的多个 bucket 按各自窗口判定过期，不因另一个 bucket 活跃而误留/误删。"""
    now = rl.monotonic()
    # parse 的窗口（300s）比 title（60s）长：按各自窗口老化才对
    parse_window = rl.RATE_LIMITS["parse"][1]
    rl._buckets[("fp:x", "title")].append(now)
    rl._buckets[("fp:x", "parse")].append(now - parse_window - 1)

    rl._sweep(now)

    assert ("fp:x", "title") in rl._buckets
    assert ("fp:x", "parse") not in rl._buckets
