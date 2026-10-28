/* /agent 的整页缩放，和普通工具页的「内容字号」分开保存。
   浏览器的 Ctrl +/- 按站点缩放，会把普通工具页一起放大；这里改为在 <html> 上设置
   CSS zoom，只影响 /agent。首帧前的初始值由 index.html 的内联脚本写好，
   常量与断点必须和那里保持一致。

   标准化 zoom（Chrome/Edge 128+、Firefox 126+）下有三处要配合：
   1. vw / vh / dvh 也会被放大，CSS 里一律写成 `100dvh / var(--zoom)`；
   2. @media 仍按真实视口判断，不会像 Ctrl +/- 那样换版式。断点因此改在这里按
      「视口 ÷ 缩放」计算，写到 <html data-vp>，CSS 用 :where(html[data-vp~="w767"]) 代替 @media；
   3. getBoundingClientRect、clientX、innerWidth 返回放大后的屏幕像素，写进 style.left
      等属性的值又会再放大一次。定位代码要先用 toCss() 换回 CSS 像素。 */

export const ZOOM_KEY = "nbx_agent_zoom";
export const ZOOM_MIN = 80;
export const ZOOM_MAX = 160;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

/* data-vp 里的 wN 表示有效宽度 < N+1（等价于 max-width: Npx），hN 同理对应 max-height。 */
const WIDTHS = [1439, 1099, 767, 720, 480];
const HEIGHTS = [700, 500];

// 允许在 node 里导入纯函数（clamp/clampZoom）做回归：没有 DOM 时跳过副作用。
const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
const root = hasDom ? document.documentElement : null;
const listeners = new Map();
let percent = readZoom();
let tokens = new Set(((root && root.dataset.vp) || "").split(" ").filter(Boolean));

export function clampZoom(value) {
  return clamp(value);
}

function clamp(value) {
  // 没有值或无法解析才回默认；数字越界要夹到边界，
  // 而不是回落到 100%：155% 再点一次"＋"不该突然变回默认。
  if (value === null || value === undefined || value === "") return ZOOM_DEFAULT;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

export function readZoom() {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    return raw === null ? ZOOM_DEFAULT : clamp(raw);
  } catch {
    return ZOOM_DEFAULT;
  }
}

export function zoomPercent() {
  return percent;
}

/* 屏幕像素 ÷ scale = CSS 像素 */
export function zoomScale() {
  return percent / 100;
}

/* 把 getBoundingClientRect / clientX 等屏幕像素换成可写进 style 的 CSS 像素 */
export function toCss(px) {
  return px / zoomScale();
}

/* 当前缩放下的视口尺寸（CSS 像素），给 left/top 的边界夹取用 */
export function viewportCss() {
  const s = zoomScale();
  return { width: innerWidth / s, height: innerHeight / s };
}

function computeTokens() {
  const { width, height } = viewportCss();
  const next = [];
  for (const b of WIDTHS) if (width < b + 1) next.push(`w${b}`);
  for (const b of HEIGHTS) if (height < b + 1) next.push(`h${b}`);
  return next;
}

/* 与 CSS 断点同口径：matches("w1099") ≈ 原来的 matchMedia("(max-width: 1099px)") */
export function matches(token) {
  return computeTokens().includes(token);
}

/* 订阅断点切换（视口变化或缩放变化都会触发），替代 matchMedia(...).addEventListener("change") */
export function onBreakpoint(token, callback) {
  if (!listeners.has(token)) listeners.set(token, new Set());
  listeners.get(token).add(callback);
}

export function syncViewport() {
  const next = computeTokens();
  root.dataset.vp = next.join(" ");
  const nextSet = new Set(next);
  const changed = [];
  for (const token of new Set([...tokens, ...nextSet])) {
    if (tokens.has(token) !== nextSet.has(token)) changed.push(token);
  }
  tokens = nextSet;
  for (const token of changed) {
    for (const callback of listeners.get(token) || []) {
      callback(nextSet.has(token));
    }
  }
}

function applyZoom() {
  const s = zoomScale();
  root.style.setProperty("--zoom", String(s));
  // 100% 时不写 zoom：不支持标准化 zoom 的浏览器在默认状态下完全不受影响。
  root.style.zoom = s === 1 ? "" : String(s);
}

export function setZoom(value) {
  const next = clamp(value);
  try {
    if (next === ZOOM_DEFAULT) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(next));
  } catch {}
  if (next === percent) return percent;
  percent = next;
  applyZoom();
  syncViewport();
  // 和浏览器缩放一样补发 resize：浮层定位、工作区开合都按 resize 重算。
  window.dispatchEvent(new Event("resize"));
  document.dispatchEvent(new CustomEvent("agent:zoom", { detail: { percent } }));
  return percent;
}

export function stepZoom(direction) {
  return setZoom(percent + Math.sign(direction) * ZOOM_STEP);
}

/* 另一个 /agent 标签页改了缩放时跟着变 */
if (hasDom) {
  window.addEventListener("storage", (event) => {
    if (event.key === ZOOM_KEY) setZoom(readZoom());
  });
  window.addEventListener("resize", syncViewport);
  applyZoom();
  syncViewport();
}
