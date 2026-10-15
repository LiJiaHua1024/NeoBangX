/* 自由对话 · 卡片进工具的「徽章飞行」过渡用例
   运行：node --test frontend/tests/tool-switch-transition.test.js

   这块的风险不在动画好不好看（那要在浏览器里看），而在：
   1. 过渡不能让功能丢——状态落位要么整体发生，要么不发生，任何一步失败
      都要退回「直接切换」；
   2. 触发范围只覆盖卡片点击：侧栏/搜索等高频道口保持即时，不能被误伤；
   3. 连点时旧过渡被跳过，它的收尾不能把新一代的痕迹清掉；
   4. 光环境降级：无 View Transitions / 减少动态效果时要有明确的落地行为。
   测试用轻量 DOM 打桩跑真正的 animateToolSwitch / selectTool，不碰浏览器。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

// script.js 顶层有裸 matchMedia 调用（WIDE_MQ），Node 没有这个全局
if (typeof global.matchMedia !== "function") {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  global.matchMedia = () => mq;
}

/* ---------------- 轻量 DOM 打桩 ----------------
   只实现被测路径用到的能力：createElement / appendChild / remove /
   setAttribute / classList / querySelector(All) / getBoundingClientRect。
   元素注册在全局表里，querySelectorAll 按「已连接到 body」过滤。 */

function makeDom() {
  const all = [];

  function connected(el) {
    for (let n = el; n; n = n.parentNode) if (n === body) return true;
    return false;
  }

  function matchesSel(el, sel) {
    if (sel === "[data-nbx-fly-ghost]") return el._attrs["data-nbx-fly-ghost"] !== undefined;
    if (sel === "[data-nbx-fly-ico]") return el._attrs["data-nbx-fly-ico"] !== undefined;
    if (sel === "[data-nbx-vt]") return el._attrs["data-nbx-vt"] !== undefined;
    if (sel === ".nbx-flight-badge") return el.classList.contains("nbx-flight-badge");
    if (sel === ".nbx-tool-link.nbx-link-launch") {
      return el.classList.contains("nbx-tool-link") && el.classList.contains("nbx-link-launch");
    }
    if (sel === ".nbx-tool-link-ico") return el.classList.contains("nbx-tool-link-ico");
    if (sel === ".tool-view-root") return el.classList.contains("tool-view-root");
    if (sel === ".tool-head-badge") return el.classList.contains("tool-head-badge");
    return false;
  }

  function descendantList(root) {
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(root);
    return out;
  }

  function makeEl(tag, cls) {
    const classes = new Set(cls ? String(cls).split(/\s+/).filter(Boolean) : []);
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      style: {},
      _attrs: {},
      _removed: false,
      children: [],
      parentNode: null,
      innerHTML: "",
      offsetWidth: 40,
      _rects: 1,
      _rect: { left: 100, top: 200, width: 16, height: 16 },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = el;
        el.children.push(c);
        return c;
      },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        if (c.parentNode === el) c.parentNode = null;
        return c;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
        el._removed = true;
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
      removeAttribute(k) { delete el._attrs[k]; },
      getClientRects() { return el._rects > 0 ? [{}] : []; },
      getBoundingClientRect() { return { ...el._rect }; },
      addEventListener() {},
      removeEventListener() {},
      querySelector(sel) {
        for (const c of descendantList(el)) if (matchesSel(c, sel)) return c;
        return null;
      },
      querySelectorAll(sel) {
        return descendantList(el).filter((c) => matchesSel(c, sel));
      },
    };
    el.classList = {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
    };
    Object.defineProperty(el, "className", {
      get: () => [...classes].join(" "),
      set: (v) => { classes.clear(); String(v).split(/\s+/).forEach((c) => c && classes.add(c)); },
    });
    all.push(el);
    return el;
  }

  const body = makeEl("body", "");
  const doc = {
    body,
    createElement: (tag) => makeEl(tag, ""),
    querySelectorAll(sel) {
      return all.filter((el) => connected(el) && matchesSel(el, sel));
    },
    querySelector(sel) {
      return doc.querySelectorAll(sel)[0] || null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { document: doc, makeEl, body };
}

/* ---------------- View Transitions 打桩 ----------------
   真语义：updateDone 在 DOM 更新回调完成后 settle；finished 在动画
   结束（或 skip）后 settle。测试手动控制这两个时刻。 */

function makeVTStub() {
  const calls = [];
  const fake = (cb) => {
    const rec = { cb };
    rec.updateDone = Promise.resolve().then(() => cb());
    rec.finished = new Promise((resolve, reject) => {
      rec._resolve = resolve;
      rec._reject = reject;
    });
    rec.finished.catch(() => {});  // 测试未显式 settle 时不冒未处理拒绝
    calls.push(rec);
    return {
      finished: rec.finished,
      updateCallbackDone: rec.updateDone,
      ready: rec.updateDone,
      skipTransition() { rec._reject(new Error("skip")); },
    };
  };
  return { fake, calls };
}

const macroTick = () => new Promise((r) => setTimeout(r, 0));

/* ---------------- 组件装载 ---------------- */

function load(spec) {
  const opts = spec || {};
  const dom = makeDom();
  const vt = makeVTStub();
  if (opts.startViewTransition !== false) dom.document.startViewTransition = vt.fake;

  const mqStub = (q) => ({
    matches: /min-width:\s*40rem/.test(q) ? opts.wide !== false : !!opts.reducedMotion,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });

  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx, toolSwitchTransitionsOk, toolSwitchFlightRect, nbxNameViewTransition," +
    " TOOL_FLY_BADGE_PX, TOOL_FLY_NAME, TOOL_MAIN_NAME };"
  );
  const api = factory(
    { matchMedia: mqStub, innerWidth: 1280, innerHeight: 800 },
    dom.document, undefined, undefined,
    { hostname: "test", origin: "http://test" }, undefined,
    undefined, (fn) => setTimeout(() => fn(0), 0), undefined, undefined,
    undefined, undefined, undefined, undefined
  );

  const c = api.nbx();
  // 主面板打桩：一个带 tool-view-root 的容器 + 工具头部徽章（挂到 body 上，与真实页面一致）
  const panel = dom.makeEl("section", "");
  const viewRoot = dom.makeEl("div", "tool-view-root");
  const badge = dom.makeEl("span", "tool-head-badge");
  panel.appendChild(viewRoot);
  panel.appendChild(badge);
  dom.body.appendChild(panel);
  c.$refs = { mainPanel: panel };
  c.$nextTick = (fn) => { if (fn) fn(); return Promise.resolve(); };

  // 界面与流程副作用替身：本测试只关心过渡编排，不操心这些子系统
  c.toast = () => {};
  c.askConfirm = async () => true;
  c.stopBusyStreams = () => {};
  c.closeToolSearch = () => {};
  c.resetReasoning = () => {};
  c.resetMigration = () => {};
  c.resetVocab = () => {};
  c.resetVisualPaper = () => {};
  c.resetOcr = () => {};
  c.resetTranslate = () => {};
  c.autoGrow = () => {};
  c.scheduleMascotCheck = () => {};

  return { api, c, vt, panel, viewRoot, badge, ...dom, dom };
}

/* 造一个卡片元素（含图标），模拟自由对话输出里的工具推荐卡片（挂到 body 上，与真实页面一致） */
function makeCard(h, id, iconClass) {
  const card = h.makeEl("button", "nbx-tool-link");
  card.setAttribute("data-tool-id", String(id));
  const ico = h.makeEl("span", iconClass || "nbx-tool-link-ico");
  card.appendChild(ico);
  h.body.appendChild(card);
  return card;
}

const TOOL_FREEFORM = { id: "25", name: "自由对话", icon: "chat" };
const TOOL_CORRECTION = { id: "10", name: "学生作文批改", icon: "correction" };
const TOOL_TRANSLATE = { id: "33", name: "翻译", icon: "languages" };

/* ================= 纯函数 ================= */

test("过渡可用性：要 View Transitions 且用户未要求减少动态效果", () => {
  const h = load();
  assert.equal(h.api.toolSwitchTransitionsOk({ startViewTransition: true, reducedMotion: false }), true);
  assert.equal(h.api.toolSwitchTransitionsOk({ startViewTransition: false, reducedMotion: false }), false, "无 VT 不可用");
  assert.equal(h.api.toolSwitchTransitionsOk({ startViewTransition: true, reducedMotion: true }), false, "减少动态效果不可用");
  assert.equal(h.api.toolSwitchTransitionsOk(null), false, "缺省环境不可用");
});

test("飞行落点：以锚点中心居中，贴边时钳制在视口内", () => {
  const h = load();
  const size = h.api.TOOL_FLY_BADGE_PX;
  // 常规：锚点中心 - 半径，四舍五入到整数像素
  assert.deepEqual(
    h.api.toolSwitchFlightRect({ left: 100, top: 200, width: 16, height: 16 }, size, 1280, 800),
    { left: Math.round(100 + 8 - size / 2), top: Math.round(200 + 8 - size / 2) }
  );
  // 左上角：钳制到 4px 边距
  const tl = h.api.toolSwitchFlightRect({ left: 0, top: 0, width: 16, height: 16 }, size, 1280, 800);
  assert.equal(tl.left, 4);
  assert.equal(tl.top, 4);
  // 右下角：不越出视口
  const br = h.api.toolSwitchFlightRect({ left: 1270, top: 790, width: 16, height: 16 }, size, 1280, 800);
  assert.equal(br.left, 1280 - size - 4);
  assert.equal(br.top, 800 - size - 4);
});

test("命名助手：挂上 view-transition-name 并留可清理的标记", () => {
  const h = load();
  const target = h.makeEl("span", "");
  h.api.nbxNameViewTransition(target, h.api.TOOL_FLY_NAME);
  assert.equal(target.style.viewTransitionName, h.api.TOOL_FLY_NAME);
  assert.equal(target.getAttribute("data-nbx-vt"), h.api.TOOL_FLY_NAME);
  h.api.nbxNameViewTransition(null, h.api.TOOL_FLY_NAME);  // null 当前安全空转
});

/* ================= selectTool 分流 ================= */

test("卡片点击：支持 VT 时先起过渡，状态在旧快照拍完后落位", async () => {
  const h = load();
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  c.output = "推荐：学生作文批改";
  const card = makeCard(h, 10);

  const p = c.selectTool(TOOL_CORRECTION, { currentTarget: card });
  // selectTool 无 await 路径：同步跑完 startViewTransition，但更新回调在下一个微任务
  assert.equal(vt.calls.length, 1, "应发起一次 View Transition");
  assert.equal(c.currentTool.id, "25", "旧快照拍完前不能落位（否则旧界面已被换掉）");
  const ghosts = h.document.querySelectorAll("[data-nbx-fly-ghost]");
  assert.equal(ghosts.length, 1, "应注入一枚飞行徽章");
  assert.ok(ghosts[0].classList.contains("nbx-flight-badge"));
  assert.equal(ghosts[0].getAttribute("data-nbx-vt"), h.api.TOOL_FLY_NAME);
  assert.equal(ghosts[0].style.left, "95px");  // 卡片图标中心 108-13
  assert.equal(ghosts[0].style.top, "195px");  // 208-13
  assert.equal(card.querySelector(".nbx-tool-link-ico").style.visibility, "hidden", "卡片原图标要先藏起");
  assert.ok(card.classList.contains("nbx-link-launch"), "卡片应点亮");

  await p;
  await vt.calls[0].updateDone;
  assert.equal(c.currentTool.id, "10", "过渡窗口内完成切换");
  assert.equal(c.output, "", "输出应清空");
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 0, "新快照前卸掉飞行徽章");
  assert.equal(h.badge.getAttribute("data-nbx-vt"), h.api.TOOL_FLY_NAME, "新端头部徽章挂上共享元素名");
  assert.equal(h.viewRoot.getAttribute("data-nbx-vt"), h.api.TOOL_MAIN_NAME, "新端内容容器挂上内容过渡名");

  vt.calls[0]._resolve();
  await macroTick();
  assert.equal(h.badge.getAttribute("data-nbx-vt"), null, "结束后摘掉命名");
  assert.equal(h.badge.style.viewTransitionName, "", "结束后摘掉内联命名");
  assert.equal(h.viewRoot.style.viewTransitionName, "", "内容容器也要摘掉");
  assert.equal(card.querySelector(".nbx-tool-link-ico").style.visibility, "", "卡片图标恢复");
  assert.ok(h.badge.classList.contains("nbx-badge-land"), "落定脉冲已触发");
});

test("卡片点击：减少动态效果时纯切换，不走过渡也不播降级动画", async () => {
  const h = load({ reducedMotion: true });
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const card = makeCard(h, 10);

  await c.selectTool(TOOL_CORRECTION, { currentTarget: card });

  assert.equal(vt.calls.length, 0, "不发起 View Transition");
  assert.equal(c.currentTool.id, "10", "立即落位");
  assert.ok(!h.viewRoot.classList.contains("nbx-view-enter"), "不应有降级淡入");
});

test("卡片点击：无 View Transitions 时立即切换 + 轻量降级淡入", async () => {
  const h = load({ startViewTransition: false });
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const card = makeCard(h, 10);

  await c.selectTool(TOOL_CORRECTION, { currentTarget: card });

  assert.equal(vt.calls.length, 0);
  assert.equal(c.currentTool.id, "10", "立即落位");
  assert.ok(h.viewRoot.classList.contains("nbx-view-enter"), "新界面应有一次淡入");
});

test("侧栏等非卡片入口：不做任何过渡，立即切换", async () => {
  const h = load();
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const sidebarBtn = h.makeEl("button", "tool-item");

  await c.selectTool(TOOL_CORRECTION, { currentTarget: sidebarBtn });

  assert.equal(vt.calls.length, 0, "高频道口不该起过渡");
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 0);
  assert.equal(c.currentTool.id, "10");
  assert.ok(!h.viewRoot.classList.contains("nbx-view-enter"), "也不该有降级淡入");
});

/* ================= 连点与异常 ================= */

test("连点：旧过渡被跳过时不碰新一代的痕迹，最新一代负责收尾", async () => {
  const h = load();
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const cardA = makeCard(h, 10);
  const cardB = makeCard(h, 33);

  await c.selectTool(TOOL_CORRECTION, { currentTarget: cardA });
  assert.equal(vt.calls.length, 1);

  // 第一代还在飞，用户又点了另一张卡片：第二代启动并把旧代痕迹收走
  const p2 = c.selectTool(TOOL_TRANSLATE, { currentTarget: cardB });
  assert.equal(vt.calls.length, 2);
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 1, "第一代徽章被清，第二代在飞");

  await p2;
  await vt.calls[0].updateDone;
  await vt.calls[1].updateDone;
  assert.equal(h.badge.getAttribute("data-nbx-vt"), h.api.TOOL_FLY_NAME, "新端命名已挂");

  // 旧过渡被 skip：它的收尾必须绕开新一代正在用的命名（否则新端映射丢失）
  vt.calls[0]._reject(new Error("skip"));
  await macroTick();
  assert.equal(h.badge.getAttribute("data-nbx-vt"), h.api.TOOL_FLY_NAME, "旧代收尾不能清掉新代正在用的痕迹");

  vt.calls[1]._resolve();
  await macroTick();
  assert.equal(c.currentTool.id, "33", "最终停在最后一次选择");
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 0);
  assert.equal(h.badge.getAttribute("data-nbx-vt"), null);
  assert.equal(h.viewRoot.style.viewTransitionName, "");
  assert.ok(h.badge.classList.contains("nbx-badge-land"), "由最新一代播落定脉冲");
});

test("起飞准备失败（卡片里没有图标）也要照常切换", async () => {
  const h = load();
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const card = h.makeEl("button", "nbx-tool-link");  // 没有 .nbx-tool-link-ico

  const p = c.selectTool(TOOL_CORRECTION, { currentTarget: card });
  assert.equal(vt.calls.length, 1, "无锚点不影响过渡本身");
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 0, "无锚点就不注入徽章");
  await p;
  await vt.calls[0].updateDone;
  assert.equal(c.currentTool.id, "10", "功能不受影响");
  vt.calls[0]._resolve();
  await macroTick();
});

test("窄档：头部徽章不显示时不做飞行（内容过渡照常）", async () => {
  const h = load({ wide: false });
  const { c, vt } = h;
  c.currentTool = TOOL_FREEFORM;
  const card = makeCard(h, 10);

  const p = c.selectTool(TOOL_CORRECTION, { currentTarget: card });
  assert.equal(h.document.querySelectorAll("[data-nbx-fly-ghost]").length, 0, "窄档不注入飞行徽章");
  await p;
  await vt.calls[0].updateDone;
  assert.equal(c.currentTool.id, "10");
  vt.calls[0]._resolve();
  await macroTick();
});
