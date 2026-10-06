/* 试卷可视化全解·两阶段解析用例（阶段二同号重开合并 / GROUP_INTRO / KEY / 题干剥号）
   运行：node frontend/tests/vp-two-stage.test.js

   与 regenerate-flow 同一装载方式：script.js 装进 Function 拿到真正的组件对象，
   直接调 parseCustomVisualPaper。守的是两阶段改造里解析端风险最高的几处：
   - 骨架 + 讲解流拼接后，同一题号只出现一道题，讲解字段并回原题
   - 题干开头的卷面题号被剥掉（"24. 24." 的根治点之一）
   - @@GROUP_INTRO@@ 挂到当前分组；@@KEY@@ 全局收集
   - 题号写在 @@Q@@ 下一行的漂移写法也能触发重开合并
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
if (typeof global.matchMedia !== "function") {
  global.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}

function loadComponent() {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn nbx;"
  );
  const nbx = factory(
    { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
    undefined, makeStorage(), undefined, { hostname: "test" }, undefined,
    undefined, undefined, undefined, undefined,
    global.NbxMirror, undefined, undefined, undefined
  );
  return nbx();
}

const SKELETON = `@@TOTAL@@ 1
@@PAPER@@ 测试卷
@@GROUP@@ reading|阅读理解|
@@PASSAGE_DEF@@ P1
Some English passage.
@@Q@@ 24
@@PASSAGE_REF@@ P1
@@STEM@@
24. Why did BART start the kiosk program?
@@OPTIONS@@
A. One
B. Two
C. Three
D. Four
@@END_Q@@
`;

const ANALYSIS = `@@NOTICE@@ 
@@GROUP_INTRO@@ 考查细节定位
@@Q@@ 24
@@QTYPE@@ choice
@@ANSWER@@
B
@@EVIDENCE@@
Para 1: Some English passage.
@@END_Q@@
@@Q@@ 25
@@QTYPE@@ blank
@@PASSAGE_REF@@ -
@@STEM@@
Fill in the blank.
@@ANSWER@@
is
@@END_Q@@
`;

function test_reopen_merges_into_one_question() {
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + ANALYSIS);
  const qs = data.groups[0].questions;
  assert.strictEqual(
    qs.filter((q) => q.no === "24").length, 1,
    "同号重开不得新建第二道 24 题，实际 " + JSON.stringify(qs.map((q) => q.no))
  );
  const q = qs.find((x) => x.no === "24");
  assert.strictEqual(q.stem, "Why did BART start the kiosk program?", "题干剥号失败: " + q.stem);
  assert.strictEqual(q.qtype, "choice");
  assert.strictEqual(q.answer, "B");
  assert.strictEqual(q.reference.evidence, "Para 1: Some English passage.");
  assert.strictEqual(q.options.length, 4);
}

function test_group_intro_and_key() {
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + ANALYSIS + "@@KEY@@\n21-25 CBADA\n");
  assert.strictEqual(data.groups[0].intro, "考查细节定位");
  assert.strictEqual(data.paperKey, "21-25 CBADA");
}

function test_gap_fill_new_question() {
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + ANALYSIS);
  const qs = data.groups.flatMap((g) => g.questions);
  assert.deepStrictEqual(qs.map((q) => q.no), ["24", "25"], "材料缺的题走新建路径");
  assert.strictEqual(qs[1].answer, "is");
}

function test_pending_qno_reopens_committed() {
  // 阶段二漂移：题号写在 @@Q@@ 的下一行，也要触发重开合并而不是新建
  const c = loadComponent();
  const doc = SKELETON + "@@Q@@\n24\n@@ANSWER@@\nB\n@@END_Q@@\n";
  const data = c.parseCustomVisualPaper(doc);
  const qs = data.groups[0].questions;
  assert.strictEqual(qs.length, 1, "漂移题号也应重开合并，实际 " + qs.length);
  assert.strictEqual(qs[0].answer, "B");
  assert.strictEqual(qs[0].stem, "Why did BART start the kiosk program?");
}

function test_skeleton_alone_parses() {
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON);
  const qs = data.groups[0].questions;
  assert.strictEqual(qs.length, 1);
  assert.strictEqual(qs[0].stem, "Why did BART start the kiosk program?");
  assert.strictEqual(qs[0].answer, null);
  assert.strictEqual(data.total, 1);
}

const tests = [
  test_reopen_merges_into_one_question,
  test_group_intro_and_key,
  test_gap_fill_new_question,
  test_pending_qno_reopens_committed,
  test_skeleton_alone_parses,
];

for (const t of tests) {
  try {
    t();
    console.log("ok - " + t.name);
  } catch (e) {
    console.error("FAIL - " + t.name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}
