"""模型评级字段（AA 智能指数）的解析回归。

旧 score（0-10 推荐评分）读入即丢弃、视为未评级；aa_index 归一化到 0-100；
管理端 ModelEntry 里 score 仅兼容接收、不落库。
"""
import json

import pytest
from pydantic import ValidationError

from app.routers.admin import ModelEntry
from app.services.runtime_config import parse_models, serialize_models


def test_legacy_score_dropped_treated_as_unrated():
    """旧库里的 score 读入即丢弃：模型降级为未评级，用户端不再显示任何评级角标。"""
    raw = json.dumps([{"id": "m/legacy", "name": "旧模型", "score": 9.5}], ensure_ascii=False)
    models = parse_models(raw)
    assert models[0]["aa_index"] is None
    assert "score" not in models[0]


def test_aa_index_normalized():
    """aa_index 归一化：保留 1 位小数、夹到 0-100，非法值视为未评级。"""
    raw = json.dumps([
        {"id": "m/a", "aa_index": 53.34},
        {"id": "m/b", "aa_index": 150},
        {"id": "m/c", "aa_index": -5},
        {"id": "m/d", "aa_index": "高"},
        {"id": "m/e"},
    ], ensure_ascii=False)
    models = {m["id"]: m for m in parse_models(raw)}
    assert models["m/a"]["aa_index"] == 53.3
    assert models["m/b"]["aa_index"] == 100.0
    assert models["m/c"]["aa_index"] == 0.0
    assert models["m/d"]["aa_index"] is None
    assert models["m/e"]["aa_index"] is None


def test_serialize_round_trip_keeps_aa_index_drops_score():
    stored = serialize_models([{"id": "m/x", "aa_index": 46, "score": 8.0}])
    assert "score" not in stored
    restored = parse_models(stored)
    assert restored[0]["aa_index"] == 46


def test_legacy_csv_format_unrated():
    models = parse_models("m/one, m/two")
    assert [m["aa_index"] for m in models] == [None, None]


def test_model_entry_aa_index_range():
    with pytest.raises(ValidationError):
        ModelEntry(id="m/over", aa_index=120)
    with pytest.raises(ValidationError):
        ModelEntry(id="m/under", aa_index=-1)
    assert ModelEntry(id="m/ok", aa_index=59).aa_index == 59
    assert ModelEntry(id="m/none").aa_index is None


def test_model_entry_score_not_persisted():
    """旧管理端提交的 score 兼容接收但不落库，模型按 aa_index 评级。"""
    entry = ModelEntry(id="m/old", score=9.5, aa_index=53)
    restored = parse_models(serialize_models([entry.model_dump()]))[0]
    assert restored["aa_index"] == 53
    assert "score" not in restored
