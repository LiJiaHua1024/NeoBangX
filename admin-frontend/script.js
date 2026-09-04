/* NeoBangX Admin Frontend */

/* ---------- 剪贴板复制（兼容 HTTP 内网部署：execCommand 回退，不依赖安全上下文） ---------- */
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

const ADMIN_THEMES = [
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf), (raf = null); }
    else if (!raf && !reduced) loop();
  });

  function glowSpot(x, y, r, color, alpha) {
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

  /* 悠空·白昼：云隙光——角度缓缓摇摆、亮度呼吸脉动的阳光光束 */
  function drawSunRays(W, H, strength, time) {
    const sway = Math.sin(time * 2.2) * 0.06;
    const pulse = 0.78 + 0.22 * Math.sin(time * 3.1);
    ctx.save();
    ctx.translate(W * 0.8, -H * 0.15);
    ctx.rotate(0.42 + sway);
    for (const [ox, w, a] of [[0, 150, 0.075], [220, 90, 0.05], [-200, 60, 0.032]]) {
      const g = ctx.createLinearGradient(ox, 0, ox + w, 0);
      g.addColorStop(0, "rgba(255,246,222,0)");
      g.addColorStop(0.5, `rgba(255,246,222,${(a * strength * pulse).toFixed(4)})`);
      g.addColorStop(1, "rgba(255,246,222,0)");
      ctx.fillStyle = g;
      ctx.fillRect(ox, 0, w, H * 1.9);
    }
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

function adminApp() {
  return {
    version: "1.1.0",
    theme: "paper",
    themes: ADMIN_THEMES,
    tab: "dashboard",
    loading: false,
    stats: {},
    securityWarning: false,
    securityBannerDismissed: false,
    rotatingSecret: false,
    codes: [],
    codesTotal: 0,
    codesPage: 1,
    codesPageSize: 20,
    codeQuery: "",
    codeTypeFilter: "",
    codeEnabledFilter: "",
    codeTypeMenuOpen: false,
    codeEnabledMenuOpen: false,
    logs: [],
    logsTotal: 0,
    logsPage: 1,
    logsPageSize: 30,
    logsPageSizeOptions: [30, 50, 100],
    logsSizeMenuOpen: false,
    logCode: "",
    logToolId: "",
    logModel: "",
    logDevice: "",
    logStart: "",
    logEnd: "",
    datePickerOpen: null,
    datePickerMode: "days",
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calHoverIso: "",
    calMonthNames: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
    logsStatusFilter: "",
    logsStatusMenuOpen: false,
    logStatusOptions: [
      { id: "", label: "全部状态" },
      { id: "success", label: "成功" },
      { id: "cancelled", label: "用户停止" },
      { id: "error", label: "异常" },
    ],
    logSummary: {},
    // 详情抽屉
    logDetailOpen: false,
    logDetail: null,
    logDetailLoading: false,
    logDetailError: "",
    payloadParts: [
      { key: "input", label: "用户输入", open: true },
      { key: "prompt", label: "渲染后的完整 Prompt", open: false },
      { key: "output", label: "模型输出", open: true },
    ],
    // null = 尚未读取；决定日志页「未开启记录」提示是否展示
    payloadRecording: null,
    purgeDays: null,
    purging: false,
    configForm: {
      default_model: "",
      models: [],
      chores_model: "",
      max_tokens: 4096,
      timeout: 120,
      log_payload: false,
      log_retention_days: 0,
    },
    savingConfig: false,
    choresModelMenuOpen: false,
    // MinerU 文档解析
    parseConfig: { mode: "precision", model: "pipeline", has_token: false, token_masked: "" },
    parseTokenInput: "",
    parseModelMenuOpen: false,
    testingMineru: false,
    savingMineru: false,
    get mineruModelLabel() {
      return this.parseConfig.model === "vlm" ? "vlm" : "pipeline（推荐）";
    },
    // 多 Provider 聚合
    providers: [],
    modelProviderMap: {},
    modelProviderDetails: {},
    savingProvider: false,
    testingProviderId: null,
    // Provider 测试弹窗（弹窗选模型，自动预填 provider_model_id + prompt）
    providerTestModalOpen: false,
    providerTestForm: { providerId: "", model: "", provider_model_id: "", prompt: "Hello" },
    providerTestModelMenuOpen: false,
    // Provider 弹窗
    providerModalOpen: false,
    providerForm: { id: "", name: "", base_url: "", api_key: "", enabled: true },
    // 模型 Provider 绑定弹窗（每模型独立优先级 + per-provider model id）
    modelProvidersModalOpen: false,
    modelProvidersModelId: "",
    modelProvidersModelName: "",
    modelProvidersOrdered: [], // [{provider_id, provider_model_id}]
    savingModelProviders: false,
    modelProvidersDragIndex: null,
    modelProvidersDragOverIndex: null,
    modelProvidersPickOpen: true,
    modelProvidersOrderedOpen: true,
    // 模型表格内 Provider 拖拽
    providerDragModelId: null,
    providerDragIndex: null,
    providerDragOverIndex: null,
    // 日志 Provider 筛选
    logProvider: "",
    // 设备指纹
    devices: [],
    devicesTotal: 0,
    devicesPage: 1,
    devicesPageSize: 20,
    deviceQuery: "",
    // 设备编辑弹窗（备注 + 自选颜色）
    deviceModalOpen: false,
    savingDevice: false,
    deviceForm: { id: null, short_code: "", auto_name: "", note: "", color: "" },
    // 设备画像抽屉（GET /api/admin/devices/{id}，摘要翻译 + 使用分布）
    deviceDetailOpen: false,
    deviceDetail: null,
    deviceDetailLoading: false,
    deviceDetailError: "",
    deviceColors: [
      "#c0392b", "#d35400", "#b7791f", "#1e8449", "#0e6e5f", "#148f77",
      "#2471a3", "#2e86c1", "#6c3483", "#884ea0", "#ad1457", "#ca6f1e",
      "#5d6d7e", "#2c3e50",
    ],
    // 模型添加/编辑弹窗
    modelModalOpen: false,
    modelModalIndex: null,
    modelForm: { id: "", name: "", description: "", score: null, mode: "default", thinking_budget: null, chores_only: false, enabled: true },
    thinkingMenuOpen: false,
    // 模型拖拽排序
    dragIndex: null,
    dragOverIndex: null,
    dragOverBefore: false,
    thinkingModes: [
      { id: "default", label: "跟随模型默认", hint: "不传任何参数，是否思考由供应商默认策略决定" },
      { id: "none", label: "关闭思考", hint: "尽可能禁用思考，响应更快、消耗更少" },
      { id: "minimal", label: "最低强度", hint: "保留极少量思考" },
      { id: "low", label: "低强度", hint: "轻度思考，适合简单任务" },
      { id: "medium", label: "中强度", hint: "均衡的思考投入" },
      { id: "high", label: "高强度", hint: "深度思考，适合复杂分析任务，响应较慢" },
      { id: "budget", label: "自定义 Token 预算", hint: "显式指定思考 token 上限（Anthropic 风格 thinking 参数）" },
    ],
    createOpen: false,
    creating: false,
    createForm: { code_type: "user", quota: 10, count: 1, note: "" },
    createTypeMenuOpen: false,
    createQuotaMenuOpen: false,
    quotaPresets: [1, 3, 5, 10, 50, 100, 200, 500, 1000],
    createdItems: [],
    quotaModalOpen: false,
    savingQuota: false,
    // 使用码备注弹窗
    codeNoteModalOpen: false,
    savingCodeNote: false,
    codeNoteForm: { id: null, code: "", note: "" },
    editingQuotaId: null,
    editingQuotaCode: "",
    editingQuotaUsed: 0,
    editingQuotaValue: 10,
    editQuotaMenuOpen: false,
    toasts: [],

    get pageTitle() {
      return (
        {
          dashboard: "概览",
          codes: "使用码管理",
          logs: "使用日志",
          devices: "设备指纹",
          logsettings: "日志设置",
          config: "API 配置",
          parse: "文档解析",
        }[this.tab] || "管理后台"
      );
    },
    get pageDesc() {
      return (
        {
          dashboard: "查看整体使用情况与快捷入口",
          codes: "生成、启用/禁用/删除使用码，查看额度",
          logs: "查看每次工具调用的详细记录",
          devices: "按浏览器指纹聚合设备，备注区分不同用户",
          logsettings: "配置原始数据记录开关与日志保留策略",
          config: "管理 LLM 密钥、模型与调用参数",
          parse: "配置 PDF 云端解析：精准/轻量模式、模型与 Token",
        }[this.tab] || ""
      );
    },
    get codeTypeFilterLabel() {
      const map = { "": "全部类型", user: "普通用户", admin: "管理员" };
      return map[this.codeTypeFilter] || "全部类型";
    },
    get codeEnabledFilterLabel() {
      const map = { "": "全部状态", true: "已启用", false: "已禁用" };
      return map[this.codeEnabledFilter] || "全部状态";
    },
    get logsStatusFilterLabel() {
      const opt = this.logStatusOptions.find((o) => o.id === this.logsStatusFilter);
      return opt ? opt.label : "全部状态";
    },
    get hasLogFilters() {
      return !!(
        this.logCode.trim() ||
        this.logToolId.trim() ||
        this.logModel.trim() ||
        this.logProvider.trim() ||
        (this.logDevice || "").trim() ||
        this.logsStatusFilter ||
        this.logStart ||
        this.logEnd
      );
    },
    get logsPageCount() {
      return Math.max(1, Math.ceil(this.logsTotal / this.logsPageSize));
    },
    get defaultModelLabel() {
      const m = this.configForm.models.find((x) => x.id === this.configForm.default_model);
      if (m) return m.name || m.id;
      return this.configForm.default_model || "请选择默认模型";
    },
    get choresModelLabel() {
      if (!this.configForm.chores_model) return `跟随默认（${this.defaultModelLabel}）`;
      const m = this.configForm.models.find((x) => x.id === this.configForm.chores_model);
      if (m) return m.name || m.id;
      return this.configForm.chores_model;
    },
    get defaultModelMissing() {
      return (
        !!this.configForm.default_model &&
        this.configForm.models.length > 0 &&
        !this.configForm.models.some((m) => m.id === this.configForm.default_model && !m.chores_only && m.enabled !== false)
      );
    },
    get providersById() {
      const map = {};
      for (const p of this.providers) map[p.id] = p;
      return map;
    },
    get hasUnboundModels() {
      return this.configForm.models.some((m) => m.enabled !== false && !(this.modelProviderMap[m.id] && this.modelProviderMap[m.id].length));
    },
    get unboundModelCount() {
      return this.configForm.models.filter((m) => m.enabled !== false && !(this.modelProviderMap[m.id] && this.modelProviderMap[m.id].length)).length;
    },

    async init() {
      const saved = localStorage.getItem("nbx_admin_theme");
      if (saved && ADMIN_THEMES.some((t) => t.id === saved)) this.theme = saved;
      this.applyTheme();

      // 悠空 · 两时段天空：每分钟校准一次，回到前台时立即校准
      this._skyTimer = setInterval(() => this.updateSkyPeriod(), 60000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.updateSkyPeriod();
      });

      // 动态光影背景 + 主要操作（侧栏导航 / 主按钮）的点击涟漪
      this._bg = createBackground(document.getElementById("bgfx"));
      document.addEventListener("click", (e) => {
        const el = e.target.closest(".nav-item, .btn-primary");
        if (el && this._bg) {
          const r = el.getBoundingClientRect();
          this._bg.attract(r.left + r.width * 0.5, r.top + r.height * 0.5);
        }
      });

      try {
        this.securityBannerDismissed = sessionStorage.getItem("nbx_jwt_warn_dismissed") === "1";
      } catch {}
      await this.refreshAll();
    },

    dismissSecurityBanner() {
      this.securityBannerDismissed = true;
      try { sessionStorage.setItem("nbx_jwt_warn_dismissed", "1"); } catch {}
    },

    async rotateJwtSecret() {
      const confirmed = confirm(
        "将生成新的随机 JWT 密钥并保存到数据卷：\n\n" +
        "· 本管理后台立即生效\n" +
        "· 主站(8000)需重启后生效（docker-compose restart）\n" +
        "· 主站重启后所有老师需重新输入使用码\n\n确定继续吗？"
      );
      if (!confirmed) return;
      this.rotatingSecret = true;
      try {
        await this.api("/api/admin/jwt-secret/rotate", { method: "POST" });
        this.toast("已生成新密钥并保存；重启主站(8000)后全部生效", "ok");
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "生成失败，请检查数据卷写入权限", "error");
      } finally {
        this.rotatingSecret = false;
      }
    },

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
      try { localStorage.setItem("nbx_admin_theme", id); } catch {}
      if (this._bg) this._bg.themeChanged();
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
      this.updateSkyPeriod();
      this.updateFavicon();
    },
    /* 悠空 · 两时段天空：白昼 6-22 / 星夜 22-6
       调试可用 URL hash 强制锁定时段，如 #sky=night（重新点主题圆点立即生效） */
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

    async refreshAll() {
      this.loading = true;
      try {
        await Promise.all([this.loadStats(), this.loadCodes(), this.loadLogs()]);
        if (this.tab === "config" || this.tab === "logsettings") await this.loadConfig();
        if (this.tab === "parse") await this.loadMineru();
      } finally {
        this.loading = false;
      }
    },

    async api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        let msg =
          (data && (data.detail || data.message)) ||
          `请求失败 HTTP ${res.status}`;
        if (Array.isArray(msg)) {
          // FastAPI 参数校验失败时 detail 是错误对象数组，转成可读文案而非原始 JSON
          const first = msg[0] || {};
          const fieldPath = Array.isArray(first.loc)
            ? first.loc.filter((part) => part !== "body").join(".")
            : "";
          msg = [fieldPath, first.msg].filter(Boolean).join("：") || "提交的参数不合法";
        }
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return data;
    },

    toast(msg, type = "ok") {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, msg, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 2800);
    },

    fmtTime(iso) {
      if (!iso) return "—";
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      } catch {
        return iso;
      }
    },

    async copyText(text) {
      const ok = await copyToClipboard(text);
      if (ok) this.toast("已复制");
      else this.toast("复制失败，请手动复制", "error");
    },

    async loadStats() {
      try {
        this.stats = await this.api("/api/admin/stats");
        this.securityWarning = !!(
          this.stats.security && this.stats.security.jwt_secret_is_default
        );
      } catch (e) {
        this.toast(e.message || "加载统计失败", "error");
      }
    },

    async loadCodes() {
      try {
        const params = new URLSearchParams({
          page: String(this.codesPage),
          page_size: String(this.codesPageSize),
        });
        if (this.codeQuery.trim()) params.set("q", this.codeQuery.trim());
        if (this.codeTypeFilter) params.set("code_type", this.codeTypeFilter);
        if (this.codeEnabledFilter !== "") params.set("enabled", this.codeEnabledFilter);

        const data = await this.api(`/api/admin/codes?${params}`);
        this.codes = data.items || [];
        this.codesTotal = data.total || 0;
        // 删除/禁用后当前页可能已超出末页（返回空列表但 total 正常），收敛页码重查
        const maxPage = Math.max(1, Math.ceil(this.codesTotal / this.codesPageSize));
        if (this.codesPage > maxPage) {
          this.codesPage = maxPage;
          return this.loadCodes();
        }
      } catch (e) {
        this.toast(e.message || "加载使用码失败", "error");
      }
    },

    openCreate() {
      this.createForm = { code_type: "user", quota: 10, count: 1, note: "" };
      this.createdItems = [];
      this.createOpen = true;
      this.createTypeMenuOpen = false;
      this.createQuotaMenuOpen = false;
    },

    async createCodes() {
      this.creating = true;
      try {
        const body = {
          code_type: this.createForm.code_type,
          quota: this.createForm.code_type === "admin" ? -1 : Number(this.createForm.quota) || 1,
          count: Number(this.createForm.count) || 1,
          note: this.createForm.note || "",
        };
        const data = await this.api("/api/admin/codes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        this.createdItems = data.items || [];
        this.toast(`已生成 ${data.count} 个使用码`);
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "生成失败", "error");
      } finally {
        this.creating = false;
      }
    },

    async copyCreated() {
      const text = this.createdItems.map((i) => i.code).join("\n");
      await this.copyText(text);
    },

    async toggleCode(c) {
      try {
        await this.api(`/api/admin/codes/${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_enabled: !c.is_enabled }),
        });
        this.toast(c.is_enabled ? "已禁用" : "已启用");
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      }
    },

    openCodeNoteEditor(c) {
      if (!c) return;
      this.codeNoteForm = { id: c.id, code: c.code || "", note: c.note || "" };
      this.savingCodeNote = false;
      this.codeNoteModalOpen = true;
    },

    async saveCodeNote() {
      const f = this.codeNoteForm;
      if (!f.id) return;
      this.savingCodeNote = true;
      try {
        await this.api(`/api/admin/codes/${f.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: (f.note || "").trim() }),
        });
        this.codeNoteModalOpen = false;
        this.toast("备注已更新");
        await this.loadCodes();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      } finally {
        this.savingCodeNote = false;
      }
    },

    openEditQuota(c) {
      this.editingQuotaId = c.id;
      this.editingQuotaCode = c.code;
      this.editingQuotaUsed = c.used_count;
      this.editingQuotaValue = c.quota;
      this.editQuotaMenuOpen = false;
      this.quotaModalOpen = true;
    },

    async saveEditQuota() {
      const quota = parseInt(this.editingQuotaValue, 10);
      if (!Number.isFinite(quota) || quota < 1) {
        this.toast("额度需为正整数", "error");
        return;
      }
      this.savingQuota = true;
      try {
        await this.api(`/api/admin/codes/${this.editingQuotaId}`, {
          method: "PATCH",
          body: JSON.stringify({ quota }),
        });
        this.toast("额度已更新");
        this.quotaModalOpen = false;
        await this.loadCodes();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      } finally {
        this.savingQuota = false;
      }
    },

    async deleteCode(c) {
      if (!confirm(`确定要删除使用码「${c.code}」吗？此操作不可恢复。`)) return;
      try {
        await this.api(`/api/admin/codes/${c.id}`, { method: "DELETE" });
        this.toast("已删除");
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "删除失败", "error");
      }
    },

    /* ============ 使用日志 ============ */
    logStatusLabel(status) {
      const map = { success: "成功", cancelled: "用户停止", error: "异常" };
      return map[status] || "成功";
    },

    fmtNum(value) {
      if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
      return Number(value).toLocaleString("zh-CN");
    },

    /* 扣费次数：null = 旧记录升级前未保存该字段，与「本次未扣费」(0) 不是一回事 */
    fmtUnits(units) {
      if (units == null || !Number.isFinite(Number(units))) return "—";
      return Number(units) > 0 ? `${units} 次` : "未扣费";
    },

    fmtDuration(ms) {
      if (ms == null || ms === "" || !Number.isFinite(Number(ms))) return "—";
      const v = Number(ms);
      if (v < 1000) return `${Math.round(v)} ms`;
      if (v < 60000) return `${(v / 1000).toFixed(1)} s`;
      const total = Math.round(v / 1000);
      return `${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
    },

    _toIso(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },
    _parseIso(iso) {
      if (!iso || typeof iso !== "string") return null;
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    },
    _todayIso() {
      return this._toIso(new Date());
    },
    fmtDateLabel(iso, placeholder) {
      return this._parseIso(iso) ? iso : placeholder;
    },

    get calCaption() {
      if (this.datePickerMode === "years") {
        const start = Math.floor(this.calYear / 12) * 12;
        return `${start} – ${start + 11}`;
      }
      if (this.datePickerMode === "months") return `${this.calYear} 年`;
      return `${this.calYear} 年 ${this.calMonth + 1} 月`;
    },
    get calYears() {
      const start = Math.floor(this.calYear / 12) * 12;
      return Array.from({ length: 12 }, (_, i) => start + i);
    },
    get calendarCells() {
      const y = this.calYear;
      const m = this.calMonth;
      const first = new Date(y, m, 1);
      const startPad = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const prevDays = new Date(y, m, 0).getDate();
      const today = this._todayIso();
      const cells = [];
      for (let i = 0; i < 42; i++) {
        let day;
        let monthOffset;
        if (i < startPad) {
          day = prevDays - startPad + i + 1;
          monthOffset = -1;
        } else if (i < startPad + daysInMonth) {
          day = i - startPad + 1;
          monthOffset = 0;
        } else {
          day = i - startPad - daysInMonth + 1;
          monthOffset = 1;
        }
        const date = new Date(y, m + monthOffset, day);
        const iso = this._toIso(date);
        cells.push({ iso, day, outside: monthOffset !== 0, today: iso === today });
      }
      return cells;
    },

    toggleDatePicker(key) {
      if (this.datePickerOpen === key) {
        this.closeDatePicker();
        return;
      }
      this.logsStatusMenuOpen = false;
      this.datePickerOpen = key;
      this.datePickerMode = "days";
      this.calHoverIso = "";
      const iso = key === "start" ? this.logStart : this.logEnd;
      const base = this._parseIso(iso) || new Date();
      this.calYear = base.getFullYear();
      this.calMonth = base.getMonth();
    },
    closeDatePicker() {
      this.datePickerOpen = null;
      this.datePickerMode = "days";
      this.calHoverIso = "";
    },
    calStep(dir) {
      if (this.datePickerMode === "days") {
        const d = new Date(this.calYear, this.calMonth + dir, 1);
        this.calYear = d.getFullYear();
        this.calMonth = d.getMonth();
      } else if (this.datePickerMode === "months") {
        this.calYear += dir;
      } else {
        this.calYear += dir * 12;
      }
    },
    calDrill() {
      if (this.datePickerMode === "days") this.datePickerMode = "months";
      else if (this.datePickerMode === "months") this.datePickerMode = "years";
    },
    calPickMonth(idx) {
      this.calMonth = idx;
      this.datePickerMode = "days";
    },
    calPickYear(y) {
      this.calYear = y;
      this.datePickerMode = "months";
    },
    calDayClass(cell) {
      const iso = cell.iso;
      const start = this.logStart;
      const end = this.logEnd;
      let from = start;
      let to = end;
      let previewing = false;
      const hover = this.calHoverIso;
      if (hover) {
        if (this.datePickerOpen === "end" && start) { to = hover; previewing = true; }
        if (this.datePickerOpen === "start" && end) { from = hover; previewing = true; }
      }
      const lo = from && to && from > to ? to : from;
      const hi = from && to && from > to ? from : to;
      const selected = previewing ? iso === lo || iso === hi : iso === start || iso === end;
      return {
        outside: cell.outside,
        today: cell.today,
        selected,
        "in-range": !!(lo && hi && iso > lo && iso < hi),
        "range-start": !!(lo && hi && iso === lo && lo !== hi),
        "range-end": !!(lo && hi && iso === hi && lo !== hi),
      };
    },
    pickDate(iso) {
      if (this.datePickerOpen === "start") {
        this.logStart = iso;
        if (this.logStart && this.logEnd && this.logStart > this.logEnd) {
          const tmp = this.logStart;
          this.logStart = this.logEnd;
          this.logEnd = tmp;
        }
        if (!this.logEnd) {
          this.datePickerOpen = "end";
          this.calHoverIso = "";
          return;
        }
      } else if (this.datePickerOpen === "end") {
        this.logEnd = iso;
        if (this.logStart && this.logEnd && this.logStart > this.logEnd) {
          const tmp = this.logStart;
          this.logStart = this.logEnd;
          this.logEnd = tmp;
        }
      }
      this.closeDatePicker();
    },
    calPickToday() {
      this.pickDate(this._todayIso());
    },
    calClear() {
      if (this.datePickerOpen === "start") this.logStart = "";
      else if (this.datePickerOpen === "end") this.logEnd = "";
    },

    /* 日期按管理员本地日历日换算成 UTC 瞬时：结束日期取次日零点（后端上界开区间） */
    _logFilterParams() {
      const params = new URLSearchParams();
      if (this.logCode.trim()) params.set("code", this.logCode.trim());
      if (this.logToolId.trim()) params.set("tool_id", this.logToolId.trim());
      if (this.logModel.trim()) params.set("model", this.logModel.trim());
      if (this.logProvider.trim()) params.set("provider", this.logProvider.trim());
      if ((this.logDevice || "").trim()) params.set("device", this.logDevice.trim());
      if (this.logsStatusFilter) params.set("status", this.logsStatusFilter);
      const start = this.logStart ? new Date(`${this.logStart}T00:00:00`) : null;
      if (start && !Number.isNaN(start.getTime())) params.set("start", start.toISOString());
      if (this.logEnd) {
        const end = new Date(`${this.logEnd}T00:00:00`);
        if (!Number.isNaN(end.getTime())) {
          end.setDate(end.getDate() + 1);
          params.set("end", end.toISOString());
        }
      }
      return params;
    },

    openLogsTab() {
      this.loadLogs();
      this.loadPayloadFlag();
    },

    async loadLogs() {
      try {
        const params = this._logFilterParams();
        params.set("page", String(this.logsPage));
        params.set("page_size", String(this.logsPageSize));
        const data = await this.api(`/api/admin/logs?${params}`);
        this.logs = data.items || [];
        this.logsTotal = data.total || 0;
        // 清理后当前页可能已超出末页（返回空列表但 total 正常），收敛页码重查
        const maxPage = Math.max(1, Math.ceil(this.logsTotal / this.logsPageSize));
        if (this.logsPage > maxPage) {
          this.logsPage = maxPage;
          return this.loadLogs();
        }
      } catch (e) {
        this.toast(e.message || "加载日志失败", "error");
      }
      await this.loadLogSummary();
    },

    async loadLogSummary() {
      try {
        const params = this._logFilterParams();
        this.logSummary = await this.api(`/api/admin/logs/summary?${params}`);
      } catch (e) {
        this.logSummary = {};
      }
    },

    async loadPayloadFlag() {
      try {
        const data = await this.api("/api/admin/config");
        this.payloadRecording = /^(1|true|yes|on)$/i.test(String(data.config?.log_payload ?? ""));
      } catch {
        this.payloadRecording = null;
      }
    },

    resetLogFilters() {
      this.logCode = "";
      this.logToolId = "";
      this.logModel = "";
      this.logProvider = "";
      this.logDevice = "";
      this.logsStatusFilter = "";
      this.logStart = "";
      this.logEnd = "";
      this.closeDatePicker();
      this.logsPage = 1;
      this.loadLogs();
    },

    async openLogDetail(id) {
      this.logDetail = null;
      this.logDetailError = "";
      this.logDetailLoading = true;
      this.logDetailOpen = true;
      try {
        this.logDetail = await this.api(`/api/admin/logs/${id}`);
      } catch (e) {
        this.logDetailError = e.message || "加载详情失败";
        this.toast(this.logDetailError, "error");
      } finally {
        this.logDetailLoading = false;
      }
    },

    closeLogDetail() {
      this.logDetailOpen = false;
      this.logDetail = null;
      this.logDetailError = "";
    },

    filterByLogCode() {
      if (!this.logDetail) return;
      this.logCode = this.logDetail.code || "";
      this.logsPage = 1;
      this.loadLogs();
    },

    /* ============ 设备指纹 ============ */
    deviceBadgeLabel(l) {
      if (!l) return "—";
      const d = l.device;
      if (d) return d.note || d.auto_name || d.short_code || "—";
      if (l.fingerprint) return `${String(l.fingerprint).slice(0, 8)}…`;
      return "—";
    },

    deviceTitle(l) {
      if (!l) return "";
      const d = l.device;
      if (d) {
        return `${d.note || d.auto_name || d.short_code} · ${d.short_code}${d.device_summary ? ` · ${d.device_summary}` : ""}`;
      }
      return l.fingerprint || "";
    },

    filterByLogDevice() {
      if (!this.logDetail || !this.logDetail.device) return;
      const d = this.logDetail.device;
      this.logDevice = d.short_code || String(d.id);
      this.logsPage = 1;
      this.closeLogDetail();
      this.tab = "logs";
      this.loadLogs();
    },

    openDeviceLogs(d) {
      if (!d) return;
      this.logDevice = d.short_code || String(d.id);
      this.logsPage = 1;
      this.tab = "logs";
      this.closeDeviceDetail();
      this.openLogsTab();
    },

    /* ============ 设备画像 ============ */
    async openDeviceDetail(d) {
      if (!d || d.id == null) return;
      this.deviceDetail = null;
      this.deviceDetailError = "";
      this.deviceDetailLoading = true;
      this.deviceDetailOpen = true;
      try {
        this.deviceDetail = await this.api(`/api/admin/devices/${d.id}`);
      } catch (e) {
        this.deviceDetailError = e.message || "加载设备画像失败";
        this.toast(this.deviceDetailError, "error");
      } finally {
        this.deviceDetailLoading = false;
      }
    },

    closeDeviceDetail() {
      this.deviceDetailOpen = false;
      this.deviceDetail = null;
      this.deviceDetailError = "";
    },

    openDeviceDetailFromLog() {
      if (!this.logDetail || !this.logDetail.device) return;
      const d = this.logDetail.device;
      this.closeLogDetail();
      this.openDeviceDetail(d);
    },

    async openLogFromDevice(logId) {
      if (logId == null) return;
      this.closeDeviceDetail();
      await this.openLogDetail(logId);
    },

    openDeviceEditorFromDetail() {
      if (!this.deviceDetail || !this.deviceDetail.device) return;
      const d = this.deviceDetail.device;
      this.closeDeviceDetail();
      this.openDeviceEditor(d);
    },

    async copyDeviceProfileText() {
      const det = this.deviceDetail;
      if (!det || !det.device) return;
      const d = det.device;
      const st = det.stats || {};
      const lines = [
        `设备画像：${d.note || d.auto_name || d.short_code}（${d.short_code}）`,
        `指纹：${d.fingerprint || "—"}`,
        `首次出现：${this.fmtTime(d.first_seen_at)}`,
        `末次活跃：${this.fmtTime(d.last_seen_at)} · 上报 ${d.seen_count ?? "—"} 次 · 活跃 ${st.active_days ?? "—"} 天`,
        `请求：${st.total_logs ?? "—"} 次（成功 ${st.success ?? 0} / 停止 ${st.cancelled ?? 0} / 异常 ${st.error ?? 0}）`,
        "",
        ...((det.profile || []).map((p) => `${p.label}：${p.value}`)),
        "",
        `关联使用码（${(det.codes || []).length}）：${(det.codes || []).map((c) => `${c.code}×${c.count}`).join("、") || "—"}`,
        `IP（${(det.ips || []).length}）：${(det.ips || []).map((x) => `${x.ip}×${x.count}`).join("、") || "—"}`,
        `常用工具：${(det.tools || []).map((t) => `${t.tool_name || t.tool_id}×${t.count}`).join("、") || "—"}`,
        `常用模型：${(det.models || []).map((m) => `${m.model}×${m.count}`).join("、") || "—"}`,
      ];
      if ((det.signals || []).length) {
        lines.push("", "风险提示（仅供参考）：", ...det.signals.map((s) => `· ${s}`));
      }
      await this.copyText(lines.join("\n"));
    },

    async loadDevices() {
      try {
        const params = new URLSearchParams({
          page: String(this.devicesPage),
          page_size: String(this.devicesPageSize),
        });
        if ((this.deviceQuery || "").trim()) params.set("q", this.deviceQuery.trim());
        const data = await this.api(`/api/admin/devices?${params}`);
        this.devices = data.items || [];
        this.devicesTotal = data.total || 0;
        const maxPage = Math.max(1, Math.ceil(this.devicesTotal / this.devicesPageSize));
        if (this.devicesPage > maxPage) {
          this.devicesPage = maxPage;
          return this.loadDevices();
        }
      } catch (e) {
        this.toast(e.message || "加载设备失败", "error");
      }
    },

    openDeviceEditor(d) {
      if (!d) return;
      this.deviceForm = {
        id: d.id,
        short_code: d.short_code || "",
        auto_name: d.auto_name || "",
        note: d.note || "",
        color: d.color || "",
      };
      this.savingDevice = false;
      this.deviceModalOpen = true;
    },

    get devicePreviewColor() {
      const c = (this.deviceForm.color || "").trim();
      if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return c;
      return "";
    },

    async saveDeviceEditor() {
      const f = this.deviceForm;
      if (!f.id) return;
      const color = (f.color || "").trim();
      if (color && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
        this.toast("颜色格式不合法，请点选色板或输入 #rrggbb", "error");
        return;
      }
      this.savingDevice = true;
      try {
        const updated = await this.api(`/api/admin/devices/${f.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: (f.note || "").trim(), color }),
        });
        const target = this.devices.find((x) => x.id === f.id);
        if (target) Object.assign(target, updated);
        // 日志列表与详情中同设备的徽章同步刷新
        for (const l of this.logs) {
          if (l.device && l.device.id === f.id) Object.assign(l.device, updated);
        }
        if (this.logDetail && this.logDetail.device && this.logDetail.device.id === f.id) {
          Object.assign(this.logDetail.device, updated);
        }
        if (this.deviceDetail && this.deviceDetail.device && this.deviceDetail.device.id === f.id) {
          Object.assign(this.deviceDetail.device, updated);
        }
        this.deviceModalOpen = false;
        this.toast("设备已更新");
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      } finally {
        this.savingDevice = false;
      }
    },

    async copyLogSummaryText() {
      const l = this.logDetail;
      if (!l) return;
      const text = [
        `日志 #${l.id}`,
        `时间：${this.fmtTime(l.created_at)}`,
        `使用码：${l.code}`,
        `工具：${l.tool_name || "—"}（ID ${l.tool_id || "—"}）`,
        `模型：${l.model || "—"}`,
        `Provider：${l.provider_name ? `${l.provider_name} (${l.provider_id})` : (l.provider_id || "—")}  尝试 ${l.fallback_attempts ?? "—"} 次`,
        `状态：${this.logStatusLabel(l.status)}`,
        `耗时：${this.fmtDuration(l.duration_ms)}`,
        `Tokens：输入 ${l.prompt_tokens ?? "—"} / 输出 ${l.completion_tokens ?? "—"} / 合计 ${l.total_tokens ?? "—"}${l.tokens_estimated ? "（估算值）" : ""}`,
        `扣费：${this.fmtUnits(l.units)}`,
        `IP：${l.ip || "—"}`,
        `UA：${l.user_agent || "—"}`,
        `设备：${l.device ? `${l.device.note || l.device.auto_name || l.device.short_code}（${l.device.short_code}）` : "—"}`,
        `请求 ID：${l.request_id || "—"}`,
        l.error_message ? `错误信息：${l.error_message}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await this.copyText(text);
    },

    async purgeLogs() {
      const input = Number(this.purgeDays);
      const useConfig = this.purgeDays === null || this.purgeDays === "" || !Number.isFinite(input);
      const days = Math.max(0, Math.floor(useConfig ? Number(this.configForm.log_retention_days) || 0 : input));
      if (days <= 0) {
        this.toast("保留天数为 0 表示永久保留，不会删除任何日志", "error");
        return;
      }
      if (!confirm(`将永久删除 ${days} 天之前的全部使用日志（含原始输入/输出），此操作不可恢复。\n\n确定继续吗？`)) {
        return;
      }
      this.purging = true;
      try {
        const data = await this.api("/api/admin/logs/purge", {
          method: "POST",
          body: JSON.stringify({ days }),
        });
        this.toast(`已清理 ${data.deleted} 条日志`);
        await Promise.all([this.loadLogs(), this.loadStats()]);
      } catch (e) {
        this.toast(e.message || "清理失败", "error");
      } finally {
        this.purging = false;
      }
    },

    async loadConfig() {
      try {
        const data = await this.api("/api/admin/config");
        const cfg = data.config || {};
        this.configForm = {
          default_model: cfg.default_model || "",
          models: Array.isArray(cfg.models)
            ? cfg.models.map((m) => ({
                id: m.id || "",
                name: m.name && m.name !== m.id ? m.name : "",
                description: m.description || "",
                score: m.score ?? null,
                reasoning_effort: m.reasoning_effort || null,
                thinking_budget: m.thinking_budget || null,
                chores_only: !!m.chores_only,
                enabled: m.enabled !== false,
              }))
            : [],
          chores_model: cfg.chores_model || "",
          max_tokens: Number(cfg.max_tokens) || 4096,
          timeout: Number(cfg.timeout) || 120,
          log_payload: /^(1|true|yes|on)$/i.test(String(cfg.log_payload ?? "")),
          log_retention_days: Number(cfg.log_retention_days) || 0,
        };
        this.payloadRecording = this.configForm.log_payload;
        // 多 Provider 聚合
        this.providers = Array.isArray(data.providers) ? data.providers : [];
        this.modelProviderMap = data.model_provider_map && typeof data.model_provider_map === 'object' ? data.model_provider_map : {};
        this.modelProviderDetails = data.model_provider_details && typeof data.model_provider_details === 'object' ? data.model_provider_details : {};
        // 兼容旧接口：若没有 providers 则尝试从 /model-providers 拉取
        if (!this.providers.length || !Object.keys(this.modelProviderMap).length) {
          try {
            const mp = await this.api("/api/admin/model-providers");
            if (!this.providers.length && Array.isArray(mp.providers)) this.providers = mp.providers;
            if (!Object.keys(this.modelProviderMap).length && mp.map) this.modelProviderMap = mp.map;
            if (!Object.keys(this.modelProviderDetails).length && mp.details) this.modelProviderDetails = mp.details;
          } catch {}
        }
        // 若 details 缺失则从 map 构造默认（provider_model_id 回退为逻辑 id）
        if (!Object.keys(this.modelProviderDetails).length && Object.keys(this.modelProviderMap).length) {
          for (const mid in this.modelProviderMap) {
            this.modelProviderDetails[mid] = (this.modelProviderMap[mid] || []).map(pid => ({ provider_id: pid, provider_model_id: mid, priority: 0 }));
          }
        }
      } catch (e) {
        this.toast(e.message || "加载配置失败", "error");
      }
    },

    /* ============ 模型管理 ============ */
    scoreColor(score) {
      if (score == null || !Number.isFinite(Number(score))) return "";
      const s = Math.max(0, Math.min(10, Number(score)));
      return `hsl(${Math.round(s * 12)} 85% 45%)`;
    },
    thinkingLabel(m) {
      if (m.thinking_budget) return `预算 ${m.thinking_budget} tokens`;
      const opt = this.thinkingModes.find((o) => o.id === m.reasoning_effort);
      return opt ? opt.label : "跟随模型默认";
    },
    thinkingModeLabel(mode) {
      const opt = this.thinkingModes.find((o) => o.id === mode);
      return opt ? opt.label : "跟随模型默认";
    },
    thinkingModeHint(mode) {
      const opt = this.thinkingModes.find((o) => o.id === mode);
      return opt ? opt.hint : "";
    },

    openAddModel() {
      this.modelModalIndex = null;
      this.modelForm = { id: "", name: "", description: "", score: null, mode: "default", thinking_budget: null, chores_only: false, enabled: true };
      this.thinkingMenuOpen = false;
      this.modelModalOpen = true;
    },

    openEditModel(i) {
      const m = this.configForm.models[i];
      if (!m) return;
      this.modelModalIndex = i;
      this.modelForm = {
        id: m.id,
        name: m.name || "",
        description: m.description || "",
        score: m.score ?? null,
        mode: m.thinking_budget ? "budget" : m.reasoning_effort || "default",
        thinking_budget: m.thinking_budget || null,
        chores_only: !!m.chores_only,
        enabled: m.enabled !== false,
      };
      this.thinkingMenuOpen = false;
      this.modelModalOpen = true;
    },

    async saveModelModal() {
      const id = (this.modelForm.id || "").trim();
      if (!id) {
        this.toast("模型 ID 不能为空", "error");
        return;
      }
      const dupIndex = this.configForm.models.findIndex((m) => m.id === id);
      if (dupIndex !== -1 && dupIndex !== this.modelModalIndex) {
        this.toast("该模型 ID 已在列表中", "error");
        return;
      }
      const mode = this.modelForm.mode;
      if (mode === "budget") {
        const budget = parseInt(this.modelForm.thinking_budget, 10);
        if (!Number.isFinite(budget) || budget < 1) {
          this.toast("请填写有效的思考 Token 预算", "error");
          return;
        }
      }
      const score = this.modelForm.score;
      if (score != null && (score === "" || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10)) {
        this.toast("推荐评分需为 0 到 10 之间的数字，留空则不展示", "error");
        return;
      }
      const chordsOnly = !!this.modelForm.chores_only;
      const enabled = this.modelForm.enabled !== false;
      const editingOldId = this.modelModalIndex !== null ? this.configForm.models[this.modelModalIndex].id : null;
      const targetId = id;
      if (chordsOnly && targetId && this.configForm.default_model === targetId) {
        this.toast("默认模型不可设为仅 Chores，请先切换默认模型", "error");
        return;
      }
      if (!enabled && targetId && this.configForm.default_model === targetId) {
        this.toast("默认模型不可直接禁用，请先切换默认模型", "error");
        return;
      }
      if (!enabled && targetId && this.configForm.chores_model === targetId) {
        this.toast("该模型正被用作 Chores 模型，请先切换 Chores 模型再禁用", "error");
        return;
      }
      const entry = {
        id,
        name: (this.modelForm.name || "").trim(),
        description: (this.modelForm.description || "").trim(),
        score: this.modelForm.score,
        reasoning_effort: mode !== "default" && mode !== "budget" ? mode : null,
        thinking_budget: mode === "budget" ? parseInt(this.modelForm.thinking_budget, 10) : null,
        chores_only: chordsOnly,
        enabled,
      };
      const oldId =
        this.modelModalIndex !== null ? this.configForm.models[this.modelModalIndex].id : null;
      if (this.modelModalIndex === null) {
        this.configForm.models.push(entry);
      } else {
        this.configForm.models.splice(this.modelModalIndex, 1, entry);
        if (oldId && this.configForm.default_model === oldId) {
          this.configForm.default_model = id;
        }
        if (oldId && this.configForm.chores_model === oldId) {
          this.configForm.chores_model = id;
        }
      }
      if (!this.configForm.default_model && !chordsOnly && enabled) this.configForm.default_model = id;
      this.modelModalOpen = false;
      // 自动保存，无需用户再点保存配置即可绑定 Provider
      try {
        await this.saveConfig();
      } catch (e) {
        // saveConfig 已 toast
      }
    },

    removeModel(i) {
      const m = this.configForm.models[i];
      if (!m) return;
      if (!confirm(`确定从列表移除模型「${m.name || m.id}」？`)) return;
      this.configForm.models.splice(i, 1);
      if (this.configForm.default_model === m.id) {
        const next = this.configForm.models.find(x => !x.chores_only && x.enabled !== false) || this.configForm.models[0];
        this.configForm.default_model = next?.id || "";
      }
      if (this.configForm.chores_model === m.id) {
        this.configForm.chores_model = "";
      }
    },

    moveModel(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= this.configForm.models.length) return;
      const arr = this.configForm.models;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    },

    /* ============ 模型拖拽排序 ============ */
    startModelDrag(i, e) {
      this.dragIndex = i;
      this.dragOverIndex = null;
      this.dragOverBefore = false;
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      }
    },

    endModelDrag() {
      this.dragIndex = null;
      this.dragOverIndex = null;
      this.dragOverBefore = false;
    },

    dragModelOver(i, e) {
      if (this.dragIndex === null || i === this.dragIndex) return;
      this.dragOverIndex = i;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      this.dragOverBefore = e.clientY < rect.top + rect.height / 2;
    },

    dragLeaveModel() {
      if (this.dragIndex !== null) this.dragOverIndex = null;
    },

    dropModel() {
      const from = this.dragIndex;
      const to = this.dragOverIndex;
      if (from === null || to === null || from === to) {
        this.endModelDrag();
        return;
      }
      const arr = this.configForm.models;
      const [moved] = arr.splice(from, 1);
      const shifted = to > from ? to - 1 : to;
      const insertAt = this.dragOverBefore ? shifted : shifted + 1;
      arr.splice(insertAt, 0, moved);
      this.endModelDrag();
    },

    setDefaultModel(id) {
      const m = this.configForm.models.find(x => x.id === id);
      if (m && m.chores_only) {
        this.toast("仅 Chores 模型不可设为默认", "error");
        return;
      }
      if (m && m.enabled === false) {
        this.toast("已禁用模型不可设为默认，请先启用", "error");
        return;
      }
      this.configForm.default_model = id;
    },

    async toggleModelEnabled(i) {
      const m = this.configForm.models[i];
      if (!m) return;
      const nextEnabled = m.enabled === false;
      if (!nextEnabled) {
        if (this.configForm.default_model === m.id) {
          this.toast("默认模型不可直接禁用，请先切换默认模型", "error");
          return;
        }
        if (this.configForm.chores_model === m.id) {
          this.toast("该模型正被用作 Chores 模型，请先切换 Chores 模型再禁用", "error");
          return;
        }
      }
      m.enabled = nextEnabled;
      try {
        await this.saveConfig();
      } catch (e) {
        // saveConfig 已 toast，失败时回滚本地状态
        m.enabled = !nextEnabled;
      }
    },

    async saveConfig() {
      if (!this.configForm.models.length) {
        this.toast("模型列表不能为空，请至少添加一个模型", "error");
        return;
      }
      if (this.defaultModelMissing || !this.configForm.default_model) {
        this.toast("请从模型列表中选择默认模型", "error");
        return;
      }
      const defaultHit = this.configForm.models.find(m => m.id === this.configForm.default_model);
      if (defaultHit && defaultHit.chores_only) {
        this.toast("默认模型不可为仅 Chores 模型", "error");
        return;
      }
      if (defaultHit && defaultHit.enabled === false) {
        this.toast("默认模型已禁用，请先切换默认模型再保存", "error");
        return;
      }
      if (this.configForm.chores_model) {
        const cm = this.configForm.models.find(m => m.id === this.configForm.chores_model);
        if (!cm) {
          this.toast("Chores 模型不存在于模型列表", "error");
          return;
        }
        if (cm.enabled === false) {
          this.toast("Chores 模型已禁用，请先切换 Chores 模型再保存", "error");
          return;
        }
      }
      this.savingConfig = true;
      try {
        const body = {
          default_model: this.configForm.default_model,
          chores_model: this.configForm.chores_model || "",
          max_tokens: this.configForm.max_tokens,
          timeout: this.configForm.timeout,
          log_payload: !!this.configForm.log_payload,
          log_retention_days: Math.max(0, Math.floor(Number(this.configForm.log_retention_days) || 0)),
          models: this.configForm.models.map((m) => ({
            id: m.id,
            name: m.name || "",
            description: m.description || "",
            score: m.score ?? null,
            reasoning_effort: m.reasoning_effort || null,
            thinking_budget: m.thinking_budget || null,
            chores_only: !!m.chores_only,
            enabled: m.enabled !== false,
          })),
        };
        await this.api("/api/admin/config", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        this.toast("配置已保存");
        await this.loadConfig();
      } catch (e) {
        this.toast(e.message || "保存失败", "error");
      } finally {
        this.savingConfig = false;
      }
    },

    /* ============ MinerU 文档解析 ============ */
    async loadMineru() {
      try {
        const data = await this.api("/api/admin/mineru");
        this.parseConfig = {
          mode: data.mode === "agent" ? "agent" : "precision",
          model: data.model === "vlm" ? "vlm" : "pipeline",
          has_token: !!data.has_token,
          token_masked: data.token_masked || "",
        };
        this.parseTokenInput = "";
      } catch (e) {
        this.toast(e.message || "加载文档解析配置失败", "error");
      }
    },
    async testMineru() {
      if (this.testingMineru) return;
      this.testingMineru = true;
      try {
        const data = await this.api("/api/admin/mineru/test", { method: "POST" });
        this.toast(`Token 有效（${data.latency_ms ?? "?"}ms）`);
      } catch (e) {
        this.toast(e.message || "Token 测试失败", "error");
      } finally {
        this.testingMineru = false;
      }
    },
    async saveMineru() {
      if (this.savingMineru) return;
      const mode = this.parseConfig.mode === "agent" ? "agent" : "precision";
      const model = this.parseConfig.model === "vlm" ? "vlm" : "pipeline";
      // 精准模式前端拦截：无 token 且未填写 → 提示先填写并测试
      if (mode === "precision" && !this.parseConfig.has_token && !(this.parseTokenInput || "").trim()) {
        this.toast("精准解析 API 需要填写 MinerU Token，请填写并通过测试后再保存", "error");
        return;
      }
      this.savingMineru = true;
      try {
        const body = { mode, model };
        const tokenIn = (this.parseTokenInput || "").trim();
        if (tokenIn) body.token = tokenIn;
        const data = await this.api("/api/admin/mineru", { method: "PUT", body: JSON.stringify(body) });
        this.parseConfig = {
          mode: data.mode === "agent" ? "agent" : "precision",
          model: data.model === "vlm" ? "vlm" : "pipeline",
          has_token: !!data.has_token,
          token_masked: data.token_masked || "",
        };
        this.parseTokenInput = "";
        this.toast("文档解析配置已保存");
      } catch (e) {
        this.toast(e.message || "保存失败", "error");
      } finally {
        this.savingMineru = false;
      }
    },

    /* ============ Provider 聚合 ============ */
    providerHasKey(id) {
      const p = this.providersById[id];
      return !!(p && p.has_api_key);
    },
    providerBoundCount(providerId) {
      let n = 0;
      for (const mid in this.modelProviderMap) {
        if ((this.modelProviderMap[mid] || []).includes(providerId)) n++;
      }
      return n;
    },
    openAddProvider() {
      this.providerForm = { id: "", name: "", base_url: "", api_key: "", enabled: true };
      this.providerModalOpen = true;
    },
    openEditProvider(p) {
      this.providerForm = { id: p.id, name: p.name || "", base_url: p.base_url || "", api_key: p.api_key || "", enabled: !!p.enabled };
      this.providerModalOpen = true;
    },
    async saveProviderModal() {
      const name = (this.providerForm.name || "").trim();
      if (!name) { this.toast("Provider 名称不能为空", "error"); return; }
      const baseUrl = (this.providerForm.base_url || "").trim();
      if (baseUrl && !/^https?:\/\//.test(baseUrl)) { this.toast("Base URL 必须以 http:// 或 https:// 开头", "error"); return; }
      this.savingProvider = true;
      try {
        if (this.providerForm.id) {
          const body = { name, base_url: baseUrl, enabled: !!this.providerForm.enabled };
          if (this.providerForm.api_key && !this.providerForm.api_key.includes("****")) body.api_key = this.providerForm.api_key;
          else if (!this.providerForm.api_key) body.api_key = "";
          // 若包含 **** 则不传 api_key，保持原密钥
          if (body.api_key === undefined || (typeof this.providerForm.api_key === 'string' && this.providerForm.api_key.includes("****"))) {
            delete body.api_key;
          }
          await this.api(`/api/admin/providers/${this.providerForm.id}`, { method: "PATCH", body: JSON.stringify(body) });
          this.toast("Provider 已更新");
        } else {
          await this.api("/api/admin/providers", { method: "POST", body: JSON.stringify({ name, base_url: baseUrl, api_key: (this.providerForm.api_key || "").trim(), enabled: !!this.providerForm.enabled }) });
          this.toast("Provider 已添加");
        }
        this.providerModalOpen = false;
        await this.loadConfig();
      } catch (e) { this.toast(e.message || "保存失败", "error"); }
      finally { this.savingProvider = false; }
    },
    async removeProvider(p) {
      if (!confirm(`确定删除 Provider「${p.name}」(${p.id})？该 Provider 在所有模型的绑定将被同步移除。`)) return;
      try {
        await this.api(`/api/admin/providers/${p.id}`, { method: "DELETE" });
        this.toast("已删除");
        await this.loadConfig();
      } catch (e) { this.toast(e.message || "删除失败", "error"); }
    },
    async toggleProviderEnabled(p) {
      try {
        await this.api(`/api/admin/providers/${p.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !p.enabled }) });
        p.enabled = !p.enabled;
        this.toast(p.enabled ? "已启用" : "已禁用");
      } catch (e) { this.toast(e.message || "更新失败", "error"); }
    },
    openTestProvider(p) {
      const pid = p.id;
      const bound = [];
      for (const mid in this.modelProviderDetails) {
        const arr = this.modelProviderDetails[mid] || [];
        const hit = arr.find(b => b.provider_id === pid);
        if (hit) {
          const m = this.configForm.models.find(x => x.id === mid);
          bound.push({ id: mid, name: m ? (m.name || m.id) : mid, provider_model_id: hit.provider_model_id || mid });
        }
      }
      let defaultModel = "";
      let defaultProviderModelId = "";
      if (bound.length) {
        defaultModel = bound[0].id;
        defaultProviderModelId = bound[0].provider_model_id;
      } else if (this.configForm.models.length) {
        defaultModel = this.configForm.models[0].id;
        defaultProviderModelId = defaultModel;
      }
      this.providerTestForm = { providerId: pid, model: defaultModel, provider_model_id: defaultProviderModelId, prompt: "Hello" };
      this.providerTestModelMenuOpen = false;
      this.providerTestModalOpen = true;
    },
    onProviderTestModelChange(modelId) {
      this.providerTestForm.model = modelId;
      const pid = this.providerTestForm.providerId;
      const details = this.modelProviderDetails[modelId] || [];
      const hit = details.find(b => b.provider_id === pid);
      this.providerTestForm.provider_model_id = hit ? (hit.provider_model_id || modelId) : modelId;
      this.providerTestModelMenuOpen = false;
    },
    get providerTestModels() {
      const pid = this.providerTestForm.providerId;
      if (!pid) return [];
      const bound = [];
      for (const mid in this.modelProviderDetails) {
        const arr = this.modelProviderDetails[mid] || [];
        const hit = arr.find(b => b.provider_id === pid);
        if (hit) {
          const m = this.configForm.models.find(x => x.id === mid);
          bound.push({ id: mid, name: m ? (m.name || m.id) : mid, provider_model_id: hit.provider_model_id || mid });
        }
      }
      if (bound.length) return bound;
      return this.configForm.models.map(m => ({ id: m.id, name: m.name || m.id, provider_model_id: m.id }));
    },
    async confirmTestProvider() {
      const f = this.providerTestForm;
      if (!f.providerId) return;
      const model = (f.model || "").trim();
      if (!model) { this.toast("请选择测试模型", "error"); return; }
      const provider_model_id = (f.provider_model_id || "").trim() || model;
      const prompt = (f.prompt || "").trim() || "Hello";
      this.testingProviderId = f.providerId;
      try {
        const data = await this.api(`/api/admin/providers/${f.providerId}/test`, { method: "POST", body: JSON.stringify({ model, provider_model_id, prompt }) });
        this.toast(`测试成功（${data.latency_ms}ms）[${data.provider_model_id}]: ${(data.output || "").slice(0,80)}`, "ok");
      } catch (e) { this.toast(e.message || "测试失败", "error"); }
      finally { this.testingProviderId = null; }
    },
    // 兼容旧调用（若有外部直接调 testProvider）
    async testProvider(p) { this.openTestProvider(p); },

    /* ============ 模型 Provider 绑定（每模型独立优先级 + per-provider model id） ============ */
    openModelProviders(modelId) {
      const m = this.configForm.models.find(x => x.id === modelId);
      this.modelProvidersModelId = modelId;
      this.modelProvidersModelName = m ? (m.name || m.id) : modelId;
      const details = this.modelProviderDetails[modelId] || [];
      // details 为 [{provider_id, provider_model_id}]
      this.modelProvidersOrdered = details.map(d => ({ provider_id: d.provider_id, provider_model_id: d.provider_model_id || modelId }));
      // 兼容旧 map 若 details 为空但 map 有
      if (!this.modelProvidersOrdered.length && (this.modelProviderMap[modelId] || []).length) {
        this.modelProvidersOrdered = (this.modelProviderMap[modelId] || []).map(pid => ({ provider_id: pid, provider_model_id: modelId }));
      }
      this.modelProvidersDragIndex = null;
      this.modelProvidersDragOverIndex = null;
      this.modelProvidersModalOpen = true;
    },
    toggleModelProvider(pid) {
      const idx = this.modelProvidersOrdered.findIndex(o => o.provider_id === pid);
      if (idx === -1) this.modelProvidersOrdered.push({ provider_id: pid, provider_model_id: this.modelProvidersModelId });
      else this.modelProvidersOrdered.splice(idx, 1);
    },
    isProviderSelected(pid) {
      return this.modelProvidersOrdered.some(o => o.provider_id === pid);
    },
    async saveModelProvidersModal() {
      if (!this.modelProvidersModelId) return;
      // 校验 provider_model_id 非空且长度
      for (const b of this.modelProvidersOrdered) {
        const pmid = (b.provider_model_id || "").trim();
        if (!pmid) { this.toast("Provider 模型 ID 不能为空", "error"); return; }
        if (pmid.length > 256) { this.toast("Provider 模型 ID 过长", "error"); return; }
      }
      this.savingModelProviders = true;
      try {
        const bindings = this.modelProvidersOrdered.map(o => ({ provider_id: o.provider_id, provider_model_id: (o.provider_model_id || "").trim() || this.modelProvidersModelId }));
        await this.api(`/api/admin/models/${encodeURIComponent(this.modelProvidersModelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ bindings }),
        });
        // 本地更新 map 与 details
        const pids = bindings.map(b => b.provider_id);
        this.modelProviderMap[this.modelProvidersModelId] = [...pids];
        this.modelProviderDetails[this.modelProvidersModelId] = bindings.map((b, i) => ({ provider_id: b.provider_id, provider_model_id: b.provider_model_id, priority: i }));
        this.modelProviderMap = { ...this.modelProviderMap };
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProvidersModalOpen = false;
        this.toast("优先级已保存");
      } catch (e) { this.toast(e.message || "保存失败", "error"); }
      finally { this.savingModelProviders = false; }
    },
    startModelProvidersDrag(idx, e) {
      this.modelProvidersDragIndex = idx;
      this.modelProvidersDragOverIndex = null;
      if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }
    },
    endModelProvidersDrag() {
      this.modelProvidersDragIndex = null;
      this.modelProvidersDragOverIndex = null;
    },
    dragModelProvidersOver(idx, e) {
      if (this.modelProvidersDragIndex === null || idx === this.modelProvidersDragIndex) return;
      this.modelProvidersDragOverIndex = idx;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
    },
    dropModelProviders() {
      const from = this.modelProvidersDragIndex;
      const to = this.modelProvidersDragOverIndex;
      if (from === null || to === null || from === to) { this.endModelProvidersDrag(); return; }
      const arr = this.modelProvidersOrdered;
      const [moved] = arr.splice(from, 1);
      const insertAt = to > from ? to : to;
      // 根据拖拽方向决定插入前后：简化为插入到目标位置之前
      // 若拖动时从上往下，目标索引已因 splice 前移一位，处理与模型拖拽一致
      const shifted = to > from ? to - 1 : to;
      arr.splice(shifted, 0, moved);
      // 若是直接 drop 到目标项上（未计算 before/after），上面 shifted 逻辑已处理
      // 为兼容未精确 before/after 的情况，若 from<to 则把 moved 放到 shifted+1
      // 这里保持简单：若 from<to 则已在 shifted，符合前移预期
      this.endModelProvidersDrag();
    },

    /* 模型表格内 Provider 拖拽（每模型独立） */
    startProviderDrag(modelId, idx, e) {
      this.providerDragModelId = modelId;
      this.providerDragIndex = idx;
      this.providerDragOverIndex = null;
      if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }
    },
    endProviderDrag() {
      this.providerDragModelId = null;
      this.providerDragIndex = null;
      this.providerDragOverIndex = null;
    },
    dragProviderOver(modelId, idx, e) {
      if (this.providerDragModelId !== modelId || this.providerDragIndex === null || idx === this.providerDragIndex) return;
      this.providerDragOverIndex = idx;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
    },
    dragLeaveProvider() {
      if (this.providerDragModelId !== null) this.providerDragOverIndex = null;
    },
    async dropProvider(modelId) {
      const from = this.providerDragIndex;
      const to = this.providerDragOverIndex;
      const mid = this.providerDragModelId;
      if (from === null || to === null || mid !== modelId || from === to) { this.endProviderDrag(); return; }
      // 优先操作 details（含 provider_model_id），回退到 map
      const srcDetails = this.modelProviderDetails[modelId];
      if (srcDetails && srcDetails.length) {
        const arr = [...srcDetails];
        const [moved] = arr.splice(from, 1);
        const shifted = to > from ? to - 1 : to;
        arr.splice(shifted, 0, moved);
        this.modelProviderDetails[modelId] = arr;
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProviderMap[modelId] = arr.map(o => o.provider_id);
        this.modelProviderMap = { ...this.modelProviderMap };
        this.endProviderDrag();
        try {
          const bindings = arr.map(o => ({ provider_id: o.provider_id, provider_model_id: o.provider_model_id || modelId }));
          await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
            method: "PUT",
            body: JSON.stringify({ bindings }),
          });
          this.toast("优先级已更新");
        } catch (e) { this.toast(e.message || "保存优先级失败", "error"); await this.loadConfig(); }
        return;
      }
      const arr = [...(this.modelProviderMap[modelId] || [])];
      const [moved] = arr.splice(from, 1);
      const shifted = to > from ? to - 1 : to;
      arr.splice(shifted, 0, moved);
      this.modelProviderMap[modelId] = arr;
      this.modelProviderMap = { ...this.modelProviderMap };
      this.endProviderDrag();
      try {
        await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ ordered_provider_ids: arr }),
        });
        this.toast("优先级已更新");
      } catch (e) { this.toast(e.message || "保存优先级失败", "error"); await this.loadConfig(); }
    },
    async moveProviderInModel(modelId, idx, dir) {
      const details = this.modelProviderDetails[modelId];
      if (details && details.length) {
        const j = idx + dir;
        if (j < 0 || j >= details.length) return;
        const arr = [...details];
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        this.modelProviderDetails[modelId] = arr;
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProviderMap[modelId] = arr.map(o => o.provider_id);
        this.modelProviderMap = { ...this.modelProviderMap };
        try {
          const bindings = arr.map(o => ({ provider_id: o.provider_id, provider_model_id: o.provider_model_id || modelId }));
          await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
            method: "PUT",
            body: JSON.stringify({ bindings }),
          });
          this.toast("优先级已更新");
        } catch (e) { this.toast(e.message || "保存失败", "error"); await this.loadConfig(); }
        return;
      }
      const arr = [...(this.modelProviderMap[modelId] || [])];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      this.modelProviderMap[modelId] = arr;
      this.modelProviderMap = { ...this.modelProviderMap };
      try {
        await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ ordered_provider_ids: arr }),
        });
        this.toast("优先级已更新");
      } catch (e) { this.toast(e.message || "保存失败", "error"); await this.loadConfig(); }
    },
    moveModelProviderOrdered(idx, dir) {
      const j = idx + dir;
      if (j < 0 || j >= this.modelProvidersOrdered.length) return;
      const arr = this.modelProvidersOrdered;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
    },
  };
}
