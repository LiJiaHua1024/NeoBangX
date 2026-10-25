const { test } = require("node:test");
const assert = require("node:assert/strict");
test("stream reader page boundaries retain surrogate pairs", async () => {
  const { FullReader } = await import("../agent/reader.mjs");
  const source = "a".repeat(11999) + "😀" + "b".repeat(12000) + "😀";
  const parts = [];
  for (let page = 0; page < Math.ceil(source.length / 12000); page++) {
    const [start, end] = FullReader.prototype.range.call({
      page,
      size: 12000,
      length: source.length,
      slice: (a, b) => source.slice(a, b),
    });
    const part = source.slice(start, end);
    assert(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part));
    parts.push(part);
  }
  assert.equal(parts.join(""), source);
});
test("full reasoning pagination preserves every character and limits page size", async () => {
  const { pageText } = await import("../agent/core.mjs");
  const source = "全文😀中文\n".repeat(100000) + "TAIL";
  const pages = pageText(source);
  assert.equal(pages.map((p) => p.text).join(""), source);
  assert(pages.every((p) => p.text.length <= 12000));
  assert(pages.every((p) => !/[\uD800-\uDBFF]$/.test(p.text)));
});
test("markdown pages retain every block including oversized tables", async () => {
  const { boundedPages } = await import("../agent/core.mjs");
  const blocks = ["# 标题\n\n", "a".repeat(50000), "\n\n尾部"];
  const pages = boundedPages(blocks);
  assert.equal(pages.map((p) => p.text).join(""), blocks.join(""));
  assert(pages.every((p) => p.text.length <= 12000));
});
test("version comparison retains unchanged, removed and added content", async () => {
  const { lineDiff } = await import("../agent/core.mjs");
  const diff = lineDiff("第一题\n第二题\n末尾", "第一题\n修改题\n末尾");
  assert.deepEqual(
    diff.map((x) => x.kind),
    ["same", "removed", "added", "same"],
  );
  assert.equal(
    diff
      .filter((x) => x.kind !== "added")
      .flatMap((x) => x.lines)
      .join("\n"),
    "第一题\n第二题\n末尾",
  );
});
