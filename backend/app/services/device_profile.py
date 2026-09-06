"""设备画像：把指纹摘要翻译成管理员可读的描述，并做确定性设备识别。

面向管理后台（非教师端），允许使用技术术语，但要求把
`device_summary` 里的原始字段翻译成人类可读的画像，而不是直接展示截断 JSON。

两层能力：
1. `identify_device` —— 按摘要字段（分辨率/DPR/UA-CH 高熵信息/GPU）确定性识别
   设备类型 / 品牌 / 机型，输出置信度分级（确定 / 倾向 / 推测），不做硬断言；
2. `build_profile` —— 把摘要翻译成画像条目 + 识别结论，供画像抽屉展示。

只有展示作用：指纹可伪造，一切结论仅供参考，不做鉴权/限流依据。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

_OS_MAP = [
    (("win32", "windows"), "Windows"),
    (("macintel", "mac os", "macos", "darwin", "mac"), "macOS"),
    (("android",), "Android"),
    (("iphone", "ipad", "ios"), "iOS"),
    (("cros", "chromeos", "chrome os"), "ChromeOS"),
    (("linux", "x11", "ubuntu", "debian"), "Linux"),
    (("freebsd", "openbsd", "netbsd"), "BSD"),
    (("sunos", "solaris"), "Solaris"),
]

_LANG_MAP = {
    # 中文
    "zh-cn": "简体中文（中国大陆）", "zh-tw": "繁体中文（台湾）", "zh-hk": "繁体中文（香港）",
    "zh-sg": "简体中文（新加坡）", "zh-mo": "繁体中文（澳门）", "zh": "中文", "yue": "粤语",
    # 英语
    "en-us": "英语（美国）", "en-gb": "英语（英国）", "en-au": "英语（澳大利亚）",
    "en-ca": "英语（加拿大）", "en-in": "英语（印度）", "en-sg": "英语（新加坡）",
    "en-nz": "英语（新西兰）", "en-hk": "英语（香港）", "en-ie": "英语（爱尔兰）",
    "en-za": "英语（南非）", "en": "英语",
    # 日韩
    "ja-jp": "日语（日本）", "ja": "日语", "ko-kr": "韩语（韩国）", "ko": "韩语",
    # 法语
    "fr-fr": "法语（法国）", "fr-ca": "法语（加拿大）", "fr-be": "法语（比利时）",
    "fr-ch": "法语（瑞士）", "fr": "法语",
    # 德语
    "de-de": "德语（德国）", "de-at": "德语（奥地利）", "de-ch": "德语（瑞士）", "de": "德语",
    # 西语
    "es-es": "西班牙语（西班牙）", "es-mx": "西班牙语（墨西哥）", "es-ar": "西班牙语（阿根廷）",
    "es-us": "西班牙语（美国）", "es-419": "西班牙语（拉丁美洲）", "es": "西班牙语",
    # 葡语 / 意语 / 荷语
    "pt-br": "葡萄牙语（巴西）", "pt-pt": "葡萄牙语（葡萄牙）", "pt": "葡萄牙语",
    "it-it": "意大利语（意大利）", "it": "意大利语",
    "nl-nl": "荷兰语（荷兰）", "nl-be": "荷兰语（比利时）", "nl": "荷兰语",
    # 俄语区
    "ru-ru": "俄语（俄罗斯）", "ru": "俄语", "uk": "乌克兰语", "uk-ua": "乌克兰语（乌克兰）",
    "be": "白俄罗斯语", "kk": "哈萨克语",
    # 北欧 / 波罗的海
    "sv-se": "瑞典语（瑞典）", "sv": "瑞典语", "da-dk": "丹麦语（丹麦）", "da": "丹麦语",
    "nb": "挪威语（书面）", "nn": "挪威语（新）", "no": "挪威语",
    "fi-fi": "芬兰语（芬兰）", "fi": "芬兰语", "is": "冰岛语",
    "et": "爱沙尼亚语", "lv": "拉脱维亚语", "lt": "立陶宛语",
    # 中东欧
    "pl-pl": "波兰语（波兰）", "pl": "波兰语", "cs-cz": "捷克语（捷克）", "cs": "捷克语",
    "sk-sk": "斯洛伐克语", "sk": "斯洛伐克语", "hu-hu": "匈牙利语", "hu": "匈牙利语",
    "ro-ro": "罗马尼亚语", "ro": "罗马尼亚语", "bg-bg": "保加利亚语", "bg": "保加利亚语",
    "el-gr": "希腊语（希腊）", "el": "希腊语", "hr": "克罗地亚语", "sr": "塞尔维亚语",
    "sl": "斯洛文尼亚语",
    # 中东
    "tr-tr": "土耳其语（土耳其）", "tr": "土耳其语",
    "ar": "阿拉伯语", "ar-sa": "阿拉伯语（沙特）", "ar-ae": "阿拉伯语（阿联酋）",
    "ar-eg": "阿拉伯语（埃及）", "he": "希伯来语", "he-il": "希伯来语（以色列）",
    "fa": "波斯语", "fa-ir": "波斯语（伊朗）", "ur": "乌尔都语",
    # 南亚 / 东南亚
    "hi-in": "印地语（印度）", "hi": "印地语", "bn": "孟加拉语", "ta": "泰米尔语",
    "te": "泰卢固语", "th-th": "泰语（泰国）", "th": "泰语",
    "vi-vn": "越南语（越南）", "vi": "越南语", "id-id": "印尼语（印尼）", "id": "印尼语",
    "ms-my": "马来语（马来西亚）", "ms": "马来语", "fil-ph": "菲律宾语", "fil": "菲律宾语",
    # 其他
    "ca-es": "加泰罗尼亚语", "ca": "加泰罗尼亚语", "eu": "巴斯克语",
}

_TZ_MAP = {
    # 东亚
    "asia/shanghai": ("北京时间", "+8"),
    "asia/urumqi": ("新疆时间", "+6"),
    "asia/taipei": ("台北时间", "+8"),
    "asia/hong_kong": ("香港时间", "+8"),
    "asia/macau": ("澳门时间", "+8"),
    "asia/singapore": ("新加坡时间", "+8"),
    "asia/kuala_lumpur": ("吉隆坡时间", "+8"),
    "asia/manila": ("马尼拉时间", "+8"),
    "asia/ulaanbaatar": ("乌兰巴托时间", "+8"),
    "asia/tokyo": ("日本时间", "+9"),
    "asia/seoul": ("韩国时间", "+9"),
    "asia/pyongyang": ("平壤时间", "+9"),
    # 东南亚 / 南亚
    "asia/bangkok": ("曼谷时间", "+7"),
    "asia/jakarta": ("雅加达时间", "+7"),
    "asia/ho_chi_minh": ("胡志明市时间", "+7"),
    "asia/yangon": ("仰光时间", "+6:30"),
    "asia/kolkata": ("印度时间", "+5:30"),
    "asia/colombo": ("斯里兰卡时间", "+5:30"),
    "asia/kathmandu": ("尼泊尔时间", "+5:45"),
    "asia/karachi": ("巴基斯坦时间", "+5"),
    "asia/dhaka": ("孟加拉时间", "+6"),
    # 中亚 / 西亚
    "asia/dubai": ("迪拜时间", "+4"),
    "asia/riyadh": ("利雅得时间", "+3"),
    "asia/qatar": ("卡塔尔时间", "+3"),
    "asia/kuwait": ("科威特时间", "+3"),
    "asia/baghdad": ("巴格达时间", "+3"),
    "asia/tehran": ("伊朗时间", "+3:30/+4:30"),
    "asia/jerusalem": ("以色列时间", "+2/+3 夏令时"),
    "asia/amman": ("约旦时间", "+3"),
    "asia/beirut": ("黎巴嫩时间", "+2/+3 夏令时"),
    "asia/almaty": ("阿拉木图时间", "+5"),
    "asia/tashkent": ("塔什干时间", "+5"),
    "asia/kabul": ("阿富汗时间", "+4:30"),
    # 欧洲
    "europe/london": ("伦敦时间", "+0/+1 夏令时"),
    "europe/dublin": ("都柏林时间", "+0/+1 夏令时"),
    "europe/lisbon": ("里斯本时间", "+0/+1 夏令时"),
    "europe/paris": ("巴黎时间", "+1/+2 夏令时"),
    "europe/berlin": ("柏林时间", "+1/+2 夏令时"),
    "europe/madrid": ("马德里时间", "+1/+2 夏令时"),
    "europe/rome": ("罗马时间", "+1/+2 夏令时"),
    "europe/amsterdam": ("阿姆斯特丹时间", "+1/+2 夏令时"),
    "europe/brussels": ("布鲁塞尔时间", "+1/+2 夏令时"),
    "europe/vienna": ("维也纳时间", "+1/+2 夏令时"),
    "europe/zurich": ("苏黎世时间", "+1/+2 夏令时"),
    "europe/stockholm": ("斯德哥尔摩时间", "+1/+2 夏令时"),
    "europe/oslo": ("奥斯陆时间", "+1/+2 夏令时"),
    "europe/copenhagen": ("哥本哈根时间", "+1/+2 夏令时"),
    "europe/warsaw": ("华沙时间", "+1/+2 夏令时"),
    "europe/prague": ("布拉格时间", "+1/+2 夏令时"),
    "europe/budapest": ("布达佩斯时间", "+1/+2 夏令时"),
    "europe/athens": ("雅典时间", "+2/+3 夏令时"),
    "europe/helsinki": ("赫尔辛基时间", "+2/+3 夏令时"),
    "europe/bucharest": ("布加勒斯特时间", "+2/+3 夏令时"),
    "europe/kyiv": ("基辅时间", "+2/+3 夏令时"),
    "europe/istanbul": ("伊斯坦布尔时间", "+3"),
    "europe/moscow": ("莫斯科时间", "+3"),
    # 北美
    "america/new_york": ("美东时间", "-5/-4 夏令时"),
    "america/toronto": ("多伦多时间", "-5/-4 夏令时"),
    "america/chicago": ("美中时间", "-6/-5 夏令时"),
    "america/denver": ("美山时间", "-7/-6 夏令时"),
    "america/phoenix": ("亚利桑那时间", "-7"),
    "america/los_angeles": ("美西时间", "-8/-7 夏令时"),
    "america/vancouver": ("温哥华时间", "-8/-7 夏令时"),
    "america/mexico_city": ("墨西哥城时间", "-6"),
    "america/halifax": ("哈利法克斯时间", "-4/-3 夏令时"),
    "america/anchorage": ("阿拉斯加时间", "-9/-8 夏令时"),
    "pacific/honolulu": ("夏威夷时间", "-10"),
    # 南美
    "america/bogota": ("波哥大时间", "-5"),
    "america/lima": ("利马时间", "-5"),
    "america/santiago": ("圣地亚哥（智利）时间", "-4/-3 夏令时"),
    "america/sao_paulo": ("圣保罗时间", "-3"),
    "america/argentina/buenos_aires": ("布宜诺斯艾利斯时间", "-3"),
    # 非洲
    "africa/cairo": ("开罗时间", "+2"),
    "africa/johannesburg": ("约翰内斯堡时间", "+2"),
    "africa/lagos": ("拉各斯时间", "+1"),
    "africa/nairobi": ("内罗毕时间", "+3"),
    "africa/casablanca": ("卡萨布兰卡时间", "+1"),
    # 大洋洲
    "australia/sydney": ("悉尼时间", "+10/+11 夏令时"),
    "australia/melbourne": ("墨尔本时间", "+10/+11 夏令时"),
    "australia/brisbane": ("布里斯班时间", "+10"),
    "australia/perth": ("珀斯时间", "+8"),
    "australia/adelaide": ("阿德莱德时间", "+9:30/+10:30 夏令时"),
    "australia/darwin": ("达尔文时间", "+9:30"),
    "pacific/auckland": ("奥克兰时间", "+12/+13 夏令时"),
    "pacific/fiji": ("斐济时间", "+12"),
    # 通用
    "utc": ("世界协调时", "+0"),
    "etc/utc": ("世界协调时", "+0"),
    "etc/gmt": ("格林尼治时间", "+0"),
    "gmt": ("格林尼治时间", "+0"),
}

# 常见分辨率 → 规格标注（覆盖面比旧版 8 对更广，含 MacBook 与缩放衍生）
_SCR_SPECIAL = {
    (1366, 768): "典型 Windows 笔记本",
    (1280, 720): "720p 小屏",
    (1280, 800): "典型 13 寸笔电",
    (1440, 900): "旧 MacBook Air 13 / 14 寸笔电",
    (1536, 864): "典型 Windows 笔记本（1080p @125% 缩放）",
    (1600, 900): "16:9 中屏笔电",
    (1680, 1050): "旧 MacBook Pro 15 / 大屏笔电",
    (1920, 1080): "全高清（1080p）",
    (1080, 1920): "全高清竖屏 / 手机外接",
    (1920, 1200): "16:10 笔电 / 高分屏",
    (2560, 1440): "2K",
    (1440, 2560): "2K 竖屏",
    (3440, 1440): "带鱼屏（21:9）",
    (3840, 2160): "4K",
    (2160, 3840): "4K 竖屏",
    (1470, 956): "MacBook Pro 14（缩放）",
    (1512, 982): "MacBook Air 13（M2 世代）/ MacBook Pro 14",
    (1710, 1112): "MacBook Pro 16（缩放）",
    (1728, 1117): "MacBook Pro 16",
}

# Windows 常见笔电逻辑分辨率（长边 ≤1920 的主流笔电组合）
_WIN_LAPTOP_SIZES = {
    (768, 1366), (864, 1536), (800, 1280), (900, 1440),
    (1050, 1680), (1200, 1920), (720, 1280),
}

# 显卡特征：独显 / 核显（含移动端 GPU）
_GPU_DISCRETE_TOKENS = ("GeForce", "GTX", "RTX", "Quadro", "Radeon RX", "Radeon Pro", "Intel(R) Arc", "Arc A", "Arc B")
_GPU_INTEGRATED_TOKENS = ("UHD Graphics", "Iris", "Intel(R) HD", "Radeon(TM) Graphics", "Radeon (TM)", "Apple", "Adreno", "Mali", "PowerVR", "Vega")

# iPhone 逻辑分辨率（短边×长边×DPR）→ 机型组；同分辨率多款共用，标「之一」
_IPHONE_SIZES = {
    (320, 480, 2): "iPhone 4 / 4s",
    (320, 568, 2): "iPhone 5 / 5s / SE（1 代）",
    (375, 667, 2): "iPhone 6 / 6s / 7 / 8 / SE（2/3 代）",
    (414, 736, 3): "iPhone 6 / 7 / 8 Plus",
    (375, 812, 3): "iPhone X / XS / 11 Pro / 12 mini / 13 mini",
    (414, 896, 2): "iPhone XR / 11",
    (414, 896, 3): "iPhone XS Max / 11 Pro Max",
    (390, 844, 3): "iPhone 12 / 12 Pro / 13 / 13 Pro / 14",
    (428, 926, 3): "iPhone 12 Pro Max / 13 Pro Max",
    (393, 852, 3): "iPhone 14 Pro / 15 / 15 Pro / 16",
    (430, 932, 3): "iPhone 14 Plus / 15 Plus / 15 Pro Max / 16 Plus",
    (402, 874, 3): "iPhone 16 Pro / 17 / 17 Pro",
    (440, 956, 3): "iPhone 16 Pro Max / 17 Pro Max",
    (420, 912, 3): "iPhone Air（2025）",
}

# iPad 逻辑分辨率 → 机型组
_IPAD_SIZES = {
    (768, 1024, 2): "iPad（1–6 代）/ Air 1/2 / mini 1–5 / Pro 9.7",
    (810, 1080, 2): "iPad 7 / 8 / 9（10.2 寸）",
    (820, 1180, 2): "iPad 10 代 / Air 4/5/6",
    (834, 1112, 2): "iPad Air 3 / Pro 10.5",
    (834, 1194, 2): "iPad Pro 11（1–3 代）",
    (834, 1210, 2): "iPad Pro 11（M4）",
    (1024, 1366, 2): "iPad Pro 12.9（1–6 代）",
    (1032, 1376, 2): "iPad Pro 13（M4）",
    (744, 1133, 2): "iPad mini 6 / 7",
}

# macOS 逻辑分辨率 → 机型推断（不带 DPR，缩放模式同为 2）
_MAC_SIZES = {
    (800, 1280): "MacBook / MacBook Air 13（旧）",
    (900, 1440): "MacBook Air 13（旧）/ MacBook Pro 13",
    (1050, 1680): "MacBook Pro 15（旧）",
    (956, 1470): "MacBook Pro 14（缩放）",
    (982, 1512): "MacBook Air 13（M2+）/ MacBook Pro 14",
    (1112, 1710): "MacBook Pro 16（缩放）",
    (1117, 1728): "MacBook Pro 16",
    (1169, 1800): "MacBook Pro 16（缩放）",
    (1080, 1920): "iMac / 外接显示器",
    (1440, 2560): "iMac 27 / 外接 2K 显示器",
}

# Android 型号串前缀 → 品牌推测（全部只是推测，展示时标注）
_ANDROID_BRANDS = [
    (r"^SM-[A-Z0-9]", "三星"),
    (r"^SCG\d", "三星（日运营商版）"),
    (r"Pixel", "谷歌"),
    (r"^(Redmi|POCO)", "红米"),
    (r"^M\d{4}[A-Z]", "小米"),
    (r"^\d{9,11}[A-Z]$", "小米·红米"),
    (r"^(vivo|V\d{4}[A-Z]?)", "vivo"),
    (r"^(iQOO|IQOO)", "iQOO"),
    (r"^RMX\d{4}", "realme"),
    (r"^CPH\d{4}", "OPPO / 一加系"),
    (r"^P[A-Z]{2,3}\d{2}", "OPPO"),
    (r"^LE\d{4}", "一加"),
    (r"^(HUAWEI|ELS-|VOG-|JAD-|CET-|ALN-|BNE-|GOA-|MGA-)", "华为"),
    (r"^(HRY|JAT|COR|STK|JKM|AGS|MED|LDN|LRA|ANY|MOA|KOB|WAS|DUA|ATU)", "荣耀 / 华为"),
    (r"^LM-[A-Z]?\d", "LG"),
    (r"^(Nokia|TA-\d{4})", "诺基亚"),
    (r"^(moto|XT\d{4})", "摩托罗拉"),
    (r"ASUS|ROG", "华硕"),
    (r"^(XQ-|SO[G-]\d)", "索尼"),
]

# 无 UA-CH model 时，从 UA 里的浏览器 token 反推品牌（推测）
_ANDROID_UA_BRANDS = [
    ("MiuiBrowser", "小米"), ("MiBrowser", "小米"),
    ("HeyTapBrowser", "OPPO"), ("VivoBrowser", "vivo"),
    ("HuaweiBrowser", "华为"), ("HMSCore", "华为"), ("HONOR", "荣耀"),
    ("SamsungBrowser", "三星"),
]

_MACOS_NAMES = {11: "Big Sur", 12: "Monterey", 13: "Ventura", 14: "Sonoma", 15: "Sequoia", 26: "Tahoe"}

_ANGLE_RE = re.compile(r"ANGLE \((.*)\)")
_HEX_ADDR_RE = re.compile(r"\s*\(0x[0-9A-Fa-f]+\)")


def parse_summary(raw: str | None) -> dict:
    """容错解析 device_summary，返回摘要字段字典（未知字段忽略）。"""
    keys = (
        "os", "lang", "scr", "dpr", "cores", "tz",
        "model", "pv", "gpu", "touch", "mem", "cd", "langs", "bat", "arch", "bit",
    )
    out = {key: "" for key in keys}
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
        out[key] = str(value).strip()[:200]
    return out


_BEIJING_TZ = timezone(timedelta(hours=8))


def beijing_hour(created: datetime) -> int | None:
    """日志时间为 UTC（可能带/不带 tzinfo），转北京时间取小时。"""
    try:
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return created.astimezone(_BEIJING_TZ).hour
    except Exception:
        return None


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
    if (w, h) in _SCR_SPECIAL:
        size_hint = _SCR_SPECIAL[(w, h)]
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
    # 国产 App 内置 / 浏览器（放最前，避免被 Chrome/Safari 通用 token 截胡）
    ("MicroMessenger/", "微信内置"),
    ("wxwork/", "企业微信内置"),
    ("Alipay", "支付宝内置"),
    ("DingTalk", "钉钉内置"),
    ("Lark", "飞书内置"),
    ("Feishu", "飞书内置"),
    ("Weibo", "微博内置"),
    ("Quark/", "夸克浏览器"),
    ("UCBrowser/", "UC 浏览器"),
    ("QQBrowser/", "QQ 浏览器"),
    ("MQQBrowser/", "QQ 浏览器（移动）"),
    ("MiuiBrowser/", "小米浏览器"),
    ("MiBrowser/", "小米浏览器"),
    ("HeyTapBrowser/", "OPPO 浏览器"),
    ("VivoBrowser/", "vivo 浏览器"),
    ("HuaweiBrowser/", "华为浏览器"),
    ("baiduboxapp/", "百度 APP"),
    ("baidubrowser/", "百度浏览器"),
    ("SogouMobileBrowser/", "搜狗浏览器"),
    ("MetaSr", "搜狗浏览器"),
    ("QIHU 360", "360 浏览器"),
    ("360SE", "360 浏览器"),
    ("360EE", "360 浏览器"),
    ("SamsungBrowser/", "三星浏览器"),
    ("DuckDuckGo/", "DuckDuckGo"),
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
    ("Windows NT 10.0", "Windows 10/11"),
    ("Windows NT 6.3", "Windows 8.1"),
    ("Windows NT 6.2", "Windows 8"),
    ("Windows NT 6.1", "Windows 7"),
    ("Windows NT 6.0", "Windows Vista"),
    ("Windows NT 5.1", "Windows XP"),
    ("Windows NT 5.2", "Windows XP 64 / Server 2003"),
    ("Windows Phone", "Windows Phone"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("iPhone OS", "iOS"),
    ("Android", "Android"),
    ("iPhone", "iOS（iPhone）"),
    ("iPad", "iOS（iPad）"),
    ("CrOS", "ChromeOS"),
    ("FreeBSD", "FreeBSD"),
    ("Linux", "Linux"),
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
            elif token == "iPhone OS":
                m = re.search(r"iPhone OS\s+([\d_]+)", raw)
                if m:
                    os_label = f"iOS {m.group(1).replace('_', '.')}"
            break
    if "iPad" in raw or "Tablet" in raw:
        device_type = "平板"
    elif "Mobile" in raw or "iPhone" in raw or "Android" in raw:
        if "Android" in raw and "Mobile" not in raw:
            device_type = "平板（安卓未带 Mobile 标记）"
        else:
            device_type = "手机 / 移动端"
    else:
        device_type = "桌面端"
    return {
        "browser": f"{browser} {version}".strip() if version else browser,
        "os": os_label,
        "device_type": device_type,
        "raw": raw[:255],
    }


# ---------------------------------------------------------------------------
# 设备识别（确定性查表 + 弱信号倾向判断）
# ---------------------------------------------------------------------------


def extract_gpu_name(renderer: str) -> str:
    """从 WebGL renderer 字符串提取可读 GPU 名。

    典型输入：`ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)`
    输出：`Intel(R) UHD Graphics`；无法解析时原样截断返回。
    """
    if not renderer:
        return ""
    desc = renderer.strip()
    m = _ANGLE_RE.search(desc)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        desc = parts[1] if len(parts) > 1 else desc
        if "Metal Renderer:" in desc:
            desc = desc.split("Metal Renderer:", 1)[1]
    for token in (" Direct3D", " OpenGL", " Vulkan", " Metal Renderer"):
        idx = desc.find(token)
        if idx > 0:
            desc = desc[:idx]
    desc = _HEX_ADDR_RE.sub("", desc)
    return desc.strip(" ,")[:80]


def classify_gpu(renderer: str) -> str:
    """按关键词把 GPU 分为 独立显卡 / 集成显卡 / ''（判断不了）。"""
    if not renderer:
        return ""
    for token in _GPU_DISCRETE_TOKENS:
        if token in renderer:
            return "独立显卡"
    for token in _GPU_INTEGRATED_TOKENS:
        if token in renderer:
            return "集成显卡"
    return ""


def _android_brand(model: str, ua: str) -> str:
    value = (model or "").strip()
    if value:
        for pattern, brand in _ANDROID_BRANDS:
            try:
                if re.search(pattern, value, re.IGNORECASE):
                    return brand
            except Exception:
                continue
    ua_l = ua or ""
    for token, brand in _ANDROID_UA_BRANDS:
        if token in ua_l:
            return brand
    return ""


def _parse_scr(summary: dict) -> tuple[int, int]:
    m = re.match(r"^\s*(\d+)\s*[x×*]\s*(\d+)\s*$", str(summary.get("scr", "")), re.IGNORECASE)
    if not m:
        return 0, 0
    w, h = int(m.group(1)), int(m.group(2))
    return min(w, h), max(w, h)


def _pv_major(summary: dict) -> float | None:
    try:
        return float(str(summary.get("pv", "")).strip().split(".")[0])
    except Exception:
        return None


def identify_device(summary: dict, ua: str = "") -> dict:
    """从摘要 + UA 确定性识别设备。

    返回 {device_type, brand, model, os_version, confidence, confidence_note,
          hints, short_name}。confidence ∈ 确定 / 倾向 / 推测 / 未知；
    short_name 为空表示信息不足（供昵称走诗意外号兜底）。
    """
    os_raw = str(summary.get("os", "")).strip().lower()
    ua_l = (ua or "").strip().lower()
    combined = f"{os_raw} {ua_l}"
    if "windows" in combined or "win32" in combined:
        return _identify_windows(summary, ua)
    if "mac" in combined and "iphone" not in combined and "ipad" not in combined:
        return _identify_mac(summary)
    if "iphone" in combined or "ipad" in combined or "ios" in combined:
        return _identify_ios(summary, ua)
    # 安卓手机的 navigator.platform 是 "Linux armv8l/aarch64"，必须先于 Linux 判断；
    # x86 桌面 Linux 几乎不会报 ARM 平台，桌面 ARM Linux 极罕见可忽略
    if "android" in combined or re.search(r"armv[4-8]|aarch64", combined):
        return _identify_android(summary, ua)
    if "cros" in combined or "chrome os" in combined:
        return {
            "device_type": "台式机 / 笔记本", "brand": "ChromeOS 设备", "model": "",
            "os_version": "", "confidence": "倾向",
            "confidence_note": "平台标识指向 ChromeOS，类型无法细分",
            "hints": [], "short_name": "ChromeOS",
        }
    if "linux" in combined:
        return {
            "device_type": "台式机 / 笔记本", "brand": "Linux 设备", "model": "",
            "os_version": "", "confidence": "倾向",
            "confidence_note": "平台标识指向 Linux，类型无法细分",
            "hints": [], "short_name": "Linux",
        }
    return {
        "device_type": "未知", "brand": "未知", "model": "", "os_version": "",
        "confidence": "未知", "confidence_note": "平台标识缺失，无法识别",
        "hints": [], "short_name": "",
    }


def _summary_hints(summary: dict, ua: str = "") -> list[str]:
    hints: list[str] = []
    try:
        touch = int(float(str(summary.get("touch", "")).strip() or 0))
    except Exception:
        touch = 0
    if touch > 0:
        hints.append(f"支持触屏（{touch} 点）")
    try:
        mem = float(str(summary.get("mem", "")).strip() or 0)
    except Exception:
        mem = 0
    if mem > 0:
        hints.append(f"内存档位 {mem:g} GB（浏览器封顶 8）")
    if str(summary.get("bat", "")).strip() in ("1", "true"):
        hints.append("检测到电池（笔记本强信号）")
    arch = str(summary.get("arch", "")).strip()
    bit = str(summary.get("bit", "")).strip()
    if arch:
        hints.append(f"CPU 架构 {arch}{f' · {bit} 位' if bit else ''}")
    return hints


def _gpu_context(summary: dict) -> tuple[str, str]:
    """返回 (GPU 可读名, 显卡分类)。"""
    gpu_raw = str(summary.get("gpu", "")).strip()
    return extract_gpu_name(gpu_raw), classify_gpu(gpu_raw)


def _identify_windows(summary: dict, ua: str) -> dict:
    major = _pv_major(summary)
    if major is not None and major >= 13:
        os_version, version_conf = "Windows 11", "确定"
    elif major is not None:
        os_version, version_conf = "Windows 10", "确定"
    else:
        os_version, version_conf = "Windows 10/11", "推测"
    gpu_name, gpu_kind = _gpu_context(summary)
    w, h = _parse_scr(summary)
    hints = _summary_hints(summary, ua)
    if gpu_name:
        hints.append(f"GPU：{gpu_name}{f'（{gpu_kind}）' if gpu_kind else ''}")
    try:
        touch = int(float(str(summary.get("touch", "")).strip() or 0))
    except Exception:
        touch = 0
    has_battery = str(summary.get("bat", "")).strip() in ("1", "true")
    laptop_size = (w, h) in _WIN_LAPTOP_SIZES if w else False
    big_screen = w and max(w, h) >= 2560
    if has_battery:
        device_type = "触屏笔电 / 二合一（倾向）" if touch > 0 else "笔记本（倾向）"
        conf, note = "倾向", "Battery API 报告存在电池，笔记本强信号"
        short_name = "Win笔电"
    elif gpu_kind == "独立显卡" and big_screen:
        device_type = "台式机（倾向）"
        conf, note = "倾向", "独立显卡 + 大屏（≥2K），台式机特征"
        short_name = "Win台式"
    elif gpu_kind == "集成显卡" and laptop_size:
        device_type = "笔记本（倾向）"
        conf, note = "倾向", "核显 + 笔记本常见分辨率"
        short_name = "Win笔电"
    elif gpu_kind == "集成显卡" and big_screen:
        device_type = "笔记本 / 台式机"
        conf, note = "推测", "核显 + 大屏：可能是办公台式机或大屏笔电，无法确定"
        short_name = "Win电脑"
    elif touch > 0:
        device_type = "触屏设备（倾向笔电 / 二合一）"
        conf, note = "推测", "Windows 触屏多见于笔电 / 二合一"
        short_name = "Win笔电"
    else:
        device_type = "笔记本 / 台式机"
        conf, note = "推测", "无电池与 GPU 弱信号，无法判断形态"
        short_name = "Win电脑"
    return {
        "device_type": device_type, "brand": "Windows 电脑", "model": "",
        "os_version": os_version, "confidence": conf, "confidence_note": note,
        "hints": hints, "short_name": short_name,
    }


def _identify_mac(summary: dict) -> dict:
    w, h = _parse_scr(summary)
    hints = _summary_hints(summary)
    gpu_name, gpu_kind = _gpu_context(summary)
    if gpu_name and gpu_name.lower() not in ("apple gpu", "apple"):
        hints.append(f"GPU：{gpu_name}")
    model = _MAC_SIZES.get((w, h), "") if w else ""
    major = _pv_major(summary)
    if major is not None and major > 10:
        name = _MACOS_NAMES.get(int(major), "")
        os_version = f"macOS {int(major)}{f'（{name}）' if name else ''}"
    elif major is not None:
        os_version = f"macOS {major:g}"
    else:
        os_version = "macOS"
    if model and ("iMac" in model or "显示器" in model):
        device_type = "台式机 / 一体机（倾向）"
        conf, note = "倾向", f"逻辑分辨率匹配「{model}」"
        short_name = "Mac台式"
    elif model:
        device_type = "笔记本（倾向）"
        conf, note = "倾向", f"逻辑分辨率匹配「{model}」"
        short_name = "MacBook"
    else:
        device_type = "笔记本（Mac 绝大多数为笔记本）"
        conf, note = "推测", "分辨率未收录，按 Mac 整体分布估计"
        short_name = "Mac"
    return {
        "device_type": device_type, "brand": "苹果", "model": model,
        "os_version": os_version, "confidence": conf, "confidence_note": note,
        "hints": hints, "short_name": short_name,
    }


def _identify_ios(summary: dict, ua: str) -> dict:
    ua_l = (ua or "").strip().lower()
    w, h = _parse_scr(summary)
    try:
        dpr = float(str(summary.get("dpr", "")).strip() or 0)
    except Exception:
        dpr = 0
    dpr_key = int(dpr) if dpr and dpr == int(dpr) else (dpr or 0)
    hints = _summary_hints(summary)
    is_ipad = "ipad" in ua_l or "ipad" in str(summary.get("os", "")).lower()
    if not is_ipad and w >= 700 and h >= 1000 and dpr_key <= 2:
        is_ipad = True
    table = _IPAD_SIZES if is_ipad else _IPHONE_SIZES
    model = table.get((w, h, dpr_key), "") if w and dpr_key else ""
    if model:
        conf, note = "确定", f"逻辑分辨率 + DPR 查表命中；同分辨率含多款，标「之一」"
    else:
        model = "iPad（分辨率未收录）" if is_ipad else "iPhone（分辨率未收录）"
        conf, note = "推测", "分辨率 / DPR 未命中收录表，只能判断大类"
    major = _pv_major(summary)
    os_version = f"iOS {int(major)}" if major is not None else "iOS"
    device_type = "平板" if is_ipad else "手机"
    return {
        "device_type": device_type, "brand": "苹果", "model": model,
        "os_version": os_version, "confidence": conf, "confidence_note": note,
        "hints": hints, "short_name": "iPad" if is_ipad else "iPhone",
    }


def _identify_android(summary: dict, ua: str) -> dict:
    model_raw = str(summary.get("model", "")).strip()
    brand = _android_brand(model_raw, ua)
    hints = _summary_hints(summary, ua)
    gpu_name, _ = _gpu_context(summary)
    if gpu_name:
        hints.append(f"GPU：{gpu_name}")
    ua_l = (ua or "").strip().lower()
    model_l = model_raw.lower()
    if "pad" in model_l or "tab" in model_l or ("android" in ua_l and "mobile" not in ua_l):
        device_type = "平板"
        type_note = "安卓 UA 未带 Mobile 标记（平板惯例）或型号含 Pad/Tab"
    else:
        device_type = "手机"
        type_note = "安卓 UA 带 Mobile 标记"
    major = _pv_major(summary)
    os_version = f"Android {int(major)}" if major is not None else "Android"
    if brand:
        conf, brand_label = "推测", f"按型号串「{model_raw}」前缀推测品牌，已标注不确定"
        if model_raw:
            conf = "倾向"
            brand_label = f"型号串「{model_raw}」来自 UA-CH 真实上报；品牌为前缀推测"
    else:
        conf = "倾向" if model_raw else "推测"
        brand_label = "品牌无法判断"
    short_name = ""
    if device_type == "平板":
        short_name = f"{brand}平板" if brand else "安卓平板"
    elif brand:
        brand_short = {"OPPO / 一加系": "OPPO", "小米·红米": "小米", "三星（日运营商版）": "三星"}.get(brand, brand)
        short_name = f"{brand_short}手机"
    else:
        short_name = "安卓手机"
    return {
        "device_type": device_type, "brand": brand,
        "model": model_raw[:60], "os_version": os_version,
        "confidence": conf, "confidence_note": brand_label + "；" + type_note,
        "hints": hints, "short_name": short_name,
    }


def identity_value(ident: dict) -> str:
    """把识别结果拼成一行可读文本。"""
    parts = [str(ident.get("device_type", "")).strip()]
    brand = str(ident.get("brand", "")).strip()
    if brand and brand != "未知":
        parts.append(brand)
    model = str(ident.get("model", "")).strip()
    if model:
        parts.append(model)
    version = str(ident.get("os_version", "")).strip()
    if version:
        parts.append(version)
    return " · ".join(p for p in parts if p) or "未知设备"


def build_profile(summary: dict, top_ua: str = "") -> list[dict]:
    """把摘要翻译成画像条目 [{key, label, value, hint}]；识别结论放最前。"""
    ident = identify_device(summary, top_ua)
    items: list[dict] = [
        {
            "key": "identity",
            "label": "设备识别",
            "value": identity_value(ident),
            "hint": (
                f"置信：{ident.get('confidence', '未知')}。{ident.get('confidence_note', '')}"
                + ("；" + "；".join(ident.get("hints", [])) if ident.get("hints") else "")
                + "；识别仅基于客户端自报信息，可伪造，仅供参考"
            ),
        }
    ]
    os_value, os_hint = translate_os(summary.get("os", ""))
    lang_value, lang_hint = translate_lang(summary.get("lang", ""))
    scr_value, scr_hint = translate_screen(summary.get("scr", ""), summary.get("dpr", ""))
    cores_value, cores_hint = translate_cores(summary.get("cores", ""))
    tz_value, tz_hint = translate_tz(summary.get("tz", ""))
    items.extend(
        [
            {"key": "os", "label": "操作系统", "value": os_value, "hint": os_hint},
            {"key": "lang", "label": "语言", "value": lang_value, "hint": lang_hint},
            {"key": "screen", "label": "屏幕", "value": scr_value, "hint": scr_hint},
            {"key": "cores", "label": "CPU", "value": cores_value, "hint": cores_hint},
            {"key": "tz", "label": "时区", "value": tz_value, "hint": tz_hint},
        ]
    )
    # 新维度：有值才追加（老摘要缺字段自动跳过）
    gpu_name, gpu_kind = _gpu_context(summary)
    gpu_raw = str(summary.get("gpu", "")).strip()
    if gpu_raw:
        items.append(
            {
                "key": "gpu",
                "label": "显卡",
                "value": f"{gpu_name or gpu_raw[:80]}{f'（{gpu_kind}）' if gpu_kind else ''}",
                "hint": "WebGL 渲染器自报；独显多见于台式机 / 游戏本，仅供倾向参考",
            }
        )
    try:
        mem = float(str(summary.get("mem", "")).strip() or 0)
    except Exception:
        mem = 0
    if mem > 0:
        items.append(
            {
                "key": "mem",
                "label": "内存",
                "value": f"约 {mem:g} GB（浏览器档位）",
                "hint": "navigator.deviceMemory，Chrome 封顶 8 GB，仅供分档参考",
            }
        )
    try:
        touch = int(float(str(summary.get("touch", "")).strip() or 0))
        has_touch = True
    except Exception:
        touch, has_touch = 0, False
    if has_touch:
        items.append(
            {
                "key": "touch",
                "label": "触屏",
                "value": f"支持触屏（{touch} 点触控）" if touch > 0 else "无触屏",
                "hint": "maxTouchPoints；Windows 上触屏多见于笔电 / 二合一",
            }
        )
    try:
        cd = int(float(str(summary.get("cd", "")).strip() or 0))
    except Exception:
        cd = 0
    if cd > 0:
        items.append(
            {
                "key": "cd",
                "label": "色深",
                "value": f"{cd} bit",
                "hint": "screen.colorDepth；30/32 位常见于 HDR 或广色域屏",
            }
        )
    langs = str(summary.get("langs", "")).strip()
    if langs:
        n = len([x for x in langs.split(",") if x.strip()])
        items.append(
            {
                "key": "langs",
                "label": "语言列表",
                "value": (langs[:120] + "…") if len(langs) > 120 else langs,
                "hint": f"navigator.languages 完整列表（共 {n} 项），含第二语言可作为区分线索",
            }
        )
    if str(summary.get("bat", "")).strip() in ("1", "true"):
        items.append(
            {
                "key": "bat",
                "label": "电池",
                "value": "检测到电池",
                "hint": "Battery API 报告非默认值；笔记本强信号（仅 Chromium 支持）",
            }
        )
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
