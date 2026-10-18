/* NeoBangX 动态光影背景引擎
   从 script.js 拆出的自包含模块：首屏不加载，启动后空闲时再拉取。
   只依赖浏览器全局（canvas / matchMedia / requestAnimationFrame），不引用主脚本闭包。 */

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
  const lerp3 = (a, b, k) => {
    a[0] += (b[0] - a[0]) * k;
    a[1] += (b[1] - a[1]) * k;
    a[2] += (b[2] - a[2]) * k;
  };
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
      scale: parseFloat(cs.getPropertyValue("--c-glow-scale")) || 1,
    };
  }
  const cur = readTheme();
  let tgt = readTheme(); // 独立目标值，插值原地更新 cur，避免逐帧分配数组

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

  let canvasDpr = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.floor(innerWidth * dpr), height = Math.floor(innerHeight * dpr);
    if (canvas.width === width && canvas.height === height && canvasDpr === dpr) return false;
    canvasDpr = dpr;
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
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

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      if (resize()) {
        spawn();
        // 画布尺寸变了，媒体查询断点（如手机档的 --c-glow-scale）可能翻转，重读目标值
        tgt = readTheme();
        // 减少动态效果模式没有帧循环，改变画布尺寸后必须补画。
        if (reduced) frame(true);
      }
    });
  }, { passive: true });
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    halo.tx = e.clientX; halo.ty = e.clientY;
  }, { passive: true });
  /* 帧循环暂停：两个独立开关——页面隐藏（visibilitychange）与全屏讲解等
     遮没场景的程序性暂停（suspend/resume），互不覆盖；循环在任一开关置位后
     的下一跳自行退出，两个开关都清除后才重新拉起。 */
  let hiddenPause = document.hidden;
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
    // 只跳过完全离开画布的贴图，运动状态仍照常更新。
    if (x + r <= 0 || y + r <= 0 || x - r >= innerWidth || y - r >= innerHeight) return;
    const r0 = color[0] | 0, g0 = color[1] | 0, b0 = color[2] | 0;
    const key = r0 * 65536 + g0 * 256 + b0;
    const sprite = glowCache.get(key);
    if (sprite) {
      glowCache.delete(key);
      glowCache.set(key, sprite); // LRU：常用颜色留在缓存
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      return;
    }
    const seen = glowSeen.get(key);
    if (seen !== undefined && seen !== frameNo) {
      // 跨帧同色：烘焙精灵，此后在缓存有效期内走贴图
      const s = bakeGlowSprite(r0, g0, b0);
      glowCache.set(key, s);
      // 每张 RGBA 纹理约 256 KiB，最多 64 张，长期切主题也不会无限增长。
      if (glowCache.size > 64) glowCache.delete(glowCache.keys().next().value);
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
    // 保持原插值公式与每帧步长，只复用对象和颜色数组。
    lerp3(cur.g1, tgt.g1, 0.06);
    lerp3(cur.g2, tgt.g2, 0.06);
    lerp3(cur.gm, tgt.gm, 0.06);
    lerp3(cur.p, tgt.p, 0.06);
    lerp3(cur.bird, tgt.bird, 0.06);
    cur.blend = tgt.blend;
    cur.sky += (tgt.sky - cur.sky) * 0.06;
    cur.rays += (tgt.rays - cur.rays) * 0.06;
    cur.stars += (tgt.stars - cur.stars) * 0.06;
    cur.birds += (tgt.birds - cur.birds) * 0.06;
    cur.boost += (tgt.boost - cur.boost) * 0.06;
    cur.scale += (tgt.scale - cur.scale) * 0.06;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = cur.blend === "lighter" ? "lighter" : "source-over";

    if (!staticOnly) stepLights();
    const m = Math.max(W, H);
    glowSpot(lights[0].x, lights[0].y, m * 0.5, cur.g1, 0.09 * cur.boost * cur.scale);
    glowSpot(lights[1].x, lights[1].y, m * 0.46, cur.g2, 0.085 * cur.boost * cur.scale);
    glowSpot(lights[2].x, lights[2].y, m * 0.38, cur.gm, 0.05 * cur.boost * cur.scale);

    if (!staticOnly) {
      halo.x += (halo.tx - halo.x) * 0.07;
      halo.y += (halo.ty - halo.y) * 0.07;
    }
    glowSpot(halo.x, halo.y, 380 + 60 * (cur.boost - 1), cur.gm, 0.12 * cur.boost * cur.scale);
    glowSpot(halo.x, halo.y, 150, cur.gm, 0.06 * cur.boost * cur.scale);

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
        drawCloud(px, py, c.s, cur.p, Math.min(0.55, c.a * cur.sky * (1 + lit * 0.7) * cur.scale));
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
