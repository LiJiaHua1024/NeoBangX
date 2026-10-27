/* Ask 工具的回答面板：输入、单选、多选共用一张卡片。
   占住输入区（composer takeover），回答提交后交还输入框。
   结构与交互对照 DeepSeek Harness 的 QuestionComposer：header / options /
   自定义回答 / 跳过 / 提交；选项一律可补充文字。 */

import { icon } from "./icons.mjs";

const RECOMMENDED = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;

function splitLabel(label) {
  const text = String(label || "");
  return RECOMMENDED.test(text)
    ? { label: text.replace(RECOMMENDED, ""), recommended: true }
    : { label: text, recommended: false };
}

function normalized(entry) {
  const details = entry?.details || {};
  const source = details.ask || {};
  const options = (Array.isArray(source.options) ? source.options : [])
    .filter((item) => item && String(item.label || "").trim())
    .map((item) => ({
      label: String(item.label).trim(),
      description: String(item.description || "").trim(),
    }));
  return {
    question: String(source.question || details.question || "").trim(),
    header: String(source.header || "").trim(),
    detail: String(source.detail || "").trim(),
    options,
    multi: Boolean(source.multi_select),
  };
}

export function createAskPanel({ host, stack, onSubmit }) {
  const drafts = new Map();
  const settled = new Set();
  let current = null;
  let refs = null;
  let focusTimer = 0;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function grow(input) {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  }

  function answered(draft) {
    return Boolean(draft.selected.length || draft.custom.trim());
  }

  function render() {
    host.replaceChildren();
    const { ask, draft } = current;
    const card = node("section", "ask-card");
    card.setAttribute("aria-labelledby", "ask-title");

    const head = node("header", "ask-head");
    const heading = node("div", "ask-heading");
    const eyebrow = node("div", "ask-eyebrow");
    const title = node("h2", "ask-title");
    title.id = "ask-title";
    heading.append(eyebrow, title);
    const actions = node("div", "ask-head-actions");
    const minimize = node("button", "ask-icon");
    minimize.type = "button";
    minimize.dataset.ask = "minimize";
    minimize.innerHTML = icon("chevron-down");
    actions.append(minimize);
    head.append(heading, actions);

    const body = node("div", "ask-body");
    const detail = node("p", "ask-detail");
    const options = node("div", "ask-options");
    const customRow = node("div", "ask-custom");
    const mark = node("span", "ask-mark");
    const field = node("div", "ask-field");
    const input = node("textarea", "ask-input scroll-thin");
    input.rows = 1;
    input.setAttribute("aria-label", "回答");
    field.append(input);
    customRow.append(mark, field);
    body.append(detail, options, customRow);

    const foot = node("footer", "ask-foot");
    const hint = node("span", "ask-hint");
    const feedback = node("span", "ask-feedback");
    feedback.setAttribute("role", "status");
    const skip = node("button", "ask-skip", "跳过");
    skip.type = "button";
    skip.title = "不提供这项信息，继续执行";
    const submit = node("button", "ask-submit", "提交");
    submit.type = "button";
    foot.append(hint, feedback, skip, submit);
    card.append(head, body, foot);
    host.append(card);

    refs = {
      card,
      eyebrow,
      title,
      minimize,
      body,
      detail,
      options,
      customRow,
      mark,
      field,
      input,
      hint,
      feedback,
      skip,
      submit,
      foot,
      buttons: [],
    };

    if (ask.options.length) {
      options.setAttribute("role", ask.multi ? "group" : "radiogroup");
      ask.options.forEach((option, index) => {
        const display = splitLabel(option.label);
        const button = node("button", "ask-option");
        button.type = "button";
        button.dataset.label = option.label;
        button.setAttribute("role", ask.multi ? "checkbox" : "radio");
        button.setAttribute("aria-label", display.label);
        const box = node("span", ask.multi ? "ask-box" : "ask-number");
        if (ask.multi) box.innerHTML = icon("check");
        else box.textContent = String(index + 1);
        const copy = node("span", "ask-copy");
        const line = node("span", "ask-option-line");
        const label = node("span", "ask-label", display.label);
        line.append(label);
        if (display.recommended) line.append(node("span", "ask-badge", "推荐"));
        copy.append(line);
        if (option.description) copy.append(node("span", "ask-desc", option.description));
        button.append(box, copy);
        button.addEventListener("click", () => choose(option.label));
        button.addEventListener("keydown", (event) => moveOption(event, index));
        options.append(button);
        refs.buttons.push(button);
      });
      options.hidden = false;
      customRow.hidden = false;
      mark.innerHTML = ask.multi ? icon("check") : icon("edit-3");
      mark.classList.toggle("ask-box", ask.multi);
      mark.classList.toggle("ask-pencil", !ask.multi);
      hint.textContent = ask.multi ? "可多选，也可以直接输入" : "选择一项，也可以直接输入";
    } else {
      options.hidden = true;
      customRow.hidden = false;
      mark.hidden = true;
      input.classList.add("ask-input-block");
      hint.textContent = "输入你的回答";
    }

    minimize.addEventListener("click", () => {
      current.draft.minimized = !current.draft.minimized;
      paint();
    });
    skip.addEventListener("click", () => submitAnswer(true));
    submit.addEventListener("click", () => submitAnswer(false));
    input.addEventListener("input", () => {
      const draftValue = input.value;
      current.draft.custom = draftValue;
      if (!current.ask.multi) current.draft.selected = [];
      current.draft.error = "";
      paint();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      submitAnswer(false);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !current.draft.minimized) {
        current.draft.minimized = true;
        paint();
      }
    });
    paint();
  }

  function moveOption(event, index) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const total = refs.buttons.length;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? total - 1
      : event.key === "ArrowDown" ? (index + 1) % total
      : (index - 1 + total) % total;
    // 单选组的方向键不仅移动焦点，也按原生 radio 的约定切换选项。
    if (!current.ask.multi) choose(refs.buttons[next].dataset.label);
    refs.buttons[next]?.focus();
  }

  function choose(label) {
    const { ask, draft } = current;
    if (draft.busy) return;
    if (ask.multi) {
      draft.selected = draft.selected.includes(label)
        ? draft.selected.filter((item) => item !== label)
        : [...draft.selected, label];
    } else {
      draft.selected = [label];
      draft.custom = "";
      refs.input.value = "";
    }
    draft.error = "";
    paint();
    grow(refs.input);
  }

  function paint() {
    if (!current || !refs) return;
    const { ask, draft } = current;
    refs.eyebrow.textContent = ask.header;
    refs.eyebrow.hidden = !ask.header;
    refs.title.textContent = ask.question;
    refs.detail.textContent = ask.detail;
    refs.detail.hidden = !ask.detail;
    refs.buttons.forEach((button) => {
      const checked = draft.selected.includes(button.dataset.label);
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = ask.multi || checked ? 0 : -1;
    });
    if (!ask.multi && refs.buttons.length && !refs.buttons.some((button) => button.tabIndex === 0))
      refs.buttons[0].tabIndex = 0;
    refs.mark.classList.toggle("ask-box", ask.multi);
    refs.mark.classList.toggle("ask-pencil", !ask.multi);
    refs.mark.classList.toggle("ask-checked", ask.multi && Boolean(draft.custom.trim()));
    refs.mark.innerHTML = ask.multi ? icon("check") : icon("edit-3");
    if (refs.input.value !== draft.custom) refs.input.value = draft.custom;
    refs.input.placeholder = ask.options.length ? "其他答案…" : "输入你的回答…";
    refs.input.disabled = draft.busy;
    refs.card.dataset.minimized = String(draft.minimized);
    refs.body.hidden = draft.minimized;
    refs.skip.disabled = draft.busy;
    refs.submit.disabled = draft.busy || !answered(draft);
    refs.submit.textContent = draft.busy ? "提交中…" : "提交";
    refs.feedback.textContent = draft.error;
    refs.hint.hidden = Boolean(draft.error);
    refs.minimize.setAttribute("aria-expanded", String(!draft.minimized));
    refs.minimize.setAttribute("aria-label", draft.minimized ? "展开问题" : "收起问题");
    refs.minimize.title = draft.minimized ? "展开问题" : "收起问题";
    refs.minimize.innerHTML = icon(draft.minimized ? "chevron-right" : "chevron-down");
    refs.foot.hidden = draft.minimized;
    grow(refs.input);
  }

  async function submitAnswer(skipped) {
    if (!current || current.draft.busy) return;
    const id = current.id;
    const entry = current.entry;
    const { draft } = current;
    if (!skipped && !answered(draft)) {
      draft.error = "请选择一个选项或填写回答。";
      paint();
      return;
    }
    draft.busy = true;
    draft.error = "";
    paint();
    try {
      await onSubmit(entry, {
        selected: skipped ? [] : [...draft.selected],
        custom: skipped ? "" : draft.custom.trim(),
        skipped: Boolean(skipped),
      });
      settled.add(id);
      drafts.delete(id);
      if (current?.id === id) hide();
    } catch (error) {
      if (current?.id !== id) return;
      draft.busy = false;
      draft.error = error?.message || "提交失败，请重试";
      paint();
    }
  }

  function focusFirst() {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (!current || host.hidden) return;
      const target = current.ask.options.length ? refs?.buttons[0] : refs?.input;
      target?.focus({ preventScroll: true });
    }, 60);
  }

  function sync(entry) {
    if (!entry || settled.has(entry.id)) return hide();
    const ask = normalized(entry);
    if (!ask.question) return hide();
    if (!current || current.id !== entry.id) {
      const draft = drafts.get(entry.id) || { selected: [], custom: "", minimized: false, busy: false, error: "" };
      drafts.set(entry.id, draft);
      current = { id: entry.id, entry, ask, draft };
      host.hidden = false;
      stack.hidden = true;
      render();
      focusFirst();
      return;
    }
    current.entry = entry;
    const changed = JSON.stringify(current.ask) !== JSON.stringify(ask);
    current.ask = ask;
    if (changed) {
      // 题干或选项变了：保留已写草稿，重建选项，避免旧标签蒙住新问题。
      current.draft.selected = current.draft.selected.filter((label) =>
        ask.options.some((option) => option.label === label),
      );
      host.hidden = false;
      stack.hidden = true;
      render();
      return;
    }
    host.hidden = false;
    stack.hidden = true;
  }

  function hide() {
    clearTimeout(focusTimer);
    host.hidden = true;
    host.replaceChildren();
    current = null;
    refs = null;
    stack.hidden = false;
  }

  return { sync, hide };
}
