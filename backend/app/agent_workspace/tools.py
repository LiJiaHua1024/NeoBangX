import io
import json
import re
import zipfile
from xml.etree import ElementTree

import regex
from sqlalchemy import select

from app.database import SessionLocal
from app.services.vocab_check import check_over_words
from .models import WorkspaceMaterial as Material, WorkspaceVersion as Version
from .settings import load_settings, search_available
from . import mcp


def schema(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required,
                           "additionalProperties": False}}}


STRING = {"type": "string"}
IDS = {"type": "array", "items": STRING}
NUMBER = {"type": "integer", "minimum": 0}
ASK_OPTION = {"type": "object", "properties": {"label": STRING, "description": STRING},
              "required": ["label"], "additionalProperties": False}
CATALOG = [
    {"id": "material_search", "name": "材料检索", "description": "在本任务材料中查找原文和定位依据", "available": True},
    {"id": "regex", "name": "正则查找", "description": "按正则匹配题号、句子和格式", "available": True},
    {"id": "vocabulary", "name": "词表检查", "description": "对照现有课标词表检查文本", "available": True},
    {"id": "web_search", "name": "网页搜索", "description": "使用管理员配置的搜索服务，查询会发送到该服务", "available": False},
    {"id": "question_bank", "name": "高考试题库", "description": "尚未接入题库", "available": False},
]


def catalog():
    ready = search_available()
    return [{**item, "available": ready if item["id"] == "web_search" else item["available"]} for item in CATALOG]


def tool_schemas(config):
    enabled = config.get("tools", [])
    tools = [
        schema("read_material", "分段读取已提供的材料。返回字符位置与总长度，有更多内容时继续翻页，不把未读取部分当作缺失。",
               {"material_id": STRING, "offset": NUMBER, "limit": {"type": "integer", "minimum": 1, "maximum": 16000}}, ["material_id"]),
        schema("read_document", "读取指定成果版本，用于核对或修改。版本列表在任务上下文中。",
               {"version_id": STRING, "offset": NUMBER, "limit": {"type": "integer", "minimum": 1, "maximum": 16000}}, ["version_id"]),
        schema("create_document", "根据完整选中材料和本任务提示词生成新文档或整篇候选稿，返回版本编号。不能用于凭空补写缺失原文。整篇重写已有成果时传入 base_version；局部修改改用 revise_document。",
               {"title": STRING, "instruction": STRING, "material_ids": IDS, "base_version": STRING, "teaching_tool": STRING}, ["title", "instruction", "material_ids"]),
        schema("revise_document",
               "把修改意见交给该版本的原写作者，按材料核实后局部修改，旧稿保留。一次调用最多产生一个新版本；"
               "写作者认为不成立的意见不改并说明理由，全部不改时不产生新版本。返回新版本编号和逐条处理说明。"
               "instruction 写本次要改什么和取舍理由；引用审阅意见时传 review_id 和意见序号 issues（从 1 起，省略则引用全部），不要转抄意见；"
               "用户本轮原话里已列出具体修改意见时把 include_user_request 设为 true，原话会完整转给写作者。"
               "局部修改解决不了的问题改用 create_document 并传 base_version。",
               {"version_id": STRING, "instruction": STRING, "review_id": STRING,
                "issues": {"type": "array", "items": {"type": "integer", "minimum": 1}, "maxItems": 100},
                "include_user_request": {"type": "boolean"}, "title": STRING},
               ["version_id", "instruction"]),
        schema("ask_user",
               "需要用户补充信息、在方案间取舍或确认后才能继续时，提出一个具体问题并暂停本轮；能从材料或任务推断的内容不要问。"
               "自由回答不传 options；从选项中选时传 2–8 个 options，可多选时设 multi_select。"
               "用户可跳过，跳过表示不提供这项信息，不是同意。",
               {"question": STRING, "header": STRING, "detail": STRING,
                "options": {"type": "array", "items": ASK_OPTION, "minItems": 2, "maxItems": 8},
                "multi_select": {"type": "boolean"}}, ["question"]),
    ]
    if "material_search" in enabled or "regex" in enabled:
        tools.append(schema("search_material", "查找本任务材料，返回匹配位置和上下文。无匹配如实返回，使用 offset 翻页。正则模式需要启用正则工具。",
                            {"query": STRING, "regex": {"type": "boolean"}, "offset": NUMBER, "material_id": STRING}, ["query"]))
    if "vocabulary" in enabled:
        tools.append(schema("check_vocabulary", "对照课标词表进行客观检查，返回超标词与统计。", {"text": STRING}, ["text"]))
    if "web_search" in enabled and search_available():
        tools.append(schema("web_search", "搜索公开网页并返回来源。仅发送必要查询词，不上传整份私人材料。无结果不能编造来源。", {"query": STRING}, ["query"]))
    return tools


def normalize_question(args):
    """把模型给的提问收成前端可渲染的形状；无法回答的选项在这里拒绝。"""
    question = str(args.get("question") or "").strip()
    if not question:
        raise ValueError("question 不能为空")
    if len(question) > 2000:
        raise ValueError("question 最多 2000 字")
    header = str(args.get("header") or "").strip()
    if len(header) > 80:
        raise ValueError("header 最多 80 字")
    detail = str(args.get("detail") or "").strip()
    if len(detail) > 4000:
        raise ValueError("detail 最多 4000 字")
    raw_options = args.get("options")
    if raw_options is None:
        raw_options = []
    if not isinstance(raw_options, list):
        raise ValueError("options 必须是数组")
    if raw_options and not 2 <= len(raw_options) <= 8:
        raise ValueError("options 需要 2–8 个")
    options, seen = [], set()
    for item in raw_options:
        if not isinstance(item, dict):
            raise ValueError("每个选项必须是对象")
        label = str(item.get("label") or "").strip()
        if not label:
            raise ValueError("选项 label 不能为空")
        if len(label) > 120:
            raise ValueError("选项 label 最多 120 字")
        if label in seen:
            raise ValueError("选项 label 不能重复")
        seen.add(label)
        description = str(item.get("description") or "").strip()
        if len(description) > 500:
            raise ValueError("选项 description 最多 500 字")
        options.append({"label": label, **({"description": description} if description else {})})
    multi_select = bool(args.get("multi_select"))
    if multi_select and not options:
        raise ValueError("multi_select 需要同时提供 options")
    return {"question": question, "header": header, "detail": detail,
            "options": options, "multi_select": multi_select}


def read_slice(text, offset=0, limit=8000):
    offset = max(0, int(offset))
    end = min(len(text), offset + max(1, min(16000, int(limit))))
    return {"text": text[offset:end], "offset": offset, "next_offset": end,
            "total_chars": len(text), "has_more": end < len(text)}


def materials(task_id, ids):
    with SessionLocal() as db:
        rows = db.scalars(select(Material).where(Material.task_id == task_id, Material.id.in_(ids))).all()
        by_id = {m.id: {"id": m.id, "name": m.name, "content": m.content} for m in rows}
        if any(i not in by_id for i in ids):
            raise ValueError("材料不存在或不属于本次任务")
        return [by_id[i] for i in ids]


def document(task_id, version_id):
    with SessionLocal() as db:
        row = db.get(Version, version_id)
        if not row or row.task_id != task_id:
            raise ValueError("成果版本不存在")
        return {"id": row.id, "title": row.title, "content": row.content, "complete": row.complete,
                "parent_id": row.parent_id, "origin": row.origin, "provenance": json.loads(row.provenance or "{}")}


def search_materials(rows, query, use_regex=False, offset=0):
    if not query or len(query) > 1000:
        raise ValueError("查询不能为空且不超过 1000 字符")
    try:
        pattern = regex.compile(query if use_regex else regex.escape(query), regex.IGNORECASE)
    except regex.error as exc:
        raise ValueError(f"正则表达式无效：{exc}") from exc
    matches, seen = [], 0
    try:
        for row in rows:
            for hit in pattern.finditer(row["content"], timeout=0.15):
                if seen >= offset:
                    start, end = hit.span()
                    matches.append({"material_id": row["id"], "name": row["name"], "start": start, "end": end,
                                    "text": row["content"][max(0, start-100):min(len(row["content"]), end+150)]})
                    if len(matches) == 21:
                        return {"matches": matches[:20], "has_more": True, "next_offset": offset+20}
                seen += 1
    except TimeoutError as exc:
        raise ValueError("正则查找超时，请简化表达式或缩小材料范围") from exc
    return {"matches": matches, "has_more": False, "next_offset": seen}


async def execute_readonly(task_id, config, name, args):
    import asyncio

    ids = config.get("materials", [])
    if name == "read_material":
        if args["material_id"] not in ids:
            raise ValueError("该材料不在本轮范围内")
        rows = await asyncio.to_thread(materials, task_id, [args["material_id"]])
        return {"material_id": rows[0]["id"], "name": rows[0]["name"], **read_slice(rows[0]["content"], args.get("offset", 0), args.get("limit", 8000))}
    if name == "read_document":
        row = await asyncio.to_thread(document, task_id, args["version_id"])
        return {"version_id": row["id"], **read_slice(row["content"], args.get("offset", 0), args.get("limit", 8000))}
    if name == "search_material":
        if args.get("regex") and "regex" not in config.get("tools", []):
            raise ValueError("正则工具未启用")
        selected = [args["material_id"]] if args.get("material_id") else ids
        if not set(selected) <= set(ids):
            raise ValueError("查找材料超出本轮范围")
        rows = await asyncio.to_thread(materials, task_id, selected)
        return await asyncio.to_thread(search_materials, rows, args["query"], args.get("regex", False), args.get("offset", 0))
    if name == "check_vocabulary":
        return await asyncio.to_thread(check_over_words, args["text"])
    if name == "web_search":
        cfg = await asyncio.to_thread(load_settings)
        if not search_available(cfg):
            raise ValueError("网页搜索尚未配置或已被管理员关闭")
        return await mcp.search(cfg, args["query"])
    raise ValueError("工具不可用")


def parse_upload(name, content):
    suffix = name.rsplit(".", 1)[-1].lower()
    if suffix in {"txt", "md", "csv"}:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("gb18030")
    elif suffix == "docx":
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > 32 * 1024 * 1024:
                raise ValueError("Word 解压后内容过大")
            xml = archive.read(info)
            if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                raise ValueError("Word 文件包含不支持的 XML 声明")
            root = ElementTree.fromstring(xml)
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            paragraphs = ["".join(p.itertext()) for p in root.findall(".//w:p", ns)]
            text = "\n".join(paragraphs)
    elif suffix == "pdf":
        import fitz
        with fitz.open(stream=content, filetype="pdf") as pdf:
            if pdf.needs_pass:
                raise ValueError("PDF 已加密，请先解除密码")
            text = "\n\n".join(f"[第 {i+1} 页]\n{page.get_text()}" for i, page in enumerate(pdf))
            if sum(len(page.get_text().strip()) for page in pdf) < 20:
                raise ValueError("扫描 PDF 没有可提取的文字，请先在普通工具中识别或粘贴转录文字")
    else:
        raise ValueError("支持 PDF、Word（.docx）、TXT 和 Markdown")
    if not text.strip():
        raise ValueError("未解析到文字，请检查文件")
    if len(text) > 2_000_000:
        raise ValueError("材料超过 200 万字符，请拆分后上传；未截断保存")
    return text
