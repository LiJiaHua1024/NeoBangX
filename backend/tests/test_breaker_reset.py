"""熔断状态重置（管理后台「重置熔断」）的回归测试。"""
from fastapi.testclient import TestClient
from litellm import exceptions as litellm_exceptions

from app.admin_main import app as admin_app
from app.services import provider_health


def _gateway_error():
    """确定性瞬时的上游故障（只有这类失败才计入熔断，与 llm_router 的判定层一致）。"""
    return litellm_exceptions.BadGatewayError(
        message="bad gateway", llm_provider="openai", model="test-model"
    )


def _open(provider_id: str) -> None:
    provider_health.record_failure(provider_id, _gateway_error())
    provider_health.record_failure(provider_id, _gateway_error())


def test_reset_clears_breaker_state():
    """清空进程内健康记忆：管理员改好 Key / 换好地址后不必等冷却期（最长 5 分钟）。"""
    provider_health.reset_for_tests()
    _open("prov_reset_a")
    assert provider_health.is_open("prov_reset_a") is True

    cleared = provider_health.reset()

    assert cleared >= 1
    assert provider_health.is_open("prov_reset_a") is False, "重置后该家应立刻重新参与调度"


def test_reset_one_provider_only():
    provider_health.reset_for_tests()
    _open("prov_reset_b")
    _open("prov_reset_c")

    assert provider_health.reset("prov_reset_b") == 1

    assert provider_health.is_open("prov_reset_b") is False
    assert provider_health.is_open("prov_reset_c") is True, "只清指定的那一家"


def test_admin_reset_breakers_endpoint():
    provider_health.reset_for_tests()
    _open("prov_reset_d")

    resp = TestClient(admin_app).post("/api/admin/providers/reset-breakers")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["cleared"], int) and body["cleared"] >= 1
    assert provider_health.is_open("prov_reset_d") is False

