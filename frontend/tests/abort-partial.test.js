/* 中断落盘（「停止并保存残文」）与历史卡片键盘可达 用例
   运行：node --test frontend/tests/abort-partial.test.js

   背景：切工具 / 回首页 / 新建题目 / 查看历史 / 关页刷新这五条路径原先都会作废在途
   生成，而作废后的收尾（finalize）因代次不符直接 return —— 屏幕上那份残文与这条记录
   一起消失，用户白等一场。修法是作废之前先落盘。

   守住四件事：
   1. 中断一定落盘，且落对地方：续写/重试就地更新原记录，重新生成追加为新版本，
      首次生成新建一条 partial 记录；
   2. 零产出不占位（与 finalize / finalizeTr 同一口径），不在历史里刷空记录；
   3. 关页/刷新真的接上了（pagehide → 落盘 + keepalive 通知后端停止），
      且落盘发生在代次递增之前；
   4. 历史卡片的 Enter/空格不会与卡片内的删除按钮互相误伤。

   被测方法写在 index.html 加载的 script.js 里（浏览器脚本，无法 require），
   所以从源码里抽出方法体，配上手写的 this 与真实的 NbxVersions 模块来跑。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const NbxVersions = require(path.join(ROOT, "nbx-versions.js"));

/* ---------------- 从源码抽取 ---------------- */

/* 从声明起点开始，按大括号配对抽出整个方法 / 函数（含签名）。
   配对从「签名末尾那个 {」开始——参数里可能还有解构花括号（如 { keepalive = false } = {}） */
function sliceDecl(startIdx, braceIdx) {
  assert.ok(SRC[braceIdx] === "{", "抽取位置不是函数体的左花括号");
  let depth = 0;
  let i = braceIdx;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SRC.slice(startIdx, i + 1);
}

function extractMethod(name) {
  // 签名必须整行形如 `name(...) {`：宽松匹配会把方法体里的 `stop();` 这类调用当成定义
  const m = new RegExp(`^    ${name}\\(.*\\) \\{$`, "m").exec(SRC);
  assert.ok(m, `未找到方法 ${name}，源码结构变了要同步这个用例`);
  return sliceDecl(m.index, m.index + m[0].length - 1);
}

function extractFn(name) {
  const m = new RegExp(`^function ${name}\\(.*\\) \\{$`, "m").exec(SRC);
  assert.ok(m, `未找到函数 ${name}`);
  return sliceDecl(m.index, m.index + m[0].length - 1);
}

function extractConst(name) {
  const m = new RegExp(`^const ${name} = ("[^"]*");$`, "m").exec(SRC);
  assert.ok(m, `未找到常量 ${name}`);
  return JSON.parse(m[1]);
}

const TRANSLATE_TOOL_ID = extractConst("TRANSLATE_TOOL_ID");
const TRANSLATE_TOOL_ICON = extractConst("TRANSLATE_TOOL_ICON");
const TR_DEFAULT_SOURCE = extractConst("TR_DEFAULT_SOURCE");
const TR_DEFAULT_TARGET = extractConst("TR_DEFAULT_TARGET");
const historyTitleFromText = new Function(`return (${extractFn("historyTitleFromText")})`)();

/* 方法体里的自由标识符由工厂参数注入：常量与 NbxVersions 都走这条路 */
const BINDINGS = {
  TRANSLATE_TOOL_ID,
  TRANSLATE_TOOL_ICON,
  TR_DEFAULT_SOURCE,
  TR_DEFAULT_TARGET,
  historyTitleFromText,
  NbxVersions,
};

function bindMethod(name, params) {
  const code = extractMethod(name);
  // eslint-disable-next-line no-new-func
  return new Function(...params, `return function ${code}`)(...params.map((p) => BINDINGS[p]));
}

const BIND = ["TRANSLATE_TOOL_ID", "TRANSLATE_TOOL_ICON", "TR_DEFAULT_SOURCE", "TR_DEFAULT_TARGET", "historyTitleFromText", "NbxVersions"];
const saveAbortedPartial = bindMethod("_saveAbortedPartial", BIND);
const saveAbortedTranslate = bindMethod("_saveAbortedTranslate", BIND);
const vpPartialSnapshot = bindMethod("_vpPartialSnapshot", BIND);
const onHistoryCardKey = bindMethod("onHistoryCardKey", []);
const focusHistoryCard = bindMethod("focusHistoryCard", []);
const historyCardLabel = bindMethod("historyCardLabel", []);

/* ---------------- 手写的 this ---------------- */

function makeCtx(over = {}) {
  const persisted = [];
  const ctx = {
    streaming: true,
    output: "已经生成的前半篇",
    selectedModel: "model-current",
    isTranslateTool: false,
    isVisualPaperTool: false,
    visualPaper: null,
    history: [],
    activeHistoryId: null,
    // 在途流的模式快照（_runStream 里写下）
    _streamCtx: { updateId: null, newVersion: false, modelUsed: "model-stream" },
    _hydrateHistory(item) { item._bodyLoaded = true; },
    _persistHistoryItem(item) { persisted.push(item.id); },
    // 真实实现里 pushHistory → commitHistoryWithTitle → _unshiftHistory → 落盘，这里照抄这条链
    pushHistory(partial, modelUsed) {
      return this._unshiftHistory({
        id: "new-" + (this.history.length + 1),
        partial: !!partial,
        output: this.output,
        model: modelUsed || "",
      });
    },
    _unshiftHistory(item) {
      this.history.unshift(item);
      this._persistHistoryItem(item);
      return item;
    },
    _persisted: persisted,
  };
  Object.assign(ctx, over);
  ctx._persisted = persisted;
  for (const [name, fn] of [
    ["_saveAbortedPartial", saveAbortedPartial],
    ["_vpPartialSnapshot", vpPartialSnapshot],
  ]) {
    ctx[name] = fn;
  }
  return ctx;
}

/* ---------------- 1. 落盘到哪里 ---------------- */

test("首次生成中途中断 → 新建一条 partial 记录，正文是残文", () => {
  const ctx = makeCtx();
  const item = ctx._saveAbortedPartial();
  assert.equal(ctx.history.length, 1);
  assert.equal(item, ctx.history[0]);
  assert.equal(item.partial, true);
  assert.equal(item.output, "已经生成的前半篇");
  assert.deepEqual(ctx._persisted, [item.id], "新建记录也要落盘");
  assert.equal(ctx.activeHistoryId, item.id, "记录指针要接回这条残文（继续生成写回同一条）");
});

test("记录里的模型取在途快照，不是中断那一刻的选中模型", () => {
  const ctx = makeCtx({ selectedModel: "model-switched-midway" });
  const item = ctx._saveAbortedPartial();
  assert.equal(item.model, "model-stream");
});

test("续写/重试中途中断 → 就地更新原记录，不新增一条", () => {
  const origin = {
    id: "h1", output: "旧的半篇", partial: true, error: "上一次的报错", model: "model-old",
    versions: [{ id: "v1", output: "旧的半篇", model: "model-old", at: 1, partial: true, error: "上一次的报错" }],
    activeVersionId: "v1",
  };
  const ctx = makeCtx({
    history: [origin],
    _streamCtx: { updateId: "h1", newVersion: false, modelUsed: "model-stream" },
  });
  const item = ctx._saveAbortedPartial();
  assert.equal(ctx.history.length, 1, "不该新增记录");
  assert.equal(item, origin);
  assert.equal(origin.output, "已经生成的前半篇");
  assert.equal(origin.partial, true);
  assert.equal(origin.error, "", "这一轮没报错，旧的错误标记要撤掉");
  assert.equal(origin.model, "model-stream");
  assert.deepEqual(ctx._persisted, ["h1"]);
  // 版本容器必须跟着走，否则下次切换版本会把这次的内容覆盖回旧正文
  assert.equal(origin.versions[0].output, "已经生成的前半篇");
  assert.equal(origin.versions[0].partial, true);
});

test("重新生成中途中断 → 残文作为新版本追加，旧版本仍在", () => {
  const origin = {
    id: "h2", output: "旧的一版", partial: false, error: "", model: "model-old",
    versions: [{ id: "v1", output: "旧的一版", model: "model-old", at: 1, partial: false, error: "" }],
    activeVersionId: "v1",
  };
  const ctx = makeCtx({
    history: [origin],
    _streamCtx: { updateId: "h2", newVersion: true, modelUsed: "model-stream" },
  });
  const item = ctx._saveAbortedPartial();
  assert.equal(item, origin);
  assert.equal(origin.versions.length, 2, "残文应成为第二版");
  assert.equal(origin.versions[0].output, "旧的一版", "旧结果不能被覆盖");
  assert.equal(origin.output, "已经生成的前半篇", "活动版本应是残文");
  assert.equal(origin.partial, true);
  assert.equal(origin.activeVersionId, origin.versions[1].id);
});

test("updateId 指向的记录已被删除 → 退回新建，不报错", () => {
  const ctx = makeCtx({ _streamCtx: { updateId: "gone", newVersion: false, modelUsed: "m" } });
  const item = ctx._saveAbortedPartial();
  assert.equal(ctx.history.length, 1);
  assert.equal(item.partial, true);
});

/* ---------------- 2. 不该落盘的情形 ---------------- */

test("零产出（一个字都没写出来）→ 不占位", () => {
  for (const blank of ["", "   ", "\n\n"]) {
    const ctx = makeCtx({ output: blank });
    assert.equal(ctx._saveAbortedPartial(), null);
    assert.equal(ctx.history.length, 0, `output=${JSON.stringify(blank)} 不该留下记录`);
    assert.deepEqual(ctx._persisted, []);
  }
});

test("没有在途流（streaming 为假）→ 不落盘", () => {
  const ctx = makeCtx({ streaming: false });
  assert.equal(ctx._saveAbortedPartial(), null);
  assert.equal(ctx.history.length, 0);
});

test("翻译工具 → 交给翻译口径处理（改而不增）", () => {
  const ctx = makeCtx({ isTranslateTool: true });
  const calls = [];
  ctx._saveAbortedTranslate = (text, modelUsed) => { calls.push([text, modelUsed]); return null; };
  ctx._saveAbortedPartial();
  assert.deepEqual(calls, [["已经生成的前半篇", "model-stream"]]);
  assert.equal(ctx.history.length, 0, "不该走通用路径建记录");
});

/* ---------------- 3. 翻译口径 ---------------- */

function makeTrCtx(over = {}) {
  return makeCtx({
    isTranslateTool: true,
    _saveAbortedTranslate: saveAbortedTranslate,
    submittedInput: "源文第一行\n第二行",
    trHistoryId: "",
    activeHistoryId: "",
    trTruncated: false,
    _trSnap: { source: "源文第一行\n第二行", sourceId: "en", targetId: "zh-Hans" },
    ...over,
  });
}

test("翻译：首次中断新建记录，语言对与标题一并写入", () => {
  const ctx = makeTrCtx();
  const item = ctx._saveAbortedTranslate("译出来的半篇", "model-stream");
  assert.equal(ctx.history.length, 1);
  assert.equal(item.toolId, TRANSLATE_TOOL_ID);
  assert.equal(item.output, "译出来的半篇");
  assert.equal(item.partial, true);
  assert.equal(item.input, "源文第一行\n第二行");
  assert.equal(item.title, "源文第一行");
  assert.deepEqual(item.translate, { source: "en", target: "zh-Hans", truncated: false });
  assert.equal(ctx.trHistoryId, item.id, "记录指针要接回这一条");
});

test("翻译：已有记录时原地更新，不新增一条", () => {
  const origin = { id: "t1", output: "旧的译文", partial: false, error: "", translate: { source: "en", target: "zh-Hans" } };
  const ctx = makeTrCtx({ history: [origin], trHistoryId: "t1" });
  const item = ctx._saveAbortedTranslate("译出来的半篇", "model-stream");
  assert.equal(ctx.history.length, 1);
  assert.equal(item, origin);
  assert.equal(origin.output, "译出来的半篇");
  assert.equal(origin.partial, true);
  assert.equal(origin.error, "");
  assert.deepEqual(ctx._persisted, ["t1"]);
});

test("翻译：撞输出上限的截断标记跟着残文一起留下", () => {
  const ctx = makeTrCtx({ trTruncated: true });
  const item = ctx._saveAbortedTranslate("译到一半", "m");
  assert.equal(item.translate.truncated, true);
});

/* ---------------- 4. 试卷可视化的结构化快照 ---------------- */

test("工具 13：残文之外还带上已解析的题目快照，并接回记录", () => {
  const paper = { groups: [{ questions: [{ no: 1 }] }], total: 20, paper: { title: "某卷" } };
  const ctx = makeCtx({ isVisualPaperTool: true, visualPaper: { ...paper } });
  const item = ctx._saveAbortedPartial();
  assert.deepEqual(item.visualPaper, paper, "快照要写进记录");
  assert.equal(ctx.visualPaper.historyId, item.id, "卷子的记录指针要接回来，否则下次续写又新建一条");
  assert.equal(ctx._persisted.length, 2, "带快照时要再落一次盘");
});

test("工具 13：一题都没解析出来时不写空快照", () => {
  const ctx = makeCtx({ isVisualPaperTool: true, visualPaper: { groups: [], total: 0, paper: {} } });
  assert.equal(ctx._vpPartialSnapshot(), null);
  const item = ctx._saveAbortedPartial();
  assert.equal(item.visualPaper, undefined);
});

test("非试卷工具不会带 visualPaper 快照", () => {
  const ctx = makeCtx({ isVisualPaperTool: false, visualPaper: { groups: [{ q: 1 }], total: 3 } });
  assert.equal(ctx._vpPartialSnapshot(), null);
  const item = ctx._saveAbortedPartial();
  assert.equal(item.visualPaper, undefined);
  assert.equal(ctx.visualPaper.historyId, undefined, "非试卷工具不该去接卷子的记录指针");
});

/* ---------------- 5. 接线：中断路径与关页 ---------------- */

test("abortActiveGeneration 在递增代次之前落盘", () => {
  const body = extractMethod("abortActiveGeneration");
  const saveAt = body.indexOf("this._saveAbortedPartial()");
  const seqAt = body.indexOf("this._runSeq += 1");
  assert.ok(saveAt >= 0, "作废在途生成时要先落盘残文");
  assert.ok(seqAt >= 0, "代次递增是作废的标志");
  assert.ok(saveAt < seqAt, "落盘必须早于代次递增：递增后在途流的收尾就直接 return 了");
});

test("四条中断路径的确认弹窗都说明「会保存到历史记录」", () => {
  const msgs = [...SRC.matchAll(/message: "(正在生成中[^"]*)"/g)].map((m) => m[1]);
  assert.equal(msgs.length, 4, "守卫弹窗数量变了要同步这个用例");
  for (const who of ["切换工具", "返回首页", "开始新题目", "查看历史"]) {
    const hit = msgs.find((m) => m.includes(who));
    assert.ok(hit, `没有找到「${who}」的确认文案`);
    assert.ok(hit.includes("保存到历史记录"), `「${who}」的文案没说清会保存残文：${hit}`);
  }
});

test("关页 / 刷新接上了 pagehide，并与「停止」同路收尾", () => {
  assert.match(SRC, /addEventListener\("pagehide", \(\) => this\._onPageHide\(\)\)/);
  const hide = extractMethod("_onPageHide");
  assert.ok(hide.includes("this.abortActiveGeneration({ keepalive: true })"), "关页要走作废路径并带 keepalive");
  const abort = extractMethod("abortActiveGeneration");
  assert.ok(abort.includes("this._saveAbortedPartial()"), "作废时要先落盘残文");
  assert.ok(abort.includes("notifyStop(requestId, keepalive)"), "keepalive 要透传给停止通知");
  assert.ok(abort.includes("this.status = "), "作废后状态要落定，不能停在「生成中」");
  // 页面被 bfcache 留住时，流若跑完不得再写一条完整记录（会与残文重复）
  assert.ok(abort.includes("this._runSeq += 1"), "作废要递增代次，让旧流的收尾失效");
});

test("keepalive 只在关页路径上传，普通停止不受影响", () => {
  const notify = extractMethod("notifyStop");
  assert.match(notify, /notifyStop\(requestId, keepalive = false\)/, "keepalive 默认关闭");
  assert.match(notify, /keepalive,/);
  assert.ok(extractMethod("stop").includes("this.notifyStop(requestId)"), "点「停止」仍走默认参数");
});

/* ---------------- 6. 历史卡片的键盘可达 ---------------- */

test("历史卡片带上了 role / tabindex / 读屏名与键盘处理", () => {
  const start = HTML.indexOf('<template x-for="(item, i) in historyRows"');
  assert.ok(start > 0, "没找到历史卡片模板");
  const block = HTML.slice(start, HTML.indexOf("</template>", start));
  assert.match(block, /role="button"/, "卡片要能被读屏识别为可操作控件");
  assert.match(block, /tabindex="0"/, "卡片要能被 Tab 聚焦");
  assert.match(block, /:aria-label="historyCardLabel\(item\)"/, "卡片要有读屏名");
  assert.match(block, /@keydown="onHistoryCardKey\(\$event, item, i\)"/, "卡片要处理键盘");
});

function keyEvent(target, currentTarget, key) {
  return {
    target, currentTarget, key,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

test("卡片上按 Enter / 空格 → 打开这条记录", () => {
  for (const key of ["Enter", " "]) {
    const opened = [];
    const card = {};
    const ev = keyEvent(card, card, key);
    onHistoryCardKey.call({ openHistory: (i) => opened.push(i), focusHistoryCard: () => {} }, ev, "item-1", 0);
    assert.deepEqual(opened, ["item-1"], `${key} 应打开记录`);
    assert.equal(ev.defaultPrevented, true, "空格默认会滚动页面，要拦掉");
  }
});

test("卡片里删除按钮上的按键不会连带打开记录", () => {
  const opened = [];
  const moved = [];
  const card = {};
  const inner = {};
  const ev = keyEvent(inner, card, "Enter");
  onHistoryCardKey.call({ openHistory: (i) => opened.push(i), focusHistoryCard: (i) => moved.push(i) }, ev, "item-1", 0);
  assert.deepEqual(opened, [], "事件源不是卡片本身，不该打开");
  assert.equal(ev.defaultPrevented, false, "也不该吞掉这次按键");
  assert.deepEqual(moved, []);
});

test("↑↓ 在卡片之间移动焦点，越界不动", () => {
  const moved = [];
  const ctx = { openHistory: () => {}, focusHistoryCard: (i) => moved.push(i) };
  const card = {};
  const down = keyEvent(card, card, "ArrowDown");
  onHistoryCardKey.call(ctx, down, "item", 3);
  const up = keyEvent(card, card, "ArrowUp");
  onHistoryCardKey.call(ctx, up, "item", 3);
  assert.deepEqual(moved, [4, 2]);
  assert.equal(down.defaultPrevented, true, "方向键默认会滚动列表，要拦掉");
});

test("其他按键不干预（Tab 要能正常走出卡片）", () => {
  const moved = [];
  const ctx = { openHistory: () => {}, focusHistoryCard: (i) => moved.push(i) };
  const card = {};
  for (const key of ["Tab", "a", "Escape", "ArrowLeft"]) {
    const ev = keyEvent(card, card, key);
    onHistoryCardKey.call(ctx, ev, "item", 1);
    assert.equal(ev.defaultPrevented, false, `${key} 不该被吞掉`);
  }
  assert.deepEqual(moved, []);
});

test("焦点移动只在列表范围内发生", () => {
  const focused = [];
  const rows = [{ id: "a" }, { id: "b" }];
  const ctx = {
    historyRows: rows,
    $nextTick: (fn) => fn(),
    $refs: {
      historySearchList: {
        querySelector: (sel) => { focused.push(sel); return { focus: () => {} }; },
      },
    },
  };
  focusHistoryCard.call(ctx, 1);
  assert.deepEqual(focused, ['[data-hs-i="1"]']);
  focused.length = 0;
  focusHistoryCard.call(ctx, 2);   // 越界：没有第 3 张卡片
  focusHistoryCard.call(ctx, -1);
  assert.deepEqual(focused, [], "越界时不该去找不存在的卡片");
});

test("读屏名带上工具、标题与状态", () => {
  const ctx = { excerpt: () => "" };
  assert.equal(
    historyCardLabel.call(ctx, { toolName: "翻译", title: "某篇", partial: false }),
    "翻译，某篇"
  );
  assert.equal(
    historyCardLabel.call(ctx, { toolName: "学生作文批改", inputHead: "My Weekend", partial: true }),
    "学生作文批改，My Weekend，已停止，可继续生成"
  );
  assert.equal(
    historyCardLabel.call(ctx, { toolName: "试卷可视化全解", inputHead: "某卷", partial: true, toolId: "13" }),
    "试卷可视化全解，某卷，待补全，可继续生成"
  );
  assert.equal(
    historyCardLabel.call(ctx, { toolName: "自由对话", inputHead: "问题", error: "超时", verCount: 3 }),
    "自由对话，问题，生成失败，3 个版本"
  );
  assert.equal(historyCardLabel.call(ctx, null), "");
});


