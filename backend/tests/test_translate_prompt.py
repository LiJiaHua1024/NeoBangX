"""翻译工具（33）：提示词渲染与语言对注入。

最容易出错的是「语言对没送到位」——prompt_loader 对没传值的占位符会回落
DEFAULT_VARIABLES，漏掉一处调用就会出现「按 {{target_lang}} 翻译」这种裸占位符。
这里逐条守住：语言名到位、正文包在 <source_text> 里、不留任何裸占位符。
"""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import UsageCode
from app.routers.tools import TRANSLATE_TOOL_ID
from app.services.usage_code import issue_token


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def auth():
    """一次有效使用码的 Bearer 头：/api/chat/preview 要求已激活。"""
    db = SessionLocal()
    try:
        row = UsageCode(
            code=f"NBXU-TR-{uuid4().hex[:12].upper()}",
            quota=10,
            used_count=0,
            is_enabled=True,
            note="翻译测试",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        token = issue_token(row)
    finally:
        db.close()
    return {"Authorization": f"Bearer {token}"}


def _preview(client, auth, **body):
    res = client.post(
        "/api/chat/preview", json={"tool_id": TRANSLATE_TOOL_ID, **body}, headers=auth
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_tool_registered_with_prompt(client):
    """工具目录里能查到翻译，且提示词文件真实加载（未加载前端会弹确认框）。"""
    groups = client.get("/api/tools/").json()["groups"]
    hits = [
        (g["id"], t)
        for g in groups
        for t in g["tools"]
        if t["id"] == TRANSLATE_TOOL_ID
    ]
    assert len(hits) == 1, "翻译工具应在工具目录里出现且仅出现一次"
    group_id, tool = hits[0]
    assert group_id == "reference", "翻译属于通用工具组"
    assert tool["name"] == "翻译"
    assert tool["prompt_filename"] == "翻译.md"
    assert tool["prompt_loaded"] is True, "prompts/翻译.md 未加载"


def test_render_injects_language_pair(client, auth):
    """语言名按原文送入提示词，正文包在 <source_text> 里。"""
    data = _preview(
        client,
        auth,
        input="The passage is about a boy and his dog.",
        source_lang="auto",
        target_lang="简体中文",
    )
    prompt = data["prompt"]
    assert "把它翻译成简体中文" in prompt
    assert "原文语言：auto" in prompt
    assert "<source_text>\nThe passage is about a boy and his dog.\n</source_text>" in prompt
    assert "{{" not in prompt and "}}" not in prompt, "渲染后的提示词里不该再有裸占位符"


def test_render_uses_english_target(client, auth):
    """目标语言是英语时，两处占位符都换成英语名，而不是回落到默认值。"""
    source = "这段文字讲的是一个男孩和他的狗。"
    prompt = _preview(
        client, auth, input=source, source_lang="简体中文", target_lang="English (US)"
    )["prompt"]
    assert "把它翻译成English (US)" in prompt
    assert "原文已经是English (US)" in prompt
    assert "原文语言：简体中文" in prompt
    # 回落到默认目标语言的两处措辞都不该出现（源语言那处本来就该是简体中文）
    assert "把它翻译成简体中文" not in prompt
    assert "原文已经是简体中文" not in prompt


def test_render_falls_back_when_languages_missing(client, auth):
    """没带语言对时回落默认值，仍然不留裸占位符（续写/重试路径的兜底）。"""
    prompt = _preview(client, auth, input="Hello world.")["prompt"]
    assert "把它翻译成简体中文" in prompt
    assert "原文语言：auto" in prompt
    assert "{{" not in prompt and "}}" not in prompt


def test_stream_rejects_empty_input(client, auth):
    """翻译是普通工具：正文为空按 400 拦下（与工具 32 的图片链路不同）。"""
    res = client.post(
        "/api/chat/stream",
        json={"tool_id": TRANSLATE_TOOL_ID, "input": "   ", "model": "test/whatever"},
        headers=auth,
    )
    assert res.status_code == 400
    assert "请输入内容" in res.text
