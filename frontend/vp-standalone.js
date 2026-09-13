/* ============================================================
   NeoBangX · 可视化讲解单文件运行时（导出产物专用）
   无依赖、无网络：读取 #vp-data 的 JSON，在 #vp-cover / #vp-present 里
   渲染封面与全屏讲台。文本一律先转义再写入（vpFmt），无注入面。
   交互与 App 内「全屏讲题」对齐：左右键/空格翻题、遮答案、题目总览、
   控制台自动隐藏与唤出、5 套主题实时切换、触屏左右滑动、浏览器全屏。
   另外带修改模式：顶栏「修改」进去，点文字就能改，选中文字可加粗/高亮，
   列表可增删；改动自动存在本浏览器，「保存文件」导出更新后的单文件 HTML。
   ============================================================ */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var THEME_KEY = "nbx_vp_theme";
  var HIDE_DELAY = 4000;

  /* ---------------- 数据 ---------------- */
  var DATA = {};
  try { DATA = JSON.parse(($("vp-data") && $("vp-data").textContent) || "{}") || {}; } catch (e) { DATA = {}; }

  /* 独立文件没有后端：正式改动存在浏览器里（键按文件自带的 id 区分），
     下次打开同一个文件自动恢复；rev 保证「文件本体」比本机记录新时以文件为准。 */
  var DOC_KEY = "nbx_vp_doc_" + (str(DATA.id) || "local");
  var DOC_REV = Number(DATA.rev) || 0;
  (function loadLocal() {
    try {
      var raw = localStorage.getItem(DOC_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.data) return;
      if ((Number(saved.rev) || 0) < DOC_REV) return;
      DATA = saved.data;
      DOC_REV = Number(saved.rev) || 0;
    } catch (e) {}
  })();

  var PAPER = DATA.paper || (DATA.paper = {});
  function titleText() { return str(DATA.title).trim() || "可视化试卷讲解"; }
  function noticeText() { return str(DATA.notice); }

  var GROUPS = [];
  var FLAT = [];
  (DATA.groups = DATA.groups || []).forEach(function (g) {
    if (!g) return;
    var qs = (g.questions || []).filter(Boolean);
    if (!qs.length) return;
    g.questions = qs;                 /* 就地规范化：修改模式写回的就是这些对象 */
    g.title = str(g.title);
    g.intro = str(g.intro);
    var gi = GROUPS.length;
    GROUPS.push(g);
    qs.forEach(function (q, qi) { FLAT.push({ gi: gi, qi: qi, group: g, q: q }); });
  });
  var TOTAL = Number(DATA.total) > 0 ? Number(DATA.total) : FLAT.length;

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
  /* 修改模式相关节点 */
  var qHead = $("q-head"), qPassage = $("q-passage"), qNoPassage = $("q-nopassage");
  var qEditMeta = $("q-edit-meta"), qEditHead = $("q-edit-head");
  var stEdit = $("st-edit"), stSave = $("st-save"), stFmt = $("st-fmt"),
      stBold = $("st-bold"), stHl = $("st-hl");
  var toolBar = $("vp-edit-tools"), toolBold = $("vp-tool-bold"), toolHl = $("vp-tool-hl");
  var toastBox = $("vp-toast");
  var dataScript = $("vp-data");

  /* ============================================================
     修改模式（与 App 内一致：完全所见即所得，永远看不到 ** 与 == 标记）
     改动写进 localStorage（按文件 id 区分），点「保存文件」把当前数据
     写进一份新的单文件 HTML，可以拷给别人；两条路都不需要老师碰源码。
     ============================================================ */
  var edit = { on: false, dirty: false, sel: false, el: null, saveTimer: null, toolTimer: null, drag: false, bound: false };
  var fileDirty = false;        /* 本次打开后有改动、还没写进 HTML 文件 */
  var saveHandle = null;        /* 拿到过的文件句柄：再次保存可无对话框直接覆盖 */
  var saving = false;

  var toastTimer = null;
  function toast(msg, kind) {
    if (!toastBox) return;
    toastBox.textContent = str(msg);
    toastBox.className = "vp-toast glass-deep" + (kind ? " " + kind : "");
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.hidden = true; }, kind === "error" ? 5200 : 3400);
  }

  /* ---------------- 行内标记：DOM ⇄ 文本（与 App 内同名函数保持一致） ---------------- */
  function vpNormalizeInline(text) {
    var s = String(text == null ? "" : text).replace(/\*{3,}/g, "**").replace(/={3,}/g, "==");
    return vpInlineParts(s).map(function (p) {
      if (p.k === "b") return "**" + vpNormalizeInline(p.v) + "**";
      if (p.k === "m") return "==" + vpNormalizeInline(p.v) + "==";
      return p.v;
    }).join("");
  }
  /* 编辑区 DOM → 标记文本：b/strong/mark 转标记，br/div/p 转换行，其余元素透明穿透 */
  function vpDomToMd(root) {
    var walk = function (node) {
      var out = "";
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, " "); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName;
        if (tag === "BR") { out += "\n"; continue; }
        var inner = walk(n);
        if (tag === "B" || tag === "STRONG") out += "**" + inner + "**";
        else if (tag === "MARK") out += "==" + inner + "==";
        else if (tag === "DIV" || tag === "P") out += (out && out.slice(-1) !== "\n" ? "\n" : "") + inner + "\n";
        else out += inner;
      }
      return out;
    };
    /* 浏览器把每行包成 <div>，末尾会多出一个换行，去掉它避免反复编辑攒空行 */
    return vpNormalizeInline(walk(root)).replace(/\n+$/, "");
  }
  function vpClosestInline(node, root, tag) {
    var want = tag.toUpperCase();
    for (var n = node && node.nodeType === 1 ? node : (node ? node.parentNode : null); n && n !== root; n = n.parentNode) {
      if (n.tagName === want) return n;
    }
    return null;
  }
  /* 给选区加/去格式：已整体处于该标签内则解包，否则包裹 */
  function vpToggleTag(root, tag) {
    var sel = document.getSelection ? document.getSelection() : window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    if (!root.contains(range.commonAncestorContainer)) return false;
    var host = vpClosestInline(range.commonAncestorContainer, root, tag);
    if (host) {
      var parent = host.parentNode;
      var moved = [];
      while (host.firstChild) moved.push(parent.insertBefore(host.firstChild, host));
      parent.removeChild(host);
      if (moved.length) {
        var after = document.createRange();
        after.setStartBefore(moved[0]);
        after.setEndAfter(moved[moved.length - 1]);
        sel.removeAllRanges();
        sel.addRange(after);
      }
      return true;
    }
    var wrap = document.createElement(tag);
    try {
      range.surroundContents(wrap);
    } catch (err) {
      wrap.appendChild(range.extractContents());
      range.insertNode(wrap);
    }
    return true;
  }

  /* ---------------- 字段路径读写：doc.* / paper.* / g<序号>.* / q.*（q 指当前题） ---------------- */
  function resolvePath(path) {
    var segs = String(path || "").split(".");
    if (!segs.length || !segs[0]) return null;
    var head = segs[0];
    var host = null;
    if (head === "doc") host = DATA;
    else if (head === "paper") host = PAPER;
    else if (/^g\d+$/.test(head)) host = GROUPS[Number(head.slice(1))];
    else if (head === "q") host = FLAT[state.cur] ? FLAT[state.cur].q : null;
    if (!host) return null;
    var rest = segs.slice(1);
    if (!rest.length) return null;
    for (var i = 0; i < rest.length - 1; i++) {
      var k = rest[i];
      host = host[/^\d+$/.test(k) ? Number(k) : k];
      if (host == null) return null;
    }
    var key = rest[rest.length - 1];
    return { host: host, key: Array.isArray(host) && /^\d+$/.test(key) ? Number(key) : key };
  }
  function fieldGet(path) {
    var t = resolvePath(path);
    if (!t) return "";
    var v = t.host[t.key];
    return v == null ? "" : v;
  }
  function fieldSet(path, value) {
    var t = resolvePath(path);
    if (!t) return;
    t.host[t.key] = value;
  }
  function deriveAnswerMap() {
    var m = {};
    FLAT.forEach(function (it) { if (has(it.q.answer)) m[str(it.q.no)] = it.q.answer; });
    return m;
  }

  /* ---------------- 编辑区节点构造 ---------------- */
  function editableNode(path, o) {
    o = o || {};
    var ed = el("div", "vp-editable" + (o.passage ? " vp-editable-passage" : ""));
    ed.dataset.vpPath = path;
    if (o.multi) ed.dataset.vpMulti = "1";
    if (o.max) ed.dataset.vpMax = String(o.max);
    return ed;
  }
  function cell(label, path, o) {
    o = o || {};
    var box = el("div", "vp-edit-cell");
    if (label) box.appendChild(el("div", "vp-edit-label", label));
    box.appendChild(editableNode(path, o));
    if (o.max) { var c = el("div", "vp-edit-count"); c.hidden = true; box.appendChild(c); }
    return box;
  }
  function listBox(path) {
    var box = el("div", "vp-edit-list");
    box.dataset.vpList = path;
    return box;
  }
  function addBtn(path, text, disabled, title) {
    var b = el("button", "vp-edit-add", text);
    b.type = "button";
    b.dataset.vpAdd = path;
    if (disabled) { b.disabled = true; if (title) b.title = title; }
    return b;
  }
  function delBtn(path, idx, title) {
    var b = el("button", "vp-edit-del", "×");
    b.type = "button";
    b.dataset.vpDel = path;
    b.dataset.vpIdx = String(idx);
    b.title = title || "删除这一条";
    return b;
  }
  function numberedRow(key, path, idx, delPath, delTitle) {
    var row = el("div", "vp-edit-row");
    row.appendChild(el("span", "vp-edit-key", key));
    row.appendChild(editableNode(path));
    row.appendChild(delBtn(delPath, idx, delTitle));
    return row;
  }

  /* ---------------- 编辑视图：左栏（标题/说明/大题/语篇）与右栏（题干/选项/答案/写作指导） ---------------- */
  function renderEditMeta() {
    var cur = FLAT[state.cur];
    clear(qEditMeta);
    qEditMeta.appendChild(cell("讲解标题（封面大字）", "doc.title"));
    qEditMeta.appendChild(cell("试卷标题（封面小字，可留空）", "paper.title"));
    qEditMeta.appendChild(cell("试卷说明（封面底部，可留空）", "doc.notice", { max: 200 }));
    if (cur) {
      qEditMeta.appendChild(cell("大题标题", "g" + cur.gi + ".title"));
      qEditMeta.appendChild(cell("大题导语（可留空）", "g" + cur.gi + ".intro", { max: 200 }));
    }
    qEditMeta.appendChild(cell("语篇（写作题或语法填空可留空）", "q.passage", { multi: true, max: 4000, passage: true }));
  }
  function renderEditHead(q) {
    clear(qEditHead);
    qEditHead.appendChild(cell("题干", "q.stem", { multi: true, max: 1000 }));
    var opts = q.options || [];
    if (opts.length || q.qtype === "choice") {
      var obox = el("div", "vp-edit-cell");
      obox.appendChild(el("div", "vp-edit-label", "选项（只改文字；增删时编号自动重排）"));
      var olist = listBox("q.options");
      opts.forEach(function (o, i) {
        var row = el("div", "vp-edit-row");
        row.appendChild(el("span", "vp-option-label", str(o && o.label) || String.fromCharCode(65 + i)));
        row.appendChild(editableNode("q.options." + i + ".text"));
        row.appendChild(delBtn("q.options", i, "删除这个选项"));
        olist.appendChild(row);
      });
      obox.appendChild(olist);
      obox.appendChild(addBtn("q.options", "+ 加一个选项"));
      qEditHead.appendChild(obox);
    }
    if (q.qtype !== "writing") qEditHead.appendChild(cell("答案（选项字母，或填空文本）", "q.answer"));
    if (q.qtype === "writing") {
      var wg = q.writingGuide || (q.writingGuide = { points: [], outline: "", sample: "" });
      wg.points = wg.points || [];
      var wbox = el("div", "vp-edit-cell");
      wbox.appendChild(el("div", "vp-edit-label", "写作指导 · 审题要点"));
      var plist = listBox("q.writingGuide.points");
      wg.points.forEach(function (p, i) {
        plist.appendChild(numberedRow((i + 1) + ".", "q.writingGuide.points." + i, i, "q.writingGuide.points", "删除这条要点"));
      });
      wbox.appendChild(plist);
      wbox.appendChild(addBtn("q.writingGuide.points", "+ 加一条要点"));
      qEditHead.appendChild(wbox);
      qEditHead.appendChild(cell("写作指导 · 结构框架", "q.writingGuide.outline"));
      qEditHead.appendChild(cell("写作指导 · 范文", "q.writingGuide.sample", { multi: true }));
    }
  }
  function renderEditTab(q) {
    clear(tabPanel);
    tabPanel.hidden = false;

    if (state.tab === "reference") {
      tabPanel.appendChild(el("div", "vp-tab-title", "参考答案"));
      if (!q.reference) q.reference = { evidence: "", reason: "", distractor: "" };
      tabPanel.appendChild(cell("证据（照录原文出处）", "q.reference.evidence", { multi: true, max: 800 }));
      tabPanel.appendChild(cell("推理", "q.reference.reason", { multi: true, max: 800 }));
      tabPanel.appendChild(cell("干扰项", "q.reference.distractor", { multi: true, max: 800 }));
      return;
    }

    if (state.tab === "pitfalls") {
      tabPanel.appendChild(el("div", "vp-tab-title", "易错点分析"));
      var list = q.pitfalls || (q.pitfalls = []);
      var box = listBox("q.pitfalls");
      list.forEach(function (p, i) {
        var item = el("div", "vp-pitfall-item vp-edit-item");
        item.appendChild(cell("易错点 " + (i + 1) + " · 标题", "q.pitfalls." + i + ".title"));
        item.appendChild(cell("描述", "q.pitfalls." + i + ".desc", { multi: true, max: 500 }));
        item.appendChild(delBtn("q.pitfalls", i, "删除这条易错点"));
        box.appendChild(item);
      });
      tabPanel.appendChild(box);
      tabPanel.appendChild(addBtn("q.pitfalls", "+ 加一条易错点"));
      return;
    }

    if (state.tab === "pattern") {
      tabPanel.appendChild(el("div", "vp-tab-title", "考点范式归纳"));
      var ptn = q.pattern || (q.pattern = { name: "", steps: [] });
      var steps = ptn.steps || (ptn.steps = []);
      tabPanel.appendChild(cell("范式名称", "q.pattern.name"));
      var pcell = el("div", "vp-edit-cell");
      pcell.appendChild(el("div", "vp-edit-label", "解题步骤（最多 5 步）"));
      var slist = listBox("q.pattern.steps");
      steps.forEach(function (s, i) {
        var row = el("div", "vp-edit-row");
        row.appendChild(el("span", "vp-edit-key", (i + 1) + "."));
        row.appendChild(editableNode("q.pattern.steps." + i, { max: 300 }));
        row.appendChild(delBtn("q.pattern.steps", i, "删除这一步"));
        slist.appendChild(row);
      });
      pcell.appendChild(slist);
      pcell.appendChild(addBtn("q.pattern.steps", "+ 加一步", steps.length >= 5, steps.length >= 5 ? "最多 5 步，先删再补" : ""));
      tabPanel.appendChild(pcell);
      return;
    }

    /* transfer（每题可多道：块内小标题 + 块级删除 + 底部「加一道」） */
    var transfers = q.transfers || (q.transfers = []);
    if (!transfers.length) {
      tabPanel.appendChild(el("div", "vp-line dim", q.qtype === "writing"
        ? "该题为写作题，不设迁移训练。请查看“参考答案”中的范文与框架。"
        : "该题暂无迁移训练内容。"));
    } else {
      var tlist = el("div", "vp-edit-list");
      tlist.dataset.vpList = "q.transfers";
      transfers.forEach(function (tr, ti) {
        if (!tr) return;
        var card = el("div", "glass-soft vp-card vp-edit-item");
        card.appendChild(el("div", "vp-transfer-cap", "迁移训练 " + (ti + 1) + " / " + transfers.length));
        card.appendChild(cell("迁移语篇", "q.transfers." + ti + ".passage", { multi: true, max: 800 }));
        card.appendChild(cell("迁移题干", "q.transfers." + ti + ".stem", { multi: true }));
        var tcell = el("div", "vp-edit-cell");
        tcell.appendChild(el("div", "vp-edit-label", "迁移选项（只改文字；增删时编号自动重排）"));
        var olist = listBox("q.transfers." + ti + ".options");
        (tr.options || []).forEach(function (o, oi) {
          var row = el("div", "vp-edit-row");
          row.appendChild(el("span", "vp-option-label", str(o && o.label) || String.fromCharCode(65 + oi)));
          row.appendChild(editableNode("q.transfers." + ti + ".options." + oi + ".text"));
          row.appendChild(delBtn("q.transfers." + ti + ".options", oi, "删除这个选项"));
          olist.appendChild(row);
        });
        tcell.appendChild(olist);
        tcell.appendChild(addBtn("q.transfers." + ti + ".options", "+ 加一个选项"));
        card.appendChild(tcell);
        card.appendChild(cell("迁移答案", "q.transfers." + ti + ".answer"));
        card.appendChild(cell("迁移解析", "q.transfers." + ti + ".explanation", { multi: true }));
        card.appendChild(delBtn("q.transfers", ti, "删除这道迁移题"));
        tlist.appendChild(card);
      });
      tabPanel.appendChild(tlist);
    }
    if (q.qtype !== "writing") tabPanel.appendChild(addBtn("q.transfers", "+ 加一道迁移题"));
  }

  /* ---------------- 挂载编辑区：只在目标变化时灌内容，避免打字时被自己覆盖 ---------------- */
  function mountCell(node) {
    if (!node || !node.dataset) return;
    var path = node.dataset.vpPath;
    if (!path) return;
    var key = path + "#" + state.cur;
    if (node.dataset.vpKey === key) return;
    node.dataset.vpKey = key;
    node.dataset.vpEdited = "";
    node.setAttribute("contenteditable", "true");
    node.setAttribute("spellcheck", "false");
    node.setAttribute("role", "textbox");
    node.setAttribute("aria-multiline", node.dataset.vpMulti === "1" ? "true" : "false");
    var lab = node.parentElement ? node.parentElement.querySelector(".vp-edit-label") : null;
    if (lab && lab.textContent.trim()) node.setAttribute("aria-label", lab.textContent.trim());
    node.innerHTML = vpFmt(fieldGet(path));
    if (!node.dataset.vpBound) {
      node.dataset.vpBound = "1";
      node.addEventListener("input", function () { onCellInput(node); });
      node.addEventListener("paste", onCellPaste);
      node.addEventListener("keydown", function (e) { onCellKeydown(e, node); });
      node.addEventListener("focus", function () { showTools(node); });
      node.addEventListener("mouseup", function () { showTools(node); });
      node.addEventListener("blur", function () { edit.sel = false; syncFmtButtons(); hideToolsSoon(); });
    }
    syncCount(node);
  }
  function mountEditables(root) {
    if (!edit.on) return;
    var nodes = (root || present).querySelectorAll("[data-vp-path]");
    for (var i = 0; i < nodes.length; i++) mountCell(nodes[i]);
  }
  /* 输入时把 DOM 还原成标记文本写回数据（只在真的改过时才写，避免误伤） */
  function onCellInput(node) {
    var path = node.dataset.vpPath;
    if (!path) return;
    node.dataset.vpEdited = "1";
    fieldSet(path, vpDomToMd(node));
    markDirty();
    syncCount(node);
  }
  function syncCount(node) {
    var max = Number(node.dataset.vpMax || 0);
    var box = node.parentElement ? node.parentElement.querySelector(".vp-edit-count") : null;
    if (!box) return;
    if (!max) { box.hidden = true; return; }
    var len = str(fieldGet(node.dataset.vpPath)).length;
    box.hidden = len < max * 0.9;
    box.textContent = len + " / " + max;
    box.classList.toggle("over", len > max);
  }
  /* 把改过的编辑区内容写回数据（防抖还没到点、或浏览器吞了 input 事件时兜底） */
  function writeBackEdited(root) {
    var nodes = (root || present).querySelectorAll("[data-vp-path][data-vp-edited='1']");
    var changed = false;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.dataset.vpPath) continue;
      var next = vpDomToMd(node);
      if (str(fieldGet(node.dataset.vpPath)) === next) continue;
      fieldSet(node.dataset.vpPath, next);
      changed = true;
    }
    if (changed) markDirty();
  }

  /* ---------------- 输入行为：粘贴纯文本、回车、快捷键 ---------------- */
  function onCellPaste(e) {
    var text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    e.preventDefault();
    // 插纯文本，杜绝从 Word/网页粘来的样式洪水；insertText 保留撤销栈
    if (!text) return;
    try { document.execCommand("insertText", false, text); } catch (err) {}
    onCellInput(e.currentTarget || e.target);
  }
  function onCellKeydown(e, node) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "b") {
      e.preventDefault();
      formatSelection(node, "b");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (node.dataset.vpMulti === "1") {
        var before = vpDomToMd(node);
        try { document.execCommand("insertLineBreak"); } catch (err) {}
        // 少数浏览器不支持 insertLineBreak：退化成插入换行文本（pre-wrap 下同样换行）
        if (vpDomToMd(node) === before) { try { document.execCommand("insertText", false, "\n"); } catch (err2) {} }
        onCellInput(node);
      } else {
        node.blur();
      }
      return;
    }
    if (e.key === "Escape") { e.stopPropagation(); node.blur(); }
  }
  function formatSelection(node, tag) {
    if (!node) { toast("先点一下要修改的文字，再选中它", "warn"); return; }
    if (!vpToggleTag(node, tag)) { toast("先选中要加格式的文字", "warn"); return; }
    node.dataset.vpEdited = "1";
    fieldSet(node.dataset.vpPath, vpDomToMd(node));
    markDirty();
    node.focus();
    repositionTools();
  }
  function formatFocused(tag) { formatSelection(edit.el, tag); }

  /* ---------------- 浮动格式按钮：只在真的选中了文字时才出现 ---------------- */
  function showTools(node) {
    edit.el = node;
    syncToolsFromSelection();
  }
  function syncFmtButtons() {
    if (stBold) stBold.disabled = !edit.sel;
    if (stHl) stHl.disabled = !edit.sel;
  }
  function syncToolsFromSelection() {
    if (!edit.on) { edit.sel = false; syncFmtButtons(); hideTools(); return; }
    var node = edit.el;
    var sel = document.getSelection ? document.getSelection() : null;
    var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    var ok = !!(node && node.isConnected && range && !range.collapsed && node.contains(range.commonAncestorContainer));
    edit.sel = ok;
    syncFmtButtons();
    if (!ok || edit.drag) { hideTools(); return; }
    if (!toolBar) return;
    toolBar.hidden = false;
    repositionTools();
  }
  function repositionTools() {
    var node = edit.el;
    if (!toolBar || toolBar.hidden || !node || !node.isConnected) return;
    /* 贴着选区浮出（选区矩形拿不到时退回整格的位置） */
    var rect = null;
    var sel = document.getSelection ? document.getSelection() : null;
    if (sel && sel.rangeCount && !sel.isCollapsed && node.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      var rr = sel.getRangeAt(0).getBoundingClientRect();
      if (rr && (rr.width || rr.height)) rect = rr;
    }
    if (!rect) rect = node.getBoundingClientRect();
    var w = toolBar.offsetWidth || 92;
    var h = toolBar.offsetHeight || 34;
    var left = Math.max(8, Math.min(rect.left + Math.min(rect.width / 2, 60), window.innerWidth - w - 8));
    var top = rect.top - h - 8;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, rect.bottom + 8);
    toolBar.style.left = Math.round(left) + "px";
    toolBar.style.top = Math.round(top) + "px";
  }
  function hideTools() {
    /* 只藏浮层，不清 edit.el：用键盘（Shift+方向键）选字时也要能点亮加粗/高亮 */
    if (toolBar) toolBar.hidden = true;
  }
  function hideToolsSoon() {
    clearTimeout(edit.toolTimer);
    edit.toolTimer = setTimeout(function () {
      if (edit.el && edit.el === document.activeElement) return;
      hideTools();
    }, 140);
  }

  /* ---------------- 列表增删：易错点 / 范式步骤 / 选项 / 写作要点 ---------------- */
  /* 重渲染会整块重建编辑区，所以增删后直接按当前数据重画，不存在「旧格子串内容」的问题 */
  function newItem(path) {
    if (path.slice(-7) === "options") return { label: "", text: "" };
    if (path.slice(-8) === "pitfalls") return { title: "", desc: "" };
    if (path === "q.transfers") return { passage: "", stem: "", options: [], answer: "", explanation: "" };
    return "";
  }
  function relabelOptions(arr) {
    arr.forEach(function (o, i) { if (o && typeof o === "object") o.label = String.fromCharCode(65 + i); });
  }
  function focusLastIn(path) {
    var box = document.querySelector('[data-vp-list="' + path + '"]');
    if (!box) return;
    var eds = box.querySelectorAll(".vp-editable");
    if (eds.length) eds[eds.length - 1].focus();
  }
  function addItem(path) {
    var t = resolvePath(path);
    if (!t) return;
    var arr = t.host[t.key];
    if (!Array.isArray(arr)) return;
    if (path.indexOf("pattern.steps") >= 0 && arr.length >= 5) {
      toast("考点范式最多 5 步，先删再补", "warn");
      return;
    }
    writeBackEdited();                 // 先把在改的内容写回，再动数组
    arr.push(newItem(path));
    if (path.slice(-7) === "options") relabelOptions(arr);
    markDirty();
    renderQuestion();
    focusLastIn(path);
  }
  function removeItem(path, idx) {
    var t = resolvePath(path);
    if (!t) return;
    var arr = t.host[t.key];
    if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
    writeBackEdited();                 // 先把在改的内容写回，再动数组
    if (path.slice(-7) === "options") {
      // 选项所属的答案字段：q.options → q.answer，q.transfers.2.options → q.transfers.2.answer
      var ansPath = path.replace(/\.options$/, ".answer");
      var ans = str(fieldGet(ansPath)).trim().toUpperCase();
      var removed = str(arr[idx] && arr[idx].label).trim().toUpperCase();
      // 删掉的正是正确项时先拦一下：否则答案会变成一个不存在的字母
      if (ans && removed && ans === removed) {
        toast("第 " + removed + " 项是当前答案，先改答案再删它", "warn");
        return;
      }
      arr.splice(idx, 1);
      relabelOptions(arr);
      var oldIdx = ans ? ans.charCodeAt(0) - 65 : -1;
      if (oldIdx > idx && oldIdx <= arr.length) fieldSet(ansPath, String.fromCharCode(64 + oldIdx));
    } else {
      arr.splice(idx, 1);
    }
    markDirty();
    renderQuestion();
  }

  /* ---------------- 保存：本机自动记 + 导出更新后的 HTML ---------------- */
  function markDirty() {
    edit.dirty = true;
    /* 有改动没写进文件：让「保存文件」按钮一直亮着，关窗口时也会拦一下 */
    if (!fileDirty) { fileDirty = true; syncEditChrome(); }
    clearTimeout(edit.saveTimer);
    edit.saveTimer = setTimeout(flushEdits, 1200);
  }
  function flushEdits() {
    clearTimeout(edit.saveTimer);
    edit.saveTimer = null;
    if (!edit.dirty) return;
    edit.dirty = false;
    persistLocal();
  }
  /* 把当前数据写进浏览器（答案速查表等派生数据一并刷新） */
  var localWarned = false;
  function persistLocal() {
    DATA.answerMap = deriveAnswerMap();
    DATA.total = TOTAL;
    DOC_REV += 1;
    DATA.rev = DOC_REV;
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify({ rev: DOC_REV, data: DATA }));
    } catch (e) {
      // 存不下就说清楚：不然老师下次打开发现改动没了，却不知道为什么
      if (!localWarned) {
        localWarned = true;
        toast("本机存不下这次修改（浏览器存储已满）；点「保存文件」导出更新后的 HTML", "warn");
      }
    }
  }

  /* 启动时抓一份原始文档文本（在任何渲染之前）：保存文件时只替换数据块、
     页签标题与主题属性，得到的永远是干净、双击即开封面的单文件。 */
  var PRISTINE_HTML = "", PRISTINE_HTML_TAG = "", PRISTINE_TITLE_TAG = "", PRISTINE_DATA_TAG = "";
  function capturePristine() {
    var root = document.documentElement;
    var text = root.outerHTML;
    PRISTINE_HTML = "<!DOCTYPE html>\n" + text;
    var head = text.indexOf(">");
    PRISTINE_HTML_TAG = head > 0 ? text.slice(0, head + 1) : "";
    var t = document.querySelector("title");
    PRISTINE_TITLE_TAG = t ? t.outerHTML : "";
    PRISTINE_DATA_TAG = dataScript ? dataScript.outerHTML : "";
  }
  function attrSet(tag, name, value) {
    var out = tag.replace(new RegExp(" " + name + '="[^"]*"'), "");
    if (!value) return out;
    return out.replace(/>$/, " " + name + '="' + String(value).replace(/"/g, "&quot;") + '">');
  }
  function safeFilename(name) {
    var cleaned = str(name)
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
      .replace(/[. ]+$/, "")
      .trim();
    if (cleaned) return cleaned;
    var d = new Date();
    return "可视化试卷讲解_" + d.getFullYear() + String(d.getMonth() + 1) + String(d.getDate());
  }
  function buildSnapshotHtml() {
    if (!PRISTINE_HTML) return "";
    var json = JSON.stringify(DATA).replace(/</g, "\\u003c");
    var dataTag = '<script id="vp-data" type="application/json">' + json + "<" + "/script>";
    var titleTag = "<title>" + esc(vpDetag(titleText())) + "</title>";
    var htmlTag = attrSet(attrSet(PRISTINE_HTML_TAG, "data-theme", state.theme), "data-sky", skyOf(state.theme));
    var put = function (s, find, repl) { return find ? s.replace(find, function () { return repl; }) : s; };
    return put(put(put(PRISTINE_HTML, PRISTINE_HTML_TAG, htmlTag), PRISTINE_TITLE_TAG, titleTag), PRISTINE_DATA_TAG, dataTag);
  }
  /* ---------------- 保存：本机自动记 + 写回 HTML 文件 ----------------
     页面不能无声写自己的文件（浏览器安全限制）：Chrome / Edge 上用文件系统访问接口，
     第一次保存会弹一次系统保存框（默认文件名就是当前文件名，选同一目录确认替换即可原地覆盖，
     不会多出"(1)"），同一个页面里之后再点保存就直接覆盖、不再弹框；
     不支持该接口的浏览器退回「另存为下载」，提示老师替换原文件。 */
  /* 当前文件名（file:// 打开时就是它本身）：用作保存对话框的默认名，方便原地替换 */
  function currentFileName() {
    try {
      if (location.protocol !== "file:") return "";
      var name = decodeURIComponent(String(location.pathname || "").split("/").pop() || "");
      return /\.html?$/i.test(name) ? name : "";
    } catch (e) { return ""; }
  }
  function fileNameFor(title) { return currentFileName() || (safeFilename(vpDetag(title)) + ".html"); }
  function canWriteInPlace() { return typeof window.showSaveFilePicker === "function"; }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  /* 写回文件：优先用已授权的句柄（无对话框），否则弹一次保存框 */
  function writeInPlace(blob) {
    var handle = saveHandle;
    var askPerm = function (h, mode) {
      if (!h.queryPermission) return Promise.resolve("granted");
      return h.queryPermission({ mode: mode }).then(function (p) {
        if (p === "granted" || !h.requestPermission) return p;
        return h.requestPermission({ mode: mode });
      });
    };
    var ready = handle
      ? askPerm(handle, "readwrite").catch(function () { return "denied"; })
      : Promise.resolve("none");
    return ready.then(function (perm) {
      if (perm === "granted") return handle;
      if (!canWriteInPlace()) throw new Error("no-fs-api");
      return window.showSaveFilePicker({
        id: "nbx-vp-doc",                         /* 让浏览器记住上次的目录，第二次默认就在原处 */
        suggestedName: fileNameFor(titleText()),
        types: [{ description: "网页文件（单文件讲解）", accept: { "text/html": [".html"] } }],
      });
    }).then(function (h) {
      if (!h || !h.createWritable) throw new Error("no-writable");
      return h.createWritable().then(function (w) {
        return Promise.resolve(w.write(blob)).then(function () { return w.close(); }).then(function () {
          saveHandle = h;
          return h.name || "";
        });
      });
    });
  }
  function markSaved() {
    fileDirty = false;
    syncEditChrome();
  }
  function saveFile() {
    if (saving) return Promise.resolve();
    writeBackEdited();
    flushEdits();
    persistLocal();
    var html = buildSnapshotHtml();
    if (!html) { toast("保存失败：读不到当前文档内容", "error"); return Promise.resolve(); }
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    return saveAs(blob);
  }
  function saveAs(blob) {
    var fallbackName = fileNameFor(titleText());
    if (!canWriteInPlace()) {
      downloadBlob(blob, fallbackName);
      markSaved();
      toast("已导出文件：" + fallbackName + "（这个浏览器不支持原地覆盖，请用它替换原文件）", "ok");
      return Promise.resolve();
    }
    saving = true;
    var inPlace = currentFileName() !== "";
    return writeInPlace(blob).then(function (name) {
      markSaved();
      toast(inPlace ? "已保存并覆盖文件：" + (name || fallbackName) : "已保存文件：" + (name || fallbackName), "ok");
    }).catch(function (err) {
      if (err && err.name === "AbortError") { toast("已取消保存", "warn"); return; }
      /* 其它失败（老浏览器 / 权限策略）：退回下载，至少别让老师的改动没了 */
      try {
        downloadBlob(blob, fallbackName);
        markSaved();
        toast("已导出文件：" + fallbackName + "（请用它替换原文件）", "ok");
      } catch (e2) {
        toast("保存失败，请换用 Chrome / Edge 打开", "error");
      }
    }).then(function () { saving = false; });
  }

  /* ---------------- 进出修改模式 ---------------- */
  function syncEditChrome() {
    if (stEdit) {
      clear(stEdit);
      stEdit.appendChild(svgUse(edit.on ? "check" : "pen"));
      stEdit.appendChild(el("span", null, edit.on ? "完成修改" : "修改"));
      stEdit.title = edit.on ? "完成修改并保存" : "修改模式：点开后所有文字都能改";
      stEdit.classList.toggle("on", edit.on);
    }
    if (stSave) {
      /* 只要「有改动没写进文件」就留着这个按钮，退出修改模式也能一键保存 */
      stSave.hidden = !(edit.on || fileDirty);
      stSave.classList.toggle("on", fileDirty);
      var fname = currentFileName();
      stSave.title = fname
        ? "保存到文件（首次会让你确认一次，之后直接覆盖 " + fname + "）"
        : "保存到文件（未保存就关闭窗口会先提示）";
    }
    if (stFmt) stFmt.hidden = !edit.on;
    syncFmtButtons();
  }
  function enterEdit() {
    if (!FLAT.length) { toast("没有可修改的内容", "error"); return; }
    edit.on = true;
    edit.dirty = false;
    edit.sel = false;
    state.mask = false;                 // 边改边看得到答案
    if (state.overview) toggleOverview(false);
    state.topHidden = false;            // 编辑时顶栏不能自动隐藏（上面有「完成修改 / 保存文件」）
    state.bottomHidden = false;
    stopHide();
    syncEditChrome();
    applyChrome();
    syncMask();
    renderQuestion();
    toast("修改模式：点文字即可改；「完成修改」存本机，「保存文件」写进 HTML");
  }
  function exitEdit() {
    if (!edit.on) return;
    writeBackEdited();
    edit.on = false;
    edit.sel = false;
    flushEdits();
    hideTools();
    syncEditChrome();
    buildCover();
    renderQuestion();
    buildAnswerMap();
    applyChrome();
    scheduleHide();
    toast(fileDirty ? "修改已保存在本机；还没写进 HTML 文件，可点「保存文件」" : "修改已保存在本机浏览器", fileDirty ? "warn" : "ok");
  }
  function toggleEdit() { if (!edit.on) enterEdit(); else exitEdit(); }

  function bindEditEvents() {
    if (edit.bound) return;
    edit.bound = true;
    if (stEdit) stEdit.addEventListener("click", toggleEdit);
    if (stSave) stSave.addEventListener("click", saveFile);
    /* 格式按钮：mousedown 阻止默认，保住编辑区里的选区 */
    var fmt = [[stBold, "b"], [stHl, "mark"], [toolBold, "b"], [toolHl, "mark"]];
    fmt.forEach(function (pair) {
      var b = pair[0];
      if (!b) return;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { formatFocused(pair[1]); });
    });
    /* 列表增删：在容器上做事件委托，重画后依然有效 */
    present.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var add = t.closest("[data-vp-add]");
      if (add) { if (!add.disabled) addItem(add.dataset.vpAdd); return; }
      var del = t.closest("[data-vp-del]");
      if (del) removeItem(del.dataset.vpDel, Number(del.dataset.vpIdx));
    });
    /* 选中文字 → 浮出格式按钮；拖选过程中先不浮出 */
    document.addEventListener("selectionchange", function () { if (edit.on) syncToolsFromSelection(); });
    document.addEventListener("scroll", function () { if (edit.el) repositionTools(); }, { passive: true, capture: true });
    window.addEventListener("resize", function () { if (edit.el) repositionTools(); });
    document.addEventListener("pointerdown", function () { edit.drag = true; }, { passive: true, capture: true });
    document.addEventListener("pointerup", function () {
      edit.drag = false;
      if (edit.on) syncToolsFromSelection();
    }, { passive: true, capture: true });
    document.addEventListener("pointercancel", function () { edit.drag = false; }, { passive: true, capture: true });
    window.addEventListener("blur", function () { edit.drag = false; });
    /* 关页面前：先把防抖中的改动落本机（localStorage 是同步的，来得及）；
       还有没写进文件的改动时拦住关闭，让浏览器弹出它自带的确认框
       （浏览器不允许自定义这句提示，也没有「保存」按钮，只能这样拦一下）。 */
    window.addEventListener("beforeunload", function (e) {
      flushEdits();
      if (!fileDirty) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
    document.addEventListener("visibilitychange", function () { if (document.hidden) flushEdits(); });
  }


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
    setRich(cvTitle, titleText());
    setRich(stTitle, titleText());

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
    setRich(cvNotice, noticeText());
    cvNotice.hidden = !noticeText();
    cvStart.disabled = !FLAT.length;
    document.title = vpDetag(titleText());
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
    /* 答案速查表跟着题目数据走：修改模式里改了答案，退出后这里就是新的 */
    var map = deriveAnswerMap();
    var keys = Object.keys(map);
    ansMap.hidden = !keys.length;
    keys.forEach(function (no) {
      var label = no + ": " + vpDetag(map[no]);
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
        var off = !(q.transfers || []).length;
        b.disabled = off;
        b.title = off ? "写作题不设迁移训练" : "";
      }
    });

    if (edit.on) { renderEditTab(q); mountEditables(present); return; }

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

    /* transfer（每题可多道：逐块渲染成卡） */
    var transfers = q.transfers || [];
    if (!transfers.length) {
      tabPanel.appendChild(el("div", "vp-line dim", q.qtype === "writing"
        ? "该题为写作题，不设迁移训练。请查看“参考答案”中的范文与框架。"
        : "该题暂无迁移训练内容。"));
      return;
    }
    var thead = el("div", "vp-tab-title");
    thead.appendChild(document.createTextNode("迁移训练 "));
    thead.appendChild(el("span", "vp-tab-sub", "（同构新题，话题不同 · 范式相同）"));
    tabPanel.appendChild(thead);
    var tblist = el("div", "vp-edit-list");
    transfers.forEach(function (tr, ti) {
      if (!tr) return;
      var card = el("div", "glass-soft vp-card");
      if (transfers.length > 1) card.appendChild(el("div", "vp-transfer-cap", "迁移训练 " + (ti + 1) + " / " + transfers.length));
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
      tblist.appendChild(card);
    });
    tabPanel.appendChild(tblist);
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
    /* 修改模式：右栏换成编辑版（题干/选项/答案/写作指导），左栏换成标题与语篇编辑区 */
    if (edit.on) {
      qHead.hidden = true;
      qEditHead.hidden = false;
      qPassage.hidden = true;
      qNoPassage.hidden = true;
      qEditMeta.hidden = false;
      renderEditMeta();
      renderEditHead(q);
      buildAnswerMap();
      mountEditables(present);
    } else {
      qHead.hidden = false;
      qEditHead.hidden = true;
      qEditMeta.hidden = true;
      clear(qEditHead);
      clear(qEditMeta);
    }
    syncMask();
    syncOverviewActive();
  }

  function setIndex(i, keepTab) {
    if (!FLAT.length) return;
    if (edit.on) writeBackEdited();          // 换题前先把在改的内容写回
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
    if (state.view !== "present" || state.pinned || edit.on) return;   // 修改模式：控制台一直留着
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
    if (edit.on) exitEdit();                 // 回封面先收工：把在改的内容存好
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
      if (edit.on) writeBackEdited();
      state.tab = b.dataset.tab;
      renderTab();
      syncMask();
    });

    document.addEventListener("fullscreenchange", syncFsButtons);

    document.addEventListener("keydown", function (e) {
      var tag = e.target && e.target.tagName;
      /* 修改模式：编辑区里的按键（方向键、Esc、Ctrl+B）归编辑区自己管，不翻题也不回封面 */
      if (edit.on && e.target && (e.target.isContentEditable || (e.target.closest && e.target.closest(".vp-editable")))) return;
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

    /* 触屏：左右滑动翻题，轻点唤出控制台（修改模式下要选字，不参与手势） */
    var touch = null;
    present.addEventListener("touchstart", function (e) {
      if (edit.on) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (t) touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    present.addEventListener("touchend", function (e) {
      if (edit.on) { touch = null; return; }
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
    capturePristine();                 /* 必须在任何渲染改动之前抓（保存文件时要用） */
    applyTheme(savedTheme() || document.documentElement.dataset.theme || "paper", false);
    buildThemeDots(cvThemes);
    buildThemeDots(stThemes);
    syncThemeDots();
    buildCover();
    buildAnswerMap();
    bindEvents();
    bindEditEvents();
    /* 修改模式按钮固定用代码画图标：顶栏的「修改」要按状态换图标 */
    setIcon(toolBold, "bold");
    setIcon(toolHl, "highlight");
    setIcon(stBold, "bold");
    setIcon(stHl, "highlight");
    syncEditChrome();
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
