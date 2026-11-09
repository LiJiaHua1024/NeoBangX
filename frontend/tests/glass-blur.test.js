/* 液态玻璃的模糊回归测试。

   浏览器只认标准 `backdrop-filter`（Chrome 141 起移除了 -webkit- 别名），但
   lightningcss 会把成对的标准/前缀声明合并成一条，只留下后写的那条。源码按
   「标准 → 前缀」书写，压缩产物因此一度只剩前缀，所有玻璃面板在 Chrome 上
   完全没有模糊。这里同时守住源码强度、产物内容和产物新鲜度三件事。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "styles.css");
const MIN = path.join(ROOT, "styles.min.css");

test("浅色主题的玻璃模糊足以隔开底层正文", () => {
  const css = fs.readFileSync(SRC, "utf8");
  const root = css.match(/:root\s*\{[\s\S]*?\}/);
  assert.ok(root, "styles.css 里应有 :root 变量块");
  const blur = root[0].match(/--glass-blur:\s*([\d.]+)px/);
  assert.ok(blur, ":root 应声明 --glass-blur");
  assert.ok(
    Number(blur[1]) >= 10,
    `--glass-blur 只有 ${blur[1]}px：模糊太弱时浮层侧栏会像直接透出底层内容`
  );
});

test("压缩产物给每条 -webkit-backdrop-filter 补回标准属性", () => {
  const css = fs.readFileSync(MIN, "utf8");
  const prefixed = (css.match(/-webkit-backdrop-filter:/g) || []).length;
  const standard = (css.match(/(?<!-webkit-)backdrop-filter:/g) || []).length;
  assert.ok(prefixed > 0, "压缩产物应保留 -webkit-backdrop-filter 给旧版 Safari");
  assert.ok(
    standard >= prefixed,
    `标准 backdrop-filter 只有 ${standard} 条，前缀有 ${prefixed} 条；Chrome 会失去模糊`
  );

  const glass = css.match(/\.glass\{background:[^}]*\}/);
  assert.ok(glass, "压缩产物里应有主 .glass 规则");
  assert.match(glass[0], /(?:^|;)-webkit-backdrop-filter:/);
  assert.match(glass[0], /(?:^|;)backdrop-filter:/);
});

test("styles.min.css 与当前源码和构建脚本同步", async () => {
  const { minifyStyles } = await import(
    pathToFileURL(path.resolve(ROOT, "..", "tools", "build-css.mjs")).href
  );
  const source = fs.readFileSync(SRC, "utf8");
  const built = minifyStyles(source);
  assert.equal(
    built,
    fs.readFileSync(MIN, "utf8"),
    "styles.min.css 不是最新产物，请重新运行 npm run build:styles"
  );
});
