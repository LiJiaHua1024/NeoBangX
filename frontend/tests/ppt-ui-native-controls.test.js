const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AGENT = fs.readFileSync(path.join(__dirname, "..", "agent", "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

test("PPT switch and preview use custom controls, not native inputs", () => {
  const toggle = MAIN.match(/<button type="button" class="ppt-toggle"[\s\S]*?<\/button>/);
  assert.ok(toggle, "custom PPT toggle must exist");
  assert.ok(!/<(input|select|textarea)\b/i.test(toggle[0]), "toggle must not contain native controls");

  const preview = MAIN.match(/<div class="modal-mask ppt-preview-mask"[\s\S]*?<!-- 悠空/);
  assert.ok(preview, "main-site preview modal must exist");
  assert.ok(!/<(input|select|textarea)\b/i.test(preview[0]), "preview must not contain native controls");
});

test("Agent output form uses the custom two-choice control", () => {
  assert.ok(!/<select id="output"/.test(AGENT), "old native output select must be removed");
  assert.equal((AGENT.match(/class="output-choice-btn"/g) || []).length, 2);
  assert.ok(AGENT.includes('role="radiogroup"'));
});

test("main site downloads PPTX via its own helper, not the agent module symbol", () => {
  // saveBlob 只在 agent/reader.mjs 里导出，主站脚本拿不到这个全局；
  // 曾经下载按钮必然抛 ReferenceError，下载链路整个失效。
  assert.ok(!/\bsaveBlob\b/.test(SCRIPT), "script.js must not reference the agent-only saveBlob");
  assert.ok(/downloadPpt\(item[\s\S]{0,600}this\.downloadBlob\(/.test(SCRIPT),
    "downloadPpt must save the fetched pptx through this.downloadBlob");
});

test("skipped PPT generation explains itself instead of staying silent", () => {
  // 截断/停止/失败时 PPT 不生成是既定语义，但必须告知用户，
  // 否则「开 PPT」与「关 PPT」的最终效果完全一样，无从排查。
  assert.ok(/pptReady/.test(SCRIPT), "finalize must gate PPT creation on a complete result");
  assert.ok(/结果撞到输出上限，PPT 未生成/.test(SCRIPT), "truncated skip must toast why");
  assert.ok(/至少 200 字/.test(SCRIPT), "short output must be pre-checked with an actionable message");
});
