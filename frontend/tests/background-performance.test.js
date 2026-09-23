const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function background(file, { hidden = false, reduced = false } = {}) {
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("function createBackground(canvas) {");
  const end = source.indexOf("\n}\n", start) + 2;
  const frames = new Map(), events = {}, calls = [];
  let id = 0, resets = 0;
  const ctx = new Proxy({}, {
    get: (_, key) => (...args) => {
      calls.push([key, ...args]);
      return { addColorStop() {} };
    },
    set: () => true,
  });
  let width = 300, height = 150;
  const canvas = {
    getContext: () => ctx,
    get width() { return width; },
    set width(value) { width = value; resets++; },
    get height() { return height; },
    set height(value) { height = value; resets++; },
  };
  const listen = (name, fn) => { events[name] = fn; };
  const document = {
    hidden, documentElement: {}, addEventListener: listen,
    createElement: () => ({ getContext: () => ctx }),
  };
  const env = {
    document, window: { addEventListener: listen },
    innerWidth: 150, innerHeight: 75, devicePixelRatio: 2,
    matchMedia: (query) => ({ matches: query.includes("reduced-motion") && reduced }),
    getComputedStyle: () => ({ getPropertyValue: () => "0" }),
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
  };
  vm.createContext(env);
  const api = vm.runInContext(source.slice(start, end) + "; createBackground", env)(canvas);
  const step = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn());
  };
  return { api, env, events, frames, calls, step, resets: () => resets };
}

for (const dir of ["frontend", "admin-frontend"]) {
  const file = path.resolve(__dirname, "../..", dir, "script.js");
  test(`${dir}: 隐藏与手动暂停互不覆盖，恢复只启动一条动画链`, () => {
    const bg = background(file, { hidden: true });
    assert.equal(bg.frames.size, 0);
    bg.env.document.hidden = false;
    bg.events.visibilitychange();
    assert.equal(bg.frames.size, 1);
    bg.api.resume();
    assert.equal(bg.frames.size, 1);
    bg.api.suspend();
    assert.equal(bg.frames.size, 0);
    bg.env.document.hidden = true;
    bg.events.visibilitychange();
    bg.api.resume();
    assert.equal(bg.frames.size, 0);
    bg.env.document.hidden = false;
    bg.events.visibilitychange();
    bg.step();
    assert.equal(bg.frames.size, 1);
  });

  test(`${dir}: 同尺寸 resize 不重置画布，事件风暴只合并一次`, () => {
    const bg = background(file);
    assert.deepEqual(bg.calls.find(([name]) => name === "setTransform"), ["setTransform", 2, 0, 0, 2, 0, 0]);
    const before = bg.resets();
    for (let i = 0; i < 20; i++) bg.events.resize();
    assert.equal(bg.frames.size, 2); // 动画一条，尺寸更新一条
    bg.step();
    assert.equal(bg.resets(), before);
    bg.env.innerWidth += 10;
    for (let i = 0; i < 20; i++) bg.events.resize();
    bg.step();
    assert.equal(bg.resets(), before + 2);
  });

  test(`${dir}: 减少动态效果时 resize 补画，但不启动动画`, () => {
    const bg = background(file, { reduced: true });
    const before = bg.calls.filter(([name]) => name === "clearRect").length;
    bg.env.innerHeight += 10;
    bg.events.resize();
    bg.step();
    assert.equal(bg.calls.filter(([name]) => name === "clearRect").length, before + 1);
    assert.equal(bg.frames.size, 0);
  });
}
