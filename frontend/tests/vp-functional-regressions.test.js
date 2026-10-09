const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const NbxMirror = require("../nbx-mirror.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const storage = () => {
  const values = new Map();
  return { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
};
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
function component() {
  const factory = new Function("window", "document", "localStorage", "sessionStorage", "location", "navigator", "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver", "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer", SRC + "\nreturn nbx;");
  const c = factory({ matchMedia: global.matchMedia }, undefined, storage(), storage(), { hostname: "test" }, undefined, undefined, undefined, undefined, undefined, NbxMirror, undefined, undefined, undefined)();
  c.toast = () => {};
  c.$nextTick = () => {};
  c.ensureCanRun = () => true;
  c.closeVpSettings = () => {};
  c._vpPersistEdits = () => {};
  return c;
}
const SKELETON = `@@TOTAL@@ 2
@@PAPER@@ Test
@@GROUP@@ reading|Reading|
@@PASSAGE_DEF@@ P1
Original passage.
@@Q@@ 1
@@PASSAGE_REF@@ P1
@@STEM@@
First question?
@@OPTIONS@@
A. One
B. Two
@@END_Q@@
@@Q@@ 2
@@PASSAGE_REF@@ P1
@@STEM@@
Second question?
@@OPTIONS@@
A. Three
B. Four
@@END_Q@@
`;
function loadPaper(c, raw = SKELETON) {
  c.output = raw;
  c.visualPaper = { ...c.newVisualPaperState(), ...c.normalizeVisualPaper(c.parseCustomVisualPaper(raw)), frameworkRaw: raw };
  c.submittedInput = "Full original exam including the second question";
}

test("首轮框架完成直接进入并发精讲，所有题目和总数始终保留", async () => {
  const c = component();
  c.visualPaper = c.newVisualPaperState();
  c.output = "";
  c._runStream = async ({ onStage, onToken, onVisualTask }) => {
    c.streaming = true;
    onStage({ name: "framework" });
    // 最后一批骨架尚未经过节流渲染时就收到了阶段切换。
    c.output = SKELETON;
    c._outputDirty = true;
    onStage({ name: "explain", framework: true, parallel: true, reuse_framework: false,
      tasks: [{ id: "1", nos: ["1", "2"], completed: [], state: "pending" }] });
    assert.equal(c.vpHasData, true);
    assert.equal(c.vpQuestionCount, 2);
    assert.equal(c.vpTotal, 2);
    assert.equal(c.vpIsStage1Done, true);
    assert.equal(c.vpIsStage2Active, true);
    const framework = c.visualPaper.frameworkRaw;
    assert.ok(framework.includes("Second question?"));
    onVisualTask({ id: "1", state: "running", active_nos: ["1", "2"] });
    assert.equal(c.vpQuestionCount, 2); // 第二步等待首题也不能退回空白加载态。
    c.output += "@@Q@@ 2\n@@ANSWER@@ B\n@@END_Q@@\n";
    c._outputDirty = true;
    c.vpDoRender();
    assert.equal(c.vpQuestionCount, 2);
    assert.equal(c.vpTotal, 2);
    assert.equal(c.vpIsStage1Done, true);
    assert.equal(c.visualPaper.frameworkRaw, framework);
    assert.equal(c.visualPaper.groups[0].questions[0].stem, "First question?");
    assert.equal(c.visualPaper.groups[0].questions[1].answer, "B");
  };
  await c._runVisualStream("original exam");
});

test("框架回退清掉本轮残片，保留续写前的内容与历史归属", async () => {
  for (const baseline of ["", SKELETON]) {
    const c = component();
    loadPaper(c, baseline || SKELETON);
    c.output = baseline;
    c.visualPaper.frameworkRaw = "";
    c.visualPaper.historyId = "existing";
    c._runStream = async ({ onStage }) => {
      c.output += "@@TOTAL@@ 99\n@@GROUP@@ other|Broken|\n@@Q@@ 77\n@@END_Q@@\n";
      c._outputDirty = true;
      c.vpDoRender();
      onStage({ name: "explain", framework: false, reset: true });
      assert.equal(c.output, baseline);
      assert.equal(c.visualPaper.historyId, "existing");
      assert.equal(c.visualPaper.frameworkRaw, "");
      assert.equal(c.vpQuestionCount, baseline ? 2 : 0);
    };
    await c._runVisualStream("original exam", "existing");
  }
});

test("旧残缺骨架的续写重新发送原卷，完整骨架仍走精讲", async () => {
  const c = component();
  loadPaper(c);
  c.visualPaper.groups[0].questions.pop();
  let input;
  c._runVisualStream = async text => { input = text; };
  await c.continueVisualPaper();
  assert.ok(input.startsWith(c.submittedInput));
  loadPaper(c);
  await c.continueVisualPaper();
  assert.ok(input.startsWith(SKELETON));
});

test("切换当前分组不会改变其他题的题型或生成状态", () => {
  const c = component();
  const reading = fullQuestion("1");
  const writing = { no: "2", qtype: "writing", writingGuide: { points: [], outline: "", sample: "" } };
  const legacyWriting = { no: "3", writingGuide: { points: [], outline: "", sample: "" } };
  c.visualPaper = { ...c.newVisualPaperState(), groups: [
    { id: "reading", questions: [reading] },
    { id: "writing_app", questions: [writing] },
    { id: "writing_cont", questions: [legacyWriting] },
  ] };
  c.streaming = true;
  c.vpStage = "explain";
  for (let index = 0; index < 3; index++) {
    c.visualPaper.currentGroupIdx = index;
    assert.equal(c.vpIsWritingQuestion(reading), false);
    assert.equal(c.vpIsWritingQuestion(writing), true);
    assert.equal(c.vpIsWritingQuestion(legacyWriting), true);
    assert.equal(c.vpQuestionStatus(reading), "done");
    assert.equal(c.vpGeneratingQuestionNo, "2");
    assert.equal(c.vpQuestionStatus(writing), "generating");
    assert.equal(c.vpQuestionStatus(legacyWriting), "pending");
  }
});

function fullQuestion(no = "1", count = 1) {
  return { no, qtype: "choice", stem: "Question?", options: [{ label: "A", text: "One" }, { label: "B", text: "Two" }], answer: "A",
    reference: { evidence: "Evidence", reason: "Reason", distractor: "Distractor" },
    pitfalls: [{ title: "Trap", desc: "Explanation" }], pattern: { name: "Pattern", steps: ["Step"] },
    transfers: Array.from({ length: count }, () => ({ passage: "Transfer passage", stem: "Transfer question?", options: [{ label: "A", text: "Three" }, { label: "B", text: "Four" }], answer: "B", explanation: "Explanation" })) };
}

test("只有答案或缺少任一维度、迁移配额时仍可续写", async () => {
  const variants = [
    { no: "1", qtype: "choice", answer: "A" },
    { ...fullQuestion(), reference: { evidence: "Evidence", reason: "", distractor: "Distractor" } },
    { ...fullQuestion(), pitfalls: [] },
    { ...fullQuestion(), pattern: { name: "Pattern", steps: [] } },
    { ...fullQuestion(), transfers: [] },
    fullQuestion("1", 2),
    { ...fullQuestion("1", 3), transfers: [{ ...fullQuestion().transfers[0], explanation: "" }, ...fullQuestion("1", 2).transfers] },
  ];
  for (const q of variants) {
    const c = component();
    loadPaper(c);
    c.visualPaper.total = 1;
    c.visualPaper.transferCount = 3;
    c.visualPaper.groups[0].questions = [q];
    c.vpRunState = "done";
    assert.equal(c.vpComplete, false);
    assert.equal(c.vpRemaining, 1);
    assert.notEqual(c.vpQuestionStatus(q), "done");
    assert.ok(c.vpContinueBrief2().includes("：1。名单之外"));
    assert.ok(c.vpContinueBrief().includes("讲解未完整的题号：1"));
    let requested = false;
    c._runVisualStream = async () => { requested = true; };
    await c.continueVisualPaper();
    assert.equal(requested, true);
  }
});

test("完整选择、填空和写作题可完成，停止时仍保留未确认完成状态", () => {
  const c = component();
  const choice = fullQuestion("1", 3);
  const blank = { ...fullQuestion("2", 3), qtype: "blank", options: [], transfers: fullQuestion("2", 3).transfers.map(tr => ({ ...tr, passage: "", options: [] })) };
  const writing = { no: "3", qtype: "writing", writingGuide: { points: ["Point"], outline: "Outline", sample: "Sample" } };
  c.visualPaper = { ...c.newVisualPaperState(), total: 3, transferCount: 3, groups: [
    { id: "reading", questions: [choice] }, { id: "grammar", questions: [blank] }, { id: "writing_app", questions: [writing] },
  ] };
  c.vpRunState = "done";
  assert.equal(c.vpComplete, true);
  assert.equal(c.vpRemaining, 0);
  for (const field of ["points", "outline", "sample"]) {
    const previous = writing.writingGuide[field];
    writing.writingGuide[field] = field === "points" ? [] : "";
    assert.equal(c.vpComplete, false);
    assert.equal(c.vpRemaining, 1);
    writing.writingGuide[field] = previous;
  }
  c.vpRunState = "stopped";
  assert.equal(c.vpComplete, false);
  c.streaming = true;
  assert.equal(c.vpGeneratingQuestionNo, null);
});

test("七选五迁移选项池不完整时保留续写入口，七项齐全后才完成", () => {
  const c = component();
  const q = fullQuestion();
  q.options = Array.from("ABCDEFG", label => ({ label, text: `Option ${label}` }));
  q.transfers[0].options = q.options.slice(0, 4);
  assert.equal(c.vpQuestionAnalyzed(q), false);
  q.transfers[0].options = q.options;
  assert.equal(c.vpQuestionAnalyzed(q), true);
});

test("编辑后续写与历史快照使用新结构，保留答案区和同篇其他题", async () => {
  const c = component();
  const original = SKELETON + "@@KEY@@\n1 A 2 B\n";
  loadPaper(c, original);
  const questions = c.visualPaper.groups[0].questions;
  Object.assign(questions[0], fullQuestion("1"));
  questions[0].passage = "Original passage.";
  questions[0].passageRef = "P1";
  questions[1].passage = "Teacher revised passage.";
  questions[1].stem = "Teacher revised question?";
  questions[1].options[0].text = "Teacher revised option";
  c.vpCommitEdits();
  assert.equal(c.visualPaper.groups[0].questions[0].passage, "Original passage.");
  assert.ok(!c.visualPaper.frameworkRaw.includes("@@ANSWER@@"), "骨架不携带讲解");
  assert.ok(!c.visualPaper.frameworkRaw.includes("@@TRANSFER_STEM@@"));
  assert.equal(c.parseCustomVisualPaper(c.output).paperKey, "1 A 2 B");
  const reopened = component();
  reopened.visualPaper = JSON.parse(JSON.stringify(c.visualPaper));
  reopened.output = c.output;
  reopened.submittedInput = c.submittedInput;
  let request;
  reopened._runVisualStream = async input => { request = input; };
  await reopened.continueVisualPaper();
  const parsed = reopened.parseCustomVisualPaper(request);
  const qs = parsed.groups[0].questions;
  assert.equal(qs[0].passage, "Original passage.");
  assert.equal(qs[1].passage, "Teacher revised passage.");
  assert.equal(qs[1].stem, "Teacher revised question?");
  assert.equal(qs[1].options[0].text, "Teacher revised option");
  assert.equal(parsed.paperKey.split("\n\n【续写指令】")[0].trim(), "1 A 2 B");
  assert.ok(!request.includes("Second question?"));
  assert.ok(request.includes("：2。名单之外"));
});

test("自动保存同步骨架，旧单阶段记录也能保留修改后续写", async () => {
  const c = component();
  loadPaper(c);
  c.visualPaper.frameworkRaw = "";
  c.visualPaper.groups[0].questions[1].stem = "Autosaved question?";
  c.vpEditing = true;
  c.vpEditDirty = true;
  let persisted;
  c._vpPersistEdits = () => { persisted = JSON.parse(JSON.stringify(c.visualPaper)); };
  c.vpFlushEdits();
  assert.ok(persisted.frameworkRaw.includes("Autosaved question?"));
  c.vpEditing = false;
  let request;
  c._runVisualStream = async input => { request = input; };
  await c.continueVisualPaper();
  assert.ok(request.includes("Autosaved question?"));
  assert.ok(!request.includes("Second question?"));
});

test("并行任务按实际状态显示多题生成，失败题不占住其他任务", () => {
  const c = component();
  loadPaper(c);
  c.streaming = true;
  c.vpStage = "explain";
  c.vpParallel = true;
  c.vpTasks = [
    { id: "a", nos: ["1"], completed: [], state: "pending" },
    { id: "b", nos: ["2"], completed: [], state: "pending" },
  ];
  c.vpApplyTask({ id: "a", state: "running" });
  c.vpApplyTask({ id: "b", state: "running" });
  const qs = c.visualPaper.groups[0].questions;
  assert.deepEqual(qs.map(q => c.vpQuestionStatus(q)), ["generating", "generating"]);
  assert.ok(c.vpStep2StatusText.includes("正在生成 2 题"));
  c.vpApplyTask({ id: "a", state: "error" });
  assert.equal(c.vpGeneratingQuestionNo, "2");
  assert.equal(c.vpQuestionStatus(qs[0]), "idle");
  assert.ok(c.vpStep2StatusText.includes("正在生成 1 题"));
  assert.ok(!c.vpStep2StatusText.includes("组"));
  c.streaming = false;
  assert.ok(c.vpWaitingText(qs[1], "参考答案").includes("待补全"));
  assert.ok(!c.vpWaitingText(qs[1], "参考答案").includes("排队"));
});

test("续写保留骨架尾部答案区，只发送缺失题号，不把讲解塞进骨架", async () => {
  const c = component();
  loadPaper(c, SKELETON + "@@KEY@@\n1 A 2 B\n");
  Object.assign(c.visualPaper.groups[0].questions[1], fullQuestion("2"));
  const originalFramework = c.visualPaper.frameworkRaw;
  let request;
  c._runStream = async args => {
    request = args;
    args.onStage({ name: "explain", framework: true, reuse_framework: true, parallel: true,
      tasks: [{ id: "1", nos: ["1"], completed: [], state: "pending" }] });
  };
  await c.continueVisualPaper();
  assert.deepEqual(request.visualQuestionNos, ["1"]);
  assert.equal(c.parseCustomVisualPaper(c.output).paperKey, "1 A 2 B");
  assert.equal(c.visualPaper.frameworkRaw, originalFramework);
  assert.ok(!c.visualPaper.frameworkRaw.includes("@@TRANSFER_STEM@@"));
  assert.equal(c.vpQuestionAnalyzed(c.parseCustomVisualPaper(c.output).groups[0].questions[1]), true);
});

test("新一轮清空旧任务，停止后没有残留转圈，旧代次事件被丢弃", async () => {
  const c = component();
  loadPaper(c);
  c.vpParallel = true;
  c.vpTasks = [{ id: "old", nos: ["1"], completed: [], state: "running" }];
  c._runStream = async () => {
    assert.equal(c.vpParallel, false);
    assert.deepEqual(c.vpTasks, []);
  };
  await c._runVisualStream("test");
  c.vpParallel = true;
  c.vpTasks = [{ id: "new", nos: ["1"], completed: [], state: "running" }];
  c._runSeq = 3;
  c.finalizeVisualPaper("error", "stale", {}, 2);
  assert.equal(c.vpTasks[0].state, "running");
  c.stopTimer = c.stopThinkTimer = () => {};
  c.pushHistory = () => ({ id: "h" });
  c._persistHistoryItem = () => {};
  c.finalizeVisualPaper("stopped", undefined, {}, 3);
  assert.equal(c.vpTasks[0].state, "cancelled");
  assert.equal(c.vpComplete, false);
});

test("visual_task SSE 不污染正文，题号清单随请求传送", async () => {
  const c = component();
  c._abortCtrl = new AbortController();
  let body;
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return new Response('event: visual_task\ndata: {"id":"1","state":"running"}\n\nevent: token\ndata: "text"\n\nevent: done\ndata: [DONE]\n\n');
  };
  try {
    const tokens = [], tasks = [];
    const result = await c._streamChat({ toolId: "13", input: SKELETON, requestId: "test", visualQuestionNos: ["2"],
      onToken: t => tokens.push(t), onVisualTask: t => tasks.push(t) });
    assert.deepEqual(body.visual_question_nos, ["2"]);
    assert.deepEqual(tokens, ["text"]);
    assert.equal(tasks[0].id, "1");
    assert.equal(result.state, "done");
  } finally {
    global.fetch = previousFetch;
  }
});

test("长语篇和讲解经快照续写往返不会被展示上限截短", async () => {
  const c = component();
  const passage = "Long original sentence. ".repeat(240) + "FINAL EVIDENCE";
  const stem = "Detailed question. ".repeat(70) + "FINAL QUESTION";
  const transfer = "New transfer sentence. ".repeat(60) + "FINAL TRANSFER";
  loadPaper(c, SKELETON.replace("Original passage.", passage).replace("First question?", stem));
  const q = c.visualPaper.groups[0].questions[1];
  Object.assign(q, fullQuestion("2"));
  q.transfers[0].passage = transfer;
  c._runVisualStream = async () => {};
  await c.continueVisualPaper();
  const parsed = c.parseCustomVisualPaper(c.output);
  assert.equal(parsed.groups[0].questions[0].passage, passage);
  assert.equal(parsed.groups[0].questions[0].stem, stem);
  assert.equal(parsed.groups[0].questions[1].transfers[0].passage, transfer);
});

test("语篇内填空不误报空题干，未完成清单与全屏总览说明同一缺项", () => {
  const c = component();
  loadPaper(c);
  const qs = c.visualPaper.groups[0].questions;
  Object.assign(qs[0], fullQuestion("1"), { qtype: "blank", options: [] });
  qs[0].transfers[0].stem = "";
  assert.deepEqual(c.vpQuestionMissing(qs[0]), []);
  Object.assign(qs[1], fullQuestion("2"));
  qs[1].options = Array.from("ABCDEFG", label => ({ label, text: label }));
  qs[1].transfers[0].options = qs[1].options.slice(0, 4);
  assert.equal(c.vpRemaining, 1);
  assert.deepEqual(c.vpMissingQuestions, [{ no: "2", reasons: ["迁移 1：选项不足（4/7）"] }]);
  assert.equal(c.vpOverviewGroups[0].questions[1].missing, "迁移 1：选项不足（4/7）");
});

test("三类语篇设问允许空题干，历史往返、剩余计数与阅读理解判定保持一致", () => {
  const c = component();
  loadPaper(c);
  c.visualPaper.transferCount = 2;
  const groups = [["cloze7", "ABCDEFG"], ["cloze", "ABCD"], ["grammar", ""], ["reading", "AB"]]
    .map(([id, labels], i) => {
      const q = fullQuestion(String(i + 1), 2);
      q.stem = "";
      q.options = [...labels].map(label => ({ label, text: "Option " + label }));
      q.qtype = labels ? "choice" : "blank";
      q.transfers.forEach(t => { t.stem = ""; t.passage = "New context (1) ____."; t.options = structuredClone(q.options); });
      return { id, title: id, questions: [q] };
    });
  c.visualPaper.groups = groups;
  c.visualPaper.total = 4;
  for (let round = 0; round < 2; round++) {
    const qs = c.visualPaper.groups.map(g => g.questions[0]);
    for (const q of qs.slice(0, 3)) assert.deepEqual(c.vpQuestionMissing(q), []);
    assert.deepEqual(c.vpQuestionMissing(qs[3]), ["迁移 1：题干", "迁移 2：题干"]);
    assert.equal(c.vpAnalyzedCount, 3);
    assert.equal(c.vpRemaining, 1);
    assert.deepEqual(c.vpMissingQuestions.map(q => q.no), ["4"]);
    // 回写并重新解析，模拟已保存历史和手动补全的输入。
    c.visualPaper = { ...c.visualPaper, ...c.normalizeVisualPaper(c.parseCustomVisualPaper(c.vpSerializeRaw())) };
  }
  const q = c.visualPaper.groups[0].questions[0];
  q.transfers[0].options = q.transfers[0].options.slice(0, 4);
  assert.deepEqual(c.vpQuestionMissing(q), ["迁移 1：选项不足（4/7）"]);
  const grammar = c.visualPaper.groups[2].questions[0];
  Object.assign(grammar.transfers[0], { passage: "", stem: "", answer: "", explanation: "" });
  assert.deepEqual(c.vpQuestionMissing(grammar), ["迁移 1：语篇", "迁移 1：答案", "迁移 1：解析"]);
});

test("第二步已有框架时按题显示 Fallback，其他任务到达不能清掉恢复提示", () => {
  const c = component();
  loadPaper(c);
  c.streaming = true;
  c.vpStage = "explain";
  c.vpParallel = true;
  c.vpTasks = [
    { id: "a", nos: ["1"], active_nos: ["1"], completed: [], state: "running", fallback: { failed_index: 1, next_index: 2, total: 2, reason: "timeout" } },
    { id: "b", nos: ["2"], completed: [], state: "running" },
  ];
  assert.equal(c.vpRecoveryItems.length, 1);
  assert.match(c.vpRecoveryItems[0].text, /第 1 题：/);
  assert.equal(c.vpRecoveryItems[0].dots.length, 2);
  c.vpApplyTask({ id: "b", state: "done", completed: ["2"] });
  assert.equal(c.vpRecoveryItems.length, 1);
  c.vpApplyTask({ id: "a", fallback: null, attempt: 2, state: "retrying" });
  assert.match(c.vpRecoveryItems[0].text, /自动补全中（第 2\/3 次尝试）/);
  c.streaming = false;
  assert.deepEqual(c.vpRecoveryItems, []);
});

test("逐题补全时当前生成指针只指向 active_nos", () => {
  const c = component();
  loadPaper(c);
  c.streaming = true; c.vpStage = "explain"; c.vpParallel = true;
  c.vpTasks = [{ id: "a", nos: ["1", "2"], active_nos: ["2"], completed: [], state: "running", attempt: 2 }];
  assert.equal(c.vpGeneratingQuestionNo, "2");
  assert.equal(c.vpQuestionStatus(c.visualPaper.groups[0].questions[0]), "pending");
  assert.equal(c.vpQuestionStatus(c.visualPaper.groups[0].questions[1]), "generating");
  assert.match(c.vpStep2StatusText, /已完成 0\/2 题.*自动补全 1 题/);
});

test("阶段切换清除框架 Fallback，精讲恢复事件独立接管", async () => {
  const c = component();
  loadPaper(c);
  c._runStream = async args => {
    c.fallbackInfo = { total: 2, failed: 1, current: 2, reason: "timeout" };
    args.onStage({ name: "explain", framework: true, reuse_framework: true, parallel: true, tasks: [] });
    assert.equal(c.fallbackInfo, null);
  };
  await c._runVisualStream("test");
});

test("框架中途停止不误报结构已锁定，主动停止续写不提示空响应失败", async () => {
  const c = component();
  loadPaper(c);
  c.visualPaper.frameworkRaw = "";
  c.vpStage = "framework";
  c.streaming = false;
  assert.equal(c.vpIsStage1Done, false);
  assert.ok(c.vpStep1StatusText.includes("待确认"));
  loadPaper(c);
  const messages = [];
  c.toast = text => messages.push(text);
  c._runVisualStream = async () => { c._runSeq++; c.vpRunState = "stopped"; };
  await c.continueVisualPaper();
  assert.ok(!messages.some(text => text.includes("未返回新题目")));
});
