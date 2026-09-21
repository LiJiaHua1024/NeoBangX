"""控制面：/__mock__/* 端点与人工调试用的控制台页面。

两个用途：
- 人工在浏览器里切场景、看请求日志、改额度；
- 自动化脚本/agent 读 /__mock__/state、/__mock__/scenarios、/__mock__/requests，
  用 /__mock__/scenario 精确控制下一次请求的行为。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse

from mock_backend.scenarios import scenario_help
from mock_backend.state import STATE

router = APIRouter(prefix="/__mock__", tags=["mock-control"])

# 由 main.py 在注册时填入：当前默认场景、是否启用假上游、前端目录
CONFIG: dict[str, Any] = {"default_scenario": "happy", "upstream_enabled": True}


@router.get("/state")
async def get_state() -> dict:
    snap = STATE.snapshot()
    snap.update({
        "default_scenario": CONFIG.get("default_scenario", "happy"),
        "upstream_enabled": CONFIG.get("upstream_enabled", True),
    })
    return snap


@router.get("/scenarios")
async def get_scenarios() -> dict:
    return {
        "scenarios": scenario_help(),
        "upstream_scenarios": ["happy", "slow", "long", "reasoning", "paper", "migration", "timeout", "error", "empty", "mid-error"],
    }


@router.get("/requests")
async def get_requests(limit: int = 100) -> dict:
    return {"requests": STATE.request_log()[-limit:]}


@router.delete("/requests")
async def clear_requests() -> dict:
    STATE.clear_requests()
    return {"ok": True}


@router.post("/scenario")
async def set_scenario(request: Request) -> dict:
    body = await _json(request)
    scenario = str(body.get("scenario") or "").strip()
    if not scenario:
        return JSONResponse({"error": "缺少 scenario"}, status_code=400)
    times = body.get("times")
    STATE.set_sticky(scenario, body.get("params") or {}, int(times) if times is not None else None)
    return {"ok": True, "sticky": STATE.snapshot()["sticky"]}


@router.delete("/scenario")
async def clear_scenario() -> dict:
    STATE.clear_sticky()
    return {"ok": True, "sticky": None}


@router.post("/quota")
async def set_quota(request: Request) -> dict:
    body = await _json(request)
    value = body.get("quota")
    STATE.quota = None if value in (None, "unlimited", -1) else int(value)
    STATE.used = 0
    return {"ok": True, "state": STATE.snapshot()}


@router.post("/reset")
async def reset_state() -> dict:
    STATE.reset()
    return {"ok": True}


async def _json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


# ---------------------------------------------------------------- 控制台页面

_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeoBangX 假后端 · 控制台</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #f6f7f9; color: #1f2328; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .sub { color: #6b7280; font-size: 12.5px; margin-bottom: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  select, input, button { font: inherit; padding: 6px 10px; border-radius: 7px; border: 1px solid #d1d5db; background: #fff; color: inherit; }
  button { cursor: pointer; background: #111827; color: #fff; border-color: #111827; }
  button.ghost { background: #fff; color: #111827; }
  button:hover { opacity: .88; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; white-space: nowrap; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-all; max-width: 420px; max-height: 150px; overflow: auto; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 12px; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.err { background: #fee2e2; color: #991b1b; }
  .muted { color: #6b7280; }
  .links a { margin-right: 14px; }
  #log { max-height: 420px; overflow: auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>NeoBangX 假后端 · 控制台</h1>
  <div class="sub">仅测试用。真实前端在 <a href="/" target="_blank">/</a>；场景说明见 backend/mock_backend/README.md</div>

  <div class="card">
    <div class="row">
      <span class="pill" id="stickyPill">粘性场景：无</span>
      <span class="pill" id="quotaPill">额度：无限</span>
      <span class="pill" id="defPill">默认：happy</span>
      <span class="pill" id="upPill">假上游：开</span>
      <span class="muted" id="reqCount"></span>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">切换场景</h2>
    <div class="row">
      <select id="scenario"></select>
      <input id="params" placeholder='参数，如 at=30 delay=200' size="30">
      <button onclick="setSticky(0)">设为粘性</button>
      <button class="ghost" onclick="setSticky(1)">只生效一次</button>
      <button class="ghost" onclick="clearSticky()">清除</button>
      <button class="ghost" onclick="resetAll()">重置全部</button>
    </div>
    <div class="row" style="margin-top:10px">
      <span class="muted">额度：</span>
      <input id="quota" placeholder="留空=无限" size="10">
      <button class="ghost" onclick="setQuota()">设置剩余次数</button>
      <span class="muted">快捷链接：</span>
      <span class="links">
        <a href="/" target="_blank">首页</a>
        <a href="/?dev=fallback" target="_blank">fallback 预览</a>
        <a href="/?dev=network" target="_blank">网络错误预览</a>
      </span>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">场景清单</h2>
    <div id="log"><table><thead><tr><th>场景</th><th>行为</th><th>覆盖参数</th></tr></thead>
    <tbody id="scenarioBody"></tbody></table></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">请求日志 <span class="muted">（agent 可改用 GET /__mock__/requests）</span>
      <button class="ghost" style="float:right" onclick="clearLog()">清空</button></h2>
    <div id="log"><table><thead><tr><th>时间</th><th>方法</th><th>路径</th><th>场景</th><th>状态</th><th>摘要</th><th>请求体</th></tr></thead>
    <tbody id="logBody"></tbody></table></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
let SCENARIOS = [];

async function refresh() {
  const state = await (await fetch('/__mock__/state')).json();
  $('stickyPill').textContent = '粘性场景：' + (state.sticky ? state.sticky.scenario + (state.sticky.times ? '（剩 ' + state.sticky.times + ' 次）' : '') : '无');
  $('stickyPill').className = 'pill' + (state.sticky ? '' : ' warn');
  $('quotaPill').textContent = '额度：' + (state.quota === null ? '无限' : '剩 ' + Math.max(0, state.quota - state.used) + ' 次');
  $('defPill').textContent = '默认：' + state.default_scenario;
  $('upPill').textContent = '假上游：' + (state.upstream_enabled ? '开' : '关');
  $('reqCount').textContent = '已记录 ' + state.request_count + ' 条请求';

  const data = await (await fetch('/__mock__/requests')).json();
  const rows = data.requests.slice().reverse().map(r => {
    const body = r.body ? JSON.stringify(r.body) : '';
    const cls = r.status >= 400 ? 'err' : (r.summary.indexOf('error') >= 0 ? 'err' : '');
    return `<tr><td>${r.time}</td><td>${r.method}</td><td>${r.path}</td><td>${r.scenario}</td>` +
      `<td><span class="pill ${cls}">${r.status}</span></td><td>${r.summary || ''}</td>` +
      `<td>${body ? '<pre>' + escapeHtml(body.slice(0, 900)) + '</pre>' : ''}</td></tr>`;
  }).join('');
  $('logBody').innerHTML = rows;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

async function loadScenarios() {
  const data = await (await fetch('/__mock__/scenarios')).json();
  SCENARIOS = data.scenarios;
  $('scenario').innerHTML = SCENARIOS.map(s =>
    `<option value="${s.scenario}">${s.scenario} — ${s.description}</option>`).join('');
  $('scenarioBody').innerHTML = SCENARIOS.map(s =>
    `<tr><td><code>${s.scenario}</code></td><td>${s.description}</td>` +
    `<td><code>${Object.keys(s.params || {}).join(', ') || '—'}</code></td></tr>`).join('');
}

async function setSticky(once) {
  const scenario = $('scenario').value;
  const params = {};
  ($('params').value || '').split(/[;\\s,]+/).forEach(part => {
    if (!part) return;
    const i = part.indexOf('=');
    if (i > 0) params[part.slice(0, i)] = part.slice(i + 1);
  });
  await fetch('/__mock__/scenario', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({scenario, params, times: once ? 1 : null}),
  });
  refresh();
}

async function clearSticky() {
  await fetch('/__mock__/scenario', {method: 'DELETE'});
  refresh();
}

async function setQuota() {
  const v = $('quota').value.trim();
  await fetch('/__mock__/quota', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({quota: v === '' ? null : Number(v)}),
  });
  refresh();
}

async function clearLog() {
  await fetch('/__mock__/requests', {method: 'DELETE'});
  refresh();
}

async function resetAll() {
  await fetch('/__mock__/reset', {method: 'POST'});
  await fetch('/__mock__/scenario', {method: 'DELETE'});
  refresh();
}

loadScenarios().then(refresh);
setInterval(refresh, 2000);
</script>
</body>
</html>
"""


@router.get("/", response_class=HTMLResponse)
@router.get("", response_class=HTMLResponse)
async def panel_page() -> HTMLResponse:
    return HTMLResponse(_PAGE)


def add_control_routes(app, *, default_scenario: str = "happy", upstream_enabled: bool = True) -> None:
    CONFIG["default_scenario"] = default_scenario
    CONFIG["upstream_enabled"] = upstream_enabled
    app.include_router(router)
