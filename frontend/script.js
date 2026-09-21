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
  "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "lightbulb": '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  "route": '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',

  // —— UI 图标 ——
  "logo": '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>',
  "cloud": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  "menu": '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  "x": '<path d="M6 6l12 12M18 6 6 18"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevrons-left": '<path d="m18 7-5 5 5 5M11 7l-5 5 5 5"/>',
  "chevrons-right": '<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>',
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
  favorites: "nbx_favorites",
  ui: "nbx_ui",
  draft: "nbx_draft",
  model: "nbx_model",
  auth: "nbx_auth",
  code: "nbx_code",
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
const HISTORY_LIMIT = 100;
// 迁移收藏单条体积可观（内嵌全部卡片输出），同样需要上限防止 localStorage 溢出
const FAVORITES_LIMIT = 100;
// 推理过程展示上限：只让用户“看到正在思考”，不无限制堆内容。
// 主流程 / 词汇替换共用 3000 字，迁移单卡 2000 字，超出截头保尾；
// 推理另有 max-height + 内部滚动双保险，盒子本身高度恒定。
const REASONING_LIMIT = 3000;
const CARD_REASONING_LIMIT = 2000;
/* 续写指令约定的「其实已经写完」控制标记（见 prompts/继续生成.md）：模型只回这一行时，
   前端把它剥掉、保持记录原状态，并告诉用户内容已经完整——既不把标记拼进成品文档，
   也不误标成已完成。识别刻意放宽（大小写、@ 数量、空格/下划线/连字符、裸词都要认），
   实测模型对定界符的写法会漂移（试卷工具的 @@TAG@@ 就吃过这个亏），严格匹配必漏。 */
const CONTINUE_DONE_SRC = "[＠@]*\\s*CONTINUE[\\s_-]*DONE\\s*[＠@]*";

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
// 只有这两处两种素材都可能来，保留手动选择：识别图片文字（通用转文字工具本身）、自由对话
const OCR_MANUAL_MODE_TOOLS = ["25", "32"];
function ocrModeForTool(toolId) {
  return OCR_HANDWRITTEN_TOOLS.indexOf(String(toolId == null ? "" : toolId)) >= 0 ? "handwritten" : "printed";
}
function ocrModeCanChoose(toolId) {
  return OCR_MANUAL_MODE_TOOLS.indexOf(String(toolId == null ? "" : toolId)) >= 0;
}
function ocrModeMeta(mode) {
  return OCR_MODES[mode] || OCR_MODES.printed;
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
  "QTYPE", "GROUP", "NOTICE", "TOTAL", "PAPER", "STEM", "END_Q", "Q",
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
function nbxFpSummarize(components, uach) {
  // 精简设备摘要：优先用 ThumbmarkJS components，缺字段时用 navigator 兜底；
  // uach 为 userAgentData.getHighEntropyValues 结果（仅 Chromium），用于型号与系统版本
  try {
    const c = components || {};
    const u = uach || {};
    const plat = (c.system && (c.system.platform || c.system.os)) || c.platform
      || (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    const lang = (c.locales && (c.locales.language || c.locales[0])) || navigator.language || "";
    const w = (c.screen && (c.screen.width || c.screen.w)) || window.screen.width || "";
    const h = (c.screen && (c.screen.height || c.screen.h)) || window.screen.height || "";
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
    // GPU 渲染器（webgl 组件已采集，此前被丢弃）；纯哈希值没有可读性，跳过
    const wg = c.webgl && typeof c.webgl === "object" ? c.webgl : {};
    const gpu = String(wg.rendererUnmasked || wg.renderer || "").trim();
    if (gpu && !/^[0-9a-f]{16,}$/i.test(gpu)) data.gpu = gpu.slice(0, 160);
    data.touch = navigator.maxTouchPoints || 0;
    const mem = Number(navigator.deviceMemory || (c.device && c.device.deviceMemory) || 0);
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
  // UMD 可能比本脚本晚到，延迟重试；仍缺失则走 CDN 兜底（仍失败则保持降级）
  setTimeout(async () => {
    if (nbxFp.hash) return;
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

/* ---------------- 动态光影背景引擎 ---------------- */
function createBackground(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;

  let raf = null;
  let t = Math.random() * 100;
  const mouse = { x: innerWidth * 0.72, y: innerHeight * 0.3 };
  const halo = { x: mouse.x, y: mouse.y, tx: mouse.x, ty: mouse.y };
  let pulses = [];
  let sparks = [];
  let clouds = [];
  let birds = [];
  let meteor = null;
  let meteorGap = 360 + Math.random() * 540;

  const parse = (s) => (s || "0,0,0").split(",").map((n) => parseFloat(n) || 0);
  const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    return {
      g1: parse(cs.getPropertyValue("--c-glow-1")),
      g2: parse(cs.getPropertyValue("--c-glow-2")),
      gm: parse(cs.getPropertyValue("--c-glow-mouse")),
      p: parse(cs.getPropertyValue("--c-particle")),
      blend: cs.getPropertyValue("--c-glow-blend").trim() || "lighter",
      sky: parseFloat(cs.getPropertyValue("--c-sky")) || 0,
      rays: parseFloat(cs.getPropertyValue("--c-sky-rays")) || 0,
      stars: parseFloat(cs.getPropertyValue("--c-sky-stars")) || 0,
      birds: parseFloat(cs.getPropertyValue("--c-sky-birds")) || 0,
      bird: parse(cs.getPropertyValue("--c-sky-bird")),
      boost: parseFloat(cs.getPropertyValue("--c-glow-boost")) || 1,
    };
  }
  let cur = readTheme();
  let tgt = cur;

  function wanderer(speed) {
    return {
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      tx: Math.random() * innerWidth,
      ty: Math.random() * innerHeight,
      k: speed,
    };
  }
  const lights = [wanderer(0.0055), wanderer(0.0038), wanderer(0.0047)];
  function stepLights() {
    const W = innerWidth, H = innerHeight;
    for (const L of lights) {
      L.x += (L.tx - L.x) * L.k;
      L.y += (L.ty - L.y) * L.k;
      const dx = L.tx - L.x, dy = L.ty - L.y;
      if (dx * dx + dy * dy < 3600) {
        L.tx = W * (0.08 + Math.random() * 0.84);
        L.ty = H * (0.08 + Math.random() * 0.84);
      }
    }
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  function spawn() {
    // 悠空主题的云絮：大团块、缓慢水平漂移，会被鼠标拨开、被光晕照亮
    clouds = Array.from({ length: coarse ? 6 : 10 }, () => ({
      x: Math.random() * innerWidth,
      y: innerHeight * (0.06 + Math.random() * 0.62),
      s: 50 + Math.random() * 110,
      v: 0.1 + Math.random() * 0.22,
      a: 0.14 + Math.random() * 0.14,
      ox: 0, oy: 0,
    }));
    // 悠空·白昼的飞鸟：一小群（一大两小，大的离“镜头”近），斜向缓缓掠过天际
    birds = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random() * innerWidth,
      y: innerHeight * (0.1 + Math.random() * 0.32),
      s: i === 0 ? 28 + Math.random() * 5 : 17 + Math.random() * 4,
      vx: 0.35 + Math.random() * 0.25,
      vy: -(0.02 + Math.random() * 0.04),
      ph: i * 1.7 + Math.random(),
    }));
  }
  spawn();

  window.addEventListener("resize", () => { resize(); spawn(); });
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    halo.tx = e.clientX; halo.ty = e.clientY;
  }, { passive: true });
  /* 帧循环暂停：两个独立开关——页面隐藏（visibilitychange）与全屏讲解等
     遮没场景的程序性暂停（suspend/resume），互不覆盖；循环在任一开关置位后
     的下一跳自行退出，两个开关都清除后才重新拉起。 */
  let hiddenPause = false;
  let manualPause = false;

  function stopChain() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenPause = true; stopChain(); }
    else {
      hiddenPause = false;
      if (!raf && !manualPause && !reduced) loop();
    }
  });

  /* 光斑精灵缓存：稳态下同一颜色每帧重复出现（3 漫游光斑 + 鼠标双光晕 +
     10 云 × 5 团块 + 流星辉光 ≈ 55 次/帧），烘焙一次后统一 drawImage 贴图，
     省去每帧数十次 createRadialGradient + 6×addColorStop + 大面积渐变填充。
     颜色键与 rgba() 同样按通道取整；烘焙精灵的透明度衰减曲线
     (1 / .82 / .56 / .34 / .16 / 0) 与原渐变逐档一致，绘制时用 globalAlpha
     承载原 alpha —— 预乘合成下与逐帧建渐变的像素数学完全等价。
     主题过渡期颜色逐帧漂移、键不稳定：连续两帧出现同色才烘焙，
     过渡帧走原有直接建渐变路径，过渡观感与从前逐帧一致。 */
  const GLOW_SPRITE = 256;
  const GLOW_STOPS = [0, 0.2, 0.42, 0.64, 0.84, 1];
  const GLOW_DECAY = [1, 0.82, 0.56, 0.34, 0.16, 0];
  let frameNo = 0;
  const glowSeen = new Map();   // 颜色键 -> 首次出现帧号（只记一次，烘焙后即删）
  const glowCache = new Map();  // 颜色键 -> 烘焙好的精灵画布（稳态每主题 ≤ 6 张）

  function bakeGlowSprite(r0, g0, b0) {
    const c = document.createElement("canvas");
    c.width = c.height = GLOW_SPRITE;
    const g = c.getContext("2d");
    const half = GLOW_SPRITE / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    for (let i = 0; i < GLOW_STOPS.length; i++) {
      grad.addColorStop(GLOW_STOPS[i], `rgba(${r0},${g0},${b0},${GLOW_DECAY[i]})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
    return c;
  }

  function glowSpot(x, y, r, color, alpha) {
    const r0 = color[0] | 0, g0 = color[1] | 0, b0 = color[2] | 0;
    const key = r0 * 65536 + g0 * 256 + b0;
    const sprite = glowCache.get(key);
    if (sprite) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      return;
    }
    const seen = glowSeen.get(key);
    if (seen !== undefined && seen !== frameNo) {
      // 连续帧同色：烘焙精灵，此后该颜色永久走贴图
      const s = bakeGlowSprite(r0, g0, b0);
      glowCache.set(key, s);
      glowSeen.delete(key);
      ctx.globalAlpha = alpha;
      ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      return;
    }
    if (seen === undefined) {
      if (glowSeen.size > 2000) glowSeen.clear(); // 防御：长期切主题的键位堆积上限
      glowSeen.set(key, frameNo);
    }
    // 首见帧 / 过渡漂移帧：保持原路径（逐帧建渐变）
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    // 多段柔和衰减：减小相邻像素的色阶跳变，明显压制 radial-gradient 的色带
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.2, rgba(color, alpha * 0.82));
    g.addColorStop(0.42, rgba(color, alpha * 0.56));
    g.addColorStop(0.64, rgba(color, alpha * 0.34));
    g.addColorStop(0.84, rgba(color, alpha * 0.16));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* 悠空：一朵云 = 五个柔和团块的叠加 */
  const CLOUD_PUFFS = [[-0.9, 0.15, 0.55], [-0.35, -0.18, 0.7], [0.25, -0.3, 0.8], [0.85, 0.05, 0.6], [0, 0.24, 0.72]];
  function drawCloud(x, y, s, color, alpha) {
    for (const [ox, oy, or] of CLOUD_PUFFS) {
      glowSpot(x + ox * s, y + oy * s, s * or, color, alpha);
    }
  }

  /* 悠空·白昼：云隙光——角度缓缓摇摆、亮度呼吸脉动的阳光光束。
     光束的横向线性渐变只随 x 变化，按宽度烘焙 2px 高的横条后竖向拉伸绘制，
     逐列颜色与原逐帧建渐变完全一致（竖向无变化，拉伸不引入任何插值差异）。 */
  const beamCache = new Map();
  function beamStrip(w) {
    let s = beamCache.get(w);
    if (s) return s;
    const c = document.createElement("canvas");
    c.width = w; c.height = 2;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(255,246,222,0)");
    grad.addColorStop(0.5, "rgba(255,246,222,1)");
    grad.addColorStop(1, "rgba(255,246,222,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, 2);
    beamCache.set(w, c);
    return c;
  }
  function drawSunRays(W, H, strength, time) {
    const sway = Math.sin(time * 2.2) * 0.06;
    const pulse = 0.78 + 0.22 * Math.sin(time * 3.1);
    ctx.save();
    ctx.translate(W * 0.8, -H * 0.15);
    ctx.rotate(0.42 + sway);
    for (const [ox, w, a] of [[0, 150, 0.075], [220, 90, 0.05], [-200, 60, 0.032]]) {
      // 与原实现一致按 4 位小数取整 alpha，输入合成器的数值逐位相同
      ctx.globalAlpha = Number((a * strength * pulse).toFixed(4));
      ctx.drawImage(beamStrip(w), ox, 0, w, H * 1.9);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 悠空·白昼：一只飞鸟 = 实心剪影（前缘双弧 + 后缘围出翼面），翅膀上下扇动。
     翼面要有足够面积（后缘深压），尺寸、实心、深色都是为了隔着
     液态玻璃的 backdrop-filter 模糊后，看到的仍是一只“在扇翅膀的鸟”，
     而不是一团移动的黑点。 */
  function drawBird(b, color, alpha) {
    const f = Math.sin(b.ph);      // -1..1，翅膀上下扇动
    const s = b.s;
    const tipY = b.y - f * s * 0.62; // 翼尖高度随扇动摆动
    ctx.beginPath();
    // 前缘：左翼尖 → 身体 → 右翼尖（经典海鸥“M”形）
    ctx.moveTo(b.x - s, tipY);
    ctx.quadraticCurveTo(b.x - s * 0.5, b.y + s * 0.02, b.x, b.y + s * 0.16);
    ctx.quadraticCurveTo(b.x + s * 0.5, b.y + s * 0.02, b.x + s, tipY);
    // 后缘：右翼尖 → 尾部 → 左翼尖（深压到 0.5s 以下，围出肥厚的实心翼面，向翼尖收窄）
    ctx.quadraticCurveTo(b.x + s * 0.38, b.y + s * 0.66, b.x, b.y + s * 0.52);
    ctx.quadraticCurveTo(b.x - s * 0.38, b.y + s * 0.66, b.x - s, tipY);
    ctx.closePath();
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
  }

  /* 悠空·星夜：不放常驻星星（隔着厚毛玻璃怎样都会糊脏），只留流星，
     且流星做得比真实的大得多、亮得多——三层叠光（外柔光带 + 中层晕 +
     暖白亮核）+ 头部大辉光，缓慢修长地划过，以美感为唯一目标。 */
  function drawMeteor(strength, time, animate) {
    if (!animate) return;
    // 流星：等待 → 划过 → 消散；出场有淡入，寿命长、速度慢，看得尽兴
    if (!meteor) {
      meteorGap -= 1;
      if (meteorGap <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        meteor = {
          x: innerWidth * (0.25 + Math.random() * 0.55),
          y: innerHeight * (0.04 + Math.random() * 0.18),
          vx: dir * (2.6 + Math.random() * 1.4),
          vy: 1.2 + Math.random() * 0.6,
          life: 1,
        };
        meteorGap = 300 + Math.random() * 420;
      }
      return;
    }
    meteor.x += meteor.vx;
    meteor.y += meteor.vy;
    meteor.life -= 0.005;
    if (meteor.life <= 0 || meteor.y > innerHeight * 0.78) { meteor = null; return; }
    const fadeIn = Math.min(1, (1 - meteor.life) / 0.1);
    const a = meteor.life * fadeIn * strength;
    const tail = 46 + 26 * meteor.life;
    const tx = meteor.x - meteor.vx * tail;
    const ty = meteor.y - meteor.vy * tail;
    const stroke = (w, c0, c1, la) => {
      const g = ctx.createLinearGradient(meteor.x, meteor.y, tx, ty);
      g.addColorStop(0, rgba(c0, la * a));
      g.addColorStop(0.35, rgba(c1, la * 0.45 * a));
      g.addColorStop(1, rgba(c1, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    };
    stroke(13, [178, 207, 252], [150, 185, 245], 0.16);   // 外层柔光带
    stroke(5.2, [214, 231, 254], [180, 208, 250], 0.42);  // 中层晕
    stroke(2.6, [255, 253, 246], [226, 237, 253], 0.97);  // 暖白亮核
    glowSpot(meteor.x, meteor.y, 46, [232, 241, 254], 0.55 * a); // 头部大辉光
    glowSpot(meteor.x, meteor.y, 16, [255, 252, 244], 0.8 * a);  // 头部亮芯
  }

  function frame(staticOnly) {
    frameNo += 1;
    const W = innerWidth, H = innerHeight;
    cur = {
      g1: lerp3(cur.g1, tgt.g1, 0.06), g2: lerp3(cur.g2, tgt.g2, 0.06),
      gm: lerp3(cur.gm, tgt.gm, 0.06), p: lerp3(cur.p, tgt.p, 0.06),
      blend: tgt.blend,
      sky: cur.sky + (tgt.sky - cur.sky) * 0.06,
      rays: cur.rays + (tgt.rays - cur.rays) * 0.06,
      stars: cur.stars + (tgt.stars - cur.stars) * 0.06,
      birds: cur.birds + (tgt.birds - cur.birds) * 0.06,
      bird: lerp3(cur.bird, tgt.bird, 0.06),
      boost: cur.boost + (tgt.boost - cur.boost) * 0.06,
    };
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = cur.blend === "lighter" ? "lighter" : "source-over";

    if (!staticOnly) stepLights();
    const m = Math.max(W, H);
    glowSpot(lights[0].x, lights[0].y, m * 0.5, cur.g1, 0.09 * cur.boost);
    glowSpot(lights[1].x, lights[1].y, m * 0.46, cur.g2, 0.085 * cur.boost);
    glowSpot(lights[2].x, lights[2].y, m * 0.38, cur.gm, 0.05 * cur.boost);

    if (!staticOnly) {
      halo.x += (halo.tx - halo.x) * 0.07;
      halo.y += (halo.ty - halo.y) * 0.07;
    }
    glowSpot(halo.x, halo.y, 380 + 60 * (cur.boost - 1), cur.gm, 0.12 * cur.boost);
    glowSpot(halo.x, halo.y, 150, cur.gm, 0.06 * cur.boost);

    for (let i = pulses.length - 1; i >= 0; i--) {
      const pu = pulses[i];
      pu.r += 2.4 + pu.r * 0.04;
      pu.a *= 0.94;
      if (pu.a < 0.01) { pulses.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(cur.gm, Math.min(0.95, pu.a * 0.65 * cur.boost));
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy;
      s.vx *= 0.965; s.vy *= 0.965;
      s.life -= 0.014;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.5 + s.life * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = rgba(cur.gm, Math.min(0.95, s.life * 0.75 * cur.boost));
      ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";

    /* 悠空：云隙光 + 云絮漂移（鼠标可拨开、光晕可照亮）+ 白昼飞鸟 */
    if (cur.sky > 0.02) {
      if (cur.rays > 0.02) drawSunRays(W, H, Math.min(cur.sky, cur.rays), t);
      if (cur.stars > 0.02) drawMeteor(cur.stars, t, !staticOnly);
      for (const c of clouds) {
        if (!staticOnly) {
          c.x += c.v;
          if (c.x - c.s * 2.4 > W) {
            c.x = -c.s * 2.4;
            c.y = H * (0.06 + Math.random() * 0.62);
          }
          if (!coarse) {
            // 鼠标像风一样把云轻轻推开
            const dx = c.x + c.ox - mouse.x, dy = c.y + c.oy - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 67600) {
              const d = Math.sqrt(d2) || 1;
              const f = (260 - d) / 260;
              c.ox += (dx / d) * f * 2.2;
              c.oy += (dy / d) * f * 2.2;
            }
            c.ox *= 0.94; c.oy *= 0.94;
          }
        }
        const depth = c.s / 110;
        const px = c.x + c.ox + (mouse.x - W * 0.5) * 0.03 * depth;
        const py = c.y + c.oy + (mouse.y - H * 0.5) * 0.014 * depth;
        // 云飘到光晕附近时被阳光照亮
        const hx = px - halo.x, hy = py - halo.y;
        const lit = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) / 320);
        drawCloud(px, py, c.s, cur.p, Math.min(0.55, c.a * cur.sky * (1 + lit * 0.7)));
      }
      if (cur.birds > 0.02) {
        for (const b of birds) {
          if (!staticOnly) {
            b.ph += 0.11;
            b.x += b.vx;
            b.y += b.vy;
            if (b.x - b.s * 2 > W || b.y < -20) {
              b.x = -b.s * 2;
              b.y = H * (0.12 + Math.random() * 0.3);
            }
          }
          drawBird(b, cur.bird, 0.55 * cur.birds);
        }
      }
    }

  }

  function loop() {
    if (hiddenPause || manualPause) { raf = null; return; }
    t += 0.0035;
    frame(false);
    raf = requestAnimationFrame(loop);
  }

  function suspend() {
    manualPause = true;
    stopChain();
  }
  function resume() {
    manualPause = false;
    if (!raf && !hiddenPause && !reduced && !document.hidden) loop();
  }

  if (reduced) { frame(true); }
  else { loop(); }

  return {
    /* 全屏讲解等遮没场景：canvas 被不透明面板完全盖住时暂停渲染 */
    suspend, resume,
    /* 点击反馈（涟漪 + 粒子）已交由 ba-click-fx 播放：见 click-fx.js 与
       vendor/ba-click-fx/。这里只保留光晕跟随，使程序化调用（初始默认工具、
       dev 预览）仍能把光晕引过去。pulses/sparks 数组与 frame() 里渲染它们的
       代码保留不动——空数组时循环零开销，将来要恢复原地涟漪把推入代码加回来即可。 */
    attract(x, y) {
      halo.tx = x; halo.ty = y;
    },
    themeChanged() { tgt = readTheme(); if (reduced) frame(true); },
  };
}

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
const HISTORY_INDEX_VERSION = 3;
// 索引里保留的输入摘要长度：够卡片在无标题时展示（模板用 excerpt 的默认 46 字）
const HISTORY_HEAD_CHARS = 60;
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

/* ---------------- Markdown 渲染 ---------------- */
function configureMarked() {
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
    // KaTeX 数学公式（$...$ / $$...$$）：
    // nonStandard 容忍 LLM 常见的 $ 与内容间不留空格的写法；
    // output:"html" 只输出 HTML（不含 MathML），保证能完整通过 DOMPurify
    if (window.markedKatex) {
      marked.use(markedKatex({ throwOnError: false, nonStandard: true, output: "html" }));
    }
  }
  if (window.DOMPurify) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
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

function finalizeRenderedHtml(html) {
  // 极少数未配对的加粗标记可能被 Markdown 解析器原样输出，避免它们漏到页面上。
  return String(html || "").replace(/\*{2,}/g, "");
}

function renderMd(raw) {
  if (!raw) return "";
  const normalized = normalizeMarkdown(raw);
  try {
    const parser = window.marked && typeof window.marked.parse === "function" ? window.marked : null;
    const html = parser ? parser.parse(normalized) : renderMdFallback(normalized);
    return finalizeRenderedHtml(window.DOMPurify ? DOMPurify.sanitize(html) : html);
  } catch {
    const html = renderMdFallback(raw);
    return finalizeRenderedHtml(window.DOMPurify ? DOMPurify.sanitize(html) : html);
  }
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

/* ---------------- Alpine 主应用 ---------------- */
function nbx() {
  return {
    /* --- 数据 --- */
    groups: [],
    models: [],
    // 模型下拉最大显示数（后台配置，0 = 不折叠）与本次展开状态
    maxVisibleModels: 0,
    modelsExpanded: false,
    toolsLoaded: false,
    toolsError: "",
    currentTool: null,
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
    reasoningOpen: true,
    reasoningDone: false,
    reasoningTruncated: false,
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
    ocrStage: "empty",          // empty | ready | streaming | done | error
    ocrText: "",
    ocrRendered: "",
    ocrError: "",
    ocrTruncated: false,
    ocrMediaCollapsed: false,
    ocrViewerOpen: false,
    ocrElapsedSec: 0,
    _ocrTimer: null,
    _ocrRenderTimer: null,
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
    // 旧格式迁移失败时置真：本次会话退回整份历史写入，不破坏尚未拆分的旧数据
    _historyLegacy: false,
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

    /* --- 内部 --- */
    _abortCtrl: null,
    // 生成代次：切换工具/新建题目会作废在途流，旧流的 finalize 据此不再回写状态
    _runSeq: 0,
    _timer: null,
    _thinkTimer: null,
    _startTs: 0,
    _renderPending: false,
    // 渲染脏标记：只有输出内容变化（新 token / 载入历史）才需要重新渲染，
    // 避免 finalize 定稿与在途节流 tick 对同一份全文做重复的全量重渲染
    _outputDirty: true,
    _nearBottom: true,
    _draftTimer: null,
    _bg: null,
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
      // @@Q@@ 独占一行、题号落在下一行时的等待标记（见下方逐行解析）
      let pendingQNo = false;
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
        if (currentQ === null) return;
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
        else if (cf === "STEM") currentQ.stem = content;
        else if (cf === "OPTIONS") {
          const opts = [];
          for (const l of content.split("\n")) {
            const line = l.trim();
            if (!line) continue;
            const m = line.match(/^([A-Ga-g])\s*[\.、:：\)）]?\s*(.*)$/);
            if (m) opts.push({label: m[1].toUpperCase(), text: m[2].trim()});
            else opts.push({label: "", text: line});
          }
          currentQ._raw_options = opts;
        } else if (cf === "ANSWER") currentQ._answer_raw = content.trim();
        else if (cf === "EVIDENCE") currentQ._evidence_raw = content.trim();
        else if (cf === "REASON") currentQ._reason_raw = content.trim();
        else if (cf === "DISTRACTOR") currentQ._distractor_raw = content.trim();
        else if (cf === "PITFALLS") {
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
          currentQ._pitfalls_raw = pits;
        } else if (cf === "PATTERN_NAME") currentQ._pattern_name_raw = content.trim();
        else if (cf === "PATTERN_STEPS") {
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
          // 已收下的迁移块 + 最后一块草稿：有 passage/stem/选项/答案才算有效迁移
          const drafts = (currentQ._transfers_raw || []).slice();
          if (currentQ._transfer_draft) drafts.push(currentQ._transfer_draft);
          transfers = drafts
            .filter((d) => d && (d.passage || d.stem || (d.options && d.options.length) || d.answer))
            .map((d) => ({
              passage: d.passage || "",
              stem: d.stem || "",
              options: d.options || [],
              answer: d.answer || "",
              explanation: d.explanation || "",
            }));
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
        currentGroup.questions.push(qObj);
        currentQ = null;
      };
      // 当前是否在往字段里收正文：@@PASSAGE_DEF@@ 可以出现在第一道题之前（此时还没有 currentQ）
      const collecting = () => currentField !== null && (currentQ !== null || currentField === "PASSAGE_DEF");
      // 逐行解析；一行内出现多个标签时逐段切分，前段文本归入当前字段
      for (let rawLine of lines) {
        let work = rawLine.replace(/\r$/, "");
        // 模型偶尔把题号写到 @@Q@@ 的下一行：这一行若是独立的 1-3 位数字就当题号收下，
        // 空行不算（跳过继续等），不是数字则放弃等待、交回正常流程
        if (pendingQNo && work.trim()) {
          pendingQNo = false;
          const bare = work.trim();
          if (/^\d{1,3}$/.test(bare) && currentQ) { currentQ.no = bare; continue; }
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
            // 相邻且表头三项完全相同的分组 = 同一板块被重复声明（续写时模型又把 @@GROUP@@ 头写了一遍），
            // 复用而不是新建；标题/导语不同的同 id 分组是合法拆分（完形可按叙事分 2-3 组），照旧新建。
            const prevGroup = groups[groups.length - 1];
            if (prevGroup && prevGroup.id === gid && prevGroup.title === title && prevGroup.intro === intro) {
              currentGroup = prevGroup;
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
            currentQ = {no: inlineNo || "?"};
            pendingQNo = !inlineNo;
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
            commitQuestion();
            currentField = null;
            fieldBuf = [];
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
      return {paper:{title:paperTitle, subject:"英语", year:""}, notice: notice, answerMap: answerMap, groups: groups, total: totalDeclared};
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
    normalizeVisualPaper(data) {
      if (!data || typeof data !== "object") return null;
      // 入参恒为本轮新建的解析结果（自定义解析 / JSON.parse 产物），从未被共享；
      // 原来的 JSON 深克隆每个渲染 tick 都要整树复制一次，纯属冗余，直接就地规范
      const out = data;
      if (!out.paper || typeof out.paper !== "object") out.paper = { title: "", subject: "英语", year: "" };
      out.paper.title = out.paper.title || "";
      out.paper.subject = out.paper.subject || "英语";
      out.paper.year = out.paper.year || "";
      out.notice = out.notice || "";
      out.answerMap = out.answerMap || {};
      out.groups = Array.isArray(out.groups) ? out.groups : [];
      out.total = out.total != null ? out.total : null;
      if (out.total == null) {
        const cnt = out.groups.reduce((s,g)=>s + (g.questions||[]).length, 0);
        out.total = cnt || null;
      }
      if (!out.answerMap || !Object.keys(out.answerMap).length) {
        const am = {};
        for (const g of out.groups) for (const q of g.questions) {
          if (q.answer) am[String(q.no)] = String(q.answer);
          else if (q.writingGuide) am[String(q.no)] = "见范文";
        }
        out.answerMap = am;
      }
      const trunc = (s,n)=> s.length>n ? s.slice(0,n)+"…" : s;
      for (const g of out.groups) {
        g.intro = trunc(String(g.intro||""), 200);
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
          if (typeof q.passage === "string") q.passage = trunc(q.passage, 4000);
          if (typeof q.stem === "string") q.stem = trunc(q.stem, 1000);
          if (q.reference) {
            for (const k of ["evidence","reason","distractor"]) if (typeof q.reference[k]==="string") q.reference[k]=trunc(q.reference[k],800);
          }
          for (const p of (q.pitfalls||[])) if (typeof p.desc==="string") p.desc=trunc(p.desc,500);
          if (q.pattern && Array.isArray(q.pattern.steps)) q.pattern.steps = q.pattern.steps.slice(0,5).map(s=>trunc(String(s),300));
          for (const tr of (q.transfers || [])) {
            // 每道迁移题各自补全字段 + 语篇截断（沿用原来的 800 字上限）
            tr.passage = typeof tr.passage === "string" ? tr.passage : "";
            tr.stem = typeof tr.stem === "string" ? tr.stem : "";
            tr.answer = typeof tr.answer === "string" ? tr.answer : "";
            tr.explanation = typeof tr.explanation === "string" ? tr.explanation : "";
            if (!Array.isArray(tr.options)) tr.options = [];
            tr.passage = trunc(tr.passage, 800);
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
      for (let i = 0; i < this.visualPaper.currentGroupIdx; i++) {
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
    get vpRemaining() {
      return Math.max(0, (this.vpTotal || 0) - this.vpQuestionCount);
    },
    /* 整卷是否已确认写完——「继续生成」入口与「已完成」字样都以此为准。
       三条同时成立才算：声明总题数有效、实际题数不少于它、上一轮是自然收尾。
       缺任何一条都按「没写完」处理：没有 @@TOTAL@@ 时 vpTotal 会退化成已生成题数，
       「剩余 0」就只是个恒真式；停止/报错/断流时总数可能是被截断的数字前缀、
       模型也可能自己数错，卡死补全入口比多花一次生成更糟。 */
    get vpComplete() {
      if (this.streaming) return false;
      const declared = Number(this.visualPaper && this.visualPaper.total);
      if (!Number.isFinite(declared) || declared <= 0) return false;
      if (this.vpQuestionCount < declared) return false;
      return this.vpRunState === "done";
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
      for (let i = this.visualPaper.currentGroupIdx - 1; i >= 0; i--) {
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
      this.visualPaper.currentGroupIdx = gIdx;
      this.visualPaper.currentQIdx = qIdx;
      this.vpActiveTab = "reference";
      this.vpEditBeforeLeave();
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
      this.vpEditBeforeLeave();
      this.$nextTick(() => {
        const el = this.$refs.vpRightPane;
        if (el) el.scrollTop = 0;
        this.vpMountAll();
      });
    },
    vpPrevQuestion() {
      if (!this.visualPaper || !this.vpCurrentGroup) return;
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
      this.vpEditBeforeLeave();
      this.$nextTick(() => {
        const el = this.$refs.vpRightPane;
        if (el) el.scrollTop = 0;
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
            this.scheduleRender();
          },
        });
        this.vocab.status = state === "stopped" ? "stopped" : "done";
        if (state === "stopped") {
          this.toast("已停止生成", "warn");
        } else if (this.vocab.output.trim()) {
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
            partial: false,
            createdAt: Date.now(),
          };
          this._unshiftHistory(item);
          this.generateTitle(item);
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
        // 同 finalize：只在正文从未开始时收一次
        if (this.vocab.reasoning && !this.vocab.reasoningDone) {
          this.vocab.reasoningDone = true;
          this.vocab.reasoningOpen = false;
        }
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

      // 悠空 · 两时段天空：每分钟校准一次，回到前台时立即校准
      this._skyTimer = setInterval(() => this.updateSkyPeriod(), 60000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          this.updateSkyPeriod();
          // 本页开着但没被看着时，对端推来的偏好只落在 nbx_prefs 上，页面收不到通知；
          // 回到前台对账一次。LWW 保证本页更晚的选择不会被对端旧值顶掉。
          this._mirrorApplyPrefs();
        }
      });

      // 动态光影背景
      this._bg = createBackground(document.getElementById("bgfx"));

      // 本地数据（历史为索引 + 分条正文，旧格式在此一次性拆分）
      this.history = this._loadHistory();
      this.favorites = lsGet(LS.favorites, []);
      this.input = localStorage.getItem(LS.draft) || "";

      const ui = lsGet(LS.ui, {});
      this.collapsedGroups = ui.collapsedGroups || {};
      this.rightCollapsed = !!ui.rightCollapsed;
      this.rightTab = ui.rightTab === "fav" ? "fav" : "history";
      this.vpChromePinned = !!ui.vpChromePinned;
      this.mascotHidden = !!ui.mascotHidden;
      // 点击特效的用户开关由 click-fx.js 自己落盘（nbx_fx_off），这里只读不写
      try { this.fxOn = localStorage.getItem("nbx_fx_off") !== "1" && !!window.NbxClickFx; } catch { this.fxOn = !!window.NbxClickFx; }

      // 全屏讲解：用户在浏览器层按 Esc 退出全屏时，同步关闭讲解模式
      document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && this.vpFullscreen) this.vpCloseFullscreen();
      });

      // 恢复认证
      this.loadAuth();

      await this.loadTools();
      this.loadParseConfig();
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
      this.auth.token = token;
      this.auth.user = user;
      this.isAuthenticated = !!token && !!user;
      this.authUser = user;
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
      const api = window.NbxClickFx;
      if (!api) { this.fxOn = !this.fxOn; return; }
      if (this.fxOn) api.enable(); else api.disable();
    },
    applyMascotSetting() {
      if (this.mascotHidden) this.retreatMascot(); else this.reconcileMascot();
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
        this.groups = data.groups || [];
        // models 为结构化列表：[{ id, name, description, score, is_free, free_no_code }]
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
      } catch (e) {
        this.toolsError = "工具列表加载失败，请确认后端服务已启动。";
        this.toolsLoaded = false;
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
      const el = ev && ev.currentTarget ? ev.currentTarget : null;
      if (el && this._bg) {
        const r = el.getBoundingClientRect();
        this._bg.attract(r.left + r.width * 0.5, r.top + r.height * 0.5);
      }
      this.$nextTick(() => {
        this.autoGrow();
        this.scheduleMascotCheck(80);
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
      this.currentTool = null;
      this.leftOpen = false;
      this.activeHistoryId = null;
      this.resetReasoning();
      this.resetOcr();
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
    },
    closeModelMenu() {
      this.modelMenuOpen = false;
      this.modelsExpanded = false;
    },

    /* ============ UI 持久化 ============ */
    persistUI() {
      lsSet(LS.ui, {
        collapsedGroups: this.collapsedGroups,
        rightCollapsed: this.rightCollapsed,
        rightTab: this.rightTab,
        vpChromePinned: this.vpChromePinned,
        mascotHidden: this.mascotHidden,
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
        this._animateDock(this.$refs.dockComposer, !this.inputCollapsed && !this.streaming);
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
      if (file) this.readFileContent(file);
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
              this.openUploadError("文件上传失败", "解析组件未加载，请检查网络后刷新页面重试。", this._uploadErrDetail(file, msg || "解析组件缺失"));
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
        throw new Error("mammoth.js 未加载，请检查网络后刷新页面");
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
    get touchPrimary() {
      // 主输入设备是触摸 = 手机/平板：桌面端（含带触摸屏的笔记本用鼠标时）不走系统相机
      return matchMedia("(pointer: coarse)").matches;
    },
    get uploadHostLabel() {
      return this.isOcrTool ? "" : "图片会先做文字识别，结果放进输入框";
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
    /* 已有原稿：直接唤起系统文件选择（文档照旧走解析，图片转识别） */
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
      if (file) this.readFileContent(file);
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
      this.ocrMediaCollapsed = false;
      this.ocrViewerOpen = false;
      this.ocrModalOpen = false;
      this._ocrMediaTouched = false;
      this.ocrHost = this.isOcrTool ? "tool" : "modal";
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
      // 图片就位后停在「开始识别」这一步：真要送出去识别得由用户按下按钮，不替他顺手按下
      this.enterOcrStartStep();
    },
    /* 进入「确认类型 / 开始识别」这步：已有结果先留着（可复制），按下开始识别才覆盖 */
    enterOcrStartStep() {
      if (this.ocrStreaming) return;
      if (!this.ocrHasImage) return;
      this.ocrError = "";
      this.ocrStage = "ready";
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
    },
    selectOcrImage(i) {
      this.ocrIndex = Math.max(0, Math.min(i, this.ocrImages.length - 1));
    },
    /* 批次变了（删/排序/追加）就得重新拍板：停掉在跑的识别，回到「开始识别」这步，
       但已有文本先留着（可复制），按下开始识别才覆盖 */
    _afterBatchChanged() {
      if (this.ocrStreaming) this.ocrCancel();
      if (!this.ocrImages.length && !this.ocrPairToken) {
        this.ocrStage = "empty";
        this.ocrText = "";
        this.ocrRendered = "";
        this.ocrError = "";
        return;
      }
      if (this.ocrStage === "done" || this.ocrStage === "error" || this.ocrStage === "streaming") {
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
    async ocrStart() {
      if (this.ocrStreaming) return;
      // 使用码是识别的硬前提：先问码，再谈有没有图
      if (!this.requireCodeForOcr(OCR_CODE_HINT)) return;
      if (!this.ocrHasImage) {
        this.toast("请先选择图片", "warn");
        return;
      }
      this.retreatMascot();
      if (this.ocrHost === "modal") this.ocrModalOpen = true;
      // 手机上默认把图片收成一条：窄屏里图片占满上半屏会把正文挤没
      if (!this._ocrMediaTouched) {
        this.ocrMediaCollapsed = !matchMedia("(min-width: 1024px)").matches;
        this._ocrMediaTouched = true;
      }
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
        await this.consumeSSE(res, (event, data) => {
          if (event === "token") {
            let text = data;
            try { text = JSON.parse(data); } catch { /* 兼容旧式未编码 token */ }
            this.ocrText += text || "";
            this.scheduleOcrRender();
          } else if (event === "truncated") {
            this.ocrTruncated = true;
          } else if (event === "error") {
            let msg = "识别失败，请稍后重试";
            try { msg = JSON.parse(data).message || msg; } catch { /* 保留默认文案 */ }
            throw new Error(msg);
          }
        });
        this.ocrStage = "done";
        this.flushOcrRender();
        if (this.ocrTruncated) {
          this.toast("结果可能不完整：可减少一次识别的张数，或请管理员调大 OCR 输出上限", "warn");
        }
      } catch (e) {
        if (e && e.name === "AbortError") {
          // 用户主动取消：已出的内容留着，按完成态展示
          this.flushOcrRender();
          this.ocrStage = this.ocrText ? "done" : "ready";
          return;
        }
        if (e && (e.status === 401 || e.status === 403)) {
          this.handleAuthFailure(e.message || "请先输入使用码");
        }
        this.ocrError = describeError(e, "识别失败，请稍后重试");
        this.flushOcrRender();
        this.ocrStage = "error";
      } finally {
        this._stopOcrTimer();
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
    scheduleOcrRender() {
      // 与结果区同样按内容长度节流：长文流式渲染太密会拖慢主线程
      if (this._ocrRenderTimer) return;
      this._ocrRenderTimer = setTimeout(() => {
        this._ocrRenderTimer = null;
        this.ocrRendered = renderMd(this.ocrText);
      }, streamRenderDelay(this.ocrText.length, 60));
    },
    /* 收尾时立刻渲染一次：节流定时器会被 _stopOcrTimer 清掉，
       不清这一步的话最后一段（往往就是全部内容）永远上不了屏 */
    flushOcrRender() {
      if (this._ocrRenderTimer) {
        clearTimeout(this._ocrRenderTimer);
        this._ocrRenderTimer = null;
      }
      this.ocrRendered = renderMd(this.ocrText);
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
      if (this._ocrRenderTimer) {
        clearTimeout(this._ocrRenderTimer);
        this._ocrRenderTimer = null;
      }
    },
    ocrCancel() {
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
        if (item && this.migrationHasOutput) this.generateTitle(item);
        if (!partial) this.verifyAuth();
        if (partial) this.toast("部分迁移卡片未完成，请检查后重试", "warn");
        else this.toast(`已完成 ${state.results.length} 张迁移卡片`);
      } catch (e) {
        state.generating = false;
        state.analysisError = describeError(e, "生成失败");
        this.toast(state.analysisError, "error");
      } finally {
        state.prechecking = false;
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
            // 收尾：取消挂起的节流渲染，直接渲染最终全文
            if (card._renderTimer) { clearTimeout(card._renderTimer); card._renderTimer = null; }
            card._renderPending = false;
            card.rendered = renderMd(card.output);
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
        card.streaming = false;
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
      lsSet(LS.favorites, this.favorites);
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
      return this._unshiftHistory({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolId: this.currentTool.id,
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        createdAt: Date.now(),
        ...fields,
      });
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
    async _runStream({ toolId, inputText, updateId = null, continueFrom = null, newVersion = false, transferCount, onToken, finalize, nearBottom = true }) {
      // 通用路径（新一轮/继续生成/重试）都跑当前工具，只有解卷会显式传 "13"；
      // 这里统一兜底，避免某个入口漏传导致请求的 tool_id 为空
      const tid = toolId || (this.currentTool && this.currentTool.id) || "";
      this.retreatMascot();
      this.activeHistoryId = updateId;
      this._streamBaselineLen = continueFrom ? this.output.length : 0;
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
          continueFrom,
          onReasoning: (text) => { if (seq === this._runSeq) this.appendReasoning(text); },
          onFallback: (info) => { if (seq === this._runSeq) this.updateFallback(info); },
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
        if (seq !== this._runSeq) return true;
        if (e && e.name === "AbortError") {
          finish("stopped", undefined, { ...ctx0, seq });
        } else {
          // 登录/额度类错误模型根本没执行，不标记；后端 error 事件回传的实际模型优先，快照兜底
          if (!(e && e.authIssue)) this.failedModel = (e && e.model) || modelUsed;
          this.errorRetryable = !(e && e.authIssue);
          this.errorLimited = !!(e && e.limited);
          finish("error", describeError(e, "生成失败，请稍后重试"), { ...ctx0, seq });
        }
      }
      return true;
    },

    /* 通用 SSE 流式调用：返回 { state: "done" | "stopped" }，出错时抛出 Error */
    async _streamChat({ toolId, input, requestId, transferCount, continueFrom, onToken, onReasoning, onFallback }) {
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
          // 续写：残文回传后端当上一条 assistant 消息，后端在末尾追加续写指令
          continue_from: continueFrom || undefined,
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
        if (data === "[CANCELLED]") { stopped = true; sawTerminal = true; return; }
        if (ev === "fallback") {
          // 备用通道切换：{failed_index, total, next_index, reason}，只用于展示进度
          let info = null;
          try { info = JSON.parse(data); } catch {}
          if (info && onFallback) onFallback(info);
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
      // 那等于悄悄做了另一件事（比如新建一条记录），比不响应更糟
      if (this.isMigrationTool || this.isVocabTool || this.isVisualPaperTool) return;
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
      this.stopTimer();
      this.stopThinkTimer();
      // 推理盒定稿：正文从未开始过（还没自动收起过）才收一次，
      // 否则会把流式期间用户手动展开的盒子在收尾时又打回去。
      if (this.reasoning && !this.reasoningDone) {
        this.reasoningDone = true;
        this.reasoningOpen = false;
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
            this.generateTitle(item);
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
    async _runVisualStream(inputText, updateId) {
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
      // 解卷的续写指令由前端按解析结构拼（见 vpContinueBrief）：走简报而不是回传正文，
      // 所以这里不传 continueFrom，后端对该工具的路径与从前完全一致
      return this._runStream({
        toolId: "13",
        inputText,
        updateId,
        transferCount,
        nearBottom: false,
        onToken: () => {
          if (this.visualPaper) this.visualPaper.rawJson = this.output;
          this.vpScheduleRender();
        },
        finalize: (state, errMsg, ctx) =>
          this.finalizeVisualPaper(state, errMsg, ctx.updateId ? { updateId: ctx.updateId } : {}, ctx.seq),
      });
    },
    finalizeVisualPaper(state, errMsg, opts = {}, seq) {
      // 代次不符 = 这次流已被切换工具/新建题目作废，收尾交给新流程
      if (seq !== undefined && seq !== this._runSeq) return;
      this.streaming = false;
      // 收尾方式决定「继续生成」入口是否保留，必须先于渲染落定
      this.vpRunState = state;
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
          origin.model = this.failedModel || this.selectedModel;
          origin.createdAt = Date.now();
          this._persistHistoryItem(origin);
          // 重试走的是 resetVisualPaper 之后的新快照，historyId 已经被清掉，
          // 这里必须把指针接回原记录，否则下一次「继续生成」又会新建一条
          if (this.visualPaper) this.visualPaper.historyId = origin.id;
        } else {
          const created = this.pushFailedHistory(this.errorMsg, hasPaper ? { visualPaper: JSON.parse(JSON.stringify(this.visualPaper)) } : {});
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
            item.model = this.selectedModel;
            if (this.visualPaper && (this.visualPaper.groups?.length || this.visualPaper.total)) {
              item.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
            }
            this._persistHistoryItem(item);
            // 同错误分支：重试/续写后要把卷子的记录指针接回这一条
            if (this.visualPaper) this.visualPaper.historyId = item.id;
            // 失败记录从来没生成过标题，续写成功后补一条
            if (!item.title) this.generateTitle(item);
          } else {
            item = this.pushHistory(unfinished);
            // 为可视化历史附加结构化数据，便于回放（0 完整题也保存 total/paper，中断可续）
            if (this.visualPaper && (this.visualPaper.groups?.length || this.visualPaper.total || (this.visualPaper.paper && this.visualPaper.paper.title))) {
              item.visualPaper = JSON.parse(JSON.stringify(this.visualPaper));
              // 同步到 history 存储
              this._persistHistoryItem(item);
            }
            if (this.visualPaper) this.visualPaper.historyId = item.id;
            this.generateTitle(item);
          }
        }
        if (state === "stopped") this.toast("已停止生成", "warn");
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
      if (!lastQ) {
        lines.push(`进度：全卷 ${total} 题，还没有题目完成。请从试卷的第一道笔试题开始，按原文顺序输出全部 ${total} 题。`);
        lines.push("板块写法：每进入一个板块时输出一行 `@@GROUP@@ id|title|intro`，该板块的题跟在它后面。");
      } else {
        lines.push(`进度：全卷 ${total} 题，已完成 ${count} 题（题号 ${nosList.join(",")}），最后一题是${lastLabel}，属于板块 ${label}。`);
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
      // 尾巴上的未完成片段（半道题、半句语篇、被截断的 @@GROUP@@ 头）在续写前整段丢掉：
      // 它们既没进结构也没显示过，留着只会让重解析在同一个位置反复走死路
      const cut = this.vpLastCompleteEnd(this.output);
      if (cut > 0) {
        this.output = this.output.slice(0, cut);
        this._outputDirty = true;
      }
      if (this.output && !this.output.endsWith("\n")) this.output += "\n";
      const contInput = this.submittedInput + "\n\n" + this.vpContinueBrief();
      const baseLen = this.output.length;
      await this._runVisualStream(contInput, keepId);
      // 若续写未新增任何内容（模型未按指令），提示
      if (this.output.length === baseLen) this.toast("续写未返回新题目，请重试", "warn");
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
      if (vp.answerMap && Object.keys(vp.answerMap).length) {
        md += `## 答案速查表\n\n`;
        md += `| 题号 | 答案 |\n|---|---|\n`;
        for (const [k, v] of Object.entries(vp.answerMap)) md += `| ${k} | ${v} |\n`;
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
      this.vpSyncCount(el);
    },
    vpOnEditInput(el) {
      const path = el.dataset.vpPath;
      if (!path) return;
      el.dataset.vpEdited = "1";
      this.vpSetField(path, vpDomToMd(el));
      this.vpSyncCount(el);
    },
    vpSyncCount(el) {
      const max = Number(el.dataset.vpMax || 0);
      const box = el.parentElement ? el.parentElement.querySelector(".vp-edit-count") : null;
      if (!box) return;
      if (!max) { box.hidden = true; return; }
      const len = String(this.vpFieldGet(el.dataset.vpPath) || "").length;
      box.hidden = len < max * 0.9;
      box.textContent = `${len} / ${max}`;
      box.classList.toggle("over", len > max);
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
        const ans = String(this.vpFieldGet(ansPath) || "").trim().toUpperCase();
        const removed = String((arr[idx] && arr[idx].label) || "").trim().toUpperCase();
        // 删掉的正是正确项时先拦一下：否则答案会变成一个不存在的字母
        if (ans && removed && ans === removed) {
          this.toast(`第 ${removed} 项是当前答案，先改答案再删它`, "warn");
          return;
        }
        arr.splice(idx, 1);
        arr.forEach((o, i) => { if (o && typeof o === "object") o.label = String.fromCharCode(65 + i); });
        const oldIdx = ans ? ans.charCodeAt(0) - 65 : -1;
        if (oldIdx > idx && oldIdx <= arr.length) this.vpSetField(ansPath, String.fromCharCode(64 + oldIdx));
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
      this._vpPersistEdits();
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
    /* 超出上限的字段：重解析会按 normalizeVisualPaper 截断，这里先收集好明确告知老师 */
    vpEditOverLimit() {
      const out = [];
      const check = (label, val, max) => { if (typeof val === "string" && val.length > max) out.push(label); };
      for (const g of this.vpGroups) {
        check("大题导语", g.intro, 200);
        for (const q of (g.questions || [])) {
          check(`第 ${q.no} 题语篇`, q.passage, 4000);
          check(`第 ${q.no} 题题干`, q.stem, 1000);
          if (q.reference) {
            check("参考答案·证据", q.reference.evidence, 800);
            check("参考答案·推理", q.reference.reason, 800);
            check("参考答案·干扰项", q.reference.distractor, 800);
          }
          for (const p of (q.pitfalls || [])) check("易错点描述", p.desc, 500);
          for (const s of ((q.pattern && q.pattern.steps) || [])) check("考点范式步骤", s, 300);
          (q.transfers || []).forEach((tr, ti) => {
            if (tr) check(`第 ${q.no} 题·迁移${ti + 1} 语篇`, tr.passage, 800);
          });
        }
      }
      return [...new Set(out)];
    },
    /* 结构 → @@TAG@@ 契约文本（与 parseCustomVisualPaper 的口径严格对应：
       QTYPE 值必须同行、每题必须 @@END_Q@@ 收题、易错点用 :: 分隔、组信息用 | 分隔、
       语篇用 @@PASSAGE_DEF@@/@@PASSAGE_REF@@ 编号复用，同一篇只写一份正文） */
    vpSerializeRaw() {
      const vp = this.visualPaper || {};
      const paper = vp.paper || {};
      // 字段内容里的 @@标签@@ 形状会被解析器当标签，插一个零宽空格打断（肉眼无差别）
      const guard = (s) => String(s == null ? "" : s).replace(/[＠@]{2,}/g, (m) => m[0] + "\u200b" + m.slice(1));
      const flat = (s) => guard(String(s == null ? "" : s).replace(/\r?\n/g, " ")).trim();
      const block = (s) => guard(String(s == null ? "" : s));
      const out = [];
      const total = Number(vp.total) > 0 ? Number(vp.total) : this.vpQuestionCount;
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
        if (!trimmed) { out.push("@@PASSAGE_REF@@ -"); return; }
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
            const desc = flat(p.desc).replace(/::/g, "：");
            out.push(desc ? `${title}::${desc}` : title);
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
      return `${out.join("\n")}\n`;
    },
    /* 退出修改模式：先序列化写回原始文本，再重解析对账（答案速查表/题量随之更新） */
    vpCommitEdits() {
      if (!this.visualPaper || !this.visualPaper.groups || !this.visualPaper.groups.length) return;
      const before = this.vpQuestionCount;
      const over = this.vpEditOverLimit();
      // 极端兜底用的结构快照：万一序列化出的文本解析不出题目，宁可回滚也不丢老师的内容
      const backup = JSON.parse(JSON.stringify({
        paper: this.visualPaper.paper, groups: this.visualPaper.groups,
        answerMap: this.visualPaper.answerMap, notice: this.visualPaper.notice, total: this.visualPaper.total,
      }));
      const raw = this.vpSerializeRaw();
      this.output = raw;
      this.visualPaper.rawJson = raw;
      this._outputDirty = true;
      this.vpDoRender();
      this._outputDirty = false;
      if (before > 0 && this.vpQuestionCount === 0) {
        // 校验未通过：回滚界面结构，且不写入历史（历史保持上一版，至少不会更差）
        this.visualPaper.paper = backup.paper;
        this.visualPaper.groups = backup.groups;
        this.visualPaper.answerMap = backup.answerMap;
        this.visualPaper.notice = backup.notice;
        this.visualPaper.total = backup.total;
        this.toast("保存校验未通过，这次修改没有写入历史记录；请检查内容后重试", "error");
        return;
      }
      this._vpPersistEdits();
      if (this.vpQuestionCount !== before) this.toast(`保存提示：题数由 ${before} 变成 ${this.vpQuestionCount}`, "warn");
      else if (over.length) this.toast(`有内容超出长度上限，已截断：${over.join("、")}`, "warn");
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
      this.reasoningOpen = true;
      this.reasoningDone = false;
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
      this.scrollReasoning();
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
    },
    /* --- 渲染（节流） --- */
    scheduleRender() {
      if (this._renderPending) return;
      this._renderPending = true;
      setTimeout(() => {
        this._renderPending = false;
        this.doRender();
      }, streamRenderDelay(this.output.length));
    },
    /* 迁移卡片的按卡片节流渲染（多卡并行时开销随累计长度二次增长，必须合并） */
    scheduleCardRender(card) {
      card._renderPending = true;
      if (card._renderTimer) return;
      card._renderTimer = setTimeout(() => {
        card._renderTimer = null;
        if (card._renderPending) card.rendered = renderMd(card.output);
        card._renderPending = false;
      }, streamRenderDelay((card.output || "").length));
    },
    doRender() {
      // 输出未变化（如定稿与在途节流 tick 重叠）时跳过整份重渲染
      if (!this._outputDirty) return;
      this._outputDirty = false;
      const main = this._foldedForRender(this.output, this.outputFoldEligible);
      this.outputFolded = main.folded;
      this.outputFoldTotal = main.total;
      this.rendered = renderMd(main.text);
      if (this.vocab) {
        const v = this._foldedForRender(this.vocab.output || "", this.vocab.foldEligible);
        this.vocab.folded = v.folded;
        this.vocab.foldTotal = v.total;
        this.vocab.rendered = renderMd(v.text);
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

    exportWord() {
      if (!window.htmlDocx) {
        this.toast("导出组件未加载，请检查网络后刷新", "error");
        return;
      }
      const fullHtml = this.buildExportHtml(this.exportFontSize);
      const converted = htmlDocx.asBlob(fullHtml, {
        orientation: "portrait",
        margins: { top: 720, right: 720, bottom: 720, left: 720 },
      });
      this.downloadBlob(converted, this.exportFilename("docx"));
      this.toast("Word 文档已开始下载");
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
        ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css">'
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
    printVisualPaper() {
      if (!this.vpHasData) {
        this.toast("暂无可打印的讲解内容", "error");
        return;
      }
      if (!window.VPPrint) {
        this.toast("打印组件未加载，请检查网络后刷新", "error");
        return;
      }
      this.closeExportMenu();
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
        answerMap: vp.answerMap || {},
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
      // JSON 里的 < 全部转义：内容中若出现 </script> 会提前闭合数据块
      const data = JSON.stringify(payload).replace(/</g, "\\u003c");
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
        if (write()) return true;
      }
      return write();
    },
    _historyIndexPayload() {
      // 迁移失败的会话退回整份数组（含正文），与拆分前的行为一致
      return JSON.stringify(this._historyLegacy ? this.history : this.history.map(historyIndexOf));
    },
    _persistHistoryIndex(keepId = "") {
      return this._evictOldestUntil(() => lsWrite(LS.history, this._historyIndexPayload()), keepId);
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
        if (dropped) lsRemove(HISTORY_BODY_PREFIX + dropped.id);
      }
      this._persistHistoryItem(item);
      return item;
    },
    pushHistory(partial) {
      return this._unshiftHistory({
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolId: this.currentTool.id,
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        input: this.submittedInput || this.input.trim(),
        fileName: this.submittedFileName || "",
        output: this.output,
        model: this.selectedModel,
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

    async generateTitle(item) {
      if (!item || !item.input || !this.isAuthenticated) return;
      try {
        const res = await fetch("/api/chat/title", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            tool_id: item.toolId,
            input: item.input.slice(0, 1200),
            output: item.output.slice(0, 1200),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.title) {
          item.title = data.title;
          // 标题只存在索引里，写索引即可（迁移失败的会话内部仍写整份数组）
          // 标题也是一次真实改动，刷新时间戳，否则镜像合并时会被对端的旧版本盖掉
          item.updatedAt = Date.now();
          this._persistHistoryIndex(item.id);
          this._mirrorChanged("h", item.id, false, item.updatedAt);
        }
      } catch {
        // 标题生成失败静默处理
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
      if (item.migration || item.hasMigration) {
        this.openMigrationHistory(item);
        return;
      }
      if (item.visualPaper || item.hasPaper || item.toolId === "13") {
        this.openVisualPaperHistory(item);
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
    removeHistory(id) {
      this.history = this.history.filter((h) => h.id !== id);
      // 删掉的正是屏幕上这条结果对应的记录：续写/重试改为收尾时新建，别再指向已删的 id
      if (this.activeHistoryId === id) this.activeHistoryId = null;
      lsRemove(HISTORY_BODY_PREFIX + id);
      // 记墓碑：否则对端（另一条线路）的旧副本会在下次合并时把这条带回来
      this._addTombstones("history", [id]);
      this._persistHistoryIndex();
      this.toast("已删除该条记录");
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
      for (const item of this.history) lsRemove(HISTORY_BODY_PREFIX + item.id);
      this._addTombstones("history", this.history.map((h) => h.id));
      this.history = [];
      lsWrite(LS.history, "[]");
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
      lsSet(LS.favorites, this.favorites);
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
        lsSet(LS.favorites, this.favorites);
        this._mirrorChanged("f", f.id, false, f.updatedAt);
        this.toast("收藏已更新");
      }
      this.favModal = false;
    },
    removeFavorite(id) {
      this.favorites = this.favorites.filter((f) => f.id !== id);
      this._addTombstones("favorites", [id]);
      lsSet(LS.favorites, this.favorites);
      this.toast("已删除该收藏");
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
    modelScoreColor(score) {
      const s = Math.max(0, Math.min(10, Number(score) || 0));
      return `hsl(${Math.round(s * 12)} 85% 45%)`;
    },
    modelRingOffset(score) {
      const s = Math.max(0, Math.min(10, Number(score) || 0));
      return (62.83 * (1 - s / 10)).toFixed(2);
    },
    modelScoreText(score) {
      const n = Number(score);
      if (!Number.isFinite(n)) return "";
      return n % 1 === 0 ? String(n) : String(Math.round(n * 10) / 10);
    },
    shortModel(id) {
      const m = this.models.find((x) => x.id === id);
      if (m && m.name && m.name !== m.id) return m.name;
      return (id || "").replace(/^openrouter\//, "") || "默认模型";
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
      const info = this.fallbackInfo;
      if (!info) return "";
      const reason = info.reason === "timeout"
        ? "响应超时"
        : info.reason === "empty"
          ? "没有返回内容"
          : "暂时不可用";
      return `第 ${info.failed} 个通道${reason}，正在尝试第 ${info.current} 个（共 ${info.total} 个）`;
    },
    get fallbackDots() {
      const info = this.fallbackInfo;
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
