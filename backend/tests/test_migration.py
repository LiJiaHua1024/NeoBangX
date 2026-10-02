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


def _finish(batch_id, index, code, *, delivered=True):
    return _finish_migration_stream(
        batch_id=batch_id,
        batch_index=index,
        owner_id=code.id,
        delivered=delivered,
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


def test_batch_charges_proportionally_to_delivered_cards():
    """整批 4 张卡值 2 次，逐卡交付时按比例摊分，收齐时累计正好等于整批价。"""
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
    # 整批 4 张值 2 次，摊到第 k 张的累计值 max(1, 2*k//4)：
    # k=1 → 1（首张按下限保底扣 1），k=2、3 仍摊到 1（不重复扣），k=4 收齐补足到 2
    assert _finish("batch-1", 0, code) == 1
    assert _finish("batch-1", 1, code) == 0
    assert _finish("batch-1", 2, code) == 0
    assert _finish("batch-1", 3, code) == 1
    assert not _migration_reserved
    assert not _migration_batches


def test_stopped_batch_still_charges_for_delivered_cards():
    """中途停止：已交付的卡片照扣，未交付的不扣 —— 内容交付了收不回来。

    用户停止时前端会中止所有在途卡片，所以每张在途卡片最终都会走到收尾，
    批次因此正常收齐、预留被释放；只有从未发出的卡片不会到达后端。
    """
    code = _code(quota=10)
    for index in range(6):
        _register(
            ChatRequest(tool_id="26", input="题目", batch_id="batch-2", batch_size=6, batch_index=index),
            code,
        )

    # 6 张卡值 3 次：交付 1 张摊到 max(1, 3*1//6)=1，交付 2 张仍摊到 1
    assert _finish("batch-2", 0, code) == 1
    assert _finish("batch-2", 1, code) == 0
    # 第 3 张被用户停止：收尾不扣；后续在途卡片同样被中止，也都不扣
    assert _finish("batch-2", 2, code, delivered=False) == 0
    for index in (3, 4, 5):
        assert _finish("batch-2", index, code, delivered=False) == 0
    assert not _migration_reserved
    assert not _migration_batches


def test_undelivered_card_is_free():
    """一个字都没产出就失败：不扣费，但要正常收尾并释放预留。"""
    code = _code(quota=1)
    for index in range(2):
        _register(
            ChatRequest(tool_id="26", input="题目", batch_id="batch-2", batch_size=2, batch_index=index),
            code,
        )

    assert _finish("batch-2", 0, code, delivered=False) == 0
    assert _finish("batch-2", 1, code, delivered=False) == 0
    assert not _migration_reserved
    assert not _migration_batches


def test_partial_batch_releases_undelivered_reservation():
    """整批收齐但只交付了一部分：只释放未交付那部分的预留，不多扣也不占用。"""
    code = _code(quota=10)
    for index in range(4):
        _register(
            ChatRequest(tool_id="26", input="题目", batch_id="batch-4", batch_size=4, batch_index=index),
            code,
        )
    # 4 张卡值 2 次
    assert _migration_reserved[code.id] == 2

    assert _finish("batch-4", 0, code) == 1  # max(1, 2*1//4) = 1
    assert _finish("batch-4", 1, code) == 0
    assert _finish("batch-4", 2, code) == 0
    assert _finish("batch-4", 3, code, delivered=False) == 0
    # 未交付的 1 次预留已归还，累计实扣 1 次 < 整批价 2 次
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
        assert _finish("batch-3", index, code) == 0
    assert _finish("batch-3", 3, code) == 0
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

    assert _finish("free-1", 0, code, delivered=False) == 0
    assert free_batch is not None
    assert _migration_reserved[code.id] == 1
