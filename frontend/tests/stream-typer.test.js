/* 流式打字机（缓存 + 近匀速放行 + 曲线变速 + 淡入）用例
   运行：node frontend/tests/stream-typer.test.js

   不动浏览器：把 script.js 装进 Function 拿到真正的打字机与淡入工具，
   帧时间戳手动注入、不依赖真实时钟。守的是：
   - 成簇到达先缓存、再近乎匀速放出：不整簇跳变，单帧推进有封顶
   - 曲线变速：积压骤增骤减时速率是渐变的，不跳档；慢速下小数余量逐字均匀推进
   - 自然完成的余量平滑快放（不瞬跳），零头直接给全；reset 对齐全文并停表
   - 「减少动效」下不做逐字动画，直接放完
   - 淡入段：最近上屏的文字带负 animation-delay 淡入（重建后曲线不断），
     老文字不带；终稿无淡入（不做打字光标，文字自己长出来就是效果）
   - 组件接线：liveOutputText 只出已上屏前缀；推理真值不动、定稿即整段可见
*/

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

/* matchMedia 替身：窄屏判定照旧，reduced 开关按需（「减少动效」用例专用） */
function makeWindow({ reduced = false } = {}) {
  const base = {
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  return {
    matchMedia: (query) => ({
      ...base,
      media: query,
      matches: reduced && /prefers-reduced-motion/.test(String(query)),
    }),
  };
}

/* rAF 替身：真浏览器里异步，替身也得异步（打字机自己会把帧停在指针到位时） */
const rafStub = (fn) => setTimeout(() => fn(0), 0);

function loadFlow({ reduced = false } = {}) {
  // 组件里用裸 matchMedia（finePointer / touchPrimary / 减少动效判定），Node 无此全局
  const mqStub = (query) => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    media: query,
    matches: reduced && /prefers-reduced-motion/.test(String(query)),
  });
  mqStub._nbx = true;
  global.matchMedia = mqStub;

  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx: nbx, streamFlow: {"
      + " createStreamTyper: createStreamTyper,"
      + " renderMdStreamPaced: renderMdStreamPaced, wrapFadeBands: wrapFadeBands,"
      + " prefersReducedMotion: prefersReducedMotion,"
      + " TYPER_BASE_CPS: TYPER_BASE_CPS, TYPER_MAX_CPS: TYPER_MAX_CPS,"
      + " TYPER_CATCHUP_S: TYPER_CATCHUP_S, TYPER_SPEED_TAU: TYPER_SPEED_TAU,"
      + " TYPER_FADE_MS: TYPER_FADE_MS, TYPER_FINISH_SNAP: TYPER_FINISH_SNAP } };"
  );
  const api = factory(
    makeWindow({ reduced }), undefined, makeStorage(), undefined, { origin: "http://localhost:8000", hostname: "localhost" },
    undefined, { now: () => Date.now() }, rafStub, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  return api;
}

function loadComponent() {
  const api = loadFlow();
  const c = api.nbx();
  // 界面副作用替身：只记录发生了什么，不碰 DOM
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  return { api, c };
}

/* 按 60fps 逐帧驱动，返回每帧的推进量 */
function drive(t, frames, start = 0) {
  const steps = [];
  let now = start;
  let prev = t.shown;
  for (let i = 0; i < frames; i += 1) {
    t.tick(now);
    steps.push(t.shown - prev);
    prev = t.shown;
    now += 16;
  }
  return steps;
}

/* ---------------- 缓存 + 近匀速放行 ---------------- */

test("成簇到达先缓存、再近乎匀速放出：不整簇跳变，单帧有封顶", () => {
  const { streamFlow } = loadFlow();
  const renders = [];
  const t = streamFlow.createStreamTyper((shown, marks) => renders.push({ shown, marks }));

  t.grow(300);                       // 一簇 300 字一次到达
  const steps = drive(t, 20);        // 之后 320ms
  const maxStep = Math.ceil((streamFlow.TYPER_MAX_CPS * 16) / 1000) + 1;
  steps.forEach((s, i) => assert.ok(s <= maxStep, `第 ${i} 帧推进 ${s} 超出封顶 ${maxStep}`));
  assert.ok(t.shown >= 10 && t.shown <= 120, `320ms 只该放出一小部分，实际 ${t.shown}`);
  assert.ok(t.shown < 300, "绝不整簇跳变");
  assert.ok(renders.length >= 3, "放行是连续上屏的（中途多次渲染）");
});

test("曲线变速：积压骤增时速率渐变爬升，不跳档", () => {
  const { streamFlow } = loadFlow();
  const t = streamFlow.createStreamTyper(() => {});

  t.grow(2);
  drive(t, 6);                       // 基准速度巡航
  t.grow(600);                       // 积压骤增
  const steps = drive(t, 36, 96);

  assert.ok(steps[0] <= 3, `骤增第一帧不该冲起来，实际 ${steps[0]}`);
  assert.ok(Math.max(...steps.slice(18)) >= 4, "之后速率应渐变升上来");
  const maxStep = Math.ceil((streamFlow.TYPER_MAX_CPS * 16) / 1000) + 1;
  steps.forEach((s, i) => assert.ok(s <= maxStep, `第 ${i} 帧推进 ${s} 超出封顶`));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(Math.abs(steps[i] - steps[i - 1]) <= 2, `第 ${i} 帧速率跳档：${steps[i - 1]} -> ${steps[i]}`);
  }
});

test("慢速逐字均匀：小数余量累计推进，不一帧 0 字一帧 2 字地抖", () => {
  const { streamFlow } = loadFlow();
  const t = streamFlow.createStreamTyper(() => {});

  t.grow(12);
  const steps = drive(t, 24);
  assert.ok(steps.every((s) => s <= 1), `基准速度下单帧最多 1 字，实际 ${steps.join(",")}`);
  assert.strictEqual(t.shown, 12, "12 字在基准速度下逐字放完");
});

/* ---------------- 收尾 ---------------- */

test("自然完成收尾：零头直接给全，大段平滑快放不瞬跳", () => {
  const { streamFlow } = loadFlow();

  // 零头：不必再走动画
  let renders = 0;
  const t1 = streamFlow.createStreamTyper(() => { renders += 1; });
  t1.grow(5);
  drive(t1, 2);
  t1.finish();
  assert.strictEqual(t1.shown, 5, "零头直接给全");
  assert.ok(renders >= 1, "收尾要渲染一次干净全文");

  // 大段：快放但是动画，不瞬跳
  const t2 = streamFlow.createStreamTyper(() => {});
  t2.grow(600);
  drive(t2, 10);
  t2.finish();
  t2.tick(200);
  assert.ok(t2.shown < 600, "收尾不瞬跳");
  drive(t2, 120, 216);
  assert.strictEqual(t2.shown, 600, "余量最终放完");
  assert.strictEqual(t2.finishing, false, "放完后收尾标记清掉");
});

test("reset 对齐全文并停表：之后 tick 不再渲染", () => {
  const { streamFlow } = loadFlow();
  let renders = 0;
  const t = streamFlow.createStreamTyper(() => { renders += 1; });

  t.grow(100);
  drive(t, 5);
  t.reset(100);
  assert.strictEqual(t.shown, 100, "指针对齐全文（残文也完整可见）");
  const r = renders;
  t.tick(500);
  assert.strictEqual(renders, r, "停表后不再渲染");
});

test("「减少动效」下不做逐字动画：grow 即放完、无淡入段", () => {
  const { streamFlow } = loadFlow({ reduced: true });
  const renders = [];
  const t = streamFlow.createStreamTyper((shown, marks) => renders.push({ shown, marks }));

  t.grow(50);
  assert.strictEqual(t.shown, 50, "不做逐字放行");
  assert.strictEqual(renders.length, 1, "同步渲染一次到位");
  assert.deepStrictEqual(renders[0].marks, [], "不做淡入段");
});

/* ---------------- 淡入段 ---------------- */

test("淡入段：新段带年龄、只往前走，老段淡出窗口后不再带", () => {
  const { streamFlow } = loadFlow();
  const paints = [];
  const t = streamFlow.createStreamTyper((shown, marks) =>
    paints.push({ shown, marks: marks.map((m) => ({ ...m })) })
  );

  t.grow(1000);
  drive(t, 60);                    // ≈1s
  const mid = paints.filter((p) => p.marks.length > 0);
  assert.ok(mid.length >= 5, "流式中要有淡入段");
  mid.forEach((p, i) => {
    p.marks.forEach((m, j) => {
      assert.ok(m.ageMs >= 0 && m.ageMs < streamFlow.TYPER_FADE_MS, `段年龄出窗：${m.ageMs}`);
      if (j > 0) assert.ok(m.at > p.marks[j - 1].at, "段起点递增");
    });
    if (i > 0) {
      const prevLast = mid[i - 1].marks[mid[i - 1].marks.length - 1].at;
      assert.ok(p.marks[p.marks.length - 1].at >= prevLast, "段只往前走");
    }
    // 最近一段永远是刚上屏的（age 0）
    assert.strictEqual(p.marks[p.marks.length - 1].ageMs, 0, "最新段刚出现");
  });
});

test("淡入渲染：最近段包负延迟淡入 span，老文字不包", () => {
  const { renderMdStreamPaced, TYPER_FADE_MS } = loadFlow().streamFlow;

  const html = renderMdStreamPaced("一二三四五", 5, [{ at: 2, ageMs: 100 }], true);
  assert.ok(
    /一二<span class="tw-fade" style="animation-delay:-100ms">三四五<\/span>/.test(html),
    `老文字不包、新段带负延迟淡入，实际 ${html}`
  );

  const fresh = renderMdStreamPaced("一二三", 3, [{ at: 0, ageMs: 0 }], true);
  assert.ok(/tw-fade"[^>]*>一二三<\/span>/.test(fresh), "整段都是新文字时全部淡入");

  const old = renderMdStreamPaced("一二三四五", 5, [{ at: 2, ageMs: TYPER_FADE_MS + 10 }], true);
  assert.ok(!old.includes("tw-fade"), "淡出窗口的老段不再包");

  const done = renderMdStreamPaced("你好世界", 4, [], false);
  assert.ok(!done.includes("tw-fade"), "终稿无淡入");

  assert.strictEqual(renderMdStreamPaced("", 0, [], true), "", "等待期不渲染任何东西");
});

test("块间空白不包淡入：尾部结构保持完整", () => {
  const { wrapFadeBands } = loadFlow().streamFlow;

  // 真 marked 会在最后一个块后补 \n（tail 文本节点）：不能被包成 span，
  // 否则尾部凭空多一段空壳
  const html = wrapFadeBands("<p>a\u2063b</p>\n", [50]);
  assert.ok(html.endsWith("</p>\n"), `尾部保持 </p> 结构，实际 ${JSON.stringify(html)}`);
  assert.ok(/<span class="tw-fade"[^>]*>b<\/span>/.test(html), "新文字照常淡入");
});

test("淡入段边界不切开 Markdown 记号：标题、加粗、空行解析永远稳定", () => {
  const { renderMdStreamPaced } = loadFlow().streamFlow;

  // 边界落在 "## " 记号上：自动后挪，标题不闪成字面 "##"
  const heading = renderMdStreamPaced("## 一、语", 6, [{ at: 2, ageMs: 50 }, { at: 4, ageMs: 20 }], true);
  assert.ok(heading.includes("<h2"), `标题语法保持完整，实际 ${heading}`);
  assert.ok(!heading.includes("##"), "不显示字面 ##");

  // 边界落在 ** 加粗记号上：加粗保持完整
  const bold = renderMdStreamPaced("前**粗**后", 8, [{ at: 2, ageMs: 20 }], true);
  assert.ok(bold.includes("<strong>"), `加粗语法保持完整，实际 ${bold}`);
  assert.ok(!bold.includes("**"), "不显示字面 **");

  // 边界落在空行中间：不能把两个块粘成一块
  const blocks = renderMdStreamPaced("甲段\n\n乙段", 6, [{ at: 3, ageMs: 20 }], true);
  assert.strictEqual((blocks.match(/<p>/g) || []).length, 2, `两个块保持分开，实际 ${blocks}`);
});

/* ---------------- 组件接线 ---------------- */

test("liveOutputText：流式中只出已上屏前缀，收尾给全文；真值 output 不受影响", () => {
  const { c } = loadComponent();
  c.currentTool = { id: "1", name: "工具一" };
  c.output = "这是一段正在逐字放出的流式文本内容";
  c.streaming = true;
  c.outTyper().reset(0);
  c.outTyper().grow(c.output.length);
  assert.strictEqual(c.liveOutputText(), "", "帧循环还没动，一个字都还没上屏");

  const typer = c._typers.out;
  typer.tick(0);
  typer.tick(16);
  const mid = c.liveOutputText();
  assert.ok(mid.length > 0 && mid.length < c.output.length, `中途是前缀，实际 ${mid.length} 字`);
  assert.strictEqual(c.output.length, 17, "真值照常按到达写入，不受上屏节奏影响");

  typer.reset(c.output.length);
  assert.strictEqual(c.liveOutputText(), c.output, "收尾对齐全文");
  c.streaming = false;
  assert.strictEqual(c.liveOutputText(), c.output, "流式结束给全文");
});

test("doRender 流式中带淡入、收尾后是干净全文", () => {
  const { c } = loadComponent();
  c.currentTool = { id: "1", name: "工具一" };
  c.output = "一二三四五六七八九十";
  c.streaming = true;
  c.outTyper().reset(0);
  c.scheduleRender();

  const typer = c._typers.out;
  typer.tick(0);
  typer.tick(16);
  typer.tick(32);
  assert.ok(c.rendered.includes("tw-fade"), "新文字带淡入");
  assert.ok(c.rendered.includes("一"), "前缀已上屏");
  assert.ok(!c.rendered.includes("十"), "未放行的尾部还没上屏");

  c.streaming = false;
  typer.reset(c.output.length);
  c._outputDirty = true;
  c.doRender();
  assert.ok(!c.rendered.includes("tw-fade"), "终稿干净");
  assert.ok(c.rendered.includes("十"), "终稿是全文");
});

test("推理过程：真值按到达写入，显示逐字放行，定稿即整段可见", () => {
  const { c } = loadComponent();
  c.resetReasoning();
  c.appendReasoning("这是一段比较长的思考内容", 3);
  assert.strictEqual(c.reasoning, "这是一段比较长的思考内容", "真值不动");

  const typer = c._typers.reason;
  typer.tick(0);
  typer.tick(16);
  const mid = c.reasoningShown;
  assert.ok(mid.length > 0 && mid.length < c.reasoning.length, `思考文字也在逐字放行，实际 ${mid.length} 字`);

  c.finishReasoningOnToken();
  assert.strictEqual(c.reasoningDone, true);
  assert.strictEqual(c.reasoningShown, c.reasoning, "定稿 = 停止打字，整段立即可见");
});