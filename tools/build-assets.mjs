/* 给 frontend/index.html 里的本地静态资源引用加内容哈希版本串（?v=<sha256 前 10 位>）。

   为什么要自动生成而不是手写版本号：带 query 的 /static/** 会被后端中间件下发
   immutable 长缓存（见 app/middleware.py 的 _cache_control），好处是浏览器与
   Cloudflare 边缘都能长期复用、不再回源验证；坏处是「改了文件忘了改版本号」时
   浏览器会一直用旧代码。把版本号交给构建脚本按文件内容算，就不存在忘改的问题：
   内容没变哈希不变（缓存继续命中），内容一变 URL 就变（自动失效）。

   只处理 href= / src= 属性里的 /static/ 引用，注释里出现的裸路径不受影响。
   幂等：重复执行结果一致（先剥掉旧版本串再按当前内容重算）。 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_ROOT = path.join(ROOT, "frontend");
const PAGES = ["frontend/index.html"];

const ATTR_RE = /((?:href|src)=")(\/static\/[^"]+)(")/g;
const cache = new Map();

function hashed(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const file = path.join(STATIC_ROOT, ...relPath.split("/"));
  let result = null;
  if (existsSync(file)) {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
    result = digest;
  }
  cache.set(relPath, result);
  return result;
}

for (const page of PAGES) {
  const pagePath = path.join(ROOT, ...page.split("/"));
  const html = readFileSync(pagePath, "utf8");
  const missing = new Set();
  let changed = 0;

  const next = html.replace(ATTR_RE, (whole, pre, url, post) => {
    const clean = url.split("?")[0];
    const digest = hashed(clean.slice("/static/".length));
    if (!digest) {
      missing.add(clean);
      return whole;
    }
    const stamped = `${clean}?v=${digest}`;
    if (url !== stamped) changed += 1;
    return pre + stamped + post;
  });

  if (next !== html) writeFileSync(pagePath, next, "utf8");
  console.log(`${page}: ${changed} 处引用更新${missing.size ? `，跳过不存在的 ${[...missing].join(", ")}` : ""}`);
}
