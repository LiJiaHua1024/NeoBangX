/* 图片识别（识别图片文字 / 上传来源）用例
   运行：node frontend/tests/ocr-flow.test.js

   同样不动浏览器：把 script.js 装进 Function 拿到真正的组件对象，只替换网络与界面副作用，
   然后直接跑 ocrStart / consumeSSE / ocrUseText / qrSvg 这些真在跑的代码。守的是：
   - 请求体形状：tool_id=32、images 为 data URL 列表、扫码来源改带 pair_token
   - 识别类型由工具决定（作文批改按手写稿、其余按原卷印刷稿），只有识别图片文字与自由对话能手动选
   - 多模态结果按 SSE token 累积，撞上限时置截断标记
   - 无图不发请求、无码（401/403）能给出可操作提示
   - 尺寸压缩目标：长边收敛到 2000 且不放大，保持比例
   - 图片文件判定与二维码库缺失时的降级
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

/* 组件里用到裸 matchMedia（finePointer / touchPrimary / 减少动效判定），Node 无此全局 */
if (typeof global.matchMedia !== "function") {
  global.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}

/* 假 Image：编辑落地那一环要用它读自然尺寸并等 onload。
   尺寸固定给一组，真正的像素换算由 ocrBakePlan 单独验（见下面的烘焙计划用例） */
global.Image = class FakeImage {
  constructor() {
    this.naturalWidth = 2000;
    this.naturalHeight = 1000;
  }
  set src(value) {
    this._src = value;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  }
  get src() { return this._src; }
};

function makeWindow() {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  return { matchMedia: () => mq };
}

/* 把模块作用域的 OCR 常量与纯函数一并取出来，便于直接断言 */
function loadModule(storage) {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx: nbx, isImageFile: isImageFile, OCR_MAX_IMAGES: OCR_MAX_IMAGES, OCR_TOOL_ID: OCR_TOOL_ID,"
      + " OCR_MODES: OCR_MODES, ocrModeForTool: ocrModeForTool, ocrModeCanChoose: ocrModeCanChoose,"
      + " OCR_CROP_HANDLES: OCR_CROP_HANDLES, OCR_EDIT_QUALITY: OCR_EDIT_QUALITY,"
      + " ocrRotateRect: ocrRotateRect, ocrRotatedSize: ocrRotatedSize, ocrFitSize: ocrFitSize,"
      + " ocrBakePlan: ocrBakePlan };"
  );
  const api = factory(
    makeWindow(), undefined, storage, undefined, { origin: "http://localhost:8000", hostname: "localhost" },
    undefined, undefined, undefined, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  const c = api.nbx();
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.autoGrow = () => {};
  c.retreatMascot = () => {};
  c.authHeaders = () => ({ Authorization: "Bearer test-token" });
  c.handleAuthFailure = function (hint) { this.authFailures = (this.authFailures || []).concat(hint || ""); };
  return { api, c };
}

/* 编辑落地的用例要真的走一遍画布：给一个只会记账的假 document 与假 Image，
   记下每张画布的尺寸与 drawImage 的坐标，断言的是「计划有没有被照做」 */
function loadWithFakeDom(storage) {
  const record = { sizes: [], draws: [] };
  const ctx = {
    fillStyle: "",
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    drawImage: (...args) => record.draws.push(args.length),
  };
  const fakeDocument = {
    createElement(tag) {
      if (tag !== "canvas") return {};
      const canvas = { width: 0, height: 0 };
      // 尺寸都是在 getContext 之前定好的：这里记一笔就等于记下了每张画布最终多宽多高
      canvas.getContext = () => {
        record.sizes.push([canvas.width, canvas.height]);
        return ctx;
      };
      canvas.toDataURL = () => "data:image/jpeg;base64,EDITED";
      return canvas;
    },
  };
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx: nbx };"
  );
  const api = factory(
    makeWindow(), fakeDocument, storage, undefined, { origin: "http://localhost:8000", hostname: "localhost" },
    undefined, undefined, undefined, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  const c = api.nbx();
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.autoGrow = () => {};
  c.retreatMascot = () => {};
  c.authHeaders = () => ({ Authorization: "Bearer test-token" });
  c.handleAuthFailure = function (hint) { this.authFailures = (this.authFailures || []).concat(hint || ""); };
  return { c, record };
}

/* 识别链路一律要有有效使用码（见 requireCodeForOcr），所以驱动识别流程的用例
   都得先有码；无码的行为另有专门用例覆盖。 */
function loadAuthed() {
  const { c } = loadModule(makeStorage());
  c.isAuthenticated = true;
  return c;
}

function sseResponse(frames) {
  const text = frames.map(([event, data]) => `event: ${event}\ndata: ${data}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  };
}

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function withFetch(frames, fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return sseResponse(frames);
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ---------------- 尺寸与文件判定 ---------------- */

test("压缩目标尺寸：长边收敛到上限、保持比例、不放大", () => {
  const { c } = loadModule(makeStorage());

  const landscape = c.ocrTargetSize(4000, 3000);
  assert.strictEqual(landscape.width, 2000);
  assert.strictEqual(landscape.height, 1500);

  const portrait = c.ocrTargetSize(3000, 4000);
  assert.strictEqual(portrait.width, 1500);
  assert.strictEqual(portrait.height, 2000);

  const small = c.ocrTargetSize(800, 600);
  assert.deepStrictEqual(small, { width: 800, height: 600 });

  const tiny = c.ocrTargetSize(1, 1);
  assert.deepStrictEqual(tiny, { width: 1, height: 1 });

  const broken = c.ocrTargetSize(0, 0);
  assert.strictEqual(broken.width, 1);
  assert.strictEqual(broken.height, 1);
});

test("图片文件判定：MIME 优先、扩展名兜底（HEIC 也算图片，解码失败另有提示）", () => {
  const { api } = loadModule(makeStorage());

  assert.strictEqual(api.isImageFile({ type: "image/jpeg" }, "jpg"), true);
  assert.strictEqual(api.isImageFile({ type: "image/heic" }, "heic"), true);
  assert.strictEqual(api.isImageFile({ type: "" }, "PNG"), true);
  assert.strictEqual(api.isImageFile({ type: "" }, "docx"), false);
  assert.strictEqual(api.isImageFile({ type: "application/pdf" }, "pdf"), false);
  assert.strictEqual(api.isImageFile(null, ""), false);
});

test("工具与张数常量与后端契约一致", () => {
  const { api } = loadModule(makeStorage());
  assert.strictEqual(api.OCR_TOOL_ID, "32");
  assert.strictEqual(api.OCR_MAX_IMAGES, 8);
});

/* ---------------- 请求体与流式结果 ---------------- */

test("本地图片：请求带 tool_id=32、ocr_mode 与 data URL 列表", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 10, dataUrl: IMG }];
  c.ocrHost = "tool";

  await withFetch([["token", JSON.stringify("转录")], ["token", JSON.stringify("结果")], ["done", "[DONE]"]], async (calls) => {
    await c.ocrStart();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "/api/chat/stream");
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.tool_id, "32");
    assert.strictEqual(body.ocr_mode, "printed");
    assert.deepStrictEqual(body.images, [IMG]);
    assert.strictEqual(body.pair_token, undefined);
    assert.strictEqual(body.input, "");
  });

  assert.strictEqual(c.ocrText, "转录结果");
  assert.strictEqual(c.ocrStage, "done");
  assert.strictEqual(c.ocrTruncated, false);

  // 面板上要真出字：渲染是节流异步的，等一拍再断言（漏了这一步会「识别跑完但界面空白」）
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(c.ocrRendered && c.ocrRendered.indexOf("转录结果") >= 0, `ocrRendered=${c.ocrRendered}`);
});

test("手写模式：作文批改工具按手写规则发请求，扫码来源改带 pair_token 且不再回传图片", async () => {
  const c = loadAuthed();
  // 学生作文批改（工具 10）：类型由工具决定，用户没得选
  c.currentTool = { id: "10", name: "学生作文批改" };
  c.ocrImages = [{ id: "p", name: "手机照片 1", size: 0, url: "/api/ocr/pair/t1/image?i=0" }];
  c.ocrPairToken = "t1";
  c.ocrHost = "modal";

  await withFetch([["done", "[DONE]"]], async (calls) => {
    await c.ocrStart();
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.ocr_mode, "handwritten");
    assert.strictEqual(body.pair_token, "t1");
    assert.strictEqual(body.images, undefined);
  });
  // 弹窗形态：识别时弹窗自动打开
  assert.strictEqual(c.ocrModalOpen, true);
});

test("撞输出上限：收到 truncated 事件即置标记", async () => {
  const c = loadAuthed();
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 10, dataUrl: IMG }];

  await withFetch([
    ["token", JSON.stringify("半份")],
    ["truncated", JSON.stringify({ limit: 8192 })],
    ["done", "[DONE]"],
  ], async () => {
    await c.ocrStart();
  });

  assert.strictEqual(c.ocrTruncated, true);
  assert.strictEqual(c.ocrText, "半份");
});

test("无图不发请求：提示先选图", async () => {
  const c = loadAuthed();
  let requested = 0;
  const original = global.fetch;
  global.fetch = async () => { requested += 1; return sseResponse([]); };
  try {
    await c.ocrStart();
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(requested, 0);
  assert.ok(c.toasts.some((t) => t.msg.indexOf("图片") >= 0));
});

test("需要有效使用码：401 触发使用码入口而不是沉默失败", async () => {
  const c = loadAuthed();
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 10, dataUrl: IMG }];
  const original = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: "请先输入使用码" }),
  });
  try {
    await c.ocrStart();
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(c.ocrStage, "error");
  assert.ok(c.ocrError.indexOf("使用码") >= 0, c.ocrError);
  assert.deepStrictEqual(c.authFailures, ["请先输入使用码"]);
});

test("限流 429 与图片过大 400 的文案能落到面板上", async () => {
  const c = loadAuthed();
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 429, json: async () => { throw new Error("no body"); } });
    c.ocrImages = [{ id: "a", name: "a.jpg", size: 10, dataUrl: IMG }];
    await c.ocrStart();
    assert.ok(c.ocrError.indexOf("频繁") >= 0, c.ocrError);

    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ detail: "图片总量超过 16MB，请减少张数" }),
    });
    c.ocrImages = [{ id: "a", name: "a.jpg", size: 10, dataUrl: IMG }];
    await c.ocrStart();
    assert.strictEqual(c.ocrError, "图片总量超过 16MB，请减少张数");
    assert.strictEqual(c.ocrStage, "error");
  } finally {
    global.fetch = original;
  }
});

/* ---------------- 交互副作用 ---------------- */

test("弹窗形态：使用这段文字把结果写进输入框并转为可编辑文本", () => {
  const { c } = loadModule(makeStorage());
  c.ocrHost = "modal";
  c.ocrModalOpen = true;
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrText = "  试卷原文  ";
  c.inputMode = "file";
  c.attachedFile = { name: "old.docx", size: 1 };

  c.ocrUseText();

  assert.strictEqual(c.input, "试卷原文");
  assert.strictEqual(c.inputMode, "text");
  assert.strictEqual(c.attachedFile, null);
  assert.strictEqual(c.ocrModalOpen, false);
});

test("移掉最后一张图回到空状态；批次上限不越过 8 张", () => {
  const { c, api } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrText = "内容";
  c.ocrStage = "done";

  c.removeOcrImage(0);

  assert.strictEqual(c.ocrImages.length, 0);
  assert.strictEqual(c.ocrStage, "empty");
  assert.strictEqual(c.ocrText, "");
  assert.strictEqual(api.OCR_MAX_IMAGES, 8);
});

test("图片就位后停在「开始识别」这一步：识别不自动开始，点一下类型也不会立刻跑", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];

  // 有图但没有结果时：停在开始识别
  c.ocrStage = "ready";
  assert.strictEqual(c.ocrNeedsStart, true);

  let calls = 0;
  const original = global.fetch;
  global.fetch = async () => { calls += 1; return sseResponse([["done", "[DONE]"]]); };
  try {
    // 选类型（可选的工具）只是记下选择，不发起任何请求
    c.chooseOcrMode("handwritten");
    assert.strictEqual(c.ocrMode, "handwritten");
    c.chooseOcrMode("printed");
    assert.strictEqual(c.ocrMode, "printed");
    assert.strictEqual(calls, 0);

    // 只有明确按下「开始识别」才跑
    await c.ocrStart();
    assert.strictEqual(calls, 1);
  } finally {
    global.fetch = original;
  }
});

test("二维码库缺失时降级为空串（弹窗退化为复制网址）", () => {
  const { c } = loadModule(makeStorage());
  assert.strictEqual(typeof global.qrcode, "undefined");
  assert.strictEqual(c.qrSvg("http://localhost:8000/m/upload?token=x"), "");
});

test("扫码配对：把电脑端当前主题交给手机页，二维码网址也带上主题", async () => {
  const { c } = loadModule(makeStorage());
  c.isAuthenticated = true;
  c.theme = "jade";

  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: "tok1", path: "/m/upload?token=tok1&theme=jade", expires_in: 900 }),
    };
  };
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
    c._stopPairTimer();
    if (c._pairSource) { try { c._pairSource.close(); } catch (e) { /* 忽略 */ } }
  }

  const body = JSON.parse(calls[0].options.body);
  assert.strictEqual(body.theme, "jade");
  assert.strictEqual(body.sky, "");
  assert.ok(c.pairUrl.indexOf("theme=jade") >= 0, c.pairUrl);
});

test("扫码配对：悠空带上当前时段（手机页才知道该给白昼还是星夜）", async () => {
  const { c } = loadModule(makeStorage());
  c.isAuthenticated = true;
  c.theme = "sora";
  c.skyPeriod = () => "night";

  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: "tok2", path: "/m/upload?token=tok2&theme=sora", expires_in: 900 }),
    };
  };
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
    c._stopPairTimer();
    if (c._pairSource) { try { c._pairSource.close(); } catch (e) { /* 忽略 */ } }
  }
  assert.strictEqual(JSON.parse(calls[0].options.body).sky, "night");
});

/* ---------------- 使用码门禁 ----------------
   识别始终要有有效使用码，连免码试用模型也帮不上忙。所以门禁不能复用 ensureCanRun：
   那条对免码模型直接放行，无码用户会被放进等待窗口，随后被后端 401 打回，
   先看到的却是「配对已失效，请重新扫码」——真正的原因（没填码）反而被盖住了。 */

/* 无码 + 当前选中的是免码模型：最容易误放行的组合 */
function anonymousWithNoCodeModel() {
  const { c } = loadModule(makeStorage());
  c.models = [{ id: "mock/mock-flash", name: "免码假模型", is_free: true, free_no_code: true }];
  c.selectedModel = "mock/mock-flash";
  c.isAuthenticated = false;
  assert.strictEqual(c.modelNoCodeAllowed, true, "前置条件：这条用例要的是免码模型");
  return c;
}

test("无码时扫码入口要的是使用码：不开等待窗口、不发请求", async () => {
  const c = anonymousWithNoCodeModel();
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => { calls.push({ url, options }); throw new Error("不该发请求"); };
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
  }
  assert.deepStrictEqual(calls, [], "无码不该先去建会话再被 401 打回");
  assert.strictEqual(c.pairOpen, false, "没有会话可等，别开那个窗口");
  assert.strictEqual(c.codeModal, true);
  assert.ok(c.codeHint.indexOf("使用码") >= 0, c.codeHint);
  // 免码试用模型对识别没用，提示里不能拿它当替代方案
  assert.ok(c.codeHint.indexOf("免码") < 0, c.codeHint);
});

test("无码时开始识别：先要码，图仍留在批次里", async () => {
  const c = anonymousWithNoCodeModel();
  c.currentTool = { id: "32", name: "识别图片文字" };
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrStage = "ready";
  let calls = 0;
  const original = global.fetch;
  global.fetch = async () => { calls += 1; return sseResponse([["done", "[DONE]"]]); };
  try {
    await c.ocrStart();
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(calls, 0, "没码就不该把图片发出去");
  assert.strictEqual(c.codeModal, true);
  assert.strictEqual(c.ocrImages.length, 1, "刚选好的图不能因为没码被丢掉");
  assert.strictEqual(c.ocrStage, "ready", "停在开始识别这一步，输完码可以直接开始");
});

test("无码时识别工具的入口就拦住：上传弹窗不开，拖进来的图也不收", async () => {
  const c = anonymousWithNoCodeModel();
  c.currentTool = { id: "32", name: "识别图片文字" };

  c.openUploadDialog();
  assert.strictEqual(c.uploadOpen, false);
  assert.strictEqual(c.codeModal, true);

  c.codeModal = false;
  await c.readFileContent(new File(["x"], "page.jpg", { type: "image/jpeg" }));
  assert.strictEqual(c.ocrImages.length, 0, "没码就别把图收进批次，免得拍完才发现跑不了");
  assert.strictEqual(c.codeModal, true);
});

test("无码时其他工具的「需要拍照」支路也要码，且停在原步骤", () => {
  const c = anonymousWithNoCodeModel();
  c.currentTool = { id: "1", name: "普通工具" };

  c.openUploadDialog();
  assert.strictEqual(c.uploadOpen, true, "上传弹窗本身可以开：已有原稿那条路不一定要码");
  assert.strictEqual(c.uploadStep, "source");

  c.gotoPhotoStep();
  assert.strictEqual(c.uploadStep, "source", "拍照只通往识别，没码就不该进这一步");
  assert.strictEqual(c.codeModal, true);
});

test("有码就直接放行，不再弹使用码窗口", async () => {
  const { c } = loadModule(makeStorage());
  c.isAuthenticated = true;
  c.theme = "paper";
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: "tok9", path: "/m/upload?token=tok9&theme=paper", expires_in: 900 }),
    };
  };
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
    c._stopPairTimer();
    if (c._pairSource) { try { c._pairSource.close(); } catch (e) { /* 忽略 */ } }
  }
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(c.codeModal, false);
  assert.strictEqual(c.pairOpen, true);
});

test("建会话失败：收起等待窗口并把真实原因说出来", async () => {
  const { c } = loadModule(makeStorage());
  c.isAuthenticated = true;
  const original = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ detail: "请求过于频繁，请稍后再试" }),
  });
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
    c._stopPairTimer();
  }
  assert.strictEqual(c.pairOpen, false, "没建起来就没有可等的");
  assert.strictEqual(c.pairState, "error");
  assert.strictEqual(c.pairStateText, "请求过于频繁，请稍后再试");
  assert.ok(c.toasts.some((t) => t.msg.indexOf("过于频繁") >= 0), JSON.stringify(c.toasts));
  // 码还有效：不该被清掉，也不该弹使用码窗口
  assert.strictEqual(c.codeModal, false);
});

test("配对过期：error 态说的是过期，不是笼统的「配对已失效」", () => {
  const { c } = loadModule(makeStorage());
  c.pairOpen = true;
  c.pairExpiresIn = 0;
  c._pairCountdown();
  assert.strictEqual(c.pairState, "error");
  assert.ok(c.pairStateText.indexOf("过期") >= 0 || c.pairStateText.indexOf("失效") >= 0, c.pairStateText);
});

/* ---------------- 配对窗口的生命周期 ----------------
   这个窗口只负责「配对」：手机连上并传回第一张，它就该退场，把界面让给识别工作区。
   手机端不需要按任何「我拍完了」——拍多少张电脑端就收多少张，
   什么时候开始识别由电脑端说了算，所以也不该因此丢掉任何一张照片。 */

/* 配对状态靠 EventSource 推；Node 没有这个全局，用一个能手动喂帧的替身 */
function fakeEventSource() {
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.closed = false;
      FakeEventSource.last = this;
    }
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
    close() { this.closed = true; }
    emit(type, payload) {
      const ev = { data: JSON.stringify(payload) };
      (this.handlers[type] || []).forEach((fn) => fn(ev));
    }
  }
  return FakeEventSource;
}

/* 起一条配对：stub 掉 EventSource 与建会话请求，返回流替身与请求记录 */
async function openPairing(c, token = "tok") {
  const Fake = fakeEventSource();
  const originalEventSource = global.EventSource;
  const originalFetch = global.fetch;
  global.EventSource = Fake;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token, path: `/m/upload?token=${token}&theme=paper`, expires_in: 900 }),
    };
  };
  await c.startPairing();
  return {
    es: Fake.last,
    calls,
    restore() {
      global.EventSource = originalEventSource;
      global.fetch = originalFetch;
      c._stopPairTimer();
      if (c._pairSource) { try { c._pairSource.close(); } catch (e) { /* 忽略 */ } }
    },
  };
}

test("第一张照片到达：配对窗口自动收起并落到开始识别，流留着继续收", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c);
  try {
    assert.strictEqual(c.pairOpen, true, "刚建好会话时窗口要在（还没人扫码）");
    assert.strictEqual(c.pairLive, true);

    // 只连上、还没有照片：窗口留着（手机可能还在取景）
    pair.es.emit("state", { state: "connected", count: 0, expires_in: 899 });
    assert.strictEqual(c.pairState, "connected");
    assert.strictEqual(c.pairOpen, true);

    pair.es.emit("state", { state: "connected", count: 1, expires_in: 898 });
    assert.strictEqual(c.ocrImages.length, 1, "照片要进批次");
    assert.strictEqual(c.pairOpen, false, "第一张到了，窗口就该退场");
    assert.strictEqual(c.ocrStage, "ready", "直接落在开始识别，不该再让人去找「换类型」");
    assert.strictEqual(pair.es.closed, false, "流不能断：手机还会接着拍");

    // 后面的照片继续进批次，不弹任何东西、不打断
    pair.es.emit("state", { state: "connected", count: 3, expires_in: 896 });
    assert.strictEqual(c.ocrImages.length, 3);
    assert.strictEqual(c.pairOpen, false);
    assert.strictEqual(c.ocrStage, "ready");
    assert.deepStrictEqual(pair.calls.filter((x) => x.options.method === "DELETE"), [], "这个阶段不该释放会话");
  } finally {
    pair.restore();
  }
});

test("窗口收起后再点扫码：接着用同一条会话，不再多建一条", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c, "tok-live");
  try {
    pair.es.emit("state", { state: "connected", count: 1, expires_in: 898 });
    assert.strictEqual(c.pairOpen, false);

    await c.startPairing();
    assert.strictEqual(pair.calls.length, 1, "不该再 POST /api/ocr/pair：批次里那几张的字节就在原会话上");
    assert.strictEqual(c.pairOpen, true, "窗口重新打开，二维码还是那条会话的");
    assert.strictEqual(c.pairToken, "tok-live");
    assert.ok(c.pairUrl.indexOf("tok-live") >= 0, c.pairUrl);

    // 之后的照片只进批次，不把用户刚打开的窗口顶掉：手动打开它就是为了再看一眼二维码，
    // 自动收起只认「0 张 → 第 1 张」那一刻
    pair.es.emit("state", { state: "connected", count: 2, expires_in: 897 });
    assert.strictEqual(c.ocrImages.length, 2);
    assert.strictEqual(c.pairOpen, true, "第二张不该再把窗口顶掉");
  } finally {
    pair.restore();
  }
});

test("点 ✕（收起）只是收起窗口：照片留着，不释放会话", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c);
  try {
    pair.es.emit("state", { state: "connected", count: 2, expires_in: 898 });
    c.pairOpen = true; // 手动把窗口打开，模拟「收起后又点开再看一眼」再点 ✕
    c.cancelPairing();
    assert.strictEqual(c.pairOpen, false);
    assert.strictEqual(c.ocrImages.length, 2, "照片只在服务器内存里，收窗口不该动批次");
    assert.strictEqual(c.ocrStage, "ready");
    assert.deepStrictEqual(pair.calls.filter((x) => x.options.method === "DELETE"), []);
    assert.strictEqual(c.ocrPairToken, "tok", "会话还在，识别请求还要按这个 token 去取字节");
  } finally {
    pair.restore();
  }
});

test("还没人连过就点 ✕：把这条空会话放掉", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c, "tok-empty");
  try {
    c.cancelPairing();
    assert.strictEqual(c.pairOpen, false);
    const deletes = pair.calls.filter((x) => x.options.method === "DELETE");
    assert.strictEqual(deletes.length, 1, "没有内容的会话不该占着服务器内存");
    assert.ok(deletes[0].url.indexOf("tok-empty") >= 0, deletes[0].url);
  } finally {
    pair.restore();
  }
});

test("会话过期：还没出结果时丢掉那些照片，并说清楚为什么", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c);
  try {
    pair.es.emit("state", { state: "connected", count: 2, expires_in: 2 });
    assert.strictEqual(c.ocrImages.length, 2);

    pair.es.emit("error", { message: "配对已过期，请重新扫码" });
    assert.strictEqual(c.ocrImages.length, 0, "服务器内存已经没了，留着只有坏预览和错位的下标");
    assert.strictEqual(c.ocrStage, "empty");
    assert.strictEqual(c.pairLive, false);
    assert.strictEqual(pair.es.closed, true);
    assert.ok(c.toasts.some((t) => t.msg.indexOf("过期") >= 0), JSON.stringify(c.toasts));
  } finally {
    pair.restore();
  }
});

test("已经有识别结果后过期：结果保住，只提示照片过期", async () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };
  const pair = await openPairing(c);
  try {
    pair.es.emit("state", { state: "connected", count: 2, expires_in: 2 });
    c.ocrText = "B 节 语法填空\n61. ……";
    c.ocrStage = "done";

    pair.es.emit("error", { message: "配对已过期，请重新扫码" });
    assert.strictEqual(c.ocrImages.length, 2, "删图会让界面退回空状态，把已经拿到的文字藏起来");
    assert.strictEqual(c.ocrText, "B 节 语法填空\n61. ……");
    assert.ok(c.toasts.some((t) => t.msg.indexOf("过期") >= 0), JSON.stringify(c.toasts));
  } finally {
    pair.restore();
  }
});

test("凭证失效（已登录但后端 401）：交给统一的凭证失效处理，而不是说成配对失效", async () => {
  const c = loadAuthed();
  const original = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: "登录已过期，请重新输入使用码" }),
  });
  try {
    await c.startPairing();
  } finally {
    global.fetch = original;
    c._stopPairTimer();
  }
  assert.strictEqual(c.pairOpen, false);
  // 有码却被拒 = 本机凭证失效，归 handleAuthFailure 统一处理（清登录态 + 引导重新输码）
  assert.strictEqual(c.authFailures.length, 1);
  assert.ok(c.authFailures[0].indexOf("使用码") >= 0, c.authFailures[0]);
  assert.deepStrictEqual(c.toasts, [], "别再多弹一个 toast 说别的事");
});

/* ---------------- 手机页与主站配色一致性 ---------------- */

/* 手机页是独立轻量页（不引框架），主题令牌靠手抄一份。抄错了不会报错、只会
   让扫完码的手机与电脑不是一套皮，所以在这里把两边逐令牌比一遍。
   比较范围是两页共有、且真正决定观感的那些颜色令牌。 */
const SHARED_THEME_TOKENS = [
  "--bg", "--bg-grad", "--accent", "--accent-2", "--title-grad",
  "--text", "--text-dim", "--text-faint", "--glass-spec",
  "--panel", "--panel-soft", "--panel-strong", "--border", "--border-strong",
  "--hover-bg", "--active-bg", "--btn-bg", "--btn-text", "--btn-hover",
  "--shadow", "--glow",
];

function themeBlocks(css) {
  const out = {};
  const re = /html\[data-theme="([a-z]+)"\](?:\[data-sky="([a-z]+)"\])?\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const key = m[2] ? `${m[1]}:${m[2]}` : m[1];
    const tokens = out[key] || (out[key] = {});
    for (const decl of m[3].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (name.indexOf("--") !== 0) continue;
      tokens[name] = decl.slice(i + 1).replace(/\s+/g, " ").trim();
    }
  }
  return out;
}

function mobileThemeBlocks() {
  const html = fs.readFileSync(path.join(__dirname, "..", "mobile-upload.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style, "手机页应有内联样式块");
  return { blocks: themeBlocks(style[1]), html };
}

/* 主站主题清单（script.js 的 THEMES）是唯一事实来源：手机页与后端白名单都得跟着它 */
function THEME_IDS_FROM_SCRIPT() {
  const m = SRC.match(/const THEMES = \[([\s\S]*?)\];/);
  assert.ok(m, "script.js 里应有 THEMES 定义");
  return [...m[1].matchAll(/id:\s*"([a-z]+)"/g)].map((x) => x[1]);
}

test("手机页覆盖了主站全部主题，且共有令牌与 styles.css 逐字一致", () => {
  const site = themeBlocks(fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8"));
  const mobile = mobileThemeBlocks();
  const siteIds = THEME_IDS_FROM_SCRIPT();
  const mobileSelectors = Object.keys(mobile.blocks);

  for (const id of siteIds) {
    assert.ok(mobile.blocks[id], `手机页缺少主题 ${id}`);
  }
  for (const key of mobileSelectors) {
    assert.ok(site[key], `手机页多出来的主题 ${key} 在主站没有对应块`);
  }
  assert.ok(mobile.blocks["sora:night"], "悠空星夜要有独立配色块");
  assert.ok(site["sora:night"], "主站应有悠空星夜块");

  for (const key of mobileSelectors) {
    for (const token of SHARED_THEME_TOKENS) {
      const siteValue = site[key][token];
      const mobileValue = mobile.blocks[key][token];
      if (siteValue === undefined) continue;          // 主站没有的令牌不比较
      assert.notStrictEqual(mobileValue, undefined, `${key} 少了 ${token}`);
      assert.strictEqual(mobileValue, siteValue, `${key} 的 ${token} 与主站不一致`);
    }
  }
});

test("手机页默认主题与主题白名单取自主站清单", () => {
  const mobile = mobileThemeBlocks();
  const siteIds = THEME_IDS_FROM_SCRIPT();
  assert.ok(siteIds.length >= 4, siteIds.join(","));

  // 静态默认（首屏还没跑脚本时用）
  const def = mobile.html.match(/<html[^>]*data-theme="([a-z]+)"/);
  assert.ok(def, "手机页 html 标签应有默认主题");
  assert.ok(siteIds.indexOf(def[1]) >= 0, `${def[1]} 不在主站主题清单里`);

  // 页内白名单（脚本里那份，决定认不认网址传进来的主题）
  const list = mobile.html.match(/var THEMES = \[([^\]]*)\]/);
  assert.ok(list, "手机页脚本应有主题白名单");
  const ids = [...list[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.deepStrictEqual(ids, siteIds, "手机页主题白名单与主站 THEMES 不一致");
});

test("配对倒计时与状态文案", () => {
  const { c } = loadModule(makeStorage());
  c.pairExpiresIn = 95;
  assert.strictEqual(c.pairCountdown, "1:35");
  c.pairState = "waiting";
  assert.ok(c.pairStateText.indexOf("等待") >= 0);
  c.pairState = "receiving";
  c.pairCount = 3;
  assert.ok(c.pairStateText.indexOf("3") >= 0, c.pairStateText);
});

/* ---------------- 上传来源弹窗 ---------------- */

test("识别图片文字工具：上传弹窗直接进拍照那一步（没有「已有原稿」这个分叉）", () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };

  c.openUploadDialog();
  assert.strictEqual(c.uploadStep, "photo");
  assert.strictEqual(c.uploadHasSourceStep, false);
  assert.strictEqual(c.ocrHost, "tool");
});

test("其他工具：上传弹窗先问「已有原稿 / 需要拍照」", () => {
  const c = loadAuthed();
  c.currentTool = { id: "13", name: "试卷可视化全解" };

  c.openUploadDialog();
  assert.strictEqual(c.uploadStep, "source");
  assert.strictEqual(c.uploadHasSourceStep, true);
  assert.strictEqual(c.ocrHost, "modal");

  c.gotoPhotoStep();
  assert.strictEqual(c.uploadStep, "photo");
  c.backToSourceStep();
  assert.strictEqual(c.uploadStep, "source");
});

test("识别工具里丢进文档类文件：给出提示而不是塞进看不见的输入框", async () => {
  const { c } = loadModule(makeStorage());
  c.currentTool = { id: "32", name: "识别图片文字" };
  c.input = "原样";

  await c.readFileContent(new File(["hello"], "paper.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));

  assert.strictEqual(c.input, "原样");
  assert.ok(
    c.toasts.some((t) => t.msg.indexOf("只处理图片") >= 0),
    JSON.stringify(c.toasts)
  );
});

test("批次筛选：排序与删除都会回到「开始识别」，顺序进请求", async () => {
  const { c } = loadModule(makeStorage());
  c.currentTool = { id: "32", name: "识别图片文字" };
  c.ocrImages = [
    { id: "a", name: "1.jpg", size: 1, dataUrl: IMG },
    { id: "b", name: "2.jpg", size: 1, dataUrl: IMG },
    { id: "c", name: "3.jpg", size: 1, dataUrl: IMG },
  ];
  c.ocrStage = "done";
  c.ocrText = "旧结果";

  // 第 3 张前移一位 → 顺序 1,3,2；结果不变但状态回到开始识别（旧文本留给复制）
  c.moveOcrImage(2, -1);
  assert.deepStrictEqual(c.ocrImages.map((x) => x.id), ["a", "c", "b"]);
  assert.strictEqual(c.ocrIndex, 1);
  assert.strictEqual(c.ocrStage, "ready");
  assert.strictEqual(c.ocrText, "旧结果");

  // 边界不越位
  c.moveOcrImage(0, -1);
  assert.deepStrictEqual(c.ocrImages.map((x) => x.id), ["a", "c", "b"]);
  c.moveOcrImage(2, 1);
  assert.deepStrictEqual(c.ocrImages.map((x) => x.id), ["a", "c", "b"]);

  // 删掉中间那张
  c.removeOcrImage(1);
  assert.deepStrictEqual(c.ocrImages.map((x) => x.id), ["a", "b"]);

  // 删空即回到空状态
  c.removeOcrImage(0);
  c.removeOcrImage(0);
  assert.strictEqual(c.ocrImages.length, 0);
  assert.strictEqual(c.ocrStage, "empty");
});

test("扫码来源：请求带 token 与电脑端排好的顺序，图片字节不回传", async () => {
  const c = loadAuthed();
  c.ocrPairToken = "t1";
  c.ocrImages = [
    { id: "p2", name: "手机照片 3", size: 0, pairIndex: 2, url: "/api/ocr/pair/t1/image?i=2" },
    { id: "p0", name: "手机照片 1", size: 0, pairIndex: 0, url: "/api/ocr/pair/t1/image?i=0" },
  ];
  c.ocrStage = "ready";

  await withFetch([["done", "[DONE]"]], async (calls) => {
    await c.ocrStart();
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.pair_token, "t1");
    assert.deepStrictEqual(body.pair_order, [2, 0]);
    assert.strictEqual(body.images, undefined);
  });
});

/* ---------------- 识别类型由工具决定 ---------------- */

test("工具 → 类型的绑定：作文批改按手写稿，其余工具一律按原卷印刷稿", () => {
  const { api } = loadModule(makeStorage());

  // 会收到学生手写稿的只有「学生作文批改」
  assert.strictEqual(api.ocrModeForTool("10"), "handwritten");
  // 弄试卷的工具：讲评 / 可视化全解 / 榨干一套 / Bug 侦察
  ["12", "13", "14", "23"].forEach((id) => {
    assert.strictEqual(api.ocrModeForTool(id), "printed", `工具 ${id} 收的是原卷`);
  });
  // 跟试卷无关的工具也是原卷印刷稿
  ["1", "15", "30"].forEach((id) => {
    assert.strictEqual(api.ocrModeForTool(id), "printed", `工具 ${id} 默认印刷稿`);
  });
  // 通用转文字工具与自由对话：两种素材都可能来，保留手动选择
  ["25", "32"].forEach((id) => {
    assert.strictEqual(api.ocrModeCanChoose(id), true, `工具 ${id} 应保留选择`);
  });
  ["10", "13", "1"].forEach((id) => {
    assert.strictEqual(api.ocrModeCanChoose(id), false, `工具 ${id} 不该给选择`);
  });
  // 未知工具（首屏还没选工具、工具被下线）按最通用的印刷稿处理
  assert.strictEqual(api.ocrModeForTool(undefined), "printed");
  assert.strictEqual(api.ocrModeForTool(""), "printed");
});

test("定死类型的工具：面板只剩当前这一张卡，换不了类型", () => {
  const c = loadAuthed();
  c.currentTool = { id: "13", name: "试卷可视化全解" };

  assert.strictEqual(c.ocrMode, "printed");
  assert.strictEqual(c.ocrTypeLabel, "印刷试卷");
  assert.strictEqual(c.ocrModeSelectable, false);
  assert.deepStrictEqual(c.ocrModeOptions.map((o) => o.mode), ["printed"], "另一种类型要直接不出现");
  assert.strictEqual(c.ocrModeOptions[0].on, true, "当前类型那张卡要显成选中态");
  assert.strictEqual(c.ocrModeOptions[0].icon, "scan-text");

  // 作文批改反过来：只剩手写这张
  c.currentTool = { id: "10", name: "学生作文批改" };
  assert.strictEqual(c.ocrMode, "handwritten");
  assert.deepStrictEqual(c.ocrModeOptions.map((o) => o.mode), ["handwritten"]);
  assert.strictEqual(c.ocrTypeLabel, "手写作文");
  assert.ok(c.ocrModeHint.indexOf("保留原有拼写与语法错误") >= 0, c.ocrModeHint);
});

test("通用工具（识别图片文字 / 自由对话）：两张卡都在，选得动", () => {
  const c = loadAuthed();
  c.currentTool = { id: "32", name: "识别图片文字" };

  assert.strictEqual(c.ocrModeSelectable, true);
  assert.deepStrictEqual(c.ocrModeOptions.map((o) => o.mode), ["printed", "handwritten"]);
  assert.strictEqual(c.ocrMode, "printed", "默认还是印刷稿");
  assert.deepStrictEqual(c.ocrModeOptions.map((o) => o.on), [true, false]);

  c.chooseOcrMode("handwritten");
  assert.deepStrictEqual(c.ocrModeOptions.map((o) => o.on), [false, true]);

  c.currentTool = { id: "25", name: "自由对话" };
  assert.strictEqual(c.ocrModeSelectable, true);
  assert.strictEqual(c.ocrMode, "handwritten", "手动选择跟着会话走");

  // 定死类型的工具上这个动作必须无效，不然面板上那张卡的显示会和请求体不一致
  c.currentTool = { id: "10", name: "学生作文批改" };
  c.chooseOcrMode("printed");
  assert.strictEqual(c.ocrMode, "handwritten");
});

test("类型面板按 ocrModeOptions 渲染：不许再退回硬编码的两张卡", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.indexOf('x-for="opt in ocrModeOptions"') >= 0, "面板要走 ocrModeOptions");
  assert.strictEqual(html.indexOf("chooseOcrMode('printed')"), -1, "卡片不能再写死两种类型");
  assert.strictEqual(html.indexOf("chooseOcrMode('handwritten')"), -1, "卡片不能再写死两种类型");
  assert.ok(html.indexOf('x-show="ocrHasImage && !ocrStreaming && !ocrNeedsStart && ocrModeSelectable"') >= 0,
    "「换类型」只对能选的工具出现");
  // 工具工作区与弹窗两处形态都要一样
  assert.strictEqual((html.match(/x-for="opt in ocrModeOptions"/g) || []).length, 2);
});

/* ---------------- 三处界面上踩过的坑 ---------------- */

test("批次里点加号：上传弹窗要能压住识别弹窗，而且只给图片入口", () => {
  const { c } = loadModule(makeStorage());
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  // 层级：两个弹窗 z-index 相同、DOM 顺序又在识别弹窗之前，不抬高就是「点了没反应」
  const base = css.match(/\.modal-mask\s*\{[^}]*z-index:\s*(\d+)/);
  const nested = css.match(/\.modal-mask\.is-nested\s*\{\s*z-index:\s*(\d+)/);
  assert.ok(base && nested, "两层弹窗的 z-index 都要在样式里写明");
  assert.ok(Number(nested[1]) > Number(base[1]), "辅助弹窗必须压在识别弹窗之上");
  assert.ok(/\.modal-mask\.under-stack\s*\{[^}]*backdrop-filter:\s*none/.test(css),
    "下面已经有一层弹窗时不再叠第二次模糊");
  ["uploadOpen", "pairOpen"].forEach((flag) => {
    const mask = html.match(new RegExp(`x-show="${flag}" class="modal-mask([^"]*)"`));
    assert.ok(mask && mask[1].indexOf("is-nested") >= 0, `${flag} 的遮罩要带 is-nested`);
    assert.ok(new RegExp(`x-show="${flag}"[^>]*:class="\\{ 'under-stack': ocrModalOpen \\}"`).test(html),
      `${flag} 的遮罩要跟着识别弹窗切换 under-stack`);
  });

  // 入口：从识别批次里补图片，只该有相册 / 相机 / 扫码，不该再问「有没有原稿」
  c.currentTool = { id: "13", name: "试卷可视化全解" };
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.openUploadDialog({ imagesOnly: true });
  assert.strictEqual(c.uploadStep, "photo", "直接进选照片那一步");
  assert.strictEqual(c.uploadHasSourceStep, false, "没有「已有原稿」这个分叉");
  assert.strictEqual(c.ocrHost, "modal", "结果仍旧落回弹窗形态");

  // 普通的第一次上传照旧先问有没有原稿
  c.closeUploadDialog();
  c.openUploadDialog();
  assert.strictEqual(c.uploadStep, "source");
  assert.strictEqual(c.uploadHasSourceStep, true);

  // 「换一批图片」同样只收图片
  c.ocrRepick();
  assert.strictEqual(c.uploadStep, "photo");
  assert.strictEqual(c.uploadOpen, true);
});

test("收起图片栏：图标是双箭头，收起后两个按钮竖排不压到右边", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

  assert.strictEqual(html.indexOf("'chevron-right' : 'chevron-left'"), -1, "单箭头像「返回」，不能再用");
  assert.strictEqual((html.match(/ocrMediaCollapsed \? 'chevrons-right' : 'chevrons-left'/g) || []).length, 2);
  assert.ok(html.indexOf("展开图片栏") >= 0 && html.indexOf("收起图片栏") >= 0, "title 要说清是收起/展开图片栏");
  assert.ok(/\.ocr-side\.is-collapsed \.ocr-side-head\s*\{[^}]*flex-direction:\s*column/.test(css),
    "收起成一条时要竖排，否则两个按钮会溢出压到类型条上");
  assert.ok(/\.ocr-side\.is-collapsed \.ocr-side-head > span\s*\{\s*display:\s*none/.test(css),
    "收起时那行「1 张 · 点击图片可放大」要藏掉");
});

test("删空图片后不留空白：类型一并收起，空状态给回入口", () => {
  const { c } = loadModule(makeStorage());
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  // 有图 + 还没结果 = 一定有落点（哪怕 stage 是个跟图片对不上的旧值）
  c.currentTool = { id: "13", name: "试卷可视化全解" };
  c.ocrStage = "empty";
  assert.strictEqual(c.ocrNeedsStart, false, "没图时不该出现「开始识别」面板");
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  assert.strictEqual(c.ocrNeedsStart, true, "批次里有图就必须给一个可操作的落点");
  c.ocrStage = "error";
  assert.strictEqual(c.ocrNeedsStart, false, "错误卡在的时候不叠一个开始识别面板");

  // 界面：无图时类型胶囊、分栏、页脚一起收起，换成空状态卡
  assert.ok(/class="ocr-type-chip ml-auto" x-show="ocrHasImage"/.test(html), "弹窗标题上的类型要跟着图片走");
  assert.ok(/x-show="!ocrHasImage" x-cloak class="flex-1 min-h-0 overflow-y-auto scroll-thin"/.test(html),
    "弹窗里要有空状态卡，不能留一块空壳");
  assert.ok(/x-show="ocrHasImage" class="ocr-split/.test(html), "分栏只在有图时出现");
  assert.ok(/x-show="ocrHasImage" class="px-5 py-3 border-t/.test(html), "无图时页脚那排按钮一并收起");
  // 工具工作区里三处一起判断，两处形态保持一致
  assert.strictEqual((html.match(/x-show="!ocrHasImage"/g) || []).length, 2);
});

/* ---------------- 图片查看 / 编辑（转正 · 裁剪） ---------------- */

/* 编辑里的几何全是纯函数：先把「转正后框跟着转」和「一次烘焙出什么像素」钉死 */
test("旋转选择框：跟着内容一起转，来回转是互逆的", () => {
  const { api } = loadModule(makeStorage());
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const cw = api.ocrRotateRect(rect, 1);
  assert.deepStrictEqual(cw, { x: 0.4, y: 0.1, w: 0.4, h: 0.3 }, "顺时针 90°：宽高互换，位置随内容走");
  assert.deepStrictEqual(api.ocrRotateRect(cw, -1), rect, "再逆时针转回来还是原来那个框");
  // 顶部横条转 90° 应该落到右边：说明框跟的是内容，不是「留在原地」
  assert.deepStrictEqual(api.ocrRotateRect({ x: 0, y: 0, w: 0.5, h: 0.25 }, 1),
    { x: 0.75, y: 0, w: 0.25, h: 0.5 });
  // 满幅怎么转都还是满幅（不会被浮点误差挤出画面）
  assert.deepStrictEqual(api.ocrRotateRect({ x: 0, y: 0, w: 1, h: 1 }, 1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepStrictEqual(api.ocrRotateRect(null, -1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepStrictEqual(api.ocrRotatedSize(2000, 1000, 270), { width: 1000, height: 2000 });
  assert.deepStrictEqual(api.ocrRotatedSize(2000, 1000, 180), { width: 2000, height: 1000 });
  assert.deepStrictEqual(api.ocrRotatedSize(2000, 1000, -90), { width: 1000, height: 2000 }, "负角度也要认");
});

test("适配尺寸：按 contain 缩放，装得下就不放大；量不到舞台时先给 0", () => {
  const { api } = loadModule(makeStorage());
  assert.deepStrictEqual(api.ocrFitSize(2000, 1000, 400, 400), { width: 400, height: 200 });
  assert.deepStrictEqual(api.ocrFitSize(1000, 2000, 400, 400), { width: 200, height: 400 });
  assert.deepStrictEqual(api.ocrFitSize(300, 150, 1000, 1000), { width: 300, height: 150 }, "小图不放大");
  assert.deepStrictEqual(api.ocrFitSize(300, 150, 0, 0), { width: 0, height: 0 }, "还没量到舞台");
});

test("烘焙计划：旋转换宽高、裁剪落成像素、边界不留缝", () => {
  const { api } = loadModule(makeStorage());
  const full = api.ocrBakePlan(2000, 1000, 0, null);
  assert.deepStrictEqual([full.rotW, full.rotH, full.sx, full.sy, full.sw, full.sh, full.outW, full.outH],
    [2000, 1000, 0, 0, 2000, 1000, 2000, 1000], "不转不裁：整幅原样");

  const p = api.ocrBakePlan(2000, 1000, 90, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
  assert.deepStrictEqual([p.rotW, p.rotH], [1000, 2000], "90° 之后画布换宽高");
  assert.deepStrictEqual([p.sx, p.sy, p.sw, p.sh], [250, 1000, 500, 500], "框按旋转后的画面换算");
  assert.deepStrictEqual([p.outW, p.outH], [500, 500]);

  // 贴着右下角的框 + 浮点误差：裁出来的矩形必须还在画布里，且至少有 1 像素
  const edge = api.ocrBakePlan(1000, 800, 270, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
  assert.deepStrictEqual([edge.rotW, edge.rotH], [800, 1000]);
  assert.ok(edge.sx + edge.sw <= edge.rotW && edge.sy + edge.sh <= edge.rotH, "不能裁出界");
  const odd = api.ocrBakePlan(999, 997, 0, { x: 0.333, y: 0.333, w: 0.667, h: 0.667 });
  assert.ok(odd.outW >= 1 && odd.outH >= 1 && odd.sx + odd.sw <= odd.rotW && odd.sy + odd.sh <= odd.rotH);
  // 越界的框（理论上不该出现）也按边界处理，不能给出负宽高
  const wild = api.ocrBakePlan(1000, 1000, 0, { x: 1.4, y: -0.2, w: 3, h: 2 });
  assert.ok(wild.sx >= 0 && wild.sy >= 0 && wild.outW >= 1 && wild.outH >= 1);
  assert.ok(wild.sx + wild.sw <= wild.rotW && wild.sy + wild.sh <= wild.rotH);
});

/* 假事件 / 假画面框：拖动那套逻辑照跑，只是不用真浏览器 */
function fakeFrame() {
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => {},
    clientWidth: 100,
    clientHeight: 100,
  };
}
function fakePointer(over) {
  const ev = { pointerId: 1, clientX: 0, clientY: 0, preventDefault: () => {} };
  return Object.assign(ev, over);
}
function handleTarget(name) {
  return { closest: () => ({ dataset: { h: name } }) };
}

test("裁剪框拖动：空白处拖出新框、框内拖动挪位、拖把手改边", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrIndex = 0;
  c.ocrEditBaseW = 1000;
  c.ocrEditBaseH = 1000;
  c.toggleOcrCrop();
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0, y: 0, w: 1, h: 1 }, "打开裁剪先给满幅框");
  const frame = fakeFrame();

  // 空白处拖出一个新框：从 (10,10) 拉到 (40,50)
  c.ocrEditDown(fakePointer({ clientX: 10, clientY: 10, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "newrect", "尺幅 1 倍时空白处拖动就是画新框");
  c.ocrEditMove(fakePointer({ clientX: 40, clientY: 50, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.1, y: 0.1, w: 0.3, h: 0.4 });
  c.ocrEditUp({ pointerId: 1 });
  assert.strictEqual(c._ocrDrag, null, "松手就不再拖了");

  // 手一抖划过的针尖大框不算数，保留原来的框（从框外起手 = 画新框）
  c.ocrEditDown(fakePointer({ clientX: 5, clientY: 5, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "newrect");
  c.ocrEditMove(fakePointer({ clientX: 7, clientY: 7, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.1, y: 0.1, w: 0.3, h: 0.4 }, "太小的框当作没画");
  c.ocrEditUp({ pointerId: 1 });

  // 框内拖动：整框挪位，尺寸不变；到边就停住，不会挤出画面
  c.ocrEditDown(fakePointer({ clientX: 30, clientY: 30, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "move");
  c.ocrEditMove(fakePointer({ clientX: 60, clientY: 60, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.4, y: 0.4, w: 0.3, h: 0.4 });
  c.ocrEditMove(fakePointer({ clientX: 95, clientY: 95, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.7, y: 0.6, w: 0.3, h: 0.4 }, "右下角顶住，不能再往外");
  c.ocrEditUp({ pointerId: 1 });

  // 拖右下角把手：对角固定，只动这一条边
  c.ocrEditCrop = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  c.ocrEditDown(fakePointer({ clientX: 50, clientY: 50, currentTarget: frame, target: handleTarget("se") }));
  assert.strictEqual(c._ocrDrag.mode, "resize");
  assert.strictEqual(c._ocrDrag.handle, "se");
  c.ocrEditMove(fakePointer({ clientX: 80, clientY: 90, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.2, y: 0.2, w: 0.7, h: 0.8 });
  // 往回拖过头也不翻转：最小边长兜住，对角（nw）始终钉在原地
  c.ocrEditMove(fakePointer({ clientX: 5, clientY: 5, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.2, y: 0.2, w: 0.04, h: 0.04 });
  c.ocrEditUp({ pointerId: 1 });

  // 放大之后空白处拖动是平移画面（手指要能把细节挪出来对边），不再是画新框
  c.ocrEditFull = { w: 400, h: 400 };   // 可见窗口的尺寸（这里没有裁剪，等于整幅）
  c._ocrSetView(2, 0, 0, 0, 0);
  c.ocrEditDown(fakePointer({ clientX: 5, clientY: 95, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "pan", "放大之后空白处拖动是平移");
  c.ocrEditMove(fakePointer({ clientX: 55, clientY: 95, currentTarget: frame }));
  assert.strictEqual(c.ocrEditView.x, 50);
  c.ocrEditUp({ pointerId: 1 });

  // 平移被夹在多出来的那半里，缩回 1 倍位置归零
  c.ocrEditView = { scale: 2, x: 9999, y: -9999 };
  c._clampOcrView();
  assert.deepStrictEqual(c.ocrEditView, { scale: 2, x: 200, y: -200 });
  c._ocrSetView(1, 0, 0, 0, 0);
  assert.deepStrictEqual(c.ocrEditView, { scale: 1, x: 0, y: 0 });
});

test("触屏双指：第二根手指落下就转成缩放，松手后不再接着拖", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrIndex = 0;
  c.ocrEditBaseW = 1000;
  c.ocrEditBaseH = 1000;
  c.ocrEditFull = { w: 400, h: 400 };   // 可见窗口的尺寸（这里没有裁剪，等于整幅）
  c.toggleOcrCrop();
  const frame = fakeFrame();

  c.ocrEditDown(fakePointer({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "newrect");
  c.ocrEditDown(fakePointer({ pointerId: 2, clientX: 100, clientY: 0, currentTarget: frame, target: frame }));
  assert.strictEqual(c._ocrDrag.mode, "pinch", "第二根手指落下：刚才的单指动作作废");
  // 两指拉远一倍 = 放大一倍；松掉一根后，剩下那根不该接管拖拽（起点已作废，硬接会跳一下）
  c.ocrEditMove(fakePointer({ pointerId: 2, clientX: 200, clientY: 0, currentTarget: frame }));
  assert.strictEqual(c.ocrEditView.scale, 2, "两指拉开一倍就放大一倍");
  const after = Object.assign({}, c.ocrEditView);
  c.ocrEditUp({ pointerId: 2 });
  assert.strictEqual(c._ocrDrag, null);
  c.ocrEditMove(fakePointer({ pointerId: 1, clientX: 300, clientY: 0, currentTarget: frame }));
  assert.deepStrictEqual(c.ocrEditView, after, "剩下那根手指不再接着拖");
});

test("转正与裁剪：转一下框跟着转，重置只撤未生效的，识别中不许动", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrIndex = 0;
  c.ocrEditBaseW = 1000;
  c.ocrEditBaseH = 800;
  c.toggleOcrCrop();
  c.ocrEditCrop = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  c.rotateOcrEditor(1);
  assert.strictEqual(c.ocrEditRotate, 90);
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.3, y: 0.2, w: 0.5, h: 0.5 }, "框跟着内容转，不是留在原地");
  c.rotateOcrEditor(-1);
  assert.strictEqual(c.ocrEditRotate, 0);
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });

  c.resetOcrEdits();
  assert.strictEqual(c.ocrEditDirty, false);
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0, y: 0, w: 1, h: 1 }, "重置后还开着裁剪工具：回到满幅框");
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditCropOn, false);
  c.resetOcrEdits();
  assert.strictEqual(c.ocrEditCrop, null, "工具收起后重置 = 彻底不裁");

  // 识别中：编辑按钮是禁用的，方法自己也要挡住（两处都拦，别只靠界面）
  c.ocrStage = "streaming";
  c.ocrEditCrop = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  c.rotateOcrEditor(1);
  assert.strictEqual(c.ocrEditRotate, 0);
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
});

test("编辑落地：旋转与裁剪一次烘焙进 dataUrl，原图留底可还原", async () => {
  const { c, record } = loadWithFakeDom(makeStorage());
  const item = { id: "a", name: "a.jpg", size: 100, dataUrl: "data:image/jpeg;base64,ORIG" };
  c.ocrImages = [item];
  c.ocrIndex = 0;
  c.ocrStage = "done";
  c.ocrText = "上一版结果";
  c.ocrEditBase = item.dataUrl;
  c.ocrEditBaseW = 2000;
  c.ocrEditBaseH = 1000;
  assert.strictEqual(c.ocrEditDirty, false, "刚打开时没有待生效的改动");

  c.ocrEditRotate = 90;
  c.ocrEditCrop = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
  c.ocrEditCropOn = true;
  assert.strictEqual(c.ocrEditDirty, true);

  assert.strictEqual(await c.applyOcrEdit(), true);
  assert.deepStrictEqual(record.sizes, [[1000, 2000], [500, 500]], "先画旋转后的整幅，再从中裁出 500×500");
  assert.deepStrictEqual(record.draws, [5, 9], "第一次贴整幅（五参），第二次从它裁（九参）");
  // 请求体取的就是 item.dataUrl（见 ocrStart），换掉它就是换掉送出去的那张
  assert.strictEqual(item.dataUrl, "data:image/jpeg;base64,EDITED");
  assert.strictEqual(item.sourceUrl, "data:image/jpeg;base64,ORIG", "第一次动它之前留一份原样");
  assert.strictEqual(item.edited, true);
  assert.ok(item.w === 500 && item.h === 500, "把新的像素尺寸记下来");
  assert.ok(item.size > 0, "体积也重新算过");
  assert.strictEqual(c.ocrEditBase, item.dataUrl, "基准换成刚生成的这张，接着再改从它出发");
  assert.strictEqual(c.ocrEditDirty, false);
  assert.strictEqual(c.ocrEditCropOn, false, "烘焙完裁剪工具收起");
  // 画面变了：上一版转录结果对不上了，退回「开始识别」，但文本留着可复制
  assert.strictEqual(c.ocrStage, "ready");
  assert.strictEqual(c.ocrText, "上一版结果");
  assert.strictEqual(c.ocrEditCanRestore, true);

  await c.restoreOcrOriginal();
  assert.strictEqual(item.dataUrl, "data:image/jpeg;base64,ORIG");
  assert.strictEqual(item.edited, false);
  assert.strictEqual(c.ocrEditCanRestore, false, "退回去之后就不该再有「还原原图」");
});

test("关闭编辑器：有改动就落地，纯看图一个像素都不碰", async () => {
  const { c, record } = loadWithFakeDom(makeStorage());
  const item = { id: "a", name: "a.jpg", size: 1, dataUrl: "data:image/jpeg;base64,ORIG" };
  c.ocrImages = [item];
  c.ocrIndex = 0;
  c.ocrEditBase = item.dataUrl;
  c.ocrEditBaseW = 800;
  c.ocrEditBaseH = 600;
  c.ocrViewerOpen = true;
  await c.closeOcrEditor();
  assert.strictEqual(c.ocrViewerOpen, false);
  assert.strictEqual(item.dataUrl, "data:image/jpeg;base64,ORIG", "只是放大看一眼，不该动图片");
  assert.strictEqual(record.sizes.length, 0, "没有改动就不该开画布");
  assert.strictEqual(c.ocrEditBase, "", "关掉后编辑态清干净，下一次打开是干净的一张");

  c.ocrViewerOpen = true;
  c.ocrEditBase = item.dataUrl;
  c.ocrEditBaseW = 800;
  c.ocrEditBaseH = 600;
  c.ocrEditRotate = 90;
  await c.closeOcrEditor();
  assert.deepStrictEqual(record.sizes, [[600, 800], [600, 800]], "转向后整幅就是 600×800");
  assert.strictEqual(item.dataUrl, "data:image/jpeg;base64,EDITED");
  assert.strictEqual(c.ocrViewerOpen, false);
  assert.strictEqual(c.ocrEditDirty, false);
  assert.ok(c.toasts.some((t) => t.msg === "已转正"), "落地了要给个回执");
});

test("画面尺寸与样式：量到舞台后，图片正好落在画面框里（NaN/undefined 回归护栏）", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG, w: 1333, h: 2000 }];
  c.ocrIndex = 0;
  // 舞台量不出来时两个尺寸都是 0：这时样式里不能出现 NaN/undefined（浏览器会把整条声明丢掉，
  // 图片就退回自然尺寸、还停在别处——曾经就是这样跟白底错位的）
  c.ocrEditBaseW = 1333;
  c.ocrEditBaseH = 2000;
  c.syncOcrEditorSize();
  assert.strictEqual(c.ocrEditImg.w, 0, "拿不到舞台尺寸时先给 0，等下一次量");

  c.$refs = { ocrEditStage: { clientWidth: 1064, clientHeight: 626 } };
  c.syncOcrEditorSize();
  assert.deepStrictEqual(c.ocrEditImg, { w: 401, h: 602 }, "装进舞台（两端各留 12px）后按比例缩");
  assert.deepStrictEqual(c.ocrEditFull, { w: 401, h: 602 }, "不转时整幅就是它");
  assert.strictEqual(c.ocrEditImageStyle,
    "width:401px;height:602px;margin-left:0px;margin-top:0px;transform:rotate(0deg)");
  assert.strictEqual(c.ocrEditFrameStyle, "width:401px;height:602px;transform:translate(0.00px,0.00px) scale(1.0000)");
  assert.strictEqual(c.ocrEditRectStyle, "left:0.000%;top:0.000%;width:100.000%;height:100.000%");
  [c.ocrEditImageStyle, c.ocrEditFrameStyle].forEach((s) => {
    assert.strictEqual(/NaN|undefined/.test(s), false, `样式里出现了无效值：${s}`);
  });

  // 转 90°：整幅换宽高，图片本身不重算尺寸（它靠 CSS transform 转），左上角跟着挪到居中位置
  c.rotateOcrEditor(1);
  assert.deepStrictEqual(c.ocrEditFull, { w: 602, h: 401 });
  assert.deepStrictEqual(c.ocrEditImg, { w: 401, h: 602 });
  assert.strictEqual(c.ocrEditImageStyle,
    "width:401px;height:602px;margin-left:100.5px;margin-top:-100.5px;transform:rotate(90deg)");
  c.rotateOcrEditor(-1);
  assert.deepStrictEqual(c.ocrEditFull, { w: 401, h: 602 });

  // 窗口变小：画面跟着缩，仍然不出无效值
  c.$refs.ocrEditStage = { clientWidth: 300, clientHeight: 300 };
  c.syncOcrEditorSize();
  assert.ok(c.ocrEditFull.w <= 276 && c.ocrEditFull.h <= 276);
  assert.strictEqual(/NaN|undefined/.test(c.ocrEditImageStyle), false);
});

/* 从几何反推「窗口里实际看到的是整幅的哪一块」——必须正好等于裁剪框。
   只断言样式字符串是没用的：那串是从同一个公式推出来的，符号写反了它照样对得上。
   这里改成从「图片被推到哪」倒着算可见区域，方向错了必然报错 */
function visibleRegion(c) {
  const full = c.ocrEditFull;
  const img = c.ocrEditImg;
  const box = c.ocrEditWinSize;
  const m = /margin-left:(-?[\d.]+)px;margin-top:(-?[\d.]+)px/.exec(c.ocrEditImageStyle);
  const left = Number(m[1]);
  const top = Number(m[2]);
  return {
    // 画面（旋转后）那个框的左上角在窗口坐标里的位置 ÷ 整幅尺寸 = 可见区域原点
    x: +((full.w / 2 - img.w / 2 - left) / full.w).toFixed(3),
    y: +((full.h / 2 - img.h / 2 - top) / full.h).toFixed(3),
    w: +(box.w / full.w).toFixed(3),
    h: +(box.h / full.h).toFixed(3),
  };
}

/* 窗口尺寸是取整的，比例会差半个像素：比到 0.002 就够，而符号写反是 0.5 级的错误 */
function assertSameRegion(c, want, msg) {
  const got = visibleRegion(c);
  ["x", "y", "w", "h"].forEach((k) => {
    assert.ok(Math.abs(got[k] - want[k]) <= 0.002, `${msg}：${k} 期望 ${want[k]}，实际 ${got[k]}`);
  });
}

test("实时预览：退出裁剪即显示裁完的样子（只是把框外不显示，不重新编码）", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrIndex = 0;
  c.ocrEditBaseW = 1333;
  c.ocrEditBaseH = 2000;
  c.$refs = { ocrEditStage: { clientWidth: 1064, clientHeight: 626 } };
  c.syncOcrEditorSize();
  const full = c.ocrEditFrameStyle;

  // 裁剪工具开着 = 看整幅（框外留着做参照），画面框不动
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditFrameStyle, full, "还在裁剪时看的是整幅");
  assert.ok(c.ocrEditImageStyle.indexOf("margin-left:0px") >= 0, "看整幅时图片左上角就在原点");
  c.ocrEditCrop = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  assert.strictEqual(c.ocrEditFrameStyle, full, "拖框的过程中也还是整幅，否则没法调整");

  // 退出裁剪 = 立刻按裁剪范围显示：画面框缩到 201×241，图片往左上推出去
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditCropOn, false);
  assert.strictEqual(c.ocrEditFrameStyle, "width:201px;height:241px;transform:translate(0.00px,0.00px) scale(1.0000)");
  assert.strictEqual(c.ocrEditImageStyle,
    "width:401px;height:602px;margin-left:-40.1px;margin-top:-120.4px;transform:rotate(0deg)");
  assertSameRegion(c, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
    "窗口里看到的必须是裁剪框框住的那一块（推反方向会算成负数）");
  assert.strictEqual(/NaN|undefined/.test(c.ocrEditFrameStyle + c.ocrEditImageStyle), false);
  // 放大边界跟着可见的这一块算，不是跟着整幅
  c.ocrEditView = { scale: 2, x: 999, y: 999 };
  c._clampOcrView();
  assert.deepStrictEqual(c.ocrEditView, { scale: 2, x: 100.5, y: 120.5 });

  // 换成偏右下的一块：可见区域跟着走，仍然是这个框
  c.ocrEditCrop = { x: 0.5, y: 0.5, w: 0.25, h: 0.25 };
  assertSameRegion(c, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, "换一块，看到的就跟着换");
  // 转 90°：框跟着内容转（右下的块转到左下），画面框换宽高，窗口里看到的仍是这个框
  c.rotateOcrEditor(1);
  assert.deepStrictEqual(c.ocrEditFull, { w: 602, h: 401 });
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.25, y: 0.5, w: 0.25, h: 0.25 }, "框跟着内容转到了左下");
  assert.strictEqual(c.ocrEditFrameStyle.indexOf("width:151px;height:100px"), 0);
  assertSameRegion(c, c.ocrEditCrop, "转 90° 后窗口里看到的还是当前这个框");
  c.rotateOcrEditor(-1);

  // 再回到裁剪：又看回整幅，框也还在（可以接着调）
  c.ocrEditCrop = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditFrameStyle, full);
  assert.deepStrictEqual(c.ocrEditCrop, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  assert.deepStrictEqual(c.ocrEditView, { scale: 1, x: 0, y: 0 }, "进出裁剪都从整幅看起");

  // 重置（裁剪工具里）＝ 回到不裁：框回满幅，预览也就成了整幅
  c.resetOcrEdits();
  assert.strictEqual(c.ocrEditCropped, false);
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditFrameStyle, full, "重置之后没有裁剪范围，看的就是整幅");
});

test("裁剪模式下的退出手势：Esc 先退出裁剪，再按一次才关闭编辑器", () => {
  const { c } = loadModule(makeStorage());
  c.ocrImages = [{ id: "a", name: "a.jpg", size: 1, dataUrl: IMG }];
  c.ocrIndex = 0;
  c.ocrViewerOpen = true;
  c.ocrEditBaseW = 1000;
  c.ocrEditBaseH = 800;
  c.toggleOcrCrop();
  assert.strictEqual(c.ocrEditCropOn, true);

  const esc = { key: "Escape", preventDefault: () => {} };
  c.ocrEditorKey(esc);
  assert.strictEqual(c.ocrEditCropOn, false, "第一次 Esc 只是退出裁剪，让人先看到结果");
  assert.strictEqual(c.ocrViewerOpen, true, "别把整个编辑器关掉");

  c.ocrEditorKey(esc);
  assert.strictEqual(c.ocrViewerOpen, false, "再按一次才关闭");
});

test("编辑器接线：入口即编辑、八个把手、Esc 不许穿透到下面的弹窗", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const { api } = loadModule(makeStorage());

  // 两个入口（工具工作区 + 上传弹窗）都走 openOcrEditor：放大与编辑是同一个界面
  assert.strictEqual((html.match(/@click="openOcrEditor\(\)"/g) || []).length, 2);
  assert.strictEqual(html.indexOf('@click="ocrViewerOpen = false"'), -1, "看图的遮罩不再一点就关（会误伤刚拖好的框）");
  assert.ok(html.indexOf('@resize.window="ocrViewerOpen && syncOcrEditorSize()"') >= 0, "转屏/改窗口要重算画面尺寸");
  assert.strictEqual((html.match(/x-ref="ocrEditStage"/g) || []).length, 1);

  // 工具条在顶栏中间，退出只有一个显眼的「完成」
  assert.ok(/<div class="ocr-editor-head">[\s\S]*?class="ocr-editor-tools"[\s\S]*?ocr-editor-done/.test(html),
    "顶栏里依次是标题、居中工具条、完成按钮");
  assert.strictEqual((html.match(/@click="closeOcrEditor\(\)"/g) || []).length, 1, "退出只留一个入口，别让人找两个");
  assert.ok(html.indexOf('class="btn-primary ocr-editor-done"') >= 0, "「完成」要是实心主按钮，不然找不到");
  assert.ok(html.indexOf('@click="rotateOcrEditor(-1)"') >= 0 && html.indexOf('@click="rotateOcrEditor(1)"') >= 0);
  assert.ok(html.indexOf('@click="toggleOcrCrop()"') >= 0);
  assert.ok(html.indexOf('@click="resetOcrEdits()"') >= 0 && html.indexOf('@click="restoreOcrOriginal()"') >= 0);
  assert.strictEqual(html.indexOf("selectAllOcrCrop"), -1, "「整幅」撤了：它的作用已经被重置覆盖");
  assert.strictEqual(src.indexOf("selectAllOcrCrop"), -1, "别把它留在代码里没人用");
  assert.ok(html.indexOf('@pointerdown="ocrEditDown($event)"') >= 0);
  assert.ok(html.indexOf('@wheel.prevent="ocrEditWheel($event)"') >= 0, "滚轮缩放要拦下页面滚动");
  assert.ok(html.indexOf('@click.self="ocrEditCropOn && toggleOcrCrop()"') >= 0, "点画面外的留白处也能退出裁剪看结果");
  assert.ok(html.indexOf(':class="{ \'is-morphing\': !ocrEditCropOn }"') >= 0, "退出裁剪时尺寸变化要形变一下");
  assert.strictEqual((html.match(/x-show="ocrEditCropOn"/g) || []).length, 1, "只剩裁剪框本身跟着这个开关");
  assert.strictEqual((html.match(/<span class="ocr-tool-text">/g) || []).length, 5, "每个工具都配一句文字说明");
  assert.ok(html.indexOf('<p class="ocr-editor-tip" x-text="ocrEditorTip">') >= 0, "操作说明常驻，跟着状态换文案");
  assert.strictEqual((html.match(/x-for="h in ocrCropHandles"/g) || []).length, 1);
  assert.strictEqual(api.OCR_CROP_HANDLES.length, 8, "四角 + 四边");
  ["nw", "n", "ne", "w", "e", "sw", "s", "se"].forEach((h) => {
    assert.ok(api.OCR_CROP_HANDLES.indexOf(h) >= 0, `缺了 ${h} 把手`);
    assert.ok(css.indexOf(".ocr-crop-h.is-" + h) >= 0, `样式里缺了 ${h} 把手`);
  });

  // Esc：编辑器在最上层，按一次只该关它
  assert.strictEqual((html.match(/!ocrViewerOpen &&/g) || []).length, 3,
    "上传弹窗 / 配对弹窗 / 识别弹窗的 Esc 都要让开编辑器");

  // 样式：触摸手势自己吃（不然拖动会变成页面滚动），把手在触屏上加大
  assert.ok(/\.ocr-editor-frame\s*\{[^}]*touch-action:\s*none/.test(css));
  assert.ok(/\.ocr-editor-stage\s*\{[^}]*touch-action:\s*none/.test(css));
  assert.ok(/@media \(pointer: coarse\)\s*\{[^}]*\.ocr-crop-h\s*\{\s*--crop-h/.test(css), "触屏把手要更大");
  assert.ok(css.indexOf(".ocr-crop-h::after") >= 0, "把手的触摸热区要往外扩");
  assert.strictEqual(css.indexOf(".ocr-viewer"), -1, "旧的纯查看器样式不再留残渣");
  assert.strictEqual(css.indexOf(".ocr-editor-bar"), -1, "底部那排按钮已经撤掉，改成顶部居中");
  assert.strictEqual(/\.ocr-editor-frame\s*\{[^}]*background:/.test(css), false,
    "画面框不铺白底：尺寸没算上时会露出一块跟图片错位的白盒子");
  // 实时预览靠这一层裁掉框外：溢出必须藏住，并且要有形变让人看出结果
  assert.ok(/\.ocr-editor-window\s*\{[^}]*overflow:\s*hidden/.test(css), "画面窗口要裁掉框外的部分");
  assert.ok(/\.ocr-editor-frame\.is-morphing[\s\S]{0,200}transition:\s*width/.test(css), "退出裁剪要形变");
  // Tailwind Preflight（@layer base）里有 img, video { max-width: 100% }：不在这张图上解开，
  // 窗口一小图片就被压扁，预览看着像错位（这条是在浏览器里量出来才发现的）。
  // 注释里就带着带花括号的代码片段，先把注释去掉再按规则体匹配
  const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(/\.ocr-editor-img\s*\{[^}]*max-width:\s*none/.test(cssBare), "编辑器里的图片必须允许比窗口大");

  // 悬停只在真有指针设备时给：触屏上 :hover 会粘住，点完一直亮着
  assert.strictEqual((css.match(/\.ocr-tool[^\s{]*:hover/g) || []).length, 2);
  assert.ok(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\.ocr-tool:hover/.test(css),
    "触屏不给 hover 反馈，只有鼠标/触控板才亮");
  assert.ok(/\.ocr-editor-tools\s*\{[^}]*justify-content:\s*center/.test(css), "工具条居中");
  assert.ok(/\.ocr-tools-pill\s*\{[^}]*border-radius:\s*999px/.test(css), "胶囊只包住按钮本身，不拉满整行");
  assert.ok(/@media \(min-width: 768px\)\s*\{[\s\S]*?\.ocr-editor-head\s*\{\s*display:\s*grid/.test(css),
    "够宽就一行三列，工具条真正居中");
  assert.ok(/\.ocr-tool-text\s*\{\s*display:\s*none/.test(css), "窄屏先只有图标");
  assert.ok(/@media \(min-width: 640px\)\s*\{\s*\.ocr-tool-text\s*\{\s*display:\s*inline/.test(css),
    "宽度够了就给图标配文字说明");
});

/* ---------------- 运行 ---------------- */

(async () => {
  let passed = 0;
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`✓ ${item.name}`);
    } catch (error) {
      console.error(`✗ ${item.name}`);
      console.error(`  ${error && error.message}`);
    }
  }
  console.log(`\n${passed}/${cases.length} 通过`);
  process.exit(passed === cases.length ? 0 : 1);
})();
