"""运行时配置：环境变量默认值 + SQLite 覆盖（含多 Provider 聚合）。"""

from __future__ import annotations

import json
import logging
import uuid
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppConfig

# 允许管理后台读写的配置键（已移除旧 llm_*/chores_base_url/api_key，整卡删除后不再可写）
CONFIG_KEYS = [
    "default_model",
    "models",
    "chores_model",
    "ocr_model",
    "ocr_max_tokens",
    "max_tokens",
    "timeout",
    "first_token_timeout",
    "max_visible_models",
    "log_payload",
    "log_retention_days",
    "mineru_mode",
    "mineru_model",
    "mineru_token",
    "tool_reasoning_rules",
    "mirror_enabled",
    "mirror_origins",
]

# 线路镜像：参与镜像的线路条数上限。
# 协议按「一对线路互为镜像」设计（共用一条待同步队列、靠对端回执出队），
# 三条以上需要改造成每对端独立队列，所以这里明确拦截，而不是静默只认前两条。
MAX_MIRROR_ORIGINS = 2
# 单条线路地址长度上限（纯 origin 远短于此，仅防误填超长串）
MAX_MIRROR_ORIGIN_LEN = 200

# MinerU 文档解析合法取值
MINERU_MODES = {"precision", "agent"}
MINERU_MODELS = {"pipeline", "vlm"}

# 敏感字段：列表接口可脱敏（旧键保留仅为兼容读取，不再写入）
SENSITIVE_KEYS = {"llm_api_key", "chores_api_key", "openrouter_api_key", "mineru_token"}

# LiteLLM reasoning_effort 合法取值（none = 关闭思考）
REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high"}

# 工具推理规则：模型不支持规则强度时的处理方式
TOOL_REASONING_UNSUPPORTED_ACTIONS = {"fallback", "fail"}

# 免费模型防滥用限额窗口（键顺序即校验顺序，由短到长）
FREE_LIMIT_KEYS = ("minute", "hour", "day", "week", "month")

# 限额取值上限：纯防误填天文数字导致 SQL 计数形同虚设
FREE_LIMIT_MAX = 1_000_000

# 用户端模型下拉最大显示数的取值上限（0 = 不折叠，保留全量显示）
MAX_VISIBLE_MODELS_LIMIT = 50

# 模型用途能力位：勾选列表里那三项。禁用（enabled=false）是它们的上一级开关，
# 禁用后三项一律失效；未禁用时必须至少勾选一项。
CAPABILITY_KEYS = ("user_usable", "ocr_usable", "chores_usable")
# 旧的「仅 Chores」单开关写法，仅用于把老数据迁移成能力位
LEGACY_CHORES_ONLY_KEYS = ("chores_only", "only_chores", "choresOnly")
# OCR 最大输出 tokens 上限：整卷转录允许很长，但挡掉误填的天文数字
OCR_MAX_TOKENS_LIMIT = 32768

logger = logging.getLogger(__name__)


def _clamp_score(score) -> float | None:
    """校验推荐评分，非法值返回 None。"""
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    return round(max(0.0, min(10.0, float(score))), 1)


def _parse_enabled(item: dict) -> bool:
    """解析模型启用状态，缺省为 True（兼容老数据）。

    优先级：enabled / is_enabled > disabled（取反）。
    """
    raw = item.get("enabled")
    if raw is None:
        raw = item.get("is_enabled")
    if raw is not None:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        s = str(raw).strip().lower()
        if s in ("0", "false", "no", "off", "disabled", "disable"):
            return False
        if s in ("1", "true", "yes", "on", "enabled", "enable"):
            return True
        return True
    disabled_raw = item.get("disabled")
    if disabled_raw is not None:
        if isinstance(disabled_raw, bool):
            return not disabled_raw
        if isinstance(disabled_raw, (int, float)):
            return not bool(disabled_raw)
        s = str(disabled_raw).strip().lower()
        if s in ("1", "true", "yes", "on"):
            return False
        if s in ("0", "false", "no", "off"):
            return True
    return True


def _parse_flag(item: dict, *names: str, default: bool = False) -> bool:
    """按名称顺序解析布尔开关，缺省返回 default。"""
    for name in names:
        raw = item.get(name)
        if raw is None:
            continue
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        s = str(raw).strip().lower()
        if s in ("1", "true", "yes", "on", "enabled", "enable"):
            return True
        if s in ("0", "false", "no", "off", "disabled", "disable", ""):
            return False
        return default
    return default


def parse_capabilities(item: dict) -> dict:
    """解析模型的三个用途能力位，并把旧的「仅 Chores」开关迁移过来。

    user_usable 用户端可选；ocr_usable 可用于图片识别；chores_usable 可用于 Chores。
    老数据里没有任何新键时按旧行为回填：不是「仅 Chores」就能给用户用、
    任何启用模型都能做 Chores、不默认开放 OCR。
    """
    if any(item.get(key) is not None for key in CAPABILITY_KEYS):
        return {
            "user_usable": _parse_flag(item, "user_usable", default=True),
            "ocr_usable": _parse_flag(item, "ocr_usable", default=False),
            "chores_usable": _parse_flag(item, "chores_usable", default=True),
        }
    legacy_only = _parse_flag(item, *LEGACY_CHORES_ONLY_KEYS, default=False)
    return {
        "user_usable": not legacy_only,
        "ocr_usable": False,
        "chores_usable": True,
    }


def has_any_capability(model: dict) -> bool:
    """未禁用模型是否至少勾选了一项用途。"""
    return any(bool(model.get(key)) for key in CAPABILITY_KEYS)


def normalize_origin(raw: str) -> str | None:
    """把一条线路地址规范化成 origin（scheme://host[:port]），非法返回 None。

    只接受纯 origin：带路径 / 查询 / 片段 / 用户信息的一律拒绝。前端要拿这个值
    去拼 `{origin}/static/bridge.html`，并与 `event.origin` 做**全等**比较，而
    event.origin 永远只是 scheme://host[:port]，所以任何多余部分都会让比对失败，
    与其到运行时静默不工作，不如在写入口就拒掉。
    默认端口（http:80 / https:443）归一为省略写法，保证同一台机器只存成一种样子。
    """
    text = (raw or "").strip()
    if not text or len(text) > MAX_MIRROR_ORIGIN_LEN:
        return None
    try:
        split = urlsplit(text)
        # 访问 .port 会为非法端口抛 ValueError，一并归入「非法」
        port = split.port
    except ValueError:
        return None
    if split.scheme not in ("http", "https") or not split.hostname:
        return None
    if split.path not in ("", "/") or split.query or split.fragment:
        return None
    if split.username or split.password:
        return None
    host = split.hostname.lower()
    # 非 ASCII 主机名（中文域名等）直接拒绝：浏览器 event.origin 是 punycode
    # （xn--…），Python 侧保留原样，放行也只会到运行时静默失效，不如写入口就报错
    if not host.isascii():
        return None
    # IPv6 字面量：urlsplit 已去方括号，拼回时补上
    if ":" in host:
        host = f"[{host}]"
    if port is None or (split.scheme, port) in (("http", 80), ("https", 443)):
        return f"{split.scheme}://{host}"
    return f"{split.scheme}://{host}:{port}"


def parse_origins(raw) -> list[str]:
    """解析线路地址列表：接受 JSON 数组、逗号分隔、换行分隔三种写法。

    前两种覆盖管理后台与 .env，换行便于手工排版。去重保序、最多
    MAX_MIRROR_ORIGINS 条；非法项直接丢弃（读取侧容错，写入口另有严格校验）。
    """
    items: list[str] = []
    if isinstance(raw, (list, tuple)):
        items = [str(x) for x in raw]
    else:
        text = (raw or "").strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                data = json.loads(text)
            except ValueError:
                return []
            if not isinstance(data, list):
                return []
            items = [str(x) for x in data]
        else:
            items = text.replace("\r", "").replace("\n", ",").split(",")
    out: list[str] = []
    for item in items:
        origin = normalize_origin(item)
        if origin and origin not in out:
            out.append(origin)
        if len(out) >= MAX_MIRROR_ORIGINS:
            break
    return out


def validate_mirror_origins(raw) -> list[str]:
    """写入口的严格校验：非法项抛 ValueError（消息可直接展示给管理员）。

    与 parse_origins 的区别是「不静默丢弃」——管理后台保存时填错了要当场报错，
    否则用户会以为配置生效了。
    """
    items = raw if isinstance(raw, (list, tuple)) else parse_origins(raw)
    out: list[str] = []
    for item in items:
        text = str(item or "").strip()
        if not text:
            continue
        origin = normalize_origin(text)
        if not origin:
            raise ValueError(
                f"线路地址不合法：{text}（需形如 https://a.example.com 或 http://192.168.1.10:8000，不能带路径）"
            )
        if origin in out:
            raise ValueError(f"线路地址重复：{origin}")
        out.append(origin)
    if len(out) > MAX_MIRROR_ORIGINS:
        raise ValueError(f"最多只能配置 {MAX_MIRROR_ORIGINS} 条线路")
    return out


def serialize_mirror_origins(origins) -> str:
    """序列化为存储用 JSON 字符串（先规范化，非法项在此拦截）。"""
    return json.dumps(validate_mirror_origins(origins), ensure_ascii=False)


def parse_mirror_settings(cfg: dict[str, str]) -> dict:
    """解析线路镜像配置，供前端与桥接页使用。

    ready 表示「开关已开且恰好配了两条合法线路」。前端还要自己确认
    location.origin 在列表里 —— 服务器不替它判断：那需要信任 Host / 转发头，
    而反代与隧道下这两个头未必可靠，由页面拿真实 origin 比对更稳。
    """
    enabled = (cfg.get("mirror_enabled") or "").strip().lower() in ("1", "true", "yes", "on")
    origins = parse_origins(cfg.get("mirror_origins"))
    if not enabled:
        return {"enabled": False, "origins": origins, "ready": False, "reason": "disabled"}
    if len(origins) < 2:
        return {"enabled": True, "origins": origins, "ready": False, "reason": "need_two_origins"}
    return {"enabled": True, "origins": origins, "ready": True, "reason": ""}


def parse_free_limits(raw) -> dict[str, int]:
    """解析免费模型的防滥用限额（每分钟/小时/天/周/月）。

    0 或负数 = 不限制，非法值同样归零；上限截断为 FREE_LIMIT_MAX。
    键缺失补 0，保证序列化往返后结构稳定。
    """
    out: dict[str, int] = {key: 0 for key in FREE_LIMIT_KEYS}
    if not isinstance(raw, dict):
        return out
    for key in FREE_LIMIT_KEYS:
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        number = int(value)
        if number <= 0:
            continue
        out[key] = min(number, FREE_LIMIT_MAX)
    return out


def parse_models(raw: str) -> list[dict]:
    """解析模型配置。

    新格式：JSON 数组，每项含 id / name / description / score / reasoning_effort / thinking_budget /
    user_usable / ocr_usable / chores_usable / enabled / is_free / free_no_code / free_limits；
    旧格式：逗号分隔的模型 ID 字符串，自动升级为结构化条目。
    enabled 缺省为 True（兼容老数据）；禁用后三项用途一律不可用。
    三项用途能力位见 parse_capabilities（旧 chores_only 会在读取时迁移）。
    is_free = 免费模型（不扣次数、用户端展示「免费」标签）；
    free_no_code 仅在 is_free 为真时生效，表示无使用码或额度用尽时也可调用；
    free_limits 为防滥用限额，0 = 不限制。
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
            enabled = _parse_enabled(item)
            # 免费模型：兼容 is_free / free 两种写法；未标记免费时无码开关强制归零
            is_free = _parse_flag(item, "is_free", "free")
            free_no_code = is_free and _parse_flag(item, "free_no_code", "free_without_code")
            out.append({
                "id": model_id,
                "name": str(item.get("name") or "").strip() or model_id,
                "description": str(item.get("description") or "").strip(),
                "score": _clamp_score(item.get("score")),
                "reasoning_effort": effort if effort in REASONING_EFFORTS else None,
                "thinking_budget": int(budget) if isinstance(budget, (int, float)) and int(budget) > 0 else None,
                **parse_capabilities(item),
                "enabled": enabled,
                "is_free": is_free,
                "free_no_code": free_no_code,
                "free_limits": parse_free_limits(item.get("free_limits")),
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
            "user_usable": True,
            "ocr_usable": False,
            "chores_usable": True,
            "enabled": True,
            "is_free": False,
            "free_no_code": False,
            "free_limits": parse_free_limits(None),
        }
        for m in raw.split(",")
        if m.strip()
    ]


def serialize_models(models: list[dict]) -> str:
    """将结构化模型列表序列化为存储用 JSON 字符串（先规范化过滤非法项）。"""
    normalized = parse_models(json.dumps(models, ensure_ascii=False))
    return json.dumps(normalized, ensure_ascii=False)


def _new_rule_id() -> str:
    return "r_" + uuid.uuid4().hex[:12]


def parse_tool_reasoning_rules(raw: str) -> list[dict]:
    """解析工具推理规则配置。

    JSON 数组，每项含 id / tool_ids / reasoning_effort / on_unsupported；
    工具 ID 为字符串（"1"~"26"），数值型自动转字符串以兼容前端提交。
    非法条目（tool_ids 为空或 effort 非法）跳过；id 缺省时生成，
    经 serialize 往返一次后固定。
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        tool_ids: list[str] = []
        for tid in item.get("tool_ids") or []:
            s = str(tid).strip()
            if s and s not in tool_ids:
                tool_ids.append(s)
        effort = item.get("reasoning_effort")
        if not tool_ids or effort not in REASONING_EFFORTS:
            continue
        action = item.get("on_unsupported")
        if action not in TOOL_REASONING_UNSUPPORTED_ACTIONS:
            action = "fallback"
        rule_id = str(item.get("id") or "").strip() or _new_rule_id()
        out.append({
            "id": rule_id,
            "tool_ids": tool_ids,
            "reasoning_effort": effort,
            "on_unsupported": action,
        })
    return out


def serialize_tool_reasoning_rules(rules: list[dict]) -> str:
    """将结构化规则列表序列化为存储用 JSON 字符串（先规范化过滤非法项）。"""
    normalized = parse_tool_reasoning_rules(json.dumps(rules, ensure_ascii=False))
    return json.dumps(normalized, ensure_ascii=False)


def find_tool_reasoning_rule(rules: list[dict], tool_id: str) -> dict | None:
    """按列表顺序返回第一条适用于该工具的规则，未配置则返回 None。"""
    for rule in rules or []:
        if tool_id in (rule.get("tool_ids") or []):
            return rule
    return None


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
        "chores_model": settings.chores_model,
        "ocr_model": settings.ocr_model,
        "ocr_max_tokens": str(settings.ocr_max_tokens),
        "max_tokens": str(settings.max_tokens),
        "timeout": str(settings.timeout),
        "max_visible_models": str(settings.max_visible_models),
        "log_payload": "true" if settings.log_payload else "false",
        "log_retention_days": str(settings.log_retention_days),
        "mineru_mode": settings.mineru_mode,
        "mineru_model": settings.mineru_model,
        "mineru_token": settings.mineru_token,
        "mirror_enabled": "true" if settings.mirror_enabled else "false",
        "mirror_origins": settings.mirror_origins,
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
    # 全量绑定：每个模型都绑定到该 Provider，priority 0，provider_model_id 默认为逻辑 id
    for m in models:
        db.add(LlmModelProvider(model_id=m["id"], provider_id=prov_id, priority=0, provider_model_id=m["id"]))
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
    """解析当前生效的 LLM 连接参数（含多 Provider 聚合，已移除旧 llm_*/chores_base_url 链路）。"""
    cfg = get_config_map(db)
    models_raw = cfg.get("models") or settings.models
    model_list = parse_models(models_raw)
    default_model = (cfg.get("default_model") or settings.default_model).strip()
    chores_model = (cfg.get("chores_model") or "").strip() or default_model
    # OCR 模型：留空跟随默认模型（此时要求默认模型勾选了「用于 OCR」，
    # 见 resolve_llm_settings 返回的 ocr_model_configured 与 chat.py 的 OCR 校验）
    ocr_model_cfg = (cfg.get("ocr_model") or settings.ocr_model).strip()
    ocr_model = ocr_model_cfg or default_model

    try:
        max_tokens = int(cfg.get("max_tokens") or settings.max_tokens)
    except ValueError:
        max_tokens = settings.max_tokens
    # OCR 输出上限单独可调：整卷转录远长于普通工具，且多图一次送入时更吃输出预算
    try:
        ocr_max_tokens = int(cfg.get("ocr_max_tokens") or settings.ocr_max_tokens)
    except ValueError:
        ocr_max_tokens = settings.ocr_max_tokens
    ocr_max_tokens = max(256, min(OCR_MAX_TOKENS_LIMIT, ocr_max_tokens))
    try:
        timeout = int(cfg.get("timeout") or settings.timeout)
    except ValueError:
        timeout = settings.timeout
    # 单家 Provider 的首块等待上限：越界值一律夹回合法区间，避免误填导致整条链瞬间全灭
    try:
        first_token_timeout = int(
            cfg.get("first_token_timeout") or settings.first_token_timeout
        )
    except ValueError:
        first_token_timeout = settings.first_token_timeout
    first_token_timeout = max(5, min(600, first_token_timeout))

    # 模型下拉最大显示数：0 与非数字都视为「不折叠」，负数夹到 0，超上限夹回上限
    try:
        max_visible_models = int(cfg.get("max_visible_models") or settings.max_visible_models)
    except ValueError:
        max_visible_models = settings.max_visible_models
    max_visible_models = max(0, min(MAX_VISIBLE_MODELS_LIMIT, max_visible_models))

    if not model_list:
        model_list = [{
            "id": default_model,
            "name": default_model,
            "description": "",
            "score": None,
            "reasoning_effort": None,
            "thinking_budget": None,
            "user_usable": True,
            "ocr_usable": False,
            "chores_usable": True,
            "enabled": True,
            "is_free": False,
            "free_no_code": False,
            "free_limits": parse_free_limits(None),
        }]

    # Chores / OCR 模型若指向已禁用模型则回退到默认（默认可用才回退，否则保留原值由上层报错，
    # 避免静默切换掩盖误配置；管理端保存时已拦截，此处仅防脏数据）。
    by_id = {m["id"]: m for m in model_list}

    def _fallback_if_disabled(model_id: str) -> str:
        hit = by_id.get(model_id)
        if hit is None or hit.get("enabled", True):
            return model_id
        default_hit = by_id.get(default_model)
        if default_hit is not None and default_hit.get("enabled", True):
            return default_model
        fallback = next((m for m in model_list if m.get("enabled", True)), None)
        return fallback["id"] if fallback is not None else model_id

    chores_model = _fallback_if_disabled(chores_model)
    ocr_model = _fallback_if_disabled(ocr_model)
    # 「跟随默认」是否仍然成立：只有真正留着显式配置的模型才算配置过；
    # 配的那个被禁用而回退到默认时，等于又变成跟随默认，能力校验得按默认模型算。
    ocr_model_configured = bool(ocr_model_cfg) and ocr_model == ocr_model_cfg

    log_payload, log_retention_days = parse_log_settings(cfg)

    # 多 Provider 聚合：加载 providers 与 model_provider_map
    try:
        from app.services.provider_config import get_model_provider_details, get_model_provider_map, list_providers

        providers = list_providers(db, mask=False)  # 原始 key 供内部使用
        model_provider_map = get_model_provider_map(db)
        model_provider_details = get_model_provider_details(db)
        # 同时提供脱敏版供外部展示
        providers_masked = list_providers(db, mask=True)
    except Exception as e:
        logger.warning("加载 providers 失败，回退为单 Provider 兼容模式: %s", e)
        providers = []
        model_provider_map = {}
        model_provider_details = {}
        providers_masked = []

    # 兼容：若 providers 为空，尝试用旧 llm_* 构造临时 Provider（已整卡删除后仅极端空库兜底）
    if not providers:
        legacy_base = ""
        legacy_key = ""
        try:
            from app.models import AppConfig

            row_base = db.get(AppConfig, "llm_base_url")
            row_key = db.get(AppConfig, "llm_api_key")
            if row_base and row_base.value:
                legacy_base = row_base.value.strip()
            if row_key and row_key.value:
                legacy_key = row_key.value.strip()
            if not legacy_base:
                legacy_base = (getattr(settings, "llm_base_url", "") or "").strip()
            if not legacy_key:
                legacy_key = (getattr(settings, "main_api_key", "") or "").strip()
        except Exception:
            legacy_base = (getattr(settings, "llm_base_url", "") or "").strip()
            legacy_key = (getattr(settings, "main_api_key", "") or "").strip()
        if legacy_base or legacy_key:
            providers = [{
                "id": "prov_legacy",
                "name": "主服务（兼容）",
                "base_url": legacy_base,
                "api_key": legacy_key,
                "enabled": True,
                "has_api_key": bool(legacy_key),
            }]
            providers_masked = [{
                "id": "prov_legacy",
                "name": "主服务（兼容）",
                "base_url": legacy_base,
                "api_key": mask_config({"llm_api_key": legacy_key}).get("llm_api_key", ""),
                "enabled": True,
                "has_api_key": bool(legacy_key),
            }]
            if not model_provider_map:
                model_provider_map = {m["id"]: ["prov_legacy"] for m in model_list}
            if not model_provider_details:
                model_provider_details = {m["id"]: [{"provider_id": "prov_legacy", "provider_model_id": m["id"], "priority": 0}] for m in model_list}

    # 计算可用模型（至少有一个 enabled Provider 绑定的模型，且对用户可见、未禁用）
    providers_by_id = {p["id"]: p for p in providers}
    hidden_ids = {m["id"] for m in model_list if not m.get("user_usable", True)}
    disabled_ids = {m["id"] for m in model_list if not m.get("enabled", True)}
    available_model_ids = set()
    for mid, pids in model_provider_map.items():
        if mid in hidden_ids or mid in disabled_ids:
            continue
        for pid in pids:
            prov = providers_by_id.get(pid)
            if prov and prov.get("enabled"):
                available_model_ids.add(mid)
                break
    # 若没有 model_provider_map 配置（新库未迁移），则视为所有启用且对用户可见的模型可用
    if not model_provider_map and providers:
        available_model_ids = {m["id"] for m in model_list if m.get("user_usable", True) and m.get("enabled", True)}

    mineru_mode = (cfg.get("mineru_mode") or "precision").strip() or "precision"
    if mineru_mode not in MINERU_MODES:
        mineru_mode = "precision"
    mineru_model = (cfg.get("mineru_model") or "pipeline").strip() or "pipeline"
    if mineru_model not in MINERU_MODELS:
        mineru_model = "pipeline"
    mineru_token = (cfg.get("mineru_token") or "").strip()

    tool_reasoning_rules = parse_tool_reasoning_rules(cfg.get("tool_reasoning_rules", ""))

    return {
        "models": model_list,
        "default_model": default_model,
        "llm_model": default_model,
        "llm_api_key": "",
        "llm_base_url": "",
        "chores_model": chores_model,
        "chores_base_url": "",
        "chores_api_key": "",
        "ocr_model": ocr_model,
        "ocr_model_configured": ocr_model_configured,
        "ocr_max_tokens": ocr_max_tokens,
        "max_tokens": max_tokens,
        "timeout": timeout,
        "first_token_timeout": first_token_timeout,
        "max_visible_models": max_visible_models,
        "log_payload": log_payload,
        "log_retention_days": log_retention_days,
        "providers": providers,
        "providers_masked": providers_masked,
        "model_provider_map": model_provider_map,
        "model_provider_details": model_provider_details,
        "available_model_ids": available_model_ids,
        "mineru": {
            "mode": mineru_mode,
            "model": mineru_model,
            "has_token": bool(mineru_token),
        },
        "tool_reasoning_rules": tool_reasoning_rules,
    }
