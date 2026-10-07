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
