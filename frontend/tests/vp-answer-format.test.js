const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// 独立文件和打印引擎封装在 IIFE 中，抽取实际比较与删除函数验证同一份答案数据。
function functionsFrom(file, names) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  return names.map(name => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing ${name}`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unclosed ${name}`);
  }).join("\n");
}

test("独立讲解与打印件识别加粗、高亮和嵌套格式的答案", () => {
  for (const [file, names] of [
    ["vp-standalone.js", ["sameLabel"]],
    ["vp-print.js", ["stripTags", "sameLabel"]],
  ]) {
    const compare = new Function("str", functionsFrom(file, names) + "\nreturn sameLabel;")(v => String(v ?? ""));
    for (const answer of ["**B**", "==b==", "**==B.==**"]) {
      assert.equal(compare("B", answer), true, file);
      assert.equal(compare("A", answer), false, file);
    }
    assert.equal(compare("B", "B and C"), false);
    assert.equal(compare("", "**== ==**"), false);
  }
});

test("独立讲解删除选项时保护格式化答案，重排答案保留格式", () => {
  for (const format of [letter => `**${letter}**`, letter => `==${letter}==`, letter => `**==${letter}==**`]) {
    const question = { answer: format("B"), options: [{ label: "A", text: "One" }, { label: "B", text: "Two" }] };
    const notices = [];
    const remove = new Function("str", "resolvePath", "fieldGet", "fieldSet", "writeBackEdited", "toast", "markDirty", "renderQuestion",
      functionsFrom("vp-standalone.js", ["sameLabel", "relabelOptions", "removeItem"]) + "\nreturn removeItem;")(
      v => String(v ?? ""), () => ({ host: question, key: "options" }), () => question.answer,
      (_, value) => { question.answer = value; }, () => {}, message => notices.push(message), () => {}, () => {},
    );
    remove("q.options", 1);
    assert.equal(question.options.length, 2);
    assert.ok(notices.some(message => message.includes("是当前答案")));
    remove("q.options", 0);
    assert.equal(question.options.length, 1);
    assert.equal(question.options[0].text, "Two");
    assert.equal(question.answer, format("A"));
  }
});
