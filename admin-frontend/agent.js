const $ = (s) => document.querySelector(s);
let saved = null,
  tools = [],
  dirty = false;
const keys = [
  "enabled",
  "max_steps",
  "max_tokens",
  "output_tokens",
  "max_seconds",
  "concurrency",
  "mcp_enabled",
  "mcp_url",
  "mcp_token",
  "mcp_tool",
  "mcp_query_field",
  "mcp_arguments",
  "mcp_timeout",
  "clear_token",
];
function state(s) {
  $("#state").textContent = s;
}
async function api(path = "", body, method = "POST") {
  const res = await fetch("/api/admin/agent" + path, {
    method: body ? method : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json();
  if (!res.ok)
    throw Error(
      typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail),
    );
  return d;
}
function data() {
  const out = {};
  for (const k of keys) {
    const el = $("#" + k);
    out[k] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number"
          ? Number(el.value)
          : el.value;
  }
  out.mcp_arguments = JSON.parse(out.mcp_arguments || "{}");
  if (
    !out.mcp_arguments ||
    Array.isArray(out.mcp_arguments) ||
    typeof out.mcp_arguments !== "object"
  )
    throw Error("固定参数必须是 JSON 对象");
  out.mcp_schema =
    tools.find((t) => t.name === out.mcp_tool)?.inputSchema ||
    saved?.mcp_schema ||
    {};
  return out;
}
function toolChanged() {
  const t = tools.find((t) => t.name === $("#mcp_tool").value);
  $("#tool-description").textContent = t?.description || "";
  $("#schema").textContent = JSON.stringify(
    t?.inputSchema || saved?.mcp_schema || {},
    null,
    2,
  );
}
function options() {
  const selected = $("#mcp_tool").value || saved?.mcp_tool;
  $("#mcp_tool").replaceChildren();
  for (const t of tools) {
    const o = document.createElement("option");
    o.value = t.name;
    o.textContent = t.name;
    $("#mcp_tool").append(o);
  }
  $("#mcp_tool").value = selected || tools[0]?.name || "";
  if (!$("#mcp_tool").value && tools.length)
    $("#mcp_tool").value = tools[0].name;
  toolChanged();
}
async function load() {
  saved = await api();
  tools = saved.mcp_tool
    ? [{ name: saved.mcp_tool, inputSchema: saved.mcp_schema }]
    : [];
  options();
  for (const k of keys) {
    const el = $("#" + k);
    if (el.type === "checkbox") el.checked = !!saved[k];
    else
      el.value =
        k === "mcp_arguments"
          ? JSON.stringify(saved[k], null, 2)
          : (saved[k] ?? "");
  }
  $("#token-state").textContent = saved.has_token
    ? "已保存令牌。留空表示保留，输入新值表示替换。"
    : "尚未设置令牌；无鉴权服务可留空。";
  dirty = false;
  state("已保存");
}
for (const k of keys) {
  $("#" + k).addEventListener("input", () => {
    dirty = true;
    state("有未保存修改");
  });
}
$("#mcp_tool").onchange = toolChanged;
function bind(id, fn) {
  $("#" + id).onclick = async (e) => {
    e.target.disabled = true;
    try {
      await fn();
    } catch (err) {
      state(err.message);
    } finally {
      e.target.disabled = false;
    }
  };
}
bind("save", async () => {
  const cfg = data();
  await api("", cfg, "PUT");
  await load();
  state("Agent 配置已保存");
});
bind("reload", async () => {
  if (dirty && !confirm("放弃未保存修改并重新加载？")) return;
  await load();
});
bind("connect", async () => {
  state("正在连接 MCP…");
  const result = await api("/connect", data());
  tools = result.tools;
  options();
  dirty = true;
  state(`连接成功，发现 ${tools.length} 个工具。选择后保存。`);
});
bind("search", async () => {
  state("正在搜索…");
  const result = await api("/search", {
    settings: data(),
    query: $("#query").value,
  });
  $("#result").hidden = false;
  $("#result").textContent = JSON.stringify(result, null, 2);
  state("搜索成功；当前表单配置尚未自动保存");
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
load().catch((e) => state(e.message));
