/* nbx-mirror-store.js 用例
   运行：node frontend/tests/nbx-mirror-store.test.js
   这一层会真的写数据，所以重点覆盖三类会「损坏或丢数据」的行为：
   取新判据、墓碑不许复活、以及本地已满时拒绝对方数据。 */

const assert = require("assert");
const path = require("path");

require(path.join(__dirname, "..", "nbx-mirror.js")); // 挂到 globalThis 上供 store 使用
const Store = require(path.join(__dirname, "..", "nbx-mirror-store.js"));

const KEYS = {
  history: "nbx_history",
  favorites: "nbx_favorites",
  bodyPrefix: "nbx_h:",
  tomb: "nbx_tomb",
  outbox: "nbx_mo",
  prefs: "nbx_prefs",
};

/* 极简 localStorage 替身：只实现被用到的三个方法 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const T = Date.now();
const MIN = 60 * 1000;

function freshStorage(side) {
  const s = makeStorage();
  Store.init(Object.assign({}, KEYS, { storage: s }));
  return s;
}

function seedHistory(storage, entries) {
  const index = entries.map((e) => e.index);
  storage.setItem(KEYS.history, JSON.stringify(index));
  for (const e of entries) {
    if (e.body) storage.setItem(KEYS.bodyPrefix + e.index.id, JSON.stringify(e.body));
  }
}

function histOp(id, at, extra) {
  return Object.assign(
    {
      k: "h",
      id,
      at,
      idx: Object.assign({ id, createdAt: at, updatedAt: at, title: "" }, (extra && extra.idx) || {}),
      body: (extra && extra.body) || { input: "in-" + id, output: "out-" + id, fileName: "" },
    },
    (extra && extra.raw) || {}
  );
}

let passed = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ---------------- 变更队列 ---------------- */

test("outboxAdd 同一 id 只留最新一条，反复编辑不撑大队列", () => {
  freshStorage();
  Store.outboxAdd("h", "a", T - 10 * MIN, false);
  Store.outboxAdd("h", "a", T - 5 * MIN, false);
  Store.outboxAdd("h", "a", T - 8 * MIN, false); // 更旧的不该覆盖
  assert.strictEqual(Store.outboxCount(), 1);
  const list = Store.outboxList();
  assert.strictEqual(list[0].at, T - 5 * MIN);
  assert.strictEqual(list[0].del, false);
});

test("outboxAdd 删除标记可覆盖，且不同 id 各占一条", () => {
  freshStorage();
  Store.outboxAdd("h", "a", T - 10 * MIN, false);
  Store.outboxAdd("h", "a", T - 5 * MIN, true);
  Store.outboxAdd("f", "b", T - 4 * MIN, false);
  assert.strictEqual(Store.outboxCount(), 2);
  const byId = Object.fromEntries(Store.outboxList().map((o) => [o.id, o]));
  assert.strictEqual(byId.a.del, true);
  assert.strictEqual(byId.b.k, "f");
});

test("outboxTrim 只清掉已确认的部分", () => {
  freshStorage();
  Store.outboxAdd("h", "old", T - 10 * MIN, false);
  Store.outboxAdd("h", "new", T - 1 * MIN, false);
  Store.outboxTrim(T - 5 * MIN);
  const ids = Store.outboxList().map((o) => o.id);
  assert.deepStrictEqual(ids, ["new"]);
});

test("outboxTrim 尊重 keep：被拒收的条目不能被清掉", () => {
  freshStorage();
  Store.outboxAdd("h", "rejected", T - 10 * MIN, false);
  Store.outboxAdd("h", "ok", T - 10 * MIN, false);
  Store.outboxTrim(T, ["rejected"]);
  const ids = Store.outboxList().map((o) => o.id).sort();
  assert.deepStrictEqual(ids, ["rejected"], "被拒收的留下等对端腾出空间，已送达的清掉");
});

test("outboxOps 的 op.at 取自队列而非条目自身（回执才能对上，队列才清得干净）", () => {
  const s = freshStorage();
  // 条目自身时间戳与队列时间戳故意不同，模拟历史数据 / 时钟漂移
  seedHistory(s, [{ index: { id: "a", createdAt: T - 100 * MIN, updatedAt: T - 100 * MIN }, body: { input: "i", output: "o", fileName: "" } }]);
  Store.outboxAdd("h", "a", T - 3 * MIN, false);
  const ops = Store.outboxOps();
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].at, T - 3 * MIN, "op.at 必须是队列时间");
  assert.strictEqual(ops[0].idx.updatedAt, T - 100 * MIN, "条目自身的时间戳原样带在对端用于取新判定");
});

test("outboxOps 对被删条目只发 del 标记，不尝试读负载", () => {
  const s = freshStorage();
  Store.outboxAdd("h", "gone", T - 1 * MIN, true);
  const ops = Store.outboxOps();
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].del, true);
  assert.strictEqual(ops[0].idx, undefined);
});

/* ---------------- 组装 op ---------------- */

test("buildOp 从存储读出负载；条目不存在时返回 null", () => {
  const s = freshStorage();
  seedHistory(s, [{ index: { id: "a", createdAt: T, updatedAt: T }, body: { input: "i", output: "o", fileName: "" } }]);
  const op = Store.buildOp("h", "a");
  assert.strictEqual(op.body.output, "o");
  assert.strictEqual(op.k, "h");
  assert.strictEqual(Store.buildOp("h", "missing"), null);
});

test("buildAllOps 摊平全部历史与收藏", () => {
  const s = freshStorage();
  seedHistory(s, [
    { index: { id: "a", createdAt: T, updatedAt: T }, body: { input: "1", output: "o1", fileName: "" } },
    { index: { id: "b", createdAt: T, updatedAt: T }, body: { input: "2", output: "o2", fileName: "" } },
  ]);
  s.setItem(KEYS.favorites, JSON.stringify([{ id: "f1", content: "c", createdAt: T }]));
  const ops = Store.buildAllOps();
  assert.strictEqual(ops.filter((o) => o.k === "h").length, 2);
  assert.strictEqual(ops.filter((o) => o.k === "f").length, 1);
});

test("localSummary 报告本机条目数与墓碑", () => {
  const s = freshStorage();
  seedHistory(s, [{ index: { id: "a", createdAt: T, updatedAt: T }, body: null }]);
  const sum = Store.localSummary();
  assert.strictEqual(sum.history, 1);
  assert.strictEqual(sum.favorites, 0);
  assert.ok(Array.isArray(sum.tombstones.history));
});

/* ---------------- 应用对方的 op ---------------- */

test("applyOps 新增对端条目并写入正文", () => {
  const s = freshStorage();
  const res = Store.applyOps([histOp("a", T - 10 * MIN)]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(res.history, true);
  const index = Store.readHistoryIndex();
  assert.strictEqual(index.length, 1);
  assert.strictEqual(Store.readBody("a").output, "out-a");
});

test("applyOps 同 id 取新：对端更新则覆盖，本地更新则保留", () => {
  const s = freshStorage();
  seedHistory(s, [{ index: { id: "a", createdAt: T - 100 * MIN, updatedAt: T - 100 * MIN }, body: { input: "old", output: "old", fileName: "" } }]);

  const newer = Store.applyOps([histOp("a", T - 10 * MIN, { body: { input: "new", output: "new", fileName: "" } })]);
  assert.strictEqual(newer.changed, 1);
  assert.strictEqual(Store.readBody("a").output, "new");

  const older = Store.applyOps([histOp("a", T - 200 * MIN, { body: { input: "stale", output: "stale", fileName: "" } })]);
  assert.strictEqual(older.changed, 0, "更旧的远端版本不应覆盖本地");
  assert.strictEqual(Store.readBody("a").output, "new");
});

test("applyOps 幂等：同一批 op 应用两次，第二次零变更", () => {
  const s = freshStorage();
  const op = histOp("a", T - 10 * MIN);
  assert.strictEqual(Store.applyOps([op]).changed, 1);
  assert.strictEqual(Store.applyOps([op]).changed, 0);
});

test("applyOps 删除服从 LWW：早于本机修改的删除不生效", () => {
  const s = freshStorage();
  seedHistory(s, [{ index: { id: "a", createdAt: T, updatedAt: T }, body: { input: "i", output: "o", fileName: "" } }]);
  // 删除早于本机最后修改：不移除本地条目（墓碑照登，见 mergeTombstone 取大时间）
  let res = Store.applyOps([{ k: "h", id: "a", at: T - 1 * MIN, del: true }]);
  assert.strictEqual(res.changed, 0, "更早的删除不该抹掉本机较新的条目");
  assert.strictEqual(Store.readHistoryIndex().length, 1);
  assert.strictEqual(Store.readBody("a").output, "o", "正文应保留");
  assert.strictEqual(Store.readTombstones().history.length, 1, "墓碑仍应登记");
  // 删除晚于本机最后修改：正常移除
  res = Store.applyOps([{ k: "h", id: "a", at: T + 1 * MIN, del: true }]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(Store.readHistoryIndex().length, 0);
  assert.strictEqual(s.getItem(KEYS.bodyPrefix + "a"), null, "正文键应被清掉");
  assert.strictEqual(Store.readTombstones().history[0].at, T + 1 * MIN);
});

test("applyOps 删除收藏服从同一 LWW 判据", () => {
  const s = freshStorage();
  s.setItem(KEYS.favorites, JSON.stringify([{ id: "f1", title: "t", createdAt: T, updatedAt: T }]));
  let res = Store.applyOps([{ k: "f", id: "f1", at: T - 1 * MIN, del: true }]);
  assert.strictEqual(res.changed, 0, "更早的删除不该生效");
  assert.strictEqual(Store.readFavorites().length, 1);
  res = Store.applyOps([{ k: "f", id: "f1", at: T + 1 * MIN, del: true }]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(Store.readFavorites().length, 0);
  assert.strictEqual(Store.readTombstones().favorites.length, 1);
});

test("applyOps 拒绝无时间戳的删除（at=0 不产生墓碑）", () => {
  const s = freshStorage();
  seedHistory(s, [{ index: { id: "a", createdAt: T, updatedAt: T }, body: { input: "i", output: "o", fileName: "" } }]);
  s.setItem(KEYS.favorites, JSON.stringify([{ id: "f1", title: "t", createdAt: T, updatedAt: T }]));
  const res = Store.applyOps([
    { k: "h", id: "a", at: 0, del: true },
    { k: "f", id: "f1", del: true },
  ]);
  assert.strictEqual(res.rejected, 2);
  assert.strictEqual(res.changed, 0);
  assert.strictEqual(Store.readHistoryIndex().length, 1, "条目应保留");
  assert.strictEqual(Store.readFavorites().length, 1, "收藏应保留");
  assert.strictEqual(Store.readTombstones().history.length, 0, "at=0 的删除不得登记墓碑");
  assert.strictEqual(Store.readTombstones().favorites.length, 0);
});

test("applyOps 不复活已被墓碑判死的条目", () => {
  const s = freshStorage();
  // 本地删过 a（墓碑比内容新），对端仍持有 a 的旧副本
  s.setItem(KEYS.tomb, JSON.stringify({ history: [{ id: "a", at: T - 1 * MIN }], favorites: [] }));
  const res = Store.applyOps([histOp("a", T - 10 * MIN)]);
  assert.strictEqual(res.changed, 0, "删过的条目不该被对端带回来");
  assert.strictEqual(Store.readHistoryIndex().length, 0);
});

test("applyOps 本地历史已满时拒绝写入，不挤掉本机数据", () => {
  const s = freshStorage();
  const full = [];
  for (let i = 0; i < 100; i += 1) full.push({ index: { id: "h" + i, createdAt: T - i * MIN, updatedAt: T - i * MIN }, body: null });
  seedHistory(s, full);
  const res = Store.applyOps([histOp("overflow", T)]);
  assert.strictEqual(res.changed, 0);
  assert.strictEqual(res.rejected, 1);
  const index = Store.readHistoryIndex();
  assert.strictEqual(index.length, 100);
  assert.ok(!index.some((i) => i.id === "overflow"));
});

test("applyOps 收藏走同一套取新 + 删除规则", () => {
  const s = freshStorage();
  s.setItem(KEYS.favorites, JSON.stringify([{ id: "f1", title: "old", createdAt: T - 100 * MIN }]));
  let res = Store.applyOps([{ k: "f", id: "f1", at: T - 10 * MIN, fav: { id: "f1", title: "new", createdAt: T - 100 * MIN, updatedAt: T - 10 * MIN } }]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(Store.readFavorites()[0].title, "new");
  res = Store.applyOps([{ k: "f", id: "f1", at: T - 1 * MIN, del: true }]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(Store.readFavorites().length, 0);
});

test("applyOps 忽略畸形 op 并计数，不抛异常", () => {
  const s = freshStorage();
  const res = Store.applyOps([null, { k: "z", id: "x" }, { k: "h" }, { k: "h", id: "ok", at: T, idx: { id: "ok", createdAt: T }, body: null }]);
  assert.strictEqual(res.rejected, 3);
  assert.strictEqual(res.changed, 1);
  assert.doesNotThrow(() => Store.applyOps(null));
  assert.doesNotThrow(() => Store.applyOps(undefined));
});

test("applyOps 结果按时间倒序（列表渲染依赖此顺序）", () => {
  const s = freshStorage();
  Store.applyOps([histOp("mid", T - 50 * MIN), histOp("old", T - 90 * MIN), histOp("new", T - 1 * MIN)]);
  assert.deepStrictEqual(Store.readHistoryIndex().map((i) => i.id), ["new", "mid", "old"]);
});

/* ---------------- 墓碑表交换与清扫 ---------------- */

test("applyTombstones 双向合并墓碑并取较新时间", () => {
  const s = freshStorage();
  Store.applyTombstones({ history: [{ id: "x", at: T - 50 * MIN }], favorites: [] });
  Store.applyTombstones({ history: [{ id: "x", at: T - 10 * MIN }], favorites: [{ id: "y", at: T - 20 * MIN }] });
  const t = Store.readTombstones();
  assert.strictEqual(t.history.length, 1);
  assert.strictEqual(t.history[0].at, T - 10 * MIN);
  assert.strictEqual(t.favorites.length, 1);
});

test("sweepTombstoned 清掉被判死的本机条目及其正文", () => {
  const s = freshStorage();
  seedHistory(s, [
    { index: { id: "dead", createdAt: T - 100 * MIN, updatedAt: T - 100 * MIN }, body: { input: "i", output: "o", fileName: "" } },
    { index: { id: "alive", createdAt: T - 50 * MIN, updatedAt: T - 50 * MIN }, body: { input: "i2", output: "o2", fileName: "" } },
  ]);
  s.setItem(KEYS.tomb, JSON.stringify({ history: [{ id: "dead", at: T - 10 * MIN }], favorites: [] }));
  const res = Store.sweepTombstoned();
  assert.deepStrictEqual(res.historyIds, ["dead"]);
  assert.deepStrictEqual(Store.readHistoryIndex().map((i) => i.id), ["alive"]);
  assert.strictEqual(s.getItem(KEYS.bodyPrefix + "dead"), null);
  assert.strictEqual(s.getItem(KEYS.bodyPrefix + "alive") !== null, true, "存活条目的正文不该被动");
});

/* ---------------- 端到端：两个 origin 互相收敛 ---------------- */

test("两个 origin 双向交换后各自持有同一份数据", () => {
  const A = freshStorage();
  seedHistory(A, [{ index: { id: "a1", createdAt: T - 10 * MIN, updatedAt: T - 10 * MIN }, body: { input: "A", output: "outA", fileName: "" } }]);
  const opsA = Store.buildAllOps();

  const B = freshStorage();
  seedHistory(B, [{ index: { id: "b1", createdAt: T - 20 * MIN, updatedAt: T - 20 * MIN }, body: { input: "B", output: "outB", fileName: "" } }]);
  const opsB = Store.buildAllOps();

  Store.applyOps(opsB); // A 收到 B 的
  Store.applyOps(opsA); // B 收到 A 的

  const idsA = Store.readHistoryIndex().map((i) => i.id).sort();
  assert.deepStrictEqual(idsA, ["a1", "b1"]);
  const idsB = Store.readHistoryIndex().map((i) => i.id).sort();
  assert.deepStrictEqual(idsB, ["a1", "b1"]);
  assert.strictEqual(Store.readBody("b1").output, "outB", "A 侧应能读到 B 的正文");
});

test("A 删除后经墓碑传播到 B，且有删除方不会被自己的队列复活", () => {
  // A 侧删除 a1 并记墓碑 + del op
  const A = freshStorage();
  seedHistory(A, [{ index: { id: "a1", createdAt: T - 10 * MIN, updatedAt: T - 10 * MIN }, body: { input: "A", output: "outA", fileName: "" } }]);
  const delOp = { k: "h", id: "a1", at: T, del: true };

  const B = freshStorage();
  seedHistory(B, [{ index: { id: "a1", createdAt: T - 10 * MIN, updatedAt: T - 10 * MIN }, body: { input: "A", output: "outA", fileName: "" } }]);
  const bOp = Store.buildAllOps(); // B 手里还是旧副本

  Store.applyOps([delOp]); // B 收到删除
  assert.strictEqual(Store.readHistoryIndex().length, 0, "B 应删掉该条");

  Store.applyOps(bOp); // A 收到 B 的旧副本（模拟对端仍在推旧数据）
  assert.strictEqual(Store.readHistoryIndex().length, 0, "A 侧不该被旧副本复活");
});

/* ---------------- 偏好同步（主题 / 选中模型） ---------------- */

test("applyOps 偏好 op：LWW 判新，未知键与畸形值拒绝", () => {
  const s = freshStorage();
  let res = Store.applyOps([{ k: "p", id: "theme", at: T - 10 * MIN, v: "sora" }]);
  assert.strictEqual(res.changed, 1);
  assert.strictEqual(Store.readPrefs().theme.v, "sora");
  assert.strictEqual(res.prefs.theme, "sora");
  // 更旧的不覆盖
  res = Store.applyOps([{ k: "p", id: "theme", at: T - 20 * MIN, v: "paper" }]);
  assert.strictEqual(res.changed, 0);
  assert.strictEqual(Store.readPrefs().theme.v, "sora");
  // 更新的覆盖
  res = Store.applyOps([{ k: "p", id: "model", at: T - 5 * MIN, v: "m1" }]);
  assert.strictEqual(Store.readPrefs().model.v, "m1");
  // 未知键 / 空值 / 无时间戳一律拒绝，且不得改动已有值
  res = Store.applyOps([
    { k: "p", id: "draft", at: T, v: "x" },
    { k: "p", id: "theme", at: T, v: "" },
    { k: "p", id: "theme", at: 0, v: "paper" },
  ]);
  assert.strictEqual(res.rejected, 3);
  assert.strictEqual(Store.readPrefs().theme.v, "sora");
});

test("buildOp / seedPrefsOnce / buildAllOps 覆盖偏好", () => {
  const s = freshStorage();
  Store.writePrefs({ theme: { v: "ink", at: T - 3 * MIN } });
  assert.deepStrictEqual(Store.buildOp("p", "theme"), { k: "p", id: "theme", at: T - 3 * MIN, v: "ink" });
  assert.strictEqual(Store.buildOp("p", "model"), null, "无记录的偏好不应生成 op");

  assert.strictEqual(Store.seedPrefsOnce("m_prefs"), true);
  assert.deepStrictEqual(Store.outboxList().map((o) => o.k + "|" + o.id), ["p|theme"]);
  assert.strictEqual(Store.seedPrefsOnce("m_prefs"), false, "标记已置不得重复播种");
  assert.deepStrictEqual(Store.buildAllOps().map((o) => o.k + "|" + o.id), ["p|theme"]);
});

/* 偏好从 nbx_prefs 落到界面这一步：页面启动读的是 LS.theme / LS.model（nbx_theme /
   nbx_model），与镜像维护的 nbx_prefs 是两个键，必须由 pickPrefUpdates 决定
   「哪些值该套上去」。这一步漏了，偏好就只是躺在存储里不生效。 */
test("pickPrefUpdates：只返回需要改且本线路存在的值", () => {
  const valid = { theme: ["paper", "sora"], model: ["m1", "m2"] };
  const prefs = { theme: { v: "sora", at: T }, model: { v: "m1", at: T } };

  // 主题与当前不同 → 应用；模型与当前一致 → 不返回（省掉无谓的主题转场与重渲染）
  assert.deepStrictEqual(
    Store.pickPrefUpdates(prefs, { theme: "paper", model: "m1" }, valid),
    { theme: "sora" }
  );
  // 两个都该改
  assert.deepStrictEqual(
    Store.pickPrefUpdates(prefs, { theme: "paper", model: "m2" }, valid),
    { theme: "sora", model: "m1" }
  );
  // 本页已经就是这个值 → 空
  assert.deepStrictEqual(Store.pickPrefUpdates(prefs, { theme: "sora", model: "m1" }, valid), {});
});

test("pickPrefUpdates：本线路没有的主题/模型一律拒收", () => {
  // 两条线路的可用集合可能不同：对端选了本线路没有的值，硬套会选中不存在的东西
  assert.deepStrictEqual(
    Store.pickPrefUpdates(
      { theme: { v: "obsidian", at: T }, model: { v: "m9", at: T } },
      { theme: "paper", model: "" },
      { theme: ["paper", "sora"], model: ["m1"] }
    ),
    {}
  );
  // 可用集合缺失（模型列表还没加载完）时同样不应用，等下次对账再来
  assert.deepStrictEqual(Store.pickPrefUpdates({ theme: { v: "sora", at: T } }, { theme: "paper" }, {}), {});
  // 畸形入参不抛异常
  assert.deepStrictEqual(Store.pickPrefUpdates(null, null, null), {});
  assert.deepStrictEqual(
    Store.pickPrefUpdates(
      { theme: { v: "", at: T }, model: { v: 5, at: T } },
      { theme: "paper" },
      { theme: ["paper"] }
    ),
    {}
  );
});

let failed = 0;
for (const c of cases) {
  try {
    c.fn();
    passed += 1;
    console.log("  \u2713 " + c.name);
  } catch (e) {
    failed += 1;
    console.error("  \u2717 " + c.name);
    console.error("    " + (e && e.message ? e.message : e));
  }
}
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
