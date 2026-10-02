/* 讲台单文件与打印件的答案速查 / 分页回归测试
   运行：node frontend/tests/vp-standalone-print.test.js

   「见范文」这条规则在主应用与后端 visual_paper 里都有，唯独讲台与打印件
   两条独立渲染路径漏了 —— 写作题在答案速查表里整行消失。同样地，
   「大题另起一页」勾选只被教师详解版与学生练习版认，答案册被漏掉。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const FRONTEND = path.join(__dirname, "..");

/* 一个只有「写作题 + 普通题」的最小卷子：写作题 answer 为空（答案在范文里） */
const PAYLOAD = {
  paper: { title: "期中测试", subject: "英语", year: "2026" },
  groups: [
    {
      title: "第一部分 听力",
      questions: [
        { no: "1", qtype: "single", stem: "What is this?", options: [{ label: "A", text: "a cat" }], answer: "A" },
      ],
    },
    {
      title: "第二部分 写作",
      questions: [
        { no: "2", qtype: "writing", stem: "Write an essay.", answer: "", writingGuide: { model: "Here is a model essay..." } },
      ],
    },
    {
      title: "第三部分 阅读",
      questions: [
        { no: "3", qtype: "single", stem: "Choose.", options: [{ label: "B", text: "an answer" }], answer: "B" },
      ],
    },
  ],
};

/* ---------------- vp-print.js ----------------
   排版（layout/paginate）要真实 DOM 量高，vm 里跑不通；本文件只关心
   「答案速查的内容对不对」与「大题组块上有没有带分页标记」—— 前者由
   answerMapOf 决定，后者由 answerItems 产出的 item 决定，两处都是纯计算。 */

function loadPrintInternals() {
  const src = fs.readFileSync(path.join(FRONTEND, "vp-print.js"), "utf8");
  const grab = (name) => {
    const start = src.indexOf("function " + name + "(");
    assert.ok(start >= 0, `脚本结构变了：找不到 ${name}`);
    // 从声明处扫到「列首 } 」结束 —— 这些函数体里没有嵌套的列首大括号
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`${name} 的大括号没配平`);
  };
  const parts = ["itemHtml", "answerMapOf", "answerItems"].map(grab).join("\n");
  const mm = (v) => v;
  const env = {
    MODE_LABEL: { answer: "答案解析", teacher: "教师详解版", student: "学生练习版" },
    DATA_ID: "vpp-data",
    str: (v) => (v == null ? "" : String(v)),
    has: (v) => v != null && String(v).trim() !== "",
    detag: (v) => String(v).replace(/<[^>]*>/g, ""),
    esc: (v) => String(v == null ? "" : v).replace(/&/g, "&amp;"),
    cnNum: (i) => String(i + 1),
    mm,
    assign: Object.assign,
    groupTitle: (g, gi) => `${gi + 1}、${g.title}`,
    groupHeadHtml: (g) => `<h2>${g.title}</h2>`,
    mastheadItems: () => [],
    ansmapItems: (p, label) => Object.keys(p.answerMap || {}).map((no) => ({ role: "ansmap", header: label })),
    pushAll: (out, items) => out.push.apply(out, items),
    refLines: () => [],
    pitfallItems: () => [],
    patternItem: () => ({ role: "pattern" }),
    transferItems: () => [],
    writingSample: (g) => (g ? { role: "writing" } : null),
    scriptOf: () => "",
    ansBox: (a) => `<b>${a}</b>`,
    itemText: (role, lines, extra) => ({ role, kind: "text", lines, ...(extra || {}) }),
  };
  vm.createContext(env);
  vm.runInContext(parts + "\n; ({ answerMapOf, answerItems, itemHtml })", env);
  return env;
}

test("打印件：写作题在答案速查里显示为「见范文」", () => {
  const { answerMapOf } = loadPrintInternals();
  const map = answerMapOf(PAYLOAD);
  assert.strictEqual(map["1"], "A");
  assert.strictEqual(map["2"], "见范文", "写作题必须在答案速查表里出现");
  assert.strictEqual(map["3"], "B");
});

test("打印件：没有 answerMap 时兜底现推，同样给出「见范文」", () => {
  // 旧版导出的文件不带 answerMap，走的是 answerMapOf 的兜底分支 ——
  // 那条分支原先也漏了 writingGuide，写作题会整行消失
  const { answerMapOf } = loadPrintInternals();
  const map = answerMapOf({ paper: PAYLOAD.paper, groups: PAYLOAD.groups });
  assert.strictEqual(map["2"], "见范文");
});

test("答案册认「大题另起一页」，与另两个模式一致", () => {
  const { answerItems } = loadPrintInternals();
  const groups = (payload, o) => answerItems(payload, { o }).filter((it) => it.role === "group");
  const on = groups(PAYLOAD, { ansmap: true, groupBreak: true });
  const off = groups(PAYLOAD, { ansmap: true, groupBreak: false });

  // 回归：答案册原先不传 pageBreak，勾选对它完全无效
  assert.deepStrictEqual(on.map((it) => it.pageBreak), [false, true, true], "第二、三个大题应当另起一页");
  assert.deepStrictEqual(off.map((it) => it.pageBreak), [false, false, false], "未勾选时不得分页");
});

/* ---------------- vp-standalone.js ---------------- */

/* vp-standalone 绑 DOM 太多，整体加载跑不动。这里只抽出 deriveAnswerMap
   验它的分支覆盖 —— 它是讲台答案速查与打印派生的唯一来源。 */
test("讲台：deriveAnswerMap 覆盖写作题的「见范文」", () => {
  const src = fs.readFileSync(path.join(FRONTEND, "vp-standalone.js"), "utf8");
  const start = src.indexOf("function deriveAnswerMap() {");
  const end = src.indexOf("\n  }", start) + 4;
  assert.ok(start >= 0 && end > start, "脚本结构变了：找不到 deriveAnswerMap");

  const FLAT = [];
  PAYLOAD.groups.forEach((g) => (g.questions || []).forEach((q) => FLAT.push({ q })));
  const env = {
    FLAT,
    str: (v) => (v == null ? "" : String(v)),
    has: (v) => v != null && String(v).trim() !== "",
  };
  vm.createContext(env);
  vm.runInContext(src.slice(start, end) + "\n; deriveAnswerMap", env);

  const map = env.deriveAnswerMap();
  assert.strictEqual(map["1"], "A");
  assert.strictEqual(map["2"], "见范文", "写作题必须给出指引，而不是整行消失");
  assert.strictEqual(map["3"], "B");
});