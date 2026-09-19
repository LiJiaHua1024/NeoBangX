/* ==========================================================================
   NeoBangX · 可视化试卷全解 —— A4 打印排版引擎

   为什么不是「给现有页面加 @media print」：
   应用里的试卷视图是左右分栏、导出的单文件讲台是 position:fixed; inset:0; overflow:hidden
   的视口应用，一次只显示一题——@media print 只能打印当前视口，而且玻璃拟态、渐变、
   暗色主题在纸上必然糊成一团。所以这里另起一套：把数据重排成固定尺寸的 A4 纸，
   自己分页、自己数页数，再写进隐藏 iframe 唤起系统打印。

   三个产物同一个源头（buildHtml）：
   · print()    隐藏 iframe + window.print()，直接出纸 / 另存 PDF
   · preview()  新标签页打开排版结果，先核对分页再打印
   · download() 下载「打印版单文件 HTML」，可离线打印或发给文印店

   这个文件同时活在两个地方：应用页面（<script src>）和打印文档内部（内联）。
   靠 document.currentScript 判断自己是被谁加载的——是外部加载就把自己的源码与
   样式抓回来内联，是内联就现取现用，所以导出的打印版单文件离线也能用。
   ========================================================================== */
(function () {
  "use strict";

  if (window.VPPrint && window.VPPrint.version) return;

  /* defer 脚本执行期间能拿到 currentScript，点击时已经拿不到了——先存下来 */
  var SELF = document.currentScript;
  var SELF_SRC = (SELF && SELF.src) || "";
  if (!SELF_SRC) {
    var tag = document.querySelector('script[src*="vp-print.js"]');
    SELF_SRC = tag ? tag.src : "";
  }

  var VERSION = "vpp260919b";
  var MM = 3.7795275591;              /* 1mm 的 CSS px（96dpi 基准） */
  var OPTS_KEY = "nbx_vp_print_opts";
  var DATA_ID = "vpp-data";
  var OPTS_ID = "vpp-opts";
  var ROOT_ID = "vpp-root";
  var CSS_ID = "vpp-css-src";
  var FRAME_ID = "vpp-print-frame";
  /* 三个版本各自成册：教师版是「题目 + 答案」连排讲评用，学生版只有卷面（不含任何答案），
     答案册只印答案与解析。学生版与答案册分开，老师才不会顺手把答案连同练习卷一起发给学生。 */
  var MODE_LABEL = { teacher: "教师详解版", student: "学生练习版", answer: "答案解析" };
  function normMode(m) { return (m === "student" || m === "answer") ? m : "teacher"; }
  var DEFAULTS = { mode: "teacher", transfers: true, pitfalls: true, pattern: true, ansmap: true, groupBreak: false, fontPt: 10.5 };
  var PT_MIN = 9, PT_MAX = 16, BASE_PT = 10.5;   /* 10.5pt = 五号，试卷正文常规 */
  /* 打印文档的字号阶梯。样式表里所有字号都走这几个变量（没有一处写死、也没用 rem），
     所以在打印文档里覆盖它们，整份排版就跟着缩放：行高是倍数，自然一起放大。 */
  var TYPE = [["body", 10.5], ["small", 9.5], ["mini", 8.5], ["head", 8], ["h1", 16], ["h2", 12.5], ["h3", 11]];
  var CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];

  /* ==================== 行内格式（与应用里的 vpFmt 同一套标记） ==================== */
  /* 只用 **加粗** 与 ==高亮== 两种成对标记：不会误伤英语原文里的单个星号。
     落单 / 空对的标记直接丢弃——切分长段落时可能把标记切断，丢了也不会印出裸符号。 */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function inlineParts(text) {
    var s = String(text == null ? "" : text);
    var out = [], buf = "", i = 0;
    while (i < s.length) {
      var marker = "";
      if (s.substr(i, 2) === "**") marker = "**";
      else if (s.substr(i, 2) === "==") marker = "==";
      if (!marker) { buf += s.charAt(i); i += 1; continue; }
      var end = s.indexOf(marker, i + 2);
      if (end === -1) { i += 2; continue; }
      var inner = s.slice(i + 2, end);
      if (!inner.trim() || inner.indexOf(marker) >= 0) { i += 2; continue; }
      if (buf) { out.push({ k: "t", v: buf }); buf = ""; }
      out.push({ k: marker === "**" ? "b" : "m", v: inner });
      i = end + 2;
    }
    if (buf) out.push({ k: "t", v: buf });
    return out;
  }
  function fmt(text) {
    return inlineParts(text).map(function (p) {
      if (p.k === "b") return '<b class="vpp-b">' + fmt(p.v) + "</b>";
      if (p.k === "m") return '<mark class="vpp-hl">' + fmt(p.v) + "</mark>";
      return esc(p.v);
    }).join("");
  }
  function detag(text) {
    return inlineParts(text).map(function (p) { return p.v; }).join("");
  }

  /* ==================== 小工具 ==================== */
  function str(v) { return v == null ? "" : String(v); }
  function has(v) { return str(v).trim().length > 0; }
  function mm(v) { return v * MM; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  /* 变参合并：调用处常有 assign({}, it, { lines: 切好的片段 }) 这种「覆盖式」用法，
     少合并一个源对象就会静默用回旧字段（切分逻辑会整个失效），所以这里必须支持多个源。 */
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    }
    return t;
  }
  function pushAll(dst, src) { (src || []).forEach(function (x) { dst.push(x); }); }
  function cnNum(i) { return CN_NUM[i] || String(i + 1); }
  function round2(n) { return Math.round(n * 100) / 100; }
  /* 字号倍率：所有需要跟着字号走的尺寸（字号阶梯、悬挂缩进）都由它换算 */
  function typeScale(o) {
    var pt = o && o.fontPt > 0 ? o.fontPt : BASE_PT;
    return pt / BASE_PT;
  }
  function typeVars(o) {
    var k = typeScale(o);
    return TYPE.map(function (t) { return "--fs-" + t[0] + ":" + round2(t[1] * k) + "pt"; }).join(";");
  }
  function hangOf(baseMm, ctx) { return round2(baseMm * typeScale(ctx.o)) + "mm"; }
  function fmtPt(v) { return round2(v) + "pt"; }
  function stripTags(v) { return str(v).trim().replace(/[.．。、,，:：]/g, "").toUpperCase(); }
  function sameLabel(a, b) { var x = stripTags(a); return x !== "" && x === stripTags(b); }

  /* 中文为主的行两端对齐、英文为主的行左对齐：浏览器不做英文连字符，
     两端对齐会把英文行拉出一道道「河」。判定只用字符比例，够用且零成本。 */
  var RE_CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff01-\uff60]/g;
  var RE_LAT = /[A-Za-z]/g;
  function scriptOf(text) {
    var s = detag(text);
    var cjk = (s.match(RE_CJK) || []).length;
    var lat = (s.match(RE_LAT) || []).length;
    return (cjk >= 4 && cjk * 3 >= lat) ? "cjk" : "latin";
  }

  /* 选项要不要排两栏，取决于文字实际宽度而不是字数——中英文混排按字数猜一定会出错 */
  var _ctx2d = null;
  function textWidth(text, font) {
    if (!_ctx2d) {
      try { _ctx2d = document.createElement("canvas").getContext("2d"); } catch (e) { _ctx2d = false; }
    }
    if (!_ctx2d) return 0;
    _ctx2d.font = font;
    return _ctx2d.measureText(text).width;
  }
  var OPT_FONT = '10.5pt "Times New Roman","SimSun",serif';
  function chooseCols(list, width) {
    if (list.length < 3 || list.length > 4) return 1;
    var half = (width - mm(6)) / 2 - mm(7.5);       /* 减栏间距与选项字母位 */
    if (half <= 0) return 1;
    for (var i = 0; i < list.length; i++) {
      if (textWidth(detag(list[i].text), OPT_FONT) > half) return 1;
    }
    return 2;
  }

  /* ==================== 块（排版的最小单位） ====================
     kind=text  由若干「段」组成，可以在段与段之间切开分页（语篇、解析、范文）
     kind=html  整体不可切（选项网格、速查表、作答横线）——比一页还高的极端情况
                只能硬放，靠纸张的 overflow:hidden 兜底，实际几乎不会出现。 */
  function line(raw, extra) { return assign({ raw: str(raw), cls: "", pre: "" }, extra); }
  function textLines(text) {
    return str(text).split(/\n+/)
      .map(function (s) { return line(s.trim()); })
      .filter(function (l) { return l.raw !== "" || l.pre !== ""; });
  }
  function itemText(role, lines, extra) { return assign({ role: role, kind: "text", lines: lines }, extra); }
  function itemHtml(role, html, extra) { return assign({ role: role, kind: "html", html: html }, extra); }

  function lineEl(l) {
    var p = document.createElement("p");
    p.className = "vpp-p" + (l.cls ? " " + l.cls : "");
    p.innerHTML = (l.pre || "") + fmt(l.raw);
    return p;
  }

  /* empty=true 时只建「空壳」（类名与样式照旧，但不填内容）：
     切分时要往同一个壳里逐段塞内容再量高，壳里若预先带着原始整段，
     一放上去高度就已经是整段的高度，切分永远不会成立。 */
  function makeEl(it, cont, empty) {
    var el = document.createElement("div");
    el.className = "vpp-blk vpp-" + it.role;
    if (it.script) el.setAttribute("data-script", it.script);
    if (it.hang) {
      el.style.setProperty("--hang", it.hang);
      /* 续排块不能再负缩进：题号已经印在上一页了，再挂出去会跑到页边距外面 */
      var lead = (it.lines && it.lines[0] && it.lines[0].pre) ? "vpp-hang" : "vpp-hang-cont";
      el.classList.add(cont ? "vpp-hang-cont" : lead);
    }
    if (it.chain) {
      el.classList.add("vpp-chain");
      if (it.chainEnd && !cont) el.classList.add("vpp-chain-end");
    }
    if (empty) return el;
    if (it.kind === "html") el.innerHTML = it.html;
    else (it.lines || []).forEach(function (l) { el.appendChild(lineEl(l)); });
    return el;
  }

  /* 外边距按类名缓存一次即可：同类块的 margin 一定相同，避免每次 getComputedStyle 的强制回流 */
  var _mbCache = {};
  function marginBottom(el) {
    var key = el.className;
    if (_mbCache[key] == null) {
      _mbCache[key] = parseFloat(getComputedStyle(el).marginBottom) || 0;
    }
    return _mbCache[key];
  }

  /* ==================== 纸张 ==================== */
  function makeSheet(isProbe) {
    var s = document.createElement("div");
    s.className = "vpp-sheet" + (isProbe ? " vpp-probe" : "");
    var head = document.createElement("div"); head.className = "vpp-head";
    var hl = document.createElement("span"); hl.className = "vpp-head-l";
    var hr = document.createElement("span"); hr.className = "vpp-head-r";
    head.appendChild(hl); head.appendChild(hr);
    var body = document.createElement("div"); body.className = "vpp-mbody";
    var foot = document.createElement("div"); foot.className = "vpp-foot";
    var fc = document.createElement("span"); fc.className = "vpp-foot-c";
    foot.appendChild(fc);
    s.appendChild(head); s.appendChild(body); s.appendChild(foot);
    if (isProbe) {
      /* 量取每页容量的那张「空纸」必须带上占位文字：空 span 撑不出行盒，
         页眉页脚高度会比真纸矮，容量就会被算大，最后一页必然溢出。 */
      hl.textContent = "X"; hr.textContent = "X"; fc.textContent = "X";
    }
    return s;
  }

  /* ==================== 切分与装箱 ==================== */

  /* 单段比整页还高（超长语篇、无空行无句号的极端输入）：
     按字符二分切到能放下为止，切点尽量落在标点上。 */
  function snapBreak(text, at) {
    var min = Math.max(1, Math.floor(at * 0.6));
    for (var i = at; i > min; i--) {
      if (/[。！？；：，、）】"'’.!?;,)\]\s]/.test(text.charAt(i - 1))) return i;
    }
    return at;
  }
  function avoidMarkerCut(text, at) {
    var i = at;
    while (i > 1 && (text.charAt(i - 1) === "*" || text.charAt(i - 1) === "=")) i--;
    return i > 1 ? i : at;
  }
  function measureLines(lines, it, ctx) {
    var el = makeEl(assign({}, it, { kind: "text", lines: lines }), false);
    ctx.mbody.appendChild(el);
    var h = el.offsetHeight + marginBottom(el);
    el.remove();
    return h;
  }

  /* 往当前页余量里塞尽可能多的整段；一段都塞不下就退回整页重试 */
  function takeChunk(lines, start, budget, it, ctx, cont) {
    var el = makeEl(it, cont, true);
    ctx.mbody.appendChild(el);
    var i = start, placed = 0, h = 0;
    while (i < lines.length) {
      var p = lineEl(lines[i]);
      el.appendChild(p);
      h = el.offsetHeight + marginBottom(el);
      if (h > budget) {
        el.removeChild(p);
        h = el.offsetHeight + marginBottom(el);
        break;
      }
      placed++; i++;
    }
    el.remove();
    if (!placed) return null;
    return { el: el, h: h, next: i };
  }

  /* 把一段按字符切成「能塞进 budget 的头 + 剩下的尾」。
     预算可能是「当前页余量」，也可能是「一整页」——两种情况都靠它兜住：
     前者用来填满页尾、避免出现只有标题的半空页，后者用来处理比整页还高的超长段落。 */
  function cutLine(l, it, ctx, budget) {
    if (!l.raw) return null;
    var lo = 1, hi = l.raw.length, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var probe = assign({}, l, { raw: l.raw.slice(0, mid) });
      if (measureLines([probe], it, ctx) <= budget) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    if (!best || best >= l.raw.length) return null;
    var cut = avoidMarkerCut(l.raw, snapBreak(l.raw, best));
    if (cut < 2) return null;
    return {
      head: assign({}, l, { raw: l.raw.slice(0, cut) }),
      tail: assign({}, l, { raw: l.raw.slice(cut), pre: "" })
    };
  }

  function splitItem(it, avail, capacity, ctx) {
    var lines = (it.lines || []).slice();
    var out = [], i = 0, budget = avail, cont = false;
    while (i < lines.length) {
      var res = takeChunk(lines, i, budget, it, ctx, cont);
      /* 当前页还剩三成以上空间，却连首段都塞不下：把它切小一截填满这一页。
         否则整块被推到下一页，上一页就只剩「一个大题标题」孤零零挂在纸上。 */
      if (!res && !cont && avail >= capacity * 0.35) {
        var cutPage = cutLine(lines[i], it, ctx, budget);
        if (cutPage) {
          lines[i] = cutPage.head;
          lines.splice(i + 1, 0, cutPage.tail);
          res = takeChunk(lines, i, budget, it, ctx, cont);
        }
      }
      /* 当前页放不下就搬去新纸，用整页的预算再试一次 */
      if (!res && budget < capacity) {
        budget = capacity;
        res = takeChunk(lines, i, budget, it, ctx, cont);
      }
      /* 单段本身就比一整页还高（超长语篇、无空行无句号的极端输入）：按整页预算切一刀。
         单靠 takeChunk 会一直塞不进，于是整块被跳过，内容就凭空少了一截。 */
      if (!res) {
        var cutFull = cutLine(lines[i], it, ctx, capacity);
        if (cutFull) {
          lines[i] = cutFull.head;
          lines.splice(i + 1, 0, cutFull.tail);
          res = takeChunk(lines, i, budget, it, ctx, cont);
        }
      }
      if (!res) break;                                  /* 兜底：彻底放不下，退出走硬放 */
      out.push({ el: res.el, h: res.h, header: it.header });
      i = res.next;
      budget = capacity;                                /* 之后每一块都从新纸顶端开始量 */
      cont = true;                                      /* 后面都是续排块，不再负缩进 */
    }
    if (!out.length) {
      var el = makeEl(assign({}, it, { kind: "text", lines: lines }), false);
      out.push({ el: el, h: it.h || 0, header: it.header });
    }
    /* 链尾块被切开时，下边距在续排块上：补类名的同时要重新量高，
       否则那块的下边距会凭空消失，下一个块直接贴着它印。 */
    if (it.chainEnd && out.length > 1) {
      var last = out[out.length - 1];
      if (last.el && !last.el.classList.contains("vpp-chain-end")) {
        ctx.mbody.appendChild(last.el);
        last.el.classList.add("vpp-chain-end");
        last.h = last.el.offsetHeight + marginBottom(last.el);
        last.el.remove();
      }
    }
    return out;
  }

  function pack(items, capacity, ctx) {
    var pages = [], cur = [], used = 0, movedHeads = false;
    pages.push(cur);
    function hOf(x) { return x.h > 0 ? x.h : 0; }
    function allHeads(p) {
      if (!p.length) return false;
      for (var i = 0; i < p.length; i++) { if (!p[i].headLike) return false; }
      return true;
    }
    /* 换页；若这一页只装了标题类块（大题标题、题号行、小节标签），
       整张撤掉把标题带到下一页去——宁可让标题引导新页，也不要一页只有一行标题。
       movedHeads 保证不会连着搬两次，避免和「块比整页还高」的极端情况互相顶着不放。 */
    function newPage() {
      var carry = (allHeads(cur) && !movedHeads) ? cur.slice() : null;
      if (carry) pages.pop();
      cur = [];
      pages.push(cur);
      used = 0;
      if (carry) carry.forEach(function (x) { cur.push(x); used += hOf(x); });
      movedHeads = !!carry;
    }
    items.forEach(function (it) {
      if (it.pageBreak && cur.length) newPage();
      /* 高度必须落成有限正数：一旦是 NaN / undefined，下面的加法比较会静默失败，
         块会被当成「哪里都放得下」，于是既不换页也不切分，直接溢出纸面。 */
      var h = hOf(it);
      if (used + h <= capacity) {
        /* 孤行防治：标题类块后面必须还能容下一小段内容，否则整块推到下一页 */
        if (it.keepWith && cur.length && capacity - (used + h) < it.keepWith) newPage();
        cur.push(it); used += h;
        movedHeads = false;
        return;
      }
      if (it.kind === "text") {
        splitItem(it, Math.max(0, capacity - used), capacity, ctx).forEach(function (c) {
          if (used + c.h > capacity) newPage();
          cur.push(c); used += c.h;
        });
        movedHeads = false;
        return;
      }
      if (cur.length) newPage();
      cur.push(it); used += h;
      movedHeads = false;
    });
    return pages;
  }

  function paint(pages, payload, o, root) {
    var meta = paperMeta(payload);
    var total = pages.length;
    pages.forEach(function (blocks, i) {
      var sheet = makeSheet(false);
      var body = sheet.querySelector(".vpp-mbody");
      blocks.forEach(function (b) { body.appendChild(b.el); });
      sheet.querySelector(".vpp-head-l").textContent = meta.title;
      var rh = "";
      for (var k = 0; k < blocks.length; k++) {
        if (blocks[k].header) { rh = blocks[k].header; break; }
      }
      sheet.querySelector(".vpp-head-r").textContent = rh;
      sheet.querySelector(".vpp-foot-c").textContent = "第 " + (i + 1) + " 页 / 共 " + total + " 页";
      root.appendChild(sheet);
    });
  }

  /* ==================== 数据整理 ==================== */
  function qTotal(payload) {
    var n = 0;
    (payload.groups || []).forEach(function (g) { n += (g.questions || []).length; });
    return n;
  }
  function paperMeta(payload) {
    var paper = payload.paper || {};
    var t = str(paper.title).trim() || str(payload.title).trim() || "试卷讲解";
    return { title: t, alt: str(payload.title).trim(), subject: str(paper.subject).trim(), year: str(paper.year).trim() };
  }
  function answerMapOf(payload) {
    var m = payload.answerMap;
    var keys = m && typeof m === "object" ? Object.keys(m) : [];
    if (keys.length) return m;
    var out = {};
    (payload.groups || []).forEach(function (g) {
      (g.questions || []).forEach(function (q) { if (has(q.answer)) out[str(q.no)] = detag(q.answer); });
    });
    return out;
  }
  function groupTitle(g, gi) {
    var t = str(g.title).trim() || "第 " + (gi + 1) + " 部分";
    return /^[一二三四五六七八九十]+\s*[、.．]/.test(t) ? t : cnNum(gi) + "、" + t;
  }
  /* 同一篇原文被同组多题共享，解析后每道题的 passage 都是同一份正文——直接印就是同一篇印 3-4 遍。
     这里按「同大题内正文完全一致」合并成一段；有个别不一致的题仍单独印自己的语篇，
     绝不会张冠李戴。编号引用没解析出来的题 passage 为空，key 为空即跳过，不印占位符。 */
  function segments(g) {
    var out = [];
    (g.questions || []).forEach(function (q) {
      var key = str(q.passage).replace(/\s+/g, " ").trim();
      var last = out[out.length - 1];
      if (last && last.key === key) last.questions.push(q);
      else out.push({ key: key, passage: q.passage, questions: [q] });
    });
    return out;
  }

  /* ==================== HTML 片段 ==================== */
  function ansBox(answer) {
    return '<span class="vpp-ansbox">答案：' + esc(detag(answer)) + "</span>";
  }
  function slabelHtml(text, mark) {
    return '<span class="vpp-mark vpp-mark-' + mark + '"></span><span>' + esc(text) + "</span>";
  }
  /* 正确项只用浅底标记，不加边框也不加内边距：盒模型与其它选项完全一致，
     字母和正文才会横竖都对齐。左粗线 + √ 的老做法会把正确项整体推右 3mm、推下 0.6mm，
     而且左粗线是语篇块（.vpp-passage）的身份标记，套在选项上会被读成引用块。 */
  function optionsHtml(list, answer, highlight, width) {
    var opts = (list || []).filter(function (o) { return o && has(o.text); });
    if (!opts.length) return "";
    var cols = chooseCols(opts, width);
    var h = '<div class="vpp-ogrid" data-cols="' + cols + '">';
    opts.forEach(function (o) {
      var ok = highlight && has(answer) && sameLabel(o.label, answer);
      h += '<div class="vpp-o"' + (ok ? ' data-correct="1"' : "") + ">"
        + '<span class="vpp-o-l">' + esc(o.label) + "</span>"
        + '<span class="vpp-o-t">' + fmt(o.text) + "</span></div>";
    });
    return h + "</div>";
  }
  function groupHeadHtml(g, gi, withIntro) {
    var h = '<div class="vpp-gh-line"><span class="vpp-gh-title">' + fmt(groupTitle(g, gi)) + "</span>"
      + '<span class="vpp-gh-count">共 ' + (g.questions || []).length + " 题</span></div>";
    if (withIntro && has(g.intro)) h += '<div class="vpp-gh-intro">' + fmt(g.intro) + "</div>";
    return h;
  }
  function qheadLines(q) {
    var lines = textLines(q.stem);
    if (!lines.length) lines.push(line(""));
    var tag = q.qtype === "writing" ? "写作" : (q.qtype === "blank" ? "填空" : "");
    var no = str(q.no).replace(/[.．。]+$/, "");
    lines[0].pre = (lines[0].pre || "")
      + '<span class="vpp-qno">' + esc(no) + ".</span>"
      + (tag ? '<span class="vpp-qtag">' + tag + "</span> " : "");
    return lines;
  }
  function writeLinesHtml(rows, cap) {
    var h = cap ? '<div class="vpp-wl-cap">' + esc(cap) + "</div>" : "";
    for (var i = 0; i < rows; i++) h += '<div class="vpp-wl-row"></div>';
    return h;
  }
  /* 答案速查表：每行 6 组「题号 + 答案」，一块最多 36 格，避免整张表比一页还高。
     两个坑都在这里避掉：
     · 列宽必须用百分比且总和不超过 100%。固定布局下表格宽度取「声明宽度」与「列宽之和」
       的较大值——列宽用毫米一旦超一点点，整张表就撑出正文区，最右边那条边线会被裁掉。
     · 末行不补空格子。补出来就是一排空框，看起来像表格没填完；不补，格线自然停在最后一个答案。 */
  function ansmapItems(payload, header) {
    var map = answerMapOf(payload);
    var keys = Object.keys(map);
    if (!keys.length) return [];
    var COLS = 6, PER = COLS * 6, out = [];
    for (var i = 0; i < keys.length; i += PER) {
      var slice = keys.slice(i, i + PER);
      var h = i === 0 ? '<div class="vpp-am-cap">答案速查</div>' : "";
      h += '<table class="vpp-amt"><colgroup>';
      for (var c = 0; c < COLS; c++) h += '<col style="width:4.2%"><col style="width:12.4%">';
      h += "</colgroup><tbody>";
      for (var r = 0; r < slice.length; r += COLS) {
        h += "<tr>";
        for (var k = 0; k < COLS; k++) {
          var key = slice[r + k];
          if (key == null) continue;
          h += '<td class="vpp-am-no">' + esc(key) + ".</td>";
          h += '<td class="vpp-am-ans">' + fmt(str(map[key])) + "</td>";
        }
        h += "</tr>";
      }
      h += "</tbody></table>";
      out.push(itemHtml("ansmap", h, { header: header, keepWith: mm(18) }));
    }
    return out;
  }

  /* ==================== 内容装配 ==================== */
  function mastheadItems(payload, ctx) {
    var m = paperMeta(payload);
    var bits = [];
    if (m.subject) bits.push(m.subject);
    if (m.year) bits.push(m.year);
    bits.push("共 " + qTotal(payload) + " 题");
    bits.push(todayStr());                     /* 只写日期本身，不写「生成日期」四个字 */
    var h = "";
    if (m.alt && m.alt !== m.title) h += '<div class="vpp-mh-overline">' + esc(m.alt) + "</div>";
    h += '<h1 class="vpp-mh-title">' + esc(m.title) + "</h1>";
    h += '<div class="vpp-mh-meta">' + bits.map(function (b) { return "<span>" + esc(b) + "</span>"; }).join("") + "</div>";
    /* 试卷说明只给老师看：里面是「答案为 AI 判断，建议教师核对」「已自动跳过听力」这类
       讲评前的提醒，印到发给学生的练习卷上既没必要，也会让学生怀疑答案的可靠性。
       教师版与答案册都要印：它们都摆着答案，正是需要这条提醒的地方。 */
    if (ctx.o.mode !== "student" && has(payload.notice)) {
      h += '<div class="vpp-mh-notice"><span class="vpp-mh-nlabel">说明</span>' + fmt(payload.notice) + "</div>";
    }
    return [itemHtml("masthead", h, { header: MODE_LABEL[ctx.o.mode], keepWith: mm(26), headLike: true })];
  }
  function passageItem(passage, header) {
    return itemText("passage", textLines(passage), { header: header, script: scriptOf(passage) });
  }
  function refLines(reference) {
    var ref = reference || {}, out = [];
    if (has(ref.evidence)) out.push(line(ref.evidence, { pre: '<span class="vpp-lab">【证据】</span>' }));
    if (has(ref.reason)) out.push(line(ref.reason, { pre: '<span class="vpp-lab">【推理】</span>' }));
    if (has(ref.distractor)) out.push(line(ref.distractor, { pre: '<span class="vpp-lab">【干扰项】</span>' }));
    return out;
  }
  function pitfallItems(list, header, ctx) {
    var out = [itemHtml("slabel", slabelHtml("易错点", "sq"), { header: header, keepWith: mm(10), headLike: true })];
    (list || []).forEach(function (p, i) {
      out.push(itemText("pf", [
        line(p.title || "易错点", { cls: "vpp-pf-title", pre: '<span class="vpp-pf-no">' + (i + 1) + ".</span>" }),
        line(p.desc || "", { cls: "vpp-pf-desc" })
      ], { header: header, hang: hangOf(4.5, ctx), keepWith: mm(9), script: scriptOf(p.desc) }));
    });
    return out;
  }
  function patternItem(ptn, header) {
    var steps = (ptn.steps || []).filter(has);
    var h = '<div class="vpp-slabel">' + slabelHtml("考点范式", "ci") + "</div>";
    if (has(ptn.name)) h += '<p class="vpp-p"><span class="vpp-lab">范式：</span>' + fmt(ptn.name) + "</p>";
    if (steps.length) {
      h += '<ol class="vpp-steps">' + steps.map(function (s) { return "<li>" + fmt(s) + "</li>"; }).join("") + "</ol>";
    }
    return itemHtml("pat", h, { header: header, keepWith: mm(12), script: scriptOf(ptn.name + " " + steps.join(" ")) });
  }
  /* 写作指导拆成「脚手架」与「范文」两半：
     教师版两半都跟着题目走；学生版脚手架留在卷面（学生要照着写），范文进答案册。 */
  function writingScaffold(wg, header) {
    var points = (wg.points || []).filter(has);
    if (!points.length && !has(wg.outline)) return null;
    var h = '<div class="vpp-chain-cap">写作指导</div>';
    if (points.length) h += '<ol class="vpp-steps">' + points.map(function (p) { return "<li>" + fmt(p) + "</li>"; }).join("") + "</ol>";
    if (has(wg.outline)) h += '<p class="vpp-p"><span class="vpp-lab">结构框架　</span>' + fmt(wg.outline) + "</p>";
    return itemHtml("wg", h, { header: header, chain: true, script: "cjk" });
  }
  function writingSample(wg, header) {
    if (!has(wg.sample)) return null;
    var lines = textLines(wg.sample);
    lines[0].pre = (lines[0].pre || "") + '<span class="vpp-lab">范文　</span>';
    return itemText("wg", lines, { header: header, chain: true, script: scriptOf(wg.sample) });
  }
  /* 迁移训练：题目与答案可以分开走（学生版题目进卷面、答案进答案册）。
     用左线串联而不是整体套框——任何一块都可能在页脚被切开，套框会在书脊处断得很难看。 */
  function transferItems(list, header, ctx, withQuestion, withAnswer) {
    var subs = [];
    var n = list.length;
    list.forEach(function (tr, ti) {
      if (!tr) return;
      if (withQuestion) {
        subs.push(itemHtml("tr", '<div class="vpp-chain-cap">迁移训练' + (n > 1 ? " " + (ti + 1) + " / " + n : "") + "</div>", { header: header }));
        if (has(tr.passage)) subs.push(itemText("tr", textLines(tr.passage), { header: header, script: scriptOf(tr.passage) }));
        if (has(tr.stem)) subs.push(itemText("tr", textLines(tr.stem), { header: header, script: scriptOf(tr.stem) }));
        if ((tr.options || []).length) {
          subs.push(itemHtml("tr", optionsHtml(tr.options, tr.answer, false, ctx.contentW - mm(5)), { header: header }));
        }
      } else {
        subs.push(itemHtml("tr", '<div class="vpp-chain-cap">迁移训练' + (n > 1 ? " " + (ti + 1) + " / " + n : "") + "</div>", { header: header }));
      }
      if (withAnswer) {
        if (has(tr.answer)) subs.push(itemHtml("tr", ansBox(tr.answer), { header: header }));
        if (has(tr.explanation)) subs.push(itemText("tr", textLines(tr.explanation), { header: header, script: scriptOf(tr.explanation) }));
      }
    });
    if (!subs.length) return [];
    subs[subs.length - 1].chainEnd = true;
    subs.forEach(function (s) { s.chain = true; });
    return subs;
  }

  function teacherItems(payload, ctx) {
    var o = ctx.o;
    var out = mastheadItems(payload, ctx);
    if (o.ansmap) pushAll(out, ansmapItems(payload, MODE_LABEL[o.mode]));
    (payload.groups || []).forEach(function (g, gi) {
      var gh = groupTitle(g, gi);
      out.push(itemHtml("group", groupHeadHtml(g, gi, true), { header: gh, pageBreak: !!o.groupBreak && gi > 0, keepWith: mm(45), headLike: true }));
      segments(g).forEach(function (seg) {
        if (seg.key) out.push(passageItem(seg.passage, gh));
        seg.questions.forEach(function (q) {
          out.push(itemText("qhead", qheadLines(q), { header: gh, hang: hangOf(7, ctx), keepWith: mm(22), headLike: true, script: scriptOf(q.stem) }));
          if ((q.options || []).length) out.push(itemHtml("opts", optionsHtml(q.options, q.answer, true, ctx.contentW), { header: gh }));
          if (q.writingGuide) {
            var wgItems = [writingScaffold(q.writingGuide, gh), writingSample(q.writingGuide, gh)].filter(Boolean);
            if (wgItems.length) {
              wgItems[wgItems.length - 1].chainEnd = true;
              pushAll(out, wgItems);
            }
          }
          if (has(q.answer)) out.push(itemHtml("ansbar", ansBox(q.answer), { header: gh, keepWith: mm(16), headLike: true }));
          var rl = refLines(q.reference);
          if (rl.length) out.push(itemText("ref", rl, { header: gh, keepWith: mm(12), script: scriptOf(rl.map(function (x) { return x.raw; }).join(" ")) }));
          if (o.pitfalls && (q.pitfalls || []).length) pushAll(out, pitfallItems(q.pitfalls, gh, ctx));
          if (o.pattern && q.pattern && (has(q.pattern.name) || (q.pattern.steps || []).length)) out.push(patternItem(q.pattern, gh));
          if (o.transfers && (q.transfers || []).length) pushAll(out, transferItems(q.transfers, gh, ctx, true, true));
        });
      });
    });
    return out;
  }

  /* 学生练习版：一张干净的卷子——题目、选项、作答横线，写作题只给写作指导（学生照着写），
     不含答案、解析、易错点、考点范式、迁移训练答案与范文。
     老师把这一册整份发给学生时，纸上不会出现任何答案。 */
  function studentItems(payload, ctx) {
    var o = ctx.o;
    var out = mastheadItems(payload, ctx);
    (payload.groups || []).forEach(function (g, gi) {
      var gh = groupTitle(g, gi);
      out.push(itemHtml("group", groupHeadHtml(g, gi, false), { header: gh, pageBreak: !!o.groupBreak && gi > 0, keepWith: mm(45), headLike: true }));
      segments(g).forEach(function (seg) {
        if (seg.key) out.push(passageItem(seg.passage, gh));
        seg.questions.forEach(function (q) {
          out.push(itemText("qhead", qheadLines(q), { header: gh, hang: hangOf(7, ctx), keepWith: mm(20), headLike: true, script: scriptOf(q.stem) }));
          if ((q.options || []).length) out.push(itemHtml("opts", optionsHtml(q.options, q.answer, false, ctx.contentW), { header: gh }));
          if (q.writingGuide) {
            var sc = writingScaffold(q.writingGuide, gh);
            if (sc) { sc.chainEnd = true; out.push(sc); }
          }
          if (o.transfers && (q.transfers || []).length) pushAll(out, transferItems(q.transfers, gh, ctx, true, false));
          if (q.qtype === "blank") out.push(itemHtml("wl", writeLinesHtml(3, "作答"), { header: gh, keepWith: mm(20) }));
          else if (q.qtype === "writing") out.push(itemHtml("wl", writeLinesHtml(9, "作答"), { header: gh, keepWith: mm(28) }));
        });
      });
    });
    return out;
  }

  /* 答案解析：只印答案、解析、易错点、考点范式、迁移训练答案与范文，不印题干与选项。
     单独成册，老师可以只发给做完题的学生，也可以自己留着核对。 */
  function answerItems(payload, ctx) {
    var o = ctx.o;
    var out = mastheadItems(payload, ctx);
    out.push(itemHtml("part", '答案解析<span class="vpp-part-sub">答案、解析与范文　与学生练习版对照使用</span>',
      { header: MODE_LABEL.answer, keepWith: mm(30), headLike: true }));
    if (o.ansmap) pushAll(out, ansmapItems(payload, MODE_LABEL.answer));
    (payload.groups || []).forEach(function (g, gi) {
      var qs = g.questions || [];
      if (!qs.length) return;
      var gh = groupTitle(g, gi);
      out.push(itemHtml("group", groupHeadHtml(g, gi, false), { header: gh, keepWith: mm(26), headLike: true }));
      qs.forEach(function (q) {
        /* 先攒这题在本册里要印的所有小块，再看要不要印「第 N 题」这个题头：
           一条都印不出来的题目整条跳过，否则纸上会出现一行光秃秃的题号。 */
        var subs = [];
        var rl = refLines(q.reference);
        if (rl.length) subs.push(itemText("ref", rl, { header: gh, keepWith: mm(12), script: scriptOf(rl.map(function (x) { return x.raw; }).join(" ")) }));
        if (o.pitfalls && (q.pitfalls || []).length) pushAll(subs, pitfallItems(q.pitfalls, gh, ctx));
        if (o.pattern && q.pattern && (has(q.pattern.name) || (q.pattern.steps || []).length)) subs.push(patternItem(q.pattern, gh));
        if (o.transfers && (q.transfers || []).length) pushAll(subs, transferItems(q.transfers, gh, ctx, false, true));
        if (q.writingGuide) {
          var sm = writingSample(q.writingGuide, gh);
          if (sm) { sm.chainEnd = true; subs.push(sm); }
        }
        var tag = q.qtype === "writing" ? "写作" : (q.qtype === "blank" ? "填空" : "");
        if (!has(q.answer) && !tag && !subs.length) return;
        var h = '<span class="vpp-qref-no">第 ' + esc(str(q.no).replace(/[.．。]+$/, "")) + " 题</span>";
        if (has(q.answer)) h += ansBox(q.answer);
        else if (tag) h += '<span class="vpp-qref-tag">' + tag + "题</span>";
        out.push(itemHtml("qref", h, { header: gh, keepWith: mm(16), headLike: true }));
        pushAll(out, subs);
      });
    });
    return out;
  }

  /* ==================== 排版主流程 ==================== */
  function layout(payload, o, root) {
    while (root.firstChild) root.removeChild(root.firstChild);
    var probe = makeSheet(true);
    root.appendChild(probe);
    var mbody = probe.querySelector(".vpp-mbody");
    /* 容量与宽度全靠实测：空纸的正文区有多高，一页就能装多高。
       两个数字都不写死，样式改了也不会对不上。 */
    var ctx = { o: o, capacity: mbody.clientHeight, contentW: mbody.clientWidth, mbody: mbody };
    var items = o.mode === "student" ? studentItems(payload, ctx)
      : o.mode === "answer" ? answerItems(payload, ctx)
        : teacherItems(payload, ctx);
    items.forEach(function (it) { it.el = makeEl(it, false); mbody.appendChild(it.el); });
    /* 全部塞进量纸后一次性读高：中间没有写操作，只触发一次布局 */
    items.forEach(function (it) { it.h = it.el.offsetHeight + marginBottom(it.el); });
    var pages = pack(items, ctx.capacity, ctx);
    paint(pages, payload, o, root);
    probe.remove();
    return pages.length;
  }

  /* ==================== 打印文档内的渲染入口 ==================== */
  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return {};
    try { return JSON.parse(el.textContent || "{}") || {}; } catch (e) { return {}; }
  }
  function normalizeOpts(o) {
    var out = assign({}, DEFAULTS);
    if (o) for (var k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; }
    out.mode = normMode(out.mode);
    /* 字号可能来自旧版本存下的选项：非法值一律退回默认，别把整份排版拖垮 */
    out.fontPt = typeof out.fontPt === "number" && isFinite(out.fontPt)
      ? Math.min(PT_MAX, Math.max(PT_MIN, out.fontPt)) : BASE_PT;
    return out;
  }
  function renderPrintDoc() {
    var root = document.getElementById(ROOT_ID);
    var dataEl = document.getElementById(DATA_ID);
    if (!root || !dataEl) return Promise.resolve(false);
    var payload = readJSON(DATA_ID);
    var opts = normalizeOpts(readJSON(OPTS_ID));
    document.title = docTitle(payload, opts);
    function run() {
      try {
        window.__vppPages = layout(payload, opts, root);
        window.__vppError = "";
      } catch (e) {
        window.__vppError = String((e && e.message) || e);
      }
    }
    run();
    /* 系统字体通常已就绪；真有字体在加载就等它落定再排一次，
       字体度量一变行高全变，不重排的话分页会错。 */
    var fonts = document.fonts;
    if (fonts && fonts.status !== "loaded" && fonts.ready && fonts.ready.then) {
      return fonts.ready.then(function () { run(); window.__vppReady = true; return true; },
        function () { window.__vppReady = true; return true; });
    }
    window.__vppReady = true;
    return Promise.resolve(true);
  }

  /* ==================== 文档装配与资源 ==================== */
  /* 文档标题（打印时的文件名、预览标签页）：带上学版别——三册同源，混在一个文件夹里要分得清 */
  function docTitle(payload, o) {
    var m = paperMeta(payload);
    var suffix = o.mode === "student" ? "（学生练习版）" : (o.mode === "answer" ? "（答案解析）" : "");
    return m.title + suffix;
  }
  /* 三个版本常常先后来自同一个文件夹：文件名各自带版本名，后下的不会盖掉先下的 */
  function fileName(payload, o) {
    var base = str(payload.title).trim() || paperMeta(payload).title;
    return base + "打印版（" + MODE_LABEL[o.mode] + "）";
  }
  function safeJson(v) {
    /* 内容里若出现脚本结束标签会提前闭合数据块，把 < 全部转义掉最省事。
       注意：本文件会被原样内联进宿主页面与打印文档的脚本元素里，源码中绝不能出现
       脚本起止标签的字面量（注释里也不行——HTML 解析器不认 JS 注释，会当场截断）。 */
    return JSON.stringify(v).replace(/</g, "\\u003c");
  }
  function assetUrl(name) {
    if (!SELF_SRC) return "/static/" + name;
    var u = SELF_SRC.replace(/vp-print\.js(\?.*)?$/, name);
    return u === SELF_SRC ? "/static/" + name : u;
  }
  function loadText(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " → " + r.status);
      return r.text();
    });
  }
  var _assets = null;
  function assets() {
    if (_assets) return _assets;
    /* 单文件打印版（离线）里，样式与本文件源码都已经内联在文档里，取出来直接用；
       应用页面里则是外部加载，把自己的源码与同名样式抓回来。 */
    var cssTag = document.getElementById(CSS_ID);
    var jsTag = document.getElementById("vpp-js-src");
    var cssP = cssTag ? Promise.resolve(cssTag.textContent || "") : loadText(assetUrl("vp-print.css"));
    var jsP = jsTag ? Promise.resolve(jsTag.textContent || "") : loadText(assetUrl("vp-print.js"));
    _assets = Promise.all([cssP, jsP]).then(function (a) { return { css: a[0], js: a[1] }; });
    return _assets;
  }

  var SCRIPT_CLOSE = "<\/script>";
  function buildHtml(payload, o, embed) {
    return assets().then(function (a) {
      var head = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + "<title>" + esc(docTitle(payload, o)) + "</title>"
        + "<style>" + a.css + "</style>"
        + "<style>body.vpp{" + typeVars(o) + "}</style></head><body class=\"vpp\">";
      var body = '<div id="' + ROOT_ID + '"></div>'
        + '<script id="' + DATA_ID + '" type="application/json">' + safeJson(payload) + SCRIPT_CLOSE
        + '<script id="' + OPTS_ID + '" type="application/json">' + safeJson(o) + SCRIPT_CLOSE
        + (embed ? "" : '<button class="vpp-printbtn" type="button" onclick="window.print()">打印 / 另存为 PDF</button>')
        + "<script>" + a.js + SCRIPT_CLOSE;
      return head + body + "</body></html>";
    });
  }

  /* ==================== 宿主侧动作 ==================== */
  function waitReady(win, timeout) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        if (win.__vppReady || Date.now() - t0 > timeout) { resolve(); return; }
        setTimeout(poll, 40);
      })();
    });
  }
  function printDoc(payload, o) {
    o = normalizeOpts(o);
    return buildHtml(payload, o, true).then(function (html) {
      var old = document.getElementById(FRAME_ID);
      if (old) old.remove();
      var frame = document.createElement("iframe");
      frame.id = FRAME_ID;
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(frame);
      var doc = frame.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      var win = frame.contentWindow;
      win.addEventListener("afterprint", function () { setTimeout(function () { frame.remove(); }, 500); });
      return waitReady(win, 8000).then(function () {
        var pages = win.__vppPages || 0;
        var err = win.__vppError || "";
        try {
          win.focus();
          win.print();
        } catch (e) {
          frame.remove();
          throw new Error("打印窗口唤起失败，请重试");
        }
        return { pages: pages, error: err };
      });
    });
  }
  function previewDoc(payload, o) {
    o = normalizeOpts(o);
    return buildHtml(payload, o, false).then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      var w = window.open(url, "_blank");
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      return { opened: !!w };
    });
  }
  function downloadDoc(payload, o, name) {
    o = normalizeOpts(o);
    return buildHtml(payload, o, false).then(function (html) {
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = (name || docTitle(payload, o)) + ".html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return { ok: true };
    });
  }

  /* ==================== 设置弹窗 ====================
     模块自带界面与样式：应用页面和导出的单文件都要用同一套弹窗，
     宿主只需要给一个 payload。颜色一律走宿主的主题变量并留回退值。 */
  var DLG_ID = "vpp-dlg";
  var DLG_CSS_ID = "vpp-dlg-css";
  function dlgCss() {
    return ""
      + "#" + DLG_ID + "{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;"
      /* 遮罩照 App 的 .modal-mask：主题背景色兑 55% 透明 + 10px 毛玻璃。
         前一行是给不支持 color-mix 的老浏览器留的旧色。 */
      + "background:rgba(10,8,6,.5);background:color-mix(in srgb,var(--bg,#fff) 55%,transparent);"
      + "-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);"
      + "font-family:var(--font,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif);color:var(--text,#1d1a15);"
      /* 入场效果与 App 里「下载讲解文件」的弹窗完全一致：遮罩淡入 + 卡片弹入，
         用同一条 0.45s 弹簧曲线。这套样式会被内联进导出的单文件，
         所以曲线写进 var 回退里，不依赖页面上的缓动变量。 */
      + "animation:vppd-mask-in .15s ease both}"
      + "@keyframes vppd-mask-in{from{opacity:0}to{opacity:1}}"
      + "@keyframes vppd-card-in{from{opacity:0;transform:scale(.92) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}"
      + "#" + DLG_ID + " *{box-sizing:border-box}"
      + "#" + DLG_ID + " .vppd-card{width:min(30rem,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;"
      + "border-radius:1.3rem;overflow:hidden;"
      /* 卡片面照 App 的 .modal-card + .glass-deep：同一层毛玻璃、同一条描边、同一个投影。
         不支持 color-mix 时退回上一行的实底色与后面的回退值，不至于把卡片画没。 */
      + "background-color:var(--bg,#fff);"
      + "background:linear-gradient(180deg,color-mix(in srgb,var(--glass-spec,#fffdf8) 12%,transparent) 0%,"
      + "color-mix(in srgb,var(--glass-spec,#fffdf8) 0%,transparent) 14%),var(--panel-strong,rgba(255,255,255,.86));"
      + "border:1px solid var(--border,rgba(0,0,0,.08));"
      + "backdrop-filter:blur(var(--glass-blur-deep,5px)) saturate(var(--glass-sat,150%)) contrast(var(--glass-contrast,104%));"
      + "-webkit-backdrop-filter:blur(var(--glass-blur-deep,5px)) saturate(var(--glass-sat,150%)) contrast(var(--glass-contrast,104%));"
      + "box-shadow:inset 0 1px 0 color-mix(in srgb,var(--glass-spec,#fffdf8) 26%,transparent),"
      + "inset 0 -1px 0 color-mix(in srgb,var(--glass-spec,#fffdf8) 8%,transparent),var(--shadow,0 20px 55px -14px rgba(0,0,0,.45));"
      + "animation:vppd-card-in .45s var(--ease-spring,cubic-bezier(.34,1.45,.64,1)) both}"
      + "#" + DLG_ID + " .vppd-head{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border,rgba(0,0,0,.08))}"
      + "#" + DLG_ID + " .vppd-head h3{margin:0;font-size:.9rem;font-weight:700}"
      + "#" + DLG_ID + " .vppd-x{margin-left:auto;width:28px;height:28px;border-radius:8px;border:1px solid var(--border,rgba(0,0,0,.1));"
      + "background:transparent;color:inherit;cursor:pointer;font-size:16px;line-height:1}"
      + "#" + DLG_ID + " .vppd-x:hover{background:var(--hover-bg,rgba(0,0,0,.06))}"
      + "#" + DLG_ID + " .vppd-body{padding:16px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}"
      + "#" + DLG_ID + " .vppd-label{font-size:.72rem;color:var(--text-dim,#6f675a);margin-bottom:7px}"
      /* 三个版本分成两个框：老师自用的一框、发给学生的一框。标签写在框内左侧而不是占一整行，
         两个框按内容宽度收窄、并排排在一行里（宽度不够时自动折成两行）。
         框是分组用的，不靠颜色也能看出归属；选中的那一框描边略深，一眼知道现在选的是哪一版。 */
      + "#" + DLG_ID + " .vppd-grps{display:flex;flex-wrap:wrap;gap:8px}"
      + "#" + DLG_ID + " .vppd-grp{display:flex;align-items:center;gap:9px;min-width:0;padding:7px 9px 7px 11px;"
      + "border:1px solid var(--border,rgba(0,0,0,.08));border-radius:12px;transition:border-color .16s}"
      + "#" + DLG_ID + " .vppd-grp.vppd-on{border-color:var(--border-strong,rgba(0,0,0,.22))}"
      + "#" + DLG_ID + " .vppd-grp-cap{font-size:.72rem;line-height:1.3;color:var(--text-faint,#a29a8b);white-space:nowrap}"
      + "#" + DLG_ID + " .vppd-grp.vppd-on .vppd-grp-cap{color:var(--text-dim,#6f675a)}"
      + "#" + DLG_ID + " .vppd-seg{display:flex;gap:8px;min-width:0}"
      + "#" + DLG_ID + " .vppd-seg label{position:relative;cursor:pointer}"
      + "#" + DLG_ID + " .vppd-seg input{position:absolute;opacity:0;pointer-events:none}"
      + "#" + DLG_ID + " .vppd-seg span{display:block;text-align:center;font-size:.78rem;font-weight:600;padding:9px 10px;border-radius:10px;"
      + "border:1px solid var(--border-strong,rgba(0,0,0,.14));background:transparent;transition:all .16s}"
      + "#" + DLG_ID + " .vppd-seg input:checked+span{background:var(--btn-bg,#1d1a15);color:var(--btn-text,#f5f2ea);border-color:var(--btn-bg,#1d1a15)}"
      + "#" + DLG_ID + " .vppd-seg input:focus-visible+span{outline:2px solid var(--accent,#b4502a);outline-offset:2px}"
      /* 布尔开关一律用看得见的方框加勾（自绘，不依赖字体字形）：
         「印不印迁移训练」「大题要不要另起一页」都是是非题，做成胶囊标签会像标签而不像开关。 */
      + "#" + DLG_ID + " .vppd-cbs{display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}"
      + "#" + DLG_ID + " .vppd-cbs.single{grid-template-columns:1fr}"
      + "#" + DLG_ID + " .vppd-cb{position:relative;display:flex;align-items:flex-start;gap:8px;cursor:pointer;"
      + "font-size:.78rem;line-height:1.35}"
      + "#" + DLG_ID + " .vppd-cb input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}"
      + "#" + DLG_ID + " .vppd-box{flex:none;position:relative;width:15px;height:15px;margin-top:1px;border-radius:4.5px;"
      + "border:1.5px solid var(--text-faint,#9a9a9a);background:transparent;transition:all .16s}"
      + "#" + DLG_ID + " .vppd-cb:hover .vppd-box{border-color:var(--accent,#b4502a)}"
      /* 置灰（学生练习版里无内容可印的项）：只压暗，不改勾选状态——
         切回教师版时原来的勾选要原样回来。方框边框一并锁成灰的，
         连同下面 :checked 的橙色边框一起压住，悬停也不会亮起来。 */
      + "#" + DLG_ID + " .vppd-cb.vppd-off{opacity:.42;cursor:default}"
      + "#" + DLG_ID + " .vppd-cb.vppd-off .vppd-box,#" + DLG_ID + " .vppd-cb.vppd-off input:checked~.vppd-box"
      + "{border-color:var(--text-faint,#9a9a9a)}"
      + "#" + DLG_ID + " .vppd-cb input:checked~.vppd-box{background:var(--accent,#b4502a);border-color:var(--accent,#b4502a)}"
      /* 勾用两条边框画出来：15px 方框内含 1.5px 边框，去掉边框后是 12px 内容区，
         4×7.5 的小 L 旋转 40° 后四角仍在 12px 内，顶到不了边框上。 */
      + "#" + DLG_ID + " .vppd-cb input:checked~.vppd-box::after{content:'';position:absolute;left:4px;top:2px;width:4px;height:7.5px;"
      + "border:solid #fff;border-width:0 1.7px 1.7px 0;transform:rotate(40deg)}"
      + "#" + DLG_ID + " .vppd-cb input:focus-visible~.vppd-box{outline:2px solid var(--accent,#b4502a);outline-offset:2px}"
      + "#" + DLG_ID + " .vppd-srow{display:flex;align-items:center;gap:.6rem;padding:0 .15rem}"
      + "#" + DLG_ID + " .vppd-slabel{font-size:.75rem;font-weight:600;color:var(--text-dim,#6f675a);white-space:nowrap}"
      + "#" + DLG_ID + " .vppd-snum{font-size:.8rem;font-weight:700;color:var(--accent,#b4502a);min-width:3.4rem;text-align:center}"
      + "#" + DLG_ID + " .vppd-slider{flex:1;min-width:0;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;"
      + "background:var(--border-strong,rgba(0,0,0,.2));outline:none}"
      + "#" + DLG_ID + " .vppd-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;"
      + "background:var(--accent,#b4502a);border:2px solid var(--bg,#fff);box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer;transition:transform .2s}"
      + "#" + DLG_ID + " .vppd-slider::-webkit-slider-thumb:hover{transform:scale(1.2)}"
      + "#" + DLG_ID + " .vppd-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--accent,#b4502a);"
      + "border:2px solid var(--bg,#fff);box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer}"
      + "#" + DLG_ID + " .vppd-cbs.mt{margin-top:9px}"
      + "#" + DLG_ID + " .vppd-hint{font-size:.72rem;line-height:1.65;color:var(--text-dim,#6f675a);margin:-6px 0 0}"
      + "#" + DLG_ID + " .vppd-note{font-size:.7rem;line-height:1.7;color:var(--text-faint,#a29a8b);"
      + "border-top:1px dashed var(--border-strong,rgba(0,0,0,.14));padding-top:10px}"
      + "#" + DLG_ID + " .vppd-note b{color:var(--text-dim,#6f675a);font-weight:600}"
      + "#" + DLG_ID + " .vppd-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:14px 18px;border-top:1px solid var(--border,rgba(0,0,0,.08))}"
      + "#" + DLG_ID + " .vppd-btn{font-family:inherit;font-size:.78rem;font-weight:600;padding:9px 15px;border-radius:10px;cursor:pointer;"
      + "border:1px solid var(--border-strong,rgba(0,0,0,.14));background:transparent;color:inherit;transition:all .16s}"
      + "#" + DLG_ID + " .vppd-btn:hover{background:var(--hover-bg,rgba(0,0,0,.06))}"
      + "#" + DLG_ID + " .vppd-btn[disabled]{opacity:.5;cursor:default}"
      + "#" + DLG_ID + " .vppd-btn.primary{margin-left:auto;background:var(--btn-bg,#1d1a15);color:var(--btn-text,#f5f2ea);border-color:var(--btn-bg,#1d1a15)}"
      + "#" + DLG_ID + " .vppd-btn.primary:hover{opacity:.9}"
      /* 系统开了「减少动态效果」就不弹入：App 页面里 styles.css 有全局同类规则，
         导出的单文件没有，这里自带一条。 */
      + "@media (prefers-reduced-motion:reduce){#" + DLG_ID + ",#" + DLG_ID + " .vppd-card{animation:none}}";
  }
  function injectDlgCss() {
    if (document.getElementById(DLG_CSS_ID)) return;
    var s = document.createElement("style");
    s.id = DLG_CSS_ID;
    s.textContent = dlgCss();
    document.head.appendChild(s);
  }
  function readOpts() {
    try { return normalizeOpts(JSON.parse(localStorage.getItem(OPTS_KEY) || "{}")); }
    catch (e) { return normalizeOpts(null); }
  }
  function writeOpts(o) {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(normalizeOpts(o))); } catch (e) { /* 隐私模式忽略 */ }
  }
  function toast(msg, kind) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:10000;"
      + "padding:10px 16px;border-radius:10px;font-size:13px;line-height:1.5;max-width:80vw;"
      + "background:" + (kind === "error" ? "#8c2f1c" : "#241f19") + ";color:#fff;box-shadow:0 12px 30px -10px rgba(0,0,0,.5)";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }

  var PRINTER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M7 8V3h10v5"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>'
    + '<rect x="7" y="14" width="10" height="7" rx="1"/></svg>';

  /* 每个版本的说明都写清「印什么、不印什么」：老师选版时看的就是这一行，
     说不明白就会出现「把带答案的练习卷发给全班」。 */
  var MODE_HINT = {
    teacher: "题目、答案与解析同页连排，另附答案速查表。适合老师讲评时自己拿一份。",
    student: "只有题目、选项与作答区，不含任何答案与解析，可直接整份发给学生。易错点、考点范式与答案速查表只在另外两版里印。",
    answer: "只有答案、解析、易错点与范文，不含题干原文。与「学生练习版」配套使用。"
  };
  /* 学生练习版中无内容可印的勾选框（在 openDialog 里按版本置灰） */
  var STUDENT_OFF = { pitfalls: true, pattern: true, ansmap: true };

  function openDialog(payload, o) {
    if (!payload || !(payload.groups || []).length) { toast("暂无可打印的讲解内容", "error"); return; }
    injectDlgCss();
    var cur = normalizeOpts(assign(readOpts(), o));
    var old = document.getElementById(DLG_ID);
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = DLG_ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "打印试卷全解");
    var checks = [["transfers", "迁移训练"], ["pitfalls", "易错点"], ["pattern", "考点范式"], ["ansmap", "答案速查表"]];
    function modeOpt(v) {
      return '<label><input type="radio" name="vppd-mode" value="' + v + '"'
        + (cur.mode === v ? " checked" : "") + "><span>" + MODE_LABEL[v] + "</span></label>";
    }
    /* 一框一组：老师拿一册，学生拿两册（练习卷 + 答案册，可分开印）。
       分组本身就是在提醒「哪些是要发出去的」。 */
    function modeGrp(cap, inner) {
      return '<div class="vppd-grp" data-grp><span class="vppd-grp-cap">' + cap + '</span><div class="vppd-seg">' + inner + "</div></div>";
    }
    wrap.innerHTML = '<div class="vppd-card">'
      + '<div class="vppd-head">' + PRINTER_SVG + "<h3>打印试卷全解</h3>"
      + '<button class="vppd-x" type="button" data-act="cancel" aria-label="关闭">×</button></div>'
      + '<div class="vppd-body">'
      + '<div><div class="vppd-label">卷面</div><div class="vppd-grps">'
      + modeGrp("老师自用", modeOpt("teacher"))
      + modeGrp("发给学生", modeOpt("student") + modeOpt("answer"))
      + "</div></div>"
      + '<p class="vppd-hint" data-role="modehint"></p>'
      + '<div><div class="vppd-label">内容</div><div class="vppd-cbs">'
      + checks.map(function (c) {
        return '<label class="vppd-cb"><input type="checkbox" data-opt="' + c[0] + '"' + (cur[c[0]] ? " checked" : "")
          + '><span class="vppd-box"></span><span>' + c[1] + "</span></label>";
      }).join("")
      + "</div></div>"
      /* 版面一组：字号与分页都是"怎么排"，不是"印不印"——别和内容取舍混在一起。
         字号滑块照通用导出那个滑块的手感做：细轨道 + 实心圆钮 + 悬停放大。 */
      + '<div><div class="vppd-label">版面</div>'
      + '<div class="vppd-srow"><span class="vppd-slabel">文字大小</span>'
      + '<input type="range" class="vppd-slider" min="' + PT_MIN + '" max="' + PT_MAX + '" step="0.5" value="' + cur.fontPt + '">'
      + '<span class="vppd-snum">' + fmtPt(cur.fontPt) + "</span></div>"
      + '<div class="vppd-cbs single mt">'
      + '<label class="vppd-cb"><input type="checkbox" data-opt="groupBreak"' + (cur.groupBreak ? " checked" : "")
      + '><span class="vppd-box"></span><span>大题另起一页</span></label>'
      + "</div></div>"
      + '<div class="vppd-note"><b>要 PDF</b>：打印弹窗里把「目标」选成「另存为 PDF」。'
      + "<br><b>打印弹窗里请这样设</b>：纸张 A4、边距「默认」、缩放 100%、不勾「页眉和页脚」。</div>"
      + "</div>"
      + '<div class="vppd-foot">'
      + '<button class="vppd-btn" type="button" data-act="cancel">取消</button>'
      + '<button class="vppd-btn" type="button" data-act="download" title="单文件 HTML：可离线打开、随手转发，或发给文印店打印">下载打印版 HTML</button>'
      + '<button class="vppd-btn" type="button" data-act="preview" title="在新标签页里核对分页结果">预览分页</button>'
      + '<button class="vppd-btn primary" type="button" data-act="print" title="唤起系统打印：可直接出纸，也可另存为 PDF">打印 / 另存为 PDF</button>'
      + "</div></div>";
    document.body.appendChild(wrap);

    var modeHint = wrap.querySelector('[data-role="modehint"]');
    var sizeEl = wrap.querySelector(".vppd-slider");
    var sizeNum = wrap.querySelector(".vppd-snum");
    function readSize() {
      return Math.min(PT_MAX, Math.max(PT_MIN, Number(sizeEl && sizeEl.value) || BASE_PT));
    }
    function syncSize() { if (sizeNum) sizeNum.textContent = fmtPt(readSize()); }
    /* 换版本时同步两件事：说明文字，以及「这一版印不印得到」的勾选框。
       学生练习版里没有答案，易错点、考点范式、答案速查表都无从印起——一律置灰，
       否则老师勾着「答案速查表」选学生版，会以为答案跟着印出去了。
       置灰只锁交互，不动 checked：切回教师版时原来的勾选还在。 */
    function syncMode() {
      var m = readMode();
      if (modeHint) modeHint.textContent = MODE_HINT[m];
      /* 两个框里各有一枚单选钮：选中的那一框描边加深，选的是「自用」还是「发出去」一眼可见 */
      wrap.querySelectorAll("[data-grp]").forEach(function (g) {
        var on = !!g.querySelector("input:checked");
        if (on) g.classList.add("vppd-on"); else g.classList.remove("vppd-on");
      });
      wrap.querySelectorAll(".vppd-cb").forEach(function (lab) {
        var i = lab.querySelector("input[data-opt]");
        if (!i) return;
        var off = m === "student" && !!STUDENT_OFF[i.getAttribute("data-opt")];
        i.disabled = off;
        if (off) lab.classList.add("vppd-off"); else lab.classList.remove("vppd-off");
      });
    }
    function readMode() {
      var r = wrap.querySelector('input[name="vppd-mode"]:checked');
      return normMode(r && r.value);
    }
    function readForm() {
      var o2 = assign({}, cur);
      o2.mode = readMode();
      wrap.querySelectorAll("input[data-opt]").forEach(function (i) { o2[i.getAttribute("data-opt")] = !!i.checked; });
      o2.fontPt = readSize();
      return o2;
    }
    wrap.querySelectorAll("input").forEach(function (i) {
      i.addEventListener("change", function () { cur = readForm(); syncMode(); });
    });
    if (sizeEl) sizeEl.addEventListener("input", function () { syncSize(); cur = readForm(); });
    syncSize();
    syncMode();

    function close() {
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter" && e.target && e.target.tagName !== "INPUT") { e.preventDefault(); run("print"); }
    }
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });

    var busy = false;
    function run(act) {
      if (busy) return;
      var o2 = readForm();
      cur = o2;
      writeOpts(o2);
      if (act === "cancel") { close(); return; }
      if (act === "download") {
        close();
        downloadDoc(payload, o2, fileName(payload, o2))
          .then(function () { toast("打印版已下载：双击打开即可打印或存为 PDF"); })
          .catch(function () { toast("生成失败，请检查网络后重试", "error"); });
        return;
      }
      if (act === "preview") {
        close();
        previewDoc(payload, o2).then(function (r) {
          if (!r.opened) toast("浏览器拦下了新标签页，请允许弹出窗口后重试", "error");
          else toast("已在新标签页打开排版结果，确认分页后再打印");
        }).catch(function () { toast("生成失败，请检查网络后重试", "error"); });
        return;
      }
      busy = true;
      var btns = wrap.querySelectorAll(".vppd-btn");
      btns.forEach(function (b) { b.disabled = true; });
      btns[btns.length - 1].textContent = "正在排版…";
      printDoc(payload, o2).then(function (r) {
        if (r.error) toast("排版有异常：" + r.error, "error");
        else if (!r.pages) toast("没有可打印的内容", "error");
      }).catch(function (e) {
        toast((e && e.message) || "打印窗口唤起失败，请重试", "error");
      }).then(function () {
        if (document.body.contains(wrap)) close();
      });
    }
    wrap.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () { run(b.getAttribute("data-act")); });
    });
    var primary = wrap.querySelector(".vppd-btn.primary");
    if (primary) primary.focus();
  }

  /* ==================== 导出 ==================== */
  window.VPPrint = {
    version: VERSION,
    build: function (payload, o) { return buildHtml(payload, normalizeOpts(o), false); },
    print: printDoc,
    preview: previewDoc,
    download: downloadDoc,
    openDialog: openDialog,
    readOpts: readOpts,
    render: renderPrintDoc
  };

  /* 在打印文档里，本文件是被内联进去的：自己把纸排出来 */
  if (document.getElementById(DATA_ID) && document.getElementById(ROOT_ID)) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { renderPrintDoc(); });
    else renderPrintDoc();
  }
})();
