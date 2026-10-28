/* 键盘 Tab 离开弹层时要落到"触发器之后的下一个可聚焦元素"。
   两个弹层（自绘下拉、模型选择器）都挂在 body 末尾：直接关闭会让焦点所在的
   祖先变成 display:none，浏览器把焦点退回 <body>，键盘用户只能从页首重来。 */
const SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visible(el) {
  if (!el || el.hidden) return false;
  if (el.getAttribute?.("aria-hidden") === "true") return false;
  if (el.closest?.("[hidden]")) return false;
  return !!(el.getClientRects?.().length ?? 0);
}

export function focusables(root = document) {
  return [...root.querySelectorAll(SELECTOR)].filter(visible);
}

/** 触发器在文档顺序里的下一个（shift 为上一个）可聚焦元素；找不到返回 null。 */
export function neighbor(from, shift = false, root = document) {
  if (!from) return null;
  const list = focusables(root);
  const at = list.indexOf(from);
  if (at < 0) return null;
  return list[at + (shift ? -1 : 1)] || null;
}
