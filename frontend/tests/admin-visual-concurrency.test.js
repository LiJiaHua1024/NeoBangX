const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup() {
  const env = { URLSearchParams, AbortController };
  vm.createContext(env);
  const app = vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../admin-frontend/script.js"), "utf8") + "; adminApp()", env);
  const errors = [];
  app.toast = message => errors.push(message);
  app.adminToolsLoaded = true;
  return { app, errors };
}

test("并发可跟随默认或模型覆盖，编辑取消和其他模型设置保持原值", async () => {
  const { app, errors } = setup();
  app.configForm.visual_paper_concurrency = 8;
  app.configForm.models = [{ id: "test", name: "Test", score: 7, visual_paper_concurrency: null }];
  app.openEditModel(0);
  assert.equal(app.modelForm.concurrency_mode, "default");
  assert.equal(app.modelForm.visual_paper_concurrency, 8);
  app.modelForm.concurrency_mode = "custom";
  app.modelForm.visual_paper_concurrency = 5;
  assert.equal(app.configForm.models[0].visual_paper_concurrency, null);
  await app.saveModelModal();
  assert.equal(app.configForm.models[0].visual_paper_concurrency, 5);
  assert.equal(app.configForm.models[0].score, 7);
  app.openEditModel(0);
  assert.equal(app.modelForm.concurrency_mode, "custom");
  app.modelForm.visual_paper_concurrency = 17;
  await app.saveModelModal();
  assert.equal(app.configForm.models[0].visual_paper_concurrency, 5);
  assert.match(errors.at(-1), /1 到 16/);
  app.modelForm.concurrency_mode = "default";
  await app.saveModelModal();
  assert.equal(app.configForm.models[0].visual_paper_concurrency, null);
});

test("后台配置加载保存往返携带默认并发与模型空值，非法默认值不发请求", async () => {
  const { app } = setup();
  const config = { default_model: "a", visual_paper_concurrency: "8", models: [{ id: "a", visual_paper_concurrency: 5 }, { id: "b" }] };
  let saved = null, writes = 0;
  app.api = async (url, options) => {
    if (options?.method === "PUT") { saved = JSON.parse(options.body); writes++; return {}; }
    return { config };
  };
  await app.loadConfig();
  assert.equal(app.configForm.visual_paper_concurrency, 8);
  assert.equal(app.configForm.models[1].visual_paper_concurrency, null);
  await app.saveConfig();
  assert.equal(saved.visual_paper_concurrency, 8);
  assert.equal(saved.models[0].visual_paper_concurrency, 5);
  assert.equal(saved.models[1].visual_paper_concurrency, null);
  app.configForm.visual_paper_concurrency = 1.5;
  await app.saveConfig();
  assert.equal(writes, 1);
});
