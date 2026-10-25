importScripts("/static/vendor/marked-15.0.12.min.js");
self.onmessage = async ({ data }) => {
  try {
    const { boundedPages, lineDiff } = await import("./core.mjs");
    if (data.type === "docx") {
      if (!self.htmlDocx) importScripts("/static/vendor/html-docx-0.3.1.js");
      self.postMessage({
        id: data.id,
        result: self.htmlDocx.asBlob(data.html),
      });
      return;
    }
    const result =
      data.type === "diff"
        ? lineDiff(data.before, data.after)
        : boundedPages(marked.lexer(data.text).map((t) => t.raw));
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e.message) });
  }
};
