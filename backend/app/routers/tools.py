from typing import Annotated, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.prompt_loader import PromptLoader
from app.services.runtime_config import resolve_llm_settings
from app.config import settings

router = APIRouter(prefix="/api/tools", tags=["tools"])


def get_prompt_loader() -> PromptLoader:
    # 使用单例模式，避免每次请求重新加载
    if not hasattr(get_prompt_loader, "_instance"):
        get_prompt_loader._instance = PromptLoader(settings.prompts_dir)
    return get_prompt_loader._instance


# 工具分组数据
# 工具 id 与 prompts/ 目录下的文件名（不含 .md）一一对应
TEACHING_TOOLS = [
    {"id": "1", "name": "语篇深度分析", "icon": "document-magnifier", "description": "主题/文体/语言特点/观点分析"},
    {"id": "2", "name": "言说策略分析", "icon": "speech-bubble", "description": "语篇中“怎么说”的策略分析"},
    {"id": "3", "name": "语篇深度研读报告", "icon": "report", "description": "What/Why/How 维度的研读报告"},
    {"id": "4", "name": "课文语言点讲解", "icon": "vocabulary", "description": "基于语篇结构化知识的语言点讲解"},
    {"id": "5", "name": "地道表达转述释义", "icon": "translate", "description": "提取并释义地道表达"},
    {"id": "6", "name": "词汇分类教学", "icon": "tags", "description": "词汇分类 + 功能化教学材料"},
    {"id": "7", "name": "词块提取与讲解", "icon": "puzzle", "description": "高价值词块提取 + 讲解"},
    {"id": "8", "name": "语法情境教学", "icon": "grammar", "description": "语法点在真实情境中的教学设计"},
    {"id": "9", "name": "英文写作教学", "icon": "writing", "description": "通用写作（记叙/议论/概要）支架与范文"},
    {"id": "10", "name": "学生作文批改", "icon": "correction", "description": "评分 + 修改建议 + 改进版本"},
    {"id": "11", "name": "辅助应用文写作", "icon": "letter", "description": "6 篇分层范文 + 错误点评 + 练习"},
    {"id": "12", "name": "试卷重点题讲评", "icon": "target", "description": "错题分析 + 解题范式 + 迁移训练"},
    {"id": "13", "name": "试卷可视化全解", "icon": "projector", "description": "整卷题目与解析的课堂投影版"},
    {"id": "14", "name": "榨干一套英语试卷", "icon": "sparkle", "description": "词类活用 / 熟词生义 / 长难句 / 画面感"},
    {"id": "15", "name": "阅读课教学设计", "icon": "book-open", "description": "课堂教学方案设计"},
    {"id": "16", "name": "读写整合教学设计", "icon": "read-write", "description": "读后续写 / 读写整合课设计"},
]

PROPOSITION_TOOLS = [
    {"id": "17", "name": "阅读文本改编", "icon": "edit-1", "description": "改写为高考阅读文本"},
    {"id": "18", "name": "阅读文本改编 2", "icon": "edit-2", "description": "更符合高考要求的改编版本"},
    {"id": "19", "name": "阅读理解设问", "icon": "question", "description": "语篇功能 / 主线 / 概括转述设问"},
    {"id": "20", "name": "阅读理解设问 2", "icon": "question-2", "description": "另一变体"},
    {"id": "21", "name": "辅助完形填空命题", "icon": "cloze", "description": "完形设空 + 选项 + 答案解析"},
    {"id": "22", "name": "试题解读分析", "icon": "analysis", "description": "选材立意 / 能力考查 / 教学引导"},
    {"id": "23", "name": "英语试题 Bug 侦察", "icon": "bug", "description": "拼写 / 标点 / 中式英语 / 逻辑漏洞"},
    {"id": "24", "name": "超标词排查+替换", "icon": "replace", "description": "课标词排查 + 替换方案"},
]

REFERENCE_TOOLS = [
    {"id": "25", "name": "自由对话", "icon": "chat", "description": "通用 LLM 对话，提示词调试用"},
]


def _resolve_prompt_filename(tool_id: str) -> str:
    """将工具 id 映射到 prompts/ 目录下的文件名"""
    mapping = {
        "1": "语篇深度分析",
        "2": "言说策略分析",
        "3": "语篇深度研读报告",
        "4": "课文语言点讲解",
        "5": "地道表达转述释义",
        "6": "词汇分类教学",
        "7": "词块提取与讲解",
        "8": "语法情境教学",
        "9": "英文写作教学",
        "10": "学生作文批改",
        "11": "辅助应用文写作",
        "12": "试卷重点题讲评",
        "13": "试卷可视化全解",
        "14": "榨干一套英语试卷",
        "15": "阅读课教学设计",
        "16": "读写整合教学设计",
        "17": "阅读文本改编",
        "18": "阅读文本改编 2",
        "19": "阅读理解设问",
        "20": "阅读理解设问 2",
        "21": "辅助完形填空命题",
        "22": "试题解读分析",
        "23": "英语试题 Bug 侦察",
        "24": "超标词排查+替换",
        "25": "自由对话",
    }
    return mapping.get(tool_id, "")


class ToolGroupResponse(BaseModel):
    id: str
    name: str
    icon: str
    description: str
    prompt_filename: str


class ToolGroupsResponse(BaseModel):
    groups: List[dict]
    models: List[dict]
    default_model: str


@router.get("/", response_model=ToolGroupsResponse)
async def list_tools(
    db: Annotated[Session, Depends(get_db)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """返回所有工具元数据、分组信息及可用模型列表"""

    def enrich(tools):
        return [
            {
                "id": t["id"],
                "name": t["name"],
                "icon": t["icon"],
                "description": t["description"],
                "prompt_filename": _resolve_prompt_filename(t["id"]) + ".md",
                "prompt_loaded": loader.get(_resolve_prompt_filename(t["id"])) is not None,
            }
            for t in tools
        ]

    groups = [
        {
            "id": "teaching",
            "title": "辅助教学功能",
            "collapsed": False,
            "tools": enrich(TEACHING_TOOLS),
        },
        {
            "id": "proposition",
            "title": "辅助命题功能",
            "collapsed": False,
            "tools": enrich(PROPOSITION_TOOLS),
        },
        {
            "id": "reference",
            "title": "参考技能",
            "collapsed": False,
            "tools": enrich(REFERENCE_TOOLS),
        },
    ]

    llm_cfg = resolve_llm_settings(db)
    return {
        "groups": groups,
        "models": [{"id": m["id"], "name": m["name"]} for m in llm_cfg["models"]],
        "default_model": llm_cfg["default_model"],
    }


@router.get("/models")
async def list_models(db: Annotated[Session, Depends(get_db)]):
    """返回可用模型列表"""
    llm_cfg = resolve_llm_settings(db)
    return {
        "models": [
            {
                "id": m["id"],
                "label": m["name"],
            }
            for m in llm_cfg["models"]
        ],
        "default_model": llm_cfg["default_model"],
    }
