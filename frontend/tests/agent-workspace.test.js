const { test } = require("node:test");
const assert = require("node:assert/strict");
test("stream reader page boundaries retain surrogate pairs", async () => {
  const { FullReader } = await import("../agent/reader.mjs");
  const source = "a".repeat(11999) + "😀" + "b".repeat(12000) + "😀";
  const parts = [];
  for (let page = 0; page < Math.ceil(source.length / 12000); page++) {
    const [start, end] = FullReader.prototype.range.call({
      page,
      size: 12000,
      length: source.length,
      slice: (a, b) => source.slice(a, b),
    });
    const part = source.slice(start, end);
    assert(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part));
    parts.push(part);
  }
  assert.equal(parts.join(""), source);
});
test("full reasoning pagination preserves every character and limits page size", async () => {
  const { pageText } = await import("../agent/core.mjs");
  const source = "全文😀中文\n".repeat(100000) + "TAIL";
  const pages = pageText(source);
  assert.equal(pages.map((p) => p.text).join(""), source);
  assert(pages.every((p) => p.text.length <= 12000));
  assert(pages.every((p) => !/[\uD800-\uDBFF]$/.test(p.text)));
});
test("markdown pages retain every block including oversized tables", async () => {
  const { boundedPages } = await import("../agent/core.mjs");
  const blocks = ["# 标题\n\n", "a".repeat(50000), "\n\n尾部"];
  const pages = boundedPages(blocks);
  assert.equal(pages.map((p) => p.text).join(""), blocks.join(""));
  assert(pages.every((p) => p.text.length <= 12000));
});
test("version comparison retains unchanged, removed and added content", async () => {
  const { lineDiff } = await import("../agent/core.mjs");
  const diff = lineDiff("第一题\n第二题\n末尾", "第一题\n修改题\n末尾");
  assert.deepEqual(
    diff.map((x) => x.kind),
    ["same", "removed", "added", "same"],
  );
  assert.equal(
    diff
      .filter((x) => x.kind !== "added")
      .flatMap((x) => x.lines)
      .join("\n"),
    "第一题\n第二题\n末尾",
  );
});

test("event replay after a task switch skips stale running snapshots", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const upserts = [];
  const streams = [];
  const fake = {
    destroyed: false,
    entries: new Map([["e1", { id: "e1", run_id: "r1", kind: "model", status: "done" }]]),
    runs: new Map([["r1", { id: "r1", status: "completed" }]]),
    upsertEntry(value) {
      upserts.push(value.id);
      this.entries.set(value.id, { ...this.entries.get(value.id), ...value });
    },
    startStream(value) {
      streams.push(value.id);
    },
    stopStream() {},
    updateWaiting() {},
    ensureTurn() {
      throw new Error("过期的轮次快照不应再碰轮次");
    },
  };
  const apply = (kind, data) => Conversation.prototype.applyEvent.call(fake, { kind, data });
  // 回放出来的旧快照：本地已是终态，事件却说还在进行。
  assert.equal(
    apply("entry", { id: "e1", run_id: "r1", status: "running", details: { chars: { reasoning: 10 } } }),
    false,
  );
  assert.equal(apply("run", { id: "r1", status: "running" }), false);
  assert.equal(fake.entries.get("e1").status, "done");
  assert.equal(fake.runs.get("r1").status, "completed");
  assert.deepEqual(upserts, []);
  assert.deepEqual(streams, []);
  // 终态快照照常合并；本地还没有的新步骤照常开始流式。
  assert.equal(apply("entry", { id: "e1", run_id: "r1", status: "done" }), true);
  assert.equal(apply("entry", { id: "e2", run_id: "r2", status: "running" }), true);
  assert.deepEqual(upserts, ["e1", "e2"]);
  assert.deepEqual(streams, ["e2"]);
});
test("a stream tick does not reopen reasoning when the entry finished during the read", async (t) => {
  const { Conversation } = await import("../agent/conversation.mjs");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const updates = [];
  const fake = {
    destroyed: false,
    streams: new Map(),
    turns: new Map(),
    entries: new Map([
      ["e1", { id: "e1", run_id: "r1", status: "running", details: { chars: { reasoning: 5 } } }],
    ]),
    entryViews: new Map([["e1", { kind: "model" }]]),
    async ensureContent() {
      // 这一拍读正文的时候，完成事件到了。
      this.entries.set("e1", { ...this.entries.get("e1"), status: "done" });
    },
    updateEntry(turn, state, entry) {
      updates.push(entry.status);
    },
    stopStream(id) {
      clearInterval(this.streams.get(id));
      this.streams.delete(id);
    },
  };
  Conversation.prototype.startStream.call(fake, fake.entries.get("e1"));
  t.mock.timers.tick(380);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [], "不能拿读之前的 running 快照去更新已完成的步骤");
  fake.stopStream("e1");
});

test("writer calls stay out of the conversation and only drive the waiting line", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const proto = Conversation.prototype;
  const writer = (id, label, output, status = "running", extra = {}) => ({
    id, run_id: "r1", kind: "model", label, status,
    details: { role: "writer", source: "tool:gen", chars: { output }, ...extra },
  });
  const entries = new Map([
    ["s1", { id: "s1", run_id: "r1", kind: "model", label: "执行步骤 1", status: "done", details: { role: "agent", chars: { output: 4 } } }],
    ["t1", { id: "t1", run_id: "r1", kind: "tool", label: "create_document", status: "running", details: {} }],
    ["w1", writer("w1", "试卷分析", 1200, "incomplete")],
    ["w2", writer("w2", "试卷分析（续写 1）", 300)],
  ]);
  const turn = { run: { status: "running" }, entries: ["s1", "t1", "w1", "w2"] };
  const fake = { entries, task: { status: "running" }, writerChars: proto.writerChars, caches: new Map([["s1:output", { text: "调度回答" }]]) };
  // 续写按 source 合计字数；正文本身不进对话。
  assert.equal(proto.waitingText.call(fake, turn), "正在撰写成果，已写 1,500 字");
  entries.set("w2", writer("w2", "试卷分析（续写 1）", 0, "running", { chars: { reasoning: 9 } }));
  assert.equal(proto.waitingText.call(fake, turn), "正在撰写成果，已写 1,200 字");
  entries.set("w3", writer("w3", "修订《试卷分析》", 80, "running", { source: "tool:rev" }));
  turn.entries.push("w3");
  assert.equal(proto.waitingText.call(fake, turn), "正在修改成果");
  // 旧记录的修订标签是「修订 · 标题」。
  entries.set("w3", writer("w3", "修订 · 试卷分析", 80, "running", { source: "tool:rev" }));
  assert.equal(proto.waitingText.call(fake, turn), "正在修改成果");
  // 复制回答取调度 Agent 的消息，不取写作者的稿子。
  fake.caches.set("w3:output", { text: "<edit>…</edit>" });
  assert.equal(proto.finalText.call(fake, turn), "调度回答");
  // 写作者不拉取正文流。
  const streamFake = { streams: new Map(), destroyed: false };
  proto.startStream.call(streamFake, entries.get("w3"));
  assert.equal(streamFake.streams.size, 0);
  // 旧记录没有 role：调度的标签一直是「执行步骤 N」，其余模型调用都是写作者。
  const legacy = { entries: new Map([["old", { id: "old", run_id: "r1", kind: "model", label: "试卷分析", status: "running", details: { chars: { output: 5 } } }]]), task: { status: "running" }, writerChars: proto.writerChars };
  assert.equal(proto.waitingText.call(legacy, { run: { status: "running" }, entries: ["old"] }), "正在撰写成果，已写 5 字");
  const step = { entries: new Map([["s", { id: "s", run_id: "r1", kind: "model", label: "执行步骤 2", status: "running", details: { chars: { output: 5 } } }]]), task: { status: "running" } };
  assert.equal(proto.waitingText.call(step, { run: { status: "running" }, entries: ["s"] }), "正在撰写");
});

test("run usage grows during a model call and never dips before settling", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const proto = Conversation.prototype;
  const fake = {
    tokenFloor: new Map(),
    entries: new Map([
      ["a", { id: "a", run_id: "r1", kind: "model", status: "done", details: { context_tokens: 900, live_tokens: 50 } }],
      ["b", { id: "b", run_id: "r1", kind: "model", status: "running", details: { context_tokens: 1000, live_tokens: 200 } }],
    ]),
  };
  const run = { id: "r1", status: "running", tokens: 3000 };
  // 已结算 3000，加上进行中调用的上下文 1000 与已收到输出 200；已结束的调用不再重复计入。
  assert.equal(proto.runTokens.call(fake, run), 4200);
  fake.entries.set("b", { ...fake.entries.get("b"), details: { context_tokens: 1000, live_tokens: 700 } });
  assert.equal(proto.runTokens.call(fake, run), 4700);
  // 调用已完成、结算事件还没到：不回落。
  fake.entries.set("b", { ...fake.entries.get("b"), status: "done" });
  assert.equal(proto.runTokens.call(fake, run), 4700);
  // 结算到达，轮次结束后显示结算值。
  assert.equal(proto.runTokens.call(fake, { ...run, status: "completed", tokens: 4650 }), 4650);
  assert.equal(fake.tokenFloor.size, 0);
});

test("a running task swaps the stop button for send once the draft has content", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const send = {
    hidden: false,
    dataset: {},
    querySelector: () => null,
    setAttribute() {},
  };
  const stop = { hidden: false, disabled: false, title: "" };
  const status = { dataset: {} };
  const rounds = { textContent: "" };
  const tokens = { textContent: "" };
  const proto = Conversation.prototype;
  // 这些引用由构造函数按作用域抓好；模型文本里出现同名 id 也抢不走。
  const fake = {
    task: { status: "running", runs: [{ id: "r1" }] },
    message: { value: "" },
    runs: new Map(),
    runTokens: () => 0,
    sendEl: send,
    stopEl: stop,
    statusEl: status,
    roundsEl: rounds,
    tokensEl: tokens,
  };
  proto.updateComposerState.call(fake);
  assert.equal(send.hidden, true, "运行中空草稿：主按钮仍是停止");
  assert.equal(stop.hidden, false);
  assert.equal(stop.disabled, false);
  fake.message.value = "再补充一句";
  proto.updateComposerState.call(fake);
  assert.equal(send.hidden, false, "运行中有草稿：主按钮换成发送");
  assert.equal(stop.hidden, true, "发送键让位后停止键收起");
  assert.equal(send.dataset.mode, "send");
  fake.message.value = "   ";
  proto.updateComposerState.call(fake);
  assert.equal(send.hidden, true, "只有空白不算草稿");
  assert.equal(stop.hidden, false);
  fake.task.status = "completed";
  fake.message.value = "";
  proto.updateComposerState.call(fake);
  assert.equal(send.hidden, false, "任务结束后发送键回到原位");
  assert.equal(stop.hidden, true);
  // 等待补充是终态，出口是回答或跳过，不提供停止。
  fake.task.status = "waiting";
  proto.updateComposerState.call(fake);
  assert.equal(stop.hidden, true, "等待补充不显示停止");
  // 正在停止：保留按钮但禁用，避免重复提交。
  fake.task.status = "stopping";
  proto.updateComposerState.call(fake);
  assert.equal(stop.hidden, false);
  assert.equal(stop.disabled, true);
  assert.equal(stop.title, "正在停止并保存已收到的内容");
  assert.equal(rounds.textContent.endsWith("轮"), true);
  assert.equal(tokens.textContent.endsWith("tok"), true);
});

test("only executing rounds are stoppable", async () => {
  const { STOPPABLE } = await import("../agent/core.mjs");
  assert.deepEqual([...STOPPABLE].sort(), ["queued", "running"]);
  assert.equal(STOPPABLE.has("waiting"), false);
  assert.equal(STOPPABLE.has("stopping"), false);
});

test("pending ask is the latest waiting ask_user step", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const entries = new Map([
    ["tool", { id: "tool", kind: "tool", label: "read_material", status: "waiting", created_at: "2026-01-01T00:00:00" }],
    ["ask1", { id: "ask1", kind: "tool", label: "ask_user", status: "done", created_at: "2026-01-01T00:00:01" }],
    ["ask2", { id: "ask2", kind: "tool", label: "ask_user", status: "waiting", created_at: "2026-01-01T00:00:02" }],
    ["ask3", { id: "ask3", kind: "tool", label: "ask_user", status: "waiting", created_at: "2026-01-01T00:00:03" }],
  ]);
  assert.equal(
    Conversation.prototype.pendingAsk.call({ entries }).id,
    "ask3",
  );
  assert.equal(
    Conversation.prototype.pendingAsk.call({ entries: new Map() }),
    null,
  );
});

test("no CSS redeclares the workspace width variable set by workspace.js", async () => {
  // workspace.js 把 `--workspace-width` 写在 #app 的行内样式上。自定义属性按"最近声明"
  // 取值，所以任何 CSS 里的同名声明（曾经的 `.layout { --workspace-width: ... }`）
  // 都会遮蔽它，让拖拽与方向键调节完全失效。
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..", "agent");
  const files = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.endsWith(".css")) files.push(full);
    }
  };
  walk(root);
  const offenders = files.filter((file) =>
    /--workspace-width\s*:/.test(fs.readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, [], "这些样式表遮蔽了 #app 上的行内变量");

  const css = fs.readFileSync(path.join(root, "claude", "workspace.css"), "utf8");
  assert.match(
    css,
    /\.workspace-panel\s*\{[^}]*width:\s*var\(--workspace-width,\s*var\(--workspace-w\)\)/,
    "面板宽度必须带 --workspace-w 兜底，变量缺失时不至于塌成 0",
  );
});

test("stale poll responses cannot overwrite a newer one", async () => {
  const { createPollGuard } = await import("../agent/poll-guard.mjs");
  const guard = createPollGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(guard.accepts(second), true);
  assert.equal(guard.accepts(first), false, "先发出的响应必须被丢弃");
});

test("local start/stop wins over a poll started before it", async () => {
  const { createPollGuard } = await import("../agent/poll-guard.mjs");
  const guard = createPollGuard();
  const inFlight = guard.begin();     // 用户点开始之前发出的轮询
  guard.bump();                       // 点开始 → 本地写入 status
  assert.equal(guard.accepts(inFlight), true);
  assert.equal(guard.fresh(inFlight), false, "期间本地写过状态，不要用响应覆盖");
  const next = guard.begin();
  assert.equal(guard.fresh(next), true, "之后的轮询可以正常同步状态");
});

test("model markdown cannot impersonate app UI or submit forms", async () => {
  // 模型输出只应是内容：白名单覆盖 marked 的全部输出，但不含表单类标签、
  // 也不含能借用应用样式的 class / id。（运行时效果用 jsdom 复现过：
  // error-box / result-card / form / id="stop" 都会被剥掉。）
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/conversation.mjs"), "utf8");
  const tags = src.match(/const ALLOWED_TAGS = (\[[\s\S]*?\]);/)[1];
  const attrs = src.match(/const ALLOWED_ATTR = (\[[\s\S]*?\]);/)[1];
  for (const banned of ["form", "button", "img", "iframe", "style", "link", "meta", "select", "textarea"])
    assert(!tags.includes(`"${banned}"`), `不应放行 <${banned}>`);
  for (const banned of ["id", "style", "name", "action", "method", "src", "onclick", "placeholder"])
    assert(!attrs.includes(`"${banned}"`), `不应放行 ${banned} 属性`);
  for (const needed of ["table", "pre", "code", "a", "ul", "li", "input"])
    assert(tags.includes(`"${needed}"`), `标记渲染需要 <${needed}>`);
  assert.match(src, /ALLOWED_URI_REGEXP: \/\^\(\?:https\?\|mailto\):\/i/);
  assert.match(src, /language-\[\^?/, "class 只应放行代码语言标记");
  assert.match(src, /uponSanitizeElement/, "非复选框的 input 需要被移除");
});

test("a model-provided id=stop cannot steal the composer controls", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/conversation.mjs"), "utf8");
  // 输入区控件必须按作用域查找：全局 getElementById 会被模型文本里的同名 id 抢先。
  for (const id of ["stop", "send", "composer-status", "composer-tokens", "composer-rounds"])
    assert(!src.includes(`document.getElementById("${id}")`), `${id} 仍走全局查找`);

  const decoy = { hidden: true, disabled: false, title: "", textContent: "9,999 tok" };
  global.document = { getElementById: () => decoy };
  const realStop = { hidden: true, disabled: false, title: "" };
  Conversation.prototype.updateComposerState.call({
    task: { status: "running", runs: [{ id: "r1" }] },
    message: { value: "" },
    runs: new Map(),
    runTokens: () => 0,
    sendEl: { hidden: false, dataset: {}, querySelector: () => null, setAttribute() {} },
    stopEl: realStop,
    statusEl: { dataset: {} },
    roundsEl: { textContent: "" },
    tokensEl: { textContent: "" },
  });
  assert.equal(realStop.hidden, false, "真正的停止键要显示出来");
  assert.equal(decoy.hidden, true, "模型文本里的同名节点不受影响");
  delete global.document;
});

test("stop-time content repair fetches again after an in-flight poll", async () => {
  const { Conversation } = await import("../agent/conversation.mjs");
  const ctx = {
    taskId: "t1",
    destroyed: false,
    caches: new Map(),
    loading: new Set(),
    entries: new Map(),
    paintCache() {},
    onError() {},
  };
  let calls = 0;
  let serverText = "01234";
  ctx.api = async (url) => {
    calls++;
    const after = Number(/after=(\d+)/.exec(url)[1]);
    const snapshot = serverText.slice(after);
    if (calls === 1) await new Promise((r) => setTimeout(r, 60));
    return { chunks: snapshot ? [{ text: snapshot }] : [], cursor: after + snapshot.length, has_more: false };
  };
  const running = { id: "e1", run_id: "r1", kind: "model", status: "running" };
  const stopped = { id: "e1", run_id: "r1", kind: "model", status: "stopped" };
  const poll = Conversation.prototype.ensureContent.call(ctx, running, "output");
  await new Promise((r) => setTimeout(r, 10));
  serverText = "0123456789"; // 轮询请求在飞时，后端补完了尾部
  const repaired = await Conversation.prototype.ensureContent.call(ctx, stopped, "output");
  await poll;
  assert.equal(repaired, "0123456789", "停止时的补拉必须真的再取一次");
  assert.equal(ctx.caches.get("e1:output").text, serverText);
  assert.equal(calls, 2);
});

test("waiting clock re-resolves the active turn on every tick", async () => {
  // 计数闭包住第一轮的 box 与 created_at 时，回答 ask_user 之后第二轮起就不再走动。
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/conversation.mjs"), "utf8");
  const block = src.match(/const tick = \(\) => \{[\s\S]*?\n    \};/);
  assert(block, "等待行应当有一个 tick 定时器");
  assert.match(block[0], /this\.activeTurn\(\)/, "每次都要重新取当前回合");
  assert.match(block[0], /created_at\)/, "用当前回合的起始时间计时");
  assert(!/durationOf\(started\)/.test(block[0]), "不能用闭包里第一轮的起始时间");
});

test("document paging keeps link reference definitions", async () => {
  // marked 15 不给 `[1]: https://…` 产生 token，按 token.raw 分页会把这类行整行丢掉。
  const fs = require("node:fs");
  const path = require("node:path");
  const marked = require(path.join(__dirname, "../../frontend/vendor/marked-15.0.12.min.js"));
  const src = fs.readFileSync(path.join(__dirname, "../agent/document-worker.js"), "utf8");
  assert.match(src, /raws\.join\(""\) === data\.text \? boundedPages\(raws\) : pageText\(data\.text\)/,
    "拼不回原文时必须退回纯文本分页");
  const doc = "# 报告\n\n结论见 [1]。\n\n[1]: https://example.com/a\n\n结尾。\n";
  assert.notEqual(marked.lexer(doc).map((t) => t.raw).join(""), doc, "该样例确实会丢行");
});

test("streaming markdown appends instead of repainting the whole message", async () => {
  // 每个分片整段重绘会清掉选区、把代码块滚动位置和复制按钮状态打回原样。
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/conversation.mjs"), "utf8");
  const body = src.slice(src.indexOf("class MarkdownView {"), src.indexOf("export class Conversation {"));
  assert(!/text\.length <= 24000/.test(body), "不再按长度切回全量重绘");
  assert.match(body, /renderIncremental\(\);/);
  assert.match(body, /startsWith\(this\.renderedText\)/, "只有非追加场景才整段重建");
  assert.match(body, /hasSelection\(\)/, "有选区时跳过重绘");
  assert.match(body, /selectionchange/, "选区释放后补画");
});

test("message draft survives switching tasks and reloading", async () => {
  const { messageKey, readMessage, writeMessage } = await import("../agent/drafts.mjs");
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  const key = messageKey(7, "t1");
  assert.match(key, /^nbx_agent_msg_7_t1$/);
  writeMessage(storage, key, "写了一半的补充要求");
  assert.equal(readMessage(storage, key), "写了一半的补充要求");
  // 另一个任务互不影响
  assert.equal(readMessage(storage, messageKey(7, "t2")), "");
  // 发送后清空
  writeMessage(storage, key, "");
  assert.equal(readMessage(storage, key), "");
  // 存储不可用时不能抛
  const broken = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); }, removeItem() {} };
  assert.equal(readMessage(broken, key), "");
  writeMessage(broken, key, "x");
  assert.equal(messageKey("", "t1"), "");
});

test("creating a task leaves exactly one history entry", async () => {
  // 先 replace 再 push 同一 URL 会留下"按一次 Back 毫无变化"的死条目。
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/workspace.js"), "utf8");
  const body = src.slice(src.indexOf("async function createTask("), src.indexOf("async function openTask("));
  assert(!body.includes("history.replaceState"), "新建任务不应 replace 掉上一条历史");
  assert.match(body, /openTask\([^)]*true, "prompt"\)/, "新任务从提示词页开始，且只 push 一次");
  const pop = src.slice(src.indexOf('window.addEventListener("popstate"'));
  assert.match(pop, /event\.state\?\.view/, "Back 要恢复历史条目里记的视图");
});

test("loading more tasks cannot append the same page twice", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/workspace.js"), "utf8");
  const body = src.slice(src.indexOf("let tasksLoading"), src.indexOf("function taskRowMenu("));
  // 连点两次"加载更多"会带同一个 offset 发两次请求：必须有在途守卫。
  assert.match(body, /if \(tasksLoading\) return;/, "缺在途守卫");
  assert.match(body, /tasksLoading = true;[\s\S]*finally \{\s*tasksLoading = false;/, "守卫要覆盖整个请求");
  // 追加时按 id 去重，并发或重放都不会画两遍。
  assert.match(body, /!reset && \$\("#task-list"\)\.querySelector\(`\[data-id="\$\{task\.id\}"\]`\)\) continue;/);
});

test("clicking a select's own label closes it", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/select.mjs"), "utf8");
  // 真实点击目标是触发器内部的 .aw-select-value，用 `=== event.target` 判断会当成"点外部"，
  // 于是面板被销毁重建、滚动位置回到顶部。
  assert.match(src, /if \(current\.trigger\.contains\(event\.target\)\) return;/);
  assert(!/event\.target === current\.trigger/.test(src));
});

test("tabbing out of a popover lands on the next control, not body", async () => {
  const { neighbor } = await import("../agent/focus-walk.mjs");
  // 极简伪 DOM：只实现 neighbor() 用到的接口。
  const make = (id, extra = {}) => ({
    id,
    hidden: false,
    getAttribute: () => null,
    closest: () => null,
    getClientRects: () => [{}],
    ...extra,
  });
  const trigger = make("trigger");
  const after = make("after");
  const hidden = make("hidden", { hidden: true });
  const disabledish = make("aria", { getAttribute: (n) => (n === "aria-hidden" ? "true" : null) });
  const list = [trigger, hidden, disabledish, after];
  const root = { querySelectorAll: () => list };
  assert.equal(neighbor(trigger, false, root), after);
  assert.equal(neighbor(after, true, root), trigger);
  assert.equal(neighbor(after, false, root), null);
});

test("both popovers hand focus back to the next control on Tab", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["select.mjs", "model-picker.mjs"]) {
    const src = fs.readFileSync(path.join(__dirname, "../agent", file), "utf8");
    assert.match(src, /neighbor\(/, `${file} 未使用 neighbor()`);
    const start = src.indexOf('event.key === "Tab"');
    const tab = src.slice(start, start + 400);
    assert.match(tab, /focus\(\{ preventScroll: true \}\)/, `${file} 的 Tab 没有交还焦点`);
  }
});

test("select keeps aria-selected for the real value and cursor in data-active", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/select.mjs"), "utf8");
  const setActive = src.slice(src.indexOf("function setActive("), src.indexOf("function choose("));
  assert(!/setAttribute\("aria-selected"/.test(setActive), "方向键不应改写 aria-selected");
  assert.match(setActive, /toggleAttribute\("data-active", cursor\)/);
  // 可访问名称沿用页面里的 <label for>，并让原生 select 留在可访问树里。
  assert.match(src, /aria-labelledby/);
  assert.match(src, /select\.removeAttribute\("aria-hidden"\)/);
  const css = fs.readFileSync(path.join(__dirname, "../agent/claude/select.css"), "utf8");
  assert.match(css, /\.aw-option\[data-active\]/);
  assert(!/\.aw-option\[aria-selected="true"\]/.test(css), "选中字重不该再挂在 aria-selected 上");
});

test("a closed mobile drawer is inert", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../agent/workspace.js"), "utf8");
  assert.match(src, /function syncNavInert\(\)/, "缺少抽屉的 inert 同步");
  assert.match(src, /nav\.inert = isNarrow\(\) && app\.dataset\.sidebar !== "open"/);
  // 初始化与断点切换都要同步一次，否则首屏仍是可聚焦的画外控件。
  assert.match(src, /syncNavInert\(\);\s*\n\s*setWorkspace\(/);
  const bp = src.slice(src.indexOf('onBreakpoint("w1099"'), src.indexOf('onBreakpoint("w1439"'));
  assert.match(bp, /syncNavInert\(\)/);
});

test("ask card height follows the effective viewport like other overlays", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "../agent/claude/ask.css"), "utf8");
  // 只看按视口算高度的规则（px / none 之类的固定值不影响缩放）。
  const heights = [...css.matchAll(/max-height:\s*min\(([^;]+);/g)].map((m) => m[1].trim());
  assert(heights.length >= 2, heights.join(" / "));
  for (const value of heights) {
    assert(!/^min\(\d+vh\s*,/.test(value), `直接写 vh 在放大后会被裁掉：${value}`);
    assert(value.includes("var(--zoom)"), `高度要按有效视口算：${value}`);
  }
});
