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

/* lightningcss 把 `backdrop-filter` 和 `-webkit-backdrop-filter` 当成同一个属性，
   同一条规则里只保留后写的那条。源码按「标准 → 前缀」书写（前缀在后是给旧版
   Safari 的），压缩后标准属性反而整条消失；Chrome 141 起已移除 -webkit- 别名，
   于是所有玻璃面板直接失去模糊、底层正文清晰透出。这里在产物里为每条前缀声明
   补回标准属性，两个引擎各取所需。 */
function restoreStandardBackdropFilter(css) {
  return css.replace(
    /-webkit-backdrop-filter:([^;}]+)/g,
    (declaration, value) => `${declaration};backdrop-filter:${value}`
  );
}

/* 纯函数，构建与回归测试共用：同样的输入必须得到同样的产物，
   `frontend/tests/glass-blur.test.js` 用它核对提交的 styles.min.css 是否最新。 */
export function minifyStyles(code) {
  const { code: minified } = transform({
    filename: "styles.css",
    code: Buffer.isBuffer(code) ? code : Buffer.from(code),
    minify: true,
    analyzeDependencies: false,
  });
  return restoreStandardBackdropFilter(minified.toString());
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const code = readFileSync(SRC);
  const out = minifyStyles(code);
  writeFileSync(OUT, out);
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(`styles.css ${kb(code.length)}KB -> styles.min.css ${kb(Buffer.byteLength(out))}KB`);
}
