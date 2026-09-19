/* NeoBangX 线路镜像 · 存储层
   ================================================================
   两个 origin（www / cf）的页面都要做同一件事：读自己的历史与收藏、把对方发来的
   变更合并进自己的 localStorage。这份逻辑必须在「主应用页面」和「桥接页面」之间
   共用 —— 各写一份一定会漂移，而漂移的后果是数据损坏，不是样式问题。

   分房：nbx-mirror.js 只放纯函数（不含存储/网络），本文件负责碰 localStorage 与
   变更队列，主应用与 bridge 页面共同加载这两份。

   键名由调用方经 init() 注入，不在这里硬编码：主应用传自己的 LS 常量（唯一真相），
   bridge 页面传同样的字面量（bridge 不加载主应用，见 bridge.html 的说明）。

   变更队列（发件箱）
   ------------------
   推送是异步跨文档的：用户写完一条立刻关标签页，消息可能还没被对端处理，这条更新
   就永久丢了。所以每个 origin 维护一个「待同步队列」持久化在本地，推送负责及时、
   队列负责不丢 —— 对端不可达时队列攒着，下次握手时补齐。
   队列只存 {at, del} 与条目 id，不存正文：正文在发送时才从主存储读出来，
   否则同一份数据会在一个 origin 内翻倍占用配额。 */

(function (global) {
  "use strict";

  var KEYS = null;
  var storage = null;

  // 参与同步的偏好键白名单。值都是短字符串（主题 id / 模型 id）。
  var PREF_KEYS = { theme: 1, model: 1 };

  function mx() {
    return global.NbxMirror;
  }

  function init(options) {
    var o = options || {};
    KEYS = {
      history: o.history,
      favorites: o.favorites,
      bodyPrefix: o.bodyPrefix,
      tomb: o.tomb,
      outbox: o.outbox,
      prefs: o.prefs,
    };
    storage = o.storage || global.localStorage;
    return KEYS;
  }

  function ready() {
    return !!(KEYS && storage && mx());
  }

  /* ---------------- 原始读写（失败一律静默降级，绝不抛给业务） ---------------- */

  function readRaw(key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function writeRaw(key, value) {
    try { storage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function removeRaw(key) {
    try { storage.removeItem(key); } catch (e) { /* 忽略 */ }
  }
  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (raw === null) return fallback;
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }

  /* ---------------- 历史 / 收藏 / 墓碑 ---------------- */

  function readHistoryIndex() {
    var raw = readJSON(KEYS.history, []);
    return Array.isArray(raw) ? raw : [];
  }
  function readBody(id) {
    return readJSON(KEYS.bodyPrefix + id, null);
  }
  function writeBody(id, body) {
    var key = KEYS.bodyPrefix + id;
    var payload = JSON.stringify(body);
    // 内容一致就不写：反复合并（每次启动都会跑）应当是零写入的，
    // 而 localStorage 写入是同步阻塞的，无谓写入会白白卡主线程
    if (readRaw(key) === payload) return true;
    return writeRaw(key, payload);
  }
  function writeHistoryIndex(list) {
    return writeRaw(KEYS.history, JSON.stringify(list));
  }
  function readFavorites() {
    var raw = readJSON(KEYS.favorites, []);
    return Array.isArray(raw) ? raw : [];
  }
  function writeFavorites(list) {
    var payload = JSON.stringify(list);
    if (readRaw(KEYS.favorites) === payload) return true;
    return writeRaw(KEYS.favorites, payload);
  }
  function readTombstones() {
    return mx().trimTombstones(readJSON(KEYS.tomb, null));
  }
  function writeTombstones(t) {
    return writeRaw(KEYS.tomb, JSON.stringify(mx().trimTombstones(t)));
  }

  /* ---------------- 偏好（主题 / 选中模型） ----------------
     与历史/收藏同一套 LWW 语义：{key: {v, at}}，at 大者胜。
     只负责存取与判新 —— 把值写进 LS.theme / LS.model 并应用到界面是主页面的事
     （bridge 没有应用上下文；收到未知主题/模型 id 时主页面会拒收）。 */
  var PREF_VAL_CAP = 128;

  function readPrefs() {
    var raw = readJSON(KEYS.prefs, null);
    var out = {};
    if (raw && typeof raw === "object") {
      var names = Object.keys(PREF_KEYS);
      for (var i = 0; i < names.length; i += 1) {
        var p = raw[names[i]];
        if (p && typeof p.v === "string" && p.v && Number(p.at) > 0) out[names[i]] = { v: p.v, at: Number(p.at) };
      }
    }
    return out;
  }
  function writePrefs(prefs) {
    return writeRaw(KEYS.prefs, JSON.stringify(prefs || {}));
  }

  /* 从偏好存储里挑出「本次需要应用到界面」的值，返回 {theme?, model?}。
     纯函数，不碰存储：判据（LWW、白名单、未知值拒收）放这里才能用 node 验证，
     调用方只负责把结果套到界面上。

     valid 传本线路可用的 id 集合：两条线路的可用主题/模型可能不同，硬套一个
     对端有、本线路没有的 id 会选中不存在的东西。与当前值相同的键不返回，
     避免无谓的重渲染与主题转场。 */
  function pickPrefUpdates(prefs, current, valid) {
    var out = {};
    var cur = current && typeof current === "object" ? current : {};
    var allow = valid && typeof valid === "object" ? valid : {};
    var names = Object.keys(PREF_KEYS);
    for (var i = 0; i < names.length; i += 1) {
      var key = names[i];
      var p = prefs && typeof prefs === "object" ? prefs[key] : null;
      if (!p || typeof p.v !== "string" || !p.v) continue;
      if (p.v === cur[key]) continue;
      var list = allow[key];
      if (!Array.isArray(list) || list.indexOf(p.v) === -1) continue;
      out[key] = p.v;
    }
    return out;
  }

  /* ---------------- 变更队列 ---------------- */

  function readOutbox() {
    var raw = readJSON(KEYS.outbox, null);
    if (!raw || typeof raw !== "object" || typeof raw.ops !== "object" || raw.ops === null) {
      return { v: 1, ops: {} };
    }
    return { v: 1, ops: raw.ops };
  }
  function writeOutbox(box) {
    return writeRaw(KEYS.outbox, JSON.stringify(box));
  }

  /* 登记一次变更。同一 id 只保留最新一条（按 at 取大），
     所以反复编辑同一条不会把队列撑大。 */
  function outboxAdd(kind, id, at, del) {
    if (!ready() || !id) return;
    var box = readOutbox();
    var key = kind + "|" + id;
    var prev = box.ops[key];
    if (!prev || at >= prev.at) box.ops[key] = { at: at, del: !!del };
    writeOutbox(box);
  }

  /* 对端确认收到 at <= upto 的变更后，把它们从队列里删掉。
     keep 是本轮被拒收的 id（见 applyOps 的 rejectedIds）：本地已满时我们拒收，
     对端并没有「送达失败」，但这条也不能就此从队列里消失 —— 否则对端一腾出空间
     就再也收不到它了。 */
  function outboxTrim(upto, keep) {
    if (!ready()) return;
    var box = readOutbox();
    var keepSet = null;
    if (Array.isArray(keep) && keep.length) {
      keepSet = Object.create(null);
      for (var k = 0; k < keep.length; k += 1) keepSet[keep[k]] = true;
    }
    var keys = Object.keys(box.ops);
    var dropped = 0;
    for (var i = 0; i < keys.length; i += 1) {
      if (box.ops[keys[i]].at > upto) continue;
      var id = keys[i].slice(keys[i].indexOf("|") + 1);
      if (keepSet && keepSet[id]) continue;
      delete box.ops[keys[i]];
      dropped += 1;
    }
    if (dropped) writeOutbox(box);
  }

  function outboxList() {
    var box = readOutbox();
    var keys = Object.keys(box.ops);
    var out = [];
    for (var i = 0; i < keys.length; i += 1) {
      var parts = keys[i].split("|");
      out.push({ k: parts[0], id: parts.slice(1).join("|"), at: box.ops[keys[i]].at, del: !!box.ops[keys[i]].del });
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  function outboxCount() {
    return Object.keys(readOutbox().ops).length;
  }

  /* 队列 → 可直接发送的 op 列表：删除条只带 id/时间（正文早已不存在），
     其余在发送时才把正文读出来。
     op.at 一律取队列里记的时间，而不是条目自身的 updatedAt —— 对端回执的 at
     来自 op.at，出队也按 op.at 比较，两者必须是同一个数，否则队列清不干净、
     会反复重发同一条。 */
  function outboxOps() {
    var entries = outboxList();
    var out = [];
    for (var i = 0; i < entries.length; i += 1) {
      var e = entries[i];
      if (e.del) {
        out.push({ k: e.k, id: e.id, at: e.at, del: true });
        continue;
      }
      var op = buildOp(e.k, e.id);
      if (op) {
        op.at = e.at;
        out.push(op);
      }
    }
    return out;
  }

  /* 首次启用镜像时，把本机已有条目全部登记进待同步队列。
     没有这一步，「启用镜像之前就存在的数据」永远送不出去：增量队列只记录启用之后
     发生的变更，而「对端为空才发全量快照」这条规则在对端已经有数据时不成立 ——
     真实场景恰恰如此（主线路用了一阵子，备份线路也可能有自己的历史）。
     用 marker 键保证只做一次，否则每次启动都会重推全量。
     存量条目按各自的时间戳登记，不能用 now：那会让它们在合并时压过对端更新的版本。 */
  function seedOutboxOnce(markerKey) {
    if (!ready() || !markerKey) return false;
    if (readRaw(markerKey) === "1") return false;
    var box = readOutbox();
    var list = readHistoryIndex();
    var i;
    for (i = 0; i < list.length; i += 1) {
      var index = list[i];
      if (!index || !index.id) continue;
      var hk = "h|" + index.id;
      var hat = mx().updatedAtOf(index);
      if (!box.ops[hk] || hat >= box.ops[hk].at) box.ops[hk] = { at: hat, del: false };
    }
    var favs = readFavorites();
    for (i = 0; i < favs.length; i += 1) {
      var fav = favs[i];
      if (!fav || !fav.id) continue;
      var fk = "f|" + fav.id;
      var fat = mx().updatedAtOf(fav);
      if (!box.ops[fk] || fat >= box.ops[fk].at) box.ops[fk] = { at: fat, del: false };
    }
    // 偏好一并播种：首次启用前的主题/模型选择也要送到对端
    var prefs = readPrefs();
    var pnames = Object.keys(PREF_KEYS);
    for (i = 0; i < pnames.length; i += 1) {
      var pk = "p|" + pnames[i];
      var pp = prefs[pnames[i]];
      if (pp && (!box.ops[pk] || pp.at >= box.ops[pk].at)) box.ops[pk] = { at: pp.at, del: false };
    }
    writeOutbox(box);
    writeRaw(markerKey, "1");
    return true;
  }

  /* 偏好的首次播种（独立 marker）：条目重灌的代价大所以只灌一次，但偏好同步是
     后加的能力——已启用镜像的用户没有 p| 开头的队列项，需要补一轮，与条目种子互不干扰。 */
  function seedPrefsOnce(markerKey) {
    if (!ready() || !markerKey) return false;
    if (readRaw(markerKey) === "1") return false;
    var box = readOutbox();
    var prefs = readPrefs();
    var names = Object.keys(PREF_KEYS);
    var seeded = false;
    for (var i = 0; i < names.length; i += 1) {
      var p = prefs[names[i]];
      var key = "p|" + names[i];
      if (p && (!box.ops[key] || p.at >= box.ops[key].at)) {
        box.ops[key] = { at: p.at, del: false };
        seeded = true;
      }
    }
    if (seeded) writeOutbox(box);
    writeRaw(markerKey, "1");
    return seeded;
  }

  /* ---------------- 组装一条带负载的 op ---------------- */

  /* 变更队列里只有 id 和标记，正文在这里才读出来。
     返回 null 表示这条已在本地不存在（删除时用 del 标记，不靠这里判空）。 */
  function buildOp(kind, id) {
    if (kind === "h") {
      var index = null;
      var list = readHistoryIndex();
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].id === id) { index = list[i]; break; }
      }
      if (!index) return null;
      var body = readBody(id);
      return { k: "h", id: id, at: mx().updatedAtOf(index), idx: index, body: body || { input: "", output: "", fileName: "" } };
    }
    if (kind === "f") {
      var favs = readFavorites();
      for (var j = 0; j < favs.length; j += 1) {
        if (favs[j] && favs[j].id === id) {
          return { k: "f", id: id, at: mx().updatedAtOf(favs[j]), fav: favs[j] };
        }
      }
      return null;
    }
    if (kind === "p") {
      var prefs = readPrefs();
      var p = PREF_KEYS[id] && prefs[id];
      if (!p) return null;
      return { k: "p", id: id, at: p.at, v: p.v };
    }
    return null;
  }

  /* 首次同步用：把本机全部条目摊成 op 列表（不含删除，删除靠墓碑表传递）。
     会读入全部正文，调用方要负责分块发送与让出主线程。偏好一并携带。 */
  function buildAllOps() {
    var ops = [];
    var list = readHistoryIndex();
    for (var i = 0; i < list.length; i += 1) {
      var index = list[i];
      if (!index || !index.id) continue;
      var body = readBody(index.id);
      ops.push({ k: "h", id: index.id, at: mx().updatedAtOf(index), idx: index, body: body || { input: "", output: "", fileName: "" } });
    }
    var favs = readFavorites();
    for (var j = 0; j < favs.length; j += 1) {
      if (!favs[j] || !favs[j].id) continue;
      ops.push({ k: "f", id: favs[j].id, at: mx().updatedAtOf(favs[j]), fav: favs[j] });
    }
    var prefs = readPrefs();
    var pnames = Object.keys(PREF_KEYS);
    for (var n = 0; n < pnames.length; n += 1) {
      var p = prefs[pnames[n]];
      if (p) ops.push({ k: "p", id: pnames[n], at: p.at, v: p.v });
    }
    return ops;
  }

  /* 本机概况：对端据此判断要不要做首次全量 */
  function localSummary() {
    return {
      history: readHistoryIndex().length,
      favorites: readFavorites().length,
      tombstones: readTombstones(),
    };
  }

  /* ---------------- 应用对方的 op ---------------- */

  /* 返回 {changed, historyTouched, favoritesTouched}。
     只按 at 取新，与 nbx-mirror 的合并规则同源（updatedAtOf）；删除走墓碑，
     且「墓碑比内容新」才生效 —— 与纯函数层保持同一判据，两处不能各说各话。 */
  function applyOps(ops) {
    var result = { changed: 0, history: false, favorites: false, rejected: 0, rejectedIds: [], prefs: {} };
    if (!ready() || !Array.isArray(ops) || !ops.length) return result;
    // 拒收的 id 要回报给对端：它不能把这条从发送队列里清掉，否则本地腾出空间后
    // 这条更新就永远送不过来了
    var reject = function (id) {
      result.rejected += 1;
      if (id) result.rejectedIds.push(String(id));
    };

    var index = readHistoryIndex();
    var indexById = Object.create(null);
    for (var i = 0; i < index.length; i += 1) {
      if (index[i] && index[i].id) indexById[index[i].id] = i;
    }
    var favs = readFavorites();
    var favById = Object.create(null);
    for (var j = 0; j < favs.length; j += 1) {
      if (favs[j] && favs[j].id) favById[favs[j].id] = j;
    }
    var tomb = readTombstones();
    var tombDirty = false;
    var limit = mx().DEFAULT_LIMITS;

    for (var n = 0; n < ops.length; n += 1) {
      var raw = ops[n];
      if (!raw || typeof raw !== "object") { reject(id); continue; }
      var id = raw.id;
      var at = Number(raw.at) || 0;
      if (!id || (raw.k !== "h" && raw.k !== "f" && raw.k !== "p")) { reject(id); continue; }

      // 偏好（主题 / 选中模型）：LWW 落进 nbx_prefs；把它写进 LS.theme/LS.model
      // 并应用到界面是主页面回调的事（bridge 没有应用上下文，未知值由主页面拒收）
      if (raw.k === "p") {
        if (!PREF_KEYS[id]) { reject(id); continue; }
        var val = typeof raw.v === "string" ? raw.v : "";
        if (!val || val.length > PREF_VAL_CAP || at <= 0) { reject(id); continue; }
        var prefs = readPrefs();
        var cur = prefs[id];
        if (cur && cur.at > at) continue;
        if (cur && cur.at === at && cur.v === val) continue;
        prefs[id] = { v: val, at: at };
        writePrefs(prefs);
        result.prefs[id] = val;
        result.changed += 1;
        continue;
      }

      if (raw.k === "h") {
        if (raw.del) {
          // 没有时间戳的删除不可靠：at=0 的墓碑会杀光所有无时间戳的存量条目
          if (at <= 0) { reject(id); continue; }
          var pos = indexById[id];
          if (pos !== undefined) {
            // 删除同样服从 LWW：不早于本机最后修改才生效。一条更早的删除
            // 若抹掉本机较新的编辑，对端随后又会被那条编辑的旧副本复活 ——
            // 两端永久分歧。墓碑照登（取较大时间），较新的内容受其保护。
            if (at >= mx().updatedAtOf(index[pos])) {
              index.splice(pos, 1);
              indexById = Object.create(null);
              for (var r = 0; r < index.length; r += 1) {
                if (index[r] && index[r].id) indexById[index[r].id] = r;
              }
              removeRaw(KEYS.bodyPrefix + id);
              result.changed += 1;
              result.history = true;
            }
          }
          if (mergeTombstone(tomb.history, id, at)) tombDirty = true;
          continue;
        }
        var cleanIndex = mx().sanitizeIndex(raw.idx);
        if (!cleanIndex) { reject(id); continue; }
        // 对方说这条更新，但本地墓碑更晚 → 是删过的，不复活
        if (isTombstoned(tomb, id, at)) continue;
        var cleanBody = mx().sanitizeBody(raw.body) || { input: "", output: "", fileName: "" };
        var at_ = mx().updatedAtOf(cleanIndex);
        var existing = indexById[id];
        if (existing === undefined) {
          if (index.length >= limit.history) {
            // 本地已满：不腾位置，拒绝写入 —— 绝不让对方的数据挤掉本机历史
            reject(id);
            continue;
          }
          index.push(cleanIndex);
          indexById[id] = index.length - 1;
        } else if (at_ > mx().updatedAtOf(index[existing])) {
          index[existing] = cleanIndex;
        } else {
          continue; // 本地更新（或时间戳相同）→ 保留本地，避免两端来回翻转
        }
        writeBody(id, cleanBody);
        result.changed += 1;
        result.history = true;
        continue;
      }

      // 收藏
      if (raw.del) {
        if (at <= 0) { reject(id); continue; }
        var fpos = favById[id];
        if (fpos !== undefined) {
          // 与历史删除同一判据：不早于本机最后修改才生效
          if (at >= mx().updatedAtOf(favs[fpos])) {
            favs.splice(fpos, 1);
            favById = Object.create(null);
            for (var q = 0; q < favs.length; q += 1) {
              if (favs[q] && favs[q].id) favById[favs[q].id] = q;
            }
            result.changed += 1;
            result.favorites = true;
          }
        }
        if (mergeTombstone(tomb.favorites, id, at)) tombDirty = true;
        continue;
      }
      var cleanFav = mx().sanitizeFavorite(raw.fav);
      if (!cleanFav) { reject(id); continue; }
      if (isTombstonedFav(tomb, id, at)) continue;
      var fat = mx().updatedAtOf(cleanFav);
      var fexisting = favById[id];
      if (fexisting === undefined) {
        if (favs.length >= limit.favorites) { reject(id); continue; }
        favs.push(cleanFav);
        favById[id] = favs.length - 1;
      } else if (fat > mx().updatedAtOf(favs[fexisting])) {
        favs[fexisting] = cleanFav;
      } else {
        continue;
      }
      result.changed += 1;
      result.favorites = true;
    }

    if (result.history) {
      // 与本地一致的时间倒序，列表渲染依赖这个顺序
      index.sort(function (a, b) { return mx().updatedAtOf(b) - mx().updatedAtOf(a); });
      writeHistoryIndex(index);
    }
    if (result.favorites) {
      favs.sort(function (a, b) { return mx().updatedAtOf(b) - mx().updatedAtOf(a); });
      writeFavorites(favs);
    }
    if (tombDirty) writeTombstones(tomb);
    return result;
  }

  function isTombstoned(tomb, id, at) {
    for (var i = 0; i < tomb.history.length; i += 1) {
      if (tomb.history[i].id === id && tomb.history[i].at >= at) return true;
    }
    return false;
  }
  function isTombstonedFav(tomb, id, at) {
    for (var i = 0; i < tomb.favorites.length; i += 1) {
      if (tomb.favorites[i].id === id && tomb.favorites[i].at >= at) return true;
    }
    return false;
  }
  /* 墓碑表里登记/刷新同一个 id，返回是否发生变化 */
  function mergeTombstone(list, id, at) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        if (at > list[i].at) { list[i].at = at; return true; }
        return false;
      }
    }
    list.push({ id: id, at: at });
    return true;
  }

  /* 把对方的墓碑表并进来（握手时整表交换一次，增量删除走 del op） */
  function applyTombstones(remote) {
    var clean = mx().trimTombstones(remote);
    var local = readTombstones();
    var changed = false;
    var kinds = ["history", "favorites"];
    for (var ki = 0; ki < kinds.length; ki += 1) {
      var kind = kinds[ki];
      for (var i = 0; i < clean[kind].length; i += 1) {
        if (mergeTombstone(local[kind], clean[kind][i].id, clean[kind][i].at)) changed = true;
      }
    }
    if (changed) writeTombstones(local);
    return changed;
  }

  /* 应用墓碑后，清掉已被判死的本机条目（正文键一并删）。返回被清掉的历史 id 列表，
     调用方据此刷新界面。 */
  function sweepTombstoned() {
    if (!ready()) return { historyIds: [], favorites: false };
    var tomb = readTombstones();
    var index = readHistoryIndex();
    var kept = [];
    var removedIds = [];
    for (var i = 0; i < index.length; i += 1) {
      var it = index[i];
      if (it && it.id && isTombstoned(tomb, it.id, mx().updatedAtOf(it))) {
        removeRaw(KEYS.bodyPrefix + it.id);
        removedIds.push(it.id);
      } else if (it) {
        kept.push(it);
      }
    }
    if (removedIds.length) writeHistoryIndex(kept);
    var favs = readFavorites();
    var keptFavs = [];
    var favChanged = false;
    for (var j = 0; j < favs.length; j += 1) {
      var f = favs[j];
      if (f && f.id && isTombstonedFav(tomb, f.id, mx().updatedAtOf(f))) favChanged = true;
      else if (f) keptFavs.push(f);
    }
    if (favChanged) writeFavorites(keptFavs);
    return { historyIds: removedIds, favorites: favChanged };
  }

  var api = {
    init: init,
    ready: ready,
    readHistoryIndex: readHistoryIndex,
    readFavorites: readFavorites,
    readBody: readBody,
    readTombstones: readTombstones,
    localSummary: localSummary,
    readPrefs: readPrefs,
    writePrefs: writePrefs,
    pickPrefUpdates: pickPrefUpdates,
    outboxAdd: outboxAdd,
    outboxTrim: outboxTrim,
    outboxList: outboxList,
    outboxCount: outboxCount,
    buildOp: buildOp,
    buildAllOps: buildAllOps,
    outboxOps: outboxOps,
    seedOutboxOnce: seedOutboxOnce,
    seedPrefsOnce: seedPrefsOnce,
    applyOps: applyOps,
    applyTombstones: applyTombstones,
    sweepTombstoned: sweepTombstoned,
  };

  global.NbxMirrorStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
