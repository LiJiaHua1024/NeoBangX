/* 持久标题任务的前端状态流测试：入队、刷新对账、终态回退与竞态。 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.NbxMirror = require(path.join(__dirname, "..", "nbx-mirror.js"));
const V = require(path.join(__dirname, "..", "nbx-versions.js"));

function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

if (typeof global.matchMedia !== "function") {
  global.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function loadComponent(storage) {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn nbx;"
  );
  const nbx = factory(
    { matchMedia: () => mq }, undefined, storage, undefined, { hostname: "test" }, undefined,
    undefined, undefined, undefined, undefined,
    global.NbxMirror, V, undefined, undefined
  );
  const c = nbx();
  c.$refs = {};
  c.$nextTick = (fn) => { if (fn) fn(); };
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c._mirrorChanged = () => {};
  c.auth.token = "test-token";
  c.auth.user = { code: "TEST-CODE" };
  c.authUser = c.auth.user;
  c.isAuthenticated = true;
  c.authHeaders = () => ({ Authorization: "Bearer test-token" });
  c.scheduleTitlePoll = () => {};
  c.stopTitlePolling = () => {};
  c._titleDelay = async () => {};
  c.currentTool = { id: "1", name: "语篇深度分析", icon: "book" };
  c.selectedModel = "model-a";
  return c;
}

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function seedPending(c, item) {
  item.titlePending = true;
  item.titleContentKey = c._titleContentKey(item);
  c._writeTitleJournal(item.titleJobId, item, item.titleContentKey);
  c.history = [item];
  c._persistHistoryIndex(item.id);
  return item;
}

function makeItem(overrides = {}) {
  return Object.assign({
    id: "history-1",
    toolId: "1",
    toolName: "语篇深度分析",
    icon: "book",
    title: "",
    input: "请分析这篇文章的语言特点",
    output: "文章使用了较多被动句。",
    model: "model-a",
    partial: false,
    error: "",
    createdAt: 1000,
    updatedAt: 1000,
    _bodyLoaded: true,
  }, overrides);
}

const originalFetch = global.fetch;
let passed = 0;
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test("正文历史与本地任务日志先落盘，不等待标题网络请求", async () => {
  const storage = makeStorage();
  const c = loadComponent(storage);
  let resolveFetch;
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const item = makeItem();

  const submission = c.generateTitle(item);
  c._unshiftHistory(item);

  assert.strictEqual(c.history.length, 1, "生成正文不能因标题接口慢而丢历史");
  assert.strictEqual(item.titlePending, true);
  assert.ok(item.titleJobId);
  const journal = JSON.parse(storage.getItem("nbx_title_jobs"));
  assert.ok(journal[item.titleJobId], "关页时可凭本地任务日志幂等补交");
  const index = JSON.parse(storage.getItem("nbx_history"))[0];
  assert.strictEqual(index.title, "");
  assert.strictEqual(index.titlePending, true);
  assert.ok(index.inputHead.startsWith("请分析"));

  resolveFetch(response(202, {
    job_id: item.titleJobId,
    history_id: item.id,
    status: "pending",
    title: "",
    payload_hash: "payload-hash",
  }));
  await submission;
  assert.strictEqual(item.titlePayloadHash, "payload-hash");
});

test("入队网络失败会用同一 job ID 重投三次，不会创建多个任务", async () => {
  const c = loadComponent(makeStorage());
  const bodies = [];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    bodies.push(JSON.parse(options.body));
    return calls < 3 ? response(500, {}) : response(202, { status: "pending" });
  };
  const item = makeItem();

  const submission = c.generateTitle(item);
  c._unshiftHistory(item);
  const accepted = await submission;
  assert.strictEqual(accepted, true);
  assert.strictEqual(calls, 3);
  assert.strictEqual(new Set(bodies.map((body) => body.job_id)).size, 1);
  assert.strictEqual(bodies[0].job_id, item.titleJobId);
});

test("入队最终失败会清掉 pending，既不重试也不提示", async () => {
  const c = loadComponent(makeStorage());
  let calls = 0;
  global.fetch = async () => { calls += 1; return response(503, {}); };
  const item = makeItem();

  const submission = c.generateTitle(item);
  c._unshiftHistory(item);
  const accepted = await submission;
  assert.strictEqual(accepted, false);
  assert.strictEqual(calls, 3);
  assert.strictEqual(item.titlePending, false);
  assert.strictEqual(item.titleJobId, "");
  assert.deepStrictEqual(c.toasts, []);
});

test("刷新后从本地 job ID 对账成功并写回标题", async () => {
  const storage = makeStorage();
  const first = loadComponent(storage);
  const item = makeItem({ titleJobId: "title_persisted_1", titlePending: true });
  seedPending(first, item);

  const refreshed = loadComponent(storage);
  refreshed.history = refreshed._loadHistory();
  global.fetch = async () => response(200, {
    jobs: [{ job_id: "title_persisted_1", history_id: "history-1", status: "succeeded", title: "语言特点分析" }],
  });
  await refreshed.reconcileTitleJobs();

  const current = refreshed.history[0];
  assert.strictEqual(current.title, "语言特点分析");
  assert.strictEqual(current.titlePending, false);
  assert.strictEqual(current.titleJobId, "");
  assert.strictEqual(JSON.parse(storage.getItem("nbx_history"))[0].title, "语言特点分析");
  assert.deepStrictEqual(refreshed.toasts, []);
});

test("最终失败只停止动效并继续显示默认标题", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({ titleJobId: "title_failed_1" }));
  global.fetch = async () => response(200, {
    jobs: [{ job_id: "title_failed_1", history_id: "history-1", status: "failed", title: "" }],
  });

  await c.reconcileTitleJobs();
  assert.strictEqual(item.title, "");
  assert.strictEqual(item.titlePending, false);
  assert.strictEqual(item.titleJobId, "");
  assert.deepStrictEqual(c.toasts, []);
});

test("旧 job 的迟到结果不会覆盖当前 job 或镜像来的标题", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({ titleJobId: "title_current_2" }));
  global.fetch = async () => response(200, {
    jobs: [{ job_id: "title_old_1", history_id: "history-1", status: "succeeded", title: "旧标题" }],
  });

  await c.reconcileTitleJobs();
  assert.strictEqual(item.title, "");
  assert.strictEqual(item.titleJobId, "title_current_2");
  assert.strictEqual(item.titlePending, true);
});

test("对账发现 missing 时用原 job ID 补交，保留幂等性", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({ titleJobId: "title_missing_1" }));
  const urls = [];
  let createCalls = 0;
  global.fetch = async (url) => {
    urls.push(url);
    if (url.endsWith("/status")) {
      return response(200, {
        jobs: [{ job_id: "title_missing_1", history_id: "history-1", status: "missing", title: "" }],
      });
    }
    createCalls += 1;
    return response(202, { status: "pending" });
  };

  await c.reconcileTitleJobs();
  assert.strictEqual(createCalls, 1);
  assert.strictEqual(urls[1], "/api/chat/title-jobs");
  assert.strictEqual(item.titleJobId, "title_missing_1");
  assert.strictEqual(item.titlePending, true);
});

test("对账途中换账号，迟到响应不能写回旧账号标题", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({ titleJobId: "title_auth_1" }));
  let resolveFetch;
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });

  const reconciling = c.reconcileTitleJobs();
  await Promise.resolve();
  c.auth.token = "other-token";
  c.auth.user = { code: "OTHER-CODE" };
  c.authUser = c.auth.user;
  resolveFetch(response(200, {
    jobs: [{ job_id: "title_auth_1", history_id: item.id, status: "succeeded", title: "旧账号标题" }],
  }));
  await reconciling;

  assert.strictEqual(item.title, "");
  assert.strictEqual(item.titlePending, true);
  assert.strictEqual(item.titleJobId, "title_auth_1");
});

test("正文或活动版本变化时废弃旧 job，不会让旧标题覆盖新内容", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({
    titleJobId: "title_old_content",
    output: "旧正文",
  }));
  const oldJobId = item.titleJobId;
  item.output = "新正文";
  let createCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/status")) {
      return response(200, {
        jobs: [{
          job_id: oldJobId,
          history_id: item.id,
          status: "succeeded",
          title: "旧标题",
          payload_hash: "old-hash",
        }],
      });
    }
    createCalls += 1;
    return response(202, { status: "pending", payload_hash: "new-hash" });
  };

  await c.reconcileTitleJobs();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(createCalls, 1);
  assert.notStrictEqual(item.titleJobId, oldJobId);
  assert.strictEqual(item.title, "");
  assert.strictEqual(item.titlePending, true);
  assert.strictEqual(item.titlePayloadHash, "new-hash");
});

test("missing 补交遇到网络故障时保留 pending，交给下一轮对账", async () => {
  const c = loadComponent(makeStorage());
  const item = seedPending(c, makeItem({ titleJobId: "title_missing_retry" }));
  let createCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/status")) {
      return response(200, {
        jobs: [{ job_id: item.titleJobId, history_id: item.id, status: "missing", title: "" }],
      });
    }
    createCalls += 1;
    throw new TypeError("Failed to fetch");
  };

  await c.reconcileTitleJobs();
  assert.strictEqual(createCalls, 3);
  assert.strictEqual(item.titlePending, true);
  assert.strictEqual(item.titleJobId, "title_missing_retry");
  assert.ok(c._titleJournalEntry("title_missing_retry"), "本地任务日志应保留到真正终态");
});

test("外来 pending 记录即使被打开，也不能借机创建新的标题任务", async () => {
  const c = loadComponent(makeStorage());
  const item = makeItem({ titleJobId: "title_foreign_open" });
  item.titlePending = true;
  item.titleContentKey = "old-key";
  c.history = [item];
  let createCalls = 0;
  global.fetch = async (url) => {
    if (!url.endsWith("/status")) createCalls += 1;
    return response(202, { status: "pending" });
  };

  const accepted = await c.generateTitle(item);
  assert.strictEqual(accepted, false);
  assert.strictEqual(createCalls, 0);
  assert.strictEqual(item.titlePending, false);
  assert.strictEqual(item.titleJobId, "");
});

test("导入或镜像的 pending 字段没有本机任务凭据时只清理、不触发 LLM", async () => {
  const c = loadComponent(makeStorage());
  const item = makeItem({ titleJobId: "title_foreign_1" });
  item.titlePending = true;
  item.titleContentKey = c._titleContentKey(item);
  c.history = [item];
  let createCalls = 0;
  global.fetch = async (url) => {
    if (!url.endsWith("/status")) createCalls += 1;
    return response(200, {
      jobs: [{ job_id: item.titleJobId, history_id: item.id, status: "missing", title: "" }],
    });
  };

  await c.reconcileTitleJobs();
  assert.strictEqual(createCalls, 0);
  assert.strictEqual(item.titlePending, false);
  assert.strictEqual(item.titleJobId, "");
});

test("模板与样式都只在 pending 状态给原文摘要加 Shimmer", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.ok(html.includes("'title-shimmer': item.titlePending && isAuthenticated && !_titlePollBlocked"));
  assert.ok(html.includes("item.inputHead || excerpt(item.input)"));
  assert.ok(css.includes(".title-shimmer"));
  assert.ok(css.includes("@keyframes title-shimmer"));
});

(async () => {
  for (const t of cases) {
    try {
      await t.fn();
      passed += 1;
      console.log("  ✓ " + t.name);
    } catch (e) {
      console.error("  ✗ " + t.name);
      console.error("    " + (e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n    ") : e));
    }
  }
  global.fetch = originalFetch;
  console.log(`\n${passed} passed, ${cases.length - passed} failed`);
  process.exit(passed === cases.length ? 0 : 1);
})();
