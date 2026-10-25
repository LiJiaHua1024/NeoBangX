/* /agent 的 Claude 双主题。
   与普通工具页的 nbx_theme 分开：工作台只呈现 Claude 浅色/深色，默认跟随系统。
   URL #agent-theme=light|dark 可强制，供截图与验收固定状态。 */

export const THEME_KEY = "nbx_agent_theme";
const OPTIONS = [
  {
    id: "light",
    name: "浅色",
    dot: "linear-gradient(135deg,#ffffff 0%,#f4f2f3 100%)",
    icon: "sun",
  },
  {
    id: "dark",
    name: "深色",
    dot: "linear-gradient(135deg,#2b2b2b 0%,#191919 100%)",
    icon: "moon",
  },
  {
    id: "system",
    name: "跟随系统",
    dot: "linear-gradient(135deg,#ffffff 0 50%,#191919 50% 100%)",
    icon: "monitor",
  },
];

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function readPref() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function forcedTheme() {
  return (location.hash || "").match(/agent-theme=(light|dark)/)?.[1] || "";
}

export function resolveTheme(pref = readPref()) {
  const forced = forcedTheme();
  if (forced) return forced;
  if (pref === "light" || pref === "dark") return pref;
  return media.matches ? "dark" : "light";
}

export function currentTheme() {
  return document.documentElement.dataset.agentTheme === "dark"
    ? "dark"
    : "light";
}

export function applyTheme(pref, { persist = true } = {}) {
  const value = pref === "dark" || pref === "light" ? pref : "system";
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {}
  }
  const theme = resolveTheme(value);
  const root = document.documentElement;
  root.dataset.agentTheme = theme;
  root.style.background = theme === "dark" ? "#191919" : "#ffffff";
  root.style.colorScheme = theme;
  document.dispatchEvent(
    new CustomEvent("agent:theme", { detail: { theme, pref: value } }),
  );
  return theme;
}

/* 主题菜单：三段（浅色/深色/跟随系统），勾选当前项。 */
export function initTheme(onChange = () => {}) {
  const button = document.getElementById("theme-toggle");
  const menu = document.getElementById("theme-menu");
  if (!button || !menu) return;

  const paint = () => {
    const pref = readPref();
    menu.innerHTML =
      '<div class="popover-title">外观</div>' +
      OPTIONS.map(
        (item) => `
        <button type="button" class="theme-option" role="menuitemradio"
          aria-checked="${item.id === pref}" data-theme-pref="${item.id}">
          <span class="swatch" style="background:${item.dot}"></span>
          <span>${item.name}</span>
          <span class="tick" aria-hidden="true">${
            item.id === pref
              ? '<svg class="aw-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>'
              : ""
          }</span>
        </button>`,
      ).join("");
  };

  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    paint();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };

  button.onclick = (event) => {
    event.stopPropagation();
    menu.hidden ? open() : close();
  };
  menu.onclick = (event) => {
    const item = event.target.closest("[data-theme-pref]");
    if (!item) return;
    applyTheme(item.dataset.themePref);
    close();
    paint();
    onChange(currentTheme());
  };
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button)
      close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      close();
      button.focus();
    }
  });
  media.addEventListener("change", () => {
    if (readPref() === "system") {
      applyTheme("system", { persist: false });
      onChange(currentTheme());
    }
  });
  document.addEventListener("agent:theme", paint);
  const syncForced = () => {
    const forced = forcedTheme();
    if (forced) applyTheme(forced, { persist: false });
  };
  window.addEventListener("hashchange", syncForced);
  applyTheme(readPref(), { persist: false });
  paint();
  onChange(currentTheme());
}
