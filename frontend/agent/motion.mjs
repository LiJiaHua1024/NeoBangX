/* 分段控件的滑动高亮 + 视图切换的进场动效。

   来源：dsh-claude-style@1e7acc5b 的 shared/sliding-pill.ts / sliding-pill.css
   与 shared/motion.css（surface-in）。上游做法：控件上只画一个 ::before 高亮块，
   脚本量出选中项相对控件的盒子写进四个 CSS 变量，之后每次切换由 transform/width
   过渡滑过去，而不是旧项淡出底色、新项淡入。首次放置与属性同一任务写入，
   伪元素出生即在原位，不会从左上角滑进来。

   位置用 offsetLeft/offsetTop/offsetWidth/offsetHeight 读取：它们是布局用的 CSS 像素，
   不受 <html> 上的 CSS zoom 与控件横向滚动影响（见 zoom.mjs 的说明）。 */

const PILL_ATTR = "data-pill";

/** 让 `control` 内与 `activeSelector` 匹配的项下方垫一块会滑动的高亮。返回 { sync, release }。 */
export function slidingPill(control, activeSelector) {
  if (!control) return { sync() {}, release() {} };
  let last = "";

  function clear() {
    control.removeAttribute(PILL_ATTR);
    for (const key of ["x", "y", "w", "h"]) control.style.removeProperty(`--pill-${key}`);
    last = "";
  }

  function sync() {
    const item = control.querySelector(activeSelector);
    // 控件被隐藏（手机版式）时量不到盒子：先撤掉，重新可见时由 ResizeObserver 原位放回。
    if (!item || !control.offsetWidth || !item.offsetWidth) {
      if (control.hasAttribute(PILL_ATTR)) clear();
      return;
    }
    const box = {
      x: item.offsetLeft,
      y: item.offsetTop,
      w: item.offsetWidth,
      h: item.offsetHeight,
    };
    const key = `${box.x},${box.y},${box.w},${box.h}`;
    if (key === last && control.hasAttribute(PILL_ATTR)) return;
    last = key;
    for (const [name, value] of Object.entries(box)) {
      control.style.setProperty(`--pill-${name}`, `${value}px`);
    }
    if (!control.hasAttribute(PILL_ATTR)) control.setAttribute(PILL_ATTR, "");
  }

  // 字体载入、计数徽标变化、版式切换都会改宽度而不触发点击；随尺寸重量。
  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => sync());
    observer.observe(control);
    for (const child of control.children) observer.observe(child);
  }
  document.fonts?.ready?.then(() => sync()).catch(() => {});

  return {
    sync,
    release() {
      observer?.disconnect();
      observer = null;
      clear();
    },
  };
}

/** 把一组按钮里的当前项标成 aria-current="page"，其余移除；返回是否有变化。
    注意不能用 toggleAttribute：它写出的是 aria-current=""，样式匹配不到 "page"，
    读屏也会当成 false。 */
export function markCurrent(buttons, isCurrent) {
  let changed = false;
  for (const button of buttons) {
    if (isCurrent(button)) {
      if (button.getAttribute("aria-current") === "page") continue;
      button.setAttribute("aria-current", "page");
    } else {
      if (!button.hasAttribute("aria-current")) continue;
      button.removeAttribute("aria-current");
    }
    changed = true;
  }
  return changed;
}

/** 新出现的视图从下方 4px 淡入升起（上游 surface-in）。只在真正切换时调用。 */
export function playEnter(element) {
  if (!element || element.hidden) return;
  element.removeAttribute("data-enter");
  // 强制一次样式计算，同一视图连续切换时动画能从头再放。
  void element.offsetWidth;
  element.setAttribute("data-enter", "");
  const done = (event) => {
    if (event.target !== element) return; // 子元素自己的动画（问候升起等）会冒泡上来
    element.removeAttribute("data-enter");
    element.removeEventListener("animationend", done);
    element.removeEventListener("animationcancel", done);
  };
  element.addEventListener("animationend", done);
  element.addEventListener("animationcancel", done);
}
