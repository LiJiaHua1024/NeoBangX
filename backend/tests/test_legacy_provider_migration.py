"""旧单 URL 配置 → 多 Provider 迁移的回归测试。

回归的是两个真实缺陷：

1. 迁移曾经从 `get_config_map` 里取 `llm_base_url` / `llm_api_key`，而这两个键早已
   被移出 `CONFIG_KEYS` 白名单（`set_config_values` 也按同一白名单过滤，根本写不进去），
   于是旧库里残留的地址与密钥在迁移时被静默丢弃，落成空地址 Provider。
2. 「已存在任意 Provider 就不再种入」的守卫让那条空 Provider 永远得不到修正，
   即使把读取修对了也没用 —— 所以迁移必须先检查并补齐空字段。

同时确认补齐只填空值：不覆盖管理员手填的地址，也不丢环境变量兜底。
"""
import pytest

from app.config import settings
from app.database import SessionLocal
from app.models import AppConfig, LlmModelProvider, LlmProvider
from app.services.runtime_config import _seed_providers_from_legacy

PROV_ID = "prov_migrated_main"
LEGACY_ROWS = ("llm_base_url", "llm_api_key")
LEGACY_MODELS = "openrouter/legacy/test-model"


def _seed_legacy_rows(db, values: dict) -> None:
    """直接写 AppConfig 行。

    不能走 set_config_values：它按 CONFIG_KEYS 白名单过滤，而 llm_base_url /
    llm_api_key 早已不在白名单里，写不进去。这里模拟的是历史遗留行。
    """
    for key, value in values.items():
        row = db.get(AppConfig, key)
        if row is None:
            db.add(AppConfig(key=key, value=value))
        else:
            row.value = value
    db.commit()


def _snapshot(db):
    """记录 provider 全量状态与旧配置行，测试后原样还原。"""
    providers = [
        {
            "id": p.id,
            "name": p.name,
            "base_url": p.base_url,
            "api_key": p.api_key,
            "enabled": p.enabled,
        }
        for p in db.query(LlmProvider).all()
    ]
    bindings = [
        (b.model_id, b.provider_id, b.priority, b.provider_model_id)
        for b in db.query(LlmModelProvider).all()
    ]
    legacy = {}
    for key in LEGACY_ROWS:
        row = db.get(AppConfig, key)
        legacy[key] = (row is not None, row.value if row is not None else "")
    return providers, bindings, legacy


def _purge_providers(db) -> None:
    db.query(LlmModelProvider).delete()
    db.query(LlmProvider).delete()
    db.commit()


def _restore(db, snapshot):
    providers, bindings, legacy = snapshot
    db.rollback()  # 清掉上一个用例可能残留的未提交状态
    # 先清空两张表再按快照重建：测试中可能新增过绑定，残留会让 INSERT 撞主键
    db.query(LlmModelProvider).delete()
    db.query(LlmProvider).delete()
    db.commit()
    for row in providers:
        db.add(LlmProvider(**row))
    # provider 必须先落库：绑定表的 provider_id 是外键，SQLAlchemy 只按表间依赖排序，
    # 它并不知道绑定对象是否引用了同一次 flush 里尚未写入的 provider
    db.flush()
    for binding in bindings:
        db.add(
            LlmModelProvider(
                model_id=binding[0],
                provider_id=binding[1],
                priority=binding[2],
                provider_model_id=binding[3],
            )
        )
    db.commit()
    for key, (existed, value) in legacy.items():
        row = db.get(AppConfig, key)
        if not existed:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            db.add(AppConfig(key=key, value=value))
        else:
            row.value = value
    db.commit()


@pytest.fixture
def isolated_providers():
    """清空 provider 表并允许写旧配置行，结束（含失败）后原样还原。

    隔离是必须的：迁移靠「providers 表为空」触发，共享库里已有的 provider 会让它直接返回。
    """
    db = SessionLocal()
    snapshot = _snapshot(db)
    try:
        _purge_providers(db)
        yield db
    finally:
        _restore(db, snapshot)
        db.close()


def test_boot_migration_reads_legacy_keys_from_database(isolated_providers):
    """旧库残留的地址与密钥必须被迁移进来，不能落成空 Provider。"""
    db = isolated_providers
    _seed_legacy_rows(db, {"llm_base_url": "https://legacy.example.com", "llm_api_key": "sk-legacy-db"})
    # 旧版逗号分隔格式：迁移要把它升级成结构化模型并全量绑定
    row = db.get(AppConfig, "models")
    if row is None:
        db.add(AppConfig(key="models", value=LEGACY_MODELS))
    else:
        row.value = LEGACY_MODELS
    db.commit()

    _seed_providers_from_legacy(db)

    prov = db.get(LlmProvider, PROV_ID)
    assert prov is not None, "providers 表为空时必须自动迁移出首个 Provider"
    assert prov.base_url == "https://legacy.example.com"
    assert prov.api_key == "sk-legacy-db"
    assert db.get(LlmModelProvider, (LEGACY_MODELS, PROV_ID)) is not None


def test_boot_migration_repairs_empty_migrated_provider(isolated_providers):
    """旧版迁移留下的空地址 Provider：下次启动必须补齐，而不是被守卫挡掉。"""
    db = isolated_providers
    db.add(LlmProvider(id=PROV_ID, name="主服务（自动迁移）", base_url="", api_key="", enabled=True))
    db.commit()
    _seed_legacy_rows(db, {"llm_base_url": "https://legacy.example.com", "llm_api_key": "sk-legacy-db"})

    _seed_providers_from_legacy(db)

    db.expire_all()
    prov = db.get(LlmProvider, PROV_ID)
    assert prov.base_url == "https://legacy.example.com"
    assert prov.api_key == "sk-legacy-db"


def test_boot_migration_never_overwrites_filled_provider(isolated_providers):
    """管理员已在后台手填过地址时，补齐分支不得覆盖它。"""
    db = isolated_providers
    db.add(
        LlmProvider(
            id=PROV_ID,
            name="主服务（自动迁移）",
            base_url="https://filled-by-admin.example.com",
            api_key="sk-admin",
            enabled=True,
        )
    )
    db.commit()
    _seed_legacy_rows(db, {"llm_base_url": "https://legacy.example.com", "llm_api_key": "sk-legacy-db"})

    _seed_providers_from_legacy(db)

    db.expire_all()
    prov = db.get(LlmProvider, PROV_ID)
    assert prov.base_url == "https://filled-by-admin.example.com"
    assert prov.api_key == "sk-admin"


def test_boot_migration_falls_back_to_env_when_db_keys_absent(isolated_providers, monkeypatch):
    """库里没有旧键时按环境配置兜底 —— 这才是旧部署最常见的形态（旧键一直只由 .env 提供）。"""
    monkeypatch.setattr(settings, "llm_base_url", "https://env.example.com")
    db = isolated_providers
    # 库里必须没有旧键，才能验证走的是环境兜底
    for key in LEGACY_ROWS:
        row = db.get(AppConfig, key)
        if row is not None:
            db.delete(row)
    row = db.get(AppConfig, "models")
    if row is None:
        db.add(AppConfig(key="models", value=LEGACY_MODELS))
    else:
        row.value = LEGACY_MODELS
    db.commit()

    _seed_providers_from_legacy(db)

    prov = db.get(LlmProvider, PROV_ID)
    assert prov is not None
    assert prov.base_url == "https://env.example.com"
