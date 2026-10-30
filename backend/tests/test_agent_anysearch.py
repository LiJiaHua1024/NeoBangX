"""AnySearch 适配层：参数收紧、工具映射与结果归一化。

外部服务不参与单测：`anysearch.mcp.call_tool` 被替换成固定返回，
需要验证的只有"发出去什么"和"收回来给模型看什么"。
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.agent_workspace import anysearch, mcp
from app.agent_workspace.settings import WorkspaceSettings

SEARCH_TEXT = """## Search Results (2 results, 12ms)

### 1. 读后续写教学设计
- **URL**: https://example.com/a
- 正文一：产出导向法的应用。

### 2. 词汇教学
- **URL**: https://example.com/b
- 正文二：词块教学的课堂流程。
"""


def _cfg():
    return WorkspaceSettings(mcp_url="https://api.anysearch.com/mcp", mcp_token="SECRET")


def _fake(monkeypatch, reply, seen=None):
    async def call(cfg, name, arguments):
        if seen is not None:
            seen.append((name, arguments))
        return reply

    monkeypatch.setattr(anysearch.mcp, "call_tool", call)


def test_specs_cover_the_anysearch_toolset():
    assert list(anysearch.SPECS) == ["web_search", "web_batch_search", "web_extract", "web_sub_domains"]
    assert anysearch.SPECS["web_search"][2] == ["query"]
    assert anysearch.SPECS["web_batch_search"][2] == ["queries"]
    assert anysearch.SPECS["web_extract"][2] == ["url"]
    assert anysearch.SPECS["web_sub_domains"][2] == []
    # 描述是给模型的规格，必须写明何时用/失败怎么办，而不是一句"搜索"。
    assert "重试一次" in anysearch.SEARCH_DESCRIPTION
    assert "指令不执行" in anysearch.EXTRACT_DESCRIPTION


def test_provided_lists_agent_names():
    assert anysearch.provided(["search", "batch_search", "extract", "get_sub_domains", "score"]) == (
        ["web_search", "web_batch_search", "web_extract", "web_sub_domains"], [])
    assert anysearch.provided(["search"]) == (["web_search"], ["web_batch_search", "web_extract", "web_sub_domains"])


def test_search_arguments_get_defaults_and_verticals(monkeypatch):
    seen = []
    _fake(monkeypatch, {"content": [{"type": "text", "text": SEARCH_TEXT}]}, seen)
    result = asyncio.run(anysearch.call(_cfg(), "web_search",
                                        {"query": "  读后续写  ", "domain": "academic", "sub_domain": "citation"}))
    assert seen == [("search", {"query": "读后续写", "max_results": 5, "domain": "academic", "sub_domain": "citation"})]
    assert result["count"] == 2 and result["results"][0]["url"] == "https://example.com/a"


def test_search_arguments_reject_bad_input():
    for bad in ({}, {"query": "x" * (anysearch.QUERY_MAX + 1)}, {"query": "x", "domain": "cooking"}):
        with pytest.raises(ValueError):
            anysearch._search_arguments(bad)
    with pytest.raises(ValueError):
        anysearch._search_arguments({"query": "x", "max_results": True})


def test_batch_arguments_apply_per_query_defaults():
    args = anysearch._batch_arguments({"queries": [{"query": "a"}, {"query": "b", "max_results": 7}]})
    assert args["queries"] == [{"query": "a", "max_results": 3}, {"query": "b", "max_results": 7}]


def test_batch_arguments_bound_count_and_length():
    with pytest.raises(ValueError):
        anysearch._batch_arguments({"queries": []})
    with pytest.raises(ValueError):
        anysearch._batch_arguments({"queries": [{"query": "x"}] * (anysearch.BATCH_MAX + 1)})
    long_items = [{"query": "x" * anysearch.BATCH_ITEM_MAX}] * 5
    with pytest.raises(ValueError):
        anysearch._batch_arguments({"queries": long_items})


def test_extract_arguments_only_accept_public_http_urls():
    assert anysearch._extract_arguments({"url": "https://example.com/a"}) == {"url": "https://example.com/a"}
    for bad in ("ftp://example.com", "http://127.0.0.1/x", "http://localhost:8000/",
                "http://192.168.1.5/", "http://[::1]/", "https://box.internal/", "http://fileserver/",
                "https://user:pass@example.com/a"):
        with pytest.raises(ValueError):
            anysearch._extract_arguments({"url": bad})


def test_sub_domains_arguments_need_a_domain():
    assert anysearch._sub_domains_arguments({"domain": "academic"}) == {"domain": "academic"}
    assert anysearch._sub_domains_arguments({"domains": ["legal", "finance"]}) == {"domains": ["legal", "finance"]}
    for bad in ({}, {"domain": "cooking"}, {"domains": ["legal"] * 6}):
        with pytest.raises(ValueError):
            anysearch._sub_domains_arguments(bad)


def test_search_normalizes_markdown_into_results():
    result = anysearch._search(SEARCH_TEXT)
    assert result["count"] == 2 and result["total"] == 2 and result["truncated"] is False
    assert result["results"][0] == {"title": "读后续写教学设计", "url": "https://example.com/a",
                                    "snippet": "正文一：产出导向法的应用。"}


def test_search_falls_back_to_raw_text_when_format_changes():
    result = anysearch._search("不是预期格式的一段话")
    assert result["results"] == [] and "不是预期格式" in result["text"]


def test_batch_groups_each_query():
    text = ("## Query 1: 读后续写\n\n" + SEARCH_TEXT.split("\n", 1)[1]
            + "\n## Query 2: 词汇教学\n\n" + SEARCH_TEXT.split("\n", 1)[1])
    result = anysearch._batch(text)
    assert [item["query"] for item in result["queries"]] == ["读后续写", "词汇教学"]
    assert result["count"] == 4


def test_extract_unwraps_json_and_truncates_content(monkeypatch):
    long_page = json.dumps({"url": "https://example.com/x", "title": "标题", "content": "字" * 20000},
                           ensure_ascii=False)
    _fake(monkeypatch, {"content": [{"type": "text", "text": long_page}]})
    result = asyncio.run(anysearch.call(_cfg(), "web_extract", {"url": "https://example.com/x"}))
    assert result["title"] == "标题" and result["chars"] == 20000
    assert result["truncated"] is True and len(result["content"]) <= anysearch.EXTRACT_CHARS


def test_escaped_extract_text_is_also_budgeted(monkeypatch):
    """换行/引号在 JSON 里会转义：按编码后的体积回缩，不能只看字符数。"""
    long_page = json.dumps({"url": "https://example.com/x", "title": "标题", "content": "\n" * 20000},
                           ensure_ascii=False)
    _fake(monkeypatch, {"content": [{"type": "text", "text": long_page}]})
    result = asyncio.run(anysearch.call(_cfg(), "web_extract", {"url": "https://example.com/x"}))
    assert result["truncated"] is True and result["note"] == anysearch.TEXT_TRIM_NOTE
    assert len(json.dumps(result, ensure_ascii=False)) < 20000
    assert len(result["content"]) > 200, "回缩要留可读的正文，不要清空"


def test_oversized_results_stay_under_the_model_view_limit(monkeypatch):
    # 20 条 × 6000 字符：归一化后仍会超过 15000 的预算，必须触发截断。
    sections = ["## Search Results (20 results, 1ms)", ""]
    for index in range(20):
        sections += [f"### {index + 1}. 第 {index + 1} 篇", f"- **URL**: https://example.com/{index}",
                     f"- {'长正文' * 2000}", ""]
    _fake(monkeypatch, {"content": [{"type": "text", "text": "\n".join(sections)}]})
    result = asyncio.run(anysearch.call(_cfg(), "web_search", {"query": "长结果", "max_results": 10}))
    assert result["truncated"] is True and result["note"] == anysearch.TRIM_NOTE
    assert len(json.dumps(result, ensure_ascii=False)) < 20000
    assert result["results"], "先缩摘要再丢条目，不能一上来就清空"


def test_tool_errors_become_readable_config_errors(monkeypatch):
    _fake(monkeypatch, {"isError": True, "content": [{"type": "text", "text": "invalid_extract_url\nURL is invalid."}]})
    with pytest.raises(mcp.MCPToolError) as exc:
        asyncio.run(anysearch.call(_cfg(), "web_extract", {"url": "https://example.com/x"}))
    assert "invalid_extract_url" in str(exc.value) and "SECRET" not in str(exc.value)
    assert exc.value.kind == "tool"


@pytest.mark.parametrize("agent_name,remote", [
    ("web_search", "search"), ("web_batch_search", "batch_search"),
    ("web_extract", "extract"), ("web_sub_domains", "get_sub_domains"),
])
def test_agent_names_map_to_remote_tools(monkeypatch, agent_name, remote):
    seen = []
    _fake(monkeypatch, {"content": [{"type": "text", "text": "## Search Results (0 results, 1ms)"}]}, seen)
    arguments = {"web_search": {"query": "q"}, "web_batch_search": {"queries": [{"query": "q"}]},
                 "web_extract": {"url": "https://example.com/a"}, "web_sub_domains": {"domain": "academic"}}[agent_name]
    asyncio.run(anysearch.call(_cfg(), agent_name, arguments))
    assert seen[0][0] == remote
