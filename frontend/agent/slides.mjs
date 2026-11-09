/* Deterministic scene renderer + slide viewer for the Agent results tab.
   The backend has already broken every line; this file only paints primitives.
   No innerHTML with user text: all text goes through textContent. */

const SVG_NS = "http://www.w3.org/2000/svg";
const SERIF = 'Georgia, "Times New Roman", "Songti SC", serif';
const SANS = 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function topOf(p, count) {
  const lh = p.line_height || 0;
  if (p.valign === "middle") return p.y + (p.h - count * lh) / 2;
  if (p.valign === "bottom") return p.y + p.h - count * lh;
  return p.y;
}

function paintText(parent, p) {
  const lines = p.lines || [];
  const top = topOf(p, lines.length);
  const font = p.family === "serif" ? SERIF : SANS;
  lines.forEach((line, i) => {
    const width = line.width || 0;
    let x = p.x;
    let anchor = "start";
    if (p.align === "center") {
      x = p.x + p.w / 2;
      anchor = "middle";
    } else if (p.align === "right") {
      x = p.x + p.w;
      anchor = "end";
    }
    const y = top + i * (p.line_height || 0) + (p.size || 0) * 0.8;
    const node = el("text", {
      x,
      y,
      "text-anchor": anchor,
      "font-family": font,
      "font-size": p.size,
      fill: (line.runs && line.runs[0] && line.runs[0].color) || "#111",
      "letter-spacing": p.letter_spacing || 0,
      "xml:space": "preserve",
      "data-label": p.label || "",
    }, parent);
    for (const run of line.runs || []) {
      const tspan = el("tspan", {
        "font-weight": run.weight || 400,
        "font-style": run.italic ? "italic" : "normal",
        fill: run.color || "#111",
      }, node);
      tspan.textContent = run.text;
    }
    if (line.width) node.setAttribute("data-width", String(line.width));
    void width;
  });
}

function paintPrimitive(parent, p) {
  if (p.type === "rect") {
    const node = el("rect", {
      x: p.x, y: p.y, width: p.w, height: p.h,
      rx: p.r || 0, ry: p.r || 0,
      fill: p.fill || "none", stroke: p.stroke || "none",
      "stroke-width": p.sw || 1, opacity: p.opacity ?? 1,
    }, parent);
    return node;
  }
  if (p.type === "ellipse") {
    return el("ellipse", {
      cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry,
      fill: p.fill || "none", stroke: p.stroke || "none",
      "stroke-width": p.sw || 1, opacity: p.opacity ?? 1,
    }, parent);
  }
  if (p.type === "line") {
    return el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: p.stroke || "#000", "stroke-width": p.sw || 1,
      opacity: p.opacity ?? 1,
    }, parent);
  }
  if (p.type === "text") {
    const group = el("g", { opacity: p.opacity ?? 1 }, parent);
    paintText(group, p);
    return group;
  }
  return null;
}

export function slideToSvg(slide, { className = "slides-svg" } = {}) {
  const svg = el("svg", {
    viewBox: "0 0 1280 720",
    class: className,
    role: "img",
    "aria-label": slide.title || `第 ${Number(slide.index || 0) + 1} 页`,
  });
  for (const p of slide.primitives || []) paintPrimitive(svg, p);
  return svg;
}

export class SlideViewer {
  constructor({ stage, thumbs, notes, counter, prev, next, onChange } = {}) {
    this.stage = stage;
    this.thumbs = thumbs;
    this.notes = notes;
    this.counter = counter;
    this.prev = prev;
    this.next = next;
    this.onChange = onChange || (() => {});
    this.scene = null;
    this.index = 0;
    this.thumbButtons = [];
    this._onKey = this._onKey.bind(this);
    stage?.addEventListener("keydown", this._onKey);
    prev?.addEventListener("click", () => this.go(this.index - 1));
    next?.addEventListener("click", () => this.go(this.index + 1));
  }

  mount(scene) {
    this.scene = scene;
    this.index = 0;
    this.thumbs?.replaceChildren();
    this.thumbButtons = [];
    (scene.slides || []).forEach((slide, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slides-thumb";
      button.setAttribute("aria-label", `第 ${i + 1} 页`);
      button.appendChild(slideToSvg(slide, { className: "slides-thumb-svg" }));
      button.addEventListener("click", () => this.go(i));
      this.thumbs?.appendChild(button);
      this.thumbButtons.push(button);
    });
    this.go(0);
  }

  go(index) {
    if (!this.scene?.slides?.length) return;
    const next = Math.max(0, Math.min(this.scene.slides.length - 1, index));
    this.index = next;
    const slide = this.scene.slides[next];
    this.stage?.replaceChildren(slideToSvg(slide));
    this.thumbButtons.forEach((btn, i) => btn.classList.toggle("on", i === next));
    this.thumbButtons[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (this.counter) this.counter.textContent = `${next + 1} / ${this.scene.slides.length}`;
    if (this.notes) {
      this.notes.textContent = slide.notes || "本页没有备注。";
      this.notes.hidden = !this.notes.dataset.open;
    }
    if (this.prev) this.prev.disabled = next === 0;
    if (this.next) this.next.disabled = next === this.scene.slides.length - 1;
    this.onChange(next, slide);
  }

  setNotesOpen(open) {
    if (!this.notes) return;
    this.notes.dataset.open = open ? "1" : "";
    this.notes.hidden = !open;
  }

  _onKey(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.go(this.index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.go(this.index + 1);
    }
  }

  destroy() {
    this.stage?.removeEventListener("keydown", this._onKey);
    this.stage?.replaceChildren();
    this.thumbs?.replaceChildren();
  }
}
