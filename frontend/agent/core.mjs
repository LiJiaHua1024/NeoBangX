export const ACTIVE = new Set(["queued", "running", "stopping"]);
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
