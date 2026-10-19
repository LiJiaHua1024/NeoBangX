/* 批次 2（前端可用性）回归：草稿按工具分键、401/403 分路、导出格式键盘可选、
   pagehide 释放扫码会话，以及模板与样式里对应的改动。

   这些方法都长在 script.js 那个大对象里，测试按名切片取出来单独跑
   （与 fp-summary / background-performance 等既有测试同一套做法）。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const SRC = fs.readFileSync(path.join(ROOT, "frontend", "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "frontend", "index.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "frontend", "styles.css"), "utf8");

/* 取对象成员方法（4 空格缩进的 `name(...) { … },`）：花括号配对扫描，
   模板串里的 ${} 也是配对的，够用 */
function methodSource(name) {
  const at = SRC.indexOf(`\n    ${name}(`);
  assert.ok(at >= 0, `script.js 里找不到方法 ${name}`);
  const open = SRC.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < SRC.length; i += 1) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(at + 1, i + 1) + ",";
    }
  }
  throw new Error(`方法 ${name} 的花括号不闭合`);
}

function load(names, globals = {}) {
  const env = { LS: { draft: "nbx_draft" }, setTimeout, clearTimeout, ...globals };
  vm.createContext(env);
  const body = names.map(methodSource).join("\n");
  return vm.runInContext(`({ ${body} })`, env);
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("草稿按工具分键：切工具各看各的，刷新不再串台", () => {
  const store = memoryStorage();
  const app = load(["_draftKey", "_loadDraft", "flushDraft"], { localStorage: store });

  app.currentTool = { id: "5" };
  app.input = "写给工具 5 的";
  app.flushDraft();
  assert.equal(store.getItem("nbx_draft:5"), "写给工具 5 的");

  app.currentTool = { id: "9" };
  assert.equal(app._loadDraft(), "", "别的工具没写过就是空的，不该读到工具 5 的草稿");

  app.currentTool = { id: "5" };
  assert.equal(app._loadDraft(), "写给工具 5 的", "切回来草稿还在");
});

test("老版本的单键草稿认领给当前工具，且不会再被别的工具读到", () => {
  const store = memoryStorage();
  store.setItem("nbx_draft", "升级前写的");
  const app = load(["_draftKey", "_loadDraft"], { localStorage: store });

  app.currentTool = { id: "7" };
  assert.equal(app._loadDraft(), "升级前写的", "升级后第一次进来不能把用户的草稿丢掉");
  assert.equal(store.getItem("nbx_draft:7"), "升级前写的");
  assert.equal(store.getItem("nbx_draft"), null, "老键认领后要删掉，免得又被别的工具读走");

  app.currentTool = { id: "8" };
  assert.equal(app._loadDraft(), "");
});

test("403 保留本机凭证，只有 401 才清", () => {
  const app = load(["handleAuthFailure"]);
  const calls = [];
  app.isAuthenticated = true;
  app.clearAuth = () => calls.push("clear");
  app.openCodeModal = (h) => calls.push("modal:" + h);

  app.handleAuthFailure("额度已用尽", 403);
  assert.deepEqual(calls, [], "403 时码还在、只是不可用，清掉凭证等于让用户白输一遍");

  app.handleAuthFailure("请先输入使用码", 401);
  assert.deepEqual(calls, ["clear"]);

  app.isAuthenticated = false;
  app.handleAuthFailure("额度已用尽", 403);
  assert.deepEqual(calls, ["clear", "modal:额度已用尽"], "未登录时 403 仍要引导输入使用码");
});

test("导出格式能键盘选，首尾循环且焦点跟着走", () => {
  const app = load(["onExportFormatKeydown"]);
  app.exportFormats = [{ id: "plaintext" }, { id: "word" }, { id: "pdf" }];
  app.exportFormat = "plaintext";
  const focused = [];
  const container = { querySelector: (sel) => ({ focus: () => focused.push(sel) }) };
  const key = (k) => ({ key: k, currentTarget: container, preventDefault() {} });

  app.onExportFormatKeydown(key("ArrowDown"));
  assert.equal(app.exportFormat, "word");
  app.onExportFormatKeydown(key("ArrowDown"));
  assert.equal(app.exportFormat, "pdf");
  app.onExportFormatKeydown(key("ArrowDown"));
  assert.equal(app.exportFormat, "plaintext", "到底了绕回第一个");
  app.onExportFormatKeydown(key("ArrowUp"));
  assert.equal(app.exportFormat, "pdf", "往上从最后一个绕回来");
  assert.ok(focused.some((s) => s.includes("data-export-i")), "焦点要跟着选中项走");
});

test("pagehide 会释放扫码配对会话（服务器内存里那批照片）", () => {
  const app = load(["_onPageHide"]);
  const calls = [];
  app.flushDraft = () => calls.push("flush");
  app.releasePairSession = () => calls.push("release");
  app.abortActiveGeneration = () => calls.push("abort");
  app.pairToken = "tok";
  app.streaming = false;

  app._onPageHide();

  assert.deepEqual(calls, ["flush", "release"], "没在生成也要释放会话，别让后端等超时回收");
});

test("模板与样式跟上了这几处改动", () => {
  assert.match(HTML, /x-show="codeModal"[\s\S]{0,140}@keydown\.escape\.window="codeModal && closeCodeModal\(\)"/);
  assert.match(HTML, /role="radiogroup" aria-label="导出格式"/);
  assert.match(HTML, /role="radio" :aria-checked="exportFormat === f\.id"/);
  assert.match(HTML, /:tabindex="exportFormat === f\.id \? 0 : -1"/);
  assert.match(CSS, /@media \(orientation: landscape\) \{[\s\S]{0,240}padding-left: env\(safe-area-inset-left, 0px\)/);
  assert.match(CSS, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(CSS, /@media \(pointer: coarse\) \{[\s\S]{0,400}\.icon-btn \{ min-width: 2\.75rem; min-height: 2\.75rem; \}/);
  assert.match(SRC, /const key = this\._draftKey\(\);/, "落盘的键要在输入变化时定下来，否则切工具后会写串");
  assert.match(SRC, /this\.flushDraft\(\);\s*\n\s*this\.currentTool = tool;\s*\n\s*this\.input = this\._loadDraft\(\);/);
});
