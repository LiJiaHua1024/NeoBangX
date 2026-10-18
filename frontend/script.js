/* ============================================================
   NeoBangX — 前端应用（Alpine.js）
   对接 docs/API_CONTRACT.md 定义的全部接口（v1.2 智能错题迁移）
   ============================================================ */

/* ---------------- 自定义 SVG 图标库（不依赖第三方图标库） ---------------- */
const ICON_PATHS = {
  // —— 工具图标 ——
  "document-magnifier": '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8.5"/><path d="M13.5 3v5.5H19"/><circle cx="11.5" cy="14.5" r="2.6"/><path d="m13.6 16.6 2.2 2.2"/>',
  "speech-bubble": '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.35 0-2.63-.32-3.76-.88L4 21l1.4-4.7A8.5 8.5 0 1 1 21 12Z"/><path d="M8.5 12h.01M12.5 12h.01M16.5 12h.01"/>',
  "report": '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.8h6v3H9z"/><path d="M9 10.5h6M9 14h6M9 17.5h3.5"/>',
  "vocabulary": '<path d="M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h14"/><path d="M9 7.5h6M9 11h4"/>',
  "translate": '<path d="M4 5h9M8.5 3v2c0 3.8-2.4 7.2-4.9 8.8"/><path d="M5.2 8.2c1.4 2.9 3.9 5.3 6.8 6.3"/><path d="m12.5 21 4.5-10 4.5 10M14.2 17h5.6"/>',
  "tags": '<path d="M3.5 12.6 11 5.1a2 2 0 0 1 1.4-.6H19a2 2 0 0 1 2 2v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a2 2 0 0 1-2.8 0l-6.6-6.6a2 2 0 0 1 0-2.8Z"/><circle cx="15.8" cy="8.2" r="1.3"/>',
  "puzzle": '<rect x="3" y="3" width="8" height="8" rx="2.2"/><rect x="13" y="13" width="8" height="8" rx="2.2"/><path d="M15.5 3H19a2 2 0 0 1 2 2v3.5M8.5 21H5a2 2 0 0 1-2-2v-3.5"/>',
  "grammar": '<path d="M17.5 4H10a3.5 3.5 0 0 0 0 7h2.5"/><path d="M13 4v16M17.5 4v16"/>',
  "writing": '<path d="m14.5 4.5 5 5L8 20H3v-5L14.5 4.5Z"/><path d="m12.5 6.5 5 5"/>',
  "correction": '<path d="m3.5 12 2.5 2.5L10.5 10"/><path d="m3.5 17.5 2.5 2.5 4.5-4.5"/><path d="M13.5 6h7M13.5 12h7M13.5 18h4.5"/>',
  "letter": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7.5 8.5 5.8 8.5-5.8"/>',
  "target": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
  "projector": '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M12 16.5V19M8 21.5l4-2.5 4 2.5"/><path d="M7.5 8.5h5M7.5 11.5h9"/>',
  "sparkle": '<path d="M12 3.5 13.9 8.6 19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z"/><path d="m18.5 15.5.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  "book-open": '<path d="M12 6.6C10.6 5.1 8.7 4.3 6.5 4.3c-1.2 0-2.4.2-3.5.7v13.8c1.1-.5 2.3-.7 3.5-.7 2.2 0 4.1.8 5.5 2.3 1.4-1.5 3.3-2.3 5.5-2.3 1.2 0 2.4.2 3.5.7V5c-1.1-.5-2.3-.7-3.5-.7-2.2 0-4.1.8-5.5 2.3Z"/><path d="M12 6.6v13.8"/>',
  "read-write": '<path d="M11 6.6C9.8 5.2 8.1 4.3 6 4.3c-1 0-2.1.2-3 .7v13.6c.9-.5 2-.7 3-.7 2.1 0 3.8.9 5 2.3V6.6Z"/><path d="m16.5 4.5 3 3L12 15l-4.2 1.2L9 12l7.5-7.5Z"/>',
  "edit-1": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19.5l-4 1 1-4L16.5 3.5Z"/>',
  "edit-2": '<path d="M17 3a2.85 2.85 0 1 1 4 4L8 20l-5 1 1-5L17 3Z"/><path d="m15 5 4 4"/>',
  "question": '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.35c-.75.3-.9.9-.9 1.65"/><path d="M12 16.8h.01"/>',
  "question-2": '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8.5"/><path d="M13.5 3v5.5H19"/><path d="M10.1 13.2a2 2 0 1 1 2.65 1.9c-.6.25-.75.75-.75 1.35"/><path d="M12 18.5h.01"/>',
  "cloze": '<path d="M4 6.5h16M4 10.5h6M14 10.5h6M4 14.5h16M4 18.5h4M12 18.5h8"/>',
  "analysis": '<path d="M4 4v15a1 1 0 0 0 1 1h15"/><path d="M8.5 15.5v-4M12.5 15.5v-7M16.5 15.5v-2.5M20 15.5V6"/>',
  "bug": '<rect x="8" y="8.5" width="8" height="10" rx="4"/><path d="M9.5 7a2.5 2.5 0 0 1 5 0"/><path d="M12 8.5V6.5M8.6 10 5 8.8M15.4 10 19 8.8M8 13.5H4M16 13.5h4M8.6 16.8 5 18.5M15.4 16.8 19 18.5"/>',
  "replace": '<path d="M4 8h12.5L13 4.5M20 16H7.5L11 19.5"/>',
  "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  "chat": '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.75-.34-3.94-.93L3 21l1.93-5.57A8.5 8.5 0 1 1 21 11.5Z"/>',
  "migration": '<path d="M5 6.5h14M5 12h9M5 17.5h5"/><path d="m16 14 4 4-4 4M20 18h-7"/>',
  // 语篇结构与主旨反推（工具 34）：git-branch，分支即"结构骨架"隐喻
  "git-branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "lightbulb": '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  "route": '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  // 翻译（工具 33）：地球经纬线。translate 已被工具 5 占用，这里要一个能一眼区分的
  "languages": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/>',

  // —— UI 图标 ——
  "logo": '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>',
  "cloud": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  "menu": '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  "x": '<path d="M6 6l12 12M18 6 6 18"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevrons-left": '<path d="m18 7-5 5 5 5M11 7l-5 5 5 5"/>',
  "chevrons-right": '<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>',
  "chevrons-up": '<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>',
  "chevrons-down": '<path d="m7 11 5 5 5-5"/><path d="m7 18 5-5 5 5"/>',
  "panel-right": '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
  "expand": '<path d="M9 3.5H5.5a2 2 0 0 0-2 2V9M15 3.5h3.5a2 2 0 0 1 2 2V9M15 20.5h3.5a2 2 0 0 0 2-2V15M9 20.5H5.5a2 2 0 0 1-2-2V15"/>',
  "compress": '<path d="M9.5 3.5v4a2 2 0 0 1-2 2h-4M14.5 3.5v4a2 2 0 0 0 2 2h4M14.5 20.5v-4a2 2 0 0 1 2-2h4M9.5 20.5v-4a2 2 0 0 0-2-2h-4"/>',
  "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 1.8"/>',
  "bookmark": '<path d="M6.5 3.5h11V21L12 16.8 6.5 21V3.5Z"/>',
  "bookmark-plus": '<path d="M6.5 3.5h11V21L12 16.8 6.5 21V3.5Z"/><path d="M12 8v5M9.5 10.5h5"/>',
  "pen": '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4.2 1.2L5 15 16.5 3.5Z"/>',
  "trash": '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  "copy": '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 15h-1a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v1"/>',
  "check": '<path d="m4.5 12.5 5 5 10-11"/>',
  "stop": '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  "send": '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  "eye": '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  "bold": '<path d="M6.5 4h7a4 4 0 0 1 0 8h-7zM6.5 12h8a4 4 0 0 1 0 8h-8z"/>',
  "highlight": '<path d="m13.6 4.4 6 6-7 7H7.4l-1.9-3.9 8.1-9.1Z"/><path d="M4 20.5h16"/>',
  "eye-off": '<path d="m4 4 16 16"/><path d="M10.5 6c.5-.1 1-.15 1.5-.15 6 0 9.5 6.15 9.5 6.15a16.8 16.8 0 0 1-2.7 3.25M6.6 6.9A16.5 16.5 0 0 0 2.5 12S6 18.15 12 18.15c1.15 0 2.25-.2 3.25-.57"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  "plus": '<path d="M12 5v14M5 12h14"/>',
  "insert": '<path d="M12 4v9.5M7.5 10 12 14.5 16.5 10"/><path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>',
  "refresh": '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 3.5v4h-4"/>',
  "wand": '<path d="m6 21 15-15-3-3L3 18l3 3Z"/><path d="m14 7 3 3"/>',
  "sliders": '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
  "home": '<path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>',
  "eraser": '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 20.5"/><path d="M21 21H9.5"/><path d="m8.5 8 7.5 7.5"/>',
  "paperclip": '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  "file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/><path d="M10 13h4M10 17h4M8 9h1"/>',
  "key": '<circle cx="7.5" cy="15.5" r="2.5"/><path d="m11 12 4-4"/><path d="m13 10 2.5 2.5"/><path d="M15 8h2v2"/>',
  "settings": '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  "alert": '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  "download": '<path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  "upload": '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  "print": '<path d="M7 8V3h10v5"/><path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',

  // —— 全屏讲解舞台 ——
  "grid": '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  "pin": '<path d="M12 16.5V21"/><path d="M9.5 3h5v6.2l2.7 3.6a1 1 0 0 1-.8 1.6H7.6a1 1 0 0 1-.8-1.6l2.7-3.6V3Z"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-up": '<path d="m18 15-6-6-6 6"/>',
  // —— 图片识别（拍照 / 相册 / 扫码） ——
  "scan-text": '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M8.5 9.5h7M8.5 12.5h7M8.5 15.5h4"/>',
  "camera": '<path d="M3.5 9A2.5 2.5 0 0 1 6 6.5h1a1.6 1.6 0 0 0 1.4-.8l.5-.9a1.6 1.6 0 0 1 1.4-.8h3.4a1.6 1.6 0 0 1 1.4.8l.5.9a1.6 1.6 0 0 0 1.4.8h1A2.5 2.5 0 0 1 20.5 9v7A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16Z"/><circle cx="12" cy="12.5" r="3.2"/>',
  "image": '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.6" cy="10" r="1.5"/><path d="m4 17.2 4.3-4a2 2 0 0 1 2.7 0l3.4 3.2"/><path d="m13.6 15.2 1.5-1.4a2 2 0 0 1 2.7 0l2.2 2"/>',
  "qr": '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.6"/><path d="M14 14h3.2v3.2H14zM20.5 14v2.4M17.6 20.5h2.9M14 20.5h1.2"/>',
  // —— 图片查看 / 编辑（转正 · 裁剪） ——
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  "crop": '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  "undo": '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  "history": '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
};

function icon(name, cls = "w-5 h-5") {
  const d = ICON_PATHS[name] || ICON_PATHS["chat"];
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/* ---------------- 剪贴板复制（兼容 HTTP 内网部署：execCommand 回退，不依赖安全上下文） ---------------- */
function copyToClipboard(text) {
  return new Promise((resolve) => {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      const sel = document.getSelection();
      const restore = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      if (restore) {
        sel.removeAllRanges();
        sel.addRange(restore);
      }
      ta.remove();
      resolve(ok);
    };
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
    } else {
      fallback();
    }
  });
}

function copyRichTextToClipboard(html, plain) {
  return new Promise((resolve) => {
    const fallback = () => {
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.setAttribute("aria-hidden", "true");
      holder.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;";
      holder.innerHTML = html;
      document.body.appendChild(holder);

      const selection = document.getSelection();
      const restore = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      const range = document.createRange();
      range.selectNodeContents(holder);
      holder.focus();
      selection.removeAllRanges();
      selection.addRange(range);

      const onCopy = (event) => {
        if (!event.clipboardData) return;
        event.clipboardData.setData("text/html", html);
        event.clipboardData.setData("text/plain", plain);
        event.preventDefault();
      };
      document.addEventListener("copy", onCopy);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.removeEventListener("copy", onCopy);
      if (restore) {
        selection.removeAllRanges();
        selection.addRange(restore);
      }
      holder.remove();
      resolve(ok);
    };

    if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]).then(() => resolve(true), fallback);
    } else {
      fallback();
    }
  });
}

/* ---------------- 常量 ---------------- */
const LS = {
  theme: "nbx_theme",
  history: "nbx_history",
  titleJobs: "nbx_title_jobs",
  favorites: "nbx_favorites",
  ui: "nbx_ui",
  draft: "nbx_draft",
  model: "nbx_model",
  auth: "nbx_auth",
  code: "nbx_code",
  // 工具目录快照：跨境线路上 /api/tools/ 要一个来回，先用上次的结果把界面顶上
  toolsCache: "nbx_tools_cache",
};
/* 侧栏布局分界：视口 ≥ WIDE_MIN（CSS 像素）时左右侧栏并入同一行（三栏并排），
   以下一律为浮层抽屉（盖在内容之上）。与 index.html 的 2xl: 前缀、
   styles.css 的 max-width:1535.98px 媒体查询必须保持一致。
   一律用 matchMedia 判定：它与 CSS 媒体查询同一套口径（innerWidth 在滚动条/缩放下
   会有偏差），并且能在跨分界时主动通知，不必只靠 resize 兜。
   注意：分档只切换「行为」（触发钮显隐、遮罩是否可用），不要新写 display 工具类去压
   自定义 CSS —— 浏览器版 Tailwind 注入样式的位置在 <link> 之前，同权重下 styles.css
   反而赢，2xl:hidden 这类类名会被自定义类的 display 吃掉。 */
const WIDE_MIN = 1536;
const WIDE_MQ = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
/* 翻译工具的上下分屏分档：与 styles.css 的 max-width:1023.98px、
   标记里的 lg: 前缀三方必须一致（同 WIDE_MQ 那条约定）。
   「译文栏按需出现」只在这一档成立，宽屏两栏始终并排 */
const TR_STACK_MQ = window.matchMedia("(max-width: 1023.98px)");
const HISTORY_LIMIT = 100;
// 迁移收藏单条体积可观（内嵌全部卡片输出），同样需要上限防止 localStorage 溢出
const FAVORITES_LIMIT = 100;
// 推理过程展示上限：只让用户“看到正在思考”，不无限制堆内容。
// 主流程 / 词汇替换共用 3000 字，迁移单卡 2000 字，超出截头保尾；
// 推理另有 max-height + 内部滚动双保险，盒子本身高度恒定。
const REASONING_LIMIT = 3000;
const CARD_REASONING_LIMIT = 2000;
// 额度显示仪的圆环几何：dasharray 用真实周长换算，不用 pathLength
// （Safari 对 <circle pathLength> 的历史支持不可靠，忽略时百分比会被当成用户单位）
const QUOTA_RING_R = 10.5;
const QUOTA_RING_C = 2 * Math.PI * QUOTA_RING_R;
/* 续写指令约定的「其实已经写完」控制标记（见 prompts/继续生成.md）：模型只回这一行时，
   前端把它剥掉、保持记录原状态，并告诉用户内容已经完整——既不把标记拼进成品文档，
   也不误标成已完成。识别刻意放宽（大小写、@ 数量、空格/下划线/连字符、裸词都要认），
   实测模型对定界符的写法会漂移（试卷工具的 @@TAG@@ 就吃过这个亏），严格匹配必漏。 */
const CONTINUE_DONE_SRC = "[＠@]*\\s*CONTINUE[\\s_-]*DONE\\s*[＠@]*";

/* 历史全文检索引擎（nbx-history-search.js）。运行期对象不进 Alpine 响应式数据：
   里面是索引、Bloom 位图与文档引用，深代理既没必要也会拖慢查询。
   内核本身已移出首屏关键路径，首次要用时才拉（见 nbxEnsureHistorySearch）。 */
let _historySearch = null;
/* 是否已经为「内核还没到」挂过一次补索引的回调（避免每个 getter 都挂一遍） */
let _historySearchDeferred = false;

/* ---------------- 「描述需求找工具」参数 ----------------
   用户不需要按 Enter：只要「有意停顿」就自动搜。什么叫有意停顿分两档：
   - 打完一句话自然停手（PAUSE_MS 内没有新输入）：这是最常见的一种，等待窗口
     里面板顶部有一条进度条走满，用户能直接看出「原来停一下就会搜」，不必猜；
   - 明确收尾的输入（以句读标点/空白结尾，或粘贴）：粘贴是完整的一次动作，
     用一个短窗确认后立即发，不再等满 PAUSE_MS。
   输入一旦变化，在途的那次搜索立刻被掐断、重新计时 —— 上一句话的结论对新的
   一句话没有意义，也不该让它晚一步盖掉新结果。
   中文输入法必须走 composition：拼音候选阶段也会触发 input，那不是用户的意思，
   组字过程中一个请求都不发（见 onToolSearchInput / onToolSearchCompositionEnd）。 */
const TOOL_SEARCH_PAUSE_MS = 500;
const TOOL_SEARCH_EARLY_MS = 140;
/* 少于此字数不打扰：一两个字的输入几乎必是还没说完 */
const TOOL_SEARCH_MIN_CHARS = 2;
/* 超过这个长度就不是「一句话需求」而是粘进来的正文了：不发请求，改成提示用户
   先挑工具再把内容ぁ到工具里（拿整篇作文去问 Jev 既贵又不可能准） */
const TOOL_SEARCH_MAX_CHARS = 200;
const TOOL_SEARCH_LIMIT = 3;
/* 「自由对话」：工具清单之外的兵底。搜索一个也匹不上时把用户送到这里，
   比让他对着空结果自己再想一遍强。id 与后端 tools.py 的 REFERENCE_TOOLS 一致。 */
const FREEFORM_TOOL_ID = "25";
/* 输入框空着时轮播的示例：教用户「可以用大白话说，不用背工具名」 */
const TOOL_SEARCH_EXAMPLES = [
  "帮我把这篇学生作文批改一下",
  "把这套卷子的重点题讲评一下",
  "给这篇课文写一份研读报告",
  "按这个语法点设计一节情境课",
  "把这段原文翻译成英文",
];
/* 视为「这句话说完了」的收尾字符（中英文标点、空白） */
const TOOL_SEARCH_END_CHARS = "\n。！？；：，、.!?;:，, ";

function toolSearchLooksFinal(text) {
  const trimmed = String(text || "").replace(/\s+$/, "");
  if (!trimmed) return false;
  return TOOL_SEARCH_END_CHARS.includes(trimmed[trimmed.length - 1]);
}

/* 本地关键词匹配：后端不可达时的兜底，让搜索框任何时候都不空转。
   与后端 tool_search.keyword_search 同一套思路（零依赖、不引分词库）：
   工具名整体被叫出来最强，其次是查询与「工具名 / 用途描述」的字符 bigram 重叠。
   命中后端时这条路径不会走 —— 它会用在后端自己配的关键词兜底（带别名表）上。 */
function toolSearchBigrams(text) {
  const cleaned = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (cleaned.length < 2) return cleaned ? [cleaned] : [];
  const out = [];
  for (let i = 0; i < cleaned.length - 1; i += 1) out.push(cleaned.slice(i, i + 2));
  return out;
}

function toolSearchKeywordMatch(groups, query, limit = TOOL_SEARCH_LIMIT) {
  const text = String(query || "").toLowerCase().trim();
  if (!text) return [];
  const queryGrams = new Set(toolSearchBigrams(text));
  const share = (grams) => {
    if (!grams.length || !queryGrams.size) return 0;
    let hit = 0;
    for (const gram of new Set(grams)) if (queryGrams.has(gram)) hit += 1;
    return hit / queryGrams.size;
  };
  const rows = [];
  for (const group of groups || []) {
    for (const tool of group.tools || []) {
      const name = String(tool.name || "").toLowerCase();
      const description = String(tool.description || "").toLowerCase();
      let score = 0;
      if (name && text.includes(name)) score += 6 + 1.5 * name.length;
      score += 6 * share(toolSearchBigrams(name));
      score += 4 * share(toolSearchBigrams(description));
      if (score <= 0) continue;
      rows.push({
        tool_id: String(tool.id),
        name: tool.name,
        icon: tool.icon || "",
        description: tool.description || "",
        group_id: group.id || "",
        group_title: group.title || "",
        score: Math.min(1, Number((score / 12).toFixed(4))),
        source: "keyword",
        reason: tool.description || "",
      });
    }
  }
  rows.sort((a, b) => b.score - a.score || (a.tool_id < b.tool_id ? -1 : 1));
  return rows.slice(0, limit);
}

/* ---------------- 图片识别（OCR）参数 ---------------- */
// 工具 id 与后端 tools.py 的 OCR_TOOL_ID 一致
const OCR_TOOL_ID = "32";
// 单次最多识别张数（后端硬上限 12，这里保守到 8 页，够一份整卷）
const OCR_MAX_IMAGES = 8;
// 压缩长边与 JPEG 质量：上游视觉模型会把图缩到 1–2k 像素级，再大只是白占带宽
const OCR_MAX_EDGE = 2000;
const OCR_COMPRESS_QUALITY = 0.85;
const OCR_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const OCR_MODES = {
  printed: { label: "印刷试卷", rule: "只转录印刷文字，忽略手写答案与批注", icon: "scan-text" },
  handwritten: { label: "手写作文", rule: "按修改后的最终状态逐字转录，保留原有拼写与语法错误", icon: "writing" },
};
// 识别类型由工具用途决定，不让用户选：会收到学生手写稿的只有「学生作文批改」，
// 其余工具收到的都是原卷印刷稿（没有人会手抄一份试卷来拍）。要改绑定就改这张表。
const OCR_HANDWRITTEN_TOOLS = ["10"]; // 学生作文批改
// 有这几处两种素材都可能来，保留手动选择：识别图片文字、自由对话、翻译
// （翻译收到的是别人递来的材料，印刷试卷与手写作文都可能有）
const OCR_MANUAL_MODE_TOOLS = ["25", "32", "33"];
function ocrModeForTool(toolId) {
  return OCR_HANDWRITTEN_TOOLS.indexOf(String(toolId == null ? "" : toolId)) >= 0 ? "handwritten" : "printed";
}
function ocrModeCanChoose(toolId) {
  return OCR_MANUAL_MODE_TOOLS.indexOf(String(toolId == null ? "" : toolId)) >= 0;
}
function ocrModeMeta(mode) {
  return OCR_MODES[mode] || OCR_MODES.printed;
}
/* 识别记录在历史列表里的标题：取正文第一个像样的行的前 16 个字。
   不调 /api/chat/title——转录结果本身就是最认得出这份材料的东西，让模型再总结一遍
   纯属多花一次调用。Markdown 前缀（#、-、>）与空白先剥掉，免得列表里全是符号。
   翻译记录同理用原文的头一行当标题，所以这里是共用的。 */
function historyTitleFromText(text) {
  const lines = String(text || "").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/^[\s#>*\-+]+/, "").trim();
    if (line.length >= 2) return line.slice(0, 16);
  }
  return "";
}

/* ---------------- 翻译（工具 33）参数 ---------------- */
// 工具 id 与后端 tools.py 的 TRANSLATE_TOOL_ID 一致
const TRANSLATE_TOOL_ID = "33";
const TRANSLATE_TOOL_ICON = "languages";
/* 语言表：界面显示 label（中文名），送进提示词的是 native（母语者的写法）。
   语言对是这份提示词里唯一无法从材料推断出来的信息，名字给错就等于译错目标，
   所以用「简体中文」「English (US)」这类模型最认得的写法，而不是语言代码。
   short 只用于历史列表那枚「英→中」小标签。 */
const TR_LANGS = [
  { id: "auto", label: "自动检测", native: "auto", short: "自动", sourceOnly: true },
  { id: "zh-Hans", label: "简体中文", native: "简体中文", short: "中" },
  { id: "zh-Hant", label: "繁体中文", native: "繁體中文", short: "繁" },
  { id: "en-US", label: "英语（美式）", native: "English (US)", short: "英" },
  { id: "en-GB", label: "英语（英式）", native: "English (UK)", short: "英" },
  { id: "ja", label: "日语", native: "日本語", short: "日" },
  { id: "ko", label: "韩语", native: "한국어", short: "韩" },
  { id: "fr", label: "法语", native: "Français", short: "法" },
  { id: "de", label: "德语", native: "Deutsch", short: "德" },
  { id: "es", label: "西班牙语", native: "Español", short: "西" },
  { id: "ru", label: "俄语", native: "Русский", short: "俄" },
  { id: "it", label: "意大利语", native: "Italiano", short: "意" },
  { id: "pt", label: "葡萄牙语", native: "Português", short: "葡" },
  { id: "ar", label: "阿拉伯语", native: "العربية", short: "阿" },
  { id: "th", label: "泰语", native: "ไทย", short: "泰" },
  { id: "vi", label: "越南语", native: "Tiếng Việt", short: "越" },
];
const TR_DEFAULT_SOURCE = "auto";
const TR_DEFAULT_TARGET = "zh-Hans";
function trLangById(id) {
  const key = String(id == null ? "" : id);
  return TR_LANGS.find((l) => l.id === key) || null;
}
function trLangLabel(id) {
  const lang = trLangById(id);
  return lang ? lang.label : "";
}
function trLangNative(id) {
  const lang = trLangById(id);
  return lang ? lang.native : "";
}
function trLangShort(id) {
  const lang = trLangById(id);
  return lang ? lang.short : "";
}
/* 源语言与目标语言撞车时，目标语言换成该源语言的常用对译方向：中文→英语，其余→简体中文。
   「原文设成简体中文时，目标语言默认为英语（美式）」就是这一条 */
function trTargetFor(sourceId) {
  return String(sourceId) === "zh-Hans" ? "en-US" : TR_DEFAULT_TARGET;
}
// 历史列表里的语言对标签（如「英→中」）；索引项也要能显示，所以存成标量
function trPairShort(sourceId, targetId) {
  const from = trLangShort(sourceId);
  const to = trLangShort(targetId);
  return from && to ? `${from}→${to}` : "";
}
/* 对照同步滚动：把一侧的滚动进度映射到另一侧。
   两侧的行高与折行不可能逐行相同，能对齐的是「进度」而不是「行」，按比例映射是唯一稳的做法。
   任一侧不可滚（内容还没对方长）时返回 null，调用方直接放弃同步——硬凑只会抖。 */
function trSyncTargetTop(fromTop, fromMax, toMax) {
  const f = Number(fromMax) || 0;
  const t = Number(toMax) || 0;
  if (f <= 0 || t <= 0) return null;
  const ratio = Math.min(1, Math.max(0, (Number(fromTop) || 0) / f));
  return Math.round(ratio * t);
}

/* ---- 图片编辑（转正 · 裁剪）的参数与几何 ---- */
// 裁剪/转正后重新编码的质量：原图是 0.85 已经是二次编码，这里留高一点，别再叠一层损失
const OCR_EDIT_QUALITY = 0.9;
// 整幅：不做任何裁剪时的选择框
const OCR_FULL_RECT = { x: 0, y: 0, w: 1, h: 1 };
// 裁剪框的最小边长（占画面比例）：再小手指一抖就没了，也裁不出能认的字
const OCR_CROP_MIN = 0.04;
// 八个把手：四角 + 四边（nw/n/ne/w/e/sw/s/se）
const OCR_CROP_HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
// 放大上限与双击放大的倍数：试卷上的小字放到 8 倍足够对到行，再大只是糊
const OCR_VIEW_MAX = 8;
const OCR_VIEW_TAP = 2.5;

/* 几何一律用归一化矩形（x/y/w/h 都是 0–1）算，只在烘焙那一刻换成像素。
   旋转、裁剪、屏幕尺寸三件事各算各的，互不牵扯；下面都是纯函数，测试直接验算。 */
function ocrClampNum(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
function ocrClamp01(v) {
  return ocrClampNum(Number(v) || 0, 0, 1);
}
// 归一化值留三位小数：够用，也让断言能直接写死
function ocrRound3(v) {
  return Math.round(v * 1000) / 1000;
}
/* 图转了 90°，选择框跟着转：不转的话，用户转完图会发现框跑去框别的地方了。
   顺时针（dir > 0）时，旧画面上的点 (x,y) 落到新画面的 (1-y,x)，矩形随之换宽高 */
function ocrRotateRect(rect, dir) {
  const r = rect || OCR_FULL_RECT;
  const cw = dir > 0;
  const out = cw
    ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
  return {
    x: ocrRound3(ocrClamp01(out.x)),
    y: ocrRound3(ocrClamp01(out.y)),
    w: ocrRound3(ocrClamp01(out.w)),
    h: ocrRound3(ocrClamp01(out.h)),
  };
}
/* 旋转后的画面尺寸：90/270 交换宽高 */
function ocrRotatedSize(w, h, rotate) {
  const r = (((Number(rotate) || 0) % 360) + 360) % 360;
  const width = Math.max(1, Math.round(Number(w) || 1));
  const height = Math.max(1, Math.round(Number(h) || 1));
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}
/* 按比例装进一个盒子（contain）：装得下就原样，绝不放大 */
function ocrFitSize(w, h, boxW, boxH) {
  const width = Math.max(1, Math.round(Number(w) || 1));
  const height = Math.max(1, Math.round(Number(h) || 1));
  const bw = Math.max(0, Number(boxW) || 0);
  const bh = Math.max(0, Number(boxH) || 0);
  if (!bw || !bh) return { width: 0, height: 0 };
  const k = Math.min(bw / width, bh / height, 1);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
/* 烘焙计划：一次画布同时完成「旋转」和「裁剪」，中间不落第二次编码。
   crop 的坐标系是「旋转之后」的画面——就是用户在屏幕上画框看到的那张，
   所以先按旋转后的尺寸换算像素，再把矩形夹进画布内，避免浮点误差裁出界 */
function ocrBakePlan(w, h, rotate, crop) {
  const baseW = Math.max(1, Math.round(Number(w) || 1));
  const baseH = Math.max(1, Math.round(Number(h) || 1));
  const r = (((Number(rotate) || 0) % 360) + 360) % 360;
  const rotated = ocrRotatedSize(baseW, baseH, r);
  const c = crop || OCR_FULL_RECT;
  let sx = Math.round(ocrClamp01(c.x) * rotated.width);
  let sy = Math.round(ocrClamp01(c.y) * rotated.height);
  let sw = Math.max(1, Math.round(ocrClamp01(c.w) * rotated.width));
  let sh = Math.max(1, Math.round(ocrClamp01(c.h) * rotated.height));
  sx = ocrClampNum(sx, 0, rotated.width - 1);
  sy = ocrClampNum(sy, 0, rotated.height - 1);
  sw = ocrClampNum(sw, 1, rotated.width - sx);
  sh = ocrClampNum(sh, 1, rotated.height - sy);
  return {
    baseW, baseH, rotate: r,
    rotW: rotated.width, rotH: rotated.height,
    sx, sy, sw, sh, outW: sw, outH: sh,
  };
}
// 识别是付费的视觉调用（后端不计费但仅限流放行），始终要有效使用码，免码试用模型也不适用
const OCR_CODE_HINT = "识别需要有效使用码";
// 图片文件判定：MIME 优先（拖拽进来一般带类型），扩展名兜底（部分环境上传不带 type）
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "bmp", "gif", "avif"];
function isImageFile(file, ext) {
  const type = (file && file.type) || "";
  if (type.indexOf("image/") === 0) return true;
  return IMAGE_EXTENSIONS.indexOf(String(ext || "").toLowerCase()) >= 0;
}

/* ---------------- 试卷可视化全解：@@TAG@@ 标签识别（宽松版） ----------------
   契约要求标签独占一行且 @@TAG@@ 双向闭合，但实测模型会漂移：@@@PITFALLS::（多打一个 @、
   用冒号收尾）、@@ANSWER=D、标签粘在上一字段行尾等，严格正则会整段漏识别，导致易错点丢失、
   原始标记泄露进正文、选项/答案被吞进上一字段。识别统一放宽：开头 2+ 个 @/＠、名字大小写
   不敏感、收尾 @@ = : ： :: 均可；一行内出现多个标签时逐段切分，前段文本归当前字段。
   下面的名单即白名单：不在名单里的 @@xx 一律当普通正文，避免误伤语篇内容。 */
const VP_TAG_NAMES = [
  "TRANSFER_PASSAGE", "TRANSFER_STEM", "TRANSFER_OPTIONS", "TRANSFER_ANSWER", "TRANSFER_EXPL",
  "WRITING_POINTS", "WRITING_OUTLINE", "WRITING_SAMPLE", "PATTERN_NAME", "PATTERN_STEPS",
  "PASSAGE_DEF", "PASSAGE_REF", "PITFALLS", "DISTRACTOR", "EVIDENCE", "OPTIONS", "PASSAGE", "ANSWER", "REASON",
  // GROUP_INTRO 必须排在 GROUP 前：正则交替按顺序匹配，否则 "GROUP" 会吃掉 "GROUP_INTRO" 前缀
  "QTYPE", "GROUP_INTRO", "GROUP", "NOTICE", "TOTAL", "PAPER", "STEM", "END_Q", "KEY", "Q",
];
const _VP_TAG_DELIM = String.raw`([＠@]{2,}|[=＝]|[:：]{1,2})`;
// 行首标签：捕获组 1=标签名 2=定界符 3=同行值
const VP_TAG_LINE_RE = new RegExp(`^[＠@]{2,}\\s*(${VP_TAG_NAMES.join("|")})\\s*${_VP_TAG_DELIM}[ \\t]*(.*)$`, "i");
// 行内标签定位：在任意位置找下一个标签标记
const VP_TAG_FIND_RE = new RegExp(`[＠@]{2,}\\s*(?:${VP_TAG_NAMES.join("|")})\\s*${_VP_TAG_DELIM}`, "i");
// 门卫：输出残片里是否出现过自定义标签（解析入口分流用，只认白名单标签名）
const VP_HAS_TAG_RE = new RegExp(`[＠@]{2,}\\s*(?:${VP_TAG_NAMES.join("|")})\\s*${_VP_TAG_DELIM}`, "i");
// 广义残片判定：任何形如 @@词@@ / @@词= / @@词: 的 token（含白名单外的自造标签）。
// 仅供"不裸奔原文"的门卫使用——宁可置空显示也不能把原始标记当 Markdown 泄露出去。
const VP_ANY_TAG_RE = /[＠@]{2,}[A-Za-z_]{1,}\s*(?:[＠@]{2,}|[=＝]|[:：])/;
// 语篇编号规范化：模型可能写成 p3 / P-3 / "P3."，统一成大写去符号的键做查表，
// 展示时仍用 @@PASSAGE_DEF@@ 行上的原始写法（它才是权威拼法）
const vpNormPassageRef = (v) => String(v == null ? "" : v).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
// 显式声明「本题无语篇」的编号写法（写作题）
const VP_NO_PASSAGE_REFS = new Set(["", "-", "NONE", "NOPASSAGE", "NULL"]);

/* ---------------- 浏览器指纹（ThumbmarkJS，仅用于识别共享，不做拦截） ----------------
   UMD 经 CDN 引入（frontend/index.html），计算失败/被拦截时静默降级为空，
   绝不阻塞业务。结果缓存到 localStorage，请求时经请求头上报。
   v2：摘要扩到 16 字段（型号/系统版本/GPU/触屏/内存/色深/语言列表/电池），
   键名升级强制重算一次，老缓存作废。 */
const NBX_FP_KEY = "nbx_fp_v2";
const nbxFp = { hash: "", summary: "", ready: false };
try {
  const cached = JSON.parse(localStorage.getItem(NBX_FP_KEY) || "null");
  if (cached && typeof cached.hash === "string" && cached.hash) {
    nbxFp.hash = cached.hash.slice(0, 128);
    nbxFp.summary = String(cached.summary || "").slice(0, 2000);
  }
} catch { /* 缓存损坏时忽略 */ }
function nbxFpHeaders() {
  try {
    if (!nbxFp.hash) return {};
    const h = { "X-Client-Fingerprint": String(nbxFp.hash).replace(/[^\x20-\x7E]/g, "") };
    if (nbxFp.summary) {
      const s = String(nbxFp.summary).replace(/[^\x20-\x7E]/g, "");
      if (s) h["X-Client-Fp-Summary"] = s;
    }
    return h;
  } catch {
    return {};
  }
}
/* GPU 渲染器。ThumbmarkJS 的 webgl 组件只回 {commonPixelsHash}，没有 renderer；
   显卡串在 hardware.videocard 里，而它只在被遮蔽值为空时才填 rendererUnmasked ——
   Chrome 的 VENDOR/RENDERER 恒非空，所以那里通常只有无用的 "WebKit WebGL"。
   因此先自己探一次 WEBGL_debug_renderer_info 拿未遮蔽串，探不到再退回组件值。 */
function nbxFpGpu(components) {
  const c = components || {};
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
      if (name) return String(name).trim();
    }
  } catch { /* 拿不到就退回组件值 */ }
  const vc = (c.hardware && c.hardware.videocard) || null;
  const raw = vc ? String(vc.rendererUnmasked || vc.renderer || "") : "";
  return raw.trim();
}

function nbxFpSummarize(components, uach) {
  // 精简设备摘要：优先用 ThumbmarkJS components，缺字段时用 navigator 兜底；
  // uach 为 userAgentData.getHighEntropyValues 结果（仅 Chromium），用于型号与系统版本
  try {
    const c = components || {};
    const u = uach || {};
    const plat = (c.system && c.system.platform) || c.platform
      || (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    // ThumbmarkJS 的 locales 组件键名是复数 languages，值是单个字符串（"zh-CN"）
    const lang = (c.locales && c.locales.languages) || navigator.language || "";
    // screen 组件没有 width/height（只有 colorDepth / maxTouchPoints / mediaMatches，
    // 而 resolution 只在非 iPad 触屏移动端才赋值）——尺寸只能读 window.screen，
    // 换成 resolution 会让桌面 Windows / macOS 的尺寸查表全部失效
    const w = window.screen.width || "";
    const h = window.screen.height || "";
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || "";
    const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || "";
    const data = {
      os: String(plat).slice(0, 64),
      lang: String(lang).slice(0, 16),
      scr: `${w}x${h}`,
      dpr,
      cores,
      tz: String(tz).slice(0, 64),
    };
    // 安卓真实型号串；Windows 11/10、macOS/iOS 大版本靠 platformVersion 区分
    const model = String(u.model || "").trim();
    if (model) data.model = model.slice(0, 40);
    const pv = String(u.platformVersion || "").trim();
    if (pv) data.pv = pv.slice(0, 20);
    const arch = String(u.architecture || "").trim();
    if (arch) data.arch = arch.slice(0, 16);
    const bit = String(u.bitness || "").trim();
    if (bit) data.bit = bit.slice(0, 8);
    const gpu = nbxFpGpu(c);
    // 纯哈希值没有可读性，跳过
    if (gpu && !/^[0-9a-f]{16,}$/i.test(gpu)) data.gpu = gpu.slice(0, 160);
    // 电池：采集侧（collectExtra）已经写好 u.bat，这里之前从没读过，
    // 于是「有电池」这个 Windows 机型识别的最高优先级信号恒为空
    if (u.bat) data.bat = 1;
    data.touch = navigator.maxTouchPoints || 0;
    // 没有 device 组件，deviceMemory 在 hardware 下且是字符串
    const mem = Number(navigator.deviceMemory || (c.hardware && c.hardware.deviceMemory) || 0);
    if (mem > 0) data.mem = mem;
    const cd = (window.screen && window.screen.colorDepth) || 0;
    if (cd) data.cd = cd;
    const langs = (navigator.languages || []).slice(0, 6).join(",");
    if (langs) data.langs = String(langs).slice(0, 100);
    const raw = JSON.stringify(data);
    // 请求头只允许 Latin1，非 ASCII 会导致 fetch 抛错，直接剥离
    return raw.replace(/[^\x20-\x7E]/g, "");
  } catch {
    return "";
  }
}
async function nbxFpInit() {
  if (nbxFp.ready) return;
  nbxFp.ready = true;
  // 高熵 UA-CH + 电池信号（均防御式，不支持就空着，绝不阻塞）
  const collectExtra = async () => {
    const extra = {};
    try {
      const uad = navigator.userAgentData;
      if (uad && typeof uad.getHighEntropyValues === "function") {
        const v = await uad.getHighEntropyValues(["model", "platformVersion", "architecture", "bitness"]);
        if (v) Object.assign(extra, v);
      }
    } catch { /* 不支持则跳过 */ }
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        // 无电池的台式机返回恒定默认值（charging=true、dischargingTime=Infinity），据此区分
        if (b && (b.charging === false || (isFinite(b.dischargingTime) && b.dischargingTime > 0))) {
          extra.bat = 1;
        }
      }
    } catch { /* 不支持则跳过 */ }
    return extra;
  };
  const collect = async () => {
    try {
      const NS = window.ThumbmarkJS;
      if (!NS || !NS.Thumbmark) {
        nbxFp.warn = "指纹库未加载（文件缺失或被拦截）";
        return false;
      }
      const t = new NS.Thumbmark();
      const r = await t.get();
      const hash = r && typeof r.thumbmark === "string" ? r.thumbmark.trim() : "";
      if (!hash || !/^[A-Za-z0-9_\-:+=/.]+$/.test(hash) || hash.length > 128) {
        nbxFp.warn = "指纹计算为空（可能被隐私类插件干扰）";
        return false;
      }
      nbxFp.hash = hash;
      nbxFp.summary = (nbxFpSummarize(r.components, await collectExtra()) || "").slice(0, 2000);
      try {
        localStorage.setItem(NBX_FP_KEY, JSON.stringify({ hash: nbxFp.hash, summary: nbxFp.summary }));
      } catch { /* 配额不足时忽略 */ }
      return true;
    } catch {
      return false;
    }
  };
  // 自托管加载失败时（如旧部署缺 vendor 文件），动态回退到 CDN 一次
  const loadCdnFallback = () => new Promise((resolve) => {
    try {
      if (window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark) return resolve(true);
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@thumbmarkjs/thumbmarkjs/dist/thumbmark.umd.js";
      s.async = true;
      const done = (ok) => resolve(!!ok);
      s.onload = () => done(true);
      s.onerror = () => done(false);
      setTimeout(() => done(!!(window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark)), 6000);
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });
  if (await collect()) return;
  // thumbmark 已移出首屏关键路径：先延迟到空闲/2.5s，再按需拉自托管文件；
  // 仍缺失才走 CDN 兜底（仍失败则保持降级）。
  const loadLocal = () => new Promise((resolve) => {
    if (window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark) return resolve(true);
    nbxLoadScript(NBX_ASSET_URLS.thumbmark, 8000)
      .then(() => resolve(!!(window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark)))
      .catch(() => resolve(false));
  });
  setTimeout(async () => {
    if (nbxFp.hash) return;
    if (await collect()) return;
    if (!(window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark)) await loadLocal();
    if (await collect()) return;
    if (window.ThumbmarkJS && window.ThumbmarkJS.Thumbmark) return;
    nbxFp.warn = "指纹库未加载，正在尝试 CDN 兜底";
    await loadCdnFallback();
    if (!nbxFp.hash) await collect();
    if (!nbxFp.hash && !nbxFp.warn) nbxFp.warn = "指纹库加载失败（可能被广告拦截插件拦截）";
  }, 2500);
}
try { nbxFpInit(); } catch { /* 指纹初始化绝不抛错 */ }
// 诊断钩子：控制台执行 __nbxFp.hash 有值即采集成功，为空则看 __nbxFp.warn
try { window.__nbxFp = nbxFp; } catch { /* 忽略 */ }

const THEMES = [
  { id: "paper", name: "宣纸", dot: "linear-gradient(135deg,#b4502a,#8c3316)" },
  { id: "celadon", name: "青瓷", dot: "linear-gradient(135deg,#0e6e5f,#0a5245)" },
  { id: "obsidian", name: "曜石", dot: "linear-gradient(135deg,#e9a15b,#cf7038)" },
  { id: "jade", name: "墨翠", dot: "linear-gradient(135deg,#5cb787,#2f8a66)" },
  { id: "sora", name: "悠空", dot: "linear-gradient(160deg,#6fa8d8 0%,#a8cbe8 55%,#eef6fc 100%)" },
];

/* 悠空主题：favicon 联动（云朵图标） */
const FAVICON_SORA = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%236fa8d8'/%3E%3Cstop offset='1' stop-color='%23a8cbe8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Cpath d='M20 44a8 8 0 0 1-.9-15.95A11 11 0 0 1 40.5 24 9.5 9.5 0 0 1 44 42.9z' fill='white'/%3E%3C/svg%3E";

/* ---------------- localStorage 工具 ---------------- */
let _storageWarnShown = false;
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 写入失败（多为存储配额已满）：全局提示一次，避免用户误以为内容已保存
    if (!_storageWarnShown) {
      _storageWarnShown = true;
      window.dispatchEvent(new CustomEvent("nbx:storage-full"));
    }
  }
}
/* 严格写入：返回是否成功，且不弹全局提示，供「失败后自行淘汰重试」的调用方判断 */
function lsWrite(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* 忽略：清理失败不影响主流程 */ }
}
function storageFullWarn(evicted) {
  if (_storageWarnShown) return;
  _storageWarnShown = true;
  window.dispatchEvent(new CustomEvent("nbx:storage-full", { detail: { evicted: !!evicted } }));
}

/* ---------------- 历史记录分键存储 ----------------
   索引键（LS.history）只存列表渲染与路由需要的轻量元数据，正文按条存 nbx_h:<id>。
   目的：新增/修改一条只序列化一条，不再整份历史重写（历史累积时每次保存的主线程
   停顿随之消失），配额不足时也只牵连单条。旧格式（整个数组含正文）在启动时一次性
   拆分，拆分失败则本次会话退回整份写入，旧数据原样保留。 */
const HISTORY_BODY_PREFIX = "nbx_h:";
const HISTORY_INDEX_VERSION = 4;
const TITLE_JOB_SUBMIT_ATTEMPTS = 3;
const TITLE_JOB_SUBMIT_TIMEOUT_MS = 4000;
const TITLE_JOB_POLL_MS = 1000;
const TITLE_JOB_POLL_HIDDEN_MS = 5000;
// 索引里保留的输入摘要长度：够卡片在无标题时展示（模板用 excerpt 的默认 46 字）
const HISTORY_HEAD_CHARS = 60;
/* 删除后的撤销窗口：删除当场就落盘（墓碑 + 正文清理），撤销靠手里留的快照写回。
   窗口只决定底部「撤销」条停留多久，不影响删除本身的持久性。 */
const UNDO_WINDOW_MS = 5000;
// 删除墓碑（线路镜像用）：合并是集合求并，没有墓碑的话，一端删掉的记录会被另一端
// 的旧副本原样带回来。墓碑与内容一起同步，合并时「比内容新」即判死。
const LS_TOMB = "nbx_tomb";
/* ---------------- 线路镜像 ----------------
   同门多条线路（主线路 + 备份线路）互嵌一个隐藏的同站 iframe，把本机的变更推进
   对方 origin 自己的 localStorage。方向是「推」不是「拉」：备用线路要顶的正是
   主线路挂掉的那一刻，那时主线路的页面加载不了、也就读不到它的存储；提前推进去，
   故障时对端手里已经有一份，零点击可用。

   参与哪些线路由后端配置决定（管理后台「线路镜像」或 MIRROR_ORIGINS 环境变量），
   页面启动时从 /api/config 读取，不在前端硬编码 —— 开源部署各有各的域名，
   内网测试还可能是 IP + 端口。后端不参与数据，只提供这份配置。

   详见 nbx-mirror.js / nbx-mirror-store.js / nbx-mirror-peer.js / bridge.html。 */
const MIRROR_CONFIG_URL = "/api/config";
// 待同步队列的键（nbx-mirror-store 用）
const MIRROR_OUTBOX_KEY = "nbx_mo";
// 「存量已登记」标记：保证首次启用镜像时只把已有条目灌进队列一次
const MIRROR_SEEDED_KEY = "nbx_mo_seeded";
// 「偏好已播种」标记：主题/模型的首次播种独立于条目种子（条目重灌代价大，偏好没有）
const MIRROR_PREFS_SEEDED_KEY = "nbx_mo_seeded_prefs";
// 偏好同步的存储键：{theme: {v, at}, model: {v, at}}，at 大者胜（与数据同一 LWW 语义）
const LS_PREFS = "nbx_prefs";
// 变更后的推送防抖：连续编辑（改标题、连删多条）合并成一次推送
const MIRROR_PUSH_DEBOUNCE = 300;
// 桥接页加载超时与退避重试：对端线路不可达时不该让 iframe 无限挂着
const MIRROR_LOAD_TIMEOUT = 8000;
const MIRROR_RETRY_DELAY = 60000;
const MIRROR_MAX_ATTEMPTS = 2;
// 导入预览每组最多渲染的行数：300 行全渲染在手机上是灾难，封顶 + 搜索是折中
const IMPORT_PREVIEW_CAP = 30;
/* 运行期状态放模块作用域而不是 Alpine 响应式数据：里面存 iframe 元素与回调引用，
   塞进响应式代理没有必要，还可能带来意外的深代理行为。只有给界面看的字符串
   才放进响应式数据（mirrorStatus / mirrorHint）。 */
const _mirror = {
  started: false,
  status: "off",
  peerOrigin: "",
  iframe: null,
  peer: null,
  onMessage: null,
  loadTimer: null,
  retryTimer: null,
  attempts: 0,
  /* 正在应用对端推来的偏好：此期间本地钩子不得回写队列，否则同值 ping-pong */
  applyingRemote: false,
};

function historyHead(input) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, HISTORY_HEAD_CHARS);
}
/* 索引项：不含 input/output/migration/visualPaper 这些大字段。
   hasMigration / hasPaper 只用于打开时路由，避免把正文读回来才能判断类型。
   本函数对「索引项」与「已水合的完整记录」都要给出相同结果：写回索引时列表里
   大部分条目只有索引项，若直接读 item.input / item.migration 会把摘要与类型标记清空。 */
function historyIndexOf(item) {
  return {
    v: HISTORY_INDEX_VERSION,
    id: item.id,
    toolId: item.toolId,
    toolName: item.toolName,
    icon: item.icon,
    title: item.title || "",
    titleJobId: item.titleJobId || "",
    titlePending: !!item.titlePending,
    titleContentKey: item.titleContentKey || "",
    titlePayloadHash: item.titlePayloadHash || "",
    error: item.error || "",
    partial: !!item.partial,
    createdAt: item.createdAt,
    // 最后修改时间：线路镜像合并时「谁更新」的唯一判据。存量记录没有这个字段，
    // 回退到 createdAt（等于「从未改过」），镜像层 (updatedAtOf) 也做同样回退。
    updatedAt: item.updatedAt || item.createdAt,
    model: item.model || "",
    inputHead: item.input !== undefined ? historyHead(item.input) : (item.inputHead || ""),
    hasMigration: !!item.migration || !!item.hasMigration,
    hasPaper: !!item.visualPaper || !!item.hasPaper,
    // 回答版本数（列表角标）。正文已水合时按 versions 现算；只有索引的条目沿用
    // 索引里已有的值——直接算会把「2 版」抹成 1 版（标题更新等路径只写索引）。
    verCount: historyVerCountOf(item),
    // 翻译记录的语言对标签（如「英→中」）：列表只读索引项，正文不在手上，
    // 所以写作记录时就把这枚标量存进索引（与 inputHead 同一套办法）
    trPair: item.translate
      ? trPairShort(item.translate.source, item.translate.target)
      : (item.trPair || ""),
  };
}
/* 版本数：无 versions 字段 = 单版本记录（存量数据一律如此）。
   注意别在这里给「未水合」的条目下 1 的定论，理由见上面的赋值注释。 */
function historyVerCountOf(item) {
  if (item.versions && item.versions.length) return item.versions.length;
  if (!item._bodyLoaded) return item.verCount || 1;
  return 1;
}
function historyBodyOf(item) {
  const body = {
    input: item.input || "",
    output: item.output || "",
    fileName: item.fileName || "",
  };
  if (item.migration) body.migration = item.migration;
  if (item.visualPaper) body.visualPaper = item.visualPaper;
  // 识别记录的元信息（类型 / 张数 / 是否截断 / 批次签名），图片字节不在这里面
  if (item.ocr) body.ocr = item.ocr;
  // 翻译记录的语言对（存 id，显示名由 TR_LANGS 现算）
  if (item.translate) body.translate = item.translate;
  // 回答版本（重新生成保留的历次结果，见 nbx-versions.js）。
  // item.output/model/partial/error 始终是活动版本的投影，这里只多带一份历史版本。
  // 只有一版时不写：单版本记录与版本化之前的数据形状完全一致，镜像摘要也不受影响。
  if (item.versions && item.versions.length > 1) {
    body.versions = item.versions;
    body.activeVersionId = item.activeVersionId || "";
  }
  return body;
}
/* 旧格式判定：整份数组里的条目带正文（input/output）而非索引摘要 */
function isLegacyHistoryArray(raw) {
  return (
    Array.isArray(raw) &&
    raw.some((it) => it && typeof it === "object" && (it.output !== undefined || it.input !== undefined))
  );
}

/* ---------------- 流式渲染节流 ----------------
   每个节流 tick 都要把「整份累计输出」重新过一遍 Markdown 解析 + 消毒 + 整块替换，
   单次开销随长度线性增长，固定间隔会让整轮生成的总开销按长度二次增长 ——
   解卷整卷、迁移多卡这类长输出到后段会明显掉帧。
   这里让间隔随输出长度递增（上限 280ms）：渲染结果本身不变，只是超长输出时
   刷新频率降下来，把总开销摊平；定稿那一次仍走完整渲染。 */
function streamRenderDelay(len, base = 60) {
  const n = Number(len) || 0;
  if (n <= 4000) return base;
  return Math.min(280, base + Math.round(n / 4000) * 40);
}

/* ---------------- 流式打字机：缓存 + 近匀速放行 + 曲线变速 ----------------
   网络 chunk 是成簇到达的：一簇几十字、停几百毫秒、又连来几簇。诚实按到达节奏上屏
   就是一顿一顿的（「块状」观感的来源）。Claude / Codex 的丝滑输出把「到达节奏」与
   「上屏节奏」彻底解耦，中间垫一层缓存、按**近匀速**放行：晚一点上屏无所谓，
   重要的是屏幕上文字的出现速率平稳。
   - 目标速度 = 基准速度 + 积压/软清空时长（积压越大放得越快），有封顶；
   - 实际速度按指数曲线逼近目标（曲线变速）：积压骤增骤减时速率是渐变的，不跳档；
   - 小数余量累计推进，慢速下也是逐字均匀出现，不会一帧 0 字一帧 2 字地抖。
   只影响上屏节奏：output 等真值字段照常按到达写入，历史 / 导出 / 续写都不受影响。
   打字动画本身是 motion：系统开启「减少动效」时直接放完，不做逐字动画。 */
const TYPER_BASE_CPS = 45;    // 基准上屏速度（字/秒）：接近舒适阅读节奏，流慢时也不干等
const TYPER_MAX_CPS = 300;    // 追速上限：积压再大也只快到这个程度，绝不一涌而出
const TYPER_CATCHUP_S = 1.6;  // 积压清空的软目标（秒）：越大缓存越深、输出越匀（延迟换平稳）
const TYPER_SPEED_TAU = 300;  // 速度曲线时间常数（ms）：目标速度变了也只渐变，不跳档
const TYPER_FADE_MS = 320;    // 淡入动画时长，也是淡入段历史窗口（与 styles.css 的 .tw-fade 对齐）
const TYPER_RENDER_MS = 45;   // 渲染合并间隔（长文自动拉宽，见 typerRenderInterval）
const TYPER_FINISH_CPS = 800; // 收尾放行速度：明显变快但仍是动画，不是瞬跳
const TYPER_FINISH_SNAP = 8;  // 收尾只剩零头（≤ 字）时直接给全，不必再走动画

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch { return false; }
}

/* 测试环境可能没有 requestAnimationFrame（工厂按参数注入，替身未必给）：退化为
   定时器，语义不变，只是帧率降为 ~60ms 一拍 */
function rafNext(fn) {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(fn)
    : setTimeout(() => fn(Date.now()), 16);
}

function rafCancel(id) {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

/* 渲染间隔随长度略增：整份 Markdown 重解析 + 整块 DOM 替换的开销随长度线性增长，
   超长输出把间隔拉宽一点摊平总开销；淡入段带负延迟，间隔变化不会让动画断档 */
function typerRenderInterval(len) {
  return Math.min(110, TYPER_RENDER_MS + Math.round((Number(len) || 0) / 400));
}

function createStreamTyper(render) {
  const typer = {
    shown: 0,
    target: 0,
    finishing: false,        // 收尾放行中：自然完成的余量仍在平滑放完
    _speed: TYPER_BASE_CPS,  // 当前上屏速度（字/秒），按曲线逼近目标
    _frac: 0,                // 小数余量：慢速下逐字均匀推进的关键
    _raf: 0,
    _lastTs: 0,
    _lastRenderTs: -1e9,
    _dirty: false,
    // 淡入段历史：每帧记录「放到哪个字、何时上屏」，供渲染时切段做负延迟淡入
    _pts: [{ shown: 0, ts: -1e9 }],
  };
  const stop = () => {
    if (typer._raf) rafCancel(typer._raf);
    typer._raf = 0;
    typer._lastTs = 0;
  };
  /* 渲染一次当前指针：marks 是「最近几段新文字」的淡入段（at = 段起点，ageMs = 已上屏多久） */
  const paint = (now) => {
    const marks = [];
    if (!prefersReducedMotion()) {
      typer._pts.push({ shown: typer.shown, ts: now });
      for (let i = 1; i < typer._pts.length; i += 1) {
        const age = now - typer._pts[i].ts;
        const at = typer._pts[i - 1].shown;
        if (age < TYPER_FADE_MS && at < typer._pts[i].shown) marks.push({ at, ageMs: age });
      }
      while (typer._pts.length > 1 && now - typer._pts[1].ts > TYPER_FADE_MS) typer._pts.shift();
    }
    render(typer.shown, marks);
  };
  const frame = (ts) => {
    typer._raf = 0;
    typer.tick(ts);
    if (typer.shown < typer.target || typer.finishing) typer._raf = rafNext(frame);
  };
  const ensure = () => {
    if (!typer._raf && (typer.shown < typer.target || typer.finishing)) typer._raf = rafNext(frame);
  };
  /* 对齐到 len 并停表：开流起点（续写基线）、停止 / 出错残文、载入历史都用它 */
  typer.reset = (len) => {
    stop();
    typer.target = Math.max(0, Number(len) || 0);
    typer.shown = typer.target;
    typer.finishing = false;
    typer._speed = TYPER_BASE_CPS;
    typer._frac = 0;
    typer._dirty = false;
    typer._lastRenderTs = -1e9;
    typer._pts = [{ shown: typer.shown, ts: -1e9 }];
  };
  /* 原文又变长了：只推进目标，放出多少交给帧循环 */
  typer.grow = (total) => {
    const n = Math.max(0, Number(total) || 0);
    if (n > typer.target) typer.target = n;
    if (prefersReducedMotion()) {
      if (typer.shown < typer.target) {
        typer.shown = typer.target;
        paint(0);
      }
      return;
    }
    ensure();
  };
  /* 自然完成：余量以收尾速度平滑放完（快但仍是动画）；只剩零头就直接给全 */
  typer.finish = () => {
    if (typer.target - typer.shown <= TYPER_FINISH_SNAP) {
      typer.reset(typer.target);
      paint(0);
      return;
    }
    typer.finishing = true;
    ensure();
  };
  /* 立刻渲染一次当前指针（不推进）：收尾路径要按打字机的进度画 */
  typer.paint = () => paint(typer._lastTs || 0);
  /* 推进一帧并按渲染间隔上屏；时间戳可注入，测试直接驱动、不依赖真实时钟 */
  typer.tick = (now) => {
    const backlog = typer.target - typer.shown;
    if (backlog > 0) {
      const dt = typer._lastTs ? Math.min(Math.max(now - typer._lastTs, 1), 120) : 16;
      // 目标速度：基准 + 积压的温和追速，封顶；收尾放行时直接给收尾速度
      const targetCps = typer.finishing
        ? TYPER_FINISH_CPS
        : Math.min(TYPER_BASE_CPS + backlog / TYPER_CATCHUP_S, TYPER_MAX_CPS);
      // 曲线变速：实际速度按指数曲线逼近目标（τ = TYPER_SPEED_TAU），骤增骤减都不跳档
      typer._speed += (targetCps - typer._speed) * (1 - Math.exp(-dt / TYPER_SPEED_TAU));
      typer._frac += (typer._speed * dt) / 1000;
      let step = Math.floor(typer._frac);
      typer._frac -= step;
      if (step > backlog) step = backlog;
      if (step > 0) {
        typer.shown += step;
        typer._dirty = true;
      }
    }
    typer._lastTs = now;
    const drained = typer.shown >= typer.target;
    if (drained && typer.finishing) {
      // 放完那帧就是干净全文（无淡入段）
      typer.finishing = false;
      paint(now);
      return typer.shown;
    }
    if (typer._dirty && (drained || now - typer._lastRenderTs >= typerRenderInterval(typer.target))) {
      typer._dirty = false;
      typer._lastRenderTs = now;
      paint(now);
    }
    return typer.shown;
  };
  return typer;
}

/* ---------------- 流式淡入 ----------------
   「每个字淡淡地浮出来」靠两件事配合：
   1) 淡入段：把「最近 TYPER_FADE_MS 内上屏的文字」切成段，各包一层 <span class="tw-fade">；
   2) 负延迟：innerHTML 是整块重建的，CSS 动画会跟着重启 —— 所以每段带上
      「已经上屏多久」的负 animation-delay，重建后动画从原进度接着跑，淡入曲线不断，
      已淡完的老文字回到普通文本（opacity 1），画面永远只有一层淡淡的尾迹。
   段边界用不可见分隔符 U+2063 埋进 Markdown 源文本，解析后落在文字流的原位；
   换装按标签切开逐段做，绝不让 span 跨块级标签，避免破坏 HTML 结构。 */
const FADE_MARK = "\u2063";

/* 段边界的安全落点：淡入分隔符绝不能切开 Markdown 语法记号
   （## 、**、```、- 、1. 、空行……），否则解析结果会在「字面记号」与
   「格式块」之间闪烁（标题闪成 "## 文字"）。落点不安全就向后挪，
   直到两侧都是普通文字——记号整体留在边界一侧，解析永远稳定。 */
const FADE_UNSAFE = /[#*_`~\-+=|>\[\]()!$.]/;

function safeMarkPos(text, at) {
  const t = String(text || "");
  let i = Math.min(Math.max(0, Number(at) || 0), t.length);
  if (i === 0) return 0;
  for (let guard = 0; guard < 128 && i < t.length; guard += 1) {
    const prev = t[i - 1];
    const next = t[i];
    // 任一侧贴着记号都不行；空行中间也不行（会把两个块粘成一块）
    if (FADE_UNSAFE.test(prev) || FADE_UNSAFE.test(next) || (prev === "\n" && next === "\n")) {
      i += 1;
      continue;
    }
    break;
  }
  return Math.min(i, t.length);
}

function renderMarkedMarkdown(slice, marks) {
  let src = "";
  // pos 从 -1 起：允许第一段从 0 开头（整段都是新文字的常见情形）
  let pos = -1;
  const ages = [];
  for (const m of marks) {
    const at = safeMarkPos(slice, m.at);
    if (at <= pos) continue;
    src += slice.slice(Math.max(0, pos), at) + FADE_MARK;
    ages.push(Math.max(0, Number(m.ageMs) || 0));
    pos = at;
  }
  src += slice.slice(Math.max(0, pos));
  return wrapFadeBands(renderMd(src), ages);
}

function wrapFadeBands(html, ages) {
  const s = String(html || "");
  if (!ages.length || s.indexOf(FADE_MARK) < 0) return s;
  const out = [];
  let band = 0;
  for (const tok of s.split(/(<[^>]*>)/)) {
    if (!tok) continue;
    if (tok[0] === "<") {
      out.push(tok);
      continue;
    }
    tok.split(FADE_MARK).forEach((piece, idx) => {
      if (idx > 0) band += 1;
      if (!piece) return;
      // band 0 是分隔符之前的老文字（不在窗口内）；band k 对应 ages[k-1]
      const age = band === 0 ? undefined : ages[band - 1];
      // 纯空白片段（块间换行等）不包淡入：看不见的东西不需要动画，
      // 而且它常在 html 尾部，包上 span 只会给尾部留一段空壳
      if (!piece.trim() || age === undefined || age >= TYPER_FADE_MS) {
        out.push(piece);
        return;
      }
      out.push(`<span class="tw-fade" style="animation-delay:-${Math.round(age)}ms">${piece}</span>`);
    });
  }
  return out.join("");
}

/* 流式期间的 Markdown 渲染：最近上屏的文字淡入（逐字「淡淡出现」）；
   收尾（live=false）时是干净全文（无淡入）。不做打字光标——文字自己长出来就是效果 */
function renderMdStreamPaced(text, shown, marks, live) {
  const full = String(text || "");
  if (!live) return renderMd(full);
  const slice = full.slice(0, Math.min(Math.max(0, Number(shown) || 0), full.length));
  return marks && marks.length ? renderMarkedMarkdown(slice, marks) : renderMd(slice);
}

/* ---------------- 超长历史折叠 ----------------
   打开一条很长的历史记录时，一次性渲染全文会让首屏明显变慢（解析 + 消毒 + DOM 重建
   都按全文长度算）。超过阈值只渲染前一段，底部给「查看更多」按钮展开全文。
   截断点取段落边界，并校正未闭合的 ``` 代码围栏与 $$ 行间公式 —— 半截的围栏会
   把后面的内容全部吞进代码块，展开前后的观感必须一致。 */
const OUTPUT_FOLD_CHARS = 12000;

function foldMarkdown(raw, limit = OUTPUT_FOLD_CHARS) {
  const text = String(raw || "");
  if (text.length <= limit) return { text, folded: false, total: text.length };
  // 优先切在空行处，保住段落与列表的完整性；找不到就按长度硬切
  let cut = text.lastIndexOf("\n\n", limit);
  if (cut < limit / 2) cut = limit;
  return { text: balanceTruncatedMarkdown(text.slice(0, cut), text, cut), folded: true, total: text.length };
}

/* 截断点校验：未闭合的围栏/公式要么向后补到闭合处，要么就地补上闭合标记。
   向后补的上限（4000 字）是防止模型把整个后文都包在一个代码块里导致「查看更多」
   一展开就跳很远。 */
function balanceTruncatedMarkdown(head, full, cut) {
  const nextFence = () => {
    const at = full.indexOf("\n```", cut);
    if (at === -1 || at - cut > 4000) return "";
    const end = full.indexOf("\n", at + 1);
    return full.slice(0, end === -1 ? full.length : end);
  };
  if ((head.match(/^ {0,3}```/gm) || []).length % 2 === 1) {
    return nextFence() || head + "\n```";
  }
  const dollars = (head.match(/\$\$/g) || []).length;
  if (dollars % 2 === 1) {
    const at = full.indexOf("$$", cut);
    if (at !== -1 && at - cut <= 4000) return full.slice(0, at + 2);
    return head + "\n$$";
  }
  return head;
}

/* ---------------- 已提交输入卡片的折叠门槛 ----------------
   收起态只露约 3 行（.submitted-text 的 4.8rem），短输入一眼看完，再套一层
   「点开才看全」纯属多余交互，所以阈值之内不给折叠入口，整段始终铺开。
   按估算行数而非纯字数判断：换行多的输入，实际行数远超字数暗示的规模。 */
const SUBMITTED_FOLD_LINES = 4;
const SUBMITTED_LINE_CHARS = 45;

function submittedNeedsFold(text) {
  let used = 0;
  for (const line of String(text || "").split("\n")) {
    used += Math.max(1, Math.ceil(line.length / SUBMITTED_LINE_CHARS));
    if (used > SUBMITTED_FOLD_LINES) return true;
  }
  return false;
}

/* 把后端错误 detail 转成可读文案；无法识别时返回 null，由调用方回退默认提示 */
function formatApiDetail(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    // FastAPI 参数校验失败（如输入超出长度上限）：detail 是错误对象数组
    const first = detail[0] || {};
    const fieldPath = Array.isArray(first.loc)
      ? first.loc.filter((part) => part !== "body").join(".")
      : "";
    return [fieldPath, first.msg].filter(Boolean).join("：") || null;
  }
  if (detail && typeof detail === "object" && detail.message) return detail.message;
  return null;
}

/* 浏览器网络层错误的特征：fetch 被拒（Failed to fetch）与读流中断
   （network error / NetworkError / Load failed）。这类文案是浏览器原生的英文
   提示，直接甩给用户既看不懂、也分不清是服务端出错还是本地断网，
   所以统一换成中文说明；原始报文只在控制台留档，便于排查。 */
const NETWORK_ERROR_PATTERN = /failed to fetch|network ?error|load failed|networkerror|err_(connection|network|internet|empty_response)/i;

function isNetworkError(e) {
  if (!e) return false;
  if (e.name === "TypeError" || e instanceof TypeError) return true;
  return NETWORK_ERROR_PATTERN.test(String(e.message || ""));
}

/* 统一的错误文案：网络层错误给中文提示，其余沿用后端/业务文案 */
function describeError(e, fallbackText = "操作失败，请稍后重试") {
  const raw = (e && e.message) || "";
  if (isNetworkError(e)) {
    try { console.warn("网络层错误：", e); } catch { /* 忽略 */ }
    return "网络连接中断，内容可能不完整。请检查网络后重试；若持续出现，请让管理员查看服务端日志。";
  }
  return raw || fallbackText;
}

/* ---------------- 运行时依赖按需加载 ----------------
   首屏只保留 Alpine / marked / DOMPurify 这类必需库。mammoth、html-docx、
   KaTeX、qrcode、vp-print 都改成用到时再拉，文件全部自托管在 /static/vendor/，
   正常路径不再依赖 jsDelivr（thumbmark 仅在本文件缺失时有一次 CDN 兜底）。
   加载失败只影响对应功能，不会拖垮整页。 */
const NBX_ASSET_URLS = {
  katexJs: "/static/vendor/katex-0.16.47/katex.min.js",
  katexCss: "/static/vendor/katex-0.16.47/katex.min.css",
  markedKatex: "/static/vendor/marked-katex-extension-5.1.4.umd.js",
  mammoth: "/static/vendor/mammoth-1.8.0.browser.min.js",
  htmlDocx: "/static/vendor/html-docx-0.3.1.js",
  qrcode: "/static/vendor/qrcode-generator-1.4.4.js",
  vpPrint: "/static/vp-print.js",
  // 渲染与检索内核：同样不占首屏关键步骤，首屏后的空闲或首次用到时才拉
  marked: "/static/vendor/marked-15.0.12.min.js",
  dompurify: "/static/vendor/dompurify-3.4.12.min.js",
  historySearch: "/static/nbx-history-search.js",
  // 首屏之后才需要的模块：不占 6 个关键步骤
  background: "/static/nbx-background.js",
  clickFx: "/static/click-fx.js",
  thumbmark: "/static/vendor/thumbmark.umd.js",
  mirror: [
    "/static/nbx-mirror.js",
    "/static/nbx-mirror-store.js",
    "/static/nbx-mirror-peer.js",
  ],
};
const _nbxAssetPromises = Object.create(null);

function nbxLoadScript(src, timeoutMs = 20000) {
  if (_nbxAssetPromises[src]) return _nbxAssetPromises[src];
  const p = new Promise((resolve, reject) => {
    if (typeof document === "undefined" || !document.createElement) {
      reject(new Error("当前环境不支持动态加载脚本"));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      s.remove();
      reject(new Error("加载超时：" + src));
    }, timeoutMs);
    s.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.remove();
      reject(new Error("加载失败：" + src));
    };
    document.head.appendChild(s);
  });
  _nbxAssetPromises[src] = p;
  p.catch(() => { if (_nbxAssetPromises[src] === p) delete _nbxAssetPromises[src]; });
  return p;
}

function nbxLoadStyle(href, timeoutMs = 20000) {
  const key = "css:" + href;
  if (_nbxAssetPromises[key]) return _nbxAssetPromises[key];
  const p = new Promise((resolve, reject) => {
    if (typeof document === "undefined" || !document.createElement) {
      reject(new Error("当前环境不支持动态加载样式"));
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      link.remove();
      reject(new Error("样式加载超时：" + href));
    }, timeoutMs);
    link.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    link.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      link.remove();
      reject(new Error("样式加载失败：" + href));
    };
    document.head.appendChild(link);
  });
  _nbxAssetPromises[key] = p;
  p.catch(() => { if (_nbxAssetPromises[key] === p) delete _nbxAssetPromises[key]; });
  return p;
}

/* 首屏后加载：点击特效接入层与镜像三件套。
   两者都不参与 8 个关键步骤；失败只影响对应增强功能。 */
let _clickFxLoading = null;
function nbxEnsureClickFx() {
  if (window.NbxClickFx) return Promise.resolve(window.NbxClickFx);
  if (_clickFxLoading) return _clickFxLoading;
  _clickFxLoading = nbxLoadScript(NBX_ASSET_URLS.clickFx, 12000)
    .then(() => window.NbxClickFx || null)
    .catch(() => null);
  return _clickFxLoading;
}

let _mirrorLoading = null;
function nbxEnsureMirrorAssets() {
  if (typeof NbxMirror !== "undefined"
    && typeof NbxMirrorStore !== "undefined"
    && typeof NbxMirrorPeer !== "undefined") return Promise.resolve(true);
  if (_mirrorLoading) return _mirrorLoading;
  _mirrorLoading = (async () => {
    for (const src of NBX_ASSET_URLS.mirror) {
      const name = src.slice(src.lastIndexOf("/") + 1);
      if (name === "nbx-mirror.js" && typeof NbxMirror !== "undefined") continue;
      if (name === "nbx-mirror-store.js" && typeof NbxMirrorStore !== "undefined") continue;
      if (name === "nbx-mirror-peer.js" && typeof NbxMirrorPeer !== "undefined") continue;
      await nbxLoadScript(src, 12000);
    }
    return typeof NbxMirrorStore !== "undefined" && typeof NbxMirrorPeer !== "undefined";
  })().catch(() => false);
  return _mirrorLoading;
}

/* marked + DOMPurify：渲染回答要用的两个库，已移出首屏关键路径（少两个跨境请求）。
   它们必须**在渲染之前**就绪 —— renderMd 是同步函数，缺了 marked 会退化成纯文本
   渲染、缺了 DOMPurify 则整段 HTML 不过滤，所以生成入口会 await 这里一次；
   首屏放行后也会空闲预加载，正常路径下生成时它早就返回了。 */
let _renderLibsLoading = null;
function nbxEnsureRenderLibs() {
  if (window.marked && window.DOMPurify) {
    configureMarked();
    return Promise.resolve(true);
  }
  if (_renderLibsLoading) return _renderLibsLoading;
  const p = (async () => {
    try {
      if (!window.marked) await nbxLoadScript(NBX_ASSET_URLS.marked, 20000);
      if (!window.DOMPurify) await nbxLoadScript(NBX_ASSET_URLS.dompurify, 20000);
    } catch (e) {
      console.warn("Markdown 渲染组件加载失败", e);
    }
    configureMarked();
    return !!(window.marked && window.DOMPurify);
  })();
  _renderLibsLoading = p;
  // 失败就清掉缓存的 promise，下一次调用重试；成功则一直复用
  p.then((ok) => { if (!ok && _renderLibsLoading === p) _renderLibsLoading = null; });
  return p;
}

/* 历史全文检索内核：同样是首屏之后才用得到的纯函数模块。 */
let _historySearchLoading = null;
function nbxEnsureHistorySearch() {
  if (typeof NbxHistorySearch !== "undefined" && NbxHistorySearch) return Promise.resolve(true);
  if (_historySearchLoading) return _historySearchLoading;
  const p = nbxLoadScript(NBX_ASSET_URLS.historySearch, 20000)
    .then(() => typeof NbxHistorySearch !== "undefined" && !!NbxHistorySearch)
    .catch(() => false);
  _historySearchLoading = p;
  p.then((ok) => { if (!ok && _historySearchLoading === p) _historySearchLoading = null; });
  return p;
}

async function ensureMammoth() {
  if (window.mammoth) return true;
  try { await nbxLoadScript(NBX_ASSET_URLS.mammoth); } catch (e) { console.warn("mammoth 加载失败", e); return false; }
  return !!window.mammoth;
}

async function ensureHtmlDocx() {
  if (window.htmlDocx) return true;
  try { await nbxLoadScript(NBX_ASSET_URLS.htmlDocx); } catch (e) { console.warn("html-docx 加载失败", e); return false; }
  return !!window.htmlDocx;
}

async function ensureQrCode() {
  if (typeof window.qrcode === "function") return true;
  try { await nbxLoadScript(NBX_ASSET_URLS.qrcode); } catch (e) { console.warn("二维码库加载失败", e); return false; }
  return typeof window.qrcode === "function";
}

async function ensureVpPrint() {
  if (window.VPPrint) return true;
  try { await nbxLoadScript(NBX_ASSET_URLS.vpPrint); } catch (e) { console.warn("打印组件加载失败", e); return false; }
  return !!window.VPPrint;
}

let _katexPromise = null;
function ensureKatex() {
  if (_katexPromise) return _katexPromise;
  _katexPromise = (async () => {
    try {
      await nbxLoadStyle(NBX_ASSET_URLS.katexCss);
      await nbxLoadScript(NBX_ASSET_URLS.katexJs);
      // UMD 扩展在加载时就把 global.katex 抓进闭包，顺序不能反
      await nbxLoadScript(NBX_ASSET_URLS.markedKatex);
      configureMarked();
      return !!(window.katex && window.markedKatex);
    } catch (e) {
      console.warn("KaTeX 加载失败，公式将以原文显示", e);
      _katexPromise = null;  // 允许下次重试
      return false;
    }
  })();
  return _katexPromise;
}

function scheduleKatexLoad() {
  const run = () => { void ensureKatex(); };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 1800 });
  } else {
    setTimeout(run, 900);
  }
}
if (typeof document !== "undefined" && document && document.addEventListener) {
  document.addEventListener("alpine:initialized", scheduleKatexLoad, { once: true });
}

/* ---------------- Markdown 渲染 ---------------- */
let _markedKatexApplied = false;
let _purifyHookAdded = false;
function configureMarked() {
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
    // KaTeX 数学公式（$...$ / $$...$$）：
    // nonStandard 容忍 LLM 常见的 $ 与内容间不留空格的写法；
    // output:"html" 只输出 HTML（不含 MathML），保证能完整通过 DOMPurify。
    // KaTeX 是首屏后异步加载的，所以这里必须可重入；扩展只挂一次。
    if (window.markedKatex && !_markedKatexApplied) {
      marked.use(markedKatex({ throwOnError: false, nonStandard: true, output: "html" }));
      _markedKatexApplied = true;
    }
  }
  if (window.DOMPurify && !_purifyHookAdded) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    _purifyHookAdded = true;
  }
}

function normalizeMarkdown(raw) {
  // SSE 已改为 JSON 编码传输，换行不再丢失；这里只保留少量兜底规则，
  // 处理 LLM 偶发的真·不规范输出（跳过代码块，避免误伤）：
  // 1) 分隔线与标题粘在同一行：---### 标题
  // 2) 段落文字后直接粘标题：……。#### 标题（限 ## 及以上，避免误伤 “C#” 等）
  const normalizeText = (text) => text
    .replace(/^([ \t]*)---(#{1,6}[ \t])/gm, "\n$1---\n\n$2")
    .replace(/([^\s#])(#{2,6}[ \t]+\S)/g, "$1\n\n$2")
    // 有些模型会把强调标记转义成 \*\*文本\*\*，或在闭合标记前多留空格；
    // 这两种写法会被 marked 当作普通文本，导致页面直接显示星号。
    .replace(/\\\*\\\*([^\n]*?)\\\*\\\*/g, "**$1**")
    .replace(/\\_\\_([^\n]*?)\\_\\_/g, "__$1__")
    .replace(/\*\*[ \t]*([^\n*]*?\S)[ \t]*\*\*/g, "**$1**")
    // marked 对中文成对标点紧贴强调边界的写法兼容性不足；只移动成对标点，
    // 避免使用宽泛匹配把相邻强调语的闭合标记误当成新的开始标记。
    .replace(/\*\*([“‘「『（【《〈〔(<"])([^\n*]*?)([”’」』）】》〉〕)>"'])\*\*/g, "$1**$2**$3");

  const normalizeOutsideCode = (text) => {
    // 代码块和行内代码中的符号是内容，不参与 Markdown 兜底修复。
    // 用反引号运行长度配对，覆盖单反引号代码、双反引号代码和围栏代码块。
    const parts = [];
    let cursor = 0;
    while (cursor < text.length) {
      let start = text.indexOf("`", cursor);
      while (start >= 0) {
        let slashCount = 0;
        for (let i = start - 1; i >= 0 && text[i] === "\\"; i -= 1) slashCount += 1;
        if (slashCount % 2 === 0) break;
        start = text.indexOf("`", start + 1);
      }
      if (start < 0) {
        parts.push(normalizeText(text.slice(cursor)));
        cursor = text.length;
        break;
      }

      parts.push(normalizeText(text.slice(cursor, start)));
      let markerEnd = start + 1;
      while (text[markerEnd] === "`") markerEnd += 1;
      const marker = text.slice(start, markerEnd);
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const openingIndent = text.slice(lineStart, start);
      const openingLineEnd = text.indexOf("\n", markerEnd);
      let codeEnd = -1;

      // 三个及以上反引号在行首是围栏代码，闭合标记必须独占一行；
      // 不能把代码内容里的反引号误当成闭合标记。
      if (marker.length >= 3 && /^[ \t]{0,3}$/.test(openingIndent) && openingLineEnd >= 0) {
        let line = openingLineEnd + 1;
        while (line <= text.length) {
          const lineEnd = text.indexOf("\n", line);
          const end = lineEnd < 0 ? text.length : lineEnd;
          let candidate = line;
          while (text[candidate] === " " || text[candidate] === "\t") candidate += 1;
          let candidateEnd = candidate;
          while (text[candidateEnd] === "`") candidateEnd += 1;
          const trailing = text.slice(candidateEnd, end).replace(/\r$/, "");
          if (candidateEnd - candidate >= marker.length && /^[ \t]*$/.test(trailing)) {
            codeEnd = lineEnd < 0 ? text.length : lineEnd + 1;
            break;
          }
          if (lineEnd < 0) break;
          line = lineEnd + 1;
        }
      } else {
        const close = text.indexOf(marker, markerEnd);
        if (close >= 0) codeEnd = close + marker.length;
      }

      if (codeEnd < 0) {
        parts.push(text.slice(start));
        cursor = text.length;
        break;
      }
      parts.push(text.slice(start, codeEnd));
      cursor = codeEnd;
    }
    return cursor === 0 ? normalizeText(text) : parts.join("");
  };

  // GFM 也支持 ~~~ 围栏代码；它同样不能被普通文本规则改写。
  const tildeFence = /((?:^|\n)[ \t]{0,3}~{3,}[^\n]*(?:\r?\n|$)[\s\S]*?(?:\n[ \t]{0,3}~{3,}[ \t]*(?:\r?\n|$)|$))/g;
  const parts = raw.split(tildeFence);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = normalizeOutsideCode(parts[i]);
  }
  return parts.join("");
}

function renderInlineMdFallback(raw) {
  const slots = [];
  const protect = (html) => `\uE000${slots.push(html) - 1}\uE001`;
  let text = escapeHtml(String(raw || ""));

  // 先保护代码和链接，后续强调规则就不会误伤它们的内容。
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, marks, code) => protect(`<code>${code}</code>`));
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);

  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/(?<!\*)\*\*([^*\n]+?)\*\*(?!\*)/g, "<strong>$1</strong>");
  text = text.replace(/(?<!_)__([^_\n]+?)__(?!_)/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
  text = text.replace(/(?<![\*])\*([^*\n]+?)\*(?![\*])/g, "<em>$1</em>");
  text = text.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<em>$1</em>");

  return text
    .replace(/\n/g, "<br>\n")
    .replace(/\uE000(\d+)\uE001/g, (_, index) => slots[Number(index)] || "");
}

function renderMdFallback(raw) {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMdFallback(paragraph.join("\n"))}</p>`);
    paragraph = [];
  };
  const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "")
    .split("|").map((cell) => renderInlineMdFallback(cell.trim()));
  const isTableDivider = (line) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const info = fence[2].trim().split(/\s+/, 1)[0];
      const code = [];
      i += 1;
      while (i < lines.length) {
        const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) {
          i += 1;
          break;
        }
        code.push(lines[i]);
        i += 1;
      }
      const className = /^[A-Za-z0-9_-]+$/.test(info) ? ` class="language-${info}"` : "";
      html.push(`<pre><code${className}>${escapeHtml(code.join("\n"))}${code.length ? "\n" : ""}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMdFallback(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^ {0,3}(?:\*{3,}|-{3,}|_{3,})[ \t]*$/.test(line)) {
      flushParagraph();
      html.push("<hr>");
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph();
      const header = tableCells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      html.push(`<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`
        + `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const quote = line.match(/^ {0,3}>[ \t]?(.*)$/);
    if (quote) {
      flushParagraph();
      const quoted = [];
      while (i < lines.length) {
        const current = lines[i].match(/^ {0,3}>[ \t]?(.*)$/);
        if (!current) break;
        quoted.push(current[1]);
        i += 1;
      }
      html.push(`<blockquote>${renderMdFallback(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const listItem = line.match(/^ {0,3}([-+*]|\d+[.)])[ \t]+(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\d/.test(listItem[1]);
      const items = [];
      while (i < lines.length) {
        const current = lines[i].match(/^ {0,3}([-+*]|\d+[.)])[ \t]+(.+)$/);
        if (!current || /^\d/.test(current[1]) !== ordered) break;
        items.push(`<li>${renderInlineMdFallback(current[2])}</li>`);
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return html.join("\n");
}

/* ---------------- 自由对话 · 工具推荐标记 ----------------
   提示词约定：模型推荐工具时单独输出一行 [[tool:10]]（只放编号，见 prompts/自由对话.md）。
   这里把编号解析成本地工具表里的入口卡片；编号→入口的映射由 loadTools 填充。
   两段式渲染：先换成私有区占位符（不参与 Markdown 解析，也不会被消毒误伤），等
   Markdown 渲染并消毒之后，再把占位符还原成 HTML 卡片，避免 HTML 被 marked 打散。
   流式期间被切断的残片（如 "[[tool:1"）暂不显示，闭合后再出现；未知编号直接丢弃，
   绝不把裸标记漏给用户。 */
let NBX_TOOLS_BY_ID = Object.create(null);
const TOOL_LINK_RE = /\[\[\s*tool\s*[:：]\s*(\d{1,3})\s*\]\]/gi;
// 完整标记已被换成占位符后，行尾残留的未闭合标记（含缺右括号的半截）整块丢弃
const TOOL_LINK_TAIL_RE = /\[\[[\s\u2063]*tool[\s\u2063]*[:：]?[\s\u2063]*\d{0,3}[\s\u2063]*[\]\s\u2063]*$/i;
const TOOL_LINK_SLOT = "\uE002";

function toolLinkPlaceholder(raw) {
  // 流式淡入的不可见分隔符（FADE_MARK）可能被插进标记内部：先抹掉方括号内的它，
  // 否则一个被切开的标记会漏成裸文本显示出来
  let text = String(raw || "").replace(/\[\[[\s\S]*?\]\]/g, (m) => m.replace(/\u2063/g, ""));
  text = text.replace(TOOL_LINK_RE, (_, id) => `${TOOL_LINK_SLOT}${id}${TOOL_LINK_SLOT}`);
  return text.replace(TOOL_LINK_TAIL_RE, "");
}

function toolLinkChipHtml(id) {
  const tool = NBX_TOOLS_BY_ID[String(id)];
  if (!tool) return "";
  return `<button type="button" class="nbx-tool-link" data-tool-id="${escapeHtml(String(id))}">`
    + `<span class="nbx-tool-link-ico">${icon(tool.icon || "sparkle", "w-4 h-4")}</span>`
    + `<span class="nbx-tool-link-name">${escapeHtml(tool.name || "")}</span>`
    + `<span class="nbx-tool-link-go">${icon("chevron-right", "w-4 h-4")}</span>`
    + `</button>`;
}

function restoreToolLinkChips(html) {
  const s = String(html || "");
  if (s.indexOf(TOOL_LINK_SLOT) < 0) return s;
  return s.replace(/\uE002(\d{1,3})\uE002/g, (_, id) => toolLinkChipHtml(id));
}

function finalizeRenderedHtml(html) {
  // 极少数未配对的加粗标记可能被 Markdown 解析器原样输出，避免它们漏到页面上。
  return String(html || "").replace(/\*{2,}/g, "");
}

/* ---------------- 自由对话 · 卡片进工具的「徽章飞行」过渡 ----------------
   点击推荐卡片的瞬间，卡片图标化作一枚渐变徽章飞向目标工具头部的徽章，
   旧界面下沉让位、新界面自下浮现（动画细节见 styles.css 的「徽章飞行」一节）。
   本块只放与 DOM 环境无关的判定与几何，编排逻辑在组件的 animateToolSwitch。
   触发范围刻意只覆盖「卡片点击」这一条路径：侧栏/搜索框切工具是高频动作，
   保持即时；卡片是低频、有仪式感的跳转，值得这段动画。 */
const TOOL_FLY_BADGE_PX = 26;      // 飞行徽章边长（px），介于卡片图标 16 与头部徽章 40 之间
const TOOL_FLY_MS = 460;           // 与 styles.css 的 VT 动画时长一致（460ms）：落定脉冲在此之后触发
const TOOL_FLY_MIN_VIEWPORT = "(min-width: 40rem)"; // sm 以下头部徽章不显示，不做飞行
const TOOL_FLY_NAME = "nbx-tool-fly";   // View Transitions 共享元素名（旧端=飞行徽章，新端=头部徽章）
const TOOL_MAIN_NAME = "nbx-tool-main"; // 工具界面内容容器名（旧内容退场 / 新内容入场）

/* 过渡是否可用：浏览器支持 View Transitions 且用户未要求减少动态效果 */
function toolSwitchTransitionsOk(env) {
  const e = env || {};
  return !!e.startViewTransition && !e.reducedMotion;
}

/* 飞行徽章在视口中的落点：以锚点（卡片图标）中心居中，四边留 4px 钳制，
   防止贴边点击时徽章被视口裁掉 */
function toolSwitchFlightRect(anchor, size, vw, vh) {
  const half = size / 2;
  const maxX = Math.max(4, vw - size - 4);
  const maxY = Math.max(4, vh - size - 4);
  const x = Math.min(Math.max(anchor.left + anchor.width / 2 - half, 4), maxX);
  const y = Math.min(Math.max(anchor.top + anchor.height / 2 - half, 4), maxY);
  return { left: Math.round(x), top: Math.round(y) };
}

/* 给元素挂上 View Transitions 命名并做标记，便于过渡结束后按标记统一清理 */
function nbxNameViewTransition(el, name) {
  if (!el || !el.style || !el.setAttribute) return;
  el.style.viewTransitionName = name;
  el.setAttribute("data-nbx-vt", name);
}

/* Markdown → HTML。marked / DOMPurify 现在由 nbxEnsureRenderLibs 按需加载
   （生成入口与 OCR / 迁移入口都会先 await 它），所以这里的降级分支只是兜底：
   真走到它说明组件没加载成功，宁可退化成纯文本也不把未过滤的 HTML 塞进页面。 */
function renderMd(raw) {
  if (!raw) return "";
  const slotted = toolLinkPlaceholder(raw);
  const normalized = normalizeMarkdown(slotted);
  let html;
  try {
    const parser = window.marked && typeof window.marked.parse === "function" ? window.marked : null;
    html = parser ? parser.parse(normalized) : renderMdFallback(normalized);
    html = finalizeRenderedHtml(window.DOMPurify ? DOMPurify.sanitize(html) : html);
  } catch {
    const fallback = renderMdFallback(slotted);
    html = finalizeRenderedHtml(window.DOMPurify ? DOMPurify.sanitize(fallback) : fallback);
  }
  return restoreToolLinkChips(html);
}

function markdownToPlainText(raw) {
  if (!raw) return "";
  const root = document.createElement("div");
  root.innerHTML = renderMd(raw);
  const lines = [];

  const inlineText = (node) => {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "img") return node.getAttribute("alt") || "";
    if (tag === "a") {
      const text = Array.from(node.childNodes).map(inlineText).join("");
      const href = node.getAttribute("href") || "";
      return href && href !== text.trim() ? `${text} (${href})` : text;
    }
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") {
      return node.textContent || "";
    }
    return Array.from(node.childNodes).map(inlineText).join("");
  };

  const cleanLine = (text) => String(text || "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const addBlock = (text) => {
    const chunks = String(text || "")
      .split("\n")
      .map(cleanLine);
    while (chunks.length && !chunks[0]) chunks.shift();
    while (chunks.length && !chunks[chunks.length - 1]) chunks.pop();
    if (!chunks.length) return;
    lines.push(...chunks, "");
  };
  const addCodeBlock = (text) => {
    const code = String(text || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (!code) return;
    lines.push(...code.split("\n"), "");
  };
  const addTable = (table) => {
    const rows = Array.from(table.querySelectorAll("tr"));
    let rowCount = 0;
    rows.forEach((row) => {
      const cells = Array.from(row.children)
        .filter((cell) => /^(TH|TD)$/.test(cell.tagName))
        .map((cell) => cleanLine(inlineText(cell)));
      if (!cells.length) return;
      lines.push(cells.join("\t"));
      rowCount += 1;
    });
    if (rowCount) lines.push("");
  };
  const addList = (list, depth) => {
    const ordered = list.tagName.toLowerCase() === "ol";
    let index = Number(list.getAttribute("start")) || 1;
    Array.from(list.children)
      .filter((item) => item.tagName && item.tagName.toLowerCase() === "li")
      .forEach((item) => {
        const ownText = Array.from(item.childNodes)
          .filter((child) => !(child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName)))
          .map(inlineText)
          .join("");
        const value = cleanLine(ownText);
        if (value) lines.push(`${"  ".repeat(depth)}${ordered ? `${index}. ` : "• "}${value}`);
        Array.from(item.children)
          .filter((child) => child.tagName && /^(UL|OL)$/.test(child.tagName))
          .forEach((child) => addList(child, depth + 1));
        index += 1;
      });
    lines.push("");
  };
  const visit = (node) => {
    if (node.nodeType === 3) {
      if (node.nodeValue.trim()) addBlock(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === "p") {
      addBlock(inlineText(node));
    } else if (tag === "ul" || tag === "ol") {
      addList(node, 0);
    } else if (tag === "blockquote") {
      addBlock(inlineText(node).split("\n").map((line) => `  ${line}`).join("\n"));
    } else if (tag === "pre") {
      addCodeBlock(node.textContent || "");
    } else if (tag === "hr") {
      addBlock("----------------");
    } else if (tag === "table") {
      addTable(node);
    } else if (tag === "div" || tag === "section" || tag === "article") {
      Array.from(node.childNodes).forEach(visit);
    } else if (tag === "li") {
      addBlock(inlineText(node));
    } else {
      addBlock(inlineText(node));
    }
  };

  Array.from(root.childNodes).forEach(visit);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---------------- 试卷可视化全解：行内格式（加粗 / 高亮） ----------------
   老师只看到排版、看不到标记，存储与导出仍是 Markdown 标记：**加粗** ==高亮==
   （只用这两种双字符成对标记：不会误伤英语原文里的单个星号）。
   · vpInlineParts：扫描出「成对标记 → 片段」，落单或空对的标记直接丢弃；
   · vpFmt：先转义再套 <b>/<mark>，返回值可直接 innerHTML（无注入面）；
   · vpDetag：只去标记不留格式（答案徽章、总览小格、纯文本复制用）；
   · vpDomToMd：把编辑区 DOM 还原成标记文本（编辑器写回数据时用）。 */
const VP_GROUP_IDS = ["reading", "cloze7", "cloze", "grammar", "writing_app", "writing_cont", "other"];

function vpInlineParts(text) {
  const s = String(text == null ? "" : text);
  const parts = [];
  let buf = "";
  let i = 0;
  const pushBuf = () => { if (buf) { parts.push({ k: "t", v: buf }); buf = ""; } };
  while (i < s.length) {
    let marker = "";
    if (s.startsWith("**", i)) marker = "**";
    else if (s.startsWith("==", i)) marker = "==";
    if (!marker) { buf += s[i]; i += 1; continue; }
    const end = s.indexOf(marker, i + 2);
    if (end === -1) { i += 2; continue; }                    // 落单标记：丢弃
    const inner = s.slice(i + 2, end);
    if (!inner.trim() || inner.includes(marker)) { i += 2; continue; }  // 空对 / 同种嵌套：丢标记
    pushBuf();
    parts.push({ k: marker === "**" ? "b" : "m", v: inner });
    i = end + 2;
  }
  pushBuf();
  return parts;
}

function vpFmt(text) {
  return vpInlineParts(text).map((p) => {
    if (p.k === "b") return `<b>${vpFmt(p.v)}</b>`;
    if (p.k === "m") return `<mark class="vp-hl">${vpFmt(p.v)}</mark>`;
    return escapeHtml(p.v);
  }).join("");
}

function vpDetag(text) {
  return vpInlineParts(text).map((p) => p.v).join("");
}

/* 归一化标记文本：压缩同种嵌套产生的重复标记，再走一遍配对扫描丢掉落单标记 */
function vpNormalizeInline(text) {
  const s = String(text == null ? "" : text).replace(/\*{3,}/g, "**").replace(/={3,}/g, "==");
  return vpInlineParts(s).map((p) => {
    if (p.k === "b") return `**${vpNormalizeInline(p.v)}**`;
    if (p.k === "m") return `==${vpNormalizeInline(p.v)}==`;
    return p.v;
  }).join("");
}

/* 约定符号兜底清洗：`::` 是 @@PITFALLS@@ 专用的「标题::描述」分隔符，模型偶尔会把
   这套写法带进其他讲解字段（如干扰项写成「易混 was::…」），裸露的分隔符会直接
   渲染到屏幕上。讲解类字段里连续两个及以上的冒号（::、：:、:：、：：）统一还原成
   普通冒号「：」。照录类字段（语篇/题干/选项/迁移题面/范文/答案）与易错点描述
   不碰：前者必须逐字保留，后者允许老师写含 :: 的文本（有回归用例盯着）。 */
function vpScrubFieldText(text) {
  if (typeof text !== "string") return text;
  return text.replace(/[:：]{2,}/g, "：");
}

/* 编辑区 DOM → 标记文本：b/strong/mark 转标记，br/div/p 转换行，其余元素透明穿透 */
function vpDomToMd(root) {
  const walk = (node) => {
    let out = "";
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, " "); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === "BR") { out += "\n"; continue; }
      const inner = walk(n);
      if (tag === "B" || tag === "STRONG") out += `**${inner}**`;
      else if (tag === "MARK") out += `==${inner}==`;
      else if (tag === "DIV" || tag === "P") out += (out && !out.endsWith("\n") ? "\n" : "") + inner + "\n";
      else out += inner;
    }
    return out;
  };
  /* 浏览器把每行包成 <div>，末尾会多出一个换行，去掉它避免反复编辑攒空行 */
  return vpNormalizeInline(walk(root)).replace(/\n+$/, "");
}

/* 在编辑区里给选区加/去格式：已整体处于该标签内则解包，否则包裹 */
function vpClosestInline(node, root, tag) {
  const want = tag.toUpperCase();
  for (let n = node && node.nodeType === 1 ? node : (node ? node.parentNode : null); n && n !== root; n = n.parentNode) {
    if (n.tagName === want) return n;
  }
  return null;
}

function vpToggleTag(root, tag) {
  const sel = document.getSelection ? document.getSelection() : window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return false;
  if (!root.contains(range.commonAncestorContainer)) return false;
  const host = vpClosestInline(range.commonAncestorContainer, root, tag);
  if (host) {
    const parent = host.parentNode;
    const moved = [];
    while (host.firstChild) moved.push(parent.insertBefore(host.firstChild, host));
    parent.removeChild(host);
    if (moved.length) {
      // 重新选中刚解包的内容，方便连续切换格式
      const after = document.createRange();
      after.setStartBefore(moved[0]);
      after.setEndAfter(moved[moved.length - 1]);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    return true;
  }
  const wrap = document.createElement(tag);
  try {
    range.surroundContents(wrap);
  } catch {
    // 选区跨节点：抽取内容再包一层（可能顺带拆分原有标签，序列化时会归一化）
    wrap.appendChild(range.extractContents());
    range.insertNode(wrap);
  }
  sel.removeAllRanges();
  const after = document.createRange();
  after.selectNodeContents(wrap);
  sel.addRange(after);
  return true;
}


/* PDF 导出（浏览器打印）专用样式：
   镜像页面 .md 排版规则，但固定为纸面友好的浅色配色，
   并补充分页控制（表格行/代码块不切断、表头跨页重复等）。 */
const PDF_PRINT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  @page { size: A4; margin: 16mm 14mm; }
  body.md {
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif;
    color: #1f2328; line-height: 1.8; word-break: break-word;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .md > :first-child { margin-top: 0; }
  .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
    font-weight: 700; line-height: 1.4; margin: 1.3em 0 0.55em;
    page-break-after: avoid; break-after: avoid;
  }
  .md h1 { font-size: 1.5em; }
  .md h2 { font-size: 1.25em; padding-bottom: 0.3em; border-bottom: 1px solid #d8dce2; }
  .md h3 { font-size: 1.1em; }
  .md h4 { font-size: 1em; }
  .md p { margin: 0.7em 0; }
  .md ul, .md ol { margin: 0.7em 0; padding-left: 1.6em; }
  .md ul { list-style: disc; }
  .md ul ul { list-style: circle; }
  .md ol { list-style: decimal; }
  .md li { margin: 0.3em 0; }
  .md li::marker { color: #b26a2e; }
  .md strong, .md b { font-weight: 650; }
  .md a { color: #b26a2e; text-decoration: underline; text-underline-offset: 3px; }
  .md blockquote {
    margin: 1em 0; padding: 0.6em 1em; border-left: 3px solid #d59a5b;
    background: #faf5ee; color: #57534e; page-break-inside: avoid; break-inside: avoid;
  }
  .md code {
    font-family: "SF Mono", "JetBrains Mono", Consolas, "Courier New", monospace;
    font-size: 0.86em; padding: 0.1em 0.4em; border-radius: 4px;
    background: #f4f4f2; border: 1px solid #e2e2de;
  }
  .md pre {
    margin: 1em 0; padding: 0.9em 1.1em; border-radius: 8px;
    background: #f7f7f5; border: 1px solid #e2e2de;
    white-space: pre-wrap; word-wrap: break-word;
    page-break-inside: avoid; break-inside: avoid;
  }
  .md pre code { padding: 0; background: transparent; border: none; }
  .md hr { margin: 1.5em 0; border: none; border-top: 1px solid #d8dce2; }
  .md table {
    width: 100%; margin: 1em 0; border-collapse: collapse; font-size: 0.9em;
    page-break-inside: auto;
  }
  .md thead { display: table-header-group; }
  .md tr { page-break-inside: avoid; break-inside: avoid; }
  .md th, .md td { padding: 0.5em 0.8em; border: 1px solid #c9ced6; text-align: left; vertical-align: top; }
  .md th { background: #f3ede4; font-weight: 650; }
  .md tr:nth-child(even) td { background: #fafaf8; }
  .md img { max-width: 100%; page-break-inside: avoid; break-inside: avoid; }
  .md .katex-display { margin: 0.8em 0; overflow: visible; }
`;

/* 答案遮罩 */
const ANSWER_KW = /答案|解析|answer|key\s*[:：]/i;
function tagAnswerElements(root) {
  if (!root) return;
  root.querySelectorAll(".ans").forEach((el) => el.classList.remove("ans"));
  const sel = "p, li, h1, h2, h3, h4, h5, td, strong, b, em, blockquote";
  const els = root.querySelectorAll(sel);
  els.forEach((el) => {
    if (!ANSWER_KW.test(el.textContent || "")) return;
    const hasMatchChild = Array.from(el.querySelectorAll(sel)).some(
      (c) => c !== el && ANSWER_KW.test(c.textContent || "")
    );
    if (!hasMatchChild) el.classList.add("ans");
  });
}

/* 计时展示：秒保留 1 位小数，满 60s 合并为 m，满 1h 合并为 h */
function fmtDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return (s / 60).toFixed(1) + "m";
  return (s / 3600).toFixed(1) + "h";
}
function fmtTokens(n) {
  return (Number(n) || 0).toLocaleString("en-US");
}

/* ---------------- 打击级别评级（AA 智能指数 → 打击级别区间映射） ----------------
   唯一对照表，与管理端 admin-frontend/script.js 的同名常量保持一致（一致性测试盯着两边）。
   留空或低于 17 分一律未评级；max 为 null 表示上不封顶。 */
const AA_STRIKE_LEVELS = [
  { lv: 1, min: 17, max: 35, name: "常规火炮级", alias: "", color: "#64748b",
    gist: "基础逻辑与轻量文本处理；已强于绝大多数普通人，仅在领域专家面前显现智力差距" },
  { lv: 2, min: 36, max: 42, name: "温压弹级", alias: "学科满分级", color: "#d97706",
    gist: "做题家巅峰：彻底打穿人类标准化考试（如高考英语除作文满分），高阶思辨仍受限于既有框架" },
  { lv: 3, min: 43, max: 47, name: "原子弹级", alias: "曼哈顿时刻", color: "#ea580c",
    gist: "初次眩晕瘫坐：单点突破人类专家盲区，解题解析极其细腻，开始让专业学者产生压迫感" },
  { lv: 4, min: 48, max: 51, name: "氢弹级", alias: "热核聚变", color: "#dc2626",
    gist: "规模化智力溢出：从裂变跃升至聚变，在复杂长链条推理与奥赛级难题上形成无死角覆盖" },
  { lv: 5, min: 52, max: 54, name: "光粒级", alias: "恒星引爆", color: "#7c3aed",
    gist: "跨量级定点抹杀：以近光速质量点直接引爆恒星，定点攻克悬置数十年的单点数学猜想" },
  { lv: 6, min: 55, max: 58, name: "二向箔级", alias: "维度坍缩", color: "#0e7490",
    gist: "连同思考过程一起二维化：不仅给出答案，更把人类探索范式的空间彻底拍扁" },
  // 59 分及以上不设级别：现有评测体系上限之外的强度不可知——未知的未知
  { lv: 0, min: 59, max: null, name: "未知", alias: "未知的未知", color: "#52525b",
    gist: "超出评级体系上限：强度不可知，故不设打击级别" },
];

/* AA 指数 → 打击级别；留空、非数字或低于 17 分返回 null（未评级）。
   区间按整数分段、小数向下取整归档；59 分及以上返回「未知」档（未知的未知）。 */
function aaLevelOf(aa) {
  const n = Number(aa);
  if (aa == null || aa === "" || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return AA_STRIKE_LEVELS.find((l) => v >= l.min && (l.max == null || v <= l.max)) || null;
}

/* 区间文案：52–54 分 / 59 分及以上 */
function aaRangeText(lv) {
  return lv.max == null ? `${lv.min} 分及以上` : `${lv.min}–${lv.max} 分`;
}

/* ---------------- Alpine 主应用 ---------------- */
function nbx() {
  return {
    /* --- 数据 --- */
    groups: [],
    models: [],
    // 模型下拉最大显示数（后台配置，0 = 不折叠）与本次展开状态
    maxVisibleModels: 0,
    modelsExpanded: false,
    // 打击级别科普弹窗（模型下拉底部「等级说明」入口打开）
    strikeGuideOpen: false,
    toolsLoaded: false,
    toolsError: "",
    currentTool: null,

    /* --- 描述需求找工具（Jev choice） ---
       两个输入框（首页大搜索框 + 侧栏顶部窄版）共用这一份状态：
       toolSearchAnchor 记住是哪个入口在开着面板，同一时刻只渲染一份结果面板。 */
    toolSearchQuery: "",
    // idle（空）| waiting（停顿计时中，进度条在走）| searching | results | long（看着像粘了正文）
    toolSearchState: "idle",
    toolSearchOpen: false,
    toolSearchResults: [],
    toolSearchMeta: { fallback: false, no_match: false, uncertain: false, offline: false, jev: false },
    toolSearchAnchor: "home",
    toolSearchActive: 0,
    // 停顿窗口与短窗：做成状态字段而不是直接读常量，便于测试收敛到几十毫秒
    toolSearchPauseMs: TOOL_SEARCH_PAUSE_MS,
    toolSearchEarlyMs: TOOL_SEARCH_EARLY_MS,
    toolSearchExample: TOOL_SEARCH_EXAMPLES[0],
    // 每次重新计时自增：进度条的动画靠它当 key 重建，才能从头再走一遍
    toolSearchArm: 0,
    _toolSearchTimer: null,
    _toolSearchAbort: null,
    _toolSearchSeq: 0,
    _toolSearchFired: "",
    _toolSearchComposing: false,
    _toolSearchExampleTimer: null,

    selectedModel: "",
    input: "",
    output: "",
    rendered: "",
    // 从历史打开的超长内容：只渲染前一段，「查看更多」展开全文（实时生成不折叠）
    outputFoldEligible: false,
    outputFolded: false,
    outputFoldTotal: 0,
    streaming: false,
    thinking: false,
    status: "idle",
    errorMsg: "",
    // 登录过期/额度用尽类错误不可通过重试解决，错误卡上隐藏重试按钮
    errorRetryable: true,
    // 本次失败是频次限制（免费模型限额 / 接口限速 429）：错误卡上给专门的解释，
    // 避免用户按「模型服务繁忙」反复重试
    errorLimited: false,
    // 刚才实际失败的模型，与 selectedModel 分离：失败后用户手动换模型时，
    // 换模型弹窗仍应禁用真正失败的那个，而不是新的当前模型
    failedModel: "",
    retryModelOpen: false,
    // 模型弹窗的用途：retry = 失败后换个模型重试，regen = 重新生成（整篇重来、旧结果保留）
    retryModelMode: "retry",
    // 屏幕上这份结果对应的历史记录 id（试卷工具另有 visualPaper.historyId）：
    // 续写与重试都写回这条记录而不是新建，同一份输入在历史里只留一条
    activeHistoryId: null,
    // 本次开流前 output 的长度：收尾时判断这一轮续写到底有没有产出新内容
    _streamBaselineLen: 0,
    // 重新生成开流前的正文快照：新版本一个字都没产出时用它把屏幕恢复成旧结果
    // （记录本身没被动过，见 finalize）。只在这一种情形下有意义，用完即清。
    _regenPrevOutput: "",
    // 备用通道切换进度：后端发 fallback 事件时才有值（单 Provider 不会触发）。
    // 只含「第几个 / 共几个 / 为什么切」，不含 Provider 名称，
    // 让用户在长等待里知道自己在等第几个通道，而不是对着空界面干等。
    fallbackInfo: null,
    // 仅供 devPreview* 预览演练的取消令牌（见下方「仅供预览/联调」段）
    _devPreviewSeq: 0,
    elapsed: "0.0",
    // 等待阶段计时：请求发出 → 首个事件到达（此期间还没在思考，只是等响应）
    thinkingSec: 0,
    // 推理过程（ ephemeral，不进历史/导出/复制）：有 reasoning 事件才显示，
    // 无事件时保持空，界面回退到“等待模型响应”动画。
    reasoning: "",
    /* 推理过程的「已上屏」视图：流式逐字放出（打字机），真值始终是 reasoning。
       收尾（reasoningDone）后与真值对齐；历史 / 统计一律读真值。 */
    reasoningShown: "",
    reasoningOpen: true,
    reasoningDone: false,
    reasoningTruncated: false,
    /* 思考过程此刻是否该占屏（翻译工具用它决定整条的显隐）。
       刻意做成一个显式状态位，而不是在模板里写 `reasoning && !reasoningDone`：
       复合表达式里 `&&` 会短路，右侧在那个求值里根本没被读到，也就没登记成依赖。 */
    reasoningLive: false,
    // 思考阶段统计：首个推理 chunk → 首个正文 token，reasoningDone 后冻结
    reasoningSec: 0,
    reasoningTokens: 0,
    reasoningSpeed: 0,
    _reasoningStartTs: 0,
    requestId: null,
    maskOn: false,
    copied: false,

    /* --- 试卷可视化全解 --- */
    visualPaper: null,
    vpFullscreen: false,
    vpActiveTab: "reference",
    vpParseError: "",
    // 上一轮生成的收尾方式：done（模型自然写完）/ stopped（用户停止）/ error（报错、断流）。
    // 空串＝这份卷子还没跑过。与视觉卷数据分开放：它描述的是「这次请求怎么结束的」，
    // 不是卷子结构，不该跟着历史快照走（历史回放时由 partial/error 重新推导）。
    vpRunState: "",
    _vpRenderPending: false,
    // 两阶段生成状态：vpStage = 当前阶段（""/framework/explain）。阶段边界快照下来的
    // 骨架文本存在 visualPaper.frameworkRaw 上——随历史快照一起持久化，历史续写才有骨架可走
    vpStage: "",
    vpParallel: false,
    vpTasks: [],
    // 全屏讲解舞台：总览面板 / 控制台自动隐藏（上下两半可独立唤回）/ 固定
    vpOverviewOpen: false,
    vpTopHidden: false,
    vpBottomHidden: false,
    vpChromePinned: false,
    // 导出单文件讲解 HTML：标题弹窗 / 打包状态 / 静态资源缓存
    vpExportOpen: false,
    vpExportTitle: "",
    vpExportBusy: false,
    _vpAssets: null,
    // 修改模式（所见即所得）：开关 / 脏标记 / 自动保存计时
    vpEditing: false,
    vpEditDirty: false,
    _vpEditTimer: null,
    _vpEditEl: null,
    _vpToolTimer: null,
    _vpEditListenersBound: false,
    _vpDragging: false,
    vpSelActive: false,
    // 生成前的工具配置：每题迁移训练题量（1–5，默认 1）；面板仿右上角模型菜单向上弹出
    vpSettings: { transferCount: 1 },
    vpSettingsOpen: false,
    VP_TRANSFER_MIN: 1,
    VP_TRANSFER_MAX: 5,

    /* --- 智能错题迁移 --- */
    migration: null,
    migrationExportTarget: null,
    migrationExportStyle: "",

    /* --- 超标词排查+替换 --- */
    vocab: null,

    /* --- 导出 --- */
    exportMenuOpen: false,
    exportMenuStyle: "",
    exportFormat: "plaintext",
    exportFontSize: 14,
    exportFormats: [
      { id: "plaintext", name: "复制纯文本", desc: "去除 Markdown 标记，保留段落和列表结构", icon: "copy", type: "copy" },
      { id: "richtext", name: "复制富文本", desc: "粘贴到 Word / WPS 时请选择“保留源格式”", icon: "copy", type: "copy" },
      { id: "mdsource", name: "复制 Markdown", desc: "保留原始标记符号", icon: "copy", type: "copy" },
      { id: "word", name: "Word (.docx)", desc: "可编辑，适合打印分发", icon: "file-text", type: "download" },
      { id: "pdf", name: "PDF", desc: "高保真排版，打印窗口中另存为 PDF", icon: "report", type: "download" },
      { id: "md", name: "Markdown (.md)", desc: "源文件，需 Markdown 阅读器", icon: "file-text", type: "download" },
      { id: "txt", name: "纯文本 (.txt)", desc: "无格式，兼容性最好", icon: "file-text", type: "download" },
    ],

    /* --- 认证 --- */
    auth: {
      token: null,
      user: null,
    },
    isAuthenticated: false,
    authUser: null,
    maskedCode: "",
    quotaLabel: "",
    codeInput: "",
    codeError: "",
    /* 弹窗里的一句「为什么被要求输入使用码」：弹窗遮罩会盖住 toast，提示必须放在弹窗内 */
    codeHint: "",
    codeActivating: false,
    codeModal: false,

    /* --- 设置面板（左下角齿轮入口，居中 3D 卡片） --- */
    settingsOpen: false,
    fxOn: true,
    mascotHidden: false,
    /* 内容字号：工作区整体缩放百分比（zoom 作用在 <main> 上，侧栏与弹窗不受影响） */
    contentScale: 100,
    CONTENT_SCALE_MIN: 80,
    CONTENT_SCALE_MAX: 160,
    CONTENT_SCALE_STEP: 10,
    CONTENT_SCALE_DEFAULT: 100,
    finePointer: matchMedia("(pointer: fine)").matches,
    _tilt: null,

    /* --- 输入模式 --- */
    inputMode: "text",
    attachedFile: null,
    dragOver: false,
    inputCollapsed: false,
    submittedInput: "",
    submittedFileName: "",
    submittedExpanded: false,

    /* --- 文件上传（本地 + PDF 云端 MinerU） --- */
    parseConfig: { pdf_enabled: true, mode: "precision", model: "pipeline", limits: { precision_mb: 200, agent_mb: 10, current_mb: 200 } },
    parsingFile: false,
    parsingLabel: "",
    pendingPdfFile: null,
    parseStartedAt: 0,
    parseElapsedSec: 0,
    parseElapsed: "",
    _parseTimer: null,
    scanWarnOpen: false,
    scanWarnStage: "pre",
    scanConfirming: false,
    uploadErrorOpen: false,
    uploadErrorTitle: "",
    uploadErrorMsg: "",
    uploadErrorDetail: "",
    showUploadDetail: false,
    /* --- 通用确认弹窗（替代浏览器原生 confirm） --- */
    confirmOpen: false,
    confirmTitle: "",
    confirmMessage: "",
    confirmText: "确定",
    confirmCancelText: "取消",
    confirmDanger: false,
    _confirmResolve: null,
    _pdfAbort: null,
    get uploadHintText() {
      const base = "支持 .docx / .doc / .txt / .md / .pdf 与图片，自动跳过听力";
      if (this.parseConfig && this.parseConfig.pdf_enabled === false) return base + "（PDF 解析未配置）";
      return base;
    },
    get uploadHintTitle() {
      return "PDF 由云端解析，较大文件需等待；图片会先做文字识别";
    },
    /* 工具数量不再写死：加一个工具就得改几处文案，久了必然对不上（当天就错过一次） */
    get toolCountLabel() {
      const total = (this.groups || []).reduce((sum, g) => sum + ((g.tools || []).length), 0);
      return total ? `${total} 个` : "…";
    },

    /* --- 上传来源弹窗（已有原稿 / 需要拍照） --- */
    uploadOpen: false,
    uploadStep: "source",  // source | photo（识别图片文字工具、以及给识别批次补图片时直接从 photo 开始）
    uploadImagesOnly: false, // 本次上传是否只收图片（见 uploadHasSourceStep）
    uploadBusyLabel: "",   // 压缩/读取中的临时提示

    /* --- 图片识别（识别图片文字：独立工具 + 弹窗两种形态共用同一套状态） --- */
    ocrHost: "tool",       // tool = 独立工具工作区，modal = 其他工具上传流程里的阻塞弹窗
    ocrModalOpen: false,   // 弹窗形态是否可见
    ocrImages: [],         // 本地图片为 { id, name, size, dataUrl }；扫码来源为 { id, name, size, url }
    ocrIndex: 0,           // 预览的是第几张
    // 手动选的类型：只对 OCR_MANUAL_MODE_TOOLS 里的工具有意义，其它工具的类型由工具决定
    ocrModeManual: "printed",   // printed = 印刷试卷，handwritten = 手写作文
    // stopped = 没跑完就停了（用户点取消，或后端以 [CANCELLED] 收尾）：已出的内容要留着，
    // 但要按「一半」交代，不能跟 done 一样当成完整结果；history = 从历史记录打开的回看态
    ocrStage: "empty",          // empty | ready | streaming | done | stopped | error | history
    ocrText: "",
    ocrRendered: "",
    ocrError: "",
    ocrTruncated: false,
    ocrMediaCollapsed: false,
    _ocrMediaTouched: false,    // 用户手动开合过图片区：本批不再按屏幕宽度覆盖他的选择
    _ocrCancelReason: "",       // user = 用户点了取消，batch = 批次变了被动停：两者的收尾不同
    _ocrHistoryId: "",          // 本批图片上一次写进历史的那条 id（同批重跑写回它，不刷屏）
    ocrStartStep: false,        // 正停在「确认类型 / 开始识别」这一步（见 ocrStartStepVisible）
    ocrElapsedSec: 0,
    /* 全屏查看（点图放大）同时也是编辑：转正与裁剪都先只记在这里，
       关闭时一次性烘焙进 dataUrl——转两次再裁一次也只编码一次，不叠画质损失 */
    ocrViewerOpen: false,
    ocrEditBase: "",            // 打开时那张图（data URL）：重置回到这里，也是烘焙的输入
    ocrEditBaseW: 0,            // 它的自然像素尺寸（未旋转）
    ocrEditBaseH: 0,
    ocrEditRotate: 0,           // 待应用的旋转（0/90/180/270）
    ocrEditCrop: null,          // 待应用的裁剪（归一化，坐标系是「旋转之后」的画面）
    ocrEditCropOn: false,       // 裁剪工具是否展开
    ocrEditFull: { w: 0, h: 0 },    // 整幅图在屏幕上的显示尺寸（旋转后）
    ocrEditImg: { w: 0, h: 0 },     // 未旋转画面在屏幕上的显示尺寸（旋转靠 CSS transform）
    ocrEditView: { scale: 1, x: 0, y: 0 },   // 放大与平移（看细节用）
    ocrEditBusy: false,         // 正在取图 / 正在烘焙：这期间不接第二次操作
    _ocrPointers: null,         // 屏幕上的指针（触屏双指缩放要用）
    _ocrDrag: null,             // 本次拖拽的起点与目标（裁剪框/平移）
    _ocrDragged: false,
    _ocrTimer: null,
    _ocrAbort: null,
    _ocrRequestId: "",
    /* 扫码配对（阶段五） */
    pairOpen: false,
    pairToken: "",
    pairUrl: "",
    pairState: "waiting",  // waiting | connected | receiving | error
    pairError: "",         // error 态的真实原因（配对过期、创建失败…），别再统一说成「配对已失效」
    pairCount: 0,          // 服务器上已有的照片数（界面用）
    _pairCount: 0,         // 上一帧的照片数：只认「0 → 第 1 张」那一刻来自动收起窗口
    pairExpiresIn: 0,
    _pairTimer: null,
    _pairSource: null,
    ocrPairToken: "",      // 本次识别取自扫码会话时的 token（请求改带 token，不回传图片）

    /* --- 翻译（工具 33）：原文/译文对照 --- */
    trSourceLang: TR_DEFAULT_SOURCE,   // 源语言 id（auto = 自动检测）
    trTargetLang: TR_DEFAULT_TARGET,   // 目标语言 id
    trSrcCollapsed: false,             // 折叠原文栏：译文独占工作区并在阅读栏宽里居中
    trTruncated: false,                // 本次译文撞到输出上限（可「继续翻译」接着译完）
    trHistoryId: "",                   // 译文写回的历史记录 id；空 = 下一次生成新建一条
    trMenu: "",                        // 打开着的语言下拉："source" | "target" | ""
    trResultVisible: false,            // 窄屏：还没按下翻译时译文栏不占地方（宽屏不起作用）
    trResultFolded: false,             // 输入法弹起时译文栏让位（只留栏头一行），窄屏才有
    _trSnap: null,                     // 本轮翻译的输入快照 { source, sourceId, targetId }
    _trKbTimer: null,                  // 键盘开合的判定延时（键盘动画期间会连续报值）
    _trRevealTimer: null,              // 译文栏收放动画落下后再重算高度/对齐
    _trGrowRaf: 0,
    _trSyncRaf: 0,
    _trScrollSide: "",                 // 本帧要带动哪一栏（滚轮比帧密，合并成每帧一次）
    _trDriven: null,                   // 上一次程序化写入的那一栏：它的回声不再反向带动
    _trFollowOutput: true,             // 译文栏是否贴着底（贴底就跟流式输出走）

    /* --- 面板状态 --- */
    leftOpen: false,
    rightMobileOpen: false,
    rightCollapsed: false,
    /* 窄档（浮层侧栏模式）：<2xl 为 true。悬浮触发钮与抽屉遮罩都只看它，
       不靠 display 工具类——那会和 styles.css 的同权重规则抢，胜负取决于注入顺序。 */
    isCompact: !WIDE_MQ.matches,
    rightTab: "history",
    collapsedGroups: {},
    modelMenuOpen: false,

    /* --- 本地数据 --- */
    history: [],
    /* --- 历史搜索（索引与查询在 nbx-history-search.js） --- */
    historyQuery: "",
    historySearchRows: [],
    historySearchActive: -1,
    historySearchIndexing: false,
    historySearchFocused: false,
    historySearchDuration: 0,
    historySearchTotal: 0,
    _hsComposing: false,
    _hsSearchTimer: null,
    _hsLastQuery: "",
    _hsBuildQueued: false,
    _hsBuildTimer: null,
    _hsBuildIdle: null,
    // 旧格式迁移失败时置真：本次会话退回整份历史写入，不破坏尚未拆分的旧数据
    _historyLegacy: false,
    _titlePollTimer: null,
    _titlePollInFlight: false,
    _titlePollFailures: 0,
    _titlePollBlocked: false,
    favorites: [],
    favModal: false,
    editingFav: { id: null, title: "", content: "" },

    /* --- 线路镜像 --- */
    // 只有给界面看的字符串进响应式数据；iframe/回调等运行期状态在 _mirror 里
    mirrorStatus: "off",
    mirrorHint: "",
    _mirrorPushTimer: null,
    _mirrorReloadTimer: null,
    _mirrorReloadPending: false,

    /* --- 导入预览 --- */
    importPreviewOpen: false,
    importPreviewFilter: "",
    importPreviewGroups: [],
    importPreviewTotal: 0,
    _importPreviewResolve: null,

    /* --- 主题 --- */
    theme: "paper",
    themes: THEMES,

    /* --- Toast --- */
    toasts: [],
    /* 删除撤销条：同一时刻只保留最近一次删除（Telegram 式单槽位） */
    undoAction: null,
    undoWindowMs: UNDO_WINDOW_MS,
    _undoTimer: null,
    get undoSeconds() {
      return Math.round(UNDO_WINDOW_MS / 1000);
    },

    /* --- 内部 --- */
    _abortCtrl: null,
    // 生成代次：切换工具/新建题目会作废在途流，旧流的 finalize 据此不再回写状态
    _runSeq: 0,
    _timer: null,
    _thinkTimer: null,
    _startTs: 0,
    // 渲染脏标记：只有输出内容变化（新 token / 载入历史 / 打字机推进）才需要重新渲染，
    // 避免 finalize 定稿与在途渲染对同一份全文做重复的全量重渲染
    _outputDirty: true,
    _nearBottom: true,
    _draftTimer: null,
    _bg: null,
    // 「徽章飞行」过渡代次：连点时旧过渡的收尾据此不再碰新过渡的痕迹
    _toolFxSeq: 0,
    _migrationAbortControllers: {},
    _exportMenuAnchor: null,
    _exportMenuPositionFrame: null,
    _migrationExportAnchor: null,
    _migrationExportPositionFrame: null,
    mascotState: "hidden",
    _mascotCheckTimer: null,
    _mascotAnimationTimer: null,
    _mascotResizeObserver: null,
    _mascotMutationObserver: null,
    _preSoraTheme: null,
    _lastMascotDbl: 0,
    _skyTimer: null,
    _faviconDefault: "",

    newMigrationState() {
      return {
        step: 1,
        form: {
          question: "",
          standardAnswer: "",
          studentAnswers: "",
          errorCause: "",
        },
        causes: [],
        selectedCauseIds: [],
        feedback: "",
        feedbackHistory: [],
        analysisHistory: [],
        analyzing: false,
        moreAnalyzing: false,
        prechecking: false,
        analysisError: "",
        questionCount: 3,
        results: [],
        generated: false,
        generating: false,
        stopRequested: false,
        batchId: "",
      };
    },
    resetMigration() {
      this.migration = this.newMigrationState();
      this.closeExportMenu();
      this._migrationAbortControllers = {};
    },
    get isMigrationTool() {
      return !!this.currentTool && this.currentTool.id === "26";
    },
    get migrationSelectedCauses() {
      if (!this.migration) return [];
      const selected = new Set(this.migration.selectedCauseIds);
      return this.migration.causes.filter((cause) => selected.has(cause.id));
    },
    get migrationChargeUnits() {
      const count = this.migrationSelectedCauses.length;
      return Math.max(1, Math.floor(count / 2));
    },
    get migrationHasOutput() {
      return !!this.migration && this.migration.results.some((card) => card.output && card.output.trim());
    },

    /* ============ 超标词排查+替换 ============ */
    newVocabState() {
      return {
        text: "",
        result: null,
        checking: false,
        checkError: "",
        checked: false,
        // 排查那一刻的原文快照。正文改动后清单即作废（见 vocabTextChanged）
        checkedText: "",
        replacing: false,
        stopRequested: false,
        thinking: false,
        status: "idle",
        elapsed: "0.0",
        output: "",
        rendered: "",
        // 从历史打开的超长结果先折叠渲染，展开后才渲染全文
        foldEligible: false,
        folded: false,
        foldTotal: 0,
        requestId: null,
        reasoning: "",
        reasoningShown: "",
        reasoningOpen: true,
        reasoningDone: false,
        reasoningTruncated: false,
        reasoningTokens: 0,
      };
    },
    resetVocab() {
      this.vocab = this.newVocabState();
    },

    /* ============ 试卷可视化全解 ============ */
    newVisualPaperState() {
      return {
        paper: null,
        groups: [],
        answerMap: {},
        notice: "",
        total: null,
        // 这份卷子生成时锁定的每题迁移题量，随历史记录一起存。
        // 未锁定（null）＝还没跑过，第一次发起时用当前设置盖章
        transferCount: null,
        // 阶段边界快照下来的骨架文本（两阶段续写的输入）；随 visualPaper 快照进历史记录
        frameworkRaw: "",
        historyId: null,
        rawJson: "",
        parseError: "",
        isJson: false,
        currentGroupIdx: 0,
        currentQIdx: 0,
        activeTab: "reference",
      };
    },
    // 输出残片是否含自定义 @@TAG@@（中断残片绝不直接展示原文）
    get vpHasCustomFragment() {
      const raw = this.output || "";
      return VP_ANY_TAG_RE.test(raw);
    },
    /* 生成中断且无完整题：展示中断卡，不裸奔原文。中途失败也走这里——那种情况下错误卡
       已经整张隐藏，中断卡是页面上唯一的恢复入口，所以残片有没有完整标签都得给出来。 */
    get vpInterrupted() {
      return !this.streaming && !this.vpHasData && !!this.output.trim()
        && (this.vpHasCustomFragment || this.vpFailedMidStream);
    },
    resetVisualPaper() {
      // 换工具 / 换试卷前先退掉修改模式：避免带着编辑态进到下一个上下文。
      // 若还有没落盘的改动（防抖时间窗内切走），先补一次写入，别丢最近的几笔修改。
      if (this.vpEditing && this.vpEditDirty) this.vpFlushEdits();
      this.vpEditing = false;
      this.vpEditDirty = false;
      this.vpSelActive = false;
      this._vpStopEditTimer();
      this.vpHideTools();
      this.closeVpSettings();
      this.visualPaper = this.newVisualPaperState();
      this.vpCloseFullscreen();
      this.vpActiveTab = "reference";
      this.vpParseError = "";
      this.vpRunState = "";
      // 两阶段状态：当前阶段（""/framework/explain）；骨架快照 frameworkRaw 随
      // newVisualPaperState 一并清空
      this.vpStage = "";
      this.vpParallel = false;
      this.vpTasks = [];
      this._vpRenderPending = false;
    },
    parseCustomVisualPaper(raw) {
      if (!raw || !VP_HAS_TAG_RE.test(raw)) return null;
      const lines = raw.split(/\r?\n/);
      const ALLOWED = new Set(["reading","cloze7","cloze","grammar","writing_app","writing_cont","other"]);
      let totalDeclared = null;
      let paperTitle = "";
      let notice = "";
      const groups = [];
      let currentGroup = null;
      let currentQ = null;
      let currentField = null;
      let fieldBuf = [];
      // 语篇按编号复用（@@PASSAGE_DEF@@ P1 + 全文 / @@PASSAGE_REF@@ P1）：先收齐全部定义，
      // 收尾时再统一解析引用，声明写在引用之后、跨组复用、截断与续写都能对上
      const passageDefs = {};
      let pendingDefRef = "";
      // 试卷所附答案/解析区（@@KEY@@，框架阶段圈出）：全局收集，讲解阶段照它核对答案
      const paperKeyParts = [];
      // 分组导语延迟挂载：@@GROUP_INTRO@@ 先于该组第一题到达，等下一道题解析出归属再挂
      let pendingGroupIntro = "";
      // 最近一次提交的题与所在组：模型偶尔把 @@END_Q@@ 提前写在一题字段中间（实测），
      // 落在其后的 ANSWER/迁移块只可能属于刚提交的那道题，靠它重开并入而不是丢弃
      let lastCommittedQ = null;
      let lastCommittedGroup = null;
      // @@Q@@ 独占一行、题号落在下一行时的等待标记（见下方逐行解析）
      let pendingQNo = false;
      // 题干开头剥卷面题号：课件自动拼「第 N 题」，题干里再带一遍号学生就会看到两遍。
      // 只剥与本题号一致的数字（(24) / 24. / 24、），其余原样保留
      const stripOwnLeadingNo = (stem, no) => {
        if (!stem || !no) return stem;
        const noDigits = String(no).replace(/\D/g, "");
        if (!noDigits) return stem;
        const m = stem.match(/^\s*(?:[（(]\s*0*(\d{1,3})\s*[)）]|0*(\d{1,3})\s*[\.、．])\s*/);
        if (!m) return stem;
        const lead = (m[1] || m[2] || "").replace(/^0+/, "");
        if (lead !== noDigits.replace(/^0+/, "")) return stem;
        return stem.slice(m[0].length);
      };
      // 两阶段合并：阶段一对每个题号提交过一道结构完整的题；阶段二的 @@Q@@ 同号重开时，
      // 从已提交对象重播种解析草稿（字段键与首次解析一致），讲解字段直接并回原题
      const findCommittedQuestion = (no) => {
        for (const g of groups) for (const q of (g.questions || [])) {
          if (String(q.no || "").trim() === no) return [g, q];
        }
        return [null, null];
      };
      const draftFromCommitted = (qObj) => {
        const ref = qObj.reference || {};
        const pattern = qObj.pattern || {};
        const draft = {
          no: qObj.no || "",
          qtype: qObj.qtype || "",
          stem: qObj.stem || "",
          passage: qObj.passage || "",
          _passage_ref: qObj.passageRef || "",
          _raw_options: qObj.options || [],
          _answer_raw: qObj.answer || "",
          _evidence_raw: ref.evidence || "",
          _reason_raw: ref.reason || "",
          _distractor_raw: ref.distractor || "",
          _pitfalls_raw: qObj.pitfalls || [],
          _pattern_name_raw: pattern.name || "",
          _pattern_steps_raw: pattern.steps || [],
          // 重开时旧迁移块只作保底（_transfers_carry）：本轮重写的新块与它按字段合并
          // （新块缺的字段取旧块），一块新块都没有才整块沿用旧块。旧块若混进
          // _transfers_raw，提交时新旧叠加会翻倍
          _transfers_carry: (qObj.transfers || []).filter((t) => t && typeof t === "object").map((t) => ({...t})),
          _transfers_raw: [],
        };
        if (qObj.writingGuide != null) {
          draft._writing_points_raw = (qObj.writingGuide.points || []).slice();
          draft._writing_outline_raw = qObj.writingGuide.outline || "";
          draft._writing_sample_raw = qObj.writingGuide.sample || "";
        }
        return draft;
      };
      // 迁移块可整块重复（每题 N 道），块以 TRANSFER_PASSAGE 开头：
      // 本块已有内容且该字段写过（或这正是开头标签）→ 上一块结束，先收进列表再开新草稿；
      // 这样模型省略 passage 直接开下一块时也能正确切分
      const beginTransferField = (key) => {
        let d = currentQ._transfer_draft;
        if (d && Object.values(d).some(Boolean) && (d[key] !== undefined || key === "passage")) {
          (currentQ._transfers_raw = currentQ._transfers_raw || []).push(d);
          d = null;
        }
        if (!d) { d = {}; currentQ._transfer_draft = d; }
        return d;
      };
      const flushField = () => {
        if (currentField === null) { fieldBuf = []; return; }
        const content = fieldBuf.join("\n").trim();
        fieldBuf = [];
        const cf = currentField;
        currentField = null;
        if (cf === "PASSAGE_DEF") {
          // 同行的是编号，正文从下一行起：同号重复声明保留首个非空正文（正文只应出现一次）
          const key = vpNormPassageRef(pendingDefRef);
          if (key && content && !passageDefs[key]) passageDefs[key] = {ref: pendingDefRef.trim(), text: content};
          pendingDefRef = "";
          return;
        }
        if (cf === "KEY") {
          // 试卷所附答案区：全局字段，与当前题无关，不能被 currentQ 空挡丢掉
          paperKeyParts.push(content);
          return;
        }
        if (currentQ === null) return;
        // 迁移块里的标签漂移：模型会把迁移题的选项/答案写成主题的 @@OPTIONS@@/@@ANSWER@@
        // （实测两类模型都漂），照原路由会把原题的选项、答案、证据逐块覆盖掉，迁移块自己
        // 的 options 却永远空着。草稿已开且有内容时，这些主题标签一律改道进当前草稿
        const draft = currentQ._transfer_draft;
        const inTransfer = !!(draft && Object.values(draft).some(Boolean));
        if (cf === "PASSAGE") {
          // 旧内联格式（历史记录）：正文写在本题里。空值或「同上」等占位沿用同组上一题的正文，
          // 但标记为「继承」——收尾解析时若本题另有 @@PASSAGE_REF@@ 编号，以编号引用为准
          let finalPassage = content;
          const stripped = content.trim();
          let isPlaceholder = false;
          if (!stripped) isPlaceholder = true;
          else if (/^\s*[<＜]?\s*(同上|见上|略|—+|同\s*A\s*篇).*?[>＞]?\s*$/.test(stripped)) isPlaceholder = true;
          else if (stripped.includes("同上") && stripped.length < 30) isPlaceholder = true;
          if (isPlaceholder && currentGroup && currentGroup.questions && currentGroup.questions.length) {
            const prev = currentGroup.questions[currentGroup.questions.length - 1].passage;
            if (prev) { finalPassage = prev; currentQ._passage_inherited = true; }
          }
          currentQ.passage = finalPassage;
        }
        // 迁移块里也可能出现 @@STEM@@（模型把原题结构搬过来）：那时它属于迁移题，
        // 不能覆盖原题题干。其余字段都有这道守卫，唯独 STEM 漏了（后端同罪，已同步修）。
        else if (cf === "STEM") {
          if (inTransfer) { beginTransferField("stem"); draft.stem = stripOwnLeadingNo(content, currentQ.no); }
          else currentQ.stem = stripOwnLeadingNo(content, currentQ.no);
        }
        else if (cf === "OPTIONS") {
          const opts = [];
          for (const l of content.split("\n")) {
            const line = l.trim();
            if (!line) continue;
            const m = line.match(/^([A-Ga-g])\s*[\.、:：\)）]?\s*(.*)$/);
            if (m) opts.push({label: m[1].toUpperCase(), text: m[2].trim()});
            else opts.push({label: "", text: line});
          }
          if (inTransfer) draft.options = opts;
          else currentQ._raw_options = opts;
        } else if (cf === "ANSWER") {
          if (inTransfer) draft.answer = content.trim();
          else currentQ._answer_raw = content.trim();
        } else if (cf === "EVIDENCE") {
          if (!inTransfer) currentQ._evidence_raw = content.trim();
        } else if (cf === "REASON") {
          if (!inTransfer) currentQ._reason_raw = content.trim();
        } else if (cf === "DISTRACTOR") {
          if (!inTransfer) currentQ._distractor_raw = content.trim();
        } else if (cf === "PITFALLS") {
          if (inTransfer) return;
          const pits = [];
          for (const l of content.split("\n")) {
            let line = l.trim();
            if (!line) continue;
            line = line.replace(/^[\d\.\、\)\）\s]+/, "");
            if (line.includes("::")) {
              const idx = line.indexOf("::");
              pits.push({title: line.slice(0, idx).trim(), desc: line.slice(idx+2).trim()});
            } else if (line.includes("：") || line.includes(":")) {
              const parts = line.split(/[：:]/);
              if (parts.length >= 2) pits.push({title: parts[0].trim(), desc: parts.slice(1).join(":").trim()});
              else pits.push({title: line, desc: ""});
            } else pits.push({title: line, desc: ""});
          }
          // 编辑保存的多行说明使用带标记的 JSON 字符串，避免段落被当成新易错点。
          // 旧版普通说明保持原样；损坏的编码也保留原文供用户修改。
          for (const pit of pits) {
            if (!pit.desc.startsWith("@json:")) continue;
            try {
              const desc = JSON.parse(pit.desc.slice(6));
              if (typeof desc === "string") pit.desc = desc;
            } catch {}
          }
          currentQ._pitfalls_raw = pits;
        } else if (cf === "PATTERN_NAME") {
          if (!inTransfer) currentQ._pattern_name_raw = content.trim();
        } else if (cf === "PATTERN_STEPS") {
          if (inTransfer) return;
          const steps = content.split("\n").map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/^[\d\.\、\)\）\s]+/, ""));
          currentQ._pattern_steps_raw = steps;
        } else if (cf === "TRANSFER_PASSAGE") beginTransferField("passage").passage = content;
        else if (cf === "TRANSFER_STEM") beginTransferField("stem").stem = content.trim();
        else if (cf === "TRANSFER_OPTIONS") {
          const opts = [];
          for (const l of content.split("\n")) {
            const line = l.trim();
            if (!line) continue;
            const m = line.match(/^([A-Ga-g])\s*[\.、:：\)）]?\s*(.*)$/);
            if (m) opts.push({label: m[1].toUpperCase(), text: m[2].trim()});
            else opts.push({label: "", text: line});
          }
          beginTransferField("options").options = opts;
        } else if (cf === "TRANSFER_ANSWER") beginTransferField("answer").answer = content.trim();
        else if (cf === "TRANSFER_EXPL") beginTransferField("explanation").explanation = content.trim();
        else if (cf === "WRITING_POINTS") {
          let points = content.split("\n").map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/^[\d\.\、\)\）\s]+/, ""));
          currentQ._writing_points_raw = points;
        } else if (cf === "WRITING_OUTLINE") currentQ._writing_outline_raw = content.trim();
        else if (cf === "WRITING_SAMPLE") currentQ._writing_sample_raw = content;
      };
      const commitQuestion = () => {
        if (currentQ === null || currentGroup === null) return;
        if (currentField !== null && fieldBuf.length) flushField();
        const no = currentQ.no || "?";
        const options = currentQ._raw_options || [];
        const pitfalls = currentQ._pitfalls_raw || [];
        const patternName = currentQ._pattern_name_raw || "";
        const patternSteps = currentQ._pattern_steps_raw || [];
        const reference = {evidence: currentQ._evidence_raw || "", reason: currentQ._reason_raw || "", distractor: currentQ._distractor_raw || ""};
        const pattern = {name: patternName, steps: patternSteps};
        let qtype = (currentQ.qtype || "").trim().toLowerCase();
        if (qtype !== "choice" && qtype !== "blank" && qtype !== "writing") {
          if (currentGroup.id === "writing_app" || currentGroup.id === "writing_cont") qtype = "writing";
          else if (options.length) qtype = "choice";
          else qtype = "blank";
        }
        const isWriting = qtype === "writing" || currentGroup.id === "writing_app" || currentGroup.id === "writing_cont";
        if (isWriting) qtype = "writing";
        let transfers = [];
        let writingGuide = null;
        if (isWriting) {
          writingGuide = {points: currentQ._writing_points_raw || [], outline: currentQ._writing_outline_raw || "", sample: currentQ._writing_sample_raw || ""};
          if (!writingGuide.points.length && !writingGuide.outline && !writingGuide.sample) writingGuide = {points:[], outline:"", sample:""};
        } else {
          // 本轮新收的迁移块 + 最后一块草稿：有 passage/stem/选项/答案才算有效迁移
          const drafts = (currentQ._transfers_raw || []).slice();
          if (currentQ._transfer_draft) drafts.push(currentQ._transfer_draft);
          const fresh = drafts
            .filter((d) => d && (d.passage || d.stem || (d.options && d.options.length) || d.answer))
            .map((d) => ({
              passage: d.passage || "",
              stem: d.stem || "",
              options: d.options || [],
              answer: d.answer || "",
              explanation: d.explanation || "",
            }));
          // 同号重开只在迁移题材料未变时补缺字段。材料改写后不得沿用旧题的
          // 答案和解析，否则会把不同版本拼成伪完整题。没有重写迁移则保留旧块。
          const carry = currentQ._transfers_carry;
          if (fresh.length && carry && carry.length) {
            const merged = fresh.map((nb, i) => {
              const ob = (i < carry.length && carry[i] && typeof carry[i] === "object") ? carry[i] : {};
              const changed = (nb.passage && nb.passage !== ob.passage)
                || (nb.stem && nb.stem !== ob.stem)
                || (nb.options.length && JSON.stringify(nb.options) !== JSON.stringify(ob.options || []));
              if (changed) return nb;
              return {
                passage: nb.passage || ob.passage || "",
                stem: nb.stem || ob.stem || "",
                options: nb.options.length ? nb.options : (ob.options || []),
                answer: nb.answer || ob.answer || "",
                explanation: nb.explanation || (nb.answer && nb.answer !== ob.answer ? "" : ob.explanation) || "",
              };
            });
            // 重写只涉及前几块时，后面没被重开的旧块按原样接着排
            transfers = merged.concat(carry.slice(fresh.length).filter((t) => t && typeof t === "object").map((t) => ({...t})));
          } else if (fresh.length) transfers = fresh;
          else transfers = (carry || []).filter((t) => t && typeof t === "object").map((t) => ({...t}));
        }
        const qObj = {
          no: String(no).trim(),
          qtype: qtype,
          passage: currentQ.passage || "",
          passageRef: (currentQ._passage_ref || "").trim(),
          // 旧内联格式下「空值/占位符沿用上一题」只算继承，收尾解析时若有编号引用以引用为准
          _passageInherited: !!currentQ._passage_inherited,
          stem: currentQ.stem || "",
          options: options,
          answer: currentQ._answer_raw || null,
          reference: reference,
          pitfalls: pitfalls,
          pattern: pattern.name || pattern.steps.length ? pattern : {name:"", steps:[]},
          transfers: transfers,
          writingGuide: writingGuide,
        };
        if (isWriting && !qObj.answer) qObj.answer = null;
        if (qObj.answer === "") qObj.answer = isWriting ? null : "";
        const committedRef = currentQ._committed || null;
        delete currentQ._committed;
        if (committedRef) {
          // 同号重开：原地更新已提交的题对象（保持它在分组数组里的位置与身份）
          for (const k of Object.keys(committedRef)) delete committedRef[k];
          Object.assign(committedRef, qObj);
        } else {
          currentGroup.questions.push(qObj);
        }
        currentQ = null;
        return {q: committedRef || qObj, g: currentGroup};
      };
      // 当前是否在往字段里收正文：@@PASSAGE_DEF@@ 可以出现在第一道题之前（此时还没有 currentQ）
      // 当前是否在往字段里收正文：@@PASSAGE_DEF@@ 可以出现在第一道题之前、@@KEY@@ 通常落在全部题
      // 之后（此时都没有 currentQ），两者都放行
      const collecting = () => currentField !== null && (currentQ !== null || currentField === "PASSAGE_DEF" || currentField === "KEY");
      // 逐行解析；一行内出现多个标签时逐段切分，前段文本归入当前字段
      for (let rawLine of lines) {
        let work = rawLine.replace(/\r$/, "");
        // 模型偶尔把题号写到 @@Q@@ 的下一行：这一行若是独立的 1-3 位数字就当题号收下，
        // 空行不算（跳过继续等），不是数字则放弃等待、交回正常流程
        if (pendingQNo && work.trim()) {
          pendingQNo = false;
          const bare = work.trim();
          if (/^\d{1,3}$/.test(bare) && currentQ) {
            const [committedGroup, committedHit] = findCommittedQuestion(bare);
            // 占位题（"?"、尚无任何内容）撞上同号已提交题 → 转为重开合并；否则照旧补号
            if (committedHit && currentQ.no === "?" && Object.keys(currentQ).length === 1) {
              currentQ = draftFromCommitted(committedHit);
              currentQ._committed = committedHit;
              if (committedGroup) currentGroup = committedGroup;
              if (pendingGroupIntro) {
                currentGroup.intro = pendingGroupIntro;
                pendingGroupIntro = "";
              }
            } else {
              currentQ.no = bare;
            }
            continue;
          }
        }
        while (true) {
          const fm = work.match(VP_TAG_FIND_RE);
          if (!fm) {
            if (collecting()) fieldBuf.push(work);
            break;
          }
          if (fm.index > 0) {
            const prefix = work.slice(0, fm.index);
            if (collecting() && prefix) fieldBuf.push(prefix);
            work = work.slice(fm.index);
          }
          const m = work.match(VP_TAG_LINE_RE);
          if (!m) {
            // 理论不可达（find 与 line 同一定界符规则），防御性兜底
            if (collecting()) fieldBuf.push(work);
            break;
          }
          const tag = m[1].toUpperCase();
          // 任何新标签都意味着「下一行是裸题号」的窗口已经过去
          if (tag !== "Q") pendingQNo = false;
          // 同行值只取到下一个标签标记为止，行内剩余标签留给下一轮
          let value = m[3];
          const vm = value.match(VP_TAG_FIND_RE);
          let rest = "";
          if (vm) { rest = value.slice(vm.index); value = value.slice(0, vm.index); }
          value = value.trim();
          if (/^[＠@]{2,}$/.test(m[2]) && value.startsWith("=")) value = value.slice(1).trim();
          if (currentField !== null) flushField();
          if (tag === "TOTAL") {
            const num = value.match(/\d+/);
            if (num) totalDeclared = parseInt(num[0], 10);
          } else if (tag === "PAPER") {
            // 续写时模型偶尔会重发总览行：空值不覆盖已有内容，免得把前面写好的标题/提示抹掉
            if (value) paperTitle = value;
          } else if (tag === "NOTICE") {
            if (value) notice = value;
          } else if (tag === "GROUP") {
            if (currentQ !== null) { currentQ = null; currentField=null; fieldBuf=[]; }
            const parts = value.split("|").map(p=>p.trim());
            let gid = parts[0] ? parts[0].trim() : "other";
            let title, intro;
            if (!ALLOWED.has(gid)) {
              if (parts.length === 2) { title = parts[0]; intro = parts[1]; gid = "other"; }
              else { title = parts[1] || gid; intro = parts[2] || ""; gid = "other"; }
            } else {
              title = parts[1] || gid;
              intro = parts[2] || "";
            }
            // 同 id 且标题（去内部空白归一化）相同的既有分组 = 同一板块被重复声明
            // （续写/重讲解时模型又把 @@GROUP@@ 头写了一遍，字面常与骨架略有出入：
            // 空格、导语有无）。全局查重复用而不是新建——重开的题都会并回原组，
            // 新建组只会沦为挂在文档底部的 0 题空组。标题不同的同 id 分组仍视作
            // 合法拆分（完形可按叙事分 2-3 组）照旧新建；骨架端对相邻同 id 同标题
            // 的组已加序号消歧，骨架内 id+标题对唯一，此规则不会误并合法分组。
            const normTitle = (s) => String(s || "").replace(/\s+/g, "");
            const seen = groups.find((g) => g.id === gid && normTitle(g.title) === normTitle(title));
            if (seen) {
              currentGroup = seen;
              // 重声明带来的导语只在原组还没有导语时补上，不覆盖第一轮写好的
              if (!currentGroup.intro && intro) currentGroup.intro = intro;
            } else {
              currentGroup = {id: gid, title: title, intro: intro, questions: []};
              groups.push(currentGroup);
            }
          } else if (tag === "Q") {
            if (currentQ !== null) { currentQ = null; currentField=null; fieldBuf=[]; }
            // 题号没写在同行时留待下一行；再等不到就标成 "?"（未知）。
            // 不用 "1" 兜底：多道题都叫 "1" 会让答案速查表互相覆盖，
            // 静默给出错数据，比一个看得见的占位符糟得多
            const inlineNo = value.trim();
            const [committedGroup, committedHit] = inlineNo ? findCommittedQuestion(inlineNo) : [null, null];
            if (committedHit) {
              // 两阶段：阶段二对同一题号重开——讲解字段并回已提交的题，不再新建
              //（否则同一题在结构里出现两遍）
              currentQ = draftFromCommitted(committedHit);
              currentQ._committed = committedHit;
              // 当前分组跟随本题所属分组：qtype 推断、后续新建题归属都以它为准
              currentGroup = committedGroup;
              pendingQNo = false;
            } else {
              currentQ = {no: inlineNo || "?"};
              pendingQNo = !inlineNo;
            }
            if (currentGroup === null) {
              // 没有板块头的题接到最后一个已有分组上：续写已明确要求「同板块不要重发 @@GROUP@@」，
              // 这些题本就属于上一板块；全新生成时 groups 为空，仍然落到「未分组」。
              if (groups.length) {
                currentGroup = groups[groups.length - 1];
                if (!Array.isArray(currentGroup.questions)) currentGroup.questions = [];
              } else {
                currentGroup = {id:"other", title:"未分组", intro:"", questions:[]};
                groups.push(currentGroup);
              }
            }
            if (pendingGroupIntro) {
              // @@GROUP_INTRO@@ 先于该组第一题到达，此刻才解析出归属；
              // 已有导语不覆盖——续写轮次重发的导语让位给第一轮写好的
              if (!currentGroup.intro) currentGroup.intro = pendingGroupIntro;
              pendingGroupIntro = "";
            }
          } else if (tag === "GROUP_INTRO") {
            // 两阶段：阶段二为本组补写的一句话导语。讲解流开始时 currentGroup 还停在
            // 骨架最后一个分组上，直接挂会挂错——挂到「下一道题」所属的分组
            if (value) pendingGroupIntro = value;
          } else if (tag === "QTYPE") {
            if (currentQ !== null) {
              const v = value.trim().toLowerCase();
              currentQ.qtype = (v === "choice" || v === "blank" || v === "writing") ? v : v;
            }
          } else if (tag === "PASSAGE_REF") {
            // 单行值标签：本题所属语篇的编号（写作题写 -）
            if (currentQ !== null) currentQ._passage_ref = value.trim();
          } else if (tag === "PASSAGE_DEF") {
            // 值在同行（编号）、正文从下一行起：编号单独存，正文按多行字段收集
            currentField = tag;
            fieldBuf = [];
            pendingDefRef = value;
          } else if (tag === "END_Q") {
            const committedNow = commitQuestion();
            if (committedNow) { lastCommittedQ = committedNow.q; lastCommittedGroup = committedNow.g; }
            currentField = null;
            fieldBuf = [];
          } else if (currentQ === null && lastCommittedQ && tag !== "PASSAGE_DEF" && tag !== "KEY") {
            // 模型偶尔把 @@END_Q@@ 提前写在一题字段中间（实测 STEM/OPTIONS 先提交、
            // ANSWER/迁移块全落在 END_Q 之后）：这些字段只可能属于刚提交的那道题，
            // 重开并入而不是静默丢弃；PASSAGE_DEF/KEY 是全局字段，无主时照旧直收
            currentQ = draftFromCommitted(lastCommittedQ);
            currentQ._committed = lastCommittedQ;
            currentGroup = lastCommittedGroup;
            currentField = tag;
            fieldBuf = [];
            if (value) fieldBuf.push(value);
          } else {
            // 白名单剩余均为多行内容标签；同行有值则作为首行内容
            currentField = tag;
            fieldBuf = [];
            if (value) fieldBuf.push(value);
          }
          work = rest;
        }
      }
      // 收尾：最后一个字段也要落地（截断、或 @@PASSAGE_DEF@@ 落在文末时没有下一个标签来触发 flush）。
      // 未遇 @@END_Q@@ 的题仍不提交，写进 currentQ 的内容随对象一起丢弃
      if (currentField !== null) flushField();
      if (!groups.length && totalDeclared === null && !paperTitle && !notice) return null;
      // 语篇引用解析（第二趟）：定义已全部收齐，这里把 @@PASSAGE_REF@@ 的编号换成对应全文。
      // 内联全文优先；只是「继承」来的正文让位给编号引用；编号查不到定义时标记未解析
      // （截断/漏声明），绝不静默顶上一篇别的语篇——宁可让左栏提示，也不能给学生看错文
      for (const g of groups) for (const q of g.questions) {
        const inherited = !!q._passageInherited;
        delete q._passageInherited;
        const rawRef = String(q.passageRef || "").trim();
        const key = vpNormPassageRef(rawRef);
        const declaredNone = VP_NO_PASSAGE_REFS.has(key) || VP_NO_PASSAGE_REFS.has(rawRef.toUpperCase());
        const def = key ? passageDefs[key] : null;
        if (def) {
          if (!q.passage || inherited) q.passage = def.text;
          q.passageRef = def.ref || key;
        } else if (key && !declaredNone) {
          q.passageUnresolved = true;
          q.passageRef = rawRef;
        } else {
          q.passageRef = "";
        }
      }
      const answerMap = {};
      for (const g of groups) for (const q of g.questions) {
        if (q.answer) answerMap[String(q.no)] = String(q.answer);
        else if (q.writingGuide) answerMap[String(q.no)] = "见范文";
      }
      return {paper:{title:paperTitle, subject:"英语", year:""}, notice: notice, answerMap: answerMap, groups: groups, total: totalDeclared, paperKey: paperKeyParts.join("\n").trim()};
    },
    tryParseVisualPaper(raw) {
      if (!raw || !raw.trim()) return { data: null, error: "empty" };
      // 优先自定义分隔格式（B方案）
      if (VP_HAS_TAG_RE.test(raw)) {
        const custom = this.parseCustomVisualPaper(raw);
        if (custom && Array.isArray(custom.groups)) {
          // 即使 groups 为空但 total 为 0 也是合法（例外）
          return { data: custom, error: "" };
        }
        // 若含标签但解析为空，仍尝试 JSON 回退（旧历史）
      }
      // 回退 JSON（兼容旧历史）
      let text = raw.trim();
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      let candidates = [];
      if (fenced && fenced[1]) candidates.push(fenced[1].trim());
      candidates.push(text);
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(text.slice(firstBrace, lastBrace + 1));
      }
      for (const cand of candidates) {
        if (!cand) continue;
        try {
          const data = JSON.parse(cand);
          if (data && typeof data === "object" && Array.isArray(data.groups)) return { data, error: "" };
        } catch {}
        for (let i = 0; i < cand.length; i++) {
          if (cand[i] !== "{") continue;
          try {
            const val = JSON.parse(cand.slice(i));
            if (val && typeof val === "object" && Array.isArray(val.groups)) return { data: val, error: "" };
          } catch {}
        }
      }
      return { data: null, error: "no valid custom or JSON found" };
    },
    /* 写作指导是否有实质内容：空对象不算（骨架期总会带一个空壳） */
    _vpHasWritingGuide(wg) {
      if (wg == null || wg === "") return false;
      if (typeof wg !== "object") return true;
      return !!((wg.points && wg.points.length) || wg.outline || wg.sample);
    },
    normalizeVisualPaper(data) {
      if (!data || typeof data !== "object") return null;
      // 入参恒为本轮新建的解析结果（自定义解析 / JSON.parse 产物），从未被共享；
      // 原来的 JSON 深克隆每个渲染 tick 都要整树复制一次，纯属冗余，直接就地规范
      const out = data;
      if (!out.paper || typeof out.paper !== "object") out.paper = { title: "", subject: "英语", year: "" };
      out.paper.title = out.paper.title || "";
      out.paper.subject = out.paper.subject || "英语";
      out.paper.year = out.paper.year || "";
      out.notice = vpScrubFieldText(out.notice || "");
      out.answerMap = out.answerMap || {};
      out.groups = Array.isArray(out.groups) ? out.groups : [];
      out.total = out.total != null ? out.total : null;
      // 记住总数是不是原文明写的：没有 @@TOTAL@@ 的卷子把 total 洗成题数后，
      // vpComplete 的「声明 > 0」会变成恒真式，讲解一齐就伪造成已完成。
      out.totalDeclared = out.total != null;
      if (out.total == null) {
        const cnt = out.groups.reduce((s,g)=>s + (g.questions||[]).length, 0);
        out.total = cnt || null;
      }
      if (!out.answerMap || !Object.keys(out.answerMap).length) {
        const am = {};
        for (const g of out.groups) for (const q of g.questions) {
          const key = String(q.no);
          // 同号（跨组重号或 "?"）时保留先到的答案：后写覆盖会让学生查到一个
          // 被别的题顶掉的答案，而两个答案都对不上眼前的题
          if (key in am) continue;
          if (q.answer) am[key] = String(q.answer);
          // 空指导不配「见范文」：写作题总会带一个 writingGuide 对象，刚过阶段一的
          // 骨架期它是空的，速查表显示「2: 见范文」但翻过去什么都没有
          else if (this._vpHasWritingGuide(q.writingGuide)) am[key] = "见范文";
        }
        out.answerMap = am;
      }
      for (const g of out.groups) {
        g.intro = vpScrubFieldText(String(g.intro || ""));
        // 坏快照可能漏 questions 数组：这里补上空数组，
        // 否则下面的 for...of 与模板里的 g.questions.length 都会抛 TypeError
        if (!Array.isArray(g.questions)) g.questions = [];
        for (const q of g.questions) {
          if (q.qtype !== "choice" && q.qtype !== "blank" && q.qtype !== "writing") {
            if (g.id === "writing_app" || g.id === "writing_cont") q.qtype = "writing";
            else if (Array.isArray(q.options) && q.options.length) q.qtype = "choice";
            else q.qtype = "blank";
          }
          const gid = g.id;
          if (gid === "writing_app" || gid === "writing_cont") {
            q.transfers = [];
            if (!q.writingGuide) q.writingGuide = {points:[], outline:"", sample:""};
          } else {
            // 旧结构（单数 transfer 对象）就地升级为数组，避免两套字段并存
            if (!Array.isArray(q.transfers)) q.transfers = q.transfer ? [q.transfer] : [];
            q.transfers = q.transfers.filter((t) => t && typeof t === "object");
            if (q.writingGuide === undefined) q.writingGuide = null;
          }
          delete q.transfer;
          // 结构快照会用于续写、编辑与导出，不能在展示归一化时静默截断原文或讲解。
          if (q.pattern && Array.isArray(q.pattern.steps)) q.pattern.steps = q.pattern.steps.map(String);
          for (const tr of (q.transfers || [])) {
            // 每道迁移题各自补全字段，保留完整材料。
            tr.passage = typeof tr.passage === "string" ? tr.passage : "";
            tr.stem = typeof tr.stem === "string" ? tr.stem : "";
            tr.answer = typeof tr.answer === "string" ? tr.answer : "";
            tr.explanation = typeof tr.explanation === "string" ? tr.explanation : "";
            if (!Array.isArray(tr.options)) tr.options = [];
          }
          // 讲解类字段兜底清洗约定符号（范围与理由见 vpScrubFieldText）：
          // 易错点描述与全部照录类字段保持原样
          if (q.reference && typeof q.reference === "object") {
            q.reference.evidence = vpScrubFieldText(q.reference.evidence);
            q.reference.reason = vpScrubFieldText(q.reference.reason);
            q.reference.distractor = vpScrubFieldText(q.reference.distractor);
          }
          if (q.pattern && typeof q.pattern === "object") {
            q.pattern.name = vpScrubFieldText(q.pattern.name);
            if (Array.isArray(q.pattern.steps)) q.pattern.steps = q.pattern.steps.map((s) => vpScrubFieldText(s));
          }
          for (const tr of (q.transfers || [])) tr.explanation = vpScrubFieldText(tr.explanation);
          if (q.writingGuide && typeof q.writingGuide === "object") {
            if (Array.isArray(q.writingGuide.points)) q.writingGuide.points = q.writingGuide.points.map((s) => vpScrubFieldText(s));
            q.writingGuide.outline = vpScrubFieldText(q.writingGuide.outline);
          }
        }
      }
      return out;
    },
    get vpGroups() {
      return (this.visualPaper && this.visualPaper.groups) || [];
    },
    get vpCurrentGroup() {
      if (!this.visualPaper || !this.visualPaper.groups.length) return null;
      const idx = Math.max(0, Math.min(this.visualPaper.currentGroupIdx, this.visualPaper.groups.length - 1));
      return this.visualPaper.groups[idx] || null;
    },
    get vpCurrentQuestion() {
      const g = this.vpCurrentGroup;
      if (!g || !Array.isArray(g.questions) || !g.questions.length) return null;
      const qIdx = Math.max(0, Math.min(this.visualPaper.currentQIdx, g.questions.length - 1));
      return g.questions[qIdx] || null;
    },
    get vpQuestionCount() {
      if (!this.visualPaper) return 0;
      let c = 0;
      for (const g of this.visualPaper.groups) c += (g.questions || []).length;
      return c;
    },
    get vpCurrentGlobalIndex() {
      if (!this.visualPaper) return 0;
      let idx = 0;
      // 组索引可能来自旧快照（组数已变少），越界时按钳制值算，别裸遍历抛 TypeError
      const upto = Math.min(Math.max(this.visualPaper.currentGroupIdx, 0), this.visualPaper.groups.length);
      for (let i = 0; i < upto; i++) {
        idx += (this.visualPaper.groups[i].questions || []).length;
      }
      idx += this.visualPaper.currentQIdx + 1;
      return idx;
    },
    get vpHasData() {
      return !!this.visualPaper && this.visualPaper.groups.length > 0 && this.vpQuestionCount > 0;
    },
    get vpTotal() {
      if (!this.visualPaper) return 0;
      const count = this.vpQuestionCount;
      // 声明的总数可能只是数字前缀（@@TOTAL@@ 26 被截断成 "2"），已生成题数反超它时以实际为准，
      // 否则续写指令会把「剩余 N 题」说少，模型就照着少生成
      if (this.visualPaper.total != null && this.visualPaper.total > 0) {
        return Math.max(this.visualPaper.total, count);
      }
      return count;
    },
    get vpProgressPercent() {
      if (!this.vpTotal) return 0;
      return Math.min(100, Math.round((this.vpQuestionCount / this.vpTotal) * 100));
    },
    /* 完成计数、题目状态与续写工单共用内容完整性判定，答案落笔不等于全解完成。 */
    vpQuestionMissing(q, groupId) {
      if (!q) return ["未返回完整讲解"];
      const text = v => typeof v === "string" && !!v.trim();
      const list = v => Array.isArray(v) && v.length > 0 && v.every(text);
      if (this.vpIsWritingQuestion(q, groupId)) {
        const guide = q.writingGuide || {};
        return [["points", "写作要点"], ["outline", "写作框架"], ["sample", "范文"]]
          .filter(([key]) => !(key === "points" ? list(guide[key]) : text(guide[key]))).map(([,label]) => label);
      }
      const missing = [], ref = q.reference || {}, pat = q.pattern || {};
      if (!text(q.answer)) missing.push("参考答案");
      for (const [key, label] of [["evidence", "原文依据"], ["reason", "解题推理"], ["distractor", "干扰项分析"]]) {
        if (!text(ref[key])) missing.push(label);
      }
      if (!q.pitfalls?.length || !q.pitfalls.every(p => p && text(p.title) && text(p.desc))) missing.push("易错点");
      if (!text(pat.name) || !list(pat.steps)) missing.push("考点范式");
      const choice = q.qtype === "choice" || (q.options || []).length > 0;
      // x-for 在重解析后可能暂时持有旧题目对象，导航应直接传入所属分组，
      // 避免引用查找失败把语篇内设问误判为缺少迁移题干。
      const ownerId = groupId ?? this.vpGroups.find(g => (g.questions || []).includes(q))?.id;
      const embedded = ["cloze7", "cloze", "grammar"].includes(ownerId);
      const transfers = Array.isArray(q.transfers) ? q.transfers : [];
      if (transfers.length < this.vpLockedTransferCount) missing.push("迁移题数量（" + transfers.length + "/" + this.vpLockedTransferCount + "）");
      transfers.forEach((tr, i) => {
        const t = tr || {}, prefix = "迁移 " + (i + 1) + "：";
        if (!text(t.stem) && !embedded && (choice || !text(t.passage))) missing.push(prefix + "题干");
        if ((choice || (embedded && !text(t.stem))) && !text(t.passage)) missing.push(prefix + "语篇");
        if (!text(t.answer)) missing.push(prefix + "答案");
        if (!text(t.explanation)) missing.push(prefix + "解析");
        if (choice) {
          const options = Array.isArray(t.options) ? t.options : [], expected = (q.options || []).length || 2;
          if (options.length < expected || !options.every(o => o && text(o.label) && text(o.text))) missing.push(prefix + "选项不足（" + options.length + "/" + expected + "）");
        }
      });
      return missing;
    },
    vpQuestionAnalyzed(q, groupId) {
      return this.vpQuestionMissing(q, groupId).length === 0;
    },
    get vpMissingQuestions() {
      // 带上 gIdx/qIdx：题号可能重复（跨组同号）或为 "?"，按题号查找会永远落到第一道
      const out = [];
      this.vpGroups.forEach((g, gIdx) => {
        (g.questions || []).forEach((q, qIdx) => {
          const reasons = this.vpQuestionMissing(q);
          if (reasons.length) out.push({ no: String(q.no), gIdx, qIdx, reasons });
        });
      });
      return out;
    },
    /* 讲解完成数。两阶段下结构（第一轮）很快跑满，这才是第二轮真正在动的数字 */
    get vpAnalyzedCount() {
      if (!this.visualPaper) return 0;
      let c = 0;
      for (const g of this.visualPaper.groups) for (const q of (g.questions || [])) {
        if (this.vpQuestionAnalyzed(q)) c += 1;
      }
      return c;
    },
    get vpExplainPercent() {
      if (!this.vpTotal) return 0;
      return Math.min(100, Math.round((this.vpAnalyzedCount / this.vpTotal) * 100));
    },
    /* 进度行唯一的状态文案：一个阶段只出现一个计数，避免「47/47 题」的结构计数
       和「讲解 8/47」并存让人读不懂——结构进度已经由浅色进度条承担了 */
    get vpProgressText() {
      const total = this.vpTotal || 0;
      if (this.streaming) {
        if (this.vpStage === "framework") return `解析试卷结构 ${this.vpQuestionCount}/${total || "…"} 题`;
        return `${this.vpParallel ? '并行生成讲解' : '撰写讲解'} ${this.vpAnalyzedCount}/${total || "…"} 题`;
      }
      if (this.vpComplete) return "已完成";
      // 「剩余 N 题」已是讲解口径：结构没齐时报结构进度，结构齐了（骨架即满）之后
      // 报讲解进度——再报「已解析 47/47 题，未写完」会让人以为没差题却卡着不动
      if (this.vpRemaining > 0 && this.vpQuestionCount < this.vpTotal) {
        return `已解析 ${this.vpQuestionCount}/${total} 题，未写完`;
      }
      return `讲解完成 ${this.vpExplainPercent}%，未确认写完`;
    },
    /* 两阶段指示器状态计算属性 */
    get vpIsStage1Active() {
      return this.streaming && this.vpStage === "framework";
    },
    get vpIsStage1Done() {
      return !this.vpIsStage1Active && this.vpQuestionCount > 0 && this.vpQuestionCount >= this.vpTotal
        && (!!this.visualPaper.frameworkRaw || this.vpComplete);
    },
    get vpIsStage2Active() {
      return this.streaming && this.vpStage === "explain";
    },
    get vpIsStage2Done() {
      return this.vpComplete;
    },
    get vpStep1StatusText() {
      if (this.vpIsStage1Active) return "正在提取题干/选项/语篇…";
      if (this.vpIsStage1Done) return `已锁定 ${this.vpQuestionCount} 题结构`;
      if (this.streaming && this.vpStage === "explain") return `正在补全结构，已提取 ${this.vpQuestionCount} 题`;
      if (!this.streaming && this.vpQuestionCount > 0) return `已提取 ${this.vpQuestionCount} 题，结构待确认`;
      return "待开始";
    },
    get vpStep2StatusText() {
      if (this.vpIsStage2Done) return `全卷 ${this.vpTotal} 题解析已完成`;
      if (this.vpIsStage2Active && this.vpParallel) {
        // 同一 Job 的各题可能处于不同尝试次数，按题统计且不重复计数。
        const questions = this.vpTasks.flatMap(t => (t.nos || [])
          .filter(n => !(t.completed || []).includes(n)).map(n => this.vpTaskQuestionInfo(t, n)));
        const active = questions.filter(q => q.state === "running" && !(q.attempt > 1)).length;
        const retrying = questions.filter(q => q.state === "retrying"
          || (["running", "pending"].includes(q.state) && q.attempt > 1)).length;
        return `已完成 ${this.vpAnalyzedCount}/${this.vpTotal} 题${active ? ` · 正在生成 ${active} 题` : ''}${retrying ? ` · 自动补全 ${retrying} 题` : ''}`;
      }
      if (this.vpIsStage2Active) return `正在生成第 ${this.vpGeneratingQuestionNo || "…"} 题解析`;
      if (this.vpIsStage1Active) return "等待结构提取后开始";
      if (this.vpAnalyzedCount > 0) return `已完成 ${this.vpAnalyzedCount}/${this.vpTotal} 题解析`;
      return "待结构提取后生成";
    },
    get vpTaskFailures() {
      // cancelled 也要算：stop 中断时未启动/未完成的任务都被兜底成 cancelled，
      // 旧实现只统计 error/incomplete，那种场景下一条提示都不出
      return this.vpTasks.filter(t => t.state === "error" || t.state === "incomplete" || t.state === "cancelled").length;
    },
    vpApplyTask(info) {
      if (!this.vpParallel || !info || !info.id) return;
      const index = this.vpTasks.findIndex(t => t.id === info.id);
      if (index < 0) return;
      this.vpTasks = this.vpTasks.map((t, i) => i === index ? { ...t, fallback: null, ...info } : t);
      if (this.thinking) { this.thinking = false; this.stopThinkTimer(); }
    },
    vpTaskQuestionInfo(task, no) {
      no = String(no);
      if ((task.completed || []).includes(no)) return { state: "done", attempt: 0, fallback: null, retry_reason: "" };
      if (task.question_states?.[no]) return task.question_states[no];
      // 兼容旧服务端的 Job 级事件；未参与当前请求的题仍显示排队。
      const waiting = task.state === "running" && !(task.active_nos || task.nos || []).includes(no);
      const state = waiting ? "pending" : task.state;
      const inFlight = ["running", "retrying"].includes(state);
      return { state, attempt: waiting ? 0 : task.attempt || 0, fallback: inFlight ? task.fallback : null,
        retry_reason: inFlight ? task.retry_reason || "" : "" };
    },
    get vpRecoveryItems() {
      if (!this.streaming) return [];
      const items = [];
      if (this.fallbackInfo && !this.vpParallel) {
        items.push({ id: "stage", text: (this.vpStage === "framework" ? "框架提取：" : "试题解析：") + this.fallbackText, dots: this.fallbackDots });
      }
      for (const task of this.vpTasks) {
        const groups = new Map();
        for (const no of task.nos || []) {
          const info = this.vpTaskQuestionInfo(task, no);
          if (!["running", "retrying", "pending"].includes(info.state)) continue;
          if (!info.fallback && !(info.attempt > 1) && info.state !== "retrying") continue;
          const key = JSON.stringify([info.attempt, info.fallback || null]);
          if (!groups.has(key)) groups.set(key, { nos: [], info });
          groups.get(key).nos.push(no);
        }
        for (const { nos, info } of groups.values()) {
          const label = `第 ${nos.join('、')} 题：`;
          const id = `${task.id}:${nos.join(',')}`;
          if (info.fallback) {
            const fallback = { total: info.fallback.total, failed: info.fallback.failed_index, current: info.fallback.next_index, reason: info.fallback.reason };
            items.push({ id, text: label + this.formatFallbackText(fallback), dots: this.formatFallbackDots(fallback) });
          } else {
            items.push({ id, text: `${label}自动补全中（第 ${info.attempt}/${task.max_attempts || 3} 次尝试），已完成题目保留`, dots: ["active"] });
          }
        }
      }
      return items;
    },
    vpWaitingText(q, label) {
      const state = this.vpQuestionStatus(q);
      if (state === "generating") return `正在生成${label}…`;
      if (state === "pending") return `排队等待生成${label}`;
      return `${label}待补全，可继续生成`;
    },
    vpQuestionRecoveryText(q) {
      const state = this.vpQuestionStatus(q);
      const prefix = state === "failed" ? "本题生成失败，待补："
        : state === "cancelled" ? "本题生成已中断，待补：" : "本题待补：";
      return prefix + this.vpQuestionMissing(q).join('、')
        + (this.streaming ? "。其他题目继续生成" : "。可点击补全讲解");
    },
    /* 准确判断某道题是否是写作题 */
    vpIsWritingQuestion(q, groupId) {
      if (!q) return false;
      if (q.qtype === "writing") return true;
      // 遍历全卷时 q 不一定是当前题；旧记录缺少 qtype 时也只能查它自己的分组。
      const ownerId = groupId ?? this.vpGroups.find(g => (g.questions || []).includes(q))?.id;
      return ownerId === "writing_app" || ownerId === "writing_cont";
    },
    /* 判定某题是否已有讲解内容生成 */
    vpHasAnalysis(q) {
      if (!q) return false;
      if (this.vpIsWritingQuestion(q)) {
        const wg = q.writingGuide;
        return !!(wg && ((wg.points && wg.points.length) || wg.outline || wg.sample));
      }
      const hasAns = !!q.answer;
      const ref = q.reference;
      const hasRef = !!(ref && (ref.evidence || ref.reason || ref.distractor));
      const hasTr = Array.isArray(q.transfers) && q.transfers.length > 0;
      const hasPit = Array.isArray(q.pitfalls) && q.pitfalls.length > 0;
      const hasPat = !!(q.pattern && (q.pattern.name || (q.pattern.steps && q.pattern.steps.length > 0)));
      return hasAns || hasRef || hasTr || hasPit || hasPat;
    },
    /* 获取当前正在撰写讲解的题号（阶段二中第一道尚未完成的题目） */
    get vpGeneratingQuestionNo() {
      if (!this.visualPaper) return null;
      if (this.vpParallel) {
        for (const task of this.vpTasks) {
          const no = (task.nos || []).find(n => this.vpTaskQuestionInfo(task, n).state === "running");
          if (no != null) return no;
        }
        return null;
      }
      for (const g of this.visualPaper.groups) {
        for (const q of (g.questions || [])) {
          if (!this.vpQuestionAnalyzed(q)) return q.no;
        }
      }
      return null;
    },
    /* 题目级状态：'done'（已完成精讲）/ 'generating'（正在实时撰写中）/ 'pending'（排队等待精讲）/ 'idle'（已停止待续写） */
    /* 选项标号比较：剥加粗/高亮标记与标点并大写。答案常写成 "A."/"a"（后端只 strip），
       严格 === 会让屏幕上不高亮、遮罩也失效，而打印件用同一份数据却标了正确项。
       与 vp-print.js / vp-standalone.js 的 sameLabel 同口径。 */
    vpSameLabel(a, b) {
      const strip = (v) => String(v == null ? "" : v).trim().replace(/\*\*|==|[.．。、,，:：]/g, "").toUpperCase();
      const x = strip(a);
      return x !== "" && x === strip(b);
    },
    /* 该题所属并行任务的重试原因（后端随 visual_task 下发，模板里零引用过） */
    vpTaskRetryReason(q) {
      if (!q || !this.vpParallel) return "";
      const task = this.vpTasks.find(t => (t.nos || []).includes(String(q.no)));
      const info = task ? this.vpTaskQuestionInfo(task, q.no) : null;
      return info && ["running", "retrying", "pending"].includes(info.state) ? info.retry_reason || "" : "";
    },
    vpQuestionStatus(q, groupId) {
      if (!q) return "idle";
      if (this.vpQuestionAnalyzed(q, groupId)) return "done";
      if (this.streaming) {
        if (this.vpStage === "framework") return "pending";
        if (this.vpStage === "explain") {
          if (this.vpParallel) {
            const task = this.vpTasks.find(t => t.nos.includes(String(q.no)));
            if (!task) return "idle";
            const state = this.vpTaskQuestionInfo(task, q.no).state;
            if (state === "done") return "done";
            if (state === "running") return "generating";
            if (state === "retrying" || state === "pending") return "pending";
            // error/incomplete/cancelled 不能再一律落 idle：整条流还在跑时，
            // 失败的任务在题库里必须看得见（旧实现把它们显示成「空闲」，
            // 而 incomplete 样式又被 !streaming 门控，等于失败完全不可见）
            if (state === "error") return "failed";
            if (state === "incomplete") return "incomplete";
            if (state === "cancelled") return "cancelled";
            return "idle";
          }
          const genNo = this.vpGeneratingQuestionNo;
          if (genNo && String(q.no) === String(genNo)) return "generating";
          return "pending";
        }
        return "pending";
      }
      return "idle";
    },
    /* 一键根据题号切换题目 */
    /* 按「组索引-题索引」定位：题号重复或为 "?" 时唯一可靠的跳转方式 */
    vpSelectQuestionAt(gIdx, qIdx) {
      if (!this.visualPaper) return;
      const g = this.visualPaper.groups[gIdx];
      if (!g || !(g.questions || []).length) return;
      this.vpSelectQuestion(gIdx, Math.max(0, Math.min(qIdx, g.questions.length - 1)));
    },
    vpSelectQuestionByNo(targetNo) {
      if (!this.visualPaper || targetNo == null) return;
      for (let gIdx = 0; gIdx < this.visualPaper.groups.length; gIdx++) {
        const g = this.visualPaper.groups[gIdx];
        const qIdx = (g.questions || []).findIndex((q) => String(q.no) === String(targetNo));
        if (qIdx !== -1) {
          this.vpSelectQuestion(gIdx, qIdx);
          return;
        }
      }
    },
    /* 还没写完讲解的题数（两阶段口径）：骨架一到位结构题数就满了，拿结构题数算
       「剩余」会恒为 0——续写按钮退化成光杆「继续生成」，简报也跟着谎报进度。
       老路径下已提交的题几乎都带讲解，两套口径数值一致，行为不变。 */
    get vpRemaining() {
      return Math.max(0, (this.vpTotal || 0) - this.vpAnalyzedCount);
    },
    /* 整卷是否已确认写完——「继续生成」入口与「已完成」字样都以此为准。
       四条同时成立才算：声明总题数有效、结构题数不少于它、讲解全部落笔、上一轮是自然收尾。
       两阶段下骨架一到位结构就满了，讲解没写完时若只看结构会把整卷当「已完成」，
       续写入口被整条收起、学生对着「讲解完成 0%」没有恢复动作。
       缺任何一条都按「没写完」处理：没有 @@TOTAL@@ 时 vpTotal 会退化成已生成题数，
       「剩余 0」就只是个恒真式；停止/报错/断流时总数可能是被截断的数字前缀、
       模型也可能自己数错，卡死补全入口比多花一次生成更糟。 */
    get vpComplete() {
      if (this.streaming) return false;
      const vp = this.visualPaper;
      const declared = Number(vp && vp.total);
      // 原文明写了总数：按声明核对（旧行为）
      if (vp && vp.totalDeclared && Number.isFinite(declared) && declared > 0) {
        if (this.vpQuestionCount < declared) return false;
      } else if (vp && vp.totalDeclared === false) {
        // 没有 @@TOTAL@@ 的卷子：total 已被洗成题数，「声明 > 0」只是恒真式。
        // 改看讲解是否齐 + 没有在跑的任务，别再伪造成已完成。
        if (this.vpQuestionCount === 0) return false;
        if (this.vpTasks.some(t => t.state === "running" || t.state === "retrying" || t.state === "pending")) return false;
      } else {
        if (!Number.isFinite(declared) || declared <= 0) return false;
        if (this.vpQuestionCount < declared) return false;
      }
      if (this.vpAnalyzedCount < this.vpTotal) return false;
      // 讲解已全齐：done 与「用户主动停止但内容已写完」都算完成。
      // 只认 done 会让全齐后手停止的卷子永远挂着「待补全」入口，需空跑一轮才知道没得写。
      return this.vpRunState === "done" || this.vpRunState === "stopped";
    },
    /* 失败是否发生在正文已经开始输出之后。判据用 errorMsg + output：只有正文 token 会
       追加进 output，思考内容进的是 reasoning，所以在思考阶段就断掉的失败没有 output，
       仍按「整卷重跑」处理；一旦出过正文，页面保持已解析出的内容、恢复动作收敛成
       「继续生成」，不再挂一张和它重复的错误卡。 */
    get vpFailedMidStream() {
      return !!this.errorMsg && !this.streaming && !!this.output.trim();
    },
    /* 这份卷子对应的历史记录 id：续写/重试都写回这一条。resetVisualPaper 会把它连同
       卷子快照一起清掉，所以调用方必须在 reset 之前取走 */
    get vpHistoryId() {
      return (this.visualPaper && this.visualPaper.historyId) || null;
    },
    // 是否处于第一/最后一题（考虑跨组空组），供全屏角落按钮禁用
    get vpIsFirstQuestion() {
      if (!this.visualPaper) return true;
      const from = Math.min(this.visualPaper.currentGroupIdx, this.visualPaper.groups.length) - 1;
      for (let i = from; i >= 0; i--) {
        if ((this.visualPaper.groups[i].questions || []).length > 0) return false;
      }
      return this.visualPaper.currentQIdx <= 0;
    },
    get vpIsLastQuestion() {
      if (!this.visualPaper) return true;
      for (let i = this.visualPaper.currentGroupIdx + 1; i < this.visualPaper.groups.length; i++) {
        if ((this.visualPaper.groups[i].questions || []).length > 0) return false;
      }
      const g = this.vpCurrentGroup;
      return !g || this.visualPaper.currentQIdx >= (g.questions || []).length - 1;
    },
    // 全屏题目总览：按大题分组的扁平视图（含当前题标记）
    get vpOverviewGroups() {
      if (!this.visualPaper) return [];
      return this.visualPaper.groups.map((g, gIdx) => ({
        gIdx,
        title: g.title,
        intro: g.intro || "",
        questions: (g.questions || []).map((q, qIdx) => ({
          gIdx, qIdx,
          no: q.no,
          answer: q.answer || "",
          missing: this.vpQuestionMissing(q).join('、'),
          current: this.vpIsCurrent(gIdx, qIdx),
        })),
      }));
    },
    // 已识别总题数超出已生成数时，总览里留虚线占位
    get vpPlaceholderCount() {
      const total = this.vpTotal || 0, count = this.vpQuestionCount;
      return total > count ? total - count : 0;
    },
    vpSelectQuestion(gIdx, qIdx) {
      if (!this.visualPaper) return;
      // 回写必须在挪指针之前：q.* 路径是靠当前题解析的，指针一动，
      // 旧题留在 DOM 里的编辑内容就会写进新题的字段
      this.vpEditBeforeLeave();
      this.visualPaper.currentGroupIdx = gIdx;
      this.visualPaper.currentQIdx = qIdx;
      this.vpActiveTab = "reference";
      // 若全屏，保持全屏；否则滚动到顶部
      this.$nextTick(() => {
        const el = this.$refs.vpRightPane;
        if (el) el.scrollTop = 0;
        const leftEl = this.$refs.vpLeftPane;
        if (leftEl) leftEl.scrollTop = 0;
        this.vpMountAll();
      });
    },
    /* 切题/切 Tab 前：把改动过的编辑区写回数据，再重新挂载。
       只写「真的动过」的格子——挂载后内容与数据必然一致，没动过的格子
       不写回就不会把任何界面陈旧内容带进数据里。 */
    vpEditBeforeLeave() {
      if (!this.vpEditing) return;
      document.querySelectorAll('[data-vp-path][data-vp-edited="1"]').forEach((el) => {
        if (el.dataset.vpPath) this.vpSetField(el.dataset.vpPath, vpDomToMd(el));
        el.dataset.vpEdited = "";
      });
    },
    vpSetTab(tab) {
      if (this.vpActiveTab === tab) return;
      this.vpEditBeforeLeave();
      this.vpActiveTab = tab;
      this.$nextTick(() => this.vpMountAll());
    },
    /* --- 生成前配置（每题迁移题量）：面板开关与取值，仿右上角模型菜单 --- */
    _vpClampTransferCount(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return this.VP_TRANSFER_MIN;
      return Math.min(this.VP_TRANSFER_MAX, Math.max(this.VP_TRANSFER_MIN, Math.round(n)));
    },
    get vpTransferCount() {
      return this._vpClampTransferCount(this.vpSettings && this.vpSettings.transferCount);
    },
    /* 续写/重跑要用的迁移题量：这份卷子已经锁定过就沿用它，而不是当前设置。
       不锁会有两个代价——内容上一份卷子前后迁移题数不一致；
       缓存上 {{transfer_count}} 出现在模板前半部分（"结构化思考步骤"那几段），
       一动整个前缀从第 587 个字符起就分叉，复用率从 99% 掉到 1%。 */
    get vpLockedTransferCount() {
      const locked = this.visualPaper && this.visualPaper.transferCount;
      return this._vpClampTransferCount(locked == null ? this.vpTransferCount : locked);
    },
    toggleVpSettings() {
      this.vpSettingsOpen = !this.vpSettingsOpen;
      // 浮层挂在坞外、固定定位，位置得按触发器的实时位置算；进场首帧 opacity 为 0，
      // 所以进场之后再落位也看不到跳动
      if (this.vpSettingsOpen) this.$nextTick(() => this.positionVpSettings());
    },
    closeVpSettings() {
      this.vpSettingsOpen = false;
    },
    /* 浮层落位：与触发器右对齐、向上展开，左右与上下都做视口兜底，
       上方放不下就翻到触发器下方（写法与 vpRepositionTools 一致）。
       正常路径用 bottom 锚定（不依赖量到的高度），只有需要判断"上方放不放得下"
       和翻到下方时才用高度，量不到就按兜底值算。 */
    positionVpSettings() {
      const menu = this.$refs.vpCfgMenu;
      const trigger = this.$refs.vpCfgTrigger;
      if (!menu || !trigger) return;
      const r = trigger.getBoundingClientRect();
      const w = menu.offsetWidth || 288;
      const h = menu.offsetHeight || 180;
      const gap = 8;
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
      menu.style.left = Math.round(left) + "px";
      if (r.top - gap - h >= 8) {
        menu.style.top = "auto";
        menu.style.bottom = Math.round(vh - r.top + gap) + "px";
      } else {
        menu.style.bottom = "auto";
        menu.style.top = Math.round(Math.max(8, Math.min(vh - h - 8, r.bottom + gap))) + "px";
      }
    },
    /* 浮层在坞外，不是触发器的子节点：@click.outside 会把面板内的点击误判成"外部"，
       所以走窗口级 pointerdown 判定——落在触发器或面板里（data-vp-cfg）就放行。
       用 pointerdown 而不是 click：拖滑块时若松手落在面板外，click 的目标会被算成
       两者的共同祖先（body），浮层会在拖动中途被判成"外部点击"关掉。 */
    vpSettingsOutsideHide(e) {
      if (!this.vpSettingsOpen) return;
      const t = e.target;
      if (t && t.closest && t.closest("[data-vp-cfg]")) return;
      this.closeVpSettings();
    },
    vpResetSettings() {
      this.vpSettings.transferCount = this.VP_TRANSFER_MIN;
    },
    vpIsCurrent(gIdx, qIdx) {
      return this.visualPaper && this.visualPaper.currentGroupIdx === gIdx && this.visualPaper.currentQIdx === qIdx;
    },
    vpNextQuestion() {
      if (!this.visualPaper || !this.vpCurrentGroup) return;
      // 先回写再动指针，理由同 vpSelectQuestion
      this.vpEditBeforeLeave();
      const g = this.vpCurrentGroup;
      if (this.visualPaper.currentQIdx + 1 < (g.questions || []).length) {
        this.visualPaper.currentQIdx += 1;
      } else {
        // 跨组
        let ng = this.visualPaper.currentGroupIdx + 1;
        while (ng < this.visualPaper.groups.length) {
          if ((this.visualPaper.groups[ng].questions || []).length > 0) {
            this.visualPaper.currentGroupIdx = ng;
            this.visualPaper.currentQIdx = 0;
            break;
          }
          ng += 1;
        }
        if (ng >= this.visualPaper.groups.length) return;
      }
      this.vpActiveTab = "reference";
      this.$nextTick(() => {
        const el = this.$refs.vpRightPane;
        if (el) el.scrollTop = 0;
        // 左栏语篇也要归位：只滚右栏会让翻题后语篇停在上一篇的滚动位置
        const leftEl = this.$refs.vpLeftPane;
        if (leftEl) leftEl.scrollTop = 0;
        this.vpMountAll();
      });
    },
    vpPrevQuestion() {
      if (!this.visualPaper || !this.vpCurrentGroup) return;
      // 先回写再动指针，理由同 vpSelectQuestion
      this.vpEditBeforeLeave();
      if (this.visualPaper.currentQIdx > 0) {
        this.visualPaper.currentQIdx -= 1;
      } else {
        let ng = this.visualPaper.currentGroupIdx - 1;
        while (ng >= 0) {
          const len = (this.visualPaper.groups[ng].questions || []).length;
          if (len > 0) {
            this.visualPaper.currentGroupIdx = ng;
            this.visualPaper.currentQIdx = len - 1;
            break;
          }
          ng -= 1;
        }
        if (ng < 0) return;
      }
      this.vpActiveTab = "reference";
      this.$nextTick(() => {
        const el = this.$refs.vpRightPane;
        if (el) el.scrollTop = 0;
        // 左栏语篇也要归位：只滚右栏会让翻题后语篇停在上一篇的滚动位置
        const leftEl = this.$refs.vpLeftPane;
        if (leftEl) leftEl.scrollTop = 0;
        this.vpMountAll();
      });
    },
    toggleVpFullscreen() {
      if (this.vpFullscreen) { this.vpCloseFullscreen(); return; }
      // 修改模式下进全屏：先保存并退出修改（讲台是只读投影，不在这里编辑）
      if (this.vpEditing) this.toggleVpEdit();
      this.vpFullscreen = true;
      this.vpOverviewOpen = false;
      this.vpTopHidden = false;
      this.vpBottomHidden = false;
      // 进沉浸态同理收掉两侧浮层抽屉与导出面板：抽屉层级（z-50）低于讲台，
      // 若有开着的，会被讲台盖住但状态还在，退出全屏时又冒出来；
      // 导出面板层级高于讲台，更不能留在屏幕上。
      this.leftOpen = false;
      this.rightMobileOpen = false;
      this.closeExportMenu();
      // 全屏讲解舞台用不透明背景盖住整个视口，bgfx 完全不可见：暂停其渲染，
      // 把整帧预算让给讲解页面（退出时 resume，视觉零变化）
      if (this._bg) this._bg.suspend();
      // 点击特效同理：讲题时点击/移动频繁，光环碎片会干扰讲台，整段停用（退出时 resume）
      if (window.NbxClickFx) window.NbxClickFx.pause();
      // 防御：若页面曾被程序化滚动（如 scrollIntoView），进入全屏前归位
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      this._vpBoundHandler = (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); this.vpNextQuestion(); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); this.vpPrevQuestion(); }
        else if (e.key === "Escape") { this.vpCloseFullscreen(); }
      };
      document.addEventListener("keydown", this._vpBoundHandler);
      // 锁住 body 滚动，全屏层内部左右分栏各自滚动
      document.documentElement.style.overflow = "hidden";
      // 指针活动（移动 / 点击 / 触摸）都会唤醒控制台并重置自动隐藏计时；
      // 指针触及屏幕顶缘时，顶栏作为覆盖层自动浮现（底部控制台不受影响）
      this._vpActivityHandler = (e) => {
        if (e.clientY != null && e.clientY <= 12) this.vpWakeTop();
        this.vpScheduleChromeHide();
      };
      ["pointermove", "pointerdown", "touchstart"].forEach((t) =>
        document.addEventListener(t, this._vpActivityHandler, { passive: true }));
      // 滚动唤出顶栏：滚到最顶部（或到顶后再向上滚）时，顶栏作为覆盖层浮现，不改布局
      this._vpScrollReveal = (e) => {
        if (e.type === "wheel") {
          if (e.deltaY >= 0) return;
          const el = e.target;
          for (let n = el && el.parentElement ? el : null; n && n !== document.body; n = n.parentElement) {
            if (n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return; // 上方还有内容可滚
          }
          this.vpWakeTop();
          return;
        }
        const t = e.target;
        if (t && t.classList && t.classList.contains("vp-pane") && t.scrollTop === 0) this.vpWakeTop();
      };
      document.addEventListener("wheel", this._vpScrollReveal, { passive: true, capture: true });
      document.addEventListener("scroll", this._vpScrollReveal, { passive: true, capture: true });
      this.vpScheduleChromeHide();
      // best-effort 进入浏览器全屏（隐藏地址栏/标签栏）；失败静默降级为应用内全屏
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    },
    vpCloseFullscreen() {
      this.vpFullscreen = false;
      this.vpOverviewOpen = false;
      this.vpTopHidden = false;
      this.vpBottomHidden = false;
      this._vpStopChromeTimer();
      // 恢复背景渲染（未处于暂停态时为幂等空操作；点击特效若被用户在设置里关掉则不唤醒）
      if (this._bg) this._bg.resume();
      if (window.NbxClickFx && this.fxOn) window.NbxClickFx.resume();
      if (this._vpBoundHandler) { document.removeEventListener("keydown", this._vpBoundHandler); this._vpBoundHandler = null; }
      if (this._vpActivityHandler) {
        ["pointermove", "pointerdown", "touchstart"].forEach((t) =>
          document.removeEventListener(t, this._vpActivityHandler));
        this._vpActivityHandler = null;
      }
      if (this._vpScrollReveal) {
        document.removeEventListener("wheel", this._vpScrollReveal, { capture: true });
        document.removeEventListener("scroll", this._vpScrollReveal, { capture: true });
        this._vpScrollReveal = null;
      }
      document.documentElement.style.overflow = "";
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    },

    /* --- 全屏讲解：控制台自动隐藏（顶栏 / 底部控制台两半独立） --- */
    vpScheduleChromeHide() {
      if (!this.vpFullscreen || this.vpChromePinned) return;
      clearTimeout(this._vpChromeTimer);
      this._vpChromeTimer = setTimeout(() => {
        if (!this.vpFullscreen || this.vpChromePinned || this.vpOverviewOpen) return;
        this.vpTopHidden = true;
        this.vpBottomHidden = true;
      }, 4000);
    },
    vpWakeTop() {
      if (!this.vpFullscreen) return;
      this.vpTopHidden = false;
      this.vpScheduleChromeHide();
    },
    vpWakeBottom() {
      if (!this.vpFullscreen) return;
      this.vpBottomHidden = false;
      this.vpScheduleChromeHide();
    },
    _vpStopChromeTimer() {
      clearTimeout(this._vpChromeTimer);
      this._vpChromeTimer = null;
    },
    vpTogglePin() {
      this.vpChromePinned = !this.vpChromePinned;
      if (this.vpChromePinned) { this.vpTopHidden = false; this.vpBottomHidden = false; this._vpStopChromeTimer(); }
      else this.vpScheduleChromeHide();
      this.persistUI();
    },
    vpToggleOverview() {
      this.vpOverviewOpen = !this.vpOverviewOpen;
      if (this.vpOverviewOpen) {
        this.vpTopHidden = false;
        this.vpBottomHidden = false;
        this._vpStopChromeTimer();
        // 只在总览面板内部滚动定位当前题；scrollIntoView 会连 overflow:hidden 的文档一起滚，
        // 把页面滚出一条无法滚回的白边
        this.$nextTick(() => {
          const body = document.querySelector(".vp-overview-body");
          const chip = body && body.querySelector(".vp-overview-chip.active");
          if (body && chip) body.scrollTop = chip.offsetTop - body.clientHeight / 2 + chip.clientHeight / 2;
          else if (body) body.scrollTop = 0;
        });
      } else {
        this.vpScheduleChromeHide();
      }
    },
    vpJumpFromOverview(gIdx, qIdx) {
      this.vpSelectQuestion(gIdx, qIdx);
      this.vpOverviewOpen = false;
      this.vpScheduleChromeHide();
    },

    /* --- 全屏讲解：触屏左右滑动翻题 --- */
    vpTouchStart(e) {
      if (!this.vpFullscreen) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      this._vpTouch = { x: t.clientX, y: t.clientY };
    },
    vpTouchEnd(e) {
      if (!this._vpTouch) return;
      const t = e.changedTouches && e.changedTouches[0];
      const start = this._vpTouch;
      this._vpTouch = null;
      if (!t) return;
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
        if (dx < 0) this.vpNextQuestion(); else this.vpPrevQuestion();
      }
    },
    get mascotAnchorName() {
      if (!this.currentTool) return "home";
      return "tool";
    },
    get mascotIsBusy() {
      return !!(
        this.streaming
        || this.ocrStreaming
        || (this.migration && (this.migration.analyzing || this.migration.moreAnalyzing
          || this.migration.prechecking || this.migration.generating))
        || (this.vocab && (this.vocab.checking || this.vocab.replacing))
      );
    },
    get mascotCanPeek() {
      if (this.mascotHidden) return false;
      if (this.mascotIsBusy) return false;
      if (!this.currentTool) return true;
      if (this.isMigrationTool) {
        return !!this.migration && this.migration.step < 4 && !this.migration.generated;
      }
      if (this.isVocabTool) {
        return !!this.vocab && !this.vocab.checked && !this.vocab.output;
      }
      if (this.isVisualPaperTool) {
        return !this.vpHasData && !this.streaming && !this.inputCollapsed;
      }
      if (this.isOcrTool) {
        // 识别结果不落在 output/submittedInput 上，通用分支会一直放行；这里按工作区是否已占用判断：
        // 有图之后整块是预览与转录文本，没有能安全落脚的地方
        return !this.ocrHasImage;
      }
      return !this.inputCollapsed && !this.submittedInput && !this.output && !this.errorMsg;
    },
    mascotRectsOverlap(a, b, padding = 0) {
      return !(
        a.right + padding <= b.left
        || a.left - padding >= b.right
        || a.bottom + padding <= b.top
        || a.top - padding >= b.bottom
      );
    },
    mascotHasSafeSpace() {
      if (!this.mascotCanPeek) return false;
      const panel = this.$refs.mainPanel;
      const layer = this.$refs.mascotLayer;
      if (!panel || !layer) return false;

      const panelRect = panel.getBoundingClientRect();
      if (window.innerWidth < 760 || panelRect.width < 540 || panelRect.height < 440) return false;

      layer.classList.add("mascot-measuring");
      const mascotRect = layer.getBoundingClientRect();
      layer.classList.remove("mascot-measuring");

      const panelPadding = 10;
      if (mascotRect.width < 80 || mascotRect.height < 70) return false;
      if (
        mascotRect.left < panelRect.left + panelPadding
        || mascotRect.right > panelRect.right - panelPadding
        || (this.mascotAnchorName !== "home" && mascotRect.top < panelRect.top + panelPadding)
        || mascotRect.bottom > panelRect.bottom - panelPadding
      ) return false;

      const keepouts = panel.querySelectorAll(
        ".mascot-keepout, .glass-soft, .submitted-card, .migration-step, "
        + ".migration-result-card, .error-card, .composer"
      );
      const collisionPadding = this.mascotAnchorName === "home" ? 4 : 12;
      for (const el of keepouts) {
        if (el === layer || layer.contains(el)) continue;
        if (el.closest && el.closest(".ms-menu")) continue;
        if (el.closest && el.closest(".ms-wrap") && el !== panel.querySelector(".mascot-keepout")) {
          const wrapTrigger = el.closest(".ms-wrap");
          if (wrapTrigger && wrapTrigger.querySelector(".ms-menu")) continue;
        }
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.02) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (this.mascotRectsOverlap(mascotRect, rect, collisionPadding)) return false;
      }
      return true;
    },
    scheduleMascotCheck(delay = 0) {
      clearTimeout(this._mascotCheckTimer);
      // 输入坞展开过渡期间布局未落定，基于中间态的判定会来回翻转；
      // 统一推迟到落定后再判（_animateDock 设置的安静窗口）
      const quiet = (this._mascotQuietUntil || 0) - Date.now();
      const wait = Math.max(delay, quiet, 0);
      this._mascotCheckTimer = setTimeout(() => {
        this._mascotCheckTimer = null;
        this.$nextTick(() => this.reconcileMascot());
      }, wait);
    },
    setupMascotObservers() {
      const panel = this.$refs.mainPanel;
      const layer = this.$refs.mascotLayer;
      if (!panel || !layer) return;

      const schedule = () => this.scheduleMascotCheck(60);
      if (typeof ResizeObserver !== "undefined") {
        this._mascotResizeObserver = new ResizeObserver(schedule);
        this._mascotResizeObserver.observe(panel);
      }
      if (typeof MutationObserver !== "undefined") {
        this._mascotMutationObserver = new MutationObserver((records) => {
          const relevant = records.some((record) => {
            const target = record.target;
            if (!(target && target.nodeType === 1)) return false;
            if (target.closest(".mascot-layer")) return false;
            if (target.closest(".ms-wrap")) return false;
            if (target.closest(".ms-menu")) return false;
            return true;
          });
          if (relevant) schedule();
        });
        this._mascotMutationObserver.observe(panel, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }

      const image = layer.querySelector("img");
      if (image && !image.complete) image.addEventListener("load", schedule, { once: true });
    },
    reconcileMascot() {
      // 探出 / 收回动画进行中不做反向的空间判定：过渡期间布局每帧都在变，
      // 判定结果来回翻转会把一次探出反复打断重启（视觉上连续鬼畜弹跳）。
      // 空间是否安全交给动画结束回调基于落定后的布局再判；只有「探出资格」
      // 消失（提交、开始生成等明确的状态变化）才立即收回。
      if (this.mascotState === "entering" || this.mascotState === "retreating") {
        if (!this.mascotCanPeek) this.retreatMascot();
        return;
      }
      if (this.mascotCanPeek && this.mascotHasSafeSpace()) this.showMascot();
      else this.retreatMascot();
    },
    showMascot() {
      if (this.mascotState === "peeking" || this.mascotState === "entering") return;
      if (this.mascotState === "retreating") return;
      clearTimeout(this._mascotAnimationTimer);
      this.mascotState = "entering";
      this._mascotAnimationTimer = setTimeout(() => {
        this._mascotAnimationTimer = null;
        if (this.mascotCanPeek && this.mascotHasSafeSpace()) {
          this.mascotState = "peeking";
        } else {
          this.retreatMascot();
        }
      }, 1220);
    },
    retreatMascot() {
      if (this.mascotState === "hidden" || this.mascotState === "retreating") return;
      clearTimeout(this._mascotAnimationTimer);
      this._mascotAnimationTimer = null;
      this.mascotState = "retreating";
      this._mascotAnimationTimer = setTimeout(() => {
        this._mascotAnimationTimer = null;
        this.mascotState = "hidden";
        this.scheduleMascotCheck(40);
      }, 460);
    },
    get isVocabTool() {
      return !!this.currentTool && this.currentTool.id === "24";
    },
    get isVisualPaperTool() {
      return !!this.currentTool && this.currentTool.id === "13";
    },
    get vocabOverCount() {
      return this.vocab && this.vocab.result ? (this.vocab.result.over_words || []).length : 0;
    },
    async checkVocab() {
      // 纯本地词汇排查，不调模型也不消耗次数，无码可直接用
      const text = (this.vocab.text || "").trim();
      if (!text) {
        this.toast("请先粘贴要排查的英语文本", "warn");
        return;
      }
      this.retreatMascot();
      this.vocab.checking = true;
      this.vocab.checkError = "";
      // 上次的失败提示随新一次排查清掉（错误行由 vocab.status === 'error' 控制显示）
      if (this.vocab.status === "error") this.vocab.status = "";
      this.vocab.result = null;
      this.vocab.checked = false;
      try {
        const res = await fetch("/api/chat/vocab/check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            const msg = "请先输入使用码，或改用带「免码」标签的模型";
            this.handleAuthFailure(msg);
            throw new Error(msg);
          }
          if (res.status === 403) throw new Error("额度已用尽或使用码已被禁用");
          let msg = "HTTP " + res.status;
          try {
            const j = await res.json();
            if (j && j.detail != null) msg = formatApiDetail(j.detail) || JSON.stringify(j.detail);
          } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        this.vocab.result = data;
        this.vocab.checked = true;
        // 记下排查时的原文：正文一改，清单里的词频、词性、例句就全部过期，
        // 而 buildReplacementInput 会把新正文拼到旧词表后面 —— 替换必然漏。
        this.vocab.checkedText = this.vocab.text;
        if (!data.over_words || !data.over_words.length) {
          this.toast("未发现超标词，词汇均在课标范围内", "ok");
        } else {
          this.toast("排查完成，发现 " + data.over_words.length + " 个疑似超标词", "ok");
        }
      } catch (e) {
        // 排查失败（含 429 限速）要留在面板上，不只飘一个 toast
        this.vocab.checkError = describeError(e, "排查失败");
        this.vocab.status = "error";
        this.toast("排查失败：" + this.vocab.checkError, "error");
      } finally {
        this.vocab.checking = false;
      }
    },
    /* 正文一改，排查清单就作废：词频、词性、例句全都对不上新正文了，
       继续拿旧清单去替换必然漏词。直接清掉清单并提示重新排查，
       别让用户对着一个看起来正常的表格点「全部替换」然后什么都没改到。

       取 $event.target.value 而不是读 this.vocab.text：x-model 与 @input
       都挂在同一个 textarea 上，谁先执行取决于监听器注册顺序，读属性可能
       拿到旧值。 */
    vocabTextChanged(value) {
      if (!this.vocab || !this.vocab.checked) return;
      if (value === this.vocab.checkedText) return;
      const had = this.vocab.result && (this.vocab.result.over_words || []).length;
      this.vocab.result = null;
      this.vocab.checked = false;
      this.vocab.status = "";
      if (had) this.toast("原文已修改，请重新排查后再替换", "warn");
    },
    buildReplacementInput() {
      const over = (this.vocab.result && this.vocab.result.over_words) || [];
      const lines = over.map((o, i) => {
        const sentence = (o.sentences && o.sentences[0]) || "";
        return `${i + 1}. ${o.word} | ${o.pos || "-"} | ×${o.count} | ${sentence}`;
      });
      return ["<over_words>", ...lines, "</over_words>", "", this.vocab.text].join("\n");
    },
    async replaceVocab() {
      if (!this.ensureCanRun("当前模型需要输入使用码后才能替换")) return;
      if (this.vocab.replacing) return;
      if (!this.vocab.result || !this.vocab.result.over_words || !this.vocab.result.over_words.length) {
        this.toast("没有超标词，无需替换", "warn");
        return;
      }
      const input = this.buildReplacementInput();
      this.retreatMascot();
      this.vocab.replacing = true;
      this.vocab.stopRequested = false;
      this.vocab.thinking = true;
      this.vocab.status = "connecting";
      this.vocab.elapsed = "0.0";
      this.vocab.output = "";
      this.vocab.rendered = "";
      // 新一次替换的内容还在增长，不套用「从历史打开」的折叠
      this.vocab.foldEligible = false;
      this.resetVocabReasoning();
      this.vocab.requestId = "24_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      this._abortCtrl = new AbortController();
      this._startTs = performance.now();
      clearInterval(this._timer);
      this._timer = setInterval(() => {
        this.vocab.elapsed = ((performance.now() - this._startTs) / 1000).toFixed(1);
      }, 100);

      // 全部替换按 1 次额度计费：跑完要和其它工具一样同步余额
      const quotaBefore = this.quotaRemaining;
      try {
        const { state } = await this._streamChat({
          toolId: this.currentTool.id,
          input,
          requestId: this.vocab.requestId,
          onReasoning: (text) => this.appendVocabReasoning(text),
          onToken: (text) => {
            if (this.vocab.thinking) {
              this.vocab.thinking = false;
              this.vocab.status = "streaming";
            }
            this.finishVocabReasoningOnToken();
            this.vocab.output += text;
            this._outputDirty = true;
            this.vocabTyper().grow((this.vocab.output || "").length);
          },
        });
        this.vocab.status = state === "stopped" ? "stopped" : "done";
        // 与 OCR / 翻译 / 通用工具同一口径：停止时已流式产出的正文要留档。
        // 原来这里只弹 toast，正文既不进历史也不提示，下一次 replaceVocab
        // 开头的 output = "" 直接抹掉 —— 用户点了停止就等于白跑一场。
        if (this.vocab.output.trim()) {
          const item = {
            id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            toolId: this.currentTool.id,
            toolName: this.currentTool.name,
            icon: this.currentTool.icon,
            title: "",
            input: this.vocab.text.trim(),
            fileName: "",
            output: this.vocab.output,
            model: this.selectedModel,
            partial: state === "stopped",
            createdAt: Date.now(),
          };
          this.commitHistoryWithTitle(item);
        }
        if (state === "stopped") {
          this.toast(
            this.vocab.output.trim() ? "已停止替换，已经替换出的内容已保留" : "已停止生成",
            "warn"
          );
        }
      } catch (e) {
        if (e && e.name === "AbortError") {
          this.vocab.status = "stopped";
        } else {
          this.vocab.status = "error";
          this.vocab.checkError = describeError(e, "替换失败");
          this.toast("替换失败：" + this.vocab.checkError, "error");
          // 原文是用户辛苦录入的，替换失败也要留一条（输入不在输入框里，显式传入）
          this.pushFailedHistory(this.vocab.checkError, {
            input: this.vocab.text.trim(),
            output: this.vocab.output,
            fileName: "",
            model: this.selectedModel,
          });
        }
      } finally {
        clearInterval(this._timer);
        this._timer = null;
        this.vocab.replacing = false;
        // 打字机收尾：自然完成的余量平滑放完，停止 / 出错残文立即全量
        if (this.vocab.status === "done") this.vocabTyper().finish();
        else this.vocabTyper().reset((this.vocab.output || "").length);
        this.vocabReasonTyper().reset((this.vocab.reasoning || "").length);
        this.vocab.reasoningShown = this.vocab.reasoning || "";
        this._outputDirty = true;
        this.doRender();
        // 同 finalize：只在正文从未开始时收一次
        if (this.vocab.reasoning && !this.vocab.reasoningDone) {
          this.vocab.reasoningDone = true;
          this.vocab.reasoningOpen = false;
        }
        // 用户停止时服务端在 finally 里扣费，延后刷才能读到新值
        this._afterRunQuota(quotaBefore, this.vocab.status === "stopped" ? 900 : 0);
      }
    },
    stopVocabReplace() {
      if (!this.vocab || !this.vocab.replacing) return;
      this.vocab.stopRequested = true;
      // 与 stop() 一致：先断本地流让 UI 立即恢复，再异步通知后端
      try { this._abortCtrl && this._abortCtrl.abort(); } catch {}
      this.notifyStop(this.vocab.requestId);
    },

    /* ============ 初始化 ============ */
    async init() {
      configureMarked();
      this.resetMigration();
      this.resetVocab();
      this.resetVisualPaper();

      // 主题
      const savedTheme = localStorage.getItem(LS.theme);
      if (savedTheme && THEMES.some((t) => t.id === savedTheme)) this.theme = savedTheme;
      this.applyTheme();

      // localStorage 写入失败（配额满）时提示，避免用户误以为内容已保存
      window.addEventListener("nbx:storage-full", (e) => {
        this.toast(
          e && e.detail && e.detail.evicted
            ? "本机存储空间不足，已自动清理最旧的历史记录"
            : "本机存储空间不足，新内容可能未被保存",
          "warn"
        );
      });

      // 点击特效的性能自适应提示（click-fx.js 无法直接触达 Alpine，故走自定义事件）
      window.addEventListener("nbx:fx-notice", (e) => {
        const d = e && e.detail;
        if (d && d.msg) this.toast(d.msg, d.type || "warn");
      });

      // 手机档模型下拉走 fixed 落位：转屏、软键盘弹出等都会触发 resize，开着时重算落位
      window.addEventListener("resize", () => this.positionModelMenu());

      // 悠空 · 两时段天空：每分钟校准一次，回到前台时立即校准
      this._skyTimer = setInterval(() => this.updateSkyPeriod(), 60000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          this.updateSkyPeriod();
          // 本页开着但没被看着时，对端推来的偏好只落在 nbx_prefs 上，页面收不到通知；
          // 回到前台对账一次。LWW 保证本页更晚的选择不会被对端旧值顶掉。
          this._mirrorApplyPrefs();
          this.resumeTitleJobs();
        }
      });

      // 本地数据（历史为索引 + 分条正文，旧格式在此一次性拆分）
      this.history = this._loadHistory();
      // 先建元数据索引（标题 / 摘要 / 工具名），正文由空闲分片在后台补齐；
      // 用户在补齐前就能搜到内容，补齐过程中结果会自动刷新。
      this._historySearchInit();
      this.favorites = lsGet(LS.favorites, []);
      this.input = localStorage.getItem(LS.draft) || "";

      const ui = lsGet(LS.ui, {});
      this.collapsedGroups = ui.collapsedGroups || {};
      this.rightCollapsed = !!ui.rightCollapsed;
      this.rightTab = ui.rightTab === "fav" ? "fav" : "history";
      this.vpChromePinned = !!ui.vpChromePinned;
      this.mascotHidden = !!ui.mascotHidden;
      // 内容字号：范围外/脏数据回落默认，避免脏值把工作区缩到看不见
      const _cs = Number(ui.contentScale);
      this.contentScale = (Number.isFinite(_cs) && _cs >= this.CONTENT_SCALE_MIN && _cs <= this.CONTENT_SCALE_MAX)
        ? _cs : this.CONTENT_SCALE_DEFAULT;
      // 点击特效的用户开关由 click-fx.js 自己落盘（nbx_fx_off），这里只读不写。
      // click-fx.js 已移出首屏关键路径，加载完成前也要保留用户的真实偏好；
      // 它启动时会自己读取同一个键，所以这里不必依赖 window.NbxClickFx 是否已就绪。
      try { this.fxOn = localStorage.getItem("nbx_fx_off") !== "1"; } catch { this.fxOn = true; }

      // 全屏讲解：用户在浏览器层按 Esc 退出全屏时，同步关闭讲解模式
      document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && this.vpFullscreen) this.vpCloseFullscreen();
      });

      // 自由对话里的工具推荐卡片：事件委托，覆盖所有 x-html 输出区（正文 / 历史 / 收藏）。
      // 卡片是渲染后才注入的，逐个绑定会漏掉后续重渲染，委托在 document 上一劳永逸。
      document.addEventListener("click", (e) => {
        const el = e.target && e.target.closest ? e.target.closest(".nbx-tool-link") : null;
        if (!el) return;
        const id = el.getAttribute("data-tool-id");
        const tool = this.findTool(id);
        if (!tool) {
          this.toast("这个工具当前不可用，请重新加载工具列表", "warn");
          return;
        }
        // selectTool 只用到 ev.currentTarget（点击定位动效）；委托里 currentTarget 是 document，
        // 必须显式换成卡片本身，否则动效锚点会落到页面原点
        this.selectTool(tool, { currentTarget: el });
      });

      // 恢复认证
      this.loadAuth();

      // 首屏 splash 放行标志：同步初始化已完成，/api/tools/ 不再阻塞应用可见
      try { window.__nbxBooted = true; } catch { /* 测试环境没有 window 时忽略 */ }

      // 先用手上的缓存目录把工具列表渲染出来（跨境线路上省掉一个来回），
      // 再让 /api/tools/ 的权威数据覆盖它。
      this._loadToolsCache();

      // 工具列表是首屏之后第一个功能请求，先让它拿到带宽；
      // 背景 / 点击特效等增强模块等它结束后再空闲加载。
      await this.loadTools();
      this.loadParseConfig();
      this._scheduleBackground();
      this._scheduleClickFx();
      this._scheduleDeferredLibs();
      // 仅供预览/联调：?dev=fallback / ?dev=network 时自动播放一次（正式使用无副作用）
      this.maybeRunDevPreview();

      const savedModel = localStorage.getItem(LS.model);
      if (savedModel && this.models.some((m) => m.id === savedModel)) this.selectedModel = savedModel;

      // 输入草稿自动保存
      this.$watch("input", (v) => {
        clearTimeout(this._draftTimer);
        this._draftTimer = setTimeout(() => {
          try { localStorage.setItem(LS.draft, v || ""); } catch {}
        }, 400);
      });
      // 翻译：原文栏按内容长高。上传解析、拍照识别写回走的也是 input，
      // 统一从这里触发，不必在每个写入口各调一次
      this.$watch("input", () => { if (this.isTranslateTool) this.trGrow(); });

      // 布局分档同步：跨过 2xl 分界时切换档位，并关掉已不适用的抽屉状态
      const syncCompact = () => {
        const compact = !WIDE_MQ.matches;
        if (!compact) {
          this.leftOpen = false;
          this.rightMobileOpen = false;
        }
        this.isCompact = compact;
      };
      WIDE_MQ.addEventListener("change", syncCompact);
      syncCompact();

      // 输入坞动效：生成开始/结束、输入区收起/展开时各走一次高度过渡
      this.$watch("streaming", () => this.syncDocks());
      this.$watch("inputCollapsed", () => this.syncDocks());

      // 视口变化时关闭浮层抽屉（跨过分界后侧栏已并排，抽屉状态不再适用）
      window.addEventListener("resize", () => {
        syncCompact();
        this.repositionExportMenu();
        this.repositionMigrationExport();
        // 翻译：分档切换会改栏宽/栏高，原文框的高度要跟着重算
        if (this.isTranslateTool) this.trGrow();
        this.scheduleMascotCheck(80);
        this._syncKB && this._syncKB();
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => {
          this.scheduleMascotCheck(80);
          this._syncKB && this._syncKB();
        });
        window.visualViewport.addEventListener("scroll", () => this._syncKB && this._syncKB());
      }

      // 键盘高度同步：解决移动端输入法弹出时底部留白（interactive-widget 回退）
      this._syncKB = () => {
        const vv = window.visualViewport;
        let kb = 0;
        if (vv) {
          // visualViewport.height 为可视区高度，offsetTop 处理 iOS 键盘顶部的偏移
          const offsetTop = vv.offsetTop || 0;
          kb = Math.max(0, window.innerHeight - vv.height - offsetTop);
          // 部分安卓机 visualViewport.height 约等于 innerHeight 但键盘仍为 overlay，用 innerWidth 判断横屏不处理
          if (kb < 40 && vv.height < window.innerHeight * 0.85) {
            kb = Math.max(0, window.innerHeight - vv.height);
          }
        } else {
          // 回退：比较 innerHeight 与 documentElement.clientHeight
          kb = Math.max(0, window.innerHeight - document.documentElement.clientHeight);
        }
        // 过滤抖动：< 60px 视为无键盘（工具栏等）
        const hasKB = kb > 60;
        const kbPx = hasKB ? Math.round(kb) + "px" : "0px";
        document.documentElement.style.setProperty("--kb", kbPx);
        document.documentElement.classList.toggle("kb-open", hasKB);
        // 翻译：输入区不在最下方，键盘弹起时把高度让给原文栏（详见 scheduleTrKbFold）
        if (this.isTranslateTool) this.scheduleTrKbFold(hasKB);
        // 同步给 mascot 布局重新计算
        if (hasKB) this.scheduleMascotCheck(30);
      };
      // 初始化一次
      this._syncKB();
      // 额外监听：确保键盘动画期间多次同步
      window.addEventListener("resize", this._syncKB, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", this._syncKB, { passive: true });
      }
      // 输入框聚焦时确保可视：避免被键盘遮挡，主动滚入视口
      window.addEventListener("focusin", (e) => {
        const el = e.target;
        if (!el || !el.matches || !el.matches("textarea, input, [contenteditable='true']")) return;
        // 延迟等待键盘动画与 --kb 更新
        setTimeout(() => this._syncKB(), 80);
        setTimeout(() => {
          try {
            const vv = window.visualViewport;
            const isMobile = window.innerWidth <= 640 || (vv && vv.width <= 640);
            if (!isMobile) return;
            // 优先让外层滚动容器把输入框带到可视区
            const scrollEl = el.closest(".migration-shell, .vocab-shell, .composer, [x-ref='migrationScroll'], [x-ref='resultScroll']");
            // 通用：scrollIntoView
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
            // 针对迁移表单：额外把父容器滚动到底部附近
            const container = this.$refs.migrationScroll || this.$refs.resultScroll;
            if (container && scrollEl) {
              const rect = el.getBoundingClientRect();
              const vH = (vv && vv.height) || window.innerHeight;
              if (rect.bottom > vH - 24) {
                container.scrollTo({ top: container.scrollTop + (rect.bottom - vH + 32), behavior: "smooth" });
              }
            }
          } catch {}
        }, 320);
      }, true);
      window.addEventListener("focusout", () => {
        // 键盘收起有动画，延迟清除 kb 标记以免闪烁
        setTimeout(() => this._syncKB(), 120);
        setTimeout(() => this._syncKB(), 400);
      }, true);

      this.$nextTick(() => {
        this.autoGrow();
        this.scheduleMascotCheck(80);
      });
      this.$nextTick(() => {
        this.setupMascotObservers();
        this.scheduleMascotCheck(120);
      });

      // 线路镜像放最后：等应用可交互之后再建隐藏 iframe（空闲时启动），
      // 让「多一次文档加载 + TLS 握手」落在首屏关键路径之外
      this._mirrorScheduleStart();
    },

    /* ============ 认证 ============ */
    _updateAuthUI(token, user) {
      // 每次生成后都会 verifyAuth → saveAuth → 这里。标题轮询只在「换了使用码」时
      // 重新起步：无条件 resumeTitleJobs 会把失败退避（最长 30s）重置成立即轮询
      const tokenChanged = this.auth.token !== token;
      const wasAuthenticated = this.isAuthenticated;
      this.auth.token = token;
      this.auth.user = user;
      this.isAuthenticated = !!token && !!user;
      this.authUser = user;
      if (this.isAuthenticated) { if (tokenChanged || !wasAuthenticated) this.resumeTitleJobs(); }
      else this.stopTitlePolling();
      if (user && user.code) {
        const c = user.code;
        const segs = c.split("-");
        this.maskedCode = segs.length >= 3
          ? segs[0] + "-" + "****" + "-" + segs.slice(2).join("-")
          : c.slice(0, 4) + "****" + c.slice(-4);
        this.quotaLabel = user.is_unlimited
          ? "无限额度"
          : `剩余 ${user.remaining ?? 0} 次 / 共 ${user.quota ?? 0} 次`;
      } else {
        this.maskedCode = "";
        this.quotaLabel = "";
      }
    },
    loadAuth() {
      const token = localStorage.getItem(LS.auth);
      const savedUser = lsGet(LS.code, null);
      if (token) {
        this._updateAuthUI(token, savedUser);
        this.verifyAuth();
      } else {
        this._updateAuthUI(null, null);
      }
    },
    saveAuth(token, user) {
      this._updateAuthUI(token, user);
      if (token) {
        localStorage.setItem(LS.auth, token);
        lsSet(LS.code, user);
      } else {
        localStorage.removeItem(LS.auth);
        localStorage.removeItem(LS.code);
      }
    },
    async verifyAuth() {
      if (!this.auth.token) return;
      try {
        const res = await fetch("/api/auth/me", {
          headers: this.authHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          this.saveAuth(this.auth.token, data.user);
        } else {
          this.clearAuth();
        }
      } catch {
        // 网络异常时保留本地 token，不直接清除
      }
    },
    /* 生成结束后的额度同步：done 事件之前服务端已经扣过费，直接刷；
       用户停止/切换工具时服务端在 finally 里扣，客户端断开早于写库，需要等一会儿。
       归零 toast 只在「这次跑之前还有、跑完变成 0」的那一次触发一次。 */
    _afterRunQuota(before, delayMs = 0) {
      const run = async () => {
        await this.verifyAuth();
        // isAuthenticated 必须带上：401 会把本地凭证清掉，那不是「用完」而是「失效」
        if (before > 0 && this.isAuthenticated && !this.isUnlimitedQuota && this.quotaRemaining === 0) {
          this.toast("使用码额度已用完，可换免费模型或更换使用码", "warn");
        }
      };
      if (delayMs > 0) setTimeout(run, delayMs); else run();
    },
    authHeaders() {
      const h = {};
      if (this.auth.token) h["Authorization"] = "Bearer " + this.auth.token;
      return { ...h, ...nbxFpHeaders() };
    },
    async activateCode() {
      if (this.codeActivating) return; // 回车键不受按钮 disabled 拦截，需防重入
      const raw = (this.codeInput || "").trim();
      if (!raw) {
        this.codeError = "请输入使用码";
        return;
      }
      this.codeActivating = true;
      this.codeError = "";
      try {
        const res = await fetch("/api/auth/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: raw }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.codeError = (data && (data.detail || data.message)) || "验证失败";
          return;
        }
        this.saveAuth(data.token, data.user);
        this.codeInput = "";
        this.codeModal = false;
        this.codeHint = "";
        this.toast(`使用码已激活：${data.user.is_unlimited ? "无限额度" : "剩余 " + data.user.remaining + " 次"}`);
        this.verifyAuth();
      } catch (e) {
        this.codeError = "网络错误，请稍后重试";
      } finally {
        this.codeActivating = false;
      }
    },
    clearAuth() {
      this.saveAuth(null, null);
      this.codeInput = "";
      this.codeError = "";
      this.codeHint = "";
      this.codeModal = false;
      this.toast("已清除本机使用码");
    },
    /* hint：为什么被要求输入使用码。弹窗遮罩会糊住 toast，这类提示只能写在弹窗里 */
    openCodeModal(hint) {
      this.codeModal = true;
      this.codeError = "";
      this.codeHint = (hint || "").trim();
      this.$nextTick(() => {
        const el = this.$refs.codeInputEl;
        if (el) el.focus();
      });
    },
    closeCodeModal() {
      this.codeModal = false;
      this.codeError = "";
      this.codeHint = "";
    },

    /* ============ 设置面板 ============ */
    openSettings() {
      this.settingsOpen = true;
      this.$nextTick(() => this.settingsTiltStart());
    },
    closeSettings() {
      this.settingsOpen = false;
      this.settingsTiltStop();
    },
    applyFxSetting() {
      // 先落盘，再通知已加载的库；库还没到时，它启动会读同一个键。
      try {
        if (this.fxOn) localStorage.removeItem("nbx_fx_off");
        else localStorage.setItem("nbx_fx_off", "1");
      } catch { /* 配额不足时忽略 */ }
      const api = window.NbxClickFx;
      if (!api) {
        if (this.fxOn) nbxEnsureClickFx();
        return;
      }
      if (this.fxOn) api.enable(); else api.disable();
    },
    applyMascotSetting() {
      if (this.mascotHidden) this.retreatMascot(); else this.reconcileMascot();
      this.persistUI();
    },

    /* ---- 内容字号：zoom 等比缩放 <main>（工作区），侧栏与弹窗在 main 之外不受影响 ----
       用 computed 而不是命令式改 DOM：x-model 更新 contentScale 即实时重渲染（拖动即预览）。
       全屏讲解模式例外——它把面板转为 position:fixed 覆盖视口，zoom 会连 fixed 后代一起缩放
       导致盖不满；且该模式自带放大排版（.vp-fullscreen-active），故回到 1:1。 */
    get wsZoomStyle() {
      if (this.vpFullscreen && this.isVisualPaperTool) return { zoom: 1 };
      return { zoom: this.contentScale / 100 };
    },
    applyContentSize() {
      this.persistUI();
    },
    resetContentSize() {
      this.contentScale = this.CONTENT_SCALE_DEFAULT;
      this.persistUI();
    },

    /* ---- 3D 卡片鼠标跟随（仅桌面）：鼠标那一侧的卡边往后退，像被鼠标推着 ----
       遮罩挂 mousemove 收集目标角度，rAF 里 lerp 逼近，停稳即自停，不留常驻循环。
       推力按离卡片的距离衰减：贴近才推得动，远了松手回正，不全屏跟着歪。 */
    get settingsTiltEnabled() {
      return this.finePointer && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
    settingsTiltStart() {
      this.settingsTiltStop();
      if (!this.settingsOpen || !this.settingsTiltEnabled) return;
      this._tilt = { rx: 0, ry: 0, tx: 0, ty: 0, sx: 50, sy: -20, raf: 0 };
      const card = this.$refs.settingsCard;
      if (card) card.classList.add("tilt-live");
    },
    settingsTiltStop() {
      if (this._tilt && this._tilt.raf) cancelAnimationFrame(this._tilt.raf);
      this._tilt = null;
      const card = this.$refs.settingsCard;
      if (card) { card.classList.remove("tilt-live"); card.style.transform = ""; }
    },
    settingsTiltMove(e) {
      const t = this._tilt;
      if (!t) return;
      const pop = this.$refs.settingsPop, card = this.$refs.settingsCard;
      if (!pop || !card) return;
      const r = pop.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const hx = card.offsetWidth / 2 || 1, hy = card.offsetHeight / 2 || 1;
      // 距离衰减：卡片「半径」的 1.1 倍内全推力，再往外线性松手，2.6 倍处归零
      const reach = Math.hypot(hx, hy);
      const dist = Math.hypot(dx, dy);
      const k = dist <= reach * 1.1 ? 1 : Math.max(0, 1 - (dist - reach * 1.1) / (reach * 1.5));
      card.classList.toggle("tilt-live", k > 0.05);
      const MAX = 4;
      const nx = Math.max(-1.15, Math.min(1.15, dx / hx));
      const ny = Math.max(-1.15, Math.min(1.15, dy / hy));
      t.ty = nx * MAX * k;   // rotateY：鼠标在左/右，左/右边后退
      t.tx = -ny * MAX * k;  // rotateX：鼠标在上/下，上/下边后退
      t.sx = ((e.clientX - r.left) / r.width) * 100;
      t.sy = ((e.clientY - r.top) / r.height) * 100;
      if (!t.raf) t.raf = requestAnimationFrame(() => this._settingsTiltStep());
    },
    _settingsTiltStep() {
      const t = this._tilt;
      if (!t) return;
      t.raf = 0;
      t.rx += (t.tx - t.rx) * 0.12;
      t.ry += (t.ty - t.ry) * 0.12;
      const card = this.$refs.settingsCard;
      if (card) {
        card.style.transform = `rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
        card.style.setProperty("--sx", `${t.sx.toFixed(1)}%`);
        card.style.setProperty("--sy", `${t.sy.toFixed(1)}%`);
      }
      if (Math.abs(t.tx - t.rx) > 0.02 || Math.abs(t.ty - t.ry) > 0.02) {
        t.raf = requestAnimationFrame(() => this._settingsTiltStep());
      }
    },
    /* 指针离开窗口：卡片缓缓回正，而不是停在歪着的姿态 */
    settingsTiltRelax() {
      const t = this._tilt;
      if (!t) return;
      t.tx = 0;
      t.ty = 0;
      const card = this.$refs.settingsCard;
      if (card) card.classList.remove("tilt-live");
      if (!t.raf) t.raf = requestAnimationFrame(() => this._settingsTiltStep());
    },
    /* ============ 免费模型 ============ */
    /* 指定（默认当前选中）模型是否免费：调用不消耗次数 */
    isFreeModel(id) {
      const target = id || this.selectedModel;
      const m = this.models.find((x) => x.id === target);
      return !!(m && m.is_free);
    },
    /* 指定（默认当前选中）模型是否免码可用：无需使用码即可调用。
       后端下发的 free_no_code 已含 is_free 与门，免码模型必然免费 */
    isNoCodeModel(id) {
      const target = id || this.selectedModel;
      const m = this.models.find((x) => x.id === target);
      return !!(m && m.free_no_code);
    },
    /* 当前模型是否允许无码调用 */
    get modelNoCodeAllowed() {
      return this.isNoCodeModel();
    },
    /* 是否存在可无码试用的免费模型（决定首页文案与默认模型） */
    get hasFreeTrial() {
      return this.models.some((m) => m.is_free && m.free_no_code);
    },
    /* 本次调用是否真的会扣次数（用于隐藏消耗提示） */
    get willConsumeQuota() {
      if (!this.isAuthenticated) return false;
      if (this.isFreeModel()) return false;
      return true;
    },

    /* ============ 额度显示仪 ============ */
    /* 只读 authUser，不新增响应式字段；authUser 整体替换时这些 getter 自动重算 */
    get quotaRemaining() {
      const u = this.authUser;
      return u && u.remaining != null ? Math.max(0, Number(u.remaining) || 0) : 0;
    },
    get quotaTotal() {
      const u = this.authUser;
      return u && u.quota != null ? Math.max(0, Number(u.quota) || 0) : 0;
    },
    get isUnlimitedQuota() {
      return !!(this.authUser && this.authUser.is_unlimited);
    },
    get quotaPct() {
      if (this.isUnlimitedQuota) return 100;
      const t = this.quotaTotal;
      if (t <= 0) return 0;
      return Math.min(100, Math.max(0, (this.quotaRemaining / t) * 100));
    },
    /* 本次预计扣减：与 backend/app/routers/chat.py 的 quota_units 口径对齐。
       识别恒 charged_free=True（识别始终不计费）；迁移按已选题数换算；
       免费模型限额内为 0，超限转按次由后端裁定，前端不做乐观假设 */
    get quotaChargeUnits() {
      if (!this.isAuthenticated) return 0;
      if (this.isFreeModel()) return 0;
      if (this.isOcrTool) return 0;
      if (this.isMigrationTool) {
        return this.migrationSelectedCauses.length ? this.migrationChargeUnits : 0;
      }
      return 1;
    },
    /* 环上「即将被扣掉的那一段」：从当前剩余弧的末端往回量。
       真实比例在 1/100 时不足 1px，给 6% 的最小可见长度——它是示意，
       精确值在环内数字与 tooltip 里；段长永远不超过当前剩余弧。 */
    get quotaBurnPct() {
      if (this.isUnlimitedQuota) return 0;
      const n = this.quotaChargeUnits;
      const t = this.quotaTotal;
      if (!n || t <= 0 || this.quotaRemaining < n) return 0;
      return Math.min(this.quotaPct, Math.max((n / t) * 100, 6));
    },
    get quotaBurnStart() {
      return Math.max(0, this.quotaPct - this.quotaBurnPct);
    },
    get quotaBurnOn() {
      return this.quotaBurnPct > 0 && !this.streaming
        && !(this.migration && this.migration.generating)
        && !this.isUnlimitedQuota;
    },
    get quotaBurnDash() {
      const start = (this.quotaBurnStart / 100) * QUOTA_RING_C;
      const len = (this.quotaBurnPct / 100) * QUOTA_RING_C;
      return `0 ${start} ${len} ${QUOTA_RING_C}`;
    },
    get quotaRingDash() {
      const filled = (this.quotaPct / 100) * QUOTA_RING_C;
      return `${filled} ${QUOTA_RING_C}`;
    },
    get quotaLow() {
      return !this.isUnlimitedQuota && this.quotaTotal > 0 && this.quotaRemaining <= 2;
    },
    get quotaEmpty() {
      return !this.isUnlimitedQuota && this.quotaRemaining <= 0;
    },
    get quotaGaugeNum() {
      return this.isUnlimitedQuota ? "∞" : String(this.quotaRemaining);
    },
    get quotaTip() {
      if (this.isUnlimitedQuota) return "无限额度";
      const base = `剩余 ${this.quotaRemaining} 次 / 共 ${this.quotaTotal} 次`;
      if (this.isMigrationTool && !this.migrationSelectedCauses.length) return base + "；勾选错因后显示本次消耗";
      const n = this.quotaChargeUnits;
      if (!n) return base + "；本次不消耗额度";
      if (this.quotaRemaining < n) return `${base}；本次需 ${n} 次，额度不足`;
      return `${base}；本次约扣 ${n} 次，完成后剩 ${this.quotaRemaining - n} 次`;
    },
    /* 不扣次数时的提示文案（免费 / 免码模型 / 需使用码），扣次数时为空串 */
    get chargeNote() {
      if (this.willConsumeQuota) return "";
      // 未登录时只有免码模型能执行，免费但需码的模型同样要输码
      if (!this.isAuthenticated) {
        return this.modelNoCodeAllowed
          ? "免码模型，无需使用码，本次生成不消耗额度"
          : "当前模型需要输入使用码，或改选带「免码」标签的模型";
      }
      if (this.isFreeModel()) return "免费模型，限额内不消耗次数；超出后按次消耗次数";
      return "";
    },
    /* 401/403 统一处理：已登录视为本机凭证失效/额度耗尽，清掉本地登录态
       （原因由错误卡与 toast 呈现）；未登录（免码试用）则引导输入使用码，
       并把原因写进弹窗 —— toast 会被弹窗遮罩糊住，等于看不见 */
    handleAuthFailure(hint) {
      if (this.isAuthenticated) this.clearAuth();
      else this.openCodeModal(hint);
    },
    /* 执行类动作的统一门禁：已登录直接放行；无码时仅免费（无码可用）模型放行。
       提示写进使用码弹窗（toast 会被弹窗遮罩糊住，等于看不见），
       并在存在可免码试用的模型时给出替代方案 */
    ensureCanRun(message) {
      if (this.isAuthenticated || this.modelNoCodeAllowed) return true;
      const parts = [message || "请先输入使用码"];
      if (this.hasFreeTrial) parts.push("也可在模型列表切换带「免码」标签的模型直接试用");
      this.openCodeModal(parts.join("；"));
      return false;
    },
    /* 图片识别的专用门禁：它始终要有效使用码，免码试用模型在这里不适用，
       所以不能用 ensureCanRun —— 那条会把无码用户放进去，再被后端 401 挡回来，
       用户先看到的是等待窗口里的「配对已失效，请重新扫码」，而真正的原因只是没填码。
       提示一律走使用码弹窗：弹窗遮罩会把 toast 糊住，等于没说。 */
    requireCodeForOcr(message) {
      if (this.isAuthenticated) return true;
      this.openCodeModal(message || OCR_CODE_HINT);
      return false;
    },

    /* ============ API：工具与模型 ============ */
    /* 工具目录：缓存与网络返回共用这一段落盘逻辑，避免两处各写一份而漂 */
    _applyToolsData(data) {
      this.groups = data.groups || [];
      // 自由对话工具推荐卡片用：编号 → 工具（含图标/名称）的本地查表
      NBX_TOOLS_BY_ID = Object.create(null);
      for (const group of this.groups) {
        for (const tool of group.tools || []) {
          if (tool && tool.id != null) NBX_TOOLS_BY_ID[String(tool.id)] = tool;
        }
      }
      // models 为结构化列表：[{ id, name, description, aa_index, is_free, free_no_code }]
      // 后端已滤掉禁用与仅 Chores 模型，该列表长度即「可见模型数」，折叠计数以它为准
      this.models = data.models || [];
      this.maxVisibleModels = Number(data.max_visible_models) || 0;
      // 默认模型优先级：本机保存的选择 > 未登录时的免费（无码可用）模型 > 后端默认模型；
      // 无码用户若默认落在收费模型上，一执行就被要求输码，免费试用形同虚设
      const saved = localStorage.getItem(LS.model);
      const savedValid = saved && this.models.some((m) => m.id === saved) ? saved : "";
      const freeNoCode = (this.models.find((m) => m.is_free && m.free_no_code) || {}).id || "";
      this.selectedModel =
        savedValid ||
        (!this.isAuthenticated && freeNoCode ? freeNoCode : "") ||
        data.default_model ||
        (this.models[0] && this.models[0].id) ||
        "";
      this.toolsLoaded = true;
    },
    /* 先拿上次的目录顶上：/api/tools/ 在跨境线路上要一个来回（≈240ms），缓存命中时
       侧栏与首页工具网格可以跟首屏一起出现，网络数据回来后再覆盖。
       缓存只负责「先让用户看见」，权威数据始终来自 /api/tools/。 */
    _loadToolsCache() {
      if (this.toolsLoaded) return;
      const cached = lsGet(LS.toolsCache, null);
      if (!cached || !Array.isArray(cached.groups) || !cached.groups.length) return;
      this._applyToolsData(cached);
    },
    _saveToolsCache(data) {
      if (!data || !Array.isArray(data.groups) || !data.groups.length) return;
      lsSet(LS.toolsCache, {
        groups: data.groups,
        models: data.models,
        default_model: data.default_model,
        max_visible_models: data.max_visible_models,
      });
    },
    async loadTools() {
      this.toolsError = "";
      try {
        const res = await fetch("/api/tools/", {
          headers: this.authHeaders(),
        });
        if (!res.ok) {
          if (res.status === 401) {
            this.clearAuth();
            this.toolsError = "请先输入使用码";
            this.openCodeModal("工具列表需要登录后加载，请先输入使用码");
            return;
          }
          throw new Error("HTTP " + res.status);
        }
        const data = await res.json();
        this._applyToolsData(data);
        this._saveToolsCache(data);
      } catch (e) {
        // 缓存已经把列表渲染出来了就别用错误态顶掉它：下次请求成功会自动覆盖
        if (!this.toolsLoaded) {
          this.toolsError = "工具列表加载失败，请确认后端服务已启动。";
          this.toolsLoaded = false;
        }
      }
    },

    get allModels() {
      return [...this.models];
    },

    // 下拉里实际渲染的模型：超出后台配置上限时折叠为前 N 个，展开后与 allModels 一致
    get visibleModels() {
      const limit = this.maxVisibleModels;
      if (!limit || this.modelsExpanded || this.models.length <= limit) return [...this.models];
      return this.models.slice(0, limit);
    },
    get modelsCollapsible() {
      return this.maxVisibleModels > 0 && this.models.length > this.maxVisibleModels;
    },

    /* ============ 工具选择 ============ */
    findTool(id) {
      for (const g of this.groups) {
        const t = (g.tools || []).find((t) => t.id === String(id));
        if (t) return t;
      }
      return null;
    },

    async selectTool(tool, ev) {
      // 工具列表与工具界面始终可预览；是否需要使用码在执行时按所选模型判定
      if (this.isBusy) {
        const ok = await this.askConfirm({
          title: "停止本次生成？",
          message: "正在生成中，切换工具将停止本次生成。",
          confirmText: "停止并切换",
          danger: true,
        });
        if (!ok) return;
        this.stopBusyStreams();
      }
      const el = ev && ev.currentTarget ? ev.currentTarget : null;
      /* 换工具的状态落位：收起搜索面板、清空输出与各类暂存，然后把输入区
         高度与新尺寸对齐。抽成闭包是因为动画路径下它要等旧快照拍完再执行
         （见 animateToolSwitch）——这份逻辑要么整体发生，要么不发生。 */
      const apply = () => {
        // 进了工具就收起搜索面板（用户写的那句话留着，回来还能接着改）
        this.closeToolSearch();
        this.currentTool = tool;
        this.output = "";
        this.rendered = "";
        this.outputFoldEligible = false;  // 切工具后展示的是新内容，清掉历史折叠态
        this.errorMsg = "";
        this.failedModel = "";
        // 换工具即与上一条记录脱钩：续写/重试不能再写回别的工具的记录
        this.activeHistoryId = null;
        this.status = "idle";
        this.maskOn = false;
        this.resetReasoning();
        this.leftOpen = false;
        this.inputCollapsed = false;
        this.submittedInput = "";
        this.submittedFileName = "";
        this.submittedExpanded = false;
        this.resetMigration();
        this.resetVocab();
        this.resetVisualPaper();
        this.resetOcr();
        this.resetTranslate();
        this.$nextTick(() => {
          this.autoGrow();
          if (this.isTranslateTool) {
            this.trGrow();
            this.trScrollTop();
          }
          this.scheduleMascotCheck(80);
        });
      };

      /* 自由对话里的工具推荐卡片：点它是一次「跳转」而不是高频的切换，
         值得一段「徽章飞行」过渡（卡片图标飞向目标工具头部徽章）。
         其余入口（侧栏、搜索结果）保持即时切换，不打扰连续操作 */
      const fromCard = !!(el && el.classList && el.classList.contains("nbx-tool-link"));
      if (!fromCard) {
        apply();
      } else {
        const env = {
          startViewTransition: typeof document.startViewTransition === "function",
          reducedMotion: !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
        };
        if (toolSwitchTransitionsOk(env)) {
          this.animateToolSwitch(el, apply);
        } else {
          apply();
          // 没有 View Transitions 的浏览器退化为「新界面轻量淡入」；减少动态效果则纯切换
          if (!env.reducedMotion) this._enterToolViewFallback();
        }
      }

      if (el && this._bg) {
        const r = el.getBoundingClientRect();
        this._bg.attract(r.left + r.width * 0.5, r.top + r.height * 0.5);
      }
    },

    /* ---------- 卡片 → 工具 的「徽章飞行」过渡 ----------
       把一次切换拆成三段：起飞（注入飞行徽章）→ 换景（View Transitions
       窗口内落位新工具）→ 落定（脉冲 + 清理）。过渡期间控制权在浏览器的
       快照层，这里只在窗口边界插手，全程不做逐帧 JS。
       任何一步失败都退回「直接切换」，绝不把用户撂在半路。 */
    animateToolSwitch(anchorEl, apply) {
      const seq = (this._toolFxSeq += 1);
      // 兜底清理上一代可能残留的痕迹（连点 / 异常中断）
      this.clearToolSwitchFx();

      let ghost = null;
      let ico = null;
      let landed = null;
      let oldRoot = null;
      try {
        const wideOk = !window.matchMedia || window.matchMedia(TOOL_FLY_MIN_VIEWPORT).matches;
        ico = anchorEl && anchorEl.querySelector ? anchorEl.querySelector(".nbx-tool-link-ico") : null;
        const r = ico && ico.getBoundingClientRect ? ico.getBoundingClientRect() : null;
        if (wideOk && r && r.width > 0) {
          const pos = toolSwitchFlightRect(r, TOOL_FLY_BADGE_PX, window.innerWidth, window.innerHeight);
          ghost = document.createElement("span");
          ghost.className = "nbx-flight-badge";
          ghost.setAttribute("data-nbx-fly-ghost", "");
          ghost.style.left = pos.left + "px";
          ghost.style.top = pos.top + "px";
          ghost.innerHTML = ico.innerHTML;  // 沿用卡片那颗图标；渐变底与光晕由样式给出
          nbxNameViewTransition(ghost, TOOL_FLY_NAME);
          document.body.appendChild(ghost);
          ico.setAttribute("data-nbx-fly-ico", "");
          ico.style.visibility = "hidden";  // 旧快照里只留飞行徽章，避免双图标
        }
        if (anchorEl && anchorEl.classList) anchorEl.classList.add("nbx-link-launch");
      } catch (err) {
        // 起飞准备失败：收拾干净后直接切换，动画不能成为功能的前置条件
        this.clearToolSwitchFx();
        apply();
        return;
      }
      // 旧端的内容容器（与目标工具同属 .tool-view-root；两边皆可见时是同一节点）
      oldRoot = this._toolViewRoot();
      nbxNameViewTransition(oldRoot, TOOL_MAIN_NAME);

      let vt = null;
      try {
        vt = document.startViewTransition(async () => {
          // 旧快照已拍完：卸掉飞行徽章，让新快照里没有它（图像已被快照接手）
          if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
          try { apply(); } catch (err) { console.error("切换工具出错：", err); }
          // 等 Alpine 渲染出新界面，再把命名挂到新端的容器与头部徽章上。
          // 微任务循环足够（x-if 渲染在一个 tick 内完成），拿到即走
          for (let i = 0; i < 4; i += 1) {
            await this.$nextTick();
            landed = this._toolHeadBadge();
            if (landed) break;
          }
          nbxNameViewTransition(this._toolViewRoot(), TOOL_MAIN_NAME);
          nbxNameViewTransition(landed, TOOL_FLY_NAME);
        });
      } catch (err) {
        // VT 起不来：回到地面，直接切换
        this.clearToolSwitchFx();
        apply();
        return;
      }
      const settle = () => {
        // 只有最新一代负责收尾：旧代被连点打断时，它的痕迹已由新一代的
        // 启动清理收走，这里再动手会误伤正在播的过渡
        if (seq !== this._toolFxSeq) return;
        this.clearToolSwitchFx();
        this._pulseToolBadge(landed);
      };
      vt.finished.then(settle, settle);  // 中途被 skip 走 reject 分支，同样要收尾
    },

    /* 清理「徽章飞行」的全部痕迹（幂等）：飞行徽章、被隐藏的卡片图标、
       view-transition-name 命名、卡片点亮。过渡结束与再次启动前各调一次 */
    clearToolSwitchFx() {
      document.querySelectorAll("[data-nbx-fly-ghost]").forEach((el) => el.remove());
      document.querySelectorAll("[data-nbx-fly-ico]").forEach((el) => {
        el.style.visibility = "";
        el.removeAttribute("data-nbx-fly-ico");
      });
      document.querySelectorAll("[data-nbx-vt]").forEach((el) => {
        el.style.viewTransitionName = "";
        el.removeAttribute("data-nbx-vt");
      });
      document.querySelectorAll(".nbx-tool-link.nbx-link-launch").forEach((el) => el.classList.remove("nbx-link-launch"));
    },

    /* 当前可见的工具界面根（欢迎页与六种工作区共用 .tool-view-root，同一
       时刻只有一个可见；display:none 的元素没有 client rect） */
    _toolViewRoot() {
      const panel = this.$refs && this.$refs.mainPanel;
      if (!panel || !panel.querySelectorAll) return null;
      for (const el of panel.querySelectorAll(".tool-view-root")) {
        if (el.getClientRects().length) return el;
      }
      return null;
    },

    /* 目标工具的头部徽章（飞行终点）。窄档头部藏起徽章，拿不到就退化为无飞行 */
    _toolHeadBadge() {
      const panel = this.$refs && this.$refs.mainPanel;
      const badge = panel && panel.querySelector ? panel.querySelector(".tool-head-badge") : null;
      return badge && badge.getClientRects().length ? badge : null;
    },

    /* 落定脉冲：加类触发一次缩放 + 光圈，动画走完（或超时兜底）摘掉 */
    _pulseToolBadge(badge) {
      if (!badge || !badge.classList) return;
      badge.classList.remove("nbx-badge-land");
      void badge.offsetWidth;  // 强制重排，连点场景下也能重新触发动画
      badge.classList.add("nbx-badge-land");
      clearTimeout(badge._nbxLandTimer);
      badge._nbxLandTimer = setTimeout(() => {
        badge.classList.remove("nbx-badge-land");
        badge._nbxLandTimer = null;
      }, TOOL_FLY_MS + 240);
    },

    /* 降级入场：没有 View Transitions 时，新界面轻量淡入一次 */
    _enterToolViewFallback() {
      this.$nextTick(() => {
        const root = this._toolViewRoot();
        if (!root || !root.classList) return;
        root.classList.add("nbx-view-enter");
        clearTimeout(root._nbxEnterTimer);
        root._nbxEnterTimer = setTimeout(() => {
          root.classList.remove("nbx-view-enter");
          root._nbxEnterTimer = null;
        }, TOOL_FLY_MS + 40);
      });
    },

    async goHome() {
      if (this.isBusy) {
        const ok = await this.askConfirm({
          title: "停止本次生成？",
          message: "正在生成中，返回首页将停止本次生成。",
          confirmText: "停止并回首页",
          danger: true,
        });
        if (!ok) return;
        this.stopBusyStreams();
      }
      this.closeToolSearch();
      this.currentTool = null;
      this.leftOpen = false;
      this.activeHistoryId = null;
      this.resetReasoning();
      this.resetOcr();
      this.resetTranslate();
      // 可视化全解也必须重置：vpCloseFullscreen 是恢复 documentElement 滚动锁的
      // 唯一路径，漏掉它会让生成中回首页的页面永久不能滚，且 vpTasks/vpStage 残留。
      this.resetVisualPaper();
      this.scheduleMascotCheck(80);
    },

    startFirst() {
      // 未登录也能先逛工具：直接把用户带进第一个工具（执行时再按模型判定是否需码）
      const first = this.groups.flatMap((g) => g.tools || [])[0];
      if (this.isCompact) {
        this.leftOpen = true;
      } else if (first) {
        this.selectTool(first);
      } else {
        this.toast("工具列表还没加载好，请稍候或点左侧「重新加载」", "warn");
      }
    },

    /* ============ 描述需求找工具（Jev choice） ============
       交互契约（与后端 tool_search.py 的注释成对）：
       1. 不要求按 Enter：最后一次输入后静默 PAUSE_MS 视为「有意停顿」，自动发请求；
          waiting 期间面板顶部有一条进度条走满，用户看得见「停一下就会搜」。
       2. 以句读标点/空白结尾或粘贴 → 短窗后立即发（粘贴是一次明确的动作）。
       3. 输入一变：在途请求立刻掐断（本地第二层兜底），重新计时，再发新的一次。
       4. 中文输入法组字期间（composition）绝不发请求，落字之后才开始计时。
       5. 同一句话不重复打 Jev（去重）；后端也可能命中自己的缓存。 */
    get toolSearchPanelOpen() {
      return this.toolSearchOpen && this.toolSearchState !== "idle";
    },
    get toolSearchSidebarOpen() {
      return this.toolSearchPanelOpen && this.toolSearchAnchor === "sidebar";
    },
    get toolSearchHomeOpen() {
      return this.toolSearchPanelOpen && this.toolSearchAnchor === "home";
    },
    /* 侧栏面板打开时让出列表位置：候选就是此刻要找的东西，两份列表叠着看反而难选 */
    get toolSearchShowGroups() {
      return !this.toolSearchSidebarOpen;
    },
    get toolSearchCanPick() {
      return this.toolSearchState === "results" && this.toolSearchResults.length > 0;
    },
    /* 模板里读的示例清单。之所以要经由 getter：TOOL_SEARCH_EXAMPLES 是模块作用域的
       const，不会挂到 window 上，Alpine 表达式（在全局作用域求值）读不到它 */
    get toolSearchExamples() {
      return TOOL_SEARCH_EXAMPLES;
    },
    get toolSearchPlaceholder() {
      return this.toolSearchExample
        ? `用一句话说说你想做什么，例如「${this.toolSearchExample}」`
        : "用一句话说说你想做什么";
    },

    onToolSearchFocus(anchor) {
      this.toolSearchAnchor = anchor;
      this.startToolSearchExamples();
      if (this.toolSearchQuery.trim()) {
        this.toolSearchOpen = true;
        if (this.toolSearchState === "idle") this.toolSearchState = "waiting";
      }
    },
    onToolSearchBlur() {
      // 面板不因失焦关闭：点候选的那一下会先失焦，关在这里就永远点不中
      this.stopToolSearchExamples();
    },
    /* 输入法组字开始：停表，组字中间一个请求都不发 */
    onToolSearchCompositionStart() {
      this._toolSearchComposing = true;
      clearTimeout(this._toolSearchTimer);
      this._toolSearchTimer = null;
    },
    onToolSearchCompositionEnd(ev) {
      this._toolSearchComposing = false;
      // 直接读 DOM：x-model 对组字的落字也可能晚于本事件，读状态会差一个字
      const value = ev && ev.target ? ev.target.value : this.toolSearchQuery;
      this.toolSearchQuery = value;
      this.armToolSearch({ early: toolSearchLooksFinal(value) });
    },
    onToolSearchInput(ev) {
      if (this._toolSearchComposing) return;
      const value = ev && ev.target ? ev.target.value : this.toolSearchQuery;
      this.toolSearchQuery = value;
      this.armToolSearch({ early: toolSearchLooksFinal(value) });
    },
    onToolSearchPaste() {
      // 粘贴：等落字完成再计时（这一步通常是零延迟的），用短窗
      this.$nextTick(() => {
        if (this._toolSearchComposing) return;
        this.armToolSearch({ early: true });
      });
    },

    /* 重新计时（并作废在途请求）：输入每变一次都走这里 */
    armToolSearch({ early = false } = {}) {
      clearTimeout(this._toolSearchTimer);
      this._toolSearchTimer = null;
      this.abortToolSearch();
      const value = (this.toolSearchQuery || "").trim();
      if (!value) {
        this.toolSearchState = "idle";
        this.toolSearchOpen = false;
        this.toolSearchResults = [];
        this.toolSearchMeta = { fallback: false, no_match: false, uncertain: false, offline: false, jev: false };
        this._toolSearchFired = "";
        return;
      }
      this.toolSearchOpen = true;
      this.toolSearchState = "waiting";
      this.toolSearchArm += 1;
      const delay = early ? this.toolSearchEarlyMs : this.toolSearchPauseMs;
      this._toolSearchTimer = setTimeout(() => {
        this._toolSearchTimer = null;
        this.fireToolSearch();
      }, delay);
    },

    abortToolSearch() {
      if (this._toolSearchAbort) {
        try { this._toolSearchAbort.abort(); } catch { /* 已经结束的请求：忽略 */ }
        this._toolSearchAbort = null;
      }
      // 序号推前：迟到的回包一律作废（无论它是成功还是失败）
      this._toolSearchSeq += 1;
    },

    async fireToolSearch() {
      const value = (this.toolSearchQuery || "").trim();
      if (value.length < TOOL_SEARCH_MIN_CHARS) {
        this.toolSearchState = "idle";
        return;
      }
      if (value.length > TOOL_SEARCH_MAX_CHARS) {
        this.toolSearchState = "long";
        return;
      }
      if (value === this._toolSearchFired && this.toolSearchResults.length) {
        this.toolSearchState = "results";
        return;
      }

      this.abortToolSearch();
      const seq = (this._toolSearchSeq += 1);
      this._toolSearchFired = value;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      this._toolSearchAbort = controller;
      this.toolSearchState = "searching";
      try {
        const res = await fetch("/api/tools/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ query: value, limit: TOOL_SEARCH_LIMIT }),
          signal: controller ? controller.signal : undefined,
        });
        if (seq !== this._toolSearchSeq) return;
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (seq !== this._toolSearchSeq) return;
        this.applyToolSearchResults(data);
      } catch (e) {
        if (e && e.name === "AbortError") return;   // 自己掐断的：不是错误
        if (seq !== this._toolSearchSeq) return;
        // 第二层兜底：后端不可达时用本地关键词匹配，控件任何时候都不空转
        this.applyToolSearchResults({
          results: toolSearchKeywordMatch(this.groups, value, TOOL_SEARCH_LIMIT),
          fallback: true,
          no_match: false,
          uncertain: false,
          offline: true,
        });
      } finally {
        if (seq === this._toolSearchSeq) this._toolSearchAbort = null;
      }
    },

    applyToolSearchResults(data) {
      this.toolSearchResults = (data && data.results) || [];
      this.toolSearchMeta = {
        fallback: !!(data && data.fallback),
        no_match: !!(data && data.no_match),
        uncertain: !!(data && data.uncertain),
        offline: !!(data && data.offline),
        jev: !!(data && data.jev_available),
      };
      this.toolSearchActive = 0;
      this.toolSearchOpen = true;
      this.toolSearchState = "results";
    },

    onToolSearchKeydown(ev) {
      const key = ev.key;
      if (key === "ArrowDown" || key === "ArrowUp") {
        if (!this.toolSearchResults.length) return;
        ev.preventDefault();
        const count = this.toolSearchResults.length;
        const step = key === "ArrowDown" ? 1 : -1;
        this.toolSearchActive = (this.toolSearchActive + step + count) % count;
        return;
      }
      if (key === "Enter") {
        // Enter 是加速键、不是必需：有结果就进最合适那个，还没搜就先搜
        ev.preventDefault();
        if (this.toolSearchCanPick) {
          this.pickToolSearchResult(this.toolSearchResults[this.toolSearchActive], ev);
        } else {
          clearTimeout(this._toolSearchTimer);
          this._toolSearchTimer = null;
          this.fireToolSearch();
        }
        return;
      }
      if (key === "Escape") {
        ev.preventDefault();
        this.closeToolSearch();
      }
    },

    pickToolSearchResult(row, ev) {
      if (!row) return;
      const tool = this.findTool(row.tool_id);
      if (!tool) {
        this.toast("这个工具当前不可用，请重新加载工具列表", "warn");
        return;
      }
      this.clearToolSearch();
      this.selectTool(tool, ev);
    },

    /* 一个都没匹上时的出口：带着原话去「自由对话」，不把用户丢在空结果上 */
    gotoFreeformTool(ev) {
      const free = this.findTool(FREEFORM_TOOL_ID);
      if (!free) {
        this.toast("工具列表还没加载好，请稍候或点左侧「重新加载」", "warn");
        return;
      }
      const question = (this.toolSearchQuery || "").trim();
      this.clearToolSearch();
      this.selectTool(free, ev);
      // 把刚才那句话带进去（用户本来就在描述需求）；已经写了内容的绝不覆盖
      if (question && !(this.input || "").trim()) this.input = question;
    },

    /* 示例 chip：点一下即填即搜（是用户明确的动作，不必再等停顿） */
    useToolSearchExample(example) {
      this.toolSearchQuery = example;
      this.toolSearchOpen = true;
      this.toolSearchState = "waiting";
      this.toolSearchArm += 1;
      this.abortToolSearch();
      this._toolSearchFired = "";
      this.fireToolSearch();
    },

    /* 收面板但留着用户写的那句话（换工具、回首页走这条） */
    closeToolSearch() {
      clearTimeout(this._toolSearchTimer);
      this._toolSearchTimer = null;
      this.abortToolSearch();
      this.toolSearchOpen = false;
      if (this.toolSearchState !== "idle") this.toolSearchState = "idle";
    },

    /* 连输入一起清空（选中结果、进工具之后走这条） */
    clearToolSearch() {
      this.closeToolSearch();
      this.toolSearchQuery = "";
      this.toolSearchResults = [];
      this.toolSearchActive = 0;
      this._toolSearchFired = "";
      this.toolSearchMeta = { fallback: false, no_match: false, uncertain: false, offline: false, jev: false };
    },

    startToolSearchExamples() {
      this.stopToolSearchExamples();
      if (!TOOL_SEARCH_EXAMPLES.length) return;
      let index = Math.floor(Math.random() * TOOL_SEARCH_EXAMPLES.length);
      this.toolSearchExample = TOOL_SEARCH_EXAMPLES[index];
      this._toolSearchExampleTimer = setInterval(() => {
        index = (index + 1) % TOOL_SEARCH_EXAMPLES.length;
        this.toolSearchExample = TOOL_SEARCH_EXAMPLES[index];
      }, 3200);
    },

    stopToolSearchExamples() {
      if (this._toolSearchExampleTimer) {
        clearInterval(this._toolSearchExampleTimer);
        this._toolSearchExampleTimer = null;
      }
    },

    /* 面板顶部文案：把「为什么是这个结果」说清楚，否则用户不知道能不能信 */
    toolSearchPanelTitle() {
      if (this.toolSearchState === "searching") return "正在理解你的需求…";
      if (this.toolSearchState === "long") return "这句话有点长，看着像正文";
      if (this.toolSearchState === "waiting") {
        return this.toolSearchQuery.trim().length < TOOL_SEARCH_MIN_CHARS
          ? "再多说几个字，例如「批改这篇作文」"
          : "停一下就会自动搜索…";
      }
      if (this.toolSearchMeta.no_match) return "没有完全对口的工具，这几个最接近";
      if (this.toolSearchMeta.offline) return "网络不通，按关键词匹配";
      if (this.toolSearchMeta.fallback) return "未启用智能匹配，按关键词匹配";
      if (this.toolSearchMeta.uncertain) return "不太确定，这几个可能合适";
      return "最合适的工具";
    },

    /* ============ 分组折叠 ============ */
    toggleGroup(id) {
      this.collapsedGroups[id] = !this.collapsedGroups[id];
      this.persistUI();
    },

    /* ============ 主题 ============ */
    setTheme(id) {
      if (id === this.theme) {
        // 重复点击当前主题：不转场，仅校准一次天空时段（便于调试两时段）
        this.updateSkyPeriod();
        return;
      }
      // 悠空独占的云扫转场：进入或离开悠空时，一朵云扫过屏幕，扫至满屏时换肤
      const involvesSora = id === "sora" || this.theme === "sora";
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (involvesSora && !reduced) {
        this.playSkySweep(() => this._applyThemeNow(id));
      } else {
        this._applyThemeNow(id);
      }
    },
    _applyThemeNow(id) {
      this.theme = id;
      this.applyTheme();
      try { localStorage.setItem(LS.theme, id); } catch {}
      if (this._bg) this._bg.themeChanged();
      // 本地主动换主题 → 登记偏好同步；对端推来的应用走 _mirrorApplyPrefs，
      // 那里置了 applyingRemote，不会回写（防同值 ping-pong）
      if (!_mirror.applyingRemote) this._mirrorSetPref("theme", id);
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
      this.updateSkyPeriod();
      this.updateFavicon();
    },
    /* 悠空 · 两时段天空：白昼 6-22 / 星夜 22-6
       调试可用 URL hash 强制锁定时段，如 #sky=day（改 hash 后一分钟内生效，重新点主题圆点立即生效） */
    skyPeriod() {
      const m = (location.hash || "").match(/sky=(day|night)/);
      if (m) return m[1];
      const h = new Date().getHours();
      return h >= 6 && h < 22 ? "day" : "night";
    },
    updateSkyPeriod() {
      const de = document.documentElement;
      if (this.theme !== "sora") {
        if (de.dataset.sky) delete de.dataset.sky;
        return;
      }
      const p = this.skyPeriod();
      if (de.dataset.sky !== p) {
        de.dataset.sky = p;
        if (this._bg) this._bg.themeChanged();
      }
    },
    updateFavicon() {
      const link = document.querySelector('link[rel="icon"]');
      if (!link) return;
      if (!this._faviconDefault) this._faviconDefault = link.href;
      link.href = this.theme === "sora" ? FAVICON_SORA : this._faviconDefault;
    },
    playSkySweep(midCallback) {
      const el = this.$refs.skySweep;
      if (!el) { midCallback(); return; }
      // 世代计数：连续切主题时，前一次转场的收尾定时器不得误摘后一次的动画类
      this._sweepGen = (this._sweepGen || 0) + 1;
      const gen = this._sweepGen;
      el.classList.remove("run");
      void el.offsetWidth;
      el.classList.add("run");
      setTimeout(midCallback, 520);
      setTimeout(() => { if (gen === this._sweepGen) el.classList.remove("run"); }, 1450);
    },
    /* 悠空 · 暗线：双击兔子，自动切入 / 切回 */
    mascotSecretTap() {
      if (this.theme === "sora") {
        this.setTheme(this._preSoraTheme && this._preSoraTheme !== "sora" ? this._preSoraTheme : "paper");
      } else {
        this._preSoraTheme = this.theme;
        this.setTheme("sora");
      }
    },

    /* ============ 模型下拉 ============ */
    chooseModel(m) {
      this.selectedModel = m;
      this.modelMenuOpen = false;
      // 收起列表状态：下次打开回到折叠态，而不是停在上次的展开态
      this.modelsExpanded = false;
      try { localStorage.setItem(LS.model, m); } catch {}
      if (!_mirror.applyingRemote) this._mirrorSetPref("model", m);
    },
    toggleModelMenu() {
      this.modelMenuOpen = !this.modelMenuOpen;
      if (!this.modelMenuOpen) this.modelsExpanded = false;
      else this.$nextTick(() => this.positionModelMenu());
    },
    closeModelMenu() {
      this.modelMenuOpen = false;
      this.modelsExpanded = false;
    },
    /* 打击级别科普弹窗：从模型下拉/重试弹窗里的「等级说明」入口打开 */
    openStrikeGuide() {
      this.closeModelMenu();
      this.retryModelOpen = false;
      this.strikeGuideOpen = true;
    },
    closeStrikeGuide() {
      this.strikeGuideOpen = false;
    },
    /* 手机档浮层落位（≤640px 时 CSS 放平 .ms-wrap，.ms-menu 的包含块变成
       mainPanel 玻璃面板，仿 positionVpSettings）：与触发器右对齐、下方 8px，
       左右各留 8px 在面板内夹取，底部放不下就上移。坐标必须按面板算而不是
       视口——面板带 backdrop-filter + overflow:hidden，视口坐标会整体偏移、
       右缘被裁。桌面档保持 CSS 右锚定，内联 left/top 要清掉，免得手机上开过
       一次、转屏到宽屏后残留的内联样式污染绝对定位。
       x-if 模板保证同一时刻 DOM 里只有当前工具那份 .ms-menu。 */
    positionModelMenu() {
      const menu = document.querySelector(".ms-menu");
      if (!menu) return;
      if (!this.modelMenuOpen || !window.matchMedia("(max-width: 640px)").matches) {
        menu.style.left = "";
        menu.style.top = "";
        return;
      }
      const panel = this.$refs.mainPanel;
      const wrap = menu.closest(".ms-wrap");
      const trigger = wrap && wrap.querySelector(".ms-trigger");
      if (!panel || !trigger) return;
      const pr = panel.getBoundingClientRect();
      const r = trigger.getBoundingClientRect();
      const w = menu.offsetWidth || 248;
      const h = menu.offsetHeight || 320;
      // 包含块是面板的 padding box，border box 差 1px 边框，忽略不计
      menu.style.left = Math.round(Math.max(8, Math.min(r.right - pr.left - w, pr.width - w - 8))) + "px";
      menu.style.top = Math.round(Math.max(8, Math.min(r.bottom - pr.top + 8, pr.height - h - 8))) + "px";
    },

    /* ============ UI 持久化 ============ */
    persistUI() {
      lsSet(LS.ui, {
        collapsedGroups: this.collapsedGroups,
        rightCollapsed: this.rightCollapsed,
        rightTab: this.rightTab,
        vpChromePinned: this.vpChromePinned,
        mascotHidden: this.mascotHidden,
        contentScale: this.contentScale,
      });
    },
    setRightTab(tab) {
      this.rightTab = tab;
      this.persistUI();
    },
    toggleRight() {
      if (!this.isCompact) {
        this.rightCollapsed = !this.rightCollapsed;
        this.persistUI();
      } else {
        this.rightMobileOpen = !this.rightMobileOpen;
      }
    },

    /* ============ 输入区 ============ */
    /* 已提交输入卡片：短输入没有折叠入口，直接当展开态用（见 submittedNeedsFold） */
    get submittedFoldable() {
      return submittedNeedsFold(this.submittedInput);
    },
    get submittedOpen() {
      return !this.submittedFoldable || this.submittedExpanded;
    },
    /* 输入坞的初始高度：模板渲染时就落定，不播动画（生成中/已收起 = 直接 0 高）。
       transition 先置 none 再于下一帧交还，避免挂载那一下被过渡成一次闪现。 */
    dockMount(el, open) {
      if (!el) return;
      // 收起的坞只是被裁成 0 高，内容仍在无障碍树里，用 inert 挡掉 Tab 与点击
      el.inert = !open;
      if (open) return;
      el.style.transition = "none";
      el.style.height = "0px";
      requestAnimationFrame(() => { el.style.transition = ""; });
    },
    /* 输入坞收起 / 展开：显式量高 → 交给 .dock 的 transition。
       目标高度取内层（普通块盒）的自然高度：它被外层 overflow:hidden 裁剪，
       但自身布局高度不受外层高度影响，所以在收起状态下也能量准。
       中途反向（如刚发出去就停止）会从当前动画高度接着走，不会跳。 */
    _animateDock(el, open) {
      if (!el) return;
      const inner = el.firstElementChild;
      if (!inner) return;
      clearTimeout(el._dockTimer);
      const from = el.getBoundingClientRect().height;
      const target = open ? inner.getBoundingClientRect().height : 0;
      el.inert = !open;
      el.classList.toggle("is-open", open);
      el.style.height = from + "px";
      void el.offsetHeight;  // 先固定起点：同帧两次赋值会被合并，过渡就没有起点了
      el.style.height = target + "px";
      // 展开期间避让区（输入区）位置每帧都在变，mascot 的空间判定
      // 推迟到过渡结束后（scheduleMascotCheck 里读），避免基于中间态判定
      if (open) this._mascotQuietUntil = Date.now() + 620;
      el._dockTimer = setTimeout(() => {
        el._dockTimer = null;
        if (open) el.style.height = "";  // 交回自动高度，之后内容变化仍能自适应
      }, 560);
    },
    /* 输入坞的目标状态：未折叠且不在生成中才展开（「开始新题目」已移到状态条，坞里只有输入面板） */
    syncDocks() {
      this.$nextTick(() => {
        const dock = this.isVisualPaperTool ? this.$refs.vpDockComposer : this.$refs.dockComposer;
        this._animateDock(dock, !this.inputCollapsed && !this.streaming);
      });
    },
    autoGrow() {
      const el = this.$refs.inputEl;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 240) + "px";
    },
    clearInput() {
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";
      this.$nextTick(() => this.autoGrow());
    },
    shakeComposer() {
      const el = this.$refs.composer;
      if (!el) return;
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    },

    /* ============ 文件上传 ============ */
    handleFileSelect(ev) {
      const file = ev.target.files && ev.target.files[0];
      if (file) {
        // accept 过滤器能在系统文件对话框里被切成「所有文件」：图片仍拦下来，
        // 指去「没有原稿，需要拍照」那条路，避免和相册入口重叠
        const name = file.name || "";
        const dot = name.lastIndexOf(".");
        const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
        if (isImageFile(file, ext)) {
          this.toast("图片请从「没有原稿，需要拍照」进入", "warn");
        } else {
          this.readFileContent(file);
        }
      }
      ev.target.value = "";
    },
    handleFileDrop(ev) {
      this.dragOver = false;
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) this.readFileContent(file);
    },
    removeAttachedFile() {
      try { if (this._pdfAbort) this._pdfAbort.abort(); } catch {}
      this._pdfAbort = null;
      this._stopParseTimer();
      this.parsingFile = false;
      this.parseElapsed = "";
      this.parseElapsedSec = 0;
      this.pendingPdfFile = null;
      this.scanWarnOpen = false;
      this.scanConfirming = false;
      this.attachedFile = null;
      this.input = "";
      this.inputMode = "text";
      this.$nextTick(() => this.autoGrow());
    },
    openUploadError(title, msg, detail) {
      this.uploadErrorTitle = title || "文件上传失败";
      this.uploadErrorMsg = msg || "文件上传失败，请重试。";
      this.uploadErrorDetail = detail || "";
      this.showUploadDetail = false;
      this.uploadErrorOpen = true;
    },
    closeUploadError() {
      this.uploadErrorOpen = false;
    },
    _uploadErrDetail(file, extra) {
      const nm = (file && file.name) || (typeof file === "string" ? file : "") || "未知文件";
      const size = file && file.size ? " · 大小：" + this.formatFileSize(file.size) : "";
      return `文件名：${nm}${size}${extra ? " · " + extra : ""}`;
    },
    reselectPdfFile() {
      // 警告弹窗的“重新选择文件”：关闭弹窗并唤起文件选择（走来源弹窗里的文档入口，
      // 不再按“第一个可见 file input”去猜——页面上的图片入口有好几个）
      this.scanWarnOpen = false;
      this.scanConfirming = false;
      this.$nextTick(() => {
        const el = this.$refs.uploadFileInput;
        if (el) el.click();
      });
    },
    async confirmScanContinue() {
      if (this.scanConfirming) return;
      const file = this.pendingPdfFile;
      if (!file) { this.scanWarnOpen = false; return; }
      this.scanConfirming = true;
      try {
        await this._uploadPdf(file, true);
      } finally {
        this.scanConfirming = false;
      }
    },
    cancelPdfUpload() {
      // 解析进度弹窗的“取消”：中断前端等待并复位状态；
      // 服务端任务会自然超时结束，不再回填结果
      try { if (this._pdfAbort) this._pdfAbort.abort(); } catch {}
      this._pdfAbort = null;
      this._stopParseTimer();
      this.parsingFile = false;
      this.parsingLabel = "";
      this.pendingPdfFile = null;
      this.scanConfirming = false;
    },
    _stopParseTimer() {
      try { if (this._parseTimer) clearInterval(this._parseTimer); } catch {}
      this._parseTimer = null;
    },
    formatParseElapsed(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      if (s < 60) return `${s}秒`;
      return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
    },
    async loadParseConfig() {
      try {
        const res = await fetch("/api/parse/config");
        const data = await res.json();
        if (data && data.limits) this.parseConfig = data;
      } catch {}
    },
    async readFileContent(file) {
      const name = file.name || "";
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
      // 图片（含拖拽进来的）：不走文档解析，直接进图片识别
      if (isImageFile(file, ext)) {
        if (this.parsingFile) {
          this.toast("文件正在解析中，请稍候", "warn");
          return;
        }
        // 图片一律进图片识别：那条链路要使用码，先要码，再收图
        if (!this.requireCodeForOcr(OCR_CODE_HINT)) return;
        this.ocrHost = this.isOcrTool ? "tool" : "modal";
        await this.acceptOcrImages([file]);
        return;
      }
      // 识别图片文字这个工具只做「照片 → 文字」：已经有原稿的文件没有转过一道的必要，
      // 直接说清楚，而不是把解析结果塞进一个它根本没渲染的输入框
      if (this.isOcrTool) {
        this.toast("本工具只处理图片，Word / PDF / 文本请直接在相应工具中使用", "warn");
        return;
      }
      const LOCAL = ["txt", "md", "markdown", "docx", "doc"];
      const REMOTE = ["pdf"];
      if (!ext) {
        this.openUploadError("不支持的文件格式", "文件缺少扩展名。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。", this._uploadErrDetail(name, "未检测到扩展名"));
        return;
      }
      if (!LOCAL.includes(ext) && !REMOTE.includes(ext)) {
        this.openUploadError("不支持的文件格式", `暂不支持“${ext}”格式。请上传 PDF / Word（.docx）/ TXT / Markdown 文件。`, this._uploadErrDetail(name, "扩展名：" + ext));
        return;
      }
      if (!file.size) {
        this.openUploadError("文件上传失败", "文件为空，无法读取。请检查文件后重试。", this._uploadErrDetail(file, "文件为空"));
        return;
      }
      if (this.parsingFile) {
        this.toast("文件正在解析中，请稍候", "warn");
        return;
      }
      this.parseElapsed = "";
      if (REMOTE.includes(ext)) {
        await this._uploadPdf(file, false);
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        this.openUploadError("文件上传失败", "文件超过 20MB，请拆分后再上传。", this._uploadErrDetail(file, "超过本地解析上限 20MB"));
        return;
      }
      try {
        let text = "";
        if (ext === "docx") {
          try {
            text = await this._readDocx(file);
          } catch (e) {
            const msg = String((e && e.message) || "");
            if (!window.mammoth || /mammoth/i.test(msg)) {
              this.openUploadError("文件上传失败", "解析组件未加载，请检查网络后重试。", this._uploadErrDetail(file, msg || "解析组件缺失"));
            } else if (/invalid|corrupt|damaged|encrypted|zip/i.test(msg)) {
              this.openUploadError("文件上传失败", "该 Word 文件可能已损坏或被加密，请重新保存为 .docx 后再试。", this._uploadErrDetail(file, msg || "文件损坏"));
            } else {
              this.openUploadError("文件上传失败", "Word 解析失败，请重新保存为 .docx 后再试。", this._uploadErrDetail(file, msg || "解析失败"));
            }
            return;
          }
        } else if (ext === "doc") {
          try {
            text = await this._readTextFile(file);
          } catch (e) {
            this.openUploadError("文件上传失败", "浏览器读取文件时中断，请重试。", this._uploadErrDetail(file, "浏览器读取中断"));
            return;
          }
          if (text && text.includes("\u0000")) {
            this.toast("旧版 .doc 格式解析可能不完整，建议另存为 .docx 后重新上传", "warn");
          }
        } else {
          try {
            text = await this._readTextFile(file);
          } catch (e) {
            this.openUploadError("文件上传失败", "浏览器读取文件时中断，请重试。", this._uploadErrDetail(file, "浏览器读取中断"));
            return;
          }
        }
        if (!text || !text.trim()) {
          this.openUploadError("文件上传失败", "文件内容为空或无法解析，请检查文件后重试。", this._uploadErrDetail(file, "内容为空"));
          return;
        }
        this.input = text;
        this.inputMode = "file";
        this.attachedFile = { name, size: file.size };
        this.toast(`已读取文件「${name}」`);
      } catch (e) {
        this.openUploadError("文件上传失败", "文件读取失败，请重试。", this._uploadErrDetail(file, String((e && e.message) || "未知错误")));
      }
    },
    async _uploadPdf(file, confirmScanned) {
      // PDF 解析不消耗次数，无码也可用（服务端对匿名调用按指纹/IP 限流）
      const cfg = this.parseConfig || {};
      const limits = cfg.limits || {};
      const limitMB = Number(limits.current_mb) || (cfg.mode === "agent" ? 10 : 200);
      if (file.size > limitMB * 1024 * 1024) {
        this.openUploadError("文件上传失败", `文件超过 ${limitMB}MB（当前${this.formatFileSize(file.size)}）。精准模式上限200MB，轻量模式上限10MB；过大请拆分或让管理员切换为精准模式。`, this._uploadErrDetail(file, `超过当前上限 ${limitMB}MB`));
        return;
      }
      if (cfg.pdf_enabled === false) {
        this.openUploadError("文件上传失败", "PDF 解析尚未配置（缺少 MinerU Token）。请联系管理员在管理后台 → 文档解析中填写。", this._uploadErrDetail(file, "服务端未配置解析 Token"));
        return;
      }
      try { if (this._pdfAbort) this._pdfAbort.abort(); } catch {}
      const ctrl = new AbortController();
      this._pdfAbort = ctrl;
      this.parsingFile = true;
      this.parsingLabel = "云端解析中，请稍候…";
      this.pendingPdfFile = file;
      this.parseElapsed = "";
      this.parseElapsedSec = 0;
      this.parseStartedAt = Date.now();
      this._stopParseTimer();
      this._parseTimer = setInterval(() => {
        this.parseElapsedSec = Math.floor((Date.now() - this.parseStartedAt) / 1000);
        this.parsingLabel = `云端解析中（已用时 ${this.parseElapsedSec} 秒），请稍候…`;
      }, 500);
      try {
        const fd = new FormData();
        fd.append("file", file, file.name || "document.pdf");
        fd.append("confirm_scanned", confirmScanned ? "true" : "false");
        let res;
        try {
          res = await fetch("/api/parse/file", { method: "POST", headers: this.authHeaders(), body: fd, signal: ctrl.signal });
        } catch (e) {
          if (e && e.name === "AbortError") return;
          this.openUploadError("文件上传失败", "网络连接失败，请检查网络后重试。", this._uploadErrDetail(file, "网络错误：" + String((e && e.message) || "请求失败")));
          return;
        }
        if (res.status === 401) {
          // 只清失效登录态：这里已经有上传错误面板，再叠一个使用码弹窗会互相遮挡
          if (this.isAuthenticated) this.clearAuth();
          this.openUploadError("文件上传失败", "需要输入使用码后再上传 PDF。", this._uploadErrDetail(file, "未认证 HTTP 401"));
          return;
        }
        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          this.openUploadError("文件上传失败", "服务器返回异常，请稍后重试。", this._uploadErrDetail(file, "服务端响应异常"));
          return;
        }
        const detail = (data && data.detail && typeof data.detail === "object") ? data.detail : {};
        const kind = detail.kind || data.kind || "";
        const msg = detail.message || data.message || "";
        if (res.status === 409 && kind === "scanned_suspected") {
          this.scanWarnStage = detail.stage === "post_parse" ? "post" : "pre";
          this.scanWarnOpen = true;
          return;
        }
        if (!res.ok) {
          const title = kind === "unsupported" ? "不支持的文件格式" : "文件上传失败";
          this.openUploadError(title, msg || `解析失败（${res.status}）。请重试。`, this._uploadErrDetail(file, `错误分类：${kind || "未知"} · HTTP ${res.status}`));
          if (res.status === 429) this.toast("请稍后再试", "warn");
          return;
        }
        const text = (data && data.text) || "";
        if (!text.trim()) {
          this.openUploadError("文件上传失败", "解析结果为空，请换一份 PDF 或联系管理员。", this._uploadErrDetail(file, "解析结果为空"));
          return;
        }
        this.scanWarnOpen = false;
        this.input = text;
        this.inputMode = "file";
        this.attachedFile = { name: file.name, size: file.size };
        this.parseElapsed = this.formatParseElapsed((Date.now() - this.parseStartedAt) / 1000);
        const imgNote = data.images_removed ? `，已去除 ${data.images_removed} 张图片` : "";
        this.toast(`已读取文件「${file.name}」${imgNote}（用时${this.parseElapsed}）`);
        if (data.truncated) this.toast("文件内容过长，已截断前 50000 字", "warn");
      } finally {
        if (this._pdfAbort === ctrl) this._pdfAbort = null;
        this._stopParseTimer();
        this.parsingFile = false;
        this.parsingLabel = "";
      }
    },
    _readTextFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || "");
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsText(file, "utf-8");
      });
    },
    async _readDocx(file) {
      if (!window.mammoth) {
        const ok = await ensureMammoth();
        if (!ok) throw new Error("mammoth.js 加载失败，请检查网络后重试");
      }
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || "";
    },
    formatFileSize(bytes) {
      if (!bytes) return "";
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    },

    /* ============ 上传来源（已有原稿 / 拍照识别） ============ */
    get isOcrTool() {
      return !!this.currentTool && this.currentTool.id === OCR_TOOL_ID;
    },
    get isTranslateTool() {
      return !!this.currentTool && this.currentTool.id === TRANSLATE_TOOL_ID;
    },
    get touchPrimary() {
      // 主输入设备是触摸 = 手机/平板：桌面端（含带触摸屏的笔记本用鼠标时）不走系统相机
      return matchMedia("(pointer: coarse)").matches;
    },
    get uploadHostLabel() {
      return this.isOcrTool ? "" : "文档解析成文字后放进输入框";
    },
    /* 「已有原稿 / 没有原稿」这个分叉只对别的工具的普通上传成立：
       识别图片文字这件事本身就是「把照片转成文字」，已经有原稿（Word/PDF/文本）就直接用，
       没有转一道的必要；从识别批次里点加号补图片同理，那里只收图片。 */
    get uploadHasSourceStep() {
      return !this.isOcrTool && !this.uploadImagesOnly;
    },
    /* imagesOnly：给识别批次补图片（弹窗里的加号、换一批图片），只给相册/相机/扫码三个入口 */
    openUploadDialog({ imagesOnly = false } = {}) {
      if (this.parsingFile) {
        this.toast("文件正在解析中，请稍候", "warn");
        return;
      }
      // 识别工具整条链路都在做识别：在入口就要码，别让用户拍完照才发现跑不了
      if (this.isOcrTool && !this.requireCodeForOcr(OCR_CODE_HINT)) return;
      // 由谁发起就归谁：OCR 结果落回当前工具，还是在独立工作区里展示
      this.ocrHost = this.isOcrTool ? "tool" : "modal";
      this.uploadImagesOnly = imagesOnly || this.isOcrTool;
      this.uploadStep = this.uploadHasSourceStep ? "source" : "photo";
      this.uploadOpen = true;
    },
    closeUploadDialog() {
      this.uploadOpen = false;
      this.uploadBusyLabel = "";
    },
    /* 「没有原稿，需要拍照」这条支路只通往图片识别，同样先要码 */
    gotoPhotoStep() {
      if (!this.requireCodeForOcr(OCR_CODE_HINT)) return;
      this.uploadStep = "photo";
    },
    backToSourceStep() {
      this.uploadStep = "source";
    },
    /* 已有原稿：直接唤起系统文件选择（文档走解析；图片不从这条路进，
       统一归「没有原稿，需要拍照」，两条路不重叠） */
    pickUploadFile() {
      const el = this.$refs.uploadFileInput;
      if (!el) return;
      this.closeUploadDialog();
      el.click();
    },
    /* 相册/文件里的多张图片：accept=image/* 在手机上直接进系统相册（一键多选） */
    pickUploadAlbum() {
      const el = this.$refs.uploadAlbumInput;
      if (!el) return;
      this.closeUploadDialog();
      el.click();
    },
    /* 现拍：capture 直达系统相机（这一项只在触摸设备上出现，见模板里的 x-show） */
    pickUploadCamera() {
      const el = this.$refs.uploadCameraInput;
      if (!el) return;
      this.closeUploadDialog();
      el.click();
    },
    handleFileSelect(ev) {
      const file = ev.target.files && ev.target.files[0];
      if (file) {
        // accept 过滤器能在系统文件对话框里被切成「所有文件」：图片仍拦下来，
        // 指去「没有原稿，需要拍照」那条路，避免和相册入口重叠
        const name = file.name || "";
        const dot = name.lastIndexOf(".");
        const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
        if (isImageFile(file, ext)) {
          this.toast("图片请从「没有原稿，需要拍照」进入", "warn");
        } else {
          this.readFileContent(file);
        }
      }
      ev.target.value = "";
    },
    handleFileDrop(ev) {
      this.dragOver = false;
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) this.readFileContent(file);
    },

    /* ============ 图片识别（OCR） ============ */
    /* 压缩目标尺寸：长边压到 maxEdge 以内、短边按比例；本来就小则不放大 */
    ocrTargetSize(w, h, maxEdge = OCR_MAX_EDGE) {
      const width = Math.max(1, Math.round(Number(w) || 0));
      const height = Math.max(1, Math.round(Number(h) || 0));
      const long = Math.max(width, height);
      if (!long || long <= maxEdge) return { width, height };
      const scale = maxEdge / long;
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
    },
    get ocrStreaming() {
      return this.ocrStage === "streaming";
    },
    get ocrHasImage() {
      return this.ocrImages.length > 0 || !!this.ocrPairToken;
    },
    /* 有内容可看（识别结果，或一条「停下/失败」的交代）。历史记录不存图片，
       所以「有文字没图片」是常态：工作区、动作条都不能只认 ocrHasImage */
    get ocrHasText() {
      return !!this.ocrText || this.ocrStage === "stopped" || this.ocrStage === "error";
    },
    get ocrStopped() {
      return this.ocrStage === "stopped";
    },
    /* 看识别结果 = 读长文，正文优先：手机上图片区默认收起（点缩略图进全屏编辑器看细节），
       桌面左右分栏时左栏默认展开。抽出来给「重置、首次收图」共用——只在按下开始识别时
       才设的话，手机上刚选完图就会被一屏大图顶掉正文的位置 */
    _ocrDefaultCollapsed() {
      return !matchMedia("(min-width: 1024px)").matches;
    },
    get ocrBatchLabel() {
      const total = this.ocrImages.length;
      if (!total) return "还没有图片";
      return total === 1 ? "1 张" : `${total} 张`;
    },
    get ocrCurrentImage() {
      return this.ocrImages[this.ocrIndex] || this.ocrImages[0] || null;
    },
    get ocrElapsedText() {
      return this.ocrElapsedSec > 0 ? `${this.ocrElapsedSec} 秒` : "";
    },
    /* 类型来源只有两个：能选的工具取用户的手动选择，其余工具按用途绑定（见 ocrModeForTool） */
    get ocrModeSelectable() {
      return ocrModeCanChoose(this.currentTool && this.currentTool.id);
    },
    get ocrMode() {
      if (this.ocrModeSelectable) return this.ocrModeManual === "handwritten" ? "handwritten" : "printed";
      return ocrModeForTool(this.currentTool && this.currentTool.id);
    },
    /* 类型面板只列出当前这一种；两种素材都可能来的工具才把两种都列出来 */
    get ocrModeOptions() {
      return Object.keys(OCR_MODES)
        .filter((mode) => this.ocrModeSelectable || mode === this.ocrMode)
        .map((mode) => Object.assign({ mode: mode, on: mode === this.ocrMode }, OCR_MODES[mode]));
    },
    get ocrTypeLabel() {
      return ocrModeMeta(this.ocrMode).label;
    },
    get ocrModeHint() {
      const meta = ocrModeMeta(this.ocrMode);
      return `${meta.label}：${meta.rule}`;
    },
    /* 「开始识别」这步：有图、没在跑、也还没有结果时就给这一个落点。
       不写成 stage === "ready"：只要批次里还有图，界面就不该是一块空白 */
    get ocrNeedsStart() {
      return this.ocrHasImage && !this.ocrStreaming && this.ocrStage !== "error" && !this.ocrText;
    },
    /* 「确认类型 / 开始识别」这一步此刻是否真的显示。
       光看「有没有结果」不够：已经有结果时用户仍要能回到这一步换类型
       （工具 32 的手写/印刷切换只有这一个入口，回不去就等于永远换不了），
       所以另立一个显式开关，由「换类型」与「收图后」两步置位 */
    get ocrStartStepVisible() {
      return this.ocrStartStep && this.ocrHasImage && !this.ocrStreaming && this.ocrStage !== "error";
    },
    resetOcr() {
      try { if (this._ocrAbort) this._ocrAbort.abort(); } catch { /* 忽略 */ }
      this._ocrAbort = null;
      this._stopOcrTimer();
      this.releasePairSession();
      this.ocrImages = [];
      this.ocrIndex = 0;
      this.ocrStage = "empty";
      this.ocrText = "";
      this.ocrRendered = "";
      this.ocrError = "";
      this.ocrTruncated = false;
      this.ocrMediaCollapsed = this._ocrDefaultCollapsed();
      this.ocrViewerOpen = false;
      this.ocrModalOpen = false;
      this.ocrStartStep = false;
      this._ocrMediaTouched = false;
      this._ocrCancelReason = "";
      this._ocrHistoryId = "";
      this.ocrHost = this.isOcrTool ? "tool" : "modal";
      this.resetOcrEdit();
    },
    /* 相册/相机选中的图片（也可能来自拖拽）：压缩后并入批次，等用户确认类型再开始 */
    async onOcrFilesSelect(ev) {
      const files = Array.from((ev.target && ev.target.files) || []);
      if (ev.target) ev.target.value = "";
      if (files.length) await this.acceptOcrImages(files);
    },
    async acceptOcrImages(files) {
      const room = OCR_MAX_IMAGES - this.ocrImages.length;
      if (room <= 0) {
        this.toast(`一次最多识别 ${OCR_MAX_IMAGES} 张，请先移除部分图片`, "warn");
        return;
      }
      const picked = files.slice(0, room);
      if (files.length > room) {
        this.toast(`一次最多 ${OCR_MAX_IMAGES} 张，已取前 ${room} 张`, "warn");
      }
      this.uploadBusyLabel = `正在处理 ${picked.length} 张图片…`;
      // 批次里混入本地图片时，先把扫码那几张落到本地：一次请求只能带一种来源
      if (this.ocrPairToken && this.ocrImages.length) await this._materializePairImages();
      const added = [];
      let failed = 0;
      for (const file of picked) {
        try {
          added.push(await this.ocrCompressImage(file));
        } catch (e) {
          failed += 1;
        }
      }
      this.uploadBusyLabel = "";
      if (!added.length) {
        this.toast("图片无法读取，请改用 JPG 或 PNG 格式", "error");
        return;
      }
      if (failed) {
        this.toast(`${failed} 张图片无法读取，已跳过；HEIC 等格式请先转为 JPG`, "warn");
      }
      this.ocrImages.push(...added);
      this.ocrIndex = Math.min(this.ocrIndex, this.ocrImages.length - 1);
      // 这一批的图片区是展开还是收起，在收图这一步就定下来：手机上默认收起（正文优先），
      // 桌面左右分栏时默认展开。用户自己点过折叠开关就按他的来，别再覆盖回去
      if (!this._ocrMediaTouched) this.ocrMediaCollapsed = this._ocrDefaultCollapsed();
      // 图片就位后停在「开始识别」这一步：真要送出去识别得由用户按下按钮，不替他顺手按下
      this.enterOcrStartStep();
    },
    /* 进入「确认类型 / 开始识别」这步：已有结果先留着（可复制），按下开始识别才覆盖 */
    enterOcrStartStep() {
      if (this.ocrStreaming) return;
      if (!this.ocrHasImage) return;
      this.ocrError = "";
      this.ocrStage = "ready";
      this.ocrStartStep = true;
      // 扫码引导弹窗还开着时不叠第二个弹窗：关掉它时再打开识别面板
      if (this.ocrHost === "modal" && !this.pairOpen) this.ocrModalOpen = true;
    },
    /* 换类型本身不跑识别：点一下切换就重来一遍，用户会以为自己按错了什么。
       类型定了的工具不给换（面板里只剩当前这一种，也压根没有可点的第二张卡） */
    chooseOcrMode(mode) {
      if (!this.ocrModeSelectable) return;
      this.ocrModeManual = mode === "handwritten" ? "handwritten" : "printed";
    },
    /* 图片压缩：长边 ≤2000、JPEG 0.85、白底。
       上游视觉模型会把图缩到 1–2k 像素级，再传大图只是白占带宽（服务器带宽很紧） */
    ocrCompressImage(file) {
      return new Promise((resolve, reject) => {
        if (!file) {
          reject(new Error("没有图片"));
          return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const { width, height } = this.ocrTargetSize(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL("image/jpeg", OCR_COMPRESS_QUALITY);
            if (!dataUrl || dataUrl.indexOf("data:image/jpeg") !== 0) {
              throw new Error("图片编码失败");
            }
            resolve({
              id: "img_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              name: file.name || "photo.jpg",
              w: width,
              h: height,
              size: Math.round(Math.max(0, dataUrl.length - OCR_DATA_URL_PREFIX.length) * 0.75),
              dataUrl,
            });
          } catch (e) {
            reject(e);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("无法解码这张图片"));
        };
        img.src = url;
      });
    },
    /* 把扫码会话里的图片落成本地 data URL（只在混入本地图片时才需要，
       正常扫码流程不动它：OCR 请求只带 token，图片不重复过网） */
    async _materializePairImages() {
      for (const item of this.ocrImages) {
        if (item.dataUrl || !item.url) continue;
        try {
          const res = await fetch(item.url, { headers: { ...this.authHeaders() } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          item.dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("读取失败"));
            reader.readAsDataURL(blob);
          });
          item.size = blob.size;
          delete item.url;
        } catch (e) {
          this.toast("扫码照片读取失败，已跳过该张", "warn");
        }
      }
      this.ocrImages = this.ocrImages.filter((item) => item.dataUrl);
      // 图片已经落到本地，会话没用了：立刻释放服务器内存
      this.releasePairSession();
    },
    toggleOcrMedia() {
      this.ocrMediaCollapsed = !this.ocrMediaCollapsed;
      // 用户自己动过这个开关：本批之后不再按屏幕宽度改回去
      this._ocrMediaTouched = true;
    },
    selectOcrImage(i) {
      this.ocrIndex = Math.max(0, Math.min(i, this.ocrImages.length - 1));
    },
    /* 点缩略图：先选中它，再分档决定要不要顺手打开全屏编辑器。
       窄屏（没有左右分栏、大图预览被收起）时缩略图就是唯一的看图入口，
       不点开就没有地方看细节、转正、裁剪了；宽屏左栏就是大图，点一下只换选中项 */
    onOcrThumbTap(i) {
      this.selectOcrImage(i);
      if (this._ocrDefaultCollapsed()) this.openOcrEditor();
    },
    /* 批次变了（删/排序/追加）就得重新拍板：停掉在跑的识别，回到「开始识别」这步，
       但已有文本先留着（可复制），按下开始识别才覆盖 */
    _afterBatchChanged() {
      if (this.ocrStreaming) this.ocrCancel("batch");
      if (!this.ocrImages.length && !this.ocrPairToken) {
        this.ocrStage = "empty";
        this.ocrText = "";
        this.ocrRendered = "";
        this.ocrError = "";
        this.ocrStartStep = false;
        return;
      }
      if (this.ocrStage === "done" || this.ocrStage === "stopped" || this.ocrStage === "error"
        || this.ocrStage === "streaming" || this.ocrStage === "history") {
        this.enterOcrStartStep();
      }
    },
    removeOcrImage(i) {
      this.ocrImages.splice(i, 1);
      this.ocrIndex = Math.max(0, Math.min(this.ocrIndex, this.ocrImages.length - 1));
      this._afterBatchChanged();
    },
    /* 排序：批次顺序就是转录顺序（多页试卷按页拼），所以上/下移是实义操作 */
    moveOcrImage(i, delta) {
      const target = i + delta;
      if (i < 0 || i >= this.ocrImages.length) return;
      if (target < 0 || target >= this.ocrImages.length) return;
      const [item] = this.ocrImages.splice(i, 1);
      this.ocrImages.splice(target, 0, item);
      this.ocrIndex = target;
      this._afterBatchChanged();
    },

    /* ---- 全屏查看 / 编辑（转正 · 裁剪） ---- */
    /* 点图放大就是编辑入口：放大看那些 [ILLEGIBLE] 的地方、顺手把多余的边和拍歪的角度修掉，
       是同一个动作的两半，分成两个界面反而要用户先想「我该点哪个」 */
    get ocrCropHandles() {
      return OCR_CROP_HANDLES;
    },
    /* 满幅的框等于没裁：不算改动，免得为它白跑一次重新编码（0.85 → 0.9 也白掉一层） */
    get ocrEditCropped() {
      const c = this.ocrEditCrop;
      return !!c && !(c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999);
    },
    /* 有待生效的旋转或裁剪：关闭时会一次性落地（见 closeOcrEditor） */
    get ocrEditDirty() {
      return this.ocrEditRotate % 360 !== 0 || this.ocrEditCropped;
    },
    get ocrEditCanRestore() {
      const item = this.ocrCurrentImage;
      return !!(item && item.sourceUrl);
    },
    get ocrEditTitle() {
      const total = this.ocrImages.length;
      const name = (this.ocrCurrentImage && this.ocrCurrentImage.name) || "";
      const head = total ? `第 ${this.ocrIndex + 1} / ${total} 张` : "";
      return name ? `${head} · ${name}` : head;
    },
    /* 提示行跟着状态走：这一步能做什么、改了以后什么时候生效，都写在这一行里。
       触屏不给鼠标那套快捷键说明（那上面没有滚轮也没有 [ ]） */
    get ocrEditorTip() {
      if (this.ocrEditCropOn) {
        return this.touchPrimary
          ? "拖动四角或边调整范围；再点一次「裁剪」就能看到裁完的样子"
          : "拖动四角或边调整范围；空白处拖出新范围，再点一次「裁剪」就能看到裁完的样子";
      }
      if (this.ocrEditDirty) return "看到的就是裁完的样子；点「完成」写入这张图片";
      return this.touchPrimary
        ? "点「裁剪」可修掉多余的边，两指缩放看细节"
        : "点「裁剪」可修掉多余的边；滚轮缩放，[ ] 转 90°，Esc 完成";
    },
    /* 画面窗口：裁剪工具开着时看整幅（框外要留着做参照才好动手），关掉后只显示裁剪范围内的那部分。
       这就是实时预览——一个像素都不动、也不重新编码，只是把框外的部分不显示出来 */
    get ocrEditWindow() {
      if (this.ocrEditCropOn) return OCR_FULL_RECT;
      return this.ocrEditCropped ? this.ocrEditCrop : OCR_FULL_RECT;
    },
    get ocrEditWinSize() {
      const full = this.ocrEditFull;
      if (!full.w || !full.h) return { w: 0, h: 0 };
      const win = this.ocrEditWindow;
      return {
        w: Math.max(1, Math.round(full.w * win.w)),
        h: Math.max(1, Math.round(full.h * win.h)),
      };
    },
    get ocrEditFrameStyle() {
      const box = this.ocrEditWinSize;
      const v = this.ocrEditView;
      return `width:${box.w}px;height:${box.h}px;transform:translate(${v.x.toFixed(2)}px,${v.y.toFixed(2)}px) scale(${v.scale.toFixed(4)})`;
    },
    get ocrEditImageStyle() {
      const full = this.ocrEditFull;
      const img = this.ocrEditImg;
      const win = this.ocrEditWindow;
      // 窗口是「镜头」，画面在它后面推：要看到靠右下的一块，就得把图片往左上（负方向）推，
      // 推出去的距离正是裁剪原点在屏幕上的像素。再叠上「把整幅居中」的那半格，
      // 就是图片左上角该在的位置。符号写反过一次：不裁剪时 win=0 看不出来，一裁就跑反方向。
      const left = ocrRound3(full.w / 2 - win.x * full.w - img.w / 2);
      const top = ocrRound3(full.h / 2 - win.y * full.h - img.h / 2);
      return `width:${img.w}px;height:${img.h}px;margin-left:${left}px;margin-top:${top}px;transform:rotate(${this.ocrEditRotate}deg)`;
    },
    get ocrEditRectStyle() {
      const c = this.ocrEditCrop || OCR_FULL_RECT;
      return `left:${(c.x * 100).toFixed(3)}%;top:${(c.y * 100).toFixed(3)}%;width:${(c.w * 100).toFixed(3)}%;height:${(c.h * 100).toFixed(3)}%`;
    },
    /* 扫码来源的那几张，字节还在服务器内存里：编辑前先落到本地。
       与「批次里再补一张本地图片」走的是同一条路（一次请求只能带一种来源） */
    async openOcrEditor() {
      const first = this.ocrCurrentImage;
      if (!first || this.ocrEditBusy) return;
      this.ocrEditBusy = true;
      try {
        if (!first.dataUrl) await this._materializePairImages();
        const item = this.ocrCurrentImage;
        if (!item || !item.dataUrl) throw new Error("图片没能读到本地");
        const img = await this._ocrLoadImage(item.dataUrl);
        this.ocrEditBase = item.dataUrl;
        this.ocrEditBaseW = img.naturalWidth || item.w || 1;
        this.ocrEditBaseH = img.naturalHeight || item.h || 1;
        this.ocrEditRotate = 0;
        this.ocrEditCrop = null;
        this.ocrEditCropOn = false;
        this.fitOcrView();
        this.ocrViewerOpen = true;
        await this.$nextTick();
        this.syncOcrEditorSize();
        this._ocrWatchStage();
      } catch (e) {
        this.toast(describeError(e, "图片打开失败，请重试"), "error");
      } finally {
        this.ocrEditBusy = false;
      }
    },
    /* 关闭 = 落地：待应用的旋转与裁剪在这里一次烘焙完，直接关掉也不会白调半天。
       没有改动就是纯看图，不留任何痕迹 */
    async closeOcrEditor() {
      if (this.ocrEditBusy) return;
      const dirty = this.ocrEditDirty && !this.ocrStreaming;
      const what = this.ocrEditCropped
        ? (this.ocrEditRotate % 360 ? "已裁剪并转正" : "已裁剪")
        : "已转正";
      if (dirty) {
        this.ocrEditBusy = true;
        try {
          // 烘焙失败就留在编辑器里：别把用户刚调好的角度和范围一起吞掉
          if (!(await this.applyOcrEdit())) return;
        } finally {
          this.ocrEditBusy = false;
        }
      }
      this.ocrViewerOpen = false;
      this.resetOcrEdit();
      if (dirty) {
        this.toast(what);
        this.enterOcrStartStep();
      }
    },
    resetOcrEdit() {
      if (this._ocrStageRO) {
        try { this._ocrStageRO.disconnect(); } catch { /* 忽略 */ }
        this._ocrStageRO = null;
      }
      this.ocrEditBase = "";
      this.ocrEditBaseW = 0;
      this.ocrEditBaseH = 0;
      this.ocrEditRotate = 0;
      this.ocrEditCrop = null;
      this.ocrEditCropOn = false;
      this.ocrEditFull = { w: 0, h: 0 };
      this.ocrEditImg = { w: 0, h: 0 };
      this.ocrEditView = { scale: 1, x: 0, y: 0 };
      this._ocrDrag = null;
      this._ocrPointers = null;
      this._ocrDragged = false;
    },
    /* 把待应用的旋转与裁剪烧进这张图：一次画布画完旋转、再一次裁掉多余部分。
       基准随即换成刚生成的这张——接着再转再裁都从它出发，不会层层叠加 */
    async applyOcrEdit() {
      const item = this.ocrCurrentImage;
      if (!item || !this.ocrEditBase) return false;
      const plan = ocrBakePlan(this.ocrEditBaseW, this.ocrEditBaseH, this.ocrEditRotate, this.ocrEditCrop);
      try {
        const img = await this._ocrLoadImage(this.ocrEditBase);
        const mid = document.createElement("canvas");
        mid.width = plan.rotW;
        mid.height = plan.rotH;
        const mctx = mid.getContext("2d");
        mctx.fillStyle = "#ffffff";
        mctx.fillRect(0, 0, plan.rotW, plan.rotH);
        mctx.save();
        mctx.translate(plan.rotW / 2, plan.rotH / 2);
        mctx.rotate((plan.rotate * Math.PI) / 180);
        mctx.drawImage(img, -plan.baseW / 2, -plan.baseH / 2, plan.baseW, plan.baseH);
        mctx.restore();
        const out = document.createElement("canvas");
        out.width = plan.outW;
        out.height = plan.outH;
        const octx = out.getContext("2d");
        octx.fillStyle = "#ffffff";
        octx.fillRect(0, 0, plan.outW, plan.outH);
        octx.drawImage(mid, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.outW, plan.outH);
        const dataUrl = out.toDataURL("image/jpeg", OCR_EDIT_QUALITY);
        if (!dataUrl || dataUrl.indexOf("data:image/jpeg") !== 0) throw new Error("图片编码失败");
        // 第一次动它之前留一份原样：裁错了还能整个退回去（只在本次会话里有效）
        if (!item.sourceUrl) item.sourceUrl = item.dataUrl;
        item.dataUrl = dataUrl;
        item.edited = true;
        item.w = plan.outW;
        item.h = plan.outH;
        item.size = Math.round(Math.max(0, dataUrl.length - OCR_DATA_URL_PREFIX.length) * 0.75);
        this.ocrEditBase = dataUrl;
        this.ocrEditBaseW = plan.outW;
        this.ocrEditBaseH = plan.outH;
        this.ocrEditRotate = 0;
        this.ocrEditCrop = null;
        this.ocrEditCropOn = false;
        this.syncOcrEditorSize();
        this._afterBatchChanged();
        return true;
      } catch (e) {
        this.toast(describeError(e, "图片处理失败，请重试"), "error");
        return false;
      }
    },
    /* 回到最初上传的那张照片（本次会话里留的底；刷新页面后就只剩当前这张了） */
    async restoreOcrOriginal() {
      const item = this.ocrCurrentImage;
      if (!item || !item.sourceUrl || this.ocrEditBusy || this.ocrStreaming) return;
      this.ocrEditBusy = true;
      try {
        const original = item.sourceUrl;
        const img = await this._ocrLoadImage(original);
        item.dataUrl = original;
        delete item.sourceUrl;
        item.edited = false;
        item.w = img.naturalWidth || item.w;
        item.h = img.naturalHeight || item.h;
        item.size = Math.round(Math.max(0, original.length - OCR_DATA_URL_PREFIX.length) * 0.75);
        this.ocrEditBase = original;
        this.ocrEditBaseW = img.naturalWidth || 1;
        this.ocrEditBaseH = img.naturalHeight || 1;
        this.ocrEditRotate = 0;
        this.ocrEditCrop = null;
        this.ocrEditCropOn = false;
        this.fitOcrView();
        this.syncOcrEditorSize();
        this._afterBatchChanged();
        this.toast("已还原原图");
      } catch (e) {
        this.toast("原图读取失败，请重试", "error");
      } finally {
        this.ocrEditBusy = false;
      }
    },
    /* 每次转 90°：选择框跟着内容转，否则用户转完图会发现框跑到别处去了 */
    rotateOcrEditor(dir) {
      if (this.ocrStreaming || this.ocrEditBusy) return;
      const step = dir > 0 ? 1 : -1;
      this.ocrEditRotate = (this.ocrEditRotate + step * 90 + 360) % 360;
      if (this.ocrEditCrop) this.ocrEditCrop = ocrRotateRect(this.ocrEditCrop, step);
      this.fitOcrView();
      this.syncOcrEditorSize();
    },
    toggleOcrCrop() {
      if (this.ocrStreaming || this.ocrEditBusy) return;
      this.ocrEditCropOn = !this.ocrEditCropOn;
      // 第一次开裁剪工具：先给一个满幅的框，用户从任意一边往里收都是直接可拖的
      if (this.ocrEditCropOn && !this.ocrEditCrop) this.ocrEditCrop = Object.assign({}, OCR_FULL_RECT);
      // 两种状态都从「整幅」看起：进去时要看清全图才好定范围，出来时要看全裁完的结果
      this.fitOcrView();
    },
    /* 重置：撤掉还没生效的旋转与裁剪（裁剪框回到满幅，等于不裁）。
       已经烘焙进图片的用「还原原图」退 */
    resetOcrEdits() {
      if (this.ocrStreaming || this.ocrEditBusy) return;
      this.ocrEditRotate = 0;
      this.ocrEditCrop = this.ocrEditCropOn ? Object.assign({}, OCR_FULL_RECT) : null;
      this.fitOcrView();
      this.syncOcrEditorSize();
    },
    fitOcrView() {
      this.ocrEditView = { scale: 1, x: 0, y: 0 };
    },
    /* 画面尺寸跟着舞台算：舞台两端各留 12px，不让图贴着屏幕边。
       旋转 90/270 时画面框换宽高（图片本身靠 CSS transform 转，尺寸不用重算） */
    syncOcrEditorSize() {
      const stage = this.$refs && this.$refs.ocrEditStage;
      if (!stage || !this.ocrEditBaseW || !this.ocrEditBaseH) return;
      const boxW = Math.max(0, stage.clientWidth - 24);
      const boxH = Math.max(0, stage.clientHeight - 24);
      if (!boxW || !boxH) return;   // 还在淡入/隐藏：下一次 resize 或打开时再量
      const fit = ocrFitSize(this.ocrEditBaseW, this.ocrEditBaseH, boxW, boxH);
      const swapped = this.ocrEditRotate % 180 === 90;
      // 注意键名：ocrFitSize 给的是 width/height，样式里读的是 w/h，写错就是 undefinedpx，
      // 整条声明会被浏览器丢掉、图片退回自然尺寸还不居中（别再踩）
      this.ocrEditImg = { w: fit.width, h: fit.height };
      this.ocrEditFull = swapped ? { w: fit.height, h: fit.width } : { w: fit.width, h: fit.height };
      this._clampOcrView();
    },
    /* 舞台一变矮就要重算：裁剪工具会多出一个按钮和一行提示，窄屏上工具栏可能因此换行，
       而画面尺寸是照舞台算的。窗口 resize 能盖住桌面，手机转屏/工具栏换行只有观察者盖得住 */
    _ocrWatchStage() {
      const stage = this.$refs && this.$refs.ocrEditStage;
      if (!stage || typeof ResizeObserver !== "function") return;
      if (!this._ocrStageRO) this._ocrStageRO = new ResizeObserver(() => this.syncOcrEditorSize());
      try { this._ocrStageRO.observe(stage); } catch { /* 忽略 */ }
    },
    /* 放大后画面不能拖出框外：留出的边界正好是「多出来的那半」 */
    _clampOcrView() {
      const v = this.ocrEditView;
      if (v.scale <= 1.001) {
        v.scale = 1;
        v.x = 0;
        v.y = 0;
        return;
      }
      const box = this.ocrEditWinSize;
      const mx = ((v.scale - 1) * box.w) / 2;
      const my = ((v.scale - 1) * box.h) / 2;
      v.x = ocrClampNum(v.x, -mx, mx);
      v.y = ocrClampNum(v.y, -my, my);
    },
    _ocrStageCenter() {
      const stage = this.$refs && this.$refs.ocrEditStage;
      if (!stage) return { x: 0, y: 0 };
      const r = stage.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    /* 以屏幕上某一点为锚缩放：放大后那一点还在原地，不会「一放大就找不到刚才那行字」。
       dx/dy 是额外的平移（双指缩放时中点在动，要跟着走） */
    _ocrSetView(scale, clientX, clientY, dx, dy) {
      const v = this.ocrEditView;
      const s1 = ocrClampNum(Number(scale) || 1, 1, OCR_VIEW_MAX);
      const k = v.scale ? s1 / v.scale : 1;
      const c = this._ocrStageCenter();
      const cx = clientX - c.x;
      const cy = clientY - c.y;
      v.x = cx - (cx - v.x) * k + (dx || 0);
      v.y = cy - (cy - v.y) * k + (dy || 0);
      v.scale = s1;
      this._clampOcrView();
    },
    ocrEditWheel(ev) {
      if (!this.ocrViewerOpen) return;
      this._ocrSetView(this.ocrEditView.scale * Math.exp(-ev.deltaY * 0.0016), ev.clientX, ev.clientY, 0, 0);
    },
    ocrEditDblClick(ev) {
      this._ocrSetView(this.ocrEditView.scale > 1.001 ? 1 : OCR_VIEW_TAP, ev.clientX, ev.clientY, 0, 0);
    },
    /* 屏幕坐标 → 画面内的归一化坐标。框上带着缩放，getBoundingClientRect 拿到的是缩放后的框，
       所以这里算出来的比例天然是对的，放大多少倍都不用另算 */
    _ocrNormPoint(ev, el) {
      const r = el.getBoundingClientRect();
      return {
        x: r.width ? ocrClamp01((ev.clientX - r.left) / r.width) : 0,
        y: r.height ? ocrClamp01((ev.clientY - r.top) / r.height) : 0,
      };
    },
    /* 拖动写回的选择框统一收到三位小数：浮点尾巴会一路进到样式字符串和烘焙换算里，
       而千分之一像素的差别谁也看不出来 */
    _setOcrCrop(x, y, w, h) {
      this.ocrEditCrop = { x: ocrRound3(x), y: ocrRound3(y), w: ocrRound3(w), h: ocrRound3(h) };
    },
    /* 指针按下：鼠标与触屏走同一条路（Pointer Events），只在「框外空白处拖动」这一处分叉——
       没放大时拖出新裁剪框（鼠标和触屏都一样，此时画面本来也没得平移），
       放大后则是平移画面（手指要能挪动细节去对边） */
    ocrEditDown(ev) {
      if (!this.ocrCurrentImage || this.ocrEditBusy || this.ocrStreaming) return;
      const frame = ev.currentTarget;
      if (!this._ocrPointers) this._ocrPointers = new Map();
      this._ocrDragged = false;
      this._ocrPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      try { frame.setPointerCapture(ev.pointerId); } catch { /* 环境不支持就算了 */ }
      if (this._ocrPointers.size === 1) {
        const n = this._ocrNormPoint(ev, frame);
        const handle = ev.target && ev.target.closest ? ev.target.closest("[data-h]") : null;
        const crop = this.ocrEditCrop;
        // 满幅框上「框内拖动」是搬不动的（左右都顶到边了），此时一律当作画新框：
        // 刚打开裁剪工具第一下就能直接拉出想要的区域，不用先跟把手较劲
        const full = !!crop && crop.w >= 0.999 && crop.h >= 0.999;
        const inside = !full && !!(crop && n.x >= crop.x && n.x <= crop.x + crop.w && n.y >= crop.y && n.y <= crop.y + crop.h);
        const mode = this.ocrEditCropOn
          ? (handle ? "resize" : (inside ? "move" : (this.ocrEditView.scale > 1.001 ? "pan" : "newrect")))
          : "pan";
        this._ocrDrag = {
          mode: mode,
          id: ev.pointerId,
          n: n,
          x: ev.clientX,
          y: ev.clientY,
          rect: crop ? Object.assign({}, crop) : null,
          handle: handle ? handle.dataset.h : "",
          view: Object.assign({}, this.ocrEditView),
        };
        return;
      }
      // 第二根手指落下：整段转成双指缩放，刚才单指那一下作废（否则会边裁边窜）
      const pts = Array.from(this._ocrPointers.values());
      this._ocrDrag = {
        mode: "pinch",
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
    },
    ocrEditMove(ev) {
      const drag = this._ocrDrag;
      if (!drag) return;
      if (this._ocrPointers && this._ocrPointers.has(ev.pointerId)) {
        this._ocrPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      }
      this._ocrDragged = true;
      if (drag.mode === "pinch") {
        const pts = Array.from((this._ocrPointers || new Map()).values());
        if (pts.length < 2) return;
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || drag.d;
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        this._ocrSetView(this.ocrEditView.scale * (d / drag.d), mid.x, mid.y, mid.x - drag.mid.x, mid.y - drag.mid.y);
        drag.d = d;
        drag.mid = mid;
        return;
      }
      if (ev.pointerId !== drag.id) return;
      if (drag.mode === "pan") {
        this.ocrEditView.x = drag.view.x + (ev.clientX - drag.x);
        this.ocrEditView.y = drag.view.y + (ev.clientY - drag.y);
        this._clampOcrView();
        return;
      }
      const n = this._ocrNormPoint(ev, ev.currentTarget);
      const dx = n.x - drag.n.x;
      const dy = n.y - drag.n.y;
      const r = drag.rect || OCR_FULL_RECT;
      if (drag.mode === "move") {
        this._setOcrCrop(
          ocrClampNum(r.x + dx, 0, 1 - r.w),
          ocrClampNum(r.y + dy, 0, 1 - r.h),
          r.w,
          r.h
        );
        return;
      }
      if (drag.mode === "newrect") {
        const x1 = Math.min(n.x, drag.n.x);
        const x2 = Math.max(n.x, drag.n.x);
        const y1 = Math.min(n.y, drag.n.y);
        const y2 = Math.max(n.y, drag.n.y);
        // 手心一抖划过的小框没有意义，当作没画（保留原来的框）
        if (x2 - x1 >= OCR_CROP_MIN && y2 - y1 >= OCR_CROP_MIN) {
          this._setOcrCrop(x1, y1, x2 - x1, y2 - y1);
        }
        return;
      }
      // resize：拖哪条边就动哪条边，对角固定
      let x1 = r.x;
      let y1 = r.y;
      let x2 = r.x + r.w;
      let y2 = r.y + r.h;
      const h = drag.handle;
      if (h.indexOf("w") >= 0) x1 = ocrClampNum(r.x + dx, 0, x2 - OCR_CROP_MIN);
      if (h.indexOf("e") >= 0) x2 = ocrClampNum(r.x + r.w + dx, x1 + OCR_CROP_MIN, 1);
      if (h.indexOf("n") >= 0) y1 = ocrClampNum(r.y + dy, 0, y2 - OCR_CROP_MIN);
      if (h.indexOf("s") >= 0) y2 = ocrClampNum(r.y + r.h + dy, y1 + OCR_CROP_MIN, 1);
      this._setOcrCrop(x1, y1, x2 - x1, y2 - y1);
    },
    ocrEditUp(ev) {
      if (this._ocrPointers && this._ocrPointers.has(ev.pointerId)) this._ocrPointers.delete(ev.pointerId);
      // 双指松掉一根也不再接着拖：这一段的起点已经作废，硬接会跳一下
      this._ocrDrag = null;
    },
    /* 编辑器里的键盘：只在看图时接管。Esc 在裁剪里先退出裁剪（这才看得到裁完的样子），
       再按一次才是「完成并关闭」；转正是 []，裁剪是 C，0 回到整幅 */
    ocrEditorKey(ev) {
      if (!this.ocrViewerOpen) return;
      const k = ev.key;
      if (k === "Escape") {
        ev.preventDefault();
        if (this.ocrEditCropOn) this.toggleOcrCrop();
        else this.closeOcrEditor();
        return;
      }
      if (k === "[") {
        ev.preventDefault();
        this.rotateOcrEditor(-1);
        return;
      }
      if (k === "]") {
        ev.preventDefault();
        this.rotateOcrEditor(1);
        return;
      }
      if (k === "c" || k === "C") {
        ev.preventDefault();
        this.toggleOcrCrop();
        return;
      }
      if (k === "0") {
        ev.preventDefault();
        this.fitOcrView();
      }
    },
    _ocrLoadImage(src) {
      return new Promise((resolve, reject) => {
        if (!src) {
          reject(new Error("没有图片"));
          return;
        }
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片读取失败"));
        img.src = src;
      });
    },

    async ocrStart() {
      if (this.ocrStreaming) return;
      // 使用码是识别的硬前提：先问码，再谈有没有图
      if (!this.requireCodeForOcr(OCR_CODE_HINT)) return;
      // 识别结果同样交给 renderMd 渲染，先备好组件（正常路径已由空闲预加载备好）
      await nbxEnsureRenderLibs();
      if (!this.ocrHasImage) {
        this.toast("请先选择图片", "warn");
        return;
      }
      this.retreatMascot();
      if (this.ocrHost === "modal") this.ocrModalOpen = true;
      // 手机上默认把图片收成一条：窄屏里图片占满上半屏会把正文挤没
      if (!this._ocrMediaTouched) this.ocrMediaCollapsed = this._ocrDefaultCollapsed();
      this._ocrCancelReason = "";
      // 开始跑了：类型那一步让位给结果区（跑完还能用「换类型」回来）
      this.ocrStartStep = false;
      this.ocrError = "";
      this.ocrTruncated = false;
      this.ocrText = "";
      this.ocrRendered = "";
      this.ocrStage = "streaming";
      this.ocrElapsedSec = 0;
      this._startOcrTimer();
      const requestId = "ocr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      this._ocrRequestId = requestId;
      const ctrl = new AbortController();
      this._ocrAbort = ctrl;
      const payload = { tool_id: OCR_TOOL_ID, ocr_mode: this.ocrMode, request_id: requestId, input: "" };
      if (this.ocrPairToken) {
        // 扫码来源：只带 token + 电脑端排好的顺序，图片字节不回传
        payload.pair_token = this.ocrPairToken;
        const order = this.ocrImages.map((item) => item.pairIndex).filter((n) => Number.isInteger(n));
        if (order.length) payload.pair_order = order;
      } else {
        payload.images = this.ocrImages.map((item) => item.dataUrl);
      }
      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (!res.ok) throw await this._ocrHttpError(res);
        // 后端以 [CANCELLED] 收尾 = 这次没跑完（停止请求生效、连接被掐），
        // 不能跟 [DONE] 一样当成「识别完了」交给用户
        let serverStopped = false;
        await this.consumeSSE(res, (event, data) => {
          if (event === "token") {
            let text = data;
            try { text = JSON.parse(data); } catch { /* 兼容旧式未编码 token */ }
            this.ocrText += text || "";
            this.scheduleOcrRender();
          } else if (event === "truncated") {
            this.ocrTruncated = true;
          } else if (event === "done" && data === "[CANCELLED]") {
            serverStopped = true;
          } else if (event === "error") {
            let msg = "识别失败，请稍后重试";
            try { msg = JSON.parse(data).message || msg; } catch { /* 保留默认文案 */ }
            throw new Error(msg);
          }
        });
        // 先落状态再收尾渲染：收尾要按「已经不是流式中」的口径画（不带淡入）
        this.ocrStage = serverStopped ? "stopped" : "done";
        if (serverStopped) this.flushOcrRender();
        else this.finishOcrRender();
        this.pushOcrHistory(this.ocrStage);
        if (this.ocrTruncated) {
          this.toast("结果可能不完整：可减少一次识别的张数，或请管理员调大 OCR 输出上限", "warn");
        }
        if (this.ocrStage === "stopped") this.toast("已停止识别，已经识别出的内容已保留", "warn");
      } catch (e) {
        if (e && e.name === "AbortError") {
          this.flushOcrRender();
          // 只有用户自己点的取消按「已停止」收尾：批次变更 / 切工具导致的被动停止，
          // 落点由发起方决定，这里不要再改状态，也不要为一次被撤销的识别留记录
          if (this._ocrCancelReason !== "user") return;
          // 用户主动取消：已出的内容是真实产出，按「已停止」交代并留一条记录
          this.ocrStage = this.ocrText ? "stopped" : "ready";
          if (this.ocrText) {
            this.pushOcrHistory("stopped");
            this.toast("已停止识别，已经识别出的内容已保留", "warn");
          }
          return;
        }
        if (e && (e.status === 401 || e.status === 403)) {
          this.handleAuthFailure(e.message || "请先输入使用码");
        }
        this.ocrError = describeError(e, "识别失败，请稍后重试");
        this.flushOcrRender();
        this.ocrStage = "error";
        this.pushOcrHistory("error");
      } finally {
        this._stopOcrTimer();
        this._ocrCancelReason = "";
        if (this._ocrAbort === ctrl) this._ocrAbort = null;
      }
    },
    async _ocrHttpError(res) {
      let detail = "";
      try {
        const data = await res.json();
        if (data && data.detail != null) {
          detail = typeof data.detail === "string" ? data.detail : (formatApiDetail(data.detail) || "");
        }
      } catch { /* 无正文时用状态码兜底 */ }
      if (!detail) {
        if (res.status === 401) detail = "请先输入使用码后再识别（识别需要有效使用码）";
        else if (res.status === 403) detail = "使用码不可用或额度已用尽";
        else if (res.status === 429) detail = "识别太频繁了，请稍后再试";
        else detail = `识别失败（HTTP ${res.status}）`;
      }
      const err = new Error(detail);
      err.status = res.status;
      return err;
    },
    ocrTyper() {
      return this._typer("ocr", (shown, marks) => {
        this.ocrRendered = renderMdStreamPaced(
          this.ocrText,
          shown,
          marks,
          this.ocrStreaming || this.ocrTyper().finishing
        );
      });
    },
    scheduleOcrRender() {
      // token 到达只推进打字机目标，转录文字近匀速放行（与其他流式文本同一套节奏）
      this.ocrTyper().grow((this.ocrText || "").length);
    },
    /* 停止 / 出错收尾：残文立即全量，不再吊着动画 */
    flushOcrRender() {
      this.ocrTyper().reset((this.ocrText || "").length);
      this.ocrRendered = renderMd(this.ocrText);
    },
    /* 自然完成收尾：余量平滑放完（零头直接给全），放完那帧自动是干净全文 */
    finishOcrRender() {
      this.ocrTyper().finish();
    },
    _startOcrTimer() {
      this._stopOcrTimer();
      this._ocrTimer = setInterval(() => {
        if (this.ocrStreaming) this.ocrElapsedSec += 1;
      }, 1000);
    },
    _stopOcrTimer() {
      if (this._ocrTimer) clearInterval(this._ocrTimer);
      this._ocrTimer = null;
    },
    /* reason：user = 用户按下取消（默认）；batch = 批次变了被动停。
       只有用户自己停的那次才按「已停止」交代并留记录（见 ocrStart 的收尾），
       被动停的落点由发起方（_afterBatchChanged / resetOcr）决定 */
    ocrCancel(reason = "user") {
      this._ocrCancelReason = reason;
      try { if (this._ocrAbort) this._ocrAbort.abort(); } catch { /* 忽略 */ }
      if (this._ocrRequestId) {
        // 通知后端停流：断开的连接不会自动让上游停下
        fetch("/api/chat/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ request_id: this._ocrRequestId }),
        }).catch(() => {});
        this._ocrRequestId = "";
      }
      this._stopOcrTimer();
    },
    ocrRetry() {
      if (this.ocrStreaming) return;
      this.ocrStart();
    },
    /* 弹窗形态：把识别结果当作「已读取的文字」放进当前工具的输入框 */
    ocrUseText() {
      const text = this.ocrText.trim();
      if (!text) {
        this.toast("还没有可用的识别结果", "warn");
        return;
      }
      this.input = text;
      this.inputMode = "text";
      this.attachedFile = null;
      this.ocrModalOpen = false;
      const from = this.ocrImages.length ? `已写入 ${this.ocrImages.length} 张图片的识别结果` : "已写入识别结果";
      this.toast(`${from}，可继续编辑后执行`);
      this.$nextTick(() => this.autoGrow());
    },
    /* 弹窗形态：换一批图片（清空当前批次后重开上传，只给图片入口） */
    ocrRepick() {
      this.ocrModalOpen = false;
      this.resetOcr();
      this.openUploadDialog({ imagesOnly: true });
    },
    /* 回看历史记录时的唯一出口：另起一次识别。
       这条记录是已经生成完的一次结果，不归这一屏再管——把工作区放回空状态（上传入口回来），
       历史里那份一个字都不动；下一次识别自然落在一条新记录上 */
    startNewOcr() {
      if (this.ocrStreaming) return;
      this.resetOcr();
    },
    copyOcrText() {
      if (!this.ocrText.trim()) {
        this.toast("还没有可复制的内容", "warn");
        return;
      }
      copyToClipboard(this.ocrText);
      this.toast("识别结果已复制");
    },
    ocrCloseModal() {
      if (this.ocrStreaming) {
        this.ocrCancel();
        return;
      }
      this.ocrModalOpen = false;
      this.resetOcr();
    },
    /* ---- 识别记录（历史） ----
       本批图片 + 当前类型的签名：同批重跑写回同一条记录，换批或换类型才新开一条。
       历史不存图片，所以签名只看图片 id 与类型——裁剪/转正改的是 dataUrl，仍是同一批 */
    _ocrBatchSig() {
      const ids = this.ocrImages.map((item) => String(item.id || "")).join(",");
      return `${this.ocrImages.length}|${ids}|${this.ocrPairToken ? "pair" : "local"}|${this.ocrMode}`;
    },
    /* 识别留痕，只给独立工作区（「识别图片文字」工具本身）写：
       弹窗形态是给别的工具做「录入」的一步，文字随后写进宿主工具的输入框、由宿主那一条
       记录承担（见 ocrUseText），在这里再记一份只会让历史列表出现两条重复内容。
       state 直接来自状态机：done / stopped / error——已停止与出错都要如实标出来，
       不然用户回头翻记录会把半份转录当成完整结果 */
    pushOcrHistory(state, errorMsg = "") {
      if (this.ocrHost !== "tool") return null;
      const text = this.ocrText;
      // 一个字都没出的普通收尾（纯取消）不值得占位；出错即使没出字也要留痕，
      // 用户点「重试」还是会回来找那条失败原因
      if (!text.trim() && state !== "error") return null;
      const count = this.ocrImages.length;
      const label = ocrModeMeta(this.ocrMode).label;
      const names = this.ocrImages.map((item) => String(item.name || "")).filter(Boolean);
      const sig = this._ocrBatchSig();
      const fields = {
        toolId: OCR_TOOL_ID,
        toolName: "识别图片文字",
        icon: "scan-text",
        input: count ? `图片 ${count} 张 · ${label}` : label,
        fileName: names.join("、").slice(0, 120),
        title: historyTitleFromText(text),
        output: text,
        // 识别走的是后台配置的 OCR 模型，前端不知道是哪个，就如实留空
        // （列表里 model 为空时不显示模型位，见历史卡片）
        model: "",
        partial: state === "stopped",
        error: state === "error"
          ? String(errorMsg || this.ocrError || "识别失败").slice(0, 300)
          : "",
        // 快照：列表只用标量，这里给下一次同批重跑与「结果可能不完整」的提示留依据。
        // 图片本身的字节不进历史（localStorage 只有几 MB，一份整卷就能把它撑爆）
        ocr: {
          sig,
          mode: this.ocrMode,
          count,
          names: names.slice(0, OCR_MAX_IMAGES),
          truncated: !!this.ocrTruncated,
        },
      };
      const prevId = this._ocrHistoryId;
      const prev = prevId ? this.history.find((item) => item.id === prevId) : null;
      // 还是那批图片（同批重跑、失败重试）：写回原记录，不在列表里刷出一串半截结果
      if (prev && prev.ocr && prev.ocr.sig === sig) {
        this._hydrateHistory(prev);
        // 这次一个 token 都没出（比如重试又失败）：保留上一次已识别出的内容，越重试越少最糟
        if (!text.trim() && prev.output) fields.output = prev.output;
        Object.assign(prev, fields);
        NbxVersions.syncActive(prev);
        this._persistHistoryItem(prev);
        return prev;
      }
      const item = this._unshiftHistory({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        ...fields,
      });
      this._ocrHistoryId = item.id;
      return item;
    },
    /* 打开一条识别记录：历史不存图片，所以恢复的是「文字 + 类型 + 状态」三样，
       图片区整块不出现；要重新识别得重新上传图片（按钮就藏在有这个前提的地方） */
    openOcrHistory(item) {
      this._hydrateHistory(item);
      const tool = this.findTool(OCR_TOOL_ID) || {
        id: OCR_TOOL_ID, name: "识别图片文字", icon: "scan-text",
        description: "图片转文字（试卷、手写作文）", prompt_loaded: true,
      };
      this.currentTool = tool;
      this.resetOcr();
      const snap = item.ocr || {};
      this.ocrModeManual = snap.mode === "handwritten" ? "handwritten" : "printed";
      this.ocrText = item.output || "";
      this.ocrRendered = renderMd(this.ocrText);
      this.ocrTruncated = !!snap.truncated;
      this.ocrImages = [];
      this.ocrIndex = 0;
      // 记下这条是谁：在它基础上重跑仍旧写回这一条，而不是又开一条
      this._ocrHistoryId = item.id;
      this.ocrError = item.error || "";
      this.ocrStage = item.error ? "error" : (item.partial ? "stopped" : "history");
      this.rightMobileOpen = false;
      // 上一批的滚动位置不该带到这一条上（工作区那份正文区在文档里排第一，弹窗那份在后）
      this.$nextTick(() => {
        try {
          const el = document.querySelector(".ocr-body");
          if (el) el.scrollTop = 0;
        } catch { /* 无 DOM 的环境（测试）不需要复位滚动 */ }
      });
    },

    /* ============ 手机扫码拍摄（电脑端） ============ */
    /* 自托管 QR 库不可用时返回空串：弹窗退化为「显示网址 + 复制」，功能不中断 */
    qrSvg(text) {
      try {
        if (typeof qrcode !== "function" || !text) return "";
        const qr = qrcode(0, "M");
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
      } catch (e) {
        return "";
      }
    },
    get pairStateText() {
      if (this.pairState === "connected") return "手机已连接";
      if (this.pairState === "receiving") return `已收到 ${this.pairCount} 张`;
      // error 的具体原因从哪来就写哪：过期、限流、断网各不相同，别一律说成「配对已失效」
      if (this.pairState === "error") return this.pairError || "配对已失效，请重新扫码";
      return "等待手机扫码…";
    },
    /* 手机上只有相机，拍完的照片逐张直传上来；排序、删除与何时开始识别都在电脑上 */
    get pairHasPhotos() {
      return this.pairCount > 0;
    },
    /* 还有一条在传的会话：照片会继续到，批次里那几张的字节也还在这条会话的内存里 */
    get pairLive() {
      return !!this.pairToken && this.pairExpiresIn > 0 && this.pairState !== "error";
    },
    get pairCountdown() {
      const sec = Math.max(0, this.pairExpiresIn);
      const m = Math.floor(sec / 60);
      const s = String(sec % 60).padStart(2, "0");
      return `${m}:${s}`;
    },
    async startPairing() {
      if (!this.requireCodeForOcr(OCR_CODE_HINT)) return;
      this.closeUploadDialog();
      // 已有在传的会话（窗口被收起过，手机可能还在拍）：接着用它，别再建一条——
      // 批次里那几张照片的字节就在这条会话上，换 token 它们就对不上号了
      if (this.pairLive) {
        this.pairOpen = true;
        this.pairError = "";
        if (!this._pairSource) this._pairConnect();
        return;
      }
      // 上一条会话已经没了：批次里挂着它的下标，先清干净再开新会话
      this._expirePairSession();
      this.pairOpen = true;
      this.pairState = "waiting";
      this.pairError = "";
      this.pairCount = 0;
      this._pairCount = 0;
      this.pairUrl = "";
      this.pairToken = "";
      // 二维码库与配对接口并行加载；失败也不影响「复制网址」兜底
      const qrReady = ensureQrCode();
      try {
        const res = await fetch("/api/ocr/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          // 把当前配色交给手机页：手机上一眼就是电脑这套主题，不会突然换一身皮
          body: JSON.stringify({
            theme: this.theme,
            sky: this.theme === "sora" ? this.skyPeriod() : "",
          }),
        });
        if (!res.ok) {
          let detail = "";
          try {
            const data = await res.json();
            if (data && data.detail != null) {
              detail = typeof data.detail === "string" ? data.detail : (formatApiDetail(data.detail) || "");
            }
          } catch { /* 无正文时用状态码兜底 */ }
          throw Object.assign(
            new Error(detail || `无法创建配对（HTTP ${res.status}）`),
            { status: res.status }
          );
        }
        const data = await res.json();
        this.pairToken = data.token || "";
        await qrReady;
        // 绝对地址在前端拼：反代下由浏览器告诉我们真实的 origin 最可靠
        this.pairUrl = location.origin + (data.path || `/m/upload?token=${this.pairToken}`);
        this.pairExpiresIn = Number(data.expires_in) || 0;
        this.ocrPairToken = this.pairToken;
        this.ocrHost = this.isOcrTool ? "tool" : "modal";
        this._pairConnect();
      } catch (e) {
        // 会话没建起来就没什么可等的：收起等待窗口，把真实原因交给码弹窗/toast 呈现，
        // 而不是留一个写着「配对已失效，请重新扫码」的空窗口盖在真正的原因上面
        this.closePairing();
        this.pairState = "error";
        this.pairError = describeError(e, "无法创建配对，请重试");
        if (e && e.status === 401) this.handleAuthFailure(OCR_CODE_HINT);
        else this.toast(this.pairError, "error");
      }
    },
    _pairConnect() {
      this._stopPairTimer();
      this._pairCountdown();
      this._pairTimer = setInterval(() => this._pairCountdown(), 1000);
      // 状态用 SSE 推送：手机每传一张都会让电脑端立刻看到进度
      try {
        const es = new EventSource(`/api/ocr/pair/${this.pairToken}/events`);
        this._pairSource = es;
        es.addEventListener("state", (ev) => {
          let data = {};
          try { data = JSON.parse(ev.data); } catch { /* 忽略坏帧 */ }
          const prevCount = this._pairCount;
          this.pairCount = Number(data.count) || 0;
          this._pairCount = this.pairCount;
          this.pairExpiresIn = Number(data.expires_in) || this.pairExpiresIn;
          // 新照片到了：批次里只记下标与预览地址，像素留在服务器内存里等识别请求，
          // 电脑端为预览只下载这一次（排序/删除只改这份下标清单）
          const arrived = this.ocrImages.filter((item) => Number.isInteger(item.pairIndex)).length;
          for (let i = arrived; i < this.pairCount; i += 1) {
            this.ocrImages.push({
              id: `pair_${i}_${Date.now().toString(36)}`,
              name: `手机照片 ${i + 1}`,
              size: 0,
              pairIndex: i,
              url: `/api/ocr/pair/${this.pairToken}/image?i=${i}&t=${Date.now().toString(36)}`,
            });
          }
          if (this.pairCount > 0) {
            this.pairState = "receiving";
            // 只认「0 张 → 第 1 张」这一刻：配对到此成立，把二维码窗口让给识别工作区。
            // 会话和这条 SSE 都留着——手机还能接着拍，照片继续进批次，什么时候开始识别
            // 由电脑端说了算。之后的帧不再动窗口：用户手动打开它就是为了再看一眼二维码，
            // 不该被随后到的照片顶掉
            if (prevCount === 0) {
              // 第一批照片到了：与本地收图同一个口径——手机上图片区默认收起，正文优先
              if (!this._ocrMediaTouched) this.ocrMediaCollapsed = this._ocrDefaultCollapsed();
              if (this.pairOpen || this.ocrStage === "empty") {
                this.pairOpen = false;
                this.enterOcrStartStep();
              }
            }
          } else if (data.state === "connected") {
            this.pairState = "connected";
          }
        });
        es.addEventListener("error", (ev) => {
          // 服务端推来的过期/失效说明了原因就照它写（event: error 带 message）
          let msg = "";
          try { msg = String((JSON.parse(ev.data) || {}).message || ""); } catch { /* 连接中断没有正文 */ }
          if (msg) {
            this.pairError = msg;
            this._expirePairSession();
            es.close();
            this._pairSource = null;
          }
        });
      } catch (e) {
        this.pairState = "error";
        this.pairError = "无法连接服务器，请检查网络后重试";
      }
    },
    _pairCountdown() {
      if (this.pairExpiresIn <= 0) {
        this._stopPairTimer();
        this._expirePairSession();
        return;
      }
      this.pairExpiresIn -= 1;
    },
    _stopPairTimer() {
      if (this._pairTimer) clearInterval(this._pairTimer);
      this._pairTimer = null;
    },
    /* 会话过期或已失效：服务器内存里那批照片没了，批次里挂着的下标也就成了空气。
       还没出结果就把它们清掉（免得留下一堆坏掉的预览）；已经识别出文字的只提示、不动批次——
       把图删掉会让界面退回空状态，反而把用户已经拿到的文字藏起来。 */
    _expirePairSession() {
      this.pairState = "error";
      this.pairError = this.pairError || "配对已过期，请重新扫码";
      this._stopPairTimer();
      if (!this.ocrImages.some((item) => Number.isInteger(item.pairIndex))) return;
      if (this.ocrText) {
        this.toast("手机照片已过期；已识别出的文字不受影响", "warn");
        return;
      }
      this._dropStalePairImages("手机照片已过期，请重新扫码拍摄");
    },
    /* 丢掉批次里那些属于已消失会话的照片（字节已经没了，留着只有坏预览和错位的下标） */
    _dropStalePairImages(notice) {
      const stale = this.ocrImages.filter((item) => Number.isInteger(item.pairIndex));
      if (!stale.length) return 0;
      this.ocrImages = this.ocrImages.filter((item) => !Number.isInteger(item.pairIndex));
      this.ocrIndex = Math.max(0, Math.min(this.ocrIndex, this.ocrImages.length - 1));
      this.ocrPairToken = "";
      this.pairToken = "";
      this.pairUrl = "";
      this.pairCount = 0;
      if (!this.ocrImages.length) {
        this.ocrStage = "empty";
        this.ocrText = "";
        this.ocrRendered = "";
        this.ocrError = "";
      } else {
        this._afterBatchChanged();
      }
      if (notice) this.toast(notice, "warn");
      return stale.length;
    },
    /* 关掉配对窗口并断开这条 SSE。有没有照片决定要不要释放会话：
       有照片就留着（识别请求还要按 token 去服务器内存取字节），没有就顺手删掉这个空会话。 */
    closePairing({ release = null } = {}) {
      this._stopPairTimer();
      if (this._pairSource) {
        try { this._pairSource.close(); } catch { /* 忽略 */ }
        this._pairSource = null;
      }
      this.pairOpen = false;
      const keep = release === null ? this.pairHasPhotos : !release;
      if (keep) return;
      this.ocrPairToken = this.pairToken;
      this.releasePairSession();
    },
    /* 释放服务器内存里的那批照片（清空批次、换一批、离开工具时调用） */
    releasePairSession() {
      const token = this.ocrPairToken || this.pairToken;
      if (token) {
        fetch(`/api/ocr/pair/${token}`, { method: "DELETE", headers: { ...this.authHeaders() } }).catch(() => {});
      }
      this.ocrPairToken = "";
      this.pairToken = "";
      this.pairUrl = "";
      this.pairCount = 0;
    },
    /* 手动收起配对窗口（✕ / Esc / 点遮罩）：手机那边已经有人了（报到过，或有照片）
       就别释放——照片只在服务器内存里，释放等于把用户刚拍的删掉，只是不再看这个窗口；
       没人连过（也没照片）才真的把这条空会话放掉。 */
    cancelPairing() {
      if (this.pairHasPhotos || this.pairState === "connected") {
        this.pairOpen = false;
        if (this.pairHasPhotos) this.enterOcrStartStep();
        return;
      }
      this.closePairing();
    },
    copyPairUrl() {
      if (!this.pairUrl) return;
      copyToClipboard(this.pairUrl);
      this.toast("网址已复制");
    },

    /* ============ 智能错题迁移 ============ */
    migrationBuildInput(cause) {
      const form = this.migration.form;
      return [
        "【原题干】",
        form.question.trim(),
        "",
        "【标准答案】",
        form.standardAnswer.trim() || "（老师未提供，请先依据题干判断）",
        "",
        "【学生错误作答 / 错误选项分布】",
        form.studentAnswers.trim() || "（老师未提供）",
        "",
        "【已经确认的本质错因】",
        cause.label,
        "",
        "【迁移题量】",
        String(this.migration.questionCount),
        "",
        "请严格围绕这一个本质错因完成全部四个部分。",
      ].join("\n");
    },
    async migrationReadError(res, fallback) {
      let message = fallback;
      try {
        const data = await res.json();
        if (data && data.detail != null) {
          message = formatApiDetail(data.detail) || JSON.stringify(data.detail);
        }
      } catch {}
      return message;
    },
    migrationCauseKey(label) {
      return String(label || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    },
    migrationParseCauses(rawCauses, prefix = "cause") {
      if (!Array.isArray(rawCauses)) return [];
      return rawCauses.map((cause, index) => ({
        id: String(cause.id || `${prefix}_${index}`),
        label: String(cause.label || cause.cause || cause).trim(),
      })).filter((cause) => cause.label);
    },
    async analyzeMigration(retry = false) {
      if (!this.ensureCanRun("当前模型需要输入使用码后才能分析错因")) return;
      if (!this.migration || this.migration.analyzing) return;
      const state = this.migration;
      if (!state.form.question.trim()) {
        this.toast("请先填写题干", "warn");
        return;
      }
      if (retry) {
        const feedback = state.feedback.trim();
        if (!feedback) {
          this.toast("请先写下需要调整的意见", "warn");
          return;
        }
        // 不覆盖旧反馈，后端每次都会收到完整历史。
        state.feedbackHistory = [...state.feedbackHistory, feedback];
        state.feedback = "";
      }

      this.retreatMascot();
      state.step = 2;
      state.analyzing = true;
      state.analysisError = "";
      try {
        const res = await fetch("/api/chat/migration/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            question: state.form.question.trim(),
            standard_answer: state.form.standardAnswer.trim(),
            student_answers: state.form.studentAnswers.trim(),
            error_cause: state.form.errorCause.trim(),
            feedback_history: state.feedbackHistory.slice(),
            model: this.selectedModel || undefined,
          }),
        });
        if (!res.ok) {
          const msg = await this.migrationReadError(res, "错因分析失败");
          if (res.status === 401 || res.status === 403) this.handleAuthFailure(msg);
          throw new Error(msg);
        }
        const data = await res.json();
        const causes = this.migrationParseCauses(data.causes);
        if (!causes.length) throw new Error("模型没有返回可确认的错因");
        state.analysisHistory = Array.isArray(data.analysis_history)
          ? data.analysis_history
          : [];
        state.causes = causes;
        state.selectedCauseIds = [];
      } catch (e) {
        state.analysisError = describeError(e, "错因分析失败");
        this.toast(state.analysisError, "error");
      } finally {
        state.analyzing = false;
      }
    },
    async loadMoreMigrationCauses() {
      if (!this.ensureCanRun("当前模型需要输入使用码后才能继续分析")) return;
      if (!this.migration || this.migration.analyzing || this.migration.moreAnalyzing) return;
      const state = this.migration;
      if (!state.causes.length || !state.analysisHistory.length) {
        this.toast("当前没有可继续分析的错因历史", "warn");
        return;
      }

      this.retreatMascot();
      state.moreAnalyzing = true;
      state.analysisError = "";
      try {
        const res = await fetch("/api/chat/migration/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            question: state.form.question.trim(),
            standard_answer: state.form.standardAnswer.trim(),
            student_answers: state.form.studentAnswers.trim(),
            error_cause: state.form.errorCause.trim(),
            feedback_history: state.feedbackHistory.slice(),
            analysis_history: state.analysisHistory.slice(),
            continue_generation: true,
            model: this.selectedModel || undefined,
          }),
        });
        if (!res.ok) {
          const msg = await this.migrationReadError(res, "继续生成错因失败");
          if (res.status === 401 || res.status === 403) this.handleAuthFailure(msg);
          throw new Error(msg);
        }
        const data = await res.json();
        const existing = new Set(state.causes.map((cause) => this.migrationCauseKey(cause.label)));
        const additions = this.migrationParseCauses(data.causes, `more_${Date.now()}`)
          .filter((cause) => {
            const key = this.migrationCauseKey(cause.label);
            if (!key || existing.has(key)) return false;
            existing.add(key);
            return true;
          })
          .map((cause, index) => ({ ...cause, id: `more_${Date.now()}_${index}` }));
        state.causes = [...state.causes, ...additions];
        if (Array.isArray(data.analysis_history)) state.analysisHistory = data.analysis_history;
        if (additions.length) this.toast(`已补充 ${additions.length} 个新错因`);
        else this.toast("AI 暂时没有发现新的独立错因", "warn");
      } catch (e) {
        state.analysisError = describeError(e, "继续生成错因失败");
        this.toast(state.analysisError, "error");
      } finally {
        state.moreAnalyzing = false;
      }
    },
    toggleMigrationCause(id) {
      const selected = new Set(this.migration.selectedCauseIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      this.migration.selectedCauseIds = [...selected];
    },
    passMigrationCauses() {
      if (!this.migrationSelectedCauses.length) {
        this.toast("请至少勾选一个需要处理的错因", "warn");
        return;
      }
      // 进入生成步骤：清掉错因分析阶段留下的旧报错，本步骤只显示生成前的预检失败
      this.migration.analysisError = "";
      this.migration.step = 3;
    },
    backMigrationStep(step) {
      if (this.migration.generating) return;
      this.migration.step = step;
    },
    async beginMigration() {
      if (!this.ensureCanRun("当前模型需要输入使用码后才能生成迁移练习")) return;
      if (this.migration.generating || this.migration.prechecking) return;
      const selected = this.migrationSelectedCauses;
      if (!selected.length) {
        this.toast("请至少勾选一个需要处理的错因", "warn");
        this.migration.step = 2;
        return;
      }

      const state = this.migration;
      const quotaBefore = this.quotaRemaining;
      this.retreatMascot();
      state.prechecking = true;
      try {
        // 免费模型与免码调用不扣次数，跳过额度预检（否则额度不足的用户会被误拦）
        if (this.willConsumeQuota) {
          const quotaRes = await fetch("/api/chat/migration/quota", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.authHeaders(),
            },
            body: JSON.stringify({ cause_count: selected.length }),
          });
          if (!quotaRes.ok) {
            if (quotaRes.status === 401) this.clearAuth();
            throw new Error(await this.migrationReadError(quotaRes, "额度不足，无法开始生成"));
          }
        }

        this.retreatMascot();
        state.step = 4;
        state.generated = false;
        state.stopRequested = false;
        state.batchId = `migration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        state.results = selected.map((cause, index) => ({
          id: `${state.batchId}_${index}`,
          causeId: cause.id,
          cause: cause.label,
          output: "",
          rendered: "",
          status: "waiting",
          error: "",
          streaming: true,
          collapsed: false,
          requestId: `${state.batchId}_${index}`,
          reasoning: "",
          reasoningShown: "",
          reasoningOpen: true,
          reasoningDone: false,
          reasoningTruncated: false,
          reasoningTokens: 0,
        }));
        state.generating = true;
        const batchId = state.batchId;
        await Promise.all(state.results.map((card, index) => (
          this.streamMigrationCard(card, index, batchId, selected.length)
        )));
        state.generating = false;
        state.generated = true;
        const partial = state.results.some((card) => card.status !== "done");
        // 出错也要留历史（用户表单里的题目/答案是真材实料）：汇总失败卡片的原因，
        // 整批失败就是那句原始错误，部分失败则标注比例
        const failed = state.results.filter((card) => card.status === "error");
        const errText = failed.length
          ? (failed.length === state.results.length
            ? (failed[0].error || "生成失败")
            : `${failed.length}/${state.results.length} 张卡片生成失败`)
          : "";
        const item = this.pushMigrationHistory(partial, errText);
        if (partial) this.toast("部分迁移卡片未完成，请检查后重试", "warn");
        else this.toast(`已完成 ${state.results.length} 张迁移卡片`);
      } catch (e) {
        state.generating = false;
        state.analysisError = describeError(e, "生成失败");
        this.toast(state.analysisError, "error");
      } finally {
        state.prechecking = false;
        // 迁移按已交付卡片摊分扣费：部分完成也已经扣了，不能只在 !partial 时刷新
        this._afterRunQuota(quotaBefore);
      }
    },
    async consumeSSE(res, onEvent) {
      if (!res.body) throw new Error("浏览器不支持流式读取");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let eventName = "message";
      let eventData = "";
      // 是否收到过终止事件（done/[DONE]/[CANCELLED]）：没收到就断流 = 内容不完整
      let sawTerminal = false;
      const dispatch = () => {
        if (eventData !== "" || eventName !== "message") {
          if (eventName === "done" || eventData === "[DONE]" || eventData === "[CANCELLED]") {
            sawTerminal = true;
          }
          onEvent(eventName, eventData);
        }
        eventName = "message";
        eventData = "";
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.replace(/\r$/, "");
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const data = line.slice(5);
            eventData += (eventData ? "\n" : "") + (data.startsWith(" ") ? data.slice(1) : data);
          } else if (!line) dispatch();
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        for (const raw of buffer.split("\n")) {
          const line = raw.replace(/\r$/, "");
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            const data = line.slice(5);
            eventData += (eventData ? "\n" : "") + (data.startsWith(" ") ? data.slice(1) : data);
          } else if (!line) dispatch();
        }
      }
      dispatch();
      // 流干净结束但没给终止事件：多半是反代/网络把连接掐了，半截内容不能当成功
      if (!sawTerminal) {
        try { console.warn("SSE 流未收到终止事件即结束，按中断处理"); } catch { /* 忽略 */ }
        throw Object.assign(new Error("生成中断，内容可能不完整，请重试"), { truncated: true });
      }
    },
    async streamMigrationCard(card, index, batchId, batchSize) {
      // 迁移卡片正文也要 renderMd 渲染，先备好组件
      await nbxEnsureRenderLibs();
      const controller = new AbortController();
      this._migrationAbortControllers[card.requestId] = controller;
      try {
        const cause = { id: card.causeId, label: card.cause };
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            tool_id: "26",
            input: this.migrationBuildInput(cause),
            model: this.selectedModel || undefined,
            request_id: card.requestId,
            batch_id: batchId,
            batch_size: batchSize,
            batch_index: index,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // 结构化 403（如额度不足无法支付整批迁移）不是登录态问题，不能清掉本地凭证
          let quotaShortfall = false;
          if (res.status === 403) {
            try {
              const detail = (await res.clone().json()).detail;
              quotaShortfall = !!(detail && typeof detail === "object" && "required" in detail);
            } catch { /* 非 JSON 响应按普通 403 处理 */ }
          }
          const msg = await this.migrationReadError(res, `HTTP ${res.status}`);
          if ((res.status === 401 || res.status === 403) && !quotaShortfall) {
            this.handleAuthFailure(msg);
          }
          throw new Error(msg);
        }
        card.status = "streaming";
        await this.consumeSSE(res, (event, data) => {
          if (event === "error") {
            let message = data;
            try { message = JSON.parse(data).message || data; } catch {}
            throw new Error(message);
          }
          if (event === "reasoning") {
            let text = data;
            let tok = 0;
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed === "string") text = parsed;
              else if (parsed && typeof parsed.t === "string") {
                text = parsed.t;
                tok = Number(parsed.n) || 0;
              }
            } catch {}
            if (text) this.appendCardReasoning(card, text, tok);
            return;
          }
          if (event === "token") {
            let text = data;
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed === "string") text = parsed;
            } catch {}
            if (text) {
              // 首个正文 token 到达即收起本卡推理盒，避免答案被顶下去。
              // 只收一次：每个 token 都收会把用户的手动展开立刻打回去。
              if (card.reasoning && !card.reasoningDone) {
                card.reasoningDone = true;
                card.reasoningOpen = false;
              }
              card.output += text;
              this.scheduleCardRender(card);
            }
          } else if (event === "done" || data === "[DONE]") {
            if (card.reasoning && !card.reasoningDone) {
              card.reasoningDone = true;
              card.reasoningOpen = false;
            }
            if (data === "[CANCELLED]") card.status = "stopped";
            else card.status = "done";
          }
        });
        if (card.status === "streaming" || card.status === "waiting") card.status = "done";
      } catch (e) {
        if (e && e.name === "AbortError") card.status = "stopped";
        else {
          card.status = "error";
          card.error = describeError(e, "生成失败");
        }
      } finally {
        // 打字机收尾统一放这里：done 的余量平滑放完（放完那帧自动是干净全文），
        // 停止 / 出错残文立即全量；推理不玩动画，定稿即整段可见。
        // 先落 streaming=false 再收尾：渲染口径以「已不是流式中」为准
        card.streaming = false;
        if (card._rTyper) card._rTyper.reset((card.reasoning || "").length);
        card.reasoningShown = card.reasoning || "";
        if (card._typer) {
          if (card.status === "done") card._typer.finish();
          else {
            card._typer.reset((card.output || "").length);
            card.rendered = renderMd(card.output);
          }
        }
        delete this._migrationAbortControllers[card.requestId];
      }
    },
    stopMigration() {
      if (!this.migration || !this.migration.generating) return;
      this.migration.stopRequested = true;
      const requests = this.migration.results.map((card) => card.requestId).filter(Boolean);
      // 与 stop() 一致：先断本地流让 UI 立即恢复，再异步通知后端
      Object.values({ ...this._migrationAbortControllers }).forEach((controller) => {
        try { controller.abort(); } catch {}
      });
      requests.forEach((requestId) => this.notifyStop(requestId));
    },
    migrationCardText(card, markdown = false) {
      const heading = markdown ? `## 错因：${card.cause}\n\n` : `错因：${card.cause}\n\n`;
      if (markdown) return heading + (card.output || "");
      return heading + markdownToPlainText(card.output || "");
    },
    migrationAllText(markdown = false) {
      return this.migration.results
        .filter((card) => card.output && card.output.trim())
        .map((card) => this.migrationCardText(card, markdown))
        .join(markdown ? "\n\n---\n\n" : "\n\n");
    },
    toggleExportMenu(anchor) {
      if (this.exportMenuOpen && !this.migrationExportTarget) {
        this.closeExportMenu();
        return;
      }
      this.closeExportMenu();
      this._exportMenuAnchor = anchor;
      this.exportMenuStyle = "visibility:hidden;";
      this.exportMenuOpen = true;
      this.$nextTick(() => this.repositionExportMenu());
    },
    repositionExportMenu() {
      if (!this.exportMenuOpen || this.migrationExportTarget || !this._exportMenuAnchor) return;
      if (this._exportMenuPositionFrame) cancelAnimationFrame(this._exportMenuPositionFrame);
      this._exportMenuPositionFrame = requestAnimationFrame(() => {
        this._exportMenuPositionFrame = null;
        const anchor = this._exportMenuAnchor;
        const menu = document.querySelector("[data-export-menu]");
        if (!anchor || !menu || !document.documentElement.contains(anchor)) return;

        const padding = window.innerWidth <= 640 ? 12 : 16;
        const availableHeight = Math.max(96, Math.floor(anchor.getBoundingClientRect().top - padding));
        menu.style.maxHeight = "none";
        menu.style.overflowY = "hidden";
        const naturalHeight = menu.scrollHeight;
        const needsScroll = naturalHeight > availableHeight;
        this.exportMenuStyle = [
          needsScroll ? `max-height:${availableHeight}px` : "max-height:none",
          `overflow-y:${needsScroll ? "auto" : "hidden"}`,
          "visibility:visible",
        ].join(";");
      });
    },
    migrationExportCards() {
      if (!this.migration || !this.migrationExportTarget) return [];
      if (this.migrationExportTarget.scope === "card") {
        const card = this.migration.results.find(
          (item) => item.id === this.migrationExportTarget.cardId,
        );
        return card && card.output ? [card] : [];
      }
      return this.migration.results.filter((card) => card.output && card.output.trim());
    },
    openMigrationExport(scope, cardId = "", anchor = null) {
      if (scope === "card") {
        const card = this.migration.results.find((item) => item.id === cardId);
        if (!card || !card.output) return;
      } else if (!this.migrationHasOutput) {
        return;
      }

      const sameTarget = this.exportMenuOpen
        && this.migrationExportTarget
        && this.migrationExportTarget.scope === scope
        && this.migrationExportTarget.cardId === cardId;
      if (sameTarget) {
        this.closeExportMenu();
        return;
      }

      const menuAlreadyOpen = this.exportMenuOpen && this.migrationExportTarget;
      this._migrationExportAnchor = anchor;
      if (!menuAlreadyOpen) this.migrationExportStyle = "visibility:hidden;";
      this.migrationExportTarget = { scope, cardId };
      this.exportMenuOpen = true;
      this.$nextTick(() => this.repositionMigrationExport());
    },
    repositionMigrationExport() {
      if (!this.exportMenuOpen || !this.migrationExportTarget || !this._migrationExportAnchor) return;
      if (this._migrationExportPositionFrame) cancelAnimationFrame(this._migrationExportPositionFrame);
      this._migrationExportPositionFrame = requestAnimationFrame(() => {
        this._migrationExportPositionFrame = null;
        const anchor = this._migrationExportAnchor;
        const menu = document.querySelector("[data-migration-export-menu]");
        if (!anchor || !menu || !document.documentElement.contains(anchor)) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const isMobile = viewportWidth <= 640;
        const padding = isMobile ? 12 : 16;
        const menuWidth = isMobile
          ? Math.max(0, viewportWidth - padding * 2)
          : Math.min(280, Math.max(0, viewportWidth - padding * 2));
        const availableHeight = Math.max(96, viewportHeight - padding * 2);
        const anchorGap = 10;

        menu.style.width = `${menuWidth}px`;
        menu.style.maxHeight = "none";
        menu.style.overflowY = "hidden";
        const naturalMenuHeight = menu.scrollHeight || menu.getBoundingClientRect().height || 360;
        const anchorRect = anchor.getBoundingClientRect();
        const spaceAbove = Math.max(0, Math.floor(anchorRect.top - padding - anchorGap));
        const spaceBelow = Math.max(0, Math.floor(viewportHeight - anchorRect.bottom - padding - anchorGap));
        const opensAbove = naturalMenuHeight <= spaceAbove || spaceAbove > spaceBelow;
        const menuMaxHeight = Math.min(
          availableHeight,
          Math.max(96, opensAbove ? spaceAbove : spaceBelow),
        );
        const menuHeight = Math.min(naturalMenuHeight, menuMaxHeight);
        const needsScroll = naturalMenuHeight > menuMaxHeight;
        menu.style.maxHeight = `${menuMaxHeight}px`;
        menu.style.overflowY = needsScroll ? "auto" : "hidden";
        let top;
        if (opensAbove) {
          top = anchorRect.top - menuHeight - anchorGap;
        } else {
          top = anchorRect.bottom + anchorGap;
        }
        top = Math.max(padding, Math.min(top, viewportHeight - padding - menuHeight));

        const left = isMobile
          ? Math.max(padding, (viewportWidth - menuWidth) / 2)
          : Math.max(padding, Math.min(anchorRect.right - menuWidth, viewportWidth - padding - menuWidth));
        this.migrationExportStyle = [
          `top:${Math.round(top)}px`,
          `left:${Math.round(left)}px`,
          `width:${Math.round(menuWidth)}px`,
          `max-height:${Math.round(menuMaxHeight)}px`,
          `overflow-y:${needsScroll ? "auto" : "hidden"}`,
          `transform-origin:${opensAbove ? "bottom right" : "top right"}`,
          `--export-menu-pop-y:${opensAbove ? "0.5rem" : "-0.5rem"}`,
          "visibility:visible",
        ].join(";");
      });
    },
    closeExportMenu() {
      if (this._exportMenuPositionFrame) cancelAnimationFrame(this._exportMenuPositionFrame);
      this._exportMenuPositionFrame = null;
      if (this._migrationExportPositionFrame) cancelAnimationFrame(this._migrationExportPositionFrame);
      this._migrationExportPositionFrame = null;
      this.exportMenuOpen = false;
      this._exportMenuAnchor = null;
      this.migrationExportTarget = null;
      this._migrationExportAnchor = null;
    },
    hasMigrationExportTarget() {
      return this.isMigrationTool && !!this.migrationExportTarget;
    },
    getExportMarkdown() {
      if (this.isVisualPaperTool && this.vpHasData) {
        return this.vpGetExportMarkdown();
      }
      if (this.hasMigrationExportTarget()) {
        const cards = this.migrationExportCards();
        return this.migrationExportTarget.scope === "all"
          ? cards.map((card) => this.migrationCardText(card, true)).join("\n\n---\n\n")
          : (cards[0] ? this.migrationCardText(cards[0], true) : "");
      }
      return this.output;
    },
    getExportPlain() {
      if (this.isVisualPaperTool && this.vpHasData) {
        return this.vpGetExportPlain();
      }
      if (this.hasMigrationExportTarget()) {
        const cards = this.migrationExportCards();
        return this.migrationExportTarget.scope === "all"
          ? cards.map((card) => this.migrationCardText(card, false)).join("\n\n")
          : (cards[0] ? this.migrationCardText(cards[0], false) : "");
      }
      return markdownToPlainText(this.output);
    },
    buildExportContent() {
      let content;
      if (this.isVisualPaperTool && this.vpHasData) {
        content = renderMd(this.vpGetExportMarkdown());
      } else if (this.hasMigrationExportTarget()) {
        content = this.migrationExportCards()
          .map((card, index) => {
            const pageBreak = this.migrationExportTarget.scope === "all" && index
              ? "page-break-before:always;"
              : "";
            return `<section style="${pageBreak}">${renderMd(this.migrationCardText(card, true))}</section>`;
          })
          .join("");
      } else {
        content = renderMd(this.output);
      }
      // 移除答案遮罩 class，导出时正常显示
      return content.replace(/ class="ans"/g, "");
    },
    saveMigrationFavorite() {
      if (!this.migrationHasOutput) return;
      const form = this.migration.form;
      const favorite = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        title: `智能错题迁移 · ${this.excerpt(form.question, 20) || "未命名"}`,
        content: this.migrationAllText(true),
        toolId: "26",
        toolName: "智能错题迁移",
        createdAt: Date.now(),
        migration: {
          form: { ...form },
          causes: this.migrationSelectedCauses.map((cause) => ({ ...cause })),
          questionCount: this.migration.questionCount,
          results: this.migration.results
            .filter((card) => card.output && card.output.trim())
            .map((card) => ({ causeId: card.causeId, cause: card.cause, output: card.output })),
        },
      };
      this.favorites.unshift(favorite);
      if (this.favorites.length > FAVORITES_LIMIT) this.favorites.length = FAVORITES_LIMIT;
      this._persistFavorites();
      this._mirrorChanged("f", favorite.id, false, favorite.createdAt);
      this.toast("已收藏整条迁移记录");
    },
    pushMigrationHistory(partial = false, error = "") {
      const form = this.migration.form;
      // 卡片状态与失败原因一并存：重开历史时部分失败的卡片不能被显示成「已完成」
      const fields = {
        input: form.question.trim(),
        output: this.migrationAllText(true),
        fileName: "",
        model: this.selectedModel,
        partial: !!partial,
        migration: {
          form: { ...form },
          causes: this.migrationSelectedCauses.map((cause) => ({ ...cause })),
          questionCount: this.migration.questionCount,
          results: this.migration.results
            .filter((card) => card.output && card.output.trim())
            .map((card) => ({
              causeId: card.causeId,
              cause: card.cause,
              output: card.output,
              status: card.status,
              error: card.error || "",
            })),
        },
      };
      // 失败走统一入口：同样是「同输入连续失败合并一条」，整批失败时输入也不会丢
      if (error) return this.pushFailedHistory(error, fields);
      const item = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolId: this.currentTool.id,
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        createdAt: Date.now(),
        ...fields,
      };
      if (this.migrationHasOutput) this.generateTitle(item);
      return this._unshiftHistory(item);
    },

    /* ============ 翻译（工具 33）：原文译文对照 ============ */
    /* 顶部两个语言下拉：界面显示中文名，送进提示词的是母语者写法（见 TR_LANGS） */
    get trSourceOptions() {
      return TR_LANGS;
    },
    get trTargetOptions() {
      return TR_LANGS.filter((l) => !l.sourceOnly);
    },
    get trSourceLabel() {
      return trLangLabel(this.trSourceLang);
    },
    get trTargetLabel() {
      return trLangLabel(this.trTargetLang);
    },
    /* 已经有一条记录在手时，按钮就该说「更新翻译」：再点一次改的是那条记录，不是新建 */
    get trUpdating() {
      return !!this.trHistoryId;
    },
    get trHasSource() {
      return !!String(this.input || "").trim();
    },
    /* 译文栏此刻是否真的占着地方。宽屏两栏始终并排（is-hidden 那条规则只写在 <lg 里），
       窄屏才看 trResultVisible —— 对照滚动、对齐都以它为准，别拿 trResultVisible 直接判 */
    get trResultShown() {
      return !TR_STACK_MQ.matches || this.trResultVisible;
    },
    get trStatusText() {
      if (this.streaming) return this.status === "connecting" ? "正在连接…" : "正在翻译…";
      if (this.status === "error") return "翻译失败";
      if (this.status === "stopped") return `已停止 · 保留 ${this.output.length} 字`;
      if (this.output) return `已翻译 · ${this.output.length} 字`;
      return this.trHasSource ? "可以翻译了" : "等待原文";
    },
    /* 请求里的语言对。源语言选「自动检测」时送 auto，由模型自己判断；
       其余送母语者写法（English (US) 这类），后端原样注入提示词 */
    trLangPayload() {
      return {
        source_lang: this.trSourceLang === "auto" ? "auto" : trLangNative(this.trSourceLang),
        target_lang: trLangNative(this.trTargetLang) || trLangNative(TR_DEFAULT_TARGET),
      };
    },
    toggleTrMenu(which) {
      this.trMenu = this.trMenu === which ? "" : which;
    },
    closeTrMenu() {
      this.trMenu = "";
    },
    chooseTrSourceLang(id) {
      this.trMenu = "";
      if (!trLangById(id)) return;
      // 与目标语言撞车时自动换向：原文设成简体中文 → 目标语言变英语（美式）
      if (id !== "auto" && id === this.trTargetLang) this.trTargetLang = trTargetFor(id);
      this.trSourceLang = id;
    },
    chooseTrTargetLang(id) {
      this.trMenu = "";
      const lang = trLangById(id);
      if (!lang || lang.sourceOnly) return;
      this.trTargetLang = id;
    },
    /* 交换语言对。源语言是「自动检测」时没有可交换的对象：
       把目标语言提上来当源语言，再按它给一个常用对译方向（中→英 / 其余→中） */
    swapTrLangs() {
      this.trMenu = "";
      if (this.trSourceLang === "auto") {
        const target = this.trTargetLang;
        this.trSourceLang = target;
        this.trTargetLang = trTargetFor(target);
        return;
      }
      const source = this.trSourceLang;
      this.trSourceLang = this.trTargetLang;
      this.trTargetLang = source;
    },
    /* 折叠/展开原文。窄屏上这两个状态是一件事的两面，收原文＝看译文、展原文＝回到只写原文的
       输入态，所以收起来时才把译文栏放出来、展开时又把它收回去（宽屏两栏始终并排，不参与）。
       没有译文可看时不折叠：那会把「隐藏原文」变成「放出一个空译文框」，屏幕上只剩个空框 */
    toggleTrFold() {
      const folding = !this.trSrcCollapsed;
      if (folding && !this.output && !this.streaming) {
        this.toast("还没有译文可看：先点「翻译」，或直接在这里写原文", "warn");
        return;
      }
      this.trSrcCollapsed = folding;
      if (TR_STACK_MQ.matches) this.revealTrResult(folding);
      // 栏宽/栏高变了，原文框要按新的可用空间重算高度
      this.$nextTick(() => {
        this.trGrow();
        this.onTrPaneScroll("source");
      });
    },
    /* 对照滚动：一侧滚动就按进度比例带动另一侧，始终开着——对照阅读的价值就在两栏对齐，
       留一个开关只会让人怀疑它到底有没有生效。三处细节都是为了「一直可用」：
       1) 带动的那一栏自己也会派发滚动事件（回声）。不靠时间锁吞它（时间锁会吞掉连续滚动中
          的后续事件，越滚越不同步），而是认「上一次是我写到这一栏的那个值」：命中就只更新
          跟随状态、不反向带动。算出来的落点与当前值一致时自然收敛，两栏不会来回追。
       2) 滚轮的节奏比帧密：合并成每帧至多写一次，并在写入那一刻取最新位置重算。
       3) 任一侧不可滚（内容还没对方长）时不做映射——硬凑只会抖；等它长过一屏后自然恢复。 */
    onTrPaneScroll(which) {
      if (!this.isTranslateTool) return;
      const a = this.$refs.trSourcePane;
      const b = this.$refs.trResultPane;
      if (!a || !b) return;
      const pane = which === "source" ? a : b;
      // 译文栏是否贴着底：贴着就跟流式输出往下走；用户往回翻过就不跟
      if (which === "result") {
        this._trFollowOutput = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 60;
      }
      const driven = this._trDriven;
      if (driven && driven.side === which && Math.abs(pane.scrollTop - driven.top) < 2) {
        // 回声：这一栏是被上一步带动的，不再反推回去
        this._trDriven = null;
        return;
      }
      // 事件来自另一栏 = 上一次带动已经结束，旧记录作废
      if (driven && driven.side !== which) this._trDriven = null;
      // 原文折叠 / 译文栏被键盘收起 / 窄屏上译文栏还没出现时，两栏都不是可对照的一对，
      // 映射只会互相拽着跑。折叠期间译文栏仍按上面的「贴底跟随」走它的流式输出
      if (this.trSrcCollapsed || this.trResultFolded || !this.trResultShown) {
        this._trDriven = null;
        return;
      }
      this._trScrollSide = which;
      if (this._trSyncRaf) return;
      this._trSyncRaf = requestAnimationFrame(() => {
        this._trSyncRaf = 0;
        const side = this._trScrollSide;
        this._trScrollSide = "";
        if (!side) return;
        const from = side === "source" ? a : b;
        const to = side === "source" ? b : a;
        const top = trSyncTargetTop(
          from.scrollTop,
          from.scrollHeight - from.clientHeight,
          to.scrollHeight - to.clientHeight
        );
        if (top == null || Math.abs(to.scrollTop - top) < 2) return;
        this._trDriven = { side: side === "source" ? "result" : "source", top };
        to.scrollTop = top;
      });
    },
    trScrollTop() {
      this._trFollowOutput = true;
      this._trDriven = null;
      [this.$refs.trSourcePane, this.$refs.trResultPane].forEach((el) => {
        if (el) el.scrollTop = 0;
      });
    },
    /* 原文框按内容长高、不设上限：滚动发生在外层栏里，同步滚动才有可映射的进度。
       矮的时候至少铺满整栏（点空白处就能接着写，不必去够底下的输入条） */
    trGrow() {
      if (this._trGrowRaf) return;
      this._trGrowRaf = requestAnimationFrame(() => {
        this._trGrowRaf = 0;
        const el = this.$refs.trInput;
        if (!el) return;
        const pane = this.$refs.trSourcePane;
        el.style.height = "auto";
        el.style.height = Math.max(pane ? pane.clientHeight : 0, el.scrollHeight) + "px";
      });
    },
    /* 输入法弹起/收起时译文栏的让位。别的工具的输入区在最下方，键盘一弹只是整块往上收；
       这个工具的输入区在上半屏，跟着一起收只会把「正在输入的原文栏」压到只剩两行，
       所以窄屏下键盘弹起时把译文栏收成一行，高度全给原文栏；键盘收起再放开。
       键盘动画期间 visualViewport 会连续报值，用一个小延时取最终态，免得译文栏一开一合。 */
    scheduleTrKbFold(open) {
      clearTimeout(this._trKbTimer);
      this._trKbTimer = setTimeout(() => {
        this._trKbTimer = null;
        const wasFolded = this.trResultFolded;
        this.trResultFolded = !!open && TR_STACK_MQ.matches;
        // 让位结束（收窄或放开）后两栏高度都变了：原文框按新的可用空间重算，
        // 等折叠动画落定再按进度重新对齐。流式生成期间不重新对齐——
        // 那时译文栏正跟着输出往下走，把用户的视线拽回原文位置反而更糟
        if (this.isTranslateTool && wasFolded !== this.trResultFolded) {
          setTimeout(() => {
            if (!this.isTranslateTool) return;
            this.trGrow();
            if (!this.streaming) this.onTrPaneScroll("source");
          }, 520);
        }
      }, 120);
    },
    /* 窄屏：译文栏在按下「翻译」之前整块不占地方，原文栏就能拿到几乎整屏的高度
       （输入与核对都宽敞），按下翻译再按同一条非线性动画把它放出来。
       宽屏不受影响——那条规则只写在 <lg 的媒体查询里，所以这里可以放心设状态。
       收放都会改变两栏的高度，动画落定后重算原文框高度并按进度重新对齐。 */
    revealTrResult(visible) {
      const next = !!visible;
      if (this.trResultVisible === next) return;
      this.trResultVisible = next;
      clearTimeout(this._trRevealTimer);
      // 宽屏没有这一出（两栏始终并排），省掉这次回算
      if (!TR_STACK_MQ.matches) return;
      this._trRevealTimer = setTimeout(() => {
        this._trRevealTimer = null;
        if (!this.isTranslateTool) return;
        this.trGrow();
        // 流式期间译文栏正跟着输出往下走，这时把视线拽回原文位置反而更糟
        if (!this.streaming) this.onTrPaneScroll("source");
      }, 520);
    },
    /* 清空两栏（记录留在历史里不动）。与当前记录脱钩：下一次生成新建一条 */
    trClearSource() {
      if (this.streaming) return;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";
      this.trNew();
      this.$nextTick(() => this.trGrow());
    },
    /* 新建一次翻译：只与当前记录脱钩，屏上的原文留着（改一改就是另一份材料的起手式） */
    trNew() {
      if (this.streaming) return;
      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this.status = "idle";
      this.trHistoryId = "";
      this.trTruncated = false;
      this.activeHistoryId = null;
      // 推理盒也要一起清：它是上一轮的产物，正文清空后单独留一条「思考过程」
      // 挂在空栏里，看着像这一屏坏了（切工具 / 重新开跑都会清，这里是漏掉的一处）
      this.resetReasoning();
      // 译文清空后「只看译文」就没意义了：把原文放回来（折叠钮此时是禁用的，不然出不来）
      this.trSrcCollapsed = false;
      // 窄屏：也把译文栏收回去，把整屏高度还给输入（下一轮翻译再放出来）
      this.revealTrResult(false);
      this.trScrollTop();
    },
    copyTrText() {
      if (!String(this.output || "").trim()) {
        this.toast("还没有可复制的译文", "warn");
        return;
      }
      copyToClipboard(this.output);
      this.toast("译文已复制");
    },
    scheduleTrRender() {
      // 与其余流式文本同一套节奏：token 到达只推进打字机，上屏逐字放行
      this.outTyper().grow((this.output || "").length);
    },
    flushTrRender() {
      // 收尾：指针对齐全文，整份干净渲染
      this.outTyper().reset((this.output || "").length);
      this.rendered = renderMd(this.output);
      this.pinTrBottom();
    },
    /* 译文收尾渲染：自然完成的余量交给打字机平滑放完（放行帧带淡入，
       放完那帧是干净全文）；停止 / 出错残文立即全量 */
    settleTrRender(state) {
      if (state === "done" && this.outTyper().finishing) {
        this.outTyper().paint();
        this.pinTrBottom();
        return;
      }
      this.flushTrRender();
    },
    /* 流式输出时把译文栏钉在底部，否则新字全写在视口下方，一屏一屏地跳。
       用户往回翻过（_trFollowOutput 为假）就不跟了。
       钉底刻意**不**带动原文栏：原文是静态的参照物，被拽着往下跑就失去意义了
       —— 程序化写入会留下 _trDriven 记录，它自己派发的回声事件因此不会被反向转发。 */
    pinTrBottom() {
      if (!this.streaming || !this._trFollowOutput) return;
      const el = this.$refs.trResultPane;
      if (!el) return;
      // 记的是浏览器会夹取到的那个值（scrollHeight - clientHeight），不是 scrollHeight：
      // 回声事件比对的是实际 scrollTop，记错了就认不出这次回声、会把原文栏一起拽下去
      const top = el.scrollHeight - el.clientHeight;
      if (top <= 0 || Math.abs(el.scrollTop - top) < 2) return;
      this._trDriven = { side: "result", top };
      el.scrollTop = top;
    },
    /* 开始 / 更新翻译。不是实时翻译：改了原文也得自己按这一下。
       已经有记录在手时写回同一条（updateId），没有才新建——历史里不会刷出一串半成品 */
    async trRun() {
      if (!this.isTranslateTool || this.streaming) return;
      if (!this.ensureCanRun("当前模型需要输入使用码后才能翻译")) return;
      const source = String(this.input || "").trim();
      if (!source) {
        this.toast("左侧还没有原文：粘贴、上传文件，或用拍照识别", "warn");
        return;
      }
      if (this.currentTool && !this.currentTool.prompt_loaded) {
        const ok = await this.askConfirm({
          title: "提示词文件尚未加载",
          message: "「翻译」的提示词文件尚未加载，生成效果可能不完整。仍要继续吗？",
          confirmText: "仍要继续",
        });
        // 弹窗期间可能有第二次触发（Ctrl+Enter）已发起生成，await 之后必须复检
        if (!ok || this.streaming) return;
      }
      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this.errorLimited = false;
      this.trTruncated = false;
      this.closeExportMenu();
      // 窄屏：按下翻译就把译文栏放出来（与折叠同一条非线性动画），
      // 等待动画、流式正文都落在这一栏里
      this.revealTrResult(true);
      // 快照：本轮翻的是这份原文与这个语言对。生成期间用户还能继续改原文，
      // 收尾落历史必须用快照，否则记录里会写着「改了一半的原文」
      this._trSnap = { source, sourceId: this.trSourceLang, targetId: this.trTargetLang };
      // 「继续翻译」走通用续写入口，那里的守卫看的是 submittedInput
      this.submittedInput = source;
      this.submittedFileName = this.attachedFile ? this.attachedFile.name : "";
      this.trScrollTop();
      await this._runStream({
        inputText: source,
        updateId: this.trHistoryId || null,
        onToken: () => this.scheduleTrRender(),
        // 滚动由左右分栏自己管，不参与外层结果容器的自动滚动
        nearBottom: false,
      });
    },
    /* 译文收尾：只写这一条记录（新建或原地更新），与通用收尾的两点不同：
       1) 不建版本、不调标题接口——「改而不增」才是这个工具要的语义；
       2) 一个字都没译出来时不占位（原文还在左栏、错误卡就在旁边，点重试即可） */
    finalizeTr(state, errMsg, opts = {}) {
      const modelUsed = opts.modelUsed || this.selectedModel;
      const updateId = opts.updateId || null;
      const origin = updateId ? this.history.find((h) => h.id === updateId) : null;
      // 镜像重读会把列表整份换成索引项：先读回正文，别把已有译文当成不存在
      if (origin) this._hydrateHistory(origin);
      // 续写零新增（模型只回了「已完整」的哨兵，或刚开跑就被停）：剥掉哨兵、保持记录原状
      if (state !== "error" && opts.continueFrom && !this._continueProducedNew()) {
        const saidDone = this._stripContinueSentinel();
        this.settleTrRender(state);
        this.status = this.errorMsg ? "error" : (origin && origin.partial ? "stopped" : "done");
        if (saidDone) this.toast("原文已经全部译完，没有剩余内容");
        else this.toast("这次没有新增内容，可稍后重试", "warn");
        return;
      }
      this.settleTrRender(state);
      const snap = this._trSnap || {};
      const produced = !!String(this.output || "").trim();
      if (state === "error") {
        this.status = "error";
        this.errorMsg = errMsg || "翻译失败";
        this.toast("翻译失败：" + this.errorMsg, "error");
      } else {
        this.failedModel = "";
        this.errorLimited = false;
        this.status = state;
        this.errorMsg = "";
        if (state === "stopped") this.toast("已停止翻译，已经译出的部分已保留", "warn");
      }
      if (!produced && !origin) return;
      const source = snap.source || this.submittedInput || "";
      const fields = {
        toolId: TRANSLATE_TOOL_ID,
        toolName: "翻译",
        icon: TRANSLATE_TOOL_ICON,
        input: source,
        title: historyTitleFromText(source),
        model: state === "error" ? (this.failedModel || modelUsed) : modelUsed,
        partial: state === "stopped",
        error: state === "error" ? String(this.errorMsg).slice(0, 300) : "",
        // 语言对存 id：显示名与提示词里的名字随时可由 TR_LANGS 换，记录不必跟着改
        translate: {
          source: snap.sourceId || TR_DEFAULT_SOURCE,
          target: snap.targetId || TR_DEFAULT_TARGET,
          truncated: !!this.trTruncated,
        },
      };
      if (produced) fields.output = this.output;
      if (origin) {
        // 这次没译出内容（比如重译又失败）：保留上一次的译文，越重试越少最糟
        if (!produced) fields.output = origin.output || "";
        Object.assign(origin, fields);
        this._persistHistoryItem(origin);
        this.trHistoryId = origin.id;
        this.activeHistoryId = origin.id;
        return;
      }
      const item = this._unshiftHistory({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        createdAt: Date.now(),
        ...fields,
      });
      this.trHistoryId = item ? item.id : "";
      this.activeHistoryId = this.trHistoryId;
    },
    /* 打开一条翻译记录：原文回左栏、译文回右栏，语言对一并还原。
       记录仍归这一屏管——改原文再点「更新翻译」改的就是它（要另起一条用「新的翻译」） */
    openTranslateHistory(item) {
      this._hydrateHistory(item);
      // 上一轮留在屏上的推理过程不属于这条记录，先清掉
      this.resetReasoning();
      // 这条记录本身就有译文，窄屏上直接放出来（别让回看时译文栏还藏着）
      this.revealTrResult(true);
      const tool = this.findTool(TRANSLATE_TOOL_ID) || {
        id: TRANSLATE_TOOL_ID,
        name: "翻译",
        icon: TRANSLATE_TOOL_ICON,
        description: "原文译文对照，支持试卷、作文、文档",
        prompt_loaded: true,
      };
      this.currentTool = tool;
      const meta = item.translate || {};
      if (trLangById(meta.source)) this.trSourceLang = meta.source;
      if (trLangById(meta.target)) this.trTargetLang = meta.target;
      this.input = item.input || "";
      this.attachedFile = null;
      this.inputMode = "text";
      this.output = item.output || "";
      this.flushTrRender();
      this.errorMsg = item.error || "";
      this.trTruncated = !!meta.truncated;
      this.status = item.error ? "error" : (item.partial ? "stopped" : "done");
      this.failedModel = item.error ? (item.model || "") : "";
      // 继续翻译（续写）走通用续写入口，那里的守卫看的是 submittedInput
      this.submittedInput = item.input || "";
      this.submittedFileName = "";
      this.submittedExpanded = false;
      this._trSnap = {
        source: item.input || "",
        sourceId: this.trSourceLang,
        targetId: this.trTargetLang,
      };
      this.trHistoryId = item.id;
      this.activeHistoryId = item.id;
      this.rightMobileOpen = false;
      this.$nextTick(() => {
        this.trGrow();
        this.trScrollTop();
      });
    },
    // 切工具 / 回首页：与本条记录脱钩（与通用工具 activeHistoryId 同一个口径）
    resetTranslate() {
      this.trHistoryId = "";
      this.trTruncated = false;
      this.trMenu = "";
      this.trResultFolded = false;
      this.trResultVisible = false;
      clearTimeout(this._trKbTimer);
      this._trKbTimer = null;
      clearTimeout(this._trRevealTimer);
      this._trRevealTimer = null;
      this._trSnap = null;
      this._trDriven = null;
      this._trScrollSide = "";
      this._trFollowOutput = true;
    },

    /* ============ 流式生成（SSE） ============ */
    /* 返回值：true = 已发起生成请求；false = 守卫阶段提前返回（未发起）。
       opts.updateId 非空 = 本轮结果写回该历史记录（「直接重试」用），不新建 */
    async run(opts = {}) {
      if (!this.ensureCanRun("当前模型需要输入使用码后才能使用")) return false;
      if (this.isMigrationTool) {
        await this.analyzeMigration();
        return;
      }
      if (this.isVocabTool) {
        await this.checkVocab();
        return;
      }
      if (this.isVisualPaperTool) {
        await this.runVisualPaper();
        return;
      }
      if (this.streaming) return false;
      if (!this.currentTool) {
        this.toast("请先在左侧选择一个工具", "warn");
        return false;
      }
      const text = this.input.trim();
      if (!text) {
        this.toast("请先粘贴或输入内容", "warn");
        this.shakeComposer();
        return false;
      }
      if (!this.currentTool.prompt_loaded) {
        const ok = await this.askConfirm({
          title: "提示词文件尚未加载",
          message: `「${this.currentTool.name}」的提示词文件尚未加载，生成效果可能不完整。仍要继续吗？`,
          confirmText: "仍要继续",
        });
        if (!ok) return false;
        // 弹窗期间可能有第二次触发（Ctrl+Enter 等）已发起生成，await 之后必须复检
        if (this.streaming) return false;
      }

      this.output = "";
      this.rendered = "";
      this.outputFoldEligible = false;  // 新生成的内容不做折叠
      this.errorMsg = "";
      // 生成中状态条的导出/复制入口会隐藏，先把可能开着的导出面板收掉，
      // 否则流结束后它会带着旧定位重新弹出来
      this.closeExportMenu();

      this.submittedInput = text;
      this.submittedFileName = this.attachedFile ? this.attachedFile.name : "";
      this.inputCollapsed = true;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";

      return this._runStream({
        inputText: text,
        updateId: opts.updateId || null,
        newVersion: !!opts.newVersion,
      });
    },

    /* 流式记账：计时器 / 代次 / requestId / 中止控制 / 正文累积 / 收尾调度。
       新一轮（run）、继续生成、重试、重新生成都从这里开跑，通用工具与试卷可视化只在
       onToken（怎么渲染）与 finalize（怎么写历史）上不同。
       - updateId：本轮结果写回的既有历史记录，为空则收尾时新建
       - continueFrom：非空表示本次是续写；残文回传后端当上一条 assistant 消息，
         output 不清空、新 token 往后追加，收尾时按有没有新增内容决定状态
       - newVersion：非空表示本轮是「整篇重来」，结果作为该记录的新版本追加（旧版保留），
         而不是覆盖当前那一版
       - nearBottom：是否把外层结果容器拉到底。解卷的滚动由左右分栏自己管，
         不参与外层自动滚动 */
    async _runStream({ toolId, inputText, updateId = null, continueFrom = null, newVersion = false, transferCount, visualQuestionNos, onToken, onStage, onVisualTask, finalize, nearBottom = true }) {
      // 通用路径（新一轮/继续生成/重试）都跑当前工具，只有解卷会显式传 "13"；
      // 这里统一兜底，避免某个入口漏传导致请求的 tool_id 为空
      const tid = toolId || (this.currentTool && this.currentTool.id) || "";
      this.retreatMascot();
      this.activeHistoryId = updateId;
      this._streamBaselineLen = continueFrom ? this.output.length : 0;
      // 打字机从基线起步：续写时已有的全文立即可见，只有新增部分逐字放出
      this.outTyper().reset(this._streamBaselineLen);
      this.fallbackInfo = null;
      this.streaming = true;
      this.thinking = true;
      this.thinkingSec = 0;
      this.resetReasoning();
      const seq = ++this._runSeq;
      this.status = "connecting";
      if (nearBottom) this._nearBottom = true;
      // request_id 带随机熵：服务端按其校验停止请求属主，可预测的毫秒时间戳会被枚举滥用
      this.requestId = `${tid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this._abortCtrl = new AbortController();
      this.startTimer();
      this.startThinkTimer();
      // 发起时快照模型：请求 body 用的是此刻的 selectedModel，失败归因以它为准，
      // 避免流式期间用户切换右上角模型导致记录错位
      const modelUsed = this.selectedModel;
      const afterToken = onToken || (() => this.scheduleRender());
      // modelUsed 一路带到收尾：请求 body 用的是它，记录里的「哪一版由谁生成」也必须用它。
      // 拿收尾时刻的 selectedModel 会记错——流式期间用户可以在右上角切模型。
      const ctx0 = { updateId, continueFrom, newVersion, modelUsed };
      // 本轮结束后的额度基线：跑完对比，才能只在「刚好用掉最后一次」时提醒一次
      const quotaBefore = this.quotaRemaining;
      let quotaDelay = 0;
      const finish = finalize || ((state, errMsg, ctx) =>
        this.finalize(state, errMsg, ctx.seq, {
          updateId: ctx.updateId,
          continueFrom: ctx.continueFrom,
          newVersion: ctx.newVersion,
          modelUsed: ctx.modelUsed,
        }));

      try {
        const { state } = await this._streamChat({
          toolId: tid,
          input: inputText,
          requestId: this.requestId,
          transferCount,
          visualQuestionNos,
          continueFrom,
          onReasoning: (text) => { if (seq === this._runSeq) this.appendReasoning(text); },
          onFallback: (info) => { if (seq === this._runSeq) this.updateFallback(info); },
          onStage: onStage ? (info) => { if (seq === this._runSeq) onStage(info); } : undefined,
          onVisualTask: onVisualTask ? (info) => { if (seq === this._runSeq) onVisualTask(info); } : undefined,
          onToken: (text) => {
            // 作废后可能还有已排队未处理的 chunk，别再写进已被清空的输出
            if (seq !== this._runSeq) return;
            if (this.thinking) { this.thinking = false; this.stopThinkTimer(); }
            this.finishReasoningOnToken();
            this.status = "streaming";
            this.output += text;
            this._outputDirty = true;
            afterToken(text);
          },
        });
        finish(state === "stopped" ? "stopped" : "done", undefined, { ...ctx0, seq });
      } catch (e) {
        // 已被「切换工具/新建题目」作废：旧流收尾交给新流程，不再回写状态
        if (seq !== this._runSeq) { quotaDelay = 900; return true; }
        if (e && e.name === "AbortError") {
          quotaDelay = 900;
          finish("stopped", undefined, { ...ctx0, seq });
        } else {
          // 登录/额度类错误模型根本没执行，不标记；后端 error 事件回传的实际模型优先，快照兜底
          if (!(e && e.authIssue)) this.failedModel = (e && e.model) || modelUsed;
          this.errorRetryable = !(e && e.authIssue);
          this.errorLimited = !!(e && e.limited);
          finish("error", describeError(e, "生成失败，请稍后重试"), { ...ctx0, seq });
        }
      } finally {
        // 所有普通工具 + 解卷都在这里收尾：done 之前服务端已扣费，直接刷；
        // 用户停止时服务端在 finally 里扣，断开早于写库，延后 900ms 再刷
        this._afterRunQuota(quotaBefore, quotaDelay);
      }
      return true;
    },

    /* 通用 SSE 流式调用：返回 { state: "done" | "stopped" }，出错时抛出 Error */
    async _streamChat({ toolId, input, requestId, transferCount, visualQuestionNos, continueFrom, onToken, onReasoning, onFallback, onStage, onVisualTask }) {
      // 结果要用 renderMd 渲染：先把 marked / DOMPurify 备好再发请求。
      // 正常路径下空闲预加载早已完成，这里几乎立即返回；加载失败也继续（renderMd 有降级）。
      await nbxEnsureRenderLibs();
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          tool_id: toolId,
          input,
          model: this.selectedModel || undefined,
          request_id: requestId,
          transfer_count: transferCount || undefined,
          visual_question_nos: visualQuestionNos || undefined,
          // 续写：残文回传后端当上一条 assistant 消息，后端在末尾追加续写指令
          continue_from: continueFrom || undefined,
          // 翻译：语言对每次都要发——续写/重试也走这里，模型得知道接着译成什么
          ...(this.isTranslateTool ? this.trLangPayload() : null),
        }),
        signal: this._abortCtrl.signal,
      });

      if (!res.ok) {
        // 后端 detail 优先（可能是「请先输入使用码」「额度已用尽」「免费模型限额已满」等）
        let detailMsg = "";
        try {
          const j = await res.json();
          if (j && j.detail != null) detailMsg = formatApiDetail(j.detail) || "";
        } catch {}
        if (res.status === 401 || res.status === 403) {
          // 已登录说明是本机凭证失效/额度耗尽，清掉本地登录态；未登录则引导输入使用码
          this.handleAuthFailure(detailMsg);
          throw Object.assign(
            new Error(
              detailMsg ||
                (res.status === 401 ? "请先输入使用码" : "额度已用尽或使用码已被禁用")
            ),
            { authIssue: true }
          );
        }
        // 429 = 免费模型限额或接口限速：单独标记，错误卡给出持久解释而不是一句「生成失败」
        const err = new Error(detailMsg || "HTTP " + res.status);
        if (res.status === 429) err.limited = true;
        throw err;
      }
      if (!res.body) throw new Error("浏览器不支持流式读取");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let evName = "message";
      let evData = "";
      let stopped = false;
      // 是否收到过终止事件（done/[DONE]/[CANCELLED]）：没收到就断流 = 内容不完整
      let sawTerminal = false;

      const dispatch = (ev, data) => {
        // [CANCELLED] 必须在 ev === "done" 之前判：两者都是 done 事件，
        // 先判 done 会把「没跑完」当成正常收尾，半截内容就悄悄变成完整结果了
        // （识别与迁移那条链路一直是这么判的，这里补齐）
        if (data === "[CANCELLED]") { stopped = true; sawTerminal = true; return; }
        if (ev === "done" || data === "[DONE]") { sawTerminal = true; return; }
        if (ev === "error") {
          let m = data;
          let model = "";
          try {
            const j = JSON.parse(data);
            if (j) { m = j.message || data; model = typeof j.model === "string" ? j.model : ""; }
          } catch {}
          // model 供失败归因：禁用真正失败的模型，而非此刻的 selectedModel
          throw Object.assign(new Error(m), { model });
        }
        if (ev === "fallback") {
          // 备用通道切换：{failed_index, total, next_index, reason}，只用于展示进度
          let info = null;
          try { info = JSON.parse(data); } catch {}
          if (info && onFallback) onFallback(info);
          return;
        }
        if (ev === "stage") {
          // 两阶段生成的阶段切换：{"name":"framework"|"explain"}（试卷可视化全解）
          let info = null;
          try { info = JSON.parse(data); } catch {}
          if (info && onStage) onStage(info);
          return;
        }
        if (ev === "visual_task") {
          let info = null;
          try { info = JSON.parse(data); } catch {}
          if (info && onVisualTask) onVisualTask(info);
          return;
        }
        if (ev === "reasoning") {
          // 推理过程与正文分离：JSON 解码后交 onReasoning，不进 output。
          // 新后端事件为 {t, n}（n 为后端 tokenizer 计得的 token 数），旧后端仍为纯字符串；
          // 旧后端没有该事件时 onReasoning 保持不被调用，界面回退到等待动画。
          let text = data;
          let tok = 0;
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed === "string") text = parsed;
            else if (parsed && typeof parsed.t === "string") {
              text = parsed.t;
              tok = Number(parsed.n) || 0;
            }
          } catch {}
          if (text && onReasoning) onReasoning(text, tok);
          return;
        }
        if (ev === "token") {
          // token 为 JSON 编码字符串（换行保真传输），解码失败时降级为原文
          let text = data;
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed === "string") text = parsed;
          } catch {}
          if (text) onToken(text);
          return;
        }
        if (ev === "truncated") {
          // 翻译撞到输出上限：只置标记，由译文栏提示「可继续翻译」。
          // 不接住的话它会落到下面那句兜底里，被当成正文拼进译文
          this.trTruncated = true;
          return;
        }
        if (data) onToken(data);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.replace(/\r$/, "");
          if (line.startsWith("event:")) {
            evName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const d = line.slice(5);
            evData = evData ? evData + "\n" + (d.startsWith(" ") ? d.slice(1) : d) : (d.startsWith(" ") ? d.slice(1) : d);
          } else if (line === "") {
            if (evData !== "" || evName !== "message") {
              dispatch(evName, evData);
            }
            evName = "message";
            evData = "";
          }
        }
      }
      if (evData !== "" || evName !== "message") dispatch(evName, evData);
      // 流干净结束但没给终止事件：多半是反代/网络把连接掐了，
      // 此时已收到的内容只是半截，绝不能当成功交付
      if (!sawTerminal) {
        try { console.warn("SSE 流未收到终止事件即结束，按中断处理"); } catch { /* 忽略 */ }
        throw Object.assign(new Error("生成中断，内容可能不完整，请重试"), { truncated: true });
      }
      return { state: stopped ? "stopped" : "done" };
    },

    // 通知后端尽早释放上游调用。不 await：本地中断不依赖网络往返，通知失败也不影响已停止的事实
    notifyStop(requestId) {
      if (!requestId) return;
      fetch("/api/chat/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ request_id: requestId }),
      }).catch(() => {});
    },
    stop() {
      if (!this.streaming) return;
      const requestId = this.requestId;
      // 先断本地流：UI 立刻恢复，不会因 /stop 请求挂起而一直卡在生成中
      try { this._abortCtrl && this._abortCtrl.abort(); } catch {}
      this.notifyStop(requestId);
    },
    // 切换工具/新建题目时作废在途生成：递增代次让旧流的收尾失效，同步复位 UI，再通知后端
    abortActiveGeneration() {
      this._runSeq += 1;
      const requestId = this.requestId;
      try { this._abortCtrl && this._abortCtrl.abort(); } catch {}
      this.streaming = false;
      this.thinking = false;
      this.fallbackInfo = null;
      this.stopTimer();
      this.stopThinkTimer();
      this.notifyStop(requestId);
    },

    /* ============ 失败恢复：错误卡上的继续生成 / 重试 / 换模型 / 编辑输入 ============ */
    /* 页面上是否留着「还能接着写」的正文——续写入口（错误卡按钮、停止提示条）都以此为准 */
    get canContinue() {
      return !this.streaming && !!this.output.trim() && !!this.submittedInput;
    },

    /* 继续生成：接着已生成的部分往下写，不是整篇重来。
       残文回传给后端当上一条 assistant 消息，新 token 追加在 output 后面；
       收尾写回 activeHistoryId 那条记录，历史里不会多出一条。 */
    async continueChat() {
      if (this.streaming) return;
      if (!this.submittedInput || !this.output.trim()) {
        this.toast("没有可续写的内容", "warn");
        return;
      }
      if (!this.ensureCanRun("当前模型需要输入使用码后才能续写")) return;
      await this._runStream({
        inputText: this.submittedInput,
        updateId: this.activeHistoryId,
        continueFrom: this.output,
      });
    },

    /* 整篇重来（重新生成 / 直接重试 / 换个模型重试都走这里）：
       结果作为 activeHistoryId 那条记录的新版本追加，旧结果不退场——底部切换器
       可在新旧版本间来回看。modelId 非空表示先用该模型（会切换当前模型，
       与错误卡的「换个模型重试」同一行为）。
       opts.allowEmpty：允许在没有正文时依然重来（错误卡上的「直接重试」要能
       重试一条一个字都没产出的失败记录，那是既有能力，不能因新按钮而丢）。 */
    async regenerate(modelId = "", opts = {}) {
      if (this.streaming) return;
      // 版本化只覆盖通用工具面板：试卷全解、错因迁移、超标词各有自己的历史结构与入口，
      // 万一将来被误接到这里，宁可什么都不做——run() 会按工具分派到那些路径上，
      // 那等于悄悄做了另一件事（比如新建一条记录），比不响应更糟。
      // 翻译同理：它要的是「改而不增」，而且 run() 会把原文栏清空（原文得留在左栏）
      if (this.isMigrationTool || this.isVocabTool || this.isVisualPaperTool || this.isTranslateTool) return;
      if (!this.submittedInput) {
        this.toast("没有可重新生成的输入内容", "warn");
        return;
      }
      if (!opts.allowEmpty && !this.output.trim()) {
        this.toast("没有可重新生成的内容", "warn");
        return;
      }
      if (!this.ensureCanRun("当前模型需要输入使用码后才能重新生成")) return;
      if (modelId && modelId !== this.selectedModel) this.chooseModel(modelId);
      this.retryModelOpen = false;
      this.input = this.submittedInput;
      // 开流前记下屏幕上的正文：新版本零产出时用它恢复（见 finalize）
      this._regenPrevOutput = this.output;
      // run() 返回 false = 守卫阶段提前返回、请求根本没发出（如提示词确认被取消），
      // 此时把内容放回可见的输入框；只要请求真的发起了，无论成败都保持折叠——
      // 失败走错误卡，与首次失败的表现一致。
      const started = (await this.run({ updateId: this.activeHistoryId, newVersion: true })) !== false;
      if (!started) {
        this._regenPrevOutput = "";
        this.inputCollapsed = false;
        this.$nextTick(() => {
          this.autoGrow();
          const el = this.$refs.inputEl;
          if (el) el.focus();
        });
      }
    },

    /* 失败卡上的「直接重试」：整篇重来，但允许零正文（否则一条彻底失败的记录
       就没法再试了）。 */
    async retryChat() {
      await this.regenerate("", { allowEmpty: true });
    },

    async retryVisualPaper() {
      if (this.streaming) return;
      if (!this.submittedInput) {
        this.toast("没有可重试的试卷内容", "warn");
        return;
      }
      const text = this.submittedInput;
      // resetVisualPaper 会清掉卷子快照（连同 historyId），先取出来：
      // 整卷重来也是覆盖原记录，不新增——中断卡上承诺的正是这条
      const keepId = this.vpHistoryId;
      this.resetVisualPaper();
      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this._nearBottom = true;
      await this._runVisualStream(text, keepId);
    },

    chooseModelAndRetry(modelId) {
      if (modelId && modelId !== this.selectedModel) this.chooseModel(modelId);
      this.retryModelOpen = false;
      if (this.isVisualPaperTool) {
        this.retryVisualPaper();
      } else {
        this.retryChat();
      }
    },

    /* 模型弹窗的两个用途共用一套列表：retry = 失败后换个模型重试（禁掉刚才失败的那个），
       regen = 重新生成（不禁任何模型，用同一个模型再跑一遍是完全正当的用法）。 */
    openModelPicker(mode) {
      if (this.streaming) return;
      this.retryModelMode = mode === "regen" ? "regen" : "retry";
      this.retryModelOpen = true;
    },
    pickModelFromDialog(modelId) {
      this.retryModelOpen = false;
      if (this.retryModelMode === "regen") this.regenerate(modelId);
      else this.chooseModelAndRetry(modelId);
    },
    /* 弹窗里的主按钮：用当前模型重新生成（不换模型，只整篇重来） */
    regenerateWithCurrentModel() {
      this.retryModelOpen = false;
      this.regenerate();
    },

    /* ============ 回答版本（重新生成保留的历次结果） ============ */
    /* 版本状态只读自当前活动记录的 versions。模板里只能走这些 getter：
       它们调 NbxVersions 的只读接口，会写容器的 ensure/append 一律只在事件与
       收尾里调用——在 getter 里写响应式字段会触发重渲染循环。 */
    get versionCount() {
      return NbxVersions.count(this._verItem());
    },
    get versionIndex() {
      return NbxVersions.activeIndex(this._verItem());
    },
    get currentVersionModel() {
      const v = NbxVersions.active(this._verItem());
      return (v && v.model) || "";
    },
    get versionTip() {
      if (this.versionCount <= 1) return "";
      return "第 " + (this.versionIndex + 1) + "/" + this.versionCount + " 版"
        + (this.currentVersionModel ? " · 由 " + this.shortModel(this.currentVersionModel) + " 生成" : "");
    },
    /* 屏幕上这份结果对应的记录。列表里持有的是索引项，正文按需水合——
       版本数组在正文里，没水合就看不到版本（此时切换器不显示，不会有错的表现）。 */
    _verItem() {
      if (!this.activeHistoryId) return null;
      return this.history.find((h) => h.id === this.activeHistoryId) || null;
    },
    /* 切换版本：‹ 上一版 / › 下一版。越界与生成中都不动（返回空）。
       切换本身是一次真实改动（要跨线路同步），落盘走 _persistHistoryItem 刷 updatedAt。 */
    switchVersion(delta) {
      if (this.streaming) return null;
      const item = this._verItem();
      if (!item) return null;
      this._hydrateHistory(item);
      const v = NbxVersions.switchTo(item, delta);
      if (!v) return null;
      this._persistHistoryItem(item);
      if (!item.title) this.generateTitle(item);
      this._showVersion(item, v);
      return v;
    },
    /* 把屏幕上的一切（正文、错误卡、续写入口、失败归因）都换成该版本的状态。
       状态映射与 openHistory 完全一致：失败→错误卡、被停→留续写入口、其余→查看态。
       换版本不动 selectedModel（那是「下一次用哪个模型」，与「这版是谁生成的」无关），
       所以只在模型不同时提示一句，免得用户以为模型被换掉了。 */
    _showVersion(item, v) {
      this.output = item.output;
      this.errorMsg = item.error || "";
      this.status = item.error ? "error" : (item.partial ? "stopped" : "history");
      this.failedModel = item.error ? (item.model || "") : "";
      this.errorRetryable = true;
      this.errorLimited = false;
      this.resetReasoning();
      // 与 openHistory 同一套：切回来的长文先折叠，首屏不必等全文解析
      this.outputFoldEligible = true;
      this._outputDirty = true;
      this.doRender();
      // 在新内容落地之后再把视口拉回顶部（同步设置会按旧高度被浏览器钳制）
      this.$nextTick(() => {
        const el = this.$refs.resultScroll;
        if (el) el.scrollTop = 0;
      });
      // 只在「这一版不是当前模型生成的」时才出声：切换本身有正文与计数器的变化，
      // 每点一下都弹一条提示反而吵；模型不同才是需要提醒的信息（用户容易以为
      // 选中的模型被换掉了）
      if (v.model && v.model !== this.selectedModel) {
        this.toast("已切到第 " + (this.versionIndex + 1) + " 版（由 " + this.shortModel(v.model) + " 生成）");
      }
    },

    editSubmittedInput() {
      if (this.streaming) return;
      const fileName = this.submittedFileName;
      this.input = this.submittedInput;
      this.submittedInput = "";
      this.submittedFileName = "";
      this.submittedExpanded = false;
      this.errorMsg = "";
      this.failedModel = "";
      this.status = "idle";
      this.inputCollapsed = false;
      this.$nextTick(() => {
        this.autoGrow();
        const el = this.$refs.inputEl;
        if (el) el.focus();
        this.scheduleMascotCheck(80);
      });
      if (fileName) this.toast(`文件「${fileName}」的内容已转回文本，可直接编辑后重新执行`);
    },

    /* 收尾。opts.updateId 非空 = 本轮是续写/重试/重新生成，结果写回该历史记录而不是新建；
       opts.continueFrom 非空 = 本轮是续写，还要处理「其实没有新增内容」的情形；
       opts.newVersion 为真 = 本轮是整篇重来，结果作为新版本追加，旧版本留在切换器里；
       opts.modelUsed = 本轮请求发起时的模型快照，记录「这一版由谁生成」只能用它。 */
    finalize(state, errMsg, seq, opts = {}) {
      // 代次不符 = 这次流已被切换工具/新建题目作废，收尾交给新流程
      if (seq !== undefined && seq !== this._runSeq) return;
      this.streaming = false;
      this.thinking = false;
      this.fallbackInfo = null;
      // 打字机收尾：自然完成的余量交给它平滑放完（放完那帧是干净全文）；
      // 停止 / 出错残文立即全量——半份内容不能还吊着动画
      if (state === "done") this.outTyper().finish();
      else this.outTyper().reset((this.output || "").length);
      this.stopTimer();
      this.stopThinkTimer();
      // 推理盒定稿：正文从未开始过（还没自动收起过）才收一次，
      // 否则会把流式期间用户手动展开的盒子在收尾时又打回去。
      if (this.reasoning && !this.reasoningDone) {
        this.reasoningDone = true;
        this.reasoningOpen = false;
        this.reasoningLive = false;
        this.reasonTyper().reset(this.reasoning.length);
        this.reasoningShown = this.reasoning;
        this.syncReasoningBox();
      }
      // 翻译（工具 33）有自己的历史口径（改而不增、零产出不留空记录），收尾整体交给它。
      // 上面这套收尾（停表、停动画）是共用的，所以分流点放在这里
      if (this.isTranslateTool) {
        this.finalizeTr(state, errMsg, opts);
        return;
      }
      const updateId = opts.updateId || null;
      const origin = updateId ? this.history.find(h => h.id === updateId) : null;
      // 镜像重读会把列表整份换成索引项：不先把正文读回来，下面往版本容器里追加时
      // 会把「没有旧正文」当成事实，把已有版本连同正文一起丢掉。
      if (origin) this._hydrateHistory(origin);
      const modelUsed = opts.modelUsed || this.selectedModel;
      // 本轮到底有没有产出。新版本模式下要用它区分「失败但留下了半成品」与
      // 「一个字都没写出来」，后者绝不能动记录里已有的版本
      const producedNew = !!this.output.trim();
      // 新版本整篇重来却一个字都没产出（开流即失败 / 刚开跑就被停）：屏幕上恢复
      // 旧结果——一次失败的重新生成不能把用户已经看到的内容清空。记录本身没被动过
      // （新版本只在有产出时才写入），恢复的就是它。
      if (opts.newVersion && !producedNew) {
        this.output = this._regenPrevOutput || "";
        this._outputDirty = true;
      }
      // 续写一个字都没新增（模型只回了「已完整」的哨兵，或用户刚开跑就停下）：
      // 剥掉哨兵、保持记录原样——不能因此把失败/中断的记录标成已完成，
      // 那句交代话也不该拼进成品文档。报错不在此列：接口 429/500 时一个字都没有，
      // 但那是真失败，必须照常走下面的错误卡。
      if (state !== "error" && opts.continueFrom && !this._continueProducedNew()) {
        const saidDone = this._stripContinueSentinel();
        if (state === "stopped") this.toast("已停止生成", "warn");
        else if (saidDone) this.toast("已生成的内容已经完整，没有需要续写的部分", "ok");
        else this.toast("这次没有新增内容，可稍后重试", "warn");
        // 状态回到本轮之前的样子：错误还在的错误着，中断的仍可继续
        this.status = this.errorMsg ? "error" : (origin && origin.partial ? "stopped" : "done");
        this.doRender();
        return;
      }
      this.doRender();
      if (state === "error") {
        this.status = "error";
        this.errorMsg = errMsg || "生成失败";
        this.toast("生成失败：" + this.errorMsg, "error");
        // 出错同样入历史：已生成的部分内容与用户输入都要留得住。
        // 续写/重试失败写回原记录，且本轮没产出就保留原正文，别越重试越少
        if (origin) {
          if (opts.newVersion) {
            // 整篇重来失败：有残文就当一版留下（切回去还能看见），旧版本原样不动；
            // 一个字都没产出则完全不碰记录——旧结果是好的，不能因为一次失败的尝试
            // 就把它标成「生成失败」，更不该凭空刷 updatedAt 去赢线路合并
            if (producedNew) {
              NbxVersions.append(origin, {
                output: this.output,
                model: this.failedModel || modelUsed,
                partial: false,
                // 与下面非版本化路径同一个截断口径：记录里的失败原因是给列表角标与
                // 重开时的错误卡看的，完整原因在屏幕上的错误卡里
                error: String(this.errorMsg).slice(0, 300),
              });
              this._persistHistoryItem(origin);
            }
          } else {
            if (producedNew) origin.output = this.output;
            origin.error = String(this.errorMsg).slice(0, 300);
            origin.partial = false;
            origin.model = this.failedModel || modelUsed;
            NbxVersions.syncActive(origin);
            this._persistHistoryItem(origin);
          }
          this.activeHistoryId = origin.id;
        } else {
          const created = this.pushFailedHistory(this.errorMsg);
          this.activeHistoryId = created ? created.id : null;
        }
      } else {
        this.failedModel = "";
        this.errorLimited = false;
        this.status = state;
        // 续写/重试成功后必须撤掉错误卡：这条路不再经过 run() 的 errorMsg 复位，
        // 否则上一次的失败提示会一直挂在一份已经写完的内容上
        this.errorMsg = "";
        if (producedNew) {
          if (origin) {
            if (opts.newVersion) {
              // 整篇重来成功：追加为新版本并激活它，旧结果留在切换器里
              NbxVersions.append(origin, {
                output: this.output,
                model: modelUsed,
                partial: state === "stopped",
                error: "",
              });
            } else {
              // 续写/重试回到原记录的活动版本：状态随最后一次结果刷新——成功即清掉
              // 失败标记，用户停止则落回「已停止」，续写入口继续留着
              origin.output = this.output;
              origin.partial = state === "stopped";
              origin.error = "";
              origin.model = modelUsed;
              NbxVersions.syncActive(origin);
            }
            this._persistHistoryItem(origin);
            this.activeHistoryId = origin.id;
            // 失败记录从来没生成过标题，续写成功后补一条，否则列表里永远只有输入摘要
            if (!origin.title) this.generateTitle(origin);
          } else {
            const item = this.pushHistory(state === "stopped");
            this.activeHistoryId = item ? item.id : null;
          }
        }
        if (state === "stopped") this.toast("已停止生成", "warn");
      }
      // 旧结果快照用完即弃：它只在「新版本整篇重来且零产出」这一刻有意义
      this._regenPrevOutput = "";
    },

    /* 这一轮续写有没有产出新内容：只认「零新增」和「仅回了完成标记」。
       用「有没有字母/数字/表意文字」而不是「去掉标点后还剩什么」来判定：
       模型常把标记套在代码围栏或括号里，剥离后残留的 ``` 与（）不该算成续写了正文，
       而在标点集合上做减法永远列不全。 */
    _continueProducedNew() {
      return /[0-9A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(this._continueNewText());
    },
    /* 剥掉续写指令约定的完成标记，返回是否真的剥到了 */
    _stripContinueSentinel() {
      const added = this.output.slice(this._streamBaselineLen);
      const cleaned = this._continueNewText();
      if (cleaned === added) return false;
      this.output = this.output.slice(0, this._streamBaselineLen) + cleaned;
      this._outputDirty = true;
      return true;
    },
    // 本轮新增的正文，去掉完成标记本身
    _continueNewText() {
      return this.output.slice(this._streamBaselineLen)
        .replace(new RegExp(CONTINUE_DONE_SRC, "gi"), "");
    },

    /* ============ 试卷可视化全解 流式 ============ */
    async runVisualPaper() {
      if (this.streaming) return;
      const text = this.input.trim();
      if (!text) {
        this.toast("请先粘贴或输入试卷内容", "warn");
        this.shakeComposer();
        return;
      }
      if (this.currentTool && this.currentTool.prompt_loaded === false) {
        const ok = await this.askConfirm({
          title: "提示词文件尚未加载",
          message: `「${this.currentTool.name}」的提示词文件尚未加载，生成效果可能不完整。仍要继续吗？`,
          confirmText: "仍要继续",
        });
        if (!ok) return;
        // 弹窗期间可能有第二次触发已发起生成，await 之后必须复检
        if (this.streaming) return;
      }
      this.retreatMascot();
      this.resetVisualPaper();
      this.visualPaper = this.newVisualPaperState();
      this.output = "";
      this.outputFoldEligible = false;  // 新生成的内容不做折叠
      this.rendered = "";
      this.errorMsg = "";
      this._nearBottom = true;
      this.submittedInput = text;
      this.submittedFileName = this.attachedFile ? this.attachedFile.name : "";
      this.inputCollapsed = true;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";
      await this._runVisualStream(text, null);
    },
    // 可视化流式共享入口：updateId 非空时在原历史记录上追加更新，不新增记录
    async _runVisualStream(inputText, updateId, visualQuestionNos = undefined) {
      // 续写/重试也走这里（不经 resetVisualPaper）：开跑就收浮层，
      // 否则输入坞一收起，浮层会孤零零留在半空中
      this.closeVpSettings();
      // 解卷的正文一律走结构化视图，不套用「从历史打开」的长文折叠
      this.outputFoldEligible = false;
      // 迁移题量随记录一起存：关掉页面再从历史续写时题量不会掉回默认值；
      // 已经锁定过的卷子一律沿用锁定值，避免续写中途改设置导致前后不一致 + 缓存全失效
      if (!this.visualPaper) this.visualPaper = this.newVisualPaperState();
      const transferCount = this.vpLockedTransferCount;
      this.visualPaper.transferCount = transferCount;
      const baselineOutput = this.output;
      const baselineFramework = this.visualPaper.frameworkRaw;
      this.vpParallel = false;
      this.vpTasks = [];
      // 完整骨架续写发送结构化缺失题号；简报兼容旧后端，不回传已有讲解正文。
      return this._runStream({
        toolId: "13",
        inputText,
        updateId,
        transferCount,
        visualQuestionNos,
        nearBottom: false,
        onVisualTask: info => this.vpApplyTask(info),
        onStage: (info) => {
          // 两阶段进度：framework = Chores 模型在插标解析结构，explain = 主模型在写讲解。
          // 阶段边界快照骨架文本（仅当两阶段骨架真实可用；回退单阶段时无骨架可存），
          // 续写时作为输入重发，后端见 @@TAG@@ 输入即跳过框架阶段
          const name = (info && info.name) || "";
          if (name !== this.vpStage) {
            this.fallbackInfo = null;
            this.resetReasoning();
          }
          this.vpStage = name;
          this.vpParallel = !!info.parallel;
          this.vpTasks = Array.isArray(info.tasks) ? info.tasks : [];
          if (info && info.reset) {
            const historyId = this.vpHistoryId;
            this.output = baselineOutput;
            this.visualPaper = { ...this.newVisualPaperState(), historyId, transferCount, frameworkRaw: baselineFramework };
            this._outputDirty = true;
            this.vpDoRender();
          }
          // fallback:"single" 表示并行规划为空、走了单流兜底。此时不能把单流输出
          // snapshot 成骨架快照——stage 协议说的是"有骨架"，实际讲解是单流写的，
          // 快照会污染框架数据，让下一轮续写从原卷突变成骨架。
          // reuse_framework（复用骨架续写）过去被排除在刷新之外，导致间隙编辑未落盘时
          // 下一轮仍拿旧快照；现在一视同仁地刷新。
          if (name === "explain" && info.framework
              && info.fallback !== "single" && this.visualPaper) {
            this.vpDoRender();
            this.visualPaper.frameworkRaw = this.vpSerializeRaw({ frameworkOnly: true });
          }
        },
        onToken: () => {
          if (this.visualPaper) this.visualPaper.rawJson = this.output;
          this.vpScheduleRender();
        },
        finalize: (state, errMsg, ctx) =>
          this.finalizeVisualPaper(state, errMsg, { updateId: ctx.updateId, modelUsed: ctx.modelUsed }, ctx.seq),
      });
    },
    finalizeVisualPaper(state, errMsg, opts = {}, seq) {
      // 代次不符 = 这次流已被切换工具/新建题目作废，收尾交给新流程
      if (seq !== undefined && seq !== this._runSeq) return;
      this.streaming = false;
      // 收尾方式决定「继续生成」入口是否保留，必须先于渲染落定
      this.vpRunState = state;
      this.vpTasks = this.vpTasks.map(t => ({ ...t,
        state: ["pending", "running", "retrying"].includes(t.state) ? "cancelled" : t.state,
        active_nos: [], fallback: null, retry_reason: "",
        ...(t.question_states ? { question_states: Object.fromEntries(Object.entries(t.question_states).map(([no, info]) =>
          [no, { ...info, state: (t.completed || []).includes(no) ? "done"
            : ["pending", "running", "retrying"].includes(info.state) ? "cancelled" : info.state,
          fallback: null, retry_reason: "" }])) } : {}),
      }));
      this.thinking = false;
      this.fallbackInfo = null;
      this.stopTimer();
      this.stopThinkTimer();
      // 与 finalize 同规则：只在正文从未开始时收一次，不动用户的手动展开
      if (this.reasoning && !this.reasoningDone) {
        this.reasoningDone = true;
        this.reasoningOpen = false;
      }
      // 一题都没解析出来、正文也一个字没有（在思考阶段就被停掉）→ 清掉思考残留。
      // 这次请求等于什么都没留下，页面该干净地回到初始状态，不该挂一条没归属的
      // 「思考过程」条和它的 token 统计（有正文时保留，那是正常的中断续写场景）
      if (!this.vpHasData && !this.output.trim()) this.resetReasoning();
      this.vpDoRender();
      if (state === "error") {
        this.status = "error";
        this.errorMsg = errMsg || "生成失败";
        this.vpParseError = errMsg || "生成失败";
        this.toast("生成失败：" + this.errorMsg, "error");
        // 失败也入历史：整卷/续写中途报错时，已解析出的题目快照一并存下，之后还能续写
        const updId = opts.updateId || null;
        const origin = updId ? this.history.find(h => h.id === updId) : null;
        const hasPaper = !!(this.visualPaper && (this.visualPaper.groups?.length || this.visualPaper.total || (this.visualPaper.paper && this.visualPaper.paper.title)));
        if (origin) {
          // 重试/续写一个字都没产出时保留原内容与快照，别把已生成的记录清空
          if (this.output.trim()) {
            origin.output = this.output;
            if (hasPaper) origin.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
          }
          origin.error = String(this.errorMsg).slice(0, 300);
          origin.partial = false;
          origin.model = opts.modelUsed || this.failedModel || this.selectedModel;
          origin.createdAt = Date.now();
          this._persistHistoryItem(origin);
          // 重试走的是 resetVisualPaper 之后的新快照，historyId 已经被清掉，
          // 这里必须把指针接回原记录，否则下一次「继续生成」又会新建一条
          if (this.visualPaper) this.visualPaper.historyId = origin.id;
        } else {
          const created = this.pushFailedHistory(this.errorMsg, {
            model: opts.modelUsed || this.failedModel || this.selectedModel,
            ...(hasPaper ? { visualPaper: JSON.parse(JSON.stringify(this.visualPaper)) } : {}),
          });
          if (created && this.visualPaper) this.visualPaper.historyId = created.id;
        }
      } else {
        this.failedModel = "";
        this.errorLimited = false;
        this.status = state;
        // 续写/重试成功后撤掉错误提示：这条路不经过 runVisualPaper 的复位，留着会让页面上
        // 一直挂着上次的失败原因，而且 vpFailedMidStream 恒为真——解析异常卡与 Markdown
        // 回退视图会被它一直压住，明明这次解析成功了也看不到
        this.errorMsg = "";
        if (this.output.trim()) {
          const updateId = opts.updateId || null;
          let item = updateId ? this.history.find(h => h.id === updateId) : null;
          // 「未确认写完」也按 partial 记：@@TOTAL@@ 被截断、模型自己少写题时，
          // 记录若标成已完成，重开就既没有「已停止」标记也没有续写入口了
          const unfinished = state === "stopped" || !this.vpComplete;
          if (item) {
            // 续写/重跑：在原记录上追加更新，不新增记录；这次成功了就不再是失败记录
            item.output = this.output;
            item.partial = unfinished;
            item.error = "";
            item.model = opts.modelUsed || this.selectedModel;
            if (this.visualPaper && (this.visualPaper.groups?.length || this.visualPaper.total)) {
              item.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
            }
            this._persistHistoryItem(item);
            // 同错误分支：重试/续写后要把卷子的记录指针接回这一条
            if (this.visualPaper) this.visualPaper.historyId = item.id;
            // 失败记录从来没生成过标题，续写成功后补一条
            if (!item.title) this.generateTitle(item);
          } else {
            item = this.pushHistory(unfinished, opts.modelUsed);
            // 为可视化历史附加结构化数据，便于回放（0 完整题也保存 total/paper，中断可续）
            if (this.visualPaper && (this.visualPaper.groups?.length || this.visualPaper.total || (this.visualPaper.paper && this.visualPaper.paper.title))) {
              item.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
              // 同步到 history 存储
              this._persistHistoryItem(item);
            }
            if (this.visualPaper) this.visualPaper.historyId = item.id;
          }
        }
        if (state === "stopped") this.toast("已停止生成", "warn");
        else if (this.vpTaskFailures && !this.vpComplete) this.toast("部分题目未完成，已保留生成结果，可继续补全", "warn");
      }
      // 一题都没解析出来（中断/失败）→ 输入坞弹回原位：此时「每题迁移题量」还可能被改
      // （重新生成用的就是当前设置），坞收着且没有唤回入口就等于把设置一起锁死了。
      // 解析出题目则维持原来的紧凑收起（卷子已有数据，题量也已随卷锁定）。
      if (!this.vpHasData) this.inputCollapsed = false;
    },
    // 最后一个「完整题」的结束位置（返回结束标签之后的下标；没有则 -1）。
    // 定界符与解析器共用一套：模型把 END_Q 写成 @@END_Q: / @@@END_Q@@ 时也要能切准。
    vpLastCompleteEnd(raw) {
      const re = new RegExp(`[＠@]{2,}\\s*END_Q\\s*${_VP_TAG_DELIM}`, "gi");
      let last = -1, m;
      while ((m = re.exec(raw || "")) !== null) last = m.index + m[0].length;
      return last;
    },
    /* 续写指令：只把「模型猜不到的那几条私有信息」交给它——进度、当前板块、输出写法。
       不回传已生成正文，是因为正文会让每轮输入多吞一份输出（输出量常比试卷原文还大），
       而且为了清洗残片去改动回传内容，前缀缓存就会从改动点起全部失效。
       进度全部取自解析出来的结构：最后一题 = 最后一个「有题的分组」的最后一题
       （分组里可能夹着空组），它的 id|title 就是续写题该归属的板块。 */
    vpContinueBrief() {
      const vp = this.visualPaper || {};
      const groups = vp.groups || [];
      const total = this.vpTotal || 0;
      const count = this.vpQuestionCount;
      const remaining = Math.max(0, total - count);
      const allNos = [];
      for (const g of groups) for (const q of (g.questions || [])) allNos.push(q.no);
      const filled = groups.filter((g) => (g.questions || []).length);
      const lastGroup = filled.length ? filled[filled.length - 1] : null;
      const lastQ = lastGroup ? lastGroup.questions[lastGroup.questions.length - 1] : null;
      const label = lastGroup ? `\`${lastGroup.id}|${lastGroup.title}\`` : "";
      // 题号没识别出来时（"?"）不要把占位符喂给模型——它会当成真题号照抄进 @@Q@@ 行
      const known = !!(lastQ && lastQ.no && lastQ.no !== "?");
      const lastLabel = known ? `第 ${lastQ.no} 题` : "最后一道已完成题（题号未能识别）";
      const nosList = allNos.filter((n) => n && n !== "?");
      const lines = ["【续写指令】你的输出会被原样追加在前面已生成内容的后面，接着往下写。"];
      const incomplete = groups.flatMap(g => (g.questions || []))
        .filter(q => q.no && q.no !== "?" && !this.vpQuestionAnalyzed(q)).map(q => q.no);
      if (incomplete.length) {
        lines.push(`已有结构但讲解未完整的题号：${incomplete.join(",")}。先为这些题重新输出完整讲解块（含足额迁移或完整写作指导），程序按题号合并；再补下面尚未覆盖的题。`);
      }
      if (!lastQ) {
        lines.push(`进度：全卷 ${total} 题，还没有题目完成。请从试卷的第一道笔试题开始，按原文顺序输出全部 ${total} 题。`);
        lines.push("板块写法：每进入一个板块时输出一行 `@@GROUP@@ id|title|intro`，该板块的题跟在它后面。");
      } else {
        lines.push(`进度：全卷 ${total} 题，已解析结构 ${count} 题（题号 ${nosList.join(",")}），讲解完整 ${this.vpAnalyzedCount} 题，最后一题是${lastLabel}，属于板块 ${label}。`);
        if (remaining > 0) {
          lines.push(`接着${lastLabel}之后的题继续写，直到写完剩余 ${remaining} 题。`);
        } else {
          lines.push(`如果试卷原文中还有未被覆盖的笔试题，接着${lastLabel}之后的题按同样格式补全。`);
        }
        lines.push(`板块写法：接下来的题若仍属于 ${label}，直接输出 \`@@Q@@\` 行；只有跨进新板块时，才输出新的 \`@@GROUP@@ id|title|intro\` 行。`);
      }
      lines.push("题号写法：题号以试卷原文为准，上面提到的题号只是进度提示，与原文不一致时照录原文题号。");
      // 已用过的语篇编号（编号 → 板块标题）也要交代：模型才知道该沿用哪个号，而不是另起一个
      const refSeen = new Map();
      for (const g of groups) for (const q of (g.questions || [])) {
        const key = vpNormPassageRef(q.passageRef);
        if (key && !refSeen.has(key)) refSeen.set(key, String(g.title || g.id || "").trim());
      }
      const refList = [...refSeen.entries()].map(([k, t]) => (t ? `${k}（${t}）` : k));
      lines.push(refList.length
        ? `语篇写法：已用编号 ${refList.join("、")}，这些语篇一律写 \`@@PASSAGE_REF@@ 编号\`、不要重复正文；只有遇到新语篇时，才在它首次出现处输出一次 \`@@PASSAGE_DEF@@ 新编号\` 加全文。`
        : "语篇写法：每篇语篇在首次出现处输出一次 `@@PASSAGE_DEF@@ P编号` 加全文，之后所有用到它的题只写 `@@PASSAGE_REF@@ 编号`；写作题写 `-`。");
      lines.push(`每道笔试题仍输出 ${this.vpLockedTransferCount} 块迁移（写作题除外）。`);
      return lines.join("\n");
    },
    async continueVisualPaper() {
      if (this.streaming) return;
      if (!this.visualPaper || !this.submittedInput) {
        this.toast("没有可续写的试卷", "warn");
        return;
      }
      // 修改模式下续写：先保存并退出修改模式——续写会重解析整份文本，
      // 编辑态留在屏幕上会被新结构覆盖
      if (this.vpEditing) {
        this.toggleVpEdit();
        this.toast("修改已保存，继续生成剩余题目");
      }
      if (!this.ensureCanRun("当前模型需要输入使用码后才能续写")) return;
      const keepId = this.vpHistoryId;
      // 连总数都没解析出来 → 整卷重跑，原记录上覆盖，不新增记录
      if ((this.visualPaper.total || 0) <= 0 && this.vpQuestionCount === 0) {
        const text = this.submittedInput;
        this.resetVisualPaper();
        this.visualPaper = this.newVisualPaperState();
        this.visualPaper.historyId = keepId;
        this.output = "";
        this.rendered = "";
        this.errorMsg = "";
        await this._runVisualStream(text, keepId);
        return;
      }
      // 骨架齐不齐由「已解析题数 vs 声明总数」决定，但声明可能虚高（模型数错、
      // 或多轮累积的错误 total）。虚高时 count>=total 恒假，本该走「骨架 + 结构化
      // 缺题号」的近路会永远进不去，退回原卷重发并把教师改过的题干/语篇覆盖掉。
      // 判据：声明远大于实际题数时按「结构已齐」处理（续写工单按缺失题号点名）。
      const declaredTotal = Number(this.visualPaper && this.visualPaper.total) || 0;
      const inflated = declaredTotal > 0 && this.vpQuestionCount < declaredTotal
        && declaredTotal > this.vpQuestionCount * 2;
      const hasFramework = !!(this.visualPaper && this.visualPaper.frameworkRaw)
        && (inflated || this.vpQuestionCount >= this.vpTotal);
      // 完整骨架不能按最后一个 END_Q 截断：KEY / TOTAL 可能在其后。
      // 从已解析快照重建可同时保住答案区、编辑内容，并丢弃本轮未提交的半题。
      if (hasFramework) {
        this.output = this.vpSerializeRaw();
        this._outputDirty = true;
      }
      // 尾巴上的未完成片段（半道题、半句语篇、被截断的 @@GROUP@@ 头）在续写前整段丢掉：
      // 它们既没进结构也没显示过，留着只会让重解析在同一个位置反复走死路。
      // 但 @@KEY@@ 答案区与文档头是已解析的全局字段：KEY 通常在所有 END_Q 之后，
      // 一并裁掉会让重解析丢失 paperKey，后续序列化再也找不回答案区。
      const cut = this.vpLastCompleteEnd(this.output);
      if (!hasFramework && cut > 0) {
        // 先按最后一个 END_Q 裁掉尾巴，再把 @@KEY@@ 答案区拼回来。
        // KEY 通常在所有 END_Q 之后，一并裁掉会让重解析丢失 paperKey，
        // 后续序列化再也找不回答案区；拼回时只取 KEY 段自身，
        // 它后面再出现的新题块残片仍然丢掉。
        const head = this.output.slice(0, cut);
        const tail = this.output.slice(cut);
        const keyStart = tail.search(new RegExp(String.raw`[＠@]{2,}\s*KEY\s*` + _VP_TAG_DELIM, "i"));
        let kept = "";
        if (keyStart >= 0) {
          const keyPart = tail.slice(keyStart);
          // KEY 段在下一个结构标签处结束（其后的题块都是残片）。
          // 从 KEY 标签自身结束之后开始找，避免又匹配到 @@KEY@@ 尾部的定界符。
          const keyTagEnd = keyPart.search(new RegExp(
            String.raw`^[＠@]{2,}\s*KEY\s*` + _VP_TAG_DELIM, "i"));
          const afterKey = keyTagEnd >= 0 ? keyTagEnd + (keyPart.match(new RegExp(
            String.raw`^[＠@]{2,}\s*KEY\s*` + _VP_TAG_DELIM, "i"))[0].length) : keyPart.length;
          const rest = keyPart.slice(afterKey);
          const nextBlock = rest.search(new RegExp(
            String.raw`[＠@]{2,}\s*(?:Q|GROUP|PASSAGE_DEF|TOTAL|PAPER|NOTICE|STEM|OPTIONS|ANSWER|END_Q|PATTERN_NAME|PATTERN_STEPS|EVIDENCE|REASON|DISTRACTOR|PITFALLS|TRANSFER_PASSAGE|TRANSFER_STEM|TRANSFER_OPTIONS|TRANSFER_ANSWER|TRANSFER_EXPL|WRITING_POINTS|WRITING_OUTLINE|WRITING_SAMPLE|QTYPE|PASSAGE_REF|PASSAGE|GROUP_INTRO)\s*` + _VP_TAG_DELIM, "i"));
          kept = nextBlock >= 0 ? keyPart.slice(0, afterKey + nextBlock) : keyPart;
        }
        // head 切在 END_Q 标签结束处，原文档里它与 @@KEY@@ 之间的换行被切掉了，
        // 直接拼会把两个标签粘在一起（@@END_Q@@@@KEY@@）导致解析器认不出答案区
        const sep = head && kept && !head.endsWith("\n") ? "\n" : "";
        this.output = head + sep + kept;
        this._outputDirty = true;
      }
      if (this.output && !this.output.endsWith("\n")) this.output += "\n";
      // 两阶段：骨架已在阶段一解析完成 → 续写直接续讲解阶段（输入含 @@TAG@@，后端跳过框架阶段）。
      // 骨架快照存在 visualPaper 上并随历史记录持久化，历史续写同样走这条近路；
      // 旧记录没有快照 → 用原卷和续写工单走单阶段，保留已完成讲解。
      if (hasFramework && this.vpTotal > 0
        && this.vpQuestionCount >= this.vpTotal && this.vpAnalyzedCount >= this.vpQuestionCount) {
        // 工单为空还发请求只会白烧一次调用：模型没有可写的题，多半回头重写已有题
        this.finalizeVisualPaper("done", undefined, { updateId: keepId });
        this.toast("全部题目均已有完整讲解");
        return;
      }
      // 工单必须用空行与材料分开：后端 split_work_order 按这个口径切分，
      // 单换行拼接会让规划端切不开、工单整段混进解析材料
      const contInput = (hasFramework ? this.visualPaper.frameworkRaw : this.submittedInput)
        + "\n\n" + (hasFramework ? this.vpContinueBrief2() : this.vpContinueBrief());
      // 先显示讲解阶段，收到并行 stage 后再显示各任务；兼容不发 stage 的旧后端。
      // 整卷重跑走上面的 reset 分支，阶段由事件驱动，不经过这里
      this.vpStage = "explain";
      const missingNos = hasFramework ? this.vpGroups.flatMap(g => g.questions || [])
        .filter(q => !this.vpQuestionAnalyzed(q)).map(q => String(q.no)) : undefined;
      // 空数组的 every() 恒真，会把 visual_question_nos: [] 发出去，后端该字段
      // min_length=1 直接 422。空名单时改为不发字段，让后端按「全量」处理。
      const structuredNos = (missingNos && missingNos.length
        && missingNos.every(n => /^\d{1,3}$/.test(n))) ? missingNos : undefined;
      const baseLen = this.output.length;
      const expectedSeq = this._runSeq + 1;
      await this._runVisualStream(contInput, keepId, structuredNos);
      // 若续写未新增任何内容（模型未按指令），提示
      if (this._runSeq === expectedSeq && this.vpRunState === "done" && this.output.length === baseLen) {
        this.toast("续写未返回新题目，请重试", "warn");
      }
    },
    /* 讲解阶段续写指令：一份按题号点名的工单。进度必须取「已讲解」数——骨架一到位
       结构题数就满了，拿结构计数冒充进度会谎报「全部完成」，模型只能自己猜从哪续，
       实测会从头重写并撞输出上限。缺失题号逐个点名；输出由程序按题号合并进已有文档，
       所以不用交代「接着哪里往下写」。骨架文本不回传（它就在输入里），只交工单。 */
    vpContinueBrief2() {
      const groups = (this.visualPaper && this.visualPaper.groups) || [];
      const total = this.vpTotal || 0;
      let analyzed = 0;
      const missingNos = [];
      for (const g of groups) for (const q of (g.questions || [])) {
        // 题号没识别出来时（"?"）不要把占位符喂给模型——它会当成真题号照抄进 @@Q@@ 行
        if (!q.no || q.no === "?") continue;
        if (this.vpQuestionAnalyzed(q)) analyzed += 1;
        else missingNos.push(String(q.no));
      }
      const lines = ["【续写指令】你的输出由程序按题号合并进已有文档，顺序与归属都由程序决定。"];
      lines.push("材料是已标注好的试卷骨架：语篇、题干、选项已定稿，照常只写讲解字段，不要重复它们。");
      lines.push(`进度：全卷 ${total || "?"} 题，已有讲解 ${analyzed} 题。`);
      if (missingNos.length) {
        lines.push(`本次只需要为下列题号输出讲解块（按题号顺序）：${missingNos.join(",")}。名单之外的题号一律不要再输出。`);
      } else {
        // 缺失清单为空但仍有未知题号（"?"）等识别不出的情况：列不出工单，退回泛化指令
        lines.push("请为材料中还没有讲解的笔试题按材料题号顺序补写讲解块，已有讲解的题不要再输出。");
      }
      lines.push("每块以 @@Q@@ 题号开头、@@END_Q@@ 结尾；语篇编号一律沿用 @@PASSAGE_REF@@，不要重发语篇正文。");
      lines.push("不要输出 @@TOTAL@@、@@PAPER@@、@@NOTICE@@、@@GROUP@@、@@GROUP_INTRO@@、@@PASSAGE_DEF@@、@@STEM@@、@@OPTIONS@@、@@KEY@@ 等结构行——程序按题号合并，多发结构行会在文档里长出重复的空分组。");
      lines.push(`每道笔试题仍输出 ${this.vpLockedTransferCount} 块迁移（写作题除外）。`);
      return lines.join("\n");
    },
    vpScheduleRender() {
      if (this._vpRenderPending) return;
      if (this.vpEditing) return;   // 修改模式下不重解析，否则会替换掉正在编辑的 DOM
      this._vpRenderPending = true;
      setTimeout(() => {
        this._vpRenderPending = false;
        this.vpDoRender();
      }, streamRenderDelay((this.output || "").length, 80));
    },
    vpDoRender() {
      // 输出未变化时跳过整份重解析（定稿与在途节流 tick 重叠时不再重复解析全文）
      if (!this._outputDirty) return;
      this._outputDirty = false;
      const raw = this.output || (this.visualPaper && this.visualPaper.rawJson) || "";
      if (!raw.trim()) return;
      const { data, error } = this.tryParseVisualPaper(raw);
      if (data) {
        const norm = this.normalizeVisualPaper(data);
        if (norm) {
          if (!this.visualPaper) this.visualPaper = this.newVisualPaperState();
          this.visualPaper.paper = norm.paper;
          this.visualPaper.groups = norm.groups;
          this.visualPaper.answerMap = norm.answerMap;
          this.visualPaper.notice = norm.notice;
          this.visualPaper.total = norm.total;
          this.visualPaper.isJson = true;
          this.visualPaper.parseError = "";
          this.vpParseError = "";
          // 保持当前选中题合法
          if (this.visualPaper.groups.length) {
            if (this.visualPaper.currentGroupIdx >= this.visualPaper.groups.length) this.visualPaper.currentGroupIdx = 0;
            const g = this.visualPaper.groups[this.visualPaper.currentGroupIdx];
            if (g && this.visualPaper.currentQIdx >= (g.questions || []).length) this.visualPaper.currentQIdx = 0;
          }
          // 0 完整题但解析出总数/标题：中断残片，不报错、不展示原文
          if (this.vpQuestionCount === 0) {
            this.rendered = "";
            this.vpParseError = "";
          }
          return;
        }
      }
      // 自定义格式残片但整体解析失败：同样不展示原文裸 @@ 标签
      if (VP_ANY_TAG_RE.test(raw)) {
        if (this.visualPaper) this.visualPaper.isJson = false;
        this.vpParseError = "";
        this.rendered = "";
        return;
      }
      // 解析失败：保留错误供界面展示回退 Markdown（仅非自定义格式走这里）
      if (this.visualPaper) {
        this.visualPaper.parseError = error || "解析失败";
        this.visualPaper.isJson = false;
      }
      this.vpParseError = error || "解析失败";
      // 回退：仍用通用 Markdown 渲染
      this.rendered = renderMd(raw);
    },
    vpGetExportMarkdown() {
      if (!this.visualPaper || !this.visualPaper.groups) return this.output || "";
      const vp = this.visualPaper;
      let md = `# ${vp.paper?.title || "试卷可视化全解"}\n\n`;
      if (vp.notice) md += `> ${vp.notice}\n\n`;
      // 答案速查表
      const answerMap = this.vpBuildAnswerMap();
      if (Object.keys(answerMap).length) {
        md += `## 答案速查表\n\n`;
        md += `| 题号 | 答案 |\n|---|---|\n`;
        for (const [k, v] of Object.entries(answerMap)) md += `| ${k} | ${v} |\n`;
        md += `\n`;
      }
      for (const g of vp.groups) {
        md += `## ${g.title}\n\n${g.intro ? g.intro + "\n\n" : ""}`;
        for (const q of (g.questions || [])) {
          md += `### 第 ${q.no} 题 ${q.stem || ""}\n\n`;
          if (q.passage) md += `${q.passage}\n\n`;
          if (Array.isArray(q.options)) {
            for (const o of q.options) md += `- ${o.label}. ${o.text}\n`;
            md += `\n`;
          }
          if (q.answer) md += `**答案：${q.answer}**\n\n`;
          if (q.reference) {
            md += `**参考答案**\n\n- 证据：${q.reference.evidence}\n- 推理：${q.reference.reason}\n- 干扰项：${q.reference.distractor}\n\n`;
          }
          if (Array.isArray(q.pitfalls)) {
            md += `**易错点分析**\n\n`;
            for (const p of q.pitfalls) md += `- **${p.title}**：${p.desc}\n`;
            md += `\n`;
          }
          if (q.pattern) {
            md += `**考点范式归纳**\n\n- 范式：${q.pattern.name}\n`;
            for (let i = 0; i < (q.pattern.steps || []).length; i++) md += `${i + 1}. ${q.pattern.steps[i]}\n`;
            md += `\n`;
          }
          if (q.transfers && q.transfers.length) {
            const total = q.transfers.length;
            q.transfers.forEach((tr, ti) => {
              if (!tr) return;
              md += `**迁移训练${total > 1 ? ` ${ti + 1}/${total}` : ""}**\n\n${tr.passage}\n\n**${tr.stem}**\n\n`;
              for (const o of (tr.options || [])) md += `- ${o.label}. ${o.text}\n`;
              md += `\n答案：${tr.answer}\n\n解析：${tr.explanation}\n\n`;
            });
          } else if (q.writingGuide) {
            md += `**写作指导**\n\n- 要点：${(q.writingGuide.points || []).join("；")}\n- 框架：${q.writingGuide.outline}\n- 范文：${q.writingGuide.sample}\n\n`;
          }
          md += `---\n\n`;
        }
      }
      return md;
    },
    vpGetExportPlain() {
      // 复用 Markdown 转纯文本；先去掉行内标记（加粗/高亮），复制出来是干净文字
      return markdownToPlainText(vpDetag(this.vpGetExportMarkdown()));
    },

    /* ============ 可视化讲解：修改模式（所见即所得） ============ */
    /* 老师全程看不到 Markdown 标记：进入修改模式后每个字段就是一段可编辑的排版文字，
       选中文字用浮动工具条加粗/高亮，存盘仍是 **加粗** / ==高亮== 标记。
       保存走「结构 → @@TAG@@ 原始文本 → 重新解析对账」：原始文本是这条管线里
       唯一真源（历史回放重解析它、续写往它追加、导出读它解析出的结构），
       所以改完导出、改完续写、关掉页面再从历史打开，三条路都保留修改。 */
    toggleVpEdit() {
      if (!this.vpEditing) {
        if (!this.vpHasData) { this.toast("暂无可修改的内容", "error"); return; }
        if (this.streaming) { this.toast("生成中不能修改，请先停止生成", "warn"); return; }
        this._vpMaskBeforeEdit = this.maskOn;   // 退出编辑时恢复，别让遮罩状态被静默改掉
        this.maskOn = false;                    // 边改边看得到答案
        this.vpEditing = true;
        this.vpEditDirty = false;
        this.vpSelActive = false;
        this._vpBindEditListeners();
        this.$nextTick(() => this.vpMountAll());
        return;
      }
      // 退出：先把改动过的编辑区内容写回结构（防抖可能还没到点），再序列化落盘
      this.vpEditBeforeLeave();
      this.vpEditing = false;
      this.vpSelActive = false;
      this._vpStopEditTimer();
      this.vpHideTools();
      this.vpCommitEdits();
      if (this._vpMaskBeforeEdit !== undefined) {
        this.maskOn = this._vpMaskBeforeEdit;
        this._vpMaskBeforeEdit = undefined;
      }
      this.toast("修改已保存");
    },
    _vpBindEditListeners() {
      if (this._vpEditListenersBound) return;
      this._vpEditListenersBound = true;
      // 编辑区滚动/窗口变化时让浮动工具条跟着走
      document.addEventListener("scroll", () => { if (this._vpEditEl) this.vpRepositionTools(); }, { passive: true, capture: true });
      window.addEventListener("resize", () => { if (this._vpEditEl) this.vpRepositionTools(); });
      // 选中文字才浮出按钮：选区一变就同步（取消选中即消失）
      document.addEventListener("selectionchange", () => { if (this.vpEditing) this.vpSyncToolsFromSelection(); });
      // 拖选过程中先不浮出，松手后再出现（避免跟随鼠标闪烁）
      document.addEventListener("pointerdown", () => { this._vpDragging = true; }, { passive: true, capture: true });
      document.addEventListener("pointerup", () => {
        this._vpDragging = false;
        if (this.vpEditing) this.vpSyncToolsFromSelection();
      }, { passive: true, capture: true });
      // 拖到窗口外松手等情况下清掉拖拽标记，避免之后选字不浮出
      document.addEventListener("pointercancel", () => { this._vpDragging = false; }, { passive: true, capture: true });
      window.addEventListener("blur", () => { this._vpDragging = false; });
      // 关页面前把防抖中的改动落盘：免得老师在最后一次停顿（约 1 秒）之内就关了窗口
      window.addEventListener("beforeunload", () => this.vpFlushEdits());
    },
    _vpStopEditTimer() { clearTimeout(this._vpEditTimer); this._vpEditTimer = null; },

    /* --- 字段路径读写：paper.* / notice / g<序号>.* / q.*（q 指当前题） --- */
    vpResolvePath(path) {
      const segs = String(path || "").split(".");
      if (!segs.length || !this.visualPaper) return null;
      let host = null;
      let rest = segs;
      if (segs[0] === "paper") { host = this.visualPaper.paper; rest = segs.slice(1); }
      else if (segs[0] === "notice") host = this.visualPaper;   // 试卷说明是顶层字段，路径就是 notice 本身
      else if (/^g\d+$/.test(segs[0])) { host = this.vpGroups[Number(segs[0].slice(1))]; rest = segs.slice(1); }
      else if (segs[0] === "q") { host = this.vpCurrentQuestion; rest = segs.slice(1); }
      if (!host || !rest.length) return null;
      for (let i = 0; i < rest.length - 1; i++) {
        const k = rest[i];
        host = host[/^\d+$/.test(k) ? Number(k) : k];
        if (host == null) return null;
      }
      const key = rest[rest.length - 1];
      return { host, key: Array.isArray(host) && /^\d+$/.test(key) ? Number(key) : key };
    },
    vpFieldGet(path) {
      const t = this.vpResolvePath(path);
      if (!t) return "";
      const v = t.host[t.key];
      return v == null ? "" : v;
    },
    vpSetField(path, value) {
      const t = this.vpResolvePath(path);
      if (!t) return;
      t.host[t.key] = value;
      this.vpMarkDirty();
    },

    /* --- 挂载编辑区：只在目标变化时灌内容，避免打字时被自己覆盖 --- */
    vpMountKey(path) {
      const vp = this.visualPaper || {};
      return `${path}#${vp.currentGroupIdx || 0}-${vp.currentQIdx || 0}`;
    },
    vpMountAll() {
      if (!this.vpEditing) return;
      document.querySelectorAll("[data-vp-path]").forEach((el) => this.vpEditMount(el));
    },
    vpEditMount(el) {
      if (!el || !el.dataset || !this.vpEditing) return;
      const path = el.dataset.vpPath;
      if (!path) return;
      const key = this.vpMountKey(path);
      if (el.dataset.vpKey === key) return;
      el.dataset.vpKey = key;
      el.dataset.vpEdited = "";
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "false");
      const multi = el.dataset.vpMulti === "1";
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-multiline", multi ? "true" : "false");
      const label = el.parentElement ? el.parentElement.querySelector(".vp-edit-label") : null;
      if (label && label.textContent.trim()) el.setAttribute("aria-label", label.textContent.trim());
      el.classList.add("vp-editable");
      el.innerHTML = vpFmt(this.vpFieldGet(path));
      if (!el.dataset.vpBound) {
        el.dataset.vpBound = "1";
        el.addEventListener("input", () => this.vpOnEditInput(el));
        el.addEventListener("paste", (e) => this.vpOnEditPaste(e));
        el.addEventListener("keydown", (e) => this.vpOnEditKeydown(e, el));
        el.addEventListener("focus", () => this.vpShowTools(el));
        el.addEventListener("mouseup", () => this.vpShowTools(el));
        el.addEventListener("blur", () => { this.vpSelActive = false; this.vpHideToolsSoon(); });
      }
    },
    vpOnEditInput(el) {
      const path = el.dataset.vpPath;
      if (!path) return;
      el.dataset.vpEdited = "1";
      this.vpSetField(path, vpDomToMd(el));
    },

    /* --- 输入行为：粘贴纯文本、回车、快捷键 --- */
    vpOnEditPaste(e) {
      const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      e.preventDefault();
      // 插纯文本，杜绝从 Word/网页粘来的样式洪水；insertText 保留撤销栈
      if (!text) return;
      document.execCommand("insertText", false, text);
      this.vpOnEditInput(e.currentTarget || e.target);
    },
    vpOnEditKeydown(e, el) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "b") {
        e.preventDefault();
        this.vpFormatSelection(el, "b");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (el.dataset.vpMulti === "1") {
          const before = vpDomToMd(el);
          document.execCommand("insertLineBreak");
          // 少数浏览器不支持 insertLineBreak：退化成插入换行文本（pre-wrap 下同样换行）
          if (vpDomToMd(el) === before) document.execCommand("insertText", false, "\n");
          this.vpOnEditInput(el);
        } else {
          el.blur();
        }
        return;
      }
      if (e.key === "Escape") el.blur();
    },
    vpFormatSelection(el, tag) {
      if (!el) return;
      if (!vpToggleTag(el, tag)) { this.toast("先选中要加格式的文字", "warn"); return; }
      el.dataset.vpEdited = "1";
      this.vpSetField(el.dataset.vpPath, vpDomToMd(el));
      el.focus();
      this.vpRepositionTools();
    },
    /* 工具条按钮：作用于当前聚焦的编辑区（mousedown.prevent 保住了选区） */
    vpFormatFocused(tag) {
      const el = this._vpEditEl;
      if (!el) { this.toast("先点一下要修改的文字，再选中它", "warn"); return; }
      this.vpFormatSelection(el, tag);
    },

    /* --- 浮动格式工具条：只在真的选中了文字时才出现（没选中就完全没有这层浮层） --- */
    vpShowTools(el) {
      this._vpEditEl = el;               // 记住当前编辑的格子，浮层显隐由选区决定
      this.vpSyncToolsFromSelection();
    },
    vpSyncToolsFromSelection() {
      if (!this.vpEditing) { this.vpSelActive = false; this.vpHideTools(); return; }
      const el = this._vpEditEl;
      const sel = document.getSelection ? document.getSelection() : null;
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      const ok = !!(el && el.isConnected && range && !range.collapsed
        && el.contains(range.commonAncestorContainer));
      this.vpSelActive = ok;
      if (!ok || this._vpDragging) { this.vpHideTools(); return; }
      const tools = this.$refs.vpEditTools;
      if (!tools) return;
      tools.hidden = false;
      this.vpRepositionTools();
    },
    vpRepositionTools() {
      const tools = this.$refs.vpEditTools;
      const el = this._vpEditEl;
      if (!tools || tools.hidden || !el || !el.isConnected) return;
      // 贴着选区浮出（选区矩形拿不到时退回整格的位置）
      let rect = null;
      const sel = document.getSelection ? document.getSelection() : null;
      if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const rr = sel.getRangeAt(0).getBoundingClientRect();
        if (rr && (rr.width || rr.height)) rect = rr;
      }
      if (!rect) rect = el.getBoundingClientRect();
      const w = tools.offsetWidth || 92;
      const h = tools.offsetHeight || 34;
      const left = Math.max(8, Math.min(rect.left + Math.min(rect.width / 2, 60), window.innerWidth - w - 8));
      let top = rect.top - h - 8;
      if (top < 8) top = Math.min(window.innerHeight - h - 8, rect.bottom + 8);
      tools.style.left = `${Math.round(left)}px`;
      tools.style.top = `${Math.round(top)}px`;
    },
    vpHideTools() {
      // 只藏浮层，不清 _vpEditEl：用键盘（Shift+方向键）选字时也要能点亮加粗/高亮
      const tools = this.$refs.vpEditTools;
      if (tools) tools.hidden = true;
    },
    vpHideToolsSoon() {
      clearTimeout(this._vpToolTimer);
      this._vpToolTimer = setTimeout(() => {
        const el = this._vpEditEl;
        if (el && el === document.activeElement) return;
        this.vpHideTools();
      }, 140);
    },

    /* --- 列表增删：易错点 / 范式步骤 / 选项 / 写作要点 --- */
    /* 列表增删后，同一条目位置上的编辑区「路径没变、内容已变」，挂载键认不出来：
       先把这一栏所有编辑区的挂载键清掉，下一次 vpMountAll 会按当前结构整栏重灌，
       否则删中间一条时，前面那格还停留在被删条目的文字上，接着编辑就会写脏数据。 */
    vpRemountList(path) {
      const box = document.querySelector(`[data-vp-list="${path}"]`);
      if (!box) return;
      box.querySelectorAll("[data-vp-path]").forEach((el) => {
        delete el.dataset.vpKey;
        delete el.dataset.vpEdited;
      });
    },
    vpNewItem(path) {
      if (path.endsWith("options")) return { label: "", text: "" };
      if (path.endsWith("pitfalls")) return { title: "", desc: "" };
      if (path === "q.transfers") return { passage: "", stem: "", options: [], answer: "", explanation: "" };
      return "";
    },
    vpAddItem(path) {
      const t = this.vpResolvePath(path);
      if (!t) return;
      const arr = t.host[t.key];
      if (!Array.isArray(arr)) return;
      if (path.endsWith("pattern.steps") && arr.length >= 5) {
        this.toast("考点范式最多 5 步，先删再补", "warn");
        return;
      }
      this.vpEditBeforeLeave();          // 先把在改的内容写回，再动数组
      arr.push(this.vpNewItem(path));
      if (path.endsWith("options")) arr.forEach((o, i) => { if (o && typeof o === "object") o.label = String.fromCharCode(65 + i); });
      this.vpMarkDirty();
      this.vpRemountList(path);
      this.$nextTick(() => {
        this.vpMountAll();
        const box = document.querySelector(`[data-vp-list="${path}"]`);
        const eds = box ? box.querySelectorAll(".vp-editable") : [];
        if (eds.length) eds[eds.length - 1].focus();
      });
    },
    vpRemoveItem(path, idx) {
      const t = this.vpResolvePath(path);
      if (!t) return;
      const arr = t.host[t.key];
      if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
      this.vpEditBeforeLeave();          // 先把在改的内容写回，再动数组
      if (path.endsWith("options")) {
        // 选项所属的答案字段：q.options → q.answer，q.transfers.2.options → q.transfers.2.answer
        const ansPath = path.replace(/\.options$/, ".answer");
        const rawAnswer = String(this.vpFieldGet(ansPath) || "");
        const ans = rawAnswer.replace(/\*\*|==/g, "").trim().toUpperCase();
        const removed = String((arr[idx] && arr[idx].label) || "").trim().toUpperCase();
        // 删掉的正是正确项时先拦一下：否则答案会变成一个不存在的字母
        // 用 sameLabel 比：答案常写成 "A."，严格 === 会漏判，删掉正确项还无提示
        if (ans && removed && this.vpSameLabel(ans, removed)) {
          this.toast(`第 ${removed} 项是当前答案，先改答案再删它`, "warn");
          return;
        }
        arr.splice(idx, 1);
        arr.forEach((o, i) => { if (o && typeof o === "object") o.label = String.fromCharCode(65 + i); });
        // 答案前移只在「单字母」形态下做：多段格式（"1. D 2. F"）首字符码点
        // 远离 A-Z，算出来的 oldIdx 是天文数字，条件恒假——那种情况保持原样并提示
        const single = /^[A-Za-z][.．。]?$/.test(String(ans || "").trim());
        const oldIdx = single ? String(ans).trim().toUpperCase().charCodeAt(0) - 65 : -1;
        if (oldIdx > idx && oldIdx <= arr.length) this.vpSetField(ansPath, rawAnswer.replace(/[A-Za-z]/, String.fromCharCode(64 + oldIdx)));
      } else {
        arr.splice(idx, 1);
      }
      this.vpMarkDirty();
      this.vpRemountList(path);
      this.$nextTick(() => this.vpMountAll());
    },

    /* --- 保存：防抖落盘 + 退出时序列化对账 --- */
    vpMarkDirty() {
      if (!this.vpEditing) return;
      this.vpEditDirty = true;
      clearTimeout(this._vpEditTimer);
      this._vpEditTimer = setTimeout(() => this.vpFlushEdits(), 1200);
    },
    vpFlushEdits() {
      this._vpStopEditTimer();
      if (!this.vpEditing || !this.vpEditDirty) return;
      if (!this.visualPaper || !this.visualPaper.groups || !this.visualPaper.groups.length) return;
      this.vpEditDirty = false;
      const raw = this.vpSerializeRaw();
      this.output = raw;
      this.visualPaper.rawJson = raw;
      // 编辑中保留结构与对象引用：重解析会丢弃尚未填写的新增条目，
      // 也会替换正在绑定编辑框的对象。只刷新派生数据，退出修改时再解析对账。
      this.visualPaper.answerMap = this.vpBuildAnswerMap();
      this._outputDirty = false;
      this.vpRefreshFramework();
      this._vpPersistEdits();
    },
    vpBuildAnswerMap() {
      const out = {};
      for (const g of this.vpGroups) for (const q of (g.questions || [])) {
        const key = String(q.no);
        if (key in out) continue;
        if (q.answer) out[key] = String(q.answer);
        else if (this._vpHasWritingGuide(q.writingGuide)) out[key] = "见范文";
      }
      return out;
    },
    _vpPersistEdits() {
      const id = this.visualPaper && this.visualPaper.historyId;
      if (!id) return;
      const item = this.history.find((h) => h.id === id);
      if (!item) return;
      this._hydrateHistory(item);
      item.output = this.output;
      item.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
      this._persistHistoryItem(item);
    },
    /* 结构 → @@TAG@@ 契约文本（与 parseCustomVisualPaper 的口径严格对应：
       QTYPE 值必须同行、每题必须 @@END_Q@@ 收题、易错点用 :: 分隔、组信息用 | 分隔、
       语篇用 @@PASSAGE_DEF@@/@@PASSAGE_REF@@ 编号复用，同一篇只写一份正文） */
    vpSerializeRaw({ frameworkOnly = false } = {}) {
      const vp = this.visualPaper || {};
      const paper = vp.paper || {};
      // 字段内容里的 @@标签@@ 形状会被解析器当标签，插一个零宽空格打断（肉眼无差别）
      const guard = (s) => String(s == null ? "" : s).replace(/[＠@]{2,}/g, (m) => m[0] + "\u200b" + m.slice(1));
      const flat = (s) => guard(String(s == null ? "" : s).replace(/\r?\n/g, " ")).trim();
      const block = (s) => guard(String(s == null ? "" : s));
      const out = [];
      const paperKey = this.tryParseVisualPaper(this.output || vp.rawJson || "").data?.paperKey
        || this.tryParseVisualPaper(vp.frameworkRaw || "").data?.paperKey || "";
      // 取声明与实际题数的较大值：声明可能只是被截断的数字前缀（虚低），
      // 但也可能虚高（模型数错、或旧卷子带着多轮累积的错误总数）。
      // 直接原样写回会把截断/虚高固化进续写输入与历史，多轮越攒越错。
      const total = Math.max(Number(vp.total) > 0 ? Number(vp.total) : 0, this.vpQuestionCount);
      out.push(`@@TOTAL@@ ${total}`);
      out.push(`@@PAPER@@ ${flat(paper.title)}`);
      out.push(`@@NOTICE@@ ${flat(vp.notice)}`);
      /* 语篇按编号回写：同一篇只在首次出现处写一份 @@PASSAGE_DEF@@，其余题写 @@PASSAGE_REF@@。
         编号沿用题目自带的 passageRef；被教师单独改过、与同编号共用正文不一致的题改写内联
         @@PASSAGE@@，保住「单题独立修改」的语义，也不会污染同篇其他题。 */
      const emittedRefs = new Set();
      for (const g of this.vpGroups) for (const q of (g.questions || [])) {
        const key = vpNormPassageRef(q.passageRef);
        if (key) emittedRefs.add(key);
      }
      const defTextByRef = new Map();
      const defRefByText = new Map();
      let refSeq = 0;
      const nextRef = () => {
        let id;
        do { refSeq += 1; id = `P${refSeq}`; } while (emittedRefs.has(id));
        emittedRefs.add(id);
        return id;
      };
      const pushPassage = (qtype, q) => {
        const text = String(q.passage == null ? "" : q.passage);
        const trimmed = text.trim();
        const declaredRef = String(q.passageRef || "").trim();
        const key = vpNormPassageRef(declaredRef);
        if (!trimmed) {
          // 无语篇有两种成因，序列化必须区分：写 "-" 会被解析端当成「本就无语篇」，
          // 把「引用未解析」的告警永久抹掉（老师进出一次修改模式就再也看不到它）。
          // 未解析的题改写哨兵 "?"：归一化后仍非空、且不在 VP_NO_PASSAGE_REFS 里，
          // 重解析时会因为没有对应 DEF 而重新标记 passageUnresolved。
          out.push(`@@PASSAGE_REF@@ ${q.passageUnresolved ? "UNRESOLVED" : "-"}`);
          return;
        }
        if (key && defTextByRef.has(key)) {
          if (defTextByRef.get(key) === trimmed) { out.push(`@@PASSAGE_REF@@ ${declaredRef || key}`); return; }
          // 同编号但正文不同 = 这一题被单独改过：内联全文，不影响同篇其他题
          out.push("@@PASSAGE@@");
          out.push(block(text));
          return;
        }
        const sameTextRef = defRefByText.get(trimmed);
        if (sameTextRef) { out.push(`@@PASSAGE_REF@@ ${sameTextRef}`); return; }
        const id = declaredRef || nextRef();
        defTextByRef.set(vpNormPassageRef(id) || id, trimmed);
        defRefByText.set(trimmed, id);
        out.push(`@@PASSAGE_DEF@@ ${id}`);
        out.push(block(text));
        out.push(`@@PASSAGE_REF@@ ${id}`);
      };
      for (const g of this.vpGroups) {
        const gid = VP_GROUP_IDS.includes(g.id) ? g.id : "other";
        out.push(`@@GROUP@@ ${gid}|${flat(String(g.title || "").replace(/\|/g, "｜"))}|${flat(String(g.intro || "").replace(/\|/g, "｜"))}`);
        for (const q of (g.questions || [])) {
          const qtype = (q.qtype === "choice" || q.qtype === "blank" || q.qtype === "writing") ? q.qtype : "blank";
          out.push(`@@Q@@ ${String(q.no == null ? "" : q.no).trim() || "?"}`);
          out.push(`@@QTYPE@@ ${qtype}`);
          pushPassage(qtype, q);
          out.push("@@STEM@@");
          out.push(block(q.stem));
          out.push("@@OPTIONS@@");
          (q.options || []).forEach((o, i) => {
            if (!o) return;
            out.push(`${flat(o.label) || String.fromCharCode(65 + i)}. ${flat(o.text)}`);
          });
          if (frameworkOnly) {
            out.push("@@END_Q@@");
            continue;
          }
          out.push("@@ANSWER@@");
          out.push(flat(q.answer));
          out.push("@@EVIDENCE@@");
          out.push(block(q.reference ? q.reference.evidence : ""));
          out.push("@@REASON@@");
          out.push(block(q.reference ? q.reference.reason : ""));
          out.push("@@DISTRACTOR@@");
          out.push(block(q.reference ? q.reference.distractor : ""));
          out.push("@@PITFALLS@@");
          for (const p of (q.pitfalls || [])) {
            if (!p) continue;
            const title = flat(p.title).replace(/::/g, "：");
            const desc = block(p.desc);
            // 仅多行或与编码前缀冲突的说明需要编码，兼容已有的单行契约。
            const savedDesc = /[\r\n]/.test(desc) || desc.startsWith("@json:")
              ? "@json:" + JSON.stringify(desc) : desc;
            out.push(savedDesc ? `${title}::${savedDesc}` : title);
          }
          out.push("@@PATTERN_NAME@@");
          out.push(flat(q.pattern ? q.pattern.name : ""));
          out.push("@@PATTERN_STEPS@@");
          for (const s of ((q.pattern && q.pattern.steps) || [])) out.push(flat(s));
          if (qtype === "writing") {
            const wg = q.writingGuide || { points: [], outline: "", sample: "" };
            out.push("@@WRITING_POINTS@@");
            for (const s of (wg.points || [])) out.push(flat(s));
            out.push("@@WRITING_OUTLINE@@");
            out.push(flat(wg.outline));
            out.push("@@WRITING_SAMPLE@@");
            out.push(block(wg.sample));
          } else if (q.transfers && q.transfers.length) {
            // 每题 N 道迁移：整块重复输出，块与块之间不插其他标签
            for (const tr of q.transfers) {
              if (!tr) continue;
              out.push("@@TRANSFER_PASSAGE@@");
              out.push(block(tr.passage));
              out.push("@@TRANSFER_STEM@@");
              out.push(block(tr.stem));
              out.push("@@TRANSFER_OPTIONS@@");
              (tr.options || []).forEach((o, i) => {
                if (!o) return;
                out.push(`${flat(o.label) || String.fromCharCode(65 + i)}. ${flat(o.text)}`);
              });
              out.push("@@TRANSFER_ANSWER@@");
              out.push(flat(tr.answer));
              out.push("@@TRANSFER_EXPL@@");
              out.push(block(tr.explanation));
            }
          }
          out.push("@@END_Q@@");
        }
      }
      if (paperKey) out.push("@@KEY@@", block(paperKey));
      return `${out.join("\n")}\n`;
    },
    vpRefreshFramework() {
      // 完整旧记录可建立骨架；残缺旧记录仍需回到原卷补齐结构。
      if (this.visualPaper.frameworkRaw || this.vpQuestionCount >= this.vpTotal) {
        this.visualPaper.frameworkRaw = this.vpSerializeRaw({ frameworkOnly: true });
      }
    },
    /* 退出修改模式：先序列化写回原始文本，再重解析对账（答案速查表/题量随之更新） */
    vpCommitEdits() {
      if (!this.visualPaper || !this.visualPaper.groups || !this.visualPaper.groups.length) return;
      const before = this.vpQuestionCount;
      // 极端兜底用的结构快照：万一序列化出的文本解析不出题目，宁可回滚也不丢老师的内容。
      // output/rawJson 也必须进快照——旧版只备份五项，校验失败时 this.output 已被写成
      // 空文档，界面看着恢复了，导出/复制/续写读到的却是空卷子。
      const backup = JSON.parse(JSON.stringify({
        paper: this.visualPaper.paper, groups: this.visualPaper.groups,
        answerMap: this.visualPaper.answerMap, notice: this.visualPaper.notice, total: this.visualPaper.total,
        output: this.output, rawJson: this.visualPaper.rawJson,
      }));
      const raw = this.vpSerializeRaw();
      this.output = raw;
      this.visualPaper.rawJson = raw;
      this._outputDirty = true;
      this.vpDoRender();
      this._outputDirty = false;
      if (this.vpQuestionCount === 0) {
        // 校验未通过：界面结构与 output 一起回滚，且不写入历史（历史保持上一版，至少不会更差）。
        // 不要求 before > 0：序列化后解析不出题就该回滚，与进来时的题数无关。
        this.visualPaper.paper = backup.paper;
        this.visualPaper.groups = backup.groups;
        this.visualPaper.answerMap = backup.answerMap;
        this.visualPaper.notice = backup.notice;
        this.visualPaper.total = backup.total;
        this.output = backup.output;
        this.visualPaper.rawJson = backup.rawJson;
        this._outputDirty = false;
        // 回滚后必须重渲染：vpDoRender 刚用空文档渲染过一版，界面停在那个结果上，
        // 只还数据不还画面会出现「结构回来了但题面是空的」
        this._outputDirty = true;
        this.vpDoRender();
        this._outputDirty = false;
        this.toast("保存校验未通过，这次修改没有写入历史记录；请检查内容后重试", "error");
        return;
      }
      this.vpRefreshFramework();
      this._vpPersistEdits();
      if (this.vpQuestionCount !== before) this.toast(`保存提示：题数由 ${before} 变成 ${this.vpQuestionCount}`, "warn");
    },

    /* --- 推理过程（有界展示：截头保尾 + 盒内滚动 + 首 token 自动收起） --- */
    /* 记录后端发来的备用通道切换进度（fallback 事件）。
       纯展示用，不参与任何判定；单 Provider 时后端不会发该事件。 */
    updateFallback(raw) {
      const total = Number(raw && raw.total) || 0;
      const failed = Number(raw && raw.failed_index) || 0;
      const next = Number(raw && raw.next_index) || failed + 1;
      if (total < 2 || failed < 1 || next > total) return;
      // 上一家的推理片段已作废：清掉，免得两家思考内容串在一起
      if (this.reasoning) {
        this.reasoning = "";
        this.reasoningTokens = 0;
        this.reasoningTruncated = false;
      }
      this.fallbackInfo = {
        total,
        failed,
        current: next,
        reason: (raw && raw.reason) || "unavailable",
      };
    },

    /* ============ 仅供预览/联调：不发起任何请求，正式流程不会调用 ============
       方式一（推荐）：地址栏加 ?dev=fallback 或 ?dev=network 刷新，自动播放一次；
       方式二：控制台手动调用，一次只跑一条，跑完刷新页面即可复原：
         Alpine.$data(document.querySelector('[x-data]')).devPreviewFallback()
         Alpine.$data(document.querySelector('[x-data]')).devPreviewNetworkError()
       确认观感后可整段删除（含上面的 _devPreviewSeq 字段）。 */
    async maybeRunDevPreview() {
      let mode = "";
      try {
        mode = new URLSearchParams(location.search).get("dev") || "";
      } catch { return; }
      if (mode !== "fallback" && mode !== "network") return;
      // 等当前工具就位：面板与错误卡所在的容器由 currentTool 决定是否渲染
      for (let i = 0; i < 60 && !this.currentTool; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!this.currentTool) return;
      // 面板挂在普通工具（非迁移 26 / 词汇 24 / 可视化 13）的结果区，
      // 当前恰好在这些专用工具里时先切回第一个普通工具，免得预览时看不到面板
      if (["26", "24", "13"].includes(this.currentTool.id)) {
        const plain = (this.groups || [])
          .flatMap((group) => group.tools || [])
          .find((tool) => !["26", "24", "13"].includes(tool.id));
        if (plain) this.selectTool(plain);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      try {
        if (mode === "network") this.devPreviewNetworkError();
        else await this.devPreviewFallback();
      } catch (e) {
        console.warn("dev 预览失败：", e);
      }
    },
    async devPreviewFallback() {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // 每次推进都重新接管界面：面板挂在「output || streaming」容器里，
      // 若先跑过网络错误预览（它会把 streaming 置回 false），不重新置位就看不到方格
      const step = (payload) => {
        this.errorMsg = "";
        this.output = "";
        this.rendered = "";
        this.outputFoldEligible = false;
        this.streaming = true;
        this.thinking = true;
        this.status = "connecting";
        this.updateFallback(payload);
      };
      const token = (this._devPreviewSeq += 1);
      console.info(
        "[dev] 开始预览备用切换：约 1 秒后应出现方格子面板（1/3 超时），" +
        "约 4.5 秒后变成「红·红·闪」（2/3 不可用），约 8 秒后落到错误卡"
      );
      this.resetReasoning();
      this.failedModel = "";
      this.errorRetryable = true;
      this.errorLimited = false;
      this.thinkingSec = 0;
      this.fallbackInfo = null;
      step();
      await sleep(700);
      if (token !== this._devPreviewSeq) return;
      step({ failed_index: 1, total: 3, next_index: 2, reason: "timeout" });   // 红·闪·空
      await sleep(3500);
      if (token !== this._devPreviewSeq) return;
      step({ failed_index: 2, total: 3, next_index: 3, reason: "unavailable" }); // 红·红·闪
      await sleep(3500);
      if (token !== this._devPreviewSeq) return;
      // 收尾：全链失败时的错误卡与 toast
      this.finalize("error", "生成失败，请稍后重试");
      this.errorRetryable = true;
      this.failedModel = this.selectedModel || "演示模型";
    },
    devPreviewNetworkError() {
      // 抢占令牌：让可能在跑的 fallback 预览立刻停下，避免两条预览互相覆盖
      this._devPreviewSeq += 1;
      console.info("[dev] 预览网络层错误的提示语言");
      this.failedModel = this.selectedModel || "演示模型";
      this.errorRetryable = true;
      this.errorLimited = false;
      this.finalize("error", describeError(new TypeError("Failed to fetch")));
    },
    resetReasoning() {
      this.reasoning = "";
      this.reasoningShown = "";
      this.reasonTyper().reset(0);
      this.reasoningOpen = true;
      this.reasoningDone = false;
      this.reasoningLive = false;
      this.syncReasoningBox();
      this.reasoningTruncated = false;
      this.reasoningSec = 0;
      this.reasoningTokens = 0;
      this.reasoningSpeed = 0;
      this._reasoningStartTs = 0;
    },
    appendReasoning(text, tok) {
      if (!text) return;
      // 备用通道已经接上并开始出推理：等待面板功成身退
      if (this.fallbackInfo) this.fallbackInfo = null;
      // token 数由后端 tokenizer 随事件下发；旧格式缺失时退回 1（chunk≈1 token）
      if (!this._reasoningStartTs) this._reasoningStartTs = performance.now();
      this.reasoningTokens += tok > 0 ? tok : 1;
      let next = this.reasoning + text;
      if (next.length > REASONING_LIMIT) {
        next = next.slice(next.length - REASONING_LIMIT);
        this.reasoningTruncated = true;
      }
      this.reasoning = next;
      // 上屏走打字机逐字放出（真值已到位，节奏只影响 reasoningShown）
      this.reasonTyper().grow(this.reasoning.length);
      // 还没定稿才让它上屏：定稿后（正文已开始）迟到的推理 chunk 不该把盒子又顶回来
      if (!this.reasoningDone) {
        this.reasoningLive = true;
        this.syncReasoningBox();
      }
      this.scrollReasoning();
    },
    /* 思考盒的显隐：直接写 DOM，不走模板绑定。
       实测 Alpine 的 x-show 在这个元素上会漏掉「该隐藏」的那一次触发 —— 样式变更历史里
       只有一次显示写入、从来没有隐藏写入，状态已经是 false 了盒子还挂在屏上，
       于是每轮翻译都会留一条「正在思考…」。它是流式期间必经的元素，漏一次就看得出来。
       显隐由 reasoningLive 决定，写入点收敛到这一个函数里；非翻译工具没有这个 ref，自动空转。 */
    syncReasoningBox() {
      const el = this.$refs && this.$refs.reasoningBox;
      if (!el) return;
      el.style.display = this.reasoningLive ? "" : "none";
    },
    finishReasoningOnToken() {
      // 正文开始即等待结束：备用通道面板收起
      if (this.fallbackInfo) this.fallbackInfo = null;
      // 正文开始后推理即收起，避免把答案顶下去；用户可手动展开回看。
      // 只在首个 token 收一次：本函数每个 token 都会被调用，若无条件收起，
      // 用户点开的盒子会被紧接着的下一个 token 立刻收回去（流一停反而点得开）。
      if (this.reasoning && !this.reasoningDone) {
        this.reasoningDone = true;
        this.reasoningOpen = false;
        this.reasoningLive = false;
        // 定稿 = 思考文字停止打字，整段立即可见
        this.reasonTyper().reset(this.reasoning.length);
        this.reasoningShown = this.reasoning;
        this.syncReasoningBox();
      }
    },
    scrollReasoning() {
      // 推理 chunk 到达频率可远高于帧率：rAF 合并为每帧至多一次滚动。
      // rAF 在 Alpine 的响应式微任务之后、绘制之前执行，DOM 文本已更新，
      // 每帧最终滚动位置与逐 chunk 直滚完全一致。
      if (this._reasoningScrollRaf) return;
      this._reasoningScrollRaf = requestAnimationFrame(() => {
        this._reasoningScrollRaf = null;
        const el = this.$refs.reasoningBody;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    resetVocabReasoning() {
      if (!this.vocab) return;
      this.vocab.reasoning = "";
      this.vocab.reasoningShown = "";
      this.vocabReasonTyper().reset(0);
      this.vocab.reasoningOpen = true;
      this.vocab.reasoningDone = false;
      this.vocab.reasoningTruncated = false;
      this.vocab.reasoningTokens = 0;
    },
    appendVocabReasoning(text, tok) {
      if (!text || !this.vocab) return;
      this.vocab.reasoningTokens = (this.vocab.reasoningTokens || 0) + (tok > 0 ? tok : 1);
      let next = (this.vocab.reasoning || "") + text;
      if (next.length > REASONING_LIMIT) {
        next = next.slice(next.length - REASONING_LIMIT);
        this.vocab.reasoningTruncated = true;
      }
      this.vocab.reasoning = next;
      this.vocabReasonTyper().grow(this.vocab.reasoning.length);
      this.scrollVocabReasoning();
    },
    scrollVocabReasoning() {
      // 与主推理盒同策略：rAF 合并，每帧至多一次滚动
      if (this._vocabScrollRaf) return;
      this._vocabScrollRaf = requestAnimationFrame(() => {
        this._vocabScrollRaf = null;
        const el = this.$refs.vocabReasoningBody;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    finishVocabReasoningOnToken() {
      // 同主推理盒：每个 token 都调用，故只收一次，别打回用户的手动展开
      if (this.vocab && this.vocab.reasoning && !this.vocab.reasoningDone) {
        this.vocab.reasoningDone = true;
        this.vocab.reasoningOpen = false;
        this.vocabReasonTyper().reset(this.vocab.reasoning.length);
        this.vocab.reasoningShown = this.vocab.reasoning;
      }
    },
    appendCardReasoning(card, text, tok) {
      if (!text || !card) return;
      card.reasoningTokens = (card.reasoningTokens || 0) + (tok > 0 ? tok : 1);
      let next = (card.reasoning || "") + text;
      if (next.length > CARD_REASONING_LIMIT) {
        next = next.slice(next.length - CARD_REASONING_LIMIT);
        card.reasoningTruncated = true;
      }
      card.reasoning = next;
      this.cardReasonTyper(card).grow(card.reasoning.length);
    },
    /* ============ 流式打字机（每份正在增长的文本一台） ============
       惰性创建：不进 data 初始值，避免被历史快照 / 镜像层带走。
       render 回调只写「显示」字段，真值字段（output / reasoning 等）不受影响。 */
    _typer(key, render) {
      if (!this._typers) this._typers = {};
      if (!this._typers[key]) this._typers[key] = createStreamTyper(render);
      return this._typers[key];
    },
    /* 上屏进行中 = 流式期间，或自然完成的余量还在平滑放行。
       载入历史 / 收尾之后两者皆非，永远给全文（打字机指针的旧值不作数） */
    liveOut() {
      return this.streaming || this.outTyper().finishing;
    },
    liveOutputText() {
      const t = this.output || "";
      return this.liveOut() ? t.slice(0, this.outTyper().shown) : t;
    },
    liveVocab() {
      return !!(this.vocab && this.vocab.replacing) || this.vocabTyper().finishing;
    },
    liveVocabText() {
      const t = (this.vocab && this.vocab.output) || "";
      return this.liveVocab() ? t.slice(0, this.vocabTyper().shown) : t;
    },
    /* 主输出 / 译文共用一台（同一时刻只有一种工具在流式出字）：
       译文栏自己渲染（不走 doRender 的折叠 / 滚动口径），其余工具走 doRender */
    outTyper() {
      return this._typer("out", (shown, marks) => {
        if (this.isTranslateTool) {
          this.rendered = renderMdStreamPaced(this.output, shown, marks, this.liveOut());
        } else {
          this._outputDirty = true;
          this.doRender(marks);
        }
      });
    },
    vocabTyper() {
      return this._typer("vocab", (shown, marks) => {
        this._outputDirty = true;
        this.doRender(null, marks);
      });
    },
    reasonTyper() {
      return this._typer("reason", (shown) => {
        this.reasoningShown = this.reasoningDone
          ? this.reasoning
          : this.reasoning.slice(0, shown);
      });
    },
    vocabReasonTyper() {
      return this._typer("vocabReason", (shown) => {
        if (!this.vocab) return;
        this.vocab.reasoningShown = this.vocab.reasoningDone
          ? this.vocab.reasoning
          : this.vocab.reasoning.slice(0, shown);
      });
    },
    /* 迁移卡片一卡两台（正文 + 推理），挂在卡片对象上随卡片走 */
    cardTyper(card) {
      if (!card._typer) {
        card._typer = createStreamTyper((shown, marks) => {
          card.rendered = renderMdStreamPaced(
            card.output || "",
            shown,
            marks,
            card.streaming || card._typer.finishing
          );
        });
      }
      return card._typer;
    },
    cardReasonTyper(card) {
      if (!card._rTyper) {
        card._rTyper = createStreamTyper((shown) => {
          card.reasoningShown = card.reasoningDone
            ? card.reasoning
            : (card.reasoning || "").slice(0, shown);
        });
      }
      return card._rTyper;
    },
    /* --- 渲染调度：token 到达只推进打字机目标，上屏节奏由帧循环匀速放行 --- */
    scheduleRender() {
      this.outTyper().grow((this.output || "").length);
    },
    /* 迁移卡片按卡片各自放行（多卡并行，各卡一台互不干扰） */
    scheduleCardRender(card) {
      this.cardTyper(card).grow((card.output || "").length);
    },
    doRender(mainMarks, vocabMarks) {
      // 输出未变化（如定稿与在途渲染重叠）时跳过整份重渲染。
      // 打字机每帧推进也算变化，其 render 回调会先把 _outputDirty 置回 true
      if (!this._outputDirty) return;
      this._outputDirty = false;
      const main = this._foldedForRender(this.liveOutputText(), this.outputFoldEligible);
      this.outputFolded = main.folded;
      this.outputFoldTotal = main.total;
      this.rendered = renderMdStreamPaced(main.text, main.text.length, mainMarks, this.liveOut());
      if (this.vocab) {
        const v = this._foldedForRender(this.liveVocabText(), this.vocab.foldEligible);
        this.vocab.folded = v.folded;
        this.vocab.foldTotal = v.total;
        this.vocab.rendered = renderMdStreamPaced(v.text, v.text.length, vocabMarks, this.liveVocab());
      }
      this.$nextTick(() => {
        if (this.maskOn && this.currentTool && this.currentTool.id === "13") {
          tagAnswerElements(this.$refs.mdRoot);
        }
        this.maybeScroll();
      });
    },
    /* 只有「从历史打开」的超长内容才折叠：实时生成的内容还在增长，折叠会打断阅读 */
    _foldedForRender(text, eligible) {
      const raw = text || "";
      return eligible ? foldMarkdown(raw) : { text: raw, folded: false, total: raw.length };
    },
    /* 「查看更多」：关掉折叠标记后按完整内容重渲染一次 */
    unfoldHistoryOutput() {
      this.outputFoldEligible = false;
      if (this.vocab) this.vocab.foldEligible = false;
      this._outputDirty = true;
      this.doRender();
    },
    toggleMask() {
      this.maskOn = !this.maskOn;
      this.$nextTick(() => {
        if (this.maskOn) tagAnswerElements(this.$refs.mdRoot);
      });
    },
    onResultScroll(e) {
      const el = e.target;
      this._nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    },
    maybeScroll() {
      if (!this.streaming || !this._nearBottom) return;
      const el = this.$refs.resultScroll;
      if (el) el.scrollTop = el.scrollHeight;
    },

    /* --- 计时 --- */
    startTimer() {
      this._startTs = performance.now();
      this.elapsed = "0.0";
      clearInterval(this._timer);
      this._timer = setInterval(() => {
        this.elapsed = ((performance.now() - this._startTs) / 1000).toFixed(1);
      }, 100);
    },
    stopTimer() {
      clearInterval(this._timer);
      this._timer = null;
    },
    startThinkTimer() {
      const startTs = performance.now();
      clearInterval(this._thinkTimer);
      this._thinkTimer = setInterval(() => {
        const now = performance.now();
        this.thinkingSec = (now - startTs) / 1000;
        // 思考阶段从首个推理 chunk 起算，正文 token 到达（reasoningDone）后冻结
        if (this._reasoningStartTs && !this.reasoningDone) {
          const sec = (now - this._reasoningStartTs) / 1000;
          this.reasoningSec = sec;
          this.reasoningSpeed = this.reasoningTokens / Math.max(sec, 0.05);
        }
      }, 100);
    },
    stopThinkTimer() {
      // 停表时固化思考统计，消除 100ms 轮询的尾差
      if (this._reasoningStartTs && !this.reasoningDone) {
        const sec = (performance.now() - this._reasoningStartTs) / 1000;
        this.reasoningSec = sec;
        this.reasoningSpeed = this.reasoningTokens / Math.max(sec, 0.05);
      }
      clearInterval(this._thinkTimer);
      this._thinkTimer = null;
    },

    /* ============ 复制 ============ */
    async copyResult() {
      if (!this.output) return;
      const ok = await copyToClipboard(this.getExportPlain());
      if (!ok) {
        this.toast("复制失败，请手动复制", "error");
        return;
      }
      this.copied = true;
      this.toast("已复制排版纯文本");
      setTimeout(() => (this.copied = false), 1600);
    },

    /* ============ 导出 ============ */
    get exportSizeEnabled() {
      return this.exportFormat === "word" || this.exportFormat === "pdf";
    },
    get exportIsCopy() {
      const f = this.exportFormats.find((x) => x.id === this.exportFormat);
      return f ? f.type === "copy" : true;
    },

    async doExport() {
      if (!this.getExportMarkdown()) return;
      switch (this.exportFormat) {
        case "plaintext": await this.exportCopyPlain(); break;
        case "richtext": await this.exportCopyRichText(); break;
        case "mdsource": await this.exportCopyMd(); break;
        case "word": this.exportWord(); break;
        case "pdf": this.exportPdf(); break;
        case "md": this.exportDownloadMd(); break;
        case "txt": this.exportDownloadTxt(); break;
      }
      this.closeExportMenu();
    },

    async exportCopyRichText() {
      const plain = this.getExportPlain();
      const ok = await copyRichTextToClipboard(this.buildRichClipboardHtml(), plain);
      if (ok) {
        this.toast("已复制富文本，粘贴到 Word / WPS 时请选择“保留源格式”");
        return;
      }
      const plainOk = await copyToClipboard(plain);
      if (plainOk) this.toast("当前环境不支持富文本，已复制排版纯文本", "warn");
      else this.toast("复制失败，请手动复制", "error");
    },

    async exportCopyPlain() {
      const ok = await copyToClipboard(this.getExportPlain());
      if (ok) this.toast("已复制排版纯文本");
      else this.toast("复制失败，请手动复制", "error");
    },

    async exportCopyMd() {
      const ok = await copyToClipboard(this.getExportMarkdown());
      if (ok) this.toast("已复制 Markdown 源码");
      else this.toast("复制失败，请手动复制", "error");
    },

    buildRichClipboardHtml() {
      const content = this.buildExportContent()
        .replace(/<h([1-6])>/g, (_, level) => `<h${level} style="font-weight:700;line-height:1.4;margin:1em 0 0.5em;">`)
        .replace(/<p>/g, '<p style="margin:0.7em 0;">')
        .replace(/<(ul|ol)>/g, '<$1 style="margin:0.7em 0;padding-left:1.6em;">')
        .replace(/<blockquote>/g, '<blockquote style="margin:1em 0;padding:0.6em 1em;border-left:3px solid #b26a2e;">')
        .replace(/<table>/g, '<table border="1" bordercolor="#c8c8c8" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #c8c8c8;width:100%;">')
        .replace(/<(th|td)>/g, '<$1 style="border:1px solid #c8c8c8;padding:6px 8px;text-align:left;vertical-align:top;">')
        .replace(/<hr>/g, '<hr style="border:0;border-top:1px solid #c8c8c8;margin:1.2em 0;">');
      return `<div style="font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif;font-size:14pt;line-height:1.8;color:#222;">${content}</div>`;
    },

    buildExportHtml(fontSize) {
      const content = this.buildExportContent();
      return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif;font-size:${fontSize}pt;line-height:1.8;color:#222;max-width:100%;padding:0;margin:0;">${content}</body></html>`;
    },

    exportFilename(ext) {
      const name = this.currentTool ? this.currentTool.name : "NeoBangX";
      const d = new Date();
      const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      return `${name}_${ts}.${ext}`;
    },

    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    async exportWord() {
      if (!window.htmlDocx) {
        this.toast("正在加载 Word 导出组件…");
        if (!(await ensureHtmlDocx())) {
          this.toast("导出组件加载失败，请检查网络后重试", "error");
          return;
        }
      }
      try {
        const fullHtml = this.buildExportHtml(this.exportFontSize);
        const converted = htmlDocx.asBlob(fullHtml, {
          orientation: "portrait",
          margins: { top: 720, right: 720, bottom: 720, left: 720 },
        });
        this.downloadBlob(converted, this.exportFilename("docx"));
        this.toast("Word 文档已开始下载");
      } catch (e) {
        try { console.warn("Word 导出失败", e); } catch { /* 忽略 */ }
        this.toast("Word 导出失败，请重试", "error");
      }
    },

    /* PDF 导出：隐藏 iframe + 浏览器原生打印。
       相比旧的 html2canvas 截图方案：矢量文字可选中、排版与页面一致、
       分页不切断表格行、文件体积小。文档标题即另存时的默认文件名。 */
    exportPdf() {
      const content = this.buildExportContent();
      const title = this.exportFilename("pdf").replace(/\.pdf$/, "");
    
      // 同一时刻只保留一个打印 iframe
      const old = document.getElementById("nbx-print-frame");
      if (old) old.remove();
      const frame = document.createElement("iframe");
      frame.id = "nbx-print-frame";
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(frame);
    
      // 含公式时才引入 KaTeX 字体样式（与页面同版本）
      const katexLink = content.includes("class=\"katex") 
        ? '<link rel="stylesheet" href="/static/vendor/katex-0.16.47/katex.min.css">'
        : "";
      const doc = frame.contentDocument;
      doc.open();
      doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${katexLink}<style>${PDF_PRINT_CSS}</style></head><body class="md" style="font-size:${this.exportFontSize}pt">${content}</body></html>`);
      doc.close();
    
      this.toast("正在准备打印预览，请在弹窗中选择“另存为 PDF”");
      const win = frame.contentWindow;
      // 打印完成（或取消）后移除 iframe
      win.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500));
    
      // 等待外链样式、字体与图片就绪后再唤起打印，避免公式/图片缺失；3s 超时兑底
      const fire = () => {
        try { win.focus(); win.print(); }
        catch { this.toast("打印窗口唤起失败，请重试", "error"); frame.remove(); }
      };
      const loaded = new Promise((r) => {
        if (doc.readyState === "complete") r();
        else win.addEventListener("load", r, { once: true });
      });
      const ready = loaded.then(() => (doc.fonts && doc.fonts.ready) || null);
      Promise.race([
        ready.then(() => new Promise((r) => setTimeout(r, 150))),
        new Promise((r) => setTimeout(r, 3000)),
      ]).then(fire);
    },

    exportDownloadMd() {
      const blob = new Blob([this.getExportMarkdown()], { type: "text/markdown;charset=utf-8" });
      this.downloadBlob(blob, this.exportFilename("md"));
      this.toast("Markdown 文件已开始下载");
    },

    exportDownloadTxt() {
      const blob = new Blob([this.getExportPlain()], { type: "text/plain;charset=utf-8" });
      this.downloadBlob(blob, this.exportFilename("txt"));
      this.toast("纯文本文件已开始下载");
    },

    /* ============ 可视化讲解：导出单文件 HTML ============ */
    /* 该工具只有一种导出格式（单文件交互式 HTML），所以不走格式菜单：
       点下载 → 标题弹窗 → 直接产出可双击讲解的离线文件。 */
    get vpExportFilenamePreview() {
      return this.vpSafeFilename(this.vpExportTitle) + ".html";
    },
    /* 打印：把当前讲解交给 A4 排版引擎（vp-print.js）重排成纸面。
       刻意不复用页面的 @media print——分栏视图与暗色主题在纸上没法看，
       引擎会自己分页、自己数页数，并在弹窗里让老师选教师详解版 / 学生练习版 / 答案解析：
       学生练习版不含答案，老师要发的卷子和自己看的答案因此能分开出纸。 */
    async printVisualPaper() {
      if (!this.vpHasData) {
        this.toast("暂无可打印的讲解内容", "error");
        return;
      }
      if (this.streaming) {
        // 两阶段下「结构齐」不等于「讲解齐」：生成到第 12 题就导出会拿到大量
        // 空字段的半成品，学生还照着作答横线做题。生成中一律拒绝。
        this.toast(`正在生成中（已完成 ${this.vpAnalyzedCount}/${this.vpTotal} 题讲解），完成后可打印`, "warn");
        return;
      }
      // 先收起菜单：组件是异步加载的，菜单开着时重复点击会弹两次对话框
      this.closeExportMenu();
      if (!window.VPPrint) {
        this.toast("正在加载打印组件…");
        if (!(await ensureVpPrint())) {
          this.toast("打印组件加载失败，请检查网络后重试", "error");
          return;
        }
      }
      const paper = this.visualPaper && this.visualPaper.paper ? this.visualPaper.paper : {};
      const title = (paper.title || "").trim() || "试卷讲解";
      try {
        window.VPPrint.openDialog(this.vpExportPayload(title));
      } catch (e) {
        this.toast("打印组件初始化失败，请刷新后重试", "error");
      }
    },
    openVpExport() {
      if (!this.vpHasData) {
        this.toast("暂无可导出的讲解内容", "error");
        return;
      }
      if (this.streaming) {
        // 同 printVisualPaper：生成中导出只会拿到半成品
        this.toast(`正在生成中（已完成 ${this.vpAnalyzedCount}/${this.vpTotal} 题讲解），完成后可导出`, "warn");
        return;
      }
      this.closeExportMenu();
      const paper = this.visualPaper && this.visualPaper.paper ? this.visualPaper.paper : {};
      this.vpExportTitle = (paper.title || "").trim() || "试卷讲解";
      this.vpExportOpen = true;
      this.$nextTick(() => {
        const el = this.$refs.vpExportTitleEl;
        if (el) { el.focus(); el.select(); }
      });
    },
    closeVpExport() {
      if (this.vpExportBusy) return;
      this.vpExportOpen = false;
    },
    /* 文件名清洗：去掉 Windows 非法字符与结尾的点/空格，过长截断 */
    vpSafeFilename(name) {
      const cleaned = String(name || "")
        .replace(/[\\/:*?"<>|]/g, " ")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
        .replace(/[. ]+$/, "")
        .trim();
      if (cleaned) return cleaned;
      const d = new Date();
      const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      return `可视化试卷全解_${ts}`;
    },
    /* 只取讲解需要的字段，且全部是纯文本（提示词契约禁止 Markdown/HTML） */
    vpExportPayload(title) {
      const vp = this.visualPaper || {};
      const paper = vp.paper || {};
      const options = (list) => (list || []).map((o) => ({ label: o.label, text: o.text }));
      const groups = (vp.groups || []).map((g) => ({
        id: g.id || "",
        title: g.title || "",
        intro: g.intro || "",
        questions: (g.questions || []).map((q) => ({
          no: q.no,
          qtype: q.qtype || "",
          // 语篇引用与解析状态：导出物要能区分「本就无语篇」和「引用未解析」，
          // 否则讲台把未解析也说成无语篇，老师照着错信息排查
          passageRef: q.passageRef || "",
          passageUnresolved: !!q.passageUnresolved,
          passage: q.passage || "",
          stem: q.stem || "",
          options: options(q.options),
          answer: q.answer || "",
          reference: q.reference ? {
            evidence: q.reference.evidence || "",
            reason: q.reference.reason || "",
            distractor: q.reference.distractor || "",
          } : null,
          pitfalls: (q.pitfalls || []).map((p) => ({ title: p.title || "", desc: p.desc || "" })),
          pattern: q.pattern ? { name: q.pattern.name || "", steps: (q.pattern.steps || []).slice() } : null,
          transfers: (q.transfers || []).map((tr) => ({
            passage: tr.passage || "",
            stem: tr.stem || "",
            options: options(tr.options),
            answer: tr.answer || "",
            explanation: tr.explanation || "",
          })),
          writingGuide: q.writingGuide ? {
            points: (q.writingGuide.points || []).slice(),
            outline: q.writingGuide.outline || "",
            sample: q.writingGuide.sample || "",
          } : null,
        })),
      }));
      return {
        version: 1,
        // 独立文件没有后端：文件自带一个 id，浏览器里按它记住本机修改（localStorage）
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        rev: 1,
        title,
        notice: vp.notice || "",
        paper: { title: paper.title || "", subject: paper.subject || "", year: paper.year || "" },
        total: this.vpTotal,
        questionCount: this.vpQuestionCount,
        // 完成度：半成卷子在独立文件/打印件里要能看出缺什么，
        // 否则学生拿到的是「暂无参考答案」「该题暂无迁移训练内容」还以为是定稿
        analyzedCount: this.vpAnalyzedCount,
        missingNos: this.vpMissingQuestions.map((m) => m.no),
        // 编辑后可能尚未触发自动保存，导出快照必须从当前题目派生答案，
        // 保证速查表与这一份快照中的题目正文一致。
        answerMap: this.vpBuildAnswerMap(),
        groups,
      };
    },
    /* 图标精灵复用页面的 ICON_PATHS，避免导出文件里再维护一套图标 */
    vpExportIconSprite() {
      const names = ["x", "check", "chevron-left", "chevron-right", "chevron-down", "chevron-up",
        "eye", "eye-off", "grid", "pin", "projector", "target", "lightbulb", "route", "puzzle",
        "expand", "compress", "pen", "insert", "bold", "highlight", "print"];
      const symbols = names
        .map((n) => `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[n] || ""}</symbol>`)
        .join("");
      return `<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
    },
    /* 导出文件要能离线打印，所以把 A4 打印引擎的样式与脚本一并内联进去 */
    async vpLoadStandaloneAssets() {
      if (this._vpAssets) return this._vpAssets;
      const load = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${url} → ${r.status}`);
        return r.text();
      });
      const [html, css, js, printCss, printJs] = await Promise.all([
        load("/static/vp-standalone.html"),
        load("/static/vp-standalone.css"),
        load("/static/vp-standalone.js"),
        load("/static/vp-print.css"),
        load("/static/vp-print.js"),
      ]);
      this._vpAssets = { html, css, js, printCss, printJs };
      return this._vpAssets;
    },
    vpBuildStandaloneHtml(assets, title, payload) {
      const theme = THEMES.some((t) => t.id === this.theme) ? this.theme : "paper";
      const hour = new Date().getHours();
      const sky = theme === "sora" ? (hour >= 6 && hour < 22 ? "day" : "night") : "";
      // JSON 里的 < 全部转义：内容中若出现 </script> 会提前闭合数据块；
      // {{ 同样转义：put() 是顺序替换，数据块里的 {{VP_JS}} 等字面量会在后续
      // 替换 JS/CSS 时被一起替换，把整份运行时灌进 data 块导致 JSON.parse 失败。
      // \u007b 是合法 JSON 转义，JSON.parse 会还原成 {，但 HTML 文本层不存在该 token。
      const data = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\{\{/g, "\\u007b\\u007b");
      // 用函数式替换：CSS/JS 里的 $& $' 等序列不会被当成替换模式
      const put = (tpl, token, value) => tpl.replace(token, () => value);
      let out = assets.html;
      out = put(out, "{{VP_THEME}}", theme);
      out = put(out, "{{VP_SKY}}", sky ? ` data-sky="${sky}"` : "");
      out = put(out, "{{VP_TITLE}}", escapeHtml(vpDetag(title)));   // 标签页标题不带格式标记
      out = put(out, "{{VP_ICONS}}", this.vpExportIconSprite());
      out = put(out, "{{VP_CSS}}", assets.css);
      out = put(out, "{{VP_DATA}}", data);
      out = put(out, "{{VP_PRINT_CSS}}", assets.printCss);
      out = put(out, "{{VP_PRINT_JS}}", assets.printJs);
      out = put(out, "{{VP_JS}}", assets.js);
      const leftover = out.match(/\{\{VP_(THEME|SKY|TITLE|ICONS|CSS|DATA|JS|PRINT_CSS|PRINT_JS)\}\}/);
      if (leftover) throw new Error(`模板占位符未替换：${leftover[0]}`);
      return out;
    },
    async doVpExport() {
      if (this.vpExportBusy) return;
      if (!this.vpHasData) {
        this.toast("暂无可导出的讲解内容", "error");
        this.vpExportOpen = false;
        return;
      }
      this.vpExportBusy = true;
      try {
        const title = (this.vpExportTitle || "").trim() || "试卷讲解";
        const payload = this.vpExportPayload(title);
        const assets = await this.vpLoadStandaloneAssets();
        const html = this.vpBuildStandaloneHtml(assets, title, payload);
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        this.downloadBlob(blob, this.vpSafeFilename(title) + ".html");
        this.toast("讲解文件已开始下载：双击打开即可讲题");
        this.vpExportOpen = false;
      } catch (e) {
        this.toast("导出组件未加载，请检查网络或刷新后重试", "error");
      } finally {
        this.vpExportBusy = false;
      }
    },

    /* ============ 历史搜索 ============ */
    /* 索引内核是纯函数模块；这里只负责喂数据、分片建索引和把结果接进 Alpine。
       查询本身在内存里完成，不读 localStorage，也不解析 JSON。 */
    _historySearchEngine() {
      if (_historySearch) return _historySearch;
      if (typeof NbxHistorySearch === "undefined" || !NbxHistorySearch) {
        // 内核已移出首屏关键路径：这次查询先用不上，把它拉回来之后再补一次索引。
        // 回调只挂一次 —— 这个函数被多个入口调用，挂多了会重复建索引。
        if (!_historySearchDeferred) {
          _historySearchDeferred = true;
          nbxEnsureHistorySearch().then((ok) => { if (ok) this._historySearchInit(); });
        }
        return null;
      }
      _historySearch = NbxHistorySearch.create();
      return _historySearch;
    },
    _historySearchInit() {
      const engine = this._historySearchEngine();
      if (!engine) return;
      const pending = engine.sync(this.history);
      this.historySearchIndexing = pending.length > 0;
      this._historySearchScheduleBuild(false);
    },
    /* 列表增删改后的统一对账。O(条数) 只比元数据，正文是否重建由引擎按签名判断。 */
    _historySearchSync() {
      const engine = this._historySearchEngine();
      if (!engine) return;
      engine.sync(this.history);
      const stats = engine.stats();
      this.historySearchIndexing = stats.pending > 0;
      if (this.historyQuery.trim()) this._runHistorySearch(true);
      if (stats.pending > 0) this._historySearchScheduleBuild(false);
    },
    /* 镜像重读 / 导入合并后整份换血：旧正文可能已经变了，全部退回元数据重新读。 */
    _historySearchReload() {
      const engine = this._historySearchEngine();
      if (!engine) return;
      engine.invalidateBodies();
      const stats = engine.stats();
      this.historySearchIndexing = stats.pending > 0;
      this._historySearchSync();
      this._historySearchScheduleBuild(true);
    },
    _historySearchClear() {
      if (_historySearch) _historySearch.clear();
      this.historyQuery = "";
      this.historySearchRows = [];
      this.historySearchActive = -1;
      this.historySearchIndexing = false;
      this.historySearchDuration = 0;
      this.historySearchTotal = 0;
      this._hsLastQuery = "";
    },
    /* 单条正文刚被读回内存（打开历史 / 后台补索引）：立刻纳入全文检索。 */
    _historySearchHydrate(item) {
      const engine = this._historySearchEngine();
      if (!engine) return;
      if (item && item.input !== undefined) engine.hydrate(item, item);
      else engine.sync(this.history);
      if (this.historyQuery.trim()) this._runHistorySearch(true);
    },
    /* 分片建索引：一次最多 6 条 / 6ms，优先用 requestIdleCallback。
       正文可能有几 MB，绝不能在一次交互里同步读完。每片结束都会重跑当前查询，
       所以用户会看到结果从「标题命中」逐步长成「正文命中」。 */
    _historySearchScheduleBuild(prioritize) {
      const engine = this._historySearchEngine();
      if (!engine) return;
      if (engine.stats().pending <= 0) {
        this.historySearchIndexing = false;
        return;
      }
      this.historySearchIndexing = true;
      if (this._hsBuildQueued) {
        if (!prioritize) return;
        if (this._hsBuildIdle != null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
          try { window.cancelIdleCallback(this._hsBuildIdle); } catch (e) { /* ignore */ }
        }
        if (this._hsBuildTimer != null) clearTimeout(this._hsBuildTimer);
        this._hsBuildIdle = null;
        this._hsBuildTimer = null;
        this._hsBuildQueued = false;
      }
      const run = () => {
        this._hsBuildQueued = false;
        this._hsBuildIdle = null;
        this._hsBuildTimer = null;
        this._historySearchBuildSlice();
      };
      this._hsBuildQueued = true;
      if (!prioritize && typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        this._hsBuildIdle = window.requestIdleCallback(run, { timeout: 900 });
      } else {
        this._hsBuildTimer = setTimeout(run, prioritize ? 0 : 120);
      }
    },
    _historySearchBuildSlice() {
      const engine = this._historySearchEngine();
      if (!engine) return;
      const started = Date.now();
      let processed = 0;
      while (processed < 6 && engine.stats().pending > 0) {
        if (processed && Date.now() - started > 6) break;
        const item = engine.nextPending();
        if (!item) break;
        if (item.input !== undefined) {
          engine.hydrate(item, item);
        } else {
          const body = this._readBodyRaw(item.id);
          if (body) engine.hydrate(item, body);
          else engine.markMissing(item.id);
        }
        processed += 1;
      }
      const left = engine.stats().pending;
      this.historySearchIndexing = left > 0;
      if (this.historyQuery.trim()) this._runHistorySearch(true);
      if (left > 0) this._historySearchScheduleBuild(true);
    },
    _runHistorySearch(keepActive) {
      const raw = this.historyQuery;
      if (!raw.trim()) {
        this.historySearchRows = [];
        this.historySearchActive = -1;
        this.historySearchTotal = 0;
        this._hsLastQuery = "";
        return;
      }
      const engine = this._historySearchEngine();
      if (!engine) return;
      const result = engine.query(raw, { limit: 200 });
      const rows = [];
      for (const entry of result.results) {
        const item = entry.item;
        // 结果元数据挂在原条目上：打开 / 删除 / 重新生成仍拿到同一个对象，
        // 不会出现「从搜索里打开的是副本，标题更新落不回列表」的问题。
        item._hsTitle = entry.titleSegments;
        item._hsSnippet = entry.snippet;
        item._hsSnippetLabel = entry.snippetLabel;
        rows.push(item);
      }
      const same = this._hsLastQuery === raw;
      this.historySearchRows = rows;
      this.historySearchTotal = result.total;
      this.historySearchDuration = result.durationMs;
      this._hsLastQuery = raw;
      if (!keepActive || !same || this.historySearchActive < 0) {
        this.historySearchActive = rows.length ? 0 : -1;
      } else if (this.historySearchActive >= rows.length) {
        this.historySearchActive = rows.length - 1;
      }
    },
    _queueHistorySearch() {
      this._historySearchScheduleBuild(true);
      // 用 0ms 定时器合并同一帧内的连续输入，而不是 rAF：
      // 后台标签页 / 无合成帧的环境里 rAF 会被节流甚至不触发，
      // 搜索不能依赖「屏幕正在刷新」这个前提。
      if (this._hsSearchTimer != null) return;
      this._hsSearchTimer = setTimeout(() => {
        this._hsSearchTimer = null;
        this._runHistorySearch(false);
      }, 0);
    },
    onHistorySearchInput(event) {
      // 输入法组字期间不读值、不查询：半截拼音既搜不到东西，也会打断组字。
      if (this._hsComposing) return;
      this.historyQuery = event && event.target ? event.target.value : "";
      this._queueHistorySearch();
    },
    onHistorySearchCompositionStart() {
      this._hsComposing = true;
    },
    onHistorySearchCompositionEnd(event) {
      this._hsComposing = false;
      if (event && event.target) this.historyQuery = event.target.value;
      this._queueHistorySearch();
    },
    clearHistorySearch() {
      this.historyQuery = "";
      this.historySearchRows = [];
      this.historySearchActive = -1;
      this.historySearchTotal = 0;
      this._hsLastQuery = "";
      this.$nextTick(() => {
        const el = this.$refs.historySearchInput;
        if (el) el.focus();
      });
    },
    focusHistorySearch() {
      if (!this.history.length) return;
      if (this.isCompact) this.rightMobileOpen = true;
      if (this.rightCollapsed) {
        this.rightCollapsed = false;
        this.persistUI();
      }
      this.setRightTab("history");
      this._historySearchScheduleBuild(true);
      this.$nextTick(() => {
        const el = this.$refs.historySearchInput;
        if (!el) return;
        el.focus();
        try { el.select(); } catch (e) { /* ignore */ }
      });
    },
    onGlobalKeydown(event) {
      if (!event || event.altKey || event.shiftKey) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (String(event.key).toLowerCase() !== "k") return;
      event.preventDefault();
      this.focusHistorySearch();
    },
    _historySearchScrollActive() {
      this.$nextTick(() => {
        const list = this.$refs.historySearchList;
        if (!list) return;
        const el = list.querySelector(`[data-hs-i="${this.historySearchActive}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      });
    },
    onHistorySearchKeydown(event) {
      if (!event || event.isComposing || this._hsComposing) return;
      if (event.key === "Escape") {
        if (this.historyQuery) {
          event.preventDefault();
          this.clearHistorySearch();
        } else if (event.target && event.target.blur) {
          event.target.blur();
        }
        return;
      }
      const rows = this.historySearchRows;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!rows.length) return;
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const base = this.historySearchActive < 0 ? (delta > 0 ? -1 : 0) : this.historySearchActive;
        this.historySearchActive = (base + delta + rows.length) % rows.length;
        this._historySearchScrollActive();
        return;
      }
      if (event.key === "Enter") {
        if (!rows.length) return;
        event.preventDefault();
        const row = rows[this.historySearchActive >= 0 ? this.historySearchActive : 0];
        if (row) this.openHistory(row);
      }
    },
    get historyRows() {
      return this.historyQuery.trim() ? this.historySearchRows : this.history;
    },
    get historySearchHasQuery() {
      return !!this.historyQuery.trim();
    },
    get historySearchCountLabel() {
      if (this.historySearchIndexing && !this.historySearchRows.length) return "检索中";
      if (!this.historySearchRows.length) return "无匹配";
      return this.historySearchRows.length + " 条";
    },
    get historySearchStats() {
      const engine = this._historySearchEngine();
      const stats = engine ? engine.stats() : { docs: this.history.length, bodies: 0 };
      const ms = this.historySearchDuration > 0 ? Math.max(0.1, this.historySearchDuration).toFixed(1) : "0.1";
      return `已索引 ${stats.bodies}/${stats.docs} 条记录 · 最近一次查询 ${ms} ms`;
    },

    /* ============ 历史记录 ============ */
    /* --- 分键存储：索引 + 单条正文 --- */
    /* 淘汰最旧记录直到写入成功：write 用当前 history 生成 payload 并落盘，返回是否成功。
       keepId 是本次正在写的记录，永不淘汰它；配额满时从最旧开始删（正文键一并清理），
       让新内容优先落盘，而不是新内容静默丢失。 */
    _evictOldestUntil(write, keepId) {
      if (write()) return true;
      for (let i = this.history.length - 1; i >= 0; i -= 1) {
        const victim = this.history[i];
        if (!victim || victim.id === keepId) continue;
        this.history.splice(i, 1);
        lsRemove(HISTORY_BODY_PREFIX + victim.id);
        if (victim.titleJobId) this._removeTitleJournal(victim.titleJobId);
        if (write()) return true;
      }
      return write();
    },
    _historyIndexPayload() {
      // 迁移失败的会话退回整份数组（含正文），与拆分前的行为一致。
      // 搜索高亮是纯展示字段（_hs*），不能跟着旧格式一起落盘。
      if (!this._historyLegacy) return JSON.stringify(this.history.map(historyIndexOf));
      return JSON.stringify(this.history.map((item) => {
        const copy = {};
        for (const key of Object.keys(item)) {
          if (key === "_hsTitle" || key === "_hsSnippet" || key === "_hsSnippetLabel") continue;
          copy[key] = item[key];
        }
        return copy;
      }));
    },
    _persistHistoryIndex(keepId = "") {
      this._mirrorMergeBeforeWrite("history");
      const ok = this._evictOldestUntil(() => lsWrite(LS.history, this._historyIndexPayload()), keepId);
      // 每次落盘都顺手对账：标题、删除、版本切换、新记录都会经过这里。
      this._historySearchSync();
      return ok;
    },
    /* 写索引/收藏之前，先把桥刚并进来的行吸收进内存。

       桥直接写本 origin 的 localStorage，通知应用刷新有 400ms 去抖、且生成
       过程中会一直推迟（_mirrorFlushReload）。在这个窗口里应用侧任何一次改动
       都是拿内存里的整份数组覆盖回去，把桥刚落的行抹掉。两条线路同时开着时，
       标题编辑、收藏、落盘新记录都会踩到。

       按 updatedAt 做 LWW 合并；同 id 就地改现有对象而不是替换 —— finalize
       正持有某个条目的引用（_persistHistoryItem(origin)），换对象会让引用游离、
       这次的产出落不进索引。 */
    _mirrorMergeBeforeWrite(kind) {
      if (!_mirror.started) return;
      if (typeof NbxMirrorStore === "undefined" || !NbxMirrorStore.ready()) return;
      try {
        if (!kind || kind === "history") this._mirrorMergeList(this.history, LS.history, "history");
        if (!kind || kind === "favorites") this._mirrorMergeList(this.favorites, LS.favorites, "favorites");
      } catch (e) { /* 合并失败就按原样写，绝不因此中断本次落盘 */ }
    },
    /* 按 updatedAt 做 LWW 把存储里的行并进内存列表；同 id 就地改现有对象而不是
       替换 —— finalize 正持有某个条目的引用（_persistHistoryItem(origin)），
       换对象会让引用游离、这次的产出落不进索引。 */
    _mirrorMergeList(list, lsKey, kind = "history") {
      const stored = lsGet(lsKey, []);
      if (!Array.isArray(stored) || !stored.length) return;
      const stones = this._tombstones()[kind] || [];
      const byId = new Map();
      for (const it of list) if (it && it.id) byId.set(it.id, it);
      for (const it of stored) {
        if (!it || !it.id) continue;
        // 已判死的条目不许从磁盘旧索引里再捞回来：删除总是先记墓碑再写索引，
        // 而写索引前的合并读到的仍是删除前那份磁盘内容。
        if (stones.some((s) => s.id === it.id && Number(s.at) >= (Number(it.updatedAt) || 0))) continue;
        const mine = byId.get(it.id);
        // 内存里没有 → 桥刚新增的行，补进来（排序交给各写入点自己处理）
        if (!mine) {
          list.push(it);
          continue;
        }
        if ((Number(it.updatedAt) || 0) > (Number(mine.updatedAt) || 0)) Object.assign(mine, it);
      }
    },
    /* 收藏落盘统一入口：先吸收桥写入再写回，避免把对端刚并进来的收藏抹掉 */
    _persistFavorites() {
      this._mirrorMergeBeforeWrite("favorites");
      return lsSet(LS.favorites, this.favorites);
    },
    /* 落盘一条记录：正文单独写、索引单独写。返回是否成功。 */
    _persistHistoryItem(item) {
      // 防御：索引项没有 input 字段，若调用方在未水合的条目上改过别的字段就落盘，
      // 这里先读回正文，避免用空 input/output 覆盖已存内容（正文一定含 input 键）
      if (!this._historyLegacy && !item._bodyLoaded && item.input === undefined) this._hydrateHistory(item);
      // 改动时间：线路镜像合并时判断「哪一版更新」的唯一依据。
      // 所有正文改动都经这里落盘，所以在这一处统一定时即可覆盖（标题改动见 generateTitle）。
      item.updatedAt = Date.now();
      let ok = true;
      if (!this._historyLegacy) {
        const key = HISTORY_BODY_PREFIX + item.id;
        const payload = JSON.stringify(historyBodyOf(item));
        ok = this._evictOldestUntil(() => lsWrite(key, payload), item.id);
      }
      ok = this._persistHistoryIndex(item.id) && ok;
      if (!ok) storageFullWarn(true);
      // 登记待同步并安排推送（镜像未启用时是空操作）
      this._mirrorChanged("h", item.id, false, item.updatedAt);
      return ok;
    },
    /* 惰性读回正文：列表只持有索引，打开某条时才把大字段合并进来（本地同步读）。
       正文键缺失（旧记录 / 已被淘汰）时保留索引里的元数据，正文按空处理。 */
    _hydrateHistory(item) {
      if (!item || item._bodyLoaded || this._historyLegacy) return item;
      item._bodyLoaded = true;
      try {
        const raw = localStorage.getItem(HISTORY_BODY_PREFIX + item.id);
        if (raw) Object.assign(item, JSON.parse(raw));
      } catch { /* 正文损坏：保留索引元数据，正文留空 */ }
      // 正文已经进内存：立即补进全文索引，不必等后台分片轮到它
      this._historySearchHydrate(item);
      return item;
    },
    /* 直读某条正文，不改动入参、也不把正文带进内存列表。
       导出整份数据时用：列表里多数条目只有索引，逐条 _hydrateHistory 会把
       全部正文一次性灌进内存（可能数 MB），而这里只需要序列化出去。 */
    _readBodyRaw(id) {
      try {
        const raw = localStorage.getItem(HISTORY_BODY_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    /* 启动加载：旧格式就地拆分。正文全部写成功后才覆盖索引键，
       中途失败或崩溃时旧键完好、下次启动重放，不会丢数据。 */
    _loadHistory() {
      const raw = lsGet(LS.history, []);
      if (!isLegacyHistoryArray(raw)) return Array.isArray(raw) ? raw : [];
      const index = [];
      const written = [];
      for (const item of raw) {
        if (!item || typeof item !== "object" || !item.id) continue;
        if (!lsWrite(HISTORY_BODY_PREFIX + item.id, JSON.stringify(historyBodyOf(item)))) {
          for (const it of written) lsRemove(HISTORY_BODY_PREFIX + it.id);
          this._historyLegacy = true;
          return raw;
        }
        written.push(item);
        index.push(historyIndexOf(item));
      }
      if (!lsWrite(LS.history, JSON.stringify(index))) {
        for (const it of written) lsRemove(HISTORY_BODY_PREFIX + it.id);
        this._historyLegacy = true;
        return raw;
      }
      return index;
    },
    _unshiftHistory(item) {
      // 正文就在内存里：标记已水合，任何路径都不必（也不该）再从存储读回来覆盖它
      item._bodyLoaded = true;
      this.history.unshift(item);
      while (this.history.length > HISTORY_LIMIT) {
        const dropped = this.history.pop();
        if (dropped) {
          lsRemove(HISTORY_BODY_PREFIX + dropped.id);
          if (dropped.titleJobId) this._removeTitleJournal(dropped.titleJobId);
        }
      }
      this._persistHistoryItem(item);
      return item;
    },
    pushHistory(partial, modelUsed) {
      return this.commitHistoryWithTitle({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolId: this.currentTool.id,
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        input: this.submittedInput || this.input.trim(),
        fileName: this.submittedFileName || "",
        output: this.output,
        model: modelUsed || this.selectedModel,
        partial: !!partial,
        createdAt: Date.now(),
      });
    },
    /* 生成失败也留一条历史：用户敲进去的输入是真实付出，不该因为一次报错就消失。
       无输入（开发预览等）不落盘；同一工具 + 同一输入连续失败时合并上一条，
       避免反复点「重试」把列表刷屏。
       extra 里 input / output / fileName / model 会覆盖取值来源（超标词等输入不在输入框里的工具用），
       其余字段原样写进记录（如可视化试卷的 visualPaper 快照）。 */
    pushFailedHistory(errorMsg, extra = {}) {
      const { input: inputOverride, output: outputOverride, fileName: fileNameOverride, ...fields } = extra;
      const input = (inputOverride != null ? String(inputOverride) : (this.submittedInput || this.input || "")).trim();
      if (!input || !this.currentTool) return null;
      const args = {
        toolId: this.currentTool.id,
        input,
        fileName: fileNameOverride != null ? String(fileNameOverride) : (this.submittedFileName || ""),
        output: outputOverride != null ? outputOverride : this.output,
        model: this.failedModel || this.selectedModel,
        error: String(errorMsg || "生成失败").slice(0, 300),
        createdAt: Date.now(),
        ...fields,
      };
      const prev = this.history[0];
      // 索引项不含 input，合并判定前先把上一条正文读回来，保持「同输入连续失败合并」的旧行为
      if (prev) this._hydrateHistory(prev);
      if (prev && prev.error && prev.toolId === args.toolId && prev.input === args.input) {
        // 这次重试一个字都没产出时保留上一条已生成的内容，别把内容越重试越少
        if (!String(args.output || "").trim() && prev.output) args.output = prev.output;
        Object.assign(prev, args);
        // 合并进来的正是「活动版本」的字段：有条目容器时同步回填，否则下次切换版本
        // 会把这次合并的内容覆盖回旧正文
        NbxVersions.syncActive(prev);
        this._persistHistoryItem(prev);
        return prev;
      }
      return this._unshiftHistory({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        partial: false,
        ...args,
      });
    },

    _titleItemTracked(item) {
      return !!(item && item.id && this.history.some((entry) => entry.id === item.id));
    },
    _persistTitleMeta(item) {
      if (!this._titleItemTracked(item)) return;
      item.updatedAt = Date.now();
      this._persistHistoryIndex(item.id);
      this._mirrorChanged("h", item.id, false, item.updatedAt);
    },
    _newTitleJobId() {
      return `title_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    },
    _titleOwnerKey() {
      const user = this.authUser || {};
      return String(user.id || user.code || "");
    },
    _titleContentKey(item) {
      const source = [
        String(item.toolId || ""),
        String(item.input || "").slice(0, 1200),
        String(item.output || "").slice(0, 1200),
      ].join("\u0000");
      let hash = 2166136261;
      const bytes = typeof TextEncoder !== "undefined"
        ? new TextEncoder().encode(source)
        : Array.from(source, (ch) => ch.charCodeAt(0) & 255);
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    },
    _readTitleJournal() {
      const journal = lsGet(LS.titleJobs, {});
      return journal && typeof journal === "object" && !Array.isArray(journal) ? journal : {};
    },
    _writeTitleJournal(jobId, item, contentKey) {
      const journal = this._readTitleJournal();
      journal[jobId] = {
        jobId,
        historyId: item.id,
        toolId: item.toolId,
        input: String(item.input || "").slice(0, 1200),
        output: String(item.output || "").slice(0, 1200),
        contentKey,
        ownerKey: this._titleOwnerKey(),
        createdAt: Date.now(),
      };
      const keys = Object.keys(journal);
      if (keys.length > 200) {
        keys
          .sort((a, b) => Number(journal[a]?.createdAt || 0) - Number(journal[b]?.createdAt || 0))
          .slice(0, keys.length - 200)
          .forEach((key) => { delete journal[key]; });
      }
      if (!lsWrite(LS.titleJobs, JSON.stringify(journal))) {
        storageFullWarn(false);
        return false;
      }
      return true;
    },
    _removeTitleJournal(jobId) {
      if (!jobId) return;
      const journal = this._readTitleJournal();
      if (!journal[jobId]) return;
      delete journal[jobId];
      lsWrite(LS.titleJobs, JSON.stringify(journal));
    },
    _titleJournalEntry(jobId) {
      const entry = this._readTitleJournal()[jobId];
      return entry && typeof entry === "object" ? entry : null;
    },
    async _titleFetch(url, options = {}, timeoutMs = TITLE_JOB_SUBMIT_TIMEOUT_MS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    },
    _titleRetryStatus(status) {
      return status === 408 || status === 425 || status === 429 || status >= 500;
    },
    async _titleDelay(ms) {
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async _submitTitleJob(item, jobId, requestToken = this.auth.token) {
      const body = JSON.stringify({
        job_id: jobId,
        history_id: item.id,
        tool_id: item.toolId,
        input: String(item.input || "").slice(0, 1200),
        output: String(item.output || "").slice(0, 1200),
      });
      for (let attempt = 1; attempt <= TITLE_JOB_SUBMIT_ATTEMPTS; attempt += 1) {
        if (requestToken !== this.auth.token) {
          return { ok: false, retryable: false, stale: true };
        }
        let res;
        try {
          res = await this._titleFetch("/api/chat/title-jobs", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.authHeaders(),
            },
            body,
            keepalive: true,
          });
        } catch {
          if (requestToken !== this.auth.token) {
            return { ok: false, retryable: false, stale: true };
          }
          if (attempt < TITLE_JOB_SUBMIT_ATTEMPTS) {
            await this._titleDelay(250 * attempt);
            continue;
          }
          return { ok: false, retryable: true, stale: false };
        }
        if (requestToken !== this.auth.token) {
          return { ok: false, retryable: false, stale: true };
        }
        if (res.ok) {
          let data = null;
          try { data = await res.json(); } catch {}
          if (data && data.status === "failed") {
            return { ok: false, retryable: false, stale: false, title: "" };
          }
          return {
            ok: true,
            retryable: false,
            stale: false,
            title: data && data.status === "succeeded" ? String(data.title || "") : "",
            payloadHash: data && data.payload_hash ? String(data.payload_hash) : "",
          };
        }
        if (this._titleRetryStatus(res.status) && attempt < TITLE_JOB_SUBMIT_ATTEMPTS) {
          await this._titleDelay(250 * attempt);
          continue;
        }
        return {
          ok: false,
          retryable: this._titleRetryStatus(res.status),
          stale: res.status === 401 || res.status === 403,
        };
      }
      return { ok: false, retryable: true, stale: false };
    },
    _clearTitleJob(item) {
      if (!item) return;
      this._removeTitleJournal(item.titleJobId);
      item.titlePending = false;
      item.titleJobId = "";
      item.titleContentKey = "";
      item.titlePayloadHash = "";
      this._persistTitleMeta(item);
    },
    _applyTitleJobResult(item, title) {
      if (!item || !title) return;
      if (!item.title) item.title = String(title);
      this._removeTitleJournal(item.titleJobId);
      item.titlePending = false;
      item.titleJobId = "";
      item.titleContentKey = "";
      item.titlePayloadHash = "";
      item.updatedAt = Date.now();
      this._persistHistoryIndex(item.id);
      this._mirrorChanged("h", item.id, false, item.updatedAt);
    },
    async generateTitle(item) {
      if (!item || item.title || !this.isAuthenticated) return false;
      if (item.input === undefined) this._hydrateHistory(item);
      if (!String(item.input || "").trim()) return false;
      const contentKey = this._titleContentKey(item);
      if (item.titleJobId) {
        const journal = this._titleJournalEntry(item.titleJobId);
        if (!journal || journal.historyId !== item.id || journal.ownerKey !== this._titleOwnerKey()) {
          if (item.titlePending) this._clearTitleJob(item);
          return false;
        }
      }
      if (item.titlePending && item.titleJobId && item.titleContentKey === contentKey) {
        this._titlePollBlocked = false;
        this.scheduleTitlePoll(true);
        return true;
      }

      const tracked = this._titleItemTracked(item);
      const jobId = this._newTitleJobId();
      if (item.titleJobId) this._removeTitleJournal(item.titleJobId);
      item.titleJobId = jobId;
      item.titlePending = true;
      item.titleContentKey = contentKey;
      item.titlePayloadHash = "";
      this._titlePollBlocked = false;
      // 本地任务日志先于网络请求落盘：即使关页时 POST 尚未送达，下次打开仍能幂等补交。
      if (!this._writeTitleJournal(jobId, item, contentKey)) {
        item.titleJobId = "";
        item.titlePending = false;
        item.titleContentKey = "";
        if (tracked) this._persistTitleMeta(item);
        return false;
      }
      if (tracked) this._persistTitleMeta(item);

      const requestToken = this.auth.token;
      const result = await this._submitTitleJob(item, jobId, requestToken);
      if (item.titleJobId !== jobId) return false;
      if (!this._titleItemTracked(item)) {
        this._removeTitleJournal(jobId);
        return false;
      }
      if (!result.ok) {
        this._clearTitleJob(item);
        return false;
      }
      if (result.payloadHash) item.titlePayloadHash = result.payloadHash;
      if (result.title) item.title = result.title;
      if (item.title) {
        this._clearTitleJob(item);
        return false;
      }
      if (tracked) this._persistTitleMeta(item);
      this.scheduleTitlePoll(true);
      return true;
    },
    commitHistoryWithTitle(item) {
      // generateTitle 在第一次 await 前已写好 pending + 本地任务日志；正文历史不等待网络。
      this.generateTitle(item);
      return this._unshiftHistory(item);
    },
    stopTitlePolling() {
      if (this._titlePollTimer) {
        clearTimeout(this._titlePollTimer);
        this._titlePollTimer = null;
      }
    },
    scheduleTitlePoll(immediate = false) {
      this.stopTitlePolling();
      if (!this.isAuthenticated || this._titlePollBlocked) return;
      const hasPending = this.history.some((item) => item.titlePending && item.titleJobId);
      if (!hasPending) return;
      const hidden = typeof document !== "undefined" && !!document.hidden;
      const base = immediate ? 0 : (hidden ? TITLE_JOB_POLL_HIDDEN_MS : TITLE_JOB_POLL_MS);
      const backoff = Math.min(30000, base * Math.pow(2, this._titlePollFailures || 0));
      this._titlePollTimer = setTimeout(() => {
        this._titlePollTimer = null;
        this.reconcileTitleJobs();
      }, backoff);
    },
    resumeTitleJobs() {
      if (!this.isAuthenticated) {
        this.stopTitlePolling();
        return;
      }
      this._titlePollBlocked = false;
      this._titlePollFailures = 0;
      this.scheduleTitlePoll(true);
    },
    async _resubmitMissingTitleJob(item, jobId) {
      if (item.titleJobId !== jobId) return;
      if (item.title) {
        this._clearTitleJob(item);
        return;
      }
      if (item.input === undefined) this._hydrateHistory(item);
      const entry = this._titleJournalEntry(jobId);
      const ownerKey = this._titleOwnerKey();
      if (!entry || entry.historyId !== item.id || entry.ownerKey !== ownerKey) {
        // 导入/镜像里的 pending 字段不是本机任务凭据，绝不据此触发外部 LLM 调用。
        this._clearTitleJob(item);
        return;
      }
      if (!String(item.input || "").trim() || !this.isAuthenticated) {
        this._clearTitleJob(item);
        return;
      }
      const contentKey = this._titleContentKey(item);
      if (contentKey !== item.titleContentKey) {
        this.generateTitle(item);
        return;
      }

      const requestToken = this.auth.token;
      const result = await this._submitTitleJob(item, jobId, requestToken);
      if (item.titleJobId !== jobId) return;
      if (result.stale) {
        this._clearTitleJob(item);
        return;
      }
      if (result.ok) {
        if (result.payloadHash) item.titlePayloadHash = result.payloadHash;
        if (result.title) this._applyTitleJobResult(item, result.title);
        else this.scheduleTitlePoll(true);
      } else if (result.retryable) {
        this._titlePollFailures = Math.min(5, (this._titlePollFailures || 0) + 1);
      } else {
        this._clearTitleJob(item);
      }
    },
    async reconcileTitleJobs() {
      if (this._titlePollInFlight) return;
      if (!this.isAuthenticated || this._titlePollBlocked) return;
      const pending = this.history.filter((item) => item.titlePending && item.titleJobId);
      if (!pending.length) return;

      const requestToken = this.auth.token;
      const requestOwner = this._titleOwnerKey();
      this._titlePollInFlight = true;
      this.stopTitlePolling();
      try {
        const res = await this._titleFetch(
          "/api/chat/title-jobs/status",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...this.authHeaders(),
            },
            body: JSON.stringify({ job_ids: pending.map((item) => item.titleJobId) }),
          },
          Math.max(TITLE_JOB_SUBMIT_TIMEOUT_MS, 8000)
        );
        if (res.status === 401 || res.status === 403) {
          this._titlePollBlocked = true;
          this.stopTitlePolling();
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (requestToken !== this.auth.token || requestOwner !== this._titleOwnerKey()) return;
        const jobs = Array.isArray(data && data.jobs) ? data.jobs : [];
        this._titlePollFailures = 0;
        for (const job of jobs) {
          const item = this.history.find((entry) => entry.id === job.history_id)
            || this.history.find((entry) => entry.titleJobId === job.job_id);
          if (!item || item.titleJobId !== job.job_id) continue;
          if (item.title) {
            this._clearTitleJob(item);
            continue;
          }
          const journal = this._titleJournalEntry(job.job_id);
          if (!journal || journal.historyId !== item.id || journal.ownerKey !== requestOwner) {
            this._clearTitleJob(item);
            continue;
          }
          const currentContentKey = item.input !== undefined
            ? this._titleContentKey(item)
            : item.titleContentKey;
          const contentChanged = currentContentKey && item.titleContentKey
            && currentContentKey !== item.titleContentKey;
          const payloadChanged = job.payload_hash && item.titlePayloadHash
            && job.payload_hash !== item.titlePayloadHash;
          if (contentChanged || payloadChanged) {
            this.generateTitle(item);
            continue;
          }
          if (job.status === "succeeded" && job.title) {
            this._applyTitleJobResult(item, job.title);
          } else if (job.status === "failed") {
            this._clearTitleJob(item);
          } else if (job.status === "missing") {
            await this._resubmitMissingTitleJob(item, job.job_id);
          }
        }
      } catch {
        this._titlePollFailures = Math.min(5, (this._titlePollFailures || 0) + 1);
      } finally {
        this._titlePollInFlight = false;
        this.scheduleTitlePoll(false);
      }
    },
    async openHistory(item) {
      // 忙碌守卫由 isBusy 统一，需与 selectTool/goHome/startNewTopic 一致
      if (this.isBusy) {
        const ok = await this.askConfirm({
          title: "停止本次生成？",
          message: "正在生成中，查看历史将停止本次生成。",
          confirmText: "停止并查看",
          danger: true,
        });
        if (!ok) return;
        this.stopBusyStreams();
      }
      // 列表里持有的是索引项，正文在打开时才读回来（本地同步读，开销可忽略）
      this._hydrateHistory(item);
      if (!item.title && item.titleJobId) this.generateTitle(item);
      if (item.migration || item.hasMigration) {
        this.openMigrationHistory(item);
        return;
      }
      if (item.visualPaper || item.hasPaper || item.toolId === "13") {
        this.openVisualPaperHistory(item);
        return;
      }
      // 识别记录回放到 OCR 工作区（历史不存图片，所以回来后是「只有文字」的形态）
      if (item.ocr || item.toolId === OCR_TOOL_ID) {
        this.openOcrHistory(item);
        return;
      }
      // 翻译记录回放到译文工作区：原文与译文分列两栏，记录仍归这一屏管
      if (item.translate || item.toolId === TRANSLATE_TOOL_ID) {
        this.openTranslateHistory(item);
        return;
      }
      const tool = this.findTool(item.toolId);
      this.currentTool = tool || {
        id: item.toolId, name: item.toolName, icon: item.icon,
        description: "", prompt_loaded: true,
      };
      if (this.isVocabTool || item.toolId === "24") {
        // 超标词工具: 历史只保存替换结果, 载入到 vocab 独立视图
        this.resetVocab();
        this.vocab.text = item.input || "";
        this.vocab.output = item.output || "";
        // 超长结果先折叠渲染（与主输出区同一套「查看更多」）
        this.vocab.foldEligible = true;
        const folded = this._foldedForRender(this.vocab.output, true);
        this.vocab.folded = folded.folded;
        this.vocab.foldTotal = folded.total;
        this.vocab.rendered = renderMd(folded.text);
        if (item.error) {
          this.vocab.status = "error";
          this.vocab.checkError = item.error;
        } else {
          this.vocab.status = item.output ? "done" : "idle";
        }
        this.rightMobileOpen = false;
        return;
      }
      this.submittedInput = item.input;
      this.submittedFileName = item.fileName || "";
      this.submittedExpanded = false;
      this.inputCollapsed = true;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";
      this.output = item.output;
      // 这条记录就是屏幕上这份结果的归属：续写/重试都写回它
      this.activeHistoryId = item.id;
      // 失败记录：把错误原因一并还原，错误卡与「继续生成 / 直接重试 / 换个模型重试 / 编辑输入」照常可用
      if (item.error) {
        this.errorMsg = item.error;
        this.status = "error";
        this.failedModel = item.model || "";
        this.errorRetryable = true;
        this.errorLimited = false;
      } else if (item.partial) {
        // 上次是被停下的（不是写完的）：状态还原成「已停止」，页面上才会给出续写入口
        this.errorMsg = "";
        this.status = "stopped";
      } else {
        this.errorMsg = "";
        this.status = "history";
      }
      this.resetReasoning();
      // 从历史打开的长文先折叠渲染，首屏不必等全文解析
      this.outputFoldEligible = true;
      this._outputDirty = true; // 载入历史同样属于输出变化，须走完整渲染
      this.doRender();
      this.rightMobileOpen = false;
      this.$nextTick(() => {
        const el = this.$refs.resultScroll;
        if (el) el.scrollTop = 0;
      });
    },
    openMigrationHistory(item) {
      this._hydrateHistory(item);
      const tool = this.findTool(item.toolId) || {
        id: "26", name: "智能错题迁移", icon: "migration", description: "", prompt_loaded: true,
      };
      this.currentTool = tool;
      this.resetMigration();
      const saved = item.migration || {};
      const form = saved.form || {};
      const causes = Array.isArray(saved.causes) ? saved.causes : [];
      this.migration.form = {
        question: form.question || item.input || "",
        standardAnswer: form.standardAnswer || "",
        studentAnswers: form.studentAnswers || "",
        errorCause: form.errorCause || "",
      };
      this.migration.causes = causes.map((cause, index) => ({
        id: String(cause.id || cause.causeId || `cause_${index}`),
        label: String(cause.label || cause.cause || cause),
      }));
      this.migration.selectedCauseIds = this.migration.causes.map((cause) => cause.id);
      this.migration.questionCount = Number(saved.questionCount) || 3;
      this.migration.results = (Array.isArray(saved.results) ? saved.results : []).map((card, index) => ({
        id: `${item.id}_${index}`,
        causeId: card.causeId || `cause_${index}`,
        cause: card.cause || "未命名错因",
        output: card.output || "",
        rendered: renderMd(card.output || ""),
        status: card.status === "error" ? "error" : (card.status === "stopped" ? "stopped" : "done"),
        error: card.error || "",
        streaming: false,
        collapsed: false,
        requestId: "",
        reasoning: "",
        reasoningShown: "",
        reasoningOpen: false,
        reasoningDone: true,
        reasoningTruncated: false,
        reasoningTokens: 0,
      }));
      this.migration.generating = false;
      if (this.migration.results.length) {
        this.migration.step = 4;
        this.migration.generated = true;
        this.migration.analysisError = item.error || "";
      } else {
        // 整批失败、一张卡片都没留下：回到参数步骤，表单与已选错因都还原，
        // 失败原因显示在那一步的错误卡上，用户可以直接再点「开始生成」
        this.migration.step = 3;
        this.migration.generated = false;
        this.migration.analysisError = item.error || "生成失败";
      }
      this.rightMobileOpen = false;
    },
    openVisualPaperHistory(item) {
      this._hydrateHistory(item);
      const tool = this.findTool("13") || {
        id: "13", name: "试卷可视化全解", icon: "projector", description: "整卷题目与解析的课堂投影版", prompt_loaded: true,
      };
      this.currentTool = tool;
      this.resetVisualPaper();
      this.resetReasoning();
      this.submittedInput = item.input || "";
      this.submittedFileName = item.fileName || "";
      this.inputCollapsed = true;
      this.output = item.output || "";
      // 解卷走结构化分页视图，不套用长文折叠
      this.outputFoldEligible = false;
      // 失败记录：还原错误提示，错误卡上的「重试 / 换个模型 / 续写」照常可用
      if (item.error) {
        this.errorMsg = item.error;
        this.status = "error";
        this.vpRunState = "error";
        this.failedModel = item.model || "";
        this.errorRetryable = true;
        this.errorLimited = false;
      } else {
        this.errorMsg = "";
        this.status = "history";
        // 历史里只有 partial 一个字段记录「上次没写完」，没标就按自然收尾算
        this.vpRunState = item.partial ? "stopped" : "done";
      }
      this.vpCloseFullscreen();
      this.vpActiveTab = "reference";
      if (item.visualPaper && item.visualPaper.groups) {
        this.visualPaper = JSON.parse(JSON.stringify(item.visualPaper));
        // 恢复这份卷子生成时的迁移题量（旧记录没有该字段 → 当时硬编码为 1 道）
        this.vpSettings.transferCount = this._vpClampTransferCount(item.visualPaper.transferCount);
        // 旧记录可能存的是解析器修复前的坏快照（标签漂移导致易错点丢失等）：
        // 原文 output 完好，优先用当前解析器重解析，重解析不出题目再回退快照
        const re = this.tryParseVisualPaper(item.output || "");
        const norm = re.data && this.normalizeVisualPaper(re.data);
        if (norm && (norm.groups.length > 0 || norm.total != null)) {
          this.visualPaper.paper = norm.paper;
          this.visualPaper.groups = norm.groups;
          this.visualPaper.answerMap = norm.answerMap;
          this.visualPaper.notice = norm.notice;
          this.visualPaper.total = norm.total;
        }
        this.visualPaper.rawJson = item.output || "";
        this.visualPaper.isJson = true;
        this.visualPaper.historyId = item.id;
        this.vpParseError = "";
      } else {
        // 旧历史：尝试解析 Markdown 回退
        this.visualPaper = this.newVisualPaperState();
        this.visualPaper.rawJson = item.output || "";
        this.visualPaper.historyId = item.id;
        const { data } = this.tryParseVisualPaper(item.output || "");
        if (data) {
          const norm = this.normalizeVisualPaper(data);
          if (norm) {
            this.visualPaper.paper = norm.paper;
            this.visualPaper.groups = norm.groups;
            this.visualPaper.answerMap = norm.answerMap;
            this.visualPaper.notice = norm.notice;
            this.visualPaper.total = norm.total;
            this.visualPaper.isJson = true;
          }
        } else {
          // 保留为非 JSON；自定义格式残片走中断卡，绝不展示原文裸标签
          this.visualPaper.isJson = false;
          if (VP_ANY_TAG_RE.test(item.output || "")) {
            this.vpParseError = "";
            this.rendered = "";
          } else {
            this.vpParseError = "旧版记录，已回退为 Markdown 展示";
            this.rendered = renderMd(item.output || "");
          }
        }
      }
      // 这条记录没有解析出题目（失败/中断）→ 输入坞留在原位，别把「每题迁移题量」一起藏掉
      if (!this.vpHasData) this.inputCollapsed = false;
      this.rightMobileOpen = false;
      this._outputDirty = true; // 载入历史同样属于输出变化，须走完整重解析
      this.$nextTick(() => {
        this.vpDoRender();
        this.scheduleMascotCheck(80);
      });
    },
    async startNewTopic() {
      // 忙碌守卫由 isBusy 统一，需与 selectTool/goHome 一致：生成中新建会清空已生成内容
      if (this.isBusy) {
        const ok = await this.askConfirm({
          title: "停止本次生成？",
          message: "正在生成中，开始新题目将停止本次生成。",
          confirmText: "停止并新建",
          danger: true,
        });
        if (!ok) return;
        this.stopBusyStreams();
      }
      if (this.isMigrationTool) {
        this.resetMigration();
        this.scheduleMascotCheck(80);
        return;
      }
      if (this.isVocabTool) {
        this.resetVocab();
        this.scheduleMascotCheck(80);
        return;
      }
      if (this.isVisualPaperTool) {
        this.resetVisualPaper();
        this.resetReasoning();
        this.inputCollapsed = false;
        this.submittedInput = "";
        this.submittedFileName = "";
        this.submittedExpanded = false;
        this.output = "";
        this.rendered = "";
        this.errorMsg = "";
        this.status = "idle";
        this.vpCloseFullscreen();
        this.vpActiveTab = "reference";
        this.inputMode = "text";
        this.attachedFile = null;
        this.$nextTick(() => {
          this.autoGrow();
          const el = this.$refs.inputEl;
          if (el) el.focus();
          this.scheduleMascotCheck(80);
        });
        return;
      }
      this.inputCollapsed = false;
      this.submittedInput = "";
      this.submittedFileName = "";
      this.submittedExpanded = false;
      this.output = "";
      this.rendered = "";
      this.outputFoldEligible = false;
      this.errorMsg = "";
      // 新题目 = 新记录：不让续写/重试写回上一条
      this.activeHistoryId = null;
      this.status = "idle";
      this.resetReasoning();
      this.inputMode = "text";
      this.attachedFile = null;
      this.$nextTick(() => {
        this.autoGrow();
        const el = this.$refs.inputEl;
        if (el) el.focus();
        this.scheduleMascotCheck(80);
      });
    },
    async removeHistory(id) {
      const at = this.history.findIndex((h) => h && h.id === id);
      if (at < 0) return;
      const removed = this.history[at];
      const name = this.excerpt(removed.title || removed.inputHead || "", 30);
      const ok = await this.askConfirm({
        title: "删除这条记录？",
        message: `${name ? `「${name}」` : "这条记录"}删除后可在 ${this.undoSeconds} 秒内撤销。`,
        confirmText: "删除",
        danger: true,
      });
      if (!ok) return;
      // 确认期间列表可能被镜像重读替换：按 id 重新定位，删的仍是同一条
      const index = this.history.findIndex((h) => h && h.id === id);
      if (index < 0) return;
      const item = this.history[index];
      // 删除要立刻落盘，撤销只能靠这份正文快照写回
      const body = item._bodyLoaded ? historyBodyOf(item) : this._readBodyRaw(id);
      if (item.titleJobId) this._removeTitleJournal(item.titleJobId);
      this.history.splice(index, 1);
      // 删掉的正是屏幕上这条结果对应的记录：续写/重试改为收尾时新建，别再指向已删的 id
      if (this.activeHistoryId === id) this.activeHistoryId = null;
      lsRemove(HISTORY_BODY_PREFIX + id);
      // 先记墓碑再写索引：写索引前的镜像合并会读磁盘旧内容，墓碑必须已生效
      this._addTombstones("history", [id]);
      this._persistHistoryIndex();
      this._showUndo({ kind: "history", id, item, body, index, label: name });
    },
    /* 删除后的底部撤销条：单槽位，新的删除顶掉上一条（Telegram 式）。
       删除当场已落盘，这里只负责在窗口内把快照写回。 */
    _showUndo(action) {
      this._cancelUndo();
      // 先摘掉旧条再重建：进度条动画从满格重新开始，不会沿用上一次的残余时间
      this.$nextTick(() => { this.undoAction = action; });
      this._undoTimer = setTimeout(() => {
        this._undoTimer = null;
        this.undoAction = null;
      }, UNDO_WINDOW_MS);
    },
    _cancelUndo() {
      if (this._undoTimer) clearTimeout(this._undoTimer);
      this._undoTimer = null;
      this.undoAction = null;
    },
    /* 撤销删除：快照写回、撤掉本机墓碑、补一条更新的镜像 op。
       对端若已收到删除也不要紧：墓碑只判「比内容新」，恢复后的 updatedAt 更晚。 */
    undoDelete() {
      const act = this.undoAction;
      this._cancelUndo();
      if (!act) return;
      if (act.kind === "history") {
        if (this.history.some((h) => h && h.id === act.id)) return;
        const item = act.item;
        if (act.body) {
          // 正文也先并回内存：即使配额不足写不进磁盘，这一会话里打开仍看得到内容
          Object.assign(item, act.body);
          if (!lsWrite(HISTORY_BODY_PREFIX + act.id, JSON.stringify(act.body))) storageFullWarn(false);
        }
        item._bodyLoaded = true;
        item.updatedAt = Date.now();
        this.history.splice(Math.min(act.index, this.history.length), 0, item);
        this._removeTombstones("history", [act.id]);
        this._persistHistoryIndex(act.id);
        this._mirrorChanged("h", act.id, false, item.updatedAt);
        this.toast("已恢复该条记录");
        return;
      }
      if (this.favorites.some((f) => f && f.id === act.id)) return;
      const fav = act.item;
      fav.updatedAt = Date.now();
      this.favorites.splice(Math.min(act.index, this.favorites.length), 0, fav);
      this._removeTombstones("favorites", [act.id]);
      this._persistFavorites();
      this._mirrorChanged("f", act.id, false, fav.updatedAt);
      this.toast("已恢复该条收藏");
    },
    async clearHistory() {
      if (!this.history.length) return;
      const ok = await this.askConfirm({
        title: "清空全部历史？",
        message: `将删除全部 ${this.history.length} 条历史记录，此操作不可恢复。`,
        confirmText: "清空",
        danger: true,
      });
      if (!ok) return;
      // 清空是整批删除：上一条还在撤销窗口里的记录也一并作废
      this._cancelUndo();
      for (const item of this.history) {
        lsRemove(HISTORY_BODY_PREFIX + item.id);
        if (item.titleJobId) this._removeTitleJournal(item.titleJobId);
      }
      this._addTombstones("history", this.history.map((h) => h.id));
      this.history = [];
      lsWrite(LS.history, "[]");
      // 清空时把搜索状态一起收掉：引擎里不能留下已删记录的正文快照
      this._historySearchClear();
      this.toast("历史记录已清空");
    },

    /* ============ 提示词收藏 ============ */
    saveFavoriteFromInput() {
      const text = this.input.trim();
      if (!text) {
        this.toast("输入框还是空的，先写点内容再收藏", "warn");
        this.shakeComposer();
        return;
      }
      const firstLine = text.split("\n").map((s) => s.trim()).find(Boolean) || "";
      const fav = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        title: firstLine.length > 18 ? firstLine.slice(0, 18) + "…" : (firstLine || "未命名"),
        content: text,
        toolId: this.currentTool ? this.currentTool.id : null,
        toolName: this.currentTool ? this.currentTool.name : "未选择工具",
        createdAt: Date.now(),
      };
      this.favorites.unshift(fav);
      if (this.favorites.length > FAVORITES_LIMIT) this.favorites.length = FAVORITES_LIMIT;
      this._persistFavorites();
      this._mirrorChanged("f", fav.id, false, fav.createdAt);
      this.toast("已收藏到笔记本");
    },
    insertFavorite(fav) {
      if (fav.migration) {
        this.openMigrationHistory(fav);
        this.toast("已打开整条迁移记录");
        return;
      }
      this.input = fav.content;
      this.rightMobileOpen = false;
      this.$nextTick(() => {
        this.autoGrow();
        const el = this.$refs.inputEl;
        if (el) el.focus();
      });
      this.toast("已填入输入框");
    },
    openFavEdit(fav) {
      this.editingFav = { id: fav.id, title: fav.title, content: fav.content };
      this.favModal = true;
    },
    saveFavEdit() {
      const f = this.favorites.find((x) => x.id === this.editingFav.id);
      if (f) {
        f.title = this.editingFav.title.trim() || "未命名";
        f.content = this.editingFav.content;
        // 编辑是一次真实改动：刷新时间戳，否则镜像合并时会被对端的旧版本盖掉
        f.updatedAt = Date.now();
        this._persistFavorites();
        this._mirrorChanged("f", f.id, false, f.updatedAt);
        this.toast("收藏已更新");
      }
      this.favModal = false;
    },
    async removeFavorite(id) {
      const at = this.favorites.findIndex((f) => f && f.id === id);
      if (at < 0) return;
      const removed = this.favorites[at];
      const name = this.excerpt(removed.title || removed.content || "", 30);
      const ok = await this.askConfirm({
        title: "删除这条收藏？",
        message: `${name ? `「${name}」` : "这条收藏"}删除后可在 ${this.undoSeconds} 秒内撤销。`,
        confirmText: "删除",
        danger: true,
      });
      if (!ok) return;
      const index = this.favorites.findIndex((f) => f && f.id === id);
      if (index < 0) return;
      const item = this.favorites[index];
      this.favorites.splice(index, 1);
      this._addTombstones("favorites", [id]);
      this._persistFavorites();
      this._showUndo({ kind: "favorite", id, item, index, label: name });
    },

    /* ============ 数据导出 / 导入 ============
       历史与收藏只存在浏览器里（后端是无状态代理，不存任何用户数据）。代价是
       localStorage 按 origin 隔离，两条线路（www / cf）天然各存一份。这里提供
       「把两份合成一份」的入口，供两条路径复用：

       1) 用户手动导出 / 导入 JSON —— 备份、换设备、以及镜像失效时的兜底
       2) PeerMirror 的自动线路镜像 —— 走同一套 envelope 与合并规则

       格式与合并规则全在 nbx-mirror.js（纯函数，可单独跑用例验证）。 */

    get mirrorAvailable() {
      return typeof NbxMirror !== "undefined" && !!NbxMirror.mergeRemote;
    },
    /* 导入预览副标题与过滤后的分组。行数有封顶，组头计数始终是未过滤的总数 */
    get importPreviewSubtitle() {
      const g = this.importPreviewGroups;
      const n = (k) => { const x = g.find((i) => i.key === k); return x ? x.rows.length : 0; };
      const total = this.importPreviewTotal;
      if (!total) return "";
      const text = `将合并 ${total} 条变更：新增 ${n("added")} · 更新 ${n("updated")} · 删除 ${n("removed")}`;
      // 偏好只在真的有变更时才出现在明细里：没有此项的导入不该多一行噪声
      return n("prefs") ? `${text} · 偏好 ${n("prefs")}` : text;
    },
    get importPreviewFiltered() {
      const q = String(this.importPreviewFilter || "").trim().toLowerCase();
      return this.importPreviewGroups
        .map((g) => {
          const rows = q ? g.rows.filter((r) => String(r.title || "").toLowerCase().indexOf(q) !== -1) : g.rows;
          const shown = rows.slice(0, IMPORT_PREVIEW_CAP);
          return {
            key: g.key,
            label: g.label,
            danger: g.danger,
            rows: shown,
            total: rows.length,
            hasMore: rows.length > shown.length,
            moreText: `还有 ${rows.length - shown.length} 条，可用上方搜索缩小范围`,
          };
        })
        .filter((g) => g.rows.length);
    },
    _tombstones() {
      return NbxMirror.trimTombstones(lsGet(LS_TOMB, null));
    },
    /* 批量记墓碑。清空历史会一次传上百个 id，逐条读改写整个墓碑表会退化成 O(n²)。
       同一个 id 已有墓碑时只把时间推到最新，绝不新增第二条。
       返回本次使用的时间戳：调用方要拿同一个值登记待同步队列，否则对端回执的 at
       与队列里的 at 对不上，队列清不干净会反复重发。 */
    _addTombstones(kind, ids) {
      const list = (ids || []).filter(Boolean);
      if (!list.length || !this.mirrorAvailable) return 0;
      const stone = this._tombstones();
      const now = Date.now();
      const seen = Object.create(null);
      for (const entry of stone[kind]) seen[entry.id] = entry;
      for (const id of list) {
        const prev = seen[id];
        if (prev) prev.at = Math.max(prev.at, now);
        else stone[kind].push({ id, at: now });
      }
      lsSet(LS_TOMB, NbxMirror.trimTombstones(stone));
      // 删除也要进待同步队列：墓碑表只在握手时整表交换，实时传播靠这个 del op
      const short = kind === "history" ? "h" : "f";
      for (const id of list) this._mirrorChanged(short, id, true, now);
      return now;
    },
    /* 撤销删除时撤掉本机墓碑。对端那份由后续的 set op（updatedAt 更新）压过：
       合并只判「墓碑比内容新」，更晚的恢复内容不会被旧墓碑判死。 */
    _removeTombstones(kind, ids) {
      const list = (ids || []).filter(Boolean);
      if (!list.length || !this.mirrorAvailable) return;
      const stone = this._tombstones();
      const drop = new Set(list);
      const next = (stone[kind] || []).filter((s) => !drop.has(s.id));
      if (next.length === (stone[kind] || []).length) return;
      stone[kind] = next;
      lsSet(LS_TOMB, stone);
    },
    /* 本机全量数据 → envelope。正文优先取内存里的版本（可能刚改过还没落盘），
       未水合的条目直读 localStorage —— 不走 _hydrateHistory，避免把整份正文
       一次性灌进内存列表。导出传 {forExport:true}（偏好要补全），导入合并不传。 */
    _localEnvelope(opts) {
      const forExport = !!(opts && opts.forExport);
      const history = [];
      for (const item of this.history) {
        if (!item || !item.id) continue;
        const body = item._bodyLoaded ? historyBodyOf(item) : this._readBodyRaw(item.id);
        history.push({ index: historyIndexOf(item), body: body || historyBodyOf(item) });
      }
      const stamp = Date.now();
      return NbxMirror.buildEnvelope({
        exportedAt: stamp,
        source: (typeof location !== "undefined" && location.hostname) || "",
        history,
        favorites: this.favorites,
        tombstones: this._tombstones(),
        prefs: this._envelopePrefs(forExport, stamp),
      });
    },
    /* 本机偏好 → envelope 的 prefs（{theme:{v,at}, model:{v,at}}）。
       有 nbx_prefs 记录就用记录（时间戳是「用户什么时候做的选择」，LWW 才有意义）；
       导出时（forExport）缺记录的键用当前界面值补一条、时间戳取导出时刻 ——
       单线路部署从不写 nbx_prefs（镜像没跑，store 也就没 init），不补的话偏好
       根本进不了导出文件，「导出/导入带上偏好」就成了空话。

       合并的本地一侧（forExport 为假）绝不补：那等于宣称「导入这一刻我的选择是
       最新的」，会用现在的时间戳顶掉文件里更早的真实选择 —— 用户导回自己的备份，
       主题反而恢复不了。本地没有记录时留给文件的值胜出，才符合「导入」的直觉。 */
    _envelopePrefs(forExport, stamp) {
      let prefs = {};
      try {
        if (typeof NbxMirrorStore !== "undefined" && NbxMirrorStore.ready()) {
          prefs = NbxMirrorStore.readPrefs();
        }
      } catch (e) { prefs = {}; }
      if (!forExport) return prefs;
      const cur = { theme: this.theme, model: this.selectedModel };
      for (const key of ["theme", "model"]) {
        if (prefs[key] || !cur[key]) continue;
        prefs[key] = { v: cur[key], at: stamp };
      }
      return prefs;
    },
    /* 把合并结果写回本机。分块 + 块间让出主线程：一次全量合并可能涉及上百条
       正文、数 MB 的 JSON.stringify 与 localStorage 写入，密集同步写会卡住 UI。
       写入前先比对现有内容，一致就跳过 —— 重复合并（每次启动都会跑一次）应当零写入。 */
    async _applyMerged(merged) {
      const CHUNK = 20;
      let failed = 0;
      for (let i = 0; i < merged.history.length; i += 1) {
        if (i && i % CHUNK === 0) await new Promise((r) => setTimeout(r, 0));
        const entry = merged.history[i];
        if (!entry.body) continue;
        const key = HISTORY_BODY_PREFIX + entry.index.id;
        const payload = JSON.stringify(entry.body);
        let cur = null;
        try { cur = localStorage.getItem(key); } catch { cur = null; }
        if (cur !== payload && !lsWrite(key, payload)) failed += 1;
      }
      // 合并后不再存在的条目：正文键一并清理
      // 注意：这里刻意「不」给对端发删除标记。本地条目消失有两种原因 ——
      // 被墓碑判死（对端早就知道），以及被本地条数上限截掉（条目在对端仍然存在）。
      // 后者一旦发删除就会把对端的数据也删掉，而它并非用户意图的删除。
      // 删除只经墓碑表传播（握手时整表交换），那条路径不会误伤。
      const alive = new Set(merged.history.map((e) => e.index.id));
      for (const item of this.history) {
        if (item && item.id && !alive.has(item.id)) lsRemove(HISTORY_BODY_PREFIX + item.id);
      }
      for (const entry of merged.droppedHistory || []) {
        if (entry && entry.index) lsRemove(HISTORY_BODY_PREFIX + entry.index.id);
      }

      // 索引整体重写：复用既有的「配额不足 → 淘汰最旧 → 重试」路径
      this.history = merged.history.map((e) => e.index);
      // 对端可能改过正文：旧索引条目不能继续拿老正文参与搜索
      this._historySearchReload();
      this._persistHistoryIndex();
      // 与镜像重读同理：屏幕上这条记录要把正文读回来，否则版本切换器会凭空消失
      const curActive = this.history.find((h) => h && h.id === this.activeHistoryId);
      if (curActive) this._hydrateHistory(curActive);

      const favPayload = JSON.stringify(merged.favorites);
      let curFav = "";
      try { curFav = localStorage.getItem(LS.favorites) || ""; } catch { curFav = ""; }
      if (curFav !== favPayload) lsSet(LS.favorites, merged.favorites);
      this.favorites = merged.favorites;

      lsSet(LS_TOMB, merged.tombstones);
      if (failed) storageFullWarn(true);
      // 偏好：合并结果既要落进 nbx_prefs（镜像在跑时那是共享真相，下面
      // _mirrorAnnounceImported 会把它带给对端），也要套到界面上 —— 单线路部署
      // 根本没跑镜像，只写存储等于什么都没发生。
      // 直接写 localStorage 而不经 NbxMirrorStore：对端不可达时镜像整场都不会启动、
      // store 也就没 init，而「镜像失效改用导入」正是这个功能的用途。写不进去的话，
      // 下次加载 _mirrorApplyPrefs 会拿 nbx_prefs 里的旧值把导入的偏好顶回去。
      if (merged.prefs && Object.keys(merged.prefs).length) {
        lsSet(LS_PREFS, merged.prefs);
        this._applyPrefMap(merged.prefs);
        // 镜像没跑：清掉「偏好已播种」标记，让下一次镜像启动重新播种，把这次导入的
        // 偏好带给对端（标记还在的话它会认为没有可送的东西）
        if (!_mirror.started) lsRemove(MIRROR_PREFS_SEEDED_KEY);
      }
      this._mirrorAnnounceImported(merged);
    },
    /* 导入 / 合并进本机的数据也要流向对端，否则用户得在两条线路上各导入一次。
       整份登记（而不是只登记增量）是因为合并统计只给数量、不指出是哪些 id，
       而队列每条只存 id + 时间戳，整份登记的代价可以忽略。 */
    _mirrorAnnounceImported(merged) {
      if (!_mirror.started || typeof NbxMirrorStore === "undefined" || !NbxMirrorStore.ready()) return;
      try {
        for (const entry of merged.history) {
          const idx = entry && entry.index;
          if (idx && idx.id) NbxMirrorStore.outboxAdd("h", idx.id, NbxMirror.updatedAtOf(idx), false);
        }
        for (const fav of merged.favorites || []) {
          if (fav && fav.id) NbxMirrorStore.outboxAdd("f", fav.id, NbxMirror.updatedAtOf(fav), false);
        }
        // 偏好：队列只存键与时间戳（值在 nbx_prefs 里，发送时由 buildOp 取出）
        for (const key of ["theme", "model"]) {
          const p = merged.prefs && merged.prefs[key];
          if (p) NbxMirrorStore.outboxAdd("p", key, p.at, false);
        }
        this._mirrorSchedulePush();
      } catch (e) {
        /* 镜像未启用：导入本身已经完成，这里失败不影响结果 */
      }
    },
    _dataStamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    },
    exportData() {
      if (!this.mirrorAvailable) {
        this.toast("导出组件未加载，请刷新页面后重试", "error");
        return;
      }
      try {
        // forExport：偏好要在导出时补全（缺 nbx_prefs 记录的键用当前界面值补）
        const env = this._localEnvelope({ forExport: true });
        if (!env.history.length && !env.favorites.length) {
          this.toast("本机还没有可导出的历史或收藏", "warn");
          return;
        }
        // 内嵌 SHA-256 校验和：导入时整份验证，任何篡改/损坏都当场拒绝。
        // 摘要对规范化序列计算（见 nbx-mirror.js），手工重排文件格式不影响校验。
        const payload = NbxMirror.serializeEnvelope(env);
        const fileText = JSON.stringify(Object.assign({}, env, { sha256: NbxMirror.sha256Hex(payload) }));
        const blob = new Blob([fileText], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `neobangx-data-${this._dataStamp()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.toast(`已导出 ${env.history.length} 条历史、${env.favorites.length} 条收藏`
          + (env.prefs ? "，以及主题 / 模型偏好" : ""));
      } catch (e) {
        this.toast("导出失败，请重试", "error");
      }
    },
    /* 取文件。用动态 input 而不是常驻 DOM 元素：这个入口平时用不到，
       没必要在页面上多挂一个隐藏控件。用户取消时不会触发 change，靠窗口
       重新获得焦点兜一次，避免 Promise 永远悬着。 */
    _pickJsonFile() {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.style.display = "none";
        document.body.appendChild(input);
        let done = false;
        const finish = (file) => {
          if (done) return;
          done = true;
          input.remove();
          resolve(file || null);
        };
        input.addEventListener("change", () => finish(input.files && input.files[0]));
        window.addEventListener("focus", () => setTimeout(() => finish(null), 800), { once: true });
        input.click();
      });
    },
    /* 短绝对时间：MM-DD HH:mm。预览用相对时间（"3 天前"）对几个月前的旧备份不直观 */
    _fmtShortTime(ts) {
      const d = new Date(Number(ts) || 0);
      if (!Number(ts) || isNaN(d.getTime())) return "";
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    /* 偏好的展示名：主题 / 模型 id → 中文名。取不到就退回 id —— 对端可能有个本
       线路还没有的模型，显示成空白会让预览里的偏好行没法判断。 */
    _prefLabel(key, id) {
      if (!id) return "未设置";
      if (key === "theme") {
        const t = THEMES.find((x) => x && x.id === id);
        return t ? t.name : id;
      }
      const m = (Array.isArray(this.models) ? this.models : []).find((x) => x && x.id === id);
      return (m && m.name) || id;
    },
    /* 打开导入预览并等用户决定。分组按警觉度排序：删除（危险色）→ 更新 → 新增
       → 偏好；行内时间：删除用墓碑时间，更新/新增用条目 updatedAt。 */
    _confirmImportPreview(merged) {
      const ch = merged.changes || {};
      const row = (d, verb, tsKey) => ({
        title: d.title || "（无标题）",
        time: `${verb}于 ${this._fmtShortTime(d[tsKey])}`,
      });
      const groups = [
        { key: "removed", label: "删除", danger: true,
          rows: [].concat(ch.historyRemoved || [], ch.favoriteRemoved || []).map((d) => row(d, "删除", "at")) },
        { key: "updated", label: "更新", danger: false,
          rows: [].concat(ch.historyUpdated || [], ch.favoriteUpdated || []).map((d) => row(d, "更新", "updatedAt")) },
        { key: "added", label: "新增", danger: false,
          rows: [].concat(ch.historyAdded || [], ch.favoriteAdded || []).map((d) => row(d, "创建", "updatedAt")) },
        { key: "prefs", label: "偏好", danger: false,
          rows: (ch.prefsChanged || []).map((p) => ({
            title: `${p.key === "theme" ? "主题" : "模型"}：${this._prefLabel(p.key, p.from)} → ${this._prefLabel(p.key, p.to)}`,
            time: `同步于 ${this._fmtShortTime(p.at)}`,
          })) },
      ].filter((g) => g.rows.length);
      return new Promise((resolve) => {
        if (this.importPreviewOpen) { resolve(false); return; }
        this.importPreviewGroups = groups;
        this.importPreviewTotal = groups.reduce((n, g) => n + g.rows.length, 0);
        this.importPreviewFilter = "";
        this._importPreviewResolve = resolve;
        this.importPreviewOpen = true;
      });
    },
    closeImportPreview(ok) {
      const resolve = this._importPreviewResolve;
      this._importPreviewResolve = null;
      this.importPreviewOpen = false;
      this.importPreviewFilter = "";
      if (resolve) resolve(!!ok);
    },
    async importData() {
      if (!this.mirrorAvailable) {
        this.toast("导入组件未加载，请刷新页面后重试", "error");
        return;
      }
      const file = await this._pickJsonFile();
      if (!file) return;
      let text = "";
      try {
        text = await file.text();
      } catch (e) {
        this.toast("读取文件失败", "error");
        return;
      }
      // 整份校验：格式/版本/形状任何一项不合规都拒绝，绝不动本机数据
      const res = NbxMirror.validateEnvelope(text);
      if (!res.ok) {
        this.toast(`导入失败：${res.reason}`, "error");
        return;
      }
      const merged = NbxMirror.mergeRemote(this._localEnvelope(), res.envelope);
      const s = merged.stats;
      if (!NbxMirror.hasChanges(s)) {
        this.toast("本机数据已是最新，无需导入");
        return;
      }
      const parts = [];
      if (s.historyAdded) parts.push(`新增 ${s.historyAdded} 条历史`);
      if (s.historyUpdated) parts.push(`更新 ${s.historyUpdated} 条历史`);
      if (s.historyRemoved) parts.push(`删除 ${s.historyRemoved} 条历史`);
      if (s.favoriteAdded) parts.push(`新增 ${s.favoriteAdded} 条收藏`);
      if (s.favoriteUpdated) parts.push(`更新 ${s.favoriteUpdated} 条收藏`);
      if (s.favoriteRemoved) parts.push(`删除 ${s.favoriteRemoved} 条收藏`);
      if (s.prefsChanged) parts.push(`更新 ${s.prefsChanged} 项偏好`);
      // 条目级预览（删除/更新/新增/偏好分组，可搜索），确认后才动本机数据
      const ok = await this._confirmImportPreview(merged);
      if (!ok) return;
      await this._applyMerged(merged);
      this.toast(`导入完成：${parts.join("、")}`);
    },

    /* ============ 线路镜像（PeerMirror） ============
       同门两条线路互嵌一个隐藏的同站 iframe，把本机变更推进对方 origin 自己的
       localStorage。方向是「推」不是「拉」—— 备用线路要顶的正是主线路挂掉的
       那一刻，那时主线路的页面加载不了、也就读不到它的存储。提前推进去，
       故障时对端手里已经有一份，零点击可用。

       启动时机：等应用完全可用之后再建 iframe（requestIdleCallback），
       把「多一次文档加载 + TLS 握手」挪出首屏关键路径。对端不可达时熔断退避，
       整个功能静默失效，应用行为退回现状。 */

    _mirrorSetStatus(status, hint) {
      _mirror.status = status;
      this.mirrorStatus = status;
      this.mirrorHint = hint || "";
    },
    /* 对端把数据写进本 origin 存储后，内存列表要重读一次：
       同步往往晚于启动时的 _loadHistory，不重读用户就得刷新才看得到。
       但生成过程中不能整份替换 this.history —— finalize 会持有某个条目对象的
       引用（_persistHistoryItem(origin)），替换会让引用游离、这次的产出落不进
       索引。所以忙碌时先记待办，等空闲（或生成收尾）再刷。 */
    _mirrorReload() {
      this._mirrorReloadPending = true;
      this._mirrorFlushReload();
    },
    _mirrorFlushReload() {
      clearTimeout(this._mirrorReloadTimer);
      this._mirrorReloadTimer = setTimeout(() => {
        if (!this._mirrorReloadPending) return;
        if (this.isBusy) {
          this._mirrorFlushReload(); // 生成继续中：稍后再试，不丢这次刷新
          return;
        }
        this._mirrorReloadPending = false;
        this.history = lsGet(LS.history, []);
        this._historySearchReload();
        this.favorites = lsGet(LS.favorites, []);
        // 重读后列表只剩索引项，屏幕上那条记录得把正文读回来：版本数组在正文里，
        // 不水合就会出现「结果还在、切换器却消失」。此处必为空闲（上面刚判过 isBusy）。
        const cur = this.history.find((h) => h && h.id === this.activeHistoryId);
        if (cur) this._hydrateHistory(cur);
      }, 400);
    },
    /* 本机发生变更：登记进待同步队列并安排一次推送。
       at 必须与条目自身的 updatedAt 一致（调用方传入），否则对端回执的 at
       与队列里的 at 对不上，队列就清不干净、会反复重发。 */
    _mirrorChanged(kind, id, del, at) {
      if (!_mirror.started || !id) return;
      if (typeof NbxMirrorStore === "undefined" || !NbxMirrorStore.ready()) return;
      NbxMirrorStore.outboxAdd(kind, id, at || Date.now(), !!del);
      this._mirrorSchedulePush();
    },
    /* 本机偏好变更：写进 nbx_prefs（buildOp 从那里取负载）并登记推送。
       值没变就不写，避免启动加载时制造无意义的队列项。 */
    _mirrorSetPref(key, value) {
      if (typeof NbxMirrorStore === "undefined" || !NbxMirrorStore.ready()) return;
      if (key !== "theme" && key !== "model") return;
      try {
        const prefs = NbxMirrorStore.readPrefs();
        const prev = prefs[key];
        if (prev && prev.v === value) return;
        const now = Date.now();
        prefs[key] = { v: value, at: now };
        NbxMirrorStore.writePrefs(prefs);
        this._mirrorChanged("p", key, false, now);
      } catch (e) { /* 偏好同步失败不影响换主题/模型本身 */ }
    },
    /* 把一份偏好（{theme:{v,at}, model:{v,at}}）套到界面上：判据（哪些值该应用、
       本线路没有的值拒收）全在 pickPrefUpdates 里。
       该函数是纯函数，镜像没启用（store 没 init）时导入路径也要用它。 */
    _applyPrefMap(prefs) {
      if (typeof NbxMirrorStore === "undefined" || typeof NbxMirrorStore.pickPrefUpdates !== "function") return;
      const next = NbxMirrorStore.pickPrefUpdates(
        prefs,
        { theme: this.theme, model: this.selectedModel },
        {
          theme: THEMES.map((t) => t && t.id),
          model: (Array.isArray(this.models) ? this.models : []).map((m) => m && m.id),
        }
      );
      if (!next.theme && !next.model) return;
      // 置 applyingRemote：由应用引起的主题/模型变更不得回写同步队列（同值 ping-pong）。
      // 导入路径的传播由 _mirrorAnnounceImported 显式登记，不依赖这个回调。
      _mirror.applyingRemote = true;
      try {
        if (next.theme) this.setTheme(next.theme);
        if (next.model) this.chooseModel(next.model);
      } finally {
        _mirror.applyingRemote = false;
      }
    },
    /* 对端把偏好推进本 origin 后应用到界面 */
    _mirrorApplyPrefs() {
      if (typeof NbxMirrorStore === "undefined" || !NbxMirrorStore.ready()) return;
      let prefs;
      try { prefs = NbxMirrorStore.readPrefs(); } catch (e) { return; }
      this._applyPrefMap(prefs);
    },
    /* 连续编辑（改标题、连删多条）合并成一次推送 */
    _mirrorSchedulePush() {
      clearTimeout(this._mirrorPushTimer);
      this._mirrorPushTimer = setTimeout(() => {
        if (_mirror.peer) _mirror.peer.flush();
      }, MIRROR_PUSH_DEBOUNCE);
    },
    _scheduleBackground() {
      const start = () => {
        if (this._bg) return;
        nbxLoadScript(NBX_ASSET_URLS.background, 12000).then(() => {
          if (typeof createBackground !== "function") return;
          this._bg = createBackground(document.getElementById("bgfx"));
          const canvas = document.getElementById("bgfx");
          if (canvas) canvas.classList.add("bgfx-ready");
        }).catch(() => {});
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 1800 });
      } else {
        setTimeout(start, 700);
      }
    },
    _scheduleClickFx() {
      if (!this.fxOn) return; // 用户明确关掉时，连接入层都不加载
      const start = () => { nbxEnsureClickFx(); };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 2400 });
      } else {
        setTimeout(start, 1000);
      }
    },
    /* 首屏放行后空闲预加载渲染与检索内核：marked / DOMPurify / 历史检索内核都不在
       关键路径上，但用户一点「生成」或一搜历史就要用。空闲时先备好，别让第一次
       用到才等；检索内核回来后立刻补一次索引，之后搜索结果直接可用。 */
    _scheduleDeferredLibs() {
      const start = () => {
        nbxEnsureRenderLibs();
        nbxEnsureHistorySearch().then((ok) => { if (ok) this._historySearchInit(); });
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 2500 });
      } else {
        setTimeout(start, 900);
      }
    },
    _mirrorScheduleStart() {
      const start = () => this.mirrorStart();
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 3000 });
      } else {
        setTimeout(start, 1200);
      }
    },
    async mirrorStart() {
      if (_mirror.started) return;
      // 镜像模块不在首屏关键路径：空闲启动时再拉三件套。
      // 必须等它们真正就绪再判断可用性，否则会把「还没加载」误判成「不支持」。
      await nbxEnsureMirrorAssets();
      // 注意：_mirror.started 不能在解析出对端之前置 true —— 它是 _mirrorChanged
      // 写待同步队列的总闸门，置早了会让「镜像根本没启用」的会话也无限累积 outbox
      if (!this.mirrorAvailable
        || typeof NbxMirrorStore === "undefined"
        || typeof NbxMirrorPeer === "undefined") {
        this._mirrorSetStatus("off");
        return;
      }
      // 旧格式历史（拆分失败的降级会话）的存储结构与约定不同，不参与镜像
      if (this._historyLegacy) { this._mirrorSetStatus("off"); return; }
      const peerOrigin = await this._mirrorResolvePeer();
      if (!peerOrigin) { this._mirrorSetStatus("off"); return; }
      try {
        NbxMirrorStore.init({
          history: LS.history,
          favorites: LS.favorites,
          bodyPrefix: HISTORY_BODY_PREFIX,
          tomb: LS_TOMB,
          outbox: MIRROR_OUTBOX_KEY,
          prefs: LS_PREFS,
          storage: window.localStorage,
        });
      } catch (e) {
        this._mirrorSetStatus("off");
        return;
      }
      if (!NbxMirrorStore.ready()) { this._mirrorSetStatus("off"); return; }
      // 偏好播种：nbx_prefs 只在用户换过主题/模型后才有值，启用镜像之前的
      // 当前值要从 LS.theme / LS.model 补录（只补缺，不覆盖已有的较新记录）
      try {
        const prefs = NbxMirrorStore.readPrefs();
        let baseline = false;
        try {
          const t = localStorage.getItem(LS.theme);
          if (t && !prefs.theme) { prefs.theme = { v: t, at: Date.now() }; baseline = true; }
          const m = localStorage.getItem(LS.model);
          if (m && !prefs.model) { prefs.model = { v: m, at: Date.now() }; baseline = true; }
        } catch (e) { /* 读不到就跳过：偏好不同步不影响数据 */ }
        if (baseline) NbxMirrorStore.writePrefs(prefs);
        NbxMirrorStore.seedPrefsOnce(MIRROR_PREFS_SEEDED_KEY);
      } catch (e) { /* 偏好播种失败只影响偏好同步 */ }
      // 对端在本线路关着的时候推来的偏好只落在 nbx_prefs，页面启动读的却是
      // LS.theme / LS.model，必须在这里补一次「落到界面」。
      // 不能指望 onApplied：偏好 op 不携带任何条目，推送方收到回执就把队列清了，
      // 本页事后握手收不到任何一批 op，那个回调永远不会来。
      this._mirrorApplyPrefs();
      // 上次会话里删掉、但对端还没收到删除的条目，先按墓碑清一次本机
      try {
        const swept = NbxMirrorStore.sweepTombstoned();
        if (swept.historyIds.length || swept.favorites) this._mirrorReload();
      } catch (e) { /* 清扫失败不影响镜像启动 */ }
      // 首次启用：把已有条目全部登记进队列。缺了这一步，「启用之前就存在的数据」
      // 永远送不出去 —— 增量队列只记启用之后的变更，而「对端为空才发全量」在对端
      // 已有数据时不成立（主线路用了一阵、备份线路也可能有自己的历史）
      try {
        NbxMirrorStore.seedOutboxOnce(MIRROR_SEEDED_KEY);
      } catch (e) { /* 忽略：种子失败只影响首次同步，后续变更照常推送 */ }
      // 走到这里才认为镜像真正「启动」：此后 _mirrorChanged 才会写待同步队列
      _mirror.started = true;
      _mirror.peerOrigin = peerOrigin;
      this._mirrorSetStatus("connecting");
      this._mirrorCreateFrame();
    },
    /* 解析本页的对端 origin：从后端配置里取，挑出「不是我」的那一条。
       任何一步不成立都返回空串（镜像静默关闭），这包括开关没开、只配了一条、
       以及当前 origin 不在配置里（开发者用 localhost 打开、或访问地址与配置不符）。 */
    async _mirrorResolvePeer() {
      let cfg = null;
      try {
        const res = await fetch(MIRROR_CONFIG_URL, { headers: this.authHeaders() });
        if (!res.ok) return "";
        cfg = await res.json();
      } catch (e) {
        return "";
      }
      const mirror = cfg && cfg.mirror;
      if (!mirror || !mirror.enabled || !Array.isArray(mirror.origins)) return "";
      const self = String(location.origin || "").toLowerCase();
      const all = mirror.origins.map((o) => String(o || "").toLowerCase());
      if (all.indexOf(self) === -1) {
        // 当前访问地址不在配置的线路列表里（配置了 IP 却用域名访问，或反之）。
        // 这不算错误，但不说一声的话「镜像为什么没生效」就只能靠猜，留条线索。
        if (window.console && console.info) {
          console.info("[线路镜像] 当前地址 " + self + " 不在配置的线路列表里，镜像未启用");
        }
        return "";
      }
      const others = all.filter((o) => o && o !== self);
      // 恰好一条才继续：协议是「一对线路互为镜像」（共用一条队列、靠对端回执出队），
      // 多条对端需要改造成每个对端独立队列，后端也已在保存时拦截超过两条的配置
      return others.length === 1 ? others[0] : "";
    },
    _mirrorCreateFrame() {
      const peerOrigin = _mirror.peerOrigin;
      if (!peerOrigin) return;
      _mirror.attempts += 1;
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      // 用 visibility:hidden 而不是 display:none —— 后者是广告拦截器更偏爱的
      // 「隐藏框架」特征，容易被当成追踪 iframe 拦掉
      frame.style.cssText =
        "position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none";
      frame.src = peerOrigin + "/static/bridge.html";
      _mirror.peer = NbxMirrorPeer.create({
        post: (msg) => {
          const f = _mirror.iframe;
          if (!f || !f.contentWindow) throw new Error("mirror frame unavailable");
          f.contentWindow.postMessage(msg, peerOrigin);
        },
        // 省流/计量网络下不做首次全量（可能数 MB）；增量变更照常
        allowFullSync: () => {
          const c = navigator.connection;
          return !(c && c.saveData);
        },
        onApplied: () => {
          this._mirrorReload();
          this._mirrorApplyPrefs();
        },
      });
      _mirror.onMessage = (ev) => {
        if (!_mirror.iframe || ev.source !== _mirror.iframe.contentWindow) return;
        if (ev.origin !== peerOrigin) return;
        if (!_mirror.peer) return;
        const handled = _mirror.peer.handleMessage(ev.data, ev.origin);
        if (handled && ev.data && ev.data.t === "ready" && _mirror.status !== "on") {
          if (_mirror.loadTimer) { clearTimeout(_mirror.loadTimer); _mirror.loadTimer = null; }
          _mirror.attempts = 0;
          this._mirrorSetStatus("on");
        }
      };
      window.addEventListener("message", _mirror.onMessage);
      _mirror.loadTimer = setTimeout(() => this._mirrorFail(), MIRROR_LOAD_TIMEOUT);
      _mirror.iframe = frame;
      document.body.appendChild(frame);
    },
    /* 加载超时或桥接页始终没握手：退避一次后放弃。
       瞬时抖动（网络切换、对端重启）不该让整个会话都没有镜像，
       但也不该无限重试打扰用户 —— 最终失败时静默降级到手动导出/导入。 */
    _mirrorFail() {
      if (_mirror.status === "on") return;
      this._mirrorTeardown();
      if (_mirror.attempts < MIRROR_MAX_ATTEMPTS) {
        clearTimeout(_mirror.retryTimer);
        _mirror.retryTimer = setTimeout(() => {
          if (_mirror.status !== "on" && _mirror.peerOrigin) this._mirrorCreateFrame();
        }, MIRROR_RETRY_DELAY);
        return;
      }
      this._mirrorSetStatus("failed", "线路镜像未启用（跨线路请用下方「导出 / 导入」搬运）");
    },
    _mirrorTeardown() {
      if (_mirror.loadTimer) { clearTimeout(_mirror.loadTimer); _mirror.loadTimer = null; }
      if (_mirror.onMessage) {
        window.removeEventListener("message", _mirror.onMessage);
        _mirror.onMessage = null;
      }
      if (_mirror.iframe) {
        try { _mirror.iframe.remove(); } catch (e) { /* 忽略 */ }
        _mirror.iframe = null;
      }
      _mirror.peer = null;
    },

    /* ============ 小工具 ============ */
    /* 打击级别徽章：AA 智能指数按 AA_STRIKE_LEVELS 区间映射；未评级不渲染任何角标 */
    strikeBadgeText(aa) {
      const lv = aaLevelOf(aa);
      return lv ? lv.name : "";
    },
    strikeBadgeStyle(aa) {
      const lv = aaLevelOf(aa);
      return lv ? `color:${lv.color};border-color:${lv.color}66;background:${lv.color}1a` : "";
    },
    strikeTip(aa) {
      const lv = aaLevelOf(aa);
      if (!lv) return "";
      return `AA 智能指数 ${Number(aa)}（${aaRangeText(lv)}）· ${lv.name}${lv.alias ? `（${lv.alias}）` : ""} —— ${lv.gist}`;
    },
    strikeLevels() {
      return AA_STRIKE_LEVELS;
    },
    shortModel(id) {
      const m = this.models.find((x) => x.id === id);
      if (m && m.name && m.name !== m.id) return m.name;
      return (id || "").replace(/^openrouter\//, "") || "默认模型";
    },
    /* 模型简介只认手动换行：按 \n 切行、去首尾空行，最多取 2 行；
       每行各自单行省略（见 .ms-item-desc-line），不做自动换行 */
    modelDescLines(desc) {
      const lines = String(desc || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      return lines.slice(0, 2);
    },
    fmtTime(ts) {
      const d = new Date(ts);
      const diff = Date.now() - ts;
      if (diff < 60 * 1000) return "刚刚";
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前";
      const pad = (n) => String(n).padStart(2, "0");
      const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
      const today = new Date();
      if (d.toDateString() === today.toDateString()) return "今天 " + hm;
      return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
    },
    excerpt(s, n = 46) {
      const t = (s || "").replace(/\s+/g, " ").trim();
      return t.length > n ? t.slice(0, n) + "…" : t;
    },
    /* 等待/思考两阶段实时提示：等待 = 请求已发出但还没首个事件；思考 = 推理 chunk 已开始 */
    get liveWaitText() {
      if (!this.thinking) return "";
      return this.reasoning
        ? "思考中… " + fmtDuration(this.reasoningSec)
        : "等待模型响应… " + fmtDuration(this.thinkingSec);
    },
    get thinkingTimeText() {
      return fmtDuration(this.thinkingSec);
    },
    /* 推理盒统计行：token 数 + 计时 + 实时速度（tok/s），结束后保留最终值 */
    get reasoningStatText() {
      const parts = [fmtTokens(this.reasoningTokens) + " tok", fmtDuration(this.reasoningSec)];
      if (this.reasoningSpeed > 0) parts.push(this.reasoningSpeed.toFixed(1) + " tok/s");
      return parts.join(" · ");
    },
    /* 备用通道切换：文字进度 + 方格子示意（已失败标红、当前尝试的呼吸动画、未尝试的留空） */
    get fallbackText() {
      return this.formatFallbackText(this.fallbackInfo);
    },
    formatFallbackText(info) {
      if (!info) return "";
      const reason = info.reason === "timeout"
        ? "响应超时"
        : info.reason === "empty"
          ? "没有返回内容"
          : "暂时不可用";
      return `第 ${info.failed} 个通道${reason}，正在尝试第 ${info.current} 个（共 ${info.total} 个）`;
    },
    get fallbackDots() {
      return this.formatFallbackDots(this.fallbackInfo);
    },
    formatFallbackDots(info) {
      if (!info || !info.total) return [];
      const dots = [];
      for (let index = 1; index <= info.total; index += 1) {
        if (index < info.current) dots.push("failed");
        else if (index === info.current) dots.push("active");
        else dots.push("pending");
      }
      return dots;
    },
    get statusText() {
      switch (this.status) {
        case "connecting": return this.thinking ? this.liveWaitText : "正在连接模型…";
        case "streaming": return this.thinking ? this.liveWaitText : "生成中… " + this.elapsed + "s";
        case "done": return "已完成 · 用时 " + this.elapsed + "s";
        case "stopped": return "已手动停止";
        case "error": return "出错了";
        case "history": return "正在查看历史记录";
        default: return "就绪";
      }
    },
    get statusDotClass() {
      if (this.status === "connecting" || this.status === "streaming") return "status-dot live";
      if (this.status === "done" || this.status === "history") return "status-dot ok";
      if (this.status === "error") return "status-dot err";
      return "status-dot";
    },

    /* ============ 通用确认弹窗（替代浏览器原生 confirm） ============ */
    /* 返回 Promise<boolean>：确认 = true，取消 / Esc / 点遮罩 = false。
       单槽位——已有确认弹窗开着时，新请求直接按取消返回：异步化后双击、
       Ctrl+Enter 会重复进入守卫，原生 confirm 阻塞事件循环不存在这个问题 */
    askConfirm({ title = "请确认", message = "", confirmText = "确定", cancelText = "取消", danger = false } = {}) {
      return new Promise((resolve) => {
        if (this.confirmOpen) { resolve(false); return; }
        this.confirmTitle = title;
        this.confirmMessage = message;
        this.confirmText = confirmText;
        this.confirmCancelText = cancelText;
        this.confirmDanger = !!danger;
        this._confirmResolve = resolve;
        this.confirmOpen = true;
      });
    },
    resolveConfirm(value) {
      const resolve = this._confirmResolve;
      this._confirmResolve = null;
      this.confirmOpen = false;
      if (resolve) resolve(!!value);
    },

    /* 在途生成判定：切工具 / 回首页 / 看历史 / 新建题目的守卫必须一致。
       超标词的 AI 替换流不置 streaming，漏判会在 resetVocab 重建状态后
       让在途 token 继续写入新对象、污染历史数据 */
    get isBusy() {
      return this.streaming || this.ocrStreaming
        || (this.migration && this.migration.generating)
        || (this.vocab && this.vocab.replacing);
    },
    /* 确认弹窗期间状态可能已自行结束（如刚好生成完），这里逐个复检 */
    stopBusyStreams() {
      if (this.streaming) this.abortActiveGeneration();
      if (this.ocrStreaming) this.ocrCancel();
      if (this.migration && this.migration.generating) this.stopMigration();
      if (this.vocab && this.vocab.replacing) this.stopVocabReplace();
    },

    /* 轻提示。警告/错误默认停留更久（额度、限速、失败原因这类信息一闪而过，
       用户会完全不知道发生了什么），成功提示保持短促 */
    toast(msg, type = "ok", duration = 0) {
      const id = Date.now() + Math.random();
      const ms = duration || (type === "ok" ? 2400 : 6000);
      this.toasts.push({ id, msg, type });
      setTimeout(() => {
        const t = this.toasts.find((x) => x.id === id);
        if (t) t.out = true;
        setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== id); }, 300);
      }, ms);
    },

    icon,
  };
}
