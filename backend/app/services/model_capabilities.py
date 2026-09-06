"""模型能力查询：基于 LiteLLM 模型库的静态能力判定（纯本地查表，无网络请求）。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def supports_reasoning(model_id: str) -> bool | None:
    """查询 LiteLLM 模型库判定模型是否支持 reasoning 参数。

    返回 True（明确支持）/ False（明确不支持）/ None（未知，模型库未收录，
    如自建网关的自定义模型名）。调用方对 None 应按"放行"处理，
    由 litellm.drop_params 兜底丢弃上游不支持的参数。
    """
    if not (model_id or "").strip():
        return None
    try:
        import litellm

        info = litellm.get_model_info(model=model_id.strip())
    except Exception as e:
        logger.debug("模型能力未知，按未收录处理：%s（%s）", model_id, e)
        return None
    return bool(info.get("supports_reasoning"))
