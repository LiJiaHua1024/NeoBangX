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
  assert.match(mobile, /\.config-bar\s*\{[^}]*position:\s*fixed/, "窄屏保存条要固定");
  assert.match(mobile, /\.config-bar\s*\{[^}]*bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobile, /\.main\s*\{[^}]*padding-bottom/, "别压住最后一行");
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
