/**
 * Claude's model picker — flat rows with the workspace's own model copy,
 * its AA strike rating and its free / no-code tags. The card shell, row
 * rhythm, hover, accent check, keyboard and 250ms growth are ported from
 * dsh-claude-style@1e7acc5b (features/model/model-picker.ts, rows.ts,
 * shared/popover.css); the vendor logos and upstream description table are
 * deliberately not used — NeoBangX already owns model descriptions and
 * ratings, and the catalog supplies both.
 *
 * The catalog is shown as one flat list, in catalog order: no provider
 * headings, no vendor art. Choosing a row writes the hidden field the
 * workspace saves.
 */

import { aaLevelOf, strikeTip } from "./rating.mjs";
import { toCss, viewportCss } from "./zoom.mjs";

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';

/** The catalog's own description, at most two manual lines (the same rule as
 *  the main site's model menu). No invented fallback copy. */
function descriptionLines(model) {
  return String(model.description || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function ratingFor(model) {
  const level = aaLevelOf(model.aa_index);
  if (level === null) return null;
  return { level, tip: strikeTip(model.aa_index) };
}

function tag(label, kind) {
  const chip = document.createElement("span");
  chip.className = `model-row-tag model-row-tag-${kind}`;
  chip.textContent = label;
  return chip;
}

function checkFor(selected) {
  const check = document.createElement("span");
  check.className = "model-row-check";
  if (selected) check.innerHTML = CHECK_SVG;
  return check;
}

/**
 * @param {object} options
 * @param {HTMLButtonElement} options.trigger
 * @param {HTMLElement} options.popover
 * @param {HTMLElement} options.label - the trigger's label span.
 * @param {(model: object) => void} options.onSelect
 */
export function createModelPicker({ trigger, popover, label, onSelect }) {
  let models = [];
  let value = "";
  let open = false;
  let active = -1;
  let closeTimer = 0;
  let rows = [];

  // The card is fixed and lives outside the composer's stacking context, so
  // the sidebar / mobile switch can never paint over it.
  if (popover.parentElement !== document.body) document.body.appendChild(popover);
  popover.setAttribute("role", "listbox");
  popover.setAttribute("aria-label", "选择执行模型");
  popover.tabIndex = -1;
  popover.hidden = true;

  const modelName = () => {
    const model = models.find((entry) => String(entry.id) === String(value));
    return model ? model.name || model.id : value || "选择模型";
  };

  function syncLabel() {
    label.textContent = modelName();
    trigger.title = `当前模型：${modelName()}`;
    trigger.setAttribute("aria-label", `选择执行模型，当前 ${modelName()}`);
    trigger.toggleAttribute("data-empty", models.length === 0);
  }

  function position() {
    if (!open) return;
    // 整页缩放下 rect / innerWidth 是屏幕像素，写回 style 前换成 CSS 像素（见 zoom.mjs）。
    const view = viewportCss();
    const width = Math.min(340, view.width - 16);
    popover.style.width = `${width}px`;
    const box = trigger.getBoundingClientRect();
    const rect = {
      top: toCss(box.top),
      right: toCss(box.right),
      bottom: toCss(box.bottom),
    };
    // A short viewport gets a shorter card that scrolls, not a card whose
    // bottom is off screen. This is the open's own measurement; the row's
    // own copy is already in place before the card is shown.
    popover.style.maxHeight = `${Math.max(140, Math.min(560, rect.top - 16))}px`;
    const height = popover.offsetHeight;
    let left = Math.min(Math.max(8, rect.right - width), view.width - width - 8);
    let top = rect.top - height - 8;
    let origin = "bottom right";
    if (top < 8) {
      top = Math.min(rect.bottom + 8, view.height - height - 8);
      origin = "top right";
    }
    popover.style.transformOrigin = origin;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function render() {
    active = -1;
    popover.removeAttribute("aria-activedescendant");
    popover.replaceChildren();
    rows = [];
    if (models.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-empty";
      empty.textContent = "暂无可用模型";
      popover.appendChild(empty);
      return;
    }
    const scroll = document.createElement("div");
    scroll.className = "model-scroll scroll-thin";
    for (const model of models) {
      const selected = String(model.id) === String(value);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "model-row";
      row.dataset.modelId = String(model.id);
      row.id = `model-option-${rows.length}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selected));
      if (selected) row.dataset.selected = "true";
      const copy = document.createElement("span");
      copy.className = "model-row-copy";
      const line = document.createElement("span");
      line.className = "model-row-line";
      const name = document.createElement("span");
      name.className = "model-row-name";
      name.textContent = String(model.name || model.id);
      line.appendChild(name);
      if (model.is_free) line.appendChild(tag("免费", "free"));
      if (model.is_free && model.free_no_code) {
        line.appendChild(tag("免码", "nocode"));
      }
      const rating = ratingFor(model);
      if (rating !== null) {
        const badge = document.createElement("span");
        badge.className = "model-row-rating";
        badge.textContent = rating.level.name;
        badge.style.setProperty("--rating-color", rating.level.color);
        badge.title = rating.tip;
        line.appendChild(badge);
      }
      copy.appendChild(line);
      for (const text of descriptionLines(model)) {
        const desc = document.createElement("span");
        desc.className = "model-row-desc";
        desc.textContent = text;
        copy.appendChild(desc);
      }
      row.appendChild(copy);
      row.appendChild(checkFor(selected));
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        pick(model);
      });
      row.addEventListener("mouseenter", () => setActive(rows.indexOf(row)));
      scroll.appendChild(row);
      rows.push(row);
    }
    popover.appendChild(scroll);
  }

  function setActive(index) {
    if (rows.length === 0) return;
    active = (index + rows.length) % rows.length;
    for (let i = 0; i < rows.length; i++) {
      rows[i].toggleAttribute("data-active", i === active);
    }
    const row = rows[active];
    popover.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  }

  function pick(model) {
    value = String(model.id);
    syncLabel();
    render();
    close();
    onSelect(model);
    document.getElementById("message")?.focus();
  }

  function show(viaKeyboard = false) {
    if (open) return;
    window.clearTimeout(closeTimer);
    render();
    syncLabel();
    popover.hidden = false;
    open = true;
    trigger.setAttribute("aria-expanded", "true");
    // Let the browser lay the card out at its resting size before the
    // opening transition starts, so it grows out of the trigger rather than
    // from nowhere.
    position();
    requestAnimationFrame(() => {
      if (!open) return;
      popover.setAttribute("data-open", "true");
      position();
      const selected = rows.findIndex(
        (row) => row.dataset.selected === "true",
      );
      if (viaKeyboard) {
        setActive(selected >= 0 ? selected : 0);
        rows[active]?.focus({ preventScroll: true });
      } else {
        active = -1;
        popover.removeAttribute("aria-activedescendant");
        popover.focus({ preventScroll: true });
      }
      position();
    });
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    popover.removeAttribute("data-open");
    trigger.setAttribute("aria-expanded", "false");
    popover.removeAttribute("aria-activedescendant");
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (!open) popover.hidden = true;
    }, 130);
    if (restoreFocus) trigger.focus();
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (open) close();
    else show(false);
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(true);
      if (rows.length) {
        setActive(event.key === "ArrowDown" ? 0 : rows.length - 1);
        rows[active]?.focus({ preventScroll: true });
      }
    }
  });

  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (active < 0) {
        const selected = rows.findIndex(
          (row) => row.dataset.selected === "true",
        );
        setActive(selected >= 0 ? selected : 0);
      } else setActive(active + 1);
      rows[active]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (active < 0) {
        const selected = rows.findIndex(
          (row) => row.dataset.selected === "true",
        );
        setActive(selected >= 0 ? selected : rows.length - 1);
      } else setActive(active - 1);
      rows[active]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      rows[active]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(rows.length - 1);
      rows[active]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active < 0) {
        const selected = rows.findIndex(
          (row) => row.dataset.selected === "true",
        );
        setActive(selected >= 0 ? selected : 0);
      }
      rows[active]?.click();
    }
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!open) return;
      if (popover.contains(event.target) || trigger.contains(event.target))
        return;
      close();
    },
    true,
  );

  window.addEventListener("resize", position);
  window.addEventListener(
    "scroll",
    () => {
      if (open) position();
    },
    true,
  );

  return {
    /** Replace the catalog and the current value (task switch, first boot). */
    setModels(list, current) {
      models = Array.isArray(list) ? list : [];
      value = current === undefined || current === null ? "" : String(current);
      syncLabel();
      if (open) {
        render();
        position();
      }
    },
    /** The task's saved model changed without a pick (fill/undo/template). */
    setValue(next) {
      value = next === undefined || next === null ? "" : String(next);
      syncLabel();
      if (open) {
        render();
        position();
      }
    },
    get value() {
      return value;
    },
    close,
    open: () => show(true),
    isOpen() {
      return open;
    },
  };
}
