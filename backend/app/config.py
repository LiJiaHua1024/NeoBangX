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

    # 静态资源服务：压缩与缓存头（实现见 app.middleware.StaticCacheMiddleware）
    # 关闭压缩 / brotli 可在弱 CPU 上用环境变量回退（STATIC_COMPRESS=false）
    static_compress: bool = True
    static_brotli: bool = True  # 仅 gzip 兜底：设 false 或 brotli 包缺失时生效
    static_cache_max_age: int = 31536000  # 带 ?v= 版本号的静态资源缓存秒数

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
    # 单家 Provider 等待「第一个数据块」的秒数上限：超时即判该家失效并切下一家。
    # 只约束流式生成的建连与首块，出字之后仍按 timeout 的按块读超时判定
    first_token_timeout: int = 30

    # 用户端模型下拉默认显示的数量，超出折叠为「展开全部」，0 = 不折叠
    max_visible_models: int = 0

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

    # 线路镜像：让同一套应用的多条线路（如主线路 + 备份线路）共用一份历史与收藏。
    # 前端在两条线路之间互嵌隐藏的同站 iframe，把变更推进对方 origin 自己的
    # localStorage；后端不参与数据，只提供这份配置。
    # 默认关闭：只有真的部署了第二条线路才需要开启。
    mirror_enabled: bool = False
    # 参与镜像的线路地址，逗号或换行分隔（例：https://a.example.com,https://b.example.com）。
    # 必须是纯 origin（scheme://host[:port]，不带路径）；支持 IP 与端口，
    # 便于内网环境用 http://192.168.1.10:8000 这类地址测试。
    mirror_origins: str = ""

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
