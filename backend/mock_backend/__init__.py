"""NeoBangX 测试用假后端（仅测试用，不属于生产代码）。

两个角色，同一个进程：

1. **假后端**（默认）：静态托管 frontend/ 并打桩全部主站 API，配一个可控的
   SSE 场景引擎。浏览器直连它即可测前端，完全不碰真实后端与 LLM API key。
2. **假 LLM 上游**：另暴露 OpenAI 兼容的 /v1/{scenario}/chat/completions。
   真实后端的 provider 指过来，就能零成本走完整真实链路（多通道 fallback、
   首块超时、计费扣次、使用日志）。

启动：:

    cd backend
    uv run python -m mock_backend.main                     # 127.0.0.1:8000
    uv run python -m mock_backend.main --port 8002 --mirror-origin http://localhost:8000
    uv run python -m mock_backend.main --scenario slow

场景清单与差异说明见同目录 README.md。
"""

__all__ = ["main"]
