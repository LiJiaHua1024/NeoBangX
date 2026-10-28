"""工作台总开关：公开配置端点要如实下发，主站与 /agent 据此隐藏入口与给出禁用页。"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.main import app


def test_public_config_exposes_the_agent_switch():
    client = TestClient(app)
    try:
        save_settings(WorkspaceSettings(enabled=True))
        assert client.get("/api/config").json()["agent_enabled"] is True
        save_settings(WorkspaceSettings(enabled=False))
        assert client.get("/api/config").json()["agent_enabled"] is False
    finally:
        save_settings(WorkspaceSettings())
