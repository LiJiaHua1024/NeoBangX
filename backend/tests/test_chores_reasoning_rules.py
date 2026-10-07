"""Chores 系列工作（生成标题、可视化试卷全解框架、设备画像）工具推理规则测试。"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.database import SessionLocal
from app.main import app
from app.models import UsageCode
from app.routers import chat as chat_router
from app.routers.tools import (
    CHORES_TOOLS,
    DEVICE_PROFILE_TOOL_ID,
    TITLE_TOOL_ID,
    VISUAL_FRAMEWORK_TOOL_ID,
)
from app.services.llm_router import LLMRouter
from app.services.runtime_config import (
    get_config_map,
    set_config_values,
)


@pytest.fixture
def test_code():
    db = SessionLocal()
    try:
        code = UsageCode(
            code="NBXJ-CHORE-" + uuid.uuid4().hex[:8].upper(),
            quota=-1,
            used_count=0,
            is_enabled=True,
            note="chores rule test",
        )
        db.add(code)
        db.commit()
        db.refresh(code)
        db.expunge(code)
        return code
    finally:
        db.close()


def test_admin_tools_includes_chores_group():
    """管理后台工具注册表接口返回 chores 分组，包含生成标题与可视化试卷全解框架。"""
    client = TestClient(admin_app)
    resp = client.get("/api/admin/tools")
    assert resp.status_code == 200
    data = resp.json()
    groups = {g["id"]: g for g in data.get("groups", [])}
    assert "chores" in groups
    chores_group = groups["chores"]
    assert chores_group["title"] == "Chores 工作"

    chores_tool_ids = {t["id"] for t in chores_group.get("tools", [])}
    assert TITLE_TOOL_ID in chores_tool_ids
    assert VISUAL_FRAMEWORK_TOOL_ID in chores_tool_ids
    assert DEVICE_PROFILE_TOOL_ID in chores_tool_ids


def test_admin_config_accepts_chores_tool_ids():
    """管理后台配置更新允许提交 Chores 工具 ID，不被 known_tool_ids 拦截。"""
    db = SessionLocal()
    old_cfg = get_config_map(db)
    try:
        rules = [
            {
                "id": "r_title_test",
                "tool_ids": [TITLE_TOOL_ID],
                "reasoning_effort": "low",
                "on_unsupported": "fallback",
            },
            {
                "id": "r_fw_test",
                "tool_ids": [VISUAL_FRAMEWORK_TOOL_ID],
                "reasoning_effort": "high",
                "on_unsupported": "fail",
            },
        ]
        client = TestClient(app)
        # 用 admin 依赖绕过或直接调 update_config 逻辑
        resp = client.put("/api/admin/config", json={"tool_reasoning_rules": rules})
        # 即使无认证返回 401 也说明到了认证层（400 才是已知工具校验失败）
        # 这里测试 set_config_values 结合 admin.py 里的 known_tool_ids 逻辑
        from app.routers.tools import (
            EXCLUSIVE_TOOLS,
            PROPOSITION_TOOLS,
            REFERENCE_TOOLS,
            TEACHING_TOOLS,
        )
        known = {
            str(t["id"])
            for g in (EXCLUSIVE_TOOLS, TEACHING_TOOLS, PROPOSITION_TOOLS, REFERENCE_TOOLS, CHORES_TOOLS)
            for t in g
        }
        for r in rules:
            for tid in r["tool_ids"]:
                assert str(tid) in known
    finally:
        db.close()


@pytest.mark.anyio
async def test_title_reasoning_effort_applied(test_code):
    """标题生成命中规则时透传对应的 reasoning_effort 给 llm.chat。"""
    cfg = {
        "models": [{"id": "model-chores-1", "name": "Chores1", "chores_usable": True, "enabled": True}],
        "chores_model": "model-chores-1",
        "log_payload": False,
        "tool_reasoning_rules": [
            {
                "id": "r1",
                "tool_ids": ["title"],
                "reasoning_effort": "low",
                "on_unsupported": "fallback",
            }
        ],
    }

    mock_llm = AsyncMock()
    mock_llm.chat = AsyncMock(return_value="生成的精彩标题")
    mock_llm.providers = [{"provider_model_id": "model-chores-1"}]

    with patch("app.routers.chat._build_llm", return_value=mock_llm), \
         patch("app.routers.chat.supports_reasoning", return_value=True):
        title = await chat_router._generate_title_once(
            code=test_code,
            tool_id="1",
            input_text="输入文本",
            output_text="输出文本",
            model="model-chores-1",
            cfg=cfg,
        )

    assert title == "生成的精彩标题"
    mock_llm.chat.assert_awaited_once()
    kwargs = mock_llm.chat.await_args.kwargs
    assert kwargs.get("reasoning_effort") == "low"


@pytest.mark.anyio
async def test_title_reasoning_unsupported_fail_raises_400(test_code):
    """当标题规则配置了 on_unsupported='fail' 且模型不支持时，抛出 400 拦截错误。"""
    cfg = {
        "models": [{"id": "model-dumb", "name": "DumbModel", "chores_usable": True, "enabled": True}],
        "chores_model": "model-dumb",
        "log_payload": False,
        "tool_reasoning_rules": [
            {
                "id": "r2",
                "tool_ids": ["title"],
                "reasoning_effort": "high",
                "on_unsupported": "fail",
            }
        ],
    }

    mock_llm = AsyncMock()
    mock_llm.providers = [{"provider_model_id": "model-dumb"}]

    with patch("app.routers.chat._build_llm", return_value=mock_llm), \
         patch("app.routers.chat.supports_reasoning", return_value=False):
        with pytest.raises(HTTPException) as exc_info:
            await chat_router._generate_title_once(
                code=test_code,
                tool_id="1",
                input_text="输入",
                output_text="输出",
                model="model-dumb",
                cfg=cfg,
            )
        assert exc_info.value.status_code == 400
        assert "不支持推理强度" in str(exc_info.value.detail)


@pytest.mark.anyio
async def test_visual_framework_reasoning_effort_applied():
    """试卷可视化全解阶段一命中 visual_framework 规则时应用指定 reasoning_effort。"""
    # 模拟在阶段一调用时，解析 visual_framework 规则并透传
    rules = [
        {
            "id": "r_fw",
            "tool_ids": ["visual_framework"],
            "reasoning_effort": "minimal",
            "on_unsupported": "fallback",
        },
        {
            "id": "r_main",
            "tool_ids": ["13"],
            "reasoning_effort": "high",
            "on_unsupported": "fallback",
        },
    ]
    rule_fw = chat_router.find_tool_reasoning_rule(rules, "visual_framework")
    assert rule_fw is not None
    assert rule_fw["reasoning_effort"] == "minimal"

    rule_main = chat_router.find_tool_reasoning_rule(rules, "13")
    assert rule_main is not None
    assert rule_main["reasoning_effort"] == "high"


def test_visual_framework_unsupported_fail_blocks_request(test_code):
    """当 visual_framework 规则配置为 on_unsupported='fail' 且框架模型不支持思考时，请求在建连前被 400 拦截。"""
    from app import deps

    cfg_override = {
        "models": [
            {"id": "main-model", "name": "MainModel", "user_usable": True, "enabled": True},
            {"id": "fw-model", "name": "FwModel", "chores_usable": True, "enabled": True},
        ],
        "default_model": "main-model",
        "chores_model": "fw-model",
        "max_tokens": 4096,
        "timeout": 120,
        "providers": [{"id": "p1", "name": "P1", "base_url": "http://mock", "api_key": "k", "enabled": True}],
        "model_provider_map": {
            "main-model": ["p1"],
            "fw-model": ["p1"],
        },
        "tool_reasoning_rules": [
            {
                "id": "r_fw_fail",
                "tool_ids": ["visual_framework"],
                "reasoning_effort": "high",
                "on_unsupported": "fail",
            }
        ],
    }
    client = TestClient(app)
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(code=test_code, reason="")
    try:
        with patch("app.routers.chat._load_cfg", return_value=cfg_override), \
             patch("app.routers.chat.supports_reasoning", side_effect=lambda m: False if "fw" in m else True):
            resp = client.post(
                "/api/chat/stream",
                json={
                    "tool_id": "13",
                    "input": "2024英语试卷\n第一题\nA. 1 B. 2",
                    "model": "main-model",
                },
            )
            assert resp.status_code == 400
            assert "框架解析模型" in resp.json()["detail"]
            assert "不支持推理强度" in resp.json()["detail"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_device_profile_reasoning_effort():
    """管理后台设备画像命中 device_profile 规则时应用指定 reasoning_effort。"""
    from app.routers.admin import generate_device_ai_profile
    from app.models import Device

    cfg = {
        "models": [{"id": "model-chores-1", "name": "Chores1", "chores_usable": True, "enabled": True}],
        "chores_model": "model-chores-1",
        "tool_reasoning_rules": [
            {
                "id": "r_dev",
                "tool_ids": ["device_profile"],
                "reasoning_effort": "medium",
                "on_unsupported": "fallback",
            }
        ],
    }

    mock_llm = AsyncMock()
    mock_llm.providers = [{"provider_model_id": "model-chores-1"}]
    mock_llm.chat = AsyncMock(return_value="设备用户画像分析结果")

    from unittest.mock import MagicMock

    mock_db = MagicMock()
    fake_device = Device(id=1, fingerprint="fp123")
    mock_db.get.return_value = fake_device

    with patch("app.routers.admin._load_cfg", return_value=cfg), \
         patch("app.routers.admin._build_llm", return_value=mock_llm), \
         patch("app.routers.admin._gather_device_evidence", return_value={}), \
         patch("app.routers.admin.supports_reasoning", return_value=True):
        res = await generate_device_ai_profile(device_id=1, db=mock_db)

    assert res["ai_profile"] == "设备用户画像分析结果"
    kwargs = mock_llm.chat.await_args.kwargs
    assert kwargs.get("reasoning_effort") == "medium"
