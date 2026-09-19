/* nbx-mirror.js 纯函数用例
   运行：node frontend/tests/nbx-mirror.test.js
   不依赖任何测试框架，断言失败即非零退出。合并规则是两条线路数据一致性的唯一保证，
   这里覆盖「取新 / 相同时间戳不翻转 / 墓碑判死 / 上限淘汰 / 非法数据整份拒绝」几类关键行为。 */

const assert = require("assert");
const path = require("path");
const crypto = require("crypto");
const M = require(path.join(__dirname, "..", "nbx-mirror.js"));

let passed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

/* ---------------- 时间戳 ---------------- */

test("updatedAtOf 优先 updatedAt，缺失回退 createdAt，都没有则为 0", () => {
  assert.strictEqual(M.updatedAtOf({ updatedAt: 200, createdAt: 100 }), 200);
  assert.strictEqual(M.updatedAtOf({ createdAt: 100 }), 100);
  assert.strictEqual(M.updatedAtOf({}), 0);
  assert.strictEqual(M.updatedAtOf(null), 0);
  assert.strictEqual(M.updatedAtOf({ updatedAt: "abc", createdAt: 100 }), 100);
});

test("utf8Bytes 按 UTF-8 计字节，中文 3 字节", () => {
  assert.strictEqual(M.utf8Bytes("abc"), 3);
  assert.strictEqual(M.utf8Bytes("中文"), 6);
  assert.strictEqual(M.utf8Bytes(""), 0);
});

/* ---------------- 归一与校验 ---------------- */

test("sanitizeIndex 拒绝无 id，裁剪超长字段，透传未知标量、丢弃未知嵌套", () => {
  assert.strictEqual(M.sanitizeIndex({ title: "x" }), null);
  const idx = M.sanitizeIndex({
    id: "a1", title: "t".repeat(900), createdAt: 5,
    futureFlag: true, futureCount: 7, futureNested: { a: 1 }, futureArr: [1],
  });
  assert.strictEqual(idx.title.length, 512);
  assert.strictEqual(idx.updatedAt, 5, "updatedAt 应回退到 createdAt");
  assert.strictEqual(idx.futureFlag, true, "未知标量应透传");
  assert.strictEqual(idx.futureCount, 7);
  assert.strictEqual(idx.futureNested, undefined, "未知嵌套应丢弃");
  assert.strictEqual(idx.futureArr, undefined, "未知数组应丢弃");
});

test("buildEnvelope 产出带版本号的 envelope，缺正文时补空正文", () => {
  const env = M.buildEnvelope({
    source: "a.example.com",
    history: [{ index: { id: "h1", createdAt: 1 } }],
    favorites: [{ id: "f1", content: "c", createdAt: 2 }],
  });
  assert.strictEqual(env.v, M.MIRROR_VERSION);
  assert.strictEqual(env.history.length, 1);
  assert.deepStrictEqual(env.history[0].body, { input: "", output: "", fileName: "" });
  assert.strictEqual(env.favorites[0].id, "f1");
  assert.strictEqual(typeof env.exportedAt, "number");
});

test("validateEnvelope 拒绝版本不符 / 非 JSON / 缺列表 / 空数据", () => {
  assert.strictEqual(M.validateEnvelope("not json{").ok, false);
  assert.strictEqual(M.validateEnvelope({ v: 99, history: [], favorites: [] }).ok, false);
  assert.strictEqual(M.validateEnvelope({ v: 1, history: {} }).ok, false);
  assert.strictEqual(M.validateEnvelope({ v: 1, history: [], favorites: [] }).ok, false);
  assert.strictEqual(M.validateEnvelope(null).ok, false);
});

test("validateEnvelope 接受合法数据并归一字段", () => {
  const res = M.validateEnvelope({
    v: 1, history: [{ index: { id: "h1", createdAt: 10, title: "T" }, body: { input: "i", output: "o" } }],
    favorites: [{ id: "f1", content: "c", createdAt: 3 }],
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.envelope.history[0].body.output, "o");
  assert.strictEqual(res.envelope.history[0].index.title, "T");
});

test("validateEnvelope 按上限截断超量条目", () => {
  const many = [];
  for (let i = 0; i < 150; i += 1) many.push({ index: { id: "h" + i, createdAt: i } });
  const res = M.validateEnvelope({ v: 1, history: many, favorites: [] }, { limits: { history: 100, favorites: 100 } });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.envelope.history.length, 100);
});

/* ---------------- 合并 ---------------- */

/* 时间戳必须用真实量级（相对当下的毫秒时间戳）。
   墓碑裁剪按「90 天内有效」判定，若用 100/150 这类小数字，墓碑会被当成
   早已过期的历史记录直接丢掉，测出来的就不是合并逻辑而是裁剪逻辑了。 */
const T = Date.now();
const MIN = 60 * 1000;

function entry(id, at, extra) {
  return {
    index: Object.assign({ id, createdAt: at, updatedAt: at, title: "" }, extra || {}),
    body: { input: "in-" + id, output: "out-" + id, fileName: "" },
  };
}

test("mergeRemote：对端独有条目被加入", () => {
  const out = M.mergeRemote(
    { history: [entry("a", T - 100 * MIN)], favorites: [] },
    { history: [entry("b", T - 50 * MIN)], favorites: [] }
  );
  assert.deepStrictEqual(out.history.map((e) => e.index.id), ["b", "a"], "应按时间倒序");
  assert.strictEqual(out.stats.historyAdded, 1);
  assert.strictEqual(out.stats.historyUpdated, 0);
});

test("mergeRemote：同 id 取 updatedAt 更新的一版，索引与正文一起换", () => {
  const local = { history: [entry("a", T - 100 * MIN, { title: "old" })], favorites: [] };
  const remote = { history: [entry("a", T - 10 * MIN, { title: "new" })], favorites: [] };
  const out = M.mergeRemote(local, remote);
  assert.strictEqual(out.history[0].index.title, "new");
  assert.strictEqual(out.history[0].body.output, "out-a");
  assert.strictEqual(out.stats.historyUpdated, 1);
  assert.strictEqual(out.stats.historyAdded, 0);

  // 反向：本地更新时不应被远端旧版本覆盖
  const out2 = M.mergeRemote(
    { history: [entry("a", T - 10 * MIN, { title: "new" })], favorites: [] },
    { history: [entry("a", T - 100 * MIN, { title: "old" })], favorites: [] }
  );
  assert.strictEqual(out2.history[0].index.title, "new");
  assert.strictEqual(out2.stats.historyUpdated, 0);
});

test("mergeRemote：时间戳相同保留本地，合并幂等不翻转", () => {
  const at = T - 10 * MIN;
  const local = { history: [entry("a", at, { title: "mine" })], favorites: [] };
  const remote = { history: [entry("a", at, { title: "theirs" })], favorites: [] };
  const once = M.mergeRemote(local, remote);
  assert.strictEqual(once.history[0].index.title, "mine");
  assert.strictEqual(once.stats.historyUpdated, 0);
  const twice = M.mergeRemote({ history: once.history, favorites: [] }, remote);
  assert.strictEqual(twice.history[0].index.title, "mine");
  assert.strictEqual(M.hasChanges(twice.stats), false, "重复合并应无变化");
});

test("mergeRemote：本地只有索引、远端有正文时补全正文", () => {
  const at = T - 10 * MIN;
  const out = M.mergeRemote(
    { history: [{ index: { id: "a", createdAt: at, updatedAt: at }, body: null }], favorites: [] },
    { history: [entry("a", at)], favorites: [] }
  );
  assert.strictEqual(out.history[0].body.output, "out-a");
  assert.strictEqual(out.stats.historyUpdated, 1);
});

test("mergeRemote：对端删除产生墓碑，本地副本被判定删除", () => {
  const out = M.mergeRemote(
    { history: [entry("a", T - 100 * MIN), entry("b", T - 50 * MIN)], favorites: [] },
    { history: [], favorites: [], tombstones: { history: [{ id: "a", at: T - 75 * MIN }], favorites: [] } }
  );
  assert.deepStrictEqual(out.history.map((e) => e.index.id), ["b"]);
  assert.strictEqual(out.stats.historyRemoved, 1);
});

test("mergeRemote：墓碑早于内容时不判死（删除后同 id 重新生成）", () => {
  const out = M.mergeRemote(
    { history: [entry("a", T - 10 * MIN)], favorites: [] },
    { history: [], tombstones: { history: [{ id: "a", at: T - 100 * MIN }], favorites: [] } }
  );
  assert.strictEqual(out.history.length, 1, "内容比墓碑新，应保留");
  assert.strictEqual(out.stats.historyRemoved, 0);
});

test("mergeRemote：墓碑双向合并，取较新的时间", () => {
  const out = M.mergeRemote(
    { history: [], tombstones: { history: [{ id: "x", at: T - 50 * MIN }], favorites: [] } },
    { history: [], tombstones: { history: [{ id: "x", at: T - 10 * MIN }], favorites: [] } }
  );
  assert.strictEqual(out.tombstones.history.length, 1);
  assert.strictEqual(out.tombstones.history[0].at, T - 10 * MIN);
});

test("mergeRemote：超出上限截掉最旧并报告 dropped", () => {
  const local = [];
  for (let i = 0; i < 100; i += 1) local.push(entry("h" + i, T - (100 - i) * MIN));
  const out = M.mergeRemote({ history: local, favorites: [] }, { history: [entry("new", T)], favorites: [] });
  assert.strictEqual(out.history.length, 100);
  assert.strictEqual(out.history[0].index.id, "new", "最新的应保留");
  assert.strictEqual(out.droppedHistory.length, 1);
  assert.strictEqual(out.droppedHistory[0].index.id, "h0", "被截掉的应是最旧的");
});

test("mergeRemote：收藏同样走取新 + 墓碑", () => {
  const out = M.mergeRemote(
    {
      history: [],
      favorites: [
        { id: "f1", title: "old", createdAt: T - 100 * MIN },
        { id: "f2", title: "keep", createdAt: T - 50 * MIN },
      ],
    },
    {
      history: [],
      favorites: [{ id: "f1", title: "new", updatedAt: T - 10 * MIN, createdAt: T - 100 * MIN }],
      tombstones: { history: [], favorites: [{ id: "f2", at: T - 30 * MIN }] },
    }
  );
  assert.strictEqual(out.favorites.length, 1);
  assert.strictEqual(out.favorites[0].title, "new");
  assert.strictEqual(out.stats.favoriteUpdated, 1);
  assert.strictEqual(out.stats.favoriteRemoved, 1);
});

test("mergeRemote 不修改入参（纯函数）", () => {
  const local = { history: [entry("a", T - 100 * MIN)], favorites: [] };
  const remote = {
    history: [entry("b", T - 50 * MIN)],
    tombstones: { history: [{ id: "a", at: T }], favorites: [] },
  };
  const snapshot = JSON.stringify({ local, remote });
  M.mergeRemote(local, remote);
  assert.strictEqual(JSON.stringify({ local, remote }), snapshot);
});

test("mergeRemote 对空/畸形入参不抛异常", () => {
  assert.doesNotThrow(() => M.mergeRemote(null, undefined));
  assert.doesNotThrow(() => M.mergeRemote({ history: "x" }, { favorites: 5 }));
  const out = M.mergeRemote(null, undefined);
  assert.deepStrictEqual(out.history, []);
  assert.strictEqual(M.hasChanges(out.stats), false);
});

test("mergeRemote 返回逐条变更清单（id + 标题 + 时间），删除带墓碑时间", () => {
  const NOW = Date.now();
  const local = M.buildEnvelope({
    history: [
      { index: { id: "keep", title: "本地保留", createdAt: NOW - 5000 }, body: { input: "", output: "", fileName: "" } },
      { index: { id: "upd", title: "本地旧版", createdAt: NOW - 4000, updatedAt: NOW - 4000 }, body: { input: "", output: "", fileName: "" } },
      { index: { id: "dead", title: "将被墓碑判死", createdAt: NOW - 3000 }, body: { input: "", output: "", fileName: "" } },
    ],
    favorites: [],
    tombstones: { history: [{ id: "dead", at: NOW - 1000 }], favorites: [] },
  });
  const remote = M.buildEnvelope({
    history: [
      { index: { id: "upd", title: "远端新版", createdAt: NOW - 4000, updatedAt: NOW - 2000 }, body: { input: "", output: "", fileName: "" } },
      { index: { id: "new", title: "远端独有", createdAt: NOW - 500 }, body: { input: "", output: "", fileName: "" } },
    ],
    favorites: [{ id: "f1", title: "新收藏", createdAt: NOW - 300 }],
    tombstones: { history: [], favorites: [] },
  });
  const out = M.mergeRemote(local, remote);
  const ch = out.changes;
  assert.deepStrictEqual(ch.historyAdded.map((d) => d.id), ["new"]);
  assert.strictEqual(ch.historyAdded[0].title, "远端独有");
  assert.strictEqual(ch.historyAdded[0].updatedAt, NOW - 500);
  assert.deepStrictEqual(ch.historyUpdated.map((d) => d.id), ["upd"]);
  assert.strictEqual(ch.historyUpdated[0].title, "远端新版");
  assert.deepStrictEqual(ch.historyRemoved.map((d) => d.id), ["dead"]);
  assert.strictEqual(ch.historyRemoved[0].title, "将被墓碑判死");
  assert.strictEqual(ch.historyRemoved[0].at, NOW - 1000, "删除行应带墓碑时间");
  assert.deepStrictEqual(ch.favoriteAdded.map((d) => d.id), ["f1"]);
  assert.deepStrictEqual(ch.favoriteUpdated, []);
});

/* ---------------- 校验和 ---------------- */

test("sha256Hex 与 node:crypto 对拍（含空串、ASCII、中文、emoji）", () => {
  const vectors = ["", "abc", "NeoBangX 数据导出 ✓", "中文正文".repeat(500), "x".repeat(100000)];
  for (const v of vectors) {
    assert.strictEqual(M.sha256Hex(v), crypto.createHash("sha256").update(v, "utf8").digest("hex"), "向量: " + JSON.stringify(v.slice(0, 20)));
  }
});

test("validateEnvelope 校验 sha256：匹配放行、篡改拒绝、缺字段兼容", () => {
  const env = M.buildEnvelope({
    history: [{ index: { id: "a", title: "t", createdAt: Date.now() }, body: { input: "i", output: "o", fileName: "" } }],
    favorites: [],
    tombstones: { history: [], favorites: [] },
  });
  const withSha = Object.assign({}, env, { sha256: M.sha256Hex(M.serializeEnvelope(env)) });

  const ok = M.validateEnvelope(JSON.stringify(withSha));
  assert.strictEqual(ok.ok, true, "校验和匹配应放行");

  const tampered = JSON.parse(JSON.stringify(withSha));
  tampered.history[0].body.output = "被篡改";
  const bad = M.validateEnvelope(JSON.stringify(tampered));
  assert.strictEqual(bad.ok, false, "内容被篡改必须拒绝");
  assert.ok(bad.reason.indexOf("校验和") !== -1);

  const noSha = M.validateEnvelope(JSON.stringify(env));
  assert.strictEqual(noSha.ok, true, "旧版无校验和文件应兼容导入");

  const badFormat = M.validateEnvelope(JSON.stringify(Object.assign({}, env, { sha256: "xyz" })));
  assert.strictEqual(badFormat.ok, false, "格式非法的校验和应拒绝");

  // 手工重排格式（pretty print）后校验和仍应通过：摘要对规范化序列计算
  const pretty = JSON.stringify(withSha, null, 2);
  assert.strictEqual(M.validateEnvelope(pretty).ok, true, "重排格式不影响校验");
});

/* ---------------- 执行 ---------------- */

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
