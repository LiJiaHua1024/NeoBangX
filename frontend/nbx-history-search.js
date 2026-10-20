/* NeoBangX 历史搜索：本地历史的全文检索内核
   ================================================================
   历史正文按条存在 localStorage（nbx_h:<id>），列表里只有索引项。如果每次输入都
   把整份历史读回来扫一遍，输入法还在组字、手指还没离开键盘，主线程就开始做几 MB
   的 JSON 解析与字符串匹配 —— 这不是「搜索」，是把界面拖慢。

   这里做成一个独立的纯 JS 内核（无 DOM、无 localStorage、无副作用），由 script.js
   负责喂数据。它解决三件事：

   1. 只建一次索引：正文进内存后转成规范化文本，查询只做内存扫描；后续增删改走
      增量 upsert，不重建整表。

   2. 先筛后扫：全局「双字 → 文档」倒排表。查询词的双字全部存在才可能命中，
      候选集从最短的一条 posting 起步，不再遍历全库；倒排只做「可能」判断，
      真正的命中仍由逐字段匹配确认，不会漏报。

   3. 不只全等匹配：
      - 空格分隔的多个关键词是 AND；引号内是连续短语；
      - 英文按词边界加分（word > 前缀 > 子串），大小写/全角/重音/零宽字符统一折叠；
      - 英文拼写容错（Damerau-Levenshtein，按词长限制编辑距离）；
      - 中文子序列缩写容错（「定从」可以找到「定语从句」）；
      - 长中文串允许双字覆盖率匹配（「写好英语作文」也能找到「如何写好一篇英语作文」）；
      - 拼音：`dingyu` / `dycj` 能找到「定语从句」（汉字→拼音查表在 nbx-pinyin-data.js，
        由 tools/gen-pinyin-data.mjs 生成）；中文同音字也走同一条投影，`定语丛句` 同样能命中；
      - 标题/工具名/正文/旧版本/结构化内容分字段加权，再叠加词频、整句命中与时间衰减；
      - 返回可直接渲染的高亮片段与上下文摘要，不把用户文本塞进 HTML。

   约束：单文件 IIFE，便于 node 直接 require 做用例与性能基准（见
   frontend/tests/history-search.test.js）。 */

(function (global) {
  "use strict";

  /* ---------------- 可调参数 ---------------- */


  // 宽松结果的上限：分段展示后它们不会抢走精确结果的位置，但总量仍要封顶，
  // 否则一个短中文词能靠覆盖率把整库拉成「相关结果」。
  var MAX_LOOSE_RESULTS = 60;

  var MAX_TERMS = 8;
  // 邻近查询 "a ... b" 的允许跨度（字符）：两个词在这个距离内按顺序出现才算命中。
  // 再大就退化成「同一篇里都有」，那就不是短语了。
  var PROXIMITY_WINDOW = 60;
  var MAX_TERM_CHARS = 48;
  var MAX_FIELD_CHARS = 400000;
  var MAX_RESULTS = 200;
  var MAX_VERSION_CHARS = 200000;
  var MAX_STRUCTURED_CHARS = 200000;

  // 字段权重：标题最重，其次是用户写下的输入与工具名；正文只作为内容证据。
  // snippet=true 的字段可以在命中时生成摘要行。
  var FIELD_SPECS = [
    { key: "title", weight: 14, snippet: false, label: "" },
    // 拼音投影（只由汉字生成，英文内容不会进这两个字段）：不参与严格匹配，
    // 只在宽松阶段兜底，所以权重压在正文之下。py: true 表示「不是正文」。
    { key: "pinyin", weight: 2.8, snippet: false, label: "", py: true },
    { key: "pinyinInit", weight: 2.0, snippet: false, label: "", py: true },
    { key: "toolName", weight: 7, snippet: false, label: "" },
    { key: "input", weight: 8, snippet: true, label: "输入" },
    { key: "fileName", weight: 5, snippet: true, label: "文件" },
    { key: "preview", weight: 3.2, snippet: false, label: "" },
    { key: "output", weight: 4.5, snippet: true, label: "正文" },
    { key: "structured", weight: 4, snippet: true, label: "内容" },
    { key: "version", weight: 2.2, snippet: true, label: "旧版" },
    { key: "trPair", weight: 3, snippet: false, label: "" },
    { key: "error", weight: 1.8, snippet: true, label: "错误" },
    { key: "model", weight: 1.2, snippet: false, label: "" }
  ];

  var FIELD_BY_KEY = Object.create(null);
  for (var fi = 0; fi < FIELD_SPECS.length; fi += 1) FIELD_BY_KEY[FIELD_SPECS[fi].key] = FIELD_SPECS[fi];

  var RUN_RE = /[a-z0-9]+(?:'[a-z0-9]+)*|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
  var TOKEN_RE = /[a-z0-9]+(?:'[a-z0-9]+)*/g;
  var SEP_RE = /[\s,.;:!?()\[\]{}<>/\\|"“”‘’、，。；：！？（）【】《》〈〉·…—–]/;
  var CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  var HAS_PERF = typeof performance !== "undefined" && performance && typeof performance.now === "function";

  function nowMs() {
    return HAS_PERF ? performance.now() : Date.now();
  }

  function isObj(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function textOf(value, maxChars) {
    if (value === null || value === undefined) return "";
    var text = typeof value === "string" ? value : String(value);
    if (maxChars && text.length > maxChars) text = text.slice(0, maxChars);
    return text;
  }

  /* ---------------- 归一化 ----------------
     NFKC 把全角 ASCII / 全角标点折成习惯写法；大小写与重音折叠让
     `Café`、`cafe`、`ＣＡＦＥ` 落在同一个键上。零宽字符与换行统一成空格，
     避免从 Markdown 里拷来的隐藏字符把命中切断。 */
  function fold(value, maxChars) {
    var text = textOf(value, maxChars);
    if (!text) return "";
    try {
      if (text.normalize) text = text.normalize("NFKC");
    } catch (e) { /* 老引擎没有 normalize：原样继续 */ }
    text = text.toLowerCase();
    try {
      if (text.normalize) text = text.normalize("NFD");
    } catch (e) { /* ignore */ }
    text = text.replace(/[\u0300-\u036f]/g, "");
    text = text
      .replace(/[\u2018\u2019\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201f]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/[\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, "");
    text = text.replace(/[\s\u00a0\u3000]+/g, " ");
    return text.trim();
  }

  function splitRuns(chunk) {
    var out = [];
    RUN_RE.lastIndex = 0;
    var match = RUN_RE.exec(chunk);
    while (match) {
      out.push(match[0]);
      match = RUN_RE.exec(chunk);
    }
    return out;
  }

  /* 引号里的 `...` / `…` 是邻近查询："定语 ... 从句" 要求两部分按顺序、在
     一个窗口内出现。它属于精确匹配（约束更严而不是更松），所以不走宽松阶段。 */
  function pushProximity(terms, seen, raw) {
    var chunks = fold(raw).split(/\.{2,}|…/);
    var parts = [];
    for (var i = 0; i < chunks.length; i += 1) {
      var part = chunks[i].trim();
      if (part) parts.push(part.length > MAX_TERM_CHARS ? part.slice(0, MAX_TERM_CHARS) : part);
    }
    if (parts.length < 2) {
      pushTerm(terms, seen, raw, true);
      return;
    }
    var key = "x:" + parts.join("\u0000");
    if (seen[key]) return;
    seen[key] = 1;
    terms.push({
      text: parts.join(" "),
      phrase: true,
      proximity: true,
      parts: parts,
      latin: false,
      cjk: CJK_RE.test(parts.join("")),
      pureCjk: false,
      allowLoose: false
    });
  }

  function pushTerm(terms, seen, raw, phrase) {
    var text = fold(raw).trim();
    if (!text) return;
    // 超长词只会来自粘贴的正文，截断能把它限制成一个「关键词」而不是一次全表扫描
    if (text.length > MAX_TERM_CHARS) text = text.slice(0, MAX_TERM_CHARS);
    var key = (phrase ? "p:" : "t:") + text;
    if (seen[key]) return;
    seen[key] = 1;
    terms.push({
      text: text,
      phrase: !!phrase,
      latin: /^[a-z0-9']+$/.test(text),
      cjk: CJK_RE.test(text),
      // 纯中文才允许子序列/双字覆盖：混入数字或英文的关键词（如「条目0」）
      // 必须按连续子串匹配，否则「条目10」会被「条目0」误召回。
      pureCjk: /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/.test(text),
      // 数字是精确语义（年份、题号、版本号），不做拼写容错；
      // 否则 rareid0 会模糊命中 rareid10。
      allowLoose: !phrase && text.length >= 2 && !/[0-9]/.test(text)
    });
  }

  /* 把用户输入拆成检索词：
     - `"reading comprehension"` / `“定语从句”` 是一个连续短语；
     - 普通内容按空白和标点切开，中英文混排时在文字系统边界处再切一刀；
     - 最多 8 个词，避免「把整篇作文粘进来」变成一次无意义的全表扫描。 */
  function parseQuery(query) {
    var text = textOf(query, 4000);
    if (!text) return [];
    try {
      if (text.normalize) text = text.normalize("NFKC");
    } catch (e) { /* ignore */ }
    var terms = [];
    var seen = Object.create(null);
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === '"' || ch === "“") {
        var close = text.indexOf(ch === '"' ? '"' : "”", i + 1);
        if (close > i) {
          var inner = text.slice(i + 1, close);
          if (/\.{2,}|…/.test(inner)) pushProximity(terms, seen, inner);
          else pushTerm(terms, seen, inner, true);
          i = close + 1;
          continue;
        }
      }
      var start = i;
      while (i < text.length && !SEP_RE.test(text.charAt(i))) i += 1;
      if (i === start) {
        i += 1;
        continue;
      }
      var runs = splitRuns(text.slice(start, i));
      for (var r = 0; r < runs.length; r += 1) pushTerm(terms, seen, runs[r], false);
      if (terms.length >= MAX_TERMS) break;
    }
    return terms.length > MAX_TERMS ? terms.slice(0, MAX_TERMS) : terms;
  }

  function hasLoosePotential(terms) {
    for (var i = 0; i < terms.length; i += 1) {
      var term = terms[i];
      // 短语不参与子序列/拼写容错，但仍可能靠同音字命中，所以也要跑宽松阶段
      if (!term.allowLoose) {
        if (term.phrase && term.text.length >= 2 && (term.cjk || term.latin)) return true;
        continue;
      }
      if (term.pureCjk && term.text.length >= 2) return true;
      if (term.latin && term.text.length >= 3) return true;
    }
    return false;
  }

  /* ---------------- 双字倒排 ----------------
     查询先要回答「哪些记录可能包含这些词」。旧做法是每条记录两张 Bloom 位图：
     省内存，但只能逐条问「你可能吗」，候选过滤依旧要遍历全库。
     现在改成全局倒排表：双字 → 文档 uid 列表（升序）。查询从最短的那条 posting
     起步，再用其余双字验证候选——代价随命中数走，不随库大小走。

     只索引双字：单字查询仍然全量扫（一两百条记录时比维护一张字符表便宜）。 */

  function bigramKey(a, b) {
    return (a << 16) | b;
  }

  function gramKeysOfText(text) {
    var keys = [];
    var seen = Object.create(null);
    for (var i = 0; i + 1 < text.length; i += 1) {
      var key = bigramKey(text.charCodeAt(i), text.charCodeAt(i + 1));
      if (seen[key]) continue;
      seen[key] = 1;
      keys.push(key);
    }
    return keys;
  }

  function gramKeysOfDoc(doc) {
    var out = [];
    var seen = Object.create(null);
    for (var f = 0; f < doc.fieldList.length; f += 1) {
      var field = doc.fieldList[f];
      var keys = gramKeysOfText(field.norm);
      for (var k = 0; k < keys.length; k += 1) {
        if (seen[keys[k]]) continue;
        seen[keys[k]] = 1;
        out.push(keys[k]);
      }
    }
    return out;
  }

  function termGramKeys(term) {
    if (term.gramKeys) return term.gramKeys;
    term.gramKeys = term.text.length >= 2 ? gramKeysOfText(term.text) : [];
    return term.gramKeys;
  }

  /* ---------------- 字段与结构化内容 ---------------- */

  function flattenText(value, parts, budget) {
    if (budget.left <= 0 || value === null || value === undefined) return;
    if (typeof value === "string") {
      var text = value.length > budget.left ? value.slice(0, budget.left) : value;
      if (text) parts.push(text);
      budget.left -= text.length;
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length && budget.left > 0; i += 1) flattenText(value[i], parts, budget);
      return;
    }
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      // versions 有独立字段与权重，避免重复计入
      if (key === "versions") continue;
      flattenText(value[key], parts, budget);
    }
  }

  function structuredText(src) {
    var parts = [];
    var budget = { left: MAX_STRUCTURED_CHARS };
    flattenText(src && src.migration, parts, budget);
    flattenText(src && src.visualPaper, parts, budget);
    flattenText(src && src.ocr, parts, budget);
    return parts.join("\n");
  }

  function versionsText(src, budgetChars) {
    if (!src || !Array.isArray(src.versions) || !src.versions.length) return "";
    var parts = [];
    var left = budgetChars;
    for (var i = 0; i < src.versions.length && left > 0; i += 1) {
      var version = src.versions[i];
      if (!version || typeof version.output !== "string" || !version.output) continue;
      var text = version.output.length > left ? version.output.slice(0, left) : version.output;
      parts.push(text);
      left -= text.length;
    }
    return parts.join("\n");
  }

  function fieldMeta(key) {
    return FIELD_BY_KEY[key] || { key: key, weight: 1, snippet: false, label: "" };
  }

  /* ---------------- 拼音表 ----------------
     运行时不带 pinyin-pro：汉字→拼音是一张只读表（构建产物），这里只负责解码与
     查询。表加载失败（老浏览器、静态资源缺失）时全部拼音能力静默关闭，
     检索退回纯文本 —— 拼音是增强，不能成为搜索能不能用的前提。 */
  var PY_TABLE = null;
  var PY_TRIED = false;

  function pyBase64(text) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lookup = pyBase64.lookup;
    if (!lookup) {
      lookup = pyBase64.lookup = new Int16Array(128);
      for (var k = 0; k < lookup.length; k += 1) lookup[k] = -1;
      for (var a = 0; a < alphabet.length; a += 1) lookup[alphabet.charCodeAt(a)] = a;
    }
    var out = [];
    var buf = 0;
    var bits = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      var value = code < 128 ? lookup[code] : -1;
      if (value < 0) continue;
      buf = (buf << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >>> bits) & 0xff);
      }
    }
    return out;
  }

  function pyLoad() {
    if (PY_TRIED) return PY_TABLE;
    PY_TRIED = true;
    var raw = null;
    try {
      if (typeof require === "function" && typeof module !== "undefined" && module.exports) {
        raw = require("./nbx-pinyin-data.js");
      }
    } catch (e) { /* 浏览器里没有 require */ }
    if (!raw && typeof globalThis !== "undefined") raw = globalThis.NbxPinyinData || null;
    if (!raw || !raw.SYL || !raw.CODES || !raw.COUNT) return (PY_TABLE = null);
    var bytes = pyBase64(raw.CODES);
    var codes = new Uint32Array(raw.COUNT);
    for (var i = 0; i < raw.COUNT; i += 1) {
      var bit = i * 12;
      var from = bit >> 3;
      var off = bit & 7;
      var packed = (bytes[from] || 0) | ((bytes[from + 1] || 0) << 8) | ((bytes[from + 2] || 0) << 16);
      codes[i] = (packed >>> off) & 0xfff;
    }
    PY_TABLE = { base: raw.BASE, count: raw.COUNT, syl: raw.SYL, codes: codes };
    return PY_TABLE;
  }

  function pyOfChar(ch) {
    var table = pyLoad();
    if (!table) return "";
    var index = ch.charCodeAt(0) - table.base;
    if (index < 0 || index >= table.count) return "";
    var code = table.codes[index];
    return code ? table.syl[code - 1] : "";
  }

  /* 只把汉字换成拼音、其余字符全部丢掉：英文内容不会污染投影，
     也不会因为原文里的空格/标点把「ding|yu」切成两段。 */
  function pyOfText(text) {
    if (!text) return "";
    var table = pyLoad();
    if (!table) return "";
    var out = "";
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (syl) out += syl;
    }
    return out;
  }

  function pyInitials(text) {
    if (!text) return "";
    var table = pyLoad();
    if (!table) return "";
    var out = "";
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (syl) out += syl.charAt(0);
    }
    return out;
  }

  /* 近音折叠：把容易混的读音归并成同一个键。
     中文输入选错字大多是「读音相近」而不仅是「完全同音」：平翘舌（zh/ch/sh ↔ z/c/s）、
     前后鼻音（ing/en/ang ↔ in/en/an）、n↔l（部分方言）。折叠只用于最后一档兜底，
     所以它把两类读音合并后即使有额外误召回，也只会排在精确、同音结果后面。 */
  function pyFoldSyllable(syl) {
    var s = syl;
    if (s.length > 1) {
      if (s.charAt(0) === "z" && s.charAt(1) === "h") s = "z" + s.slice(2);
      else if (s.charAt(0) === "c" && s.charAt(1) === "h") s = "c" + s.slice(2);
      else if (s.charAt(0) === "s" && s.charAt(1) === "h") s = "s" + s.slice(2);
      else if (s.charAt(0) === "n") s = "l" + s.slice(1);
    }
    if (s.length > 3) s = s.replace(/ing$/, "in").replace(/eng$/, "en").replace(/ang$/, "an");
    return s;
  }

  function pyOfTextFolded(text) {
    if (!text) return "";
    var table = pyLoad();
    if (!table) return "";
    var out = "";
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (syl) out += pyFoldSyllable(syl);
    }
    return out;
  }

  /* 把拼音串上的区间映射回原文字符区间：拼音是一对多展开，只能顺序走一遍。 */
  function pyRangeOf(text, fromPy, toPy) {
    var out = 0;
    var start = -1;
    var end = -1;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (!syl) continue;
      var stop = out + syl.length;
      if (start < 0 && fromPy >= out && fromPy < stop) start = i;
      if (toPy > out && toPy <= stop) end = i + 1;
      out = stop;
    }
    if (start < 0) return null;
    if (end < 0) end = start + 1;
    return [start, end];
  }

  /* 折叠串上的区间 → 原文字符区间。折叠后的音节长度与原音节不一定相同，
     所以不能复用 pyRangeOf。 */
  function pyRangeOfFolded(text, fromPy, toPy) {
    var out = 0;
    var start = -1;
    var end = -1;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (!syl) continue;
      var stop = out + pyFoldSyllable(syl).length;
      if (start < 0 && fromPy >= out && fromPy < stop) start = i;
      if (toPy > out && toPy <= stop) end = i + 1;
      out = stop;
    }
    if (start < 0) return null;
    if (end < 0) end = start + 1;
    return [start, end];
  }

  function pyTextOfField(field) {
    if (!field) return "";
    if (field.pyText === undefined) field.pyText = pyOfText(field.norm);
    return field.pyText;
  }

  function pyFoldedOfField(field) {
    if (!field) return "";
    if (field.pyFolded === undefined) field.pyFolded = pyOfTextFolded(field.norm);
    return field.pyFolded;
  }

  /* 整条记录的折叠串：只用于判「要不要继续查」，真正定位仍回到单字段。
     懒建 + 缓存在 doc 上，用户不打近音输入就不会付出这份开销。 */
  function docPyFolded(doc) {
    if (doc.pyFoldedText !== undefined) return doc.pyFoldedText;
    var out = "";
    for (var i = 0; i < doc.fieldList.length; i += 1) {
      var field = doc.fieldList[i];
      if (field.py) continue;
      out += pyFoldedOfField(field);
    }
    doc.pyFoldedText = out;
    return out;
  }

  function pyInitialsOfField(field) {
    if (!field) return "";
    if (field.pyInit === undefined) field.pyInit = pyInitials(field.norm);
    return field.pyInit;
  }

  function addField(fields, key, value) {
    var raw = textOf(value, MAX_FIELD_CHARS).trim();
    if (!raw) return;
    var spec = fieldMeta(key);
    fields[key] = {
      key: key,
      weight: spec.weight,
      snippet: spec.snippet,
      label: spec.label,
      py: !!spec.py,
      raw: raw,
      norm: fold(raw, MAX_FIELD_CHARS),
      tokens: null
    };
  }

  function displayText(field) {
    if (!field) return "";
    var raw = field.raw;
    if (raw.length === field.norm.length) return raw;
    var lower = raw.toLowerCase();
    if (lower.length === field.norm.length) return lower;
    return field.norm;
  }

  /* ---------------- 文档 ---------------- */

  function metaSignature(item) {
    return [
      textOf(item.title),
      textOf(item.inputHead),
      textOf(item.toolName),
      textOf(item.trPair),
      textOf(item.error),
      textOf(item.model)
    ].join("\u0000");
  }

  function bodySignature(item, src) {
    var versions = src && Array.isArray(src.versions) ? src.versions.length : 0;
    return [
      Number(item.updatedAt || item.createdAt) || 0,
      textOf(src && src.input !== undefined ? src.input : item.input).length,
      textOf(src && src.output !== undefined ? src.output : item.output).length,
      versions,
      textOf(src && src.fileName !== undefined ? src.fileName : item.fileName).length
    ].join(":");
  }

  function rebuild(doc, src, hasBody) {
    var item = doc.item;
    var fields = {};
    var title = textOf(item.title).trim() || textOf(item.inputHead).trim();
    addField(fields, "title", title);
    // 标题已存在时，索引项里的 inputHead 仍值得单独检索：正文还没读回来之前，
    // 用户输入的开头往往是最有辨识度的内容。
    if (textOf(item.title).trim()) addField(fields, "preview", item.inputHead);
    addField(fields, "toolName", item.toolName);
    addField(fields, "trPair", item.trPair);
    addField(fields, "error", item.error);
    addField(fields, "model", item.model);

    if (hasBody) {
      var body = isObj(src) ? src : {};
      addField(fields, "input", body.input !== undefined ? body.input : item.input);
      addField(fields, "fileName", body.fileName !== undefined ? body.fileName : item.fileName);
      addField(fields, "output", body.output !== undefined ? body.output : item.output);
      addField(fields, "structured", structuredText(body));
      addField(fields, "version", versionsText(body, MAX_VERSION_CHARS));
    }

    var list = [];
    var totalChars = 0;
    // 先把原始字段收集成表：拼音投影要从它们身上生成
    for (var sk in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, sk)) continue;
      list.push(fields[sk]);
    }
    // 拼音投影进字段表：这样倒排与非严格匹配都自动覆盖它，不需要另建一套索引。
    // 只由汉字生成，纯英文记录不会多出一份重复文本。
    var pyText = "";
    var pyInit = "";
    for (var pf = 0; pf < list.length; pf += 1) {
      pyText += pyTextOfField(list[pf]);
      pyInit += pyInitialsOfField(list[pf]);
      if (pyText.length > MAX_FIELD_CHARS) break;
    }
    if (pyText) addField(fields, "pinyin", pyText);
    if (pyInit) addField(fields, "pinyinInit", pyInit);

    list = [];
    totalChars = 0;
    for (var key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      var field = fields[key];
      list.push(field);
      totalChars += field.norm.length;
    }
    doc.fields = fields;
    doc.fieldList = list;
    doc.textChars = totalChars;
    doc.hasBody = !!hasBody;
    doc.bodySig = hasBody ? bodySignature(item, src) : "";
    doc.metaSig = metaSignature(item);
    doc.queryTokens = null;
    doc.pyFoldedText = undefined;
    return doc;
  }

  function createDoc(item, uid) {
    return {
      item: item,
      uid: uid,
      fields: {},
      fieldList: [],
      textChars: 0,
      hasBody: false,
      bodySig: "",
      metaSig: "",
      queryTokens: null,
      pyFoldedText: undefined
    };
  }

  /* ---------------- 精确匹配 ---------------- */

  function isWordChar(ch) {
    if (!ch) return false;
    var code = ch.charCodeAt(0);
    return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "'";
  }

  function findExact(field, term) {
    var norm = field.norm;
    var text = term.text;
    if (!norm || !text) return null;
    var first = norm.indexOf(text);
    if (first < 0) return null;

    if (term.phrase || !term.latin) {
      var count = 1;
      var cursor = first;
      while (count < 8) {
        cursor = norm.indexOf(text, cursor + text.length);
        if (cursor < 0) break;
        count += 1;
      }
      return { start: first, end: first + text.length, count: count, word: false };
    }

    // 英文：优先找词边界上的出现位置。`indexOf` 只找子串，但排序时
    // 「完整单词」应当明显高于「某个单词中间的一段」。
    var scans = 0;
    var bestStart = -1;
    var bestWord = false;
    var occurrences = 0;
    var pos = 0;
    while (scans < 12) {
      pos = norm.indexOf(text, pos);
      if (pos < 0) break;
      scans += 1;
      occurrences += 1;
      var before = pos > 0 ? norm.charAt(pos - 1) : "";
      var after = norm.charAt(pos + text.length);
      var startBoundary = !isWordChar(before);
      var endBoundary = !isWordChar(after);
      if (startBoundary && endBoundary) {
        bestStart = pos;
        bestWord = true;
        break;
      }
      if (startBoundary && bestStart < 0) bestStart = pos;
      pos += Math.max(1, text.length);
    }
    if (bestStart < 0) bestStart = first;
    return {
      start: bestStart,
      end: bestStart + text.length,
      count: Math.max(1, occurrences),
      word: bestWord
    };
  }

  function qualityOf(field, term, hit) {
    if (term.phrase) return field.norm === term.text ? 1.65 : 1.45;
    if (field.norm === term.text) return 1.75;
    if (term.latin) {
      if (hit.word) return 1.45;
      var before = hit.start > 0 ? field.norm.charAt(hit.start - 1) : "";
      if (!isWordChar(before)) return 1.18;
      return 0.86;
    }
    return hit.start === 0 ? 1.14 : 0.92;
  }

  /* 邻近匹配：各部分按顺序出现，且整个跨度不超过 PROXIMITY_WINDOW。
     从第一个词的前几个出现位置分别试，取跨度最小的一次（最紧凑=最可能是同一句）。 */
  function proximityInField(field, term) {
    var norm = field.norm;
    var parts = term.parts;
    if (!norm || !parts || parts.length < 2) return null;
    var best = null;
    var from = 0;
    var tries = 0;
    while (tries < 8) {
      tries += 1;
      var first = norm.indexOf(parts[0], from);
      if (first < 0) break;
      var spans = [[first, first + parts[0].length]];
      var ok = true;
      var cursor = first + parts[0].length;
      for (var i = 1; i < parts.length; i += 1) {
        var pos = norm.indexOf(parts[i], cursor);
        if (pos < 0) { ok = false; break; }
        spans.push([pos, pos + parts[i].length]);
        cursor = pos + parts[i].length;
      }
      if (ok) {
        var span = spans[spans.length - 1][1] - first;
        if (span <= PROXIMITY_WINDOW && (!best || span < best.span)) {
          best = { spans: spans, span: span, start: first, end: spans[spans.length - 1][1] };
          if (span === cursor - first) break; // 已经紧邻，不可能更紧凑
        }
      }
      from = first + 1;
    }
    if (!best) return null;
    // 跨度越紧凑越可信：parts 的总长度 / 实际跨度，1 就是紧挨着
    var partChars = 0;
    for (var p = 0; p < parts.length; p += 1) partChars += parts[p].length;
    var quality = 0.9 + 0.35 * Math.min(1, partChars / best.span);
    return {
      term: term,
      field: field,
      start: best.start,
      end: best.end,
      count: 1,
      quality: quality,
      score: field.weight * quality,
      loose: false,
      positions: null,
      spans: best.spans
    };
  }

  function exactInField(field, term) {
    if (term.proximity) return proximityInField(field, term);
    var hit = findExact(field, term);
    if (!hit) return null;
    var quality = qualityOf(field, term, hit);
    return {
      term: term,
      field: field,
      start: hit.start,
      end: hit.end,
      count: hit.count,
      quality: quality,
      score: field.weight * quality * (1 + Math.min(hit.count - 1, 5) * 0.04),
      loose: false,
      positions: null
    };
  }

  function bestExact(doc, term) {
    var best = null;
    var fields = doc.fieldList;
    for (var i = 0; i < fields.length; i += 1) {
      // 拼音投影不参与严格匹配：它是「另一种写法」，不是原文命中。
      // 混进来会让 loose 标记失真，也会让权重排序凭空多出一份分数。
      if (fields[i].py) continue;
      var rec = exactInField(fields[i], term);
      if (rec && (!best || rec.score > best.score)) best = rec;
    }
    return best;
  }

  /* 标题命中时也需要正文里的上下文，不能只把标题那一行加亮。
     这里在「可做摘要」的字段里单独找一次，不改变打分用的最佳字段。 */
  function bestSnippetExact(doc, term) {
    var best = null;
    var fields = doc.fieldList;
    for (var i = 0; i < fields.length; i += 1) {
      if (!fields[i].snippet) continue;
      var rec = exactInField(fields[i], term);
      if (rec && (!best || rec.score > best.score)) best = rec;
    }
    return best;
  }

  /* ---------------- 宽松匹配 ---------------- */

  function subsequenceMatch(norm, term) {
    var text = term.text;
    if (text.length < 2 || !norm) return null;
    var firstChar = text.charAt(0);
    var start = norm.indexOf(firstChar);
    var tries = 0;
    var best = null;
    while (start >= 0 && tries < 4) {
      tries += 1;
      var pos = start;
      var positions = [start];
      var gaps = 0;
      var ok = true;
      for (var i = 1; i < text.length; i += 1) {
        var next = norm.indexOf(text.charAt(i), pos + 1);
        if (next < 0) {
          ok = false;
          break;
        }
        gaps += next - pos - 1;
        positions.push(next);
        pos = next;
      }
      if (ok) {
        var span = pos - start + 1;
        var maxGap = Math.max(3, Math.ceil(text.length / 2) + 2);
        if (span - text.length <= maxGap && (!best || span < best.span)) {
          best = { start: start, end: pos + 1, span: span, positions: positions };
          if (span === text.length) break;
        }
      }
      start = norm.indexOf(firstChar, start + 1);
    }
    return best;
  }

  function coverageMatch(norm, term) {
    var text = term.text;
    if (text.length < 4 || !norm) return null;
    var total = text.length - 1;
    var found = 0;
    var firstPos = -1;
    var lastPos = -1;
    var positions = [];
    for (var i = 0; i < total; i += 1) {
      var pos = norm.indexOf(text.substr(i, 2));
      if (pos < 0) continue;
      found += 1;
      if (firstPos < 0 || pos < firstPos) firstPos = pos;
      if (pos + 2 > lastPos) lastPos = pos + 2;
      if (positions.length < 12) positions.push(pos);
    }
    if (!total || found / total < 0.7) return null;
    return {
      start: firstPos,
      end: lastPos,
      coverage: found / total,
      positions: positions
    };
  }

  function editDistance(a, b, max) {
    var la = a.length;
    var lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    if (!la) return lb;
    if (!lb) return la;
    var row0 = new Array(lb + 1);
    var prev = new Array(lb + 1);
    var cur = new Array(lb + 1);
    for (var j = 0; j <= lb; j += 1) {
      row0[j] = j;
      prev[j] = j;
    }
    var prev2 = row0;
    for (var i = 1; i <= la; i += 1) {
      cur[0] = i;
      var rowMin = cur[0];
      for (var k = 1; k <= lb; k += 1) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        var value = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
        if (i > 1 && k > 1 && a.charAt(i - 1) === b.charAt(k - 2) && a.charAt(i - 2) === b.charAt(k - 1)) {
          value = Math.min(value, prev2[k - 2] + 1);
        }
        cur[k] = value;
        if (value < rowMin) rowMin = value;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
      cur = new Array(lb + 1);
    }
    return prev[lb];
  }

  function tokensOf(field) {
    if (field.tokens) return field.tokens;
    var tokens = [];
    var seen = Object.create(null);
    TOKEN_RE.lastIndex = 0;
    var match = TOKEN_RE.exec(field.norm);
    var count = 0;
    while (match && count < 6000) {
      if (!seen[match[0]]) {
        seen[match[0]] = 1;
        tokens.push(match[0]);
        count += 1;
      }
      match = TOKEN_RE.exec(field.norm);
    }
    field.tokens = tokens;
    return tokens;
  }

  function fuzzyToken(field, term) {
    var text = term.text;
    if (text.length < 3) return null;
    var maxDist = text.length <= 4 ? 1 : 2;
    var tokens = tokensOf(field);
    var best = null;
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (Math.abs(token.length - text.length) > maxDist) continue;
      var dist = editDistance(text, token, maxDist);
      if (dist > maxDist) continue;
      if (!best || dist < best.dist) {
        best = { token: token, dist: dist, index: i };
        if (dist === 1) break;
      }
    }
    if (!best) return null;
    var pos = field.norm.indexOf(best.token);
    if (pos < 0) return null;
    var similarity = 1 - best.dist / Math.max(text.length, best.token.length);
    return {
      start: pos,
      end: pos + best.token.length,
      similarity: similarity,
      dist: best.dist
    };
  }

  /* ---------------- 英文词干 ----------------
     英文记录里同一个词会以不同形态出现（teach / teaches / teaching / taught），
     用户记得哪个形态就敲哪个。这里只做「够用」的规则化归并，不做完整 Porter：
     多一条规则就多一分过切风险，而过切会凭空造出根本不存在的匹配。
     不规则动词只收录教学材料里常见的双 / 三态。 */
  var STEM_IRREGULAR = {
    taught: "teach", teaches: "teach", teaching: "teach",
    bought: "buy", brought: "bring", thought: "think",
    wrote: "write", written: "write", writing: "write",
    spoke: "speak", spoken: "speak",
    read: "read", learnt: "learn", learned: "learn",
    studies: "study", studied: "study", studying: "study",
    children: "child", people: "person", men: "man", women: "woman",
    went: "go", gone: "go", did: "do", done: "do", had: "have",
    made: "make", took: "take", taken: "take", came: "come",
    saw: "see", seen: "see", gave: "give", given: "give",
    knew: "know", known: "know", better: "good", best: "good",
  };

  function stemOf(word) {
    var w = word;
    if (STEM_IRREGULAR[w]) return STEM_IRREGULAR[w];
    if (w.length <= 3) return w;
    if (/[^aeiou]ies$/.test(w)) w = w.slice(0, -3) + "y";
    else if (/(ches|shes|xes|zes|sses)$/.test(w)) w = w.slice(0, -2);
    else if (/[^su]s$/.test(w)) w = w.slice(0, -1);
    if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
    else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
    else if (/est$/.test(w) && w.length > 5) w = w.slice(0, -3);
    else if (/er$/.test(w) && w.length > 4) w = w.slice(0, -2);
    if (/e$/.test(w) && w.length > 3) w = w.slice(0, -1);
    // 双写尾字母（running → runn → run）：只处理常见的几个辅音
    if (/([bdgmnprt])\1$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  /* 词干索引懒建：只有真的需要做词形兜底时才扫一遍去重后的词，
     平时（精确命中就够了）一分钱不花。 */
  function stemToken(field, term) {
    if (term.stem === undefined) term.stem = stemOf(term.text);
    var target = term.stem;
    if (!target || target.length < 3) return null;
    var index = field.stemIndex;
    if (!index) {
      index = field.stemIndex = Object.create(null);
      var tokens = tokensOf(field);
      for (var i = 0; i < tokens.length; i += 1) {
        var s = stemOf(tokens[i]);
        if (s && s.length >= 3 && !index[s]) index[s] = tokens[i];
      }
    }
    var token = index[target];
    if (!token) return null;
    var pos = field.norm.indexOf(token);
    if (pos < 0) return null;
    return { start: pos, end: pos + token.length, similarity: 0.9 };
  }

  function looseInField(field, term) {
    var sub = null;
    var cov = null;
    var fuzzy = null;
    var stem = null;
    if (term.pureCjk) {
      sub = subsequenceMatch(field.norm, term);
      if (term.text.length >= 4) cov = coverageMatch(field.norm, term);
    } else if (term.latin) {
      fuzzy = fuzzyToken(field, term);
      stem = stemToken(field, term);
    }

    var candidate = null;
    if (sub) {
      var subQuality = 0.1 + 0.5 * (term.text.length / sub.span);
      candidate = {
        start: sub.start,
        end: sub.end,
        positions: sub.positions,
        quality: subQuality,
        score: field.weight * subQuality
      };
    }
    if (cov) {
      var covQuality = 0.18 + 0.45 * cov.coverage;
      var covScore = field.weight * covQuality;
      if (!candidate || covScore > candidate.score) {
        candidate = {
          start: cov.start,
          end: cov.end,
          positions: cov.positions,
          quality: covQuality,
          score: covScore
        };
      }
    }
    if (fuzzy) {
      var fuzzyQuality = 0.22 + 0.4 * fuzzy.similarity;
      var fuzzyScore = field.weight * fuzzyQuality;
      if (!candidate || fuzzyScore > candidate.score) {
        candidate = {
          start: fuzzy.start,
          end: fuzzy.end,
          positions: null,
          quality: fuzzyQuality,
          score: fuzzyScore
        };
      }
    }
    // 词形变化比「拼错一个字母」可信得多：teaching 命中 teach 是同一词，
    // 而 grammer 命中 grammar 只是可能打错。所以词干分高于拼写容错。
    if (stem) {
      var stemQuality = 0.62 + 0.3 * stem.similarity;
      var stemScore = field.weight * stemQuality;
      if (!candidate || stemScore > candidate.score) {
        candidate = {
          start: stem.start,
          end: stem.end,
          positions: null,
          quality: stemQuality,
          score: stemScore
        };
      }
    }
    if (!candidate) return null;
    return {
      term: term,
      field: field,
      start: candidate.start,
      end: candidate.end,
      count: 1,
      quality: candidate.quality,
      score: candidate.score,
      loose: true,
      positions: candidate.positions
    };
  }

  function pyInitialRange(text, fromPy, toPy) {
    var out = 0;
    var start = -1;
    var end = -1;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) < 0x2e80) continue;
      var syl = pyOfChar(text.charAt(i));
      if (!syl) continue;
      if (start < 0 && fromPy === out) start = i;
      if (toPy === out + 1) end = i + 1;
      out += 1;
    }
    if (start < 0) return null;
    if (end < 0) end = start + 1;
    return [start, end];
  }

  /* 拼音证据：在正文里把拼音命中重新定位到汉字区间。
     命中的是「哪个字」——高亮和摘要都要回到原文，不能拿拼音串上的偏移。 */
  function pinyinEvidence(doc, needle, kind, snippetOnly) {
    var fields = doc.fieldList;
    var best = null;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.py) continue;
      if (snippetOnly && !field.snippet) continue;
      var py = kind === "pinyin" ? pyTextOfField(field)
        : (kind === "pinyinInit" ? pyInitialsOfField(field) : pyFoldedOfField(field));
      if (!py) continue;
      var pos = py.indexOf(needle);
      if (pos < 0) continue;
      var range = kind === "pinyin" ? pyRangeOf(field.norm, pos, pos + needle.length)
        : (kind === "pinyinInit" ? pyInitialRange(field.norm, pos, pos + needle.length)
          : pyRangeOfFolded(field.norm, pos, pos + needle.length));
      if (!range) continue;
      // 同一串拼音在多个字段里都可能出现（标题 + 正文）：取权重最高的那个作证据
      if (!best || field.weight > best.field.weight) best = { field: field, start: range[0], end: range[1] };
    }
    return best;
  }

  /* 拼音命中（宽松阶段才能走）：
     - 拉丁输入（dingyu / dycj）本身就是拼音串，直接在全拼/首字母投影里找；
     - 中文输入（定语丛句）先转拼音，再做同音比对——这就是汉字错别字容错。
     返回的 rec 携带原文里的字段与区间，所以标题高亮与摘要片段不用特殊处理。 */
  function pinyinInDoc(doc, term, snippetOnly) {
    var exact = "";
    if (term.cjk) {
      if (term.pyTextNorm === undefined) term.pyTextNorm = pyOfText(term.text);
      exact = term.pyTextNorm;
    } else if (term.latin) {
      exact = term.text;
    }
    if (!exact || exact.length < 2) return null;

    var kinds = [];
    var full = doc.fields.pinyin;
    if (full && full.norm.indexOf(exact) >= 0) {
      // 中文输入进这里是同音字（定语丛句 → 定语从句）；拉丁输入进这里是打拼音。
      kinds.push({ kind: "pinyin", needle: exact, quality: term.cjk ? 0.58 : 0.66 });
    }
    // 首字母只对拉丁输入有意义：中文查询没有「首字母」形态
    if (!term.cjk && doc.fields.pinyinInit && doc.fields.pinyinInit.norm.indexOf(exact) >= 0) {
      kinds.push({ kind: "pinyinInit", needle: exact, quality: 0.5 });
    }
    // 近音（平翘舌 / 前后鼻音 / n-l）垫底：它比同音宽松，只在词级容错时用，
    // 并强制排在精确与同音结果之后。短语要求精确，不走这一档。
    if (term.cjk && term.allowLoose) {
      if (term.pyFoldedNorm === undefined) term.pyFoldedNorm = pyOfTextFolded(term.text);
      var folded = term.pyFoldedNorm;
      if (folded && folded.length >= 2 && folded !== exact && docPyFolded(doc).indexOf(folded) >= 0) {
        kinds.push({ kind: "pinyinFuzzy", needle: folded, quality: 0.46 });
      }
    }

    for (var k = 0; k < kinds.length; k += 1) {
      var hit = kinds[k];
      var ev = pinyinEvidence(doc, hit.needle, hit.kind, snippetOnly);
      if (!ev) continue;
      return {
        term: term,
        field: ev.field,
        start: ev.start,
        end: ev.end,
        count: 1,
        quality: hit.quality,
        score: ev.field.weight * hit.quality,
        loose: true,
        positions: null,
        pinyin: hit.kind
      };
    }
    return null;
  }

  function bestLoose(doc, term) {
    // 短语不允许子序列/覆盖率这类宽松匹配，但同音字仍然成立：
    // 用户加引号是为了「别拆词」，不是为了「读音必须完全一样」。
    var best = null;
    if (term.allowLoose) {
      var fields = doc.fieldList;
      for (var i = 0; i < fields.length; i += 1) {
        if (fields[i].py) continue;
        var rec = looseInField(fields[i], term);
        if (rec && (!best || rec.score > best.score)) best = rec;
      }
    }
    var py = pinyinInDoc(doc, term);
    if (py && (!best || py.score > best.score)) best = py;
    return best;
  }

  function bestSnippetLoose(doc, term) {
    if (!term.allowLoose) return null;
    var best = null;
    var fields = doc.fieldList;
    for (var i = 0; i < fields.length; i += 1) {
      if (!fields[i].snippet) continue;
      var rec = looseInField(fields[i], term);
      if (rec && (!best || rec.score > best.score)) best = rec;
    }
    // 摘要证据只能从可出摘要的字段里找：拼音命中常落在标题上，
    // 但片段要从正文里取（与 titleSegments 各管一段互不干扰）。
    var py = pinyinInDoc(doc, term, true);
    if (py && (!best || py.score > best.score)) best = py;
    return best;
  }

  /* ---------------- 打分与结果 ---------------- */

  function makeMatch(doc, recs, loose) {
    var score = 0;
    var titleHits = 0;
    var fieldHits = Object.create(null);
    var fieldCount = 0;
    var anyLoose = false;
    for (var i = 0; i < recs.length; i += 1) {
      var rec = recs[i];
      score += rec.score;
      if (rec.loose) anyLoose = true;
      if (rec.field.key === "title") titleHits += 1;
      if (!fieldHits[rec.field.key]) {
        fieldHits[rec.field.key] = 1;
        fieldCount += 1;
      }
    }
    if (loose || anyLoose) score *= 0.8;
    if (titleHits) score += titleHits === recs.length ? 7 : titleHits * 1.4;
    if (fieldCount === 1 && recs.length > 1) score += 1.5;

    // 时间只做细小的破同分因素：相关内容永远高于「仅仅更新」。
    var createdAt = Number(doc.item.createdAt) || 0;
    if (createdAt > 0) {
      var ageDays = Math.max(0, Date.now() - createdAt) / 86400000;
      score += 0.9 / (1 + ageDays / 14);
    }
    return { doc: doc, recs: recs, score: score, loose: loose || anyLoose };
  }

  function mergeRanges(ranges) {
    if (!ranges.length) return ranges;
    ranges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [ranges[0]];
    for (var i = 1; i < ranges.length; i += 1) {
      var last = out[out.length - 1];
      var range = ranges[i];
      if (range[0] <= last[1]) {
        if (range[1] > last[1]) last[1] = range[1];
      } else {
        out.push(range);
      }
    }
    return out;
  }

  function cleanSegment(text) {
    return text.replace(/[\r\n\t]+/g, " ");
  }

  function segmentsFromRanges(field, ranges, start, end, prefixEllipsis, suffixEllipsis) {
    var display = displayText(field);
    if (display.length !== field.norm.length) display = field.norm;
    var clipped = [];
    for (var i = 0; i < ranges.length; i += 1) {
      var from = Math.max(start, ranges[i][0]);
      var to = Math.min(end, ranges[i][1]);
      if (to > from) clipped.push([from, to]);
    }
    clipped = mergeRanges(clipped);
    var out = [];
    if (prefixEllipsis) out.push({ t: "…", h: 0 });
    var cursor = start;
    for (var j = 0; j < clipped.length; j += 1) {
      var range = clipped[j];
      if (range[0] > cursor) {
        var plain = cleanSegment(display.slice(cursor, range[0]));
        if (plain) out.push({ t: plain, h: 0 });
      }
      var hit = cleanSegment(display.slice(range[0], range[1]));
      if (hit) out.push({ t: hit, h: 1 });
      cursor = range[1];
    }
    if (cursor < end) {
      var tail = cleanSegment(display.slice(cursor, end));
      if (tail) out.push({ t: tail, h: 0 });
    }
    if (suffixEllipsis) out.push({ t: "…", h: 0 });
    return out;
  }

  function titleSegments(field, recs) {
    if (!field) return [];
    var ranges = [];
    for (var i = 0; i < recs.length; i += 1) {
      var rec = recs[i];
      if (rec.field.key !== field.key) continue;
      if (rec.spans && rec.spans.length) {
        for (var s = 0; s < rec.spans.length; s += 1) ranges.push(rec.spans[s]);
      } else if (rec.positions && rec.positions.length) {
        for (var p = 0; p < rec.positions.length; p += 1) {
          ranges.push([rec.positions[p], rec.positions[p] + 1]);
        }
      } else {
        ranges.push([rec.start, rec.end]);
      }
    }
    if (!ranges.length) {
      var plain = cleanSegment(displayText(field));
      return plain ? [{ t: plain, h: 0 }] : [];
    }
    return segmentsFromRanges(field, ranges, 0, field.norm.length, false, false);
  }

  function snippetFor(field, recs, chosen) {
    if (!field || !field.norm) return [];
    var norm = field.norm;
    var anchorStart = chosen.start;
    var anchorEnd = chosen.end;
    if (chosen.positions && chosen.positions.length) {
      anchorStart = chosen.positions[0];
      anchorEnd = chosen.positions[chosen.positions.length - 1] + 1;
    }
    var start = Math.max(0, anchorStart - 30);
    var end = Math.min(norm.length, anchorEnd + 74);
    if (end - start < 88) end = Math.min(norm.length, start + 88);
    if (end - start < 88) start = Math.max(0, end - 88);

    // 同一条摘要里可能命中多个关键词：边界调整不能把另一个命中点切掉。
    var requiredStart = anchorStart;
    var requiredEnd = anchorEnd;
    for (var ri = 0; ri < recs.length; ri += 1) {
      var rangeRec = recs[ri];
      if (rangeRec.field.key !== field.key) continue;
      if (rangeRec.spans && rangeRec.spans.length) {
        if (rangeRec.spans[0][0] < requiredStart) requiredStart = rangeRec.spans[0][0];
        var lastSpan = rangeRec.spans[rangeRec.spans.length - 1][1];
        if (lastSpan > requiredEnd) requiredEnd = lastSpan;
      } else if (rangeRec.positions && rangeRec.positions.length) {
        if (rangeRec.positions[0] < requiredStart) requiredStart = rangeRec.positions[0];
        var lastPos = rangeRec.positions[rangeRec.positions.length - 1] + 1;
        if (lastPos > requiredEnd) requiredEnd = lastPos;
      } else {
        if (rangeRec.start < requiredStart) requiredStart = rangeRec.start;
        if (rangeRec.end > requiredEnd) requiredEnd = rangeRec.end;
      }
    }

    // 尽量从词边界开始，别让摘要第一眼是半截单词；但只在不会挤掉命中时调整。
    var space = norm.lastIndexOf(" ", requiredStart);
    if (space >= 0 && requiredStart - space < 18 && space >= start && space + 1 <= requiredStart) {
      start = space + 1;
    }
    var nextSpace = norm.indexOf(" ", requiredEnd);
    if (nextSpace >= 0 && nextSpace - requiredEnd < 18 && nextSpace <= end && nextSpace >= requiredEnd) {
      end = nextSpace;
    }

    if (start > 0 && norm.charCodeAt(start) >= 0xdc00 && norm.charCodeAt(start) <= 0xdfff) start += 1;
    if (end < norm.length && norm.charCodeAt(end - 1) >= 0xd800 && norm.charCodeAt(end - 1) <= 0xdbff) end -= 1;

    while (start < end && /\s/.test(norm.charAt(start))) start += 1;
    while (end > start && /\s/.test(norm.charAt(end - 1))) end -= 1;
    if (end <= start) return [];

    var ranges = [];
    for (var i = 0; i < recs.length; i += 1) {
      var rec = recs[i];
      if (rec.field.key !== field.key) continue;
      if (rec.spans && rec.spans.length) {
        for (var s2 = 0; s2 < rec.spans.length; s2 += 1) ranges.push(rec.spans[s2]);
      } else if (rec.positions && rec.positions.length) {
        for (var p = 0; p < rec.positions.length; p += 1) {
          ranges.push([rec.positions[p], rec.positions[p] + 1]);
        }
      } else if (rec.loose || rec.term.phrase) {
        ranges.push([rec.start, rec.end]);
      } else {
        var pos = norm.indexOf(rec.term.text, start);
        var guard = 0;
        while (pos >= 0 && pos < end && guard < 10) {
          ranges.push([pos, Math.min(end, pos + rec.term.text.length)]);
          pos = norm.indexOf(rec.term.text, pos + rec.term.text.length);
          guard += 1;
        }
      }
    }
    return segmentsFromRanges(field, ranges, start, end, start > 0, end < norm.length);
  }

  function buildView(match, terms) {
    var doc = match.doc;
    var recs = match.recs;
    var titleField = doc.fields.title || null;
    var titleRecs = [];
    for (var i = 0; i < recs.length; i += 1) {
      if (recs[i].field.key === "title") titleRecs.push(recs[i]);
    }
    var segments = titleSegments(titleField, titleRecs);

    // 每个词的「最佳字段」可能正好是标题；摘要另找一份正文证据，
    // 这样结果卡既能解释为什么命中，也能让用户在打开前看到上下文。
    var snippetRecs = recs.slice();
    for (var k = 0; k < terms.length; k += 1) {
      var term = terms[k];
      var covered = false;
      for (var c = 0; c < snippetRecs.length; c += 1) {
        if (snippetRecs[c].field.snippet && snippetRecs[c].term.text === term.text) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      var alt = bestSnippetExact(doc, term);
      if (!alt && !term.phrase) alt = bestSnippetLoose(doc, term);
      if (alt) snippetRecs.push(alt);
    }

    var chosen = null;
    var chosenScore = -1;
    for (var j = 0; j < snippetRecs.length; j += 1) {
      var rec = snippetRecs[j];
      if (!rec.field.snippet) continue;
      var score = rec.score + (rec.field.key === "input" ? 0.5 : 0);
      if (score > chosenScore) {
        chosen = rec;
        chosenScore = score;
      }
    }
    var snippet = [];
    var snippetLabel = "";
    if (chosen) {
      snippet = snippetFor(chosen.field, snippetRecs, chosen);
      snippetLabel = chosen.field.label || "";
    }
    return {
      item: doc.item,
      score: match.score,
      loose: match.loose,
      titleSegments: segments,
      snippet: snippet,
      snippetLabel: snippetLabel,
      terms: terms
    };
  }

  /* ---------------- 引擎 ---------------- */

  function create() {
    var docs = Object.create(null);
    // 双字 → 文档 uid 升序列表。uid 只在本引擎内有效，删掉的文档在 uidDocs 里置空。
    var postings = new Map();
    var uidDocs = [];
    var docVersion = 0;
    var cacheKey = null;
    var cacheVersion = -1;
    var cacheResult = null;

    function bump() {
      docVersion += 1;
      cacheKey = null;
      cacheResult = null;
    }

    function newDoc(item) {
      var uid = uidDocs.length;
      var doc = createDoc(item, uid);
      uidDocs.push(doc);
      return doc;
    }

    function postingAdd(key, uid) {
      var list = postings.get(key);
      if (!list) {
        postings.set(key, [uid]);
        return;
      }
      var lo = 0;
      var hi = list.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (list[mid] === uid) return;
        if (list[mid] < uid) lo = mid + 1;
        else hi = mid - 1;
      }
      list.splice(lo, 0, uid);
    }

    function postingHas(key, uid) {
      var list = postings.get(key);
      if (!list) return false;
      var lo = 0;
      var hi = list.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (list[mid] === uid) return true;
        if (list[mid] < uid) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    }

    function postingRemove(key, uid) {
      var list = postings.get(key);
      if (!list) return;
      var lo = 0;
      var hi = list.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (list[mid] === uid) {
          list.splice(mid, 1);
          if (!list.length) postings.delete(key);
          return;
        }
        if (list[mid] < uid) lo = mid + 1;
        else hi = mid - 1;
      }
    }

    function addGrams(doc) {
      var keys = gramKeysOfDoc(doc);
      for (var i = 0; i < keys.length; i += 1) postingAdd(keys[i], doc.uid);
    }

    function dropGrams(doc) {
      // 旧字段还在时算一遍旧键：不把键留在内存里（每条记录几千个）
      var keys = gramKeysOfDoc(doc);
      for (var i = 0; i < keys.length; i += 1) postingRemove(keys[i], doc.uid);
    }

    /* 重建文档的统一入口：先摘掉旧的双字，再重建字段，最后登记新双字。
       直接调 rebuild 会留下旧词条，变成「幽灵命中」。 */
    function rebuildDoc(doc, src, hasBody) {
      dropGrams(doc);
      rebuild(doc, src, hasBody);
      addGrams(doc);
    }

    function candidatesFor(terms) {
      var base = null;
      for (var t = 0; t < terms.length; t += 1) {
        var keys = termGramKeys(terms[t]);
        for (var k = 0; k < keys.length; k += 1) {
          var list = postings.get(keys[k]);
          if (!list) return [];
          if (!base || list.length < base.length) base = list;
        }
      }
      if (!base) return null; // 单字查询：交给上层全量扫
      var out = [];
      for (var i = 0; i < base.length; i += 1) {
        var uid = base[i];
        var doc = uidDocs[uid];
        if (!doc) continue;
        var ok = true;
        for (var t2 = 0; t2 < terms.length && ok; t2 += 1) {
          var ks = termGramKeys(terms[t2]);
          for (var k2 = 0; k2 < ks.length; k2 += 1) {
            if (!postingHas(ks[k2], uid)) { ok = false; break; }
          }
        }
        if (ok) out.push(doc);
      }
      return out;
    }

    function hydrate(item, body) {
      if (!item || !item.id) return null;
      var id = String(item.id);
      var doc = docs[id] || (docs[id] = newDoc(item));
      doc.item = item;
      var src = body;
      var hasBody = false;
      if (isObj(src)) {
        hasBody = true;
      } else if (body === undefined && item._bodyLoaded && item.input !== undefined) {
        src = item;
        hasBody = true;
      }
      if (!hasBody) return null;
      rebuildDoc(doc, src, true);
      bump();
      return doc;
    }

    function markMissing(id) {
      var doc = docs[String(id)];
      if (!doc) return null;
      doc.hasBody = true;
      doc.bodySig = "";
      doc.queryTokens = null;
      bump();
      return doc;
    }

    function remove(id) {
      var key = String(id);
      if (!docs[key]) return false;
      dropGrams(docs[key]);
      uidDocs[docs[key].uid] = null;
      delete docs[key];
      bump();
      return true;
    }

    function clear() {
      docs = Object.create(null);
      postings = new Map();
      uidDocs = [];
      bump();
    }

    function sync(items) {
      var seen = Object.create(null);
      var pending = [];
      var pendingSeen = Object.create(null);
      var list = Array.isArray(items) ? items : [];
      for (var i = 0; i < list.length; i += 1) {
        var item = list[i];
        if (!item || !item.id) continue;
        var id = String(item.id);
        if (seen[id]) continue;
        seen[id] = 1;
        var doc = docs[id];
        var bodyReady = item.input !== undefined;
        if (!doc) {
          doc = docs[id] = newDoc(item);
          if (bodyReady) rebuildDoc(doc, item, true);
          else rebuildDoc(doc, null, false);
          bump();
        } else {
          doc.item = item;
          var metaChanged = metaSignature(item) !== doc.metaSig;
          if (bodyReady) {
            var sig = bodySignature(item, item);
            if (!doc.hasBody || sig !== doc.bodySig) {
              rebuildDoc(doc, item, true);
              bump();
            } else if (metaChanged) {
              rebuildDoc(doc, item, true);
              bump();
            }
          } else if (metaChanged && doc.hasBody) {
            // 索引项改了标题/工具名，但正文不在手上：先退回元数据检索，
            // 正文由后台重新读取（不拿旧正文配上新标题继续搜）。
            rebuildDoc(doc, null, false);
            bump();
          } else if (metaChanged) {
            rebuildDoc(doc, null, false);
            bump();
          }
        }
        if (!doc.hasBody && !pendingSeen[id]) {
          pendingSeen[id] = 1;
          pending.push(item);
        }
      }

      var removed = false;
      for (var key in docs) {
        if (!Object.prototype.hasOwnProperty.call(docs, key)) continue;
        if (!seen[key]) {
          dropGrams(docs[key]);
          uidDocs[docs[key].uid] = null;
          delete docs[key];
          removed = true;
        }
      }
      if (removed) bump();
      return pending;
    }

    function invalidateBodies() {
      for (var key in docs) {
        if (!Object.prototype.hasOwnProperty.call(docs, key)) continue;
        var doc = docs[key];
        // 正文可能已被对端改写：这里无条件退回元数据，等 sync / 后台分片重新读；
        // 不能拿旧的内存正文续上（否则镜像同步后搜索还在用旧内容）。
        rebuildDoc(doc, null, false);
      }
      bump();
      return pending();
    }

    function pending() {
      var out = [];
      for (var key in docs) {
        if (!Object.prototype.hasOwnProperty.call(docs, key)) continue;
        if (!docs[key].hasBody) out.push(docs[key].item);
      }
      return out;
    }

    function nextPending() {
      for (var key in docs) {
        if (!Object.prototype.hasOwnProperty.call(docs, key)) continue;
        if (!docs[key].hasBody) return docs[key].item;
      }
      return null;
    }

    function stats() {
      var bodies = 0;
      var total = 0;
      for (var key in docs) {
        if (!Object.prototype.hasOwnProperty.call(docs, key)) continue;
        total += 1;
        if (docs[key].hasBody) bodies += 1;
      }
      return { docs: total, bodies: bodies, pending: total - bodies, version: docVersion };
    }

    function query(input, options) {
      var key = textOf(input, 4000);
      if (cacheKey === key && cacheVersion === docVersion) return cacheResult;
      var terms = parseQuery(key);
      var started = nowMs();
      var exactMatches = [];
      var looseMatches = [];
      var matched = Object.create(null);
      var limit = options && options.limit ? Math.max(1, Math.min(MAX_RESULTS, options.limit | 0)) : MAX_RESULTS;

      if (terms.length) {
        // 精确阶段只需要看倒排表给出的候选；单字查询没有双字可查，退回全库扫。
        var candidates = candidatesFor(terms);
        if (!candidates) {
          candidates = [];
          for (var allId in docs) {
            if (!Object.prototype.hasOwnProperty.call(docs, allId)) continue;
            candidates.push(docs[allId]);
          }
        }
        for (var ci = 0; ci < candidates.length; ci += 1) {
          var doc = candidates[ci];
          var recs = [];
          var ok = true;
          for (var t = 0; t < terms.length; t += 1) {
            var rec = bestExact(doc, terms[t]);
            if (!rec) {
              ok = false;
              break;
            }
            recs.push(rec);
          }
          if (!ok) continue;
          matched[doc.uid] = 1;
          exactMatches.push(makeMatch(doc, recs, false));
        }

        // 宽松匹配不再看「精确结果够不够多」。用条数决定召回会让同一句话时灵时不灵：
        // 库里恰好有 12 条精确命中时，拼错的那个词就永远搜不到。现在两档都跑，
        // 结果按「精确 / 相关」分组展示，低置信结果不会抢精确结果的位置。
        if (hasLoosePotential(terms)) {
          for (var looseId in docs) {
            if (!Object.prototype.hasOwnProperty.call(docs, looseId)) continue;
            var looseDoc = docs[looseId];
            // 精确阶段已经命中的记录不再重复入场
            if (matched[looseDoc.uid]) continue;
            var looseRecs = [];
            var looseOk = true;
            for (var lt = 0; lt < terms.length; lt += 1) {
              var term = terms[lt];
              var exact = bestExact(looseDoc, term);
              var loose = exact || bestLoose(looseDoc, term);
              if (!loose) {
                looseOk = false;
                break;
              }
              looseRecs.push(loose);
            }
            if (looseOk) looseMatches.push(makeMatch(looseDoc, looseRecs, true));
          }
        }
      }

      var byScore = function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var ac = Number(a.doc.item.createdAt) || 0;
        var bc = Number(b.doc.item.createdAt) || 0;
        if (bc !== ac) return bc - ac;
        return String(a.doc.item.id).localeCompare(String(b.doc.item.id));
      };
      exactMatches.sort(byScore);
      looseMatches.sort(byScore);

      // 精确结果先占名额，剩下的才分给相关结果（最多 MAX_LOOSE_RESULTS 条）。
      var exactShown = exactMatches.length > limit ? exactMatches.slice(0, limit) : exactMatches;
      var room = Math.min(limit - exactShown.length, MAX_LOOSE_RESULTS);
      var looseShown = room > 0
        ? (looseMatches.length > room ? looseMatches.slice(0, room) : looseMatches)
        : [];
      var shown = exactShown.concat(looseShown);
      var results = new Array(shown.length);
      for (var i = 0; i < shown.length; i += 1) results[i] = buildView(shown[i], terms);
      var out = {
        query: key,
        terms: terms,
        results: results,
        total: exactMatches.length + looseMatches.length,
        // exactCount 是「结果列表里精确条目的条数」：界面靠它插入分组分隔线
        exact: exactMatches.length,
        exactCount: exactShown.length,
        looseTotal: looseMatches.length,
        docs: stats().docs,
        bodies: stats().bodies,
        loose: shown.length ? !!shown[0].loose : false,
        durationMs: Math.max(0, nowMs() - started)
      };
      cacheKey = key;
      cacheVersion = docVersion;
      cacheResult = out;
      return out;
    }

    return {
      sync: sync,
      hydrate: hydrate,
      upsert: hydrate,
      markMissing: markMissing,
      remove: remove,
      clear: clear,
      invalidateBodies: invalidateBodies,
      pending: pending,
      nextPending: nextPending,
      stats: stats,
      query: query
    };
  }

  var api = {
    create: create,
    parseQuery: parseQuery,
    fold: fold,
    editDistance: editDistance
  };

  global.NbxHistorySearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
