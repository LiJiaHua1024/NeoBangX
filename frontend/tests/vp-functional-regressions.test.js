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
function component(hostWindow = {}) {
  const factory = new Function("window", "document", "localStorage", "sessionStorage", "location", "navigator", "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver", "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer", SRC + "\nreturn nbx;");
  const c = factory({ matchMedia: global.matchMedia, ...hostWindow }, undefined, storage(), storage(), { hostname: "test" }, undefined, undefined, undefined, undefined, undefined, NbxMirror, undefined, undefined, undefined)();
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

test("编辑自动保存保留未填写的新增条目，停顿后仍可接着填写", () => {
  for (const list of ["q.transfers", "q.pitfalls", "q.pattern.steps", "q.writingGuide.points"]) {
    const c = component();
    const q = fullQuestion();
    q.writingGuide = { points: ["Point"], outline: "Outline", sample: "Sample" };
    const writing = list === "q.writingGuide.points";
    if (writing) q.qtype = "writing";
    c.visualPaper = { ...c.newVisualPaperState(), total: 1, transferCount: 1,
      groups: [{ id: writing ? "writing_app" : "reading", title: "Group", questions: [q] }] };
    c.vpEditing = true;
    c.vpEditBeforeLeave = () => {};
    c.vpRemountList = () => {};
    let saved;
    c._vpPersistEdits = () => { saved = structuredClone(c.visualPaper); };
    c.vpAddItem(list);
    const items = c.vpFieldGet(list), before = items.length;
    c.vpFlushEdits();
    assert.equal(c.vpCurrentQuestion, q, "自动保存不得替换正在编辑的题目");
    assert.equal(c.vpFieldGet(list), items);
    assert.equal(items.length, before, "新增的空条目不得消失");
    assert.equal(saved.groups[0].questions[0].no, q.no);
    const field = list === "q.transfers" ? ".passage" : list === "q.pitfalls" ? ".desc" : "";
    c.vpSetField(`${list}.${before - 1}${field}`, "New content");
    c.vpFlushEdits();
    assert.equal(c.vpFieldGet(`${list}.${before - 1}${field}`), "New content");
    assert.ok(c.output.includes("New content"));
  }
});

test("编辑自动保存仍刷新速查表，并保留空写作指导的未完成状态", () => {
  const c = component(), q = fullQuestion();
  c.visualPaper = { ...c.newVisualPaperState(), total: 2, groups: [
    { id: "reading", questions: [q] },
    { id: "writing_app", questions: [{ no: "2", qtype: "writing", writingGuide: { points: [], outline: "", sample: "" } }] },
  ] };
  c.vpEditing = true;
  c.vpSetField("q.answer", "B");
  c.vpFlushEdits();
  assert.deepEqual(c.visualPaper.answerMap, { "1": "B" });
  assert.equal(c.vpQuestionAnalyzed(c.vpGroups[1].questions[0]), false);
});

test("修改答案后立即打印，速查表与正文一致且不丢编辑草稿", () => {
  let printed;
  const c = component({ VPPrint: { openDialog: payload => { printed = payload; } } });
  const q = fullQuestion();
  c.visualPaper = { ...c.newVisualPaperState(), paper: { title: "Test" }, total: 1,
    answerMap: { "1": "A" }, groups: [{ id: "reading", questions: [q] }] };
  c.vpEditing = true;
  c.closeExportMenu = () => {};
  c.vpSetField("q.answer", "B");
  q.transfers.push({ passage: "", stem: "", options: [], answer: "", explanation: "" });
  c.printVisualPaper();
  assert.equal(printed.groups[0].questions[0].answer, "B");
  assert.deepEqual(printed.answerMap, { "1": "B" });
  assert.equal(c.vpCurrentQuestion, q);
  assert.equal(q.transfers.length, 2);
  assert.equal(c.vpEditing, true);
  assert.equal(c.vpEditDirty, true, "打印不得取消待自动保存的改动");
  c._vpStopEditTimer();
});

test("导出速查表跟随清空的答案和新增写作范文，不沿用旧快照", () => {
  const c = component(), q = fullQuestion();
  const writing = { no: "2", qtype: "writing", writingGuide: { points: [], outline: "", sample: "" } };
  c.visualPaper = { ...c.newVisualPaperState(), total: 2, answerMap: { "1": "A" }, groups: [
    { id: "reading", questions: [q] }, { id: "writing_app", questions: [writing] },
  ] };
  q.answer = "";
  assert.deepEqual(c.vpExportPayload("Test").answerMap, {});
  writing.writingGuide.sample = "New sample";
  assert.deepEqual(c.vpExportPayload("Test").answerMap, { "2": "见范文" });
});

test("历史重解析后导航持有旧题目引用时，语篇题的完成标记仍与整卷一致", () => {
  const c = component();
  const groups = ["cloze7", "cloze", "grammar", "reading"].map(id => {
    // 同号跨组，不能用题号猜所属分组。
    const q = fullQuestion("1");
    q.transfers[0].stem = "";
    if (id === "cloze7" || id === "cloze") {
      q.options = [...(id === "cloze7" ? "ABCDEFG" : "ABCD")].map(label => ({ label, text: "Option " + label }));
      q.transfers[0].options = structuredClone(q.options);
    }
    if (id === "grammar") { q.qtype = "blank"; q.options = []; q.transfers[0].options = []; }
    return { id, title: id, questions: [q] };
  });
  c.visualPaper = { ...c.newVisualPaperState(), total: 4, transferCount: 1, groups };
  c.output = JSON.stringify(c.visualPaper);
  c.vpRunState = "done";
  const navigationGroups = c.vpGroups;
  c._outputDirty = true;
  c.vpDoRender();
  assert.notEqual(c.vpGroups[0].questions[0], navigationGroups[0].questions[0]);
  for (const g of navigationGroups.slice(0, 3)) {
    assert.deepEqual(c.vpQuestionMissing(g.questions[0], g.id), []);
    assert.equal(c.vpQuestionStatus(g.questions[0], g.id), "done");
  }
  assert.deepEqual(c.vpQuestionMissing(navigationGroups[3].questions[0], "reading"), ["迁移 1：题干"]);
  assert.equal(c.vpQuestionStatus(navigationGroups[3].questions[0], "reading"), "idle");
  assert.equal(c.vpRemaining, 1, JSON.stringify(c.vpMissingQuestions));
  assert.equal(c.vpComplete, false);
  c.vpGroups[3].questions[0].transfers[0].stem = "Question?";
  assert.equal(c.vpComplete, true);
  assert.equal(c.vpRemaining, 0);
  // 真正缺失的内容仍须显示待补，不因明确分组而放宽其他检查。
  const broken = structuredClone(navigationGroups[0].questions[0]);
  broken.transfers[0].explanation = "";
  assert.deepEqual(c.vpQuestionMissing(broken, "cloze7"), ["迁移 1：解析"]);
  assert.equal(c.vpQuestionStatus(broken, "cloze7"), "idle");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes("vpQuestionStatus(q, g.id)"));
  assert.ok(html.includes("vpQuestionMissing(q, g.id)"));
  assert.ok(!html.includes("vpQuestionStatus(q)"));
});

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
  // 讲解已全齐：done 与「用户主动停止但内容已写完」都算完成。
  // 只认 done 会让全齐后手停止的卷子永远挂着「待补全」入口，需空跑一轮才知道没得写。
  c.vpRunState = "stopped";
  assert.equal(c.vpComplete, true);
  assert.equal(c.vpRemaining, 0);
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
  // error/incomplete/cancelled 不再一律落 idle：生成中也要看得见失败
  assert.equal(c.vpQuestionStatus(qs[0]), "failed");
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
  // 复用续写也会刷新快照（旧实现不刷新，间隙编辑未落盘时下轮仍拿旧快照）；
  // 但刷新后的快照只含结构，讲解字段不得塞进去
  assert.notEqual(c.visualPaper.frameworkRaw, originalFramework);
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
  assert.deepEqual(c.vpMissingQuestions.map(m => ({ no: m.no, reasons: m.reasons })),
                [{ no: "2", reasons: ["迁移 1：选项不足（4/7）"] }]);
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


test("校验失败时回滚 output：删到空卷不能留下被掏空的原始文本", () => {
  const c = component();
  loadPaper(c);
  const rawBefore = c.output;
  const jsonBefore = c.visualPaper.rawJson;
  assert.equal(c.vpQuestionCount, 2);
  // 编辑态把题目清空但保留一个组：vpCommitEdits 的守卫查的是 groups.length，
  // 而序列化结果里一道题都没有，重解析后 vpQuestionCount 归零 → 触发校验失败分支
  c.vpEditing = true;
  c.visualPaper.groups = [{ id: "reading", title: "Reading", intro: "", questions: [] }];
  c.vpCommitEdits();
  // 界面结构已回滚
  assert.equal(c.vpQuestionCount, 2);
  // 关键是 output 也回滚了：旧版只备份五项，这里读到的是空文档
  assert.equal(c.output, rawBefore);
  assert.equal(c.visualPaper.rawJson, jsonBefore);
  // 回滚后导出读到的仍是完整卷子
  const { data } = c.tryParseVisualPaper(c.output);
  assert.ok(data, "output 必须仍是可解析的卷子");
  assert.equal(data.groups[0].questions.length, 2);
});

const NO_TOTAL = `@@PAPER@@ Test
@@GROUP@@ reading|Reading|
@@Q@@ 1
@@STEM@@
Only question?
@@OPTIONS@@
A. One
B. Two
@@ANSWER@@ A
@@END_Q@@
`;

test("没有 @@TOTAL@@ 声明的卷子：total 标记为未声明，不伪造成已完成", () => {
  const c = component();
  c.output = NO_TOTAL;
  c.visualPaper = { ...c.newVisualPaperState(), ...c.normalizeVisualPaper(c.parseCustomVisualPaper(NO_TOTAL)) };
  assert.equal(c.visualPaper.totalDeclared, false);
  assert.equal(c.vpQuestionCount, 1);
  c.vpRunState = "done";
  // 讲解不齐时即使结构齐也不能完成（旧实现靠 total 被洗成 1 的恒真式放行）
  assert.equal(c.vpComplete, false);
  // 补齐讲解后可以完成
  const q = c.visualPaper.groups[0].questions[0];
  q.reference = { evidence: "e", reason: "r", distractor: "d" };
  q.pitfalls = [{ title: "t", desc: "d" }];
  q.pattern = { name: "n", steps: ["s"] };
  q.transfers = [{ passage: "p", stem: "s", answer: "a", explanation: "e", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }] }];
  c.visualPaper.transferCount = 1;
  assert.equal(c.vpComplete, true);
  assert.equal(c.vpRemaining, 0);
  // 生成中不完成
  c.streaming = true;
  assert.equal(c.vpComplete, false);
});

test("序列化不把虚高的 total 固化：取声明与实际题数的较大值", () => {
  const c = component();
  loadPaper(c);
  // 虚高：声明 47 实际 2
  c.visualPaper.total = 47;
  const raw = c.vpSerializeRaw();
  assert.ok(raw.startsWith("@@TOTAL@@ 47"), "声明高于实际时保留声明，别凭空改小");
  // 虚低（被截断的数字前缀）：声明 1 实际 2
  c.visualPaper.total = 1;
  const raw2 = c.vpSerializeRaw();
  assert.ok(raw2.startsWith("@@TOTAL@@ 2"), "声明低于实际时以实际为准");
});

test("总数虚高时不锁死结构化续写：仍走骨架近路而非原卷重发", async () => {
  const c = component();
  loadPaper(c);
  // 模型数错/多轮累积：声明 47 实际 2
  c.visualPaper.total = 47;
  let input;
  c._runVisualStream = async text => { input = text; };
  await c.continueVisualPaper();
  assert.ok(input.startsWith(SKELETON), "虚高时应发骨架，不能退回原卷把教师的修改覆盖掉");
});

test("总数真实偏少时仍回退原卷：残缺骨架走老路径", async () => {
  const c = component();
  loadPaper(c);
  c.visualPaper.groups[0].questions.pop();
  let input;
  c._runVisualStream = async text => { input = text; };
  await c.continueVisualPaper();
  assert.ok(input.startsWith(c.submittedInput));
});

test("裁尾保留 @@KEY@@ 答案区，不把 paperKey 一起丢掉", async () => {
  const c = component();
  const withKey = SKELETON + "@@KEY@@" + "\n" + "1 A\n2 B\n";
  c.output = withKey + "@@Q@@ 3\n@@STEM@@\n半道题";
  c.visualPaper = { ...c.newVisualPaperState(), ...c.normalizeVisualPaper(c.parseCustomVisualPaper(withKey)), frameworkRaw: "" };
  c.submittedInput = "Original paper";
  c._runVisualStream = async () => {};
  const before = c.output;
  assert.equal(c.parseCustomVisualPaper(before).paperKey.trim(), "1 A\n2 B");
  await c.continueVisualPaper();
  // 未完成残片被裁掉
  assert.ok(!c.output.includes("半道题"), "未完成残片应被裁掉");
  // 答案区必须留在本地 output 里，否则重解析丢失 paperKey、后续序列化再也找不回
  assert.ok(c.output.includes("@@KEY@@"), "答案区必须保留");
  const parsed = c.parseCustomVisualPaper(c.output);
  assert.equal(parsed.paperKey.trim(), "1 A\n2 B");
  // 序列化时答案区仍能被找回
  const raw = c.vpSerializeRaw();
  assert.ok(raw.includes("@@KEY@@"));
});

test("序列化不抹掉「语篇引用未解析」告警：round-trip 后仍标记", () => {
  const c = component();
  const raw = `@@TOTAL@@ 1
@@PAPER@@ Test
@@GROUP@@ reading|Reading|
@@Q@@ 1
@@PASSAGE_REF@@ P9
@@STEM@@
Question?
@@OPTIONS@@
A. One
B. Two
@@ANSWER@@ A
@@END_Q@@
`;
  c.output = raw;
  c.visualPaper = { ...c.newVisualPaperState(), ...c.normalizeVisualPaper(c.parseCustomVisualPaper(raw)) };
  const q = c.visualPaper.groups[0].questions[0];
  assert.equal(q.passageUnresolved, true, "P9 没有对应 DEF，应标记未解析");
  const out = c.vpSerializeRaw();
  assert.ok(out.includes("@@PASSAGE_REF@@ UNRESOLVED"), "未解析的题必须写哨兵，不能写 '-'");
  const reparsed = c.parseCustomVisualPaper(out);
  assert.equal(reparsed.groups[0].questions[0].passageUnresolved, true, "round-trip 后告警必须还在");
});

test("本就无语篇的题仍写 '-'，不会被误标成未解析", () => {
  const c = component();
  loadPaper(c);
  const q = c.visualPaper.groups[0].questions[0];
  q.passage = "";
  q.passageRef = "";
  delete q.passageUnresolved;
  const out = c.vpSerializeRaw();
  assert.ok(out.includes("@@PASSAGE_REF@@ -"), "本就无语篇仍写 -");
  const reparsed = c.parseCustomVisualPaper(out);
  assert.ok(!reparsed.groups[0].questions[0].passageUnresolved);
});

test("生成中拒绝打印与导出半成品", () => {
  const c = component();
  loadPaper(c);
  const toasts = [];
  c.toast = (t) => toasts.push(t);
  c.streaming = true;
  c.printVisualPaper();
  assert.ok(toasts.some(t => t.includes("正在生成中")), "生成中应提示而非打印");
  toasts.length = 0;
  c.openVpExport();
  assert.ok(toasts.some(t => t.includes("正在生成中")), "生成中应提示而非导出");
  assert.equal(c.vpExportOpen, false);
  // 生成结束后不再拦（VPPrint 未加载会走另一条提示，但不再是「生成中」）
  c.streaming = false;
  toasts.length = 0;
  c.printVisualPaper();
  assert.ok(!toasts.some(t => t.includes("正在生成中")), "完成后应放行");
  c.openVpExport();
  assert.equal(c.vpExportOpen, true, "完成后导出面板应打开");
});

test("无题号题不互相覆盖：速查表保留先到的答案，清单按索引跳转", () => {
  const c = component();
  const raw = `@@TOTAL@@ 3
@@PAPER@@ Test
@@GROUP@@ reading|Reading|
@@Q@@ 1
@@STEM@@
First?
@@OPTIONS@@
A. One
B. Two
@@ANSWER@@ A
@@END_Q@@
@@Q@@
@@STEM@@
Bare one?
@@OPTIONS@@
A. x
B. y
@@ANSWER@@ B
@@END_Q@@
@@Q@@
@@STEM@@
Bare two?
@@OPTIONS@@
A. p
B. q
@@ANSWER@@ C
@@END_Q@@
`;
  c.output = raw;
  c.visualPaper = { ...c.newVisualPaperState(), ...c.normalizeVisualPaper(c.parseCustomVisualPaper(raw)) };
  const qs = c.visualPaper.groups[0].questions;
  assert.equal(qs.length, 3);
  assert.equal(qs[1].no, "?");
  assert.equal(qs[2].no, "?");
  // 速查表不能因同号互相覆盖而只剩一个 "?"
  assert.equal(c.visualPaper.answerMap["1"], "A");
  assert.ok("?" in c.visualPaper.answerMap);
  // 缺失清单带索引，点击按索引定位而不是 findIndex 落第一道
  const missing = c.vpMissingQuestions;
  assert.ok(missing.length >= 2);
  assert.ok(missing.every(m => typeof m.gIdx === "number" && typeof m.qIdx === "number"));
  assert.equal(missing[1].qIdx, 1, "第二道缺题必须指向索引 1");
  assert.equal(missing[2].qIdx, 2, "第三道缺题必须指向索引 2");
});
