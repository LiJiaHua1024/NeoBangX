/* 自绘下拉：桌面端把原生 <select> 的弹层换成与工作台同一套材质的面板。
   移动端不做增强 —— 系统选择器在手机上比自绘面板更好用。
   原生 <select> 仍留在 DOM 里作为值容器，所有读写 value / options 的旧代码不用改。 */

const finePointer = () => matchMedia("(pointer: fine)").matches;

let panel = null;
let current = null;

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';

function createPanel() {
  panel = document.createElement("div");
  panel.className = "aw-listbox";
  panel.setAttribute("role", "listbox");
  panel.id = "aw-listbox";
  panel.tabIndex = -1;
  panel.hidden = true;
  document.body.append(panel);

  // 面板本身可聚焦；选项是 div，点击不会夺走焦点，因此不需要阻止 pointerdown
  // （阻止了反而会让面板内的滚动条拖不动）。
  panel.addEventListener("click", (e) => {
    const option = e.target.closest("[data-index]");
    if (option) choose(Number(option.dataset.index));
  });
  panel.addEventListener("pointermove", (e) => {
    const option = e.target.closest("[data-index]");
    if (option) setActive(Number(option.dataset.index), false);
  });
  panel.addEventListener("keydown", (e) => {
    if (!current) return;
    const last = current.options.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(last, current.active + 1), true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, current.active - 1), true);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last, true);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(current.active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  });
}

function open(select, trigger) {
  if (current?.select === select) {
    close(true);
    return;
  }
  close(false);
  if (!panel) createPanel();
  const options = [...select.options];
  if (!options.length) return;

  panel.replaceChildren();
  options.forEach((option, index) => {
    const item = document.createElement("div");
    item.className = "aw-option";
    item.dataset.index = String(index);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    if (option.disabled) item.classList.add("disabled");
    const check = document.createElement("span");
    check.className = "aw-option-check";
    if (option.selected) check.innerHTML = CHECK;
    const label = document.createElement("span");
    label.className = "aw-option-label";
    label.textContent = option.textContent;
    item.append(check, label);
    panel.append(item);
  });

  const rect = trigger.getBoundingClientRect();
  panel.hidden = false;
  panel.style.minWidth = `${Math.max(rect.width, 180)}px`;
  const width = panel.offsetWidth;
  panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  const below = rect.bottom + 6;
  const above = rect.top - 6 - panel.offsetHeight;
  panel.style.top = `${below + panel.offsetHeight > innerHeight - 8 && above > 8 ? above : below}px`;

  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", panel.id);
  current = {
    select,
    trigger,
    options,
    active: Math.max(0, options.findIndex((option) => option.selected)),
  };
  panel.focus({ preventScroll: true });
  setActive(current.active, true);
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
}

function outside(event) {
  if (!current) return;
  if (event.target === current.trigger) return;
  if (panel.contains(event.target)) return;
  close(false);
}

function onScroll(event) {
  // 面板自己的滚动不应关闭面板（列表很长时要能滚）。
  if (panel && event?.target instanceof Node && panel.contains(event.target))
    return;
  close(false);
}

function setActive(index, scroll) {
  if (!current) return;
  const items = panel.querySelectorAll(".aw-option");
  if (!items.length) return;
  current.active = Math.max(0, Math.min(items.length - 1, index));
  items.forEach((item, i) => {
    item.classList.toggle("active", i === current.active);
    item.setAttribute("aria-selected", String(i === current.active));
  });
  if (scroll) items[current.active]?.scrollIntoView({ block: "nearest" });
}

function choose(index) {
  if (!current) return;
  const { select, options, trigger } = current;
  const option = options[index];
  if (!option || option.disabled) return;
  if (select.value !== option.value) {
    select.value = option.value;
    // 页面里既有 input 监听也有 change 监听，两个都要发。
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  close(false);
  trigger.focus({ preventScroll: true });
}

function close(focus) {
  if (!current) return;
  const { trigger } = current;
  current = null;
  if (panel) panel.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  if (focus) trigger.focus({ preventScroll: true });
}

/* 把工作台里所有 .aw-select 升级成自绘下拉。移动端直接跳过。 */
export function enhanceSelects(root = document) {
  if (!finePointer()) return;
  for (const host of root.querySelectorAll(".aw-select")) {
    const select = host.querySelector("select");
    if (!select || host.dataset.selectReady === "1") continue;
    host.dataset.selectReady = "1";
    host.classList.add("aw-select-enhanced");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "aw-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const value = document.createElement("span");
    value.className = "aw-select-value";
    trigger.append(value);
    host.append(trigger);

    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const sync = () => {
      const option = select.selectedOptions[0];
      value.textContent = option ? option.textContent : "请选择";
      value.title = value.textContent;
      trigger.disabled = select.disabled;
    };
    select.addEventListener("change", sync);
    select._awSync = sync;
    sync();

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      open(select, trigger);
    });
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        open(select, trigger);
      }
    });
  }
}

/* options 或 value 被代码直接改写后，手动对一次显示值。 */
export function refreshSelects(root = document) {
  for (const select of root.querySelectorAll(".aw-select select"))
    select._awSync?.();
}
