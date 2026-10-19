/* 错误卡第二行（后端转写的「该怎么做」）在前端的落地
   运行：node --test frontend/tests/error-advice.test.js

   背景：error 事件原本只有一句 message（「生成失败，请稍后重试」）。现在后端用
   Chores 模型（或机械兜底）转写出「发生了什么 + 该怎么做」，前端要把它接住并渲染，
   同时保证复位干净——否则上一次失败的建议会粘在下一次错误卡上。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

test("解析 error 事件时读出 advice（老后端缺字段也不报错）", () => {
  const start = SRC.indexOf('if (ev === "error")');
  assert.ok(start > 0, "解析器里没有 error 分支");
  // 分支体包含注释在内约 900 字符；窗口给宽一点，避免加了字段就把断言挤出范围
  const branch = SRC.slice(start, start + 1100);
  assert.match(branch, /advice = typeof j\.advice === "string" \? j\.advice : "";/, "缺字段要回落空串");
  assert.match(branch, /Object\.assign\(new Error\(m\), \{ model, advice, code \}\)/, "advice 与 code 要随错误一起带走");
});

test("失败收尾把 advice 落到界面状态上", () => {
  const body = SRC.slice(SRC.indexOf("async _runStream("), SRC.indexOf("async _runStream(") + 6000);
  assert.match(body, /this\.errorAdvice = \(e && e\.advice\) \|\| "";/, "续写/重试的失败路径同样要带上");
});

test("两张错误卡都渲染第二行，且没有内容时不占位", () => {
  const cards = HTML.split('class="error-card"').length - 1;
  assert.ok(cards >= 2, "错误卡不止一处（通用结果区 + 试卷工具）");
  const rendered = HTML.split('x-show="errorAdvice" x-cloak x-text="errorAdvice"').length - 1;
  assert.equal(rendered, 2, "两处错误卡都要有第二行（x-show 保证空值不占位）");
});

test("explaining 事件把界面从「生成中」切走，并收起停止按钮", () => {
  // 失败已发生、后端在整理说明（最多几秒）：这段时间不能继续显示「生成中」
  assert.match(SRC, /if \(ev === "explaining"\) \{[\s\S]{0,400}?this\.explaining = true;/);
  assert.match(SRC, /if \(this\.explaining\) return "生成没有成功，正在整理说明…";/);
  assert.match(SRC, /if \(this\.explaining\) return "status-dot err";/, "状态点也要从「进行中」切成失败色");
  const stops = HTML.split('x-show="streaming && !explaining"').length - 1;
  assert.equal(stops, 3, "三处停止按钮（状态条 + 试卷工具两处）都该在整理说明时收起——已经没有东西可停了");
});

test("explaining 状态在收尾、作废、新生成时都会清掉", () => {
  const resets = SRC.split("this.explaining = false;").length - 1;
  assert.ok(resets >= 4, `复位点太少（找到 ${resets} 处）：收尾 / 试卷收尾 / 作废在途流 / 新生成`);
});

test("失败分类驱动错误卡的动作（后端发的 code 不再白发）", () => {
  assert.match(SRC, /code = typeof j\.code === "string" \? j\.code : "";/, "解析要读出 code");
  assert.match(SRC, /Object\.assign\(new Error\(m\), \{ model, advice, code \}\)/, "code 要随错误带走");
  assert.match(SRC, /this\.errorCode = \(e && e\.code\) \|\| "";/);
  assert.match(
    SRC,
    /get errorRetryPointless\(\) \{\s*\n\s*return \["context_overflow", "content_blocked", "provider_auth"\]/
  );
  assert.match(
    SRC,
    /get errorInputFixable\(\) \{\s*\n\s*return \["context_overflow", "content_blocked"\]/
  );
  // 两处错误卡（通用结果区 + 试卷工具）都要按分类收起「直接重试」、把「编辑输入」提为主按钮
  assert.equal(HTML.split("!errorLimited && !errorRetryPointless").length - 1, 2);
  assert.equal(HTML.split("errorInputFixable ? 'btn-primary' : 'btn-ghost'").length - 1, 2);
  const resets = SRC.split("this.errorCode = \"\";").length - 1;
  assert.ok(resets >= 6, `errorCode 复位点太少（找到 ${resets} 处）`);
});

test("五个入口都会复位 advice，不会粘在下一次错误上", () => {
  const resets = SRC.split("this.errorAdvice = \"\";").length - 1;
  assert.ok(resets >= 5, `复位点太少（找到 ${resets} 处）：新生成 / 切工具 / 成功收尾 / 打开历史 / 切版本`);
  // 新生成（run）与切工具（apply）这两条最关键：下一次错误卡必须是干净的
  assert.match(SRC, /this\.outputTruncated = false;\s*\n\s*this\.outputFoldEligible = false;[^\n]*\n\s*this\.errorMsg = "";\s*\n\s*this\.errorAdvice = "";/);
  assert.match(SRC, /this\.outputTruncated = false;\s*\n\s*this\.outputFoldEligible = false;[^\n]*切工具[^\n]*\n\s*this\.errorMsg = "";\s*\n\s*this\.errorAdvice = "";/);
});
