"""场景表与场景解析：把一次 /api/chat/stream 请求映射成一份可执行的 StreamPlan。

触发优先级（高 → 低）：

1. 输入首行魔术指令 ``#mock <场景> [k=v ...]``（浏览器里直接打，不碰前端）
2. 请求头 ``X-Mock-Scenario``（curl / 自动化脚本）
3. 查询串 ``?mock=``
4. 粘性场景（``POST /__mock__/scenario`` 设置，可带生效次数）
5. 请求的模型名（``MODEL_SCENARIOS``，选「假模型 · 慢速」即慢速流）
6. 命令行 ``--scenario`` / 默认 ``happy``
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from mock_backend.catalog import MODEL_SCENARIOS

# ---------------------------------------------------------------- StreamPlan


@dataclass
class StreamPlan:
    """一次流式请求的完整执行计划。字段默认值 = 「happy」的表现。"""

    scenario: str = "happy"
    # 时序
    pre_delay_ms: int = 0          # 首块前延迟（模拟慢启动）
    delay_ms: int = 0              # 每个 token 帧间隔
    chunk_chars: int = 2           # 每个 token 帧承载的字符数（模拟真实分词）
    max_chars: int = 0             # 正文长度上限，0 = 用完整模板
    # 推理
    reasoning_chars: int = 0       # 思考片段长度
    reasoning_delay_ms: int = 0    # 思考片段之间的间隔
    # 内容
    content: str = "generic"       # generic/long/paper/migration/vocab/echo/sentinel/empty/title
    # 故障
    fault: str = ""                # "" | "error" | "truncate"
    fault_at: int = 0              # 第 N 个 token 帧后触发故障（0 = 不按 token 数触发）
    fault_chars: int = 0           # 累计发出 N 字符后触发故障（0 = 不按字数触发）
    fallback_at: tuple[int, ...] = ()   # 在第 N 个 token 帧前插入 fallback 事件
    # 收尾
    finish: str = "done"           # done | cancel
    # 直接返回 HTTP 错误（不建流）
    http_status: int = 0
    http_detail: Any = ""
    # 迁移错因
    cause_count: int = 3
    more_cause_count: int = 3
    # PDF 解析分支
    pdf_mode: str = "ok"
    # 试卷
    paper_questions: int = 5
    paper_done: int = 0            # 0 = 全发完；>0 = 只发这么多道完整题
    # 每道笔试题的迁移题量（试卷工具）
    transfer_count: int = 1
    # 来源（仅用于日志/面板展示）
    source: str = "default"


# ---------------------------------------------------------------- 场景表

# 只写与默认值不同的字段；同名字段在合并时被覆盖。
SCENARIOS: dict[str, dict[str, Any]] = {
    # ---- 流式输出 ----
    "happy": {"content": "generic", "reasoning_chars": 180},
    "fast": {"content": "generic", "reasoning_chars": 0, "chunk_chars": 4},
    "slow": {"content": "generic", "delay_ms": 200, "reasoning_chars": 120, "max_chars": 400},
    "stall": {"content": "generic", "pre_delay_ms": 20000, "reasoning_chars": 200},
    "long": {"content": "long"},
    "reasoning-heavy": {"content": "generic", "reasoning_chars": 2400, "reasoning_delay_ms": 60},
    "reasoning-only": {"content": "empty", "reasoning_chars": 2400},
    "mid-error": {"content": "generic", "fault": "error", "fault_at": 30, "reasoning_chars": 120},
    "mid-truncate": {"content": "generic", "fault": "truncate", "fault_at": 30, "reasoning_chars": 120},
    "fallback": {"content": "generic", "fallback_at": (20,), "reasoning_chars": 100},
    "fallback-chain": {"content": "generic", "fallback_at": (20, 40), "reasoning_chars": 100},
    "fallback-fail": {"content": "generic", "fallback_at": (20,), "fault": "error", "fault_at": 40, "reasoning_chars": 100},
    "cancel": {"content": "generic", "delay_ms": 100, "max_chars": 180, "reasoning_chars": 100},
    "cancel-now": {"content": "generic", "reasoning_chars": 80, "finish": "cancel"},
    "empty": {"content": "empty"},
    "sentinel": {"content": "sentinel"},
    "echo": {"content": "echo", "reasoning_chars": 60},
    # ---- HTTP 层 ----
    "http-401": {"http_status": 401, "http_detail": "请先输入使用码"},
    "http-403": {"http_status": 403, "http_detail": "额度已用尽"},
    "http-403-quota": {
        "http_status": 403,
        "http_detail": {"message": "额度不足，无法生成本次智能错题迁移", "required": 2, "remaining": 0},
    },
    "http-429": {"http_status": 429, "http_detail": "调用过于频繁，请稍后再试"},
    "http-500": {"http_status": 500, "http_detail": "服务器内部错误，请稍后重试"},
    "bad-model": {"http_status": 400, "http_detail": "模型不可用：mock/unknown"},
    # ---- 试卷可视化 ----
    "paper": {"content": "paper", "paper_questions": 5, "chunk_chars": 8, "delay_ms": 4},
    "paper-partial": {"content": "paper", "paper_questions": 5, "paper_done": 3, "chunk_chars": 8},
    "paper-mid-truncate": {"content": "paper", "paper_questions": 5, "paper_done": 1, "fault": "truncate", "chunk_chars": 8},
    "paper-resume": {"content": "paper", "chunk_chars": 8},
    # ---- 智能错题迁移 ----
    "migration": {"content": "migration", "reasoning_chars": 120},
    "migration-analyze": {"cause_count": 3},
    "migration-more": {"cause_count": 3, "more_cause_count": 3},
    "migration-quota-short": {"cause_count": 6},
    # ---- 词汇 / 标题 ----
    "vocab": {"content": "vocab"},
    "title": {"content": "title"},
    # ---- PDF ----
    "pdf-ok": {"pdf_mode": "ok"},
    "pdf-scanned-pre": {"pdf_mode": "scanned-pre"},
    "pdf-scanned-post": {"pdf_mode": "scanned-post"},
    "pdf-too-large": {"pdf_mode": "too-large"},
    "pdf-corrupt": {"pdf_mode": "corrupt"},
    "pdf-no-token": {"pdf_mode": "no-token"},
    "pdf-empty": {"pdf_mode": "empty"},
    "pdf-truncated": {"pdf_mode": "truncated"},
}

# 面板 / 文档用的场景说明（顺序即展示顺序）
SCENARIO_DOC: list[tuple[str, str]] = [
    ("happy", "正常：思考片段 → 约 600 字课件正文 → done"),
    ("fast", "无延迟无思考，瞬时完成"),
    ("slow", "每 token 间隔 200ms，用于看流式渲染与点停止"),
    ("stall", "首块前等 20s，用于看思考动画"),
    ("long", "4000+ 字，用于测「查看更多」折叠与渲染性能"),
    ("reasoning-heavy", "超长思考后接正文"),
    ("reasoning-only", "只出思考不出正文"),
    ("mid-error", "出 30 个 token 后发 error 事件 → 错误卡"),
    ("mid-truncate", "出 30 个 token 后直接断流 → 「生成中断，内容不完整」"),
    ("fallback", "先发一次 fallback 事件再出正文 → 备用通道面板"),
    ("fallback-chain", "连发两次 fallback 再出正文"),
    ("fallback-fail", "fallback 之后 error → 全链失败卡"),
    ("cancel", "慢速流（约 9 秒），留出点击「停止」的窗口"),
    ("cancel-now", "不发正文，直接以 [CANCELLED] 收尾，测「已停止」界面态"),
    ("empty", "立即 done 且无正文"),
    ("sentinel", "只回 @@CONTINUE_DONE@@，测续写哨兵"),
    ("echo", "正文是请求回执，用于核对前端发出的参数"),
    ("http-401", "直接 401 → 使用码弹窗 / 清登录态"),
    ("http-403", "直接 403 → 额度已用尽"),
    ("http-403-quota", "结构化 403（required/remaining）→ 迁移额度不足"),
    ("http-429", "429 → 「调用频次限制」且隐藏重试/续写"),
    ("http-500", "500 → 服务器错误"),
    ("bad-model", "400 模型不可用 → 换模型重试"),
    ("paper", "合法整卷 5 题（含语篇复用/七选五/语法填空/读后续写）"),
    ("paper-partial", "只发 3 题即 done，但 @@TOTAL@@=5 → 进度条停 3/5 + 续写条"),
    ("paper-mid-truncate", "1 题后断流 → 隐藏重试卡、只留续写条"),
    ("paper-resume", "按输入里的【续写指令】简报续写剩余题目"),
    ("migration", "迁移卡正文（批量并发）"),
    ("migration-analyze", "错因分析返回 3 条错因"),
    ("migration-more", "继续分析再追加 3 条"),
    ("migration-quota-short", "错因数超过额度 → 迁移批次 403"),
    ("vocab", "超标词替换流"),
    ("title", "标题生成"),
    ("pdf-ok", "PDF 解析成功"),
    ("pdf-scanned-pre", "预检判定扫描版 → 409 pre_check"),
    ("pdf-scanned-post", "首次解析为空 → 409 post_parse"),
    ("pdf-too-large", "413 文件过大"),
    ("pdf-corrupt", "422 文件损坏"),
    ("pdf-no-token", "503 未配置 MinerU Token"),
    ("pdf-empty", "502 解析结果为空"),
    ("pdf-truncated", "成功但超过 5 万字被截断"),
]

# 参数别名 -> StreamPlan 字段名
ALIASES: dict[str, str] = {
    "at": "fault_at", "delay": "delay_ms", "pre": "pre_delay_ms", "reasoning": "reasoning_chars",
    "chars": "max_chars", "chunk": "chunk_chars", "causes": "cause_count", "more": "more_cause_count",
    "questions": "paper_questions", "done": "paper_done", "transfers": "transfer_count",
    "status": "http_status", "pdf": "pdf_mode", "fallback": "fallback_at", "detail": "http_detail",
}

_INT_PARAMS = {
    "fault_at", "fault_chars", "delay_ms", "pre_delay_ms", "chunk_chars", "max_chars",
    "reasoning_chars", "reasoning_delay_ms", "cause_count", "more_cause_count",
    "paper_questions", "paper_done", "transfer_count", "http_status",
}
_TUPLE_PARAMS = {"fallback_at"}

_MOCK_RE = re.compile(r"^\s*#\s*mock\s*[:：]?\s*(.*)$", re.IGNORECASE)


# ---------------------------------------------------------------- 指令解析


def parse_directive(text: str) -> tuple[str, dict, str]:
    """解析输入首行的 ``#mock`` 指令。

    返回 ``(场景名, 参数, 去掉指令后的正文)``。没有指令时返回空场景名与原文。
    """
    if not text:
        return "", {}, text
    lines = text.split("\n")
    m = _MOCK_RE.match(lines[0])
    if not m:
        return "", {}, text
    rest = m.group(1).strip()
    name, params = "", {}
    if rest.startswith("{"):
        # #mock {"scenario":"slow","delay_ms":150} —— 便于脚本生成，参数名就是字段名
        try:
            obj = json.loads(rest)
        except Exception:
            obj = None
        if isinstance(obj, dict):
            name = str(obj.pop("scenario", "") or "")
            params = dict(obj)
    else:
        for part in rest.split():
            if "=" in part:
                key, value = part.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key == "scenario":
                    name = value
                else:
                    params[key] = value
            elif not name:
                name = part
    stripped = "\n".join(lines[1:]).lstrip("\n")
    return name, params, stripped


def _normalize_params(params: dict) -> dict:
    """把外部参数名与字符串值归一成 StreamPlan 字段名与正确类型。"""
    out: dict[str, Any] = {}
    for key, value in (params or {}).items():
        field_name = ALIASES.get(key, key)
        if field_name in _TUPLE_PARAMS:
            if isinstance(value, str):
                nums = [int(p) for p in re.findall(r"\d+", value)]
                out[field_name] = tuple(nums)
            elif isinstance(value, (list, tuple)):
                out[field_name] = tuple(int(v) for v in value)
            continue
        if field_name in _INT_PARAMS:
            try:
                out[field_name] = int(float(value))
            except (TypeError, ValueError):
                continue
            continue
        if isinstance(value, str):
            out[field_name] = value
        else:
            out[field_name] = value
    return out


def _merge(plan: StreamPlan, name: str, params: dict, source: str, warnings: list[str]) -> StreamPlan:
    """把一层配置合进 plan。

    带场景名时**整体替换**：高层选了新预设就从干净默认值重新开始，
    不会残留低层预设的参数（否则 `--scenario slow` 之后写 `#mock fast`
    仍带着 slow 的 max_chars，很反直觉）。只给参数不给名字时，叠加在当前
    计划上——`#mock mid-error at=30` 正是靠这个在预设上微调。
    """
    if name:
        plan = StreamPlan()
    base = SCENARIOS.get(name)
    if base is None:
        if name:
            warnings.append(f"未知场景「{name}」，已忽略")
        merged = _normalize_params(params)
    else:
        merged = dict(base)
        merged.update(_normalize_params(params))
    for key, value in merged.items():
        if hasattr(plan, key):
            setattr(plan, key, value)
    if name:
        plan.scenario = name
        plan.source = source
    return plan


def resolve_plan(
    *,
    input_text: str = "",
    header: str = "",
    query: str = "",
    model: str = "",
    default_scenario: str = "happy",
    sticky: dict | None = None,
) -> tuple[StreamPlan, list[str], str]:
    """按优先级合成执行计划。

    返回 ``(plan, warnings, 去掉 #mock 指令后的输入正文)``。
    """
    warnings: list[str] = []
    plan = StreamPlan()
    plan = _merge(plan, default_scenario, {}, "default", warnings)
    if model and model in MODEL_SCENARIOS:
        plan = _merge(plan, MODEL_SCENARIOS[model], {}, "model", warnings)
    if sticky:
        plan = _merge(plan, sticky.get("scenario", ""), sticky.get("params") or {}, "sticky", warnings)
    if query:
        name, params = _split_query(query)
        plan = _merge(plan, name, params, "query", warnings)
    if header:
        name, params = _split_query(header)
        plan = _merge(plan, name, params, "header", warnings)
    directive_name, directive_params, stripped = parse_directive(input_text)
    if directive_name or directive_params:
        plan = _merge(plan, directive_name, directive_params, "directive", warnings)
    return plan, warnings, stripped


def _split_query(raw: str) -> tuple[str, dict]:
    """解析 ``mid-error;at=30`` / ``mid-error at=30`` / ``{"scenario":...}``。"""
    text = (raw or "").strip()
    if not text:
        return "", {}
    if text.startswith("{"):
        try:
            obj = json.loads(text)
        except Exception:
            return "", {}
        if isinstance(obj, dict):
            name = str(obj.pop("scenario", "") or "")
            return name, dict(obj)
        return "", {}
    name, params = "", {}
    for part in re.split(r"[;\s,]+", text):
        if not part:
            continue
        if "=" in part:
            key, value = part.split("=", 1)
            params[key.strip()] = value.strip().strip('"').strip("'")
        elif not name:
            name = part
    return name, params


def scenario_help() -> list[dict]:
    """场景清单（含可覆盖参数），供面板与 agent 读取。"""
    out = []
    for name, desc in SCENARIO_DOC:
        params = {k: v for k, v in SCENARIOS.get(name, {}).items()}
        out.append({"scenario": name, "description": desc, "params": params})
    return out
