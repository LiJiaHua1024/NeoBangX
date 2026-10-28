"""令牌身份绑定：使用码删除后 SQLite 复用的 rowid 不能把旧令牌交给后来者。

`usage_codes.id` 曾经是没有 AUTOINCREMENT 的 rowid：删掉最大的码再新建，
新码会拿到同一个 id，于是已删除使用码的长效令牌直接变成新用户的令牌。
这里既验证数据库层的"id 不复用"，也验证令牌自带的 `code` 值被真正比对。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.agent_workspace import api
from app.config import settings
from app.database import SessionLocal
from app.models import UsageCode
from app.services.usage_code import (
    get_active_code_from_token,
    issue_token,
    resolve_code_lenient,
)


@pytest.fixture
def workspace(workspace_code):
    app = FastAPI()
    app.include_router(api.router)
    return workspace_code, app


def _reuse_rowid(old_id: int, new_id: int) -> None:
    """让 new_id 这一行占住 old_id，模拟没有 AUTOINCREMENT 时的 rowid 复用。"""
    with SessionLocal() as db:
        db.execute(text("UPDATE usage_codes SET id=:old WHERE id=:new"), {"old": old_id, "new": new_id})
        db.commit()


def _code_value(code_id: int) -> str:
    with SessionLocal() as db:
        return db.get(UsageCode, code_id).code


def _client(app: FastAPI, token: str) -> TestClient:
    return TestClient(app, headers={"Authorization": "Bearer " + token})


def test_usage_code_table_never_reuses_rowids():
    with SessionLocal() as db:
        ddl = db.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='usage_codes'")
        ).scalar()
    assert ddl and "AUTOINCREMENT" in ddl.upper(), ddl


def test_deleted_code_token_is_rejected_when_its_rowid_is_reused(workspace):
    workspace_code, app = workspace
    stale_id, stale_token = workspace_code("STALE-", quota=10)
    with SessionLocal() as db:
        db.execute(text("DELETE FROM usage_codes WHERE id=:i"), {"i": stale_id})
        db.commit()
    victim_id, victim_token = workspace_code("VICTIM-", quota=10)
    _reuse_rowid(stale_id, victim_id)

    assert _client(app, stale_token).get("/api/workspace/tasks").status_code == 401
    assert _client(app, stale_token).get("/api/workspace/catalog").status_code == 401

    ok = _client(app, victim_token).get("/api/workspace/catalog")
    assert ok.status_code == 200, ok.text
    assert ok.json()["user"]["id"] == stale_id  # 复用后的 rowid 属于受害者自己


def test_main_site_resolvers_reject_reused_rowids(workspace):
    workspace_code, _ = workspace
    stale_id, stale_token = workspace_code("STALE-", quota=10)
    with SessionLocal() as db:
        db.execute(text("DELETE FROM usage_codes WHERE id=:i"), {"i": stale_id})
        db.commit()
    victim_id, victim_token = workspace_code("VICTIM-", quota=10)
    victim_code_value = _code_value(victim_id)
    _reuse_rowid(stale_id, victim_id)

    with SessionLocal() as db:
        with pytest.raises(HTTPException) as exc:
            get_active_code_from_token(db, stale_token)
        assert exc.value.status_code == 401
        assert resolve_code_lenient(db, stale_token) == (None, "unknown")

        row = get_active_code_from_token(db, victim_token)
        assert row.id == stale_id and row.code == victim_code_value
        assert resolve_code_lenient(db, victim_token)[0].id == stale_id


def test_token_without_code_claim_falls_back_to_row_id(workspace):
    """历史令牌只带 `sub`：没有码值可比时仍按 rowid 放行，不制造重新登录。"""
    workspace_code, app = workspace
    code_id, _ = workspace_code("LEGACY-", quota=10)
    payload = {"sub": str(code_id), "exp": datetime.now(timezone.utc) + timedelta(days=1)}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    assert _client(app, token).get("/api/workspace/catalog").status_code == 200
    with SessionLocal() as db:
        assert get_active_code_from_token(db, token).id == code_id
        assert resolve_code_lenient(db, token)[0].id == code_id


def test_issued_token_carries_the_code_value(workspace):
    """严格校验的前提：签发时一定带 `code`，所以现存令牌都不必重新登录。"""
    workspace_code, _ = workspace
    code_id, token = workspace_code("ISSUED-", quota=10)
    code_value = _code_value(code_id)
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    assert payload["sub"] == str(code_id)
    assert payload["code"] == code_value


def test_workspace_rejects_token_without_subject(workspace):
    """没有 `sub` 的令牌不是工作台签发的凭证：即使 `code` 有效也不放行。"""
    workspace_code, app = workspace
    code_id, _ = workspace_code("NOSUB-", quota=10)
    payload = {"code": _code_value(code_id), "exp": datetime.now(timezone.utc) + timedelta(days=1)}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    assert _client(app, token).get("/api/workspace/catalog").status_code == 401
