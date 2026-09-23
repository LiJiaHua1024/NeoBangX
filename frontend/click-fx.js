/* ============================================================================
   ba-click-fx 接入层（点击溶解圆环 / 碎片爆发 / 恒定光标拖尾）

   本文件与 admin-frontend/click-fx.js 逐字相同，改动必须两端同步。
   与库本体分离：升级库只覆盖 vendor/ba-click-fx/ba-click-fx.js，不动本文件。

   设计要点：
   1) 闸门：reduced-motion / saveData / 慢网 / #fx=off / 用户已关闭 → 连库都不加载。
   2) 网络：只在 window.load 之后、浏览器空闲时才拉库，不抢首屏。
      没加载出来之前就是没有特效，不排队、不补播。
      传输体积由后端 StaticCacheMiddleware 保证：636KB 源文件经 brotli 约 237KB、
      gzip 约 250KB（实测）；带 ?v= 的 URL 走 immutable 长缓存，重复访问零请求。
      改动库本体后必须同步提升 VENDOR 的版本号，否则客户端拿旧缓存。
   3) 尺寸：库内部尺寸 ∝ 画布高度（referenceHeight=1080），横屏天然正确；竖屏手机的
      短边是宽度，环相对短边会被放大两倍以上，故按「短边/高度」归一化。
   4) 触屏：库默认在 pointerdown 当场生成圆环，于是「滑动页面」起手也会冒环。
      故触屏端改用 inputSource:'manual'，自研轻点判定，只有真正轻点才 boom()。
   5) 性能：库没有 FPS 接口，自己测；关键是做归因（A/B 对照窗口），不能把页面自身
      的卡顿算到特效头上。自适应分两层，刻意把「当下这一会儿」与「这台机器长期如何」
      拆开，避免一次偶发卡顿造成长期降级：
        · 本会话内：快、可逆、不留痕。连续 2 个坏窗口才花 1 秒做对照探测（探测本身
          还有 30 秒冷却）；确认是特效开销才降一档，降下去之后若连续变好会自己爬回来。
          阶梯走完仍差 → 暂时禁用 + Toast，冷却（90 秒起、翻倍、上限 15 分钟）后自动恢复。
        · 跨会话：慢、要反复证据、没有任何永不失效的 TTL。只记每次会话达到过的最高档，
          只有「连续多次会话都降过级」才用它决定下次起步档，否则一律满血起步；
          永久关闭永远只由用户点确认触发。
      详见 TUNING、deriveStartRung、applyLevel 三处注释。
   6) 讲题互斥：进入可视化试卷全解讲题时 script.js 会调 pause()，讲题期间完全没有特效。
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- 可调阈值（全部集中在这里，便于日后调参） ---------------- */
  var TUNING = {
    libVersion: "1.3.3",
    windowMs: 1200,            // 特效活跃采样窗口
    baselineMs: 900,           // 基准帧间隔采样窗口（创建实例之前测）
    controlMs: 1000,           // A/B 对照窗口（暂停特效后测）
    dropFactor: 2.5,           // 帧间隔 > 基准 × 该倍数 记为丢帧
    minDropMs: 25,             // 丢帧的绝对下限：高刷屏（144/240Hz）基准只有 4~7ms，
                               // 只按倍数算会把 10~17ms 的普通抖动误判成卡顿；
                               // 超过 25ms（低于 40fps）才算真卡，60Hz 屏上此下限不起作用
    badRatio: 0.25,            // 丢帧率 ≥ 该值 → 这个窗口算「坏」
    confirmNeeded: 2,          // 连续这么多个坏窗口，才值得花那 1 秒做对照探测（单次抖动不触发）
    probeCooldownMs: 30 * 1000,// 两次对照探测的最小间隔：慢机器上最多每 30 秒测一次，
                               // 不会每次交互都掐掉 1 秒
    promoteGoodWindows: 5,     // 连续这么多个好窗口，且距上次档位变化够久 → 回升一档
    promoteMinIntervalMs: 60 * 1000, // 回升的最小间隔；从最低档回到满血约需 6 分钟
    cooldownMs: 90 * 1000,     // 暂时禁用的冷却期，每次翻倍（上限见下）
                               // 「临时」就是 90 秒 ~ 15 分钟这个区间，到期自动恢复
    cooldownMaxMs: 15 * 60 * 1000,
    sessionStrikes: 3,         // 本会话累计该次数 → 参与长期判定
    longTermStrikes: 3,        // 长期判定：累计 strike 下限
    longTermSessions: 2,       // 长期判定：非零 strike 的天数下限
    longTermWindowMs: 30 * 24 * 3600 * 1000,
    declineSilenceMs: 7 * 24 * 3600 * 1000,
    minWindowsForSession: 5,   // 一次会话至少要有这么多采样窗口，才计入跨会话记录
                               // （避免「打开就关」把弱机的连续记录打断）
    startRungStreak: 2,        // 连续这么多次有效会话都降过级，下次才从降级档起步
    cardAutoDismissMs: 8000,
  };

  var LS_OFF = "nbx_fx_off";        // 永久开关（将来设置窗口用的就是这把钥匙）
  var LS_PERF = "nbx_fx_perf";      // 本机性能记录（设备数据，不入线路镜像）
  var SS_OFFERED = "nbx_fx_offered"; // 本会话是否已弹过询问卡
  var VENDOR = "/static/vendor/ba-click-fx/ba-click-fx.js?v=fxlib133p2";

  /* ---------------- 调试开关（沿用 #sky=night&moon=full 的既有约定） ---------------- */
  var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  var DEBUG_BOOM = hash.get("fx") === "boom";

  /* ---------------- 状态 ---------------- */
  var fx = null;               // 库实例
  var ready = false;           // 实例已就绪
  var loading = false;
  var hardOff = false;         // 用户明确关闭 / #fx=off
  var coarse = matchMedia("(pointer: coarse)").matches;

  var perf = {
    applied: 0,          // 当前生效的降级档数（可升可降）
    rung0: 0,            // 本次会话的起步档（仅供诊断）
    strikes: 0,          // 本会话累计的「暂时禁用」次数
    baseline: 0,         // 基准帧间隔中位数
    measuring: false,
    consecutiveBad: 0,   // 连续坏窗口数（好窗口清零）
    goodWindows: 0,      // 连续好窗口数（坏窗口清零），用于回升判定
    windows: 0,          // 本会话累计完成的有效采样窗口数
    sessionMaxRung: 0,   // 本会话达到过的最高档，计入跨会话记录
    lastChangeAt: 0,     // 上次档位变化时刻（回升节流用）
    lastProbeAt: 0,      // 上次对照探测时刻（探测节流用）
    cooldown: TUNING.cooldownMs,
    disabledUntil: 0,
    hardPaused: false,   // 讲题模式：完全停用
    probePaused: false,  // A/B 对照窗口期间临时暂停
    isPaused: false,     // 当前是否处于暂停态（避免重复 clear）
    cardEl: null,
  };

  /* ---------------- 小工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  /* 本机性能记录结构（v2）：
       { v:2, strikes, strikeDays:[{day,n}], recent:[{day,maxRung,windows}], declinedAt, lastAt }
     strikeDays 供「长期性能不足」判定；recent 供「下次从哪一档起步」判定。
     v1 的 sessions 与 strikeDays 语义相同，读到时平移过来即可；
     v1 的 startRung 是旧的自续期 TTL 那套（永不失效），直接丢弃。 */
  function readPerf() {
    try {
      var o = JSON.parse(lsGet(LS_PERF) || "null");
      if (!o) return null;
      if (o.v === 1) {
        o = {
          v: 2, strikes: o.strikes || 0, strikeDays: o.sessions || [], recent: [],
          declinedAt: o.declinedAt || 0, lastAt: o.lastAt || 0,
        };
      }
      if (o.v !== 2) return null;
      if (!Array.isArray(o.strikeDays)) o.strikeDays = [];
      if (!Array.isArray(o.recent)) o.recent = [];
      return o;
    } catch (e) { return null; }
  }
  function writePerf(o) { lsSet(LS_PERF, JSON.stringify(o)); }
  function ensureRecord() {
    return readPerf() || { v: 2, strikes: 0, strikeDays: [], recent: [], declinedAt: 0, lastAt: 0 };
  }

  /* 由一次采样窗口推出「基准帧间隔」。
     两个讲究：
     1) 取偏低的分位数而不是中位数——基准窗口里偶尔撞上的卡顿不该把基准抬高；
     2) 做合理性钳制——显示器刷新是有限的（240Hz≈4ms 到 30Hz≈33ms），超出这个区间
        说明这次采样本身就不可信（例如正好撞上页面初始化、或渲染被挂起），
        此时退回 60Hz 假设。否则阈值会被抬得极高，整套检测会静默失效。 */
  function baselineFrom(samples) {
    if (!samples || samples.length < 4) return 1000 / 60;
    var s = samples.slice().sort(function (a, b) { return a - b; });
    var v = s[Math.floor((s.length - 1) * 0.2)];
    if (!(v >= 2 && v <= 34)) return 1000 / 60;
    return v;
  }

  /* 给主站/后台的 Alpine 层发通知，复用既有的 nbx:storage-full 事件范式 */
  function notify(type, msg) {
    try {
      window.dispatchEvent(new CustomEvent("nbx:fx-notice", { detail: { type: type, msg: msg } }));
    } catch (e) { /* 通知失败不影响任何逻辑 */ }
  }

  /* ---------------- 主题色：--accent 五套主题都是标准六位 hex ---------------- */
  function themeHex() {
    var cs = getComputedStyle(document.documentElement);
    var raw = (cs.getPropertyValue("--accent") || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    // 兜底：--c-glow-mouse 是 "r, g, b" 三元组
    var m = (cs.getPropertyValue("--c-glow-mouse") || "").match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      return "#" + [1, 2, 3].map(function (i) {
        return ("0" + Number(m[i]).toString(16)).slice(-2);
      }).join("");
    }
    return "#4ca7ff"; // 库默认的游戏蓝
  }

  function syncTheme() { if (fx) fx.setThemeColor(themeHex()); }

  /* ---------------- 尺寸：按「视口短边 / 视口高度」归一化 ----------------
     库内 _getScale() = config.scale × (高度 / 1080)，环外半径 = 0.14×540×1.0637 × _getScale()。
     横屏时短边就是高度，环占短边的比例天然恒定（约 15%），无需干预；
     竖屏手机的短边是宽度，同一配置下环会占到宽度的 30% 以上，必须归一化。
     触屏端再放宽 15%：指尖会盖住圆心，环略大一点才看得见。 */
  function computeScale() {
    var vh = window.innerHeight || 1;
    var short = Math.min(window.innerWidth || vh, vh);
    var base = short / vh;
    return clamp(coarse ? base * 1.15 : base, 0.45, 1);
  }

  function applyScale() {
    if (!fx) return;
    try { fx.updateConfig({ scale: computeScale() }); fx.resize(); } catch (e) { /* 老版本无此接口则忽略 */ }
  }

  var sizeRaf = 0;
  function scheduleScale() {
    if (sizeRaf) return;
    sizeRaf = requestAnimationFrame(function () { sizeRaf = 0; applyScale(); });
  }

  /* ---------------- 暂停：讲题模式 / A/B 对照 / 暂时禁用 三者统一在这里合成 ---------------- */
  function shouldPause() {
    return perf.hardPaused || perf.probePaused || Date.now() < perf.disabledUntil;
  }

  function syncPause() {
    if (!fx) return;
    var want = shouldPause();
    if (want === perf.isPaused) return;
    perf.isPaused = want;
    try { fx.setPaused(want, want ? { clear: true } : undefined); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 帧间隔测量：同一套逻辑用于基准 / 活跃窗口 / A/B 对照 ---------------- */
  function measure(ms) {
    return new Promise(function (resolve) {
      var out = [];
      var start = performance.now();
      var last = start;
      function tick(now) {
        var dt = now - last;
        last = now;
        if (dt > 0 && dt < 1000) out.push(dt); // 明显异常的超长帧（切标签页/断点）不计入
        if (now - start < ms) requestAnimationFrame(tick);
        else resolve(out);
      }
      requestAnimationFrame(tick);
    });
  }

  function droppedRatio(samples) {
    if (!samples || samples.length < 8) return 0; // 样本太少不下结论
    var base = perf.baseline > 0 ? perf.baseline : 1000 / 60;
    var limit = Math.max(base * TUNING.dropFactor, TUNING.minDropMs);
    var n = 0;
    for (var i = 0; i < samples.length; i++) if (samples[i] > limit) n++;
    return n / samples.length;
  }

  /* ---------------- 档位：从「原始参数」出发按档重放 ----------------
     每一档都写成绝对值，而不是在当前值上再乘系数。这样回升时可以先还原到创建实例时的
     原始参数、再重放前 n 档，得到的配置与当初降级时完全一致，不会因为反复乘系数而漂移。 */
  var pristine = null; // 创建实例时抓下来的原始参数与配置

  function capturePristine() {
    var f = fx.getFxConfig(), c = fx.getConfig();
    pristine = {
      bloomResolution: f.bloom.resolutionScale,
      bloomIntensity: f.bloom.intensity,
      shardMax: f.shards.maxCount,
      ringArc: f.rings.arcSamples,
      ringRadial: f.rings.radialSamples,
      maxDpr: c.maxDpr,
      trailAlways: c.trailAlways,
      effectBackend: c.effectBackend,
      bloomBackend: c.bloomBackend,
    };
  }

  function setFx(path, value) {
    try { fx.setFxParam(path, value); } catch (e) { /* 参数不存在则跳过 */ }
  }
  /* 数量/采样数这类参数必须是整数，否则严格模式会拒收 */
  function scaled(cur, factor) {
    var v = cur * factor;
    return Number.isInteger(cur) ? Math.max(1, Math.round(v)) : v;
  }

  function restorePristine() {
    if (!pristine) return;
    setFx("bloom.resolutionScale", pristine.bloomResolution);
    setFx("bloom.intensity", pristine.bloomIntensity);
    setFx("shards.maxCount", pristine.shardMax);
    setFx("rings.arcSamples", pristine.ringArc);
    setFx("rings.radialSamples", pristine.ringRadial);
    try {
      fx.updateConfig({
        maxDpr: pristine.maxDpr,
        trailAlways: pristine.trailAlways,
        effectBackend: pristine.effectBackend,
        bloomBackend: pristine.bloomBackend,
      });
      // updateConfig(maxDpr) 已调用 resize，避免重复重置画布。
    } catch (e) { /* 忽略 */ }
  }

  var RUNGS = [
    { why: "bloom 分辨率", apply: function () { setFx("bloom.resolutionScale", scaled(pristine.bloomResolution, 0.6)); } },
    {
      why: "碎片数量与辉光",
      apply: function () {
        setFx("shards.maxCount", scaled(pristine.shardMax, 0.5));
        setFx("bloom.intensity", pristine.bloomIntensity * 0.8);
      },
    },
    { why: "画布像素密度", apply: function () { try { fx.updateConfig({ maxDpr: 1 }); } catch (e) { /* 忽略 */ } } },
    {
      why: "拖尾改为按住时显示",
      apply: function () { try { fx.updateConfig({ trailAlways: false }); } catch (e) { /* 忽略 */ } },
      // 只在「降级跨过这一档」时播报；回升时重放不播报（静默变好不必打扰）
      after: function () { notify("warn", "为流畅起见，拖尾已改为按住时显示"); },
    },
    {
      why: "环的采样精度",
      apply: function () {
        setFx("rings.arcSamples", scaled(pristine.ringArc, 0.6));
        setFx("rings.radialSamples", scaled(pristine.ringRadial, 0.6));
      },
    },
    // 刻意不设「换渲染后端为 Canvas2D」档：fx-bench 实测 Canvas2D 路径狂点时
    // 每帧主线程 JS 达 74ms（p95 107ms），比 WebGL2 的亚毫秒级高约两个数量级，
    // 视觉还更差——往它降级等于越降越卡。五档参数降级走完仍差 → 直接暂时禁用。
  ];

  /* 把档位设到 n：先还原原始参数、再按序重放前 n 档。可升可降、幂等。 */
  function applyLevel(n, opts) {
    if (!fx) return;
    var prev = perf.applied;
    n = clamp(n, 0, RUNGS.length);
    restorePristine();
    for (var i = 0; i < n; i++) {
      try { RUNGS[i].apply(); } catch (e) { /* 单档失败不阻断 */ }
    }
    perf.applied = n;
    perf.goodWindows = 0;
    if (n !== prev) perf.lastChangeAt = Date.now();
    if (n > prev && RUNGS[prev] && RUNGS[prev].after) RUNGS[prev].after();
    if (perf.sessionMaxRung < n) perf.sessionMaxRung = n;
    if (!opts || !opts.silent) flushSession();
  }

  /* 阶梯走完仍不足 → 暂时禁用，冷却后自动恢复 */
  function enterTempDisabled() {
    perf.strikes++;
    perf.disabledUntil = Date.now() + perf.cooldown;
    perf.cooldown = Math.min(perf.cooldown * 2, TUNING.cooldownMaxMs);
    perf.lastChangeAt = Date.now();
    perf.goodWindows = 0;
    syncPause();
    notify("warn", "检测到设备性能不足，点击特效已暂时关闭，稍后会自动重试");
    recordStrike();
    if (perf.strikes >= TUNING.sessionStrikes) maybeOfferDisable();
    setTimeout(recoverFromTemp, Math.max(0, perf.disabledUntil - Date.now()) + 300);
  }

  function recoverFromTemp() {
    if (hardOff || !fx) return;
    perf.consecutiveBad = 0;
    perf.goodWindows = 0;
    syncPause(); // 以当前（已降级）配置恢复
  }

  /* ---------------- 长期判定：跨会话累计，条件足够才询问 ---------------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  /* ---------------- 跨会话记录：只用来决定「下次从哪一档起步」 ----------------
     规则刻意做得简单可解释，且没有任何永不失效的 TTL：
       · 每次会话记一条 { day, maxRung, windows }，采样窗口不足的会话不计入；
       · 前「连续 N 次」有效会话的 maxRung 都 ≥1 时，取它们的最小值作为起步档；
       · 否则一律从 0 档起步——先给全质量，实测不行再降（代价只是几秒钟）。
     所以一次偶发卡顿只影响当时那几分钟，下一次照旧满血起步；
     而真正弱的机器连续两次就会稳定在高档位起步，不用每次重新降一遍。 */
  function sessionEntry() {
    var rec = ensureRecord();
    var day = today();
    var last = rec.recent.length ? rec.recent[rec.recent.length - 1] : null;
    if (!last || last.day !== day) {
      last = { day: day, maxRung: 0, windows: 0 };
      rec.recent.push(last);
    }
    return { rec: rec, entry: last };
  }

  function flushSession() {
    var s = sessionEntry();
    if (perf.sessionMaxRung > s.entry.maxRung) s.entry.maxRung = perf.sessionMaxRung;
    if (perf.windows > s.entry.windows) s.entry.windows = perf.windows;
    s.rec.recent = s.rec.recent.slice(-6);
    s.rec.lastAt = Date.now();
    writePerf(s.rec);
  }

  function deriveStartRung() {
    var rec = readPerf();
    if (!rec) return 0;
    var valid = [];
    for (var i = 0; i < rec.recent.length; i++) {
      if ((rec.recent[i].windows || 0) >= TUNING.minWindowsForSession) valid.push(rec.recent[i]);
    }
    if (valid.length < TUNING.startRungStreak) return 0;
    var lowest = Infinity;
    for (var j = valid.length - TUNING.startRungStreak; j < valid.length; j++) {
      var r = valid[j].maxRung || 0;
      if (r < 1) return 0; // 有一次会话没降过级 → 不足以认定这台机器弱
      if (r < lowest) lowest = r;
    }
    return clamp(lowest, 0, RUNGS.length);
  }

  function recordStrike() {
    var rec = ensureRecord();
    rec.strikes = (rec.strikes || 0) + 1;
    rec.lastAt = Date.now();
    var day = today();
    var hit = null;
    for (var i = 0; i < rec.strikeDays.length; i++) {
      if (rec.strikeDays[i].day === day) { hit = rec.strikeDays[i]; break; }
    }
    if (hit) hit.n++;
    else rec.strikeDays.push({ day: day, n: 1 });
    rec.strikeDays = rec.strikeDays.slice(-5);
    writePerf(rec);
  }

  /* 判定「长期性能不足」：需同时满足累计次数、跨天、时效、未被拒绝 —— 缺一不可 */
  function longTermInsufficient() {
    var rec = readPerf();
    if (!rec) return false;
    if ((rec.strikes || 0) < TUNING.longTermStrikes) return false;
    var days = 0;
    for (var i = 0; i < rec.strikeDays.length; i++) if (rec.strikeDays[i].n > 0) days++;
    if (days < TUNING.longTermSessions) return false;
    if (Date.now() - (rec.lastAt || 0) > TUNING.longTermWindowMs) return false;
    if (rec.declinedAt && Date.now() - rec.declinedAt < TUNING.declineSilenceMs) return false;
    return true;
  }

  /* 非阻塞询问卡：无遮罩、不锁滚动、不抢焦点，只截获卡片自身的点击 */
  function hideCard() {
    if (perf.cardEl) { perf.cardEl.remove(); perf.cardEl = null; }
  }

  function maybeOfferDisable() {
    if (hardOff || perf.hardPaused || LongTermDisableOffered()) return false;
    if (!longTermInsufficient()) return false;
    try { sessionStorage.setItem(SS_OFFERED, "1"); } catch (e) { /* 忽略 */ }
    showCard();
    return true;
  }

  function LongTermDisableOffered() {
    try { return sessionStorage.getItem(SS_OFFERED) === "1"; } catch (e) { return false; }
  }

  function showCard() {
    if (perf.cardEl) return;
    var el = document.createElement("div");
    el.id = "fx-notice";
    el.className = "glass";
    el.setAttribute("role", "status"); // 非模态：不是 dialog，不打断用户
    el.innerHTML =
      '<div class="fx-notice-msg">检测到本机性能可能不足以流畅运行点击特效，是否关闭？</div>' +
      '<div class="fx-notice-acts">' +
        '<button type="button" class="btn-primary fx-notice-yes">关闭特效</button>' +
        '<button type="button" class="btn-ghost fx-notice-no">忽略</button>' +
      '</div>';
    document.body.appendChild(el);
    perf.cardEl = el; // 进场动画由 styles.css 里 #fx-notice 的 CSS animation 负责

    var timer = setTimeout(function () { hideCard(); }, TUNING.cardAutoDismissMs);
    function done() { clearTimeout(timer); hideCard(); }

    el.querySelector(".fx-notice-yes").addEventListener("click", function () {
      var rec = readPerf();
      if (rec) { rec.lastAt = Date.now(); writePerf(rec); }
      API.disable();
      done();
    });
    el.querySelector(".fx-notice-no").addEventListener("click", function () {
      var rec = readPerf() || { v: 1, strikes: 0, sessions: [], startRung: 0, lastAt: 0 };
      rec.declinedAt = Date.now();
      writePerf(rec);
      done();
    });
  }

  /* ---------------- 采样窗口与归因 ---------------- */
  function armSampler() {
    if (!ready || perf.hardPaused || perf.measuring) return;
    if (Date.now() < perf.disabledUntil) return;
    perf.measuring = true;
    measure(TUNING.windowMs).then(function (samples) {
      perf.measuring = false;
      evaluate(samples);
    });
  }

  /* 一个采样窗口结束后的判定。顺序刻意是「先攒证据、再花那 1 秒」：
     单次抖动既不探测也不降级，确认持续变差才暂停特效做 A/B 对照，
     把「特效的开销」与「页面自身的卡顿」区分开——既不冤枉特效，也不放过真问题。 */
  function evaluate(samples) {
    if (!ready || hardOff || perf.hardPaused) return;
    perf.windows++;
    if (perf.windows % 5 === 0) flushSession();

    var ratio = droppedRatio(samples);
    if (ratio < TUNING.badRatio) {
      perf.consecutiveBad = 0;
      perf.goodWindows++;
      maybePromote();
      return;
    }

    perf.goodWindows = 0;
    perf.consecutiveBad++;
    if (perf.consecutiveBad < TUNING.confirmNeeded) return;
    // 探测也要节流：慢机器上最多每 30 秒花那 1 秒，不会每次交互都掐一下
    if (Date.now() - perf.lastProbeAt < TUNING.probeCooldownMs) return;

    perf.measuring = true; // 对照窗口期间不允许再开新窗口（否则并发 measure 会重复判定）
    perf.probePaused = true;
    perf.lastProbeAt = Date.now();
    syncPause();
    measure(TUNING.controlMs).then(function (control) {
      perf.probePaused = false;
      syncPause();
      perf.measuring = false;
      if (!ready || hardOff || perf.hardPaused) return;

      if (droppedRatio(control) >= TUNING.badRatio) {
        // 对照也差 → 是页面/环境此刻在卡（正在生成、后台在跑别的），不冤枉特效
        perf.consecutiveBad = 0;
        return;
      }
      perf.consecutiveBad = 0;
      if (perf.applied >= RUNGS.length) enterTempDisabled();
      else applyLevel(perf.applied + 1);
    });
  }

  /* 连续好窗口够多、且距上次档位变化够久 → 升回一档。
     这是「偶发卡顿不会留下长期影响」的关键：降下去会自己爬回来。 */
  function maybePromote() {
    if (perf.applied <= 0) return;
    if (perf.goodWindows < TUNING.promoteGoodWindows) return;
    if (Date.now() - perf.lastChangeAt < TUNING.promoteMinIntervalMs) return;
    perf.goodWindows = 0;
    applyLevel(perf.applied - 1);
  }

  /* ---------------- 触屏轻点判定 ----------------
     不做则「滑动页面」的起手也会冒环。这里只认「按下→抬起在 350ms 内且位移 <10px」，
     滚动 / 翻页 / 长按都不触发。监听一律 capture + passive，绝不 preventDefault。

     onlyTouch：dom 模式下库自己会处理鼠标与触控笔，若这里再兜一遍，同一次点击会出
     两套特效（库的点击 + 这里的 boom），所以那种情况只接被 inputFilter 挡掉的触摸。 */
  function installTapDetector(onlyTouch) {
    var tap = null;
    addEventListener("pointerdown", function (e) {
      if (onlyTouch && e.pointerType !== "touch") return;
      if (!e.isPrimary) return;
      tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { capture: true, passive: true });
    addEventListener("pointerup", function (e) {
      if (!tap || e.pointerId !== tap.id) return;
      var dt = performance.now() - tap.t;
      var dist = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      var x = tap.x, y = tap.y;
      tap = null;
      if (dt > 350 || dist > 10) return;
      // 全屏覆盖层下画布原点 = 视口原点，故 clientX/Y 即 boom() 要的画布局部 CSS 像素
      if (fx && !shouldPause()) { try { fx.boom(x, y); } catch (e2) { /* 忽略 */ } }
    }, { capture: true, passive: true });
    addEventListener("pointercancel", function () { tap = null; }, { capture: true, passive: true });
  }

  /* ---------------- 实例创建 ---------------- */
  function initialRung() {
    var forced = parseInt(hash.get("rung"), 10);
    if (Number.isFinite(forced)) return clamp(forced, 0, RUNGS.length);
    // 跨会话只在「连续多次都降过级」时才给降级起步，见 deriveStartRung
    var learned = deriveStartRung();
    if (learned > 0) return learned;
    // 设备粗档：弱机先从第 1 档起步，少挨一次卡；之后仍按实测继续走（且能回升）
    var cores = navigator.hardwareConcurrency || 8;
    var mem = Number(navigator.deviceMemory || 8);
    return (cores <= 4 || mem <= 4) ? 1 : 0;
  }

  function create(BAClickFX) {
    fx = new BAClickFX({
      // 不传 target = 全屏 fixed 覆盖层（项目是 h-dvh + 面板内滚动，fixed 才对）
      outputCompositing: "browser-overlay",
      hostCompositing: "screen",          // 官方对普通网页的推荐组合；浅色底上比 plus-lighter 稳
      hostCompositingSurface: "dom-backdrop",
      themeColor: themeHex(),
      clickEnabled: true,                 // 点击反馈由本库接管（bgfx 的涟漪已同时停发）
      trailEnabled: true,
      trailAlways: true,                  // 恒定拖尾：不按鼠标，移动即出
      scale: computeScale(),
      inputSource: coarse ? "manual" : "dom",
      // 精细指针端：混血设备（触屏笔记本）的 touch 交给下面的轻点判定，避免滑动起手冒环
      inputFilter: coarse ? undefined : function (e) { return e.pointerType !== "touch"; },
      maxDpr: coarse ? 1 : 2,             // 库默认 1；桌面端提到 2 与 bgfx 观感一致
    });

    ready = true;
    perf.isPaused = false;
    capturePristine(); // 先抓原始参数，之后按档重放与回升还原都以它为准
    applyLevel(initialRung(), { silent: true }); // 起步档（可能是连续降级会话推出的档位）
    perf.rung0 = perf.applied;
    if (perf.applied > 0) flushSession(); // 起步就带档位 → 让本次会话被计入跨会话记录
    // 触屏可能性的两种来源：
    //   coarse —— 主指针就是触摸（手机/平板），走 manual 模式，库没有任何指针监听，
    //             所以三种指针都由轻点判定兜底（外接鼠标因此只有点击、没有拖尾）。
    //   maxTouchPoints>0 —— 「精细指针 + 触屏」的混血设备（触屏笔记本），走 dom 模式；
    //             库负责鼠标与触控笔，触摸被 inputFilter 挡掉，这里只补触摸这一类，
    //             否则同一次点击会被库和这里各处理一遍，出两套特效。
    if (coarse) installTapDetector(false);
    else if ((navigator.maxTouchPoints || 0) > 0) installTapDetector(true);

    // 主题跟随：观察 html 的 data-theme / data-sky，因此不必改动 script.js 的换肤逻辑
    try {
      new MutationObserver(syncTheme).observe(document.documentElement, {
        attributes: true, attributeFilter: ["data-theme", "data-sky"],
      });
    } catch (e) { /* 老浏览器无 MutationObserver 时仅换肤不同步 */ }
    addEventListener("resize", scheduleScale);
    addEventListener("orientationchange", scheduleScale);

    // 精细指针端由库自己监听 pointermove；这里只为采样窗口「上膛」
    addEventListener("pointermove", armSampler, { capture: true, passive: true });
    addEventListener("pointerdown", armSampler, { capture: true, passive: true });

    // 页面离开前把本次会话的档位落盘，别因为直接关标签页而丢掉
    addEventListener("visibilitychange", function () { if (document.hidden) flushSession(); });
    addEventListener("pagehide", function () { flushSession(); });

    if (DEBUG_BOOM) setTimeout(function () { API.boom(); }, 60);
  }

  /* ---------------- 闸门与懒加载 ---------------- */
  function eligible() {
    if (hash.get("fx") === "off") return false;
    if (lsGet(LS_OFF) === "1") return false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    var c = navigator.connection;
    if (c && (c.saveData || /^(slow-)?2g$/.test(c.effectiveType || ""))) return false;
    return true;
  }

  function boot() {
    if (hardOff || ready || loading) return;
    if (!eligible()) { hardOff = true; return; }
    loading = true;
    // 先量基准帧间隔（此时实例还没创建，且页面已 load 完，噪声最小），再拉库
    measure(TUNING.baselineMs).then(function (samples) {
      perf.baseline = baselineFrom(samples);
      return import(VENDOR);
    }).then(function (mod) {
      loading = false;
      if (hardOff) return;
      if (!mod || !mod.BAClickFX) return;
      create(mod.BAClickFX);
    }).catch(function () {
      // 加载失败静默降级、不重试、绝不阻塞业务（与 thumbmark 的既有约定一致）
      loading = false;
    });
  }

  /* ---------------- 对外接口（含将来设置窗口要用的开关） ---------------- */
  var API = {
    get: function () { return fx; },
    state: function () {
      if (hardOff) return "off";
      if (perf.hardPaused) return "paused";
      if (!fx) return loading ? "loading" : "idle";
      return perf.applied > 0 ? "degraded" : "ready";
    },
    /* 诊断：帧基准、当前档位、会话计数、跨会话记录 */
    perf: function () {
      return {
        baselineMs: perf.baseline, appliedRung: perf.applied, startRung: perf.rung0,
        goodWindows: perf.goodWindows, windows: perf.windows,
        sessionMaxRung: perf.sessionMaxRung, consecutiveBad: perf.consecutiveBad,
        strikes: perf.strikes, scale: computeScale(), coarse: coarse,
        tempDisabledUntil: perf.disabledUntil,
        lastProbeAt: perf.lastProbeAt, lastChangeAt: perf.lastChangeAt,
        record: readPerf(),
      };
    },
    /* 讲题模式互斥：进入讲题 pause()，退出 resume()（幂等） */
    pause: function () {
      perf.hardPaused = true;
      hideCard();
      syncPause();
    },
    resume: function () {
      perf.hardPaused = false;
      syncPause();
    },
    boom: function (x, y) {
      if (!fx || shouldPause() || hardOff) return;
      var w = window.innerWidth, h = window.innerHeight;
      try {
        fx.boom(
          typeof x === "number" ? x : w / 2,
          typeof y === "number" ? y : h / 2
        );
      } catch (e) { /* 忽略 */ }
    },
    /* 永久关闭 / 重新启用 —— 将来设置窗口的开关就是这两个 */
    disable: function () {
      lsSet(LS_OFF, "1");
      hardOff = true;
      hideCard();
      perf.hardPaused = true;
      if (fx) { try { fx.destroy(); } catch (e) { /* 忽略 */ } fx = null; }
      ready = false;
    },
    enable: function () {
      try { localStorage.removeItem(LS_OFF); } catch (e) { /* 忽略 */ }
      hardOff = false;
      perf.hardPaused = false;
      perf.strikes = 0;
      perf.consecutiveBad = 0;
      perf.goodWindows = 0;
      perf.windows = 0;
      perf.cooldown = TUNING.cooldownMs;
      perf.disabledUntil = 0;
      syncPause(); // 必须把暂停态同步回库：否则从暂时禁用/关闭状态重新启用时，特效会一直停着
      boot();
    },
    TUNING: TUNING,
    version: TUNING.libVersion,
  };
  window.NbxClickFx = API;

  /* ---------------- 启动：只在 load 之后、浏览器空闲时拉，不抢首屏 ---------------- */
  function schedule() {
    if ("requestIdleCallback" in window) requestIdleCallback(boot, { timeout: 4000 });
    else setTimeout(boot, 1500);
  }
  if (document.readyState === "complete") schedule();
  else addEventListener("load", schedule, { once: true });
})();
