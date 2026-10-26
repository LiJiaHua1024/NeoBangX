/**
 * Claude's composer caret — a drawn 2px bar in place of the browser's own,
 * ported from dsh-claude-style@1e7acc5b
 * (packages/client/src/features/caret/{caret.ts,caret-measure.ts,caret.css}).
 *
 * The native caret has no animatable position, so the only way to make it
 * glide between letters is to draw one. The browser's caret is made
 * transparent only while a drawn caret really exists; every failed
 * measurement hands the native caret back. Movement is an 80ms ease, the
 * native blink cycle is 1000ms, and reduced motion pins both.
 *
 * The composer is a textarea, so the caret is measured through a hidden
 * mirror that copies every property deciding glyph width and wrap position.
 * A Range cannot reach a textarea's selection; the mirror breaks the value at
 * the caret and measures the first line box of the back half.
 */

import { toCss, zoomScale } from "./zoom.mjs";

const CARET_ATTR = "data-caret-layer";
const HOST_ATTR = "data-caret-host";
const ACTIVE_ATTR = "data-caret-active";
const VISIBLE_ATTR = "data-caret-visible";
export const CARET_BLINK_NAME = "agent-caret-blink";

/** Everything that decides where a glyph lands inside the textarea. */
const MIRRORED = [
  "direction",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-feature-settings",
  "font-variation-settings",
  "font-kerning",
  "letter-spacing",
  "word-spacing",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

let probeHome = null;

function home() {
  if (probeHome === null) {
    probeHome = document.createElement("div");
    probeHome.setAttribute("aria-hidden", "true");
    probeHome.style.cssText =
      "position:fixed;inset:0 auto auto 0;width:0;height:0;overflow:visible;pointer-events:none;visibility:hidden";
    document.body.appendChild(probeHome);
  }
  return probeHome;
}

function mirroredStyle(input, names) {
  const style = getComputedStyle(input);
  return names.map((name) => `${name}:${style.getPropertyValue(name)}`);
}

/**
 * Where the insertion point sits, in the input's padding box, and how tall
 * the line is. `dx` includes the padding-left; `dy` includes padding-top.
 */
function measurePlain(input, caretAt, endKeyed) {
  const style = getComputedStyle(input);
  const paddingX =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  const width = Math.max(0, input.clientWidth - paddingX);
  if (width <= 0) return null;

  const mirror = document.createElement("div");
  mirror.style.cssText =
    "position:fixed;top:0;left:0;margin:0;border:0;box-sizing:content-box;" +
    "height:auto;overflow:hidden;visibility:hidden;pointer-events:none";
  for (const declaration of mirroredStyle(input, MIRRORED)) {
    const split = declaration.indexOf(":");
    mirror.style.setProperty(
      declaration.slice(0, split),
      declaration.slice(split + 1),
    );
  }
  mirror.style.width = `${width}px`;
  mirror.textContent = input.value.slice(0, caretAt);
  const marker = document.createElement("span");
  // An empty back half needs a line box of its own after a trailing newline.
  marker.textContent = input.value.slice(caretAt) || "\u200b";
  mirror.appendChild(marker);
  home().appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const rects = marker.getClientRects();
  let spot = rects[0];
  let edge = spot === undefined ? undefined : spot.left;
  // After the End key Chromium draws at the end of the previous visual line,
  // not at the start of the next one. Measure that character instead when the
  // two sit on different lines.
  if (
    endKeyed &&
    spot !== undefined &&
    caretAt > 0 &&
    input.value[caretAt - 1] !== "\n" &&
    mirror.firstChild instanceof Text
  ) {
    const previous = document.createRange();
    previous.setStart(mirror.firstChild, caretAt - 1);
    previous.setEnd(mirror.firstChild, caretAt);
    const previousRects = previous.getClientRects();
    const last = previousRects[previousRects.length - 1];
    if (last !== undefined && last.top < spot.top - 1) {
      spot = last;
      edge = last.right;
    }
  }
  mirror.remove();
  if (spot === undefined || edge === undefined || spot.height <= 0) return null;

  return {
    dx: edge - mirrorRect.left,
    dy: spot.top - mirrorRect.top,
    height: spot.height,
  };
}

/**
 * One surface's drawn state. `caret` is positioned against the card's
 * padding box, which is why the card gets `position: relative` if needed.
 */
function createLayer(input) {
  const host = input.parentElement;
  if (host === null) return null;
  const hostStyle = getComputedStyle(host);
  if (hostStyle.display === "contents") return null;
  const marked = hostStyle.position === "static";
  if (marked) host.setAttribute(HOST_ATTR, "");
  const caret = document.createElement("div");
  caret.setAttribute(CARET_ATTR, "");
  caret.setAttribute("aria-hidden", "true");
  host.appendChild(caret);
  return { caret, host, marked, visible: false };
}

function place(layer, box) {
  const rect = layer.host.getBoundingClientRect();
  // `box` and `rect` are screen pixels; under the page zoom (zoom.mjs) the
  // translate below is in CSS pixels and gets zoomed again, so convert first.
  // Snap to whole pixels: a fractional box is antialiased into a grey fringe
  // and reads as a different caret.
  const left = Math.round(
    toCss(box.left - rect.left) - layer.host.clientLeft + layer.host.scrollLeft,
  );
  const top = Math.round(
    toCss(box.top - rect.top) - layer.host.clientTop + layer.host.scrollTop,
  );
  const fresh = !layer.visible;
  if (fresh) layer.caret.style.transitionProperty = "none";
  layer.caret.style.transform = `translate(${left}px, ${top}px)`;
  layer.caret.style.height = `${toCss(box.height)}px`;
  if (fresh) {
    layer.visible = true;
    layer.caret.setAttribute(VISIBLE_ATTR, "");
    requestAnimationFrame(() => {
      layer.caret.style.transitionProperty = "";
    });
  }
  // Restart the blink on every move: caught on the dark half, a reader would
  // think the caret did not keep up. The travel transition is left alone.
  for (const animation of layer.caret.getAnimations()) {
    if (
      animation instanceof CSSAnimation &&
      animation.animationName === CARET_BLINK_NAME
    ) {
      animation.currentTime = 0;
    }
  }
}

function hide(layer) {
  layer.caret.removeAttribute(VISIBLE_ATTR);
  layer.visible = false;
}

/**
 * Install the drawn caret for one textarea.
 *
 * @returns `{ refresh, dispose }`; refresh asks for a measurement on the next
 *     frame (after auto-grow, a task switch, a theme change, …).
 */
export function installCaret(input) {
  let layer = null;
  let queued = false;
  let frame = 0;
  let disposed = false;
  let endKeyed = false;

  const release = () => {
    if (layer !== null) {
      layer.caret.remove();
      if (layer.marked) layer.host.removeAttribute(HOST_ATTR);
      layer = null;
    }
    input.removeAttribute(ACTIVE_ATTR);
  };

  const measure = () => {
    if (disposed || !input.isConnected) return null;
    if (document.activeElement !== input) return null;
    if (input.selectionStart !== input.selectionEnd) return null;
    if (input.selectionStart === null) return null;
    const spot = measurePlain(input, input.selectionStart, endKeyed);
    if (spot === null) return null;
    const field = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    // The mirror carries the textarea's padding and no border; the textarea's
    // border and its own scroll are the only corrections left. Those two are
    // CSS pixels while the rects are screen pixels, so scale them to match.
    const scale = zoomScale();
    return {
      left: field.left + (borderLeft - input.scrollLeft) * scale + spot.dx,
      top: field.top + (borderTop - input.scrollTop) * scale + spot.dy,
      height: spot.height,
    };
  };

  const apply = () => {
    queued = false;
    if (disposed) return;
    const box = measure();
    if (box === null) {
      if (layer !== null) hide(layer);
      input.removeAttribute(ACTIVE_ATTR);
      return;
    }
    if (layer === null) layer = createLayer(input);
    if (layer === null) return;
    place(layer, box);
    input.setAttribute(ACTIVE_ATTR, "");
  };

  const refresh = () => {
    if (disposed || queued) return;
    queued = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };

  const onSelection = () => refresh();
  const onInput = () => {
    endKeyed = false;
    refresh();
  };
  const onPointer = () => {
    endKeyed = false;
    refresh();
  };
  const onKey = (event) => {
    if (event.key === "End" && !event.shiftKey) endKeyed = true;
    else if (!["Shift", "Control", "Meta", "Alt"].includes(event.key))
      endKeyed = false;
    refresh();
  };
  const onFocus = () => {
    endKeyed = false;
    refresh();
    window.setTimeout(refresh, 120);
  };
  const onBlur = () => {
    if (layer !== null) hide(layer);
    input.removeAttribute(ACTIVE_ATTR);
  };
  const onScroll = () => {
    if (layer !== null) refresh();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("scroll", onScroll, { passive: true });
  input.addEventListener("keydown", onKey);
  input.addEventListener("pointerdown", onPointer);
  document.addEventListener("selectionchange", onSelection);
  document.fonts?.addEventListener("loadingdone", refresh);
  window.addEventListener("resize", refresh);

  // The caret starts only when the field already holds focus (a restored
  // task can), and stops drawing when it leaves.
  if (document.activeElement === input) refresh();

  return {
    refresh,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      input.removeEventListener("input", onInput);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("scroll", onScroll);
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("selectionchange", onSelection);
      document.fonts?.removeEventListener("loadingdone", refresh);
      window.removeEventListener("resize", refresh);
      release();
      probeHome?.remove();
      probeHome = null;
    },
  };
}
