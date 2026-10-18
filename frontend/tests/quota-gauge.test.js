/* 额度显示仪 getter 的回归测试
   运行：node frontend/tests/quota-gauge.test.js
   守的是「环尾将被扣掉的那一段」的几何口径：满额、1/20、免费模型、迁移未选题、
   额度不足都必须给出可画的段。曾经按纯比例画弧：满额时长度被夹成 0、1/100 不足
   1px，用户完全看不见——这里把「永远有一段可见的弧」钉住。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const SOURCE = path.join(__dirname, "..", "script.js");
const RING_C = 2 * Math.PI * 10.5;

/* 从 script.js 抽出额度显示仪的 getter 区块，在最小环境里跑。
   整份脚本依赖 Alpine 与 DOM，没法整体加载。 */
function loadGauge() {
  const src = fs.readFileSync(SOURCE, "utf8");
  const start = src.indexOf("    /* ============ 额度显示仪 ============ */");
  const end = src.indexOf("    /* 不扣次数时的提示文案", start);
  assert.ok(start >= 0 && end > start, "脚本结构变了：找不到额度显示仪 getter 区块");
  const body = src.slice(start, end).replace(/^    /gm, "");
  return vm.runInNewContext("({" + body + "})", { QUOTA_RING_C: RING_C });
}

const GAUGE = loadGauge();

function view({ quota = 20, remaining = 20, unlimited = false, free = false, ocr = false, migration = false, causes = 0, charge = null } = {}) {
  return Object.assign(Object.create(GAUGE), {
    authUser: { quota, remaining, is_unlimited: unlimited, code: "NBXU-TEST" },
    isAuthenticated: true,
    streaming: false,
    migration: { generating: false },
    models: [{ id: "m", is_free: free }],
    selectedModel: "m",
    isFreeModel() { return free; },
    isOcrTool: ocr,
    isMigrationTool: migration || causes > 0,
    migrationSelectedCauses: Array.from({ length: causes }, (_, i) => ({ id: i })),
    migrationChargeUnits: charge == null ? 1 : charge,
  });
}

function burnLen(v) {
  // dasharray: "0 <start> <len> <C>"
  return Number(v.quotaBurnDash.split(" ")[2]);
}

test("满额 10/10：扣 1 次 = 环上 10% 的段，长度绝不为 0", () => {
  const v = view({ quota: 10, remaining: 10 });
  assert.equal(v.quotaBurnPct, 10);
  assert.equal(v.quotaBurnStart, 90);
  assert.equal(v.quotaBurnOn, true);
  assert.ok(burnLen(v) > RING_C * 0.09, "满额时也必须画出可见的一段");
});
test("满额 20/20：按最小可见长度兜底，仍有段可画", () => {
  const v = view();
  assert.equal(v.quotaBurnPct, 6);
  assert.ok(burnLen(v) > 3.5);
});
test("1/20：段长不超过当前剩余弧，且贴住起点", () => {
  const v = view({ remaining: 1 });
  assert.equal(v.quotaPct, 5);
  assert.equal(v.quotaBurnPct, 5);
  assert.equal(v.quotaBurnStart, 0);
  assert.equal(v.quotaLow, true);
});
test("免费模型与识别：不扣额度，不画段", () => {
  for (const v of [view({ free: true }), view({ ocr: true })]) {
    assert.equal(v.quotaChargeUnits, 0);
    assert.equal(v.quotaBurnPct, 0);
    assert.equal(v.quotaBurnOn, false);
    assert.match(v.quotaTip, /本次不消耗额度/);
  }
});
test("额度为 0：不画段，环进入耗尽态", () => {
  const v = view({ remaining: 0 });
  assert.equal(v.quotaBurnPct, 0);
  assert.equal(v.quotaEmpty, true);
  assert.match(v.quotaTip, /额度不足/);
});
test("迁移：未勾错因不画段，勾了按题数换算", () => {
  assert.equal(view({ remaining: 18, migration: true }).quotaBurnPct, 0);
  assert.match(view({ remaining: 18, migration: true }).quotaTip, /勾选错因后显示本次消耗/);
  assert.equal(view({ remaining: 18, causes: 6, charge: 3 }).quotaBurnPct, 15);
});
test("无限额度：不画段，整环填满", () => {
  const v = view({ quota: -1, unlimited: true });
  assert.equal(v.quotaBurnPct, 0);
  assert.equal(v.quotaPct, 100);
  assert.equal(v.quotaTip, "无限额度");
});
test("生成中不画段（扣费正在进行，别预测已经发生的事）", () => {
  const v = view({ quota: 10, remaining: 10 });
  v.streaming = true;
  assert.equal(v.quotaBurnOn, false);
});
