/* 翻译（工具 33）用例
   运行：node frontend/tests/translate-flow.test.js

   同样不动浏览器：把 script.js 装进 Function 拿到真正的组件对象，只替换网络与界面副作用，
   然后直接跑 trRun / finalizeTr / openTranslateHistory 这些真在跑的代码。守的是：
   - 语言对：默认 自动检测 → 简体中文；原文设成简体中文时目标语言自动变英语（美式）
   - 请求体形状：tool_id=33、source_lang/target_lang 按母语者写法随请求发出、模型取用户所选
   - 改而不增：改原文后重新翻译写回同一条历史记录，列表里不会刷出一串半成品
   - 撞输出上限的 truncated 事件只置标记，绝不被当成正文拼进译文
   - 零产出不留记录；记录里的语言对过镜像层不丢字段
   - 对照滚动：两侧行高不同，能对齐的是「进度」而不是「行」
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

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

// 组件里用裸 matchMedia（finePointer / touchPrimary / 减少动效判定），Node 无此全局。
// 这里按查询串给结果（不写死一个值）：工具里有几处按窄屏分档的行为要能被跑到
if (typeof global.matchMedia !== "function" || !global.matchMedia._nbx) {
  const mqBase = {
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  const mqStub = (query) => ({
    ...mqBase,
    media: query,
    matches: /max-width:\s*1023\.98px/.test(String(query)),
  });
  mqStub._nbx = true;
  global.matchMedia = mqStub;
}
// closeExportMenu 里的 cancelAnimationFrame 是裸全局（不是工厂参数）
if (typeof global.cancelAnimationFrame !== "function") {
  global.cancelAnimationFrame = () => {};
}

/* rAF 替身：真浏览器里它是异步的，替身也得异步（同步执行会让「先赋值再回调」
   的次序反过来，_trSyncRaf 就永远清不掉）。等一帧用下面的 tick() */
const rafStub = (fn) => setTimeout(() => fn(0), 0);
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 假滚动栏：scrollTop 走访问器，写入次数就是「谁带动了谁」的断言依据 */
function fakePane(scrollTop, scrollHeight, clientHeight) {
  let top = scrollTop;
  const pane = { scrollHeight, clientHeight, _writes: 0 };
  Object.defineProperty(pane, "scrollTop", {
    get: () => top,
    set: (v) => { top = v; pane._writes += 1; },
  });
  return pane;
}

/* 这台测试机默认按「窄屏」算：翻译工具里有几处按分档走的行为（打字时译文栏让位、
   译文栏按需出现、折叠按钮换箭头）要能被跑到。narrow: false 装出宽屏那一份，
   用来验「宽屏两栏始终并排」——分档常量是模块加载时定的，只能重新装。 */
function makeWindow({ narrow = true } = {}) {
  const base = {
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  return {
    matchMedia: (query) => ({
      ...base,
      media: query,
      matches: narrow && /max-width:\s*1023\.98px/.test(String(query)),
    }),
  };
}

function loadModule(storage, { narrow = true } = {}) {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx: nbx, translateFlow: {"
      + " TRANSLATE_TOOL_ID: TRANSLATE_TOOL_ID, TR_LANGS: TR_LANGS,"
      + " TR_DEFAULT_SOURCE: TR_DEFAULT_SOURCE, TR_DEFAULT_TARGET: TR_DEFAULT_TARGET,"
      + " trTargetFor: trTargetFor, trPairShort: trPairShort, trLangNative: trLangNative,"
      + " trSyncTargetTop: trSyncTargetTop, historyTitleFromText: historyTitleFromText,"
      + " historyIndexOf: historyIndexOf, historyBodyOf: historyBodyOf } };"
  );
  const api = factory(
    makeWindow({ narrow }), undefined, storage, undefined, { origin: "http://localhost:8000", hostname: "localhost" },
    undefined, { now: () => Date.now() }, rafStub, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  const c = api.nbx();
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.retreatMascot = () => {};
  c.authHeaders = () => ({ Authorization: "Bearer test-token" });
  c.handleAuthFailure = function (hint) { this.authFailures = (this.authFailures || []).concat(hint || ""); };
  // 计时器只要不真的跑：本用例不验用时，但泄漏的 interval 会拖住进程
  c.startTimer = () => {};
  c.stopTimer = () => {};
  c.startThinkTimer = () => {};
  c.stopThinkTimer = () => {};
  c.copied = false;
  return { api, c, storage };
}

/* 一个已登录、已进翻译工具的组件 */
function loadTranslateTool() {
  const { api, c, storage } = loadModule(makeStorage());
  // 窄屏（本测试机就是这一档）：译文栏默认是藏起来的，做对照滚动的用例要显式放出来
  c.trResultVisible = true;
  c.isAuthenticated = true;
  c.ensureCanRun = () => true;
  c.currentTool = { id: api.translateFlow.TRANSLATE_TOOL_ID, name: "翻译", icon: "languages", prompt_loaded: true };
  c.selectedModel = "model-current";
  c.history = [];
  c._runSeq = 1;
  return { api, c, storage };
}

function sseResponse(frames) {
  const text = frames.map(([event, data]) => `event: ${event}\ndata: ${data}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  };
}

/* 跑一轮 trRun，把请求体回给调用方 */
async function runTranslate(c, frames, source) {
  if (source !== undefined) c.input = source;
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return sseResponse(frames);
  };
  try {
    await c.trRun();
  } finally {
    global.fetch = original;
  }
  return calls;
}

function translatedFrames(text) {
  return [
    ["token", JSON.stringify(text.slice(0, 2))],
    ["token", JSON.stringify(text.slice(2))],
    ["done", "[DONE]"],
  ];
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ---------------- 语言表与默认值 ---------------- */

test("工具 id 与语言表：默认 自动检测 → 简体中文，语言名用母语者写法", () => {
  const { api } = loadTranslateTool();
  const t = api.translateFlow;

  assert.strictEqual(t.TRANSLATE_TOOL_ID, "33");
  assert.strictEqual(t.TR_DEFAULT_SOURCE, "auto");
  assert.strictEqual(t.TR_DEFAULT_TARGET, "zh-Hans");
  // 送进提示词的名字必须是模型最认得的写法，不是语言代码
  assert.strictEqual(t.trLangNative("zh-Hans"), "简体中文");
  assert.strictEqual(t.trLangNative("en-US"), "English (US)");
  assert.strictEqual(t.trLangNative("auto"), "auto");
  // 表里每个语言 id 唯一，且都有中文名与短名（历史列表那枚 chip 要用）
  const ids = t.TR_LANGS.map((l) => l.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  t.TR_LANGS.forEach((l) => {
    assert.ok(l.label && l.short, `语言 ${l.id} 缺 label 或 short`);
    assert.ok(!l.sourceOnly || l.id === "auto", "只有自动检测是源语言专属");
  });
});

test("自动检测不在目标语言列表里", () => {
  const { c } = loadTranslateTool();
  assert.ok(!c.trTargetOptions.some((l) => l.id === "auto"));
  assert.ok(c.trSourceOptions.some((l) => l.id === "auto"));
});

test("源语言撞车：原文设成简体中文时目标语言自动变英语（美式）", () => {
  const { c } = loadTranslateTool();
  assert.strictEqual(c.trSourceLang, "auto");
  assert.strictEqual(c.trTargetLang, "zh-Hans");

  c.chooseTrSourceLang("zh-Hans");
  assert.strictEqual(c.trSourceLang, "zh-Hans");
  assert.strictEqual(c.trTargetLang, "en-US", "原文是中文时目标语言该换成英语");

  // 换成一个非中文语言、且当前目标正是它时，目标语言回落到简体中文
  c.chooseTrTargetLang("ja");
  c.chooseTrSourceLang("ja");
  assert.strictEqual(c.trTargetLang, "zh-Hans");

  // 不撞车就不动用户已经选好的目标语言
  c.chooseTrTargetLang("fr");
  c.chooseTrSourceLang("de");
  assert.strictEqual(c.trTargetLang, "fr");
});

test("交换语言对：自动检测时把目标语言提上来，并给它一个常用对译方向", () => {
  const { c } = loadTranslateTool();

  c.swapTrLangs();
  assert.strictEqual(c.trSourceLang, "zh-Hans");
  assert.strictEqual(c.trTargetLang, "en-US");

  // 两边都具体时就是直接换位
  c.chooseTrSourceLang("en-GB");
  c.chooseTrTargetLang("zh-Hant");
  c.swapTrLangs();
  assert.strictEqual(c.trSourceLang, "zh-Hant");
  assert.strictEqual(c.trTargetLang, "en-GB");
});

/* ---------------- 请求体 ---------------- */

test("请求体：tool_id=33、语言对按母语者写法带上、模型取用户所选", async () => {
  const { c } = loadTranslateTool();
  c.selectedModel = "model-current";
  c.chooseTrSourceLang("zh-Hans");   // 目标语言随之变成英语（美式）

  const calls = await runTranslate(c, translatedFrames("Hello world."), "你好，世界。");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "/api/chat/stream");
  const body = JSON.parse(calls[0].options.body);
  assert.strictEqual(body.tool_id, "33");
  assert.strictEqual(body.model, "model-current");
  assert.strictEqual(body.input, "你好，世界。");
  assert.strictEqual(body.source_lang, "简体中文");
  assert.strictEqual(body.target_lang, "English (US)");
  assert.strictEqual(c.output, "Hello world.");
});

test("自动检测的源语言送 auto，不送中文名", async () => {
  const { c } = loadTranslateTool();
  const calls = await runTranslate(c, translatedFrames("译文"), "Some text.");
  const body = JSON.parse(calls[0].options.body);
  assert.strictEqual(body.source_lang, "auto");
  assert.strictEqual(body.target_lang, "简体中文");
});

test("空原文不发请求", async () => {
  const { c } = loadTranslateTool();
  const calls = await runTranslate(c, translatedFrames("不该发生"), "   ");
  assert.strictEqual(calls.length, 0);
  assert.ok(c.toasts.some((t) => /还没有原文/.test(t.msg)));
});

/* ---------------- 历史：改而不增 ---------------- */

test("首次生成新建一条记录，语言对与标题按原文落库", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("First translation."), "第一篇原文\n第二行");

  assert.strictEqual(c.history.length, 1);
  const item = c.history[0];
  assert.strictEqual(item.toolId, "33");
  assert.strictEqual(item.toolName, "翻译");
  assert.strictEqual(item.output, "First translation.");
  assert.strictEqual(item.input, "第一篇原文\n第二行");
  // 标题取原文首行前 16 字：不再花一次调用让模型总结
  assert.strictEqual(item.title, "第一篇原文");
  assert.deepStrictEqual(item.translate, { source: "auto", target: "zh-Hans", truncated: false });
  assert.strictEqual(c.trHistoryId, item.id, "生成完就该记住这条记录");
  assert.strictEqual(c.trUpdating, true, "按钮该说「更新翻译」了");
});

test("改原文后重新翻译：写回同一条记录，不新增", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("First translation."), "第一版原文");
  const id = c.history[0].id;
  const createdAt = c.history[0].createdAt;

  // 改原文 + 改目标语言，再按一次「更新翻译」
  c.chooseTrTargetLang("ja");
  await runTranslate(c, translatedFrames("Second translation."), "第二版原文");

  assert.strictEqual(c.history.length, 1, "同一份材料的重译不该在历史里刷第二条");
  const item = c.history[0];
  assert.strictEqual(item.id, id);
  assert.strictEqual(item.createdAt, createdAt);
  assert.strictEqual(item.output, "Second translation.");
  assert.strictEqual(item.input, "第二版原文");
  assert.deepStrictEqual(item.translate, { source: "auto", target: "ja", truncated: false });
  assert.ok(item.updatedAt >= item.createdAt);
  assert.strictEqual(c.trHistoryId, id);
});

test("「新的翻译」脱钩：下一次生成另起一条记录", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("First."), "原文一");
  const first = c.history[0].id;

  // 上一轮留下的推理过程：清空正文时必须一起清掉，否则空栏里只挂一条「思考过程」
  c.reasoning = "先把原文拆成段落…";
  c.reasoningDone = true;
  c.reasoningOpen = false;

  c.trNew();
  assert.strictEqual(c.trHistoryId, "", "脱钩后按钮回到「翻译」");
  assert.strictEqual(c.output, "", "译文栏清空，但历史里那条留着");
  assert.strictEqual(c.reasoning, "", "上一轮的推理过程不该留在空栏里");
  assert.strictEqual(c.reasoningDone, false);
  assert.strictEqual(c.reasoningOpen, true);

  await runTranslate(c, translatedFrames("Second."), "原文二");
  assert.strictEqual(c.history.length, 2);
  assert.notStrictEqual(c.history[0].id, first);
  assert.strictEqual(c.history[1].id, first);
  assert.strictEqual(c.history[1].output, "First.");
});

test("打开一条翻译记录：上一轮的推理过程一并清掉", () => {
  const { c } = loadTranslateTool();
  c.reasoning = "上一轮的思考";
  c.reasoningDone = true;

  c.openTranslateHistory({
    id: "h5", toolId: "33", toolName: "翻译", icon: "languages",
    input: "Some text.", output: "一些文字。",
    translate: { source: "auto", target: "zh-Hans" },
  });

  assert.strictEqual(c.reasoning, "", "记录里不含推理，屏上也不该留着上一条的");
  assert.strictEqual(c.reasoningDone, false);
});

test("零产出不留记录（刚开跑就被停）", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, [["done", "[CANCELLED]"]], "原文");

  assert.strictEqual(c.history.length, 0, "一个字都没译出来不值得在历史里占一条");
  assert.strictEqual(c.trHistoryId, "");
  assert.strictEqual(c.status, "stopped");
  assert.ok(c.toasts.some((t) => /已停止翻译/.test(t.msg)));
});

test("更新时零产出不覆盖已有译文（越重试越少最糟）", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("有内容的译文"), "原文");
  const item = c.history[0];

  // 第二次：一个字都没出（比如又失败了）
  c.output = "";
  c.finalizeTr("error", "模型服务繁忙", { updateId: item.id, modelUsed: "model-current" });

  assert.strictEqual(item.output, "有内容的译文", "旧译文必须留着");
  assert.strictEqual(item.error, "模型服务繁忙");
  assert.strictEqual(c.errorMsg, "模型服务繁忙");
  assert.strictEqual(c.status, "error");
  assert.strictEqual(c.trHistoryId, item.id);
});

/* ---------------- 截断 ---------------- */

test("truncated 事件只置标记，绝不被当成正文拼进译文", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, [
    ["token", JSON.stringify("半篇译文")],
    ["truncated", JSON.stringify({ limit: 8192 })],
    ["done", "[DONE]"],
  ], "原文");

  assert.strictEqual(c.output, "半篇译文");
  assert.strictEqual(c.trTruncated, true);
  assert.strictEqual(c.history[0].translate.truncated, true, "截断要跟着记录走");
  assert.ok(!c.output.includes("8192"), "截断事件的数据不该出现在译文里");
});

test("没有截断时标记是干净的", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("完整译文"), "原文");
  assert.strictEqual(c.trTruncated, false);
  assert.strictEqual(c.history[0].translate.truncated, false);
});

/* ---------------- 历史记录的形状与回放 ---------------- */

test("记录形状：语言对过索引与正文层，列表不用读正文就能画出「英→中」", () => {
  const { api } = loadTranslateTool();
  const t = api.translateFlow;

  assert.strictEqual(t.trPairShort("en-US", "zh-Hans"), "英→中");
  assert.strictEqual(t.trPairShort("auto", "zh-Hans"), "自动→中");
  assert.strictEqual(t.trPairShort("", ""), "");
  // 表里没有的语言 id 不该造出一个半截标签
  assert.strictEqual(t.trPairShort("xx-XX", "zh-Hans"), "");

  const full = {
    id: "h1", toolId: "33", toolName: "翻译", icon: "languages",
    title: "原文", createdAt: 1, updatedAt: 2, output: "译文", input: "原文",
    translate: { source: "en-US", target: "zh-Hans", truncated: false },
  };
  const body = t.historyBodyOf(full);
  assert.deepStrictEqual(body.translate, full.translate, "语言对要跟着正文一起落盘");
  const index = t.historyIndexOf(full);
  assert.strictEqual(index.trPair, "英→中");
  // 只有索引的条目（正文没读回来）也得算出同样的标签
  assert.strictEqual(t.historyIndexOf(index).trPair, "英→中");
  // 非翻译记录不带这枚标签
  assert.strictEqual(t.historyIndexOf({ id: "h2", toolId: "1", createdAt: 1 }).trPair, "");
});

test("打开一条翻译记录：原文回左栏、译文回右栏、语言对与记录 id 一并还原", () => {
  const { c } = loadTranslateTool();
  c.currentTool = null;
  c.openTranslateHistory({
    id: "h9", toolId: "33", toolName: "翻译", icon: "languages",
    input: "The original text.", output: "原文。", model: "model-old",
    partial: false, error: "",
    translate: { source: "en-US", target: "zh-Hans", truncated: true },
  });

  assert.strictEqual(c.currentTool.id, "33");
  assert.strictEqual(c.input, "The original text.");
  assert.strictEqual(c.output, "原文。");
  assert.strictEqual(c.trSourceLang, "en-US");
  assert.strictEqual(c.trTargetLang, "zh-Hans");
  assert.strictEqual(c.trTruncated, true);
  assert.strictEqual(c.status, "done");
  assert.strictEqual(c.trHistoryId, "h9", "回看一条记录后按钮就该说「更新翻译」");
  // 继续翻译走的是通用续写入口，它看 submittedInput
  assert.strictEqual(c.submittedInput, "The original text.");
});

test("切工具后与记录脱钩（下一次生成另起一条）", () => {
  const { c } = loadTranslateTool();
  c.trHistoryId = "h1";
  c.trTruncated = true;
  c.resetTranslate();
  assert.strictEqual(c.trHistoryId, "");
  assert.strictEqual(c.trTruncated, false);
  // 语言对是用户的使用习惯，切工具不必回默认
  assert.strictEqual(c.trSourceLang, "auto");
  assert.strictEqual(c.trTargetLang, "zh-Hans");
});

test("原文标题：剥掉 Markdown 前缀，太短的行跳过", () => {
  const { api } = loadTranslateTool();
  const t = api.translateFlow;
  assert.strictEqual(t.historyTitleFromText("# 阅读理解\nPassage"), "阅读理解");
  assert.strictEqual(t.historyTitleFromText("\n\n- Hello world, this is a long line"), "Hello world, thi");
  assert.strictEqual(t.historyTitleFromText(""), "");
});

/* ---------------- 对照滚动 ---------------- */

test("对照滚动：按进度比例映射，而不是照搬 scrollTop", () => {
  const { api } = loadTranslateTool();
  const t = api.translateFlow;

  // 两侧可滚高度不同：同样滚到一半，落点按比例算
  assert.strictEqual(t.trSyncTargetTop(500, 1000, 200), 100);
  assert.strictEqual(t.trSyncTargetTop(1000, 1000, 200), 200);
  assert.strictEqual(t.trSyncTargetTop(0, 1000, 200), 0);

  // 任一侧不可滚（内容还没对方长）：不做映射，免得硬凑出抖动
  assert.strictEqual(t.trSyncTargetTop(100, 0, 200), null);
  assert.strictEqual(t.trSyncTargetTop(100, 1000, 0), null);
  // 越界与脏数据都被夹住
  assert.strictEqual(t.trSyncTargetTop(-50, 1000, 200), 0);
  assert.strictEqual(t.trSyncTargetTop(99999, 1000, 200), 200);
  assert.strictEqual(t.trSyncTargetTop(NaN, NaN, NaN), null);
});

test("对照滚动：一栏移动就带动另一栏，滚到底两端都到底", async () => {
  const { c } = loadTranslateTool();
  // 原文可滚 1400（2000-600），译文可滚 200（800-600）
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };

  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 0, "原文在顶上，译文也该在顶上");

  src.scrollTop = 700;   // 一半
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 100, "一半对一半");

  src.scrollTop = 1400;  // 到底
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 200, "原文到底，译文也要到底");

  // 反过来也一样：用户滚译文，原文跟着走
  out.scrollTop = 50;
  c.onTrPaneScroll("result");
  await tick();
  assert.strictEqual(src.scrollTop, 350);
});

test("对照滚动：被带动那一栏的回声不会再反推回去（两栏不互相追）", async () => {
  const { c } = loadTranslateTool();
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };

  src.scrollTop = 700;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 100);
  const outWrites = out._writes;
  const srcWrites = src._writes;   // 上面那行是测试自己写的，基线从这里算

  // 带动译文栏时它自己会派发一次 scroll 事件：不能因此反过来再写原文栏
  c.onTrPaneScroll("result");
  await tick();
  assert.strictEqual(src._writes, srcWrites, "回声不该写回原文栏");
  assert.strictEqual(out._writes, outWrites, "回声也不该再写译文栏");
});

test("对照滚动：一侧内容还不够长时不做映射，不硬凑", async () => {
  const { c } = loadTranslateTool();
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 500, 600);   // 译文还没长过一屏：不可滚
  c.$refs = { trSourcePane: src, trResultPane: out };

  src.scrollTop = 900;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 0);
  assert.strictEqual(out._writes, 0);
});

test("流式输出：译文栏贴底就跟着往下走，用户往回翻过就不再跟", async () => {
  const { c } = loadTranslateTool();
  const out = fakePane(300, 1000, 600);   // 300 + 600 = 900，离底 100 → 不在贴底范围
  c.$refs = { trResultPane: out, trSourcePane: fakePane(0, 1000, 600) };
  c.streaming = true;

  c.onTrPaneScroll("result");
  assert.strictEqual(c._trFollowOutput, false, "用户往回翻过：不再跟着走");
  await tick();
  assert.strictEqual(out._writes, 0);

  out.scrollTop = 400;   // 400 + 600 = 1000，正好贴底
  c.onTrPaneScroll("result");
  await tick();
  assert.strictEqual(c._trFollowOutput, true);
  c.pinTrBottom();
  assert.strictEqual(out.scrollTop, 400, "本来就在底部：不重复写");

  // 内容变长后（流式追加），钉底把它带到底部
  out.scrollHeight = 1400;
  c.pinTrBottom();
  assert.strictEqual(out.scrollTop, 800);
  assert.deepStrictEqual(c._trDriven, { side: "result", top: 800 });
});

test("钉底带动的是译文栏：它自己派发的回声不会把原文栏拽到底", async () => {
  const { c } = loadTranslateTool();
  const src = fakePane(0, 4000, 600);
  const out = fakePane(340, 1000, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };
  c.streaming = true;
  c._trFollowOutput = true;

  out.scrollHeight = 1600;   // 流式追加了一段
  c.pinTrBottom();
  assert.strictEqual(out.scrollTop, 1000);

  // 钉底之后的回声事件：不该被当成用户滚动，也不该带动原文栏
  c.onTrPaneScroll("result");
  await tick();
  assert.strictEqual(src._writes, 0, "静态的原文栏不该被拽下去");
});

test("对照滚动：原文折叠期间不做映射（那时两栏已不是对照）", async () => {
  const { c } = loadTranslateTool();
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };
  c.trSrcCollapsed = true;

  src.scrollTop = 900;
  const srcWrites = src._writes;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out._writes, 0, "折叠期间不该带动译文栏");
  assert.strictEqual(src._writes, srcWrites);

  // 折叠期间译文栏的贴底跟随照旧（否则流式输出会一屏一屏地跳）
  out.scrollHeight = 1500;
  out.scrollTop = 900;   // 900 + 600 = 1500 正好贴底
  c.onTrPaneScroll("result");
  await tick();
  assert.strictEqual(c._trFollowOutput, true);

  // 展开后再滚动：映射恢复（0.25 的进度落到 0.25 * 200 = 50）
  c.trSrcCollapsed = false;
  out.scrollHeight = 800;
  out.scrollTop = 0;
  src.scrollTop = 350;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 50, "展开后重新按进度对齐");
});

test("思考过程：正文一开始就置成已结束（模板据此整条隐藏）", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, [
    ["reasoning", JSON.stringify({ t: "先看原文讲的是什么。", n: 8 })],
    ["token", JSON.stringify("译文")],
    ["done", "[DONE]"],
  ], "原文");

  assert.strictEqual(c.reasoning, "先看原文讲的是什么。");
  // 模板里的可见条件是 reasoningLive 这一个状态位（不用复合表达式：
  // && 短路会让右侧不被读到、也就没登记成依赖，隐藏会不生效）
  assert.strictEqual(c.reasoningLive, false, "正文一开始就该整条消失");
  assert.strictEqual(c.reasoningDone, true);
  assert.strictEqual(c.output, "译文");

  // 定稿后迟到的推理 chunk 不该把盒子又顶回来
  c.appendReasoning("迟到的补充", 3);
  assert.strictEqual(c.reasoningLive, false);

  c.resetReasoning();
  assert.strictEqual(c.reasoningLive, false);
  c.appendReasoning("新一轮的推理", 3);
  assert.strictEqual(c.reasoningLive, true, "新一轮开始，思考过程该重新上屏");

  // 被停止/出错的收尾也要把它收掉
  c.streaming = true;
  c.status = "streaming";
  c.finalize("stopped");
  assert.strictEqual(c.reasoningLive, false, "收尾后不该还挂着「正在思考」");
});

test("思考盒的显隐由 syncReasoningBox 直接写 DOM（模板绑定会漏触发）", () => {
  const { c } = loadTranslateTool();
  const box = { style: {} };
  c.$refs.reasoningBox = box;

  c.resetReasoning();
  assert.strictEqual(box.style.display, "none", "进工具/重开一轮：收起");

  c.appendReasoning("先看原文……", 5);
  assert.strictEqual(box.style.display, "", "推理一来：上屏");

  c.reasoningDone = true;          // 模拟正文已经开始
  c.appendReasoning("迟到的推理", 2);
  assert.strictEqual(box.style.display, "", "定稿后迟到的 chunk 不改显隐");

  c.reasoningDone = false;
  c.reasoning = "有内容";
  c.finishReasoningOnToken();
  assert.strictEqual(box.style.display, "none", "正文一开始：整条收起");

  // 没有这个 ref（其它工具）时空转，不该抛
  const other = loadTranslateTool().c;
  assert.doesNotThrow(() => other.syncReasoningBox());
});

test("输入法弹起：窄屏把译文栏收成一行，收起后放开；让位期间不做映射", async () => {
  const { c } = loadTranslateTool();
  assert.strictEqual(c.trResultFolded, false);

  c.scheduleTrKbFold(true);
  await wait(180);
  assert.strictEqual(c.trResultFolded, true, "窄屏 + 键盘弹起 → 译文栏让位");

  // 让位期间两栏不再是对照（译文栏只剩一行），滚动不该互相带动
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };
  src.scrollTop = 900;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out._writes, 0);

  c.scheduleTrKbFold(false);
  await wait(180);
  assert.strictEqual(c.trResultFolded, false, "键盘收起 → 译文栏放开");
});

test("窄屏：译文栏默认藏着（原文栏独占），按下翻译才放出来，新的翻译再收回", async () => {
  const { c } = loadTranslateTool();
  c.trResultVisible = false;   // 初始态
  assert.strictEqual(c.trResultShown, false, "窄屏：初始不占地方");

  // 藏着的译文栏不参与对照滚动（两栏不是可对照的一对）
  const src = fakePane(0, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };
  src.scrollTop = 900;
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out._writes, 0);

  await runTranslate(c, translatedFrames("译文"), "原文");
  assert.strictEqual(c.trResultVisible, true, "按下翻译就放出来（等待动画也落在这一栏）");
  assert.strictEqual(c.trResultShown, true);

  c.trNew();
  assert.strictEqual(c.trResultVisible, false, "新的翻译把高度还给输入");
  assert.strictEqual(c.trResultShown, false);
});

test("折叠原文：窄屏上看译文（放出译文栏），展开回来把译文栏再收回去", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("译文"), "原文");
  c.trNew();                       // 回到输入态：译文栏藏起来、原文展开
  assert.strictEqual(c.trResultVisible, false);
  c.output = "译文";               // 屏上这份结果还在（trNew 只是清屏与脱钩）

  c.toggleTrFold();
  assert.strictEqual(c.trSrcCollapsed, true, "收原文");
  assert.strictEqual(c.trResultVisible, true, "窄屏：放出来才有得看");

  c.toggleTrFold();
  assert.strictEqual(c.trSrcCollapsed, false, "展原文");
  assert.strictEqual(c.trResultVisible, false, "窄屏：也把译文栏收回去，回到只写原文的输入态");
});

test("没有译文可看时不折叠原文（否则只剩一个空译文框）", () => {
  const { c } = loadTranslateTool();
  c.trResultVisible = false;       // 初始态：译文栏藏着
  c.$refs = { trSourcePane: fakePane(0, 2000, 600), trResultPane: fakePane(0, 800, 600) };
  c.input = "还没翻译的原文";
  c.output = "";
  c.streaming = false;

  c.toggleTrFold();
  assert.strictEqual(c.trSrcCollapsed, false, "不该折叠");
  assert.strictEqual(c.trResultVisible, false, "更不该凭空放出一个空译文框");
  assert.ok(c.toasts.some((t) => /还没有译文可看/.test(t.msg)));

  // 正在翻译（已经有得看）则可以折
  c.streaming = true;
  c.toggleTrFold();
  assert.strictEqual(c.trSrcCollapsed, true);
  assert.strictEqual(c.trResultVisible, true);
});

test("清空译文（新的翻译）时把折叠的原文放回来", async () => {
  const { c } = loadTranslateTool();
  await runTranslate(c, translatedFrames("译文"), "原文");
  c.toggleTrFold();                 // 只留译文
  assert.strictEqual(c.trSrcCollapsed, true);

  c.trNew();
  assert.strictEqual(c.trSrcCollapsed, false, "没译文了还折着、折叠钮又是禁用的，等于出不来");
  assert.strictEqual(c.trResultVisible, false);
});

test("宽屏折叠原文不牵动译文栏（两栏本来就并排）", () => {
  const { c } = loadModule(makeStorage(), { narrow: false });
  c.currentTool = { id: "33", name: "翻译", icon: "languages", prompt_loaded: true };
  c.isAuthenticated = true;
  c.ensureCanRun = () => true;
  c.history = [];
  c._runSeq = 1;
  c.output = "译文";

  c.toggleTrFold();
  assert.strictEqual(c.trSrcCollapsed, true);
  assert.strictEqual(c.trResultVisible, false, "宽屏不参与窄屏那套「按需出现」");
  assert.strictEqual(c.trResultShown, true, "译文栏照常在");
});

test("宽屏：两栏始终并排，可见性状态取反也不影响对照", async () => {
  // 重新装一份组件，这次 matchMedia 按「宽屏」回答（分档常量是模块加载时定的）
  const { c } = loadModule(makeStorage(), { narrow: false });
  c.currentTool = { id: "33", name: "翻译", icon: "languages", prompt_loaded: true };
  c.isAuthenticated = true;
  c.ensureCanRun = () => true;
  c.history = [];
  c._runSeq = 1;

  assert.strictEqual(c.trResultVisible, false, "状态本身仍是「没放出来」");
  assert.strictEqual(c.trResultShown, true, "但宽屏两栏本来就并排，对照滚动照常");

  const src = fakePane(700, 2000, 600);
  const out = fakePane(0, 800, 600);
  c.$refs = { trSourcePane: src, trResultPane: out };
  c.onTrPaneScroll("source");
  await tick();
  assert.strictEqual(out.scrollTop, 100, "宽屏一直在对照");
});

/* ---------------- 跑起来 ---------------- */

(async () => {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of cases) {
    try {
      await fn();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (e) {
      failures.push({ name, e });
      console.log(`✗ ${name}`);
      console.log(`    ${e && e.message}`);
    }
  }
  console.log(`\n${passed}/${cases.length} 通过`);
  if (failures.length) process.exitCode = 1;
})();
