"""Blueprint/page-budget contract shared by writer, validator and tool switch.

页数区间按「一个教学单元（一篇语篇/一个专题）」标定（样片：阅读 11 页、
续写 9 页），上限留出可选页与 staged 揭晓页的余量。材料包含多篇语篇（如整张
试卷）时合并在同一份演示文稿里：写作者在 deck 顶层 units 声明单元数，页数
预算随单元数扩展，避免"整卷分析"被单课区间卡死。
"""

REVEAL_LAYOUTS = {"passage", "questions", "exam"}

# 多单元合并成一份演示文稿时的页数额度：units 每多 1，区间两端各加一份。
PER_UNIT_MIN_PAGES = 3
PER_UNIT_MAX_PAGES = 10
MAX_UNITS = 12

BLUEPRINTS = {
    "reading": {
        "name": "阅读课", "tools": {"15", "1", "3", "27", "2", "4"},
        "required": {"cover", "objectives", "passage", "questions", "task", "summary"},
        "recommended": {"pre_reading", "text_structure", "language", "model", "closing"},
        "min_pages": 7, "max_pages": 16, "theme": "paper",
    },
    "continuation": {
        "name": "读后续写", "tools": {"16", "31", "30"},
        "required": {"cover", "story", "six_w", "plan", "support", "model", "writing", "closing"},
        "recommended": {"objectives", "plot", "summary"},
        "min_pages": 8, "max_pages": 14, "theme": "paper",
    },
    "writing": {
        "name": "写作课", "tools": {"9", "11"},
        "required": {"cover", "objectives", "task", "writing", "model", "summary"},
        "recommended": {"support", "pre_reading", "closing"},
        "min_pages": 7, "max_pages": 14, "theme": "paper",
    },
    "grammar": {
        "name": "语法课", "tools": {"8"},
        "required": {"grammar"},
        "recommended": {"cover", "objectives", "language", "task", "summary"},
        "min_pages": 3, "max_pages": 12, "theme": "chalk",
    },
    "vocabulary": {
        "name": "词汇课", "tools": {"5", "6", "7", "28", "29"},
        "required": {"language"},
        "recommended": {"cover", "objectives", "task", "summary", "model"},
        "min_pages": 3, "max_pages": 12, "theme": "paper",
    },
    "exam_review": {
        "name": "试卷讲评", "tools": {"12", "14", "22"},
        "required": {"exam"},
        "recommended": {"cover", "objectives", "language", "summary"},
        "min_pages": 3, "max_pages": 20, "theme": "chalk",
    },
    "writing_feedback": {
        "name": "作文批改", "tools": {"10"},
        "required": {"questions"},
        "recommended": {"cover", "objectives", "language", "model", "summary"},
        "min_pages": 3, "max_pages": 14, "theme": "paper",
    },
    "generic_lesson": {
        "name": "通用课", "tools": set(),
        "required": {"cover"}, "recommended": {"objectives", "task", "summary"},
        "min_pages": 1, "max_pages": 16, "theme": "paper",
    },
}

TOOL_BLUEPRINTS = {
    tool: key for key, bp in BLUEPRINTS.items() for tool in bp["tools"]
}

# Tools with a dedicated view / no blueprint in P1.
NO_PRESENTATION_TOOLS = {"13", "17", "19", "21", "23", "24", "25", "32", "33"}


def page_budget(blueprint: str, units: int = 1) -> tuple[int, int]:
    """该 blueprint 在给定教学单元数下的展开页数区间；units 超上限时按上限算。"""
    bp = BLUEPRINTS[blueprint]
    extra = max(0, min(int(units or 1), MAX_UNITS) - 1)
    return (bp["min_pages"] + extra * PER_UNIT_MIN_PAGES,
            bp["max_pages"] + extra * PER_UNIT_MAX_PAGES)


def blueprint_for_tool(tool_id: str) -> str | None:
    return TOOL_BLUEPRINTS.get(str(tool_id))


def supports_presentation(tool_id: str, enabled: bool = True) -> bool:
    return enabled and str(tool_id) in TOOL_BLUEPRINTS and str(tool_id) not in NO_PRESENTATION_TOOLS
