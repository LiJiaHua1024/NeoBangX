from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.free_access import identity_key
from app.services.prompt_loader import PromptLoader
from app.services.rate_limit import enforce_rate_limit
from app.services.request_log import get_client_info, get_fingerprint_info
from app.services.runtime_config import resolve_llm_settings
from app.services.tool_search import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MAX_QUERY_CHARS,
    MIN_QUERY_CHARS,
    flatten_tools,
    search_tools,
)
from app.config import settings
from app.services.migration import MIGRATION_TOOL_ID, MIGRATION_TOOL_NAME

router = APIRouter(prefix="/api/tools", tags=["tools"])


def get_prompt_loader() -> PromptLoader:
    # 使用单例模式，避免每次请求重新加载
    if not hasattr(get_prompt_loader, "_instance"):
        get_prompt_loader._instance = PromptLoader(settings.prompts_dir)
    return get_prompt_loader._instance


# 工具分组数据
# 工具 id 与 prompts/ 目录下的文件名（不含 .md）一一对应
EXCLUSIVE_TOOLS = [
    {
        "id": MIGRATION_TOOL_ID,
        "name": MIGRATION_TOOL_NAME,
        "icon": "migration",
        "description": "锁定本质错因，讲懂方法并生成高质量迁移练习",
    },
    {
        "id": "34",
        "name": "语篇结构与主旨反推",
        "icon": "git-branch",
        "description": "基于高考典型结构图谱，判定语篇类型、拆解篇章骨架并反推主旨",
    },
]

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
    {"id": "27", "name": "教考衔接文本解读", "icon": "link", "description": "文本解读 / 教学设计 / 语用设问 / 思维培养四层面分析"},
    {"id": "28", "name": "优质例句创研工坊", "icon": "lightbulb", "description": "贴近学生生活、对接写作场景的例句创作"},
    {"id": "29", "name": "依托语境的词汇练习", "icon": "list-checks", "description": "每词一道依托完整语境的词汇选择题"},
    {"id": "30", "name": "隐性写作知识显性化", "icon": "eye", "description": "Meaning→Structure→Language 显化写作知识"},
    {"id": "31", "name": "读后续写审题指导", "icon": "route", "description": "六个 W 梳理情节 + 两段续写功能规划"},
]

PROPOSITION_TOOLS = [
    {"id": "17", "name": "阅读文本改编", "icon": "edit-1", "description": "高考阅读文本改编 + 词汇真实化改造"},
    {"id": "19", "name": "阅读理解设问", "icon": "question", "description": "双版本命题（标准化 / 思辨）+ 鉴别指引，多篇语篇逐篇同出"},
    {"id": "21", "name": "辅助完形填空命题", "icon": "cloze", "description": "完形设空 + 选项 + 答案解析"},
    {"id": "22", "name": "试题解读分析", "icon": "analysis", "description": "选材立意 / 能力考查 / 教学引导"},
    {"id": "23", "name": "英语试题 Bug 侦察", "icon": "bug", "description": "拼写 / 标点 / 中式英语 / 逻辑漏洞"},
    {"id": "24", "name": "超标词排查+替换", "icon": "replace", "description": "机器排查课标外词汇 + AI 一键替换"},
]

REFERENCE_TOOLS = [
    {"id": "25", "name": "自由对话", "icon": "chat", "description": "个性化自定义需求，工具清单外的教学任务兜底"},
    {
        "id": "32",
        "name": "识别图片文字",
        "icon": "scan-text",
        "description": "图片转文字（试卷、手写作文）",
    },
    {
        "id": "33",
        "name": "翻译",
        "icon": "languages",
        "description": "原文译文对照，支持试卷、作文、文档",
    },
]

# Chores 系列工作：供工具推理规则等后台配置管理
TITLE_TOOL_ID = "title"
TITLE_TOOL_NAME = "生成标题"

VISUAL_FRAMEWORK_TOOL_ID = "visual_framework"
VISUAL_FRAMEWORK_TOOL_NAME = "可视化试卷全解框架"

DEVICE_PROFILE_TOOL_ID = "device_profile"
DEVICE_PROFILE_TOOL_NAME = "设备画像分析"

# 报错解读：生成失败时把上游报错转写成给用户看的两句话（见 app/services/error_explain.py）。
# 它同样是一次 Chores 调用，所以也注册成一个「Chores 工作」——推理等级由管理后台按模型配
# （有些模型关推理写 off、有些写 none，代码里不做任何硬编码，只透传你配的值）。
ERROR_EXPLAIN_TOOL_ID = "error_explain"
ERROR_EXPLAIN_TOOL_NAME = "报错解读"

CHORES_TOOLS = [
    {
        "id": TITLE_TOOL_ID,
        "name": TITLE_TOOL_NAME,
        "icon": "sparkle",
        "description": "历史记录与会话标题生成",
    },
    {
        "id": VISUAL_FRAMEWORK_TOOL_ID,
        "name": VISUAL_FRAMEWORK_TOOL_NAME,
        "icon": "projector",
        "description": "试卷可视化全解第一阶段结构插标",
    },
    {
        "id": DEVICE_PROFILE_TOOL_ID,
        "name": DEVICE_PROFILE_TOOL_NAME,
        "icon": "user",
        "description": "后台设备列表生成 AI 用户画像",
    },
    {
        "id": ERROR_EXPLAIN_TOOL_ID,
        "name": ERROR_EXPLAIN_TOOL_NAME,
        "icon": "bug",
        "description": "生成失败时把上游报错转写成给用户看的两句话",
    },
]

# 翻译（工具 33）：工具本身只固定「对照翻译」这件事，语言对由请求带入
# （ChatRequest.source_lang / target_lang），与 OCR 一条工具两种模式同理。
TRANSLATE_TOOL_ID = "33"
TRANSLATE_TOOL_NAME = "翻译"

# 自由对话（工具 25）：逐请求注入工具目录，供模型在用户找工具时推荐（见 build_tool_catalog）
FREEFORM_TOOL_ID = "25"

# 图片 OCR：一条工具、两种识别模式，各自对应一份提示词文件
OCR_TOOL_ID = "32"
OCR_TOOL_NAME = "识别图片文字"
OCR_MODES = ("printed", "handwritten")
DEFAULT_OCR_MODE = "printed"
OCR_MODE_PROMPTS = {
    "printed": "识别图片文字-印刷试卷",
    "handwritten": "识别图片文字-手写作文",
}
# 单次识别可送进的图片张数上限（前端按 8 张提示，后端硬上限留出余量）
OCR_MAX_IMAGES = 12


def resolve_ocr_prompt_filename(mode: str) -> str:
    """OCR 模式 → 提示词文件名；未知模式回落到默认模式。"""
    return OCR_MODE_PROMPTS.get(mode, OCR_MODE_PROMPTS[DEFAULT_OCR_MODE])


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
        "27": "教考衔接文本解读",
        "28": "优质例句创研工坊",
        "29": "依托语境的词汇练习",
        "30": "隐性写作知识显性化",
        "31": "读后续写审题指导",
        "17": "阅读文本改编",
        # 旧 id 18/20（「阅读文本改编 2」/「阅读理解设问 2」）已并入 17/19；
        # 映射保留别名，旧会话的续写/预览不断链
        "18": "阅读文本改编",
        "19": "阅读理解设问",
        "20": "阅读理解设问",
        "21": "辅助完形填空命题",
        "22": "试题解读分析",
        "23": "英语试题 Bug 侦察",
        "24": "超标词替换",
        "25": "自由对话",
        "32": OCR_MODE_PROMPTS[DEFAULT_OCR_MODE],
        TRANSLATE_TOOL_ID: TRANSLATE_TOOL_NAME,
        MIGRATION_TOOL_ID: MIGRATION_TOOL_NAME,
        "34": "语篇结构与主旨反推",
    }
    return mapping.get(tool_id, "")


# 续写指令：所有工具共用 prompts/继续生成.md；某个工具想单独定制时，
# 放一份「<工具名>续写.md」即可覆盖，不需要改代码。
CONTINUE_PROMPT_NAME = "继续生成"


def _resolve_continue_prompt_filename(tool_id: str) -> str:
    """工具专属续写指令的文件名（不含 .md）；没有映射的工具返回空串"""
    base = _resolve_prompt_filename(tool_id)
    return f"{base}续写" if base else ""


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
    # 模型下拉默认显示数量（0 = 不折叠）；前端据此折叠，禁用与仅 Chores 模型已在下方过滤
    max_visible_models: int = 0


def build_tool_groups(loader: PromptLoader) -> List[dict]:
    """构造工具分组目录（含 prompt_loaded 状态）。

    工具列表接口与「描述需求找工具」共用这一份构造：搜索给出的候选必须与
    左侧列表逐字一致，两处各拼一份迟早会漂。分组只影响展示与浏览，
    搜索是一道覆盖全部工具的 choice 题，不按分组切（分组本身无语义）。
    """

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

    return [
        {
            "id": "exclusive",
            "title": "独家功能",
            "collapsed": False,
            "tools": enrich(EXCLUSIVE_TOOLS),
        },
        {
            "id": "teaching",
            "title": "备课与教学",
            "collapsed": False,
            "tools": enrich(TEACHING_TOOLS),
        },
        {
            "id": "proposition",
            "title": "命题与试题分析",
            "collapsed": False,
            "tools": enrich(PROPOSITION_TOOLS),
        },
        {
            "id": "reference",
            "title": "通用工具",
            "collapsed": False,
            "tools": enrich(REFERENCE_TOOLS),
        },
    ]


def build_tool_catalog(loader: PromptLoader) -> str:
    """自由对话注入用的工具目录（编号｜名称：用途）。

    与左侧列表同一份数据（build_tool_groups），避免两处各写一份而漂移。
    只列真正可用的工具（Prompt 已加载），并排除「自由对话」自身——在自由对话里
    推荐自由对话没有意义。
    """
    lines: list[str] = []
    for group in build_tool_groups(loader):
        for tool in group["tools"]:
            if tool["id"] == FREEFORM_TOOL_ID or not tool["prompt_loaded"]:
                continue
            lines.append(f"- {tool['id']}｜{tool['name']}：{tool['description']}")
    return "\n".join(lines)


@router.get("/", response_model=ToolGroupsResponse)
async def list_tools(
    db: Annotated[Session, Depends(get_db)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """返回所有工具元数据、分组信息及可用模型列表"""

    groups = build_tool_groups(loader)

    llm_cfg = resolve_llm_settings(db)
    available = llm_cfg.get("available_model_ids")
    # 若没有可用集合（旧库未迁移或无 Provider），则回退为启用且勾选「用户可用」的模型；
    # 禁用模型任何情况下都不回退暴露（区别于未勾「用户可用」，后者只是不给用户端展示）。
    def _user_visible(models):
        return [m for m in models if m.get("enabled", True) and m.get("user_usable", True)]

    if available:
        filtered_models = [m for m in llm_cfg["models"] if m["id"] in available]
        # 若过滤后为空（配置异常，模型均未绑定），回退为启用且用户可用的模型以免前端无模型可选
        if not filtered_models:
            filtered_models = _user_visible(llm_cfg["models"])
    else:
        # available 为空：可能是未迁移或全部未绑定/禁用，回退同样不含禁用与用户不可用
        fallback = _user_visible(llm_cfg["models"])
        filtered_models = fallback if fallback else []
    return {
        "groups": groups,
        "models": [
            {
                "id": m["id"],
                "name": m["name"],
                "description": m["description"],
                "aa_index": m["aa_index"],
                # 免费模型：用户端展示「免费」标签；free_no_code 表示无码/次数用尽也可直接调用
                "is_free": bool(m.get("is_free")),
                "free_no_code": bool(m.get("is_free") and m.get("free_no_code")),
            }
            for m in filtered_models
        ],
        "default_model": llm_cfg["default_model"],
        "max_visible_models": llm_cfg.get("max_visible_models", 0),
    }


class ToolSearchRequest(BaseModel):
    query: str = Field(
        "",
        max_length=MAX_QUERY_CHARS,
        description="用户用自然语言描述自己想做什么（不是工具名检索词）",
    )
    limit: int = Field(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="返回条数上限")


class ToolSearchResult(BaseModel):
    tool_id: str
    name: str
    icon: str
    description: str
    group_id: str
    group_title: str
    score: float = Field(description="Jev 给的选项概率，或关键词归一化得分")
    source: str = Field(description="jev = 决策模型判定；keyword = 本地关键词兜底")
    reason: str = Field(description="为什么可能是它：直接取该工具的用途描述（Jev 不生成文字）")


class ToolSearchResponse(BaseModel):
    results: List[ToolSearchResult]
    fallback: bool = Field(description="是否走了关键词兜底（Jev 未启用/不可用/回包不可解析）")
    no_match: bool = Field(description="Jev 明确判定「以上都不合适」，返回的是关键词近邻")
    uncertain: bool = Field(description="置信度低或前两名难分，应提示「不太确定」")
    cached: bool = Field(description="是否命中进程内缓存（未消耗 Jev 调用）")
    latency_ms: int
    jev_available: bool = Field(description="本次是否真的用上了 Jev（未启用或未配齐时为 false）")


@router.post("/search", response_model=ToolSearchResponse)
async def search_tools_api(
    req: ToolSearchRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    loader: PromptLoader = Depends(get_prompt_loader),
):
    """按自然语言需求推荐工具。

    与 `/api/tools/` 一样不需要使用码：它只做导航，不是生成，未登录用户
    本来就可以浏览全部工具；也**不扣额度、不写使用日志**（不污染管理后台的
    请求统计与免费模型限额计数），但按指纹/IP 限速，防止有人拿它刷 Jev Key。
    """
    query = (req.query or "").strip()
    if len(query) < MIN_QUERY_CHARS:
        raise HTTPException(
            status_code=400, detail="请多说几个字，比如「把这篇学生作文批改一下」"
        )

    fp_hash, _ = get_fingerprint_info(request)
    client_ip, _ = get_client_info(request)
    enforce_rate_limit(identity_key(fingerprint=fp_hash, ip=client_ip), "tool_search")

    cfg = resolve_llm_settings(db)
    jev_cfg = cfg.get("jev") if isinstance(cfg.get("jev"), dict) else None
    tools = flatten_tools(build_tool_groups(loader))
    return await search_tools(jev_cfg, query, tools, limit=req.limit)


@router.get("/models")
async def list_models(db: Annotated[Session, Depends(get_db)]):
    """返回可用模型列表"""
    llm_cfg = resolve_llm_settings(db)
    available = llm_cfg.get("available_model_ids")
    def _user_visible(models):
        return [m for m in models if m.get("enabled", True) and m.get("user_usable", True)]
    if available:
        filtered_models = [m for m in llm_cfg["models"] if m["id"] in available]
        if not filtered_models:
            filtered_models = _user_visible(llm_cfg["models"])
    else:
        fallback = _user_visible(llm_cfg["models"])
        filtered_models = fallback if fallback else []
    return {
        "models": [
            {
                "id": m["id"],
                "label": m["name"],
                "description": m["description"],
                "aa_index": m["aa_index"],
                "is_free": bool(m.get("is_free")),
                "free_no_code": bool(m.get("is_free") and m.get("free_no_code")),
            }
            for m in filtered_models
        ],
        "default_model": llm_cfg["default_model"],
    }
