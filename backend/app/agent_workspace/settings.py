import json
import logging

from pydantic import BaseModel, Field, field_validator
from urllib.parse import urlsplit

from app.database import SessionLocal
from app.models import AppConfig
from .anysearch import REQUIRED

KEY = "agent_workspace_settings"
# 旧默认值：256K 压缩阈值下连一次调用都装不下，读取时按新口径抬到 2M
LEGACY_MAX_TOKENS = 250000
logger = logging.getLogger(__name__)


class WorkspaceSettings(BaseModel):
    enabled: bool = True
    max_steps: int = Field(24, ge=2, le=100)
    # 预算给管理员自己定：不同模型的思考量差别很大，不设上下限
    max_tokens: int = Field(2000000)
    output_tokens: int = Field(16384, ge=2048, le=131072)
    max_seconds: int = Field(1800, ge=60, le=7200)
    concurrency: int = Field(2, ge=1, le=8)
    # 上下文压缩：超过它就先压再发；真正拒绝发生在压缩后仍超过 1.25 倍时
    context_budget: int = Field(262144, ge=8192, le=2000000)
    keep_tail_steps: int = Field(4, ge=1, le=20)
    # Provider 粘性：同一家最多试几次才换（Agent 换家的代价远大于多等几秒）
    provider_attempts: int = Field(3, ge=1, le=6)
    retry_wait_cap_seconds: int = Field(60, ge=0, le=600)
    switch_compaction_ratio: float = Field(0.5, ge=0.1, le=1.0)
    mcp_enabled: bool = False
    mcp_url: str = Field("", max_length=2048)
    mcp_token: str = Field("", max_length=4096)
    # 连接时发现的服务端工具名，既是"已验证"凭据，也是可用性判断依据；
    # 具体给模型什么工具、参数怎么翻译，由 anysearch.py 固定。
    mcp_tools: list[str] = Field(default_factory=list, max_length=50)
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

    @field_validator("mcp_tools")
    @classmethod
    def check_tools(cls, value):
        seen = []
        for item in value:
            name = str(item or "").strip()
            if not name:
                continue
            if len(name) > 200:
                raise ValueError("工具名过长")
            if name not in seen:
                seen.append(name)
        return seen


def load_settings() -> WorkspaceSettings:
    with SessionLocal() as db:
        row = db.get(AppConfig, KEY)
        if not row:
            return WorkspaceSettings()
        data = WorkspaceSettings.model_validate_json(row.value)
        # 升级兼容：旧库只存了 250K 轮预算，而 256K 的上下文一步就超预算。
        # 只在「没存过 context_budget（即旧配置）+ 预算仍是旧默认」时抬一次，
        # 管理员下次在后台保存就会把新值落库。
        if "context_budget" not in (row.value or "") and data.max_tokens == LEGACY_MAX_TOKENS:
            logger.warning("Agent 配置用的仍是旧默认轮预算 250K，已按新口径按 2M 处理（保存一次即落库）")
            data = data.model_copy(update={"max_tokens": 2000000})
        return data


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
    # 四个工具缺一个就当作未接入：宁可让管理员看到"未接入"，也不要在运行时
    # 让模型拿到一个必然失败的 web_extract。
    return bool(data.mcp_enabled and data.mcp_url and REQUIRED <= set(data.mcp_tools))
