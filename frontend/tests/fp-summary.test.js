/* nbxFpSummarize 的回归测试
   运行：node frontend/tests/fp-summary.test.js

   这一层以前完全没测，于是 ThumbmarkJS 键名读错、采集了却从不读取的字段
   都能悄悄上线：后端按 gpu / bat 分支做机型识别，读到的却恒为空串。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const SOURCE = path.join(__dirname, "..", "script.js");

/* 抽出 nbxFpSummarize 与它依赖的 nbxFpGpu，在最小环境里跑。
   script.js 依赖 Alpine 与整套 DOM，没法整体加载。 */
/* bare = true 时摘掉 navigator / window 上的兜底，只留组件路径 ——
   用来暴露「读了一个 ThumbmarkJS 里并不存在的键、却恰好被兜底掩盖」的情况。 */
function loadSummarize({ webglRenderer = "", webglExt = true, bare = false } = {}) {
  const src = fs.readFileSync(SOURCE, "utf8");
  const start = src.indexOf("function nbxFpGpu(components) {");
  const marker = "\nasync function nbxFpInit()";
  const end = src.indexOf(marker, start);
  assert.ok(start >= 0 && end > start, "脚本结构变了：找不到 nbxFpGpu / nbxFpSummarize");

  const screen = { width: 1920, height: 1080, colorDepth: 24 };
  const nav = {
    platform: "Win32", language: "zh-CN", languages: ["zh-CN", "en"],
    maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8,
  };
  if (bare) {
    // 只留空壳：组件路径读错键时没有兜底可依，错误会直接暴露
    for (const k of Object.keys(nav)) delete nav[k];
  }
  const env = {
    navigator: nav,
    screen,
    window: { screen },
    devicePixelRatio: 2,
    deviceMemory: bare ? undefined : 8,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Asia/Shanghai" }) }) },
    document: {
      createElement: () => ({
        getContext: () =>
          webglRenderer
            ? {
                getExtension: (n) => (webglExt && n === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
                getParameter: () => webglRenderer,
              }
            : null,
      }),
    },
  };
  // vm 沙箱不自带内建全局，JSON.stringify / RegExp 都是 undefined，
  // 摘要函数会走进 catch 返回空串。必须在 createContext 之前挂上，
  // 之后赋值会被沙箱重置掉。
  env.JSON = JSON;
  env.RegExp = RegExp;
  vm.createContext(env);
  vm.runInContext(src.slice(start, end) + "\n; nbxFpSummarize", env);
  return env.nbxFpSummarize;
}

/* ThumbmarkJS 1.11.0 的真实组件形状（逐键核对过 vendor/thumbmark.umd.js） */
const REAL_COMPONENTS = {
  system: { platform: "Win32", productSub: "2007", product: "Gecko", useragent: "Mozilla/5.0", browser: { name: "Chrome", version: "140" } },
  locales: { languages: "zh-CN", timezone: "Asia/Shanghai" },
  screen: { is_touchscreen: false, maxTouchPoints: 0, colorDepth: 24, mediaMatches: ["any-hover: hover"] },
  hardware: {
    videocard: { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", version: "WebGL 1.0", shadingLanguageVersion: "WebGL GLSL ES 1.0" },
    architecture: 4,
    deviceMemory: "8",
    jsHeapSizeLimit: 4294705152,
  },
  webgl: { commonPixelsHash: "9f2c1a7b3d4e5f60" },
};

test("gpu 取自 hardware.videocard，不是 webgl 组件", () => {
  // 回归：webgl 组件只回 {commonPixelsHash}，读它永远得到 undefined
  const summarize = loadSummarize({ webglRenderer: "" });
  const out = JSON.parse(summarize(REAL_COMPONENTS, {}));
  assert.ok(out.gpu, "显卡必须有值");
  assert.match(out.gpu, /RTX 3060/);
  assert.doesNotMatch(out.gpu, /^[0-9a-f]{16,}$/i, "纯哈希值不应作为显卡名");
});

test("探到 WEBGL_debug_renderer_info 时优先用未遮蔽串", () => {
  const summarize = loadSummarize({ webglRenderer: "NVIDIA GeForce RTX 4060 Laptop GPU" });
  const out = JSON.parse(summarize(REAL_COMPONENTS, {}));
  assert.strictEqual(out.gpu, "NVIDIA GeForce RTX 4060 Laptop GPU");
});

test("拿不到 GPU 时整个字段缺席，不写空串", () => {
  const summarize = loadSummarize({ webglRenderer: "" });
  const out = JSON.parse(summarize({ ...REAL_COMPONENTS, hardware: { videocard: null } }, {}));
  assert.ok(!("gpu" in out));
});

test("bat 从 uach 透传进摘要", () => {
  // 回归：采集侧早就写好了 extra.bat，摘要函数从头到尾没读过它，
  // 「检测到电池」这个 Windows 机型识别的最高优先级信号恒为空
  const summarize = loadSummarize();
  assert.strictEqual(JSON.parse(summarize(REAL_COMPONENTS, { bat: 1 })).bat, 1);
  assert.ok(!("bat" in JSON.parse(summarize(REAL_COMPONENTS, {}))), "无电池信号时不应凭空造出该字段");
});

test("lang 读 locales.languages（键名是复数，值是单个字符串）", () => {
  const summarize = loadSummarize();
  assert.strictEqual(JSON.parse(summarize(REAL_COMPONENTS, {})).lang, "zh-CN");
});

test("组件键名读错时不会被 navigator 兜底掩盖", () => {
  // 这三个曾经各读了一个 ThumbmarkJS 里不存在的键（locales.language、
  // screen.width、device.deviceMemory），恰好被 navigator/window 的兜底
  // 掩盖住，读的那一半是死支。这里把兜底全部摘掉，读错键就露出来。
  const summarize = loadSummarize({ bare: true });
  const out = JSON.parse(summarize(REAL_COMPONENTS, {}));
  assert.strictEqual(out.lang, "zh-CN", "locales.languages");
  assert.strictEqual(out.scr, "1920x1080");
  assert.strictEqual(out.mem, 8, "hardware.deviceMemory 是字符串，要转成数字");
});

test("scr 用 window.screen 的尺寸，桌面端不能为空", () => {
  // 回归：screen 组件没有 width/height，resolution 又只在触屏移动端赋值，
  // 换成它会让桌面 Windows / macOS 的尺寸查表全部失效
  const summarize = loadSummarize();
  assert.strictEqual(JSON.parse(summarize(REAL_COMPONENTS, {})).scr, "1920x1080");
});

test("摘要里不含非 ASCII（请求头只允许 Latin1）", () => {
  const summarize = loadSummarize();
  const raw = summarize(REAL_COMPONENTS, { model: "小米 14" });
  assert.ok(!/[^\x20-\x7E]/.test(raw), "非 ASCII 会让 fetch 直接抛错");
});

test("产出的是 parse_summary 白名单里的 16 个键", () => {
  const summarize = loadSummarize();
  const out = JSON.parse(summarize(REAL_COMPONENTS, { bat: 1, model: "Xiaomi 14", platformVersion: "14", architecture: "arm", bitness: "64" }));
  const allowed = new Set(["os", "lang", "scr", "dpr", "cores", "tz", "model", "pv", "gpu", "touch", "mem", "cd", "langs", "bat", "arch", "bit"]);
  for (const k of Object.keys(out)) {
    assert.ok(allowed.has(k), `后端 parse_summary 会丢弃未知键：${k}`);
    assert.ok(typeof out[k] !== "object", `${k} 不能是嵌套对象，后端 str() 会把它转成 Python repr`);
  }
});