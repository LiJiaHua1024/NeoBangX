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
      + " OCR_MODES: OCR_MODES, ocrModeForTool: ocrModeForTool, ocrModeCanChoose: ocrModeCanChoose };"
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
