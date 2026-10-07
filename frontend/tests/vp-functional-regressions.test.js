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
