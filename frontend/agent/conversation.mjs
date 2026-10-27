/* Claude 风格对话渲染。
   移植自 dsh-claude-style@1e7acc5b 的 chat-fold / chat-follow / chat-wait /
   chat-files / chat-reveal 的可见行为，按 NeoBangX 的轮询与按游标读取正文接口重写。
   这里不伪造任何内容：正文、思考、工具输入输出都来自后端已保存的块。 */

import { ACTIVE, escapeHTML as esc, setParts } from "./core.mjs";
import { pickGreeting } from "./greetings.mjs";
import { icon } from "./icons.mjs";
import { markCurrent, playEnter } from "./motion.mjs";
import { copyText } from "./reader.mjs";
import { startWaitLoader, releaseWaitLoader } from "./wait-loader.mjs";

/** 本次页面访问的空态问候：载入时抽一次，之后切任务、重绘都沿用这一句。 */
const PAGE_GREETING = pickGreeting();

const TOOL_NAMES = {
  create_document: "生成成果",
  revise_document: "修订成果",
  patch_document: "修改成果",
  read_material: "读取材料",
  search_material: "检索材料",
  web_search: "网页搜索",
  check_vocabulary: "词表检查",
  ask_user: "等待补充",
};
const TOOL_ICONS = {
  create_document: "file-text",
  revise_document: "edit",
  patch_document: "edit",
  read_material: "book-open",
  search_material: "search",
  web_search: "search",
  check_vocabulary: "list-checks",
  ask_user: "message-square",
};

const MODE_NAMES = {
  execute: "执行",
  continue: "继续",
  review: "审阅",
  revise: "修订",
  tool_test: "教学工具试运行",
};
const STATUS_NAMES = {
  queued: "排队中",
  running: "进行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  incomplete: "未完成",
  stopped: "已停止",
  waiting: "等待补充",
  done: "完成",
  interrupted: "已中断",
  draft: "草稿",
};
const nf = new Intl.NumberFormat("zh-CN");
const boxAttr = (el, name, on) => {
  if (!el) return;
  if (on) el.setAttribute(name, "true");
  else el.removeAttribute(name);
};
const chars = (n) => `${nf.format(Math.max(0, Number(n) || 0))} 字`;

/* 切换任务后轮询从游标 0 回放整份事件日志，每条事件都是写入当时的快照。
   步骤只会从 running 走到终态、轮次只会从 ACTIVE 走到终态，都不会倒回去；
   所以本地已是终态、事件却说还在进行，就是回放出来的旧快照。照单全收的话，
   每条思考都会按历史重新展开、流式、再收起，还会被慢一拍的流式回调卡在展开状态。 */
const isStale = (previous, next, active) =>
  Boolean(previous?.status) && !active(previous.status) && active(next?.status);
const entryActive = (status) => status === "running";
const runActive = (status) => ACTIVE.has(status);

/** 写作者的生成/修订调用。正文直接进成果，对话里不铺开整篇稿子或修改块，过程留在执行轨迹。
 * 旧记录没有 role；调度 Agent 的调用标签一直是「执行步骤 N」，其余模型调用都来自写作者。 */
function isWriter(entry) {
  if (entry?.kind !== "model") return false;
  const role = entry.details?.role;
  if (role) return role === "writer";
  return !/^执行步骤 \d+$/.test(String(entry.label || ""));
}

function timeOf(iso) {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
function durationOf(start, end) {
  const from = Date.parse(start || "");
  const to = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "";
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

/* ---------- Markdown 的块级增量渲染 ---------- */
/* 上游 chat-reveal 逐帧揭示；长文上逐字重排会让页面抖动，所以这里按 Markdown
   顶层块增量追加，只重画末尾仍在变化的块。内容不抽样、不省略。 */
class MarkdownView {
  constructor(el) {
    this.el = el;
    this.text = "";
    this.tokens = [];
    this.nodeCounts = [];
    this.rendering = false;
    this.pending = false;
    this.destroyed = false;
    this.el.classList.add("md");
  }

  setText(text) {
    if (this.destroyed || text === this.text) return;
    this.text = text;
    if (!window.marked || !window.DOMPurify) {
      this.el.textContent = text;
      return;
    }
    if (this.rendering) {
      this.pending = true;
      return;
    }
    this.render();
  }

  render() {
    this.rendering = true;
    try {
      if (this.text.length <= 24000) {
        this.renderFull();
      } else {
        this.renderIncremental();
      }
    } finally {
      this.rendering = false;
      if (this.pending) {
        this.pending = false;
        requestAnimationFrame(() => {
          if (!this.destroyed) this.render();
        });
      }
    }
  }

  renderFull() {
    const html = window.marked.parse(this.text);
    this.el.innerHTML = sanitize(html);
    decorate(this.el);
    this.tokens = [];
    this.nodeCounts = [];
  }

  renderIncremental() {
    const tokens = window.marked.lexer(this.text);
    // 末尾两个块可能还在增长；重画它们，其余保留。结构变短则整体重来。
    const keep = Math.max(0, this.tokens.length - 2);
    if (!this.tokens.length || tokens.length < this.tokens.length - 1) {
      this.el.replaceChildren();
      this.tokens = [];
      this.nodeCounts = [];
      this.appendTokens(tokens, 0, 240);
      return;
    }
    // 从 keep 之后移除已挂载的节点。
    for (let i = this.tokens.length - 1; i >= keep; i--) {
      const count = this.nodeCounts[i] || 0;
      for (let n = 0; n < count; n++) this.el.lastElementChild?.remove();
    }
    this.tokens.length = keep;
    this.nodeCounts.length = keep;
    this.appendTokens(tokens, keep, 400);
  }

  appendTokens(tokens, from, budget) {
    let count = 0;
    while (this.tokens.length < tokens.length && count < budget) {
      const token = tokens[this.tokens.length];
      const html = sanitize(window.marked.parser([token]));
      const frag = document.createRange().createContextualFragment(html);
      decorate(frag);
      const added = frag.childElementCount;
      this.el.append(frag);
      this.tokens.push(token);
      this.nodeCounts.push(added);
      count++;
    }
    if (this.tokens.length < tokens.length) {
      this.pending = true;
    }
  }

  getEntry(id) {
    return this.entries.get(id) || null;
  }

  destroy() {
    this.destroyed = true;
  }
}

function sanitize(html) {
  return window.DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "iframe", "style", "link", "meta"],
    FORBID_ATTR: ["style"],
  });
}

function decorate(root) {
  for (const pre of [...root.querySelectorAll("pre")]) {
    if (pre.closest(".md-code")) continue;
    const code = pre.querySelector("code");
    const className = code?.className || "";
    const language =
      /language-([\w+#.-]+)/.exec(className)?.[1] ||
      (code?.dataset?.lang ?? "") ||
      "";
    const wrap = document.createElement("div");
    wrap.className = "md-code";
    const head = document.createElement("div");
    head.className = "md-code-head";
    head.innerHTML = `<span class="lang">${esc(language || "代码")}</span><span class="spacer"></span><button type="button" class="copy" aria-label="复制代码" title="复制代码">${icon("copy")}</button>`;
    head.querySelector(".copy").addEventListener("click", () => {
      copyText(code?.textContent || "").catch(() => {});
    });
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  }
  for (const table of [...root.querySelectorAll("table")]) {
    if (table.parentElement?.classList.contains("md-table-scroll")) continue;
    const wrap = document.createElement("div");
    wrap.className = "md-table-scroll";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const link of root.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

/* ---------- 对话 ---------- */
let conversationSeq = 0;

export class Conversation {
  constructor({
    api,
    taskId,
    getTask,
    onOpenResult = () => {},
    onOpenEntry = () => {},
    onReview = () => {},
    onError = (e) => console.error(e),
    onModeChange = () => {},
    onRequestStop = () => {},
  }) {
    this.seq = ++conversationSeq;
    this.api = api;
    this.taskId = taskId;
    this.getTask = getTask;
    this.onOpenResult = onOpenResult;
    this.onOpenEntry = onOpenEntry;
    this.onReview = onReview;
    this.onError = onError;
    this.onModeChange = onModeChange;
    this.onRequestStop = onRequestStop;

    this.root = document.getElementById("transcript-inner");
    this.transcript = document.getElementById("transcript");
    this.empty = document.getElementById("empty");
    this.greeting = document.getElementById("empty-greeting-text");
    this.app = document.getElementById("app");
    this.latest = document.getElementById("latest");
    this.trajectory = document.getElementById("trajectory");
    this.timeline = document.getElementById("timeline");
    this.composerSeat = document.getElementById("composer-seat");
    this.composerCard = document.getElementById("composer-card");
    this.message = document.getElementById("message");

    this.runs = new Map();
    this.entries = new Map();
    this.notes = [];
    this.versions = [];
    this.turns = new Map();
    this.streams = new Map();
    this.caches = new Map();
    this.previews = new Map();
    this.previewLoading = new Set();
    this.briefObserver = null;
    this.briefWaits = new Map();
    this.loading = new Set();
    this.observers = new Map();
    this.held = false;
    // 跟随页面当前视图起步：切任务时若停在轨迹页，载入期间就不会先把对话空态画出来。
    this.mode = this.app?.dataset.mode === "trajectory" ? "trajectory" : "chat";
    this.scrollMemo = { chat: 0, trajectory: 0 };
    this.waitingTimer = null;
    this.lastHeight = 0;
    this.destroyed = false;
    this.clock = null;
    this.pendingVersions = new Map();
    this.tokenFloor = new Map();

    this.latest.onclick = () => this.scrollToLatest();
    this.transcript.addEventListener("scroll", () => this.onScroll(), {
      passive: true,
    });
    this.trajectory?.addEventListener("scroll", () => {
      this.scrollMemo.trajectory = this.trajectory.scrollTop;
    });

    if ("ResizeObserver" in window) {
      this.resize = new ResizeObserver(() => {
        if (!this.held) this.pin();
      });
      this.resize.observe(this.root);
    }
    this.onTheme = () => this.refreshTheme();
    document.addEventListener("agent:theme", this.onTheme);
  }

  /* 初次打开或切换任务：恢复全部步骤元数据、补充要求与成果。 */
  async load(task) {
    this.reset(task);
    let entries = [];
    try {
      entries = (await this.api(`/tasks/${this.taskId}/entries`)).entries || [];
    } catch (error) {
      this.onError(error);
    }
    if (this.destroyed) return;
    for (const entry of entries) this.entries.set(entry.id, entry);
    this.rebuild(task);
  }

  setTask(task) {
    this.task = task;
  }

  reset(task) {
    this.task = task;
    this.runs.clear();
    this.entries.clear();
    this.notes = [];
    this.versions = [];
    this.turns.clear();
    this.streams.forEach((timer) => clearInterval(timer));
    this.streams.clear();
    this.caches.clear();
    this.previews.clear();
    this.previewLoading.clear();
    this.briefObserver?.disconnect();
    this.briefObserver = null;
    this.briefWaits.clear();
    this.loading.clear();
    this.entryViews = new Map();
    this.tokenFloor.clear();
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    this.root.replaceChildren();
    this.held = false;
    this.lastHeight = 0;
    for (const run of task?.runs || []) this.runs.set(run.id, run);
    this.notes = [...(task?.notes || [])];
    this.versions = [...(task?.versions || [])];
    this.task = task;
  }

  rebuild(task) {
    this.task = task;
    this.root.replaceChildren();
    this.turns.clear();
    const runs = [...this.runs.values()].sort(byCreated);
    for (const run of runs) this.ensureTurn(run);
    // 先建轮次，再按创建顺序挂上每一步；没有对应轮次的孤立步骤也保留。
    for (const entry of [...this.entries.values()].sort(byCreated)) {
      if (!this.runs.has(entry.run_id)) this.runs.set(entry.run_id, fallbackRun(entry));
      this.upsertEntry(entry, { render: true });
    }
    for (const turn of this.turns.values()) this.finishTurn(turn);
    this.refreshEmpty();
    this.updateWaiting();
    if (!this.held) this.pin();
    else this.latest.hidden = false;
    this.refreshTheme();
  }

  /* 事件：run / entry / note / version / adopt */
  applyEvent(event) {
    const value = event.data;
    if (!value || this.destroyed) return false;
    if (event.kind === "run") {
      const previous = this.runs.get(value.id);
      if (isStale(previous, value, runActive)) return false;
      this.runs.set(value.id, { ...previous, ...value });
      const turn = this.ensureTurn(this.runs.get(value.id));
      if (turn) turn.run = this.runs.get(value.id);
      this.updateTurnMeta(turn);
      if (turn) this.finishTurn(turn);
      this.refreshEmpty();
      this.updateWaiting();
      return true;
    }
    if (event.kind === "entry") {
      const previous = this.entries.get(value.id);
      if (isStale(previous, value, entryActive)) return false;
      this.upsertEntry(value, { render: true });
      if (value.status === "running") this.startStream(value);
      else if (previous?.status === "running") this.stopStream(value.id);
      this.updateWaiting();
      return true;
    }
    if (event.kind === "note") {
      if (this.notes.some((note) => note.id === value.id)) return false;
      this.notes.push(value);
      const run = this.runs.get(value.run_id);
      if (run) this.renderNote(this.ensureTurn(run), value);
      this.updateWaiting();
      return true;
    }
    if (event.kind === "version") {
      this.addVersion(value);
      return true;
    }
    if (event.kind === "adopt") {
      this.task.adopted_version = value.version_id;
      this.updateVersions();
      return true;
    }
    return false;
  }

  activeRunId() {
    return this.task?.active_run || "";
  }

  /* ---------- 轮次 ---------- */
  ensureTurn(run) {
    if (!run) return null;
    let turn = this.turns.get(run.id);
    if (turn) return turn;
    const el = document.createElement("section");
    el.className = "turn";
    el.dataset.run = run.id;
    el.dataset.status = run.status || "completed";
    const meta = document.createElement("div");
    meta.className = "turn-meta";
    meta.innerHTML = `<button class="meta-button" type="button"><span class="meta-time"></span>${icon("chevron-right")}</button><span class="rule"></span>`;
    meta.querySelector(".meta-button").addEventListener("click", () =>
      this.onModeChange("trajectory"),
    );
    const body = document.createElement("div");
    body.className = "turn-body";
    const flow = document.createElement("div");
    flow.className = "turn-flow";
    const results = document.createElement("div");
    results.className = "turn-results";
    const actions = document.createElement("div");
    actions.className = "turn-actions";
    body.append(flow, results, actions);
    el.append(meta, body);
    this.root.append(el);
    turn = { run, el, meta, body, flow, results, actions, entries: [], notes: [], waiting: null };
    this.turns.set(run.id, turn);
    this.renderUser(turn);
    // 该轮已有的步骤（初次恢复时）
    for (const entry of [...this.entries.values()]
      .filter((item) => item.run_id === run.id)
      .sort(byCreated)) {
      this.upsertEntry(entry, { render: true });
    }
    this.renderNotes(turn);
    this.renderResults(turn);
    this.updateTurnMeta(turn);
    this.finishTurn(turn);
    return turn;
  }

  upsertEntry(entry, { render = true } = {}) {
    const previous = this.entries.get(entry.id);
    this.entries.set(entry.id, { ...previous, ...entry });
    const merged = this.entries.get(entry.id);
    const run = this.runs.get(merged.run_id) || fallbackRun(merged);
    const turn = this.ensureTurn(run);
    if (!turn) return;
    let state = this.entryViews?.get(merged.id);
    if (!state) {
      if (!render) return;
      state = this.renderEntry(turn, merged);
      if (!state) return;
      this.entryViews ??= new Map();
      this.entryViews.set(merged.id, state);
      turn.entries.push(merged.id);
      turn.flow.append(state.el);
    }
    this.updateEntry(turn, state, merged);
  }

  renderEntry(turn, entry) {
    if (isWriter(entry)) {
      // 只占一个隐藏位置：出错时显示错误，等待行据此显示撰写进度；正文从成果卡片查看。
      const el = document.createElement("div");
      el.className = "assistant writer-step";
      el.dataset.entry = entry.id;
      el.hidden = true;
      return { kind: "writer", el };
    }
    if (entry.kind === "model") {
      const el = document.createElement("div");
      el.className = "assistant";
      el.dataset.entry = entry.id;
      const reasoning = document.createElement("div");
      el.append(reasoning);
      const output = document.createElement("div");
      output.className = "assistant-block";
      el.append(output);
      const state = {
        kind: "model",
        el,
        reasoning: null,
        reasoningView: null,
        markdown: null,
        output: null,
        outputText: "",
        reasoningText: "",
        details: entry.details || {},
      };
      return state;
    }
    if (entry.kind === "tool") return this.renderTool(entry);
    if (entry.kind === "review") return this.renderReview(entry);
    return null;
  }

  updateEntry(turn, state, entry) {
    const details = entry.details || {};
    const previousStatus = state.entry?.status;
    state.entry = entry;
    if (state.kind === "model") {
      const counts = details.chars || {};
      if ((counts.reasoning || 0) > 0) {
        this.ensureReasoning(state, entry);
        const running = entry.status === "running";
        if (running) {
          if (
            state.reasoningTouched !== "running" &&
            state.reasoning?.dataset.open !== "true"
          )
            this.setReasoningOpen(state, entry, true);
        } else {
          if (
            previousStatus === "running" &&
            state.reasoningTouched !== entry.status &&
            state.reasoning?.dataset.open === "true"
          )
            this.setReasoningOpen(state, entry, false);
          this.ensurePreview(entry);
        }
      }
      if ((counts.output || 0) > 0) {
        this.ensureOutput(state, entry);
      }
      if (state.output) {
        state.output.dataset.streaming = String(entry.status === "running");
      }
      if (entry.status !== "running") state.el.dataset.done = "true";
      if (entry.status !== "running") this.finishTurn(turn);
    } else if (state.kind === "tool") {
      this.updateTool(state, entry);
    } else if (state.kind === "review") {
      this.updateReview(state, entry);
    } else if (state.kind === "writer") {
      if (entry.status !== "running") this.finishTurn(turn);
    }
    if (details.error && state.kind !== "tool") {
      this.renderError(state, details.error, entry);
    }
    this.updateTurnMeta(turn);
    if (!this.held) this.pin();
    else if (entry.status === "running") this.latest.hidden = false;
  }

  ensureReasoning(state, entry) {
    if (!state.reasoning) {
      const box = document.createElement("div");
      box.className = "reasoning";
      box.dataset.entry = entry.id;
      box.innerHTML = `
        <button class="reasoning-head" type="button" aria-expanded="false">
          <span class="reasoning-glyph"><span class="reasoning-spark">${icon("sparkle")}</span><span class="reasoning-chev">${icon("chevron-right")}</span></span>
          <span class="reasoning-title">思考</span>
          <span class="reasoning-preview" hidden></span>
        </button>
        <div class="reasoning-body" hidden>
          <div class="reasoning-text"></div>
        </div>`;
      state.reasoning = box;
      state.reasoningBody = box.querySelector(".reasoning-body");
      state.reasoningText = box.querySelector(".reasoning-text");
      state.reasoningPreview = box.querySelector(".reasoning-preview");
      state.reasoningHead = box.querySelector(".reasoning-head");
      state.reasoningPreviewText = "";
      state.reasoningTouched = "";
      state.el.prepend(box);
      state.reasoningHead.addEventListener("click", () => {
        const current = this.entries.get(entry.id) || entry;
        const open = box.dataset.open !== "true";
        state.reasoningTouched = current.status || "";
        this.setReasoningOpen(state, current, open);
      });
    }
    if (entry.status === "running") boxAttr(state.reasoning, "data-running", true);
    else boxAttr(state.reasoning, "data-running", false);
    if (entry.status !== "running") this.updateReasoningPreview(state);
  }

  /** 展开/收起一条思考；展开时按运行中或已完成决定读窗口还是读全文。 */
  setReasoningOpen(state, entry, open) {
    const box = state.reasoning;
    if (!box) return;
    box.dataset.open = String(open);
    state.reasoningHead?.setAttribute("aria-expanded", String(open));
    if (state.reasoningBody) state.reasoningBody.hidden = !open;
    this.updateReasoningPreview(state);
    if (!open) return;
    if (entry.status !== "running" && state.reasoningBody) {
      state.reasoningBody.scrollTop = 0;
    }
    const cached = this.caches.get(`${entry.id}:reasoning`);
    if (cached?.text) this.paintReasoning(state, entry, cached.text);
    this.ensureContent(entry, "reasoning")
      .then((text) => this.paintReasoning(state, entry, text))
      .catch((error) => this.onError(error));
  }

  /** 运行中只把末尾几行放进窗口；完成后展开的是全文。 */
  paintReasoning(state, entry, text) {
    if (!state.reasoningText) return;
    // 正文是异步读回来的，调用方手里的 entry 可能已经过期；按当前状态决定窗口还是全文。
    const running = (this.entries.get(entry.id) || entry).status === "running";
    let shown = text || "";
    if (running && shown.length > 1800) {
      shown = shown.slice(-1800);
      const line = shown.indexOf("\n");
      if (line >= 0) shown = shown.slice(line + 1);
    }
    if (state.reasoningShown !== shown) {
      state.reasoningShown = shown;
      paintParagraphs(state.reasoningText, shown);
    }
    if (state.reasoningBody) {
      if (!running && state.reasoningBody.dataset.streaming === "true") {
        state.reasoningBody.scrollTop = 0;
      }
      state.reasoningBody.dataset.streaming = String(running);
      if (running) {
        // 先同步跟到底，下一帧再补一次：文本刚换完时布局可能还没落定。
        state.reasoningBody.scrollTop = state.reasoningBody.scrollHeight;
        requestAnimationFrame(() => {
          if (state.reasoningBody)
            state.reasoningBody.scrollTop = state.reasoningBody.scrollHeight;
        });
      }
    }
  }

  updateReasoningPreview(state) {
    if (!state.reasoningPreview) return;
    const text = state.reasoningPreviewText || "";
    const open = state.reasoning?.dataset.open === "true";
    state.reasoningPreview.hidden = !text || open;
    if (state.reasoningPreview.textContent !== text)
      state.reasoningPreview.textContent = text;
  }

  /** 折叠行只读第一页，取模型写下的第一句；不读全文。 */
  ensurePreview(entry) {
    const key = `${entry.id}:reasoning`;
    if (this.previews.has(key)) return;
    if (this.previewLoading.has(key)) return;
    const state = this.entryViews?.get(entry.id);
    if (!state || state.kind !== "model") return;
    const cached = this.caches.get(key);
    if (cached?.text) {
      this.previews.set(key, this.reasoningPreviewOf(cached.text));
      state.reasoningPreviewText = this.previews.get(key);
      this.updateReasoningPreview(state);
      return;
    }
    this.previewLoading.add(key);
    this.api(`/tasks/${this.taskId}/entries/${entry.id}/content?kind=reasoning&after=0`)
      .then((data) => {
        const text = (data.chunks || []).map((chunk) => chunk.text).join("");
        const preview = this.reasoningPreviewOf(text);
        this.previews.set(key, preview);
        const current = this.entryViews?.get(entry.id);
        if (current && current.kind === "model") {
          current.reasoningPreviewText = preview;
          this.updateReasoningPreview(current);
        }
      })
      .catch(() => this.previews.set(key, ""))
      .finally(() => this.previewLoading.delete(key));
  }

  reasoningPreviewOf(text) {
    const plain = String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`~]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) return "";
    const sentence = plain.match(/^.*?[。！？.!?]/)?.[0] || plain;
    return sentence.length > 90
      ? `${sentence.slice(0, 90).replace(/[，,、；;：:\s]+$/, "")}…`
      : sentence;
  }

  ensureOutput(state, entry) {
    if (!state.markdown) {
      const block = document.createElement("div");
      block.className = "assistant-block";
      block.dataset.entry = entry.id;
      const md = document.createElement("div");
      md.className = "md";
      block.append(md);
      state.output = block;
      state.markdown = new MarkdownView(md);
      state.el.append(block);
      this.observeContent(entry, block, "output", (text) => {
        state.outputText = text;
        this.paintOutput(state, entry, text);
      });
    }
  }

  /** 回答始终完整渲染，不折叠。 */
  paintOutput(state, entry, text) {
    state.markdown?.setText(text);
  }

  renderTool(entry) {
    const label = TOOL_NAMES[entry.label] || entry.label || "工具";
    const el = document.createElement("div");
    el.className = "tool-call";
    el.dataset.entry = entry.id;
    el.innerHTML = `
      <button class="tool-call-head" type="button" aria-expanded="false">
        <span class="tool-glyph"><span class="tool-icon">${icon(TOOL_ICONS[entry.label] || "wrench")}</span><span class="tool-chev">${icon("chevron-right")}</span></span>
        <span class="tool-call-name"></span>
        <span class="tool-call-brief"></span>
        <span class="tool-call-state"></span>
      </button>
      <div class="tool-call-body" hidden></div>`;
    el.querySelector(".tool-call-name").textContent = label;
    const state = {
      kind: "tool",
      el,
      head: el.querySelector(".tool-call-head"),
      body: el.querySelector(".tool-call-body"),
      name: el.querySelector(".tool-call-name"),
      brief: el.querySelector(".tool-call-brief"),
      status: el.querySelector(".tool-call-state"),
      entry,
      loaded: false,
    };
    state.head.addEventListener("click", () => {
      const open = el.dataset.open === "true";
      el.dataset.open = String(!open);
      state.head.setAttribute("aria-expanded", String(!open));
      state.body.hidden = open;
      if (!open && !state.loaded) {
        state.loaded = true;
        this.loadToolBody(state, this.entries.get(entry.id) || entry);
      }
    });
    this.updateTool(state, entry);
    this.observeToolBrief(state, entry);
    return state;
  }

  /** 工具行只读一次参数，把检索词、文件名或成果标题补在标题后面。 */
  observeToolBrief(state, entry) {
    const load = () => {
      if (state.briefLoaded) return;
      state.briefLoaded = true;
      this.ensureContent(entry, "input")
        .then((input) => {
          if (!state.brief.textContent)
            this.fillToolBrief(state, entry, input, "");
        })
        .catch(() => {});
    };
    if (!("IntersectionObserver" in window) || entry.status === "running") {
      load();
      return;
    }
    if (!this.briefObserver) {
      this.briefObserver = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            if (!record.isIntersecting) continue;
            const wait = this.briefWaits.get(record.target);
            if (!wait) continue;
            this.briefObserver.unobserve(record.target);
            this.briefWaits.delete(record.target);
            wait.load();
          }
        },
        { root: this.transcript, rootMargin: "240px 0px" },
      );
    }
    this.briefWaits.set(state.el, { load });
    this.briefObserver.observe(state.el);
  }

  async loadToolBody(state, entry) {
    state.body.innerHTML = `<div class="tool-section"><span class="tool-label">输入</span><pre class="input"></pre></div><div class="tool-section"><span class="tool-label">结果</span><pre class="output"></pre></div>`;
    const inputEl = state.body.querySelector(".input");
    const outputEl = state.body.querySelector(".output");
    const input = await this.ensureContent(entry, "input").catch(() => "");
    inputEl.textContent = pretty(input);
    if ((entry.details?.chars?.output || 0) > 0) {
      outputEl.textContent = "正在读取…";
      const output = await this.ensureContent(entry, "output").catch(() => "");
      outputEl.textContent = pretty(output);
      this.fillToolBrief(state, entry, input, output);
    } else {
      outputEl.textContent = "尚无输出";
    }
    this.bodyScroll();
  }

  fillToolBrief(state, entry, input, output) {
    const brief = briefOf(entry.label, input, output);
    if (brief) state.brief.textContent = brief;
  }

  updateTool(state, entry) {
    state.entry = entry;
    const status = entry.status || "running";
    state.status.dataset.state = status;
    state.status.textContent = ["failed", "interrupted", "waiting", "incomplete"].includes(status)
      ? STATUS_NAMES[status] || status
      : "";
    state.el.dataset.status = status;
    if (entry.details?.question) {
      state.brief.textContent = entry.details.question;
    } else if (entry.details?.error) {
      state.brief.textContent = entry.details.error;
    }
    if (state.body.hidden === false && entry.status !== "running" && !state.loaded) {
      state.loaded = true;
      this.loadToolBody(state, entry);
    }
  }

  renderReview(entry) {
    const el = document.createElement("div");
    el.className = "tool-call";
    el.dataset.entry = entry.id;
    el.innerHTML = `
      <button class="tool-call-head" type="button" aria-expanded="false">
        <span class="tool-glyph"><span class="tool-icon">${icon("list-checks")}</span><span class="tool-chev">${icon("chevron-right")}</span></span>
        <span class="tool-call-name">审阅</span>
        <span class="tool-call-brief"></span>
        <span class="tool-call-state"></span>
      </button>
      <div class="tool-call-body" hidden></div>`;
    const state = {
      kind: "review",
      el,
      head: el.querySelector(".tool-call-head"),
      body: el.querySelector(".tool-call-body"),
      brief: el.querySelector(".tool-call-brief"),
      status: el.querySelector(".tool-call-state"),
      entry,
    };
    state.head.addEventListener("click", () => {
      const current = this.entries.get(entry.id) || entry;
      if (current.details?.version_id) this.onReview(entry.id);
    });
    this.updateReview(state, entry);
    return state;
  }

  updateReview(state, entry) {
    state.entry = entry;
    const status = entry.status || "running";
    state.status.dataset.state = status;
    state.status.textContent = ["failed", "interrupted", "waiting", "incomplete"].includes(status)
      ? STATUS_NAMES[status] || status
      : "";
    state.brief.textContent =
      entry.details?.review_summary ||
      entry.details?.error ||
      (entry.details?.issues
        ? `${entry.details.issues} 条意见`
        : "正在生成审阅意见");
    state.el.dataset.status = status;
  }

  renderError(state, message, entry) {
    if (state.errorBox) {
      state.errorBox.querySelector(".error-text").textContent = message;
      return;
    }
    const box = document.createElement("div");
    box.className = "error-box";
    box.innerHTML = `${icon("alert")}<span class="error-text"></span><button type="button" class="error-action">查看全文</button>`;
    box.querySelector(".error-text").textContent = message;
    box.querySelector(".error-action").addEventListener("click", () =>
      this.onOpenEntry(entry.id, entry.kind === "tool" ? "output" : "reasoning"),
    );
    state.el.append(box);
    state.errorBox = box;
    state.el.hidden = false;
  }

  /* ---------- 用户消息 ---------- */
  renderUser(turn) {
    const run = turn.run;
    const task = this.task;
    const text = this.userTextFor(run);
    if (!text) {
      // 没有用户原话时用状态行说明这一轮如何开始，不伪造用户气泡。
      const start = document.createElement("div");
      start.className = "turn-start";
      start.innerHTML = `${icon("play")}<span>${
        run.mode === "execute" ? "使用当前提示词开始" : "继续执行"
      }</span>`;
      turn.meta.before(start);
      turn.user = start;
      return;
    }
    const row = document.createElement("div");
    row.className = "user-row";
    const bubble = document.createElement("div");
    bubble.className = "user-bubble";
    bubble.textContent = text;
    // 第一轮的配置附件：只列真实选中的材料。
    if (run.id === [...this.runs.keys()][0]) {
      const names = (task?.config?.materials || [])
        .map((id) => task?.materials?.find((m) => m.id === id)?.name)
        .filter(Boolean);
      if (names.length) {
        const list = document.createElement("div");
        list.className = "attach-list";
        for (const name of names.slice(0, 4)) {
          const chip = document.createElement("span");
          chip.className = "attach-chip";
          chip.innerHTML = `${icon("file-text")}<span></span>`;
          chip.querySelector("span").textContent = name;
          list.append(chip);
        }
        if (names.length > 4) {
          const chip = document.createElement("span");
          chip.className = "attach-chip";
          chip.textContent = `+${names.length - 4}`;
          list.append(chip);
        }
        bubble.append(list);
      }
    }
    const meta = document.createElement("div");
    meta.className = "user-time";
    meta.innerHTML = `<span>${timeOf(run.created_at)}</span><button class="copy-mini" type="button" aria-label="复制这条消息" title="复制">${icon("copy")}</button>`;
    meta.querySelector("button").addEventListener("click", () =>
      copyText(text).catch((error) => this.onError(error)),
    );
    row.append(bubble, meta);
    // 用户消息在回合最上方，耗时行在其下、助手正文之前（对照 Claude 的「用时」）。
    if (turn.meta.parentElement === turn.el) turn.meta.before(row);
    else turn.flow.append(row);
    turn.user = row;
  }

  userTextFor(run) {
    if (!run) return "";
    if (run.mode === "review") return run.instruction || "审阅当前成果";
    if (run.mode === "revise")
      return run.instruction ? `要求修订：${run.instruction}` : "要求修订当前成果";
    if (run.mode === "tool_test")
      return run.instruction || "单独试运行教学工具";
    const notes = this.notes.filter((note) => note.run_id === run.id);
    if (run.mode === "continue") {
      const first = this.runs.values().next().value;
      if (first?.id === run.id) {
        return this.task?.config?.goal || "";
      }
      return notes.find((note) => note.text)?.text || run.instruction || "继续执行";
    }
    // execute：第一轮显示目标；后续轮显示目标或“继续执行”。
    const first = [...this.runs.values()].sort(byCreated)[0];
    if (run.id === first?.id) {
      // 目标留空直接执行时没有用户原话，不伪造一条用户消息。
      return this.task?.config?.goal || "";
    }
    const note = this.notes.find(
      (item) => item.run_id === run.id && item.text,
    );
    return note?.text || run.instruction || "继续执行";
  }

  renderNotes(turn) {
    for (const note of this.notes.filter((item) => item.run_id === turn.run.id)) {
      this.renderNote(turn, note, { prependToFlow: false });
    }
  }

  renderNote(turn, note, { prependToFlow = false } = {}) {
    if (turn.notes.includes(note.id)) return;
    turn.notes.push(note.id);
    const row = document.createElement("div");
    row.className = "note-row";
    const bubble = document.createElement("div");
    bubble.className = "note-bubble";
    bubble.textContent = note.text || "应用新提示词与工具配置";
    if (!note.applied) {
      const flag = document.createElement("span");
      flag.className = "note-flag";
      flag.textContent = "已接收，等待下一步生效";
      bubble.append(flag);
    }
    row.append(bubble);
    turn.flow.append(row);
  }

  /* ---------- 成果 ---------- */
  addVersion(version) {
    if (!version || this.versions.some((item) => item.id === version.id)) return;
    this.versions.push(version);
    this.updateVersions();
    const run = this.runs.get(version.run_id);
    // 手动版本没有执行轮次：只进工作区版本列表，不在对话里新建一条空回合。
    if (run) this.renderResults(this.ensureTurn(run));
  }

  updateVersions() {
    for (const turn of this.turns.values()) this.renderResults(turn);
  }

  renderResults(turn) {
    if (!turn) return;
    const list = this.versions
      .filter((version) => version.run_id === turn.run.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    turn.results.replaceChildren();
    for (const version of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "result-card";
      card.innerHTML = `<span class="result-glyph">${icon("file-text")}</span><span class="result-main"><strong></strong><small></small></span><span class="result-open">查看成果${icon("chevron-right")}</span>`;
      card.querySelector("strong").textContent = version.title;
      setParts(card.querySelector("small"), [
        version.id === this.task?.adopted_version ? "已采用" : "",
        version.complete ? "完整" : "待补全",
        chars(version.chars),
      ]);
      card.addEventListener("click", () => this.onOpenResult(version.id));
      turn.results.append(card);
    }
  }

  /* ---------- 输入/等待/滚动 ---------- */
  renderWaiting(turn) {
    if (turn.waiting) return turn.waiting;
    const box = document.createElement("div");
    box.className = "waiting";
    const loader = document.createElement("span");
    loader.className = "waiting-loader";
    loader.setAttribute("aria-hidden", "true");
    for (const [laneName, count] of [
      ["is-bounce", 3],
      ["is-line", 3],
      ["is-orbit", 4],
    ]) {
      const lane = document.createElement("span");
      lane.className = `waiting-lane ${laneName}`;
      for (let dot = 0; dot < count; dot += 1) {
        const point = document.createElement("span");
        point.className = "waiting-dot";
        lane.append(point);
      }
      loader.append(lane);
    }
    const text = document.createElement("span");
    text.className = "waiting-text";
    const word = document.createElement("span");
    word.className = "waiting-word";
    word.textContent = "正在执行";
    const sweep = document.createElement("span");
    sweep.className = "waiting-sweep";
    sweep.setAttribute("aria-hidden", "true");
    const glyphs = document.createElement("span");
    glyphs.className = "waiting-sweep-glyphs";
    glyphs.dataset.text = "正在执行";
    sweep.append(glyphs);
    text.append(word, sweep);
    const clock = document.createElement("span");
    clock.className = "waiting-clock";
    box.append(loader, text, clock);
    box.hidden = true;
    turn.waiting = box;
    turn.flow.after(box);
    startWaitLoader(loader);
    return box;
  }

  activeTurn() {
    const active = this.task?.active_run;
    if (active && this.turns.has(active)) return this.turns.get(active);
    const running = [...this.turns.values()].find(
      (turn) =>
        ["running", "queued", "stopping", "waiting"].includes(turn.run.status) ||
        turn.entries.some(
          (id) => this.entries.get(id)?.status === "running",
        ),
    );
    return running || null;
  }

  updateWaiting() {
    const turn = this.activeTurn();
    for (const item of this.turns.values()) {
      if (item !== turn && item.waiting) {
        item.waiting.hidden = true;
        releaseWaitLoader(item.waiting.querySelector(".waiting-loader"));
      }
    }
    const status = this.task?.status || "";
    const active = ["running", "queued", "stopping", "waiting"].includes(status);
    const box = turn ? this.renderWaiting(turn) : null;
    if (!active || !turn || !box) {
      if (box) {
        box.hidden = true;
        releaseWaitLoader(box.querySelector(".waiting-loader"));
      }
      this.stopClock();
      this.updateComposerState();
      if (!this.held) this.pin();
      return;
    }
    box.hidden = false;
    const text = this.waitingText(turn);
    const word = box.querySelector(".waiting-word");
    if (word.textContent !== text) {
      word.textContent = text;
      box.querySelector(".waiting-sweep-glyphs").dataset.text = text;
    }
    startWaitLoader(box.querySelector(".waiting-loader"));
    const started = turn.run.created_at;
    const tick = () => {
      if (box.hidden) return;
      box.querySelector(".waiting-clock").textContent = durationOf(started);
    };
    tick();
    if (!this.clock) this.clock = setInterval(tick, 1000);
    this.refreshUsage(turn);
    this.updateComposerState();
  }

  waitingText(turn) {
    if (turn.run.status === "stopping") return "正在停止并保存已收到的内容";
    if (turn.run.status === "queued") return "正在排队";
    if (this.task?.status === "waiting") return "等待你的补充";
    const ids = turn.entries;
    const last = this.entries.get(ids[ids.length - 1]);
    if (!last) return "正在开始";
    if (isWriter(last)) {
      if (last.status !== "running") return "正在整理成果";
      // 修订的输出是修改块，字数不代表成果篇幅，只说明阶段。
      // 新标签是「修订《标题》」，旧记录是「修订 · 标题」。
      const revising = /^修订(《| · )/.test(String(last.label || ""));
      const written = this.writerChars(turn, last);
      if (revising) return written ? "正在修改成果" : "正在构思修改";
      return written ? `正在撰写成果，已写 ${chars(written)}` : "正在构思成果";
    }
    if (last.kind === "tool") {
      return last.status === "running"
        ? `正在调用${TOOL_NAMES[last.label] || "工具"}`
        : "正在整理工具结果";
    }
    const counts = last.details?.chars || {};
    if ((counts.arguments || 0) > 0 && !(counts.output || 0))
      return "正在准备工具调用";
    if ((counts.output || 0) > 0) return "正在撰写";
    if ((counts.reasoning || 0) > 0) return "正在思考";
    return "正在执行";
  }

  /** 同一次写作的续写分成多次调用，按 source 合计已写字数。 */
  writerChars(turn, entry) {
    const source = entry.details?.source;
    if (!source) return entry.details?.chars?.output || 0;
    let total = 0;
    for (const id of turn.entries) {
      const item = this.entries.get(id);
      if (isWriter(item) && item.details?.source === source)
        total += item.details?.chars?.output || 0;
    }
    return total;
  }

  stopClock() {
    clearInterval(this.clock);
    this.clock = null;
  }

  updateTurnMeta(turn) {
    if (!turn) return;
    const button = turn.meta.querySelector(".meta-button");
    const time = turn.meta.querySelector(".meta-time");
    const run = this.runs.get(turn.run.id) || turn.run;
    const elapsed = durationOf(run.created_at, run.finished_at);
    const label =
      run.mode === "execute" ? `用时 ${elapsed}` : `${MODE_NAMES[run.mode] || run.mode}用时 ${elapsed}`;
    time.textContent = label;
    turn.el.dataset.status = run.status;
    button.title = "在执行轨迹中查看这一轮";
    if (this.task?.status === "running" && run.status === "running") {
      time.textContent =
        run.mode === "execute"
          ? `用时 ${durationOf(run.created_at)}`
          : `${MODE_NAMES[run.mode] || run.mode}用时 ${durationOf(run.created_at)}`;
    }
  }

  finishTurn(turn) {
    if (!turn) return;
    this.updateTurnMeta(turn);
    this.renderActions(turn);
  }

  renderActions(turn) {
    const run = this.runs.get(turn.run.id) || turn.run;
    const isActive = ["running", "queued", "stopping", "waiting"].includes(
      run.status,
    );
    const actions = turn.actions;
    turn.usageMarkup = this.usageMarkup(run);
    actions.innerHTML = `
      <button class="action" type="button" data-copy aria-label="复制回答" title="复制回答">${icon("copy")}</button>
      <button class="action" type="button" data-trajectory aria-label="在执行轨迹中查看这一轮" title="查看轨迹">${icon("route")}</button>
      <span class="spacer"></span>
      <span class="usage">${turn.usageMarkup}</span>`;
    actions.querySelector("[data-copy]").addEventListener("click", async () => {
      let text = this.finalText(turn);
      if (!text) {
        const last = [...turn.entries]
          .reverse()
          .map((id) => this.entries.get(id))
          .find((entry) => entry?.kind === "model" && !isWriter(entry) && entry.details?.chars?.output);
        if (last) {
          try {
            text = await this.ensureContent(last, "output");
          } catch (error) {
            this.onError(error);
            return;
          }
        }
      }
      if (!text) return;
      copyText(text)
        .then(() => this.toast?.("已复制回答"))
        .catch((error) => this.onError(error));
    });
    actions
      .querySelector("[data-trajectory]")
      .addEventListener("click", () => this.onModeChange("trajectory"));
    if (isActive) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "action";
      stop.innerHTML = `${icon("stop")}`;
      stop.setAttribute("aria-label", "停止本轮");
      stop.title = "停止本轮";
      stop.addEventListener("click", () => this.onRequestStop());
      actions.insertBefore(stop, actions.querySelector(".spacer"));
    }
  }

  /** 本轮用量。已结算部分在每次调用结束后才更新；执行中加上进行中调用的上下文与已收到输出的估算，
   * 并且不回落，避免结算事件晚到一拍时数字先掉再涨。结束后显示结算值。 */
  runTokens(run) {
    const settled = Number(run?.tokens) || 0;
    if (!run || !ACTIVE.has(run.status)) {
      this.tokenFloor.delete(run?.id);
      return settled;
    }
    let live = settled;
    for (const entry of this.entries.values()) {
      if (entry.run_id !== run.id || entry.status !== "running") continue;
      const details = entry.details || {};
      live += (Number(details.context_tokens) || 0) + (Number(details.live_tokens) || 0);
    }
    const shown = Math.max(live, this.tokenFloor.get(run.id) || 0);
    this.tokenFloor.set(run.id, shown);
    return shown;
  }

  usageMarkup(run) {
    const tokens = this.runTokens(run);
    return `${tokens ? `${icon("terminal")}<span>${nf.format(tokens)} tok</span>` : ""}<span class="turn-time">${timeOf(run.finished_at || run.created_at)}</span>`;
  }

  /** 只换用量文字，不重建操作按钮，执行中频繁刷新也不打断悬停和焦点。 */
  refreshUsage(turn) {
    const run = this.runs.get(turn.run.id) || turn.run;
    const markup = this.usageMarkup(run);
    if (markup === turn.usageMarkup) return;
    const usage = turn.actions.querySelector(".usage");
    if (usage) usage.innerHTML = markup;
    turn.usageMarkup = markup;
  }

  finalText(turn) {
    const ids = turn.entries;
    for (let i = ids.length - 1; i >= 0; i--) {
      const entry = this.entries.get(ids[i]);
      if (entry?.kind === "model" && !isWriter(entry)) {
        const text = this.caches.get(`${entry.id}:output`)?.text;
        if (text) return text;
      }
    }
    return "";
  }

  onScroll() {
    const box = this.transcript;
    const top = box.scrollTop;
    const gap = box.scrollHeight - top - box.clientHeight;
    if (gap < 40) {
      this.held = false;
      this.latest.hidden = true;
    } else if (
      top < (this.lastScrollTop || 0) - 2 &&
      performance.now() > (this.programmaticUntil || 0)
    ) {
      // 只有向上滚才释放跟随；程序化落位与流式增长不能误判成读者离开。
      this.held = true;
    }
    this.lastScrollTop = top;
    this.scrollMemo.chat = top;
  }

  pin() {
    if (this.mode !== "chat" || this.emptyVisible || this.held) return;
    if (this.pinPending) return;
    this.pinPending = true;
    requestAnimationFrame(() => {
      this.pinPending = false;
      if (this.destroyed || this.mode !== "chat" || this.emptyVisible || this.held)
        return;
      this.programmaticUntil = performance.now() + 260;
      this.transcript.scrollTop = this.transcript.scrollHeight;
    });
  }

  pinIfFollowing() {
    if (!this.held) this.pin();
  }

  scrollToLatest() {
    this.held = false;
    this.latest.hidden = true;
    const behavior = document.documentElement.dataset.motion === "reduced"
      ? "auto"
      : "smooth";
    this.programmaticUntil = performance.now() + (behavior === "smooth" ? 800 : 260);
    this.transcript.scrollTo({ top: this.transcript.scrollHeight, behavior });
    this.scrollMemo.chat = this.transcript.scrollHeight;
  }

  refreshEmpty() {
    const hasRuns = (this.task?.runs?.length || 0) > 0 || this.runs.size > 0;
    this.emptyVisible = !hasRuns && !this.entries.size;
    // 问候每次进入页面抽一句；切任务会重建 Conversation，所以抽签放在模块级，不随实例重抽。
    if (this.emptyVisible && this.greeting && this.greeting.textContent !== PAGE_GREETING) {
      this.greeting.textContent = PAGE_GREETING;
    }
    // 空态问候只属于对话视图。轮询里的 updateStatus 也会走到这里，若不看视图，
    // 停在轨迹页时问候会在下一次轮询（几秒后）被插到轨迹上方。
    const inChat = this.mode !== "trajectory";
    this.empty.hidden = !inChat || !this.emptyVisible;
    this.transcript.hidden = !inChat || this.emptyVisible;
    this.composerSeat.dataset.hero = String(this.emptyVisible);
    this.composerCard.dataset.hero = String(this.emptyVisible);
    this.message.placeholder = this.emptyVisible
      ? "今天我能帮你做些什么？"
      : this.task?.active_run
        ? "补充要求…"
        : "补充要求，或直接继续任务…";
    if (this.emptyVisible) {
      this.latest.hidden = true;
      this.composerSeat.scrollIntoView?.({ block: "nearest" });
    }
  }

  updateComposerState() {
    const active = ["running", "queued", "stopping", "waiting"].includes(
      this.task?.status,
    );
    const send = document.getElementById("send");
    const stop = document.getElementById("stop");
    const status = document.getElementById("composer-status");
    if (send) {
      send.hidden = active;
      send.dataset.mode = active
        ? "send"
        : (this.task?.runs?.length || 0) > 0
          ? "send"
          : "start";
      const label = send.querySelector("[data-label]");
      if (label)
        label.textContent = active
          ? "发送"
          : (this.task?.runs?.length || 0) > 0
            ? "继续"
            : "开始任务";
      send.setAttribute(
        "aria-label",
        (this.task?.runs?.length || 0) > 0 ? "发送补充" : "开始任务",
      );
    }
    if (stop) stop.hidden = !active;
    if (status) {
      const value =
        STATUS_NAMES[this.task?.status] ||
        (active ? "执行中" : "准备就绪");
      status.textContent = active
        ? `${value}，在后台继续执行`
        : value;
      status.dataset.state = this.task?.status || "idle";
    }
    const rounds = this.task?.runs?.length || 0;
    const tokens = (this.task?.runs || []).reduce(
      (sum, run) => sum + this.runTokens(this.runs.get(run.id) || run),
      0,
    );
    const roundsEl = document.getElementById("composer-rounds");
    const tokensEl = document.getElementById("composer-tokens");
    if (roundsEl) roundsEl.textContent = `${rounds} 轮`;
    if (tokensEl) tokensEl.textContent = `${nf.format(tokens)} tok`;
  }

  refreshTheme() {
    // Markdown 的颜色全部走 CSS 变量；这里只处理跟随焦点/主题后需要重画的元素。
  }

  setMode(mode, { push = false } = {}) {
    if (mode !== "trajectory") mode = "chat";
    const changed = mode !== this.mode;
    this.scrollMemo[this.mode] =
      this.mode === "trajectory"
        ? this.trajectory.scrollTop
        : this.transcript.scrollTop;
    this.mode = mode;
    this.app.dataset.mode = mode;
    markCurrent(
      document.querySelectorAll(".view-tabs [data-mode]"),
      (button) => button.dataset.mode === mode,
    );
    const showTrajectory = mode === "trajectory";
    this.trajectory.hidden = !showTrajectory;
    this.transcript.hidden = showTrajectory || this.emptyVisible;
    this.empty.hidden = showTrajectory || !this.emptyVisible;
    this.latest.hidden = showTrajectory || !this.held;
    if (showTrajectory) {
      this.trajectory.scrollTop = this.scrollMemo.trajectory || 0;
    } else if (!this.emptyVisible) {
      this.transcript.scrollTop = this.held
        ? this.scrollMemo.chat
        : this.transcript.scrollHeight;
    }
    // 切换时新视图的正文淡入升起；滚动容器本身不动，滚动条和固定元素不跟着位移。
    // 空态不用另加：问候自带的升起动画会在重新显示时重放。
    if (changed && (showTrajectory || !this.emptyVisible)) {
      playEnter(
        showTrajectory ? this.trajectory.querySelector(".transcript-inner") : this.root,
      );
    }
    if (push && this.task) {
      const url = new URL(location.href);
      url.hash = mode === "trajectory" ? "trajectory" : "";
      history.replaceState(history.state, "", url);
    }
    this.onModeChange(mode);
  }

  /* ---------- 正文按需读取 ---------- */
  observeContent(entry, element, kind, paint) {
    const key = `${entry.id}:${kind}`;
    if (element.dataset.observed === "true") return;
    element.dataset.observed = "true";
    const load = () => {
      this.ensureContent(entry, kind)
        .then(paint)
        .catch((error) => this.onError(error));
    };
    if (!("IntersectionObserver" in window) || entry.status === "running") {
      load();
      return;
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          observer.disconnect();
          this.observers.delete(key);
          load();
        }
      },
      { root: this.transcript, rootMargin: "320px 0px" },
    );
    observer.observe(element);
    this.observers.set(key, observer);
  }

  async ensureContent(entry, kind) {
    const key = `${entry.id}:${kind}`;
    let cache = this.caches.get(key);
    if (cache?.done) return cache.text;
    if (this.loading.has(key)) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!this.loading.has(key)) {
            clearInterval(check);
            resolve();
          }
        }, 30);
      });
      return this.caches.get(key)?.text || "";
    }
    this.loading.add(key);
    cache ??= { cursor: 0, text: "", done: false };
    this.caches.set(key, cache);
    try {
      for (;;) {
        const data = await this.api(
          `/tasks/${this.taskId}/entries/${entry.id}/content?kind=${kind}&after=${cache.cursor}`,
        );
        const added = (data.chunks || []).map((chunk) => chunk.text).join("");
        if (added) {
          cache.text += added;
          cache.cursor = data.cursor;
          this.paintCache(entry, kind, cache.text);
        }
        if (!data.has_more) break;
        if (this.destroyed) break;
      }
      cache.done = entry.status !== "running";
      return cache.text;
    } finally {
      this.loading.delete(key);
    }
  }

  paintCache(entry, kind, text) {
    const state = this.entryViews?.get(entry.id);
    if (!state) return;
    if (state.kind === "model") {
      if (kind === "reasoning" && state.reasoningText) {
        if (state.reasoning.dataset.open === "true")
          this.paintReasoning(state, entry, text);
      }
      if (kind === "output") {
        state.outputText = text;
        this.paintOutput(state, entry, text);
      }
    }
    if (state.kind === "tool" && kind === "output" && !state.body.hidden) {
      const output = state.body.querySelector(".output");
      if (output) output.textContent = pretty(text);
    }
  }

  startStream(entry) {
    // 写作者正文不在对话里显示，不必逐拍拉取；进度只看事件里的字数。
    if (this.streams.has(entry.id) || this.destroyed || isWriter(entry)) return;
    const kinds = [];
    const counts = entry.details?.chars || {};
    for (const kind of ["reasoning", "output", "input", "arguments"])
      if ((counts[kind] || 0) > 0) kinds.push(kind);
    if (!kinds.length) return;
    const timer = setInterval(async () => {
      const current = this.entries.get(entry.id);
      if (!current || current.status !== "running" || this.destroyed) {
        this.stopStream(entry.id);
        return;
      }
      for (const kind of kinds) {
        try {
          await this.ensureContent(current, kind);
        } catch {
          // 轮询失败不打断对话；下一拍重试。
        }
      }
      // 读正文期间完成事件可能已经到了：按最新状态判断，不能拿 await 之前的
      // running 快照去 updateEntry，否则刚收起的思考会被重新展开并停在流式窗口里。
      const latest = this.entries.get(entry.id);
      if (!latest || latest.status !== "running" || this.destroyed) return;
      const state = this.entryViews?.get(entry.id);
      if (state?.kind === "model") this.updateEntry(this.turns.get(latest.run_id), state, latest);
    }, 380);
    this.streams.set(entry.id, timer);
  }

  stopStream(entryId) {
    const timer = this.streams.get(entryId);
    if (!timer) return;
    clearInterval(timer);
    this.streams.delete(entryId);
    // 完成后补一次全文，防止最后一拍落在状态变更之后。
    const entry = this.entries.get(entryId);
    if (entry && entry.status !== "running") {
      for (const kind of ["output", "reasoning", "input", "arguments"]) {
        if ((entry.details?.chars || {})[kind]) {
          this.ensureContent(entry, kind).catch(() => {});
        }
      }
    }
  }

  bodyScroll() {
    // 工具行展开后不改变外层阅读位置。
  }

  getEntry(id) {
    return this.entries.get(id) || null;
  }

  /** The latest entry's kind, so the composer mascot can mirror the work. */
  latestEntryKind() {
    const entries = [...this.entries.values()];
    entries.sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")),
    );
    return entries[entries.length - 1]?.kind || "";
  }

  destroy() {
    this.destroyed = true;
    this.stopClock();
    this.streams.forEach((timer) => clearInterval(timer));
    this.streams.clear();
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    this.resize?.disconnect();
    document.removeEventListener("agent:theme", this.onTheme);
  }
}

function byCreated(a, b) {
  return String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id).localeCompare(String(b.id));
}

function fallbackRun(entry) {
  return {
    id: entry?.run_id || "restored",
    status: "completed",
    mode: "execute",
    created_at: entry?.created_at || new Date().toISOString(),
    tokens: 0,
  };
}

function pretty(text) {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 思考是纯文本：按空行切成段落，段间距交给 CSS，不再让空行占满一整行高。
 * 复用已有段落节点，流式刷新时只改变化的那几段。 */
function paintParagraphs(root, text) {
  const parts = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*(?:\n[ \t]*)+/)
    .map((part) => part.replace(/^\n+|\s+$/g, ""))
    .filter(Boolean);
  const nodes = root.children;
  parts.forEach((part, i) => {
    let node = nodes[i];
    if (!node) {
      node = document.createElement("p");
      root.append(node);
    }
    if (node.textContent !== part) node.textContent = part;
  });
  while (nodes.length > parts.length) nodes[nodes.length - 1].remove();
}

function briefOf(label, input, output) {
  try {
    const data = input ? JSON.parse(input) : null;
    if (!data) return "";
    if (label === "search_material" || label === "web_search")
      return data.query ? `“${data.query}”` : "";
    if (label === "read_material") return data.material_id ? `材料 ${data.material_id}` : "";
    if (label === "check_vocabulary") return data.text ? `“${String(data.text).slice(0, 30)}”` : "";
    if (label === "create_document" || label === "patch_document" || label === "revise_document")
      return data.title || data.instruction || "";
    if (label === "ask_user") return data.question || "";
  } catch {}
  return output ? "" : "";
}
