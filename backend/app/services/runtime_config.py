"""运行时配置：环境变量默认值 + SQLite 覆盖（含多 Provider 聚合）。"""

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
            break
        try:
            db.add_all(AppConfig(key=key, value=value or "") for key, value in missing)
            db.commit()
            break
        except IntegrityError:
            # 另一进程抢先插入了部分键，回滚后重查剩余缺失项
            db.rollback()
    else:
        logger.warning("seed_config_from_env 多次遇到并发冲突，剩余键将由另一进程完成种入")

    # 多 Provider 聚合的自动迁移：若 providers 表空但旧单 URL 配置非空，则生成首个 Provider 并全量绑定
    try:
        _seed_providers_from_legacy(db)
    except Exception as e:
        logger.warning("seed providers from legacy failed: %s", e)


def _seed_providers_from_legacy(db: Session) -> None:
    """检测旧单 URL 配置并迁移为首个 Provider + 全量 model_provider_map。"""
    from sqlalchemy import select

    from app.models import LlmModelProvider, LlmProvider

    # 若已存在任何 Provider，则不自动种入
    existing_count = db.execute(select(LlmProvider)).scalars().first()
    if existing_count is not None:
        return

    cfg = get_config_map(db)
    legacy_base = (cfg.get("llm_base_url") or "").strip()
    legacy_key = (cfg.get("llm_api_key") or settings.main_api_key or "").strip()
    # 若 legacy 完全为空，也按 models 生成一个 provider 占位（便于新部署直接可用）
    models = parse_models(cfg.get("models") or settings.models)
    if not models:
        return
    # 仅当至少有一个非空 legacy 字段或 models 非空时才种入
    # 无 legacy key 且 base_url 为空时，仍创建一个空 key 的 provider 占位，保证模型可用性检查能通过
    provider_name = "主服务（自动迁移）"
    # 若 legacy_key 为空，仍创建 provider，key 留空（允许后续在后台填）
    prov_id = "prov_migrated_main"
    # 检查是否已存在该 id
    if db.get(LlmProvider, prov_id) is not None:
        return
    prov = LlmProvider(
        id=prov_id,
        name=provider_name,
        base_url=legacy_base,
        api_key=legacy_key,
        enabled=True,
    )
    db.add(prov)
    db.flush()
    # 全量绑定：每个模型都绑定到该 Provider，priority 0
    for m in models:
        db.add(LlmModelProvider(model_id=m["id"], provider_id=prov_id, priority=0))
    db.commit()
    logger.info("已自动迁移旧单 URL 配置为 Provider %s，绑定 %s 个模型", prov_id, len(models))


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
    """解析当前生效的 LLM 连接参数（含多 Provider 聚合）。"""
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

    # 多 Provider 聚合：加载 providers 与 model_provider_map
    try:
        from app.services.provider_config import get_model_provider_map, list_providers

        providers = list_providers(db, mask=False)  # 原始 key 供内部使用
        model_provider_map = get_model_provider_map(db)
        # 同时提供脱敏版供外部展示
        providers_masked = list_providers(db, mask=True)
    except Exception as e:
        logger.warning("加载 providers 失败，回退为单 Provider 兼容模式: %s", e)
        providers = []
        model_provider_map = {}
        providers_masked = []

    # 兼容：若 providers 为空但旧 llm_* 配置非空，构造临时单 Provider 视图
    if not providers and (llm_base_url or llm_api_key):
        providers = [{
            "id": "prov_legacy",
            "name": "主服务（兼容）",
            "base_url": llm_base_url,
            "api_key": llm_api_key,
            "enabled": True,
            "has_api_key": bool(llm_api_key),
        }]
        providers_masked = [{
            "id": "prov_legacy",
            "name": "主服务（兼容）",
            "base_url": llm_base_url,
            "api_key": mask_config({"llm_api_key": llm_api_key}).get("llm_api_key", ""),
            "enabled": True,
            "has_api_key": bool(llm_api_key),
        }]
        # 兼容的 map：所有模型都指向该临时 provider
        if not model_provider_map:
            model_provider_map = {m["id"]: ["prov_legacy"] for m in model_list}

    # 计算可用模型（至少有一个 enabled Provider 绑定的模型）
    providers_by_id = {p["id"]: p for p in providers}
    # enabled 过滤后的 map 用于判断可用性
    available_model_ids = set()
    for mid, pids in model_provider_map.items():
        for pid in pids:
            prov = providers_by_id.get(pid)
            if prov and prov.get("enabled"):
                available_model_ids.add(mid)
                break
    # 若没有 model_provider_map 配置（新库未迁移），则视为所有模型可用（兼容旧逻辑）
    if not model_provider_map and providers:
        available_model_ids = {m["id"] for m in model_list}

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
        "providers": providers,
        "providers_masked": providers_masked,
        "model_provider_map": model_provider_map,
        "available_model_ids": available_model_ids,
    }
