const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MAIN = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AGENT = fs.readFileSync(path.join(__dirname, "..", "agent", "index.html"), "utf8");

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
