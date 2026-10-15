"""自由对话（工具 25）：工具目录注入与推荐标记契约。

目录由后端从与左侧列表同一份数据生成（build_tool_catalog），逐请求注入
{{tool_catalog}}。最容易出的两种错都在这里守：
1. 漏注入 → 模型看到的是裸占位符，既答不出「有哪些工具」，也无从推荐；
2. 目录里混进「自由对话」自己 → 在自由对话里把用户又推荐回自由对话。
"""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import UsageCode
from app.routers.tools import FREEFORM_TOOL_ID
from app.services.usage_code import issue_token


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def auth():
    db = SessionLocal()
    try:
        row = UsageCode(
            code=f"NBXU-FF-{uuid4().hex[:12].upper()}",
            quota=10,
            used_count=0,
            is_enabled=True,
            note="自由对话目录测试",
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
        "/api/chat/preview", json={"tool_id": FREEFORM_TOOL_ID, **body}, headers=auth
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_catalog_injected_into_freeform_prompt(client, auth):
    """目录被真实注入，且渲染后不留任何裸占位符。"""
    prompt = _preview(client, auth, input="帮我找批改作文的工具")["prompt"]
    assert "{{" not in prompt and "}}" not in prompt, "渲染后不该再有裸占位符"
    # 目录行的形状：编号｜名称：用途
    assert "- 10｜学生作文批改：" in prompt
    assert "- 13｜试卷可视化全解：" in prompt
    # 推荐标记的写法必须交代清楚，否则模型只会讲工具名、给不出可解析的标记
    assert "[[tool:编号]]" in prompt


def test_catalog_excludes_freeform_itself(client, auth):
    """自由对话不该把自己列进目录再推荐一遍。"""
    prompt = _preview(client, auth, input="你好")["prompt"]
    assert "- 25｜" not in prompt


def test_other_tools_get_no_catalog(client, auth):
    """目录只进自由对话：其它工具的提示词里不该凭空多出这份清单。"""
    res = client.post(
        "/api/chat/preview", json={"tool_id": "10", "input": "作文正文"}, headers=auth
    )
    assert res.status_code == 200, res.text
    prompt = res.json()["prompt"]
    assert "{{" not in prompt and "}}" not in prompt
    assert "[[tool:编号]]" not in prompt
