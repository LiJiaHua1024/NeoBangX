importScripts("/static/vendor/marked-15.0.12.min.js");
self.onmessage = async ({ data }) => {
  try {
    const { boundedPages, lineDiff, pageText } = await import("./core.mjs");
    if (data.type === "docx") {
      if (!self.htmlDocx) importScripts("/static/vendor/html-docx-0.3.1.js");
      self.postMessage({
        id: data.id,
        result: self.htmlDocx.asBlob(data.html),
      });
      return;
    }
    let result;
    if (data.type === "diff") {
      result = lineDiff(data.before, data.after);
    } else {
      // marked 15 不会给链接引用定义（`[1]: https://…`）产生 token，`raw` 拼回去会丢行。
      // 拼不回原文时就退回纯文本分页：分页粒度不变，但一个字都不丢。
      const raws = marked.lexer(data.text).map((t) => t.raw);
      result = raws.join("") === data.text ? boundedPages(raws) : pageText(data.text);
    }
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e.message) });
  }
};
