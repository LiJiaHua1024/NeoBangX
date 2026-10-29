const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

/* 运行全解的加载 / 换步 / 分页 / 取消都走 adminApp 自己的方法；
   与 admin-logs.test.js 同一套 vm 隔离，额外注入定时器供轮询与自动播放使用。 */
function setup() {
  const env = { URLSearchParams, AbortController, setTimeout, clearTimeout };
  vm.createContext(env);
  const source = fs.readFileSync(path.resolve(__dirname, "../../admin-frontend/script.js"), "utf8");
  const app = vm.runInContext(source + "; adminApp()", env);
  const requests = [], toasts = [];
  app.api = (url, options = {}) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  app.toast = (message, type) => toasts.push({ message, type });
  return { app, requests, toasts };
}

function report(overrides = {}) {
  const entries = overrides.entries || [
    {
      id: "e-model", kind: "model", label: "执行步骤 1", status: "done", offset_ms: 1200,
      details: { usage: { prompt_tokens: 5000, completion_tokens: 700 }, cached_tokens: 3000,
        provider_id: "prov-a", attempts: 1, context_tokens: 5000 },
      text_sizes: { prompt: 100, output: 200, reasoning: 30 },
    },
    {
      id: "e-tool", kind: "tool", label: "read_material", status: "done", offset_ms: 2400,
      details: {}, text_sizes: { input: 20, output: 50 },
    },
    {
      id: "e-compact", kind: "compaction", label: "压缩上下文", status: "done", offset_ms: 3000,
      details: { reason: "pressure", before: 48000, after: 14300, dropped_units: 6, kept_units: 4 },
      text_sizes: {},
    },
  ];
  return {
    log: { id: 7, code: "NBXU-TEST", tool_id: "agent" },
    device: null,
    task: { id: "task-1", title: "讲评这套卷子", goal: "把错题讲清楚" },
    run: {
      id: "run-1", mode: "execute", status: "completed", step: 2, tokens: 1200, error: "",
      created_at: "2026-10-29T06:00:00+00:00", started_at: null,
      finished_at: "2026-10-29T06:01:00+00:00", duration_ms: 60000, live: false,
      model: "test-model", provider: "prov-a", preferred_provider: "prov-a", switches: [],
      instruction: "重点讲第三题", base_version: null,
      usage: { prompt: 5000, cached: 3000, completion: 700, cached_reported: true },
      limits: { max_tokens: 2000000, context_budget: 262144 }, versions: [],
    },
    summary: { entries: 3, model_calls: 1, tool_calls: 1, reviews: 0, compactions: 1, waiting: 0, text_chars: 400 },
    entries,
    ...overrides,
  };
}

async function opened(data = report()) {
  const { app, requests, toasts } = setup();
  app.openLogDetail = (id) => { requests.push({ url: `drawer:${id}` }); };
  app.closeLogDetail = () => {};
  const pending = app.openAgentRun(7);
  assert.equal(requests[0].url, "/api/admin/logs/7/agent-run");
  requests[0].resolve(data);
  await pending;
  return { app, requests, toasts };
}

test("打开运行全解默认停在封面，并选中第一步", async () => {
  const { app } = await opened();
  assert.equal(app.agentRunOpen, true);
  assert.equal(app.agentView, "cover");
  assert.equal(app.agentEntryId, "e-model");
  assert.equal(app.agentTab, "overview");
  assert.equal(app.agentRun.task.title, "讲评这套卷子");
});

test("加载失败留在封面给出错误，不会静默关闭", async () => {
  const { app, requests } = setup();
  app.closeLogDetail = () => {};
  const pending = app.openAgentRun(9);
  requests[0].reject(new Error("运行记录已不存在"));
  await pending;
  assert.equal(app.agentRunOpen, true);
  assert.equal(app.agentRunError, "运行记录已不存在");
  assert.equal(app.agentRun, null);
});

test("按步骤类型给出可用页签", async () => {
  const { app } = await opened();
  const [model, tool, compaction] = app.agentEntries;
  assert.deepEqual(Array.from(app.agentEntryTabs(model)), ["overview", "context", "output", "reasoning", "usage"]);
  assert.deepEqual(Array.from(app.agentEntryTabs(tool)), ["overview", "input", "output"]);
  assert.deepEqual(Array.from(app.agentEntryTabs(compaction)), ["overview"]);
  assert.equal(app.agentTabLabel("output", tool), "结果");
  assert.equal(app.agentKindMeta(tool).name, "读取材料");
});

test("小正文一次取全，超过阈值按页取", async () => {
  const { app, requests } = await opened();
  app.startAgentRun();
  app.setAgentTab("output");
  assert.match(requests[1].url, /kind=output&offset=0&limit=200$/);
  requests[1].resolve({ text: "正文", total: 2, offset: 0, limit: 2 });
  await new Promise(setImmediate);
  assert.equal(app.agentText.full, true);

  const big = report({
    entries: [{
      id: "big", kind: "model", label: "执行步骤 1", status: "done", offset_ms: 0,
      details: {}, text_sizes: { prompt: 300000 },
    }],
  });
  const second = await opened(big);
  second.app.startAgentRun();
  second.app.setAgentTab("context");
  assert.match(second.requests[1].url, /kind=prompt&offset=0&limit=16384$/);
  second.requests[1].resolve({ text: "x".repeat(16384), total: 300000, offset: 0, limit: 16384 });
  await new Promise(setImmediate);
  assert.equal(second.app.agentText.full, false);
  second.app.agentTextPage(1);
  assert.match(second.requests[2].url, /offset=16384&limit=16384$/);
});

test("换步时取消旧正文请求，迟到的响应不回写", async () => {
  const { app, requests } = await opened();
  app.startAgentRun();
  app.setAgentTab("output");
  const stale = requests[1];
  app.agentStep(1);
  assert.equal(stale.options.signal.aborted, true);
  stale.resolve({ text: "旧内容", total: 3, offset: 0, limit: 3 });
  await new Promise(setImmediate);
  assert.equal(app.agentText, null);
});

test("运行中刷新保留当前步骤，不打断正在看的内容", async () => {
  const live = report();
  live.run = { ...live.run, status: "running", live: true, finished_at: null };
  const { app, requests } = await opened(live);
  app.startAgentRun();
  app.agentEntryId = "e-tool";
  const pending = app.refreshAgentRun();
  const refresh = requests[requests.length - 1];
  assert.match(refresh.url, /\/api\/admin\/logs\/7\/agent-run$/);
  refresh.resolve({ ...live, summary: { ...live.summary, entries: 4 } });
  await pending;
  assert.equal(app.agentEntryId, "e-tool");
  assert.equal(app.agentRun.summary.entries, 4);
  app.closeAgentRun();
});

test("首尾夹住，关闭后清空状态与定时器", async () => {
  const { app } = await opened();
  app.startAgentRun();
  app.agentStep(-1);
  assert.equal(app.agentEntryId, "e-model");
  app.agentStep(1);
  app.agentStep(1);
  app.agentStep(1);
  assert.equal(app.agentEntryId, "e-compact");
  app.closeAgentRun();
  assert.equal(app.agentRunOpen, false);
  assert.equal(app.agentRun, null);
  assert.equal(app.agentEntryId, "");
  assert.equal(app.agentPlaying, false);
});

test("审阅意见可切回原始 JSON", async () => {
  const { app } = await opened();
  app.agentTab = "review";
  app.agentText = {
    kind: "review", offset: 0, total: 20, limit: 20, full: true,
    text: JSON.stringify({ summary: "可用", issues: [] }),
  };
  assert.ok(app.agentReviewData);
  app.agentRaw = true;
  assert.equal(app.agentReviewData, null);
});

test("Agent 日志行走全解，运行记录缺失时退回详情抽屉", async () => {
  const { app, requests } = setup();
  app.openAgentRun = (id) => requests.push({ url: `run:${id}` });
  app.openLogDetail = (id) => requests.push({ url: `drawer:${id}` });
  app.openLogFor({ id: 3, tool_id: "agent", agent_available: true });
  app.openLogFor({ id: 4, tool_id: "agent", agent_available: false });
  app.openLogFor({ id: 5, tool_id: "13" });
  assert.deepEqual(requests.map((r) => r.url), ["run:3", "drawer:4", "drawer:5"]);
});

test("日志表与抽屉都提供运行全解入口", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../admin-frontend/index.html"), "utf8");
  assert.match(html, /@click="openLogFor\(l\)"/, "Agent 行点击要分流到全解");
  assert.match(html, /x-show="l\.tool_id === 'agent' && l\.agent_available !== false"/, "只有运行记录还在时才给全解按钮");
  assert.match(html, /打开运行全解/, "详情抽屉要能一键转到全解");
  assert.match(html, /class="arv"/, "舞台根节点存在");
  assert.match(html, /第 \$\{agentIndex \+ 1\} \/ \$\{agentEntries\.length\} 步/, "位置指示");
});
