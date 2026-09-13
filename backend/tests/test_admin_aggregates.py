"""管理后台聚合的等价性验证。

两处聚合从「把窗口内的行拉回 Python 再算」改成「SQL 侧分组后只传回聚合结果」，
必须保证结果逐值一致（日志量增长后这里是主要的卡顿来源）：
1. 设备活跃时段直方图：strftime(+8 小时) 与 device_profile.beijing_hour 逐行等价；
2. 用量分析的耗时分位数/直方图：按取值分组 + 累积计数定位名次，与全量排序等价。
"""
from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import UsageLog
from app.routers.admin import _device_hour_histogram, _usage_analytics_impl
from app.services.device_profile import beijing_hour

_MARK = "AGGREGATE-EQUIVALENCE"


def _add_log(db, *, created_at, duration_ms=None, device_id=None, model="agg-model"):
    row = UsageLog(
        code_id=0,
        code=_MARK,
        tool_id="1",
        tool_name="聚合测试",
        model=model,
        request_id=_MARK,
        created_at=created_at,
        status="success",
        duration_ms=duration_ms,
        device_id=device_id,
        fingerprint=_MARK,
    )
    db.add(row)
    db.commit()
    return row


def _cleanup(db):
    db.query(UsageLog).filter(UsageLog.request_id == _MARK).delete(synchronize_session=False)
    db.commit()


def test_device_hour_histogram_matches_beijing_hour_row_by_row():
    """跨 UTC+8 边界的时间戳必须落在同一小时：SQL 分桶与逐行 beijing_hour 完全一致。"""
    db = SessionLocal()
    device_id = 987_654_321  # 独立的伪设备 ID，避免与其它用例的行混在一起
    # 23:30 UTC → 北京次日 07 点；08:00 UTC → 北京 16 点；00:00 UTC → 北京 08 点
    stamps = [
        datetime(2026, 9, 1, 23, 30, tzinfo=timezone.utc),
        datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 1, 15, 59, tzinfo=timezone.utc),
        datetime(2026, 9, 1, 16, 0, tzinfo=timezone.utc),
        datetime(2026, 9, 1, 23, 30, tzinfo=timezone.utc),  # 与上一条同小时，验证计数累加
    ]
    try:
        for stamp in stamps:
            _add_log(db, created_at=stamp, device_id=device_id)

        base = db.query(UsageLog).filter(UsageLog.device_id == device_id)
        got = _device_hour_histogram(base)

        expected = [0] * 24
        for (created,) in base.with_entities(UsageLog.created_at).all():
            hour = beijing_hour(created)
            if hour is not None:
                expected[hour] += 1
        assert sum(expected) == len(stamps)
        assert got == expected
        # 边界点单独确认，避免两边同时算错却相等
        assert got[7] == 2 and got[8] == 1 and got[16] == 1 and got[23] == 1
    finally:
        _cleanup(db)
        db.close()


def test_analytics_latency_matches_full_sort_reference():
    """分位数与直方图必须与「全量耗时排序后取名次」的原始算法逐值一致。"""
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    bucket_defs = [(1000, "<1s"), (3000, "1–3s"), (5000, "3–5s"), (10000, "5–10s"), (30000, "10–30s"), (None, "30s+")]
    # 含重复值、含恰好落在分桶边界上的值、含空耗时（应被排除）
    durations = [120, 120, 999, 1000, 2500, 3000, 4999, 5000, 9000, 10000, 29_999, 30_000, 45_000, 45_000]
    try:
        for index, value in enumerate(durations):
            _add_log(db, created_at=now - timedelta(minutes=index), duration_ms=value)
        _add_log(db, created_at=now, duration_ms=None)  # 未记录耗时：不参与统计

        latency = _usage_analytics_impl(db, 0)["latency"]

        # 参考实现：与改动前的 Python 版完全一致（全量排序 + 同一套名次公式）
        all_values = sorted(
            int(v)
            for (v,) in db.query(UsageLog.duration_ms).filter(UsageLog.duration_ms.is_not(None)).all()
            if v is not None
        )
        total = len(all_values)
        assert total >= len(durations)
        assert latency["count"] == total

        def ref_q(p):
            return all_values[min(total - 1, max(0, int(p * total)))]

        assert latency["p50"] == ref_q(0.50)
        assert latency["p90"] == ref_q(0.90)
        assert latency["p95"] == ref_q(0.95)
        assert latency["p99"] == ref_q(0.99)
        assert latency["max"] == all_values[-1]

        counts = [0] * len(bucket_defs)
        for value in all_values:
            for i, (upper, _label) in enumerate(bucket_defs):
                if upper is None or value < upper:
                    counts[i] += 1
                    break
        assert [b["count"] for b in latency["buckets"]] == counts
        assert [b["label"] for b in latency["buckets"]] == [label for _le, label in bucket_defs]
        # share 各自四舍五入到 4 位（求和不必精确等于 1），逐值比对
        assert [b["share"] for b in latency["buckets"]] == [round(c / total, 4) for c in counts]
    finally:
        _cleanup(db)
        db.close()


def test_analytics_latency_empty_window_stays_null():
    """窗口内没有任何耗时记录时保持原来的空值形状，前端展示不受影响。"""
    db = SessionLocal()
    try:
        latency = _usage_analytics_impl(db, 7)["latency"]
        assert latency["p50"] is None and latency["max"] is None
        assert latency["count"] >= 0
        assert [b["label"] for b in latency["buckets"]] == ["<1s", "1–3s", "3–5s", "5–10s", "10–30s", "30s+"]
    finally:
        db.close()
