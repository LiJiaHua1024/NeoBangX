"""静态资源压缩与缓存头中间件测试。

覆盖：brotli/gzip 协商、Cache-Control 两档策略（版本化长缓存 / 未版本化 no-cache）、
etag 304 透传、Range 透传、API 路径不受影响、HTML 里的本地资源不带版本串。
注意 httpx 会按 Content-Encoding 自动解码，故断言压缩效果时看响应头，断言内容时直接读正文。
"""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.admin_main import app as admin_app
from app.config import settings
from app.main import app as main_app


@pytest.fixture(params=["main", "admin"])
def client(request):
    return TestClient(main_app if request.param == "main" else admin_app)


def test_local_assets_are_never_versioned():
    """HTML 里的本地静态资源不许带 ?v= 版本串。

    带 query 会被中间件当成「版本化资源」下发 immutable 长缓存：改了文件却忘了改
    版本串时浏览器会一直用旧代码，而 HTML 每次重验证 → 「新 HTML + 旧 JS/CSS」
    界面直接错乱，且手机端无法强退出缓存刷新（只能干等缓存过期）。不带版本串走
    no-cache + etag：文件变了下一次加载自动就是新的，没变则 304，几乎零成本。
    这条测试就是防它被谁加回来。
    """
    pages = [
        Path(settings.static_dir) / "index.html",
        Path(settings.static_dir) / "bridge.html",
        Path(settings.admin_static_dir) / "index.html",
    ]
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert not re.search(r"/static/[^\"\s>]+\?v=", html), f"{page} 的本地资源带了版本串"


def test_bridge_mirror_scripts_share_index_urls():
    """桥接页与主站必须引用同一份镜像模块 URL。

    两个页面用不同 URL（比如一边带 ?v=、一边不带）时浏览器会各缓存一份，更新后
    桥接页可能仍在跑旧版本，而镜像协议版本不匹配是**静默失效**（消息被忽略、没有报错）。
    两边都不带版本串，才能真正保证是同一份代码。

    主站已把镜像三件套移出首屏关键路径：index.html 不再直接引用，
    由 script.js 的 nbxEnsureMirrorAssets() 在启动后按需加载；桥接页仍然直接引用。
    """
    main_html = (Path(settings.static_dir) / "index.html").read_text(encoding="utf-8")
    main_js = (Path(settings.static_dir) / "script.js").read_text(encoding="utf-8")
    bridge_html = (Path(settings.static_dir) / "bridge.html").read_text(encoding="utf-8")
    assert "/static/nbx-mirror" not in main_html
    for name in ("nbx-mirror.js", "nbx-mirror-store.js", "nbx-mirror-peer.js"):
        url = f"/static/{name}"
        assert url in main_js
        assert f'src="{url}"' in bridge_html


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


def test_static_without_query_is_no_cache(client):
    # 未版本化的资源（无 ?v=）必须每次重验证：改了文件而 URL 不变时，
    # 长缓存会把旧代码钉在浏览器里，升级后出现「新 HTML + 旧 JS」的错配
    r = client.get("/static/click-fx.js")
    assert r.status_code == 200
    cc = r.headers["cache-control"]
    assert cc == "no-cache"
    assert "immutable" not in cc
    assert "etag" in r.headers  # 仍靠 etag 做条件请求，命中即 304


def test_index_html_is_no_cache(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"


def test_index_html_etag_revalidation_returns_304(client):
    """根路径也要支持条件请求。

    Starlette 的 FileResponse 不处理 If-None-Match，只有 StaticFiles 会；中间件
    必须替它补上，否则浏览器每次打开页面都会重新下载整页 HTML。
    """
    r = client.get("/")
    etag = r.headers["etag"]
    r2 = client.get("/", headers={"if-none-match": etag})
    assert r2.status_code == 304
    assert r2.headers["cache-control"] == "no-cache"
    assert r2.headers["etag"] == etag
    assert "content-encoding" not in r2.headers


def test_index_html_if_modified_since_returns_304(client):
    """CF 线的 HTML 没有 ETag，只剩 Last-Modified，必须也能命中 304。"""
    r = client.get("/")
    last_modified = r.headers["last-modified"]
    r2 = client.get("/", headers={"if-modified-since": last_modified})
    assert r2.status_code == 304
    assert r2.headers["cache-control"] == "no-cache"


def test_index_html_stale_etag_returns_full_body(client):
    r = client.get("/", headers={"if-none-match": '"stale-etag"'})
    assert r.status_code == 200
    assert len(r.content) > 0


def test_woff2_content_type_is_font():
    """Windows 的 mimetypes 会把 woff2 识别成 octet-stream，中间件要兜底成 font/woff2。"""
    client = TestClient(main_app)
    r = client.get("/static/vendor/katex-0.16.47/fonts/KaTeX_Main-Regular.woff2")
    assert r.status_code == 200
    assert r.headers["content-type"] == "font/woff2"


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


@pytest.mark.parametrize("header,enabled,expected", [
    ("gzip, deflate, br", True, "br"),
    ("gzip;q=1, br;q=0.5", True, "gzip"),
    ("gzip;q=0, br", False, ""),
    ("br", False, ""),
    ("gzip, br;q=0", True, "gzip"),
    ("identity", True, ""),
])
def test_encoding_preferences(header, enabled, expected, monkeypatch):
    from app import middleware

    monkeypatch.setattr(middleware, "_brotli", object())
    assert middleware._pick_encoding(
        [(b"accept-encoding", header.encode())], brotli=enabled,
    ) == expected


def test_prewarm_is_reused_and_changed_files_invalidate(tmp_path, monkeypatch):
    import threading
    from fastapi import FastAPI
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from app import middleware

    # 同步预热，避免测试与后台线程竞争；之后每次压缩都被计数。
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    raw = b"/* cached asset */\n" * 100
    asset = tmp_path / "index.html"
    asset.write_bytes(raw)
    app = FastAPI()
    app.mount("/static", StaticFiles(directory=tmp_path))

    @app.get("/")
    def index():
        return FileResponse(asset)

    wrapped = middleware.StaticCacheMiddleware(app, tmp_path, brotli=False)
    wrapped._prewarm()
    # TestClient 需要创建自己的线程，预热完成后恢复 start。
    monkeypatch.undo()
    original_compress = middleware._compress
    calls = []

    def compress(body, encoding, **kwargs):
        calls.append(body)
        return original_compress(body, encoding, **kwargs)

    monkeypatch.setattr(middleware, "_compress", compress)
    # 其它 app（main/admin）的预热线程可能仍在后台压缩真实资源，会污染全局
    # monkeypatch 的 calls。这里只关心本次 tmp 资源是否被重复压缩。
    updated = raw + b"updated"

    def is_tmp(body):
        return body == raw or body == updated

    with TestClient(wrapped) as local_client:
        for url in ("/", "/static/index.html", "/static/index.html?v=test"):
            response = local_client.get(url, headers={"accept-encoding": "gzip"})
            assert response.content == raw
            assert response.headers["content-encoding"] == "gzip"
        assert not any(is_tmp(c) for c in calls), "首请求必须复用预热字节，不能重新压缩"

        asset.write_bytes(updated)
        response = local_client.get("/static/index.html", headers={"accept-encoding": "gzip"})
        assert response.content == updated
        assert sum(1 for c in calls if c == updated) == 1
        assert local_client.get("/", headers={"accept-encoding": "gzip"}).content == updated
        assert sum(1 for c in calls if c == updated) == 1
