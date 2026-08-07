/* ============================================================
   NeoBangX — 前端应用（Alpine.js）
   对接 docs/API_CONTRACT.md 定义的全部接口（v1.2 智能错题迁移）
   ============================================================ */

/* ---------------- 自定义 SVG 图标库（不依赖第三方图标库） ---------------- */
const ICON_PATHS = {
  // —— 26 个工具图标 ——
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
  "chat": '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.75-.34-3.94-.93L3 21l1.93-5.57A8.5 8.5 0 1 1 21 11.5Z"/>',
  "migration": '<path d="M5 6.5h14M5 12h9M5 17.5h5"/><path d="m16 14 4 4-4 4M20 18h-7"/>',

  // —— UI 图标 ——
  "logo": '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>',
  "menu": '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  "x": '<path d="M6 6l12 12M18 6 6 18"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "chevrons-right": '<path d="m6 7 5 5-5 5M13 7l5 5-5 5"/>',
  "panel-right": '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
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
  "eye-off": '<path d="m4 4 16 16"/><path d="M10.5 6c.5-.1 1-.15 1.5-.15 6 0 9.5 6.15 9.5 6.15a16.8 16.8 0 0 1-2.7 3.25M6.6 6.9A16.5 16.5 0 0 0 2.5 12S6 18.15 12 18.15c1.15 0 2.25-.2 3.25-.57"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  "plus": '<path d="M12 5v14M5 12h14"/>',
  "insert": '<path d="M12 4v9.5M7.5 10 12 14.5 16.5 10"/><path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>',
  "refresh": '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 3.5v4h-4"/>',
  "wand": '<path d="m6 21 15-15-3-3L3 18l3 3Z"/><path d="m14 7 3 3"/>',
  "home": '<path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>',
  "eraser": '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 20.5"/><path d="M21 21H9.5"/><path d="m8.5 8 7.5 7.5"/>',
  "paperclip": '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  "file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/><path d="M10 13h4M10 17h4M8 9h1"/>',
  "key": '<circle cx="7.5" cy="15.5" r="2.5"/><path d="m11 12 4-4"/><path d="m13 10 2.5 2.5"/><path d="M15 8h2v2"/>',
  "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  "alert": '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
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
const HISTORY_LIMIT = 100;

const THEMES = [
  { id: "paper", name: "宣纸", dot: "linear-gradient(135deg,#b4502a,#8c3316)" },
  { id: "celadon", name: "青瓷", dot: "linear-gradient(135deg,#0e6e5f,#0a5245)" },
  { id: "obsidian", name: "曜石", dot: "linear-gradient(135deg,#e9a15b,#cf7038)" },
  { id: "jade", name: "墨翠", dot: "linear-gradient(135deg,#5cb787,#2f8a66)" },
];

/* ---------------- 动态光影背景引擎 ---------------- */
function createBackground(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const PARTICLES = coarse ? 45 : 100;

  let raf = null;
  let t = Math.random() * 100;
  const mouse = { x: innerWidth * 0.72, y: innerHeight * 0.3 };
  const halo = { x: mouse.x, y: mouse.y, tx: mouse.x, ty: mouse.y };
  let particles = [];
  let pulses = [];
  let sparks = [];

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
    particles = Array.from({ length: PARTICLES }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: 1 + Math.random() * 2.2,
      vx: (Math.random() - 0.5) * 0.1,
      vy: -(0.06 + Math.random() * 0.18),
      ph: Math.random() * Math.PI * 2,
      ps: 0.5 + Math.random() * 0.9,
      a: 0.3 + Math.random() * 0.5,
      ox: 0, oy: 0,
    }));
  }
  spawn();

  window.addEventListener("resize", () => { resize(); spawn(); });
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    halo.tx = e.clientX; halo.ty = e.clientY;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf), (raf = null); }
    else if (!raf && !reduced) loop();
  });

  function glowSpot(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function frame(staticOnly) {
    const W = innerWidth, H = innerHeight;
    cur = {
      g1: lerp3(cur.g1, tgt.g1, 0.06), g2: lerp3(cur.g2, tgt.g2, 0.06),
      gm: lerp3(cur.gm, tgt.gm, 0.06), p: lerp3(cur.p, tgt.p, 0.06),
      blend: tgt.blend,
    };
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = cur.blend === "lighter" ? "lighter" : "source-over";

    if (!staticOnly) stepLights();
    const m = Math.max(W, H);
    glowSpot(lights[0].x, lights[0].y, m * 0.5, cur.g1, 0.09);
    glowSpot(lights[1].x, lights[1].y, m * 0.46, cur.g2, 0.085);
    glowSpot(lights[2].x, lights[2].y, m * 0.38, cur.gm, 0.05);

    if (!staticOnly) {
      halo.x += (halo.tx - halo.x) * 0.07;
      halo.y += (halo.ty - halo.y) * 0.07;
    }
    glowSpot(halo.x, halo.y, 380, cur.gm, 0.12);
    glowSpot(halo.x, halo.y, 130, cur.gm, 0.06);

    for (let i = pulses.length - 1; i >= 0; i--) {
      const pu = pulses[i];
      pu.r += 2.4 + pu.r * 0.04;
      pu.a *= 0.94;
      if (pu.a < 0.01) { pulses.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(cur.gm, pu.a * 0.65);
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
      ctx.fillStyle = rgba(cur.gm, s.life * 0.75);
      ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";
    for (const pt of particles) {
      if (!staticOnly) {
        pt.ph += 0.012 * pt.ps;
        pt.x += pt.vx + Math.sin(pt.ph * 0.6) * 0.06;
        pt.y += pt.vy;
        if (!coarse) {
          const dx = pt.x + pt.ox - mouse.x, dy = pt.y + pt.oy - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 16900) {
            const d = Math.sqrt(d2) || 1;
            const f = (130 - d) / 130;
            pt.ox += (dx / d) * f * 1.1;
            pt.oy += (dy / d) * f * 1.1;
          }
          pt.ox *= 0.92; pt.oy *= 0.92;
        }
        if (pt.y < -12) { pt.y = H + 12; pt.x = Math.random() * W; }
        if (pt.x < -12) pt.x = W + 12;
        if (pt.x > W + 12) pt.x = -12;
      }
      const tw = 0.55 + 0.45 * Math.sin(pt.ph);
      ctx.beginPath();
      ctx.arc(pt.x + pt.ox, pt.y + pt.oy, pt.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(cur.p, Math.min(0.9, pt.a * tw * 0.85));
      ctx.fill();
    }
  }

  function loop() {
    t += 0.0035;
    frame(false);
    raf = requestAnimationFrame(loop);
  }

  if (reduced) { frame(true); }
  else { loop(); }

  return {
    attract(x, y) {
      halo.tx = x; halo.ty = y;
      pulses.push({ x, y, r: 6, a: 0.7 });
      if (pulses.length > 6) pulses.shift();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + Math.random() * 0.5;
        const sp = 1.4 + Math.random() * 2.6;
        sparks.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 0.4,
          r: 0.9 + Math.random() * 1.3,
          life: 0.7 + Math.random() * 0.45,
        });
      }
      if (sparks.length > 90) sparks.splice(0, sparks.length - 90);
    },
    themeChanged() { tgt = readTheme(); if (reduced) frame(true); },
  };
}

/* ---------------- localStorage 工具 ---------------- */
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储满时静默失败 */ }
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
  // 处理 LLM 偶发的真·不规范输出（跳过 ``` 代码块，避免误伤）：
  // 1) 分隔线与标题粘在同一行：---### 标题
  // 2) 段落文字后直接粘标题：……。#### 标题（限 ## 及以上，避免误伤 “C#” 等）
  const parts = raw.split(/(```[\s\S]*?(?:```|$))/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/^([ \t]*)---(#{1,6}[ \t])/gm, "\n$1---\n\n$2")
      .replace(/([^\s#])(#{2,6}[ \t]+\S)/g, "$1\n\n$2")
      // 有些模型会把强调标记转义成 \*\*文本\*\*，或在闭合标记前多留空格；
      // 这两种写法会被 marked 当作普通文本，导致页面直接显示星号。
      .replace(/\\\*\\\*([^\n]*?)\\\*\\\*/g, "**$1**")
      .replace(/\\_\\_([^\n]*?)\\_\\_/g, "__$1__")
      .replace(/\*\*[ \t]+([^\n*]*?\S)[ \t]*\*\*/g, "**$1**")
      .replace(/\*\*([^\n*]*?\S)[ \t]+\*\*/g, "**$1**")
      // marked 对强调内容首尾是中文引号、括号等标点的情况不一定能识别；
      // 把成对标点移到强调范围外，视觉效果不变且不会引入隐藏字符。
      .replace(/\*\*([“‘「『（【《〈〔(<"])([^\n*]*?)([”’」』）】》〉〕)>"'])\*\*/g, "$1**$2**$3");
  }
  return parts.join("");
}

function renderMd(raw) {
  if (!raw) return "";
  try {
    const normalized = normalizeMarkdown(raw);
    const html = window.marked ? marked.parse(normalized) : escapeHtml(normalized);
    return window.DOMPurify ? DOMPurify.sanitize(html) : html;
  } catch {
    return escapeHtml(raw);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

/* ---------------- Alpine 主应用 ---------------- */
function nbx() {
  return {
    /* --- 数据 --- */
    groups: [],
    models: [],
    toolsLoaded: false,
    toolsError: "",
    currentTool: null,
    selectedModel: "",
    input: "",
    output: "",
    rendered: "",
    streaming: false,
    thinking: false,
    status: "idle",
    errorMsg: "",
    elapsed: "0.0",
    thinkingElapsed: "0.0",
    requestId: null,
    maskOn: false,
    copied: false,

    /* --- 智能错题迁移 --- */
    migration: null,
    migrationExportTarget: null,
    migrationExportStyle: "",
    migrationDifficultyMenuOpen: false,
    migrationDifficultyOptions: [
      { value: "same", name: "同难度迁移", desc: "保持与原题相近的难度" },
      { value: "harder", name: "逐步升难", desc: "逐步提高综合复杂度" },
      { value: "easiest", name: "专出最容易错的题", desc: "优先诱发当前错因" },
    ],

    /* --- 导出 --- */
    exportMenuOpen: false,
    exportMenuStyle: "",
    exportFormat: "richtext",
    exportFontSize: 14,
    exportFormats: [
      { id: "richtext", name: "复制富文本", desc: "粘贴到 Word / WPS 即有排版", icon: "copy", type: "copy" },
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
    codeActivating: false,
    codeModal: false,

    /* --- 输入模式 --- */
    inputMode: "text",
    attachedFile: null,
    dragOver: false,
    inputCollapsed: false,
    submittedInput: "",
    submittedFileName: "",
    submittedExpanded: false,

    /* --- 面板状态 --- */
    leftOpen: false,
    rightMobileOpen: false,
    rightCollapsed: false,
    rightTab: "history",
    collapsedGroups: {},
    modelMenuOpen: false,

    /* --- 本地数据 --- */
    history: [],
    favorites: [],
    favModal: false,
    editingFav: { id: null, title: "", content: "" },

    /* --- 主题 --- */
    theme: "paper",
    themes: THEMES,

    /* --- Toast --- */
    toasts: [],

    /* --- 内部 --- */
    _abortCtrl: null,
    _stopRequested: false,
    _timer: null,
    _thinkTimer: null,
    _startTs: 0,
    _renderPending: false,
    _nearBottom: true,
    _draftTimer: null,
    _bg: null,
    _migrationAbortControllers: {},
    _exportMenuAnchor: null,
    _exportMenuPositionFrame: null,
    _migrationExportAnchor: null,
    _migrationExportPositionFrame: null,

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
        difficulty: "easiest",
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
      this.migrationDifficultyMenuOpen = false;
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

    /* ============ 初始化 ============ */
    async init() {
      configureMarked();
      this.resetMigration();

      // 主题
      const savedTheme = localStorage.getItem(LS.theme);
      if (savedTheme && THEMES.some((t) => t.id === savedTheme)) this.theme = savedTheme;
      this.applyTheme();

      // 动态光影背景
      this._bg = createBackground(document.getElementById("bgfx"));

      // 本地数据
      this.history = lsGet(LS.history, []);
      this.favorites = lsGet(LS.favorites, []);
      this.input = localStorage.getItem(LS.draft) || "";

      const ui = lsGet(LS.ui, {});
      this.collapsedGroups = ui.collapsedGroups || {};
      this.rightCollapsed = !!ui.rightCollapsed;
      this.rightTab = ui.rightTab === "fav" ? "fav" : "history";

      // 恢复认证
      this.loadAuth();

      await this.loadTools();

      const savedModel = localStorage.getItem(LS.model);
      if (savedModel && this.models.some((m) => m.id === savedModel)) this.selectedModel = savedModel;

      // 输入草稿自动保存
      this.$watch("input", (v) => {
        clearTimeout(this._draftTimer);
        this._draftTimer = setTimeout(() => {
          try { localStorage.setItem(LS.draft, v || ""); } catch {}
        }, 400);
      });

      // 视口变化时关闭移动端抽屉
      window.addEventListener("resize", () => {
        if (window.innerWidth >= 1024) this.leftOpen = false;
        if (window.innerWidth >= 1280) this.rightMobileOpen = false;
        this.repositionExportMenu();
        this.repositionMigrationExport();
      });

      this.$nextTick(() => this.autoGrow());
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
      if (!this.auth.token) return {};
      return { "Authorization": "Bearer " + this.auth.token };
    },
    async activateCode() {
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
      this.codeModal = false;
      this.toast("已清除本机使用码");
    },
    openCodeModal() {
      this.codeModal = true;
      this.codeError = "";
      this.$nextTick(() => {
        const el = this.$refs.codeInputEl;
        if (el) el.focus();
      });
    },
    closeCodeModal() {
      this.codeModal = false;
      this.codeError = "";
    },
    requireAuth(message) {
      if (!this.isAuthenticated) {
        this.toast(message || "请先输入使用码", "warn");
        this.openCodeModal();
        return false;
      }
      return true;
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
            this.openCodeModal();
            return;
          }
          throw new Error("HTTP " + res.status);
        }
        const data = await res.json();
        this.groups = data.groups || [];
        // models 为结构化列表：[{ id, name }]
        this.models = data.models || [];
        this.selectedModel = data.default_model || (this.models[0] && this.models[0].id) || "";
        this.toolsLoaded = true;
      } catch (e) {
        this.toolsError = "工具列表加载失败，请确认后端服务已启动。";
        this.toolsLoaded = false;
      }
    },

    get allModels() {
      return [...this.models];
    },

    /* ============ 工具选择 ============ */
    findTool(id) {
      for (const g of this.groups) {
        const t = (g.tools || []).find((t) => t.id === String(id));
        if (t) return t;
      }
      return null;
    },

    selectTool(tool, ev) {
      if (!this.requireAuth("请先输入使用码再选择工具")) return;
      if (this.streaming || (this.migration && this.migration.generating)) {
        if (!confirm("正在生成中，切换工具将停止本次生成。确定切换吗？")) return;
        if (this.streaming) this.stop();
        if (this.migration && this.migration.generating) this.stopMigration();
      }
      this.currentTool = tool;
      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this.status = "idle";
      this.maskOn = false;
      this.leftOpen = false;
      this.inputCollapsed = false;
      this.submittedInput = "";
      this.submittedFileName = "";
      this.submittedExpanded = false;
      this.resetMigration();
      const el = ev && ev.currentTarget ? ev.currentTarget : null;
      if (el && this._bg) {
        const r = el.getBoundingClientRect();
        this._bg.attract(r.left + r.width * 0.5, r.top + r.height * 0.5);
      }
      this.$nextTick(() => this.autoGrow());
    },

    goHome() {
      if (this.streaming || (this.migration && this.migration.generating)) {
        if (!confirm("正在生成中，返回首页将停止本次生成。确定吗？")) return;
        if (this.streaming) this.stop();
        if (this.migration && this.migration.generating) this.stopMigration();
      }
      this.currentTool = null;
      this.leftOpen = false;
    },

    startFirst() {
      if (!this.requireAuth("请先输入使用码")) return;
      const first = this.groups.flatMap((g) => g.tools || [])[0];
      if (window.innerWidth < 1024) {
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
      this.theme = id;
      this.applyTheme();
      try { localStorage.setItem(LS.theme, id); } catch {}
      if (this._bg) this._bg.themeChanged();
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
    },

    /* ============ 模型下拉 ============ */
    chooseModel(m) {
      this.selectedModel = m;
      this.modelMenuOpen = false;
      try { localStorage.setItem(LS.model, m); } catch {}
    },
    chooseMigrationDifficulty(value) {
      if (!this.migrationDifficultyOptions.some((option) => option.value === value)) return;
      this.migration.difficulty = value;
      this.migrationDifficultyMenuOpen = false;
    },

    /* ============ UI 持久化 ============ */
    persistUI() {
      lsSet(LS.ui, {
        collapsedGroups: this.collapsedGroups,
        rightCollapsed: this.rightCollapsed,
        rightTab: this.rightTab,
      });
    },
    setRightTab(tab) {
      this.rightTab = tab;
      this.persistUI();
    },
    toggleRight() {
      if (window.innerWidth >= 1280) {
        this.rightCollapsed = !this.rightCollapsed;
        this.persistUI();
      } else {
        this.rightMobileOpen = !this.rightMobileOpen;
      }
    },

    /* ============ 输入区 ============ */
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
      this.attachedFile = null;
      this.input = "";
      this.inputMode = "text";
      this.$nextTick(() => this.autoGrow());
    },
    async readFileContent(file) {
      const name = file.name || "";
      const ext = name.split(".").pop().toLowerCase();
      const SUPPORTED = ["txt", "md", "markdown", "docx", "doc"];
      if (!SUPPORTED.includes(ext)) {
        this.toast("不支持的文件格式，请上传 Word / TXT / Markdown 文件", "error");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        this.toast("文件超过 20MB，请拆分后再上传", "error");
        return;
      }
      try {
        let text = "";
        if (ext === "docx") {
          text = await this._readDocx(file);
        } else if (ext === "doc") {
          text = await this._readTextFile(file);
          if (text && text.includes("\u0000")) {
            this.toast("旧版 .doc 格式解析可能不完整，建议另存为 .docx 后重新上传", "warn");
          }
        } else {
          text = await this._readTextFile(file);
        }
        if (!text || !text.trim()) {
          this.toast("文件内容为空或无法解析", "warn");
          return;
        }
        this.input = text;
        this.inputMode = "file";
        this.attachedFile = { name, size: file.size };
        this.toast(`已读取文件「${name}」`);
      } catch (e) {
        this.toast("文件解析失败：" + (e.message || "未知错误"), "error");
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

    /* ============ 智能错题迁移 ============ */
    migrationDifficultyLabel(value) {
      return {
        same: "同难度迁移",
        harder: "逐步升难",
        easiest: "专出该易错因下最容易让学生出错的题",
      }[value] || "专出该易错因下最容易让学生出错的题";
    },
    migrationDifficultyName(value) {
      const option = this.migrationDifficultyOptions.find((item) => item.value === value);
      return option ? option.name : "专出最容易错的题";
    },
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
        "【迁移难度】",
        this.migrationDifficultyLabel(this.migration.difficulty),
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
        if (data && data.detail) {
          message = typeof data.detail === "string"
            ? data.detail
            : (data.detail.message || JSON.stringify(data.detail));
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
      if (!this.requireAuth("请先输入使用码")) return;
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
          if (res.status === 401) this.clearAuth();
          throw new Error(await this.migrationReadError(res, "错因分析失败"));
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
        state.analysisError = e.message || "错因分析失败";
        this.toast(state.analysisError, "error");
      } finally {
        state.analyzing = false;
      }
    },
    async loadMoreMigrationCauses() {
      if (!this.requireAuth("请先输入使用码")) return;
      if (!this.migration || this.migration.analyzing || this.migration.moreAnalyzing) return;
      const state = this.migration;
      if (!state.causes.length || !state.analysisHistory.length) {
        this.toast("当前没有可继续分析的错因历史", "warn");
        return;
      }

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
          if (res.status === 401) this.clearAuth();
          throw new Error(await this.migrationReadError(res, "继续生成错因失败"));
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
        state.analysisError = e.message || "继续生成错因失败";
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
      this.migration.step = 3;
    },
    backMigrationStep(step) {
      if (this.migration.generating) return;
      this.migration.step = step;
    },
    async beginMigration() {
      if (!this.requireAuth("请先输入使用码")) return;
      if (this.migration.generating || this.migration.prechecking) return;
      const selected = this.migrationSelectedCauses;
      if (!selected.length) {
        this.toast("请至少勾选一个需要处理的错因", "warn");
        this.migration.step = 2;
        return;
      }

      const state = this.migration;
      state.prechecking = true;
      try {
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
        }));
        state.generating = true;
        const batchId = state.batchId;
        await Promise.all(state.results.map((card, index) => (
          this.streamMigrationCard(card, index, batchId, selected.length)
        )));
        state.generating = false;
        state.generated = true;
        const partial = state.results.some((card) => card.status !== "done");
        if (this.migrationHasOutput) {
          const item = this.pushMigrationHistory(partial);
          this.generateTitle(item);
        }
        if (!partial) this.verifyAuth();
        if (partial) this.toast("部分迁移卡片未完成，请检查后重试", "warn");
        else this.toast(`已完成 ${state.results.length} 张迁移卡片`);
      } catch (e) {
        state.generating = false;
        state.analysisError = e.message || "生成失败";
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
      const dispatch = () => {
        if (eventData !== "" || eventName !== "message") onEvent(eventName, eventData);
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
          if (res.status === 401) this.clearAuth();
          throw new Error(await this.migrationReadError(res, `HTTP ${res.status}`));
        }
        card.status = "streaming";
        await this.consumeSSE(res, (event, data) => {
          if (event === "error") {
            let message = data;
            try { message = JSON.parse(data).message || data; } catch {}
            throw new Error(message);
          }
          if (event === "token") {
            let text = data;
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed === "string") text = parsed;
            } catch {}
            if (text) {
              card.output += text;
              card.rendered = renderMd(card.output);
            }
          } else if (event === "done" || data === "[DONE]") {
            if (data === "[CANCELLED]") card.status = "stopped";
            else card.status = "done";
          }
        });
        if (card.status === "streaming" || card.status === "waiting") card.status = "done";
      } catch (e) {
        if (e && e.name === "AbortError") card.status = "stopped";
        else {
          card.status = "error";
          card.error = e.message || "生成失败";
        }
      } finally {
        card.streaming = false;
        delete this._migrationAbortControllers[card.requestId];
      }
    },
    async stopMigration() {
      if (!this.migration || !this.migration.generating) return;
      this.migration.stopRequested = true;
      const requests = this.migration.results.map((card) => card.requestId).filter(Boolean);
      const controllers = { ...this._migrationAbortControllers };
      await Promise.all(requests.map((requestId) => fetch("/api/chat/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ request_id: requestId }),
      }).catch(() => null)));
      Object.values(controllers).forEach((controller) => {
        try { controller.abort(); } catch {}
      });
    },
    migrationCardText(card, markdown = false) {
      const heading = markdown ? `## 错因：${card.cause}\n\n` : `错因：${card.cause}\n\n`;
      if (markdown) return heading + (card.output || "");
      const box = document.createElement("div");
      box.innerHTML = renderMd(card.output || "");
      return heading + (box.textContent || card.output || "").trim();
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
      this._migrationExportAnchor = anchor;
      this.migrationExportStyle = "visibility:hidden;";
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

        menu.style.width = `${menuWidth}px`;
        menu.style.maxHeight = `${availableHeight}px`;
        const menuHeight = Math.min(menu.getBoundingClientRect().height || 360, availableHeight);
        const anchorRect = anchor.getBoundingClientRect();
        const spaceAbove = anchorRect.top - padding;
        const spaceBelow = viewportHeight - anchorRect.bottom - padding;
        let top;
        if (spaceAbove >= menuHeight + 10 || spaceAbove > spaceBelow) {
          top = anchorRect.top - menuHeight - 10;
        } else {
          top = anchorRect.bottom + 10;
        }
        top = Math.max(padding, Math.min(top, viewportHeight - padding - menuHeight));

        const left = isMobile
          ? Math.max(padding, (viewportWidth - menuWidth) / 2)
          : Math.max(padding, Math.min(anchorRect.right - menuWidth, viewportWidth - padding - menuWidth));
        this.migrationExportStyle = [
          `top:${Math.round(top)}px`,
          `left:${Math.round(left)}px`,
          `width:${Math.round(menuWidth)}px`,
          `max-height:${Math.round(availableHeight)}px`,
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
      this.exportMenuStyle = "";
      this._exportMenuAnchor = null;
      this.migrationExportTarget = null;
      this.migrationExportStyle = "";
      this._migrationExportAnchor = null;
    },
    hasMigrationExportTarget() {
      return this.isMigrationTool && !!this.migrationExportTarget;
    },
    getExportMarkdown() {
      if (this.hasMigrationExportTarget()) {
        const cards = this.migrationExportCards();
        return this.migrationExportTarget.scope === "all"
          ? cards.map((card) => this.migrationCardText(card, true)).join("\n\n---\n\n")
          : (cards[0] ? this.migrationCardText(cards[0], true) : "");
      }
      return this.output;
    },
    getExportPlain() {
      if (this.hasMigrationExportTarget()) {
        const cards = this.migrationExportCards();
        return this.migrationExportTarget.scope === "all"
          ? cards.map((card) => this.migrationCardText(card, false)).join("\n\n")
          : (cards[0] ? this.migrationCardText(cards[0], false) : "");
      }
      return this.output;
    },
    buildExportContent() {
      let content;
      if (this.hasMigrationExportTarget()) {
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
          difficulty: this.migration.difficulty,
          questionCount: this.migration.questionCount,
          results: this.migration.results
            .filter((card) => card.output && card.output.trim())
            .map((card) => ({ causeId: card.causeId, cause: card.cause, output: card.output })),
        },
      };
      this.favorites.unshift(favorite);
      lsSet(LS.favorites, this.favorites);
      this.toast("已收藏整条迁移记录");
    },
    pushMigrationHistory(partial = false) {
      const form = this.migration.form;
      const output = this.migrationAllText(true);
      const item = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        toolId: this.currentTool.id,
        toolName: this.currentTool.name,
        icon: this.currentTool.icon,
        title: "",
        input: form.question.trim(),
        fileName: "",
        output,
        model: this.selectedModel,
        partial: !!partial,
        createdAt: Date.now(),
        migration: {
          form: { ...form },
          causes: this.migrationSelectedCauses.map((cause) => ({ ...cause })),
          difficulty: this.migration.difficulty,
          questionCount: this.migration.questionCount,
          results: this.migration.results
            .filter((card) => card.output && card.output.trim())
            .map((card) => ({ causeId: card.causeId, cause: card.cause, output: card.output })),
        },
      };
      this.history.unshift(item);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
      lsSet(LS.history, this.history);
      return item;
    },

    /* ============ 流式生成（SSE） ============ */
    async run() {
      if (!this.requireAuth("请先输入使用码")) return;
      if (this.isMigrationTool) {
        await this.analyzeMigration();
        return;
      }
      if (this.streaming) return;
      if (!this.currentTool) {
        this.toast("请先在左侧选择一个工具", "warn");
        return;
      }
      const text = this.input.trim();
      if (!text) {
        this.toast("请先粘贴或输入内容", "warn");
        this.shakeComposer();
        return;
      }
      if (!this.currentTool.prompt_loaded) {
        if (!confirm(`「${this.currentTool.name}」的提示词文件尚未加载，生成效果可能不完整。仍要继续吗？`)) return;
      }

      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this.streaming = true;
      this.thinking = true;
      this.thinkingElapsed = "0.0";
      this._stopRequested = false;
      this.status = "connecting";
      this._nearBottom = true;
      this.requestId = `${this.currentTool.id}_${Date.now()}`;
      this._abortCtrl = new AbortController();
      this.startTimer();
      this.startThinkTimer();

      this.submittedInput = text;
      this.submittedFileName = this.attachedFile ? this.attachedFile.name : "";
      this.inputCollapsed = true;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";

      let gotDone = false;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({
            tool_id: this.currentTool.id,
            input: text,
            model: this.selectedModel || undefined,
            request_id: this.requestId,
          }),
          signal: this._abortCtrl.signal,
        });

        if (!res.ok) {
          if (res.status === 401) {
            this.clearAuth();
            throw new Error("登录已过期，请重新输入使用码");
          }
          if (res.status === 403) {
            throw new Error("额度已用尽或使用码已被禁用");
          }
          let msg = "HTTP " + res.status;
          try {
            const j = await res.json();
            if (j && j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
          } catch {}
          throw new Error(msg);
        }
        if (!res.body) throw new Error("浏览器不支持流式读取");

        this.status = "streaming";
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let evName = "message";
        let evData = "";

        const dispatch = (ev, data) => {
          if (ev === "done" || data === "[DONE]") { gotDone = true; return; }
          if (ev === "error") {
            let m = data;
            try { m = JSON.parse(data).message || data; } catch {}
            throw new Error(m);
          }
          if (data === "[CANCELLED]") { this._stopRequested = true; return; }
          if (ev === "token") {
            // token 为 JSON 编码字符串（换行保真传输），解码失败时降级为原文
            let text = data;
            try {
              const parsed = JSON.parse(data);
              if (typeof parsed === "string") text = parsed;
            } catch {}
            if (text) {
              if (this.thinking) { this.thinking = false; this.stopThinkTimer(); }
              this.output += text;
              this.scheduleRender();
            }
            return;
          }
          if (data) {
            if (this.thinking) { this.thinking = false; this.stopThinkTimer(); }
            this.output += data;
            this.scheduleRender();
          }
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

        this.finalize(this._stopRequested ? "stopped" : "done");
      } catch (e) {
        if (e && e.name === "AbortError") {
          this.finalize("stopped");
        } else {
          this.finalize("error", (e && e.message) || "网络请求失败");
        }
      }
    },

    async stop() {
      if (!this.streaming) return;
      this._stopRequested = true;
      try {
        await fetch("/api/chat/stop", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.authHeaders(),
          },
          body: JSON.stringify({ request_id: this.requestId }),
        });
      } catch { /* 停止信号失败不阻塞前端中止 */ }
      try { this._abortCtrl && this._abortCtrl.abort(); } catch {}
    },

    finalize(state, errMsg) {
      this.streaming = false;
      this.thinking = false;
      this.stopTimer();
      this.stopThinkTimer();
      this.doRender();
      if (state === "error") {
        this.status = "error";
        this.errorMsg = errMsg || "生成失败";
        this.toast("生成失败：" + this.errorMsg, "error");
      } else {
        this.status = state;
        if (this.output.trim()) {
          const item = this.pushHistory(state === "stopped");
          this.generateTitle(item);
        }
        if (state === "stopped") this.toast("已停止生成", "warn");
      }
    },

    /* --- 渲染（节流） --- */
    scheduleRender() {
      if (this._renderPending) return;
      this._renderPending = true;
      setTimeout(() => {
        this._renderPending = false;
        this.doRender();
      }, 60);
    },
    doRender() {
      this.rendered = renderMd(this.output);
      this.$nextTick(() => {
        if (this.maskOn && this.currentTool && this.currentTool.id === "13") {
          tagAnswerElements(this.$refs.mdRoot);
        }
        this.maybeScroll();
      });
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
        this.thinkingElapsed = ((performance.now() - startTs) / 1000).toFixed(1);
      }, 100);
    },
    stopThinkTimer() {
      clearInterval(this._thinkTimer);
      this._thinkTimer = null;
    },

    /* ============ 复制 ============ */
    async copyResult() {
      if (!this.output) return;
      const ok = await copyToClipboard(this.output);
      if (!ok) {
        this.toast("复制失败，请手动复制", "error");
        return;
      }
      this.copied = true;
      this.toast("已复制到剪贴板");
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
      const markdown = this.getExportMarkdown();
      const plain = this.getExportPlain();
      if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
        const html = this.buildExportContent();
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([plain], { type: "text/plain" }),
            }),
          ]);
          this.toast("已复制富文本，可直接粘贴到 Word");
          return;
        } catch { /* 回退纯文本 */ }
      }
      const ok = await copyToClipboard(markdown);
      if (ok) this.toast("当前环境不支持富文本复制，已改为复制纯文本", "warn");
      else this.toast("复制失败，请手动复制", "error");
    },

    async exportCopyMd() {
      const ok = await copyToClipboard(this.getExportMarkdown());
      if (ok) this.toast("已复制 Markdown 源码");
      else this.toast("复制失败，请手动复制", "error");
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

    /* ============ 历史记录 ============ */
    pushHistory(partial) {
      const item = {
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
      };
      this.history.unshift(item);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
      lsSet(LS.history, this.history);
      return item;
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
          lsSet(LS.history, this.history);
        }
      } catch {
        // 标题生成失败静默处理
      }
    },
    openHistory(item) {
      if (this.streaming || (this.migration && this.migration.generating)) {
        if (!confirm("正在生成中，查看历史将停止本次生成。确定吗？")) return;
        if (this.streaming) this.stop();
        if (this.migration && this.migration.generating) this.stopMigration();
      }
      if (item.migration) {
        this.openMigrationHistory(item);
        return;
      }
      const tool = this.findTool(item.toolId);
      this.currentTool = tool || {
        id: item.toolId, name: item.toolName, icon: item.icon,
        description: "", prompt_loaded: true,
      };
      this.submittedInput = item.input;
      this.submittedFileName = item.fileName || "";
      this.submittedExpanded = false;
      this.inputCollapsed = true;
      this.input = "";
      this.attachedFile = null;
      this.inputMode = "text";
      this.output = item.output;
      this.errorMsg = "";
      this.status = "history";
      this.doRender();
      this.rightMobileOpen = false;
      this.$nextTick(() => {
        const el = this.$refs.resultScroll;
        if (el) el.scrollTop = 0;
      });
    },
    openMigrationHistory(item) {
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
      this.migration.difficulty = saved.difficulty || "easiest";
      this.migration.questionCount = Number(saved.questionCount) || 3;
      this.migration.results = (Array.isArray(saved.results) ? saved.results : []).map((card, index) => ({
        id: `${item.id}_${index}`,
        causeId: card.causeId || `cause_${index}`,
        cause: card.cause || "未命名错因",
        output: card.output || "",
        rendered: renderMd(card.output || ""),
        status: "done",
        error: "",
        streaming: false,
        collapsed: false,
        requestId: "",
      }));
      this.migration.step = 4;
      this.migration.generated = true;
      this.migration.generating = false;
      this.rightMobileOpen = false;
    },
    startNewTopic() {
      if (this.isMigrationTool) {
        this.resetMigration();
        return;
      }
      this.inputCollapsed = false;
      this.submittedInput = "";
      this.submittedFileName = "";
      this.submittedExpanded = false;
      this.output = "";
      this.rendered = "";
      this.errorMsg = "";
      this.status = "idle";
      this.inputMode = "text";
      this.attachedFile = null;
      this.$nextTick(() => {
        this.autoGrow();
        const el = this.$refs.inputEl;
        if (el) el.focus();
      });
    },
    removeHistory(id) {
      this.history = this.history.filter((h) => h.id !== id);
      lsSet(LS.history, this.history);
      this.toast("已删除该条记录");
    },
    clearHistory() {
      if (!this.history.length) return;
      if (!confirm(`确定要清空全部 ${this.history.length} 条历史记录吗？此操作不可恢复。`)) return;
      this.history = [];
      lsSet(LS.history, []);
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
      lsSet(LS.favorites, this.favorites);
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
        lsSet(LS.favorites, this.favorites);
        this.toast("收藏已更新");
      }
      this.favModal = false;
    },
    removeFavorite(id) {
      this.favorites = this.favorites.filter((f) => f.id !== id);
      lsSet(LS.favorites, this.favorites);
      this.toast("已删除该收藏");
    },

    /* ============ 小工具 ============ */
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
    get statusText() {
      switch (this.status) {
        case "connecting": return this.thinking ? "思考中… " + this.thinkingElapsed + "s" : "正在连接模型…";
        case "streaming": return this.thinking ? "思考中… " + this.thinkingElapsed + "s" : "生成中… " + this.elapsed + "s";
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

    toast(msg, type = "ok") {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, msg, type });
      setTimeout(() => {
        const t = this.toasts.find((x) => x.id === id);
        if (t) t.out = true;
        setTimeout(() => { this.toasts = this.toasts.filter((x) => x.id !== id); }, 300);
      }, 2400);
    },

    icon,
  };
}
