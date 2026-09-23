"""工具与模型目录：与 backend/app/routers/tools.py 保持逐字段一致的测试数据。

一致性由 tests/test_mock_backend.py 守护——真实目录任何字段变化都会让测试失败，
提醒同步更新这里，避免假后端悄悄失配。
"""

from __future__ import annotations

from app.services.migration import MIGRATION_TOOL_ID, MIGRATION_TOOL_NAME

# 分组顺序、折叠态与 tools.py 的 TOOL_GROUPS 完全一致
TOOL_GROUPS: list[dict] = [
    {
        "id": "exclusive",
        "title": "独家功能",
        "collapsed": False,
        "tools": [
            {
                "id": MIGRATION_TOOL_ID,
                "name": MIGRATION_TOOL_NAME,
                "icon": "migration",
                "description": "锁定本质错因，讲懂方法并生成高质量迁移练习",
                "prompt_filename": "智能错题迁移.md",
            },
        ],
    },
    {
        "id": "teaching",
        "title": "备课与教学",
        "collapsed": False,
        "tools": [
            {"id": "1", "name": "语篇深度分析", "icon": "document-magnifier", "description": "主题/文体/语言特点/观点分析", "prompt_filename": "语篇深度分析.md"},
            {"id": "2", "name": "言说策略分析", "icon": "speech-bubble", "description": "语篇中“怎么说”的策略分析", "prompt_filename": "言说策略分析.md"},
            {"id": "3", "name": "语篇深度研读报告", "icon": "report", "description": "What/Why/How 维度的研读报告", "prompt_filename": "语篇深度研读报告.md"},
            {"id": "4", "name": "课文语言点讲解", "icon": "vocabulary", "description": "基于语篇结构化知识的语言点讲解", "prompt_filename": "课文语言点讲解.md"},
            {"id": "5", "name": "地道表达转述释义", "icon": "translate", "description": "提取并释义地道表达", "prompt_filename": "地道表达转述释义.md"},
            {"id": "6", "name": "词汇分类教学", "icon": "tags", "description": "词汇分类 + 功能化教学材料", "prompt_filename": "词汇分类教学.md"},
            {"id": "7", "name": "词块提取与讲解", "icon": "puzzle", "description": "高价值词块提取 + 讲解", "prompt_filename": "词块提取与讲解.md"},
            {"id": "8", "name": "语法情境教学", "icon": "grammar", "description": "语法点在真实情境中的教学设计", "prompt_filename": "语法情境教学.md"},
            {"id": "9", "name": "英文写作教学", "icon": "writing", "description": "通用写作（记叙/议论/概要）支架与范文", "prompt_filename": "英文写作教学.md"},
            {"id": "10", "name": "学生作文批改", "icon": "correction", "description": "评分 + 修改建议 + 改进版本", "prompt_filename": "学生作文批改.md"},
            {"id": "11", "name": "辅助应用文写作", "icon": "letter", "description": "6 篇分层范文 + 错误点评 + 练习", "prompt_filename": "辅助应用文写作.md"},
            {"id": "12", "name": "试卷重点题讲评", "icon": "target", "description": "错题分析 + 解题范式 + 迁移训练", "prompt_filename": "试卷重点题讲评.md"},
            {"id": "13", "name": "试卷可视化全解", "icon": "projector", "description": "整卷题目与解析的课堂投影版", "prompt_filename": "试卷可视化全解.md"},
            {"id": "14", "name": "榨干一套英语试卷", "icon": "sparkle", "description": "词类活用 / 熟词生义 / 长难句 / 画面感", "prompt_filename": "榨干一套英语试卷.md"},
            {"id": "15", "name": "阅读课教学设计", "icon": "book-open", "description": "课堂教学方案设计", "prompt_filename": "阅读课教学设计.md"},
            {"id": "16", "name": "读写整合教学设计", "icon": "read-write", "description": "读后续写 / 读写整合课设计", "prompt_filename": "读写整合教学设计.md"},
            {"id": "27", "name": "教考衔接文本解读", "icon": "link", "description": "文本解读 / 教学设计 / 语用设问 / 思维培养四层面分析", "prompt_filename": "教考衔接文本解读.md"},
            {"id": "28", "name": "优质例句创研工坊", "icon": "lightbulb", "description": "贴近学生生活、对接写作场景的例句创作", "prompt_filename": "优质例句创研工坊.md"},
            {"id": "29", "name": "依托语境的词汇练习", "icon": "list-checks", "description": "每词一道依托完整语境的词汇选择题", "prompt_filename": "依托语境的词汇练习.md"},
            {"id": "30", "name": "隐性写作知识显性化", "icon": "eye", "description": "Meaning→Structure→Language 显化写作知识", "prompt_filename": "隐性写作知识显性化.md"},
            {"id": "31", "name": "读后续写审题指导", "icon": "route", "description": "六个 W 梳理情节 + 两段续写功能规划", "prompt_filename": "读后续写审题指导.md"},
        ],
    },
    {
        "id": "proposition",
        "title": "命题与试题分析",
        "collapsed": False,
        "tools": [
            {"id": "17", "name": "阅读文本改编", "icon": "edit-1", "description": "改写为高考阅读文本", "prompt_filename": "阅读文本改编.md"},
            {"id": "18", "name": "阅读文本改编 2", "icon": "edit-2", "description": "更符合高考要求的改编版本", "prompt_filename": "阅读文本改编 2.md"},
            {"id": "19", "name": "阅读理解设问", "icon": "question", "description": "语篇功能 / 主线 / 概括转述设问", "prompt_filename": "阅读理解设问.md"},
            {"id": "20", "name": "阅读理解设问 2", "icon": "question-2", "description": "另一变体", "prompt_filename": "阅读理解设问 2.md"},
            {"id": "21", "name": "辅助完形填空命题", "icon": "cloze", "description": "完形设空 + 选项 + 答案解析", "prompt_filename": "辅助完形填空命题.md"},
            {"id": "22", "name": "试题解读分析", "icon": "analysis", "description": "选材立意 / 能力考查 / 教学引导", "prompt_filename": "试题解读分析.md"},
            {"id": "23", "name": "英语试题 Bug 侦察", "icon": "bug", "description": "拼写 / 标点 / 中式英语 / 逻辑漏洞", "prompt_filename": "英语试题 Bug 侦察.md"},
            {"id": "24", "name": "超标词排查+替换", "icon": "replace", "description": "机器排查课标外词汇 + AI 一键替换", "prompt_filename": "超标词替换.md"},
        ],
    },
    {
        "id": "reference",
        "title": "通用工具",
        "collapsed": False,
        "tools": [
            {"id": "25", "name": "自由对话", "icon": "chat", "description": "通用 LLM 对话，提示词调试用", "prompt_filename": "自由对话.md"},
            {"id": "32", "name": "识别图片文字", "icon": "scan-text", "description": "图片转文字（试卷、手写作文）", "prompt_filename": "识别图片文字-印刷试卷.md"},
            {"id": "33", "name": "翻译", "icon": "languages", "description": "原文译文对照，支持试卷、作文、文档", "prompt_filename": "翻译.md"},
        ],
    },
]

# 默认模型故意选「免费 + 免码」：未输入使用码也能立刻开跑，测起来最快。
# 需要测使用码门禁时，在模型下拉里切到 mock/mock-pro（付费）。
DEFAULT_MODEL = "mock/mock-flash"
# 与真实后端一致的含义：0 = 不折叠；这里故意给非 0 值，让模型下拉的折叠/展开路径被测到
MAX_VISIBLE_MODELS = 3

MODELS: list[dict] = [
    {"id": "mock/mock-flash", "name": "假模型 · Flash", "description": "假后端默认，免费且免码", "score": 88, "is_free": True, "free_no_code": True},
    {"id": "mock/mock-pro", "name": "假模型 · Pro", "description": "付费假模型，用于测使用码门禁", "score": 92, "is_free": False, "free_no_code": False},
    {"id": "mock/mock-reasoning", "name": "假模型 · 深度思考", "description": "带推理过程，用于测思考面板", "score": 90, "is_free": False, "free_no_code": False},
    {"id": "mock/mock-long", "name": "假模型 · 长文", "description": "输出超长，用于测折叠与渲染性能", "score": 85, "is_free": True, "free_no_code": True},
    {"id": "mock/mock-slow", "name": "假模型 · 慢速", "description": "每 token 间隔 200ms，用于测流式与停止", "score": 80, "is_free": True, "free_no_code": True},
]

# 选中这些模型即自动套用对应场景，省得每次手写指令
MODEL_SCENARIOS: dict[str, str] = {
    "mock/mock-slow": "slow",
    "mock/mock-long": "long",
    "mock/mock-reasoning": "reasoning-heavy",
}

APP_NAME = "NeoBangX"
APP_VERSION = "1.2.0"
SLOGAN = "Bang助教学，大有可AI"

# 工具 id -> prompts/ 下的文件名（与 tools.py._resolve_prompt_filename 一致）
PROMPT_FILENAMES: dict[str, str] = {
    "1": "语篇深度分析", "2": "言说策略分析", "3": "语篇深度研读报告", "4": "课文语言点讲解",
    "5": "地道表达转述释义", "6": "词汇分类教学", "7": "词块提取与讲解", "8": "语法情境教学",
    "9": "英文写作教学", "10": "学生作文批改", "11": "辅助应用文写作", "12": "试卷重点题讲评",
    "13": "试卷可视化全解", "14": "榨干一套英语试卷", "15": "阅读课教学设计", "16": "读写整合教学设计",
    "27": "教考衔接文本解读", "28": "优质例句创研工坊", "29": "依托语境的词汇练习", "30": "隐性写作知识显性化",
    "31": "读后续写审题指导", "17": "阅读文本改编", "18": "阅读文本改编 2", "19": "阅读理解设问",
    "20": "阅读理解设问 2", "21": "辅助完形填空命题", "22": "试题解读分析", "23": "英语试题 Bug 侦察",
    "24": "超标词替换", "25": "自由对话", "32": "识别图片文字-印刷试卷", "33": "翻译",
    MIGRATION_TOOL_ID: MIGRATION_TOOL_NAME,
}

# OCR 工具 id 与两种识别模式的提示词文件名（与 tools.py 的 OCR_MODE_PROMPTS 一致）
OCR_TOOL_ID = "32"
OCR_MODE_PROMPTS: dict[str, str] = {
    "printed": "识别图片文字-印刷试卷",
    "handwritten": "识别图片文字-手写作文",
}

# 可视化试卷工具的 tool_id（tool 13）：内容模板按它切换到 @@TAG@@ 格式
VISUAL_PAPER_TOOL_ID = "13"
# 智能错题迁移的 tool_id
MIGRATION_TOOL = MIGRATION_TOOL_ID
# 超标词排查的 tool_id（前端在这里发一次非流式的替换流）
VOCAB_TOOL_ID = "24"


def all_tools() -> list[dict]:
    """扁平化全部工具（按分组顺序）。"""
    return [t for g in TOOL_GROUPS for t in g["tools"]]


def find_tool(tool_id: str) -> dict | None:
    for t in all_tools():
        if t["id"] == str(tool_id):
            return t
    return None


def tools_payload() -> dict:
    """与真实 /api/tools/ 响应同构：groups[].tools 带 prompt_loaded。"""
    groups = []
    for g in TOOL_GROUPS:
        tools = []
        for t in g["tools"]:
            tools.append({
                "id": t["id"],
                "name": t["name"],
                "icon": t["icon"],
                "description": t["description"],
                "prompt_filename": t["prompt_filename"],
                "prompt_loaded": True,
            })
        groups.append({"id": g["id"], "title": g["title"], "collapsed": g["collapsed"], "tools": tools})
    return {
        "groups": groups,
        "models": [dict(m) for m in MODELS],
        "default_model": DEFAULT_MODEL,
        "max_visible_models": MAX_VISIBLE_MODELS,
    }


def models_payload() -> dict:
    """与真实 /api/tools/models 同构（注意这里键名是 label 不是 name）。"""
    return {
        "models": [
            {
                "id": m["id"],
                "label": m["name"],
                "description": m["description"],
                "score": m["score"],
                "is_free": m["is_free"],
                "free_no_code": m["free_no_code"],
            }
            for m in MODELS
        ],
        "default_model": DEFAULT_MODEL,
    }
