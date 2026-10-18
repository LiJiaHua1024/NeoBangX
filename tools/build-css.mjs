/* 用 lightningcss 把 frontend/styles.css 压成 frontend/styles.min.css。
   tailwind.css 那份由 `npm run build:css` 的 tailwindcss CLI 直接产出压缩版，
   这里只补手写的主题样式（styles.css 是纯手写，没有 @import / url()，因此关掉
   依赖分析，避免它去解析并不存在的资源引用）。 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "lightningcss";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend", "styles.css");
const OUT = path.join(ROOT, "frontend", "styles.min.css");

const code = readFileSync(SRC);
const { code: out } = transform({
  filename: "styles.css",
  code,
  minify: true,
  analyzeDependencies: false,
});

writeFileSync(OUT, out);
const kb = (n) => (n / 1024).toFixed(1);
console.log(`styles.css ${kb(code.length)}KB -> styles.min.css ${kb(out.length)}KB`);
