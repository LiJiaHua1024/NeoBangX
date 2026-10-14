/* 打击级别评级（AA 智能指数 → 打击级别区间映射）用例。
   守三件事：
   1. 边界映射：35/36、42/43、47/48、51/52、54/55、58/59 的档位归属；
   2. 未评级语义：留空、非数字、低于 17 分一律不出评级；
   3. 两端对照表一致：管理端与用户端的 AA_STRIKE_LEVELS 必须逐字段相同。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const USER_SRC = fs.readFileSync(path.resolve(__dirname, "..", "script.js"), "utf8");
const ADMIN_SRC = fs.readFileSync(path.resolve(__dirname, "..", "..", "admin-frontend", "script.js"), "utf8");

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
    USER_SRC + "\nreturn { nbx, AA_STRIKE_LEVELS, aaLevelOf };"
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
  vm.runInContext(ADMIN_SRC + "\n;__out = { AA_STRIKE_LEVELS, aaLevelOf, app: adminApp() };", env);
  return env.__out;
}

test("区间边界：两分之差就是档位之差", () => {
  const { aaLevelOf } = loadUserSide();
  const cases = [
    [17, 1], [35, 1], [36, 2], [42, 2], [43, 3], [47, 3],
    [48, 4], [51, 4], [52, 5], [54, 5], [55, 6], [58, 6],
    [58.5, 6], // 小数向下取整归档：58.5 仍属二向箔级
  ];
  for (const [aa, lv] of cases) {
    const level = aaLevelOf(aa);
    assert.ok(level, `AA ${aa} 应映射到打击级别`);
    assert.equal(level.lv, lv, `AA ${aa} 应为 Lv.${lv}，实得 ${level && level.name}`);
  }
  // 59 分及以上：不设级别，标注「未知」（未知的未知）
  for (const aa of [59, 87.5, 120]) {
    const level = aaLevelOf(aa);
    assert.ok(level, `AA ${aa} 应落入「未知」档`);
    assert.equal(level.name, "未知", `AA ${aa} 应标注「未知」`);
    assert.equal(level.lv, 0);
  }
});

test("未评级：留空、非数字、低于 17 分都不出评级", () => {
  const { aaLevelOf } = loadUserSide();
  for (const aa of [null, undefined, "", "abc", NaN, 16, 0]) {
    assert.equal(aaLevelOf(aa), null, `AA ${String(aa)} 应为未评级`);
  }
  // 数字字符串照常映射（表单输入常见形态）
  assert.equal(aaLevelOf("43").lv, 3);
});

test("用户端徽章与悬停文案", () => {
  const { nbx } = loadUserSide();
  const c = nbx();
  assert.equal(c.strikeBadgeText(53), "光粒级");
  assert.ok(c.strikeBadgeStyle(53).includes("#7c3aed"));
  const tip = c.strikeTip(53);
  assert.ok(tip.includes("AA 智能指数 53"));
  assert.ok(tip.includes("光粒级"));
  // 59 分及以上：「未知」档照常出徽章
  assert.equal(c.strikeBadgeText(59), "未知");
  assert.ok(c.strikeTip(59).includes("59 分及以上"));
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
  assert.equal(app.aaLevelLabel(45), "原子弹级");
  assert.equal(app.aaLevelLabel(null), "未评级");
  assert.equal(app.aaLevelLabel(12), "未评级");
  assert.equal(app.aaLevelLabel(87), "未知");
  const tip = app.aaLevelTip(45);
  assert.ok(tip.includes("AA 智能指数 45"));
  assert.ok(tip.includes("43–47"));
  assert.ok(tip.includes("原子弹级"));
  assert.ok(app.aaLevelTip(null).includes("未评级"));
  assert.ok(app.aaLevelTip(12).includes("低于 17 分"));
  const unknownTip = app.aaLevelTip(59);
  assert.ok(unknownTip.includes("未知"));
  assert.ok(unknownTip.includes("59 分及以上"));
});

test("两端对照表逐字段一致", () => {
  const user = loadUserSide();
  const admin = loadAdminSide();
  // 两侧各自在独立 realm 里构造对象，原型不同会让 deepStrictEqual 误报，按 JSON 比
  assert.equal(JSON.stringify(user.AA_STRIKE_LEVELS), JSON.stringify(admin.AA_STRIKE_LEVELS));
  // 归零者级已废止：59 分及以上为「未知」，对照表里不许再出现它
  assert.ok(!JSON.stringify(user.AA_STRIKE_LEVELS).includes("归零者"));
  assert.equal(user.AA_STRIKE_LEVELS.length, 7);
});