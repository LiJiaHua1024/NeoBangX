from app.agent_workspace.settings import WorkspaceSettings, save_settings
from app.agent_workspace.tools import tool_schemas
from app.routers.tools import build_tool_groups, get_prompt_loader


def test_slides_flag_hides_tools_and_switch():
    save_settings(WorkspaceSettings(slides_enabled=False))
    names = {s["function"]["name"] for s in tool_schemas({}, False)}
    assert "create_presentation" not in names
    groups = build_tool_groups(get_prompt_loader())
    tools = {t["id"]: t for g in groups for t in g["tools"]}
    assert tools["15"]["ppt_supported"] is False
    save_settings(WorkspaceSettings(slides_enabled=True))
    names = {s["function"]["name"] for s in tool_schemas({}, True)}
    assert {"create_presentation", "revise_presentation", "read_presentation"} <= names
    groups = build_tool_groups(get_prompt_loader())
    tools = {t["id"]: t for g in groups for t in g["tools"]}
    assert tools["15"]["ppt_supported"] is True
    assert tools["15"]["ppt_blueprint"] == "reading"
    assert tools["13"]["ppt_supported"] is False
    save_settings(WorkspaceSettings(slides_enabled=False))
