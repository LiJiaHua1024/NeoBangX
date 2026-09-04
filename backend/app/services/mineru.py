"""MinerU 云端 PDF 解析：精准解析 API（pipeline/vlm）+ Agent 轻量解析 API。

官方文档：https://mineru.net/apiManage/docs
Base URL 硬编码官方地址，不暴露给管理后台。
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import time
import zipfile
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.services.runtime_config import MINERU_MODES, MINERU_MODELS, get_config_value

logger = logging.getLogger(__name__)

MINERU_BASE_URL = "https://mineru.net"

# 空结果阈值（hardcode）：解析文本 strip 后少于该字符数即视为"被 skip / 疑似扫描致空"
EMPTY_CHARS_THRESHOLD = 50

# 精准模式可透传的固定参数
_PRECISION_LANGUAGE = "ch"

# Agent 模式固定参数
_AGENT_LANGUAGE = "ch"

# 轮询间隔（秒）
_POLL_INTERVAL = 3.0

# zip / md 下载大小上限
_MAX_ZIP_BYTES = 50 * 1024 * 1024
_MAX_MD_BYTES = 10 * 1024 * 1024


class MinerUError(Exception):
    """MinerU 业务错误：kind 供 router 映射 HTTP 状态，user_message 直接展示给老师。"""

    def __init__(self, kind: str, user_message: str, detail: str = "", http_status: int = 502):
        super().__init__(user_message)
        self.kind = kind
        self.user_message = user_message
        self.detail = detail
        self.http_status = http_status


def get_mineru_settings(db: Session) -> dict:
    """读取当前 MinerU 配置（mode/model/token），非法值回退默认。

    token 统一经 extract_mineru_token 归一化：兼容直接粘贴的 Token、
    带 Bearer 前缀、以及 OpenXLab 剪切板常见的
    "Access Key: xxx / Secret Key: yyy" 两行格式。
    """
    mode = (get_config_value(db, "mineru_mode", "precision") or "precision").strip() or "precision"
    if mode not in MINERU_MODES:
        mode = "precision"
    model = (get_config_value(db, "mineru_model", "pipeline") or "pipeline").strip() or "pipeline"
    if model not in MINERU_MODELS:
        model = "pipeline"
    token = extract_mineru_token(get_config_value(db, "mineru_token", "") or "")[0]
    return {"mode": mode, "model": model, "token": token}


# 访问 https://sso.openxlab.org.cn/usercenter 点复制得到的即这种两行格式
_RE_SECRET_KEY = re.compile(r"secret\s*key|secretkey|secret_key", re.IGNORECASE)
_RE_ACCESS_KEY = re.compile(r"access\s*key(?:\s*id)?|accesskey(?:id)?|access_key(?:_id)?", re.IGNORECASE)
_RE_KV_SEP = re.compile(r"\s*[:：=]\s*")


def extract_mineru_token(raw: str) -> tuple[str, str]:
    """从粘贴文本中提取 MinerU Token，返回 (token, 来源)。

    来源：secret_key（两行格式中的 Secret Key，优先）/ access_key（只有 Access Key 时兜底）
    / raw（单行 Token）/ bearer（带 Bearer 前缀）/ ""（未识别出）。
    永远不抛异常，未识别时返回 ("", "")。
    """
    text = (raw or "").strip().strip("\"'“”‘’")
    if not text:
        return "", ""
    # 带 Bearer 前缀：直接取后半段
    m = re.match(r"(?i)^bearer\s+(\S+)\s*$", text)
    if m:
        return m.group(1).strip().strip("\"'"), "bearer"
    # 两行剪切板格式：逐行找 Secret Key / Access Key
    access_value = ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = _RE_KV_SEP.split(line, maxsplit=1)
        if len(parts) != 2:
            continue
        key, value = parts[0].strip(), parts[1].strip().strip("\"'")
        if not value:
            continue
        if _RE_SECRET_KEY.fullmatch(key):
            return value, "secret_key"
        if _RE_ACCESS_KEY.fullmatch(key) and not access_value:
            access_value = value
    if access_value:
        return access_value, "access_key"
    # 单行：含空白或非常用 Token 字符（如中文整句）则不可信，判为未识别
    if re.search(r"\s", text):
        return "", ""
    if not re.fullmatch(r"[A-Za-z0-9_\-./+=]+", text):
        return "", ""
    return text, "raw"


# ---------------- 错误码翻译 ----------------

def _file_size_text(size_bytes: int) -> str:
    mb = size_bytes / (1024 * 1024)
    return f"{mb:.1f}"


def translate_precision_code(code: int | None, err_msg: str = "") -> MinerUError:
    """精准 API code/err_msg → 老师文案。code 为 MinerU 业务码（如 -60005）。"""
    msg = (err_msg or "").strip()
    low = msg.lower()
    if code == -60005:
        return MinerUError("too_large", "文件超过大小上限（精准模式上限 200MB）。请拆分后分段上传。", f"code=-60005 {msg}", 413)
    if code == -60006:
        return MinerUError("too_many_pages", "文件页数超过限制（精准模式≤200 页）。请拆分后分段上传。", f"code=-60006 {msg}", 422)
    if code in (-60003, -60004, -60011, -60015):
        return MinerUError("corrupt", "文件无法读取，可能已损坏、被加密或为空。请重新导出一次 PDF 后再试。", f"code={code} {msg}", 422)
    if code == -60002:
        return MinerUError("unsupported", "暂不支持该文件格式。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。", f"code=-60002 {msg}", 400)
    if code in (-60018, -60019):
        return MinerUError("quota", "今日文档解析次数已用完，请明天再试。", f"code={code} {msg}", 429)
    if code in (-60009, -60007):
        return MinerUError("busy", "解析服务繁忙，请稍后再试。", f"code={code} {msg}", 503)
    if code in (-60010, -60017, -60020, -60021, -60022, -60001, -60012, -60013, -60014, -60016, -10001, -10002, -500):
        short = msg[:60] if msg else f"错误码 {code}"
        return MinerUError("parse_failed", f"解析失败（{short}）。可重试一次，仍失败请换一份 PDF 或联系管理员。", f"code={code} {msg}", 502)
    if "unsupported" in low or "invalid file" in low:
        return MinerUError("unsupported", "暂不支持该文件格式。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。", msg, 400)
    short = msg[:60] if msg else (f"错误码 {code}" if code is not None else "未知错误")
    return MinerUError("parse_failed", f"解析失败（{short}）。可重试一次，仍失败请换一份 PDF 或联系管理员。", f"code={code} {msg}", 502)


def translate_agent_code(code: int | None, err_msg: str = "") -> MinerUError:
    """Agent API err_code → 老师文案。"""
    msg = (err_msg or "").strip()
    if code == -30001:
        return MinerUError("too_large", "文件超过 10MB（轻量模式上限）。请拆分后分段上传，或联系管理员切换为精准模式（上限 200MB）。", f"code=-30001 {msg}", 413)
    if code == -30002:
        return MinerUError("unsupported", "暂不支持该文件格式。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。", f"code=-30002 {msg}", 400)
    if code == -30003:
        return MinerUError("too_many_pages", "文件页数超过限制（轻量模式≤20 页）。请拆分后分段上传，或联系管理员切换为精准模式（≤200 页）。", f"code=-30003 {msg}", 422)
    if code == -30004:
        return MinerUError("parse_failed", "解析请求参数有误，请重试或联系管理员。", f"code=-30004 {msg}", 502)
    short = msg[:60] if msg else (f"错误码 {code}" if code is not None else "未知错误")
    return MinerUError("parse_failed", f"解析失败（{short}）。可重试一次，仍失败请换一份 PDF 或联系管理员。", f"code={code} {msg}", 502)


def translate_http_status(status: int, body_text: str = "", mode: str = "precision") -> MinerUError:
    """HTTP 层错误 → 老师文案。401/403 优先判 Token 问题（仅精准模式）。"""
    snippet = (body_text or "")[:200]
    if status in (401, 403) or "A0202" in snippet or "A0211" in snippet:
        if mode == "precision":
            return MinerUError("token_invalid", "MinerU Token 无效或已过期（管理员需更换）。已记录，请联系管理员。", f"http={status} {snippet}", 502)
        return MinerUError("parse_failed", "解析服务拒绝了本次请求，请稍后重试或联系管理员。", f"http={status} {snippet}", 502)
    if status == 429:
        if mode == "agent":
            return MinerUError("rate_limited", "当前解析人数较多（轻量接口限流），请稍后再试；或联系管理员切换精准模式。", f"http=429 {snippet}", 429)
        return MinerUError("quota", "今日文档解析次数已用完，请明天再试。", f"http=429 {snippet}", 429)
    if status == 413:
        return MinerUError("too_large", "文件超过大小上限，请拆分后分段上传。", f"http=413 {snippet}", 413)
    return MinerUError("parse_failed", "解析服务暂时不可用，请稍后重试。", f"http={status} {snippet}", 502)


# ---------------- 内部 HTTP 工具 ----------------

def _check_mineru_envelope(payload: dict, mode: str) -> dict:
    """校验 MinerU 外层 code==0，否则按 msg 翻译。返回 data 字典。"""
    code = payload.get("code")
    msg = str(payload.get("msg") or "")
    trace = str(payload.get("trace_id") or "")
    if code == 0:
        data = payload.get("data") or {}
        return data if isinstance(data, dict) else {}
    # 外层非 0：尝试从 msg 提取已知码
    detail = f"code={code} msg={msg} trace={trace}"
    if "A0202" in msg or "A0211" in msg or "token" in msg.lower():
        raise MinerUError("token_invalid", "MinerU Token 无效或已过期（管理员需更换）。已记录，请联系管理员。", detail, 502)
    if "429" in msg or "limit" in msg.lower():
        if mode == "agent":
            raise MinerUError("rate_limited", "当前解析人数较多（轻量接口限流），请稍后再试；或联系管理员切换精准模式。", detail, 429)
        raise MinerUError("quota", "今日文档解析次数已用完，请明天再试。", detail, 429)
    raise MinerUError("parse_failed", f"解析提交失败（{msg[:60] or '未知错误'}）。请重试或联系管理员。", detail, 502)


async def _put_bytes(client: httpx.AsyncClient, url: str, data: bytes) -> None:
    """PUT 文件字节到预签名 URL（按文档要求不带 Content-Type）。"""
    try:
        # httpx 默认不设 content-type（bytes 时），显式去掉以符合 MinerU 要求
        resp = await client.put(url, content=data)
    except httpx.TimeoutException as e:
        raise MinerUError("timeout", "网络连接解析服务超时，请检查网络后重试。", f"PUT timeout {e!r}", 504) from e
    except httpx.ConnectError as e:
        raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"PUT connect {e!r}", 504) from e
    except httpx.HTTPError as e:
        raise MinerUError("network", "文件上传失败，请检查网络后重试。", f"PUT http {e!r}", 504) from e
    if resp.status_code not in (200, 201, 204):
        raise translate_http_status(resp.status_code, resp.text, "precision")


async def _download_text(client: httpx.AsyncClient, url: str, limit: int) -> str:
    try:
        resp = await client.get(url)
    except httpx.TimeoutException as e:
        raise MinerUError("timeout", "网络连接解析服务超时，请检查网络后重试。", f"GET md timeout {e!r}", 504) from e
    except httpx.ConnectError as e:
        raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"GET md connect {e!r}", 504) from e
    except httpx.HTTPError as e:
        raise MinerUError("network", "解析结果下载失败，请重试。", f"GET md http {e!r}", 504) from e
    if resp.status_code != 200:
        raise translate_http_status(resp.status_code, resp.text)
    if len(resp.content) > limit:
        raise MinerUError("too_large", "解析结果过大，请拆分文件后分段上传。", f"md {len(resp.content)}B", 502)
    try:
        return resp.content.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise MinerUError("parse_failed", "解析结果编码异常，请重试或联系管理员。", f"md decode {e!r}", 502) from e


async def _download_zip_markdown(client: httpx.AsyncClient, url: str) -> str:
    try:
        resp = await client.get(url)
    except httpx.TimeoutException as e:
        raise MinerUError("timeout", "网络连接解析服务超时，请检查网络后重试。", f"GET zip timeout {e!r}", 504) from e
    except httpx.ConnectError as e:
        raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"GET zip connect {e!r}", 504) from e
    except httpx.HTTPError as e:
        raise MinerUError("network", "解析结果下载失败，请重试。", f"GET zip http {e!r}", 504) from e
    if resp.status_code != 200:
        raise translate_http_status(resp.status_code, resp.text)
    if len(resp.content) > _MAX_ZIP_BYTES:
        raise MinerUError("too_large", "解析结果过大，请拆分文件后分段上传。", f"zip {len(resp.content)}B", 502)
    try:
        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf) as zf:
            names = zf.namelist()
            md_names = [n for n in names if n.lower().endswith(".md")]
            if not md_names:
                raise MinerUError("empty", "解析结果为空，该文件很可能是清晰度不足的拍照/扫描件。建议换文字版 PDF 或 Word 后再试。", f"zip entries={names[:10]}", 502)
            # 优先 full.md，否则取最大 md
            target = next((n for n in md_names if n.lower().endswith("full.md")), None)
            if target is None:
                target = max(md_names, key=lambda n: zf.getinfo(n).file_size)
            raw = zf.read(target)
    except zipfile.BadZipFile as e:
        raise MinerUError("parse_failed", "解析结果损坏，请重试。", f"bad zip {e!r}", 502) from e
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise MinerUError("parse_failed", "解析结果编码异常，请重试或联系管理员。", f"zip md decode {e!r}", 502) from e


# MinerU full.md 中的图片引用（zip 内相对路径如 images/xxx.jpg，本地打不开）：
# 留着是死链，统一清洗掉
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_HTML_IMG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_BLANK_LINES_RE = re.compile(r"\n{3,}")


def clean_mineru_markdown(text: str) -> tuple[str, int]:
    """去除 Markdown 图片引用与 HTML img 标签，返回 (cleaned, removed_count)。

    图片引用独占一行时顺带收掉多余空行；纯图片文档清洗后为空，由上层按空结果处理。
    """
    if not text:
        return "", 0
    removed = len(_MD_IMAGE_RE.findall(text)) + len(_HTML_IMG_RE.findall(text))
    cleaned = _MD_IMAGE_RE.sub("", text)
    cleaned = _HTML_IMG_RE.sub("", cleaned)
    cleaned = _BLANK_LINES_RE.sub("\n\n", cleaned).strip()
    return cleaned, removed


# ---------------- 精准解析 ----------------

async def parse_pdf_precision(
    *,
    file_bytes: bytes,
    filename: str,
    token: str,
    model_version: str = "pipeline",
    is_ocr: bool = False,
    timeout_total: float = 300.0,
) -> ParseResult:
    """精准解析：file-urls/batch → PUT → 轮询 batch 结果 → 下载 zip 取 full.md（去图片引用）。"""
    if not token:
        raise MinerUError("token_missing", "PDF 解析尚未配置（缺少 MinerU Token）。请联系管理员在管理后台 → 文档解析中填写。", "empty token", 503)
    if model_version not in MINERU_MODELS:
        model_version = "pipeline"
    if timeout_total <= 0:
        timeout_total = 300.0

    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=10.0)) as client:
        # 1. 申请上传 URL（is_ocr 为 per-file 参数）
        body = {
            "files": [{"name": filename or "document.pdf", "is_ocr": bool(is_ocr)}],
            "model_version": model_version,
            "enable_table": True,
            "enable_formula": True,
            "language": _PRECISION_LANGUAGE,
        }
        try:
            resp = await client.post(
                f"{MINERU_BASE_URL}/api/v4/file-urls/batch",
                json=body,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
        except httpx.TimeoutException as e:
            raise MinerUError("timeout", "网络连接解析服务超时，请检查网络后重试。", f"submit timeout {e!r}", 504) from e
        except httpx.ConnectError as e:
            raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"submit connect {e!r}", 504) from e
        except httpx.HTTPError as e:
            raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"submit http {e!r}", 504) from e
        if resp.status_code in (401, 403):
            raise translate_http_status(resp.status_code, resp.text, "precision")
        if resp.status_code == 429:
            raise translate_http_status(429, resp.text, "precision")
        if resp.status_code != 200:
            raise translate_http_status(resp.status_code, resp.text, "precision")
        try:
            payload = resp.json()
        except ValueError as e:
            raise MinerUError("parse_failed", "解析服务返回异常，请稍后重试。", f"submit json {e!r}", 502) from e
        data = _check_mineru_envelope(payload, "precision")
        batch_id = str(data.get("batch_id") or "")
        file_urls = data.get("file_urls") or []
        if not batch_id or not file_urls:
            raise MinerUError("parse_failed", "解析提交失败（未返回上传地址）。请重试或联系管理员。", f"no batch/file_urls {payload!r:.200}", 502)
        upload_url = str(file_urls[0])

        # 2. PUT 上传（不带 Content-Type）
        await _put_bytes(client, upload_url, file_bytes)

        # 3. 轮询 batch 结果
        deadline = time.monotonic() + timeout_total
        batch_url = f"{MINERU_BASE_URL}/api/v4/extract-results/batch/{batch_id}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "*/*"}
        last_state = ""
        while True:
            if time.monotonic() > deadline:
                raise MinerUError("timeout", "解析耗时过长（已超时），请拆分文件后重试。", f"batch={batch_id} last={last_state}", 504)
            await asyncio.sleep(_POLL_INTERVAL)
            try:
                r = await client.get(batch_url, headers=headers)
            except httpx.TimeoutException:
                continue  # 单次轮询超时继续等
            except httpx.ConnectError as e:
                raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"poll connect {e!r}", 504) from e
            except httpx.HTTPError as e:
                raise MinerUError("network", "解析进度查询失败，请重试。", f"poll http {e!r}", 504) from e
            if r.status_code in (401, 403):
                raise translate_http_status(r.status_code, r.text, "precision")
            if r.status_code != 200:
                raise translate_http_status(r.status_code, r.text, "precision")
            try:
                pj = r.json()
            except ValueError:
                continue
            try:
                d = _check_mineru_envelope(pj, "precision")
            except MinerUError:
                raise
            results = d.get("extract_result") or []
            if not results:
                continue
            item = results[0] if isinstance(results, list) else {}
            state = str(item.get("state") or "")
            last_state = state
            if state == "done":
                zip_url = str(item.get("full_zip_url") or "")
                if not zip_url:
                    raise MinerUError("parse_failed", "解析完成但未返回结果地址，请重试。", f"batch={batch_id} no zip", 502)
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as dl:
                    text = await _download_zip_markdown(dl, zip_url)
                    cleaned, removed = clean_mineru_markdown(text)
                    if removed:
                        logger.info("precision parse stripped %s image refs", removed)
                    return ParseResult(text=cleaned, is_ocr=is_ocr, mode="precision",
                                       model=model_version, images_removed=removed)
            if state == "failed":
                raise translate_precision_code(None, str(item.get("err_msg") or ""))
            # waiting-file/pending/running/converting/uploading → 继续
            continue


# ---------------- Agent 轻量解析 ----------------

async def parse_pdf_agent(
    *,
    file_bytes: bytes,
    filename: str,
    is_ocr: bool = False,
    timeout_total: float = 180.0,
) -> ParseResult:
    """Agent 轻量：parse/file → PUT → 轮询 task → 下载 md（去图片引用）。"""
    if timeout_total <= 0:
        timeout_total = 180.0
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=10.0)) as client:
        body = {
            "file_name": filename or "document.pdf",
            "language": _AGENT_LANGUAGE,
            "enable_table": True,
            "is_ocr": bool(is_ocr),
            "enable_formula": True,
        }
        try:
            resp = await client.post(
                f"{MINERU_BASE_URL}/api/v1/agent/parse/file",
                json=body,
                headers={"Content-Type": "application/json"},
            )
        except httpx.TimeoutException as e:
            raise MinerUError("timeout", "网络连接解析服务超时，请检查网络后重试。", f"agent submit timeout {e!r}", 504) from e
        except httpx.ConnectError as e:
            raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"agent submit connect {e!r}", 504) from e
        except httpx.HTTPError as e:
            raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"agent submit http {e!r}", 504) from e
        if resp.status_code == 429:
            raise translate_http_status(429, resp.text, "agent")
        if resp.status_code != 200:
            raise translate_http_status(resp.status_code, resp.text, "agent")
        try:
            payload = resp.json()
        except ValueError as e:
            raise MinerUError("parse_failed", "解析服务返回异常，请稍后重试。", f"agent submit json {e!r}", 502) from e
        data = _check_mineru_envelope(payload, "agent")
        task_id = str(data.get("task_id") or "")
        file_url = str(data.get("file_url") or "")
        if not task_id or not file_url:
            raise MinerUError("parse_failed", "解析提交失败（未返回上传地址）。请重试或联系管理员。", f"no task/file_url {payload!r:.200}", 502)

        await _put_bytes(client, file_url, file_bytes)

        deadline = time.monotonic() + timeout_total
        qurl = f"{MINERU_BASE_URL}/api/v1/agent/parse/{task_id}"
        last_state = ""
        while True:
            if time.monotonic() > deadline:
                raise MinerUError("timeout", "解析耗时过长（已超时），请拆分文件后重试。", f"task={task_id} last={last_state}", 504)
            await asyncio.sleep(_POLL_INTERVAL)
            try:
                r = await client.get(qurl)
            except httpx.TimeoutException:
                continue
            except httpx.ConnectError as e:
                raise MinerUError("network", "网络连接解析服务失败，请检查网络后重试。", f"agent poll connect {e!r}", 504) from e
            except httpx.HTTPError as e:
                raise MinerUError("network", "解析进度查询失败，请重试。", f"agent poll http {e!r}", 504) from e
            if r.status_code == 429:
                raise translate_http_status(429, r.text, "agent")
            if r.status_code != 200:
                raise translate_http_status(r.status_code, r.text, "agent")
            try:
                pj = r.json()
            except ValueError:
                continue
            d = _check_mineru_envelope(pj, "agent")
            state = str(d.get("state") or "")
            last_state = state
            if state == "done":
                md_url = str(d.get("markdown_url") or "")
                if not md_url:
                    raise MinerUError("parse_failed", "解析完成但未返回结果地址，请重试。", f"task={task_id} no md", 502)
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as dl:
                    text = await _download_text(dl, md_url, _MAX_MD_BYTES)
                    cleaned, removed = clean_mineru_markdown(text)
                    if removed:
                        logger.info("agent parse stripped %s image refs", removed)
                    return ParseResult(text=cleaned, is_ocr=is_ocr, mode="agent",
                                       model="pipeline", images_removed=removed)
            if state == "failed":
                code = d.get("err_code")
                try:
                    code = int(code) if code is not None else None
                except (TypeError, ValueError):
                    code = None
                raise translate_agent_code(code, str(d.get("err_msg") or ""))
            continue


# ---------------- Token 探活 ----------------

async def probe_precision_token(*, token: str, timeout: float = 15.0) -> float:
    """用最小 file-urls/batch 请求探活（不实际 PUT，不产生解析任务）。

    返回耗时毫秒；Token 无效/过期抛 MinerUError(kind=token_invalid)。
    """
    token = extract_mineru_token(token)[0]
    if not token:
        raise MinerUError("token_missing", "未能识别出有效的 Token，请粘贴 MinerU Token 或 Access Key / Secret Key 两行格式。", "empty", 400)
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
            resp = await client.post(
                f"{MINERU_BASE_URL}/api/v4/file-urls/batch",
                json={"files": [{"name": "probe_test.pdf"}], "model_version": "pipeline"},
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
    except httpx.TimeoutException as e:
        raise MinerUError("timeout", "连接 MinerU 超时，请检查服务器网络后重试。", f"probe timeout {e!r}", 504) from e
    except httpx.ConnectError as e:
        raise MinerUError("network", "连接 MinerU 失败，请检查服务器网络后重试。", f"probe connect {e!r}", 504) from e
    except httpx.HTTPError as e:
        raise MinerUError("network", "连接 MinerU 失败，请稍后重试。", f"probe http {e!r}", 504) from e
    latency_ms = (time.monotonic() - started) * 1000
    if resp.status_code in (401, 403):
        raise translate_http_status(resp.status_code, resp.text, "precision")
    if resp.status_code != 200:
        raise translate_http_status(resp.status_code, resp.text, "precision")
    try:
        payload = resp.json()
    except ValueError as e:
        raise MinerUError("parse_failed", "MinerU 返回异常，请稍后重试。", f"probe json {e!r}", 502) from e
    _check_mineru_envelope(payload, "precision")
    return latency_ms


@dataclass
class ParseResult:
    text: str
    is_ocr: bool
    mode: str
    model: str
    images_removed: int = 0
