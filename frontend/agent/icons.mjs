/* Agent 工作台的图标子集。
   路径与主站 frontend/script.js 的 ICON_PATHS 同源（同名同形），
   但工作台是独立页面，不能为了几个图标去加载 600KB 的主脚本，
   所以这里只保留用得到的那部分，并补 3 个主站没有的 UI 图标。 */

const PATHS = {
  // —— 品牌与导航 ——
  logo: '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  "panel-right": '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
  expand: '<path d="M9 3.5H5.5a2 2 0 0 0-2 2V9M15 3.5h3.5a2 2 0 0 1 2 2V9M15 20.5h3.5a2 2 0 0 0 2-2V15M9 20.5H5.5a2 2 0 0 1-2-2V15"/>',
  compress: '<path d="M9.5 3.5v4a2 2 0 0 1-2 2h-4M14.5 3.5v4a2 2 0 0 0 2 2h4M14.5 20.5v-4a2 2 0 0 1 2-2h4M9.5 20.5v-4a2 2 0 0 0-2-2h-4"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "arrow-right": '<path d="M4 12h15M13 5.5 19.5 12 13 18.5"/>',

  // —— 任务与执行 ——
  sparkle: '<path d="M12 3.5 13.9 8.6 19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z"/><path d="m18.5 15.5.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  play: '<path d="M8 5.2v13.6L19 12 8 5.2Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 1.8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 3.5v4h-4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  wand: '<path d="m6 21 15-15-3-3L3 18l3 3Z"/><path d="m14 7 3 3"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.75-.34-3.94-.93L3 21l1.93-5.57A8.5 8.5 0 1 1 21 11.5Z"/>',

  // —— 材料、工具、成果 ——
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  "file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/><path d="M10 13h4M10 17h4M8 9h1"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  upload: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download: '<path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 15h-1a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v1"/>',
  send: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  "book-open": '<path d="M12 6.6C10.6 5.1 8.7 4.3 6.5 4.3c-1.2 0-2.4.2-3.5.7v13.8c1.1-.5 2.3-.7 3.5-.7 2.2 0 4.1.8 5.5 2.3 1.4-1.5 3.3-2.3 5.5-2.3 1.2 0 2.4.2 3.5.7V5c-1.1-.5-2.3-.7-3.5-.7-2.2 0-4.1.8-5.5 2.3Z"/><path d="M12 6.6v13.8"/>',
  key: '<circle cx="7.5" cy="15.5" r="2.5"/><path d="m11 12 4-4"/><path d="m13 10 2.5 2.5"/><path d="M15 8h2v2"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',

  // —— 界面 ——
  contrast:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3h-1.3a1.7 1.7 0 0 0-1.7 1.7c0 .5.2.9.5 1.3.3.4.5.8.5 1.3A1.7 1.7 0 0 1 12 21Z"/>',
  settings:
    '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  sliders:
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
};

const cls = "aw-svg";

export function icon(name, extra = "") {
  const path = PATHS[name] || PATHS.chat;
  return `<svg class="${cls}${extra ? " " + extra : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

export function fillIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.dataset.iconDone === "1") continue;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.iconDone = "1";
  }
}

export const hasIcon = (name) => Boolean(PATHS[name]);
