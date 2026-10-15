"""「描述需求找工具」：用 Jev 的 choice 题型，把教师的一句话需求映射到一个工具。

为什么用 Jev
------------
让主模型「猜一个工具名」要等它把整段话写完、再解析文本，还要处理它编出来的
不存在的工具；Jev 是 TypeSafe 的决策模型（System One），只做窄判定：一次 POST
回一个选中项 + 每个选项的概率，官方给的往返在 70–500ms 量级。前端因此可以做
到「用户一停顿就搜」，不需要用户按 Enter，也不需要为这件事付一次生成费用。

协议（与 app.services.jev_judge 一致，那里有完整抄录与来源）
------------------------------------------------------------
POST {端点}，body `{"model": ..., "state": ..., "questions": {...}}`，
header `Authorization: Bearer <key>`；回包 `{"answers": {题 id: {...}}}`，
choice 题的答案是 `{"type": "choice", "choice": <选中项>, "probabilities": {...},
"confidence": <0-1>}`。

题面写法（依据 TypeSafe 官方提示词教程）
----------------------------------------
1. 问题本身必须写进 `instructions`（question id 不会发给模型）。
2. 一题一问，答案应是「有知识的人一秒内能给出的判断」；不要把多条件塞进一题。
3. `state` 里只放判定所需的事实，用结构化对象，并在 instructions 里点名要看的
   字段（这里就是 `user_request`）。
4. `criteria` 定义候选：键是选项标签（这里直接用工具名，回包按名字映射回 id），
   值是「它覆盖什么 / 不覆盖什么」的边界描述，用来收紧容易混淆的选项。
5. 题面按字面读，否词与隐含条件不会被自动补全，所以决策规则要写全。
6. 「都不合适」确实是一种合法结果，官方允许为此加一个 none 选项 —— 否则 32 个
   候选会把模型逼着硬选一个。
7. instructions 用英文：官方口径是 Jev 对英文支持最好，本仓库的既有做法也是
   英文题面 + 原样保留中文载荷（见 jev_judge.py 的 Q_* 常量）。
   （留档：中文题面与英文题面的 top-1 命中率可在 prompt-tuning/ 里对比；本模块
   的注释即评测入口，改题面时把结论补在这里。）

Jev 不会给出解释
----------------
Jev 不生成文字，所以结果里的 `reason` 直接取该工具自己的用途描述（本来就是我们
写给用户看的中文），不是模型编的推荐语 —— 这一点在 UI 上也照实展示。

兜底
----
Jev 未启用 / 未配齐 / 超时 / 报错 / 回包无法解析，一律立刻回退到本地关键词匹配
（零新依赖：中文按字符 bigram 重叠打分，不引入分词库），调用方拿到的永远是
200 与一份可展示的结果，不会因为 Jev 挂掉把搜索框变成坏功能。
"""

from __future__ import annotations

import logging
import re
from time import monotonic
from typing import Any, Iterable, Optional

from app.services.jev_judge import _jev_usable, a_ask_jev

logger = logging.getLogger(__name__)

# 交互路径上的 Jev 等待上限（秒）：后台的 jev_timeout 可以调到 30 秒（错误重试
# 判定能容忍长等待），但用户是一边打字一边等搜索，必须给一个短上限。
TOOL_SEARCH_TIMEOUT_MAX = 5.0

# 查询文本长度：与前端 TOOL_SEARCH_MIN_CHARS / TOOL_SEARCH_MAX_CHARS 保持一致
MIN_QUERY_CHARS = 2
MAX_QUERY_CHARS = 200

# 结果条数
DEFAULT_LIMIT = 3
MAX_LIMIT = 8

# search_tools 的回包键集（前端与假后端都按这个断言，防止任一侧漂移）。
SEARCH_RESPONSE_SHAPE = {
    "results", "fallback", "no_match", "uncertain", "cached", "latency_ms", "jev_available",
}

# 题 id（不会发给模型，只用于在 answers 里取回自己那题）
QUESTION_KEY = "best_tool"

# 「以上都不合适」哨兵：让 Jev 可以诚实弃权。命中它时不硬推一个工具，
# 而是把关键词匹配出来的近邻当作「可能相关」列出来。
NONE_OPTION = "以上都不合适"

# 低置信度阈值。choice 的 confidence 是概率分布的集中度（不是正确率，官方没有
# 推荐阈值）。选错工具的代价是「进错工具、白填一次输入」，比多列两个候选贵，
# 所以阈值取得低一些：只在分布明显摊平时才提示「不太确定」。
LOW_CONFIDENCE = 0.35
# top1 与 top2 的概率差小于此值算「难分」，同样提示不确定
LOW_GAP = 0.08

# 「换一个词就能命中」的别名表：工具 id -> 用户更可能说出口的说法。
# 只补描述里不太可能出现、但老师口语里常见的词（兜底路径的召回率靠它）。
TOOL_ALIASES: dict[str, tuple[str, ...]] = {
    "1": ("深度分析语篇", "分析这篇文章", "文本分析"),
    "3": ("研读报告", "文本研读"),
    "5": ("释义", "转述", "地道表达"),
    "7": ("词块", "搭配"),
    "8": ("语法", "讲语法"),
    "9": ("写作教学", "教写作", "写作课"),
    "10": ("批改作文", "改作文", "作文批改", "改错", "批改"),
    "11": ("应用文", "写应用文", "书信"),
    "12": ("讲评", "错题分析", "讲题"),
    "13": ("讲评试卷", "卷子讲评", "试卷解析", "投影讲卷"),
    "14": ("榨干试卷", "试卷精讲", "一套卷子"),
    "15": ("阅读课", "上课教案", "教学设计"),
    "16": ("读写整合", "读后续写课"),
    "17": ("改编阅读", "改写语篇"),
    "19": ("出题", "命题", "设问", "阅读理解题"),
    "21": ("完形填空", "完形"),
    "22": ("试题分析", "解读试题"),
    "23": ("找错", "bug", "挑错"),
    "24": ("超纲词", "超标词", "课标外词汇"),
    "25": ("随便聊", "聊聊", "随便问", "自由讨论", "教学问题", "其他需求", "兜底"),
    "27": ("教考衔接", "教材对接高考"),
    "29": ("词汇练习", "词汇题"),
    "30": ("写作知识", "显性化"),
    "31": ("续写审题", "读后续写"),
    "32": ("ocr", "图片转文字", "拍照识别", "识别文字"),
    "33": ("英译中", "中译英", "translate"),
    "34": ("主旨", "语篇结构"),
    "migration": ("错题迁移", "迁移练习"),
}

# 容易混淆的工具，手写一句「什么时候选它、什么时候别选它」。
# 这两个工具只差在「谁做这件事」上，光看名字与描述分不开，必须显式划线。
TOOL_BOUNDARY_NOTES: dict[str, str] = {
    "1": "适合通读一篇课文的主题、文体、语言特点；不要用于单个语言点讲解。",
    "2": "关注「怎么说」（修辞、语气、衔接、态度标记）；不要用于「写了什么」的内容分析。",
    "9": "用于教学生「怎么写」的写作课设计（文体、支架、范文、升格路径）；不是批改某一篇具体作文。",
    "10": "用于批改学生已经写好的某一篇作文（评分、逐段点评、纠错）；不是写作课设计。",
    "11": "用于应用文书（书信、通知、演讲稿等）的范文与练习；记叙文议论文请选英文写作教学。",
    "12": "用于讲评个别错题或重点题（错因、解题范式、迁移训练）；整卷投影讲评请选试卷可视化全解。",
    "13": "用于整卷的课堂投影版结构化解析；只讲一两道题请选试卷重点题讲评。",
    "15": "用于阅读课的课堂流程设计；只是解读文本本身请选语篇深度分析。",
    "22": "用于分析试题的选材立意与考查能力；判断题目有没有毛病请选英语试题 Bug 侦察。",
    "25": "当没有任何工具匹配这个需求时选它：它按教师的自由输入作答，是全部工具之外的兜底。",
    "32": "用于把图片（试卷、手写作文）转成文字；不是判卷、不是批改。",
    "33": "用于把一段原文翻译成另一种语言；不是讲解语言点、也不是改写。",
}

# ---------------- 进程内缓存 ----------------
# 与限速、停止事件一样，主站按单进程部署，进程内缓存即可；键里带上工具目录
# 指纹，目录一变旧结果自动失效，不会出现「搜到已经不存在的工具」。
_CACHE_TTL = 600.0
_CACHE_MAX = 256
_cache: dict[str, tuple[float, str, dict]] = {}


def _normalize_query(query: str) -> str:
    return " ".join((query or "").split()).strip().lower()


def _normalize_text(text: Any) -> str:
    """压掉空白并转小写，供关键词匹配用（中文与字母数字都保留）。"""
    return " ".join(str(text or "").split()).lower()


def catalog_fingerprint(tools: Iterable[dict]) -> str:
    """工具目录指纹：id + 名字 + 描述，任一变化都会让缓存失效。"""
    return "|".join(f"{t.get('id')}:{t.get('name')}:{t.get('description')}" for t in tools)


def flatten_tools(groups: Iterable[dict]) -> list[dict]:
    """把分组目录拍平成带分组信息的工具列表（搜索与结果展示共用）。"""
    flat: list[dict] = []
    for group in groups or []:
        for tool in group.get("tools") or []:
            flat.append({
                "id": str(tool.get("id") or ""),
                "name": str(tool.get("name") or ""),
                "icon": str(tool.get("icon") or ""),
                "description": str(tool.get("description") or ""),
                "group_id": str(group.get("id") or ""),
                "group_title": str(group.get("title") or ""),
            })
    return [t for t in flat if t["id"] and t["name"]]


# ---------------- 题面 ----------------

TOOL_SEARCH_INSTRUCTIONS = (
    "The teacher wrote `user_request`: what they want to do next, in their own words. "
    "Choose the single tool that best accomplishes it. "
    "Judge by the goal behind the request, not by shared words: a request that only "
    "mentions an essay may be about grading one, about a writing lesson, or about "
    "model application letters - pick the one that does the actual work the teacher "
    "asked for. Prefer the tool that carries the task through end to end; do not "
    "choose a neighbouring step (for example, do not choose text analysis when the "
    "teacher asked for a classroom activity). "
    f"If no tool matches what the teacher is asking for, choose {NONE_OPTION}. "
    "Select exactly one option."
)


def build_tool_choice_question(tools: Iterable[dict]) -> dict:
    """把工具目录拼成一道 choice 题。

    选项标签直接用工具名（唯一且稳定），回包按名字映射回 id；描述里带上
    「它是什么 + 何时不要用它」的边界，容易混淆的几个由 TOOL_BOUNDARY_NOTES
    显式划线。末尾固定加「以上都不合适」，给模型一个诚实的退路。
    """
    criteria: dict[str, str] = {}
    for tool in tools:
        label = tool["name"]
        parts = [tool.get("description") or ""]
        note = TOOL_BOUNDARY_NOTES.get(tool["id"])
        if note:
            parts.append(note)
        description = "".join(p for p in parts if p).strip()
        # 重名（理论上不该有）时保留先出现的那个，避免选项被后来者顶掉
        if label not in criteria:
            criteria[label] = description
    criteria[NONE_OPTION] = (
        "没有工具匹配这个需求，或者这句话本身不是本平台的教学任务。"
    )
    return {
        "type": "choice",
        "instructions": TOOL_SEARCH_INSTRUCTIONS,
        "criteria": criteria,
    }


def parse_tool_choice_answer(
    answers: Any, tools: Iterable[dict]
) -> tuple[Optional[str], float, list[tuple[dict, float]], bool]:
    """解析回包：(工具 id 或 None, 置信度, [(工具, 概率)] 降序, 是否明确弃权)。

    `abstained` 只在模型真的选了「以上都不合适」时为 True —— 那是合法结论，
    与「回包读不出来」必须分开：后者返回空结论，交给调用方回退关键词，绝不猜。
    标签认不出来（比如网关改写了选项名）同样算读不出来。
    """
    if not isinstance(answers, dict):
        return None, 0.0, [], False
    answer = answers.get(QUESTION_KEY)
    if not isinstance(answer, dict):
        return None, 0.0, [], False

    by_name = {t["name"]: t for t in tools}

    ranked: list[tuple[dict, float]] = []
    probabilities = answer.get("probabilities")
    if isinstance(probabilities, dict):
        for label, value in probabilities.items():
            tool = by_name.get(str(label))
            if tool is None:
                continue
            try:
                ranked.append((tool, float(value)))
            except (TypeError, ValueError):
                continue
        ranked.sort(key=lambda item: item[1], reverse=True)

    choice = answer.get("choice")
    tool_id: Optional[str] = None
    abstained = False
    if isinstance(choice, str):
        if choice == NONE_OPTION:
            abstained = True
        else:
            hit = by_name.get(choice)
            if hit is not None:
                tool_id = hit["id"]

    confidence = _as_float(answer.get("confidence"))
    if confidence is None:
        confidence = ranked[0][1] if ranked else 0.0
    return tool_id, confidence, ranked, abstained


def _as_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------- 关键词兜底 ----------------

def _bigrams(text: str) -> set[str]:
    cleaned = re.sub(r"[\W_]+", "", text or "", flags=re.UNICODE)
    if len(cleaned) < 2:
        return {cleaned} if cleaned else set()
    return {cleaned[i:i + 2] for i in range(len(cleaned) - 1)}


def keyword_score(query: str, tool: dict) -> float:
    """单个工具的关键词得分（0 = 不相关）。只用字符重叠，不依赖任何分词库。"""
    text = _normalize_text(query)
    if not text:
        return 0.0
    name = _normalize_text(tool.get("name"))
    description = _normalize_text(tool.get("description"))
    score = 0.0

    # 直接叫出了工具名（「翻译」「完形填空」）——最强信号
    if name and name in text:
        score += 6.0 + 1.5 * len(name)

    query_grams = _bigrams(text)
    if query_grams:
        if name:
            score += 6.0 * _overlap(query_grams, _bigrams(name))
        if description:
            score += 4.0 * _overlap(query_grams, _bigrams(description))

    for alias in TOOL_ALIASES.get(tool.get("id") or "", ()):
        alias_text = _normalize_text(alias)
        if alias_text and alias_text in text:
            score += 5.0 + 0.5 * len(alias_text)
    return score


def _overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left)


def keyword_search(
    query: str, tools: Iterable[dict], limit: int = DEFAULT_LIMIT
) -> list[tuple[dict, float]]:
    """本地关键词匹配：返回 (工具, 0-1 归一化得分) 降序，只留下真的有命中的。"""
    scored = [(tool, keyword_score(query, tool)) for tool in tools]
    scored = [(tool, score) for tool, score in scored if score > 0]
    scored.sort(key=lambda item: (-item[1], item[0]["id"]))
    # 归一化：12 分以上视为满分（名字命中 + 描述大范围重叠）
    return [(tool, min(1.0, round(score / 12.0, 4))) for tool, score in scored[:limit]]


# ---------------- 结果组装 ----------------

def _row(tool: dict, score: float, source: str) -> dict:
    return {
        "tool_id": tool["id"],
        "name": tool["name"],
        "icon": tool.get("icon") or "",
        "description": tool.get("description") or "",
        "group_id": tool.get("group_id") or "",
        "group_title": tool.get("group_title") or "",
        "score": float(score),
        "source": source,
        # Jev 不生成文字，所以「为什么推荐」就是工具自己的用途描述
        "reason": tool.get("description") or "",
    }


def _keyword_payload(query: str, tools: list[dict], limit: int, *, no_match: bool) -> dict:
    rows = [_row(tool, score, "keyword") for tool, score in keyword_search(query, tools, limit)]
    return {
        "results": rows,
        "fallback": True,
        "no_match": no_match,
        "uncertain": False,
    }


async def search_tools(
    jev_cfg: Optional[dict],
    query: str,
    tools: list[dict],
    limit: int = DEFAULT_LIMIT,
    *,
    cache: bool = True,
) -> dict:
    """搜索总入口：Jev 优先，任何失败立刻回退关键词。永不抛异常。

    返回 {results, fallback, no_match, uncertain, cached, latency_ms, jev_available}。
    """
    started = monotonic()
    cache_key = _normalize_query(query)
    fingerprint = catalog_fingerprint(tools)

    if cache:
        cached = _cache_get(cache_key, fingerprint)
        if cached is not None:
            payload = dict(cached)
            payload["cached"] = True
            payload["latency_ms"] = int((monotonic() - started) * 1000)
            return payload

    jev_available = _jev_usable(jev_cfg) and _tool_search_enabled(jev_cfg)
    payload: Optional[dict] = None
    if jev_available:
        assert jev_cfg is not None
        try:
            payload = await _jev_payload(jev_cfg, query, tools, limit)
        except Exception as exc:  # noqa: BLE001 - 任何失败都只记日志并回退，不影响搜索本身
            logger.warning("工具搜索：Jev 判定不可用，回退关键词：%s", exc)
            payload = None

    if payload is None:
        payload = _keyword_payload(query, tools, limit, no_match=False)

    payload = {
        "results": payload["results"][:limit],
        "fallback": payload["fallback"],
        "no_match": payload["no_match"],
        "uncertain": payload["uncertain"],
        "cached": False,
        "latency_ms": int((monotonic() - started) * 1000),
        "jev_available": jev_available,
    }
    if cache:
        _cache_put(cache_key, fingerprint, payload)
    return payload


def _tool_search_enabled(jev_cfg: Optional[dict]) -> bool:
    """后台可单独关掉「描述需求找工具」，不影响 Jev 的错误重试判定。"""
    if not isinstance(jev_cfg, dict):
        return False
    return bool(jev_cfg.get("tool_search_enabled", True))


async def _jev_payload(jev_cfg: dict, query: str, tools: list[dict], limit: int) -> Optional[dict]:
    cfg = dict(jev_cfg)
    try:
        cfg["timeout"] = min(float(cfg.get("timeout") or TOOL_SEARCH_TIMEOUT_MAX), TOOL_SEARCH_TIMEOUT_MAX)
    except (TypeError, ValueError):
        cfg["timeout"] = TOOL_SEARCH_TIMEOUT_MAX

    answers = await a_ask_jev(cfg, {"user_request": query}, {QUESTION_KEY: build_tool_choice_question(tools)})
    tool_id, confidence, ranked, abstained = parse_tool_choice_answer(answers, tools)

    if abstained and tool_id is None:
        # Jev 明确弃权：不硬推一个工具，把关键词近邻当「可能相关」列出来
        return _keyword_payload(query, tools, limit, no_match=True)

    if tool_id is None:
        # 回包存在但读不出可用结论（缺字段 / 标签认不出）→ 交给关键词兜底
        logger.warning("工具搜索：Jev 回包无法解析，回退关键词：%s", answers)
        return None

    by_id = {t["id"]: t for t in tools}
    rows: list[dict] = []
    top = by_id.get(tool_id)
    if top is not None:
        top_score = next((score for tool, score in ranked if tool["id"] == tool_id), confidence)
        rows.append(_row(top, top_score, "jev"))
    for tool, score in ranked:
        if len(rows) >= limit:
            break
        if tool["id"] == tool_id:
            continue
        rows.append(_row(tool, score, "jev"))

    # 置信度：官方口径是分布集中度，不是正确率；这里只用它决定要不要提示「不太确定」
    gap = (ranked[0][1] - ranked[1][1]) if len(ranked) > 1 else 1.0
    uncertain = confidence < LOW_CONFIDENCE or gap < LOW_GAP
    return {
        "results": rows,
        "fallback": False,
        "no_match": False,
        "uncertain": uncertain,
    }


# ---------------- 缓存读写 ----------------

def _cache_get(cache_key: str, fingerprint: str) -> Optional[dict]:
    entry = _cache.get(cache_key)
    if not entry:
        return None
    created, cached_fingerprint, payload = entry
    if cached_fingerprint != fingerprint or monotonic() - created > _CACHE_TTL:
        _cache.pop(cache_key, None)
        return None
    return payload


def _cache_put(cache_key: str, fingerprint: str, payload: dict) -> None:
    if not cache_key:
        return
    if len(_cache) >= _CACHE_MAX:
        # 先丢过期的，再丢最旧的一批（纯内存缓存，丢一点不心疼）
        now = monotonic()
        for key in [k for k, (ts, _, _) in _cache.items() if now - ts > _CACHE_TTL]:
            _cache.pop(key, None)
        while len(_cache) >= _CACHE_MAX:
            oldest = min(_cache, key=lambda k: _cache[k][0])
            _cache.pop(oldest, None)
    _cache[cache_key] = (monotonic(), fingerprint, payload)


def clear_cache() -> None:
    """清空缓存（测试与后台改配置后使用）。"""
    _cache.clear()
