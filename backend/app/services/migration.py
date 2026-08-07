"""智能错题迁移的纯业务规则与错因结果解析。"""

from __future__ import annotations

import json
import re
from typing import Any


MIGRATION_TOOL_ID = "26"
MIGRATION_TOOL_NAME = "智能错题迁移"
MIGRATION_PROMPT_NAME = "智能错题迁移"
MIGRATION_ANALYSIS_PROMPT_NAME = "智能错题迁移错因分析"


def migration_charge_units(cause_count: int) -> int:
    """根据选中的错因数量计算最终生成所需的额度次数。"""
    if cause_count < 1:
        raise ValueError("至少需要选择一个错因")
    return max(1, cause_count // 2)


def _json_values(raw: str) -> Any | None:
    """从模型输出中提取 JSON 数组或对象，兼容 Markdown 代码围栏。"""
    text = (raw or "").strip()
    if not text:
        return None

    decoder = json.JSONDecoder()
    candidates = [text]
    fenced = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    candidates.extend(fenced)

    for candidate in candidates:
        try:
            value = json.loads(candidate.strip())
            return value if isinstance(value, (list, dict)) else None
        except (json.JSONDecodeError, TypeError):
            pass

        for index, char in enumerate(candidate):
            if char not in "[{":
                continue
            try:
                value, _ = decoder.raw_decode(candidate[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(value, (list, dict)):
                return value
    return None


def _items_from_json(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if not isinstance(value, dict):
        return []
    for key in ("causes", "error_causes", "items", "diagnoses", "options"):
        items = value.get(key)
        if isinstance(items, list):
            return items
    return []


def _clean_cause(value: Any) -> str:
    if isinstance(value, str):
        text = value
    elif isinstance(value, dict):
        text = ""
        for key in ("label", "cause", "error_cause", "name", "title", "text", "description"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                text = candidate
                break
    else:
        text = ""

    text = re.sub(r"^[\s\-*_•·\d.、)）]+", "", text).strip()
    text = text.strip("`\"'“”‘’")
    return re.sub(r"\s+", " ", text)


def parse_error_causes(raw: str) -> list[str]:
    """解析错因分析结果，优先使用 JSON，失败时兼容逐行文本。"""
    parsed = _json_values(raw)
    values = _items_from_json(parsed)
    if not values:
        # 模型明确返回空数组时，不应把 "[]" 当成一个错因。
        if isinstance(parsed, list) and not parsed:
            return []
        if isinstance(parsed, dict) and any(
            isinstance(parsed.get(key), list) and not parsed.get(key)
            for key in ("causes", "error_causes", "items", "diagnoses", "options")
        ):
            return []
        values = (raw or "").splitlines()

    causes: list[str] = []
    seen: set[str] = set()
    for value in values:
        cause = _clean_cause(value)
        if not cause or cause in seen:
            continue
        seen.add(cause)
        causes.append(cause)

    if causes:
        return causes

    fallback = _clean_cause(raw)
    return [fallback] if fallback else []
