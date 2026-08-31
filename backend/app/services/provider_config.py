"""Provider 与 Model→Provider 优先级映射的配置读写。"""

from __future__ import annotations

import re
import secrets
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import LlmModelProvider, LlmProvider

# API Key 脱敏工具
def mask_api_key(raw: str) -> str:
    if not raw:
        return ""
    if len(raw) <= 8:
        return "****"
    return raw[:4] + "****" + raw[-4:]


def _validate_base_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url):
        raise ValueError("Base URL 必须以 http:// 或 https:// 开头")
    # 去掉尾部 /
    return url.rstrip("/")


def _gen_provider_id() -> str:
    # nanoid 风格短 id
    return "prov_" + secrets.token_hex(6)


# ---- Provider CRUD ----

def list_providers(db: Session, *, mask: bool = False) -> list[dict]:
    rows = db.execute(select(LlmProvider).order_by(LlmProvider.created_at)).scalars().all()
    return [r.to_dict(mask_key=mask) for r in rows]


def get_provider(db: Session, provider_id: str) -> LlmProvider | None:
    return db.get(LlmProvider, provider_id)


def create_provider(
    db: Session,
    *,
    name: str,
    base_url: str = "",
    api_key: str = "",
    enabled: bool = True,
    provider_id: Optional[str] = None,
) -> LlmProvider:
    name = (name or "").strip()
    if not name:
        raise ValueError("Provider 名称不能为空")
    if len(name) > 128:
        raise ValueError("Provider 名称过长（≤128）")
    base_url = _validate_base_url(base_url)
    api_key = (api_key or "").strip()
    pid = (provider_id or "").strip() or _gen_provider_id()
    if db.get(LlmProvider, pid) is not None:
        raise ValueError(f"Provider ID 已存在：{pid}")
    row = LlmProvider(id=pid, name=name, base_url=base_url, api_key=api_key, enabled=bool(enabled))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_provider(
    db: Session,
    provider_id: str,
    *,
    name: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    enabled: Optional[bool] = None,
) -> LlmProvider:
    row = db.get(LlmProvider, provider_id)
    if row is None:
        raise ValueError("Provider 不存在")
    if name is not None:
        n = name.strip()
        if not n:
            raise ValueError("Provider 名称不能为空")
        if len(n) > 128:
            raise ValueError("Provider 名称过长")
        row.name = n
    if base_url is not None:
        row.base_url = _validate_base_url(base_url)
    if api_key is not None:
        # 调用方已处理 **** 脱敏占位不覆盖的逻辑；此处直接赋值
        # 但仍兼容：如果传 **** 视为不修改（由 admin 层控制）
        if "****" in api_key:
            pass
        else:
            row.api_key = api_key.strip()
    if enabled is not None:
        row.enabled = bool(enabled)
    db.commit()
    db.refresh(row)
    return row


def delete_provider(db: Session, provider_id: str) -> None:
    row = db.get(LlmProvider, provider_id)
    if row is None:
        raise ValueError("Provider 不存在")
    # 级联清理绑定（FK CASCADE 也会清理，但显式删除更可控）
    db.execute(delete(LlmModelProvider).where(LlmModelProvider.provider_id == provider_id))
    db.delete(row)
    db.commit()


# ---- Model → Provider 有序映射 ----

def get_model_provider_map(db: Session) -> dict[str, list[str]]:
    """读取全量映射：model_id -> [provider_id 按 priority 升序]"""
    rows = db.execute(
        select(LlmModelProvider).order_by(LlmModelProvider.model_id, LlmModelProvider.priority)
    ).scalars().all()
    out: dict[str, list[str]] = {}
    for r in rows:
        out.setdefault(r.model_id, []).append(r.provider_id)
    return out


def get_model_provider_details(db: Session) -> dict[str, list[dict]]:
    """读取全量细节：model_id -> [{provider_id, provider_model_id, priority}]"""
    rows = db.execute(
        select(LlmModelProvider).order_by(LlmModelProvider.model_id, LlmModelProvider.priority)
    ).scalars().all()
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r.model_id, []).append({
            "provider_id": r.provider_id,
            "provider_model_id": r.provider_model_id or r.model_id,
            "priority": r.priority,
        })
    return out


def get_providers_for_model(
    db: Session, model_id: str, *, only_enabled: bool = True
) -> list[dict]:
    """按模型的优先级返回 Provider 链（已过滤 enabled），每项含 provider 与 provider_model_id。"""
    if not model_id:
        return []
    rows = db.execute(
        select(LlmModelProvider, LlmProvider)
        .join(LlmProvider, LlmProvider.id == LlmModelProvider.provider_id)
        .where(LlmModelProvider.model_id == model_id)
        .order_by(LlmModelProvider.priority)
    ).all()
    out: list[dict] = []
    for mp, prov in rows:
        if only_enabled and not prov.enabled:
            continue
        # 将 ORM 转为 dict 并附加 provider_model_id
        p_dict = prov.to_dict(mask_key=False)
        p_dict["provider_model_id"] = (mp.provider_model_id or "").strip() or model_id
        p_dict["priority"] = mp.priority
        out.append(p_dict)
    return out


def get_providers_for_model_from_map(
    model_provider_map: dict[str, list[str]],
    providers_by_id: dict[str, LlmProvider | dict],
    model_id: str,
) -> list[dict | LlmProvider]:
    """内存版：基于已加载的 map + providers_by_id 计算可用链（过滤 enabled）。"""
    ordered_ids = model_provider_map.get(model_id) or []
    out: list = []
    for pid in ordered_ids:
        p = providers_by_id.get(pid)
        if p is None:
            continue
        enabled = p.enabled if hasattr(p, "enabled") else p.get("enabled", True)
        if not enabled:
            continue
        out.append(p)
    return out


def set_model_provider_map(db: Session, model_provider_map: dict[str, list[str]]) -> dict[str, list[str]]:
    """全量覆盖 Model→Provider 映射（事务）。"""
    # 校验
    from app.services.runtime_config import parse_models, get_config_map  # 延迟导入避免循环
    from app.models import AppConfig

    # 加载现有 providers / models 用于校验
    provider_ids = {r.id for r in db.execute(select(LlmProvider)).scalars().all()}
    # 加载全局 models 目录
    # 直接从 DB 读 app_config.models，避免循环
    cfg_map = get_config_map(db)
    models = parse_models(cfg_map.get("models", ""))
    valid_model_ids = {m["id"] for m in models}

    normalized: dict[str, list[str]] = {}
    for model_id, pids in model_provider_map.items():
        mid = (model_id or "").strip()
        if not mid:
            continue
        if mid not in valid_model_ids:
            raise ValueError(f"模型不存在于全局目录：{mid}")
        if not isinstance(pids, list):
            raise ValueError(f"模型 {mid} 的 Provider 列表必须为数组")
        # 去重保序
        seen = set()
        ordered: list[str] = []
        for pid in pids:
            pid = str(pid or "").strip()
            if not pid or pid in seen:
                continue
            if pid not in provider_ids:
                raise ValueError(f"Provider 不存在：{pid}（模型 {mid}）")
            seen.add(pid)
            ordered.append(pid)
        normalized[mid] = ordered

    # 策略：仅替换 payload 中出现的 model_id，保留未提及模型的现有绑定（避免部分提交误删）
    # 若 payload 为空则视为清空全部（显式）
    if not normalized and model_provider_map:
        # 调用方显式传空 map 但原有非空：保持清空语义？为安全不删除任何
        # 仅当调用方意图清空时才会传 {}，此时应删除全部
        # 这里保持：空 payload 且原 map 非空时，视为不操作，直接返回现有
        # 若确实要清空，应通过传所有 model_id -> [] 的形式
        return get_model_provider_map(db)
    if normalized:
        db.execute(delete(LlmModelProvider).where(LlmModelProvider.model_id.in_(list(normalized.keys()))))
        for model_id, pids in normalized.items():
            for idx, pid in enumerate(pids):
                db.add(LlmModelProvider(model_id=model_id, provider_id=pid, priority=idx))
        db.commit()
    return get_model_provider_map(db)


def set_providers_for_single_model(
    db: Session, model_id: str, ordered_provider_ids: list[str] | list[dict]
) -> list[str]:
    """覆盖单个模型的优先级链。

    ordered_provider_ids 可为：
    - list[str] 仅 provider_id（兼容旧调用，provider_model_id 回退为 model_id）
    - list[dict] 每项 {provider_id, provider_model_id}
    """
    from app.services.runtime_config import parse_models, get_config_map

    model_id = (model_id or "").strip()
    if not model_id:
        raise ValueError("model_id 不能为空")
    cfg_map = get_config_map(db)
    models = parse_models(cfg_map.get("models", ""))
    valid_model_ids = {m["id"] for m in models}
    if model_id not in valid_model_ids:
        raise ValueError(f"模型不存在于全局目录：{model_id}")
    provider_ids = {r.id for r in db.execute(select(LlmProvider)).scalars().all()}
    seen = set()
    normalized: list[tuple[str, str]] = []  # (provider_id, provider_model_id)
    for item in ordered_provider_ids or []:
        if isinstance(item, dict):
            pid = str(item.get("provider_id") or "").strip()
            pmid = str(item.get("provider_model_id") or "").strip()
        else:
            pid = str(item or "").strip()
            pmid = ""
        if not pid or pid in seen:
            continue
        if pid not in provider_ids:
            raise ValueError(f"Provider 不存在：{pid}")
        seen.add(pid)
        # provider_model_id 为空时回退为逻辑 model_id
        if not pmid:
            pmid = model_id
        # 校验长度
        if len(pmid) > 256:
            raise ValueError(f"Provider 模型 ID 过长：{pmid}")
        normalized.append((pid, pmid))

    db.execute(delete(LlmModelProvider).where(LlmModelProvider.model_id == model_id))
    for idx, (pid, pmid) in enumerate(normalized):
        db.add(LlmModelProvider(model_id=model_id, provider_id=pid, priority=idx, provider_model_id=pmid))
    db.commit()
    return [pid for pid, _ in normalized]


def set_providers_for_single_model_detailed(
    db: Session, model_id: str, bindings: list[dict]
) -> list[dict]:
    """以详细绑定覆盖（显式 provider_model_id）。"""
    # 兼容：bindings 为 [{provider_id, provider_model_id}]
    return set_providers_for_single_model(db, model_id, bindings)


def is_model_available(db: Session, model_id: str) -> bool:
    """该模型是否至少有一个 enabled Provider 绑定。"""
    return len(get_providers_for_model(db, model_id, only_enabled=True)) > 0


def ensure_model_provider_consistency(db: Session) -> None:
    """当 models 目录或 providers 变更后，清理悬空绑定（可选调用）。"""
    # 清理 model_id 不再存在的绑定
    from app.services.runtime_config import parse_models, get_config_map

    cfg_map = get_config_map(db)
    models = parse_models(cfg_map.get("models", ""))
    valid_model_ids = {m["id"] for m in models}
    provider_ids = {r.id for r in db.execute(select(LlmProvider)).scalars().all()}
    rows = db.execute(select(LlmModelProvider)).scalars().all()
    to_delete = []
    for r in rows:
        if r.model_id not in valid_model_ids or r.provider_id not in provider_ids:
            to_delete.append(r)
    for r in to_delete:
        db.delete(r)
    if to_delete:
        db.commit()
        # 重排同 model 内的 priority 连续化
        # 按 model 分组重排
        remaining = db.execute(
            select(LlmModelProvider).order_by(LlmModelProvider.model_id, LlmModelProvider.priority)
        ).scalars().all()
        from collections import defaultdict

        grouped: dict[str, list[LlmModelProvider]] = defaultdict(list)
        for r in remaining:
            grouped[r.model_id].append(r)
        for mid, lst in grouped.items():
            for idx, r in enumerate(sorted(lst, key=lambda x: x.priority)):
                r.priority = idx
        db.commit()
