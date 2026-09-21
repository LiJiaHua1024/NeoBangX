"""静态资源压缩与缓存头中间件测试。

覆盖：brotli/gzip 协商、Cache-Control 三档策略、etag 304 透传、
Range 透传、API 路径不受影响。注意 httpx 会按 Content-Encoding
自动解码，故断言压缩效果时看响应头，断言内容时直接读正文。
"""

import pytest
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.main import app as main_app


@pytest.fixture(params=["main", "admin"])
def client(request):
    return TestClient(main_app if request.param == "main" else admin_app)


def test_static_versioned_asset_is_immutable_and_compressed(client):
    r = client.get("/static/click-fx.js?v=fx260920f")
    assert r.status_code == 200
    assert "immutable" in r.headers["cache-control"]
    assert "max-age=31536000" in r.headers["cache-control"]
    assert r.headers["vary"] == "accept-encoding"
    # TestClient 的 httpx 默认接受 br；未装 brotli 时退化为 gzip
    assert r.headers["content-encoding"] in ("br", "gzip")
    assert len(r.content) > 0
    assert "etag" in r.headers  # 上游 etag 原样保留，条件请求仍可 304


def test_static_without_query_uses_short_cache(client):
    # click-fx.js 不带 ?v= 请求：短缓存 + 后台重验证（兜底未版本化引用）
    r = client.get("/static/click-fx.js")
    assert r.status_code == 200
    cc = r.headers["cache-control"]
    assert "max-age=3600" in cc
    assert "stale-while-revalidate=86400" in cc
    assert "immutable" not in cc


def test_index_html_is_no_cache(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_etag_revalidation_still_returns_304(client):
    r = client.get("/static/click-fx.js?v=fx260920f")
    etag = r.headers["etag"]
    r2 = client.get("/static/click-fx.js?v=fx260920f", headers={"if-none-match": etag})
    assert r2.status_code == 304
    # 304 也要带缓存头，浏览器据此延续新鲜期
    assert "immutable" in r2.headers["cache-control"]


def test_range_request_passes_through(client):
    r = client.get("/static/click-fx.js", headers={"range": "bytes=0-99"})
    assert r.status_code == 206
    assert "content-encoding" not in r.headers


def test_api_paths_untouched(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert "cache-control" not in r.headers


def test_identity_client_gets_uncompressed(client):
    r = client.get("/static/click-fx.js?v=fx260920f", headers={"accept-encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert r.headers["cache-control"].startswith("public")


def test_gzip_negotiation_returns_gzip_body(client):
    r = client.get("/static/click-fx.js?v=fx260920f", headers={"accept-encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip"
    # httpx 已自动解码，内容应与磁盘文件一致
    from pathlib import Path

    static = Path(settings_static_dir())
    raw = (static / "click-fx.js").read_bytes()
    assert r.content == raw


def settings_static_dir() -> str:
    from app.config import settings

    return str(settings.static_dir)
