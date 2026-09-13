/* ============================================================
   NeoBangX · 可视化讲解单文件运行时（导出产物专用）
   无依赖、无网络：读取 #vp-data 的 JSON，在 #vp-cover / #vp-present 里
   渲染封面与全屏讲台。所有文本一律用 textContent 写入，不拼 HTML。
   交互与 App 内「全屏讲题」对齐：左右键/空格翻题、遮答案、题目总览、
   控制台自动隐藏与唤出、5 套主题实时切换、触屏左右滑动、浏览器全屏。
   ============================================================ */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var THEME_KEY = "nbx_vp_theme";
  var HIDE_DELAY = 4000;

  /* ---------------- 数据 ---------------- */
  var DATA = {};
  try { DATA = JSON.parse(($("vp-data") && $("vp-data").textContent) || "{}") || {}; } catch (e) { DATA = {}; }

  var TITLE = str(DATA.title) || "可视化试卷讲解";
  var PAPER = DATA.paper || {};
  var NOTICE = str(DATA.notice);
  var ANSWER_MAP = DATA.answerMap || {};
  var TOTAL = Number(DATA.total) > 0 ? Number(DATA.total) : 0;

  var GROUPS = [];
  var FLAT = [];
  (DATA.groups || []).forEach(function (g) {
    if (!g) return;
    var qs = (g.questions || []).filter(Boolean);
    if (!qs.length) return;
    var gi = GROUPS.length;
    GROUPS.push({ title: str(g.title), intro: str(g.intro), questions: qs });
    qs.forEach(function (q, qi) { FLAT.push({ gi: gi, qi: qi, group: g, q: q }); });
  });
  if (!TOTAL) TOTAL = FLAT.length;

  /* 分组内坐标 → 扁平题号（与 FLAT 的构建顺序一致） */
  function flatIndexOf(gi, qi) {
    var n = 0;
    for (var i = 0; i < gi && i < GROUPS.length; i++) n += GROUPS[i].questions.length;
    return n + qi;
  }

  var THEMES = [
    { id: "paper", name: "宣纸", dot: "linear-gradient(135deg,#b4502a,#8c3316)" },
    { id: "celadon", name: "青瓷", dot: "linear-gradient(135deg,#0e6e5f,#0a5245)" },
    { id: "obsidian", name: "曜石", dot: "linear-gradient(135deg,#e9a15b,#cf7038)" },
    { id: "jade", name: "墨翠", dot: "linear-gradient(135deg,#5cb787,#2f8a66)" },
    { id: "sora", name: "悠空", dot: "linear-gradient(160deg,#6fa8d8 0%,#a8cbe8 55%,#eef6fc 100%)" },
  ];
  var FEATURES = [
    { icon: "target", name: "参考答案", desc: "证据 · 推理 · 干扰项" },
    { icon: "lightbulb", name: "易错点", desc: "失分原因逐条拆解" },
    { icon: "route", name: "考点范式", desc: "解题步骤可迁移" },
    { icon: "puzzle", name: "迁移训练", desc: "同构新题即时练" },
  ];
  var state = {
    view: "cover",
    cur: 0,
    tab: "reference",
    mask: false,
    overview: false,
    pinned: false,
    topHidden: false,
    bottomHidden: false,
    theme: "paper",
  };

  /* ---------------- DOM 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function str(v) { return v == null ? "" : String(v); }
  function has(v) { return str(v).trim().length > 0; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = str(text);
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function svgUse(name) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "vp-ic");
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(SVGNS, "use");
    u.setAttribute("href", "#i-" + name);
    s.appendChild(u);
    return s;
  }
  function setIcon(btn, name) {
    clear(btn);
    btn.appendChild(svgUse(name));
  }
  function noop() {}

  /* ---------------- 行内格式（与 frontend/script.js 的 vpFmt 保持一致） ----------------
     存储里是 **加粗** 与 ==高亮==，这里渲染成排版效果：先转义再套标签，无注入面。 */
  function vpInlineParts(text) {
    var s = String(text == null ? "" : text);
    var parts = [];
    var buf = "";
    var i = 0;
    var pushBuf = function () { if (buf) { parts.push({ k: "t", v: buf }); buf = ""; } };
    while (i < s.length) {
      var marker = "";
      if (s.startsWith("**", i)) marker = "**";
      else if (s.startsWith("==", i)) marker = "==";
      if (!marker) { buf += s[i]; i += 1; continue; }
      var end = s.indexOf(marker, i + 2);
      if (end === -1) { i += 2; continue; }
      var inner = s.slice(i + 2, end);
      if (!inner.trim() || inner.includes(marker)) { i += 2; continue; }
      pushBuf();
      parts.push({ k: marker === "**" ? "b" : "m", v: inner });
      i = end + 2;
    }
    pushBuf();
    return parts;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function vpFmt(text) {
    return vpInlineParts(text).map(function (p) {
      if (p.k === "b") return "<b>" + vpFmt(p.v) + "</b>";
      if (p.k === "m") return '<mark class="vp-hl">' + vpFmt(p.v) + "</mark>";
      return esc(p.v);
    }).join("");
  }
  function vpDetag(text) {
    return vpInlineParts(text).map(function (p) { return p.v; }).join("");
  }
  function setRich(node, text) {
    if (node) node.innerHTML = vpFmt(text);
    return node;
  }

  /* ---------------- 元素引用 ---------------- */
  var cover = $("vp-cover"), present = $("vp-present"), stage = $("st-stage");
  var cvPaper = $("cv-paper"), cvTitle = $("cv-title"), cvFeatures = $("cv-features"),
      cvMeta = $("cv-meta"), cvNotice = $("cv-notice"), cvStart = $("cv-start"),
      cvFs = $("cv-fs"), cvThemes = $("cv-themes");
  var leftPane = $("vp-left"), rightPane = $("vp-right"), tabPanel = $("q-tab"),
      ansList = $("ans-list"), ansMap = $("ans-map");
  var stTitle = $("st-title"), stPos = $("st-pos"), stGroup = $("st-group"),
      stThemes = $("st-themes"), stFs = $("st-fs"), stCover = $("st-cover");
  var navPrev = $("nav-prev"), navNext = $("nav-next"), dockPos = $("dock-pos"),
      dockMask = $("dock-mask"), dockOverview = $("dock-overview"), dockPin = $("dock-pin");
  var ovMask = $("ov-mask"), ovPanel = $("ov-panel"), ovBody = $("ov-body"),
      ovCount = $("ov-count"), ovClose = $("ov-close");
  var wakeTopBtn = $("wake-top"), wakeBottomBtn = $("wake-bottom");
  var tabsWrap = $("q-tabs");

  /* ---------------- 主题 ---------------- */
  var dotNodes = [];
  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }
  function skyOf(id) {
    if (id !== "sora") return "";
    var h = new Date().getHours();
    return h >= 6 && h < 22 ? "day" : "night";
  }
  function applyTheme(id, persist) {
    var t = themeById(id) || themeById("paper");
    state.theme = t.id;
    var root = document.documentElement;
    root.dataset.theme = t.id;
    var sky = skyOf(t.id);
    if (sky) root.dataset.sky = sky; else root.removeAttribute("data-sky");
    if (persist) { try { localStorage.setItem(THEME_KEY, t.id); } catch (e) {} }
    syncThemeDots();
  }
  function savedTheme() { try { return localStorage.getItem(THEME_KEY) || ""; } catch (e) { return ""; } }
  function buildThemeDots(container) {
    THEMES.forEach(function (t) {
      var b = el("button", "theme-dot" + (t.id === "sora" ? " theme-dot-sora" : ""));
      b.type = "button";
      b.style.background = t.dot;
      b.title = t.name;
      b.setAttribute("aria-label", "切换到" + t.name + "主题");
      b.addEventListener("click", function () { applyTheme(t.id, true); });
      container.appendChild(b);
      dotNodes.push({ id: t.id, node: b });
    });
  }
  function syncThemeDots() {
    dotNodes.forEach(function (d) {
      var on = d.id === state.theme;
      d.node.classList.toggle("on", on);
      d.node.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------------- 浏览器全屏 ---------------- */
  function fsAvailable() { return typeof document.documentElement.requestFullscreen === "function"; }
  function requestFs() {
    if (!fsAvailable() || document.fullscreenElement) return;
    try {
      var p = document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(noop);
    } catch (e) {}
  }
  function exitFs() {
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      var p = document.exitFullscreen();
      if (p && p.catch) p.catch(noop);
    } catch (e) {}
  }
  function toggleFs() { if (document.fullscreenElement) exitFs(); else requestFs(); }
  function syncFsButtons() {
    var inFs = !!document.fullscreenElement;
    [cvFs, stFs].forEach(function (btn) {
      if (!btn) return;
      setIcon(btn, inFs ? "compress" : "expand");
      var label = inFs ? "退出全屏" : "进入全屏";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    });
  }

  /* ---------------- 封面 ---------------- */
  function buildCover() {
    cvPaper.textContent = has(PAPER.title) ? vpDetag(PAPER.title) : "";
    cvPaper.hidden = !has(PAPER.title);
    setRich(cvTitle, TITLE);
    setRich(stTitle, TITLE);

    clear(cvFeatures);
    FEATURES.forEach(function (f) {
      var card = el("div", "cv-feature");
      var ic = svgUse(f.icon);
      ic.classList.add("cv-feature-ic");
      card.appendChild(ic);
      var box = el("div");
      box.appendChild(el("div", "cv-feature-name", f.name));
      box.appendChild(el("div", "cv-feature-desc", f.desc));
      card.appendChild(box);
      cvFeatures.appendChild(card);
    });

    var bits = [];
    bits.push("共 " + FLAT.length + " 题");
    if (GROUPS.length) bits.push(GROUPS.length + " 个大题");
    if (has(PAPER.subject)) bits.push(PAPER.subject);
    if (has(PAPER.year)) bits.push(PAPER.year);
    cvMeta.textContent = bits.join(" · ");
    setRich(cvNotice, NOTICE);
    cvNotice.hidden = !NOTICE;
    cvStart.disabled = !FLAT.length;
    document.title = vpDetag(TITLE);
  }

  /* ---------------- 讲台 ---------------- */
  function syncOverviewActive() {
    var chips = ovBody.querySelectorAll(".vp-overview-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("active", Number(chips[i].dataset.flat) === state.cur);
    }
  }
  function buildAnswerMap() {
    clear(ansList);
    var keys = Object.keys(ANSWER_MAP);
    ansMap.hidden = !keys.length;
    keys.forEach(function (no) {
      var label = no + ": " + vpDetag(ANSWER_MAP[no]);
      var chip = el("span", "chip neutral vp-ans-chip ans", label);
      chip.title = label;
      ansList.appendChild(chip);
    });
  }
  function optionCard(opt, answer, masked) {
    var correct = has(answer) && str(opt.label) === str(answer);
    var card = el("div", "vp-option-card" + (correct ? " correct" : "") + (correct && masked ? " masked" : ""));
    card.dataset.correct = correct ? "1" : "0";
    card.appendChild(el("span", "vp-option-label", str(opt.label)));
    card.appendChild(setRich(el("span", "vp-option-text"), opt.text));
    return card;
  }
  function renderTab() {
    clear(tabPanel);
    var cur = FLAT[state.cur];
    if (!cur) return;
    var q = cur.q;
    tabPanel.hidden = false;
    tabsWrap.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === state.tab);
      if (b.dataset.tab === "transfer") {
        var off = !q.transfer;
        b.disabled = off;
        b.title = off ? "写作题不设迁移训练" : "";
      }
    });

    if (state.tab === "reference") {
      var head = el("div", "vp-tab-title");
      head.appendChild(document.createTextNode("参考答案"));
      if (has(q.answer)) head.appendChild(el("span", "vp-tab-sub ans", "答案：" + str(q.answer)));
      tabPanel.appendChild(head);
      if (q.reference) {
        var lines = el("div", "vp-lines");
        [["证据：", q.reference.evidence], ["推理：", q.reference.reason], ["干扰项：", q.reference.distractor]]
          .forEach(function (pair) {
            if (!has(pair[1])) return;
            var line = el("div", "vp-line");
            line.appendChild(el("span", "semibold", pair[0]));
            line.appendChild(setRich(el("span"), pair[1]));
            lines.appendChild(line);
          });
        tabPanel.appendChild(lines);
        if (!lines.childNodes.length) tabPanel.appendChild(el("div", "vp-line dim", "暂无参考答案"));
      } else {
        tabPanel.appendChild(el("div", "vp-line dim", "暂无参考答案"));
      }
      return;
    }

    if (state.tab === "pitfalls") {
      tabPanel.appendChild(el("div", "vp-tab-title", "易错点分析"));
      var list = (q.pitfalls || []).filter(Boolean);
      if (!list.length) {
        tabPanel.appendChild(el("div", "vp-line dim", "暂无易错点分析"));
        return;
      }
      var box = el("div", "vp-pitfall-list");
      list.forEach(function (p, i) {
        var item = el("div", "vp-pitfall-item");
        item.appendChild(setRich(el("div", "vp-pitfall-title"), (i + 1) + ". " + str(p.title)));
        item.appendChild(setRich(el("div", "vp-pitfall-desc"), p.desc));
        box.appendChild(item);
      });
      tabPanel.appendChild(box);
      return;
    }

    if (state.tab === "pattern") {
      tabPanel.appendChild(el("div", "vp-tab-title", "考点范式归纳"));
      var ptn = q.pattern || {};
      var pline = el("div", "vp-line");
      pline.appendChild(el("span", "semibold", "范式："));
      pline.appendChild(setRich(el("span", "ans"), ptn.name));
      tabPanel.appendChild(pline);
      var steps = (ptn.steps || []).filter(has);
      if (steps.length) {
        var ol = el("ol", "vp-steps");
        steps.forEach(function (s) { ol.appendChild(setRich(el("li", "vp-line"), s)); });
        tabPanel.appendChild(ol);
      }
      return;
    }

    /* transfer */
    var tr = q.transfer;
    if (!tr) {
      tabPanel.appendChild(el("div", "vp-line dim", q.qtype === "writing"
        ? "该题为写作题，不设迁移训练。请查看“参考答案”中的范文与框架。"
        : "该题暂无迁移训练内容。"));
      return;
    }
    var thead = el("div", "vp-tab-title");
    thead.appendChild(document.createTextNode("迁移训练 "));
    thead.appendChild(el("span", "vp-tab-sub", "（同构新题，话题不同 · 范式相同）"));
    tabPanel.appendChild(thead);
    var card = el("div", "glass-soft vp-card");
    if (has(tr.passage)) card.appendChild(setRich(el("div", "vp-pre vp-line mb2"), tr.passage));
    if (has(tr.stem)) card.appendChild(setRich(el("div", "semibold vp-line mb2"), tr.stem));
    var grid = el("div", "vp-options-grid");
    (tr.options || []).filter(Boolean).forEach(function (opt) {
      grid.appendChild(optionCard(opt, tr.answer, state.mask));
    });
    if (grid.childNodes.length) card.appendChild(grid);
    var foot = el("div", "vp-transfer-foot");
    var ansline = el("div", "vp-line");
    ansline.appendChild(setRich(el("span", "semibold ans"), "答案：" + str(tr.answer)));
    foot.appendChild(ansline);
    if (has(tr.explanation)) foot.appendChild(setRich(el("div", "vp-line dim"), tr.explanation));
    card.appendChild(foot);
    tabPanel.appendChild(card);
  }
  function renderQuestion() {
    var cur = FLAT[state.cur];
    if (!cur) return;
    var q = cur.q, group = cur.group;
    var pos = state.cur + 1;

    stPos.textContent = "第 " + pos + " / " + FLAT.length + " 题";
    setRich(stGroup, group.title);
    stGroup.hidden = !has(group.title);
    dockPos.textContent = pos + " / " + FLAT.length;
    navPrev.disabled = state.cur <= 0;
    navNext.disabled = state.cur >= FLAT.length - 1;

    $("q-no").textContent = "第 " + str(q.no) + " 题";
    $("q-type-blank").hidden = q.qtype !== "blank";
    $("q-type-writing").hidden = q.qtype !== "writing";
    setRich($("q-group"), group.title);
    $("q-pos").textContent = pos + " / " + FLAT.length;
    setRich($("q-stem"), q.stem);

    /* 语篇（写作题/语法填空可能无独立语篇） */
    var passage = $("q-passage");
    setRich(passage, q.passage);
    passage.hidden = !has(q.passage);
    $("q-nopassage").hidden = has(q.passage);

    /* 选项 */
    var opts = $("q-options");
    clear(opts);
    (q.options || []).filter(Boolean).forEach(function (opt) {
      opts.appendChild(optionCard(opt, q.answer, state.mask));
    });
    opts.hidden = !opts.childNodes.length;

    /* 写作指导 */
    var wg = q.writingGuide;
    var wbox = $("q-writing");
    wbox.hidden = !wg;
    if (wg) {
      setRich($("q-writing-points"), "审题要点：" + ((wg.points || []).filter(has).join("；")));
      setRich($("q-writing-outline"), "结构框架：" + str(wg.outline));
      setRich($("q-writing-sample"), wg.sample);
    }

    renderTab();
    syncMask();
    syncOverviewActive();
  }

  function setIndex(i, keepTab) {
    if (!FLAT.length) return;
    var n = Math.max(0, Math.min(i, FLAT.length - 1));
    state.cur = n;
    if (!keepTab) state.tab = "reference";
    renderQuestion();
    leftPane.scrollTop = 0;
    rightPane.scrollTop = 0;
    scheduleHide();
  }
  function goNext() { if (state.cur < FLAT.length - 1) setIndex(state.cur + 1); }
  function goPrev() { if (state.cur > 0) setIndex(state.cur - 1); }

  /* ---------------- 遮答案 ---------------- */
  function syncMask() {
    leftPane.classList.toggle("mask-answers", state.mask);
    tabPanel.classList.toggle("mask-answers", state.mask);
    var cards = rightPane.querySelectorAll(".vp-option-card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle("masked", state.mask && cards[i].dataset.correct === "1");
    }
    var chips = ovBody.querySelectorAll(".vp-q-chip-ans");
    for (var j = 0; j < chips.length; j++) chips[j].classList.toggle("masked", state.mask);
    dockMask.classList.toggle("on", state.mask);
    var label = state.mask ? "显示答案" : "隐藏答案";
    dockMask.title = label;
    dockMask.setAttribute("aria-label", label);
    setIcon(dockMask, state.mask ? "eye-off" : "eye");
  }
  function toggleMask() { state.mask = !state.mask; syncMask(); }

  /* ---------------- 控制台自动隐藏 ---------------- */
  var hideTimer = null;
  function scheduleHide() {
    if (state.view !== "present" || state.pinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (state.view !== "present" || state.pinned || state.overview) return;
      state.topHidden = true;
      state.bottomHidden = true;
      applyChrome();
    }, HIDE_DELAY);
  }
  function stopHide() { clearTimeout(hideTimer); hideTimer = null; }
  function wakeTop() { state.topHidden = false; applyChrome(); scheduleHide(); }
  function wakeBottom() { state.bottomHidden = false; applyChrome(); scheduleHide(); }
  function applyChrome() {
    stage.classList.toggle("top-hidden", state.topHidden);
    stage.classList.toggle("bottom-hidden", state.bottomHidden);
    wakeTopBtn.classList.toggle("show", state.topHidden && !state.overview);
    wakeBottomBtn.classList.toggle("show", state.bottomHidden && !state.overview);
    dockOverview.classList.toggle("on", state.overview);
    dockPin.classList.toggle("on", state.pinned);
    var pinLabel = state.pinned ? "取消固定（恢复自动隐藏）" : "固定控制台（不再自动隐藏）";
    dockPin.title = pinLabel;
    dockPin.setAttribute("aria-label", pinLabel);
    setIcon(dockPin, "pin");
  }
  function togglePin() {
    state.pinned = !state.pinned;
    if (state.pinned) { state.topHidden = false; state.bottomHidden = false; stopHide(); }
    else scheduleHide();
    applyChrome();
  }

  /* ---------------- 题目总览 ---------------- */
  function buildOverview() {
    clear(ovBody);
    GROUPS.forEach(function (g, gi) {
      var wrap = el("div", "vp-overview-group");
      var head = el("div", "vp-overview-group-title");
      head.appendChild(setRich(el("span", "vp-gname"), g.title));
      head.appendChild(el("span", "t-xs faint", g.questions.length + " 题"));
      wrap.appendChild(head);
      if (has(g.intro)) wrap.appendChild(setRich(el("div", "t-xs dim vp-overview-intro"), g.intro));
      var grid = el("div", "vp-overview-grid");
      g.questions.forEach(function (q, qi) {
        var flat = flatIndexOf(gi, qi);
        var chip = el("button", "vp-overview-chip");
        chip.type = "button";
        chip.dataset.flat = String(flat);
        chip.appendChild(el("span", null, str(q.no)));
        if (has(q.answer)) {
          var a = el("span", "vp-q-chip-ans" + (state.mask ? " masked" : ""), vpDetag(q.answer));
          chip.appendChild(a);
        }
        chip.addEventListener("click", function () {
          toggleOverview(false);
          setIndex(flat);
        });
        grid.appendChild(chip);
      });
      wrap.appendChild(grid);
      ovBody.appendChild(wrap);
    });
    if (TOTAL > FLAT.length) {
      var ph = el("div", "vp-overview-placeholders");
      ph.appendChild(el("span", "t-xs faint", "未生成"));
      for (var i = FLAT.length + 1; i <= TOTAL; i++) ph.appendChild(el("span", "vp-overview-ph", i));
      ovBody.appendChild(ph);
    }
    ovCount.textContent = "共 " + FLAT.length + " 题" + (TOTAL > FLAT.length ? " / " + TOTAL : "");
  }
  function toggleOverview(open) {
    state.overview = open == null ? !state.overview : !!open;
    ovMask.hidden = !state.overview;
    ovPanel.hidden = !state.overview;
    if (state.overview) {
      state.topHidden = false;
      state.bottomHidden = false;
      stopHide();
      buildOverview();
      syncOverviewActive();
      var active = ovBody.querySelector(".vp-overview-chip.active");
      if (active) ovBody.scrollTop = active.offsetTop - ovBody.clientHeight / 2 + active.clientHeight / 2;
      else ovBody.scrollTop = 0;
    } else {
      scheduleHide();
    }
    applyChrome();
  }

  /* ---------------- 视图切换 ---------------- */
  function startPresentation() {
    if (!FLAT.length) return;
    state.view = "present";
    cover.hidden = true;
    present.hidden = false;
    state.tab = "reference";
    state.cur = 0;
    renderQuestion();
    syncMask();
    applyChrome();
    scheduleHide();
    /* 开始讲解是一个用户手势，此刻请求浏览器全屏最稳妥（失败静默） */
    requestFs();
  }
  function backToCover() {
    state.view = "cover";
    present.hidden = true;
    cover.hidden = false;
    toggleOverview(false);
    stopHide();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    cvStart.addEventListener("click", startPresentation);
    cvFs.addEventListener("click", toggleFs);
    stFs.addEventListener("click", toggleFs);
    stCover.addEventListener("click", backToCover);
    navPrev.addEventListener("click", goPrev);
    navNext.addEventListener("click", goNext);
    dockMask.addEventListener("click", toggleMask);
    dockOverview.addEventListener("click", function () { toggleOverview(); });
    ovClose.addEventListener("click", function () { toggleOverview(false); });
    ovMask.addEventListener("click", function () { toggleOverview(false); });
    wakeTopBtn.addEventListener("click", wakeTop);
    wakeBottomBtn.addEventListener("click", wakeBottom);
    dockPin.addEventListener("click", togglePin);

    tabsWrap.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tab]");
      if (!b || b.disabled) return;
      state.tab = b.dataset.tab;
      renderTab();
      syncMask();
    });

    document.addEventListener("fullscreenchange", syncFsButtons);

    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      if (state.view === "cover") {
        if ((e.key === "Enter" || e.key === " ") && tag !== "BUTTON") {
          e.preventDefault();
          startPresentation();
        }
        return;
      }
      if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goNext(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goPrev(); }
      else if (e.key === "Escape") {
        if (document.fullscreenElement) return;   /* 交给浏览器退出全屏 */
        backToCover();
      }
    });

    /* 指针活动：顶缘唤出顶栏；点击唤出两侧；均重置自动隐藏计时 */
    document.addEventListener("pointermove", function (e) {
      if (state.view !== "present") return;
      if (e.clientY != null && e.clientY <= 12 && state.topHidden) wakeTop();
      else scheduleHide();
    }, { passive: true });
    document.addEventListener("pointerdown", function () {
      if (state.view !== "present") return;
      if (state.topHidden || state.bottomHidden) { wakeTop(); wakeBottom(); }
      else scheduleHide();
    }, { passive: true });

    /* 向上滚到面板顶部时唤出顶栏（与 App 行为一致） */
    document.addEventListener("wheel", function (e) {
      if (state.view !== "present" || e.deltaY >= 0) return;
      var pane = e.target && e.target.closest ? e.target.closest(".vp-pane") : null;
      if (pane && pane.scrollTop > 0) return;
      if (state.topHidden) wakeTop();
    }, { passive: true });

    /* 触屏：左右滑动翻题，轻点唤出控制台 */
    var touch = null;
    present.addEventListener("touchstart", function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (t) touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    present.addEventListener("touchend", function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      var start = touch;
      touch = null;
      if (!t || !start) return;
      var dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (dx < 0) goNext(); else goPrev();
        return;
      }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && (state.topHidden || state.bottomHidden)) {
        wakeTop();
        wakeBottom();
      }
    }, { passive: true });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    applyTheme(savedTheme() || document.documentElement.dataset.theme || "paper", false);
    buildThemeDots(cvThemes);
    buildThemeDots(stThemes);
    syncThemeDots();
    buildCover();
    buildAnswerMap();
    bindEvents();
    if (!fsAvailable()) { cvFs.hidden = true; stFs.hidden = true; }
    syncFsButtons();
    applyChrome();
    /* 打开即尝试全屏：无用户手势时浏览器会拒绝，静默忽略；
       封面在任何情况下都铺满视口，“开始讲解”与左下角按钮可随时进入真全屏 */
    requestFs();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
