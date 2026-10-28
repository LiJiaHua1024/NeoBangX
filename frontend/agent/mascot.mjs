/**
 * Clawd, the pixel crab on the composer's top edge — ported from
 * dsh-claude-style@1e7acc5b (features/mascot/{crab.ts,mascot-player.ts,
 * mascot-stage.ts,sheets.ts,crab.css}).
 *
 * The frame tables and frame time are the upstream ones. A sheet is one PNG
 * per animation (body) and one ink mask (laptop, notes, hat); the strip is
 * translated by a WAAPI `steps()` animation, so playback runs on the
 * browser's animation engine rather than a timer. Reduced motion pins the
 * sheet's still frame; a click is then the only thing that moves it.
 */

const FRAME_MS = 80;
const GUTTER = 1;
const TICKLE_GAP_MS = 450;
const TICKLE_CLICKS = 4;
const LIFT_PX = 4;
const SLEEP_AFTER_MS = 60000;
const EXTRA_MIN_MS = 20000;
const EXTRA_SPAN_MS = 20000;

const SHEETS = {
  idle: { frames: 24, box: [24, 20, 24, 16], still: 0 },
  "idle-look": { frames: 31, box: [24, 20, 24, 16], still: 0 },
  "idle-wave": { frames: 12, box: [24, 15, 24, 21], still: 0 },
  "idle-laptop": { frames: 43, box: [14, 13, 34, 23], still: 0 },
  thinking: { frames: 32, box: [14, 4, 34, 32], still: 18 },
  typing: { frames: 6, box: [15, 22, 28, 14], still: 0 },
  music: { frames: 16, box: [22, 1, 30, 35], still: 0 },
  conducting: { frames: 24, box: [24, 12, 27, 24], still: 0 },
  building: { frames: 6, box: [15, 19, 28, 17], still: 0 },
  error: { frames: 24, box: [23, 11, 26, 25], still: 4 },
  happy: { frames: 32, box: [18, 6, 34, 30], still: 3 },
  notification: { frames: 16, box: [24, 8, 24, 28], still: 0 },
  compacting: { frames: 20, box: [21, 20, 30, 16], still: 3 },
  sleeping: { frames: 32, box: [23, 3, 29, 33], still: 0 },
  waking: { frames: 12, box: [24, 4, 24, 32], still: 11 },
  "poke-left": { frames: 10, box: [24, 20, 27, 16], still: 0 },
  "poke-right": { frames: 10, box: [21, 20, 27, 16], still: 0 },
  tickle: { frames: 16, box: [23, 18, 26, 18], still: 0 },
  drag: { frames: 8, box: [23, 12, 26, 22], still: 0 },
};

const EXTRAS = ["idle-look", "idle-wave", "idle-laptop"];

function reducedMotion() {
  return (
    document.documentElement.dataset.motion === "reduced" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function urlFor(key) {
  return `/static/agent/mascot/crab/${key}.png`;
}

/**
 * @param {HTMLElement} host - the composer card the crab stands on.
 */
export function createClawd(host) {
  const root = document.createElement("span");
  root.className = "clawd";
  root.setAttribute("aria-hidden", "true");
  const sprite = document.createElement("span");
  sprite.className = "clawd-sprite";
  const strip = document.createElement("span");
  strip.className = "clawd-strip";
  sprite.appendChild(strip);
  const hit = document.createElement("span");
  hit.className = "clawd-hit";
  root.appendChild(sprite);
  root.appendChild(hit);
  host.appendChild(root);

  /** Loaded sheets, so an animation never pops in half-painted. */
  const loaded = new Set();
  /** The animation on screen and the promise that settles when it finishes. */
  let animation = null;
  let current = "";
  let currentMode = "loop";
  let mode = "idle";
  let lastKeyAt = 0;
  let lastStatus = "";
  let lastTask = "";
  let quietSince = Date.now();
  let asleep = false;
  let nextExtraAt = 0;
  let extraTimer = 0;
  let switchTimer = 0;
  let clickTimes = [];
  let press = null;
  let dragged = false;
  let disposed = false;

  /**
   * Frame offset in the sheet: eight frames to a row, one gutter around each
   * crop, two device pixels per cell.
   */
  function offset(sheet, frame) {
    const cellW = sheet.box[2] + GUTTER * 2;
    const cellH = sheet.box[3] + GUTTER * 2;
    return `translate(${-((frame % 8) * cellW + GUTTER) * 2}px, ${-(Math.floor(frame / 8) * cellH + GUTTER) * 2}px)`;
  }

  function prepare(key) {
    const sheet = SHEETS[key];
    const cellW = sheet.box[2] + GUTTER * 2;
    const cellH = sheet.box[3] + GUTTER * 2;
    const rows = Math.ceil(sheet.frames / 8);
    root.style.setProperty("--clawd-x", String(sheet.box[0]));
    root.style.setProperty("--clawd-y", String(sheet.box[1]));
    root.style.setProperty("--clawd-w", String(sheet.box[2]));
    root.style.setProperty("--clawd-h", String(sheet.box[3]));
    root.style.setProperty("--clawd-cell-w", String(cellW));
    root.style.setProperty("--clawd-strip-h", String(rows * cellH));
    root.style.setProperty("--clawd-sheet", `url("${urlFor(key)}")`);
    root.style.setProperty("--clawd-ink", `url("${urlFor(`${key}-ink`)}")`);
  }

  function play(key, playMode = "loop") {
    if (disposed || !SHEETS[key]) return;
    if (current === key && currentMode === playMode && animation !== null) return;
    current = key;
    currentMode = playMode;
    lastKeyAt = Date.now();
    prepare(key);
    animation?.cancel();
    animation = null;
    const sheet = SHEETS[key];
    if (!loaded.has(key)) {
      // A sheet that has not arrived stays on the current frame; the image's
      // load handler calls play again.
      return;
    }
    if (reducedMotion() && playMode === "loop") {
      strip.style.transform = offset(sheet, sheet.still);
      return;
    }
    strip.style.transform = "";
    const frames = [];
    for (let frame = 0; frame < sheet.frames; frame++) {
      frames.push({
        offset: frame / sheet.frames,
        transform: offset(sheet, frame),
        easing: "steps(1)",
      });
    }
    frames.push({
      offset: 1,
      transform: offset(sheet, playMode === "loop" ? 0 : sheet.frames - 1),
    });
    animation = strip.animate(frames, {
      duration: sheet.frames * FRAME_MS,
      iterations: playMode === "loop" ? Infinity : 1,
      fill: "forwards",
    });
    root.dataset.animation = key;
    if (playMode === "once") {
      animation.addEventListener("finish", () => {
        if (current === key && currentMode === "once") settle();
      });
    }
  }

  /** A one-shot animation ended: go back to what the task is doing. */
  function settle() {
    if (asleep) {
      play("sleeping");
      return;
    }
    if (mode === "active") play("thinking");
    else if (mode === "error") play("idle");
    else if (mode === "done") {
      mode = "idle";
      play("idle");
      scheduleExtra();
    } else play("idle");
  }

  function scheduleExtra() {
    window.clearTimeout(extraTimer);
    nextExtraAt = Date.now() + EXTRA_MIN_MS + Math.random() * EXTRA_SPAN_MS;
    extraTimer = window.setTimeout(tick, nextExtraAt - Date.now());
  }

  function tick() {
    if (disposed || document.hidden) return;
    const now = Date.now();
    if (mode !== "active" && mode !== "error" && mode !== "done" && !asleep) {
      if (now - quietSince >= SLEEP_AFTER_MS) {
        asleep = true;
        play("sleeping");
        return;
      }
      if (!reducedMotion() && now >= nextExtraAt) {
        play(EXTRAS[Math.floor(Math.random() * EXTRAS.length)], "once");
        scheduleExtra();
        return;
      }
    }
    if (mode === "active") {
      play("thinking");
      return;
    }
    scheduleExtra();
  }

  function wake() {
    quietSince = Date.now();
    if (!asleep) return;
    asleep = false;
    play("waking", "once");
    scheduleExtra();
  }

  /** React to a click on the shell. */
  function react() {
    if (disposed) return;
    wake();
    const now = Date.now();
    clickTimes = clickTimes.filter((at) => now - at < TICKLE_GAP_MS);
    clickTimes.push(now);
    if (clickTimes.length >= TICKLE_CLICKS) {
      clickTimes = [];
      play("tickle", "once");
      return;
    }
    const choices = reducedMotion() ? ["idle-wave"] : EXTRAS;
    play(choices[Math.floor(Math.random() * choices.length)], "once");
  }

  hit.addEventListener("click", (event) => {
    event.stopPropagation();
    if (dragged) {
      dragged = false;
      return;
    }
    react();
  });
  hit.addEventListener("pointerdown", (event) => {
    press = { x: event.clientX, y: event.clientY, id: event.pointerId };
    dragged = false;
    hit.setPointerCapture?.(event.pointerId);
  });
  hit.addEventListener("pointerup", (event) => {
    if (press === null) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    press = null;
    if (Math.abs(dx) < LIFT_PX && Math.abs(dy) < LIFT_PX) return;
    dragged = true;
    window.setTimeout(() => {
      dragged = false;
    }, 400);
    wake();
    if (Math.abs(dx) > Math.abs(dy)) {
      play(dx < 0 ? "poke-left" : "poke-right", "once");
    } else if (dy < 0) {
      play("drag", "once");
    }
  });
  hit.addEventListener("pointercancel", () => {
    press = null;
    dragged = false;
  });

  // Keyboard presence keeps the crab awake, as a pointer move does upstream.
  const onActivity = () => wake();
  document.addEventListener("pointermove", onActivity, { passive: true });
  document.addEventListener("keydown", onActivity);
  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) {
      window.clearTimeout(extraTimer);
    } else if (mode !== "active") {
      scheduleExtra();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Load the idle sheet first so the crab appears whole; the rest follow.
  const load = (key) =>
    new Promise((resolve) => {
      const body = new Image();
      const ink = new Image();
      let pending = 2;
      let ok = true;
      const done = () => {
        pending -= 1;
        if (pending === 0) {
          if (ok) loaded.add(key);
          resolve(ok);
        }
      };
      body.onload = done;
      ink.onload = done;
      body.onerror = () => {
        ok = false;
        done();
      };
      ink.onerror = () => {
        ok = false;
        done();
      };
      body.src = urlFor(key);
      ink.src = urlFor(`${key}-ink`);
    });

  load("idle").then((ok) => {
    if (disposed) return;
    if (ok) root.setAttribute("data-ready", "");
    play("idle");
    for (const key of Object.keys(SHEETS)) {
      if (key === "idle") continue;
      load(key).then((present) => {
        if (present && current === key && animation === null) play(key, currentMode);
      });
    }
    scheduleExtra();
  });

  return {
    /**
     * @param {object} state
     * @param {string} state.status - the task status.
     * @param {string} state.kind - the latest entry kind (`output`, `reasoning`, `tool`, …).
     * @param {boolean} state.visible - whether the chat view and composer are on screen.
     */
    update(state) {
      if (disposed) return;
      if ((state.taskId || "") !== lastTask) {
        lastTask = state.taskId || "";
        lastStatus = "";
        mode = "idle";
        asleep = false;
      }
      const visible = state.visible !== false;
      root.hidden = !visible;
      if (!visible) {
        window.clearTimeout(extraTimer);
        return;
      }
      const status = state.status || "";
      const active = ["running", "queued", "stopping", "waiting"].includes(status);
      const now = Date.now();
      const changed = status !== lastStatus;
      lastStatus = status;

      if (status === "failed" || status === "error" || status === "cancelled") {
        mode = "error";
        quietSince = now;
        if (changed) play("error", "once");
        return;
      }
      if (status === "completed" || status === "done") {
        if (changed) {
          mode = "done";
          quietSince = now;
          play("happy", "once");
        }
        return;
      }
      if (active) {
        mode = "active";
        quietSince = now;
        asleep = false;
        const next =
          state.kind === "output" ? "typing" : state.kind === "tool" ? "typing" : "thinking";
        // Do not strobe between two equal-priority states within a second.
        if (current !== next && now - lastKeyAt < 900) {
          window.clearTimeout(switchTimer);
          switchTimer = window.setTimeout(() => {
            if (mode === "active") play(next);
          }, 900 - (now - lastKeyAt));
        } else {
          play(next);
        }
        return;
      }
      mode = "idle";
      if (changed || (current !== "idle" && current !== "sleeping")) {
        asleep = false;
        play("idle");
        scheduleExtra();
      }
    },
    destroy() {
      disposed = true;
      window.clearTimeout(extraTimer);
      window.clearTimeout(switchTimer);
      animation?.cancel();
      document.removeEventListener("pointermove", onActivity);
      document.removeEventListener("keydown", onActivity);
      // 匿名函数无法移除：销毁后切回前台仍会安排计时器。
      document.removeEventListener("visibilitychange", onVisibility);
      root.remove();
    },
  };
}
