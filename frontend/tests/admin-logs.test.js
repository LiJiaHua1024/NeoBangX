const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup() {
  const env = { URLSearchParams, AbortController };
  vm.createContext(env);
  const source = fs.readFileSync(path.resolve(__dirname, "../../admin-frontend/script.js"), "utf8");
  const app = vm.runInContext(source + "; adminApp()", env);
  const requests = [], errors = [];
  app.api = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  app.toast = (message) => errors.push(message);
  return { app, requests, errors, env };
}

test("日志列表与统计单请求加载，使用同一筛选条件", async () => {
  const { app, requests } = setup();
  app.logCode = " code ";
  const pending = app.loadLogs();
  assert.equal(requests.length, 1);
  const params = new URLSearchParams(requests[0].url.split("?")[1]);
  assert.equal(params.get("code"), "code");
  assert.equal(params.get("include_summary"), "true");
  const data = { items: [{ id: 1 }], total: 120, summary: { total: 120 } };
  requests[0].resolve(data);
  await pending;
  assert.equal(app.logs, data.items);
  assert.equal(app.logSummary, data.summary);
  assert.equal(app.logsTotal, 120);
  assert.equal(requests.length, 1);
});

test("快速切换筛选取消旧请求；即使旧响应迟到也不能覆盖新结果", async () => {
  const { app, requests, errors } = setup();
  const first = app.loadLogs();
  app.logToolId = "25";
  const second = app.loadLogs();
  assert.equal(requests[0].options.signal.aborted, true);
  const latest = { items: [{ id: 2 }], total: 1, summary: { total: 1 } };
  requests[1].resolve(latest);
  await second;
  requests[0].resolve({ items: [{ id: 99 }], total: 99, summary: { total: 99 } });
  await first;
  assert.equal(app.logs, latest.items);
  assert.equal(app.logSummary, latest.summary);
  assert.deepEqual(errors, []);
});

test("后端尚未升级时使用旧汇总接口，保留筛选与展示", async () => {
  const { app, requests } = setup();
  app.logToolId = "25";
  const pending = app.loadLogs();
  requests[0].resolve({ items: [{ id: 1 }], total: 1 });
  await new Promise(setImmediate);
  assert.equal(requests[1].url, "/api/admin/logs/summary?tool_id=25");
  const summary = { total: 1, success: 1 };
  requests[1].resolve(summary);
  await pending;
  assert.equal(app.logSummary, summary);
  assert.equal(app.logs[0].id, 1);
});

test("旧请求报错静默，最新请求失败保留原列表并提示", async () => {
  const { app, requests, errors } = setup();
  const initial = [{ id: 3 }];
  app.logs = initial;
  const first = app.loadLogs(), second = app.loadLogs();
  requests[0].reject(new Error("obsolete"));
  requests[1].reject(new Error("latest failure"));
  await Promise.all([first, second]);
  assert.equal(app.logs, initial);
  assert.deepEqual(errors, ["latest failure"]);
});

test("清理后的越界页自动回退，过程不写入空表", async () => {
  const { app, requests } = setup();
  const initial = [{ id: 8 }];
  app.logs = initial;
  app.logsPage = 9;
  const pending = app.loadLogs();
  requests[0].resolve({ items: [], total: 31, summary: { total: 31 } });
  await new Promise(setImmediate);
  assert.equal(app.logsPage, 2);
  assert.equal(app.logs, initial);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /page=2&/);
  const data = { items: [{ id: 1 }], total: 31, summary: { total: 31 } };
  requests[1].resolve(data);
  await pending;
  assert.equal(app.logs, data.items);
});

async function openDetail(context, sizes = { input: 60000, prompt: 60000, output: 60000 }) {
  const pending = context.app.openLogDetail(42);
  context.requests[0].resolve({ id: 42, payload: null, payload_sizes: sizes });
  await pending;
  return context.app.logPayloadParts;
}

test("大日志先读取元数据，只加载默认展开的两段各一页", async () => {
  const context = setup();
  const parts = await openDetail(context);
  assert.equal(context.requests[0].url, "/api/admin/logs/42?include_payload=false");
  assert.equal(context.requests.length, 3);
  assert.equal(context.requests[1].url, "/api/admin/logs/42/payload/input?offset=0&limit=4096");
  assert.equal(context.requests[2].url, "/api/admin/logs/42/payload/output?offset=0&limit=4096");
  context.requests[1].resolve({ text: "长".repeat(4096), total: 60000 });
  context.requests[2].resolve({ text: "出".repeat(4096), total: 60000 });
  await new Promise(setImmediate);
  assert.equal(parts[0].text.length + parts[2].text.length, 8192);
  assert.equal(parts[1].text, "");
  assert.equal(parts[1].loaded, false);
  assert.equal(context.app.logPayloadPages(parts[0]), 15);
  context.app.toggleLogPayload(parts[1], true);
  assert.match(context.requests[3].url, /payload\/prompt\?offset=0&limit=4096$/);
});

test("原始数据翻页替换当前页，旧页响应不能覆盖新页", async () => {
  const context = setup();
  const [input] = await openDetail(context);
  const next = context.app.loadLogPayload(input, 1);
  assert.equal(context.requests[1].options.signal.aborted, true);
  assert.match(context.requests[3].url, /offset=4096&limit=4096$/);
  context.requests[3].resolve({ text: "第二页", total: 60000 });
  await next;
  context.requests[1].resolve({ text: "旧第一页", total: 60000 });
  await new Promise(setImmediate);
  assert.equal(input.page, 1);
  assert.equal(input.text, "第二页");
  assert.equal(input.loading, false);
  const last = context.app.loadLogPayload(input, 999);
  assert.equal(input.page, 14);
  assert.equal(input.text, "第二页");
  assert.equal(input.loaded, true);
  context.requests[4].resolve({ text: "尾页", total: 60000 });
  await last;
  assert.equal(input.text, "尾页");
});

test("折叠原始数据取消加载并释放文本，重开只发起一次请求", async () => {
  const context = setup();
  const [input] = await openDetail(context);
  context.app.toggleLogPayload(input, false);
  assert.equal(context.requests[1].options.signal.aborted, true);
  context.requests[1].resolve({ text: "迟到的内容", total: 60000 });
  await new Promise(setImmediate);
  assert.equal(input.text, "");
  assert.equal(input.loaded, false);
  context.app.toggleLogPayload(input, true);
  context.app.toggleLogPayload(input, true);
  assert.equal(context.requests.length, 4);
  context.requests[3].resolve({ text: "当前内容", total: 60000 });
  await new Promise(setImmediate);
  assert.equal(input.text, "当前内容");
  context.app.toggleLogPayload(input, false);
  assert.equal(input.text, "");
});

test("翻页期间保留正文，失败后可重试同一页并替换内容", async () => {
  const context = setup();
  const [input] = await openDetail(context);
  context.requests[1].resolve({ text: "第一页正文", total: 60000 });
  await new Promise(setImmediate);
  const next = context.app.loadLogPayload(input, 1);
  assert.equal(input.text, "第一页正文");
  assert.equal(input.loaded, true);
  assert.equal(input.loadedPage, 0);
  context.requests[3].reject(new Error("下一页失败"));
  await next;
  assert.equal(input.text, "第一页正文");
  assert.equal(input.error, "下一页失败");
  const retry = context.app.loadLogPayload(input, 1);
  assert.equal(context.requests.length, 5);
  context.requests[4].resolve({ text: "第二页正文", total: 60000 });
  await retry;
  assert.equal(input.text, "第二页正文");
  assert.equal(input.loadedPage, 1);
  assert.equal(input.error, "");
  assert.equal(input.loading, false);
});

test("切换与关闭详情取消请求，迟到的元数据和原始数据均不能回写", async () => {
  const context = setup();
  const first = context.app.openLogDetail(41);
  const second = context.app.openLogDetail(42);
  assert.equal(context.requests[0].options.signal.aborted, true);
  context.requests[0].resolve({ id: 41, payload_sizes: { input: 9, prompt: 9, output: 9 } });
  await first;
  assert.equal(context.app.logDetail, null);
  assert.equal(context.app.logDetailLoading, true);
  context.requests[1].resolve({ id: 42, payload_sizes: { input: 9, prompt: 9, output: 9 } });
  await second;
  const oldInput = context.app.logPayloadParts[0];
  context.app.closeLogDetail();
  assert.equal(context.requests[2].options.signal.aborted, true);
  assert.equal(context.requests[3].options.signal.aborted, true);
  context.requests[2].resolve({ text: "关闭后的内容", total: 9 });
  context.requests[3].reject(new Error("关闭后错误"));
  await new Promise(setImmediate);
  assert.equal(context.app.logDetail, null);
  assert.equal(context.app.logPayloadParts.length, 0);
  assert.equal(oldInput.text, "");
  assert.deepEqual(context.errors, []);
  const third = context.app.openLogDetail(43);
  context.app.closeLogDetail();
  context.requests[4].resolve({ id: 43, payload_sizes: { input: 9, prompt: 9, output: 9 } });
  await third;
  assert.equal(context.app.logDetail, null);
  assert.equal(context.requests.length, 5);
});

test("空内容不请求正文，页面失败可重试，未记录原始数据不加载", async () => {
  const context = setup();
  const [input, , output] = await openDetail(context, { input: 0, prompt: 1, output: 9 });
  assert.equal(input.loaded, true);
  assert.equal(input.text, "");
  assert.equal(context.requests.length, 2);
  context.requests[1].reject(new Error("加载失败"));
  await new Promise(setImmediate);
  assert.equal(output.error, "加载失败");
  assert.equal(output.loading, false);
  const retry = context.app.loadLogPayload(output, output.page);
  context.requests[2].resolve({ text: "重试成功", total: 9 });
  await retry;
  assert.equal(output.text, "重试成功");
  assert.equal(output.error, "");
  const next = context.app.openLogDetail(43);
  context.requests[3].resolve({ id: 43, payload_sizes: null });
  await next;
  assert.equal(context.app.logPayloadParts.length, 0);
  assert.equal(context.requests.length, 4);
});

test("复制获取全文而非当前页，关闭详情后不能继续复制", async () => {
  const context = setup();
  const [input] = await openDetail(context);
  const copied = [];
  context.app.copyText = async (text) => copied.push(text);
  const copy = context.app.copyLogPayload(input);
  const duplicate = context.app.copyLogPayload(input);
  assert.equal(context.requests.length, 4);
  assert.equal(context.requests[3].url, "/api/admin/logs/42/payload/input/download");
  assert.equal(context.requests[3].options.responseType, "text");
  const full = "全".repeat(60000);
  context.requests[3].resolve(full);
  await Promise.all([copy, duplicate]);
  assert.deepEqual(copied, [full]);
  assert.equal(input.text, "");
  assert.equal(input.copying, false);
  const lateCopy = context.app.copyLogPayload(input);
  context.app.closeLogDetail();
  assert.equal(context.requests[4].options.signal.aborted, true);
  context.requests[4].resolve("过期全文");
  await lateCopy;
  assert.deepEqual(copied, [full]);
});

test("文本 API 保留原文，失败时仍解析 JSON 错误", async () => {
  const { app, env } = setup();
  const actualApi = vm.runInContext("adminApp().api", env);
  env.fetch = async (_path, options) => {
    assert.equal(options.responseType, undefined);
    return { ok: true, text: async () => "原文\r\n🙂" };
  };
  assert.equal(await actualApi.call(app, "/download", { responseType: "text" }), "原文\r\n🙂");
  env.fetch = async () => ({ ok: false, status: 404, json: async () => ({ detail: "原始数据不存在" }) });
  await assert.rejects(actualApi.call(app, "/download", { responseType: "text" }), /原始数据不存在/);
});
