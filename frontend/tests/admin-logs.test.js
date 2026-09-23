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
  return { app, requests, errors };
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
