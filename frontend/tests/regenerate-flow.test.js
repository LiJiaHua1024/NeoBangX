/* 「重新生成」流程用例（通用工具路径的收尾与版本记账）
   运行：node frontend/tests/regenerate-flow.test.js

   这里不动浏览器：把 script.js 装进一个 Function 里拿到真正的组件对象（nbx()），
   只把它用到的存储与界面副作用换成替身，然后直接跑 finalize / switchVersion /
   regenerate 这些真正在跑的代码。守的是这次改动风险最高的几处：
   - 重新生成后旧结果必须还在，且「哪一版由谁生成」记的是发起请求时的模型
   - 失败的重新生成：有残文留一版、零产出则记录一动不动（屏幕恢复旧结果）
   - 续写写回活动版本，而不是新建一版
   - 切版本后屏幕状态（错误卡 / 续写入口 / 失败模型）跟着那一版走
   - 「直接重试」在零正文时仍能发起（既有能力，不能被新按钮改丢）
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

/* ---------------- 存储与组件装载 ---------------- */

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

/* 模块作用域只碰了一处浏览器 API：WIDE_MQ = window.matchMedia(...)。
   组件里还有几处裸 matchMedia（finePointer、prefers-reduced-motion 判定），
   在 Node 里没有全局 matchMedia，所以先补一个，否则装载组件就会 ReferenceError。 */
if (typeof global.matchMedia !== "function") {
  global.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}

function makeWindow() {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  return { matchMedia: () => mq };
}

function loadComponent(storage) {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn nbx;"
  );
  const nbx = factory(
    makeWindow(), undefined, storage, undefined, { hostname: "test" }, undefined,
    undefined, undefined, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  const c = nbx();
  // 界面副作用替身：只记录发生了什么，不碰 DOM
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.renderedCount = 0;
  c.doRender = function () { this.renderedCount += 1; };
  c.stopTimer = () => {};
  c.stopThinkTimer = () => {};
  c.resetReasoning = function () { this.reasoning = ""; };
  c.generateTitle = () => {};
  c._runSeq = 1;
  c.currentTool = { id: "1", name: "工具一", icon: "book" };
  c.selectedModel = "model-current";
  c.isAuthenticated = false;
  // 使用码门禁与本用例无关（它只管「能不能发起」），统一放行
  c.ensureCanRun = () => true;
  return c;
}

/* 一条已经落盘的单版本记录（版本化之前的形状） */
function seedRecord(c, opts) {
  const o = opts || {};
  const item = {
    v: 3,
    id: "h1",
    toolId: "1",
    toolName: "工具一",
    icon: "book",
    title: "",
    error: "",
    partial: false,
    createdAt: 1000,
    updatedAt: 2000,
    model: "model-old",
    inputHead: "题目",
    hasMigration: false,
    hasPaper: false,
    _bodyLoaded: true,
    input: "题目",
    output: o.output !== undefined ? o.output : "第一版正文",
    fileName: "",
  };
  if (o.versions) {
    item.versions = o.versions;
    item.activeVersionId = o.activeVersionId;
  }
  c.history = [item];
  c.activeHistoryId = item.id;
  c.submittedInput = item.input;
  c.output = item.output;
  c.status = "done";
  c.errorMsg = "";
  c.failedModel = "";
  c.errorLimited = false;
  c._regenPrevOutput = "";
  c._streamBaselineLen = 0;
  c._persistHistoryItem(item);
  return item;
}

/* 读回落盘的东西，模拟「关掉页面再打开」 */
function readBack(c, id) {
  const body = JSON.parse(c.localStorage ? "{}" : "{}");
  return body;
}

function bodyOnDisk(storage, id) {
  const raw = storage.getItem("nbx_h:" + id);
  return raw ? JSON.parse(raw) : null;
}
function indexOnDisk(storage) {
  const raw = storage.getItem("nbx_history");
  return raw ? JSON.parse(raw) : [];
}

let passed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

/* ---------------- 成功重新生成 ---------------- */

test("成功重新生成：追加为新版本并激活，旧正文与旧模型都还在", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);

  // 发起重新生成时选的是 model-a，收尾时用户已把右上角切成了别的模型
  c.output = "第二版正文";
  c.selectedModel = "model-switched-after";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "model-a" });

  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.versions[0].output, "第一版正文");
  assert.strictEqual(item.versions[0].model, "model-old");
  assert.strictEqual(item.versions[1].output, "第二版正文");
  assert.strictEqual(item.versions[1].model, "model-a", "记的是发起请求时的模型，不是收尾时的");
  assert.strictEqual(item.output, "第二版正文");
  assert.strictEqual(item.model, "model-a");
  assert.strictEqual(item.activeVersionId, item.versions[1].id);
  assert.strictEqual(c.versionCount, 2, "切换器应显示 2 版");
  assert.strictEqual(c.versionIndex, 1, "默认停在最新一版");

  // 落盘：正文键里必须写着版本数组，索引里带着版本数
  const body = bodyOnDisk(storage, item.id);
  assert.strictEqual(body.versions.length, 2);
  assert.strictEqual(body.activeVersionId, item.activeVersionId);
  assert.strictEqual(indexOnDisk(storage)[0].verCount, 2);
});

test("成功重新生成但用户中途停止：这一版标成 partial（续写入口保留）", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);

  c.output = "写到一半";
  c.finalize("stopped", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m" });

  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.partial, true);
  assert.strictEqual(item.versions[1].partial, true);
  assert.strictEqual(item.error, "");
});

test("第一次重新生成前的记录没有版本容器：播种出的第一版沿用原归属与时间", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  assert.strictEqual(item.versions, undefined);
  // 落盘会把 updatedAt 刷新成现在（每次真实改动都这样），播种取的正是它
  const stampedAt = item.updatedAt;

  c.output = "第二版";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m2" });

  assert.strictEqual(item.versions[0].at, stampedAt);
  assert.strictEqual(item.versions[0].model, "model-old", "第一版的归属沿用记录原来的模型");
});

/* ---------------- 失败的重新生成 ---------------- */

test("失败但有残文：残文留成一版并标明失败，旧版本原样不动", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  const firstId = () => item.versions[0].id;

  c.output = "残缺的正文";
  c.failedModel = "model-bad";
  c.finalize("error", "生成失败，请稍后重试", c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "model-bad" });
  const v1 = firstId();

  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.versions[0].id, v1);
  assert.strictEqual(item.versions[0].output, "第一版正文");
  assert.strictEqual(item.versions[0].error, "", "旧版本不能被标成失败");
  assert.strictEqual(item.versions[1].error, "生成失败，请稍后重试");
  assert.strictEqual(item.versions[1].model, "model-bad");
  assert.strictEqual(c.failedModel, "model-bad", "失败归因留给换模型弹窗");
});

test("失败且一个字都没产出（新版本）：记录一动不动，屏幕恢复旧结果", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  item.versions = [
    { id: "v1", output: "第一版正文", model: "model-old", at: 2000, partial: false, error: "" },
    { id: "v2", output: "第二版正文", model: "model-a", at: 3000, partial: false, error: "" },
  ];
  item.activeVersionId = "v2";
  item.output = "第二版正文";
  item.model = "model-a";
  c.output = "第二版正文";
  c._persistHistoryItem(item);
  const before = JSON.stringify(bodyOnDisk(storage, item.id));

  // 重新生成：开流前记下屏幕正文，随后一个字都没产出
  c._regenPrevOutput = c.output;
  c.output = "";
  c.failedModel = "model-bad";
  c.finalize("error", "生成失败", c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "model-bad" });

  assert.strictEqual(item.versions.length, 2, "零产出不该新增版本");
  assert.strictEqual(item.activeVersionId, "v2", "活动版本不能被动");
  assert.strictEqual(item.error, "", "旧结果不能被标成失败");
  assert.strictEqual(c.output, "第二版正文", "屏幕要恢复成旧结果");
  assert.strictEqual(c.status, "error", "错误卡照常显示");
  assert.strictEqual(c.errorMsg, "生成失败");
  assert.strictEqual(JSON.stringify(bodyOnDisk(storage, item.id)), before, "落盘内容一个字节都不该变");
  assert.strictEqual(c._regenPrevOutput, "", "快照用完即弃");
});

test("失败且一个字都没产出（续写路径）：旧行为不变——保留原正文，不新增版本", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  item.versions = [
    { id: "v1", output: "第一版正文", model: "model-old", at: 2000, partial: false, error: "" },
    { id: "v2", output: "第二版正文", model: "model-a", at: 3000, partial: false, error: "" },
  ];
  item.activeVersionId = "v2";
  item.output = "第二版正文";
  c.output = "";

  c.finalize("error", "生成失败", c._runSeq, { updateId: item.id, modelUsed: "model-bad" });

  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.versions[1].output, "第二版正文", "零产出不能把活动版本的内容清掉");
  assert.strictEqual(item.versions[1].model, "model-bad", "失败归属写回活动版本（与版本化之前一致）");
  assert.strictEqual(item.error, "生成失败");
});

/* ---------------- 续写写回活动版本 ---------------- */

test("续写成功：写回活动版本而不是新建一版，切版本时看到的是续写后的内容", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "第二版";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "model-a" });
  assert.strictEqual(item.versions.length, 2);

  // 切回第一版，再续写：续的应当是屏幕上这一版
  assert.ok(c.switchVersion(-1));
  assert.strictEqual(c.output, "第一版正文");
  c.submittedInput = item.input;
  c.output = "第一版正文 + 续写内容";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, continueFrom: "第一版正文", modelUsed: "model-a" });

  assert.strictEqual(item.versions.length, 2, "续写不新增版本");
  assert.strictEqual(item.versions[0].output, "第一版正文 + 续写内容");
  assert.strictEqual(item.versions[1].output, "第二版", "另一版不受影响");
  assert.strictEqual(item.output, "第一版正文 + 续写内容");

  // 再切到第二版，正文必须是第二版自己的（续写没有串台）
  assert.ok(c.switchVersion(1));
  assert.strictEqual(c.output, "第二版");
});

/* ---------------- 版本切换 ---------------- */

test("切到失败版本：错误卡、失败模型、重试可用性跟着那一版走；切回好版本时全部撤掉", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "残缺正文";
  c.failedModel = "model-bad";
  c.finalize("error", "生成失败", c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "model-bad" });

  // 当前停在失败的那一版
  assert.strictEqual(c.status, "error");
  assert.strictEqual(c.errorMsg, "生成失败");
  assert.strictEqual(c.failedModel, "model-bad");

  // 切回第一版：错误状态必须全部撤掉，否则好内容上会一直挂着失败提示
  assert.ok(c.switchVersion(-1));
  assert.strictEqual(c.output, "第一版正文");
  assert.strictEqual(c.status, "history");
  assert.strictEqual(c.errorMsg, "");
  assert.strictEqual(c.failedModel, "");
  assert.strictEqual(c.errorRetryable, true);
  assert.strictEqual(c.canContinue, true, "旧版本仍可继续生成");

  // 再切回失败的那一版：失败状态要能还原
  assert.ok(c.switchVersion(1));
  assert.strictEqual(c.status, "error");
  assert.strictEqual(c.errorMsg, "生成失败");
  assert.strictEqual(c.failedModel, "model-bad");
});

test("切到「已停止」的版本：状态落回 stopped，续写入口留着", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "写了一半";
  c.finalize("stopped", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m" });

  assert.strictEqual(c.status, "stopped");
  assert.ok(c.switchVersion(-1));
  assert.strictEqual(c.status, "history");
  assert.ok(c.switchVersion(1));
  assert.strictEqual(c.status, "stopped");
  assert.strictEqual(c.canContinue, true);
});

test("切版本会落盘（activeVersionId 与 updatedAt 都要刷新，否则镜像合并会把切换吞掉）", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "第二版";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m2" });
  const firstVersionId = item.versions[0].id;
  const beforeAt = item.updatedAt;

  assert.ok(c.switchVersion(-1));

  const body = bodyOnDisk(storage, item.id);
  assert.strictEqual(body.activeVersionId, firstVersionId);
  assert.strictEqual(body.output, "第一版正文", "正文是活动版本的投影，必须一起落盘");
  assert.ok(item.updatedAt >= beforeAt);
  assert.strictEqual(item.versions.length, 2, "切换不改动版本集合");
});

test("越界的切换不动任何东西", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "第二版";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m2" });

  const snapshot = JSON.stringify(item);
  assert.strictEqual(c.switchVersion(1), null, "已在最新一版：往下一版是没有的");
  assert.strictEqual(JSON.stringify(item), snapshot);
  assert.ok(c.switchVersion(-1));
  assert.strictEqual(c.switchVersion(-1), null, "已在最早一版");
});

test("生成中不允许切版本（避免把在途流的收尾写错版本）", () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  const item = seedRecord(c);
  c.output = "第二版";
  c.finalize("done", undefined, c._runSeq, { updateId: item.id, newVersion: true, modelUsed: "m2" });
  c.streaming = true;
  const activeBefore = item.activeVersionId;
  c.switchVersion(-1);
  assert.strictEqual(item.activeVersionId, activeBefore);
  c.streaming = false;
});

/* ---------------- 入口与守卫 ---------------- */

test("重新生成把 newVersion 传到 run()，并记下开流前的正文", async () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  seedRecord(c);
  let got = null;
  c.run = async (opts) => { got = opts; return undefined; };
  await c.regenerate("model-next");
  assert.strictEqual(got.newVersion, true);
  assert.strictEqual(got.updateId, "h1");
  assert.strictEqual(c.selectedModel, "model-next", "换模型重新生成会切换当前模型");
  assert.strictEqual(c._regenPrevOutput, "第一版正文");
});

test("没有正文时拒绝重新生成，但「直接重试」仍然放行（既有能力不能被改丢）", async () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  seedRecord(c, { output: "" });
  let called = 0;
  c.run = async () => { called += 1; };
  await c.regenerate();
  assert.strictEqual(called, 0, "零正文时普通重新生成不该发起");
  await c.retryChat();
  assert.strictEqual(called, 1, "错误卡上的「直接重试」必须还能发起");
});

test("没有输入内容时不发起任何请求", async () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  seedRecord(c);
  c.submittedInput = "";
  let called = 0;
  c.run = async () => { called += 1; };
  await c.regenerate();
  assert.strictEqual(called, 0);
  assert.ok(c.toasts.some((t) => t.type === "warn"));
});

test("试卷/迁移/超标词工具不接版本化入口（各有自己的历史结构）", async () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  seedRecord(c);
  let called = 0;
  c.run = async () => { called += 1; };
  for (const getter of ["isMigrationTool", "isVocabTool", "isVisualPaperTool"]) {
    Object.defineProperty(c, getter, { value: true, configurable: true });
    await c.regenerate();
  }
  assert.strictEqual(called, 0);
});

/* ---------------- 运行 ---------------- */

(async () => {
  for (const t of cases) {
    try {
      await t.fn();
      passed += 1;
      console.log("  \u2713 " + t.name);
    } catch (e) {
      console.error("  \u2717 " + t.name);
      console.error("    " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n    ") : e));
    }
  }
  console.log(`\n${passed} passed, ${cases.length - passed} failed`);
  process.exit(passed === cases.length ? 0 : 1);
})();
