/* 管理后台本轮 UX 改动：列表三态、筛选自动查询、窄屏保存条、熔断复位
   运行：node --test frontend/tests/admin-ux.test.js

   后台的 JS 用 vm 跑真实组件（与 admin-logs.test.js 同一套 harness），
   模板与样式部分做结构性断言——它们没法在 node 里渲染。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const HTML = fs.readFileSync(path.join(ROOT, "admin-frontend", "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "admin-frontend", "styles.css"), "utf8");

function setup() {
  const env = { URLSearchParams, AbortController, setTimeout, clearTimeout };
  vm.createContext(env);
  const source = fs.readFileSync(path.join(ROOT, "admin-frontend", "script.js"), "utf8");
  const app = vm.runInContext(source + "; adminApp()", env);
  const requests = [], errors = [];
  app.api = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  app.toast = (message) => errors.push(message);
  return { app, requests, errors, env };
}

test("熔断复位按钮打对端点并回执清掉的家数", async () => {
  const { app, requests, errors } = setup();
  const pending = app.resetProviderBreakers();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/admin/providers/reset-breakers");
  assert.equal(requests[0].options.method, "POST");
  requests[0].resolve({ status: "ok", cleared: 2 });
  await pending;
  assert.match(errors.join(" "), /已清空 2 家/);
});

test("Provider 开关失败要回滚（否则复选框停在服务端没生效的状态）", async () => {
  const { app, requests } = setup();
  const provider = { id: "p1", enabled: true };
  const pending = app.toggleProviderEnabled(provider);
  assert.equal(provider.enabled, false, "先乐观置位");
  requests[0].reject(new Error("网络错误"));
  await pending;
  assert.equal(provider.enabled, true, "失败必须翻回原状");
});

test("筛选条件变化会安排一次防抖查询", () => {
  const { app } = setup();
  let calls = 0;
  app.loadLogs = () => { calls += 1; };
  app.logsPage = 3;
  app.scheduleLogReload();
  app.scheduleLogReload();
  app.scheduleLogReload();
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(calls, 1, "连输三次只查一次");
      assert.equal(app.logsPage, 1, "条件变了要回到第一页");
      resolve();
    }, 450);
  });
});

test("三个列表都有加载中 / 失败重试 / 真空态", () => {
  for (const [key, colSpan] of [["logs", 11], ["codes", 8], ["devices", 9]]) {
    assert.ok(HTML.includes(`x-show="${key}Loading"`), `${key} 缺加载中态`);
    assert.ok(HTML.includes(`x-show="${key}Error && !${key}Loading"`), `${key} 缺失败态`);
    assert.ok(HTML.includes(`@click="load${key[0].toUpperCase()}${key.slice(1)}()"`), `${key} 失败态缺重试按钮`);
    assert.ok(
      HTML.includes(`x-show="!${key}.length && !${key}Loading && !${key}Error"`),
      `${key} 空态没有把「加载中/失败」排除掉`
    );
    assert.ok(colSpan > 0);
  }
});

test("窄屏保存条钉在底部，并给内容留出让位空间", () => {
  const mobile = CSS.slice(CSS.indexOf("@media (max-width: 640px)"));
  // 固定条必须挂在顶栏之外：.glass 的 backdrop-filter 会成为 fixed 后代的包含块，
  // 放在 .topbar 里的 position: fixed 会被钉在顶栏内部，钉不到屏幕底部
  assert.match(mobile, /\.topbar \.config-bar\s*\{[^}]*display:\s*none/, "窄屏只留一份保存条");
  assert.match(mobile, /\.config-bar-fixed\s*\{[^}]*position:\s*fixed/, "窄屏保存条要固定");
  assert.match(mobile, /\.config-bar-fixed\s*\{[^}]*bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobile, /\.main\s*\{[^}]*padding-bottom/, "别压住最后一行");
  assert.ok(
    HTML.indexOf('class="config-bar-fixed"') > HTML.indexOf("</main>"),
    "固定条要放在顶栏（.glass 层叠上下文）之外"
  );
  assert.match(HTML, /class="config-bar-fixed"[^>]*x-show="isDraftTab"[\s\S]{0,200}?resetDraft\(\)/);
});

test("Agent 配置是后台的第二个页签，控件与其它配置页签同一套", () => {
  const nav = HTML.slice(HTML.indexOf('<nav class="nav">'), HTML.indexOf("</nav>"));
  const labels = [...nav.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 2), ["概览", "Agent"], "Agent 排在概览之后，不在第一位");

  assert.ok(!HTML.includes("agent.html"), "不再用 iframe 嵌独立页面");
  assert.ok(HTML.includes(`x-if="tab === 'agent'"`), "Agent 配置要是后台自己的页签");

  const section = HTML.slice(
    HTML.indexOf("<!-- Agent 工作台配置"),
    HTML.indexOf("<!-- 概览 -->")
  );
  assert.ok(section.length > 0, "没找到 Agent 页签的模板");
  for (const cls of ["glass card", "switch-slider", "field", "custom-select-trigger", "payload-block"]) {
    assert.ok(section.includes(`class="${cls}`) || section.includes(` ${cls}`), `缺统一控件 ${cls}`);
  }
  assert.ok(!/<select\b/.test(section), "下拉要用自绘的 .custom-select，不用原生 select");
  assert.ok(!/style="/.test(section), "排版走样式表里的布局类，不写行内样式");
  for (const id of ["agent-mcp-url", "agent-mcp-token", "agent-tool-trigger", "agent-search"]) {
    assert.ok(section.includes(`id="${id}"`), `缺可操作锚点 #${id}`);
  }
});

test("配置校验失败会把视线带到出问题的那张卡片", () => {
  const { app, env, errors } = setup();
  const scrolled = [];
  const card = (title) => ({
    querySelector: () => ({ textContent: title }),
    scrollIntoView: () => scrolled.push(title),
  });
  env.document = { querySelectorAll: () => [card("日志设置"), card("模型管理")] };

  app.validationError("模型列表不能为空", "模型管理");

  assert.deepEqual(scrolled, ["模型管理"], "滚到报错的那张卡片，而不是停在原地");
  assert.match(errors.join(" "), /模型列表不能为空/, "提示本身不能丢");

  app.validationError("没有对应卡片", "不存在的卡片");
  assert.deepEqual(scrolled, ["模型管理"], "找不到卡片时不乱滚，也不抛错");
});

test("弹窗补了 dialog 语义与全局 Esc，Provider 卡片写明开关即时生效", () => {
  assert.match(
    fs.readFileSync(path.join(ROOT, "admin-frontend", "script.js"), "utf8"),
    /querySelectorAll\("\.modal-mask > \.modal"\)[\s\S]{0,400}?setAttribute\("role", "dialog"\)/
  );
  assert.match(fs.readFileSync(path.join(ROOT, "admin-frontend", "script.js"), "utf8"), /window\.addEventListener\("keydown", \(e\) => \{\s*\n\s*if \(e\.key !== "Escape"\) return;/);
  assert.match(HTML, /「启用」开关即时生效/);
});

test("放弃 Agent 修改后重进页签会重新加载服务端配置", async () => {
  const { app, requests } = setup();
  app.agentForm = { max_steps: 30 };
  app.agentSnapshot = JSON.stringify({ max_steps: 24 });
  app.agentLoaded = true;              // 已经成功加载过，当前是"有未保存修改"的状态
  app.tab = "agent";
  app.askConfirm = async () => true;              // 用户点了"放弃修改"
  const pending = app.switchTab("dashboard");
  await new Promise((r) => setImmediate(r));
  await pending;
  assert.equal(app.agentSnapshot, "", "快照要清掉，否则重进页签不会重载");
  // 再进 agent 页签：必须真的去拉服务端配置
  const again = app.switchTab("agent");
  await new Promise((r) => setImmediate(r));
  assert(requests.some((r) => r.url === "/api/admin/agent"), "重进页签应重新 loadAgent()");
  for (const r of requests) r.resolve({});
  await again.catch(() => {});
});

test("加载失败后不能保存默认值覆盖服务端配置", async () => {
  const { app, requests, errors } = setup();
  app.api = (url, options) => {
    requests.push({ url, options });
    return Promise.reject(new Error("网关超时"));
  };
  await app.loadAgent();
  assert.equal(app.agentLoaded, false);
  assert.equal(app.agentDirty, false, "没加载成功就不能算有改动");
  const before = requests.length;
  await app.saveAgent();
  assert.equal(requests.length, before, "不该发出任何保存请求");
  assert.match(errors.join(" "), /尚未加载成功/);
});

test("加载成功后保存按钮恢复可用", async () => {
  const { app } = setup();
  let calls = 0;
  app.api = () => {
    calls += 1;
    return Promise.resolve({ enabled: true, max_steps: 24, concurrency: 2, mcp_arguments: {} });
  };
  await app.loadAgent();
  assert.equal(app.agentLoaded, true);
  assert.equal(app.agentDirty, false);
  app.agentForm = { ...app.agentForm, max_steps: 30 };
  assert.equal(app.agentDirty, true);
  assert.equal(calls, 1);
});

test("保存 Agent 配置用 PATCH，避免整文档替换", async () => {
  const { app, requests } = setup();
  app.agentLoaded = true;
  app.agentForm = {
    enabled: false, max_steps: 24, max_tokens: 250000, output_tokens: 16384, max_seconds: 1800,
    concurrency: 2, mcp_enabled: false, mcp_url: "", mcp_token: "", clear_token: false,
    mcp_tool: "", mcp_query_field: "query", mcp_arguments: "{}", mcp_timeout: 45,
  };
  let settled = false;
  const pending = app.saveAgent().finally(() => {
    settled = true;
  });
  for (let i = 0; i < 20 && !settled; i++) {
    await new Promise((r) => setImmediate(r));
    for (const r of requests) r.resolve?.({});
  }
  await pending;
  const save = requests.find((r) => r.url === "/api/admin/agent" && r.options?.method);
  assert(save, "没有发出保存请求");
  assert.equal(save.options.method, "PATCH");
});
