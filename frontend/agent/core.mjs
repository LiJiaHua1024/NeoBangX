export const ACTIVE = new Set(["queued", "running", "stopping"]);
/** 只有真正会继续产生输出的轮次才提供停止；“等待补充”的出口是回答或跳过。 */
export const STOPPABLE = new Set(["running", "queued"]);
export const STATUS = {
  draft: "草稿",
  queued: "排队中",
  running: "执行中",
  stopping: "正在停止",
  stopped: "已停止",
  completed: "已完成",
  waiting: "等待补充",
  incomplete: "待继续",
  failed: "失败",
  done: "完成",
  interrupted: "已中断",
};
export function escapeHTML(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
/** 同一行里并列的几段信息：各段是独立的 span，间距交给 .parts 的样式，不夹分隔符号。
 * 段间留一个真实空格，复制和读屏时各段不会粘在一起。内容没变时不重建节点。 */
export function setParts(el, parts) {
  if (!el) return;
  const list = parts.filter((part) => part !== "" && part != null).map(String);
  const key = list.join("\n");
  if (el.dataset.parts === key && el.childElementCount === list.length) return;
  el.dataset.parts = key;
  el.classList.add("parts");
  const nodes = [];
  list.forEach((text, i) => {
    if (i) nodes.push(" ");
    const span = document.createElement("span");
    span.textContent = text;
    nodes.push(span);
  });
  el.replaceChildren(...nodes);
}
/** 生成 HTML 字符串时用的同款写法。 */
export function partsHTML(parts) {
  return parts
    .filter((part) => part !== "" && part != null)
    .map((part) => `<span>${escapeHTML(part)}</span>`)
    .join(" ");
}
export function newKey() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}
export function pageText(text, size = 12000) {
  const pages = [];
  for (let pos = 0; pos < text.length; ) {
    let end = Math.min(pos + size, text.length);
    // 不在代理对中间分页，原文拼接必须完全一致。
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    pages.push({ start: pos, text: text.slice(pos, end), plain: true });
    pos = end;
  }
  return pages.length ? pages : [{ start: 0, text: "", plain: true }];
}
export function lineDiff(before, after) {
  const a = before.split("\n"),
    b = after.split("\n");
  let head = 0,
    tail = 0;
  while (head < Math.min(a.length, b.length) && a[head] === b[head]) head++;
  while (
    tail < Math.min(a.length - head, b.length - head) &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  // 线性比较共同首尾，复杂重排呈现完整替换块，绝不伪称精确逐字差异。
  return [
    { kind: "same", lines: a.slice(0, head) },
    { kind: "removed", lines: a.slice(head, a.length - tail) },
    { kind: "added", lines: b.slice(head, b.length - tail) },
    { kind: "same", lines: tail ? a.slice(a.length - tail) : [] },
  ].filter((x) => x.lines.length);
}
export function boundedPages(blocks, size = 12000) {
  const out = [];
  let buffer = "",
    start = 0;
  const flush = () => {
    if (buffer) {
      out.push({ text: buffer, start, plain: false });
      start += buffer.length;
      buffer = "";
    }
  };
  for (const block of blocks) {
    if (block.length > size) {
      flush();
      for (const p of pageText(block, size))
        out.push({ ...p, start: start + p.start });
      start += block.length;
    } else {
      if (buffer.length + block.length > size) flush();
      buffer += block;
    }
  }
  flush();
  return out.length ? out : [{ text: "", start: 0, plain: false }];
}
