const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

/* 运行记录的加载 / 换步 / 筛选 / 分页 / 取消都走 adminApp 自己的方法；
   与 admin-logs.test.js 同一套 vm 隔离，额外注入定时器供轮询使用。 */
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
  const attempts = [
    { provider: "prov-a", provider_name: "通道一", attempt: 1, outcome: "retry",
      status: 502, error_code: "provider_busy", error: "bad gateway", wait_ms: 1000, elapsed_ms: 400 },
    { provider: "prov-a", provider_name: "通道一", attempt: 2, outcome: "success",
      elapsed_ms: 8200 },
  ];
  const entries = overrides.entries || [
    {
      id: "e-model", key: "run-key-1", kind: "model", label: "执行步骤 1", status: "done",
      offset_ms: 1200, duration_ms: 8200, duration_estimated: false,
      details: { usage: { prompt_tokens: 5000, completion_tokens: 700 }, cached_tokens: 3000,
        provider_id: "prov-a", attempts: 2, context_tokens: 5200, finish_reason: "stop",
        first_token_ms: 900, budget_tokens: 5700, output_tokens: 16384, config_revision: 3,
        role: "agent", message_count: 6, tool_count: 3, attempt_log: attempts },
      text_sizes: { prompt: 100, output: 200, reasoning: 30 },
    },
    {
      id: "e-tool", key: "tool:1", kind: "tool", label: "read_material", status: "done",
      offset_ms: 9600, duration_ms: 1400, duration_estimated: false,
      details: {}, text_sizes: { input: 20, output: 50 },
    },
    {
      id: "e-compact", key: "compact-1", kind: "compaction", label: "压缩上下文", status: "done",
      offset_ms: 12000, duration_ms: 200, duration_estimated: false,
      details: { reason: "pressure", before: 48000, after: 14300, dropped_units: 6,
        kept_units: 4, kept_notes: 1, digest_chars: 900 },
      text_sizes: {},
    },
    {
      id: "e-review", kind: "review", label: "开放式审阅", status: "done",
      offset_ms: 13000, duration_ms: 45000, duration_estimated: false,
      details: { usage: { prompt_tokens: 8000, completion_tokens: 300 }, cached_tokens: 6000,
        provider_id: "prov-a", attempts: 1, context_tokens: 8000, issues: 2,
        review_summary: "整体可用", version_id: "v1" },
      text_sizes: { review: 120, prompt: 90 },
    },
  ];
  return {
    log: { id: 7, code: "NBXU-TEST", tool_id: "agent", status: "success", units: 1,
      ip: "10.0.0.9", user_agent: "UA/1.0", error_message: "" },
    device: { id: 1, short_code: "FP-1", note: "老王电脑" },
    task: { id: "task-1", title: "讲评这套卷子", goal: "把错题讲清楚" },
    run: {
      id: "run-1", mode: "execute", status: "completed", step: 2, tokens: 1200, error: "",
      created_at: "2026-10-29T06:00:00+00:00", started_at: "2026-10-29T06:00:02+00:00",
      finished_at: "2026-10-29T06:01:00+00:00", duration_ms: 60000, queued_ms: 2500,
      live: false, charged: true, request_key: "key-1",
      model: "test-model", provider: "prov-a", preferred_provider: "prov-a",
      switches: [{ from: "prov-a", to: "prov-b", step: 2 }],
      instruction: "重点讲第三题", base_version: null,
      usage: { prompt: 13000, cached: 9000, completion: 1000, cached_reported: true },
      limits: { max_tokens: 2000000, max_steps: 24, output_tokens: 16384, max_seconds: 1800,
        context_budget: 262144, keep_tail_steps: 4, provider_attempts: 3,
        retry_wait_cap_seconds: 60, switch_compaction_ratio: 0.5 },
      config: { tools: ["material_search"], review: true, auto_improve: false,
        review_rounds: 1, materials: 2, teaching_tool: "t1", revision: 3, review_rounds_used: 0 },
      template_names: { t1: "全解" },
      versions: [],
    },
    summary: { entries: entries.length, model_calls: 1, tool_calls: 1, reviews: 1,
      compactions: 1, waiting: 0, problems: 0, max_context_tokens: 8000, switches: 1,
      text_chars: 400 },
    entries,
    ...overrides,
  };
}

async function opened(data = report()) {
  const { app, requests, toasts } = setup();
  app.closeLogDetail = () => {};
  const pending = app.openAgentRun(7);
  assert.equal(requests[0].url, "/api/admin/logs/7/agent-run");
  requests[0].resolve(data);
  await pending;
  return { app, requests, toasts };
}

test("打开运行记录直接进入步骤视图，完成看第一步、运行中看最后一步", async () => {
  const { app } = await opened();
  assert.equal(app.agentRunOpen, true);
  assert.equal(app.agentPane, "step");
  assert.equal(app.agentEntryId, "e-model");
  assert.equal(app.agentTab, "overview");
  assert.equal(app.agentRun.task.title, "讲评这套卷子");
  assert.match(app.agentRunMeta(), /使用码 NBXU-TEST/);
  assert.match(app.agentRunMeta(), /老王电脑/);

  const live = report();
  live.run = { ...live.run, status: "running", live: true, finished_at: null };
  const second = await opened(live);
  assert.equal(second.app.agentEntryId, "e-review");
  second.app.closeAgentRun();
});

test("加载失败留在原位给出错误，不会静默关闭", async () => {
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

test("步骤行给出耗时、Provider、上下文与检索信息", async () => {
  const { app } = await opened();
  const [model, tool, compaction] = app.agentEntries;
  assert.equal(app.agentStepDuration(model), "8.2 s");
  assert.match(app.agentStepSecondary(model), /prov-a/);
  assert.match(app.agentStepSecondary(model), /上下文 5.2k/);
  assert.match(app.agentStepSecondary(model), /尝试 2 次/);
  assert.match(app.agentStepSecondary(tool), /50 字/);
  assert.match(app.agentStepSecondary(compaction), /48.0k → 14.3k/);
});

test("小正文一次取全，超过阈值按页取", async () => {
  const { app, requests } = await opened();
  app.setAgentTab("output");
  assert.match(requests[1].url, /kind=output&offset=0&limit=200$/);
  requests[1].resolve({ text: "正文", total: 2, offset: 0, limit: 2 });
  await new Promise(setImmediate);
  assert.equal(app.agentText.full, true);

  const big = report({
    entries: [{
      id: "big", kind: "model", label: "执行步骤 1", status: "done", offset_ms: 0,
      duration_ms: 10, duration_estimated: false,
      details: {}, text_sizes: { prompt: 300000 },
    }],
  });
  const second = await opened(big);
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
  app.setAgentTab("output");
  const stale = requests[1];
  app.agentStep(1);
  assert.equal(stale.options.signal.aborted, true);
  stale.resolve({ text: "旧内容", total: 3, offset: 0, limit: 3 });
  await new Promise(setImmediate);
  assert.equal(app.agentText, null);
});

test("刷新保留当前步骤；停在最后一步时跟到新步骤", async () => {
  const live = report();
  live.run = { ...live.run, status: "running", live: true, finished_at: null };
  const { app, requests } = await opened(live);
  app.selectAgentEntry("e-tool");
  let pending = app.refreshAgentRun();
  let refresh = requests[requests.length - 1];
  refresh.resolve({ ...live, summary: { ...live.summary, entries: 5 } });
  await pending;
  assert.equal(app.agentEntryId, "e-tool");

  app.selectAgentEntry("e-review");
  pending = app.refreshAgentRun();
  refresh = requests[requests.length - 1];
  const added = { id: "e-new", kind: "model", label: "执行步骤 4", status: "running",
    offset_ms: 60000, duration_ms: 0, duration_estimated: false,
    details: {}, text_sizes: {} };
  refresh.resolve({ ...live, entries: [...live.entries, added],
    summary: { ...live.summary, entries: 5 } });
  await pending;
  assert.equal(app.agentEntryId, "e-new");
  app.closeAgentRun();
});

test("筛选与搜索只改列表，不重新请求后端", async () => {
  const failed = { id: "e-bad", kind: "model", label: "执行步骤 9", status: "failed",
    offset_ms: 20000, duration_ms: 300, duration_estimated: false,
    details: { error: "凭证无效", error_code: "model_auth" }, text_sizes: {} };
  const data = report();
  data.entries = [...data.entries, failed];
  const { app, requests } = await opened(data);
  const before = requests.length;
  assert.deepEqual({ ...app.agentKindCounts }, { all: 5, model: 2, tool: 1, review: 1, compaction: 1, problem: 1 });
  assert.equal(app.agentFilterChips().find((item) => item.id === "problem").count, 1);

  app.setAgentFilter("tool");
  assert.deepEqual(app.agentVisibleEntries.map((entry) => entry.id), ["e-tool"]);
  assert.equal(app.agentEntryId, "e-tool");

  app.setAgentFilter("problem");
  assert.deepEqual(app.agentVisibleEntries.map((entry) => entry.id), ["e-bad"]);

  app.setAgentFilter("all");
  app.agentQuery = "read_material";
  app.agentQueryChanged();
  assert.deepEqual(app.agentVisibleEntries.map((entry) => entry.id), ["e-tool"]);

  app.agentQuery = "zzz";
  app.agentQueryChanged();
  assert.equal(app.agentVisibleEntries.length, 0);
  assert.equal(app.agentEntry, null);
  assert.equal(app.agentPane, "step");
  assert.equal(requests.length, before, "筛选与搜索不发请求");
});

test("运行信息给出基础、限制、配置与逐步用量", async () => {
  const { app } = await opened();
  app.setAgentPane("run");
  assert.equal(app.agentPane, "run");

  const basics = app.agentRunBasics();
  assert.equal(basics.find((row) => row.label === "日志").value, "#7");
  assert.equal(basics.find((row) => row.label === "运行 ID").value, "run-1");
  assert.equal(basics.find((row) => row.label === "排队").value, "2.5 s");

  const limits = app.agentLimitRows();
  assert.equal(limits.find((row) => row.label === "同家尝试上限").value, "3 次");
  assert.equal(limits.find((row) => row.label === "上下文阈值").value, "262,144 tok");

  const config = app.agentConfigRows();
  assert.equal(config.find((row) => row.label === "教学工具").value, "全解");
  assert.equal(config.find((row) => row.label === "材料").value, "2 份");
  assert.equal(config.find((row) => row.label === "配置版本").value, "r3");
  assert.equal(config.find((row) => row.label === "启用工具").value, "材料检索");

  const rows = app.agentUsageRows();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].kind, "模型调用");
  assert.equal(rows[0].cached, "3.0k tok");
  assert.equal(rows[1].cached, "—");
  assert.equal(rows[2].context, "48.0k → 14.3k");
});

test("尝试链按顺序解释重试与成功", async () => {
  const { app } = await opened();
  const rows = app.agentAttemptRows(app.agentEntries[0]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].head, /第 1 次/);
  assert.match(rows[0].head, /同家重试/);
  assert.match(rows[0].head, /HTTP 502/);
  assert.match(rows[0].head, /服务繁忙/);
  assert.equal(rows[0].error, "bad gateway");
  assert.match(rows[1].head, /成功/);
  assert.equal(rows[1].elapsed, "8.2 s");
  assert.equal(app.agentAttemptRows(app.agentEntries[1]).length, 0);
});

test("步骤事实包含首字、预算、消息数与步骤键", async () => {
  const { app } = await opened();
  const labels = app.agentEntryFacts(app.agentEntries[0]).map((fact) => fact.label);
  for (const label of ["角色", "Provider", "尝试", "首字延迟", "上下文", "输入", "缓存命中",
    "输出", "结束原因", "累计预算", "输出上限", "配置版本", "消息数", "工具数", "步骤键"]) {
    assert.ok(labels.includes(label), `缺少 ${label}`);
  }
  assert.equal(app.agentEntryFacts(app.agentEntries[0]).find((fact) => fact.label === "首字延迟").value, "900 ms");
});

test("复制元数据只带元数据，不带正文", async () => {
  const { app } = await opened();
  const copied = [];
  app.copyText = async (text) => copied.push(text);
  await app.copyAgentEntryMeta();
  const entry = JSON.parse(copied[0]);
  assert.equal(entry.entry.id, "e-model");
  assert.equal(entry.run_id, "run-1");
  assert.equal(entry.text, undefined);

  await app.copyAgentRunMeta();
  const run = JSON.parse(copied[1]);
  assert.equal(run.run.id, "run-1");
  assert.equal(run.entries.length, 4);
  assert.equal(run.log.id, 7);
  assert.equal(run.payload, undefined);
});

test("预算为 0 或负数时显示未设上限，缓存未上报不显示 0%", async () => {
  for (const limit of [0, -5]) {
    const data = report();
    data.run.limits = { ...data.run.limits, max_tokens: limit };
    const { app } = await opened(data);
    assert.equal(app.agentBudgetText(), "1.2k");
    assert.equal(app.agentBudgetHint(), "未设上限");
    assert.equal(app.agentBudgetPercent(), 0);
  }

  const data = report();
  data.run.usage = { ...data.run.usage, cached_reported: false };
  const { app } = await opened(data);
  assert.equal(app.agentCachedRateText(), "未上报");
  assert.equal(app.agentCacheSub(), "");
  assert.equal(app.agentCachedText(), "未上报");
});

test("没有步骤的轮次直接展示运行信息与空态提示", async () => {
  const data = report({ entries: [] });
  data.run = { ...data.run, status: "failed", error: "模型服务调用失败" };
  data.summary = { ...data.summary, entries: 0, problems: 0 };
  const { app } = await opened(data);
  assert.equal(app.agentPane, "run");
  assert.equal(app.agentEntry, null);
  assert.equal(app.agentRunAlertTitle(), "运行失败");
  assert.match(app.agentEmptyHint(), /模型服务调用失败/);
  assert.equal(app.agentKindCounts.all, 0);
});

test("Agent 专属错误分类有中文短标签", async () => {
  const { app } = await opened();
  assert.equal(app.agentErrorLabel("model_timeout"), "模型超时");
  assert.equal(app.agentErrorLabel("output_limit"), "输出上限");
  assert.equal(app.agentErrorLabel("provider_busy"), "服务繁忙");
  assert.equal(app.agentErrorLabel(""), "");
});

test("上下文页签可以把 JSON 格式化查看", async () => {
  const { app } = await opened();
  app.agentTab = "context";
  app.agentText = { kind: "prompt", offset: 0, total: 7, limit: 7, full: true, text: '{"a":1}' };
  app.agentPretty = true;
  assert.match(app.agentPreText(), /\n  "a": 1/);
  app.agentPretty = false;
  assert.equal(app.agentPreText(), '{"a":1}');
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

test("Agent 日志行走运行记录，运行记录缺失时退回详情抽屉", () => {
  const { app, requests } = setup();
  app.openAgentRun = (id) => requests.push({ url: `run:${id}` });
  app.openLogDetail = (id) => requests.push({ url: `drawer:${id}` });
  app.openLogFor({ id: 3, tool_id: "agent", agent_available: true });
  app.openLogFor({ id: 4, tool_id: "agent", agent_available: false });
  app.openLogFor({ id: 5, tool_id: "13" });
  assert.deepEqual(requests.map((r) => r.url), ["run:3", "drawer:4", "drawer:5"]);
});

test("关闭后清空筛选与选中状态", async () => {
  const { app } = await opened();
  app.setAgentFilter("tool");
  app.agentQuery = "read";
  app.closeAgentRun();
  assert.equal(app.agentRunOpen, false);
  assert.equal(app.agentRun, null);
  assert.equal(app.agentEntryId, "");
  assert.equal(app.agentPane, "step");
  assert.equal(app.agentFilter, "all");
  assert.equal(app.agentQuery, "");
});

test("日志表与抽屉都提供运行记录入口，封面与播放已移除", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../admin-frontend/index.html"), "utf8");
  assert.match(html, /@click="openLogFor\(l\)"/, "Agent 行点击要分流到运行记录");
  assert.match(html, /x-show="l\.tool_id === 'agent' && l\.agent_available !== false"/);
  assert.match(html, /@click\.stop="openAgentRun\(l\.id\)" title="运行记录">运行</, "列表动作改为运行");
  assert.match(html, /打开运行记录/, "详情抽屉要能一键转到运行记录");
  assert.match(html, /class="arv"/, "运行记录根节点存在");
  assert.match(html, /arv-stats/, "指标条存在");
  assert.match(html, /arv-step-list/, "步骤列表存在");
  assert.match(html, /arv-runinfo/, "运行信息存在");
  assert.match(html, /运行信息/, "运行信息入口存在");
  assert.doesNotMatch(html, /arv-cover/, "讲题封面已移除");
  assert.doesNotMatch(html, /开始复盘/, "复盘入口已移除");
  assert.doesNotMatch(html, /arv-dock/, "底部播放条已移除");
});
