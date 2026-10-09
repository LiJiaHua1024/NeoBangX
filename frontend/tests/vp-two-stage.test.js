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

function completedQuestion(no, answer) {
  return { no, answer, qtype: "blank", reference: { evidence: "text", reason: "reason", distractor: "无（非选择题）" },
    pitfalls: [{ title: "trap", desc: "reason" }], pattern: { name: "pattern", steps: ["step"] },
    transfers: [{ passage: "context", stem: "Fill ___ (be).", options: [], answer: "is", explanation: "explanation" }] };
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

// ===== 续写轮次（input 已是 @@TAG@@ 文档再追加讲解）的合并语义 =====

// 骨架组头：标题带空格、导语为空（框架 applier 的派生形式）
const SKELETON2 = SKELETON.replace("@@GROUP@@ reading|阅读理解|", "@@GROUP@@ reading|阅读理解 A 篇|");

function test_group_redeclaration_reused_not_duplicated() {
  // 续写轮次模型重发 @@GROUP@@ 头（无空格、带导语）：必须复用既有分组，
  // 否则重开的题并回原组，新组沦为文档底部 0 题空分组（线上 log-300 的翻车点）
  const cont = "@@GROUP@@ reading|阅读理解A篇|信息匹配类应用文，考查细节定位\n"
    + "@@Q@@ 24\n@@ANSWER@@\nB\n@@END_Q@@\n";
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON2 + cont);
  assert.strictEqual(data.groups.length, 1,
    "重声明不得新建分组，实际 " + JSON.stringify(data.groups.map((g) => g.title)));
  assert.strictEqual(data.groups[0].title, "阅读理解 A 篇");
  // 原组没有导语时，重声明带来的导语补上
  assert.strictEqual(data.groups[0].intro, "信息匹配类应用文，考查细节定位");
  assert.strictEqual(data.groups[0].questions[0].answer, "B");
}

function test_group_intro_not_overwritten_on_reopen() {
  const pass1 = "@@GROUP_INTRO@@ 第一轮导语\n@@Q@@ 24\n@@ANSWER@@\nB\n@@END_Q@@\n";
  const pass2 = "@@GROUP_INTRO@@ 第二轮导语\n@@Q@@ 24\n@@ANSWER@@\nC\n@@END_Q@@\n";
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + pass1 + pass2);
  assert.strictEqual(data.groups[0].intro, "第一轮导语");
  assert.strictEqual(data.groups[0].questions[0].answer, "C");
}

function _transferBlock(passage, answer) {
  return "@@TRANSFER_PASSAGE@@\n" + passage + "\n@@TRANSFER_STEM@@\nTransfer stem?\n"
    + "@@TRANSFER_ANSWER@@\n" + answer + "\n@@TRANSFER_EXPL@@\n解析\n";
}

function test_reopen_transfer_replaced_by_new_blocks() {
  // 同号重开且模型重写了迁移块：整体替换旧块，不得新旧叠加翻倍（线上重复迁移的翻车点）
  const pass1 = "@@GROUP_INTRO@@ g\n@@Q@@ 24\n@@ANSWER@@\nB\n@@PATTERN_STEPS@@\ns\n"
    + _transferBlock("Old passage.", "A") + "@@END_Q@@\n";
  const pass2 = "@@Q@@ 24\n@@ANSWER@@\nC\n@@PATTERN_STEPS@@\ns2\n"
    + _transferBlock("New passage.", "D") + "@@END_Q@@\n";
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + pass1 + pass2);
  const q = data.groups[0].questions[0];
  assert.strictEqual(q.answer, "C");
  assert.strictEqual(q.transfers.length, 1,
    "重写后迁移块应整体替换，实际 " + q.transfers.length + " 块");
  assert.strictEqual(q.transfers[0].passage, "New passage.");
}

function test_reopen_without_transfer_keeps_old_blocks() {
  // 同号重开但模型没重写迁移块：沿用重开前持有的旧块，不得清空
  const pass1 = "@@Q@@ 24\n@@ANSWER@@\nB\n@@PATTERN_STEPS@@\ns\n"
    + _transferBlock("Old passage.", "A") + "@@END_Q@@\n";
  const pass2 = "@@Q@@ 24\n@@ANSWER@@\nC\n@@END_Q@@\n";
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(SKELETON + pass1 + pass2);
  const q = data.groups[0].questions[0];
  assert.strictEqual(q.transfers.length, 1);
  assert.strictEqual(q.transfers[0].passage, "Old passage.");
}

function test_continue_brief2_lists_missing_nos() {
  // 工单只点名未讲解的题号（结构题数会谎报进度——简报必须用「已讲解」口径）
  const c = loadComponent();
  c.visualPaper = c.newVisualPaperState();
  c.visualPaper.total = 3;
  c.visualPaper.groups = [
    {id: "reading", title: "A篇", intro: "", questions: [
      completedQuestion("21", "A"),
      {no: "22", answer: null},
    ]},
    {id: "writing_app", title: "应用文写作", intro: "", questions: [
      {no: "66", qtype: "writing", answer: null, writingGuide: {points: ["x"], outline: "outline", sample: "sample"}},
    ]},
  ];
  const brief = c.vpContinueBrief2();
  assert.ok(brief.includes("：22。名单之外"), "工单应点名缺失题号 22：" + brief);
  assert.ok(!brief.includes("21"), "已讲解的题号不得进工单：" + brief);
  assert.ok(!brief.includes("66"), "写作指导完整的写作题也算已讲解：" + brief);
  assert.ok(brief.includes("已有讲解 2 题"), "进度必须用完整讲解数：" + brief);
  assert.ok(!brief.includes("最后完成的是"), "不再用「最后完成的是第 N 题」误导续写起点");
  assert.ok(brief.includes("不要输出 @@TOTAL@@"), "应禁发结构行：" + brief);
  assert.ok(brief.includes("按题号合并进已有文档"), "开篇应说明合并方式：" + brief);
}

function test_stray_fields_after_early_endq_reopened() {
  // 实测（log-300）：模型把 @@END_Q@@ 提前写在 OPTIONS 之后，ANSWER/迁移块全落在
  // 第一个 END_Q 之后——重开并入刚提交的题，不得静默丢弃（线上 Q26 讲解丢失的来源）
  const doc = SKELETON
    + "@@Q@@ 24\n@@QTYPE@@ choice\n@@STEM@@\nRecent activities?\n@@OPTIONS@@\nA. x\nB. y\n@@END_Q@@\n"
    + "@@ANSWER@@\nA\n@@EVIDENCE@@\nPara 2: evidence.\n"
    + "@@TRANSFER_PASSAGE@@\nStray transfer.\n@@TRANSFER_ANSWER@@\nC\n@@TRANSFER_EXPL@@\n路径\n@@END_Q@@\n";
  const c = loadComponent();
  const data = c.parseCustomVisualPaper(doc);
  const qs = data.groups[0].questions;
  assert.strictEqual(qs.length, 1, "不得新建第二道 24，实际 " + JSON.stringify(qs.map((q) => q.no)));
  assert.strictEqual(qs[0].answer, "A");
  assert.strictEqual(qs[0].reference.evidence, "Para 2: evidence.");
  assert.strictEqual(qs[0].transfers.length, 1);
  assert.strictEqual(qs[0].transfers[0].passage, "Stray transfer.");
}

function test_vp_remaining_and_complete_use_analyzed_semantics() {
  // 两阶段口径：骨架到位后结构题数即满，「剩余/完成」必须看讲解——
  // 否则讲解 0% 也算「已完成」，续写入口被整条收起（线上卡死场景）
  const c = loadComponent();
  c.visualPaper = c.newVisualPaperState();
  c.visualPaper.total = 3;
  c.visualPaper.groups = [
    {id: "reading", title: "A篇", intro: "", questions: [
      completedQuestion("21", "A"),
      {no: "22", answer: null},
      {no: "23", answer: null},
    ]},
  ];
  c.vpRunState = "done";
  assert.strictEqual(c.vpRemaining, 2, "剩余应按讲解口径（结构 3/3 已满，2 题未讲解）");
  assert.strictEqual(c.vpComplete, false, "讲解没写完不得算已完成");
  // 进度行：结构齐了但讲解没写完 → 报讲解进度，不再报「已解析 3/3 题，未写完」
  assert.ok(c.vpProgressText.includes("讲解完成"), "进度行应报讲解进度：" + c.vpProgressText);
  assert.ok(!c.vpProgressText.includes("已解析"), "结构已满不得再报结构进度：" + c.vpProgressText);
  c.visualPaper.groups[0].questions[1] = completedQuestion("22", "B");
  c.visualPaper.groups[0].questions[2] = completedQuestion("23", "C");
  assert.strictEqual(c.vpRemaining, 0);
  assert.strictEqual(c.vpComplete, true, "全部讲解 + 自然收尾才算完成");
  assert.strictEqual(c.vpProgressText, "已完成");
}

function test_stage_pills_during_continuation() {
  // 续写流没有 stage 事件：入口把 vpStage 拨到 explain 后，指示器不得回落成「待开始」
  // （实测续写期间第一步显示「待开始」，停止后才变绿——两阶段口径残留）
  const c = loadComponent();
  c.visualPaper = c.newVisualPaperState();
  c.visualPaper.total = 47;
  c.visualPaper.groups = [
    {id: "reading", title: "A篇", intro: "", questions: [
      {no: "21", answer: "A"}, {no: "22", answer: null},
    ]},
  ];
  c.streaming = true;
  c.vpStage = "explain"; // continueVisualPaper 入口设置
  assert.strictEqual(c.vpIsStage1Active, false);
  assert.strictEqual(c.vpIsStage1Done, false, "旧记录只有 2/47 题结构，不得误报结构已锁定");
  assert.ok(c.vpStep1StatusText.includes("补全结构"), "第一步文案：" + c.vpStep1StatusText);
  assert.strictEqual(c.vpIsStage2Active, true, "续写期间第二步应处于进行中");
  assert.strictEqual(c.vpIsStage2Done, false);
  c.visualPaper.total = 2;
  c.visualPaper.frameworkRaw = "完整骨架快照";
  assert.strictEqual(c.vpIsStage1Done, true, "完整骨架续写期间第一步应显示已完成");
  assert.ok(c.vpStep1StatusText.includes("已锁定"));
  // 对照：首跑框架阶段不误报完成
  c.vpStage = "framework";
  assert.strictEqual(c.vpIsStage1Active, true);
  assert.strictEqual(c.vpIsStage1Done, false, "框架提取中不得显示已完成");
}

const tests = [
  test_reopen_merges_into_one_question,
  test_group_intro_and_key,
  test_gap_fill_new_question,
  test_pending_qno_reopens_committed,
  test_skeleton_alone_parses,
  test_group_redeclaration_reused_not_duplicated,
  test_group_intro_not_overwritten_on_reopen,
  test_reopen_transfer_replaced_by_new_blocks,
  test_reopen_without_transfer_keeps_old_blocks,
  test_continue_brief2_lists_missing_nos,
  test_stray_fields_after_early_endq_reopened,
  test_vp_remaining_and_complete_use_analyzed_semantics,
  test_stage_pills_during_continuation,
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
