const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/vendor/ba-click-fx/ba-click-fx.js"), "utf8");
// 加载真实实现但不创建设备；只把未导出的 renderer 暴露给测试。
const env = { atob };
vm.createContext(env);
const types = vm.runInContext(source.replace(/^export .*;$/m, "") + "; ({ renderer: ai, fx: Xo, hdr: f, passSize: zr, geometrySize: Br })", env);
const pipeline = () => ({ getBindGroupLayout: () => ({}) });

function renderer() {
  const instance = Object.create(types.renderer.prototype);
  const groups = [], writes = [];
  instance.device = {
    createBindGroup: (descriptor) => { const group = { descriptor }; groups.push(group); return group; },
    queue: { writeBuffer: (target, offset, data) => writes.push(Buffer.from(new Uint8Array(data))) },
  };
  instance.sampler = {};
  return { instance, groups, writes };
}

test("WebGPU uniform 字节布局、默认值、padding 与全新缓冲一致", () => {
  const { instance, writes } = renderer();
  const fields = [
    ["texelX", 1], ["texelY", 1], ["backgroundScaleX", 1], ["backgroundScaleY", 1],
    ["sampleScale", 1], ["threshold", 0], ["softKnee", 0], ["clampMax", 65504],
    ["intensity", 0], ["overlayAlphaLimit", 1], ["opacity", 1],
    ...["hasScene", "hasBackground", "transparentOverlay", "visualMaxAlpha", "brightUnknownBackground", "hostAdditive", "extendedOutput"].map((key) => [key, false]),
    ...["peak", "whiteCore", "whiteStart", "whiteEnd", "brightness", "colorPreservation"].map((key) => ["hdr" + key[0].toUpperCase() + key.slice(1), types.hdr[key]]),
  ];
  let first;
  for (let frame = 0; frame < 100; frame++) {
    const params = Object.fromEntries(fields.filter((_, i) => (i + frame) % 3).map(([key], i) => [key, frame % 2 ? (i - 4) / 7 : null]));
    const expected = Buffer.alloc(types.passSize);
    fields.forEach(([key, fallback], i) => {
      if (i >= 11 && i <= 17) expected.writeUInt32LE(+!!params[key], i * 4);
      else expected.writeFloatLE(params[key] ?? fallback, i * 4);
    });
    const actual = instance._createPassUniform(params);
    first ??= actual;
    assert.equal(actual, first);
    assert.deepEqual(Buffer.from(actual), expected);

    instance.displayWidth = 800 + frame;
    instance.displayHeight = 600;
    instance._writeGeometryUniform({}, frame % 2, { disk: -1, ring: frame / 10 });
    const geometry = Buffer.alloc(types.geometrySize);
    [800 + frame, 600, 0, frame / 10].forEach((value, i) => geometry.writeFloatLE(value, i * 4));
    geometry.writeUInt32LE(frame % 2, 16);
    assert.deepEqual(writes.at(-1), geometry);
  }
});

test("稳定资源重复 1000 次只创建一组几何绑定和一个 texture view", () => {
  const { instance, groups } = renderer();
  let views = 0;
  const texture = { createView: () => { views++; return {}; } }, p = pipeline(), uniform = {};
  const first = instance._createGeometryBindGroup(p, uniform, texture);
  for (let i = 0; i < 1000; i++) assert.equal(instance._createGeometryBindGroup(p, uniform, texture), first);
  assert.equal(groups.length, 1);
  assert.equal(views, 1);
  assert.equal(first.descriptor.entries[0].resource.buffer, uniform);
  assert.equal(first.descriptor.entries[2].resource, instance.sampler);
  // 修改 buffer 内容无需重建绑定；替换任一绑定资源则必须重建。
  instance._writeGeometryUniform(uniform, true);
  assert.equal(instance._createGeometryBindGroup(p, uniform, texture), first);
  const variants = [[pipeline(), uniform, texture], [p, {}, texture], [p, uniform, { createView: () => ({}) }], [p, uniform, null]];
  for (const args of variants) assert.notEqual(instance._createGeometryBindGroup(...args), first);
  instance.sampler = {};
  assert.notEqual(instance._createGeometryBindGroup(p, uniform, texture), first);
  const previous = groups.at(-1);
  instance.device = { ...instance.device };
  assert.notEqual(instance._createGeometryBindGroup(p, uniform, texture), previous);
});

test("全屏绑定覆盖四张贴图、pipeline、uniform、sampler 和 device，释放后失效", () => {
  const { instance, groups } = renderer();
  const args = [pipeline(), {}, {}, {}, {}, {}];
  const first = instance._createFullscreenBindGroup(...args);
  for (let i = 0; i < 1000; i++) assert.equal(instance._createFullscreenBindGroup(...args), first);
  assert.equal(groups.length, 1);
  assert.deepEqual(Array.from(first.descriptor.entries, (entry) => entry.binding), [0, 1, 2, 3, 4, 5]);
  for (let i = 0; i < args.length; i++) {
    const previous = instance._createFullscreenBindGroup(...args);
    args[i] = i === 0 ? pipeline() : {};
    assert.notEqual(instance._createFullscreenBindGroup(...args), previous);
  }
  for (const key of ["sampler", "device"]) {
    const previous = instance._createFullscreenBindGroup(...args);
    instance[key] = { ...instance[key] };
    assert.notEqual(instance._createFullscreenBindGroup(...args), previous);
  }
  const previous = instance._createFullscreenBindGroup(...args);
  instance.levels = [];
  instance._deleteTargets();
  assert.equal(instance._nbxBindGroups, null);
  assert.notEqual(instance._createFullscreenBindGroup(...args), previous);
  const noUniform = instance._createFullscreenBindGroup(args[0], null, args[2]);
  assert.equal(instance._createFullscreenBindGroup(args[0], null, args[2]), noUniform);
  assert.deepEqual(Array.from(noUniform.descriptor.entries, (entry) => entry.binding), [1, 2]);
});

test("同尺寸 resize 不重置画布，DPR 变化和外部尺寸变化仍能修复", () => {
  const instance = Object.create(types.fx.prototype);
  let resets = 0, frames = 0;
  function canvas() {
    let width = 800, height = 600;
    return {
      get width() { return width; }, set width(v) { width = v; resets++; },
      get height() { return height; }, set height(v) { height = v; resets++; },
    };
  }
  Object.assign(instance, { width: 800, height: 600, dpr: 1, canvas: canvas(), contrastCanvas: canvas(),
    context: { setTransform() {} }, contrastContext: { setTransform() {} }, config: { maxDpr: 2 },
    _getCanvasRect: () => ({ width: 800, height: 600 }), _requestRender: () => frames++ });
  for (let i = 0; i < 100; i++) instance._resize(800, 600, 1);
  assert.equal(resets, 0);
  assert.equal(frames, 0);
  instance._resize(800, 600, 2);
  assert.equal(instance.canvas.width, 1600);
  assert.equal(instance.contrastCanvas.height, 1200);
  assert.equal(resets, 4);
  instance.contrastCanvas.width = 1;
  instance._resize(800, 600, 2);
  assert.equal(instance.contrastCanvas.width, 1600);
  assert.equal(frames, 2);
});

test("主站与管理端的接入层、库和补丁台账逐字节同步", () => {
  for (const file of ["click-fx.js", "vendor/ba-click-fx/ba-click-fx.js", "vendor/ba-click-fx/PATCHES.md"]) {
    assert.deepEqual(fs.readFileSync(path.join(root, "frontend", file)), fs.readFileSync(path.join(root, "admin-frontend", file)));
  }
});
