/* NeoBangX 历史记录的「回答版本」容器：重新生成时旧结果不丢
   ================================================================
   背景：一条历史记录原本只有一份正文（item.output）。「重新生成」要整篇重来、
   旧结果仍能回看，于是正文之外再挂一个版本数组：

     item.versions        = [{ id, output, model, at, partial, error }]  时间升序，末项最新
     item.activeVersionId = 当前展示的那一版的 id

   关键不变量：item.output / model / partial / error 始终是「活动版本」的投影。
   渲染、导出、标题、错误卡、历史索引、线路镜像都只读这几个字段，所以版本化对那些
   路径完全透明——这也是本功能不必改动它们的原因。

   设计要点：
   - 纯函数、无 DOM、无副作用、不碰 localStorage：可直接用 node 跑用例验证。
   - 缺 versions 字段 = 单版本记录（全部存量数据），read() 返回 null，行为与
     版本化引入前完全一致，不需要任何数据迁移。
   - 只有正文非空的尝试才成为版本：一个字都没产出的失败不该在切换器里占一格，
     屏幕上照常显示错误卡即可。
   - 双上限（条数 + 总字数），超限时从最旧的**非活动**版本开始淘汰。
     活动版本是屏幕上正在看的那一份，永远不删：删了就成了「切回自己却什么都没有」。
   - 条目只含有语义的六个字段且键序固定，镜像层按同样的形状重建并算摘要。 */

(function (global) {
  "use strict";

  // 单条记录最多保留的版本数与所有版本正文合计字数上限。
  // 与 nbx-mirror.js 里的 VERSION_LIMIT / VERSION_TOTAL_CHARS 同口径，
  // 那边略宽一档（镜像层永远不该比应用层删得更狠）。两处需同步修改。
  var LIMIT = 8;
  var TOTAL_CHARS = 1000 * 1000;

  function isObj(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function str(v, max) {
    if (typeof v !== "string") return "";
    return v.length > max ? v.slice(0, max) : v;
  }

  function newId() {
    return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function findIdx(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return i;
    }
    return -1;
  }

  function totalChars(list) {
    var n = 0;
    for (var i = 0; i < list.length; i += 1) n += (list[i].output || "").length;
    return n;
  }

  /* 一个版本条目，键序固定（id, output, model, at, partial, error）：
     镜像层按同样顺序重建，往返之后摘要才不会漂。 */
  function makeEntry(entry) {
    var e = entry || {};
    return {
      id: str(e.id, 64) || newId(),
      output: typeof e.output === "string" ? e.output : "",
      model: str(e.model, 128),
      at: Number(e.at) > 0 ? Number(e.at) : Date.now(),
      partial: !!e.partial,
      error: str(e.error, 2000),
    };
  }

  /* 只读：把 versions 规范化成数组返回，没有容器（或没有可用条目）时返回 null。
     绝不改动入参——Alpine 模板里的 getter 只能走这里，在其中写响应式字段会触发
     重渲染循环。返回的是原条目对象本身，id 保持稳定，switchTo 才找得回它。 */
  function read(item) {
    if (!isObj(item) || !Array.isArray(item.versions)) return null;
    var out = [];
    for (var i = 0; i < item.versions.length; i += 1) {
      var raw = item.versions[i];
      if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) continue;
      if (typeof raw.output !== "string" || !raw.output) continue;
      out.push(raw);
    }
    return out.length ? out : null;
  }

  /* 版本数：没有容器时按「正文非空就是 1 版」算，与界面上的显隐判断一致。 */
  function count(item) {
    var list = read(item);
    if (list) return list.length;
    return isObj(item) && typeof item.output === "string" && item.output ? 1 : 0;
  }

  function activeIndex(item) {
    var list = read(item);
    if (!list) return 0;
    var i = findIdx(list, item.activeVersionId);
    // 活动 id 找不到（容器被外来数据改过）时回落到最新一版，而不是第一版：
    // 界面上默认展示的应当是最近一次生成的结果
    return i < 0 ? list.length - 1 : i;
  }

  /* 当前活动版本。没有容器时按 item 的投影字段合成一份，供切换器 tooltip 显示
     版本来源；刻意不调 makeEntry，免得给不存在的版本编造 id 与时间戳。 */
  function active(item) {
    var list = read(item);
    if (list) return list[activeIndex(item)];
    if (!isObj(item)) return null;
    return {
      id: "",
      output: typeof item.output === "string" ? item.output : "",
      model: typeof item.model === "string" ? item.model : "",
      at: Number(item.updatedAt || item.createdAt) || 0,
      partial: !!item.partial,
      error: typeof item.error === "string" ? item.error : "",
    };
  }

  /* 需要写的时候才建容器：把 item 现有的 output 固化成第一版。
     只在真正要追加新版本时才调用——单纯浏览不该产生任何写入。
     现有正文为空时返回 null（没有可固化的旧版本），由 append 直接建新容器。 */
  function ensure(item) {
    if (!isObj(item)) return null;
    if (read(item)) return item.versions;
    var out = typeof item.output === "string" ? item.output : "";
    if (!out) return null;
    var first = makeEntry({
      output: out,
      model: item.model,
      at: Number(item.updatedAt || item.createdAt) || Date.now(),
      partial: item.partial,
      error: item.error,
    });
    item.versions = [first];
    item.activeVersionId = first.id;
    return item.versions;
  }

  /* 把活动版本投影回 item 的投影字段。写版本容器的每条路径最后都要走这里，
     否则 item.output 与活动版本会脱钩，界面上就会出现「切了版本但正文没变」。 */
  function projectActive(item) {
    var list = read(item);
    if (!list) return null;
    var e = list[activeIndex(item)];
    if (!e) return null;
    item.output = e.output || "";
    item.model = e.model || "";
    item.partial = !!e.partial;
    item.error = e.error || "";
    item.activeVersionId = e.id;
    return e;
  }

  /* 超限淘汰：从最旧的非活动版本开始删。只剩活动版本时即便还超字数上限也不再删
     （退回单版本记录的体量，而不是把用户正在看的内容删掉）。 */
  function prune(item) {
    var list = read(item);
    if (!list || list.length <= 1) return list;
    var act = list[activeIndex(item)] || {};
    while (list.length > 1 && (list.length > LIMIT || totalChars(list) > TOTAL_CHARS)) {
      var victim = -1;
      for (var k = 0; k < list.length; k += 1) {
        if (list[k].id !== act.id) { victim = k; break; }
      }
      if (victim < 0) break;
      list.splice(victim, 1);
    }
    item.versions = list;
    return list;
  }

  /* 追加一个新版本并激活它。entry.output 为空则不追加（返回 null）：
     零产出的失败不占版本格，调用方照常显示错误卡、旧结果一动不动。 */
  function append(item, entry) {
    if (!isObj(item)) return null;
    var out = entry && typeof entry.output === "string" ? entry.output : "";
    if (!out) return null;
    var list = ensure(item); // 把现有正文固化成第一版；没有则返回 null
    var e = makeEntry(entry);
    if (list) list.push(e);
    else item.versions = [e];
    item.activeVersionId = e.id;
    prune(item);
    projectActive(item);
    return e;
  }

  /* 用 item 的投影字段回填活动版本：续写（在原版本上接着写）、失败记录合并等
     就地更新路径收尾时调用。没有容器时是空操作。 */
  function syncActive(item) {
    var list = read(item);
    if (!list) return null;
    var e = list[activeIndex(item)];
    if (!e) return null;
    if (typeof item.output === "string") e.output = item.output;
    if (typeof item.model === "string") e.model = item.model;
    e.partial = !!item.partial;
    e.error = typeof item.error === "string" ? item.error : "";
    return e;
  }

  /* 切换活动版本。target 传数字 = 相对位移（-1 上一版 / +1 下一版，0 是原地不动，
     返回 null），传字符串 = 目标版本 id。越界与原地不动都返回 null（按钮本来也会
     置灰，这里再兜一层）。成功时把该版本的字段写回 item 并返回它。 */
  function switchTo(item, target) {
    var list = read(item);
    if (!list) return null;
    var cur = activeIndex(item);
    var next = typeof target === "number" ? cur + target : findIdx(list, target);
    if (next < 0 || next > list.length - 1 || next === cur) return null;
    item.activeVersionId = list[next].id;
    projectActive(item);
    return list[next];
  }

  var api = {
    LIMIT: LIMIT,
    TOTAL_CHARS: TOTAL_CHARS,
    makeEntry: makeEntry,
    read: read,
    count: count,
    activeIndex: activeIndex,
    active: active,
    ensure: ensure,
    projectActive: projectActive,
    prune: prune,
    append: append,
    syncActive: syncActive,
    switchTo: switchTo,
  };

  global.NbxVersions = api;
  // 供 node 直接 require 做用例验证（本文件不含任何浏览器专有 API 的硬依赖）
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
