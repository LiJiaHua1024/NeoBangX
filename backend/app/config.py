from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

# 公开在源码与 .env.example 中的默认密钥。运行时若仍为该值，
# 任何人都能离线伪造合法登录票据（见管理后台的安全警告）。
DEFAULT_JWT_SECRET = "neobangx-dev-secret-change-me"


class Settings(BaseSettings):
    """NeoBangX 后端配置类

    配置优先级：环境变量 > .env 文件 > 默认值
    运行时 LLM 配置可由管理后台写入 SQLite，覆盖此处默认值。
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # FastAPI 运行参数
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    admin_host: str = "0.0.0.0"
    admin_port: int = 8001

    # 路径配置
    prompts_dir: Path = Path("../prompts")
    static_dir: Path = Path("../frontend")
    admin_static_dir: Path = Path("../admin-frontend")
    data_dir: Path = Path("./data")

    # JWT / 使用码
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_expire_days: int = 365

    @property
    def jwt_secret_is_default(self) -> bool:
        """密钥仍为公开默认值时为 True，管理后台据此显示安全警告。"""
        return self.jwt_secret == DEFAULT_JWT_SECRET

    # LLM 配置
    # 兼容旧版：OpenRouter API Key（未配置 llm_api_key 时使用）
    openrouter_api_key: str = ""

    # 默认模型（LiteLLM 格式，例如：openrouter/google/gemini-2.0-flash）
    default_model: str = "openrouter/google/gemini-2.0-flash"

    # 可用模型列表，逗号分隔（LiteLLM 格式）
    models: str = "openrouter/google/gemini-2.0-flash"

    # 主 AI 连接配置
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # Chores AI 连接配置：用于标题生成等轻量任务
    chores_model: str = ""
    chores_base_url: str = ""
    chores_api_key: str = ""

    # LLM 调用参数
    max_tokens: int = 4096
    timeout: int = 120

    # MinerU 文档解析（PDF）：模式 precision=精准解析API（推荐）/ agent=轻量解析API；
    # 模型仅精准模式有效 pipeline（推荐）/ vlm；token 仅精准模式必填；base_url 硬编码官方地址
    mineru_mode: str = "precision"
    mineru_model: str = "pipeline"
    mineru_token: str = ""

    # 使用日志
    # 是否记录每次请求的原始输入 / 渲染 Prompt / 模型输出（元数据始终记录）
    log_payload: bool = False
    # 日志保留天数，超过后自动清理；0 = 永久保留
    log_retention_days: int = 0

    # SSE 配置
    sse_retry_timeout: int = 30000  # 客户端重连时间（毫秒）

    @property
    def model_list(self) -> List[str]:
        return [m.strip() for m in self.models.split(",") if m.strip()]

    @property
    def main_api_key(self) -> str:
        return self.llm_api_key or self.openrouter_api_key

    @property
    def main_base_url(self) -> str:
        return self.llm_base_url

    @property
    def main_model(self) -> str:
        return self.llm_model or self.default_model

    @property
    def chores_api_key_value(self) -> str:
        return self.chores_api_key or self.main_api_key

    @property
    def chores_base_url_value(self) -> str:
        return self.chores_base_url or self.main_base_url

    @property
    def chores_model_value(self) -> str:
        return self.chores_model or self.main_model


settings = Settings()
