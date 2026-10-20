/* 历史全文搜索内核用例
   运行：npm test（node --test）

   这个模块是纯函数 + 内存索引，不碰 DOM/localStorage，所以可以直接 require。
   用例分四组：
   1. 归一化与查询解析：多关键词、引号短语、中英文混排；
   2. 召回：标题/输入/正文/工具/旧版本/结构化内容、元数据先行、增量更新；
   3. 不只是全等：英文拼写容错、中文子序列缩写、长中文双字覆盖率；
   4. 排序、高亮片段与性能基线（100 条 × 约 12 KB 正文）。
*/

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const S = require(path.join(__dirname, "..", "nbx-history-search.js"));

let seq = 0;
function item(overrides) {
  seq += 1;
  return Object.assign({
    id: "h" + seq,
    title: "",
    toolId: "1",
    toolName: "语法讲解",
    inputHead: "",
    createdAt: Date.now() - seq * 1000,
    updatedAt: Date.now() - seq * 1000,
    _bodyLoaded: true,
    input: "",
    output: "",
    model: "",
  }, overrides || {});
}

function engineWith(items) {
  const engine = S.create();
  engine.sync(items);
  return engine;
}

function texts(engine, query) {
  return engine.query(query).results.map((row) => text(row));
}

function text(row) {
  return [row.titleSegments, row.snippet]
    .map((segments) => (segments || []).map((seg) => seg.t).join(""))
    .join("\n");
}

function titles(engine, query) {
  return engine.query(query).results.map((row) => row.item.title || row.item.inputHead || "");
}

/* ---------------- 1. 归一化与解析 ---------------- */

test("归一化：全角、大小写、重音、零宽字符与换行折叠", () => {
  assert.equal(S.fold("  ＣＡＦＥ\u200b\n\t"), "cafe");
  assert.equal(S.fold("Café"), "cafe");
  assert.equal(S.fold("ＡＢＣ　１２３"), "abc 123");
  assert.equal(S.fold("“引号”"), "\"引号\"");
});

test("查询解析：空格是 AND，引号是短语，中英文在边界处切开", () => {
  const terms = S.parseQuery('  定语  从句  "reading comprehension"  语法grammar  ');
  assert.deepEqual(terms.map((t) => t.text), [
    "定语", "从句", "reading comprehension", "语法", "grammar",
  ]);
  assert.equal(terms[2].phrase, true);
  assert.equal(terms[3].cjk, true);
  assert.equal(terms[4].latin, true);
  // 重复词只保留一次
  assert.equal(S.parseQuery("语法 语法 语法").length, 1);
});

test("查询解析：中文弯引号与空串", () => {
  assert.deepEqual(S.parseQuery("“定语从句”").map((t) => [t.text, t.phrase]), [["定语从句", true]]);
  assert.deepEqual(S.parseQuery("   "), []);
  assert.deepEqual(S.parseQuery("，。；"), []);
});

/* ---------------- 2. 召回 ---------------- */

test("字段召回：标题、输入、正文、工具名都能命中，并给出摘要", () => {
  const engine = engineWith([
    item({
      title: "定语从句精讲",
      inputHead: "定语从句是什么",
      toolName: "语法讲解",
      input: "请解释定语从句。",
      output: "定语从句由关系代词引导，例如 The book that I bought is interesting.",
    }),
    item({
      title: "作文批改",
      toolName: "作文批改",
      input: "My summer holiday was great.",
      output: "结构清晰，但请补上结尾。",
    }),
  ]);

  assert.deepEqual(titles(engine, "定语从句"), ["定语从句精讲"]);
  assert.deepEqual(titles(engine, "关系代词"), ["定语从句精讲"]);
  assert.deepEqual(titles(engine, "summer"), ["作文批改"]);
  assert.deepEqual(titles(engine, "语法讲解"), ["定语从句精讲"]);

  const row = engine.query("关系代词").results[0];
  assert.equal(row.snippetLabel, "正文");
  assert.ok(text(row).includes("关系代词"));
});

test("多关键词是 AND；短语要求连续出现", () => {
  const engine = engineWith([
    item({ title: "夏天的作文", input: "My summer holiday", output: "Very interesting." }),
    item({ title: "定语从句", input: "关系代词", output: "The book that I bought." }),
  ]);

  assert.equal(engine.query("summer 作文").total, 1);
  assert.equal(engine.query("summer 定语").total, 0);
  assert.equal(engine.query('"the book"').total, 1);
  assert.equal(engine.query('"book the"').total, 0);
});

test("元数据先行：正文还没读回来也能按标题/摘要/工具搜到", () => {
  const indexOnly = item({
    id: "meta-1",
    title: "阅读课教案",
    inputHead: "高中英语阅读课教学设计",
    toolName: "教案生成",
    _bodyLoaded: false,
  });
  delete indexOnly.input;
  delete indexOnly.output;

  const engine = S.create();
  const pending = engine.sync([indexOnly]);
  assert.equal(pending.length, 1, "没有正文的条目应进入待补索引队列");
  assert.equal(engine.stats().bodies, 0);
  assert.deepEqual(titles(engine, "阅读课"), ["阅读课教案"]);
  assert.deepEqual(titles(engine, "教学设计"), ["阅读课教案"]);
  assert.equal(engine.query("关系代词").total, 0);

  engine.hydrate(indexOnly, { input: "关系代词引导的定语从句", output: "讲解正文" });
  assert.equal(engine.stats().bodies, 1);
  assert.equal(engine.query("关系代词").total, 1);
});

test("缺失正文键不会让待索引队列死循环", () => {
  const indexOnly = item({ id: "missing-body", title: "只有索引", _bodyLoaded: false });
  delete indexOnly.input;
  delete indexOnly.output;

  const engine = S.create();
  engine.sync([indexOnly]);
  engine.markMissing(indexOnly.id);
  assert.equal(engine.stats().pending, 0);
  assert.equal(engine.nextPending(), null);
  assert.deepEqual(titles(engine, "只有索引"), ["只有索引"]);
});

test("增量更新：正文替换后旧词立即失效，新词立即生效", () => {
  const record = item({ id: "inc-1", title: "版本一", output: "旧的台风路径分析" });
  const engine = engineWith([record]);
  assert.equal(engine.query("台风").total, 1);

  record.output = "新的晴空观测记录";
  record.updatedAt += 1;
  engine.sync([record]);
  assert.equal(engine.query("台风").total, 0);
  assert.equal(engine.query("晴空").total, 1);
});

test("删除与重读：remove 后不再命中，invalidateBodies 后正文退回待索引", () => {
  const record = item({ id: "life-1", title: "生命周期", output: "候鸟迁徙路线" });
  const engine = engineWith([record]);
  assert.equal(engine.query("候鸟").total, 1);

  engine.invalidateBodies();
  assert.equal(engine.stats().bodies, 0);
  assert.equal(engine.query("候鸟").total, 0, "正文失效后不能继续拿旧快照参与搜索");
  assert.equal(engine.query("生命周期").total, 1, "元数据检索仍然可用");

  engine.hydrate(record, record);
  assert.equal(engine.query("候鸟").total, 1);

  engine.remove(record.id);
  assert.equal(engine.query("生命周期").total, 0);
  assert.equal(engine.stats().docs, 0);
});

test("旧版本与结构化内容也进入检索，并标记摘要来源", () => {
  const record = item({
    id: "version-1",
    title: "天气稿",
    input: "写一段天气预报",
    output: "今天晴，气温 26 度。",
    versions: [
      { id: "v1", output: "台风将于今夜登陆。" },
      { id: "v2", output: "今天晴，气温 26 度。" },
    ],
    activeVersionId: "v2",
  });
  const engine = engineWith([record]);
  const old = engine.query("台风").results[0];
  assert.ok(old, "应能搜到旧版本的正文");
  assert.equal(old.snippetLabel, "旧版");

  const paper = item({
    id: "paper-1",
    title: "试卷讲解",
    input: "",
    output: "",
    visualPaper: {
      items: [{ question: "Why does the author mention the lighthouse?", analysis: "象征希望" }],
    },
  });
  const engine2 = engineWith([paper]);
  const row = engine2.query("lighthouse").results[0];
  assert.ok(row, "结构化试卷内容也应能被搜到");
  assert.equal(row.snippetLabel, "内容");
});

/* ---------------- 3. 不只是全等 ---------------- */

test("英文拼写容错：少一个字母、字母换位都能找到", () => {
  const engine = engineWith([
    item({ id: "fuzzy-1", title: "Grammar note", output: "Grammar tip: use the present tense." }),
    item({ id: "fuzzy-2", title: "Reading", output: "Please receive the package." }),
  ]);

  assert.deepEqual(titles(engine, "grammer"), ["Grammar note"]);
  assert.deepEqual(titles(engine, "recieve"), ["Reading"]);
  const row = engine.query("grammer").results[0];
  assert.equal(row.loose, true);
  assert.ok(row.snippet.some((seg) => seg.h), "混淆命中也要给出高亮片段");
});

test("英文词干：teaching / taught / studies 都能找到对应词", () => {
  const engine = engineWith([
    item({ id: "stem-1", title: "Grammar tip", output: "Teach the present tense." }),
    item({ id: "stem-2", title: "Reading skills", output: "Study skills for exams." }),
    item({ id: "stem-3", title: "Past tense", output: "I taught him yesterday." }),
  ]);

  // 同一个词的不同形态互相可搜：teaching / taught / teach 都指向同一个词干
  const teach = ["Grammar tip", "Past tense"];
  assert.deepEqual(titles(engine, "teaching").sort(), teach.sort());
  assert.deepEqual(titles(engine, "taught").sort(), teach.sort());
  assert.deepEqual(titles(engine, "teach").sort(), teach.sort());
  assert.deepEqual(titles(engine, "studies"), ["Reading skills"]);
  assert.equal(engine.query("teaching").results.every((row) => row.loose), true);

  const row = engine.query("teaching").results[0];
  assert.equal(row.loose, true, "词形变化属于宽松召回");
  assert.ok(row.snippet.some((seg) => seg.h));
});

test("中文子序列：定从 → 定语从句", () => {
  const engine = engineWith([
    item({ id: "cjk-1", title: "定语从句精讲", input: "定语从句是什么", output: "由关系代词引导。" }),
  ]);
  const result = engine.query("定从");
  assert.equal(result.total, 1);
  assert.equal(result.results[0].loose, true);
  assert.ok(result.results[0].snippet.some((seg) => seg.h));
});

test("拼音：全拼与首字母都能找到中文记录，且不污染纯英文记录", () => {
  const engine = engineWith([
    item({ id: "py-1", title: "定语从句精讲", input: "定语从句是什么", output: "由关系代词引导。" }),
    item({ id: "py-2", title: "English grammar", output: "present tense drill" }),
  ]);

  assert.deepEqual(titles(engine, "dingyu"), ["定语从句精讲"]);
  assert.deepEqual(titles(engine, "dingyucongju"), ["定语从句精讲"]);
  assert.deepEqual(titles(engine, "dingyucong"), ["定语从句精讲"], "前缀也应命中");
  assert.deepEqual(titles(engine, "dycj"), ["定语从句精讲"], "首字母缩写");

  const row = engine.query("dingyu").results[0];
  assert.equal(row.loose, true, "拼音命中属于宽松召回");
  assert.ok(row.snippet.some((seg) => seg.h), "拼音命中也要在原文里高亮");
  assert.ok(text(row).includes("定语从句"), "摘要取原文，不是拼音串");

  // 拼音只在宽松阶段兜底，正文里的英文命中不受影响
  const en = engine.query("grammar").results.map((r) => r.item.id);
  assert.deepEqual(en, ["py-2"]);
});

test("同音字：定语丛句也能找到定语从句（含引号短语）", () => {
  const engine = engineWith([
    item({ id: "homo-1", title: "定语从句精讲", input: "定语从句是什么", output: "由关系代词引导。" }),
    item({ id: "homo-2", title: "数学", output: "二次函数与方程。" }),
  ]);

  assert.deepEqual(titles(engine, "定语丛句"), ["定语从句精讲"]);
  assert.deepEqual(titles(engine, '"定语丛句"'), ["定语从句精讲"], "引号短语也要过同音");
  // 同音是兜底，不能把不相关记录拉进来
  assert.equal(engine.query("定语丛句").total, 1);
  assert.equal(engine.query("动物世界").total, 0);

  const row = engine.query("定语丛句").results[0];
  assert.equal(row.loose, true);
  assert.ok(row.snippet.some((seg) => seg.h));
});

test("近音容错：平翘舌、前后鼻音、n-l 混用都能命中", () => {
  const engine = engineWith([
    item({ id: "near-1", title: "从句用法", output: "从句由关系代词引导。" }),
    item({ id: "near-2", title: "心里描写", output: "人物的心理活动。" }),
    item({ id: "near-3", title: "动物世界", output: "纪录片旁白。" }),
  ]);

  // chong → con，与 cong 同键
  assert.deepEqual(titles(engine, "冲句"), ["从句用法"]);
  // xing → xin，与 xin 同键
  assert.deepEqual(titles(engine, "星里"), ["心里描写"]);
  // 近音也要能收束：不相关记录不进场
  assert.equal(engine.query("冲句").total, 1);
});

test("长中文串允许双字覆盖率匹配，但不会召回无关记录", () => {
  const engine = engineWith([
    item({ id: "cov-1", title: "写作指导", output: "如何写好一篇英语作文：先列提纲，再补细节。" }),
    item({ id: "cov-2", title: "数学", output: "二次函数与一元二次方程。" }),
  ]);
  assert.deepEqual(titles(engine, "如何写好英语作文"), ["写作指导"]);
  assert.equal(engine.query("如何写好英语作文").total, 1);
});

test("精确结果充足时宽松结果仍保留，但排在精确结果之后", () => {
  const items = [];
  for (let i = 0; i < 15; i += 1) {
    items.push(item({ id: "strict-" + i, title: "Grammar " + i, output: "grammar exercise " + i }));
  }
  items.push(item({ id: "typo", title: "Grammer typo" }));
  const engine = engineWith(items);
  const result = engine.query("grammar");
  assert.equal(result.exactCount, 15, "前 15 条都是精确命中");
  assert.equal(result.results.length, 16);
  assert.ok(result.results.slice(0, 15).every((row) => row.loose === false));
  assert.equal(result.results[15].item.id, "typo");
  assert.equal(result.results[15].loose, true);
  assert.equal(result.looseTotal, 1);
});

test("分组：相关结果的分数再高也排在精确结果之后", () => {
  const engine = engineWith([
    // 正文里是真正的连续命中（精确，分数低）
    item({ id: "exact", title: "普通记录", output: "这里提到了定从这条规则。" }),
    // 标题只能靠子序列擦到（宽松，标题权重高，单看分数反而更高）
    item({ id: "loose", title: "定制的从属连词", output: "无关内容。" }),
  ]);
  const result = engine.query("定从");
  assert.equal(result.exactCount, 1);
  assert.equal(result.results[0].item.id, "exact");
  assert.equal(result.results[0].loose, false);
  assert.equal(result.results[1].item.id, "loose");
  assert.equal(result.results[1].loose, true);
});

/* ---------------- 4. 排序、片段与性能 ---------------- */

test("排序：标题命中 > 正文完整词 > 正文子串；同分时新的在前", () => {
  const engine = engineWith([
    item({ id: "rank-sub", title: "普通记录", output: "grammars structure", createdAt: 3000 }),
    item({ id: "rank-body", title: "普通记录二", output: "grammar note", createdAt: 2000 }),
    item({ id: "rank-title", title: "Grammar 精讲", output: "无关内容", createdAt: 1000 }),
  ]);
  assert.deepEqual(
    engine.query("grammar").results.map((row) => row.item.id),
    ["rank-title", "rank-body", "rank-sub"]
  );

  const newer = engineWith([
    item({ id: "old", title: "同一个标题", output: "同一段正文", createdAt: 1000 }),
    item({ id: "new", title: "同一个标题", output: "同一段正文", createdAt: 9000 }),
  ]);
  assert.deepEqual(
    newer.query("同一个标题").results.map((row) => row.item.id),
    ["new", "old"]
  );
});

test("高亮片段是纯文本分段，不把用户内容当 HTML", () => {
  const engine = engineWith([
    item({
      id: "xss-1",
      title: "<img src=x onerror=alert(1)>",
      output: "正文里的 <script>alert(1)</script> 片段",
    }),
  ]);
  const row = engine.query("script").results[0];
  const joined = row.titleSegments.map((seg) => seg.t).join("");
  assert.equal(joined, "<img src=x onerror=alert(1)>");
  assert.ok(row.snippet.map((seg) => seg.t).join("").includes("<script>"));
  assert.ok(row.snippet.some((seg) => seg.h));
  assert.ok(row.snippet.every((seg) => typeof seg.t === "string"));
});

test("查询结果缓存：同一查询复用，数据变化后失效", () => {
  const record = item({ id: "cache-1", title: "缓存", output: "缓存内容" });
  const engine = engineWith([record]);
  const first = engine.query("缓存");
  assert.equal(engine.query("缓存"), first);
  record.output = "新的内容";
  record.updatedAt += 1;
  engine.sync([record]);
  assert.notEqual(engine.query("缓存"), first);
});

test("性能基线：100 条 × 约 12 KB 正文，常见词查询 P95 < 25ms", () => {
  const docs = [];
  const common = "定语从句由关系代词引导，例如 the book that I bought is interesting. ";
  const filler = "reading comprehension writing grammar vocabulary exercise classroom. ";
  for (let i = 0; i < 100; i += 1) {
    docs.push(item({
      id: "perf-" + i,
      title: "性能记录 " + i,
      input: "主题 " + i,
      output: common.repeat(220) + filler.repeat(160) + " unique" + i + " ",
      createdAt: Date.now() - i * 60000,
    }));
  }

  const buildStart = performance.now();
  const engine = engineWith(docs);
  const buildMs = performance.now() - buildStart;
  assert.equal(engine.stats().bodies, 100);
  assert.ok(buildMs < 1500, `索引构建过慢：${buildMs.toFixed(1)}ms`);

  // 预热一轮，再做 24 次不同查询（避免命中缓存）
  engine.query("定语从句");
  engine.query("relationship");
  const times = [];
  for (let i = 0; i < 24; i += 1) {
    const query = i % 3 === 0 ? "定语从句 " + i : (i % 3 === 1 ? "grammar " + i : "unique" + (i % 100));
    const start = performance.now();
    const result = engine.query(query);
    times.push(performance.now() - start);
    if (i % 3 === 2) assert.ok(result.total >= 1, `第 ${i} 次查询应至少命中一条`);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  console.log(`# 索引 ${buildMs.toFixed(1)}ms，查询 P50 ${times[Math.floor(times.length / 2)].toFixed(2)}ms，P95 ${p95.toFixed(2)}ms`);
  assert.ok(p95 < 25, `查询 P95 过慢：${p95.toFixed(2)}ms`);
});

test("倒排失效：文档被删或改写后，旧双字不再指向它", () => {
  const record = item({ id: "gram-1", title: "观测记录", output: "台风将于今夜登陆。" });
  const engine = engineWith([record]);
  assert.equal(engine.query("台风").total, 1);

  record.output = "晴空观测记录";
  record.updatedAt += 1;
  engine.sync([record]);
  assert.equal(engine.query("台风").total, 0, "改写后旧双字必须摘掉");
  assert.equal(engine.query("晴空").total, 1, "新双字必须登记");

  engine.remove(record.id);
  assert.equal(engine.query("晴空").total, 0);
  assert.equal(engine.stats().docs, 0);
});

test("性能：双字倒排不产生漏召回（每个文档都能被唯一词找到）", () => {
  const docs = [];
  for (let i = 0; i < 120; i += 1) {
    docs.push(item({
      id: "bloom-" + i,
      title: "Bloom " + i,
      output: "普通正文 ".repeat(120) + " rareid" + i + "z ",
    }));
  }
  const engine = engineWith(docs);
  for (let i = 0; i < 120; i += 1) {
    const result = engine.query("rareid" + i + "z");
    assert.equal(result.total, 1, `第 ${i} 条被倒排误杀`);
    assert.equal(result.results[0].item.id, "bloom-" + i);
  }
});
