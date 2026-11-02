/* 生成中断后的前端行为：自动续接、游标推进、放弃与停止
   运行：node --test frontend/tests/stream-reconnect.test.js

   背景：SSE 连接被网络掐断时，后端仍在续接窗口里继续生成（见
   backend/app/services/stream_hub.py）。前端要做到的是：先重连、按事件 id 补齐缺口，
   而不是立刻甩一张「生成中断」的错误卡。

   守住四件事：
   1. 断流（报错或干净结束但没有终止帧）先重连，GET 带 `since=<最后一个完整事件>`
      只补缺口：不重复、不丢字；
   2. 事件 id 只在**整条事件派发之后**才推进——断在事件中间时整条重收；
   3. 重连失败（404/410）或次数用尽才报错，且明确告诉用户「内容还在」；
   4. 用户点停止不重连；长时间没有字节要主动断开重连，不能一直「假生成中」。
*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function loadComponent() {
  const mqStub = (query) => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    media: query,
    matches: false,
  });
  global.matchMedia = mqStub;
  global.marked = { setOptions: () => {}, use: () => {} };
  global.DOMPurify = { addHook: () => {}, sanitize: (s) => s };
  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: mqStub,
    marked: global.marked,
    DOMPurify: global.DOMPurify,
    location: { origin: "http://localhost:8000", hostname: "localhost" },
  };
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { nbx: nbx };"
  );
  const api = factory(
    win, undefined, makeStorage(), undefined, win.location,
    undefined, { now: () => Date.now() }, (fn) => setTimeout(() => fn(0), 0),
    undefined, undefined, undefined, undefined, undefined, undefined
  );
  const c = api.nbx();
  c.$refs = {};
  c.toasts = [];
  c.toast = function (msg, type) { this.toasts.push({ msg, type }); };
  c.auth = { token: "" };
  c.authHeaders = () => ({});
  c.stopThinkTimer = () => {};
  c.handleAuthFailure = () => {};
  c.notifyStop = function (id) { (this.stops || (this.stops = [])).push(id); };
  c.output = "";
  c.streaming = true;
  // 测试里把等待与卡死判定压到毫秒级
  c.streamStallMs = 40;
  c.streamReconnectDelays = [0, 5, 10, 20, 40, 80];
  return c;
}

const enc = new TextEncoder();

function frame(eventName, data, id) {
  return `${id != null ? `id: ${id}\n` : ""}event: ${eventName}\ndata: ${data}\n\n`;
}

function response(chunks, { headers = {}, error = null } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      if (error) setTimeout(() => controller.error(error), 0);
      else controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

function stalledResponse(signal) {
  const stream = new ReadableStream({
    start(controller) {
      if (signal) {
        signal.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        });
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "X-Stream-Id": "s" } });
}

function installFetch(queue) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", signal: opts.signal });
    const next = queue.shift();
    if (!next) throw new Error("没有预设的响应了：" + url);
    return typeof next === "function" ? next(url, opts) : next;
  };
  global.fetch.calls = calls;
  return calls;
}

async function runChat(c, over = {}) {
  const out = { text: "", reasoning: "" };
  const promise = c._streamChat({
    toolId: "1",
    input: "材料",
    requestId: over.requestId || "req-1",
    // 与生产一致：正文由上层累加到 output（giveUp 的文案据此区分「写了一半」与「没开始」）
    onToken: (text) => { out.text += text; c.output += text; },
    onReasoning: (text) => { out.reasoning += text; },
  });
  return { promise, out };
}

test("连接中途报错：自动续接，只补缺口，不重复不丢字", async () => {
  const c = loadComponent();
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("前半"), 1)], {
      headers: { "X-Stream-Id": "stream-1" },
      error: new TypeError("network error"),
    }),
    () => response([
      frame("token", JSON.stringify("后半"), 2),
      frame("done", "[DONE]", 3),
    ]),
  ]);
  const { promise, out } = await runChat(c);
  const result = await promise;

  assert.equal(result.state, "done");
  assert.equal(out.text, "前半后半");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[1].url, /^\/api\/chat\/stream\/stream-1\?since=1$/);
  assert.equal(c.reconnecting, false);
  assert.equal(c.streaming, true, "流式状态不该被一次抖动打断");
});

test("干净结束但没有终止帧：同样按中断续接", async () => {
  const c = loadComponent();
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("A"), 1)]),
    () => response([frame("token", JSON.stringify("B"), 2), frame("done", "[DONE]", 3)]),
  ]);
  const { promise, out } = await runChat(c);
  const result = await promise;
  assert.equal(result.state, "done");
  assert.equal(out.text, "AB");
  assert.match(calls[1].url, /since=1$/);
});

test("断在事件中间：整条重收，id 游标不前进", async () => {
  const c = loadComponent();
  const calls = installFetch([
    // 第 2 条事件只有 id 行与半截 data，没有空行
    () => response([
      frame("token", JSON.stringify("前半"), 1),
      'id: 2\nevent: token\ndata: "半',
    ]),
    () => response([
      frame("token", JSON.stringify("后半"), 2),
      frame("done", "[DONE]", 3),
    ]),
  ]);
  const { promise, out } = await runChat(c);
  const result = await promise;
  assert.equal(result.state, "done");
  // 半截 "半" 不能被拼进正文；续接从 1 之后重发完整事件
  assert.equal(out.text, "前半后半");
  assert.match(calls[1].url, /since=1$/);
});

test("续接被服务端拒绝（会话过期）：不再重试，内容保留并给出继续生成建议", async () => {
  const c = loadComponent();
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("写了一半"), 1)], {
      headers: { "X-Stream-Id": "stream-gone" },
      error: new TypeError("network error"),
    }),
    () => new Response(JSON.stringify({ detail: "这次生成已经结束，无法续接" }), { status: 404 }),
  ]);
  const { promise, out } = await runChat(c);
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, "network_lost");
    assert.match(err.message, /保留/);
    return true;
  });
  assert.equal(out.text, "写了一半", "已生成的内容不能丢");
  assert.equal(calls.length, 2, "404 之后不该继续重试");
  assert.equal(c.stops.length, 1, "放弃时通知服务端停止，别让它继续烧 token");
});

test("多次重连仍失败：给出网络中断文案，而不是原生 TypeError", async () => {
  const c = loadComponent();
  c.streamReconnectDelays = [0, 1];
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("x"), 1)], {
      headers: { "X-Stream-Id": "s" },
      error: new TypeError("network error"),
    }),
    () => { throw new TypeError("Failed to fetch"); },
  ]);
  const { promise } = await runChat(c);
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, "network_lost");
    assert.equal(err.networkIssue, true, "网络中断不能把当前模型记成失败模型");
    assert.match(err.message, /网络断开太久/);
    return true;
  });
  assert.equal(calls.length, 2);
});

test("用户停止：立即中止，不再发起续接", async () => {
  const c = loadComponent();
  const calls = installFetch([
    (url, opts) => stalledResponse(opts.signal),
  ]);
  const { promise } = await runChat(c);
  await new Promise((r) => setTimeout(r, 10));
  c.streaming = true;
  c.stop();
  await assert.rejects(promise, (err) => err && err.name === "AbortError");
  assert.equal(calls.length, 1, "用户停止后不该再发续接请求");
  assert.equal(c.stops.length, 1);
});

test("长时间收不到字节：主动断开并续接，而不是一直假装在生成", async () => {
  const c = loadComponent();
  const calls = installFetch([
    (url, opts) => stalledResponse(opts.signal),
    () => response([frame("token", JSON.stringify("接上了"), 1), frame("done", "[DONE]", 2)]),
  ]);
  const { promise, out } = await runChat(c);
  const result = await promise;
  assert.equal(result.state, "done");
  assert.equal(out.text, "接上了");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "GET");
});

test("续接成功后显示一次「已恢复连接」，随后自动收起", async () => {
  const c = loadComponent();
  installFetch([
    () => response([frame("token", JSON.stringify("a"), 1)], {
      headers: { "X-Stream-Id": "s" },
      error: new TypeError("network error"),
    }),
    // 续接响应故意晚 420ms 才到：超过「重连提示」350ms 的显示门槛，
    // 这样才走真实的「用户已经看到重连、随后恢复」路径
    async (url, opts) => {
      await new Promise((r) => setTimeout(r, 420));
      return stalledResponse(opts.signal);
    },
  ]);
  const { promise } = await runChat(c);
  await new Promise((r) => setTimeout(r, 460));
  assert.equal(c.reconnected, true, "续接响应到达后应给出恢复确认");
  assert.equal(c.reconnecting, false);
  // 收尾：让挂起的 promise 结束，避免测试进程一直等
  c.stop();
  await promise.catch(() => {});
});

test("首连就失败：带同一个 request_id 重发 POST，接回同一次生成", async () => {
  const c = loadComponent();
  const calls = installFetch([
    () => { throw new TypeError("Failed to fetch"); },
    () => response([frame("token", JSON.stringify("接上了"), 1), frame("done", "[DONE]", 2)]),
  ]);
  const { promise, out } = await runChat(c);
  const result = await promise;
  assert.equal(result.state, "done");
  assert.equal(out.text, "接上了");
  assert.equal(calls.length, 2);
  // 没有 streamId 可续接时只能重发 POST；服务端按 request_id 幂等接回，不会重复计费
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].method, "POST");
});

test("首连重发也失败：给出「没开始生成」的文案，而不是「内容已保留」", async () => {
  const c = loadComponent();
  c.streamReconnectDelays = [0, 1];
  installFetch([
    () => { throw new TypeError("Failed to fetch"); },
    () => { throw new TypeError("Failed to fetch"); },
  ]);
  const { promise, out } = await runChat(c);
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, "network_lost");
    assert.match(err.message, /没能开始生成/);
    assert.equal(err.advice, "");
    return true;
  });
  assert.equal(out.text, "");
});

/* ---------------- 错题迁移：每张卡片各自续接 ---------------- */

function migrationCard(c) {
  c.migration = { stopRequested: false, results: [] };
  c.selectedModel = "m1";
  c._migrationAbortControllers = {};
  c.migrationBuildInput = () => "材料";
  c.appendCardReasoning = () => {};
  c.scheduleCardRender = () => {};
  c.renderMd = (text) => text;
  c.migrationReadError = async () => "读取失败";
  c.handleAuthFailure = () => {};
  return {
    id: "card-1",
    requestId: "mig_1_abc",
    causeId: "c1",
    cause: "时态混用",
    output: "",
    rendered: "",
    status: "waiting",
    error: "",
    streaming: true,
    reasoning: "",
    reasoningDone: false,
    reasoningOpen: true,
  };
}

test("迁移卡片断流后按 request_id 续接，不重复、不丢字", async () => {
  const c = loadComponent();
  const card = migrationCard(c);
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("A"), 1)], {
      headers: { "X-Stream-Id": "mig_1_abc" },
      error: new TypeError("network error"),
    }),
    () => response([frame("token", JSON.stringify("B"), 2), frame("done", "[DONE]", 3)]),
  ]);
  await c.streamMigrationCard(card, 0, "batch-1", 1);
  assert.equal(card.output, "AB");
  assert.equal(card.status, "done");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[1].url, /\/api\/chat\/stream\/mig_1_abc\?since=1$/);
});

test("迁移卡片续接被拒：标为失败但保留已生成正文", async () => {
  const c = loadComponent();
  const card = migrationCard(c);
  card.output = "已经生成的一段";
  installFetch([
    () => response([frame("token", JSON.stringify("A"), 1)], {
      headers: { "X-Stream-Id": "mig_gone" },
      error: new TypeError("network error"),
    }),
    () => new Response(JSON.stringify({ detail: "gone" }), { status: 404 }),
  ]);
  await c.streamMigrationCard(card, 0, "batch-1", 1);
  assert.equal(card.status, "error");
  assert.match(card.error, /已生成的内容已保留/);
  assert.equal(card.output, "已经生成的一段A");
});

test("迁移卡片用户停止后不再重连", async () => {
  const c = loadComponent();
  const card = migrationCard(c);
  const calls = installFetch([
    (url, opts) => stalledResponse(opts.signal),
  ]);
  const p = c.streamMigrationCard(card, 0, "batch-1", 1);
  await new Promise((r) => setTimeout(r, 10));
  c.migration.stopRequested = true;
  Object.values(c._migrationAbortControllers).forEach((ctrl) => ctrl.abort());
  await p;
  assert.equal(card.status, "stopped");
  assert.equal(calls.length, 1);
});

/* ---------------- 图片识别：一键识别也要能续接 ---------------- */

function ocrComponent(c) {
  c.ocrStage = "ready";
  c.ocrImages = [{ dataUrl: "data:image/png;base64,xx" }];
  c.ocrPairToken = "";
  c.ocrMode = "printed";
  c.ocrText = "";
  c.ocrRendered = "";
  c.ocrError = "";
  c.ocrTruncated = false;
  c._ocrCancelReason = "";
  c.ocrHost = "page";
  c.ocrStartStep = true;
  c.requireCodeForOcr = () => true;
  c.retreatMascot = () => {};
  c._ocrDefaultCollapsed = () => true;
  c._startOcrTimer = () => {};
  c._stopOcrTimer = () => {};
  c.scheduleOcrRender = () => {};
  c.finishOcrRender = () => {};
  c.flushOcrRender = () => {};
  c.pushOcrHistory = () => {};
  return c;
}

test("图片识别断线后从断点续接，不重复识别、不丢字", async () => {
  const c = loadComponent();
  ocrComponent(c);
  const calls = installFetch([
    () => response([frame("token", JSON.stringify("第一张"), 1)], {
      headers: { "X-Stream-Id": "ocr_1" },
      error: new TypeError("network error"),
    }),
    () => response([frame("token", JSON.stringify("第二张"), 2), frame("done", "[DONE]", 3)]),
  ]);
  await c.ocrStart();
  assert.equal(c.ocrText, "第一张第二张");
  assert.equal(c.ocrStage, "done");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[1].url, /\/api\/chat\/stream\/ocr_1\?since=1$/);
  assert.equal(c.ocrReconnecting, false);
});

test("图片识别续接失败：保留已识别文字并标失败", async () => {
  const c = loadComponent();
  ocrComponent(c);
  installFetch([
    () => response([frame("token", JSON.stringify("半卷"), 1)], {
      headers: { "X-Stream-Id": "ocr_gone" },
      error: new TypeError("network error"),
    }),
    () => new Response(JSON.stringify({ detail: "gone" }), { status: 404 }),
  ]);
  await c.ocrStart();
  assert.equal(c.ocrText, "半卷");
  assert.equal(c.ocrStage, "error");
  assert.match(c.ocrError, /网络断开太久/);
});
