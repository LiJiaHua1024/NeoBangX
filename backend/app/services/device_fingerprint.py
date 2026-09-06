"""浏览器设备指纹的服务端呈现逻辑（纯展示，不做鉴权/限流依据）。

客户端经 ThumbmarkJS（MIT，CDN 引入）计算 `thumbmark` 哈希后，
经 `X-Client-Fingerprint` 请求头上报。后端只做三件事：

1. 归一化 + 截断（非法指纹直接丢弃，绝不 400）；
2. 按指纹确定性派生人眼可读的短码 / 自动昵称 / 颜色；
3. 落库复用（`devices` 表按 fingerprint 唯一）。

短码算法：`sha256(fingerprint)` 前 5 字节（40bit）→ Crockford Base32
（去掉了 I/L/O/U，避免与数字混淆）→ 8 字符 → `FP-XXXX-XXXX`。
几百设备量级下碰撞可忽略；仍有唯一索引 + 冲突重试兜底。
"""

from __future__ import annotations

import hashlib
import re

from app.services.device_profile import identify_device, parse_summary

# 指纹合法字符：ThumbmarkJS 返回十六进制哈希，放宽到常见的 base64url/UUID 形态
_FINGERPRINT_RE = re.compile(r"^[A-Za-z0-9_\-:+=/\.]+$")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

# 诗意外号（识别不出设备时的兜底命名）
_ADJECTIVES = [
    "青", "晓", "墨", "澄", "朗", "静", "遥", "暖",
    "澈", "昭", "恬", "蔚", "熠", "安", "睿", "淳",
]
_NOUNS = [
    "鹭", "松", "竹", "兰", "雁", "溪", "岚", "柏",
    "桐", "梅", "枫", "荷", "杉", "桦", "薇", "蒲",
]

# 诗意外号形态：两个汉字 + · + 4 位大写十六进制（用于判断昵称可否升级为识别名）
_POETIC_NAME_RE = re.compile(r"^[一-龥]{2}·[0-9A-F]{4}$")

MAX_FINGERPRINT_CHARS = 128
MAX_FP_SUMMARY_CHARS = 2000


def normalize_fingerprint(raw: str | None) -> str:
    """归一化客户端上报的指纹；非法/空返回空串（调用方直接视为无指纹）。"""
    if not raw:
        return ""
    value = raw.strip()
    if not value:
        return ""
    if len(value) > MAX_FINGERPRINT_CHARS:
        return ""
    if not _FINGERPRINT_RE.fullmatch(value):
        return ""
    return value


def _digest(fingerprint: str) -> bytes:
    return hashlib.sha256(fingerprint.encode("utf-8")).digest()


def short_code_for(fingerprint: str) -> str:
    """按指纹确定性生成 `FP-XXXX-XXXX` 短码。"""
    digest = _digest(f"FINGERPRINT-SHORT:{fingerprint}")
    bits = int.from_bytes(digest[:5], "big")  # 40 bit
    chars: list[str] = []
    for _ in range(8):
        chars.append(_CROCKFORD[bits & 31])
        bits >>= 5
    code = "".join(reversed(chars))
    return f"FP-{code[:4]}-{code[4:]}"


def auto_name_for(fingerprint: str, summary: str = "") -> str:
    """按指纹确定性生成昵称；同一指纹永远同一昵称。

    摘要能识别出设备时用识别名（如 `iPhone·3F2A`、`Win笔电·3F2A`），
    识别不出或摘要缺失时沿用 `青鹭·3F2A` 风格诗意外号兜底。
    """
    digest = _digest(f"FINGERPRINT-NAME:{fingerprint}")
    suffix = f"{digest[2]:02X}{digest[3]:02X}"
    try:
        ident = identify_device(parse_summary(summary))
        short_name = str(ident.get("short_name") or "").strip()
    except Exception:
        short_name = ""
    if short_name:
        return f"{short_name}·{suffix}"
    adj = _ADJECTIVES[digest[0] % len(_ADJECTIVES)]
    noun = _NOUNS[digest[1] % len(_NOUNS)]
    return f"{adj}{noun}·{suffix}"


def is_poetic_name(name: str | None) -> bool:
    """判断昵称是否为诗意外号形态（可被识别名升级替换）。"""
    return bool(name) and bool(_POETIC_NAME_RE.fullmatch(name.strip()))


def refresh_auto_name(current: str | None, fingerprint: str, summary: str) -> str:
    """已有设备昵称升级：仅当当前仍是诗意外号且新摘要识别成功时替换。

    用户手写 note 展示优先级更高，不受影响；已是识别名的保持稳定。
    """
    current = (current or "").strip()
    if not is_poetic_name(current):
        return current
    try:
        ident = identify_device(parse_summary(summary))
    except Exception:
        return current
    short_name = str(ident.get("short_name") or "").strip()
    if short_name:
        return auto_name_for(fingerprint, summary)
    return current


def color_for(fingerprint: str) -> str:
    """按指纹确定性生成 HSL 颜色（管理后台色点，前后端展示一致）。"""
    digest = _digest(f"FINGERPRINT-COLOR:{fingerprint}")
    hue = int.from_bytes(digest[:2], "big") % 360
    return f"hsl({hue} 70% 45%)"


def clip_summary(raw: str | None) -> str:
    """设备摘要截断（前端上报的精简 JSON/一句话，不可信，仅展示）。"""
    return (raw or "").strip()[:MAX_FP_SUMMARY_CHARS]
