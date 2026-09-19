/* 续写完成标记（@@CONTINUE_DONE@@）的识别用例
   运行：node frontend/tests/continue-mark.test.js

   标记由 prompts/继续生成.md 约定，前端负责识别与剥离；识别写在 index.html 加载的
   script.js 里（浏览器脚本，无法 require），所以这里从源码中抽出这几个纯函数来验。
   要守住的三件事：模型漂移的写法都得认、正文一个字都不能被误删、零新增不算产出。 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

/* 按大括号配对抽出组件方法体（`    name() { ... }` 形式） */
function extractMethod(name) {
  const start = SRC.indexOf(`    ${name}() {`);
  assert.ok(start >= 0, `未找到方法 ${name}，源码结构变了要同步这个用例`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SRC.slice(start, i + 1);
}

/* 标记的匹配式也从源码取，避免用例里另写一份而失真 */
const srcMatch = SRC.match(/^const CONTINUE_DONE_SRC = (".*");$/m);
assert.ok(srcMatch, "未找到 CONTINUE_DONE_SRC");
const CONTINUE_DONE_SRC = JSON.parse(srcMatch[1]);

const fx = { output: "", _streamBaselineLen: 0, CONTINUE_DONE_SRC };
for (const name of ["_continueProducedNew", "_stripContinueSentinel", "_continueNewText"]) {
  const code = extractMethod(name).replace(/CONTINUE_DONE_SRC/g, "this.CONTINUE_DONE_SRC");
  // eslint-disable-next-line no-new-func
  fx[name] = new Function(`return function ${code}`)();
}

const BASE = "已生成的前半段";
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

/* 装载：output = 已有正文 + 本轮新增，基线取已有正文长度 */
function load(added) {
  fx.output = BASE + added;
  fx._streamBaselineLen = BASE.length;
}

test("零新增（用户刚开跑就停）→ 不算产出，正文原样", () => {
  load("");
  assert.strictEqual(fx._continueProducedNew(), false);
  assert.strictEqual(fx._stripContinueSentinel(), false);
  assert.strictEqual(fx.output, BASE);
});

test("标准标记 → 不算产出，剥掉后正文复原", () => {
  load("@@CONTINUE_DONE@@");
  assert.strictEqual(fx._continueProducedNew(), false);
  assert.strictEqual(fx._stripContinueSentinel(), true);
  assert.strictEqual(fx.output, BASE);
});

/* 模型对定界符的写法会漂移（试卷工具的 @@TAG@@ 就吃过这个亏）：这些都得认出来 */
const DRIFTS = [
  ["换行包裹", "\n@@CONTINUE_DONE@@\n"],
  ["全角 @", "＠＠CONTINUE_DONE＠＠"],
  ["小写", "@@continue_done@@"],
  ["空格代替下划线", "@@CONTINUE DONE@@"],
  ["连字符", "@@CONTINUE-DONE@@"],
  ["裸词", "CONTINUE_DONE"],
  ["多打 @ 与空格", "@@@  CONTINUE_DONE  @@@"],
  ["代码围栏包裹", "```\n@@CONTINUE_DONE@@\n```"],
  ["括号包裹", "（@@CONTINUE_DONE@@）"],
];
for (const [label, raw] of DRIFTS) {
  test(`漂移写法（${label}）→ 认得出，且不留下残渣`, () => {
    load(raw);
    assert.strictEqual(fx._continueProducedNew(), false);
    assert.strictEqual(fx._stripContinueSentinel(), true);
    const left = fx.output.slice(BASE.length);
    assert.ok(!/[0-9A-Za-z\u4e00-\u9fff]/.test(left), `剥离后仍有残留：${JSON.stringify(left)}`);
  });
}

test("标记后面还有正文 → 算产出，只去标记", () => {
  load("@@CONTINUE_DONE@@\n## 接下去的一节");
  assert.strictEqual(fx._continueProducedNew(), true);
  assert.strictEqual(fx._stripContinueSentinel(), true);
  assert.strictEqual(fx.output, BASE + "\n## 接下去的一节");
});

test("纯新增正文（哪怕重复了上文开头）→ 算产出，一个字都不动", () => {
  const added = "已生成的前半段续写的后半段";
  load(added);
  assert.strictEqual(fx._continueProducedNew(), true);
  assert.strictEqual(fx._stripContinueSentinel(), false);
  assert.strictEqual(fx.output, BASE + added);
});

test("正文里恰好提到这个标记（讲解协议的场景）→ 照常算产出", () => {
  load("CONTINUE_DONE 是续写完成标记，下面继续正题：表格如下");
  assert.strictEqual(fx._continueProducedNew(), true);
  assert.strictEqual(fx._stripContinueSentinel(), true);
  assert.strictEqual(fx.output, BASE + "是续写完成标记，下面继续正题：表格如下");
});

test("只有空白新增 → 不算产出", () => {
  load("   \n  ");
  assert.strictEqual(fx._continueProducedNew(), false);
});

/* 指令文件与匹配式必须对得上：改了 prompts/继续生成.md 里的标记却忘了改代码，
   表现是「模型说已完整、程序把它当正文拼进文档」，而且不会有任何报错。
   这条断言就是拦这个的。 */
test("指令文件里的标记写法，前端匹配式认得出", () => {
  const promptPath = path.join(__dirname, "..", "..", "prompts", "继续生成.md");
  const prompt = fs.readFileSync(promptPath, "utf8");
  assert.ok(prompt.includes("@@CONTINUE_DONE@@"), "继续生成.md 里应写着标准写法 @@CONTINUE_DONE@@");
  const left = prompt.replace(new RegExp(CONTINUE_DONE_SRC, "gi"), "");
  assert.ok(!left.includes("CONTINUE"), "指令文件里还有匹配式认不出的标记写法");
});

let failed = 0;
for (const c of cases) {
  try {
    c.fn();
    console.log("  \u2713 " + c.name);
  } catch (e) {
    failed += 1;
    console.error("  \u2717 " + c.name);
    console.error("    " + (e && e.message ? e.message : e));
  }
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
