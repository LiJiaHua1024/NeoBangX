"""试卷并发配置：旧配置继承默认，模型覆盖独立，管理 API 严格校验。"""
from fastapi.testclient import TestClient

from app.admin_main import app
from app.database import SessionLocal
from app.services.runtime_config import (
    get_config_map, parse_models, resolve_llm_settings, set_config_values, visual_concurrency_for,
)


def test_legacy_models_inherit_and_bad_stored_values_fall_back():
    models = parse_models('model-a,model-b')
    assert all(m["visual_paper_concurrency"] is None for m in models)
    cfg = {"models": [{"id": "custom", "visual_paper_concurrency": 5}, {"id": "default"}], "visual_paper_concurrency": 7}
    assert visual_concurrency_for(cfg, "custom") == 5
    assert visual_concurrency_for(cfg, "default") == 7
    assert visual_concurrency_for(cfg, "unknown") == 7
    for invalid in [0, -1, 17, True, "bad", 2.5]:
        cfg["visual_paper_concurrency"] = invalid
        cfg["models"][0]["visual_paper_concurrency"] = invalid
        assert visual_concurrency_for(cfg, "custom") == 3


def test_admin_concurrency_config_roundtrip_and_validation():
    client = TestClient(app)
    with SessionLocal() as db:
        old = get_config_map(db)
        try:
            for invalid in [0, -1, 17, True, "4", 2.5]:
                assert client.put("/api/admin/config", json={"visual_paper_concurrency": invalid}).status_code == 422
                assert client.put("/api/admin/config", json={"models": [{"id": "test", "visual_paper_concurrency": invalid}]}).status_code == 422
            # 保留原有模型选择，避免变更默认/辅助模型带来的校验与此测试无关。
            models = parse_models(old["models"])
            assert models
            models[0]["visual_paper_concurrency"] = 5
            response = client.put("/api/admin/config", json={"visual_paper_concurrency": 8, "models": models})
            assert response.status_code == 200, response.text
            cfg = resolve_llm_settings(db)
            model_id = models[0]["id"]
            assert visual_concurrency_for(cfg, model_id) == 5
            returned = client.get("/api/admin/config").json()["config"]
            assert int(returned["visual_paper_concurrency"]) == 8
            assert returned["models"][0]["visual_paper_concurrency"] == 5
            models[0]["visual_paper_concurrency"] = None
            assert client.put("/api/admin/config", json={"models": models}).status_code == 200
            assert visual_concurrency_for(resolve_llm_settings(db), model_id) == 8
            # 请求的配置快照不受之后管理员修改影响。
            assert visual_concurrency_for(cfg, model_id) == 5
        finally:
            set_config_values(db, old)
