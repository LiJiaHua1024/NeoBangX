"""静态资源压缩与 HTTP 缓存头中间件。

纯 ASGI 实现（不继承 BaseHTTPMiddleware，避免每请求额外建 task 的开销），
只对 `/static/**` 与 `/`（index.html 入口）两类响应生效：

- 压缩：按 Accept-Encoding 优先 brotli 后退 gzip，对满足条件的 200 响应
  预压缩。压缩结果按 (路径, mtime_ns, size, 编码) 缓存在内存并受 LRU 上限
  约束，文件不变则零重复压缩 CPU；启动时后台线程预热全部可压缩资源。
- 缓存头：URL 带 query string（本项目全部 ?v= 版本化资源）→ immutable
  长缓存；不带 query → 短缓存 + stale-while-revalidate；`/` → no-cache。
- 透传：非 http scope、其它路径（API/SSE 绝不触碰）、非 200/304/206 状态、
  带 Range 的请求、HEAD、已带 Content-Encoding 或超出体积阈值的响应。

上游响应的 etag / last-modified 原样保留（Starlette 的 etag 由
mtime+size 派生），条件请求 304 语义不变；304 与 206 也会补上缓存头。
"""

import gzip
import os
import threading
from collections import OrderedDict
from typing import Optional, Tuple

try:  # brotli 为可选依赖，缺失时自动退化为仅 gzip
    import brotli as _brotli
except ImportError:  # pragma: no cover - 取决于部署环境
    _brotli = None

BROTLI_QUALITY = 5
GZIP_LEVEL = 6

# 小于该体积不压缩（压缩收益抵不上头部与 CPU 开销）
MIN_COMPRESS_SIZE = 512
# 超过该体积放弃压缩，避免单文件常驻内存过大
MAX_COMPRESS_SIZE = 8 * 1024 * 1024

# 可压缩的 Content-Type 前缀 / 全集（字体、图片等已压缩格式不在其列）
_COMPRESSIBLE_PREFIXES = ("text/",)
_COMPRESSIBLE_TYPES = frozenset(
    {
        "application/javascript",
        "application/x-javascript",
        "application/json",
        "image/svg+xml",
        "application/wasm",
    }
)

# 预压缩缓存的条目上限（本项目静态文件约 20 个，64 足够）
_CACHE_MAX_ENTRIES = 64


def _pick_encoding(headers) -> str:
    """从 ASGI headers 中读 Accept-Encoding 并挑选首选编码（br 优先、gzip 次之）。"""
    header = ""
    for k, v in headers:
        if k == b"accept-encoding":
            header = v.decode("latin-1")
            break
    if not header:
        return ""
    for part in header.split(","):
        fields = part.split(";")
        coding = fields[0].strip().lower()
        if coding not in ("br", "gzip"):
            continue
        q = 1.0
        for param in fields[1:]:
            param = param.strip()
            if param.startswith("q="):
                try:
                    q = float(param[2:])
                except ValueError:
                    q = 0.0
        if q <= 0:
            continue
        if coding == "br" and _brotli is not None:
            return "br"  # 客户端明确接受 br 且库可用
        if coding == "gzip":
            return "gzip"
    return ""


def _compress(body: bytes, encoding: str) -> bytes:
    if encoding == "br":
        # MODE_TEXT：本中间件只压缩文本类静态资源
        return _brotli.compress(body, mode=_brotli.MODE_TEXT, quality=BROTLI_QUALITY)
    return gzip.compress(body, compresslevel=GZIP_LEVEL)


class StaticCacheMiddleware:
    """见模块 docstring。构造参数与 settings.static_* 一一对应。"""

    def __init__(
        self,
        app,
        static_dir: os.PathLike | str,
        *,
        compress: bool = True,
        brotli: bool = True,
        max_age: int = 31536000,
        short_max_age: int = 3600,
    ) -> None:
        self.app = app
        self.static_dir = os.fspath(static_dir)
        self.compress = compress
        self.brotli = brotli and _brotli is not None
        self.max_age = max_age
        self.short_max_age = short_max_age
        self._cache: "OrderedDict[Tuple[str, int, int, str], bytes]" = OrderedDict()
        self._lock = threading.Lock()
        if self.compress:
            # 后台预热：首请求零压缩开销，线程挂了也不影响服务
            threading.Thread(target=self._prewarm, daemon=True).start()

    # ---------------- 内部工具 ----------------

    def _resolve_path(self, path: str) -> Optional[str]:
        """把 URL 路径映射到磁盘文件；仅限 /static/ 与 / 两类入口。"""
        if path == "/":
            rel = "index.html"
        elif path.startswith("/static/"):
            rel = path[len("/static/"):]
        else:
            return None
        # 阻断路径穿越（StaticFiles 自身也会拦，这里双保险）
        rel = os.path.normpath(rel).lstrip("\\/")
        if rel.startswith(".."):
            return None
        full = os.path.join(self.static_dir, *rel.split("/"))
        return full if os.path.isfile(full) else None

    def _cache_control(self, path: str, query: bytes) -> str:
        if path == "/":
            return "no-cache"  # HTML 入口每次重验证
        if query:
            # 带 ?v= 版本号：内容变则 URL 变，可无限期缓存
            return f"public, max-age={self.max_age}, immutable"
        # 未版本化的资源（如 thumbmark）：短缓存 + 后台重验证
        return f"public, max-age={self.short_max_age}, stale-while-revalidate=86400"

    def _cache_get(self, key: Tuple[str, int, int, str]) -> Optional[bytes]:
        with self._lock:
            data = self._cache.get(key)
            if data is not None:
                self._cache.move_to_end(key)
            return data

    def _cache_put(self, key: Tuple[str, int, int, str], data: bytes) -> None:
        with self._lock:
            self._cache[key] = data
            self._cache.move_to_end(key)
            while len(self._cache) > _CACHE_MAX_ENTRIES:
                self._cache.popitem(last=False)

    def _compressible_type(self, content_type: str) -> bool:
        ctype = content_type.split(";", 1)[0].strip().lower()
        return ctype.startswith(_COMPRESSIBLE_PREFIXES) or ctype in _COMPRESSIBLE_TYPES

    def _prewarm(self) -> None:
        """启动时把全部可压缩静态资源预先压缩入缓存。"""
        try:
            for root, _dirs, files in os.walk(self.static_dir):
                for name in files:
                    full = os.path.join(root, name)
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    if not (MIN_COMPRESS_SIZE <= st.st_size <= MAX_COMPRESS_SIZE):
                        continue
                    ext = os.path.splitext(name)[1].lower()
                    if ext not in (".js", ".css", ".html", ".svg", ".json", ".txt", ".map"):
                        continue
                    with open(full, "rb") as fh:
                        body = fh.read()
                    for enc in (("br",) if self.brotli else ()) + ("gzip",):
                        key = (os.path.relpath(full, self.static_dir).replace(os.sep, "/"), st.st_mtime_ns, st.st_size, enc)
                        self._cache_put(key, _compress(body, enc))
        except Exception:
            pass  # 预热失败不影响服务：请求路径会懒压缩兜底

    # ---------------- ASGI 入口 ----------------

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]
        is_static = path.startswith("/static/")
        is_root = path == "/"
        if not (is_static or is_root):
            await self.app(scope, receive, send)
            return

        method: str = scope.get("method", "GET")
        query: bytes = scope.get("query_string", b"") or b""
        cache_control = self._cache_control(path, query)

        encoding = ""
        if self.compress and method != "HEAD":
            encoding = _pick_encoding(scope.get("headers", []))
            if encoding == "br" and not self.brotli:
                encoding = "gzip"

        # 需要在 send_wrapper 闭包间共享的状态
        state = {
            "buffering": False,   # True = 暂存 body 等压缩
            "chunks": [],
            "start": None,        # 原始 http.response.start
            "done": False,
        }

        async def send_wrapper(message) -> None:
            if state["done"]:
                return
            mtype = message["type"]

            if mtype == "http.response.start":
                raw_headers = message.get("headers", [])
                status = message["status"]

                if status != 200:
                    # 非 200：原样透传，仅 304/206 补缓存头
                    headers = list(raw_headers)
                    if status in (304, 206):
                        headers.append((b"cache-control", cache_control.encode("latin-1")))
                    await send({"type": "http.response.start", "status": status, "headers": headers})
                    if status in (304, 204):
                        state["done"] = True
                        await send({"type": "http.response.body", "body": b"", "more_body": False})
                    return

                hdict = {}
                for k, v in raw_headers:
                    hdict.setdefault(k, []).append(v)
                ctype = ""
                for v in hdict.get(b"content-type", []):
                    ctype = v.decode("latin-1")
                    break
                raw_len = None
                for v in hdict.get(b"content-length", []):
                    try:
                        raw_len = int(v)
                    except ValueError:
                        raw_len = None
                    break

                can_compress = (
                    encoding
                    and b"content-encoding" not in hdict
                    and raw_len is not None
                    and MIN_COMPRESS_SIZE <= raw_len <= MAX_COMPRESS_SIZE
                    and self._compressible_type(ctype)
                )

                # 重新组装：去掉旧 content-length（压缩后长度必变），后续按需补回
                headers = [(k, v) for k, v in raw_headers if k != b"content-length"]
                # 缓存头 + Vary 对所有 200 静态响应生效（压缩与否都可能因
                # Accept-Encoding 而不同，Vary 让中间缓存按编码分别存放）
                headers.append((b"cache-control", cache_control.encode("latin-1")))
                headers.append((b"vary", b"accept-encoding"))

                if method == "HEAD" or not can_compress:
                    # 不压缩：content-length 保持原值
                    if raw_len is not None:
                        headers.append((b"content-length", str(raw_len).encode("latin-1")))
                    await send({"type": "http.response.start", "status": 200, "headers": headers})
                    state["forward_body"] = True
                    return

                full = self._resolve_path(path)
                key = None
                cached = None
                if full is not None:
                    try:
                        st = os.stat(full)
                        key = (path, st.st_mtime_ns, st.st_size, encoding)
                    except OSError:
                        key = None
                if key is not None:
                    cached = self._cache_get(key)

                if cached is not None:
                    # 命中预压缩缓存：丢弃上游 body，直接发缓存字节
                    headers.append((b"content-encoding", encoding.encode("latin-1")))
                    headers.append((b"content-length", str(len(cached)).encode("latin-1")))
                    await send({"type": "http.response.start", "status": 200, "headers": headers})
                    await send({"type": "http.response.body", "body": cached, "more_body": False})
                    state["done"] = True
                    return

                state["buffering"] = True
                state["start"] = (headers, key, encoding, ctype)
                return

            if mtype == "http.response.body":
                if state.get("forward_body"):
                    await send(message)
                    return
                if not state["buffering"]:
                    await send(message)
                    return
                body = message.get("body", b"")
                if body:
                    state["chunks"].append(body)
                if not message.get("more_body", False):
                    state["buffering"] = False
                    headers, key, enc, ctype = state["start"]
                    raw = b"".join(state["chunks"])
                    state["chunks"] = []
                    compressed = _compress(raw, enc)
                    if key is not None:
                        self._cache_put(key, compressed)
                    headers.append((b"content-encoding", enc.encode("latin-1")))
                    headers.append((b"content-length", str(len(compressed)).encode("latin-1")))
                    await send({"type": "http.response.start", "status": 200, "headers": headers})
                    await send({"type": "http.response.body", "body": compressed, "more_body": False})
                    state["done"] = True
                return

            await send(message)

        await self.app(scope, receive, send_wrapper)
