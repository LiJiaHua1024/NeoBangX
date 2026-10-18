/* 用 terser 把 frontend/script.js 压成 frontend/script.min.js。
   源码保留可读版本、产物单独一份：index.html 引用 .min 版，排障与回滚都不受影响
   （与 tailwind.css 由 CLI 生成同属「构建产物进仓库」的既有做法）。

   mangle.toplevel 必须保持关闭：script.js 是经典脚本，顶层声明（nbx / icon /
   NBX_ASSET_URLS / THEMES …）直接挂在全局作用域上，Alpine 的 x-data="nbx()"、
   nbx-versions.js 等模块与 frontend/tests 都要按名字取用。 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { minify } from "terser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend", "script.js");
const OUT = path.join(ROOT, "frontend", "script.min.js");

const code = readFileSync(SRC, "utf8");
const result = await minify(code, {
  compress: { passes: 2, drop_debugger: true },
  mangle: { toplevel: false },
  format: { comments: false },
});
if (!result.code) throw new Error("terser 未输出内容，构建中止");

writeFileSync(OUT, result.code, "utf8");
const kb = (s) => (Buffer.byteLength(s, "utf8") / 1024).toFixed(1);
console.log(`script.js ${kb(code)}KB -> script.min.js ${kb(result.code)}KB`);
