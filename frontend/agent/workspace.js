import {
  ACTIVE,
  STATUS,
  escapeHTML as esc,
  newKey,
  pageText,
} from "./core.mjs";
import { FullReader, saveBlob } from "./reader.mjs";
import { fillIcons, icon } from "./icons.mjs";
import { enhanceSelects, refreshSelects } from "./select.mjs";
import {
  applyTheme,
  initThemeMenu,
  readTheme,
  watchStorage,
} from "./theme.mjs";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];

/* 图标只在这里集中映射，业务代码不写 SVG。 */
const KIND_ICON = {
  reasoning: "sparkle",
  output: "file-text",
  input: "sliders",
  prompt: "list-checks",
  arguments: "route",
};
function labelOf(selector, text) {
  const host = $(selector);
  if (!host) return;
  const label = host.querySelector("[data-label]");
  if (label) label.textContent = text;
  else host.textContent = text;
}
function saveState(text, state) {
  const el = $("#save-state");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}
function connState(text, state, detail = "") {
  const el = $("#connection");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
  el.title = detail || text;
}
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
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
};
let reader = null,
  saveTimer,
  pollTimer,
  toastTimer,
  taskOffset = 0,
  taskQuery = "",
  modalCleanup = null;
const base = "/api/workspace";
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
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
    e.status = res.status;
    throw e;
  }
  return options.blob ? res.blob() : res.json();
}
function toast(message) {
  $("#toast").textContent = String(message);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
function error(e) {
  console.error(e);
  toast(e.message || String(e));
  if (e.status === 401) {
    labelOf("#account", "重新登录");
    $("#account").title = "重新登录";
  }
}
function action(id, fn) {
  $(id).addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      error(err);
    } finally {
      b.disabled = false;
      updateStatus();
    }
  });
}
function modal(title, body, buttons = []) {
  closeModal();
  $("#modal-title").textContent = title;
  $("#modal-body").replaceChildren();
  if (typeof body === "string") $("#modal-body").innerHTML = body;
  else $("#modal-body").append(body);
  $("#modal-actions").replaceChildren();
  for (const item of buttons) {
    const b = document.createElement("button");
    b.textContent = item.text;
    b.className = item.primary ? "btn-primary" : "btn-ghost";
    b.onclick = async () => {
      b.disabled = true;
      try {
        await item.run();
      } catch (e) {
        error(e);
      } finally {
        b.disabled = false;
      }
    };
    $("#modal-actions").append(b);
  }
  $("#modal").showModal();
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
function readText(title, text, download) {
  modal(title, '<div id="full-reader"></div>');
  reader = new FullReader($("#full-reader"), {
    text,
    download,
    onError: error,
  });
}
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
function drawer(open) {
  document.body.classList.toggle("nav-open", open);
  $("#shade").hidden = !open;
  $("#menu").setAttribute("aria-expanded", String(open));
  if (open) $("#close-nav").focus();
  else $("#menu").focus();
}
$("#menu").onclick = () =>
  drawer(!document.body.classList.contains("nav-open"));
$("#close-nav").onclick = () => drawer(false);
$("#shade").onclick = () => drawer(false);
document.addEventListener("click", (e) => {
  for (const d of $$("details.aw-theme, details.aw-taskmenu"))
    if (d.open && !d.contains(e.target)) d.open = false;
});
function setView(view, push = true) {
  document.body.dataset.view = view;
  for (const b of $$("[data-view] button[data-view]")) {
    b.toggleAttribute("aria-current", b.dataset.view === view);
  }
  if (view === "chat") $("#activity-dot").textContent = "";
  if (push && state.task)
    history.replaceState({ ...history.state, view }, "", location.href);
}
$$(".view-switch button").forEach(
  (b) => (b.onclick = () => setView(b.dataset.view)),
);
function setTab(tab, push = true) {
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  $$("[data-tab]").forEach((b) =>
    b.toggleAttribute("aria-current", b.dataset.tab === tab),
  );
  if (tab === "results") $("#result-dot").textContent = "";
  setView("work", false);
  if (push && state.task) {
    const u = new URL(location.href);
    u.hash = tab;
    history.pushState({ view: "work" }, "", u);
  }
}
$$("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$$("[data-focus]").forEach(
  (b) =>
    (b.onclick = () => {
      if (document.body.dataset.focus === b.dataset.focus)
        delete document.body.dataset.focus;
      else document.body.dataset.focus = b.dataset.focus;
    }),
);
function viewport() {
  document.documentElement.style.setProperty(
    "--vh",
    `${window.visualViewport?.height || innerHeight}px`,
  );
}
window.visualViewport?.addEventListener("resize", viewport);
viewport();
matchMedia("(max-width: 1099px)").addEventListener("change", (e) => {
  if (e.matches) delete document.body.dataset.focus;
});
function width(value) {
  const w = Math.round(Math.min(680, Math.max(380, value)));
  document.body.style.setProperty("--aw-inspector", w + "px");
  $("#separator").setAttribute("aria-valuenow", String(w));
  try {
    localStorage.setItem("nbx_agent_inspector", String(w));
  } catch {}
}
width(Number(localStorage.getItem("nbx_agent_inspector")) || 480);
$("#separator").onkeydown = (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    width(
      Number(e.currentTarget.getAttribute("aria-valuenow")) +
        (e.key === "ArrowRight" ? 24 : -24),
    );
  }
};
$("#separator").onpointerdown = (e) => {
  const b = e.currentTarget;
  b.setPointerCapture(e.pointerId);
  b.classList.add("dragging");
  b.onpointermove = (ev) => {
    const r = $(".columns").getBoundingClientRect();
    width(r.right - ev.clientX);
  };
  b.onpointerup = () => {
    b.onpointermove = null;
    b.classList.remove("dragging");
  };
};

function draftKey() {
  return state.task && state.catalog
    ? `nbx_agent_draft_${state.catalog.user.id}_${state.task.id}`
    : "";
}
function localDraft() {
  try {
    const k = draftKey();
    if (k)
      localStorage.setItem(
        k,
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
const fields = {
  goal: "goal",
  prompt: "prompt",
  behavior: "behavior",
  model: "model",
  review: "review",
  "review-prompt": "review_prompt",
  "auto-improve": "auto_improve",
  "review-rounds": "review_rounds",
};
for (const [id, key] of Object.entries(fields)) {
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
  });
}
$("#task-title").oninput = changed;
for (const [source, target] of [
  ["mobile-goal", "goal"],
  ["mobile-model", "model"],
]) {
  $("#" + source).oninput = (e) => {
    $("#" + target).value = e.target.value;
    $("#" + target).dispatchEvent(new Event("input"));
  };
  $("#" + target).addEventListener(
    "input",
    (e) => ($("#" + source).value = e.target.value),
  );
}
action("#mobile-run", () =>
  ACTIVE.has(state.task?.status) ? setView("chat") : start(),
);
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
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    localDraft();
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("online", () => {
  save().catch(error);
  poll();
});

async function listTasks(reset = true) {
  if (!state.catalog) return;
  const q = $("#task-search").value;
  if (reset) {
    taskOffset = 0;
    taskQuery = q;
  }
  const data = await api(
    `/tasks?q=${encodeURIComponent(q)}&offset=${taskOffset}`,
  );
  if (q !== $("#task-search").value) return;
  if (reset) $("#task-list").replaceChildren();
  for (const t of data.tasks) {
    const b = document.createElement("button");
    b.className = "aw-task" + (t.id === state.task?.id ? " on" : "");
    b.dataset.id = t.id;
    b.title = `${t.title} · ${STATUS[t.status] || t.status}`;
    const top = document.createElement("span");
    top.className = "aw-task-top";
    const name = document.createElement("span");
    name.className = "aw-task-name";
    name.textContent = t.title;
    const badge = document.createElement("span");
    badge.className = "aw-state";
    badge.dataset.state = t.status;
    badge.textContent = STATUS[t.status] || t.status;
    top.append(name, badge);
    const meta = document.createElement("span");
    meta.className = "aw-task-meta";
    meta.textContent = shortTime(t.updated_at) || "尚无记录";
    b.append(top, meta);
    b.onclick = () => openTask(t.id).catch(error);
    $("#task-list").append(b);
  }
  if (reset && !data.tasks.length) {
    const empty = document.createElement("p");
    empty.className = "aw-task-empty";
    empty.textContent = taskQuery ? "没有匹配的任务" : "还没有任务，先新建一个";
    $("#task-list").append(empty);
  }
  taskOffset += data.tasks.length;
  $("#more-tasks").hidden = !data.has_more;
}
let searchTimer;
$("#task-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => listTasks().catch(error), 250);
};
action("#more-tasks", () => listTasks(false));
async function createTask(config) {
  await requireSaved();
  const item = await api("/tasks", {
    method: "POST",
    body: {
      title: "新任务",
      config: config || {
        ...state.catalog.defaults,
        model: state.catalog.default_model || state.catalog.models[0]?.id || "",
      },
    },
  });
  await openTask(item.id);
  await listTasks();
}
action("#new-task", () => (state.catalog ? createTask() : login()));
async function openTask(id, push = true) {
  if (state.task?.id === id) {
    setTab(location.hash.slice(1) || "prompt", false);
    return;
  }
  await requireSaved();
  clearTimeout(pollTimer);
  const generation = ++state.generation;
  const task = await api(`/tasks/${id}`);
  if (generation !== state.generation) return;
  state.task = task;
  state.templateUndo = null;
  $("#undo-template").hidden = true;
  state.dirty = false;
  state.conflict = false;
  state.cursor = 0;
  state.entries.clear();
  state.runs = new Map(task.runs.map((r) => [r.id, r]));
  state.notes.clear();
  state.version = null;
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
  if (push)
    history.pushState({ view: "work" }, "", `/agent/tasks/${id}#prompt`);
  fill();
  setTab(location.hash.slice(1) || "prompt", false);
  drawer(false);
  document.body.classList.remove("nav-open");
  await listTasks();
  poll();
  if (state.dirty && !state.conflict)
    saveTimer = setTimeout(() => save().catch(error), 800);
}
function fill() {
  const t = state.task;
  $("#task-title").value = t.title;
  for (const [id, key] of Object.entries(fields)) {
    const el = $("#" + id);
    if (el.type === "checkbox") el.checked = t.config[key];
    else el.value = t.config[key] ?? "";
  }
  $("#mobile-goal").value = t.config.goal;
  $("#mobile-model").value = t.config.model;
  $("#template").value = t.config.template_id || "";
  renderMaterials();
  renderTools();
  renderTeaching();
  renderVersions();
  updateStatus();
  refreshSelects();
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
  const active = ACTIVE.has(state.task?.status);
  const disabled = !state.task || !state.catalog?.enabled;
  $("#run").hidden = active;
  $("#stop").hidden = !active;
  $("#run").disabled = disabled;
  labelOf("#run", state.task?.runs.length ? "再执行一轮" : "开始任务");
  const status = state.task?.status || "";
  const chip = $("#task-status");
  chip.textContent = STATUS[status] || "准备就绪";
  chip.dataset.state = status;
  $("#next-step").hidden = !active;
  labelOf("#send", active ? "发送补充" : "继续任务");
  labelOf(
    "#mobile-run",
    active
      ? "查看进度"
      : state.task?.runs.length
        ? "再执行一轮"
        : "开始任务",
  );
  $("#mobile-run").disabled = disabled;
}
$$("[data-policy]").forEach(
  (button) =>
    (button.onclick = async () => {
      try {
        const c = await api("/catalog");
        modal(
          "本轮预算与任务保存",
          `<p>${esc(c.billing)}</p><p>当前剩余额度：${c.user.is_unlimited ? "无限" : c.user.remaining} 次</p><p>单轮上限：${c.limits.steps} 步、${c.limits.tokens.toLocaleString()} tokens、${Math.round(c.limits.seconds / 60)} 分钟。到达上限会保存已有内容，可继续新一轮。</p><p>${esc(c.retention)}</p><p>免费模型仍遵守管理员设置的调用频率限制。</p>`,
        );
      } catch (e) {
        error(e);
      }
    }),
);
function upsert(list, item) {
  const index = list.findIndex((x) => x.id === item.id);
  if (index < 0) list.push(item);
  else list[index] = item;
}
function entryCard(item) {
  let card = $(`[data-entry="${item.id}"]`);
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
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `${icon(KIND_ICON[kind])}<span>${label}</span>`;
      b.dataset.kind = kind;
      b.onclick = () => openEntry(item.id, kind).catch(error);
      card.querySelector(".aw-step-actions").append(b);
    }
  }
  card.dataset.status = item.status;
  const title = card.querySelector(".entry-title");
  // 轮询每秒一次、压力场景有 200 张卡：标题没变就别重建图标和文本。
  if (title.dataset.label !== item.label) {
    title.dataset.label = item.label;
    title.innerHTML = `${icon(stepIcon(item))}<span></span>`;
    title.querySelector("span").textContent = item.label;
  }
  const stateEl = card.querySelector(".entry-state");
  setText(stateEl, STATUS[item.status] || item.status);
  if (stateEl.dataset.state !== item.status) stateEl.dataset.state = item.status;
  const chars = item.details.chars || {};
  const meta = Object.entries(chars)
    .filter(([k]) => k !== "prompt")
    .map(
      ([k, n]) =>
        `${{ reasoning: "思考", output: "输出", arguments: "调用", input: "参数" }[k] || k} ${n.toLocaleString()} 字符`,
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
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.source = item.id;
    b.innerHTML = `${icon("target")}<span>定位材料</span>`;
    b.onclick = () => sourceLinks(item.id).catch(error);
    actions.append(b);
  }
  if (item.kind === "review" && item.details.version_id && !actions.querySelector("[data-review]")) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.review = item.id;
    b.innerHTML = `${icon("list-checks")}<span>处理审阅意见</span>`;
    b.onclick = () => openReview(item.id).catch(error);
    actions.append(b);
  }
  card.querySelectorAll("[data-kind]").forEach((b) => {
    b.hidden = !chars[b.dataset.kind];
  });
}
function runCard(run) {
  let c = $(`[data-run="${run.id}"]`);
  if (!c) {
    c = document.createElement("article");
    c.className = "entry";
    c.dataset.run = run.id;
    c.innerHTML =
      '<div class="entry-header"><strong></strong><button class="aw-steplink" type="button"><span></span></button></div><small></small>';
    c.querySelector("button").onclick = async () => {
      try {
        const r = await api(path(`/runs/${run.id}`));
        readText("本轮配置快照", JSON.stringify(r.snapshot, null, 2));
      } catch (e) {
        error(e);
      }
    };
    $("#timeline").append(c);
  }
  c.dataset.status = run.status;
  const label = `${{ execute: "执行", continue: "继续", review: "审阅", revise: "修订", tool_test: "教学工具试运行" }[run.mode] || run.mode} · ${STATUS[run.status] || run.status}`;
  const strong = c.querySelector("strong");
  if (strong.dataset.label !== label) {
    strong.dataset.label = label;
    strong.innerHTML = `${icon("route")}<span></span>`;
    strong.querySelector("span").textContent = label;
  }
  setText(c.querySelector(".aw-steplink span"), "本轮配置");
  setText(
    c.querySelector("small"),
    run.error || `步骤 ${run.step} · ${run.tokens.toLocaleString()} tokens`,
  );
}
async function poll() {
  clearTimeout(pollTimer);
  if (!state.task) return;
  const gen = state.generation,
    id = state.task.id;
  try {
    const data = await api(`/tasks/${id}/events?after=${state.cursor}`);
    if (gen !== state.generation) return;
    const timeline = $("#timeline"),
      near =
        timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 90;
    let changed = false;
    for (const ev of data.events) {
      const v = ev.data;
      changed = true;
      if (ev.kind === "entry") {
        state.entries.set(v.id, v);
        entryCard(v);
      }
      if (ev.kind === "run") {
        state.runs.set(v.id, v);
        upsert(state.task.runs, v);
        runCard(v);
      }
      if (ev.kind === "material") {
        upsert(state.task.materials, v);
        renderMaterials();
      }
      if (ev.kind === "version") {
        upsert(state.task.versions, v);
        renderVersions();
        $("#result-dot").textContent = "•";
      }
      if (ev.kind === "adopt") {
        state.task.adopted_version = v.version_id;
        renderVersions();
      }
      if (ev.kind === "note") {
        let c = $(`[data-note="${v.id}"]`);
        if (!c) {
          c = document.createElement("article");
          c.className = "entry";
          c.dataset.note = v.id;
          c.innerHTML = `<div class="aw-note">${icon("chat")}<span></span></div>`;
          timeline.append(c);
        }
        c.dataset.status = v.applied ? "done" : "queued";
        c.querySelector(".aw-note span").textContent =
          `${v.applied ? "已生效" : "已接收，等待下一步"}：${v.text}`;
      }
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
        if (gen !== state.generation) return;
        state.task = latest;
        fill();
      }
    }
    updateStatus();
    syncTimelineEmpty();
    connState(
      "已连接",
      "live",
      ACTIVE.has(state.task.status) ? "已连接 · 任务在后台执行" : "已连接",
    );
    if (changed && near) timeline.scrollTop = timeline.scrollHeight;
    else if (changed) {
      $("#latest").hidden = false;
      $("#activity-dot").textContent = "•";
    }
    pollTimer = setTimeout(
      poll,
      data.has_more ? 30 : ACTIVE.has(state.task.status) ? 1000 : 5000,
    );
  } catch (e) {
    if (gen !== state.generation) return;
    connState(
      navigator.onLine ? "重连中" : "离线",
      "error",
      navigator.onLine ? "连接中断，正在重试" : "离线 · 任务仍在后台执行",
    );
    pollTimer = setTimeout(poll, 5000);
  }
}
$("#timeline").onscroll = () => {
  const e = $("#timeline");
  if (e.scrollHeight - e.scrollTop - e.clientHeight < 90)
    $("#latest").hidden = true;
};
$("#latest").onclick = () => {
  $("#timeline").scrollTop = $("#timeline").scrollHeight;
  $("#latest").hidden = true;
};
async function openEntry(id, kind) {
  const entry = state.entries.get(id),
    taskId = state.task.id;
  modal(
    `${entry.label} · ${{ reasoning: "思考全文", prompt: "实际指令", input: "输入参数", output: "输出全文", arguments: "工具调用" }[kind]}`,
    '<div id="full-reader"></div>',
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
      r.append(data.chunks.map((c) => c.text));
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

async function start(
  mode = "execute",
  instruction = "",
  baseVersion = "",
  teachingTool = "",
) {
  await requireSaved();
  const keyName = `nbx_agent_request_${state.task.id}`,
    signature = JSON.stringify({
      mode,
      instruction,
      baseVersion,
      teachingTool,
    });
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
  state.task.status = run.status;
  state.task.active_run = run.id;
  upsert(state.task.runs, run);
  state.runs.set(run.id, run);
  runCard(run);
  syncTimelineEmpty();
  updateStatus();
  setView("chat");
  poll();
  await listTasks();
}
action("#run", () => start());
action("#stop", async () => {
  await api(path("/stop"), { method: "POST" });
  state.task.status = "stopping";
  toast("已请求停止，正在保存已收到的内容");
  poll();
});
action("#send", async () => {
  const text = $("#message").value.trim();
  if (!text) throw Error("请先填写补充要求");
  if (ACTIVE.has(state.task?.status))
    await api(path("/notes"), { method: "POST", body: { text } });
  else await start("continue", text, state.task.adopted_version || "");
  $("#message").value = "";
  poll();
});
action("#apply-next", async () => {
  await requireSaved();
  await api(path("/notes"), { method: "POST", body: { apply_config: true } });
  toast("已接收，新配置将在下一步生效；本轮模型保持不变");
  poll();
});
action("#copy-task", async () => {
  await requireSaved();
  const t = await api(path("/copy"), { method: "POST" });
  await openTask(t.id);
});
action("#delete-task", () =>
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
  ),
);

function renderMaterials() {
  const root = $("#materials-list");
  root.replaceChildren();
  for (const m of state.task.materials) {
    const c = document.createElement("div");
    c.className = "material";
    c.innerHTML = `<label class="aw-check"><input type="checkbox" data-check><span>${esc(m.name)}<small>${m.chars.toLocaleString()} 字符 · 原文已保存</small></span></label><div class="aw-row"><button data-read type="button">${icon("book-open")}<span>阅读全文</span></button><button data-download type="button">${icon("download")}<span>下载原文件</span></button></div>`;
    const check = c.querySelector("[data-check]");
    check.checked = state.task.config.materials.includes(m.id);
    check.onchange = () => {
      const ids = new Set(state.task.config.materials);
      check.checked ? ids.add(m.id) : ids.delete(m.id);
      state.task.config.materials = [...ids];
      changed();
    };
    c.querySelector("[data-read]").onclick = async () => {
      try {
        const item = await api(path(`/materials/${m.id}`));
        readText(m.name, item.content);
      } catch (e) {
        error(e);
      }
    };
    c.querySelector("[data-download]").onclick = async () => {
      try {
        saveBlob(
          await api(path(`/materials/${m.id}?original=true`), { blob: true }),
          m.name,
        );
      } catch (e) {
        error(e);
      }
    };
    root.append(c);
  }
  if (!state.task.materials.length) {
    const hint = document.createElement("p");
    hint.className = "aw-empty-line";
    hint.textContent = "还没有材料。上传文件，或直接粘贴原文。";
    root.append(hint);
  }
}
async function receivedMaterial(m) {
  upsert(state.task.materials, m);
  if (!state.task.config.materials.includes(m.id))
    state.task.config.materials.push(m.id);
  renderMaterials();
  changed();
  await save();
}
action("#add-material", async () => {
  if (!$("#material-text").value.trim()) throw Error("请粘贴材料正文");
  const m = await api(path("/materials"), {
    method: "POST",
    body: {
      name: $("#material-name").value || "粘贴材料",
      content: $("#material-text").value,
    },
  });
  await receivedMaterial(m);
  $("#material-text").value = "";
  $("#material-name").value = "";
  toast("材料已保存并选中");
});
$("#upload").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.disabled = true;
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
  } catch (err) {
    error(err);
  } finally {
    e.target.disabled = false;
    e.target.value = "";
  }
};
function renderTools() {
  const root = $("#tools-list");
  root.replaceChildren();
  for (const t of state.catalog.tools) {
    const c = document.createElement("div");
    c.className = "tool-card";
    c.innerHTML = `<label class="aw-check"><input type="checkbox" data-check><span><span class="aw-tool-name">${esc(t.name)}</span>${t.available ? "" : '<span class="aw-tag">未接入</span>'}</span></label><p>${esc(t.description)}</p>`;
    const b = c.querySelector("[data-check]");
    b.disabled = !t.available;
    b.checked = state.task.config.tools.includes(t.id);
    b.onchange = () => {
      const s = new Set(state.task.config.tools);
      b.checked ? s.add(t.id) : s.delete(t.id);
      state.task.config.tools = [...s];
      changed();
    };
    root.append(c);
  }
}
function renderTeaching() {
  const root = $("#teaching-list");
  root.replaceChildren();
  for (const [id, prompt] of Object.entries(state.task.config.teaching_tools)) {
    const d = document.createElement("details");
    d.innerHTML = `<summary>${esc(state.catalog.official_templates.find((t) => t.id === id)?.name || id)}</summary><textarea class="editor" aria-label="教学工具提示词"></textarea><div class="aw-row"><button data-remove type="button">${icon("trash")}<span>移除此工具</span></button><button data-test type="button">${icon("play")}<span>单独试运行</span></button></div>`;
    d.querySelector("textarea").value = prompt;
    d.querySelector("textarea").oninput = (e) => {
      state.task.config.teaching_tools[id] = e.target.value;
      changed();
    };
    d.querySelector("[data-remove]").onclick = () => {
      delete state.task.config.teaching_tools[id];
      changed();
      renderTeaching();
    };
    const test = d.querySelector("[data-test]");
    test.title = "按本页计费规则开启一轮任务，结果保存为独立成果";
    test.onclick = () => start("tool_test", "", "", id).catch(error);
    root.append(d);
  }
}
action("#add-teaching", () => {
  const t = state.catalog.official_templates.find(
    (t) => t.id === $("#teaching-select").value,
  );
  if (t) {
    state.task.config.teaching_tools[t.id] = t.prompt;
    renderTeaching();
    changed();
  }
});
action("#test-tool", async () => {
  await requireSaved();
  const name = $("#test-name").value,
    q = $("#test-query").value;
  if (!q.trim()) throw Error("请输入测试内容");
  const args =
    name === "check_vocabulary"
      ? { text: q }
      : name === "search_material"
        ? { query: q, regex: $("#test-regex").checked }
        : { query: q };
  const r = await api(path("/tool-test"), {
    method: "POST",
    body: { name, arguments: args },
  });
  readText("工具试运行结果", JSON.stringify(r, null, 2));
});
function getTemplate() {
  return (
    state.catalog.official_templates.find(
      (t) => t.id === $("#template").value,
    ) || state.catalog.templates.find((t) => t.id === $("#template").value)
  );
}
function applyTemplate(t) {
  if (!t) return;
  state.templateUndo = structuredClone(state.task.config);
  if (t.kind === "tool") {
    state.task.config.tools = [...t.config.tools];
    state.task.config.teaching_tools = { ...t.config.teaching_tools };
  } else if (t.config) {
    const current = state.task.config;
    state.task.config = {
      ...t.config,
      materials: current.materials,
      goal: current.goal,
      model: current.model,
      template_id: t.id,
    };
  } else {
    state.task.config.prompt = t.prompt;
    state.task.config.template_id = t.id;
  }
  fill();
  $("#undo-template").hidden = false;
  changed();
}
action("#undo-template", () => {
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
});
$("#template").onchange = () => {
  const t = getTemplate();
  if (!t) {
    state.task.config.template_id = "";
    changed();
    return;
  }
  confirmAction(
    "应用模板",
    "将替换任务提示词或工具配置；当前材料与目标保留。",
    () => applyTemplate(t),
  );
};
action("#reset-prompt", () => {
  const t = getTemplate();
  if (!t) throw Error("请先选择模板");
  confirmAction("恢复模板", "恢复模板会替换当前编辑内容。", () =>
    applyTemplate(t),
  );
});
async function saveTemplate(kind) {
  askText(
    kind === "tool" ? "保存工具配置" : "另存为我的模板",
    "模板名称",
    state.task.title,
    async (name) => {
      await requireSaved();
      const r = await api("/templates", {
        method: "POST",
        body: { name: name.trim(), kind, config: state.task.config },
      });
      state.catalog.templates.push(r);
      renderTemplateOptions();
      toast("已保存到个人库");
    },
  );
}
action("#save-template", () => saveTemplate("prompt"));
action("#save-tool-template", () => saveTemplate("tool"));
function renderTemplateOptions() {
  const opts =
    '<option value="">自定义提示词</option>' +
    state.catalog.official_templates
      .map((t) => `<option value="${esc(t.id)}">官方 · ${esc(t.name)}</option>`)
      .join("") +
    state.catalog.templates
      .map((t) => `<option value="${esc(t.id)}">我的 · ${esc(t.name)}</option>`)
      .join("");
  $("#template").innerHTML = opts;
  $("#teaching-select").innerHTML = state.catalog.official_templates
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
    .join("");
  if (state.task) $("#template").value = state.task.config.template_id || "";
  refreshSelects();
}
action("#my-library", () => {
  if (!state.catalog) return login();
  modal("我的提示词与工具", '<div id="library"></div>');
  for (const t of state.catalog.templates) {
    const c = document.createElement("div");
    c.className = "tool-card";
    c.innerHTML = `<strong>${esc(t.name)}</strong><small>${t.kind === "tool" ? "工具配置" : "提示词模板"}</small><div class="aw-row"><button data-use type="button">用于当前任务</button><button data-new type="button">新建任务</button><button data-del type="button" class="danger">删除</button></div>`;
    c.querySelector("[data-use]").onclick = () => {
      applyTemplate(t);
      closeModal();
    };
    c.querySelector("[data-new]").onclick = async () => {
      try {
        await createTask({ ...t.config, materials: [], template_id: t.id });
        closeModal();
      } catch (e) {
        error(e);
      }
    };
    c.querySelector("[data-del]").onclick = () => {
      confirmAction(
        "删除个人模板",
        "只删除个人库中的模板；任务中已保存的副本和成果会保留。",
        async () => {
          await api(`/templates/${t.id}`, { method: "DELETE" });
          state.catalog.templates = state.catalog.templates.filter(
            (x) => x.id !== t.id,
          );
          renderTemplateOptions();
        },
      );
    };
    $("#library").append(c);
  }
  if (!state.catalog.templates.length)
    $("#library").textContent = "还没有个人模板。在提示词或工具页另存即可。";
});

let worker,
  workerSeq = 0;
const pendingWork = new Map();
function work(data) {
  if (!worker) {
    worker = new Worker("/static/agent/document-worker.js");
    worker.onmessage = ({ data }) => {
      const p = pendingWork.get(data.id);
      pendingWork.delete(data.id);
      if (p) data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
    worker.onerror = () => {
      for (const p of pendingWork.values())
        p.reject(Error("文档处理失败，请使用原文阅读"));
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
  const text = blocks
    .map(
      (b) =>
        `${{ same: "未修改", removed: "− 原版", added: "+ 修改版" }[b.kind]}\n${b.lines.join("\n")}`,
    )
    .join("\n\n");
  readText(title + " · 共同首尾与完整变更段", text);
}
action("#compare-prompt", () =>
  compare(
    "提示词比较",
    getTemplate()?.prompt ||
      getTemplate()?.config?.prompt ||
      state.catalog.defaults.prompt,
    $("#prompt").value,
  ),
);
action("#compare-conflict", async () => {
  const remote = await api(path());
  const local = structuredClone(state.task);
  modal(
    "保存冲突 · 本地草稿仍保留",
    "<p>先比较两份完整配置，再选择处理方式。</p>",
    [
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
          const cfg = {
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
              config: cfg,
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
    ],
  );
});
function renderVersions() {
  const versions = state.task.versions;
  $("#version-count").textContent = versions.length || "";
  $("#result-empty").hidden = versions.length > 0;
  $("#versions-list").replaceChildren();
  for (const v of versions) {
    const adopted = v.id === state.task.adopted_version;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "aw-version" + (adopted ? " on" : "");
    b.innerHTML = `${icon(adopted ? "check" : "file-text")}<span></span>`;
    b.querySelector("span").textContent =
      `${adopted ? "已采用 · " : ""}${v.title} · ${v.complete ? "完整" : "待补全"} · ${v.chars.toLocaleString()} 字符`;
    b.dataset.version = v.id;
    b.onclick = () => selectVersion(v.id).catch(error);
    $("#versions-list").append(b);
  }
  $("#version-select").innerHTML = versions
    .map(
      (v, i) =>
        `<option value="${v.id}">版本 ${i + 1} · ${esc(v.title)}${v.id === state.task.adopted_version ? " · 已采用" : ""}</option>`,
    )
    .join("");
  if (state.version) $("#version-select").value = state.version.id;
  $("#result-actions").hidden = !state.version;
  refreshSelects();
}
$("#version-select").onchange = (e) =>
  selectVersion(e.target.value).catch(error);
async function selectVersion(id) {
  const gen = state.generation;
  state.selectedVersion = id;
  const v = await api(path(`/versions/${id}`));
  if (gen !== state.generation || state.selectedVersion !== id) return;
  state.version = v;
  state.page = 0;
  state.pages = pageText(v.content);
  $("#result-actions").hidden = false;
  $("#version-select").value = id;
  renderDocument();
  const pages = await work({ type: "pages", text: v.content });
  if (state.version?.id !== id) return;
  state.pages = pages;
  renderDocument();
}
function renderDocument() {
  if (!state.version) return;
  const p = state.pages[state.page];
  const raw = $("#result-plain").checked || p.plain;
  const root = $("#result-body");
  root.className = "document" + (raw ? " plain" : "");
  if (raw) root.textContent = p.text;
  else
    root.innerHTML = DOMPurify.sanitize(marked.parse(p.text), {
      FORBID_TAGS: ["img", "iframe", "style"],
      FORBID_ATTR: ["style"],
    });
  root.querySelectorAll("a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  root.querySelectorAll("table").forEach((table) => {
    const headers = [...table.querySelectorAll("thead th")].map(
      (h) => h.textContent,
    );
    if (table.querySelector("[colspan],[rowspan]")) return;
    table
      .querySelectorAll("tbody tr")
      .forEach((tr) =>
        [...tr.children].forEach(
          (td, i) => (td.dataset.label = headers[i] || `第 ${i + 1} 列`),
        ),
      );
    if ($("#table-cards").checked) table.classList.add("cards");
  });
  $("#result-page").textContent =
    `${state.page + 1} / ${state.pages.length} 段${p.plain ? " · 长段落原文" : ""}`;
  $("#result-prev").disabled = state.page === 0;
  $("#result-next").disabled = state.page === state.pages.length - 1;
  $("#adopt").disabled =
    !state.version.complete || state.task.adopted_version === state.version.id;
}
$("#result-prev").onclick = () => {
  state.page--;
  renderDocument();
};
$("#result-next").onclick = () => {
  state.page++;
  renderDocument();
};
$("#result-plain").onchange = renderDocument;
$("#table-cards").onchange = renderDocument;
action("#adopt", async () => {
  await api(path(`/versions/${state.version.id}/adopt`), {
    method: "POST",
    body: { expected: state.task.adopted_version },
  });
  state.task.adopted_version = state.version.id;
  renderVersions();
  renderDocument();
  toast("已采用，之前版本仍保留");
});
action("#compare-version", async () => {
  if (!state.version.parent_id) throw Error("此版本没有基准版本");
  const parent = await api(path(`/versions/${state.version.parent_id}`));
  await compare("成果版本比较", parent.content, state.version.content);
});
action("#edit-version", () => {
  const baseVersion = state.version;
  askText(
    "编辑成果 · 保存为新版本",
    "完整正文",
    baseVersion.content,
    async (content) => {
      const r = await api(path("/versions"), {
        method: "POST",
        body: {
          request_key: newKey(),
          title: baseVersion.title,
          content,
          parent_id: baseVersion.id,
        },
      });
      upsert(state.task.versions, r);
      renderVersions();
      await selectVersion(r.id);
    },
  );
});
action("#review-version", () => start("review", "", state.version.id));
action("#revise-version", () =>
  askText("修订此版本", "具体修改要求", "", async (instruction) => {
    await start("revise", instruction, state.version.id);
  }),
);
action("#copy-result", async () => {
  if (navigator.clipboard && window.isSecureContext)
    await navigator.clipboard.writeText(state.version.content);
  else {
    const ta = document.createElement("textarea");
    ta.value = state.version.content;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw Error("浏览器禁止复制，请下载 Markdown");
  }
  toast("已复制完整成果");
});
action("#export-md", () =>
  saveBlob(
    state.version.content,
    state.version.title + ".md",
    "text/markdown;charset=utf-8",
  ),
);
action("#export-docx", async () => {
  const version = state.version;
  const pages = await work({ type: "pages", text: version.content });
  const fragments = [];
  for (const page of pages) {
    fragments.push(
      DOMPurify.sanitize(
        page.plain ? `<pre>${esc(page.text)}</pre>` : marked.parse(page.text),
        {
          FORBID_TAGS: ["img", "iframe", "style"],
          FORBID_ATTR: ["style"],
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const html = fragments.join("");
  saveBlob(
    await work({
      type: "docx",
      html: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
    }),
    version.title + ".docx",
  );
});

async function login() {
  modal(
    "登录工作台",
    '<p>使用与普通工具相同的使用码，恢复自己的任务和成果。</p><label for="login-code">使用码</label><input id="login-code" type="password" autocomplete="off"><p id="login-error" role="alert"></p>',
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
}
action("#account", () => {
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
});
let bgfx = null;
function initBackground() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (matchMedia("(max-width: 767px)").matches) return;
  const load = () => {
    const script = document.createElement("script");
    script.src = "/static/nbx-background.js";
    script.async = true;
    script.onload = () => {
      if (typeof createBackground !== "function") return;
      const canvas = $("#bgfx");
      if (!canvas) return;
      bgfx = createBackground(canvas);
      canvas.classList.add("bgfx-ready");
    };
    document.head.append(script);
  };
  if ("requestIdleCallback" in window)
    requestIdleCallback(load, { timeout: 2600 });
  else setTimeout(load, 1200);
}
async function boot() {
  fillIcons();
  enhanceSelects();
  applyTheme(readTheme(), { persist: false });
  initThemeMenu(() => bgfx?.themeChanged());
  watchStorage(() => bgfx?.themeChanged());
  initBackground();
  if (!token()) {
    await login();
    connState("尚未登录", "idle");
    return;
  }
  try {
    state.catalog = await api("/catalog");
    labelOf("#account", "切换使用码");
    $("#account").title = "切换使用码";
    $("#account").setAttribute("aria-label", "切换使用码");
    $("#model").innerHTML = state.catalog.models
      .map(
        (m) =>
          `<option value="${esc(m.id)}">${esc(m.name || m.id)}${m.is_free ? " · 免费" : ""}</option>`,
      )
      .join("");
    $("#mobile-model").innerHTML = $("#model").innerHTML;
    refreshSelects();
    $("#run-policy").textContent = state.catalog.billing;
    renderTemplateOptions();
    await listTasks();
    const id = location.pathname.match(/\/agent\/tasks\/([a-f0-9]+)/)?.[1];
    if (id) await openTask(id, false);
    else await createTask();
    const handoff = sessionStorage.getItem("nbx_agent_handoff");
    if (handoff) {
      sessionStorage.removeItem("nbx_agent_handoff");
      const data = JSON.parse(handoff);
      const t = state.catalog.official_templates.find(
        (t) => t.id === String(data.toolId),
      );
      if (t) applyTemplate(t);
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
window.addEventListener("popstate", () => {
  const id = location.pathname.match(/\/agent\/tasks\/([a-f0-9]+)/)?.[1];
  if (id && id !== state.task?.id) openTask(id, false).catch(error);
  else {
    setTab(location.hash.slice(1) || "prompt", false);
    setView(history.state?.view || "work", false);
  }
});
updateStatus();
boot();

async function openReview(id) {
  const entry = state.entries.get(id);
  const blob = await api(
    path(`/entries/${id}/content?kind=review&download=true`),
    {
      blob: true,
    },
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
    `<p>${esc(data.summary)}</p><div id="review-issues"></div>`,
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
          const issues = selected().map((i) => data.issues[i]);
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
          const issues = selected().map((i) => data.issues[i]);
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
      (e) => Number(e.value),
    );
  }
  data.issues.forEach((issue, i) => {
    const el = document.createElement("div");
    el.className = "tool-card aw-issue";
    el.innerHTML = `<label class="aw-check"><input type="checkbox" value="${i}"><span>${esc(issue.problem)}<small>${issue.certainty === "confirmed" ? "审阅判断：有依据" : "待核实"}${entry.details.ignored?.includes(i) ? " · 已忽略" : ""}</small></span></label><p><b>原文</b>${esc(issue.quote || "未定位")}</p><p><b>依据</b>${esc(issue.evidence)}</p><p><b>建议</b>${esc(issue.fix)}</p>`;
    $("#review-issues").append(el);
  });
}
action("#legacy-tasks", async () => {
  const d = await api("/legacy");
  modal(
    "旧版任务 · 只读归档",
    '<p>旧执行不会在新版继续。材料、成果和已保存过程可以查看与下载。</p><div id="legacy-list"></div>',
  );
  if (!d.tasks.length)
    $("#legacy-list").textContent = "当前使用码没有旧版任务。";
  let offset = 0;
  function append(data) {
    for (const t of data.tasks) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "aw-version";
      b.textContent = `${t.tool_name || "旧任务"} · ${t.created_at} · ${t.status}`;
      b.onclick = async () => {
        try {
          const item = await api(`/legacy/${t.id}`);
          readText("旧版任务完整归档", JSON.stringify(item, null, 2));
        } catch (e) {
          error(e);
        }
      };
      $("#legacy-list").append(b);
    }
    offset += data.tasks.length;
    if (data.has_more) {
      const more = document.createElement("button");
      more.textContent = "加载更多";
      more.onclick = async () => {
        const next = await api("/legacy?offset=" + offset);
        more.remove();
        append(next);
      };
      $("#legacy-list").append(more);
    }
  }
  append(d);
});

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
    const b = document.createElement("button");
    b.type = "button";
    b.className = "aw-version";
    b.textContent = `${match.name || match.material_id} · 字符 ${match.start || 0}`;
    b.onclick = async () => {
      try {
        const data = await api(path(`/materials/${match.material_id}`));
        readText(data.name, data.content);
        reader.go(Math.floor((match.start || 0) / reader.size));
      } catch (e) {
        error(e);
      }
    };
    $("#source-list").append(b);
  }
  if (!matches.length) $("#source-list").textContent = "没有匹配来源。";
}
