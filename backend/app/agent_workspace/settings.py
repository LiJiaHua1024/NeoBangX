import json

from pydantic import BaseModel, Field, field_validator
from urllib.parse import urlsplit

from app.database import SessionLocal
from app.models import AppConfig

KEY = "agent_workspace_settings"


class WorkspaceSettings(BaseModel):
    enabled: bool = True
    max_steps: int = Field(24, ge=2, le=100)
    max_tokens: int = Field(250000, ge=4096, le=1500000)
    output_tokens: int = Field(16384, ge=2048, le=131072)
    max_seconds: int = Field(1800, ge=60, le=7200)
    concurrency: int = Field(2, ge=1, le=8)
    mcp_enabled: bool = False
    mcp_url: str = Field("", max_length=2048)
    mcp_token: str = Field("", max_length=4096)
    mcp_tool: str = Field("", max_length=200)
    mcp_query_field: str = Field("query", max_length=100)
    mcp_arguments: dict = Field(default_factory=dict)
    mcp_schema: dict = Field(default_factory=dict)
    mcp_timeout: int = Field(45, ge=5, le=180)

    @field_validator("mcp_url")
    @classmethod
    def check_url(cls, value):
        value = value.strip()
        if value:
            u = urlsplit(value)
            if u.scheme not in {"https", "http"} or not u.hostname or u.username or u.password or u.fragment:
                raise ValueError("MCP 地址须为完整 HTTP(S) 地址，不包含用户名、密码或片段")
        return value


def load_settings() -> WorkspaceSettings:
    with SessionLocal() as db:
        row = db.get(AppConfig, KEY)
        return WorkspaceSettings.model_validate_json(row.value) if row else WorkspaceSettings()


def save_settings(data: WorkspaceSettings) -> dict:
    with SessionLocal() as db:
        row = db.get(AppConfig, KEY)
        if row is None:
            row = AppConfig(key=KEY)
            db.add(row)
        row.value = data.model_dump_json()
        db.commit()
    return admin_settings(data)


def admin_settings(data=None):
    data = data or load_settings()
    value = data.model_dump(exclude={"mcp_token"})
    value["has_token"] = bool(data.mcp_token)
    return value


def search_available(data=None):
    data = data or load_settings()
    return bool(data.mcp_enabled and data.mcp_url and data.mcp_tool and data.mcp_schema)
