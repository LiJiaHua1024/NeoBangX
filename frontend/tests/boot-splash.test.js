/* 首屏启动页静态回归用例
   目标不是测视觉，而是锁住几件容易在后续改动中悄悄退化的事实：
   1. 主题 id 必须和 script.js 的 THEMES 完全对齐（历史上 forest/jade 就错配过）；
   2. m/n 的 8 个关键步骤必须和 index.html 里的标签一一对应；
   3. thumbmark / 镜像三件套 / click-fx 不得再回到首屏关键路径；
   4. 背景引擎必须留在独立模块里，由启动后的空闲调度加载。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

const THEMES = (() => {
  const block = JS.match(/const THEMES = \[([\s\S]*?)\n\];/);
  assert.ok(block, "script.js 里应能找到 THEMES");
  return [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
})();

test("splash 主题选择器覆盖 THEMES 的每个 id，且不再有 forest", () => {
  assert.ok(THEMES.length >= 5, "主题数量应至少 5 个");
  assert.ok(!HTML.includes('data-theme="forest"'), "forest 是旧 id，不能让墨翠主题回退到浅色 splash");
  for (const id of THEMES) {
    if (id === "paper") {
      // paper 是默认主题，变量直接定义在 #boot-splash 上
      assert.match(HTML, /#boot-splash\{[\s\S]*?--b-bg:#f3f0e9/);
      continue;
    }
    const selector = id === "sora"
      ? 'html[data-theme="sora"][data-sky="day"] #boot-splash'
      : `html[data-theme="${id}"] #boot-splash`;
    assert.ok(HTML.includes(selector), `splash 缺少主题 ${id} 的配色`);
  }
});

test("m/n 的 8 个关键资源与标签数量一致", () => {
  const cssMarks = [...HTML.matchAll(/__nbxBootMark\('(css:[^']+)'\)/g)].map((m) => m[1]);
  const jsMarks = [...HTML.matchAll(/__nbxBootMark\('(js:[^']+)'\)/g)].map((m) => m[1]);
  const all = [...cssMarks, ...jsMarks];
  assert.equal(cssMarks.length, 2, "应恰好有 2 份关键 CSS");
  assert.equal(jsMarks.length, 6, "应恰好有 6 个关键脚本");
  assert.equal(new Set(all).size, 8, "步骤名不能重复");
  assert.ok(HTML.includes("total: 8"), "登记器 total 必须是 8");
  assert.ok(HTML.includes("jsTotal: 6"), "登记器 jsTotal 必须是 6");
  assert.match(HTML, /id="boot-splash-progress"[\s\S]*?aria-valuemax="8"/);

  const rail = HTML.match(/id="boot-splash-rail"[\s\S]*?<\/div>/);
  assert.ok(rail, "应有进度轨");
  assert.equal((rail[0].match(/<i><\/i>/g) || []).length, 8, "进度轨应有 8 段");
});

test("关键脚本标签都带 onload/onerror，且顺序保持依赖关系", () => {
  const tags = [...HTML.matchAll(/<script\s+defer\s+src="([^"]+)"([^>]*)><\/script>/g)];
  const names = tags.map((m) => m[1]);
  assert.deepEqual(names, [
    "/static/vendor/marked-15.0.12.min.js",
    "/static/vendor/dompurify-3.4.12.min.js",
    "/static/vendor/alpine-collapse-3.15.12.min.js",
    "/static/nbx-versions.js",
    "/static/script.js",
    "/static/vendor/alpinejs-3.15.12.min.js",
  ]);
  for (const [, src, attrs] of tags) {
    assert.match(attrs, /onload="__nbxBootMark\('js:/, `${src} 缺少 onload 步骤`);
    assert.match(attrs, /onerror="__nbxBootFail\('js:/, `${src} 缺少 onerror 失败态`);
  }
});

test("thumbmark、镜像三件套、click-fx 不再占首屏关键路径", () => {
  const srcs = [...HTML.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  for (const url of [
    "/static/vendor/thumbmark.umd.js",
    "/static/nbx-mirror.js",
    "/static/nbx-mirror-store.js",
    "/static/nbx-mirror-peer.js",
    "/static/click-fx.js",
  ]) {
    const name = url.slice(url.lastIndexOf("/") + 1);
    assert.ok(!srcs.some((s) => s === url), `${name} 不应再出现在首屏 script 标签里`);
    assert.ok(JS.includes(url), `script.js 应保留 ${name} 的按需加载 URL`);
  }
  assert.ok(JS.includes("nbxEnsureClickFx"), "点击特效应有按需加载器");
  assert.ok(JS.includes("nbxEnsureMirrorAssets"), "镜像应有按需加载器");
  assert.ok(JS.includes("NBX_ASSET_URLS.thumbmark"), "指纹库应有按需加载 URL");
});

test("背景引擎已拆出且首屏不再直接初始化", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "nbx-background.js")), "应存在 nbx-background.js");
  assert.ok(!JS.includes("function createBackground(canvas)"), "script.js 不应再内联背景引擎");
  assert.ok(JS.includes("NBX_ASSET_URLS.background"), "script.js 应登记背景模块 URL");
  assert.ok(JS.includes("_scheduleBackground()"), "初始化应调度背景模块");
  const bg = fs.readFileSync(path.join(ROOT, "nbx-background.js"), "utf8");
  assert.ok(bg.includes("function createBackground(canvas) {"));
});

test("启动页包含 m/n、阶段、首次/再次、慢网与错误态", () => {
  for (const id of [
    "boot-splash-count", "boot-splash-phase", "boot-splash-hint", "boot-splash-slow",
    "boot-splash-very-slow", "boot-splash-retry", "boot-splash-live",
  ]) {
    assert.ok(HTML.includes(id), `启动页缺少 ${id}`);
  }
  assert.ok(HTML.includes("nbx_boot_seen"), "应记录首次/再次加载");
  assert.ok(HTML.includes("首次加载会下载必要组件"), "首次加载应有解释文案");
  assert.ok(HTML.includes("正在恢复上次的主题、历史与偏好"), "再次加载应有恢复文案");
  assert.ok(HTML.includes("prefers-reduced-motion: reduce"), "应尊重减少动态效果");
  assert.ok(HTML.includes("html.nbx-ready .app-root"), "应支持应用淡入交接");
  assert.match(HTML, /<div x-data="nbx\(\)" x-cloak inert class="app-root/, "首屏期间应用应 inert");
  assert.ok(HTML.includes('appRoot.removeAttribute("inert")'), "首屏结束后应解除 inert");
});

test("旧版无限动画已移除，改为真实进度轨", () => {
  assert.ok(!HTML.includes("boot-bar"), "旧 boot-bar 应已移除");
  assert.ok(!HTML.includes("boot-slide"), "旧无限滑动动画应已移除");
  assert.ok(HTML.includes("boot-rail"), "应使用分段进度轨");
});

test("布偶大图改为懒加载，避免和关键资源抢带宽", () => {
  const img = HTML.match(/<img[^>]+Sora_Rabbit_Plush\.webp[^>]*>/);
  assert.ok(img, "应能找到布偶图片");
  assert.match(img[0], /loading="lazy"/);
});

/* 运行时冒烟：在最小 DOM 沙盒里跑真正的内联控制器，验证放行、m/n、失败态。 */
function makeSplashSandbox({ failed = "", seen = null } = {}) {
  const elements = new Map();
  const makeEl = (id) => {
    const classes = new Set();
    return {
      id,
      textContent: "",
      className: "",
      attrs: Object.create(null),
      children: [],
      parentNode: { removeChild() {} },
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        contains: (n) => classes.has(n),
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      focus() { this.focused = true; },
    };
  };
  for (const id of [
    "boot-splash", "boot-splash-text", "boot-splash-live", "boot-splash-count",
    "boot-splash-phase", "boot-splash-progress", "boot-splash-rail", "boot-splash-hint",
    "boot-splash-retry",
  ]) elements.set(id, makeEl(id));
  elements.get("boot-splash-rail").children = Array.from({ length: 8 }, (_, i) => makeEl("seg" + i));

  const store = new Map();
  if (seen != null) store.set("nbx_boot_seen", seen);
  const listeners = Object.create(null);
  const timers = new Map();
  let timerId = 0;
  const window = {
    __nbxBoot: { steps: Object.create(null), total: 8, jsTotal: 6, failed, startedAt: Date.now() },
  };
  const document = {
    documentElement: makeEl("html"),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  const sandbox = {
    window, document,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; },
    clearInterval: (id) => timers.delete(id),
    Date, Number, Object, Array, String,
  };
  vm.createContext(sandbox);

  const start = HTML.indexOf("    (function () {\n      var root = document.documentElement;");
  const end = HTML.indexOf("    })();\n  </script>", start);
  assert.ok(start > 0 && end > start, "应能提取内联启动控制器");
  vm.runInContext(HTML.slice(start, end + "    })();".length), sandbox);
  return { window, document, elements, listeners, store, timers };
}

function markAll(sandbox) {
  const boot = sandbox.window.__nbxBoot;
  for (const name of [
    "css:tailwind", "css:styles", "js:marked", "js:dompurify",
    "js:alpine-collapse", "js:versions", "js:app", "js:alpine",
  ]) {
    boot.steps[name] = 1;
    sandbox.window.__nbxBootPaint();
  }
}

test("控制器：8/8 + Alpine + booted 后淡出并记录已访问", () => {
  const sb = makeSplashSandbox({ seen: null });
  const splash = sb.elements.get("boot-splash");
  assert.equal(sb.elements.get("boot-splash-count").textContent, "0/8");
  assert.equal(sb.elements.get("boot-splash-phase").textContent, "正在加载界面");
  assert.equal(
    sb.elements.get("boot-splash-hint").textContent,
    "首次加载会下载必要组件，之后会快很多"
  );

  markAll(sb);
  assert.equal(sb.elements.get("boot-splash-count").textContent, "8/8");
  assert.equal(sb.elements.get("boot-splash-progress").attrs["aria-valuenow"], "8");
  assert.equal(splash.classList.contains("boot-splash-done"), false, "Alpine 未就绪前不能放行");

  sb.window.__nbxBooted = true;
  sb.listeners["alpine:initialized"]();
  assert.ok(splash.classList.contains("boot-splash-done"), "应淡出");
  assert.ok(sb.document.documentElement.classList.contains("nbx-ready"), "应触发应用淡入");
  assert.equal(sb.store.get("nbx_boot_seen"), "1");
});

test("控制器：资源失败立即进入错误态并聚焦重试", () => {
  const sb = makeSplashSandbox({ failed: "核心脚本" });
  const splash = sb.elements.get("boot-splash");
  assert.ok(splash.classList.contains("boot-splash-error"));
  assert.match(sb.elements.get("boot-splash-text").textContent, /核心脚本加载失败/);
  assert.ok(sb.elements.get("boot-splash-retry").focused, "错误态应把焦点交给重试按钮");
});

test("控制器：再次访问使用恢复文案", () => {
  const sb = makeSplashSandbox({ seen: "1" });
  assert.equal(
    sb.elements.get("boot-splash-hint").textContent,
    "正在恢复上次的主题、历史与偏好"
  );
});
