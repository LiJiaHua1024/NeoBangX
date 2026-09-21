"""扫码配对：手机拍照 → 直传服务器 → 电脑端取走。

图片不落盘、不经电脑转手：手机只上传一次，电脑端预览直接读服务器内存里的同一份字节，
OCR 请求只带 token（见 routers/chat.py 的 OCR 分支），因此一张照片最多过网两次
（上行一次、电脑端预览下行一次），而不是 base64 来回传三趟。

会话存进程内字典，与停止事件、限流计数一样依赖主站单进程部署（supervisord 起的是
单个 uvicorn，无 --workers）；多 worker 部署需要换成共享存储，属已知限制。
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import secrets
from dataclasses import dataclass, field
from time import monotonic
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.deps import CodeContext, get_code_context
from app.services.free_access import identity_key
from app.services.rate_limit import enforce_rate_limit
from app.services.request_log import get_client_info, get_fingerprint_info

router = APIRouter(prefix="/api/ocr", tags=["ocr"])
logger = logging.getLogger(__name__)

PAIR_TTL_SECONDS = 15 * 60
PAIR_MAX_IMAGES = 12
PAIR_MAX_IMAGE_BYTES = 12 * 1024 * 1024
MOBILE_PAGE_PATH = "/m/upload"

# 手机页沿用的主题：与前端 THEMES（frontend/script.js）保持一致。
# 手机页靠它把自己染成电脑端当前的配色，所以未知值一律退回默认，绝不把用户串当主题用。
MOBILE_THEMES = ("paper", "celadon", "obsidian", "jade", "sora")
DEFAULT_MOBILE_THEME = "paper"
MOBILE_SKIES = ("day", "night")

# 允许的图片类型：键是规范 mime，值是上传时可能出现的别名
_IMAGE_MIME_ALIASES = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
}
# 魔数嗅探：不信任声明的 Content-Type，以字节为准（同时挡住「假图片」的文件中继）
_IMAGE_SIGNATURES = (
    ("image/jpeg", b"\xff\xd8\xff"),
    ("image/png", b"\x89PNG\r\n\x1a\n"),
)


def sniff_image_mime(data: bytes) -> Optional[str]:
    """按字节头判断图片类型，识别不了返回 None（webp 需要看 RIFF....WEBP 结构）。"""
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for mime, signature in _IMAGE_SIGNATURES:
        if data.startswith(signature):
            return mime
    return None


def normalize_image_mime(raw: str) -> Optional[str]:
    """把上传声明或 data URL 前缀里的类型归一成规范 mime，不支持则 None。"""
    return _IMAGE_MIME_ALIASES.get((raw or "").strip().lower())


@dataclass
class PairSession:
    """一次配对：一个 token 对应一批手机上传的照片。

    没有「拍完了」这种状态：手机端只管拍与传，收到第一张照片电脑端就收起配对窗口，
    之后还传多少张、什么时候开始识别，全由电脑端决定。
    """

    token: str
    created: float
    helloed: bool = False
    theme: str = DEFAULT_MOBILE_THEME
    sky: str = ""
    images: list[tuple[str, bytes]] = field(default_factory=list)
    event: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def expired(self) -> bool:
        return monotonic() - self.created > PAIR_TTL_SECONDS

    @property
    def expires_in(self) -> int:
        return max(0, int(PAIR_TTL_SECONDS - (monotonic() - self.created)))

    def snapshot(self) -> dict:
        return {
            "state": "connected" if self.helloed else "waiting",
            "count": len(self.images),
            "expires_in": self.expires_in,
        }


_sessions: dict[str, PairSession] = {}


def _sweep() -> None:
    """丢掉过期会话：手机端断网后不会有人来收尾，只能靠随手清理。"""
    for token in [t for t, s in _sessions.items() if s.expired]:
        _sessions.pop(token, None)


def _require(token: str) -> PairSession:
    _sweep()
    session = _sessions.get(token)
    if session is None:
        raise HTTPException(status_code=404, detail="配对已失效或已过期，请重新扫码")
    return session


def pair_image_data_urls(token: str, order: Optional[list[int]] = None) -> list[str]:
    """取配对会话里的图片（data URL 列表），供 OCR 分支替代请求体里的 base64。

    order 是电脑端排好序、并可能删过几张之后的下标序列：像素始终留在会话里，
    重排与删除只改这个序列，不重传字节（手机拍的照片永远只上传一次）。
    不传 order 就按手机上传的顺序。
    """
    session = _require(token)
    if not session.images:
        raise HTTPException(status_code=409, detail="手机还没上传照片，请先拍完再识别")
    indexes = list(order) if order else list(range(len(session.images)))
    picked: list[str] = []
    for index in indexes:
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(session.images):
            raise HTTPException(status_code=400, detail="图片顺序参数不合法，请重新选择图片")
        mime, data = session.images[index]
        picked.append(f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}")
    return picked


def _identity(request: Request, ctx: CodeContext) -> str:
    fp_hash, _ = get_fingerprint_info(request)
    client_ip, _ = get_client_info(request)
    return identity_key(code_id=ctx.code.id if ctx.code else None, fingerprint=fp_hash, ip=client_ip)


class PairCreateResponse(BaseModel):
    token: str
    path: str
    expires_in: int
    max_images: int


class PairCreateRequest(BaseModel):
    """电脑端建会话时可选带上自己的当前配色，手机页据此渲染成同一套主题。"""

    theme: Optional[str] = None
    sky: Optional[str] = None


def normalize_mobile_theme(theme: Optional[str]) -> str:
    value = (theme or "").strip().lower()
    return value if value in MOBILE_THEMES else DEFAULT_MOBILE_THEME


def normalize_mobile_sky(theme: str, sky: Optional[str]) -> str:
    """只有悠空分昼夜；其余主题不带天空时段，免得把 day/night 跟着带进别的主题。"""
    value = (sky or "").strip().lower()
    if theme != "sora" or value not in MOBILE_SKIES:
        return ""
    return value


@router.post("/pair", response_model=PairCreateResponse)
async def create_pair(
    request: Request,
    ctx: Annotated[CodeContext, Depends(get_code_context)],
    payload: Optional[PairCreateRequest] = None,
):
    """建一个配对会话。需要有效使用码：扫码只是免去在电脑上传图，不是匿名入口。"""
    if not ctx.ok:
        raise ctx.error()
    enforce_rate_limit(_identity(request, ctx), "ocr_pair")
    _sweep()
    token = secrets.token_urlsafe(16)
    theme = normalize_mobile_theme(payload.theme if payload else None)
    _sessions[token] = PairSession(
        token=token,
        created=monotonic(),
        theme=theme,
        sky=normalize_mobile_sky(theme, payload.sky if payload else None),
    )
    # 只回相对路径：绝对地址由前端用 location.origin 拼，避免反代下判错 scheme/host
    return PairCreateResponse(
        token=token,
        path=f"{MOBILE_PAGE_PATH}?token={token}&theme={theme}",
        expires_in=PAIR_TTL_SECONDS,
        max_images=PAIR_MAX_IMAGES,
    )


@router.post("/pair/{token}/hello")
async def pair_hello(token: str):
    """手机页打开时报到，电脑端据此把状态从「等待扫码」推进到「手机已连接」。

    顺带回传电脑端当前的配色，手机页用它上色（URL 里的 theme 只为首屏不闪，
    这里才是权威值：会话里记的才是电脑端真正在用的那套）。"""
    session = _require(token)
    session.helloed = True
    session.event.set()
    return {
        "ok": True,
        "count": len(session.images),
        "expires_in": session.expires_in,
        "theme": session.theme,
        "sky": session.sky,
    }


class PairUploadResponse(BaseModel):
    ok: bool
    count: int
    max_images: int


@router.post("/pair/{token}/upload", response_model=PairUploadResponse)
async def pair_upload(
    token: str,
    request: Request,
    file: UploadFile = File(...),
):
    """手机直传一张照片（图片应用已在前端压缩）。收到即在内存里排队，等待电脑端取走。"""
    session = _require(token)
    client_ip, _ = get_client_info(request)
    enforce_rate_limit(identity_key(ip=client_ip), "ocr_pair")
    if len(session.images) >= PAIR_MAX_IMAGES:
        raise HTTPException(
            status_code=400, detail=f"一次最多 {PAIR_MAX_IMAGES} 张，已经够了，请点「拍好了」"
        )
    declared = normalize_image_mime(file.content_type or "")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="这张照片是空的，请重新拍摄")
    if len(data) > PAIR_MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"这张照片超过 {PAIR_MAX_IMAGE_BYTES // 1024 // 1024}MB，请重新拍摄",
        )
    sniffed = sniff_image_mime(data)
    if sniffed is None or (declared and declared != sniffed):
        raise HTTPException(status_code=400, detail="只支持 JPG / PNG / WebP 照片")
    session.images.append((sniffed, data))
    session.event.set()
    logger.info("OCR pair upload: token=%s count=%s bytes=%s", token[:6], len(session.images), len(data))
    return PairUploadResponse(ok=True, count=len(session.images), max_images=PAIR_MAX_IMAGES)


@router.get("/pair/{token}/image")
async def pair_image(token: str, i: int = 0):
    """电脑端预览用：按索引返回原图字节（内存直出，nginx 可正常缓存这一段）。"""
    from fastapi import Response

    session = _require(token)
    if i < 0 or i >= len(session.images):
        raise HTTPException(status_code=404, detail="这张照片不存在")
    mime, data = session.images[i]
    return Response(
        content=data,
        media_type=mime,
        headers={"Cache-Control": "private, max-age=600"},
    )


@router.get("/pair/{token}/events")
async def pair_events(token: str):
    """电脑端 SSE：等待扫码 → 手机已连接 → 已收到 N 张（照片到达就推一帧）。

    没有终态：手机端不需要宣布「拍完了」，电脑端想收多少就收多少，
    直到自己不再需要（DELETE 释放）或会话过期。
    """
    session = _require(token)

    async def event_generator():
        yield {"event": "state", "data": json.dumps(session.snapshot(), ensure_ascii=False)}
        while True:
            if session.expired:
                yield {
                    "event": "error",
                    "data": json.dumps({"message": "配对已过期，请重新扫码"}, ensure_ascii=False),
                }
                return
            try:
                await asyncio.wait_for(session.event.wait(), timeout=20)
            except asyncio.TimeoutError:
                # 交给 sse-starlette 的 ping 维持连接，这里只是定期回头看有没有过期
                continue
            session.event.clear()
            yield {"event": "state", "data": json.dumps(session.snapshot(), ensure_ascii=False)}

    return EventSourceResponse(event_generator())


@router.delete("/pair/{token}")
async def drop_pair(token: str):
    """电脑端关闭弹窗：立刻释放内存里的照片。"""
    _sessions.pop(token, None)
    return {"ok": True}
