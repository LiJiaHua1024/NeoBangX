/* 「描述需求找工具」（Jev choice 搜索控件）用例
   运行：npm test（node --test）

   这个控件的全部难点在「什么时候发请求」上，所以用例主要在守时序：
   1. 静默期不发，停顿成立才发（不要求用户按 Enter）；
   2. 计时中继续输入只重排、不叠加请求；已在途时输入必须立刻掐断并重发；
   3. 中文输入法组字期间一个请求都不发，落字之后才开始计时；
   4. 标点/粘贴这类明确收尾用短窗立即发；
   5. 太短不发、太长（看着像粘了正文）不发；
   6. 迟到的回包一律作废（否则旧结论会盖掉新结果）；
   7. 后端不可达时用本地关键词兜底，控件任何时候都不空转；
   8. Enter / ↑↓ / Esc 的行为，以及「同一句话不重复打 Jev」。
   UI 上的进度条不在断言范围（纯视觉），但它依赖的 waiting 状态在这里被守住。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

// 组件里有裸 matchMedia 调用（宽窄分档、减少动效判定），Node 没有这个全局
if (typeof global.matchMedia !== "function") {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  global.matchMedia = () => mq;
}

function loadApi() {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx, toolSearchKeywordMatch, toolSearchLooksFinal,"
      + " TOOL_SEARCH_EXAMPLES, TOOL_SEARCH_PAUSE_MS, TOOL_SEARCH_EARLY_MS,"
      + " TOOL_SEARCH_MIN_CHARS, TOOL_SEARCH_MAX_CHARS, FREEFORM_TOOL_ID };"
  );
  return factory(
    { matchMedia: global.matchMedia }, undefined, undefined, undefined,
    { origin: "http://localhost:8000", hostname: "localhost" }, undefined,
    undefined, (fn) => setTimeout(() => fn(0), 0), undefined, undefined,
    undefined, undefined, undefined, undefined
  );
}

const TOOL_GROUPS = [
  {
    id: "teaching",
    title: "备课与教学",
    tools: [
      { id: "10", name: "学生作文批改", icon: "correction", description: "评分 + 修改建议 + 改进版本" },
      { id: "9", name: "英文写作教学", icon: "writing", description: "通用写作（记叙/议论/概要）支架与范文" },
    ],
  },
  {
    id: "reference",
    title: "通用工具",
    tools: [
      { id: "25", name: "自由对话", icon: "chat", description: "个性化自定义需求，工具清单外的教学任务兜底" },
      { id: "33", name: "翻译", icon: "languages", description: "原文译文对照，支持试卷、作文、文档" },
    ],
  },
];

const RESULT_ROW = (toolId, name, score) => ({
  tool_id: toolId,
  name,
  icon: "correction",
  description: "评分 + 修改建议 + 改进版本",
  group_id: "teaching",
  group_title: "备课与教学",
  score,
  source: "jev",
  reason: "评分 + 修改建议 + 改进版本",
});

function makeComponent(overrides = {}) {
  const api = loadApi();
  const c = api.nbx();
  c.groups = TOOL_GROUPS;
  c.toolsLoaded = true;
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.authHeaders = () => ({ Authorization: "Bearer test-token" });
  c.findTool = function (id) {
    for (const g of this.groups) {
      const hit = (g.tools || []).find((t) => String(t.id) === String(id));
      if (hit) return hit;
    }
    return null;
  };
  c.selectedTools = [];
  c.selectTool = function (tool) { this.selectedTools.push(tool); };
  // 停顿窗口收到几十毫秒，用例才好断言
  c.toolSearchPauseMs = 30;
  c.toolSearchEarlyMs = 10;
  Object.assign(c, overrides);
  return { api, c };
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/* 可手动放行的 fetch：用来构造「请求还在途中」这种状态 */
function installFetch() {
  const calls = [];
  const pending = [];
  global.fetch = (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject, options });
    });
  };
  return {
    calls,
    resolve(i, body) { pending[i].resolve(jsonResponse(body)); return tick(); },
    fail(i, error) { pending[i].reject(error); return tick(); },
    get aborted() { return (options) => pending; },
  };
}

/* 立即答复的 fetch：只关心「发了几次、发了什么」的用例用它 */
function installInstantFetch(body = { results: [], fallback: false, no_match: false, uncertain: false }) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse(body);
  };
  return calls;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => wait(5);

function type(c, value) {
  c.onToolSearchInput({ target: { value } });
}

async function withFetch(kind, fn) {
  const original = global.fetch;
  const handle = kind();
  try {
    return await fn(handle);
  } finally {
    global.fetch = original;
  }
}

/* ---------------- 停顿判定 ---------------- */

test("静默期不发请求，停顿成立才发（不需要按 Enter）", async () => {
  const { c } = makeComponent();
  const calls = await withFetch(() => installInstantFetch({ results: [RESULT_ROW("10", "学生作文批改", 0.9)] }), async (h) => {
    type(c, "帮我批改这篇作文");
    assert.equal(c.toolSearchState, "waiting", "输入后立刻进入「等待停顿」");
    assert.equal(c.toolSearchOpen, true, "等待期间面板就开着，用户看得见进度条");
    await wait(10);
    assert.equal(h.length, 0, "还没到停顿窗口，不能发请求");
    await wait(45);
    return h;
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/tools/search");
  assert.deepEqual(calls[0].body, { query: "帮我批改这篇作文", limit: 3 });
  assert.equal(c.toolSearchState, "results");
  assert.equal(c.toolSearchResults[0].tool_id, "10");
});

test("计时中继续输入：只重排、不叠加请求", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "帮我批改");
    await wait(15);
    type(c, "帮我批改这篇作文");
    await wait(15);
    assert.equal(h.length, 0, "每次输入都重新计时");
    await wait(45);
    assert.equal(h.length, 1, "连打一串字也只发一次");
    assert.equal(h[0].body.query, "帮我批改这篇作文");
  });
});

test("已在途时输入：立刻掐断旧请求，再按新的停顿重发", async () => {
  const { c } = makeComponent();
  await withFetch(() => installFetch(), async (h) => {
    type(c, "帮我批改这篇作文");
    await wait(45);
    assert.equal(h.calls.length, 1, "第一次请求已发出");
    assert.equal(c.toolSearchState, "searching");
    const firstSignal = h.calls[0].options.signal;
    assert.equal(firstSignal.aborted, false);

    type(c, "把这套卷子讲评一下");
    assert.equal(firstSignal.aborted, true, "内容一变就必须掐断在途请求");
    assert.equal(c.toolSearchState, "waiting", "掐断后回到等待，等下一次有意停顿");

    await wait(45);
    assert.equal(h.calls.length, 2, "重新发起一次新的请求");
    assert.equal(h.calls[1].body.query, "把这套卷子讲评一下");
  });
});

test("迟到的回包作废：旧结论不许盖掉新结果", async () => {
  const { c } = makeComponent();
  await withFetch(() => installFetch(), async (h) => {
    type(c, "帮我批改这篇作文");
    await wait(45);
    assert.equal(h.calls.length, 1);

    // 用户改主意了：旧请求被掐断，新请求随后发出
    type(c, "把这套卷子讲评一下");
    await wait(45);
    assert.equal(h.calls.length, 2);

    // 旧请求现在才回包（真实网络里 abort 后仍可能有一帧数据回来）
    h.resolve(0, { results: [RESULT_ROW("9", "英文写作教学", 0.5)], fallback: false });
    // 新请求给的是正确答案
    h.resolve(1, { results: [RESULT_ROW("10", "学生作文批改", 0.9)], fallback: false });
    await tick();

    assert.equal(c.toolSearchResults.length, 1);
    assert.equal(c.toolSearchResults[0].tool_id, "10", "屏幕上必须是新那句话的结果");
  });
});

test("中文输入法：组字期间一个请求都不发，落字之后才计时", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    // 拼音候选阶段：会连续触发 input，但那不是用户的意思
    c.onToolSearchCompositionStart();
    type(c, "bang");
    type(c, "bangwo");
    await wait(45);
    assert.equal(h.length, 0, "组字中绝不发请求");
    assert.equal(c.toolSearchState, "idle", "组字中连等待态都不进");

    // 落字：x-model 对组字的落字可能晚于本事件，所以实现里直接读 DOM
    c.onToolSearchCompositionEnd({ target: { value: "帮我批改这篇作文" } });
    assert.equal(c.toolSearchQuery, "帮我批改这篇作文");
    assert.equal(c.toolSearchState, "waiting");
    await wait(45);
    assert.equal(h.length, 1);
    assert.equal(h[0].body.query, "帮我批改这篇作文");
  });
});

test("收尾标点走短窗：刚说完就发，不等满停顿窗口", async () => {
  const { c } = makeComponent({ toolSearchPauseMs: 400, toolSearchEarlyMs: 10 });
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "帮我批改这篇作文。");
    await wait(40);
    assert.equal(h.length, 1, "句号收尾视为说完了，不该再等 400ms");
  });
});

test("粘贴走短窗", async () => {
  const { c } = makeComponent({ toolSearchPauseMs: 400, toolSearchEarlyMs: 10 });
  await withFetch(() => installInstantFetch(), async (h) => {
    c.toolSearchQuery = "批改这篇作文";
    c.onToolSearchPaste();
    await wait(40);
    assert.equal(h.length, 1);
  });
});

test("太短不发：一两个字几乎必是还没说完", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "批");
    await wait(45);
    assert.equal(h.length, 0);
    assert.equal(c.toolSearchState, "idle");
  });
});

test("太长不发：看着像粘了正文，改成提示而不是把正文送去判定", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "作".repeat(500));
    await wait(45);
    assert.equal(h.length, 0);
    assert.equal(c.toolSearchState, "long");
    assert.ok(/看着像正文/.test(c.toolSearchPanelTitle()));
  });
});

test("同一句话不重复打 Jev", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch({ results: [RESULT_ROW("10", "学生作文批改", 0.9)] }), async (h) => {
    type(c, "帮我批改这篇作文");
    await wait(45);
    assert.equal(h.length, 1);

    await c.fireToolSearch();      // 回车/停顿再触发一次
    await wait(5);
    assert.equal(h.length, 1, "同一句话已有结果：直接复用");
    assert.equal(c.toolSearchState, "results");
  });
});

/* ---------------- 兜底 ---------------- */

test("后端不可达：用本地关键词兜底，控件不空转", async () => {
  const { c } = makeComponent();
  let attempted = 0;
  await withFetch(() => ({
    calls: [],
  }), async () => {
    global.fetch = async () => { attempted += 1; throw new TypeError("Failed to fetch"); };
    type(c, "帮我把这篇学生作文批改一下");
    await wait(45);
  });

  assert.equal(attempted, 1, "先试过后端");
  assert.equal(c.toolSearchState, "results");
  assert.equal(c.toolSearchResults[0].tool_id, "10");
  assert.equal(c.toolSearchResults[0].source, "keyword");
  assert.equal(c.toolSearchMeta.offline, true);
  assert.ok(/网络不通/.test(c.toolSearchPanelTitle()));
});

test("后端主动掐断不报错、不兜底（那是我们自己发起的）", async () => {
  const { c } = makeComponent();
  await withFetch(() => installFetch(), async (h) => {
    type(c, "帮我批改这篇作文");
    await wait(45);
    type(c, "把这套卷子讲评一下");   // 触发 abort
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    h.fail(0, abortError);
    await tick();
    assert.equal(c.toolSearchState, "waiting", "回到等待，而不是报错或塞个兜底结果");
    assert.equal(c.toasts.length, 0);
  });
});

test("后端 429/500 也走兜底，不把错误甩给用户", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async () => {
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    type(c, "帮我把这篇学生作文批改一下");
    await wait(45);
    assert.equal(c.toolSearchState, "results");
    assert.equal(c.toolSearchResults.length > 0, true);
  });
});

/* ---------------- 键盘 ---------------- */

test("↑↓ 环绕高亮，Enter 进入高亮那个工具", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async () => {
    c.applyToolSearchResults({
      results: [
        RESULT_ROW("10", "学生作文批改", 0.9),
        RESULT_ROW("9", "英文写作教学", 0.3),
        RESULT_ROW("33", "翻译", 0.1),
      ],
    });
    const key = (k) => { const ev = { key: k, preventDefault() {} }; c.onToolSearchKeydown(ev); return ev; };

    assert.equal(c.toolSearchActive, 0);
    key("ArrowDown");
    assert.equal(c.toolSearchActive, 1);
    key("ArrowDown");
    key("ArrowDown");
    assert.equal(c.toolSearchActive, 0, "到底回卷");
    key("ArrowUp");
    assert.equal(c.toolSearchActive, 2, "到顶回卷");

    key("Enter");
    assert.deepEqual(c.selectedTools.map((t) => t.id), ["33"]);
    assert.equal(c.toolSearchQuery, "", "选中后清空输入与结果");
    assert.equal(c.toolSearchOpen, false);
  });
});

test("还没出结果时 Enter = 立即搜（Enter 是加速键，不是必需）", async () => {
  const { c } = makeComponent({ toolSearchPauseMs: 5000 });
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "帮我批改这篇作文");
    assert.equal(h.length, 0);
    c.onToolSearchKeydown({ key: "Enter", preventDefault() {} });
    await tick();
    assert.equal(h.length, 1, "回车不必等停顿");
  });
});

test("Esc 收面板但留着用户那句话", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async () => {
    type(c, "帮我批改这篇作文");
    c.onToolSearchKeydown({ key: "Escape", preventDefault() {} });
    assert.equal(c.toolSearchOpen, false);
    assert.equal(c.toolSearchQuery, "帮我批改这篇作文", "用户写的话不该被 Esc 吃掉");
  });
});

/* ---------------- 结果面板与出口 ---------------- */

test("面板文案：搜索中 / 不确定 / 关键词兜底 / 都不合适，各有各的说法", async () => {
  const { c } = makeComponent();
  c.toolSearchQuery = "帮我批改这篇作文";

  c.toolSearchState = "searching";
  assert.ok(/正在理解你的需求/.test(c.toolSearchPanelTitle()));

  c.toolSearchState = "results";
  c.toolSearchMeta = { fallback: false, no_match: false, uncertain: false, offline: false, jev: true };
  assert.equal(c.toolSearchPanelTitle(), "最合适的工具");

  c.toolSearchMeta = { fallback: false, no_match: false, uncertain: true, offline: false, jev: true };
  assert.ok(/不太确定/.test(c.toolSearchPanelTitle()));

  c.toolSearchMeta = { fallback: true, no_match: false, uncertain: false, offline: false, jev: false };
  assert.ok(/未启用智能匹配/.test(c.toolSearchPanelTitle()));

  c.toolSearchMeta = { fallback: true, no_match: true, uncertain: false, offline: false, jev: true };
  assert.ok(/没有完全对口/.test(c.toolSearchPanelTitle()));
});

test("一个都没匹上时把人送到「自由对话」，并带上他那句话", async () => {
  const { c } = makeComponent();
  c.toolSearchQuery = "帮我设计一次班会活动";
  c.input = "";
  await withFetch(() => installInstantFetch(), async () => {
    c.gotoFreeformTool({ currentTarget: null });
  });

  assert.deepEqual(c.selectedTools.map((t) => t.id), ["25"]);
  assert.equal(c.input, "帮我设计一次班会活动", "把刚写的那句话带进输入框");
  assert.equal(c.toolSearchQuery, "", "搜索框清空");
});

test("已经写了内容时不覆盖输入框", async () => {
  const { c } = makeComponent();
  c.toolSearchQuery = "帮我设计一次班会活动";
  c.input = "已经粘进来的一整篇作文";
  c.gotoFreeformTool(null);
  assert.equal(c.input, "已经粘进来的一整篇作文");
});

test("点结果直接进对应工具", async () => {
  const { c } = makeComponent();
  c.toolSearchQuery = "帮我批改这篇作文";
  c.toolSearchResults = [RESULT_ROW("10", "学生作文批改", 0.9)];
  c.pickToolSearchResult(c.toolSearchResults[0], { currentTarget: null });

  assert.deepEqual(c.selectedTools.map((t) => t.id), ["10"]);
  assert.equal(c.toolSearchQuery, "");
  assert.equal(c.toolSearchResults.length, 0);
});

test("结果里的工具已不存在时给提示，不乱跳", async () => {
  const { c } = makeComponent();
  c.pickToolSearchResult({ tool_id: "404", name: "已下线的工具" }, null);
  assert.equal(c.selectedTools.length, 0);
  assert.ok(c.toasts.some((t) => /重新加载工具列表/.test(t.msg)));
});

test("示例 chip：点一下就填上并立即搜", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    c.useToolSearchExample("把这套卷子的重点题讲评一下");
    await tick();
    assert.equal(c.toolSearchQuery, "把这套卷子的重点题讲评一下");
    assert.equal(h.length, 1, "点示例是明确动作，不必再等停顿");
  });
});

test("清空输入即收起面板、不再计时", async () => {
  const { c } = makeComponent();
  await withFetch(() => installInstantFetch(), async (h) => {
    type(c, "帮我批改这篇作文");
    type(c, "");
    await wait(45);
    assert.equal(h.length, 0);
    assert.equal(c.toolSearchOpen, false);
    assert.equal(c.toolSearchState, "idle");
  });
});

/* ---------------- 本地关键词匹配（后端不可达时的兜底） ---------------- */

test("本地关键词匹配：老师口吻的话能命中，噪声不编结果", () => {
  const api = loadApi();
  const match = api.toolSearchKeywordMatch;

  assert.equal(match(TOOL_GROUPS, "帮我把这篇学生作文批改一下")[0].tool_id, "10");
  assert.equal(match(TOOL_GROUPS, "把这段课文翻译成英文")[0].tool_id, "33");
  // 工具自己的用途描述也参与匹配（「工具清单外」是自由对话的关键词）
  assert.equal(match(TOOL_GROUPS, "工具清单外的教学任务")[0].tool_id, "25");
  assert.deepEqual(match(TOOL_GROUPS, "zzz"), []);
  assert.deepEqual(match(TOOL_GROUPS, "  "), []);
  // 结果是接口同一形状，UI 不必为兜底分叉
  const row = match(TOOL_GROUPS, "作文批改")[0];
  assert.equal(typeof row.reason, "string");
  assert.equal(row.source, "keyword");
  assert.ok(row.score > 0 && row.score <= 1);
});

test("收尾字符判定", () => {
  const api = loadApi();
  for (const text of ["帮我批改作文。", "把这套卷子讲评一下？", "翻译成英文，", "do it."]) {
    assert.equal(api.toolSearchLooksFinal(text), true, text);
  }
  for (const text of ["帮我批改作文", "把", ""]) {
    assert.equal(api.toolSearchLooksFinal(text), false, text);
  }
});

test("参数与引导文案在位", () => {
  const api = loadApi();
  assert.equal(api.TOOL_SEARCH_PAUSE_MS, 500);
  assert.ok(api.TOOL_SEARCH_EARLY_MS < api.TOOL_SEARCH_PAUSE_MS);
  assert.equal(api.TOOL_SEARCH_MIN_CHARS, 2);
  assert.equal(api.TOOL_SEARCH_MAX_CHARS, 200);
  assert.equal(api.FREEFORM_TOOL_ID, "25");
  assert.ok(api.TOOL_SEARCH_EXAMPLES.length >= 3);
  // 示例必须是大白话（出现「帮我/把」这类说法），不是工具名
  assert.ok(api.TOOL_SEARCH_EXAMPLES.every((ex) => ex.length > 6));
});
