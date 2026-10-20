/* 生成 frontend/nbx-pinyin-data.js：汉字 → 拼音（无声调）的紧凑查表。

   为什么要有这一步：历史检索要支持「输入 dingyu 也能找到定语从句」，这需要一张
   汉字到拼音的映射。运行时不能带 pinyin-pro（词典体积远大于整份检索内核），所以
   把映射压成一张只读表，随内核一起懒加载。

   编码：覆盖 U+4E00–U+9FA5 共 20902 个字，每个字一个 12 bit 的音节序号
   （音节表约 400 项，12 bit 绰绰有余），按位紧排后 base64。解码在检索内核里做
   （见 nbx-history-search.js 的 pyInit）。

   多音字只取常用读音：检索里同音容错的目标是「打错字也能搜到」，不是注音准确。
   覆盖率不足时重新执行本脚本即可，产物变化会让静态资源版本串自动失效。

   运行：npm run build:pinyin（需要 devDependency pinyin-pro）
*/
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pinyin } from "pinyin-pro";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "frontend", "nbx-pinyin-data.js");

// CJK 统一表意文字基本区。扩展区（B 以后）是生僻字，教学材料里几乎不出现。
const BASE = 0x4e00;
const END = 0x9fa5;
const COUNT = END - BASE + 1;

const syllables = [];
const sylIndex = new Map();
function sylCode(syl) {
  let idx = sylIndex.get(syl);
  if (idx === undefined) {
    idx = syllables.length;
    syllables.push(syl);
    sylIndex.set(syl, idx);
  }
  return idx;
}

const codes = new Uint16Array(COUNT);
let unknown = 0;
for (let i = 0; i < COUNT; i += 1) {
  const ch = String.fromCodePoint(BASE + i);
  let syl = "";
  try {
    // type:"array" + multiple:false 取常用读音；未知字符会原样返回汉字本身
    const out = pinyin(ch, { toneType: "none", type: "array", multiple: false });
    syl = (out && out[0]) || "";
  } catch (e) {
    syl = "";
  }
  // 只接受纯小写字母音节：把它当「未知」
  if (!/^[a-z]{1,6}$/.test(syl)) {
    unknown += 1;
    continue;
  }
  codes[i] = sylCode(syl) + 1; // 0 表示未知
}

if (syllables.length > 0xfff) throw new Error(`音节数 ${syllables.length} 超过 12 bit 上限`);

// 12 bit 位流 → base64
const bits = COUNT * 12;
const bytes = new Uint8Array(Math.ceil(bits / 8));
for (let i = 0; i < COUNT; i += 1) {
  const bit = i * 12;
  const byte = bit >> 3;
  const off = bit & 7;
  const value = codes[i];
  bytes[byte] |= (value << off) & 0xff;
  bytes[byte + 1] |= (value >>> (8 - off)) & 0xff;
  bytes[byte + 2] |= (value >>> (16 - off)) & 0xff;
}
const b64 = Buffer.from(bytes).toString("base64");

const js = `/* 汉字 → 拼音（无声调）只读表 —— **构建产物，请勿手改**。
   由 tools/gen-pinyin-data.mjs 生成（pinyin-pro），覆盖 U+${BASE.toString(16).toUpperCase()}–U+${END.toString(16).toUpperCase()} 共 ${COUNT} 个字。
   每个字一个 12 bit 的音节序号，位流 base64 编码；0 表示未知（回退为原字）。
   用法见 nbx-history-search.js 的 pyInit / pyOfChar。 */

(function (global) {
  "use strict";
  var BASE = ${BASE};
  var COUNT = ${COUNT};
  var SYL = ${JSON.stringify(syllables)};
  var CODES = "${b64}";
  var api = { BASE: BASE, COUNT: COUNT, SYL: SYL, CODES: CODES };
  global.NbxPinyinData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

writeFileSync(OUT, js, "utf8");
const kb = (Buffer.byteLength(js, "utf8") / 1024).toFixed(1);
console.log(`nbx-pinyin-data.js ${kb}KB：${syllables.length} 个音节，${COUNT - unknown} 个字有读音，${unknown} 个未知`);
