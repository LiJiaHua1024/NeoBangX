/* nbx-versions.js 回答版本容器用例
   运行：node frontend/tests/nbx-versions.test.js
   不依赖任何测试框架，断言失败即非零退出。

   这里守的是「重新生成不丢旧结果」这条承诺的底座：投影字段与活动版本必须始终
   一致（否则界面切了版本正文却没变）、活动版本永远不能被淘汰（否则切回自己
   什么都没有）、零产出的失败不能占版本格（否则切换器里出现一格空白）。 */

const assert = require("assert");
const path = require("path");
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

let passed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

/* 一条单版本记录（版本化之前的形状），全部用例都从这里出发 */
function plain(opts) {
  return Object.assign({
    id: "h1",
    input: "题目",
    output: "第一版正文",
    model: "model-a",
    partial: false,
    error: "",
    createdAt: 1000,
    updatedAt: 2000,
  }, opts || {});
}

/* 追加 n 版（第 i 版正文为 "v{i}"），返回 item */
function grow(item, n) {
  for (let i = 2; i <= n; i += 1) {
    V.append(item, { output: "v" + i, model: "model-a", at: 1000 + i });
  }
  return item;
}

/* ---------------- 只读接口 ---------------- */

test("read：没有 versions 字段的记录返回 null，绝不凭空建容器", () => {
  const item = plain();
  assert.strictEqual(V.read(item), null);
  assert.strictEqual(item.versions, undefined);
});

test("read：过滤掉非法条目（无 id / 正文非字符串 / 正文为空）", () => {
  const item = plain({
    versions: [
      null,
      { output: "缺 id" },
      { id: "a" },
      { id: "b", output: "" },
      { id: "c", output: 42 },
      { id: "d", output: "好的" },
    ],
    activeVersionId: "d",
  });
  const list = V.read(item);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, "d");
});

test("count：无容器时正文非空算 1 版、正文为空算 0 版", () => {
  assert.strictEqual(V.count(plain()), 1);
  assert.strictEqual(V.count(plain({ output: "" })), 0);
  assert.strictEqual(V.count(null), 0);
});

test("active：无容器时按投影字段合成一份，不编造 id 与时间戳", () => {
  const v = V.active(plain({ output: "正文", model: "m", createdAt: 1000 }));
  assert.strictEqual(v.output, "正文");
  assert.strictEqual(v.model, "m");
  assert.strictEqual(v.at, 2000); // updatedAt 优先
  assert.strictEqual(v.id, "");
});

test("activeIndex：活动 id 认不出时回落到最新一版，而不是第一版", () => {
  const item = plain();
  grow(item, 3);
  item.activeVersionId = "不存在的 id";
  assert.strictEqual(V.activeIndex(item), 2);
  assert.strictEqual(V.active(item).output, "v3");
});

/* ---------------- 建容器与追加 ---------------- */

test("ensure：把现有正文固化成第一版，沿用记录的时间与归属", () => {
  const item = plain();
  const list = V.ensure(item);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].output, "第一版正文");
  assert.strictEqual(list[0].model, "model-a");
  assert.strictEqual(list[0].at, 2000);
  assert.strictEqual(item.activeVersionId, list[0].id);
});

test("ensure：正文为空时返回 null（没有可固化的旧版本）", () => {
  const item = plain({ output: "" });
  assert.strictEqual(V.ensure(item), null);
  assert.strictEqual(item.versions, undefined);
});

test("append：有旧正文时先播种再追加，活动版本变成新的", () => {
  const item = plain();
  V.append(item, { output: "第二版正文", model: "model-b", at: 3000 });
  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.versions[0].output, "第一版正文");
  assert.strictEqual(item.versions[1].output, "第二版正文");
  // 投影必须跟着活动版本走，否则界面上会出现「切了版本正文没变」
  assert.strictEqual(item.output, "第二版正文");
  assert.strictEqual(item.model, "model-b");
  assert.strictEqual(item.activeVersionId, item.versions[1].id);
});

test("append：零产出的失败不占版本格，记录一动不动", () => {
  const item = plain();
  grow(item, 2);
  const before = JSON.stringify(item);
  assert.strictEqual(V.append(item, { output: "", model: "m", error: "失败了" }), null);
  assert.strictEqual(V.append(item, {}), null);
  assert.strictEqual(JSON.stringify(item), before);
});

test("append：没有旧正文的失败记录重来成功时，容器直接从新版本起算", () => {
  const item = plain({ output: "" });
  V.append(item, { output: "第一次成功", model: "m", at: 5 });
  assert.strictEqual(item.versions.length, 1);
  assert.strictEqual(item.output, "第一次成功");
  assert.strictEqual(item.versions[0].id, item.activeVersionId);
});

test("append：条目键序固定（镜像层按同一顺序重建才算得出同一个摘要）", () => {
  const item = plain();
  V.append(item, { output: "二", model: "m", at: 9, partial: true, error: "e" });
  assert.deepStrictEqual(Object.keys(item.versions[1]), ["id", "output", "model", "at", "partial", "error"]);
});

/* ---------------- 上限与淘汰 ---------------- */

test("append：超过条数上限时淘汰最旧的非活动版本", () => {
  const item = plain();
  grow(item, V.LIMIT + 2); // 1 版播种 + LIMIT+1 次追加
  assert.strictEqual(item.versions.length, V.LIMIT);
  // 最新的那一版还在，最旧的几版被淘汰
  assert.strictEqual(item.versions[item.versions.length - 1].output, "v" + (V.LIMIT + 2));
  assert.ok(!item.versions.some((v) => v.output === "v2"));
});

test("prune：活动版本是最旧的一版时，淘汰从别的版本下手", () => {
  const item = plain();
  grow(item, V.LIMIT); // 顶到上限
  V.switchTo(item, item.versions[0].id); // 用户切回最早那一版（按 id 直达）
  const activeId = item.versions[0].id;
  // 模拟外来数据把容器顶过上限（导入与镜像合并都可能带来已超限的容器）
  item.versions.push(V.makeEntry({ output: "外来的", at: 1 }));
  V.prune(item);
  assert.strictEqual(item.versions.length, V.LIMIT);
  assert.ok(item.versions.some((v) => v.id === activeId), "活动版本被淘汰了");
});

test("append：字数上限触发淘汰，活动版本同样豁免", () => {
  const item = plain({ output: "x".repeat(400000) });
  V.append(item, { output: "y".repeat(400000), at: 2 });
  V.append(item, { output: "z".repeat(400000), at: 3 });
  // 1_000_000 上限：三版共 120 万，必须裁掉最旧的一版
  assert.strictEqual(item.versions.length, 2);
  assert.strictEqual(item.versions[item.versions.length - 1].output.slice(0, 1), "z");
  assert.ok(item.versions[0].output.slice(0, 1) !== "x", "最旧的版本应已被淘汰");
});

test("append：只剩活动版本时即便还超字数也不再删（宁可退回单版本记录）", () => {
  const item = plain({ output: "x".repeat(V.TOTAL_CHARS + 10) });
  V.switchTo(item, 0);
  V.append(item, { output: "y".repeat(V.TOTAL_CHARS + 10), at: 2 });
  // 活动版本是新追加的那一版，旧的超大版本被裁掉后只剩它一个
  assert.strictEqual(item.versions.length, 1);
  assert.strictEqual(item.output.slice(0, 1), "y");
});

/* ---------------- 切换与回填 ---------------- */

test("switchTo：相对位移切换并把该版本投影回记录", () => {
  const item = plain();
  grow(item, 3);
  const v = V.switchTo(item, -1);
  assert.strictEqual(v.output, "v2");
  assert.strictEqual(item.output, "v2");
  assert.strictEqual(item.activeVersionId, v.id);
  const back = V.switchTo(item, 1);
  assert.strictEqual(back.output, "v3");
  assert.strictEqual(item.output, "v3");
});

test("switchTo：越界与原地不动都返回 null，记录不变", () => {
  const item = plain();
  grow(item, 2);
  V.switchTo(item, -1); // 已在第一版
  const before = JSON.stringify(item);
  assert.strictEqual(V.switchTo(item, -1), null);
  assert.strictEqual(V.switchTo(item, 0), null);
  assert.strictEqual(V.switchTo(item, "不存在的 id"), null);
  assert.strictEqual(JSON.stringify(item), before);
  // 末尾同样钳制
  V.switchTo(item, 1);
  assert.strictEqual(V.switchTo(item, 1), null);
});

test("switchTo：可以按 id 直达某一版", () => {
  const item = plain();
  grow(item, 3);
  const target = item.versions[1];
  assert.strictEqual(V.switchTo(item, target.id).id, target.id);
  assert.strictEqual(item.output, "v2");
});

test("switchTo：没有容器时是空操作（单版本记录不因误点产生写入）", () => {
  const item = plain();
  assert.strictEqual(V.switchTo(item, -1), null);
  assert.strictEqual(item.versions, undefined);
  assert.strictEqual(item.output, "第一版正文");
});

test("switchTo：切到失败版本时错误与 partial 一并投影出去", () => {
  const item = plain();
  V.append(item, { output: "半成品", model: "m2", error: "生成失败", partial: true, at: 3 });
  V.switchTo(item, -1);
  assert.strictEqual(item.error, "");
  assert.strictEqual(item.partial, false);
  V.switchTo(item, 1);
  assert.strictEqual(item.error, "生成失败");
  assert.strictEqual(item.partial, true);
  assert.strictEqual(item.model, "m2");
});

test("syncActive：把就地更新的投影回填到活动版本（续写走这条路）", () => {
  const item = plain();
  grow(item, 2);
  // 续写：output 变长、模型归属刷新
  item.output = "v2 后面接着写的内容";
  item.model = "model-c";
  item.partial = true;
  V.syncActive(item);
  assert.strictEqual(item.versions[1].output, "v2 后面接着写的内容");
  assert.strictEqual(item.versions[1].model, "model-c");
  assert.strictEqual(item.versions[1].partial, true);
  // 旧版本不受影响
  assert.strictEqual(item.versions[0].output, "第一版正文");
});

test("syncActive：没有容器时是空操作（不制造版本）", () => {
  const item = plain();
  item.output = "改过了";
  assert.strictEqual(V.syncActive(item), null);
  assert.strictEqual(item.versions, undefined);
});

/* ---------------- 幂等与只读性 ---------------- */

test("read 纯只读：不改动入参，也不替换容器数组", () => {
  const item = plain();
  grow(item, 2);
  const ref = item.versions;
  const before = JSON.stringify(item);
  V.read(item);
  V.count(item);
  V.active(item);
  V.activeIndex(item);
  assert.strictEqual(item.versions, ref);
  assert.strictEqual(JSON.stringify(item), before);
});

test("规范化幂等：重复 ensure / prune 不再改变容器", () => {
  const item = plain();
  grow(item, V.LIMIT + 2);
  const snapshot = JSON.stringify(item.versions);
  V.ensure(item);
  V.prune(item);
  assert.strictEqual(JSON.stringify(item.versions), snapshot);
});

/* ---------------- 落盘接缝（从 script.js 抽出真实函数） ---------------- */

/* script.js 是浏览器脚本，无法 require；这里按 continue-mark.test.js 的老办法
   从源码里抽出真正在跑的落盘函数来验。守的是两件事：多版本记录过一遍
   historyBodyOf / 读回来之后版本一个不少；只有索引的条目写回索引时不会把
   「2 版」抹成 1 版（标题更新等路径只写索引）。 */
const fs = require("fs");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function extractFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `未找到函数 ${name}，源码结构变了要同步这个用例`);
  let depth = 0;
  for (let i = SRC.indexOf("{", start); i < SRC.length; i += 1) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 的花括号不配对`);
}

function constNumber(name) {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(SRC);
  assert.ok(m, `未找到常量 ${name}`);
  return Number(m[1]);
}

const S = new Function(
  "HISTORY_HEAD_CHARS",
  "HISTORY_INDEX_VERSION",
  extractFunction("historyHead")
    + extractFunction("historyVerCountOf")
    + extractFunction("historyIndexOf")
    + extractFunction("historyBodyOf")
    + "\nreturn { historyIndexOf, historyBodyOf, historyVerCountOf };"
)(constNumber("HISTORY_HEAD_CHARS"), constNumber("HISTORY_INDEX_VERSION"));

test("落盘接缝：多版本记录过一遍正文序列化再读回来，版本一个不少", () => {
  const item = {
    id: "h1", toolId: "1", toolName: "工具", icon: "i", title: "",
    input: "题目", output: "第一版正文", fileName: "", model: "model-a",
    partial: false, error: "", createdAt: 10, updatedAt: 20, _bodyLoaded: true,
  };
  V.append(item, { output: "第二版正文", model: "model-b", at: 30 });

  // 落盘：正文走 historyBodyOf（这是真正写进 nbx_h:<id> 的东西）
  const body = JSON.parse(JSON.stringify(S.historyBodyOf(item)));
  assert.strictEqual(body.versions.length, 2);
  assert.strictEqual(body.activeVersionId, item.activeVersionId);
  assert.strictEqual(body.output, "第二版正文", "正文仍是活动版本的投影");

  // 读回：_hydrateHistory 会把索引项与正文合并（索引在前、正文覆盖其上）
  const back = Object.assign({}, S.historyIndexOf(item), body, { _bodyLoaded: true });
  assert.strictEqual(V.count(back), 2);
  assert.strictEqual(V.active(back).output, "第二版正文");
  assert.strictEqual(V.active(back).model, "model-b");
  // 再切一版，切到的必须是原来那一版（id 没在序列化里走样）
  assert.strictEqual(V.switchTo(back, -1).output, "第一版正文");
});

test("落盘接缝：只有索引的条目写回索引时不会把「2 版」抹成 1 版", () => {
  const idxOnly = { id: "h1", toolId: "1", createdAt: 10, updatedAt: 20, verCount: 2, inputHead: "题目" };
  assert.strictEqual(idxOnly._bodyLoaded, undefined, "模拟镜像重读后的索引项");
  assert.strictEqual(S.historyIndexOf(idxOnly).verCount, 2);

  // 正文为空 / 单版本：不写 versions，形状与版本化之前完全一致
  const single = S.historyBodyOf({ input: "i", output: "o", fileName: "" });
  assert.deepStrictEqual(Object.keys(single), ["input", "output", "fileName"]);
  assert.strictEqual(S.historyVerCountOf({ id: "x", output: "o", _bodyLoaded: true }), 1);
  assert.strictEqual(S.historyVerCountOf({ id: "x", output: "o" }), 1);
  assert.strictEqual(S.historyVerCountOf({ id: "x", output: "o", verCount: 3 }), 3);
});

test("落盘接缝：镜像层归一后的正文，版本容器仍能正常读（跨模块形状一致）", () => {
  const M = require(path.join(__dirname, "..", "nbx-mirror.js"));
  const item = {
    id: "h1", output: "第一版正文", model: "model-a", createdAt: 10, updatedAt: 20, _bodyLoaded: true,
  };
  V.append(item, { output: "第二版正文", model: "model-b", at: 30 });
  const wire = M.sanitizeBody(S.historyBodyOf(item));
  assert.deepStrictEqual(wire.versions, item.versions, "镜像层不该改动版本条目");
  assert.strictEqual(wire.activeVersionId, item.activeVersionId);
  // 对端拿到的记录：正文 + 版本容器都要能接着用
  const remote = Object.assign({ _bodyLoaded: true }, wire);
  assert.strictEqual(V.count(remote), 2);
  assert.strictEqual(V.active(remote).model, "model-b");
});

/* ---------------- 运行 ---------------- */

for (const c of cases) {
  try {
    c.fn();
    passed += 1;
    console.log("  \u2713 " + c.name);
  } catch (e) {
    console.error("  \u2717 " + c.name);
    console.error("    " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n    ") : e));
  }
}
console.log(`\n${passed} passed, ${cases.length - passed} failed`);
process.exit(passed === cases.length ? 0 : 1);
