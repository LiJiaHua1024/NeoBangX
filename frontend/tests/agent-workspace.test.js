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
    ["w2", writer("w2", "试卷分析 · 续写 1", 300)],
  ]);
  const turn = { run: { status: "running" }, entries: ["s1", "t1", "w1", "w2"] };
  const fake = { entries, task: { status: "running" }, writerChars: proto.writerChars, caches: new Map([["s1:output", { text: "调度回答" }]]) };
  // 续写按 source 合计字数；正文本身不进对话。
  assert.equal(proto.waitingText.call(fake, turn), "正在撰写成果 · 1,500 字");
  entries.set("w2", writer("w2", "试卷分析 · 续写 1", 0, "running", { chars: { reasoning: 9 } }));
  assert.equal(proto.waitingText.call(fake, turn), "正在撰写成果 · 1,200 字");
  entries.set("w3", writer("w3", "修订 · 试卷分析", 80, "running", { source: "tool:rev" }));
  turn.entries.push("w3");
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
  assert.equal(proto.waitingText.call(legacy, { run: { status: "running" }, entries: ["old"] }), "正在撰写成果 · 5 字");
  const step = { entries: new Map([["s", { id: "s", run_id: "r1", kind: "model", label: "执行步骤 2", status: "running", details: { chars: { output: 5 } } }]]), task: { status: "running" } };
  assert.equal(proto.waitingText.call(step, { run: { status: "running" }, entries: ["s"] }), "正在撰写");
});
