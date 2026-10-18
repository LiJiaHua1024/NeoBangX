/* 压缩产物回归：script.min.js 必须存在，且不丢源码里的任何顶层声明。

   terser 保持 mangle.toplevel / compress.toplevel 关闭，顶层声明本不该被改名或删除；
   但 HTML 里是**字符串引用**的地方（x-data="nbx()"、onload 回调、Alpine 表达式里的
   icon()）一旦被删就静默失效，浏览器端不会报错。这条测试用集合差集守住它。

   产物过期（改了源码却忘了重新构建）由 backend/tests/test_static_cache.py 的
   「版本串哈希与文件内容是否一致」负责，两者互补：一个管内容完整，一个管版本新鲜。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const MIN = fs.readFileSync(path.join(ROOT, "script.min.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const TOP_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function topLevelNames(code) {
  const names = new Set();
  for (const m of code.matchAll(TOP_RE)) names.add(m[1] || m[2]);
  return names;
}

function present(name, code) {
  return new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(code);
}

test("script.min.js 保留了源码的全部顶层声明", () => {
  const src = topLevelNames(SRC);
  assert.ok(src.size > 100, "应能从源码提取到顶层声明");
  const missing = [...src].filter((name) => !present(name, MIN));
  assert.deepEqual(missing, [], "压缩产物缺少顶层声明：" + missing.join(", "));
});

test("HTML 表达式调用的全局名字在产物里仍存在", () => {
  const exprs = [...HTML.matchAll(/(?:x-data|onload|onerror|x-html|x-text|x-show)="([^"]*)"/g)].map((m) => m[1]);
  const called = new Set();
  for (const expr of exprs) {
    for (const m of expr.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);
  }
  // 这三个由 index.html 内联脚本定义，本来就不在 script.js 里
  for (const name of ["__nbxBootMark", "__nbxBootFail", "__nbxBootPaint"]) called.delete(name);
  const missing = [...called].filter((name) => !present(name, MIN));
  assert.deepEqual(missing, [], "产物缺少 HTML 表达式调用的名字：" + missing.join(", "));
});

test("script.min.js 明显小于源码（防止误提交未压缩内容）", () => {
  assert.ok(
    MIN.length < SRC.length * 0.7,
    `产物 ${MIN.length} 字节 与源码 ${SRC.length} 字节 相比偏大，可能没有真正压缩`
  );
});
