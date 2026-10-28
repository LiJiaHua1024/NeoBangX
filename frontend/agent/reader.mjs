import { escapeHTML, setParts } from "./core.mjs";

// 分页正文：任意长度的记录只挂载一页文本。全文仍可搜索、定位和下载。
export class FullReader {
  constructor(
    root,
    { text = "", download, readFull, onError = () => {} } = {},
  ) {
    this.root = root;
    this.parts = text ? [text] : [];
    this.length = text.length;
    this.page = 0;
    this.size = 12000;
    // 上一次查找的关键词与命中位置：换词时要重置，否则会跳过新词的首个出现。
    this.query = "";
    this.match = -1;
    this.follow = false;
    this.closed = false;
    this.download = download;
    this.readFull = readFull;
    this.onError = onError;
    root.innerHTML =
      '<div class="reader-meta"></div><div class="reader-search"><input type="search" aria-label="查找全文" placeholder="查找完整记录…"><button data-a="find">查找下一个</button></div><div class="reader-window" tabindex="0" aria-label="全文阅读区域"><pre></pre></div><div class="reader-toolbar"><button data-a="prev">上一页</button><span class="reader-page"></span><button data-a="next">下一页</button><button data-a="last">最新位置</button><button data-a="copy">复制全文</button><button data-a="download">下载全文</button></div><label class="reader-follow"><input type="checkbox">跟随新增内容</label><input class="reader-position" type="range" min="0" max="0" value="0" aria-label="跳转正文页码">';
    root.onclick = (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === "prev") this.go(this.page - 1);
      if (a === "next") this.go(this.page + 1);
      if (a === "last") {
        this.follow = true;
        this.go(this.pages - 1, false);
      }
      if (a === "find") this.find();
      if (a === "copy")
        Promise.resolve(this.readFull ? this.readFull() : this.text())
          .then(copyText)
          .catch(onError);
      if (a === "download")
        Promise.resolve(
          this.download?.() || saveBlob(this.text(), "完整记录.txt"),
        ).catch(onError);
    };
    root.querySelector(".reader-follow input").onchange = (e) => {
      this.follow = e.target.checked;
      if (this.follow) this.go(this.pages - 1, false);
    };
    root.querySelector(".reader-position").oninput = (e) =>
      this.go(Number(e.target.value));
    root.querySelector("[type=search]").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.find();
      }
    };
    this.render();
  }
  get pages() {
    return Math.max(1, Math.ceil(this.length / this.size));
  }
  text() {
    if (this.parts.length > 1) this.parts = [this.parts.join("")];
    return this.parts[0] || "";
  }
  slice(start, end) {
    let pos = 0,
      out = "";
    for (const p of this.parts) {
      if (pos >= end) break;
      if (pos + p.length > start)
        out += p.slice(Math.max(0, start - pos), end - pos);
      pos += p.length;
    }
    return out;
  }
  append(parts) {
    for (const text of parts) {
      this.parts.push(text);
      this.length += text.length;
    }
    if (this.follow) this.page = this.pages - 1;
    this.render();
  }
  go(page, manual = true) {
    this.page = Math.max(0, Math.min(this.pages - 1, page));
    if (manual) this.follow = false;
    this.render();
    this.root.querySelector(".reader-window").scrollTop = 0;
  }
  render() {
    if (this.closed) return;
    const [start, end] = this.range();
    const pre = this.root.querySelector("pre");
    const value = this.slice(start, end);
    if (pre.textContent !== value) pre.textContent = value;
    setParts(this.root.querySelector(".reader-meta"), [
      `全文 ${this.length.toLocaleString()} 字符`,
      `当前 ${start.toLocaleString()}–${end.toLocaleString()}`,
      "分页仅影响显示，不删减内容",
    ]);
    this.root.querySelector(".reader-page").textContent =
      `${this.page + 1} / ${this.pages}`;
    this.root.querySelector("[data-a=prev]").disabled = this.page === 0;
    this.root.querySelector("[data-a=next]").disabled =
      this.page >= this.pages - 1;
    this.root.querySelector(".reader-follow input").checked = this.follow;
    const range = this.root.querySelector(".reader-position");
    range.max = this.pages - 1;
    range.value = this.page;
  }
  range() {
    let start = this.page * this.size,
      end = Math.min(start + this.size, this.length);
    const pair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
    if (start && pair.test(this.slice(start - 1, start + 1))) start++;
    if (end < this.length && pair.test(this.slice(end - 1, end + 1))) end++;
    return [start, end];
  }
  find() {
    if (this.root.querySelector("[data-a=find]").disabled) {
      this.root.querySelector(".reader-meta").textContent =
        "完整记录仍在读取，请稍后查找；已有内容可继续阅读。";
      return;
    }
    const query = this.root.querySelector("[type=search]").value;
    if (!query) return;
    const full = this.text();
    // 换了关键词就从头找：沿用上一个词的命中位置会跳过新词的首次出现。
    if (query !== this.query) {
      this.query = query;
      this.match = -1;
    }
    let at = full.indexOf(query, (this.match ?? -1) + 1);
    if (at < 0) at = full.indexOf(query);
    if (at < 0) {
      this.root.querySelector(".reader-meta").textContent =
        "全文中没有匹配结果";
      return;
    }
    this.match = at;
    this.go(Math.floor(at / this.size));
    const [start, end] = this.range();
    const raw = this.slice(start, end),
      local = at - start;
    this.root.querySelector("pre").innerHTML =
      escapeHTML(raw.slice(0, local)) +
      "<mark>" +
      escapeHTML(raw.slice(local, local + query.length)) +
      "</mark>" +
      escapeHTML(raw.slice(local + query.length));
    this.root.querySelector("mark")?.scrollIntoView({ block: "center" });
  }
  destroy() {
    this.closed = true;
    clearTimeout(this.timer);
    this.root.onclick = null;
  }
}
export function saveBlob(text, name, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(
    text instanceof Blob ? text : new Blob([text], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw Error("浏览器禁止复制，请下载全文");
}
