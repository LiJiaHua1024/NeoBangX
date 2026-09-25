/* NeoBangX 线路镜像：数据格式、校验与合并规则
   ================================================================
   背景：同一套应用由两个 hostname 提供（www 主线路 / cf 备用线路，互为灾备）。
   浏览器按 origin 隔离 localStorage，两个 hostname 天然各存一份历史与收藏。
   本文件提供「把两份独立数据正确合并成一份」的全部纯逻辑，供两条路径复用：

   1. 手动导出 / 导入 JSON 文件（用户主动搬运、备份、换设备）
   2. 线路镜像（隐藏同站 iframe + postMessage，两个 origin 互相补齐）

   两条路径的数据格式与合并规则完全一致，镜像只是把「用户手动传文件」换成
   「写进对端 origin 的 localStorage」，因此这里不涉及任何传输细节。

   设计要点：
   - 纯函数、无 DOM、无副作用、不碰 localStorage：可直接用 node 跑用例验证。
   - 不信任任何外来数据。导出文件可能被手工编辑，镜像数据来自另一个页面，
     两者都按「不可信输入」处理：字段白名单 + 长度/体积上限 + 形状校验。
   - 删除需要墓碑（tombstone）。合并是集合求并，若只记「谁有什么」，
     一端删掉的记录会被另一端的旧副本原样带回来（用户刚删的历史自己复活）。
     所以删除必须记成带时间戳的墓碑并一起同步，合并时墓碑比内容新则判死。
   - 冲突按条目粒度后来者胜（LWW），不引入 CRDT：同一 id 取 updatedAt 更新的
     那一版。updatedAt 缺失时回退 createdAt（兼容镜像上线前的存量数据）。 */

(function (global) {
  "use strict";

  // 数据格式版本：字段语义或合并规则变化时递增，旧版本一律拒绝导入（宁可拒绝，不猜）。
  // 例外：新增「可选」字段不必递增 —— 见 buildEnvelope 里 prefs 只在非空时输出的说明。
  // 递增版本的代价是用户手里已有的备份全部变砖，所以这条路只在语义不兼容时才走。
  var MIRROR_VERSION = 1;

  // 条目数量上限，与 script.js 的 HISTORY_LIMIT / FAVORITES_LIMIT 保持一致。
  // 这里再兜一层是为了防外来数据（导出文件可能被改过、对端可能版本不同）绕过应用侧限制，
  // 否则对端能把本地配额塞满，触发 _evictOldestUntil 静默淘汰掉本地更旧的历史。
  var DEFAULT_LIMITS = { history: 100, favorites: 100 };

  // 单条正文体积上限（按字符数计）。正常一条记录远小于此；迁移/试卷快照虽大也不该破 2M 字符。
  // 注意单位是字符不是 UTF-8 字节：截断按 charLength 进行，纯中文正文的上限字节数
  // 约为字符数的 3 倍。真正的总闸由 MAX_ENVELOPE_BYTES 兜底。
  var MAX_ITEM_BYTES = 2 * 1024 * 1024;

  // 整个 envelope 的体积上限，防超大文件把内存/存储打爆
  var MAX_ENVELOPE_BYTES = 64 * 1024 * 1024;

  // 回答版本数组（versions）的上限，与 nbx-versions.js 的 LIMIT / TOTAL_CHARS 同口径。
  // 这里刻意宽一档：镜像层永远不该比应用层删得更狠，否则一份应用允许的记录会在
  // 跨线路时被削掉一版。两处需同步修改。
  var VERSION_LIMIT = 8;
  var VERSION_TOTAL_CHARS = 1200 * 1000;

  // 字段长度上限：只约束有明确语义的短字段，正文类字段由体积上限兜
  var MAX_FIELD = {
    title: 512,
    error: 2000,
    inputHead: 200,
    model: 128,
    toolName: 128,
    icon: 64,
    toolId: 32,
    fileName: 256,
    id: 64,
    titleJobId: 96,
    titleContentKey: 16,
    titlePayloadHash: 64,
  };

  // 墓碑保留策略：只按数量裁剪，不过期。早年设过 90 天过期，代价是「过期后
  // 对端旧副本 / 多年前的旧备份会把已删除的条目带回来」——删除意图不该有保质期。
  // 1000 条上限已把体积钉死在几十 KB，正常使用自然轮换，不会无限增长。
  var TOMBSTONE_MAX_COUNT = 1000;

  /* 偏好（主题 / 选中模型）的键白名单与值长上限，必须与 nbx-mirror-store.js 的
     PREF_KEYS / PREF_VAL_CAP 一致：两处各管一段（那边管存储与镜像，这边管
     envelope 与合并），不一致会让同一条数据在一处合法、在另一处被悄悄丢掉。 */
  var PREF_KEYS = { theme: 1, model: 1 };
  var PREF_VAL_CAP = 128;

  /* ---------------- 基础工具 ---------------- */

  function utf8Bytes(str) {
    try {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    } catch (e) { /* 退化到下面的估算 */ }
    // 无 TextEncoder（极老环境 / 部分测试环境）：按 UTF-8 编码规则估算，只用于限额判断
    var n = 0;
    for (var i = 0; i < str.length; i += 1) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
      else n += 3;
    }
    return n;
  }

  /* 与 utf8Bytes 同一套编码规则，但产出字节数组（供 SHA-256 使用）。
     不依赖 crypto.subtle：内网 http（非安全上下文）下它不存在，而导出/导入必须可用。 */
  function utf8BytesArray(str) {
    if (typeof TextEncoder !== "undefined") {
      try { return new TextEncoder().encode(str); } catch (e) { /* 退化 */ }
    }
    var out = [];
    for (var i = 0; i < str.length; i += 1) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i += 1;
        } else {
          out.push(0xef, 0xbf, 0xbd); // 半个代理对 → U+FFFD
        }
      }
      else if (c >= 0xdc00 && c <= 0xdfff) out.push(0xef, 0xbf, 0xbd);
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  /* 纯 JS SHA-256（FIPS 180-4）。选纯 JS 而不用 crypto.subtle 的原因：
     内网 http 部署（http://192.168.x.x）不是安全上下文，subtle 不存在；
     而自实现只需几十行，性能对 ≤64MB 的 envelope 绰绰有余。
     测试用例拿 node:crypto 的实现对拍已知向量。 */
  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function sha256Hex(message) {
    // TextEncoder 给的是 Uint8Array（无 push），统一转成普通数组
    var bytes = Array.prototype.slice.call(utf8BytesArray(String(message)));
    var bitLenHi = Math.floor(bytes.length / 0x20000000);
    var bitLenLo = (bytes.length << 3) >>> 0;
    var buf = bytes.slice();
    buf.push(0x80);
    while (buf.length % 64 !== 56) buf.push(0);
    buf.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff);
    buf.push((bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Array(64);
    var rotr = function (x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; };

    for (var off = 0; off < buf.length; off += 64) {
      for (var t = 0; t < 16; t += 1) {
        var j = off + t * 4;
        w[t] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
      }
      for (var i = 16; i < 64; i += 1) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
        var s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (var r = 0; r < 64; r += 1) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + SHA256_K[r] + w[r]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    var hex = function (n) { return ("00000000" + n.toString(16)).slice(-8); };
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function str(v, cap) {
    if (v === null || v === undefined) return "";
    var s = typeof v === "string" ? v : String(v);
    return cap && s.length > cap ? s.slice(0, cap) : s;
  }

  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /* 条目的「最后修改时间」：合并取新的唯一依据。
     updatedAt 是镜像上线后新增的字段，存量数据没有，回退 createdAt。
     两者都缺失时返回 0，等于「永远最旧」，外来条目会覆盖它——这也是我们想要的：
     没有时间戳的本地条目无法证明自己更新。 */
  function updatedAtOf(item) {
    if (!isPlainObject(item)) return 0;
    var u = num(item.updatedAt, 0);
    if (u > 0) return u;
    return num(item.createdAt, 0);
  }

  /* 深拷贝一段不透明的 JSON 数据（migration / visualPaper 这类快照）。
     刻意不做内部字段白名单：这些快照的结构由业务侧演进，镜像层不认识它，
     只负责原样搬运；擅自裁剪会在未来加字段时静默丢数据。 */
  function cloneOpaque(v) {
    if (v === null || v === undefined) return null;
    try {
      var s = JSON.stringify(v);
      if (typeof s !== "string") return null;
      if (utf8Bytes(s) > MAX_ITEM_BYTES) return null;
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  /* ---------------- 形状归一 ---------------- */

  /* id 只接受字符串与数字：对象会被 String() 成 "[object Object]" 这种合法 id */
  function validId(v) {
    return typeof v === "string" || typeof v === "number";
  }

  /* 索引项：列表渲染与路由需要的轻量元数据。
     已知字段显式裁剪；未知字段只透传标量——这样业务侧日后新增标量字段不会在
     合并时被悄悄丢掉，同时把未知的嵌套结构挡在外面（体积与注入面都不可控）。 */
  function sanitizeIndex(raw) {
    if (!isPlainObject(raw) || !validId(raw.id)) return null;
    var id = str(raw.id, MAX_FIELD.id);
    if (!id) return null;
    var out = {
      // v 是业务侧的索引版本号，镜像层不认识也不解释，原样透传即可
      v: num(raw.v, 0),
      id: id,
      toolId: str(raw.toolId, MAX_FIELD.toolId),
      toolName: str(raw.toolName, MAX_FIELD.toolName),
      icon: str(raw.icon, MAX_FIELD.icon),
      title: str(raw.title, MAX_FIELD.title),
      error: str(raw.error, MAX_FIELD.error),
      partial: !!raw.partial,
      createdAt: num(raw.createdAt, 0),
      model: str(raw.model, MAX_FIELD.model),
      inputHead: str(raw.inputHead, MAX_FIELD.inputHead),
      hasMigration: !!raw.hasMigration,
      hasPaper: !!raw.hasPaper,
    };
    // 版本数（列表角标用）只在输入里有时才输出：老数据的摘要必须逐字节保持不变，
    // 否则用户手里已有的备份文件会因为「重算摘要多出一个默认字段」被判为损坏而拒收。
    // 与 buildEnvelope 里 prefs 只在非空时输出的道理完全一样。
    if (raw.verCount !== null && raw.verCount !== undefined) out.verCount = num(raw.verCount, 1);
    var titleJobId = raw.titleJobId === null || raw.titleJobId === undefined
      ? ""
      : str(raw.titleJobId, MAX_FIELD.titleJobId);
    if (titleJobId) {
      out.titleJobId = titleJobId;
      if (raw.titlePending !== null && raw.titlePending !== undefined) {
        out.titlePending = !!raw.titlePending;
      }
      if (raw.titleContentKey !== null && raw.titleContentKey !== undefined) {
        out.titleContentKey = str(raw.titleContentKey, MAX_FIELD.titleContentKey);
      }
      if (raw.titlePayloadHash !== null && raw.titlePayloadHash !== undefined) {
        out.titlePayloadHash = str(raw.titlePayloadHash, MAX_FIELD.titlePayloadHash);
      }
    }
    out.updatedAt = updatedAtOf(raw);
    var known = {
      v: 1, id: 1, toolId: 1, toolName: 1, icon: 1, title: 1, error: 1, partial: 1,
      createdAt: 1, model: 1, inputHead: 1, hasMigration: 1, hasPaper: 1, updatedAt: 1,
      verCount: 1, titleJobId: 1, titlePending: 1, titleContentKey: 1, titlePayloadHash: 1,
      _bodyLoaded: 1,
    };
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      if (known[k]) continue;
      var v = raw[k];
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = typeof v === "string" ? str(v, MAX_FIELD.inputHead) : v;
      }
    }
    return out;
  }

  /* 回答版本数组：重新生成时保留的历次结果（见 nbx-versions.js）。
     逐项白名单 + 截断；只要有一项认不出，或活动版本不在列表里，就整块丢弃——
     一份缺了活动版本的列表会让应用切不回它该显示的那一版，而退回单版本记录
     （output 是活动版本的投影，仍在）总好过带一份自相矛盾的数据过河。
     裁剪必须**幂等且确定**：buildEnvelope / validateEnvelope / 接收端 applyOps
     三处都要按它算摘要，同样的输入必须得到同样的输出。 */
  function sanitizeVersions(raw, activeId) {
    if (!Array.isArray(raw)) return null;
    var list = [];
    for (var i = 0; i < raw.length; i += 1) {
      var v = raw[i];
      if (!isPlainObject(v) || !validId(v.id)) return null;
      var id = str(v.id, MAX_FIELD.id);
      var output = str(v.output, MAX_ITEM_BYTES);
      if (!id || !output) return null;
      // 键序固定（与 nbx-versions.js 的 makeEntry 一致）：往返一次摘要才不会漂
      list.push({
        id: id,
        output: output,
        model: str(v.model, MAX_FIELD.model),
        at: num(v.at, 0),
        partial: !!v.partial,
        error: str(v.error, MAX_FIELD.error),
      });
    }
    if (list.length < 2 || list.length > VERSION_LIMIT) return null;
    var act = str(activeId, MAX_FIELD.id);
    if (!act) return null;
    var hit = false;
    for (var j = 0; j < list.length; j += 1) {
      if (list[j].id === act) hit = true;
    }
    if (!hit) return null;
    // 超字数上限时从最旧的非活动版本开始裁，活动版本永不裁掉（与业务侧同一规则）
    while (list.length > 1 && versionChars(list) > VERSION_TOTAL_CHARS) {
      var cut = -1;
      for (var m = 0; m < list.length; m += 1) {
        if (list[m].id !== act) { cut = m; break; }
      }
      if (cut < 0) break;
      list.splice(cut, 1);
    }
    return list;
  }

  function versionChars(list) {
    var n = 0;
    for (var i = 0; i < list.length; i += 1) n += str(list[i].output, MAX_ITEM_BYTES).length;
    return n;
  }

  /* 正文：input / output / fileName 三件套 + 可选快照 + 可选回答版本。
     新增字段一律**追加在已有键之后**且只在输入里有时才输出：老信封（没有它们）
     重算出来的摘要必须与当年导出时逐字节一致，否则旧备份会被判为损坏。 */
  function sanitizeBody(raw) {
    if (!isPlainObject(raw)) return null;
    var out = {
      input: str(raw.input, MAX_ITEM_BYTES),
      output: str(raw.output, MAX_ITEM_BYTES),
      fileName: str(raw.fileName, MAX_FIELD.fileName),
    };
    var mig = cloneOpaque(raw.migration);
    if (mig) out.migration = mig;
    var paper = cloneOpaque(raw.visualPaper);
    if (paper) out.visualPaper = paper;
    var vers = sanitizeVersions(raw.versions, raw.activeVersionId);
    if (vers) {
      out.versions = vers;
      out.activeVersionId = str(raw.activeVersionId, MAX_FIELD.id);
    }
    // 识别记录的元信息（类型 / 张数 / 是否截断 / 批次签名，见识别图片文字）：
    // 不认识结构，原样搬运即可。追加在已有键之后，理由同上
    var ocr = cloneOpaque(raw.ocr);
    if (ocr) out.ocr = ocr;
    return out;
  }

  /* 收藏项：与 script.js 的 favorite 结构一致，migration 为不透明快照。 */
  function sanitizeFavorite(raw) {
    if (!isPlainObject(raw) || !validId(raw.id)) return null;
    var id = str(raw.id, MAX_FIELD.id);
    if (!id) return null;
    var out = {
      id: id,
      title: str(raw.title, MAX_FIELD.title),
      content: str(raw.content, MAX_ITEM_BYTES),
      toolId: raw.toolId === null || raw.toolId === undefined ? null : str(raw.toolId, MAX_FIELD.toolId),
      toolName: str(raw.toolName, MAX_FIELD.toolName),
      createdAt: num(raw.createdAt, 0),
      updatedAt: updatedAtOf(raw),
    };
    var mig = cloneOpaque(raw.migration);
    if (mig) out.migration = mig;
    return out;
  }

  /* 偏好：{theme?: {v, at}, model?: {v, at}}，LWW 的键是 at。
     键顺序固定（按白名单顺序构造），否则同一个信封换个键序算出的摘要就不一样，
     校验和会无端失配。值只接字符串：数字 / 对象一律丢弃，不做 String() 强转，
     免得把 "5" 这种非 id 的垃圾值写进存储再经镜像传出去。
     at <= 0 视为无效（与 store 的 applyOps 同一判据）：没有时间戳的偏好无法参与
     「谁更新」的判断，留着只会在合并时被随意覆盖。 */
  function sanitizePrefs(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var names = Object.keys(PREF_KEYS);
    for (var i = 0; i < names.length; i += 1) {
      var key = names[i];
      var p = raw[key];
      if (!isPlainObject(p)) continue;
      var v = typeof p.v === "string" ? str(p.v, PREF_VAL_CAP) : "";
      var at = num(p.at, 0);
      if (!v || at <= 0) continue;
      out[key] = { v: v, at: at };
    }
    return out;
  }

  function sanitizeTombstones(raw) {
    var out = { history: [], favorites: [] };
    if (!isPlainObject(raw)) return out;
    var kinds = ["history", "favorites"];
    for (var ki = 0; ki < kinds.length; ki += 1) {
      var kind = kinds[ki];
      var list = raw[kind];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i += 1) {
        var t = list[i];
        if (!isPlainObject(t) || !validId(t.id)) continue;
        var id = str(t.id, MAX_FIELD.id);
        if (!id) continue;
        out[kind].push({ id: id, at: num(t.at, 0) });
      }
    }
    return out;
  }

  /* 墓碑只按数量裁剪（不过期，理由见 pruneTombstones 内注释）。 */
  function pruneTombstones(list, opts) {
    // 墓碑不过期：90 天过期会让「旧备份/对端旧副本复活已删条目」的窗口长期存在，
    // 而 1000 条上限已经把体积钉死在几十 KB。opts.maxAgeMs 显式传入时仍按时间过滤。
    var maxAge = (opts && typeof opts.maxAgeMs === "number" && isFinite(opts.maxAgeMs)) ? opts.maxAgeMs : Infinity;
    var now = (opts && opts.now) || Date.now();
    var maxCount = (opts && opts.maxCount) || TOMBSTONE_MAX_COUNT;
    var kept = (Array.isArray(list) ? list : []).filter(function (t) {
      return isPlainObject(t) && t.id && now - num(t.at, 0) <= maxAge;
    });
    if (kept.length > maxCount) {
      kept.sort(function (a, b) { return num(b.at, 0) - num(a.at, 0); });
      kept = kept.slice(0, maxCount);
    }
    return kept;
  }

  function trimTombstones(tombstones, opts) {
    var t = sanitizeTombstones(tombstones);
    return {
      history: pruneTombstones(t.history, opts),
      favorites: pruneTombstones(t.favorites, opts),
    };
  }

  /* ---------------- envelope ---------------- */

  /* 打包。history 传 [{index, body}]，调用方负责把正文读齐（列表里多数条目只持有索引）。 */
  function buildEnvelope(input) {
    var src = isPlainObject(input) ? input : {};
    var history = [];
    var rawHistory = Array.isArray(src.history) ? src.history : [];
    for (var i = 0; i < rawHistory.length; i += 1) {
      var entry = rawHistory[i];
      if (!isPlainObject(entry)) continue;
      var index = sanitizeIndex(entry.index);
      if (!index) continue;
      history.push({ index: index, body: sanitizeBody(entry.body) || sanitizeBody({}) });
    }
    var favorites = [];
    var rawFavs = Array.isArray(src.favorites) ? src.favorites : [];
    for (var j = 0; j < rawFavs.length; j += 1) {
      var fav = sanitizeFavorite(rawFavs[j]);
      if (fav) favorites.push(fav);
    }
    var env = {
      v: MIRROR_VERSION,
      exportedAt: num(src.exportedAt, Date.now()),
      source: str(src.source, MAX_FIELD.toolName),
      history: history,
      favorites: favorites,
      tombstones: trimTombstones(src.tombstones),
    };
    /* 偏好只在非空时才作为一个字段出现。这不是洁癖：sha256 是对本函数的输出序列
       计算的，字段一旦总是出现，「偏好功能之前导出的文件」重算出来的摘要就会变，
       用户手里的旧备份会全部被判定为「校验和不匹配」。缺席即保持旧形状，
       旧文件照常导入（旧文件本来也没有偏好），新文件里偏好一并受校验和保护。 */
    var prefs = sanitizePrefs(src.prefs);
    if (Object.keys(prefs).length) env.prefs = prefs;
    return env;
  }

  function serializeEnvelope(envelope) {
    return JSON.stringify(envelope);
  }

  /* 校验外来数据。返回 {ok, envelope} 或 {ok:false, reason}。
     任何一项不合规都整份拒绝：宁可让用户重来，也不要把半份数据写进本地存储。 */
  function validateEnvelope(raw, opts) {
    var limits = (opts && opts.limits) || DEFAULT_LIMITS;
    var value = raw;
    if (typeof raw === "string") {
      if (utf8Bytes(raw) > MAX_ENVELOPE_BYTES) {
        return { ok: false, reason: "数据体积超过 " + Math.round(MAX_ENVELOPE_BYTES / 1048576) + "MB，已拒绝" };
      }
      try {
        value = JSON.parse(raw);
      } catch (e) {
        return { ok: false, reason: "不是合法的 JSON 文件" };
      }
    }
    if (!isPlainObject(value)) return { ok: false, reason: "数据格式不正确" };
    if (num(value.v, -1) !== MIRROR_VERSION) {
      return { ok: false, reason: "数据版本不兼容（当前支持 v" + MIRROR_VERSION + "）" };
    }
    if (!Array.isArray(value.history) || !Array.isArray(value.favorites)) {
      return { ok: false, reason: "缺少 history / favorites 列表" };
    }
    // 校验和：导出文件在 sha256 字段内嵌摘要（对规范化序列计算，因此手工重排
    // 格式的文件仍能验证）。缺字段不拒绝——兼容本功能加入前导出的文件；
    // 摘要不匹配则整份拒绝，宁可让用户重新导出。
    if (typeof value.sha256 === "string" && value.sha256) {
      var expect = value.sha256.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expect)) {
        return { ok: false, reason: "文件校验和格式不正确" };
      }
      if (sha256Hex(serializeEnvelope(buildEnvelope(value))) !== expect) {
        // 除了真损坏，还有一种情形会走到这里：文件由更新版本的应用导出，而那个版本
        // 往信封里加了本版本不认识、因而不参与摘要计算的字段。判语里说清楚，
        // 免得用户拿「数据已损坏」去折腾一个其实完好的备份。
        return { ok: false, reason: "文件校验和不匹配：文件可能已损坏，或用更新版本的应用导出过，请重新导出" };
      }
    }
    // 先按上限截断再逐条归一：超大文件不该让我们遍历几十万条
    var envelope = buildEnvelope({
      exportedAt: value.exportedAt,
      source: value.source,
      history: value.history.slice(0, limits.history),
      favorites: value.favorites.slice(0, limits.favorites),
      tombstones: value.tombstones,
      prefs: value.prefs,
    });
    if (!envelope.history.length && !envelope.favorites.length) {
      return { ok: false, reason: "数据里没有任何可导入的记录" };
    }
    return { ok: true, envelope: envelope };
  }

  /* ---------------- 合并 ---------------- */

  function isDead(id, tombstones, updatedAt) {
    var list = (tombstones && tombstones.history) || [];
    for (var i = 0; i < list.length; i += 1) {
      // 墓碑比内容新才算死：删除之后又重新生成的同 id 条目（理论上不会出现，
      // 但 id 由时间戳+随机数生成，不排除碰撞）不应被旧墓碑误杀
      if (list[i].id === id && num(list[i].at, 0) >= updatedAt) return true;
    }
    return false;
  }

  function isFavDead(id, tombstones, updatedAt) {
    var list = (tombstones && tombstones.favorites) || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id && num(list[i].at, 0) >= updatedAt) return true;
    }
    return false;
  }

  /* 预览用：找出某 id 的墓碑时间（找不到返回 0）。调用方保证只问被判死的 id。 */
  function tombstoneAt(tombstones, kind, id) {
    var list = ((tombstones && tombstones[kind]) || []);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return num(list[i].at, 0);
    }
    return 0;
  }

  /* 预览用：条目的展示摘要（标题截断已由 sanitize 保证，这里只是取字段）。 */
  function descOf(index, extra) {
    var d = {
      id: str(index.id, MAX_FIELD.id),
      title: str(index.title, MAX_FIELD.title),
      updatedAt: updatedAtOf(index),
    };
    if (extra) d.at = num(extra, 0);
    return d;
  }

  function mergeTombstones(a, b, opts) {
    var seen = Object.create(null);
    var out = [];
    var push = function (list) {
      for (var i = 0; i < (list || []).length; i += 1) {
        var t = list[i];
        if (!t || !t.id) continue;
        var prev = seen[t.id];
        if (prev === undefined) {
          seen[t.id] = out.length;
          out.push({ id: t.id, at: num(t.at, 0) });
        } else if (num(t.at, 0) > num(out[prev].at, 0)) {
          out[prev] = { id: t.id, at: num(t.at, 0) };
        }
      }
    };
    push(a);
    push(b);
    return pruneTombstones(out, opts);
  }

  /* 合并历史。local / remote 均为 [{index, body}]；返回合并结果与统计。
     时间戳相同时保留本地版本：合并是幂等的，不能因为「远端看起来更新」而在两端
     来回翻转（flapping）。
     changes 是逐条变更清单（id + 标题 + 时间），供导入预览展示用。 */
  function mergeHistory(localHistory, remoteHistory, tombstones) {
    var map = new Map();
    var stats = { added: 0, updated: 0, removed: 0 };
    var added = [];
    var updated = [];
    var removed = [];
    var list = Array.isArray(localHistory) ? localHistory : [];
    for (var i = 0; i < list.length; i += 1) {
      var e = list[i];
      if (e && e.index && e.index.id) map.set(e.index.id, e);
    }
    var remote = Array.isArray(remoteHistory) ? remoteHistory : [];
    for (var j = 0; j < remote.length; j += 1) {
      var r = remote[j];
      if (!r || !r.index || !r.index.id) continue;
      var id = r.index.id;
      var cur = map.get(id);
      if (!cur) {
        map.set(id, r);
        stats.added += 1;
        added.push(descOf(r.index));
        continue;
      }
      if (updatedAtOf(r.index) > updatedAtOf(cur.index)) {
        // 远端版本更新：索引与正文一起换，避免出现「新索引配旧正文」
        map.set(id, r);
        stats.updated += 1;
        updated.push(descOf(r.index));
      } else if (!cur.body && r.body) {
        // 索引相同但本地缺正文（列表里只有索引项的情形）：把正文补进来
        map.set(id, { index: cur.index, body: r.body });
        stats.updated += 1;
        updated.push(descOf(cur.index));
      }
    }
    var merged = [];
    map.forEach(function (entry) {
      if (isDead(entry.index.id, tombstones, updatedAtOf(entry.index))) {
        stats.removed += 1;
        removed.push(descOf(entry.index, tombstoneAt(tombstones, "history", entry.index.id)));
        return;
      }
      merged.push(entry);
    });
    merged.sort(function (a, b) { return updatedAtOf(b.index) - updatedAtOf(a.index); });
    return { list: merged, stats: stats, changes: { added: added, updated: updated, removed: removed } };
  }

  function mergeFavorites(localFavs, remoteFavs, tombstones) {
    var map = new Map();
    var stats = { added: 0, updated: 0, removed: 0 };
    var added = [];
    var updated = [];
    var removed = [];
    var list = Array.isArray(localFavs) ? localFavs : [];
    for (var i = 0; i < list.length; i += 1) {
      var f = list[i];
      if (f && f.id) map.set(f.id, f);
    }
    var remote = Array.isArray(remoteFavs) ? remoteFavs : [];
    for (var j = 0; j < remote.length; j += 1) {
      var r = remote[j];
      if (!r || !r.id) continue;
      var cur = map.get(r.id);
      if (!cur) {
        map.set(r.id, r);
        stats.added += 1;
        added.push(descOf(r));
      } else if (updatedAtOf(r) > updatedAtOf(cur)) {
        map.set(r.id, r);
        stats.updated += 1;
        updated.push(descOf(r));
      }
    }
    var merged = [];
    map.forEach(function (fav) {
      if (isFavDead(fav.id, tombstones, updatedAtOf(fav))) {
        stats.removed += 1;
        removed.push(descOf(fav, tombstoneAt(tombstones, "favorites", fav.id)));
        return;
      }
      merged.push(fav);
    });
    merged.sort(function (a, b) { return updatedAtOf(b) - updatedAtOf(a); });
    return { list: merged, stats: stats, changes: { added: added, updated: updated, removed: removed } };
  }

  function trimHistory(list, limit) {
    var arr = Array.isArray(list) ? list.slice() : [];
    if (limit > 0 && arr.length > limit) {
      // 已经按时间倒序排好，直接截尾＝淘汰最旧，与 _unshiftHistory 的口径一致
      var dropped = arr.slice(limit);
      arr = arr.slice(0, limit);
      return { list: arr, dropped: dropped };
    }
    return { list: arr, dropped: [] };
  }

  /* 偏好合并：逐键 LWW，时间戳相同时保留本地 —— 与条目合并同一套幂等口径
     （同刻不翻转，两端反复合并不会来回抖）。
     changed 只列「本机值真的变了」的键：对端带了个更旧的偏好过来时合并结果仍是
     本机的值，就不该在导入预览里显示成一条变更。 */
  function mergePrefs(local, remote) {
    var l = sanitizePrefs(local);
    var r = sanitizePrefs(remote);
    var prefs = {};
    var changed = [];
    var names = Object.keys(PREF_KEYS);
    for (var i = 0; i < names.length; i += 1) {
      var key = names[i];
      var a = l[key];
      var b = r[key];
      if (!a && !b) continue;
      var win = a && b ? (b.at > a.at ? b : a) : (a || b);
      prefs[key] = { v: win.v, at: win.at };
      var cur = a ? a.v : "";
      if (cur !== win.v) changed.push({ key: key, from: cur, to: win.v, at: win.at });
    }
    return { prefs: prefs, changed: changed };
  }

  /* 把两份数据合并成一份。返回：
     {history, favorites, prefs, tombstones, stats, changes, droppedHistory, droppedFavorites}
     dropped* 是被条数上限截掉的条目，调用方需要据此清理它们的正文键。
     changes 是逐条变更清单（id + 标题 + 时间），供导入预览展示用；
     prefs 是逐键合并后的偏好（LWW），调用方要把它落盘并套到界面上。 */
  function mergeRemote(local, remote, opts) {
    var limits = (opts && opts.limits) || DEFAULT_LIMITS;
    var l = isPlainObject(local) ? local : {};
    var r = isPlainObject(remote) ? remote : {};
    var tombstones = {
      history: mergeTombstones(
        (l.tombstones && l.tombstones.history) || [],
        (r.tombstones && r.tombstones.history) || [],
        opts
      ),
      favorites: mergeTombstones(
        (l.tombstones && l.tombstones.favorites) || [],
        (r.tombstones && r.tombstones.favorites) || [],
        opts
      ),
    };
    var h = mergeHistory(l.history, r.history, tombstones);
    var f = mergeFavorites(l.favorites, r.favorites, tombstones);
    var p = mergePrefs(l.prefs, r.prefs);
    var th = trimHistory(h.list, limits.history);
    var tf = trimHistory(f.list, limits.favorites);
    return {
      history: th.list,
      favorites: tf.list,
      prefs: p.prefs,
      tombstones: tombstones,
      stats: {
        historyAdded: h.stats.added,
        historyUpdated: h.stats.updated,
        historyRemoved: h.stats.removed,
        favoriteAdded: f.stats.added,
        favoriteUpdated: f.stats.updated,
        favoriteRemoved: f.stats.removed,
        prefsChanged: p.changed.length,
      },
      changes: {
        historyAdded: h.changes.added,
        historyUpdated: h.changes.updated,
        historyRemoved: h.changes.removed,
        favoriteAdded: f.changes.added,
        favoriteUpdated: f.changes.updated,
        favoriteRemoved: f.changes.removed,
        prefsChanged: p.changed,
      },
      droppedHistory: th.dropped,
      droppedFavorites: tf.dropped,
    };
  }

  /* 合并是否真的改变了什么（用于决定要不要落盘、要不要重渲染）。
     偏好算数：只带了偏好变更的文件不能被判成「本机数据已是最新」。 */
  function hasChanges(stats) {
    if (!stats) return false;
    return !!(stats.historyAdded || stats.historyUpdated || stats.historyRemoved
      || stats.favoriteAdded || stats.favoriteUpdated || stats.favoriteRemoved
      || stats.prefsChanged);
  }

  var api = {
    MIRROR_VERSION: MIRROR_VERSION,
    DEFAULT_LIMITS: DEFAULT_LIMITS,
    MAX_ITEM_BYTES: MAX_ITEM_BYTES,
    MAX_ENVELOPE_BYTES: MAX_ENVELOPE_BYTES,
    VERSION_LIMIT: VERSION_LIMIT,
    VERSION_TOTAL_CHARS: VERSION_TOTAL_CHARS,
    utf8Bytes: utf8Bytes,
    utf8BytesArray: utf8BytesArray,
    sha256Hex: sha256Hex,
    updatedAtOf: updatedAtOf,
    sanitizeIndex: sanitizeIndex,
    sanitizeBody: sanitizeBody,
    sanitizeFavorite: sanitizeFavorite,
    sanitizePrefs: sanitizePrefs,
    trimTombstones: trimTombstones,
    pruneTombstones: pruneTombstones,
    buildEnvelope: buildEnvelope,
    serializeEnvelope: serializeEnvelope,
    validateEnvelope: validateEnvelope,
    mergePrefs: mergePrefs,
    mergeRemote: mergeRemote,
    hasChanges: hasChanges,
  };

  global.NbxMirror = api;
  // 供 node 直接 require 做用例验证（本文件不含任何浏览器专有 API 的硬依赖）
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
