"""Blueprint/page-budget contract shared by writer, validator and tool switch."""

REVEAL_LAYOUTS = {"passage", "questions", "exam"}

BLUEPRINTS = {
    "reading": {
        "name": "阅读课", "tools": {"15", "1", "3", "27", "2", "4"},
        "required": {"cover", "objectives", "passage", "questions", "task", "summary"},
        "recommended": {"pre_reading", "text_structure", "language", "model", "closing"},
        "min_pages": 7, "max_pages": 14, "theme": "paper",
    },
    "continuation": {
        "name": "读后续写", "tools": {"16", "31", "30"},
        "required": {"cover", "story", "six_w", "plan", "support", "model", "writing", "closing"},
        "recommended": {"objectives", "plot", "summary"},
        "min_pages": 8, "max_pages": 12, "theme": "paper",
    },
    "writing": {
        "name": "写作课", "tools": {"9", "11"},
        "required": {"cover", "objectives", "task", "writing", "model", "summary"},
        "recommended": {"support", "pre_reading", "closing"},
        "min_pages": 7, "max_pages": 12, "theme": "paper",
    },
    "grammar": {
        "name": "语法课", "tools": {"8"},
        "required": {"grammar"},
        "recommended": {"cover", "objectives", "language", "task", "summary"},
        "min_pages": 3, "max_pages": 10, "theme": "chalk",
    },
    "vocabulary": {
        "name": "词汇课", "tools": {"5", "6", "7", "28", "29"},
        "required": {"language"},
        "recommended": {"cover", "objectives", "task", "summary", "model"},
        "min_pages": 3, "max_pages": 10, "theme": "paper",
    },
    "exam_review": {
        "name": "试卷讲评", "tools": {"12", "14", "22"},
        "required": {"exam"},
        "recommended": {"cover", "objectives", "language", "summary"},
        "min_pages": 3, "max_pages": 16, "theme": "chalk",
    },
    "writing_feedback": {
        "name": "作文批改", "tools": {"10"},
        "required": {"questions"},
        "recommended": {"cover", "objectives", "language", "model", "summary"},
        "min_pages": 3, "max_pages": 12, "theme": "paper",
    },
    "generic_lesson": {
        "name": "通用课", "tools": set(),
        "required": {"cover"}, "recommended": {"objectives", "task", "summary"},
        "min_pages": 1, "max_pages": 12, "theme": "paper",
    },
}

TOOL_BLUEPRINTS = {
    tool: key for key, bp in BLUEPRINTS.items() for tool in bp["tools"]
}

# Tools with a dedicated view / no blueprint in P1.
NO_PRESENTATION_TOOLS = {"13", "17", "19", "21", "23", "24", "25", "32", "33"}


def blueprint_for_tool(tool_id: str) -> str | None:
    return TOOL_BLUEPRINTS.get(str(tool_id))


def supports_presentation(tool_id: str, enabled: bool = True) -> bool:
    return enabled and str(tool_id) in TOOL_BLUEPRINTS and str(tool_id) not in NO_PRESENTATION_TOOLS
