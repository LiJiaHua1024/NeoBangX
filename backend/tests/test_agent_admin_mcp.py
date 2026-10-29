"""MCP 令牌只能发给它被保存时的那台主机。

旧实现里"改地址、令牌留空、点测试连接"会把已保存的 Bearer 令牌
原样发给管理员新填的任意地址，换供应商或打错域名就等于泄露密钥。
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.agent_workspace import admin
from app.agent_workspace.settings import WorkspaceSettings, load_settings, save_settings


@pytest.fixture(autouse=True)
def clean_settings():
    save_settings(WorkspaceSettings())
    yield
    save_settings(WorkspaceSettings())


def _body(**overrides):
    base = admin.SettingsWrite(mcp_url="https://mcp.example.com/sse", mcp_token="")
    return base.model_copy(update=overrides)


def test_token_budget_has_no_upper_bound():
    assert WorkspaceSettings(max_tokens=2_000_000).max_tokens == 2_000_000
    assert WorkspaceSettings(max_tokens=50_000_000).max_tokens == 50_000_000
    assert admin.patch_settings({"max_tokens": 50_000_000})["max_tokens"] == 50_000_000


def test_saved_token_is_not_sent_to_a_different_host():
    save_settings(WorkspaceSettings(mcp_url="https://mcp.example.com/sse", mcp_token="SECRET-TOKEN"))
    with pytest.raises(HTTPException) as exc:
        admin.resolved(_body(mcp_url="https://evil.example.net/sse"))
    assert exc.value.status_code == 422
    assert "重新填写令牌" in exc.value.detail


def test_same_host_keeps_the_saved_token():
    save_settings(WorkspaceSettings(mcp_url="https://mcp.example.com/sse", mcp_token="SECRET-TOKEN"))
    cfg = admin.resolved(_body(mcp_url="https://mcp.example.com/other"))
    assert cfg.mcp_token == "SECRET-TOKEN"


def test_new_token_is_accepted_for_a_new_host():
    save_settings(WorkspaceSettings(mcp_url="https://mcp.example.com/sse", mcp_token="SECRET-TOKEN"))
    cfg = admin.resolved(_body(mcp_url="https://other.example.net/sse", mcp_token="NEW-TOKEN"))
    assert cfg.mcp_token == "NEW-TOKEN"


def test_first_time_setup_without_a_token_still_works():
    cfg = admin.resolved(_body(mcp_url="https://mcp.example.com/sse", mcp_token=""))
    assert cfg.mcp_token == "" and cfg.mcp_url == "https://mcp.example.com/sse"


def test_connect_endpoint_rejects_a_host_change(monkeypatch):
    save_settings(WorkspaceSettings(mcp_url="https://mcp.example.com/sse", mcp_token="SECRET-TOKEN"))
    called = []

    async def no_connect(cfg):
        called.append(cfg)
        raise AssertionError("不该向新主机发起连接")

    monkeypatch.setattr(admin, "connection", no_connect)
    client = TestClient(admin_app)
    resp = client.post("/api/admin/agent/connect",
                       json={"mcp_url": "https://evil.example.net/sse", "mcp_token": ""})
    assert resp.status_code == 422
    assert not called
    assert load_settings().mcp_token == "SECRET-TOKEN"


def test_patch_only_changes_the_fields_it_is_given():
    """PATCH {"enabled": false} 不能把预算与 MCP 配置一起重置。"""
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app

    save_settings(WorkspaceSettings(enabled=True, max_steps=30, mcp_url="https://mcp.example.com/sse",
                                    mcp_token="SECRET-TOKEN", mcp_tool="search", mcp_query_field="q"))
    client = TestClient(admin_app)
    resp = client.patch("/api/admin/agent", json={"enabled": False})
    assert resp.status_code == 200, resp.text
    cfg = load_settings()
    assert cfg.enabled is False
    assert cfg.max_steps == 30 and cfg.mcp_url == "https://mcp.example.com/sse"
    assert cfg.mcp_tool == "search" and cfg.mcp_token == "SECRET-TOKEN"


def test_patch_validates_and_rejects_unknown_fields():
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app

    save_settings(WorkspaceSettings())
    client = TestClient(admin_app)
    assert client.patch("/api/admin/agent", json={"max_steps": 1}).status_code == 422
    assert client.patch("/api/admin/agent", json={"nope": 1}).status_code == 422
    assert client.patch("/api/admin/agent", json={"max_steps": 40}).status_code == 200
    assert load_settings().max_steps == 40


def test_patch_keeps_the_token_bound_to_its_host():
    from fastapi.testclient import TestClient

    from app.admin_main import app as admin_app

    save_settings(WorkspaceSettings(mcp_url="https://mcp.example.com/sse", mcp_token="SECRET-TOKEN"))
    client = TestClient(admin_app)
    assert client.patch("/api/admin/agent", json={"mcp_url": "https://evil.example.net/sse"}).status_code == 422
    assert client.patch("/api/admin/agent",
                        json={"mcp_url": "https://evil.example.net/sse", "mcp_token": "NEW"}).status_code == 200
    assert load_settings().mcp_token == "NEW"
