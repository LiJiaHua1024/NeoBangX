/* Agent 工作台的主题层。
   和主站共用同一个偏好键 nbx_theme，进出两个页面看到的是同一套配色；
   主题列表也照抄主站的 THEMES（颜色点见 frontend/script.js）。
   这里不做首屏防闪烁——那段在 agent/index.html 的 <head> 里内联，必须早于样式表。 */

export const THEMES = [
  { id: "paper", name: "宣纸", dot: "linear-gradient(135deg,#b4502a,#8c3316)" },
  { id: "celadon", name: "青瓷", dot: "linear-gradient(135deg,#0e6e5f,#0a5245)" },
  { id: "obsidian", name: "曜石", dot: "linear-gradient(135deg,#e9a15b,#cf7038)" },
  { id: "jade", name: "墨翠", dot: "linear-gradient(135deg,#5cb787,#2f8a66)" },
  { id: "sora", name: "悠空", dot: "linear-gradient(160deg,#6fa8d8 0%,#a8cbe8 55%,#eef6fc 100%)" },
];

export const THEME_KEY = "nbx_theme";
const DEFAULT = "paper";

export function normalizeTheme(id) {
  return THEMES.some((t) => t.id === id) ? id : DEFAULT;
}

export function readTheme() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT;
  }
}

/* 悠空的昼夜：与主站 script.js 的 skyPeriod 保持一致（6:00–22:00 白昼）。
   支持 URL 上强制 #sky=day / #sky=night，方便验收时固定状态。 */
export function skyPeriod(now = new Date()) {
  const forced = (location.hash || "").match(/sky=(day|night)/);
  if (forced) return forced[1];
  const hour = now.getHours();
  return hour >= 6 && hour < 22 ? "day" : "night";
}

export function currentTheme() {
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function applyTheme(id, { persist = true } = {}) {
  const theme = normalizeTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (theme === "sora") root.dataset.sky = skyPeriod();
  else delete root.dataset.sky;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }
  window.dispatchEvent(new CustomEvent("aw:theme", { detail: { theme } }));
  return theme;
}

/* 主题菜单：用 <details> 做开关，点击面板外或 Esc 收起。
   onChange 在切换后调用，用来通知背景引擎重读 CSS 变量。 */
let menuBound = false;
let skyTimer = null;
export function initThemeMenu(onChange = () => {}) {
  const box = document.querySelector("[data-themes]");
  const wrap = box?.closest("details");
  if (!box || !wrap) return;
  if (menuBound) return;

  box.innerHTML = THEMES.map(
    (t) =>
      `<button type="button" class="theme-dot${t.id === "sora" ? " theme-dot-sora" : ""}" data-theme-id="${t.id}" style="background:${t.dot}" title="${t.name}" aria-label="切换到${t.name}主题" aria-pressed="false"></button>`,
  ).join("");

  const paint = () => {
    const now = currentTheme();
    for (const b of box.querySelectorAll("[data-theme-id]"))
      b.setAttribute("aria-pressed", String(b.dataset.themeId === now));
  };

  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-id]");
    if (!b) return;
    applyTheme(b.dataset.themeId);
    paint();
    wrap.open = false;
    onChange(currentTheme());
  });

  wrap.querySelector("summary")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") wrap.open = false;
  });
  document.addEventListener("click", (e) => {
    if (wrap.open && !wrap.contains(e.target)) wrap.open = false;
  });
  window.addEventListener("aw:theme", paint);
  paint();
  menuBound = true;

  // 悠空跨过昼夜分界时自动换天空（每分钟对一次表）
  if (!skyTimer) {
    skyTimer = setInterval(() => {
      if (currentTheme() !== "sora") return;
      const next = skyPeriod();
      if (document.documentElement.dataset.sky !== next) {
        document.documentElement.dataset.sky = next;
        onChange(currentTheme());
      }
    }, 60_000);
  }

  return paint;
}

/* 另一个标签页切了主题：本页跟着换（storage 事件只在别的页面触发）。 */
let storageBound = false;
export function watchStorage(onChange = () => {}) {
  if (storageBound) return;
  storageBound = true;
  window.addEventListener("storage", (e) => {
    if (e.key && e.key !== THEME_KEY) return;
    applyTheme(readTheme(), { persist: false });
    onChange(currentTheme());
  });
}
