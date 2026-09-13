from app.routers.chat import (
    ChatRequest,
    _finish_migration_stream,
    _migration_batches,
    _migration_reserved,
    _register_migration_batch,
)
from app.models import UsageCode
from app.services.migration import migration_charge_units, parse_error_causes


def _code(quota=10):
    return UsageCode(
        id=7,
        code="NBXU-TEST-TEST-TEST",
        quota=quota,
        used_count=0,
        is_enabled=True,
    )


def _register(request, code, *, free=False):
    """按新签名注册迁移批次：属主 / 剩余额度 / 是否免费模型。"""
    return _register_migration_batch(
        request,
        owner_id=code.id,
        remaining=code.remaining,
        free=free,
    )


def _finish(batch_id, index, code, *, success=True):
    return _finish_migration_stream(
        batch_id=batch_id,
        batch_index=index,
        owner_id=code.id,
        success=success,
    )


def teardown_function():
    _migration_batches.clear()
    _migration_reserved.clear()


def test_migration_charge_formula():
    assert [migration_charge_units(n) for n in (1, 2, 3, 4, 5, 6)] == [1, 1, 1, 2, 2, 3]


def test_parse_json_causes_without_limiting_count():
    raw = '{"causes":["审题时忽略转折关系", {"label":"把语境线索当成词义直译"}, "第三个错因"]}'
    assert parse_error_causes(raw) == [
        "审题时忽略转折关系",
        "把语境线索当成词义直译",
        "第三个错因",
    ]


def test_parse_empty_json_array_as_no_causes():
    assert parse_error_causes("[]") == []
    assert parse_error_causes("1. 忽略限定词\n2. 过度依赖直译") == [
        "忽略限定词",
        "过度依赖直译",
    ]


def test_batch_is_charged_only_after_every_card_finishes():
    code = _code(quota=3)
    requests = [
        ChatRequest(
            tool_id="26",
            input="题目",
            batch_id="batch-1",
            batch_size=4,
            batch_index=index,
        )
        for index in range(4)
    ]

    _register(requests[0], code)
    for request in requests[1:]:
        _register(request, code)

    assert _migration_reserved[code.id] == 2
    assert not _finish("batch-1", 0, code)
    assert not _finish("batch-1", 1, code)
    assert not _finish("batch-1", 2, code)
    assert _finish("batch-1", 3, code)
    assert not _migration_reserved
    assert not _migration_batches


def test_failed_batch_releases_reservation_without_charging():
    code = _code(quota=1)
    request = ChatRequest(
        tool_id="26",
        input="题目",
        batch_id="batch-2",
        batch_size=2,
        batch_index=0,
    )
    _register(request, code)

    assert not _finish("batch-2", 0, code, success=False)
    assert not _migration_reserved
    assert not _migration_batches


def test_free_model_batch_never_reserves_quota():
    """免费模型整批 charge_units=0：既不占额度预留，也不受剩余次数拦截。"""
    code = _code(quota=1)
    batch = _register(
        ChatRequest(tool_id="26", input="题目", batch_id="batch-3", batch_size=4, batch_index=0),
        code,
        free=True,
    )
    assert batch is not None and batch.charge_units == 0
    assert not _migration_reserved

    for index in range(3):
        assert not _finish("batch-3", index, code)
    assert _finish("batch-3", 3, code)
    assert not _migration_batches


def test_free_model_batch_release_keeps_other_reservations():
    """免费批次收尾时不能把同一使用码其它批次的额度预留一起清掉。"""
    code = _code(quota=10)
    _register(
        ChatRequest(tool_id="26", input="题目", batch_id="paid-1", batch_size=2, batch_index=0),
        code,
    )
    free_batch = _register(
        ChatRequest(tool_id="26", input="题目", batch_id="free-1", batch_size=2, batch_index=0),
        code,
        free=True,
    )
    assert _migration_reserved[code.id] == 1

    assert not _finish("free-1", 0, code, success=False)
    assert free_batch is not None
    assert _migration_reserved[code.id] == 1
