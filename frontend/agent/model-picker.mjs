/**
 * Claude's model picker — grouped rows with vendor lockups, one description
 * line and the accent check, ported from dsh-claude-style@1e7acc5b
 * (features/model/{model-picker.ts,rows.ts,brand.ts,sub-menu.ts} and
 * shared/popover.css), adapted to NeoBangX's configured model catalog.
 *
 * The host catalog is flat. Rows are grouped the way the upstream picker
 * groups its routes: by the first path segment of a model id when it has one
 * (`openrouter/...` is OpenRouter), otherwise by the vendor the name names.
 * The mark is the vendor's, never the route's. The list opens as one card
 * above the trigger and grows out of it over 250ms; choosing a row writes the
 * hidden field the rest of the workspace already saves.
 */


/** The upstream family table, fetched once: a configured description wins,
 *  otherwise the model line's own sentence (the same copy the reference
 *  picker shows). Failure is silent — a name-only row is still a row. */
let rulesPromise = null;
let descriptionRules = [];

function ensureDescriptionRules() {
  if (rulesPromise !== null) return rulesPromise;
  rulesPromise = fetch("/static/agent/model-descriptions.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((document) => {
      if (!document || !Array.isArray(document.families)) return;
      descriptionRules = document.families
        .filter((rule) => typeof rule.match === "string" && rule.text)
        .map((rule) => {
          try {
            return { pattern: new RegExp(rule.match, "i"), text: rule.text };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    })
    .catch(() => {});
  return rulesPromise;
}

function descriptionFor(model) {
  if (model.description) return model.description;
  if (descriptionRules.length === 0) return "";
  const text = `${model.id || ""} ${model.name || ""}`;
  for (const rule of descriptionRules) {
    if (!rule.pattern.test(text)) continue;
    return rule.text.zh || rule.text.en || "";
  }
  return "";
}

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';

/** The vendor rules, ordered the way the upstream copy document orders them. */
const VENDOR_RULES = [
  ["deepseek", /\bdeepseek\b|(^|[/:])deepseek/i],
  ["claude", /claude|anthropic/i],
  ["openai", /gpt|(^|[^a-z0-9])o[1-9](-|$)/i],
  ["gemini", /gemini/i],
  ["gemma", /gemma/i],
  ["qwen", /qwen|tongyi/i],
  ["zai", /\bglm\b|zhipu/i],
  ["kimi", /kimi|moonshot|(^|[^a-z0-9])k3([._-]?\d)?($|-)/i],
  ["minimax", /minimax|(^|[^a-z0-9])m[23]($|-)/i],
  ["grok", /grok|xai/i],
  ["mistral", /mistral|magistral|codestral/i],
  ["meta", /llama|meta/i],
  ["stepfun", /\bstep\b|stepfun/i],
  ["bytedance", /doubao|seed|volc/i],
  ["baidu", /ernie/i],
  ["tencent", /hunyuan|(^|[^a-z0-9])hy(\d|-?mt)/i],
  ["nova", /(^|[^a-z0-9])nova(-|$)/i],
  ["perplexity", /sonar|perplexity/i],
  ["xiaomimimo", /mimo/i],
  ["longcat", /longcat/i],
  ["microsoft", /phi-?\d/i],
  ["cohere", /north|command-?[ar]|cohere/i],
  ["inception", /mercury|inception/i],
  ["celestoai", /celeris/i],
  ["nanobanana", /nano-?banana/i],
  ["reflection", /\bbeam\b/i],
];

const PROVIDER_NAMES = {
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  gemini: "Google",
  qwen: "Qwen",
  dashscope: "DashScope",
  siliconflow: "SiliconFlow",
  moonshot: "Moonshot",
  zhipu: "Zhipu",
  minimax: "MiniMax",
  xai: "xAI",
  mistral: "Mistral",
  meta: "Meta",
  groq: "Groq",
  together: "Together",
  fireworks: "Fireworks",
  ollama: "Ollama",
  azure: "Azure",
  bedrock: "Bedrock",
  vertex: "Vertex",
  cloudflare: "Cloudflare",
};

const brandCache = new Map();

function brandOf(id, name) {
  const text = `${id} ${name}`;
  for (const [brand, rule] of VENDOR_RULES) {
    if (rule.test(text)) return brand;
  }
  return null;
}

function providerKey(model) {
  const id = String(model.id || "");
  const known = Object.keys(PROVIDER_NAMES).find(
    (key) => id === key || id.startsWith(`${key}/`) || id.startsWith(`${key}:`),
  );
  if (known) return known;
  const slash = id.indexOf("/");
  if (slash > 0) return id.slice(0, slash);
  return brandOf(id, String(model.name || "")) || "other";
}

function providerName(key) {
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key];
  if (key === "other") return "其他";
  return key
    .replace(/^cn[:-]/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function groupModels(models) {
  const groups = new Map();
  for (const model of models) {
    const key = providerKey(model);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(model);
  }
  return [...groups].map(([key, list]) => ({
    key,
    name: groups.size === 1 && key === "other" ? "可用模型" : providerName(key),
    models: list,
  }));
}

function svgWord(svg) {
  const match = /data-combine-word="([^"]+)"/.exec(svg);
  return match === null ? "" : match[1];
}

async function brandSvg(brand) {
  if (brand === null) return null;
  if (!brandCache.has(brand)) {
    brandCache.set(
      brand,
      fetch(`/static/agent/brands/${brand}.svg`)
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null),
    );
  }
  return brandCache.get(brand);
}

/** The vendor lockup that replaces, or leads, the vendor's word in the name. */
function buildName(text, brand, svg) {
  const label = document.createElement("span");
  label.className = "model-row-name";
  if (!brand || !svg) {
    label.textContent = text;
    return label;
  }
  const word = svgWord(svg);
  const at =
    word === "" ? -1 : text.toLowerCase().indexOf(word.toLowerCase());
  const lockup = document.createElement("span");
  lockup.className = "model-brand-lockup";
  lockup.setAttribute("aria-hidden", "true");
  lockup.innerHTML = svg;
  const head = at < 0 ? "" : text.slice(0, at);
  const tail =
    at < 0
      ? text
      : text
          .slice(at + word.length)
          .replace(/^[\s/\\\-–—:]+/, "");
  if (head) label.appendChild(document.createTextNode(head));
  label.appendChild(lockup);
  if (word) {
    const spoken = document.createElement("span");
    spoken.className = "sr";
    spoken.textContent = `${word} `;
    label.appendChild(spoken);
  }
  if (tail) label.appendChild(document.createTextNode(tail));
  return label;
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
  let brandGeneration = 0;

  // The card is fixed and lives outside the composer's stacking context, so
  // the sidebar / mobile switch can never paint over it.
  if (popover.parentElement !== document.body) document.body.appendChild(popover);
  popover.setAttribute("role", "listbox");
  popover.setAttribute("aria-label", "选择执行模型");
  popover.tabIndex = -1;
  popover.hidden = true;

  ensureDescriptionRules().then(() => {
    if (open) {
      render();
      position();
    }
  });

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
    const width = Math.min(340, window.innerWidth - 16);
    popover.style.width = `${width}px`;
    const rect = trigger.getBoundingClientRect();
    // A short viewport gets a shorter card that scrolls, not a card whose
    // bottom is off screen. This is the open's own measurement; a lockup
    // arriving afterwards calls position again.
    popover.style.maxHeight = `${Math.max(140, Math.min(560, rect.top - 16))}px`;
    const height = popover.offsetHeight;
    let left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    let top = rect.top - height - 8;
    let origin = "bottom right";
    if (top < 8) {
      top = Math.min(rect.bottom + 8, window.innerHeight - height - 8);
      origin = "top right";
    }
    popover.style.transformOrigin = origin;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function render() {
    const generation = ++brandGeneration;
    active = -1;
    popover.removeAttribute("aria-activedescendant");
    popover.replaceChildren();
    const groups = groupModels(models);
    rows = [];
    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "model-empty";
      empty.textContent = "暂无可用模型";
      popover.appendChild(empty);
      return;
    }
    const scroll = document.createElement("div");
    scroll.className = "model-scroll scroll-thin";
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "model-group";
      const heading = document.createElement("div");
      heading.className = "model-group-label";
      heading.textContent = group.name;
      section.appendChild(heading);
      for (const model of group.models) {
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
        const brand = brandOf(model.id, model.name || "");
        line.appendChild(
          buildName(String(model.name || model.id), brand, null),
        );
        if (model.is_free) {
          const free = document.createElement("span");
          free.className = "model-row-tag";
          free.textContent = "免费";
          line.appendChild(free);
        }
        copy.appendChild(line);
        const description = descriptionFor(model);
        if (description) {
          const desc = document.createElement("span");
          desc.className = "model-row-desc";
          desc.textContent = description;
          copy.appendChild(desc);
        }
        row.appendChild(copy);
        row.appendChild(checkFor(selected));
        row.addEventListener("click", (event) => {
          event.stopPropagation();
          pick(model);
        });
        row.addEventListener("mouseenter", () => setActive(rows.indexOf(row)));
        section.appendChild(row);
        rows.push(row);

        // The lockup arrives from the static asset tree: draw the name now,
        // swap in the vendor's mark when it lands. A row rebuilt by a later
        // selection keeps the mark because the fetch is cached.
        if (brand !== null) {
          brandSvg(brand).then((svg) => {
            if (generation !== brandGeneration || !row.isConnected || !svg)
              return;
            const replacement = buildName(
              String(model.name || model.id),
              brand,
              svg,
            );
            line.replaceChild(replacement, line.firstChild);
            if (open) position();
          });
        }
      }
      scroll.appendChild(section);
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
