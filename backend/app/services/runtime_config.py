"""运行时配置：环境变量默认值 + SQLite 覆盖。"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppConfig

# 允许管理后台读写的配置键
CONFIG_KEYS = [
    "default_model",
    "models",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "chores_model",
    "chores_base_url",
    "chores_api_key",
    "max_tokens",
    "timeout",
    "log_payload",
    "log_retention_days",
]

# 敏感字段：列表接口可脱敏
SENSITIVE_KEYS = {"llm_api_key", "chores_api_key", "openrouter_api_key"}

# LiteLLM reasoning_effort 合法取值（none = 关闭思考）
REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high"}

logger = logging.getLogger(__name__)


def _clamp_score(score) -> float | None:
    """校验推荐评分，非法值返回 None。"""
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    return round(max(0.0, min(10.0, float(score))), 1)


def parse_models(raw: str) -> list[dict]:
    """解析模型配置。

    新格式：JSON 数组，每项含 id / name / description / score / reasoning_effort / thinking_budget；
    旧格式：逗号分隔的模型 ID 字符串，自动升级为结构化条目。
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            data = json.loads(raw)
        except ValueError:
            return []
        if not isinstance(data, list):
            return []
        out: list[dict] = []
        for item in data:
            if isinstance(item, str):
                item = {"id": item}
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            effort = item.get("reasoning_effort")
            budget = item.get("thinking_budget")
            out.append({
                "id": model_id,
                "name": str(item.get("name") or "").strip() or model_id,
                "description": str(item.get("description") or "").strip(),
                "score": _clamp_score(item.get("score")),
                "reasoning_effort": effort if effort in REASONING_EFFORTS else None,
                "thinking_budget": int(budget) if isinstance(budget, (int, float)) and int(budget) > 0 else None,
            })
        return out
    # 旧版逗号分隔格式
    return [
        {
            "id": m.strip(),
            "name": m.strip(),
            "description": "",
            "score": None,
            "reasoning_effort": None,
            "thinking_budget": None,
        }
        for m in raw.split(",")
        if m.strip()
    ]


def serialize_models(models: list[dict]) -> str:
    """将结构化模型列表序列化为存储用 JSON 字符串（先规范化过滤非法项）。"""
    normalized = parse_models(json.dumps(models, ensure_ascii=False))
    return json.dumps(normalized, ensure_ascii=False)


def find_model_entry(models: list[dict], model_id: str) -> dict | None:
    """按模型 ID 查找结构化条目，未配置则返回 None。"""
    for m in models:
        if m.get("id") == model_id:
            return m
    return None


def _env_defaults() -> dict[str, str]:
    return {
        "default_model": settings.default_model,
        "models": settings.models,
        "llm_base_url": settings.llm_base_url,
        "llm_api_key": settings.main_api_key,
        "llm_model": settings.llm_model,
        "chores_model": settings.chores_model,
        "chores_base_url": settings.chores_base_url,
        "chores_api_key": settings.chores_api_key,
        "max_tokens": str(settings.max_tokens),
        "timeout": str(settings.timeout),
        "log_payload": "true" if settings.log_payload else "false",
        "log_retention_days": str(settings.log_retention_days),
    }


def seed_config_from_env(db: Session) -> None:
    """首次启动时用环境变量填充空配置表。

    main 与 admin 两个进程可能几乎同时启动并对同一个空库执行种入，
    后提交方会撞 UNIQUE 约束；这里捕获冲突后重查补齐剩余键即可。
    """
    from sqlalchemy.exc import IntegrityError

    defaults = _env_defaults()
    for _attempt in range(3):
        existing = {row.key for row in db.query(AppConfig).all()}
        missing = [
            (key, value)
            for key, value in defaults.items()
            if key not in existing
        ]
        if not missing:
            return
        try:
            db.add_all(AppConfig(key=key, value=value or "") for key, value in missing)
            db.commit()
            return
        except IntegrityError:
            # 另一进程抢先插入了部分键，回滚后重查剩余缺失项
            db.rollback()
    logger.warning("seed_config_from_env 多次遇到并发冲突，剩余键将由另一进程完成种入")


def get_config_map(db: Session) -> dict[str, str]:
    """合并环境默认值与数据库覆盖值。"""
    merged = _env_defaults()
    for row in db.query(AppConfig).all():
        if row.key in CONFIG_KEYS:
            merged[row.key] = row.value if row.value is not None else ""
    return merged


def get_config_value(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppConfig, key)
    if row is not None:
        return row.value or ""
    return _env_defaults().get(key, default)


def set_config_values(db: Session, updates: dict[str, str]) -> dict[str, str]:
    """批量更新配置，返回最新完整配置（敏感字段不脱敏，供内部使用）。"""
    for key, value in updates.items():
        if key not in CONFIG_KEYS:
            continue
        row = db.get(AppConfig, key)
        str_value = "" if value is None else str(value)
        if row is None:
            db.add(AppConfig(key=key, value=str_value))
        else:
            row.value = str_value
    db.commit()
    return get_config_map(db)


def mask_config(cfg: dict[str, str]) -> dict[str, str]:
    """管理后台展示用：API Key 脱敏。"""
    out = dict(cfg)
    for key in SENSITIVE_KEYS:
        if key in out and out[key]:
            raw = out[key]
            if len(raw) <= 8:
                out[key] = "****"
            else:
                out[key] = raw[:4] + "****" + raw[-4:]
    return out


def parse_log_settings(cfg: dict[str, str]) -> tuple[bool, int]:
    """解析日志相关配置：（是否记录原始数据，保留天数）。"""
    log_payload = (cfg.get("log_payload") or "").strip().lower() in ("1", "true", "yes", "on")
    try:
        log_retention_days = int(cfg.get("log_retention_days") or 0)
    except ValueError:
        log_retention_days = 0
    return log_payload, max(0, log_retention_days)


def resolve_llm_settings(db: Session) -> dict:
    """解析当前生效的 LLM 连接参数。"""
    cfg = get_config_map(db)
    models_raw = cfg.get("models") or settings.models
    model_list = parse_models(models_raw)
    default_model = (cfg.get("default_model") or settings.default_model).strip()
    llm_model = (cfg.get("llm_model") or "").strip() or default_model
    llm_api_key = (cfg.get("llm_api_key") or settings.main_api_key or "").strip()
    llm_base_url = (cfg.get("llm_base_url") or "").strip()
    chores_model = (cfg.get("chores_model") or "").strip() or llm_model
    chores_base_url = (cfg.get("chores_base_url") or "").strip() or llm_base_url
    chores_api_key = (cfg.get("chores_api_key") or "").strip() or llm_api_key

    try:
        max_tokens = int(cfg.get("max_tokens") or settings.max_tokens)
    except ValueError:
        max_tokens = settings.max_tokens
    try:
        timeout = int(cfg.get("timeout") or settings.timeout)
    except ValueError:
        timeout = settings.timeout

    if not model_list:
        model_list = [{
            "id": default_model,
            "name": default_model,
            "reasoning_effort": None,
            "thinking_budget": None,
        }]

    log_payload, log_retention_days = parse_log_settings(cfg)

    return {
        "models": model_list,
        "default_model": default_model,
        "llm_model": llm_model,
        "llm_api_key": llm_api_key,
        "llm_base_url": llm_base_url,
        "chores_model": chores_model,
        "chores_base_url": chores_base_url,
        "chores_api_key": chores_api_key,
        "max_tokens": max_tokens,
        "timeout": timeout,
        "log_payload": log_payload,
        "log_retention_days": log_retention_days,
    }
