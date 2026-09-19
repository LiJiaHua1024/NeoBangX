/* nbx-mirror-peer.js 双向集成用例
   运行：node frontend/tests/nbx-mirror-peer.test.js

   把两个 origin 各自的 storage + Store + Peer 装进一个内存总线，让消息在两侧之间
   真正来回跑，覆盖握手、分块、回执、出队、墓碑交换这几条最容易写错的路径。

   注意：NbxMirrorStore 是单例（浏览器里一个页面只对应一个 origin），所以每次派发
   消息前要用对应那一侧的 storage 重新 init 一次。 */

const assert = require("assert");
const path = require("path");

require(path.join(__dirname, "..", "nbx-mirror.js"));
const Store = require(path.join(__dirname, "..", "nbx-mirror-store.js"));
const Peer = require(path.join(__dirname, "..", "nbx-mirror-peer.js"));

const KEYS = {
  history: "nbx_history",
  favorites: "nbx_favorites",
  bodyPrefix: "nbx_h:",
  tomb: "nbx_tomb",
  outbox: "nbx_mo",
  prefs: "nbx_prefs",
};

const T = Date.now();
const MIN = 60 * 1000;

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function useSide(side) {
  Store.init(Object.assign({}, KEYS, { storage: side.storage }));
}

/* 一个 origin：自己的存储、自己的对端实例，post 往总线上扔消息 */
function makeSide(name) {
  const side = { name, storage: makeStorage(), peer: null, received: [] };
  side.post = (msg) => {
    side.sent = side.sent || [];
    side.sent.push(msg);
    bus.push({ from: side, to: side.peerHost, data: msg });
  };
  return side;
}

const bus = [];

/* 把总线上的消息派发给对端。派发前把 Store 切到对端那一侧的 storage。 */
async function pump(rounds = 60) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((r) => setTimeout(r, 1));
    let moved = 0;
    while (bus.length) {
      const item = bus.shift();
      const target = item.from.peerHost;
      if (!target) continue;
      useSide(target);
      target.peer.handleMessage(item.data, "https://" + item.from.name);
      moved += 1;
    }
    if (!moved && i > 3) {
      // 连续几轮没有新消息，且发送方的 setTimeout 分块也已跑完
      await new Promise((r) => setTimeout(r, 2));
      if (!bus.length) return;
    }
  }
}

function seed(side, entries, favorites) {
  useSide(side);
  side.storage.setItem(KEYS.history, JSON.stringify(entries.map((e) => e.index)));
  for (const e of entries) {
    if (e.body) side.storage.setItem(KEYS.bodyPrefix + e.index.id, JSON.stringify(e.body));
  }
  if (favorites) side.storage.setItem(KEYS.favorites, JSON.stringify(favorites));
}

function entry(id, at, out) {
  return {
    index: { id, createdAt: at, updatedAt: at, title: "" },
    body: { input: "in-" + id, output: out || "out-" + id, fileName: "" },
  };
}

function ids(side) {
  useSide(side);
  return Store.readHistoryIndex().map((i) => i.id);
}

function makePair() {
  const A = makeSide("www");
  const B = makeSide("cf");
  A.peerHost = B;
  B.peerHost = A;
  A.peer = Peer.create({ post: A.post });
  B.peer = Peer.create({ post: B.post });
  return { A, B };
}

let passed = 0;
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ---------------- 握手与全量 ---------------- */

test("A 有数据、B 为空：握手后 B 拿到全部历史与收藏", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN), entry("a2", T - 20 * MIN)], [{ id: "f1", content: "c", createdAt: T - 5 * MIN }]);
  seed(B, []);
  // 首次启用镜像：把存量登记进队列（生产里由 mirrorStart 调用 seedOutboxOnce）
  useSide(A);
  assert.strictEqual(Store.seedOutboxOnce("nbx_mo_seeded"), true);
  bus.length = 0;

  // 真实方向：桥（B）先 ready，主页面（A）收到后回 hello 并推自己的队列
  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  assert.deepStrictEqual(ids(B).sort(), ["a1", "a2"], "B 应拿到 A 的全部历史");
  useSide(B);
  assert.strictEqual(Store.readFavorites().length, 1, "B 应拿到 A 的收藏");
  assert.strictEqual(Store.readBody("a1").output, "out-a1", "正文应随 op 送达");
});

test("双方都有数据：握手后各自持有并集", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN)]);
  seed(B, [entry("b1", T - 20 * MIN)]);
  useSide(A);
  Store.seedOutboxOnce("nbx_mo_seeded");
  useSide(B);
  Store.seedOutboxOnce("nbx_mo_seeded");
  bus.length = 0;

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  assert.deepStrictEqual(ids(A).sort(), ["a1", "b1"]);
  assert.deepStrictEqual(ids(B).sort(), ["a1", "b1"]);
});

test("对端非空时，启用镜像之前就存在的数据也必须能送达", async () => {
  // 回归用例：只靠「对端为空才发全量快照」是不够的 —— 主线路用了一阵子、
  // 备份线路也可能有自己的历史，那种情况下存量数据会永远送不出去。
  const { A, B } = makePair();
  seed(A, [entry("old1", T - 100 * MIN), entry("old2", T - 90 * MIN)]);
  seed(B, [entry("b-existing", T - 50 * MIN)]);
  useSide(A);
  Store.seedOutboxOnce("nbx_mo_seeded");
  bus.length = 0;

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  assert.deepStrictEqual(ids(B).sort(), ["b-existing", "old1", "old2"], "存量数据必须能送达非空对端");
});

test("种子只做一次：标记已置时不再重复登记", () => {
  const { A } = makePair();
  seed(A, [entry("a1", T - 10 * MIN)]);
  useSide(A);
  assert.strictEqual(Store.seedOutboxOnce("nbx_mo_seeded"), true);
  const n = Store.outboxCount();
  assert.strictEqual(Store.seedOutboxOnce("nbx_mo_seeded"), false);
  assert.strictEqual(Store.outboxCount(), n);
});

test("握手是幂等的：重复握手不产生重复条目、不丢数据", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN)]);
  seed(B, []);

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();
  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  assert.deepStrictEqual(ids(B), ["a1"]);
  useSide(A);
  assert.deepStrictEqual(ids(A), ["a1"]);
});

/* ---------------- 增量推送 ---------------- */

test("A 新增一条并 flush：B 收到，且 A 的队列被清空", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN)]);
  seed(B, [entry("a1", T - 10 * MIN)]);

  useSide(A);
  A.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  // A 侧新增 a2：先落本地，再登记队列并推送
  useSide(A);
  const list = Store.readHistoryIndex();
  list.unshift({ id: "a2", createdAt: T, updatedAt: T, title: "" });
  A.storage.setItem(KEYS.history, JSON.stringify(list));
  A.storage.setItem(KEYS.bodyPrefix + "a2", JSON.stringify({ input: "x", output: "new-a2", fileName: "" }));
  Store.outboxAdd("h", "a2", T, false);
  A.peer.flush();
  await pump();

  useSide(B);
  assert.strictEqual(Store.readBody("a2").output, "new-a2", "B 应收到新增条目");
  useSide(A);
  assert.strictEqual(Store.outboxCount(), 0, "收到回执后 A 的队列应清空");
});

test("分块：条目数超过每包上限时全部送达", async () => {
  const { A, B } = makePair();
  const many = [];
  for (let i = 0; i < 21; i += 1) many.push(entry("h" + i, T - i * MIN));
  seed(A, many);
  seed(B, []);

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump(120);

  assert.strictEqual(ids(B).length, 21, "21 条应分 3 包全部送达（每包 8 条）");
});

/* ---------------- 删除与墓碑 ---------------- */

test("A 删除一条：B 收到删除，且 A 自己不会被旧副本复活", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN)]);
  seed(B, [entry("a1", T - 10 * MIN)]);

  // 先握一次手让双方都拿到 B 的旧副本
  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  // A 删除 a1：记墓碑 + 登记删除 op + 推送
  useSide(A);
  A.storage.setItem(KEYS.history, JSON.stringify([]));
  A.storage.removeItem(KEYS.bodyPrefix + "a1");
  A.storage.setItem(KEYS.tomb, JSON.stringify({ history: [{ id: "a1", at: T }], favorites: [] }));
  Store.outboxAdd("h", "a1", T, true);
  A.peer.flush();
  await pump();

  useSide(B);
  assert.deepStrictEqual(Store.readHistoryIndex().map((i) => i.id), [], "B 应删掉 a1");
  assert.ok(Store.readTombstones().history.some((t) => t.id === "a1"), "B 应落墓碑防止复活");

  useSide(A);
  assert.deepStrictEqual(Store.readHistoryIndex().map((i) => i.id), [], "A 自己也不该被旧副本复活");
});

test("离线期间的删除：靠握手时的墓碑整表交换补上", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 10 * MIN), entry("a2", T - 20 * MIN)]);
  seed(B, [entry("a1", T - 10 * MIN), entry("a2", T - 20 * MIN)]);

  // A 删掉 a1（B 全程离线，收不到 del op）
  useSide(A);
  A.storage.setItem(KEYS.history, JSON.stringify([{ id: "a2", createdAt: T - 20 * MIN, updatedAt: T - 20 * MIN }]));
  A.storage.setItem(KEYS.tomb, JSON.stringify({ history: [{ id: "a1", at: T }], favorites: [] }));

  // B 上线握手
  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  useSide(B);
  assert.deepStrictEqual(Store.readHistoryIndex().map((i) => i.id), ["a2"], "握手交换墓碑后 B 应清掉 a1");
});

/* ---------------- 取新与拒收 ---------------- */

test("两端改同一条：取 updatedAt 更新的一版", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a1", T - 100 * MIN, "old")]);
  seed(B, [entry("a1", T - 100 * MIN, "old")]);

  // A 侧把 a1 改新并推送
  useSide(A);
  A.storage.setItem(KEYS.history, JSON.stringify([{ id: "a1", createdAt: T - 100 * MIN, updatedAt: T, title: "" }]));
  A.storage.setItem(KEYS.bodyPrefix + "a1", JSON.stringify({ input: "x", output: "A-newer", fileName: "" }));
  Store.outboxAdd("h", "a1", T, false);
  A.peer.flush();
  await pump();

  useSide(B);
  assert.strictEqual(Store.readBody("a1").output, "A-newer", "B 应收下更新的版本");

  // 反向：B 再推它那份旧的，不应覆盖
  useSide(B);
  B.storage.setItem(KEYS.bodyPrefix + "a1", JSON.stringify({ input: "x", output: "B-stale", fileName: "" }));
  Store.outboxAdd("h", "a1", T - 50 * MIN, false);
  B.peer.flush();
  await pump();

  useSide(A);
  assert.strictEqual(Store.readBody("a1").output, "A-newer", "A 不该被更旧的版本覆盖");
});

test("对端已满：拒收并从回执里回报，发送方保留在队列里等下次", async () => {
  const { A, B } = makePair();
  seed(A, [entry("a-new", T)]);
  const full = [];
  for (let i = 0; i < 100; i += 1) full.push(entry("b" + i, T - (i + 1) * MIN));
  seed(B, full);
  // A 侧登记一条待推送的新增，而 B 已经满额
  useSide(A);
  Store.outboxAdd("h", "a-new", T, false);

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  assert.strictEqual(ids(B).length, 100, "B 保持满额，不该被顶掉任何一条");
  assert.ok(!ids(B).includes("a-new"), "溢出的条目应被拒收");
  useSide(A);
  assert.ok(Store.outboxCount() > 0, "被拒收的条目要留在 A 的队列里，不能当成已送达");
});

test("偏好同步：A 换主题与模型，B 收到并落进偏好存储", async () => {
  const { A, B } = makePair();
  seed(A, []);
  seed(B, []);
  useSide(A);
  Store.writePrefs({ theme: { v: "sora", at: T - 2 * MIN }, model: { v: "m1", at: T - MIN } });
  Store.seedPrefsOnce("nbx_mo_seeded_prefs");
  useSide(B);
  Store.seedPrefsOnce("nbx_mo_seeded_prefs");
  bus.length = 0;

  useSide(B);
  B.post({ nbx: Peer.PROTO, t: "ready", summary: Store.localSummary() });
  await pump();

  useSide(B);
  const prefs = Store.readPrefs();
  assert.strictEqual(prefs.theme.v, "sora", "B 应收到 A 的主题");
  assert.strictEqual(prefs.model.v, "m1", "B 应收到 A 的模型");
});

/* ---------------- 执行 ---------------- */

(async function run() {
  for (const c of cases) {
    try {
      bus.length = 0;
      await c.fn();
      passed += 1;
      console.log("  \u2713 " + c.name);
    } catch (e) {
      console.error("  \u2717 " + c.name);
      console.error("    " + (e && e.message ? e.message : e));
      process.exitCode = 1;
    }
  }
  console.log("\n" + passed + " passed, " + (cases.length - passed) + " failed");
  process.exit(process.exitCode || 0);
}());
