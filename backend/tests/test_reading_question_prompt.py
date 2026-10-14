"""阅读理解设问（19）：多篇材料渲染与多篇规则到位。

最容易出错的是「多篇被当一篇」——篇目切分、逐篇成组、总览表三处规则
任何一处漏掉，教师拿到的就还是一套混在一起的题。这里逐条守住：
材料全文进 <material>、多篇规则在场、渲染后无裸占位符。
"""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import UsageCode
from app.services.usage_code import issue_token

READING_QUESTION_TOOL_ID = "19"

PASSAGE_ONE = (
    "The Seed Vault\n\nDeep inside a mountain in Norway, a vault keeps frozen copies "
    "of the world's crop seeds. It opened in 2008 as a backup for disasters and war."
)
PASSAGE_TWO = (
    "Last Bus Home\n\nThe number 47 stopped running at nine, and my shift ended at ten. "
    "For three months I walked the four miles home along the river road."
)


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
            code=f"NBXU-RQ-{uuid4().hex[:12].upper()}",
            quota=10,
            used_count=0,
            is_enabled=True,
            note="阅读理解设问测试",
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
        "/api/chat/preview",
        json={"tool_id": READING_QUESTION_TOOL_ID, **body},
        headers=auth,
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_tool_registered_with_prompt(client):
    """工具目录里能查到阅读理解设问，且提示词文件真实加载（未加载前端会弹确认框）。"""
    groups = client.get("/api/tools/").json()["groups"]
    hits = [
        t
        for g in groups
        for t in g["tools"]
        if t["id"] == READING_QUESTION_TOOL_ID
    ]
    assert len(hits) == 1, "阅读理解设问应在工具目录里出现且仅出现一次"
    tool = hits[0]
    assert tool["name"] == "阅读理解设问"
    assert tool["prompt_filename"] == "阅读理解设问.md"
    assert tool["prompt_loaded"] is True, "prompts/阅读理解设问.md 未加载"


def test_render_multi_article_keeps_all_passages_and_rules(client, auth):
    """两篇材料：全文进 <material>，篇目识别/逐篇成组/总览表三处规则都在场。"""
    text = f"{PASSAGE_ONE}\n\n---\n\n{PASSAGE_TWO}"
    prompt = _preview(client, auth, input=text)["prompt"]
    assert "Deep inside a mountain in Norway" in prompt
    assert "The number 47 stopped running at nine" in prompt
    # 多篇规则三件套：切分判断、逐篇成组、拼卷总览表
    assert "篇目识别" in prompt
    assert "每篇独立一组" in prompt
    assert "总览表" in prompt
    assert "{{" not in prompt and "}}" not in prompt, "渲染后的提示词里不该再有裸占位符"


def test_render_single_article_still_full_pipeline(client, auth):
    """单篇路径不回退：四块输出结构与逐篇命制的收尾句都在场。"""
    prompt = _preview(client, auth, input=PASSAGE_ONE)["prompt"]
    for block in ("语篇结构速览", "版本 A", "版本 B", "鉴别指引", "单篇材料"):
        assert block in prompt, f"单篇路径缺 {block}"
    assert "逐篇命制" in prompt
    assert "{{" not in prompt and "}}" not in prompt
