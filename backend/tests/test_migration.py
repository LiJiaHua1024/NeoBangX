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
        code_type="user",
        quota=quota,
        used_count=0,
        is_enabled=True,
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

    _register_migration_batch(requests[0], code)
    for request in requests[1:]:
        _register_migration_batch(request, code)

    assert _migration_reserved[code.id] == 2
    assert not _finish_migration_stream(
        batch_id="batch-1", batch_index=0, code_id=code.id, success=True
    )
    assert not _finish_migration_stream(
        batch_id="batch-1", batch_index=1, code_id=code.id, success=True
    )
    assert not _finish_migration_stream(
        batch_id="batch-1", batch_index=2, code_id=code.id, success=True
    )
    assert _finish_migration_stream(
        batch_id="batch-1", batch_index=3, code_id=code.id, success=True
    )
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
    _register_migration_batch(request, code)

    assert not _finish_migration_stream(
        batch_id="batch-2", batch_index=0, code_id=code.id, success=False
    )
    assert not _migration_reserved
    assert not _migration_batches
