/* 等待行左侧的加载点：三套动作轮流值班，换班时把点逐个交到下一套动作里。
   移植自 dsh-claude-style@1e7acc5b 的 features/chat-wait/wait-loader.ts，
   CSS 的几何与节拍见 claude/waiting.css。 */

const LANES = [
  { motion: "bounce", lane: "is-bounce", dots: 3 },
  { motion: "line", lane: "is-line", dots: 3 },
  { motion: "orbit", lane: "is-orbit", dots: 4 },
];
const ACTIVE = "is-active";
const LEAVING = "is-leaving";
const RESTING = "is-resting";
const HAND_OVER = "nbx-wait-hand-over";
const DOT = "waiting-dot";

const loaders = new WeakMap();

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function laneEntry(motion) {
  const entry = LANES.find((one) => one.motion === motion);
  if (!entry) throw new Error(`wait-loader: no lane for ${motion}`);
  return entry;
}

function laneOf(loader, motion) {
  const lane = loader.querySelector(`.${laneEntry(motion).lane}`);
  if (!lane) throw new Error("wait-loader: a lane is missing");
  return lane;
}

function dotsOf(loader, motion) {
  return Array.from(laneOf(loader, motion).querySelectorAll(`.${DOT}`));
}

function place(loader, active, leaving) {
  for (const { motion } of LANES) {
    const lane = laneOf(loader, motion);
    lane.classList.toggle(ACTIVE, motion === active);
    lane.classList.toggle(LEAVING, motion === leaving);
    lane.classList.toggle(RESTING, motion !== active && motion !== leaving);
  }
}

function sharesOf(style, name) {
  return style
    .getPropertyValue(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

function timingOf(lane) {
  const style = getComputedStyle(lane);
  const fade = Number(style.getPropertyValue("--wait-dot-fade"));
  if (!Number.isFinite(fade) || fade <= 0)
    throw new Error("wait-loader: a lane has no fade length");
  const leaves = sharesOf(style, "--wait-dot-leaves");
  if (leaves.length === 0)
    throw new Error("wait-loader: a lane has no still moment");
  return { arrives: sharesOf(style, "--wait-dot-arrives"), leaves, fade };
}

function clockOf(dot) {
  const motion = dot
    .getAnimations()
    .find((one) => one instanceof CSSAnimation);
  const effect = motion?.effect;
  const time = motion?.currentTime;
  if (!motion || !effect || time === null || time === undefined) {
    throw new Error("wait-loader: a dot carries no motion");
  }
  const timing = effect.getTiming();
  const turn = typeof timing.duration === "number" ? timing.duration : 0;
  if (turn <= 0) throw new Error("wait-loader: a motion has no turn");
  return {
    motion,
    turn,
    alternate: timing.direction === "alternate",
    active: Number(time) - Number(timing.delay ?? 0),
  };
}

function shareAt(turn, alternate, time) {
  const passed = Math.floor(time / turn);
  const through = (time - passed * turn) / turn;
  return alternate && passed % 2 === 1 ? 1 - through : through;
}

function waitFor(clock, shares) {
  const step = 1;
  const cycle = clock.turn * (clock.alternate ? 2 : 1);
  for (let waited = 0; waited <= cycle; waited += step) {
    const share = shareAt(clock.turn, clock.alternate, clock.active + waited);
    if (shares.some((one) => Math.abs(share - one) <= step / clock.turn))
      return waited;
  }
  throw new Error(`wait-loader: a motion never reaches ${shares.join("/")}`);
}

function poseAt(dot, clock, wait) {
  const now = clock.motion.currentTime;
  clock.motion.currentTime = Number(now) + wait;
  const style = getComputedStyle(dot);
  const translate =
    style.translate === "none" ? [] : style.translate.split(" ").map(parseFloat);
  const scale =
    style.scale === "none" ? [] : style.scale.split(" ").map(parseFloat);
  clock.motion.currentTime = now;
  const originX = dot.offsetLeft + dot.offsetWidth / 2;
  const originY = dot.offsetTop + dot.offsetHeight;
  return {
    x: originX + (translate[0] ?? 0),
    y: originY + (translate[1] ?? 0),
    originX,
    originY,
    scaleX: scale[0] ?? 1,
    scaleY: scale[1] ?? scale[0] ?? 1,
  };
}

function pairDots(leaving, arriving, cost) {
  const many = Math.max(leaving, arriving);
  const few = Math.min(leaving, arriving);
  let best = [];
  let least = Infinity;
  for (let code = 0; code < few ** many; code += 1) {
    const pairs = [];
    const reached = new Set();
    for (let at = 0, rest = code; at < many; at += 1, rest = Math.floor(rest / few)) {
      const other = rest % few;
      reached.add(other);
      pairs.push(leaving >= arriving ? [at, other] : [other, at]);
    }
    if (reached.size < few) continue;
    const total = pairs.reduce((sum, [from, to]) => sum + cost(from, to), 0);
    if (total < least) {
      least = total;
      best = pairs;
    }
  }
  return best;
}

function timelineNow() {
  const now = document.timeline.currentTime;
  if (now === null) throw new Error("wait-loader: no document timeline");
  return Number(now);
}

function anchor(dots, start) {
  return dots.map((dot) => {
    const clock = clockOf(dot);
    clock.motion.startTime = start;
    return clock;
  });
}

function dropHandOver(loader) {
  for (const dot of loader.querySelectorAll(`.${DOT}`)) {
    for (const one of dot.getAnimations()) {
      if (one.id === HAND_OVER) one.cancel();
    }
  }
}

function handOverAnimation(dot, keyframes, options, start) {
  const animation = dot.animate(keyframes, { ...options, id: HAND_OVER });
  animation.startTime = start;
  return animation;
}

function switchDot(dot, shown, wait, start) {
  return handOverAnimation(
    dot,
    shown ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: 0, delay: wait, fill: "both" },
    start,
  );
}

function openingEase(motion) {
  return motion === "bounce"
    ? "--wait-ease-damped-in"
    : "--wait-ease-damped-out";
}

function motionEase(loader, name) {
  return getComputedStyle(loader).getPropertyValue(name).trim() || "ease";
}

function motionMs(loader, name) {
  const raw = getComputedStyle(loader).getPropertyValue(name).trim();
  const value = parseFloat(raw) || 0;
  if (raw.endsWith("ms")) return value;
  if (raw.endsWith("s")) return value * 1000;
  return value;
}

function open(loader, to) {
  place(loader, to, null);
  const lane = timingOf(laneOf(loader, to));
  const start = timelineNow();
  const dots = dotsOf(loader, to);
  const clocks = anchor(dots, start);
  for (const [at, dot] of dots.entries()) {
    const clock = clocks[at];
    handOverAnimation(
      dot,
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: clock.turn * lane.fade,
        delay: lane.arrives.length === 0 ? 0 : waitFor(clock, lane.arrives),
        easing: motionEase(loader, openingEase(to)),
        fill: "both",
      },
      start,
    );
  }
}

function morph(loader, from, to) {
  const start = timelineNow();
  const travel = motionMs(loader, "--wait-duration-dot-morph");
  const ease = motionEase(loader, "--wait-ease-harmonic");
  const timing = timingOf(laneOf(loader, from));
  const leaving = dotsOf(loader, from);
  const leavingClocks = leaving.map(clockOf);
  const moments = leavingClocks.map((clock) => waitFor(clock, timing.leaves));
  const stood = leaving.map((dot, at) => poseAt(dot, leavingClocks[at], moments[at]));
  place(loader, to, from);
  const arriving = dotsOf(loader, to);
  const clocks = anchor(arriving, start);
  const pairs = pairDots(leaving.length, arriving.length, (one, two) => {
    const there = poseAt(arriving[two], clocks[two], moments[one]);
    return Math.hypot(there.x - stood[one].x, there.y - stood[one].y);
  });
  const leads = arriving.map((_, at) =>
    pairs
      .filter((pair) => pair[1] === at)
      .map((pair) => pair[0])
      .reduce((first, one) => (moments[one] < moments[first] ? one : first)),
  );
  const animations = [];
  for (const [one, dot] of leaving.entries()) {
    if (leads.includes(one)) {
      animations.push(switchDot(dot, false, moments[one], start));
      continue;
    }
    const partner = pairs.find((pair) => pair[0] === one);
    if (!partner) throw new Error("wait-loader: a dot was left out of a hand-over");
    const meet = poseAt(arriving[partner[1]], clocks[partner[1]], moments[one] + travel);
    const own = stood[one];
    animations.push(
      handOverAnimation(
        dot,
        [
          {
            translate: `${own.x - own.originX}px ${own.y - own.originY}px`,
            scale: `${own.scaleX} ${own.scaleY}`,
          },
          {
            translate: `${meet.x - own.originX}px ${meet.y - own.originY}px`,
            scale: `${meet.scaleX} ${meet.scaleY}`,
          },
        ],
        { duration: travel, delay: moments[one], easing: ease, fill: "forwards" },
        start,
      ),
    );
    animations.push(switchDot(dot, false, moments[one] + travel, start));
  }
  for (const [at, dot] of arriving.entries()) {
    const lead = leads[at];
    const wait = moments[lead];
    const here = poseAt(dot, clocks[at], wait);
    const landed = poseAt(dot, clocks[at], wait + travel);
    animations.push(switchDot(dot, true, wait, start));
    animations.push(
      handOverAnimation(
        dot,
        [
          { translate: `${stood[lead].x - here.x}px ${stood[lead].y - here.y}px` },
          { translate: "0px 0px" },
        ],
        { duration: travel, delay: wait, easing: ease, composite: "add" },
        start,
      ),
    );
    animations.push(
      handOverAnimation(
        dot,
        [
          { scale: `${stood[lead].scaleX} ${stood[lead].scaleY}` },
          { scale: `${landed.scaleX} ${landed.scaleY}` },
        ],
        { duration: travel, delay: wait, easing: ease },
        start,
      ),
    );
  }
  return animations;
}

function handOver(loader, state, from, to) {
  dropHandOver(loader);
  state.motion = to;
  const handOvers = ++state.handOvers;
  if (from === null) {
    open(loader, to);
    return;
  }
  if (reducedMotion()) {
    place(loader, to, null);
    return;
  }
  const animations = morph(loader, from, to);
  void Promise.allSettled(animations.map((one) => one.finished)).then(() => {
    if (!loader.isConnected || loaders.get(loader) !== state || state.handOvers !== handOvers)
      return;
    place(loader, to, null);
    dropHandOver(loader);
  });
}

function nextMotion(motion) {
  const others = LANES.filter((one) => one.motion !== motion);
  return others[Math.floor(Math.random() * others.length)].motion;
}

function rotate(loader, state) {
  if (state.timer !== null) window.clearTimeout(state.timer);
  const period = motionMs(loader, "--wait-period-dot-rotate");
  state.timer = window.setTimeout(() => {
    state.timer = null;
    if (!loader.isConnected) return;
    handOver(loader, state, state.motion, nextMotion(state.motion));
    rotate(loader, state);
  }, period);
}

export function startWaitLoader(loader) {
  if (!loader || loaders.has(loader)) return;
  const opening = LANES[Math.floor(Math.random() * LANES.length)].motion;
  const state = { motion: opening, timer: null, handOvers: 0 };
  loaders.set(loader, state);
  try {
    handOver(loader, state, null, opening);
  } catch {
    // 动画读不到时至少让第一套动作站住，不让等待行整行消失。
    place(loader, opening, null);
  }
  if (!reducedMotion()) rotate(loader, state);
}

export function releaseWaitLoader(loader) {
  const state = loader ? loaders.get(loader) : null;
  if (!state) return;
  if (state.timer !== null) window.clearTimeout(state.timer);
  loaders.delete(loader);
}
