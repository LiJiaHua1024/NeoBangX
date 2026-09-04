"""设备画像：把指纹摘要翻译成管理员可读的描述。

面向管理后台（非教师端），允许使用技术术语，但要求把
`device_summary` 里的原始字段（os / lang / scr / dpr / cores / tz）
翻译成人类可读的画像，而不是直接展示截断 JSON。

只有展示作用：指纹可伪造，一切结论仅供参考，不做鉴权/限流依据。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

_OS_MAP = [
    (("win32", "windows"), "Windows"),
    (("macintel", "mac os", "macos", "darwin", "mac"), "macOS"),
    (("android",), "Android"),
    (("iphone", "ipad", "ios"), "iOS"),
    (("linux", "x11", "ubuntu", "debian"), "Linux"),
    (("cros", "chromeos", "chrome os"), "ChromeOS"),
]

_LANG_MAP = {
    "zh-cn": "简体中文（中国大陆）",
    "zh-tw": "繁体中文（台湾）",
    "zh-hk": "繁体中文（香港）",
    "zh-sg": "简体中文（新加坡）",
    "zh": "中文",
    "en-us": "英语（美国）",
    "en-gb": "英语（英国）",
    "en": "英语",
    "ja-jp": "日语（日本）",
    "ja": "日语",
    "ko-kr": "韩语（韩国）",
    "ko": "韩语",
    "fr-fr": "法语（法国）",
    "fr": "法语",
    "de-de": "德语（德国）",
    "de": "德语",
    "es-es": "西班牙语（西班牙）",
    "es": "西班牙语",
    "ru-ru": "俄语（俄罗斯）",
    "ru": "俄语",
}

_TZ_MAP = {
    "asia/shanghai": ("北京时间", "+8"),
    "asia/taipei": ("台北时间", "+8"),
    "asia/hong_kong": ("香港时间", "+8"),
    "asia/singapore": ("新加坡时间", "+8"),
    "asia/tokyo": ("日本时间", "+9"),
    "asia/seoul": ("韩国时间", "+9"),
    "utc": ("世界协调时", "+0"),
    "etc/utc": ("世界协调时", "+0"),
    "europe/london": ("伦敦时间", "+0/+1 夏令时"),
    "europe/paris": ("巴黎时间", "+1/+2 夏令时"),
    "europe/berlin": ("柏林时间", "+1/+2 夏令时"),
    "america/new_york": ("美东时间", "-5/-4 夏令时"),
    "america/chicago": ("美中时间", "-6/-5 夏令时"),
    "america/los_angeles": ("美西时间", "-8/-7 夏令时"),
    "australia/sydney": ("悉尼时间", "+10/+11 夏令时"),
}


def parse_summary(raw: str | None) -> dict:
    """容错解析 device_summary，返回 {os, lang, scr, dpr, cores, tz}。"""
    out = {"os": "", "lang": "", "scr": "", "dpr": "", "cores": "", "tz": ""}
    if not raw or not isinstance(raw, str):
        return out
    try:
        data = json.loads(raw)
    except Exception:
        return out
    if not isinstance(data, dict):
        return out
    for key in out:
        value = data.get(key, "")
        if value is None:
            continue
        out[key] = str(value).strip()[:128]
    return out


def translate_os(os_raw: str) -> tuple[str, str]:
    """返回 (译文, 备注)。"""
    if not os_raw:
        return "未知", "前端未上报 os 字段"
    lowered = os_raw.strip().lower()
    for keys, label in _OS_MAP:
        if any(k in lowered for k in keys):
            return f"{label}（{os_raw.strip()}）", "来自 navigator.platform / UA platform，仅供参考"
    return os_raw.strip(), "未能识别的平台标识，原样展示"


def translate_lang(lang_raw: str) -> tuple[str, str]:
    if not lang_raw:
        return "未知", "前端未上报 lang 字段"
    key = lang_raw.strip().lower().replace("_", "-")
    if key in _LANG_MAP:
        return f"{_LANG_MAP[key]}（{lang_raw.strip()}）", "浏览器首选语言"
    base = key.split("-")[0]
    if base in _LANG_MAP:
        return f"{_LANG_MAP[base]}（{lang_raw.strip()}）", "浏览器首选语言（按语种大类匹配）"
    return lang_raw.strip(), "未能识别的语言标识，原样展示"


def _aspect_label(w: int, h: int) -> str:
    if not w or not h:
        return ""
    from math import gcd

    g = gcd(w, h) or 1
    rw, rh = w // g, h // g
    if rw * h == rh * w and rw <= 32 and rh <= 32:
        return f"{rw}:{rh}"
    return f"约 {w / h:.2f}:1"


def translate_screen(scr_raw: str, dpr_raw: str) -> tuple[str, str]:
    if not scr_raw:
        return "未知", "前端未上报 scr（屏幕逻辑分辨率）字段"
    m = re.match(r"^\s*(\d+)\s*[x×*]\s*(\d+)\s*$", scr_raw.strip(), re.IGNORECASE)
    if not m:
        return scr_raw.strip(), "分辨率格式无法解析，原样展示"
    w, h = int(m.group(1)), int(m.group(2))
    mp = w * h / 1_000_000
    aspect = _aspect_label(w, h)
    long_side = max(w, h)
    if long_side < 768:
        size_hint = "手机竖屏规格"
    elif long_side < 1280:
        size_hint = "小屏笔记本 / 平板规格"
    elif long_side < 1920:
        size_hint = "主流笔记本 / 桌面规格"
    elif long_side < 2560:
        size_hint = "大屏桌面 / 外接显示器规格"
    else:
        size_hint = "高分屏桌面规格"
    if (w, h) in ((1366, 768), (1536, 864)):
        size_hint = "典型 Windows 笔记本规格"
    elif (w, h) in ((1920, 1080), (1080, 1920)):
        size_hint = "全高清（1080p）规格"
    elif (w, h) in ((2560, 1440), (1440, 2560)):
        size_hint = "2K 规格"
    elif (w, h) in ((3840, 2160), (2160, 3840)):
        size_hint = "4K 规格"
    orient = "竖屏" if h > w else "横屏"
    value = f"{w}×{h}（{orient}，{aspect}，约 {mp:.1f} 百万像素，{size_hint}）"
    try:
        dpr = float(str(dpr_raw).strip()) if str(dpr_raw).strip() else 0
    except Exception:
        dpr = 0
    if dpr:
        pw, ph = int(w * dpr), int(h * dpr)
        if dpr >= 2.5:
            dpr_hint = "手机 / Retina 高分屏常见"
        elif dpr >= 1.75:
            dpr_hint = "高分屏（Retina 级）"
        elif dpr > 1.05:
            dpr_hint = "Windows 缩放（如 125%/150%）常见"
        else:
            dpr_hint = "标准清晰度（无系统缩放）"
        value += f" · DPR {dpr:g}（物理约 {pw}×{ph}，{dpr_hint}）"
        hint = "scr 为 CSS 逻辑分辨率，乘 DPR 得物理像素"
    else:
        hint = "scr 为 CSS 逻辑分辨率；未上报 DPR"
    return value, hint


def translate_cores(cores_raw: str) -> tuple[str, str]:
    if not cores_raw:
        return "未知", "前端未上报 cores（逻辑 CPU 核心数）字段"
    try:
        n = int(float(str(cores_raw).strip()))
    except Exception:
        return str(cores_raw).strip(), "核心数格式无法解析，原样展示"
    if n <= 0:
        return str(cores_raw).strip(), "核心数格式无法解析，原样展示"
    if n <= 2:
        level = "低端 / 旧设备，或浏览器限制了可读核心数"
    elif n <= 4:
        level = "入门水平（轻薄本 / 手机常见）"
    elif n <= 8:
        level = "主流桌面 / 笔记本水平"
    elif n <= 16:
        level = "高性能桌面 / 工作站水平"
    else:
        level = "服务器 / 旗舰工作站水平"
    return f"{n} 核（{level}）", "navigator.hardwareConcurrency，为逻辑核心（含超线程），非物理核"


def translate_tz(tz_raw: str) -> tuple[str, str]:
    if not tz_raw:
        return "未知", "前端未上报 tz（IANA 时区）字段"
    key = tz_raw.strip().lower()
    if key in _TZ_MAP:
        name, offset = _TZ_MAP[key]
        return f"{tz_raw.strip()}（{name}，UTC{offset}）", "浏览器 Intl 时区；与 IP 归属地对照可发现代理/跨区"
    # 通用回退：尝试用 zoneinfo 算当前 UTC 偏移
    try:
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo(tz_raw.strip()))
        delta = now.utcoffset()
        if delta is not None:
            total_min = int(delta.total_seconds() // 60)
            sign = "+" if total_min >= 0 else "-"
            hh, mm = divmod(abs(total_min), 60)
            return (
                f"{tz_raw.strip()}（UTC{sign}{hh}" + (f":{mm:02d}" if mm else "") + "，当前偏移）",
                "经服务端 zoneinfo 换算的当前偏移，夏令时地区会随季节变化",
            )
    except Exception:
        pass
    return tz_raw.strip(), "非常用时区，原样展示；可与 IP 归属地对照"


_UA_BROWSERS = [
    ("EdgA/", "Edge（Android）"),
    ("EdgiOS/", "Edge（iOS）"),
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Vivaldi/", "Vivaldi"),
    ("CriOS/", "Chrome（iOS）"),
    ("FxiOS/", "Firefox（iOS）"),
    ("Firefox/", "Firefox"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
    ("MSIE ", "IE"),
    ("Trident/", "IE"),
]

_UA_OS = [
    ("Windows NT 10.0", "Windows 10/11 64 位"),
    ("Windows NT 6.3", "Windows 8.1"),
    ("Windows NT 6.1", "Windows 7"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Android", "Android"),
    ("iPhone", "iOS（iPhone）"),
    ("iPad", "iOS（iPad）"),
    ("Linux", "Linux"),
    ("CrOS", "ChromeOS"),
]


def parse_user_agent(ua: str | None) -> dict:
    """极简 UA 解析（无第三方依赖），返回 {browser, os, device_type, raw}。"""
    raw = (ua or "").strip()
    if not raw:
        return {"browser": "未知", "os": "未知", "device_type": "未知", "raw": ""}
    browser = "未知"
    version = ""
    for token, label in _UA_BROWSERS:
        if token in raw:
            browser = label
            try:
                after = raw.split(token, 1)[1]
                m = re.match(r"[\d.]+", after)
                if m:
                    version = m.group(0)
            except Exception:
                version = ""
            break
    os_label = "未知"
    for token, label in _UA_OS:
        if token in raw:
            os_label = label
            if token == "Android":
                m = re.search(r"Android\s+([\d.]+)", raw)
                if m:
                    os_label = f"Android {m.group(1)}"
            elif token == "Mac OS X":
                m = re.search(r"Mac OS X\s+([\d_]+)", raw)
                if m:
                    os_label = f"macOS {m.group(1).replace('_', '.')}"
            break
    if "Mobile" in raw or "Android" in raw or "iPhone" in raw:
        device_type = "手机 / 移动端"
    elif "iPad" in raw or "Tablet" in raw:
        device_type = "平板"
    else:
        device_type = "桌面端"
    return {
        "browser": f"{browser} {version}".strip() if version else browser,
        "os": os_label,
        "device_type": device_type,
        "raw": raw[:255],
    }


def build_profile(summary: dict, top_ua: str = "") -> list[dict]:
    """把摘要翻译成画像条目 [{key, label, value, hint}]。"""
    os_value, os_hint = translate_os(summary.get("os", ""))
    lang_value, lang_hint = translate_lang(summary.get("lang", ""))
    scr_value, scr_hint = translate_screen(summary.get("scr", ""), summary.get("dpr", ""))
    cores_value, cores_hint = translate_cores(summary.get("cores", ""))
    tz_value, tz_hint = translate_tz(summary.get("tz", ""))
    items = [
        {"key": "os", "label": "操作系统", "value": os_value, "hint": os_hint},
        {"key": "lang", "label": "语言", "value": lang_value, "hint": lang_hint},
        {"key": "screen", "label": "屏幕", "value": scr_value, "hint": scr_hint},
        {"key": "cores", "label": "CPU", "value": cores_value, "hint": cores_hint},
        {"key": "tz", "label": "时区", "value": tz_value, "hint": tz_hint},
    ]
    if top_ua:
        parsed = parse_user_agent(top_ua)
        items.append(
            {
                "key": "browser",
                "label": "浏览器（最近一次）",
                "value": f"{parsed['browser']} / {parsed['os']} / {parsed['device_type']}",
                "hint": "由最近一条日志的 User-Agent 解析；UA 可伪造，仅供对照",
            }
        )
    return items


def build_signals(*, code_count: int, ip_count: int, ua_count: int) -> list[str]:
    signals: list[str] = []
    if code_count > 1:
        signals.append(f"多码：同一浏览器用过 {code_count} 个使用码（疑似共享 / 转借）")
    if ip_count > 1:
        signals.append(f"多 IP：出现过 {ip_count} 个不同 IP（可能为移动网络 / 多地点使用）")
    if ua_count > 1:
        signals.append(f"多 UA：出现过 {ua_count} 种 User-Agent（多为浏览器升级；若浏览器大类变化则可能换过浏览器）")
    return signals
