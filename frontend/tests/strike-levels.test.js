/* AAII v5.0.1 打击级别评级（AA 智能指数 → 分数段映射）用例。
   守三件事：
   1. 边界映射与浮点分四舍五入；
   2. 未评级语义：留空、非数字、低于 6 分一律不出评级；
   3. 三端对照表一致：管理端、用户端与 Agent 端必须逐字段相同。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { test } = require("node:test");

const USER_SRC = fs.readFileSync(path.resolve(__dirname, "..", "script.js"), "utf8");
const ADMIN_SRC = fs.readFileSync(path.resolve(__dirname, "..", "..", "admin-frontend", "script.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");

/* 组件里有裸 matchMedia 调用（WIDE_MQ 等），Node 没有全局 matchMedia，先补桩 */
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

function loadUserSide() {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    USER_SRC + "\nreturn { nbx, AAII_V501_RATING_TIERS, AA_STRIKE_LEVELS, aaLevelOf };"
  );
  return factory(
    makeWindow(), undefined, undefined, undefined, { hostname: "test" }, undefined,
    undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined
  );
}

function loadAdminSide() {
  const env = { URLSearchParams, AbortController };
  vm.createContext(env);
  vm.runInContext(
    ADMIN_SRC + "\n;__out = { AAII_V501_RATING_TIERS, AA_STRIKE_LEVELS, aaLevelOf, app: adminApp() };",
    env,
  );
  return env.__out;
}

test("AAII v5.0.1 区间边界与浮点分四舍五入", () => {
  const { aaLevelOf } = loadUserSide();
  const cases = [
    [5.5, 1], [6, 1], [22, 1], [22.5, 2], [23, 2], [33, 2],
    [33.5, 3], [34, 3], [43, 3], [43.5, 4], [44, 4], [51, 4],
    [52, 5], [58, 5], [58.5, 6], [59, 6], [65, 6],
  ];
  for (const [aa, lv] of cases) {
    const level = aaLevelOf(aa);
    assert.ok(level, `AA ${aa} 应映射到打击级别`);
    assert.equal(level.lv, lv, `AA ${aa} 应为 Lv.${lv}，实得 ${level && level.name}`);
  }
  // 65.5 四舍五入为 66，和 66 分及以上一样标注「未知」（未知的未知）
  for (const aa of [65.5, 66, 87.5, 120]) {
    const level = aaLevelOf(aa);
    assert.ok(level, `AA ${aa} 应落入「未知」档`);
    assert.equal(level.name, "未知", `AA ${aa} 应标注「未知」`);
    assert.equal(level.lv, 7);
  }
});

test("未评级：留空、非数字、低于 6 分都不出评级", () => {
  const { aaLevelOf } = loadUserSide();
  for (const aa of [null, undefined, "", "abc", NaN, 5.4, 5, 0]) {
    assert.equal(aaLevelOf(aa), null, `AA ${String(aa)} 应为未评级`);
  }
  // 数字字符串照常映射（表单输入常见形态）
  assert.equal(aaLevelOf("34").lv, 3);
});

test("用户端徽章与悬停文案", () => {
  const { nbx } = loadUserSide();
  const c = nbx();
  assert.equal(c.strikeBadgeText(53), "光粒级");
  assert.ok(c.strikeBadgeStyle(53).includes("#7c3aed"));
  const tip = c.strikeTip(53);
  assert.ok(tip.includes("AA 智能指数 53"));
  assert.ok(tip.includes("光粒级"));
  // 66 分及以上：「未知」档照常出徽章
  assert.equal(c.strikeBadgeText(66), "未知");
  assert.ok(c.strikeTip(66).includes("66 分及以上"));
  // 未评级：无文案、无样式，模板里 x-show=false 连角标一起不渲染
  assert.equal(c.strikeBadgeText(null), "");
  assert.equal(c.strikeBadgeStyle(null), "");
  assert.equal(c.strikeTip(null), "");
});

test("科普弹窗入口：打开时收起模型菜单与重试弹窗", () => {
  const { nbx } = loadUserSide();
  const c = nbx();
  c.modelMenuOpen = true;
  c.retryModelOpen = true;
  c.openStrikeGuide();
  assert.equal(c.strikeGuideOpen, true);
  assert.equal(c.modelMenuOpen, false);
  assert.equal(c.retryModelOpen, false);
  c.closeStrikeGuide();
  assert.equal(c.strikeGuideOpen, false);
});

test("管理端说明标签：实时映射与悬停提示", () => {
  const { app } = loadAdminSide();
  assert.equal(app.aaLevelLabel(40), "原子弹级");
  assert.equal(app.aaLevelLabel(null), "未评级");
  assert.equal(app.aaLevelLabel(5.4), "未评级");
  assert.equal(app.aaLevelLabel(87), "未知");
  const tip = app.aaLevelTip(40);
  assert.ok(tip.includes("AA 智能指数 40"));
  assert.ok(tip.includes("34–43"));
  assert.ok(tip.includes("原子弹级"));
  assert.ok(app.aaLevelTip(null).includes("未评级"));
  assert.ok(app.aaLevelTip(5.4).includes("低于 6 分"));
  const unknownTip = app.aaLevelTip(66);
  assert.ok(unknownTip.includes("未知"));
  assert.ok(unknownTip.includes("66 分及以上"));
});

test("三端 AAII v5.0.1 对照表逐字段一致", async () => {
  const user = loadUserSide();
  const admin = loadAdminSide();
  const agent = await import(
    pathToFileURL(path.resolve(__dirname, "..", "agent", "rating.mjs")).href
  );
  // 两侧各自在独立 realm 里构造对象，原型不同会让 deepStrictEqual 误报，按 JSON 比
  assert.equal(JSON.stringify(user.AA_STRIKE_LEVELS), JSON.stringify(admin.AA_STRIKE_LEVELS));
  assert.equal(JSON.stringify(user.AA_STRIKE_LEVELS), JSON.stringify(agent.AA_STRIKE_LEVELS));
  assert.equal(JSON.stringify(user.AAII_V501_RATING_TIERS), JSON.stringify(admin.AAII_V501_RATING_TIERS));
  assert.equal(JSON.stringify(user.AAII_V501_RATING_TIERS), JSON.stringify(agent.AAII_V501_RATING_TIERS));
  assert.ok(!JSON.stringify(user.AAII_V501_RATING_TIERS).includes("归零者"));
  assert.equal(user.AA_STRIKE_LEVELS.length, 7);
});

test("Agent 模型选择器沿用同一份打击级别表", async () => {
  const agent = await import(
    pathToFileURL(path.resolve(__dirname, "..", "agent", "rating.mjs")).href
  );
  const user = loadUserSide();
  assert.deepEqual(
    JSON.parse(JSON.stringify(agent.AA_STRIKE_LEVELS)),
    JSON.parse(JSON.stringify(user.AA_STRIKE_LEVELS)),
  );
  for (const aa of [null, "", 5, 22, 23, 40, 55, 65, 65.5, 66]) {
    const left = agent.aaLevelOf(aa);
    const right = user.aaLevelOf(aa);
    assert.equal(left && left.name, right && right.name, `AA ${String(aa)} 不一致`);
  }
});

test("科普弹窗同步 AAII v5.0.1 文案", () => {
  const expected = [
    "AAII v5.0.1 映射标准",
    "AA 智能指数 v5.0.1",
    "三五分的差距即代表代际跨越",
    "就备考而言，23 分以上的模型已是降维配置",
    "Lv.3 原子弹级（34 分）及以上模型",
    "低于 6 分（未达评级线）",
    "66 分及以上为何标注「未知」",
    "同版本 AA 指数内永不贬值",
  ];
  for (const text of expected) {
    assert.ok(INDEX_HTML.includes(text), `弹窗缺少文案：${text}`);
  }
  assert.ok(!INDEX_HTML.includes("两三分的差距"));
  assert.ok(!INDEX_HTML.includes("低于 17 分（未达评级线）"));
  assert.ok(!INDEX_HTML.includes("59 分及以上为何标注"));
});
