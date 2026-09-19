/* NeoBangX 线路镜像 · 消息协议
   ================================================================
   两条线路（www / cf）的页面互嵌一个隐藏的同站 iframe，通过 postMessage 互相补齐
   数据。本文件是这套协议的唯一实现，由「主应用页面」和「桥接页面」共同加载 ——
   两侧各写一份握手/分块/对账逻辑一定会漂移，而漂移的后果是数据损坏。

   为什么是「推」而不是「拉」
   --------------------------
   数据存在各 origin 自己的 localStorage 里。备用线路的意义是主线路挂掉时顶上，
   那一刻主线路的页面加载不了，也就读不到它的 localStorage。所以正确方向是反的：
   主线路活着时主动把数据推进对端的存储，故障时对端手里早已有一份，无需再拉取。

   协议（nbx=1）
   ------------
   ready  桥 → 主：我活着 + 我的概况（不含数据，目标域用 "*" 无害）
   hello  主 → 桥：收到 ready 的回应 + 我的概况
         两侧收到 hello/ready 后都做同样三件事：推自己的待同步队列、若对方为空
         而自己有数据就推全量快照、交换墓碑表
   ops    双向：一批变更（分块发送，块间让出主线程）
   tomb   双向：整份墓碑表（只在握手时交换；增量删除走 ops 里的 del 标记）
   ack    双向：已处理的 at 上界 + 本轮拒收的 id（拒收的不能从对端队列里清掉）

   op 形状
   -------
   {k:"h", id, at, idx, body}   历史新增/更新
   {k:"h", id, at, del:true}    历史删除
   {k:"f", id, at, fav}         收藏新增/更新
   {k:"f", id, at, del:true}    收藏删除
   {k:"p", id:"theme"|"model", at, v}  偏好（主题/选中模型），v2 起

   合并判据（取新、墓碑判死、上限拒收）全在 nbx-mirror-store.js，本文件只管搬运。 */

(function (global) {
  "use strict";

  var PROTO = 1;
  // 每条消息最多携带的 op 数。单条正文可达 2MB，因此限制的是「条数」而非字节；
  // 块间用 setTimeout 让出主线程，避免一次全量把页面写卡。
  var CHUNK = 8;
  // 单条消息里 op 数的硬上限：防御畸形的对端消息（正常分块不会超过 CHUNK）
  var MAX_INCOMING_OPS = 200;

  function create(opts) {
    var options = opts || {};
    var postFn = options.post;
    var onApplied = options.onApplied || function () {};
    var onPeerState = options.onPeerState || function () {};
    // 首次全量同步会一次读入并送出全部条目（可能数 MB）。省流/计量网络下跳过，
    // 等用户切到 WiFi 的下一次握手再补 —— 增量变更不受影响，照常推送。
    var allowFullSync = options.allowFullSync || function () { return true; };

    var peerSummary = null;
    var helloSent = false;

    function Store() {
      return global.NbxMirrorStore;
    }

    function post(msg) {
      msg.nbx = PROTO;
      try {
        postFn(msg);
        return true;
      } catch (e) {
        return false;
      }
    }

    function isEmptySummary(s) {
      return !s || (!s.history && !s.favorites);
    }

    function sendOps(ops) {
      if (!Array.isArray(ops) || !ops.length) return;
      var i = 0;
      (function step() {
        if (i >= ops.length) return;
        var slice = ops.slice(i, i + CHUNK);
        i += CHUNK;
        if (!post({ t: "ops", ops: slice })) return;
        // 块间让出：一次全量可能上百条、数 MB，连续 postMessage 会卡住主线程
        setTimeout(step, 0);
      })();
    }

    /* 握手（两侧共用）：推队列 + 必要时推全量 + 交换墓碑表 */
    function handshake(summary) {
      var S = Store();
      if (!S || !S.ready()) return;
      peerSummary = summary || null;
      onPeerState(peerSummary);
      sendOps(S.outboxOps());
      if (isEmptySummary(peerSummary) && allowFullSync()) {
        // 对端是空的：它多半是首次启用，把我这边全部推过去（正文随 op 携带）
        sendOps(S.buildAllOps());
      }
      // 墓碑表整表交换一次：删除不体现在条目列表里，只靠 ops 的增量会漏掉
      // 「对端离线期间发生的删除」
      post({ t: "tomb", tombstones: S.readTombstones() });
    }

    /* 主应用收到 ready 后回 hello；桥收到 hello 后同样回一次握手的三个动作 */
    function onReady(summary) {
      if (helloSent) return;
      helloSent = true;
      var S = Store();
      post({ t: "hello", summary: S && S.ready() ? S.localSummary() : null });
      handshake(summary);
    }

    /* 本机数据变更后立刻推一次。推整个队列而不是单条：队列里只有未确认的条目
       （对端一 ack 就清空），把它整份送出顺带完成了「漏掉的补发」。 */
    function flush() {
      var S = Store();
      if (!S || !S.ready()) return;
      var ops = S.outboxOps();
      if (ops.length) sendOps(ops);
    }

    function handleMessage(data, origin) {
      if (!data || typeof data !== "object" || data.nbx !== PROTO) return false;
      var S = Store();
      if (!S || !S.ready()) return false;

      if (data.t === "ready") {
        onReady(data.summary);
        return true;
      }
      if (data.t === "hello") {
        handshake(data.summary);
        return true;
      }
      if (data.t === "ops") {
        var ops = Array.isArray(data.ops) ? data.ops : [];
        if (ops.length > MAX_INCOMING_OPS) ops = ops.slice(0, MAX_INCOMING_OPS);
        var res = S.applyOps(ops);
        if (data.tombstones) {
          if (S.applyTombstones(data.tombstones)) res.changed += 1;
        }
        var swept = S.sweepTombstoned();
        if (res.changed || swept.historyIds.length || swept.favorites) {
          onApplied(res, swept);
        }
        // 只对「成功处理」的部分回执：被拒收的（本地已满）那个 id 单独回报，
        // 让对端保留在队列里等下次机会，而不是就此丢掉这条更新
        var maxAt = 0;
        for (var i = 0; i < ops.length; i += 1) {
          var at = Number(ops[i] && ops[i].at) || 0;
          if (at > maxAt) maxAt = at;
        }
        post({ t: "ack", at: maxAt, keep: res.rejectedIds || [] });
        return true;
      }
      if (data.t === "tomb") {
        if (S.applyTombstones(data.tombstones)) {
          var swept2 = S.sweepTombstoned();
          if (swept2.historyIds.length || swept2.favorites) onApplied({ changed: 1 }, swept2);
        }
        return true;
      }
      if (data.t === "ack") {
        S.outboxTrim(Number(data.at) || 0, data.keep);
        return true;
      }
      return false;
    }

    return {
      handleMessage: handleMessage,
      onReady: onReady,
      flush: flush,
      isHelloed: function () { return helloSent; },
      peerSummary: function () { return peerSummary; },
    };
  }

  var api = { PROTO: PROTO, CHUNK: CHUNK, create: create };
  global.NbxMirrorPeer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this));
