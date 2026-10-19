/* 撞输出上限（truncated）在前端的落地：标记、记录字段、列表角标与「继续生成」出口
   运行：node --test frontend/tests/truncation-flow.test.js

   背景：后端原先只对 OCR / 翻译发 truncated，别的工具撞上限时以 [DONE] 收尾，
   前端因此把它当完整结果——既不标「待补全」，也没有「继续生成」入口。

   守住四件事：
   1. 解析器接住 truncated 且**不把载荷当正文**拼进结果；
   2. 标记能落到记录上（partial + truncated），失败路径要把它清掉；
   3. 换工具 / 重新生成 / 切版本时标记复位，不会粘在下一份结果上；
   4. 结果区那条「可继续生成」的提示与列表角标的显隐条件写对（13 号工具不重复提示）。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* ---------------- 从源码抽取 ---------------- */

function sliceDecl(startIdx, braceIdx) {
  assert.ok(SRC[braceIdx] === "{", "抽取位置不是函数体的左花括号");
  let depth = 0;
  let i = braceIdx;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SRC.slice(startIdx, i + 1);
}

function extractMethod(name) {
  const m = new RegExp(`^    (?:async )?${name}\\(.*\\) \\{$`, "m").exec(SRC);
  assert.ok(m, `未找到方法 ${name}，源码结构变了要同步这个用例`);
  return sliceDecl(m.index, m.index + m[0].length - 1);
}

function extractFn(name) {
  const m = new RegExp(`^function ${name}\\(.*\\) \\{$`, "m").exec(SRC);
  assert.ok(m, `未找到函数 ${name}`);
  return sliceDecl(m.index, m.index + m[0].length - 1);
}

function extractConst(name) {
  const m = new RegExp(`^const ${name} = ("[^"]*"|\\d+);$`, "m").exec(SRC);
  assert.ok(m, `未找到常量 ${name}`);
  return /^\d+$/.test(m[1]) ? Number(m[1]) : JSON.parse(m[1]);
}

function bind(names, code) {
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${code})`)(...names.map((n) => BINDINGS[n]));
}

const BINDINGS = {
  HISTORY_INDEX_VERSION: extractConst("HISTORY_INDEX_VERSION"),
  historyHead: new Function("HISTORY_HEAD_CHARS", `return (${extractFn("historyHead")})`)(
    extractConst("HISTORY_HEAD_CHARS")
  ),
  historyVerCountOf: new Function(`return (${extractFn("historyVerCountOf")})`)(),
  trPairShort: new Function(`return (${extractFn("trPairShort")})`)(),
};

const historyIndexOf = new Function(
  "HISTORY_INDEX_VERSION",
  "historyHead",
  "historyVerCountOf",
  "trPairShort",
  `return (${extractFn("historyIndexOf")})`
)(
  BINDINGS.HISTORY_INDEX_VERSION,
  BINDINGS.historyHead,
  BINDINGS.historyVerCountOf,
  BINDINGS.trPairShort
);

// 方法体是对象字面量里的简写形式，包一层 function 才能当独立函数跑
const pushHistory = new Function(`return function ${extractMethod("pushHistory")}`)();

/* ---------------- 1. 索引与记录字段 ---------------- */

test("索引项带上 truncated（列表角标据此区分「待补全」与「已停止」）", () => {
  const base = { id: "h1", toolId: "1", toolName: "语篇深度分析", createdAt: 1, input: "材料" };
  assert.equal(historyIndexOf({ ...base, truncated: true }).truncated, true);
  assert.equal(historyIndexOf({ ...base, truncated: false }).truncated, false);
  assert.equal(historyIndexOf(base).truncated, false, "缺字段按 false（存量记录形状不变）");
});

test("pushHistory 把截断标记写进记录", () => {
  const captured = [];
  const ctx = {
    currentTool: { id: "1", name: "语篇深度分析", icon: "doc" },
    submittedInput: "材料",
    submittedFileName: "",
    input: "",
    output: "半篇讲解",
    selectedModel: "m1",
    outputTruncated: true,
    commitHistoryWithTitle(item) { captured.push(item); return item; },
  };
  const item = pushHistory.call(ctx, true, "m1");
  assert.equal(item.truncated, true);
  assert.equal(item.partial, true);

  ctx.outputTruncated = false;
  assert.equal(pushHistory.call(ctx, false, "m1").truncated, false, "正常完成不带标记");
});

/* ---------------- 2. 解析器接住事件 ---------------- */

test("truncated 分支置标记，且排在兜底之前（载荷不会被当成正文）", () => {
  const start = SRC.indexOf('if (ev === "truncated")');
  assert.ok(start > 0, "解析器里没有 truncated 分支");
  const branch = SRC.slice(start, start + 420);
  assert.match(branch, /this\.outputTruncated = true;/);
  assert.match(branch, /this\.trTruncated = true;/, "翻译栏读的是 trTruncated，两个标记都要置");
  assert.match(branch, /return;/, "必须 return，否则会落到兜底把 JSON 拼进正文");
  const fallback = SRC.indexOf("if (data) onToken(data);", start);
  assert.ok(fallback > start, "兜底仍在，但 truncated 分支要在它之前 return");
});

/* ---------------- 3. 收尾时落到记录上 ---------------- */

test("finalize 把截断并进 partial，并写进记录", () => {
  const body = extractMethod("finalize");
  // 新记录：partial 要 OR 上截断标记，否则重开后没有「待补全」也没有续写入口
  assert.match(body, /this\.pushHistory\(state === "stopped" \|\| this\.outputTruncated\)/);
  // 已有记录（续写 / 重试）
  assert.match(body, /origin\.partial = state === "stopped" \|\| this\.outputTruncated;/);
  assert.match(body, /origin\.truncated = this\.outputTruncated;/);
  // 整篇重来（新版本）
  assert.match(body, /partial: state === "stopped" \|\| this\.outputTruncated,/);
  // 失败路径：截断标记要清掉，别让上一次的截断挂在一条失败记录上
  assert.match(body, /origin\.partial = false;\s*\n\s*origin\.truncated = false;/);
});

test("换工具 / 重新生成 / 切版本都会复位截断标记", () => {
  // run()：新一轮生成
  assert.match(SRC, /this\.output = "";\s*\n\s*this\.rendered = "";\s*\n\s*this\.outputTruncated = false;/);
  // selectTool 的状态落位
  const apply = SRC.slice(SRC.indexOf("const apply = () => {"), SRC.indexOf("const apply = () => {") + 600);
  assert.match(apply, /this\.outputTruncated = false;/);
  // 切版本：标记属于最后一次生成，别的版本不适用
  const showVersion = extractMethod("_showVersion");
  assert.match(showVersion, /this\.outputTruncated = false;/);
});

test("打开历史记录会还原标记，且不再重复弹「已停止」", () => {
  const body = extractMethod("openHistory");
  assert.match(body, /this\.outputTruncated = !!item\.truncated && !item\.error;/);
  assert.match(
    body,
    /this\.status = this\.outputTruncated \? "history" : "stopped";/,
    "截断记录由结果区那条提示给出口，状态不能置成 stopped"
  );
});

/* ---------------- 4. 界面 ---------------- */

test("结果区给出「继续生成」出口，且 13 号工具不重复提示", () => {
  const start = HTML.indexOf("<!-- 撞输出上限");
  assert.ok(start > 0, "结果区没有截断提示");
  const block = HTML.slice(start, HTML.indexOf("<!-- 错误 -->", start));
  assert.match(block, /x-show="!streaming && outputTruncated && !isVisualPaperTool"/);
  assert.match(block, /@click="continueChat\(\)"/, "出口要接在续写入口上，不新增一条路径");
  assert.match(block, /继续生成/);
});

test("列表角标：截断记录显示「待补全」", () => {
  assert.match(
    HTML,
    /x-text="\(item\.truncated \|\| item\.toolId === '13'\) \? '待补全' : '已停止'"/,
    "角标要能把「撞上限」与「用户停止」分开"
  );
});

