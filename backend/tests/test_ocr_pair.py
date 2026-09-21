"""扫码配对会话（/api/ocr/pair）的回归测试。

覆盖：建会话的使用码门禁、主题白名单、手机报到与上传、状态 SSE 只推状态不收尾、
原图字节直出、非图片/空文件拒绝、过期与释放后的 404。
"""
import asyncio
import base64
import json
from time import monotonic
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import deps
from app.database import SessionLocal
from app.main import app
from app.models import UsageCode
from app.routers import ocr as ocr_router

JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x11" * 128


def _make_code():
    db = SessionLocal()
    try:
        row = UsageCode(
            code=f"NBXU-PAIR-{uuid4().hex[:12].upper()}",
            quota=5,
            used_count=0,
            is_enabled=True,
            note="扫码配对测试",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        db.expunge(row)
        return row
    finally:
        db.close()


def _as_code(code):
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(code=code)


def _as_anonymous():
    app.dependency_overrides[deps.get_code_context] = lambda: deps.CodeContext(
        code=None, reason="missing"
    )


@pytest.fixture(autouse=True)
def clean_sessions():
    """每个用例从干净状态开始：会话与限流计数都不共享（限流按 IP 计数，会跨用例累计）。"""
    from app.services.rate_limit import _buckets

    ocr_router._sessions.clear()
    _buckets.clear()
    yield
    ocr_router._sessions.clear()
    _buckets.clear()


def _create(client) -> dict:
    response = client.post("/api/ocr/pair")
    assert response.status_code == 200, response.text
    return response.json()


def test_pair_create_requires_code():
    _as_anonymous()
    response = TestClient(app).post("/api/ocr/pair")
    assert response.status_code == 401
    assert "使用码" in response.json()["detail"]


def test_pair_create_returns_relative_path():
    """只回相对路径：绝对地址由前端用 location.origin 拼，避免反代下判错 scheme/host。"""
    _as_code(_make_code())
    data = _create(TestClient(app))
    assert data["path"].startswith(f"/m/upload?token={data['token']}")
    assert data["expires_in"] > 0
    assert data["max_images"] >= 8


def test_pair_defaults_to_site_default_theme():
    """不带主题（老客户端或手写请求）时落默认主题，且默认值与主站一致。"""
    _as_code(_make_code())
    client = TestClient(app)
    data = _create(client)
    assert f"theme={ocr_router.DEFAULT_MOBILE_THEME}" in data["path"]

    hello = client.post(f"/api/ocr/pair/{data['token']}/hello").json()
    assert hello["theme"] == ocr_router.DEFAULT_MOBILE_THEME
    assert hello["sky"] == ""


def test_pair_carries_desktop_theme_to_mobile():
    """手机页的配色来自电脑端：建会话时带过来，手机报到时取回。"""
    _as_code(_make_code())
    client = TestClient(app)

    jade = client.post("/api/ocr/pair", json={"theme": "jade"}).json()
    assert "theme=jade" in jade["path"]
    hello = client.post(f"/api/ocr/pair/{jade['token']}/hello").json()
    assert hello["theme"] == "jade"
    # 非悠空主题不带天空时段，免得把 day/night 跟着带进别的主题
    assert hello["sky"] == ""

    night = client.post("/api/ocr/pair", json={"theme": "sora", "sky": "night"}).json()
    assert "theme=sora" in night["path"]
    hello = client.post(f"/api/ocr/pair/{night['token']}/hello").json()
    assert (hello["theme"], hello["sky"]) == ("sora", "night")


def test_pair_rejects_unknown_theme_values():
    """主题来自请求体，是用户可控输入：白名单之外一律退回默认，绝不原样回给手机页。"""
    _as_code(_make_code())
    client = TestClient(app)

    weird = client.post("/api/ocr/pair", json={"theme": "<script>", "sky": "dusk"}).json()
    assert f"theme={ocr_router.DEFAULT_MOBILE_THEME}" in weird["path"]
    hello = client.post(f"/api/ocr/pair/{weird['token']}/hello").json()
    assert hello["theme"] == ocr_router.DEFAULT_MOBILE_THEME
    assert hello["sky"] == ""
    assert ocr_router.normalize_mobile_theme(None) == ocr_router.DEFAULT_MOBILE_THEME
    assert ocr_router.normalize_mobile_theme("  SORA ") == "sora"
    # 悠空只在 day/night 两段天空里选，别的值当作没给
    assert ocr_router.normalize_mobile_sky("sora", "noon") == ""
    assert ocr_router.normalize_mobile_sky("jade", "night") == ""


def test_mobile_theme_whitelist_matches_frontend():
    """手机页主题白名单必须跟着主站 THEMES 走：三处（主站/手机页/后端）散开就会走神。"""
    import re
    from pathlib import Path

    script = (Path(__file__).resolve().parents[2] / "frontend" / "script.js").read_text(encoding="utf-8")
    block = re.search(r"const THEMES = \[(.*?)\];", script, re.S)
    assert block, "script.js 里应有 THEMES 定义"
    ids = re.findall(r'id:\s*"([a-z]+)"', block.group(1))
    assert list(ocr_router.MOBILE_THEMES) == ids
    assert ocr_router.DEFAULT_MOBILE_THEME in ids


def test_pair_lifecycle_and_state_events():
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]

    assert client.post(f"/api/ocr/pair/{token}/hello").status_code == 200

    for _ in range(2):
        uploaded = client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": ("page.jpg", JPEG_BYTES, "image/jpeg")},
        )
        assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["count"] == 2

    first = client.get(f"/api/ocr/pair/{token}/image", params={"i": 0})
    assert first.status_code == 200
    assert first.content == JPEG_BYTES
    assert first.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/ocr/pair/{token}/image", params={"i": 5}).status_code == 404

    assert client.delete(f"/api/ocr/pair/{token}").status_code == 200
    assert client.get(f"/api/ocr/pair/{token}/image").status_code == 404


def test_pair_events_push_state_until_expired(monkeypatch):
    """SSE 只推状态、不推终态：手机拍多少张就收多少张，收尾只有过期这一条路。

    走 body_iterator 直接读帧（无限流不能交给 TestClient，那会让请求永远挂住）。"""
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]
    assert client.post(f"/api/ocr/pair/{token}/hello").status_code == 200
    for _ in range(2):
        assert client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": ("page.jpg", JPEG_BYTES, "image/jpeg")},
        ).status_code == 200

    async def read_frames(count: int, ttl_after_open: int | None = None) -> list[dict]:
        # 先把生成器拿到手（这时会话还没过期），再改 TTL，让它从下一轮起就算过期
        response = await ocr_router.pair_events(token)
        if ttl_after_open is not None:
            monkeypatch.setattr(ocr_router, "PAIR_TTL_SECONDS", ttl_after_open)
        frames: list[dict] = []
        async for frame in response.body_iterator:
            frames.append(frame)
            if len(frames) >= count:
                break
        aclose = getattr(response.body_iterator, "aclose", None)
        if aclose is not None:
            await aclose()
        return frames

    first = asyncio.run(read_frames(1))[0]
    assert first["event"] == "state"
    payload = json.loads(first["data"])
    assert payload["count"] == 2
    assert payload["state"] == "connected"
    assert "finished" not in payload

    # 会话过期：推一帧 error 说明原因，然后收尾
    frames = asyncio.run(read_frames(2, ttl_after_open=0))
    assert frames[-1]["event"] == "error"
    assert "过期" in json.loads(frames[-1]["data"])["message"]


def test_pair_rejects_non_image_and_empty_uploads():
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]

    # 声明的类型不在白名单
    pdf = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert pdf.status_code == 400
    assert "JPG" in pdf.json()["detail"]

    # 声明 image/jpeg 但内容不是图片：魔数嗅探挡下
    fake = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("a.jpg", b"not an image at all", "image/jpeg")},
    )
    assert fake.status_code == 400

    empty = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("a.jpg", b"", "image/jpeg")},
    )
    assert empty.status_code == 400
    assert "空" in empty.json()["detail"]


def test_pair_finish_endpoint_is_gone():
    """手机端不再有「我拍完了」这个动作（配对靠第一张照片就成立）：
    端点一并删掉，免得留着让人以为它还有用。"""
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]
    uploaded = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("page.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert uploaded.status_code == 200
    assert client.post(f"/api/ocr/pair/{token}/finish").status_code == 404


def test_pair_snapshot_has_no_terminal_state():
    """状态里没有「拍完了」：会话要到释放或过期才结束，期间照片收多少算多少。"""
    session = ocr_router.PairSession(token="t", created=monotonic())
    snapshot = session.snapshot()
    assert snapshot["state"] == "waiting"
    assert snapshot["count"] == 0
    assert "finished" not in snapshot
    session.helloed = True
    assert session.snapshot()["state"] == "connected"


def test_pair_expired_session_is_gone():
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]

    ocr_router._sessions[token].created = monotonic() - (ocr_router.PAIR_TTL_SECONDS + 1)
    assert client.get(f"/api/ocr/pair/{token}/image").status_code == 404
    assert client.post(f"/api/ocr/pair/{token}/hello").status_code == 404
    assert ocr_router._sessions == {}


def test_pair_upload_capped():
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]

    for _ in range(ocr_router.PAIR_MAX_IMAGES):
        assert client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": ("page.jpg", JPEG_BYTES, "image/jpeg")},
        ).status_code == 200
    over = client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("page.jpg", JPEG_BYTES, "image/jpeg")},
    )
    assert over.status_code == 400
    assert "最多" in over.json()["detail"]


def test_pair_image_data_urls_helper():
    """chat 的 OCR 分支直接用这个助手把会话图片变成 data URL。"""
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]

    with pytest.raises(Exception):
        ocr_router.pair_image_data_urls(token)  # 还没有照片

    for index in (1, 2, 3):
        client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": (f"{index}.jpg", JPEG_BYTES + bytes([index]), "image/jpeg")},
        )
    urls = ocr_router.pair_image_data_urls(token)
    assert len(urls) == 3
    assert urls[0].startswith("data:image/jpeg;base64,")
    assert base64.b64decode(urls[0].split(",", 1)[1]) == JPEG_BYTES + b"\x01"


def test_pair_image_order_follows_indexes():
    """电脑端排序/删除后只传下标序列：顺序按序列走，删掉的不再出现，字节不重传。"""
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]
    for index in (1, 2, 3):
        client.post(
            f"/api/ocr/pair/{token}/upload",
            files={"file": (f"{index}.jpg", JPEG_BYTES + bytes([index]), "image/jpeg")},
        )

    reordered = ocr_router.pair_image_data_urls(token, [2, 0])
    assert [base64.b64decode(u.split(",", 1)[1])[-1] for u in reordered] == [3, 1]


def test_pair_image_order_rejects_bad_indexes():
    _as_code(_make_code())
    client = TestClient(app)
    token = _create(client)["token"]
    client.post(
        f"/api/ocr/pair/{token}/upload",
        files={"file": ("1.jpg", JPEG_BYTES, "image/jpeg")},
    )
    for bad in ([5], [-1]):
        with pytest.raises(Exception):
            ocr_router.pair_image_data_urls(token, bad)
