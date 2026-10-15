/* 自由对话 · 工具推荐标记（[[tool:10]]）渲染用例
   运行：npm test（node --test）

   这块的风险全在「模型输出的编号如何变入口卡片」上：
   1. 只用编号，名称/图标由本地工具表解析；未知编号必须丢弃而不是裸奔；
   2. 编号→入口的映射来自工具列表，标记本身不带名字；
   3. 流式期间被 token 切断的残片（[[tool:1）不能显示成裸文本；
   4. 流式淡入的不可见分隔符（FADE_MARK）可能被插进标记内部，也要能识别；
   5. 普通正文里的方括号、数学公式之类不受影响。 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

// script.js 有裸 matchMedia 调用，Node 没有这个全局
if (typeof global.matchMedia !== "function") {
  const mq = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  };
  global.matchMedia = () => mq;
}

function loadApi() {
  const factory = new Function(
    "window", "document", "localStorage", "sessionStorage", "location", "navigator",
    "performance", "requestAnimationFrame", "MutationObserver", "IntersectionObserver",
    "NbxMirror", "NbxVersions", "NbxMirrorStore", "NbxMirrorPeer",
    SRC + "\nreturn { renderMd, NBX_TOOLS_BY_ID };"
  );
  return factory(
    { matchMedia: global.matchMedia }, undefined, undefined, undefined,
    { origin: "http://localhost:8000", hostname: "localhost" }, undefined,
    undefined, (fn) => setTimeout(() => fn(0), 0), undefined, undefined,
    undefined, undefined, undefined, undefined
  );
}

// 与真实 /api/tools/ 同形的两条工具
const TOOLS = {
  "10": { id: "10", name: "学生作文批改", icon: "correction", description: "评分 + 修改建议 + 改进版本" },
  "13": { id: "13", name: "试卷可视化全解", icon: "projector", description: "整卷题目与解析的课堂投影版" },
};

function setup() {
  const api = loadApi();
  for (const [id, tool] of Object.entries(TOOLS)) api.NBX_TOOLS_BY_ID[id] = tool;
  return api;
}

test("编号渲染成可点击入口卡片，带本地工具名", () => {
  const { renderMd } = setup();
  const html = renderMd("最合适的是：\n\n[[tool:10]]\n\n点一下就能用。");
  assert.ok(/class="nbx-tool-link"/.test(html), "应有入口卡片");
  assert.ok(/data-tool-id="10"/.test(html), "应带编号供点击跳转");
  assert.ok(html.includes("学生作文批改"), "工具名由本地工具表解析，不靠模型写");
  assert.ok(!html.includes("[[tool"), "裸标记不能漏到页面上");
});

test("多个标记各自渲染，互不干扰", () => {
  const { renderMd } = setup();
  const html = renderMd("[[tool:10]]\n\n或者\n\n[[tool:13]]");
  assert.ok(html.includes("学生作文批改"));
  assert.ok(html.includes("试卷可视化全解"));
  assert.equal((html.match(/nbx-tool-link"/g) || []).length, 2);
});

test("未知编号直接丢弃，不暴露标记", () => {
  const { renderMd } = setup();
  const html = renderMd("也许可以试试：\n\n[[tool:99]]");
  assert.ok(!html.includes("[[tool"), "未知编号不能裸奔");
  assert.ok(!/class="nbx-tool-link"/.test(html), "解析不到工具就不给入口");
});

test("全角冒号与多余空格也能识别", () => {
  const { renderMd } = setup();
  for (const text of ["[[tool：10]]", "[[ tool : 10 ]]"]) {
    assert.ok(/data-tool-id="10"/.test(renderMd(text)), text);
  }
});

test("流式期间的半截标记暂不显示", () => {
  const { renderMd } = setup();
  const html = renderMd("推荐这个：\n\n[[tool:1");
  assert.ok(!html.includes("[[tool"), "没闭合的标记不能显示成裸文本");
  assert.ok(!/class="nbx-tool-link"/.test(html), "没闭合就先不给入口");
});

test("淡入分隔符插进标记内部也照样识别", () => {
  const { renderMd } = setup();
  const FADE = "\u2063";
  assert.ok(/data-tool-id="10"/.test(renderMd(`[[tool:1${FADE}0]]`)), "词间分隔");
  assert.ok(/data-tool-id="10"/.test(renderMd(`[[${FADE}tool:10]]`)), "标签名前分隔");
});

test("普通正文与数学公式不受影响", () => {
  const { renderMd } = setup();
  const html = renderMd("矩阵记作 [[1, 0], [0, 1]]，公式 $a_{ij}$ 照常渲染。");
  assert.ok(html.includes("[[1, 0], [0, 1]]"), "普通双方括号不该被吃掉");
  assert.ok(!/class="nbx-tool-link"/.test(html));
});
