import { ACTIVE, STATUS, escapeHTML as esc, newKey, pageText } from "./core.mjs";
import { FullReader, saveBlob, copyText } from "./reader.mjs";
import { fillIcons, icon } from "./icons.mjs";
import { initTheme } from "./claude-theme.mjs";
import { Conversation } from "./conversation.mjs";
import { createModelPicker } from "./model-picker.mjs";
import { installCaret } from "./caret.mjs";
import { createClawd } from "./mascot.mjs";
import { enhanceSelects, refreshSelects } from "./select.mjs";
import { matches as vpMatches, onBreakpoint, toCss, viewportCss } from "./zoom.mjs";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const app = $("#app");
const base = "/api/workspace";
const FIELDS = {
  goal: "goal",
  prompt: "prompt",
  behavior: "behavior",
  model: "model",
  review: "review",
  "review-prompt": "review_prompt",
  "auto-improve": "auto_improve",
  "review-rounds": "review_rounds",
};
const KIND_ICON = {
  reasoning: "sparkle",
  output: "file-text",
  input: "sliders",
  prompt: "list-checks",
  arguments: "route",
};
const TAB_IDS = new Set(["prompt", "materials", "tools", "results"]);

let modelPicker = null;
let caret = null;
let clawd = null;

const state = {
  catalog: null,
  task: null,
  dirty: false,
  editSeq: 0,
  saving: null,
  conflict: false,
  cursor: 0,
  entries: new Map(),
  runs: new Map(),
  notes: new Map(),
  generation: 0,
  version: null,
  pages: [],
  page: 0,
  composing: false,
  conversation: null,
  menuClose: null,
};

let reader = null,
  saveTimer,
  pollTimer,
  toastTimer,
  taskOffset = 0,
  taskQuery = "",
  shadeFor = "",
  modalCleanup = null;

/* ---------------- 输入区增强（光标 / 模型 / Clawd） ---------------- */
function initComposerSurfaces() {
  modelPicker = createModelPicker({
    trigger: $("#model-trigger"),
    popover: $("#model-popover"),
    label: $("#model-trigger .model-trigger-label"),
    onSelect(model) {
      const id = String(model?.id || "");
      $("#model").value = id;
      if (state.task) {
        state.task.config.model = id;
        changed();
        updateStatus();
      }
    },
  });
  caret = installCaret($("#message"));
  clawd = createClawd($("#composer-card"));
  syncClawd();
}

/** Tell the crab what the task is doing. Cheap to call on every poll. */
function syncClawd() {
  if (!clawd) return;
  const kind = state.conversation?.latestEntryKind?.() || "";
  clawd.update({
    taskId: state.task?.id || "",
    status: state.task?.status || "",
    kind,
    visible: app.dataset.mode !== "trajectory" && app.dataset.view !== "work",
  });
}

/* ---------------- 基础 ---------------- */
function token() {
  return localStorage.getItem("nbx_auth") || "";
}
function path(s = "") {
  if (!state.task) throw Error("请先新建任务");
  return `/tasks/${state.task.id}${s}`;
}
async function api(url, options = {}) {
  const headers = { Authorization: `Bearer ${token()}`, ...options.headers };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(base + url, { ...options, headers });
  if (!res.ok) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = { detail: `请求失败 (${res.status})` };
    }
    const e = new Error(
      typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail),
    );
    e.status = res.status;
    throw e;
  }
  return options.blob ? res.blob() : res.json();
}
function toast(message, kind = "") {
  const el = $("#toast");
  el.textContent = String(message);
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}
function error(e) {
  console.error(e);
  toast(e.message || String(e), "error");
  if (e.status === 401) {
    $("#account-name").textContent = "重新登录";
    $("#account-note").textContent = "使用码已失效";
  }
}
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
function saveState(text, stateName) {
  const el = $("#save-state");
  el.textContent = text;
  el.dataset.state = stateName;
}
function connState(text, stateName, detail = "") {
  const el = $("#connection");
  const label = el.querySelector(".sr");
  if (label) label.textContent = text;
  el.dataset.state = stateName;
  el.setAttribute("aria-label", text);
  el.title = detail || text;
}
function shortTime(iso) {
  const value = Date.parse(iso || "");
  if (!Number.isFinite(value)) return "";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(value);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
function fmtChars(n) {
  return `${Number(n || 0).toLocaleString("zh-CN")} 字符`;
}
function autoGrow(textarea) {
  textarea.style.height = "auto";
  const max =
    Number(getComputedStyle(textarea).maxHeight.replace("px", "")) || 520;
  textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
  if (textarea.id === "message") caret?.refresh();
}
function updateDraftEmpty() {
  const card = $("#composer-card");
  const message = $("#message");
  if (!card || !message) return;
  card.toggleAttribute("data-draft-empty", message.value.length === 0);
}
/* 断点按「视口 ÷ 整页缩放」算（见 zoom.mjs），与 responsive.css 的 data-vp 同口径 */
function isNarrow() {
  return vpMatches("w1099");
}
function isMobile() {
  return vpMatches("w767");
}
function isOverlayWorkspace() {
  return vpMatches("w1439");
}

/* ---------------- 外壳：侧栏、工作区、视图、菜单 ---------------- */
function showShade(kind) {
  shadeFor = kind;
  $("#shade").hidden = false;
  $("#shade").dataset.open = "true";
}
function hideShade() {
  shadeFor = "";
  $("#shade").dataset.open = "false";
  $("#shade").hidden = true;
}
function drawer(open, { focus = true } = {}) {
  app.dataset.sidebar = open ? "open" : "collapsed";
  document.body.classList.toggle("nav-open", Boolean(open));
  try {
    if (!isNarrow()) localStorage.setItem("nbx_agent_sidebar", open ? "open" : "collapsed");
  } catch {}
  $("#menu").setAttribute("aria-expanded", String(open));
  if (open && isNarrow()) {
    showShade("nav");
    if (focus) $("#close-nav").focus();
  } else if (shadeFor === "nav") {
    hideShade();
    if (focus && isNarrow()) $("#menu").focus();
  }
}
function setWorkspace(open, { persist = true } = {}) {
  const overlay = isOverlayWorkspace();
  if (isMobile()) {
    setView(open ? "work" : "chat");
    return;
  }
  app.dataset.workspace = open ? "open" : "closed";
  $("#workspace-toggle").setAttribute("aria-expanded", String(open));
  $("#workspace-toggle").setAttribute("aria-label", open ? "收起工作区" : "显示工作区");
  if (overlay && open) showShade("workspace");
  else if (shadeFor === "workspace") hideShade();
  if (!open && app.dataset.focus === "work") delete app.dataset.focus;
  if (persist) {
    try {
      localStorage.setItem("nbx_agent_workspace", open ? "open" : "closed");
    } catch {}
  }
}
function setView(view, push = true) {
  if (view !== "work") view = "chat";
  app.dataset.view = view;
  for (const button of $$(".mobile-switch [data-view]")) {
    button.toggleAttribute("aria-current", button.dataset.view === view);
  }
  if (view === "chat") $("#activity-dot").textContent = "";
  syncClawd();
  if (push && state.task) {
    history.replaceState({ ...history.state, view }, "", location.href);
  }
}
function setMode(mode, push = true) {
  if (mode !== "trajectory") mode = "chat";
  if (mode === "trajectory") modelPicker?.close();
  app.dataset.mode = mode;
  for (const button of $$(".view-tabs [data-mode]")) {
    button.toggleAttribute("aria-current", button.dataset.mode === mode);
  }
  state.conversation?.setMode(mode, { push });
  if (mode === "trajectory") $("#activity-dot").textContent = "";
  syncClawd();
  if (push && state.task) {
    const url = new URL(location.href);
    if (mode === "trajectory") url.hash = "trajectory";
    else if (url.hash === "#trajectory") url.hash = "";
    history.replaceState(history.state, "", url);
  }
}
function setTab(tab, push = true) {
  if (!TAB_IDS.has(tab)) tab = "prompt";
  $$("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  $$("[data-tab]").forEach((button) => {
    button.toggleAttribute("aria-current", button.dataset.tab === tab);
  });
  if (tab === "results") {
    $("#result-dot").textContent = "";
    ensureResultSelection().catch(error);
  }
  if (isMobile()) setView("work");
  else if (!isOverlayWorkspace()) setWorkspace(true, { persist: false });
  if (push && state.task) {
    const u = new URL(location.href);
    u.hash = tab;
    history.pushState({ view: app.dataset.view }, "", u);
  }
}
function closeMenus() {
  $("#task-menu").hidden = true;
  $("#task-menu-btn").setAttribute("aria-expanded", "false");
  $("#theme-menu").hidden = true;
  $("#theme-toggle").setAttribute("aria-expanded", "false");
  state.menuClose?.();
  state.menuClose = null;
}
function menuAt(anchor, html, onClick) {
  closeMenus();
  const menu = document.createElement("div");
  menu.className = "popover";
  menu.style.position = "fixed";
  // A body-level menu sets left itself; `right: 0` from the header menu's
  // .popover[data-side="left"] would stretch it across the viewport instead
  // of letting it shrink to its own rows.
  menu.style.right = "auto";
  menu.style.minWidth = "190px";
  menu.style.transformOrigin = "top left";
  menu.innerHTML = html;
  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  const view = viewportCss();
  const width = menu.offsetWidth;
  menu.style.left = `${Math.min(toCss(box.left), view.width - width - 8)}px`;
  menu.style.top = `${Math.min(toCss(box.bottom) + 4, view.height - menu.offsetHeight - 8)}px`;
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    onClick(button.dataset.action, button);
  });
  const close = () => {
    menu.remove();
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", onKey, true);
    state.menuClose = null;
  };
  const outside = (event) => {
    if (!menu.contains(event.target) && event.target !== anchor) close();
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    anchor.focus({ preventScroll: true });
  };
  setTimeout(() => document.addEventListener("click", outside, true), 0);
  document.addEventListener("keydown", onKey, true);
  state.menuClose = close;
  return menu;
}

/* ---------------- 主题、视口、分隔条 ---------------- */
function viewport() {
  document.documentElement.style.setProperty(
    "--vh",
    `${toCss(window.visualViewport?.height || innerHeight)}px`,
  );
}
window.visualViewport?.addEventListener("resize", viewport);
viewport();

/* 「有新进展」浮在输入卡片上方；卡片高度随附件/多行变化，用实测值定位。 */
const composerSeat = $("#composer-seat");
function placeLatest() {
  const latest = $("#latest");
  const seat = composerSeat.getBoundingClientRect();
  const conversation = $("#chat").getBoundingClientRect();
  if (!seat.height || !conversation.height) return;
  const bottom = Math.max(12, Math.round(toCss(conversation.bottom - seat.top) + 8));
  latest.style.bottom = `${bottom}px`;
  app.style.setProperty("--composer-h", `${composerSeat.offsetHeight}px`);
}
if ("ResizeObserver" in window) {
  new ResizeObserver(placeLatest).observe(composerSeat);
}
window.addEventListener("resize", placeLatest);
placeLatest();

function workspaceWidth(value) {
  const w = Math.round(Math.min(680, Math.max(360, value)));
  app.style.setProperty("--workspace-width", `${w}px`);
  $("#separator").setAttribute("aria-valuenow", String(w));
  try {
    localStorage.setItem("nbx_agent_inspector", String(w));
  } catch {}
}
workspaceWidth(Number(localStorage.getItem("nbx_agent_inspector")) || 420);
$("#separator").onkeydown = (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  workspaceWidth(
    Number(event.currentTarget.getAttribute("aria-valuenow")) +
      (event.key === "ArrowRight" ? 24 : -24),
  );
};
$("#separator").onpointerdown = (event) => {
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  handle.classList.add("dragging");
  handle.onpointermove = (move) => {
    const box = $(".layout").getBoundingClientRect();
    workspaceWidth(toCss(box.right - move.clientX));
  };
  handle.onpointerup = () => {
    handle.onpointermove = null;
    handle.classList.remove("dragging");
  };
};

/* ---------------- 侧栏 ---------------- */
$("#menu").onclick = () => {
  if (isNarrow()) drawer(app.dataset.sidebar !== "open");
  else drawer(app.dataset.sidebar === "collapsed");
};
$("#sidebar-collapse").onclick = () => {
  if (isNarrow()) drawer(false);
  else drawer(app.dataset.sidebar === "collapsed");
};
$("#close-nav").onclick = () => drawer(false);
$("#shade").onclick = () => {
  if (shadeFor === "workspace") setWorkspace(false);
  else drawer(false);
};
$("#workspace-toggle").onclick = () => {
  setWorkspace(app.dataset.workspace !== "open");
};
$("#workspace-close").onclick = () => {
  if (app.dataset.focus === "work") delete app.dataset.focus;
  setWorkspace(false);
};
$("#workspace-focus").onclick = () => {
  if (app.dataset.focus === "work") delete app.dataset.focus;
  else app.dataset.focus = "work";
};
$("#open-workspace").onclick = () => {
  closeMenus();
  setWorkspace(true);
  setTab("prompt");
};
$("#task-menu-btn").onclick = (event) => {
  event.stopPropagation();
  const menu = $("#task-menu");
  const open = menu.hidden;
  closeMenus();
  if (open) {
    menu.hidden = false;
    $("#task-menu-btn").setAttribute("aria-expanded", "true");
  }
};
$("#theme-toggle").onclick = (event) => event.stopPropagation();
document.addEventListener("click", (event) => {
  if (!$("#task-menu").contains(event.target) && event.target !== $("#task-menu-btn"))
    $("#task-menu").hidden = true;
  if (!$("#theme-menu").contains(event.target) && event.target !== $("#theme-toggle"))
    $("#theme-menu").hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (isNarrow() && app.dataset.sidebar === "open") drawer(false);
    if (app.dataset.workspace === "open" && isOverlayWorkspace() && !isMobile())
      setWorkspace(false);
    if (!$("#task-menu").hidden) {
      $("#task-menu").hidden = true;
      $("#task-menu-btn").focus();
    }
    if (!$("#theme-menu").hidden) {
      $("#theme-menu").hidden = true;
      $("#theme-toggle").focus();
    }
    closePops();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#task-search").focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (state.catalog) createTask();
  }
});
$("#rename-task").onclick = () => {
  closeMenus();
  $("#task-title").focus();
  $("#task-title").select();
};
$("#my-library").onclick = () => {
  if (!state.catalog) return login();
  openLibrary();
};
$("#task-search").oninput = () => {
  clearTimeout(window.__taskSearchTimer);
  window.__taskSearchTimer = setTimeout(() => listTasks().catch(error), 240);
};
$("#more-tasks").onclick = () => listTasks(false).catch(error);
$("#new-task").onclick = () => (state.catalog ? createTask() : login());

/* 侧栏任务行：按更新时间分组。 */
function groupLabel(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "更早";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= today) return "今天";
  if (time >= today - 86_400_000) return "昨天";
  if (time >= today - 6 * 86_400_000) return "过去 7 天";
  return "更早";
}
async function listTasks(reset = true) {
  if (!state.catalog) return;
  const query = $("#task-search").value.trim();
  if (reset) {
    taskOffset = 0;
    taskQuery = query;
  }
  const data = await api(
    `/tasks?q=${encodeURIComponent(query)}&offset=${taskOffset}`,
  );
  if (query !== $("#task-search").value.trim()) return;
  if (reset) $("#task-list").replaceChildren();
  let lastGroup = "";
  for (const task of data.tasks) {
    const group = groupLabel(task.updated_at);
    if (group !== lastGroup) {
      const label = document.createElement("div");
      label.className = "group-label";
      label.textContent = group;
      $("#task-list").append(label);
      lastGroup = group;
    }
    const row = document.createElement("div");
    row.className = "task-row";
    row.dataset.id = task.id;
    row.dataset.status = task.status;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-current", String(task.id === state.task?.id));
    row.title = `${task.title} · ${STATUS[task.status] || task.status}`;
    row.innerHTML = `
      <span class="task-dot">${icon("message-square")}</span>
      <span class="task-name"></span>
      <span class="task-time"></span>
      <button class="task-menu-btn" type="button" aria-label="任务操作" title="任务操作">${icon("more")}</button>`;
    row.querySelector(".task-name").textContent = task.title;
    row.querySelector(".task-time").textContent = shortTime(task.updated_at);
    row.onclick = (event) => {
      if (event.target.closest(".task-menu-btn")) return;
      openTask(task.id).catch(error);
    };
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTask(task.id).catch(error);
      }
    };
    row.querySelector(".task-menu-btn").onclick = (event) => {
      event.stopPropagation();
      taskRowMenu(task, event.currentTarget);
    };
    $("#task-list").append(row);
  }
  if (reset && !data.tasks.length) {
    const empty = document.createElement("p");
    empty.className = "task-empty";
    empty.textContent = taskQuery ? "没有匹配的任务" : "还没有任务，先新建一个。";
    $("#task-list").append(empty);
  }
  taskOffset += data.tasks.length;
  $("#more-tasks").hidden = !data.has_more;
}
function taskRowMenu(task, anchor) {
  menuAt(
    anchor,
    `<button data-action="copy">${icon("copy")}<span>复制任务</span></button>
     <button data-action="delete" class="danger">${icon("trash")}<span>删除任务</span></button>`,
    async (action) => {
      closeMenus();
      if (action === "copy") {
        try {
          await requireSaved();
          const copy = await api(`/tasks/${task.id}/copy`, { method: "POST" });
          await openTask(copy.id);
          await listTasks();
        } catch (e) {
          error(e);
        }
      }
      if (action === "delete") {
        confirmAction("删除任务", "此任务的材料、过程和全部成果将一并删除，无法恢复。", async () => {
          await api(`/tasks/${task.id}`, { method: "DELETE" });
          if (task.id === state.task?.id) {
            state.dirty = false;
            await createTask();
          } else {
            await listTasks();
          }
        });
      }
    },
  );
}

/* ---------------- 草稿与保存 ---------------- */
function draftKey() {
  return state.task && state.catalog
    ? `nbx_agent_draft_${state.catalog.user.id}_${state.task.id}`
    : "";
}
function localDraft() {
  try {
    const key = draftKey();
    if (key)
      localStorage.setItem(
        key,
        JSON.stringify({
          revision: state.task.revision,
          config: state.task.config,
          title: state.task.title,
          at: Date.now(),
        }),
      );
  } catch {
    toast("本地草稿空间不足，请保持联网并保存");
  }
}
function changed() {
  if (!state.task) return;
  if (ACTIVE.has(state.task.status)) state.configChangedDuringRun = true;
  state.dirty = true;
  state.editSeq++;
  state.task.title = $("#task-title").value || "新任务";
  localDraft();
  saveState("正在编辑", "editing");
  clearTimeout(saveTimer);
  if (!state.composing) saveTimer = setTimeout(() => save().catch(error), 800);
}
async function save() {
  clearTimeout(saveTimer);
  if (state.saving) {
    await state.saving;
    if (state.dirty && !state.conflict) return save();
    return !state.conflict;
  }
  if (!state.dirty || !state.task) return true;
  if (state.conflict) return false;
  if (state.composing) return false;
  const task = state.task,
    seq = state.editSeq;
  saveState("正在保存…", "saving");
  state.saving = (async () => {
    try {
      const saved = await api(`/tasks/${task.id}`, {
        method: "PUT",
        body: {
          title: task.title,
          revision: task.revision,
          config: task.config,
        },
      });
      if (state.task !== task) return true;
      task.revision = saved.revision;
      if (seq === state.editSeq) {
        state.dirty = false;
        localStorage.removeItem(draftKey());
        saveState("已保存", "saved");
      } else localDraft();
      return true;
    } catch (e) {
      if (e.status === 409) {
        state.conflict = true;
        $("#conflict").hidden = false;
        saveState("需处理冲突", "conflict");
        return false;
      }
      saveState("未同步 · 草稿已保留", "conflict");
      throw e;
    } finally {
      state.saving = null;
    }
  })();
  return state.saving;
}
async function requireSaved() {
  if (!(await save())) throw Error("请先处理保存冲突或完成输入");
}

/* ---------------- 输入与同步 ---------------- */
for (const [id, key] of Object.entries(FIELDS)) {
  const el = $("#" + id);
  el.addEventListener("input", () => {
    if (!state.task) return;
    state.task.config[key] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "number"
          ? Number(el.value)
          : el.value;
    changed();
    if (id === "prompt" || id === "behavior") autoGrow(el);
  });
}
$("#task-title").oninput = changed;
$("#goal").addEventListener("input", () => {
  if (!state.task) return;
  state.task.config.goal = $("#goal").value;
  if (!state.task.runs.length && $("#message").value !== $("#goal").value) {
    $("#message").value = $("#goal").value;
    autoGrow($("#message"));
  }
  changed();
});
$("#message").addEventListener("input", () => {
  autoGrow($("#message"));
  updateDraftEmpty();
  if (!state.task) return;
  if (!state.task.runs.length && $("#goal").value !== $("#message").value) {
    $("#goal").value = $("#message").value;
    state.task.config.goal = $("#message").value;
    changed();
  }
});
$("#message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !state.composing && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
document.addEventListener("compositionstart", () => {
  state.composing = true;
  clearTimeout(saveTimer);
});
document.addEventListener("compositionend", () => {
  state.composing = false;
  if (state.dirty) {
    localDraft();
    saveTimer = setTimeout(() => save().catch(error), 800);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    localDraft();
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("online", () => {
  save().catch(error);
  poll();
});
window.addEventListener("resize", () => {
  viewport();
  if (isMobile() && shadeFor === "workspace") hideShade();
  if (!isOverlayWorkspace()) {
    if (shadeFor === "workspace") hideShade();
    app.dataset.workspace =
      localStorage.getItem("nbx_agent_workspace") === "closed"
        ? "closed"
        : "open";
  }
  if (isNarrow() && app.dataset.sidebar === "collapsed") hideShade();
});
onBreakpoint("w1099", (narrow) => {
  if (narrow) {
    app.dataset.sidebar = "collapsed";
    hideShade();
    setView("chat", false);
  } else {
    app.dataset.sidebar =
      localStorage.getItem("nbx_agent_sidebar") === "collapsed"
        ? "collapsed"
        : "open";
  }
});
onBreakpoint("w1439", (overlay) => {
  setWorkspace(!overlay, { persist: false });
});

/* ---------------- 工作区：材料、工具、教学工具 ---------------- */
function renderMaterials() {
  const root = $("#materials-list");
  root.replaceChildren();
  for (const material of state.task.materials) {
    const row = document.createElement("div");
    row.className = "material-row";
    const check = document.createElement("label");
    check.className = "check";
    check.innerHTML = `<input type="checkbox"><span class="material-main"><span class="material-name"></span><span class="material-meta"></span></span>`;
    check.querySelector(".material-name").textContent = material.name;
    check.querySelector(".material-meta").textContent = `${fmtChars(
      material.chars,
    )} · ${material.has_original ? "原文已保存" : "解析文本"}`;
    const input = check.querySelector("input");
    input.checked = state.task.config.materials.includes(material.id);
    input.onchange = () => {
      const ids = new Set(state.task.config.materials);
      input.checked ? ids.add(material.id) : ids.delete(material.id);
      state.task.config.materials = [...ids];
      changed();
      renderMaterials();
      renderComposerContext();
    };
    const actions = document.createElement("div");
    actions.className = "material-actions";
    const read = document.createElement("button");
    read.type = "button";
    read.className = "icon-btn";
    read.title = "阅读全文";
    read.setAttribute("aria-label", `阅读 ${material.name}`);
    read.innerHTML = icon("book-open");
    read.onclick = async () => {
      try {
        const item = await api(path(`/materials/${material.id}`));
        readText(material.name, item.content);
      } catch (e) {
        error(e);
      }
    };
    const download = document.createElement("button");
    download.type = "button";
    download.className = "icon-btn";
    download.title = "下载原文件";
    download.setAttribute("aria-label", `下载 ${material.name}`);
    download.innerHTML = icon("download");
    download.onclick = async () => {
      try {
        saveBlob(
          await api(path(`/materials/${material.id}?original=true`), {
            blob: true,
          }),
          material.name,
        );
      } catch (e) {
        error(e);
      }
    };
    actions.append(read, download);
    row.append(check, actions);
    root.append(row);
  }
  if (!state.task.materials.length) {
    const hint = document.createElement("p");
    hint.className = "empty-line";
    hint.textContent = "还没有材料。上传文件，或直接粘贴原文。";
    root.append(hint);
  }
  renderComposerContext();
}
async function receivedMaterial(material) {
  upsert(state.task.materials, material);
  if (!state.task.config.materials.includes(material.id))
    state.task.config.materials.push(material.id);
  renderMaterials();
  changed();
  await save();
}
$("#add-material").onclick = async () => {
  try {
    if (!$("#material-text").value.trim()) throw Error("请粘贴材料正文");
    const material = await api(path("/materials"), {
      method: "POST",
      body: {
        name: $("#material-name").value || "粘贴材料",
        content: $("#material-text").value,
      },
    });
    await receivedMaterial(material);
    $("#material-text").value = "";
    $("#material-name").value = "";
    toast("材料已保存并选中");
  } catch (e) {
    error(e);
  }
};
$("#upload").onchange = async (event) => {
  const files = [...event.target.files];
  event.target.disabled = true;
  try {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      toast(`正在解析 ${file.name}`);
      await receivedMaterial(
        await api(path("/upload"), { method: "POST", body: form }),
      );
    }
    toast("文件已保存，解析全文可在材料中查看");
  } catch (e) {
    error(e);
  } finally {
    event.target.disabled = false;
    event.target.value = "";
  }
};

function renderTools() {
  const root = $("#tools-list");
  root.replaceChildren();
  for (const tool of state.catalog.tools) {
    const row = document.createElement("div");
    row.className = "tool-row";
    row.innerHTML = `
      <div class="tool-main">
        <span class="tool-name"></span>
        <span class="tool-desc"></span>
      </div>
      <span class="tag" hidden>未接入</span>
      <label class="switch" title="启用或关闭">
        <input type="checkbox">
        <span class="track"></span>
        <span class="thumb"></span>
      </label>`;
    row.querySelector(".tool-name").textContent = tool.name;
    row.querySelector(".tool-desc").textContent = tool.description;
    const input = row.querySelector("input");
    input.checked = state.task.config.tools.includes(tool.id);
    input.disabled = !tool.available;
    row.querySelector(".tag").hidden = tool.available;
    input.onchange = () => {
      const tools = new Set(state.task.config.tools);
      input.checked ? tools.add(tool.id) : tools.delete(tool.id);
      state.task.config.tools = [...tools];
      changed();
      renderComposerContext();
      renderComposerTools();
    };
    root.append(row);
  }
  renderComposerContext();
  renderComposerTools();
}

function renderTeaching() {
  const root = $("#teaching-list");
  root.replaceChildren();
  const ids = Object.keys(state.task.config.teaching_tools);
  setText($("#teaching-count"), ids.length ? `${ids.length} 个` : "");
  for (const id of ids) {
    const prompt = state.task.config.teaching_tools[id];
    const item = document.createElement("details");
    item.className = "teaching-item";
    const name =
      state.catalog.official_templates.find((template) => template.id === id)
        ?.name || id;
    item.innerHTML = `
      <summary><span data-icon="chevron-right" class="chev"></span><span class="teaching-name"></span></summary>
      <textarea aria-label="教学工具提示词" spellcheck="false"></textarea>
      <div class="teaching-actions">
        <button type="button" data-test>${icon("play")}<span>单独试运行</span></button>
        <button type="button" data-remove class="danger">${icon("trash")}<span>移除</span></button>
      </div>`;
    item.querySelector(".teaching-name").textContent = name;
    const area = item.querySelector("textarea");
    area.value = prompt;
    area.oninput = () => {
      state.task.config.teaching_tools[id] = area.value;
      changed();
    };
    item.querySelector("[data-remove]").onclick = () => {
      delete state.task.config.teaching_tools[id];
      changed();
      renderTeaching();
    };
    const test = item.querySelector("[data-test]");
    test.title = "按本页计费规则开启一轮任务，结果保存为独立成果";
    test.onclick = () => start("tool_test", "", "", id).catch(error);
    root.append(item);
  }
}
$("#add-teaching").onclick = () => {
  const tool = state.catalog.official_templates.find(
    (template) => template.id === $("#teaching-select").value,
  );
  if (tool) {
    state.task.config.teaching_tools[tool.id] = tool.prompt;
    renderTeaching();
    changed();
  }
};

/* 工具试运行 */
$("#test-tool").onclick = async () => {
  try {
    await requireSaved();
    const name = $("#test-name").value,
      query = $("#test-query").value;
    if (!query.trim()) throw Error("请输入测试内容");
    const args =
      name === "check_vocabulary"
        ? { text: query }
        : name === "search_material"
          ? { query, regex: $("#test-regex").checked }
          : { query };
    const result = await api(path("/tool-test"), {
      method: "POST",
      body: { name, arguments: args },
    });
    readText("工具试运行结果", JSON.stringify(result, null, 2));
  } catch (e) {
    error(e);
  }
};

/* ---------------- 输入卡片上的材料/工具浮层 ---------------- */
function renderComposerContext() {
  if (!state.task) return;
  const host = $("#composer-context");
  host.replaceChildren();
  const selected = state.task.materials.filter((material) =>
    state.task.config.materials.includes(material.id),
  );
  for (const material of selected.slice(0, 3)) {
    const chip = document.createElement("span");
    chip.className = "context-chip";
    chip.innerHTML = `${icon("file-text")}<span></span><button type="button" aria-label="移除材料">${icon("x")}</button>`;
    chip.querySelector("span").textContent = material.name;
    chip.querySelector("button").onclick = () => {
      state.task.config.materials = state.task.config.materials.filter(
        (id) => id !== material.id,
      );
      changed();
      renderMaterials();
      renderComposerContext();
    };
    host.append(chip);
  }
  if (selected.length > 3) {
    const more = document.createElement("span");
    more.className = "context-chip more";
    more.textContent = `+${selected.length - 3}`;
    host.append(more);
  }
  const templateId = state.task.config.template_id;
  const template = state.catalog?.official_templates
    .concat(state.catalog?.templates || [])
    .find((item) => item.id === templateId);
  if (template) {
    const chip = document.createElement("span");
    chip.className = "context-chip";
    chip.innerHTML = `${icon("book-open")}<span></span>`;
    chip.querySelector("span").textContent = `模板 · ${template.name}`;
    host.append(chip);
  }
  const count = state.task.config.materials.length;
  const tools = state.task.config.tools.length;
  setText($("#composer-material-count"), count ? String(count) : "");
  setText($("#composer-tool-count"), tools ? String(tools) : "");
  $("#composer-materials").dataset.active = String(count > 0);
  $("#composer-tools").dataset.active = String(tools > 0);
}
function renderComposerMaterials() {
  const pop = $("#materials-pop");
  pop.replaceChildren();
  const title = document.createElement("div");
  title.className = "composer-pop-title";
  title.textContent = "本轮材料";
  pop.append(title);
  if (!state.task.materials.length) {
    const empty = document.createElement("div");
    empty.className = "composer-pop-empty";
    empty.textContent = "还没有材料。在「材料」页上传或粘贴。";
    pop.append(empty);
  }
  for (const material of state.task.materials) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "composer-pop-row";
    row.setAttribute(
      "aria-checked",
      String(state.task.config.materials.includes(material.id)),
    );
    row.innerHTML = `<span class="row-main"><span></span><small></small></span><span class="check">${icon("check")}</span>`;
    row.querySelector(".row-main span").textContent = material.name;
    row.querySelector("small").textContent = fmtChars(material.chars);
    row.onclick = () => {
      const ids = new Set(state.task.config.materials);
      ids.has(material.id) ? ids.delete(material.id) : ids.add(material.id);
      state.task.config.materials = [...ids];
      changed();
      renderMaterials();
      renderComposerMaterials();
      renderComposerContext();
    };
    pop.append(row);
  }
  const foot = document.createElement("div");
  foot.className = "composer-pop-foot";
  const manage = document.createElement("button");
  manage.type = "button";
  manage.textContent = "管理材料与上传…";
  manage.onclick = () => {
    closePops();
    setTab("materials");
  };
  foot.append(manage);
  pop.append(foot);
}
function renderComposerTools() {
  const pop = $("#tools-pop");
  pop.replaceChildren();
  const title = document.createElement("div");
  title.className = "composer-pop-title";
  title.textContent = "本轮可用的工具";
  pop.append(title);
  for (const tool of state.catalog?.tools || []) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "composer-pop-row";
    row.setAttribute(
      "aria-checked",
      String(state.task.config.tools.includes(tool.id)),
    );
    row.disabled = !tool.available;
    row.innerHTML = `<span class="row-main"><span></span><small></small></span><span class="check">${icon("check")}</span>`;
    row.querySelector(".row-main span").textContent = tool.name;
    row.querySelector("small").textContent = tool.description;
    row.onclick = () => {
      const tools = new Set(state.task.config.tools);
      tools.has(tool.id) ? tools.delete(tool.id) : tools.add(tool.id);
      state.task.config.tools = [...tools];
      changed();
      renderTools();
      renderComposerTools();
    };
    pop.append(row);
  }
  const foot = document.createElement("div");
  foot.className = "composer-pop-foot";
  const manage = document.createElement("button");
  manage.type = "button";
  manage.textContent = "更多工具设置…";
  manage.onclick = () => {
    closePops();
    setTab("tools");
  };
  foot.append(manage);
  pop.append(foot);
}
function closePops() {
  for (const [button, pop] of [
    [$("#composer-materials"), $("#materials-pop")],
    [$("#composer-tools"), $("#tools-pop")],
  ]) {
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}
function togglePop(button, pop) {
  const open = pop.hidden;
  closePops();
  if (!open) return;
  pop.hidden = false;
  button.setAttribute("aria-expanded", "true");
}
$("#composer-materials").onclick = (event) => {
  event.stopPropagation();
  renderComposerMaterials();
  togglePop($("#composer-materials"), $("#materials-pop"));
};
$("#composer-tools").onclick = (event) => {
  event.stopPropagation();
  renderComposerTools();
  togglePop($("#composer-tools"), $("#tools-pop"));
};
document.addEventListener("click", (event) => {
  if (!event.target.closest(".composer-pop") && !event.target.closest(".composer-btn"))
    closePops();
});

/* ---------------- 任务打开与填充 ---------------- */
/* 从未编辑、从未执行的任务：revision 仍是创建时的 1，且标题未改。 */
function isBlankTask(task) {
  return (
    task.revision === 1 &&
    task.status === "draft" &&
    !task.active_run &&
    task.title === "新任务"
  );
}
/* 切走时可以丢弃的空白任务：没有运行、没有材料、输入框里也没写东西。 */
function isDiscardable(task) {
  return (
    !!task &&
    isBlankTask(task) &&
    !state.dirty &&
    !task.runs?.length &&
    !task.materials?.length &&
    !task.config?.materials?.length &&
    !$("#message").value.trim()
  );
}
async function discardBlank(id) {
  try {
    await api(`/tasks/${id}`, { method: "DELETE" });
    localStorage.removeItem(`nbx_agent_draft_${state.catalog.user.id}_${id}`);
  } catch {
    // 丢弃失败不影响切换；下次新建时会复用这条空白任务。
  }
}
async function createTask(config) {
  await requireSaved();
  // 进入页面、删除当前任务、Ctrl+N 都会走到这里；已有空白任务时直接复用，
  // 避免每次都在侧栏堆出一条新的“新任务”。带模板配置的创建仍新建。
  if (!config) {
    const { tasks } = await api("/tasks?limit=100");
    const blank = tasks.find(isBlankTask);
    if (blank) {
      if (blank.id === state.task?.id) {
        toast("当前已是空白任务");
        return;
      }
      history.replaceState({}, "", `/agent/tasks/${blank.id}#prompt`);
      await openTask(blank.id);
      await listTasks();
      return;
    }
  }
  const item = await api("/tasks", {
    method: "POST",
    body: {
      title: "新任务",
      config: config || {
        ...state.catalog.defaults,
        model:
          state.catalog.default_model || state.catalog.models[0]?.id || "",
      },
    },
  });
  // 新任务总从提示词页开始，不继承上一个任务的哈希标签。
  history.replaceState({}, "", `/agent/tasks/${item.id}#prompt`);
  await openTask(item.id);
  await listTasks();
}
async function openTask(id, push = true) {
  modelPicker?.close();
  if (state.task?.id === id) {
    const hash = location.hash.slice(1);
    setMode(hash === "trajectory" ? "trajectory" : "chat", false);
    if (TAB_IDS.has(hash)) setTab(hash, false);
    return;
  }
  await requireSaved();
  // 新建后什么都没做就切到别的任务：这条空白任务随之消失。
  const discard = isDiscardable(state.task) ? state.task.id : "";
  clearTimeout(pollTimer);
  const generation = ++state.generation;
  const task = await api(`/tasks/${id}`);
  if (generation !== state.generation) return;
  if (discard) {
    // 先等删除落地再刷新侧栏，避免并发的列表请求把它又画回来。
    await discardBlank(discard);
    listTasks().catch(error);
    if (generation !== state.generation) return;
  }
  state.task = task;
  app.dataset.task = task.id;
  state.configChangedDuringRun = false;
  state.templateUndo = null;
  $("#undo-template").hidden = true;
  state.dirty = false;
  state.conflict = false;
  state.cursor = 0;
  state.entries.clear();
  state.runs = new Map(task.runs.map((run) => [run.id, run]));
  state.notes.clear();
  state.version = null;
  state.selectedVersion = null;
  state.pages = [];
  state.page = 0;
  clearTimeline();
  $("#conflict").hidden = true;
  saveState("已保存", "saved");
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey()) || "null");
    if (draft) {
      task.config = draft.config;
      task.title = draft.title;
      state.dirty = true;
      state.conflict = draft.revision !== task.revision;
      $("#conflict").hidden = !state.conflict;
      saveState("本地草稿已恢复", "draft");
    }
  } catch {}
  const hash = location.hash.slice(1);
  const tab = TAB_IDS.has(hash) ? hash : "prompt";
  if (push) history.pushState({ view: "work" }, "", `/agent/tasks/${id}#${tab}`);
  fill();
  state.conversation?.destroy();
  state.conversation = new Conversation({
    api,
    taskId: id,
    getTask: () => state.task,
    onOpenResult: (versionId) => {
      setWorkspace(true);
      setTab("results");
      selectVersion(versionId).catch(error);
    },
    onOpenEntry: (entryId, kind) => openEntry(entryId, kind).catch(error),
    onReview: (entryId) => openReview(entryId).catch(error),
    onError: error,
    onModeChange: (mode) => {
      app.dataset.mode = mode;
      for (const button of $$(".view-tabs [data-mode]"))
        button.toggleAttribute("aria-current", button.dataset.mode === mode);
      if (mode === "trajectory") $("#activity-dot").textContent = "";
    },
    onRequestStop: () => stopRun().catch(error),
    toast,
  });
  await state.conversation.load(task);
  setMode(hash === "trajectory" ? "trajectory" : "chat", false);
  setTab(tab, false);
  if (isMobile()) setView("chat", false);
  if (isNarrow()) drawer(false, { focus: false });
  await listTasks();
  updateStatus();
  poll();
  if (state.dirty && !state.conflict)
    saveTimer = setTimeout(() => save().catch(error), 800);
  document.title = `${task.title} · NeoBangX Agent`;
}
function fill() {
  const task = state.task;
  if (!task) return;
  const template = state.catalog?.official_templates
    .concat(state.catalog?.templates || [])
    .find((item) => item.id === task.config.template_id);
  setText($("#prompt-origin"), template ? `模板 · ${template.name}` : "任务副本");
  $("#task-title").value = task.title;
  for (const [id, key] of Object.entries(FIELDS)) {
    const el = $("#" + id);
    if (el.type === "checkbox") el.checked = Boolean(task.config[key]);
    else el.value = task.config[key] ?? "";
  }
  modelPicker?.setValue(task.config.model || "");
  autoGrow($("#prompt"));
  autoGrow($("#behavior"));
  $("#template").value = task.config.template_id || "";
  refreshSelects();
  $("#message").value = task.runs.length ? "" : task.config.goal || "";
  autoGrow($("#message"));
  updateDraftEmpty();
  $("#message").placeholder = task.runs.length
    ? "补充要求，或直接继续任务…"
    : "今天我能帮你做些什么？";
  $("#composer-seat").dataset.hero = String(!task.runs.length);
  $("#composer-card").dataset.hero = String(!task.runs.length);
  renderMaterials();
  renderTools();
  renderTeaching();
  renderVersions();
  updateStatus();
}
function clearTimeline() {
  $("#timeline")
    .querySelectorAll("[data-entry],[data-run],[data-note]")
    .forEach((el) => el.remove());
  const empty = $("#timeline-empty");
  if (empty) empty.hidden = false;
}
function syncTimelineEmpty() {
  const empty = $("#timeline-empty");
  if (!empty) return;
  empty.hidden = Boolean(
    $("#timeline").querySelector("[data-entry],[data-run],[data-note]"),
  );
}
function updateStatus() {
  const task = state.task;
  const active = ACTIVE.has(task?.status);
  const status = task?.status || "";
  setText($("#task-status"), STATUS[status] || "准备就绪");
  $("#task-status-pill").dataset.state = status || "idle";
  $("#task-status-pill").title = STATUS[status] || "准备就绪";
  $("#next-step").hidden = !(active && state.configChangedDuringRun);
  const runPolicy = $("#run-policy");
  if (runPolicy && state.catalog?.billing) runPolicy.textContent = state.catalog.billing;
  setText(
    $("#composer-status"),
    active
      ? `${STATUS[status] || "执行中"} · 执行在后台继续`
      : STATUS[status] || "准备就绪",
  );
  $("#composer-status").dataset.state = status || "idle";
  state.conversation?.updateComposerState();
  state.conversation?.updateWaiting();
  state.conversation?.refreshEmpty();
  syncClawd();
}

/* ---------------- 轨迹卡片 ---------------- */
function upsert(list, item) {
  const index = list.findIndex((x) => x.id === item.id);
  if (index < 0) list.push(item);
  else list[index] = item;
}
function stepIcon(item) {
  const label = String(item.label || "");
  if (item.kind === "review") return "list-checks";
  if (/审阅/.test(label)) return "list-checks";
  if (/搜索|检索/.test(label)) return "search";
  if (/材料|读取/.test(label)) return "file-text";
  if (/修订|改写/.test(label)) return "wand";
  if (/试运行/.test(label)) return "play";
  if (/成果|生成|输出/.test(label)) return "sparkle";
  return "route";
}
function entryCard(item) {
  let card = $(`#timeline [data-entry="${item.id}"]`);
  if (!card) {
    card = document.createElement("article");
    card.className = "entry";
    card.dataset.entry = item.id;
    card.innerHTML =
      '<div class="entry-header"><span class="entry-title"></span><small class="entry-state"></small></div><small class="entry-meta"></small><p class="entry-note"></p><div class="aw-step-actions"></div>';
    $("#timeline").append(card);
    for (const [kind, label] of [
      ["reasoning", "思考"],
      ["output", "输出"],
      ["input", "参数"],
      ["prompt", "指令"],
      ["arguments", "工具调用"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `${icon(KIND_ICON[kind])}<span>${label}</span>`;
      button.dataset.kind = kind;
      button.onclick = () => openEntry(item.id, kind).catch(error);
      card.querySelector(".aw-step-actions").append(button);
    }
  }
  card.dataset.status = item.status;
  const title = card.querySelector(".entry-title");
  if (title.dataset.label !== item.label) {
    title.dataset.label = item.label;
    title.innerHTML = `${icon(stepIcon(item))}<span></span>`;
    title.querySelector("span").textContent = item.label;
  }
  const stateEl = card.querySelector(".entry-state");
  setText(stateEl, STATUS[item.status] || item.status);
  if (stateEl.dataset.state !== item.status) stateEl.dataset.state = item.status;
  const counts = item.details.chars || {};
  const meta =
    Object.entries(counts)
      .filter(([key]) => key !== "prompt")
      .map(
        ([key, n]) =>
          `${{ reasoning: "思考", output: "输出", arguments: "调用", input: "参数" }[key] || key} ${Number(n).toLocaleString()} 字符`,
      )
      .join(" · ") || "等待输出";
  setText(card.querySelector(".entry-meta"), meta);
  setText(
    card.querySelector(".entry-note"),
    item.details.error ||
      item.details.question ||
      item.details.review_summary ||
      "",
  );
  const actions = card.querySelector(".aw-step-actions");
  if (
    ["read_material", "search_material"].includes(item.label) &&
    item.status === "done" &&
    !actions.querySelector("[data-source]")
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.source = item.id;
    button.innerHTML = `${icon("target")}<span>定位材料</span>`;
    button.onclick = () => sourceLinks(item.id).catch(error);
    actions.append(button);
  }
  if (
    item.kind === "review" &&
    item.details.version_id &&
    !actions.querySelector("[data-review]")
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.review = item.id;
    button.innerHTML = `${icon("list-checks")}<span>处理审阅意见</span>`;
    button.onclick = () => openReview(item.id).catch(error);
    actions.append(button);
  }
  card.querySelectorAll("[data-kind]").forEach((button) => {
    button.hidden = !counts[button.dataset.kind];
  });
}
function runCard(run) {
  let card = $(`#timeline [data-run="${run.id}"]`);
  if (!card) {
    card = document.createElement("article");
    card.className = "entry";
    card.dataset.run = run.id;
    card.innerHTML =
      '<div class="entry-header"><strong></strong><button class="aw-steplink" type="button"><span></span></button></div><small></small>';
    card.querySelector("button").onclick = async () => {
      try {
        const detail = await api(path(`/runs/${run.id}`));
        readText("本轮配置快照", JSON.stringify(detail.snapshot, null, 2));
      } catch (e) {
        error(e);
      }
    };
    $("#timeline").append(card);
  }
  card.dataset.status = run.status;
  const label = `${{ execute: "执行", continue: "继续", review: "审阅", revise: "修订", tool_test: "教学工具试运行" }[run.mode] || run.mode} · ${STATUS[run.status] || run.status}`;
  const strong = card.querySelector("strong");
  if (strong.dataset.label !== label) {
    strong.dataset.label = label;
    strong.innerHTML = `${icon("route")}<span></span>`;
    strong.querySelector("span").textContent = label;
  }
  setText(card.querySelector(".aw-steplink span"), "本轮配置");
  setText(
    card.querySelector("small"),
    run.error || `步骤 ${run.step} · ${Number(run.tokens).toLocaleString()} tokens`,
  );
  syncTimelineEmpty();
}

/* ---------------- 轮询 ---------------- */
async function poll() {
  clearTimeout(pollTimer);
  if (!state.task) return;
  const generation = state.generation,
    id = state.task.id;
  const conversation = state.conversation;
  try {
    const data = await api(`/tasks/${id}/events?after=${state.cursor}`);
    if (generation !== state.generation) return;
    for (const event of data.events) {
      const value = event.data;
      if (event.kind === "entry") {
        state.entries.set(value.id, value);
        entryCard(value);
        $("#activity-dot").textContent =
          app.dataset.mode === "trajectory" ? "•" : "";
      }
      if (event.kind === "run") {
        state.runs.set(value.id, value);
        upsert(state.task.runs, value);
        runCard(value);
      }
      if (event.kind === "material") {
        upsert(state.task.materials, value);
        renderMaterials();
      }
      if (event.kind === "version") {
        upsert(state.task.versions, value);
        renderVersions();
        $("#result-dot").textContent = "•";
      }
      if (event.kind === "adopt") {
        state.task.adopted_version = value.version_id;
        renderVersions();
      }
      if (event.kind === "note") {
        let card = $(`#timeline [data-note="${value.id}"]`);
        if (!card) {
          card = document.createElement("article");
          card.className = "entry";
          card.dataset.note = value.id;
          card.innerHTML = `<div class="aw-note">${icon("chat")}<span></span></div>`;
          $("#timeline").append(card);
        }
        card.dataset.status = value.applied ? "done" : "queued";
        card.querySelector(".aw-note span").textContent =
          `${value.applied ? "已生效" : "已接收，等待下一步"}：${value.text}`;
      }
      if (state.conversation === conversation)
        state.conversation.applyEvent(event);
    }
    state.cursor = data.cursor;
    state.task.status = data.task.status;
    state.task.active_run = data.task.active_run;
    state.task.adopted_version = data.task.adopted_version;
    if (data.task.revision > state.task.revision && !state.saving) {
      if (state.dirty) {
        state.conflict = true;
        $("#conflict").hidden = false;
        saveState("需处理冲突", "conflict");
      } else {
        const latest = await api(`/tasks/${id}`);
        if (generation !== state.generation) return;
        const localMessage = $("#message").value;
        state.task = latest;
        fill();
        if (latest.runs.length) $("#message").value = localMessage;
        state.conversation?.setTask(latest);
      }
    }
    updateStatus();
    syncTimelineEmpty();
    connState(
      "已连接",
      "live",
      ACTIVE.has(state.task.status) ? "已连接 · 任务在后台执行" : "已连接",
    );
    pollTimer = setTimeout(
      poll,
      data.has_more ? 30 : ACTIVE.has(state.task.status) ? 1000 : 5000,
    );
  } catch (e) {
    if (generation !== state.generation) return;
    console.error("agent poll", e);
    connState(
      navigator.onLine ? "重连中" : "离线",
      "error",
      navigator.onLine
        ? "连接中断，正在重试；任务状态待同步"
        : "离线 · 任务状态待同步",
    );
    pollTimer = setTimeout(poll, 5000);
  }
}
$("#latest").onclick = () => state.conversation?.scrollToLatest();

async function openEntry(id, kind) {
  const entry =
    state.entries.get(id) ||
    state.conversation?.getEntry(id) ||
    { label: "步骤" };
  const taskId = state.task.id;
  modal(
    `${entry.label} · ${{ reasoning: "思考全文", prompt: "实际指令", input: "输入参数", output: "输出全文", arguments: "工具调用" }[kind]}`,
    '<div id="full-reader"></div>',
    [],
    { wide: true },
  );
  const r = new FullReader($("#full-reader"), {
    onError: error,
    readFull: async () =>
      (
        await api(
          `/tasks/${taskId}/entries/${id}/content?kind=${kind}&download=true`,
          { blob: true },
        )
      ).text(),
    download: async () =>
      saveBlob(
        await api(
          `/tasks/${taskId}/entries/${id}/content?kind=${kind}&download=true`,
          { blob: true },
        ),
        `${entry.label}-${kind}.txt`,
      ),
  });
  reader = r;
  r.root.querySelector(".reader-meta").textContent = "正在读取全文与分页…";
  r.root.querySelector("[data-a=find]").disabled = true;
  let after = 0;
  async function load() {
    if (r.closed) return;
    try {
      const data = await api(
        `/tasks/${taskId}/entries/${id}/content?kind=${kind}&after=${after}`,
      );
      if (r.closed) return;
      after = data.cursor;
      r.append(data.chunks.map((chunk) => chunk.text));
      r.root.querySelector("[data-a=find]").disabled = data.has_more;
      if (!data.chunks.length && !r.length)
        r.root.querySelector(".reader-meta").textContent =
          "接口尚未返回此类文本，不会生成或猜测思考内容";
      if (data.has_more || data.status === "running")
        r.timer = setTimeout(load, data.has_more ? 30 : 1000);
    } catch (e) {
      if (!r.closed) {
        r.onError(e);
        r.timer = setTimeout(load, 4000);
      }
    }
  }
  await load();
}

/* ---------------- 执行 ---------------- */
async function start(mode = "execute", instruction = "", baseVersion = "", teachingTool = "") {
  await requireSaved();
  const keyName = `nbx_agent_request_${state.task.id}`,
    signature = JSON.stringify({ mode, instruction, baseVersion, teachingTool });
  let old;
  try {
    old = JSON.parse(sessionStorage.getItem(keyName) || "null");
  } catch {}
  const key = old?.signature === signature ? old.key : newKey();
  sessionStorage.setItem(keyName, JSON.stringify({ key, signature }));
  const run = await api(path("/runs"), {
    method: "POST",
    body: {
      request_key: key,
      mode,
      instruction,
      base_version: baseVersion,
      teaching_tool: teachingTool,
    },
  });
  sessionStorage.removeItem(keyName);
  if (instruction) run.instruction = instruction;
  state.task.status = run.status;
  state.task.active_run = run.id;
  state.configChangedDuringRun = false;
  upsert(state.task.runs, run);
  state.runs.set(run.id, run);
  runCard(run);
  state.conversation?.setTask(state.task);
  state.conversation?.applyEvent({ kind: "run", data: run });
  $("#message").value = "";
  autoGrow($("#message"));
  updateDraftEmpty();
  setMode("chat", false);
  setView("chat", false);
  updateStatus();
  state.conversation?.refreshEmpty();
  state.conversation?.updateComposerState();
  state.conversation?.scrollToLatest();
  poll();
  await listTasks();
}
async function stopRun() {
  await api(path("/stop"), { method: "POST" });
  state.task.status = "stopping";
  toast("已请求停止，正在保存已收到的内容");
  poll();
}
async function sendMessage() {
  if (!state.task) return;
  const text = $("#message").value.trim();
  if (ACTIVE.has(state.task?.status)) {
    if (!text) {
      toast("任务正在执行，可直接等待结果；有补充要求时再发送");
      return;
    }
    await api(path("/notes"), { method: "POST", body: { text } });
    $("#message").value = "";
    autoGrow($("#message"));
    updateDraftEmpty();
    poll();
    return;
  }
  if (!state.task.runs.length) {
    await start("execute");
    return;
  }
  await start("continue", text, state.task.adopted_version || "");
}
$("#send").onclick = () => sendMessage().catch(error);
$("#stop").onclick = () => stopRun().catch(error);
$("#apply-next").onclick = async () => {
  try {
    await requireSaved();
    await api(path("/notes"), { method: "POST", body: { apply_config: true } });
    state.configChangedDuringRun = false;
    $("#next-step").hidden = true;
    toast("已接收，新配置将在下一步生效；本轮模型保持不变");
    poll();
  } catch (e) {
    error(e);
  }
};
$("#copy-task").onclick = async () => {
  closeMenus();
  try {
    await requireSaved();
    const task = await api(path("/copy"), { method: "POST" });
    await openTask(task.id);
  } catch (e) {
    error(e);
  }
};
$("#delete-task").onclick = () => {
  closeMenus();
  confirmAction(
    "删除任务",
    "此任务的材料、过程和全部成果将一并删除，无法恢复。",
    async () => {
      await api(path(), { method: "DELETE" });
      localStorage.removeItem(draftKey());
      state.dirty = false;
      state.task = null;
      await createTask();
    },
  );
};

/* ---------------- 模板 ---------------- */
function getTemplate() {
  return (
    state.catalog.official_templates.find(
      (template) => template.id === $("#template").value,
    ) ||
    state.catalog.templates.find(
      (template) => template.id === $("#template").value,
    )
  );
}
function applyTemplate(template) {
  if (!template) return;
  state.templateUndo = structuredClone(state.task.config);
  if (template.kind === "tool") {
    state.task.config.tools = [...template.config.tools];
    state.task.config.teaching_tools = { ...template.config.teaching_tools };
  } else if (template.config) {
    const current = state.task.config;
    state.task.config = {
      ...template.config,
      materials: current.materials,
      goal: current.goal,
      model: current.model,
      template_id: template.id,
    };
  } else {
    state.task.config.prompt = template.prompt;
    state.task.config.template_id = template.id;
  }
  fill();
  $("#undo-template").hidden = false;
  changed();
}
$("#undo-template").onclick = () => {
  if (!state.templateUndo) return;
  state.task.config = {
    ...state.templateUndo,
    materials: state.task.config.materials,
    goal: state.task.config.goal,
    model: state.task.config.model,
  };
  state.templateUndo = null;
  fill();
  changed();
  $("#undo-template").hidden = true;
};
/* 应用模板会覆盖的字段：官方模板只换提示词，工具配置只换工具，个人提示词模板换整份配置。 */
const KEEP_ON_TEMPLATE = new Set(["materials", "goal", "model", "template_id"]);
function templateFields(template) {
  if (template.kind === "tool") return ["tools", "teaching_tools"];
  if (!template.config) return ["prompt"];
  return [
    ...new Set([
      ...Object.keys(template.config),
      ...Object.keys(state.task.config),
    ]),
  ].filter((key) => !KEEP_ON_TEMPLATE.has(key));
}
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
function sameValue(key, a, b) {
  // 工具勾选顺序无意义，按集合比较。
  if (key === "tools")
    return canon([...(a || [])].sort()) === canon([...(b || [])].sort());
  return canon(a) === canon(b);
}
/* 被覆盖的字段若与目标相同，或能从默认配置、模板库里原样找回，就不算会丢的改动。 */
function wouldLoseEdits(template) {
  const config = state.task.config;
  const target = template.config || { prompt: template.prompt };
  const sources = [
    state.catalog.defaults,
    ...state.catalog.official_templates.map((item) => ({ prompt: item.prompt })),
    ...state.catalog.templates.map((item) => item.config),
  ];
  return templateFields(template).some(
    (key) =>
      !sameValue(key, config[key], target[key]) &&
      !sources.some(
        (source) =>
          source && key in source && sameValue(key, config[key], source[key]),
      ),
  );
}
$("#template").onchange = () => {
  const template = getTemplate();
  if (!template) {
    state.task.config.template_id = "";
    changed();
    return;
  }
  if (!wouldLoseEdits(template)) return applyTemplate(template);
  confirmAction(
    "应用模板",
    "将替换任务提示词或工具配置；当前材料与目标保留。",
    () => applyTemplate(template),
  );
};
$("#reset-prompt").onclick = () => {
  const template = getTemplate();
  if (!template) return error(Error("请先选择模板"));
  if (!wouldLoseEdits(template)) return applyTemplate(template);
  confirmAction("恢复模板", "恢复模板会替换当前编辑内容。", () =>
    applyTemplate(template),
  );
};
function askText(title, label, initial, run) {
  modal(
    title,
    `<label for="dialog-value">${esc(label)}</label><textarea id="dialog-value"></textarea>`,
    [
      { text: "取消", run: closeModal },
      {
        text: "保存",
        primary: true,
        run: async () => {
          await run($("#dialog-value").value);
          closeModal();
        },
      },
    ],
  );
  $("#dialog-value").value = initial;
}
async function saveTemplate(kind) {
  askText(
    kind === "tool" ? "保存工具配置" : "另存为我的模板",
    "模板名称",
    // 标题还是默认的“新任务”时，用当前所选模板名作为更有意义的默认名。
    state.task.title === "新任务"
      ? getTemplate()?.name || state.task.title
      : state.task.title,
    async (name) => {
      await requireSaved();
      const result = await api("/templates", {
        method: "POST",
        body: { name: name.trim(), kind, config: state.task.config },
      });
      state.catalog.templates.push(result);
      renderTemplateOptions();
      toast("已保存到个人库");
    },
  );
}
$("#save-template").onclick = () => saveTemplate("prompt").catch(error);
$("#save-tool-template").onclick = () => saveTemplate("tool").catch(error);
function renderTemplateOptions() {
  const options =
    '<option value="">自定义提示词</option>' +
    state.catalog.official_templates
      .map((template) => `<option value="${esc(template.id)}">官方 · ${esc(template.name)}</option>`)
      .join("") +
    state.catalog.templates
      .map((template) => `<option value="${esc(template.id)}">我的 · ${esc(template.name)}</option>`)
      .join("");
  $("#template").innerHTML = options;
  $("#teaching-select").innerHTML = state.catalog.official_templates
    .map((template) => `<option value="${esc(template.id)}">${esc(template.name)}</option>`)
    .join("");
  if (state.task) $("#template").value = state.task.config.template_id || "";
  refreshSelects();
}
function openLibrary() {
  modal("我的提示词与工具", '<div id="library"></div>');
  const root = $("#library");
  if (!state.catalog.templates.length) {
    root.textContent = "还没有个人模板。在提示词或工具页另存即可。";
    return;
  }
  for (const template of state.catalog.templates) {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.innerHTML = `<strong></strong><small>${template.kind === "tool" ? "工具配置" : "提示词模板"}</small><div class="row"><button data-use type="button">用于当前任务</button><button data-new type="button">新建任务</button><button data-del type="button" class="danger">删除</button></div>`;
    card.querySelector("strong").textContent = template.name;
    card.querySelector("[data-use]").onclick = () => {
      applyTemplate(template);
      closeModal();
    };
    card.querySelector("[data-new]").onclick = async () => {
      try {
        await createTask({ ...template.config, materials: [], template_id: template.id });
        closeModal();
      } catch (e) {
        error(e);
      }
    };
    card.querySelector("[data-del]").onclick = () => {
      confirmAction(
        "删除个人模板",
        "只删除个人库中的模板；任务中已保存的副本和成果会保留。",
        async () => {
          await api(`/templates/${template.id}`, { method: "DELETE" });
          state.catalog.templates = state.catalog.templates.filter(
            (item) => item.id !== template.id,
          );
          renderTemplateOptions();
          closeModal();
          openLibrary();
        },
      );
    };
    root.append(card);
  }
}

/* ---------------- 成果 ---------------- */
let worker,
  workerSeq = 0;
const pendingWork = new Map();
function work(data) {
  if (!worker) {
    worker = new Worker("/static/agent/document-worker.js");
    worker.onmessage = ({ data: message }) => {
      const pending = pendingWork.get(message.id);
      pendingWork.delete(message.id);
      if (pending)
        message.error
          ? pending.reject(Error(message.error))
          : pending.resolve(message.result);
    };
    worker.onerror = () => {
      for (const pending of pendingWork.values())
        pending.reject(Error("文档处理失败，请使用原文阅读"));
      pendingWork.clear();
      worker.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    pendingWork.set(id, { resolve, reject });
    worker.postMessage({ ...data, id });
  });
}
async function compare(title, before, after) {
  const blocks = await work({ type: "diff", before, after });
  const body = document.createElement("div");
  body.className = "diff-view";
  for (const block of blocks) {
    const section = document.createElement("section");
    section.className = `diff-block ${block.kind}`;
    const label = document.createElement("div");
    label.className = "diff-label";
    label.textContent =
      { same: "未修改", removed: "− 原版", added: "+ 修改版" }[block.kind] +
      ` · ${block.lines.length} 行`;
    const pre = document.createElement("pre");
    pre.textContent = block.lines.join("\n");
    section.append(label, pre);
    body.append(section);
  }
  modal(`${title} · 共同首尾与完整变更段`, body, [], { wide: true });
}
$("#compare-prompt").onclick = () =>
  compare(
    "提示词比较",
    getTemplate()?.prompt ||
      getTemplate()?.config?.prompt ||
      state.catalog.defaults.prompt,
    $("#prompt").value,
  ).catch(error);
$("#compare-conflict").onclick = async () => {
  try {
    const remote = await api(path());
    const local = structuredClone(state.task);
    modal("保存冲突 · 本地草稿仍保留", "<p>先比较两份完整配置，再选择处理方式。</p>", [
      {
        text: "比较完整配置",
        run: () =>
          compare(
            "本地与服务器",
            JSON.stringify(remote.config, null, 2),
            JSON.stringify(local.config, null, 2),
          ),
      },
      {
        text: "保留为新任务",
        run: async () => {
          const copy = await api(path("/copy"), { method: "POST" });
          const mapped = new Map(Object.entries(copy.material_map));
          const config = {
            ...local.config,
            materials: local.config.materials
              .map((id) => mapped.get(id))
              .filter(Boolean),
          };
          await api(`/tasks/${copy.id}`, {
            method: "PUT",
            body: {
              title: local.title + " · 本地草稿",
              revision: copy.revision,
              config,
            },
          });
          state.dirty = false;
          state.conflict = false;
          localStorage.removeItem(draftKey());
          closeModal();
          await openTask(copy.id);
        },
      },
      {
        text: "采用服务器版本",
        run: () => {
          state.task = remote;
          state.dirty = false;
          state.conflict = false;
          localStorage.removeItem(draftKey());
          $("#conflict").hidden = true;
          fill();
          saveState("已保存", "saved");
          closeModal();
        },
      },
      {
        text: "用本地版本保存",
        primary: true,
        run: async () => {
          state.task.revision = remote.revision;
          state.conflict = false;
          state.dirty = true;
          if (await save()) {
            $("#conflict").hidden = true;
            closeModal();
          }
        },
      },
    ]);
  } catch (e) {
    error(e);
  }
};

function renderVersions() {
  if (!state.task) return;
  const versions = state.task.versions;
  setText($("#version-count"), versions.length ? String(versions.length) : "");
  $("#result-empty").hidden = versions.length > 0;
  $("#versions-list").replaceChildren();
  versions.forEach((version, index) => {
    const adopted = version.id === state.task.adopted_version;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "version-row";
    button.dataset.version = version.id;
    button.dataset.current = String(version.id === state.version?.id);
    button.innerHTML = `<span class="num">${index + 1}</span><span class="version-main"><strong></strong><small></small></span>${adopted ? '<span class="adopted">已采用</span>' : ""}`;
    button.querySelector("strong").textContent = version.title;
    button.querySelector("small").textContent = `${version.complete ? "完整" : "待补全"} · ${fmtChars(version.chars)}`;
    button.onclick = () => selectVersion(version.id).catch(error);
    $("#versions-list").append(button);
  });
  $("#version-select").innerHTML = versions
    .map(
      (version, index) =>
        `<option value="${version.id}">版本 ${index + 1} · ${esc(version.title)}${version.id === state.task.adopted_version ? " · 已采用" : ""}</option>`,
    )
    .join("");
  if (state.version) $("#version-select").value = state.version.id;
  refreshSelects();
  $("#result-actions").hidden = !state.version;
}
$("#version-select").onchange = (event) =>
  selectVersion(event.target.value).catch(error);
async function ensureResultSelection() {
  if (!state.task || state.version) return;
  const versions = state.task.versions;
  if (!versions.length) return;
  await selectVersion(versions[versions.length - 1].id);
}
async function selectVersion(id) {
  const generation = state.generation;
  state.selectedVersion = id;
  const version = await api(path(`/versions/${id}`));
  if (generation !== state.generation || state.selectedVersion !== id) return;
  state.version = version;
  state.page = 0;
  state.pages = pageText(version.content);
  $("#result-actions").hidden = false;
  $("#version-select").value = id;
  refreshSelects();
  renderVersions();
  renderDocument();
  try {
    const pages = await work({ type: "pages", text: version.content });
    if (state.version?.id !== id) return;
    state.pages = pages;
    renderDocument();
  } catch (e) {
    console.warn(e);
  }
}
function setDocumentHead(version) {
  setText($("#document-title"), version.title);
  const index = state.task.versions.findIndex((item) => item.id === version.id);
  setText($("#document-version"), index >= 0 ? `v${index + 1}` : "");
  $("#document-adopted").hidden = state.task.adopted_version !== version.id;
}
function renderDocument() {
  if (!state.version) return;
  const page = state.pages[state.page];
  if (!page) return;
  const raw = $("#result-plain").checked || page.plain;
  const root = $("#result-body");
  root.className = "document" + (raw ? " plain" : " md");
  setDocumentHead(state.version);
  if (raw) {
    root.textContent = page.text;
  } else {
    root.innerHTML = window.DOMPurify.sanitize(window.marked.parse(page.text), {
      FORBID_TAGS: ["img", "iframe", "style", "link", "meta"],
      FORBID_ATTR: ["style"],
    });
    decorateDocument(root);
  }
  $("#result-page").textContent = `${state.page + 1} / ${state.pages.length} 段${
    page.plain ? " · 长段落原文" : ""
  }`;
  $("#result-prev").disabled = state.page === 0;
  $("#result-next").disabled = state.page === state.pages.length - 1;
  $("#adopt").disabled =
    !state.version.complete ||
    state.task.adopted_version === state.version.id;
}
function decorateDocument(root) {
  root.querySelectorAll("a").forEach((anchor) => {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  });
  root.querySelectorAll("table").forEach((table) => {
    const headers = [...table.querySelectorAll("thead th")].map(
      (header) => header.textContent,
    );
    if (table.querySelector("[colspan],[rowspan]")) return;
    table.querySelectorAll("tbody tr").forEach((row) =>
      [...row.children].forEach(
        (cell, index) =>
          (cell.dataset.label = headers[index] || `第 ${index + 1} 列`),
      ),
    );
    if ($("#table-cards").checked) table.classList.add("cards");
  });
}
$("#result-prev").onclick = () => {
  state.page--;
  renderDocument();
  $("#work-body").scrollTop = 0;
};
$("#result-next").onclick = () => {
  state.page++;
  renderDocument();
  $("#work-body").scrollTop = 0;
};
$("#result-plain").onchange = renderDocument;
$("#table-cards").onchange = renderDocument;
$("#adopt").onclick = async () => {
  try {
    await api(path(`/versions/${state.version.id}/adopt`), {
      method: "POST",
      body: { expected: state.task.adopted_version },
    });
    state.task.adopted_version = state.version.id;
    renderVersions();
    renderDocument();
    toast("已采用，之前版本仍保留");
  } catch (e) {
    error(e);
  }
};
$("#compare-version").onclick = async () => {
  try {
    if (!state.version.parent_id) throw Error("此版本没有基准版本");
    const parent = await api(path(`/versions/${state.version.parent_id}`));
    await compare("成果版本比较", parent.content, state.version.content);
  } catch (e) {
    error(e);
  }
};
$("#edit-version").onclick = () => {
  const baseVersion = state.version;
  askText("编辑成果 · 保存为新版本", "完整正文", baseVersion.content, async (content) => {
    const result = await api(path("/versions"), {
      method: "POST",
      body: {
        request_key: newKey(),
        title: baseVersion.title,
        content,
        parent_id: baseVersion.id,
      },
    });
    upsert(state.task.versions, result);
    renderVersions();
    await selectVersion(result.id);
  });
};
$("#review-version").onclick = () => start("review", "", state.version.id).catch(error);
$("#revise-version").onclick = () =>
  askText("修订此版本", "具体修改要求", "", async (instruction) => {
    await start("revise", instruction, state.version.id);
  });
$("#copy-result").onclick = async () => {
  try {
    await copyText(state.version.content);
    toast("已复制完整成果");
  } catch (e) {
    error(e);
  }
};
$("#export-md").onclick = () =>
  saveBlob(state.version.content, state.version.title + ".md", "text/markdown;charset=utf-8");
$("#export-docx").onclick = async () => {
  try {
    const version = state.version;
    const pages = await work({ type: "pages", text: version.content });
    const fragments = [];
    for (const page of pages) {
      fragments.push(
        window.DOMPurify.sanitize(
          page.plain
            ? `<pre>${esc(page.text)}</pre>`
            : window.marked.parse(page.text),
          {
            FORBID_TAGS: ["img", "iframe", "style", "link", "meta"],
            FORBID_ATTR: ["style"],
          },
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    saveBlob(
      await work({
        type: "docx",
        html: `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragments.join("")}</body></html>`,
      }),
      version.title + ".docx",
    );
  } catch (e) {
    error(e);
  }
};
$("#view-instruction").onclick = () => {
  const run = state.task?.runs?.[state.task.runs.length - 1];
  if (!run) return error(Error("还没有执行记录"));
  api(path(`/runs/${run.id}`))
    .then((detail) => readText("最近一轮的完整指令", JSON.stringify(detail.snapshot, null, 2)))
    .catch(error);
};

/* ---------------- 弹层 ---------------- */
function modal(title, body, buttons = [], { wide = false } = {}) {
  closeModal();
  const dialog = $("#modal");
  dialog.dataset.wide = String(wide);
  $("#modal-title").textContent = title;
  $("#modal-body").replaceChildren();
  if (typeof body === "string") $("#modal-body").innerHTML = body;
  else $("#modal-body").append(body);
  $("#modal-actions").replaceChildren();
  for (const item of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.text;
    button.className = item.primary ? "btn btn-primary" : "btn btn-ghost";
    button.onclick = async () => {
      button.disabled = true;
      try {
        await item.run();
      } catch (e) {
        error(e);
      } finally {
        button.disabled = false;
      }
    };
    $("#modal-actions").append(button);
  }
  $("#modal-actions").hidden = !buttons.length;
  dialog.showModal();
}
function closeModal() {
  reader?.destroy();
  reader = null;
  modalCleanup?.();
  modalCleanup = null;
  if ($("#modal").open) $("#modal").close();
}
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("cancel", closeModal);
function readText(title, text) {
  modal(title, '<div id="full-reader"></div>', [], { wide: true });
  reader = new FullReader($("#full-reader"), {
    text,
    download: () => saveBlob(text, `${title}.txt`),
    onError: error,
  });
}
function confirmAction(title, text, run) {
  modal(title, `<p>${esc(text)}</p>`, [
    { text: "取消", run: closeModal },
    {
      text: "确认",
      primary: true,
      run: async () => {
        await run();
        closeModal();
      },
    },
  ]);
}

/* 政策 */
$$("[data-policy]").forEach((button) => {
  button.onclick = async () => {
    closeMenus();
    try {
      const catalog = await api("/catalog");
      modal(
        "本轮预算与任务保存",
        `<div class="policy">
          <p>${esc(catalog.billing)}</p>
          <p>当前剩余额度：${catalog.user.is_unlimited ? "无限" : catalog.user.remaining} 次</p>
          <p>单轮上限：${catalog.limits.steps} 步、${catalog.limits.tokens.toLocaleString()} tokens、${Math.round(catalog.limits.seconds / 60)} 分钟。到达上限会保存已有内容，可继续新一轮。</p>
          <p>${esc(catalog.retention)}</p>
          <p>免费模型仍遵守管理员设置的调用频率限制。</p>
        </div>`,
      );
    } catch (e) {
      error(e);
    }
  };
});

/* ---------------- 登录 ---------------- */
function login() {
  modal(
    "登录工作台",
    '<p class="login-note">使用与普通工具相同的使用码，恢复自己的任务和成果。</p><label for="login-code">使用码</label><input id="login-code" type="password" autocomplete="off"><p id="login-error" class="login-error" role="alert"></p>',
    [
      {
        text: "登录",
        primary: true,
        run: async () => {
          const res = await fetch("/api/workspace/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: $("#login-code").value }),
          });
          const data = await res.json();
          if (!res.ok) {
            $("#login-error").textContent =
              typeof data.detail === "string"
                ? data.detail
                : JSON.stringify(data.detail);
            return;
          }
          localStorage.setItem("nbx_auth", data.token);
          closeModal();
          state.task = null;
          state.dirty = false;
          await boot();
        },
      },
    ],
  );
  setTimeout(() => $("#login-code")?.focus(), 30);
}
$("#account").onclick = () => {
  if (!state.catalog) return login();
  confirmAction("切换使用码", "当前已保存的任务仍属于原使用码。", async () => {
    await requireSaved();
    state.catalog = null;
    state.task = null;
    state.generation++;
    clearTimeout(pollTimer);
    localStorage.removeItem("nbx_auth");
    location.assign("/agent");
  });
};

/* ---------------- 审阅 ---------------- */
async function openReview(id) {
  const entry = state.entries.get(id) || state.conversation?.getEntry(id);
  const blob = await api(
    path(`/entries/${id}/content?kind=review&download=true`),
    { blob: true },
  );
  let data;
  try {
    data = JSON.parse(await blob.text());
    if (!Array.isArray(data.issues)) throw Error();
  } catch {
    throw Error("审阅格式无效，请查看输出全文；未判为通过");
  }
  modal(
    "审阅意见 · 建议由你决定",
    `<div class="review-summary">${esc(data.summary)}</div><div id="review-issues"></div>`,
    [
      {
        text: "忽略选中意见",
        run: async () => {
          const ignored = [
            ...new Set([...(entry.details.ignored || []), ...selected()]),
          ];
          await api(path(`/reviews/${id}`), {
            method: "POST",
            body: { ignored },
          });
          closeModal();
          poll();
        },
      },
      {
        text: "复核选中意见",
        run: async () => {
          const issues = selected().map((index) => data.issues[index]);
          if (!issues.length) throw Error("请先选择意见");
          await start(
            "review",
            "请重点复核这些意见是否成立：" + JSON.stringify(issues),
            entry.details.version_id,
          );
          closeModal();
        },
      },
      {
        text: "按选中意见生成候选稿",
        primary: true,
        run: async () => {
          const issues = selected().map((index) => data.issues[index]);
          if (!issues.length) throw Error("请先选择意见");
          await start(
            "revise",
            "用户选择修订这些意见；请先核对依据，保留其他内容：" +
              JSON.stringify(issues),
            entry.details.version_id,
          );
          closeModal();
        },
      },
    ],
  );
  function selected() {
    return [...document.querySelectorAll("#review-issues input:checked")].map(
      (input) => Number(input.value),
    );
  }
  data.issues.forEach((issue, index) => {
    const el = document.createElement("div");
    el.className = "tool-card aw-issue";
    el.innerHTML = `<label class="check"><input type="checkbox" value="${index}"><span>${esc(
      issue.problem,
    )}<small>${
      issue.certainty === "confirmed" ? "审阅判断：有依据" : "待核实"
    }${entry.details.ignored?.includes(index) ? " · 已忽略" : ""}</small></span></label><p><b>原文</b>${esc(
      issue.quote || "未定位",
    )}</p><p><b>依据</b>${esc(issue.evidence)}</p><p><b>建议</b>${esc(
      issue.fix,
    )}</p>`;
    $("#review-issues").append(el);
  });
}

/* ---------------- 材料来源 ---------------- */
async function sourceLinks(id) {
  const blob = await api(path(`/entries/${id}/content?download=true`), {
    blob: true,
  });
  const result = JSON.parse(await blob.text());
  const matches =
    result.matches ||
    (result.material_id ? [{ ...result, start: result.offset }] : []);
  modal("材料来源与位置", '<div id="source-list"></div>');
  for (const match of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "version-row";
    button.textContent = `${match.name || match.material_id} · 字符 ${match.start || 0}`;
    button.onclick = async () => {
      try {
        const data = await api(path(`/materials/${match.material_id}`));
        readText(data.name, data.content);
        reader.go(Math.floor((match.start || 0) / reader.size));
      } catch (e) {
        error(e);
      }
    };
    $("#source-list").append(button);
  }
  if (!matches.length) $("#source-list").textContent = "没有匹配来源。";
}

/* ---------------- 启动 ---------------- */
async function boot() {
  fillIcons();
  initTheme();
  if (localStorage.getItem("nbx_agent_sidebar") === "collapsed" && !isNarrow())
    app.dataset.sidebar = "collapsed";
  if (isNarrow()) app.dataset.sidebar = "collapsed";
  setWorkspace(
    !isOverlayWorkspace()
      ? localStorage.getItem("nbx_agent_workspace") !== "closed"
      : false,
    { persist: false },
  );
  setView("chat", false);
  if (!token()) {
    await login();
    connState("尚未登录", "idle");
    return;
  }
  try {
    state.catalog = await api("/catalog");
    $("#account-name").textContent = maskCode(state.catalog.user.code);
    $("#account-note").textContent = state.catalog.user.is_unlimited
      ? "无限额度"
      : `剩余 ${state.catalog.user.remaining} 次`;
    $("#account-avatar").textContent = state.catalog.user.code?.slice(-1) || "N";
    const initialModel =
      $("#model").value ||
      state.catalog.default_model ||
      state.catalog.models[0]?.id ||
      "";
    $("#model").value = initialModel;
    modelPicker.setModels(state.catalog.models, initialModel);
    $("#run-policy").textContent = state.catalog.billing;
    renderTemplateOptions();
    await listTasks();
    const id = location.pathname.match(/\/agent\/tasks\/([a-f0-9]+)/)?.[1];
    if (id) {
      try {
        await openTask(id, false);
      } catch (e) {
        if (e.status === 404) {
          toast("任务不存在，已新建任务");
          await createTask();
        } else throw e;
      }
    } else await createTask();
    const handoff = sessionStorage.getItem("nbx_agent_handoff");
    if (handoff) {
      sessionStorage.removeItem("nbx_agent_handoff");
      const data = JSON.parse(handoff);
      const template = state.catalog.official_templates.find(
        (item) => item.id === String(data.toolId),
      );
      if (template) applyTemplate(template);
      if (data.text)
        await receivedMaterial(
          await api(path("/materials"), {
            method: "POST",
            body: {
              name: data.name || "来自普通工具的材料",
              content: data.text,
            },
          }),
        );
      toast("已带入材料与提示词副本");
    }
  } catch (e) {
    connState("连接失败", "error");
    if (e.status === 401) await login();
    else error(e);
  }
}
function maskCode(code) {
  const value = String(code || "");
  if (!value) return "使用码";
  return `使用码 ····${value.slice(-4)}`;
}
window.addEventListener("popstate", () => {
  const id = location.pathname.match(/\/agent\/tasks\/([a-f0-9]+)/)?.[1];
  if (id && id !== state.task?.id) openTask(id, false).catch(error);
  else {
    const hash = location.hash.slice(1);
    setMode(hash === "trajectory" ? "trajectory" : "chat", false);
    if (TAB_IDS.has(hash)) setTab(hash, false);
    else setTab("prompt", false);
  }
});
$$(".view-tabs [data-mode]").forEach((button) => {
  button.onclick = () => setMode(button.dataset.mode);
});
$$("[data-tab]").forEach((button) => {
  button.onclick = () => setTab(button.dataset.tab);
});
$$(".mobile-switch [data-view]").forEach((button) => {
  button.onclick = () => setView(button.dataset.view);
});
$("#activity-dot").textContent = "";
initComposerSurfaces();
enhanceSelects();
updateStatus();
boot().catch(error);
