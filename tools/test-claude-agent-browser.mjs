// Claude 风格 Agent 工作台浏览器验收。
// 启动隔离后端（假模型、临时数据库），用 Playwright 无头 Chromium 覆盖双主题、
// 多设备、流式跟随、长思考/长成果、200 步、错误/停止/恢复与现有业务。
//
// 用法：node tools/test-claude-agent-browser.mjs
// 可选：BROWSER_PATH=/path/to/chrome、KEEP_EVIDENCE=1、NBX_TEST_PORT=8790
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(ROOT, ".debug", "claude-port", STAMP);
const VIDEO = path.join(OUT, "video");
const SHOTS = path.join(OUT, "shots");
await mkdir(VIDEO, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const libPath = process.env.PW_LIBS ||
  path.join(homedir(), ".local", "pwlibs", "usr", "lib", "x86_64-linux-gnu");
if (existsSync(libPath)) {
  process.env.LD_LIBRARY_PATH = [libPath, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
}

const { chromium } = await import("playwright");

const python = existsSync(path.join(ROOT, "backend", ".venv", "bin", "python"))
  ? path.join(ROOT, "backend", ".venv", "bin", "python")
  : "python3";
const dataDir = await mkdtemp(path.join(tmpdir(), "nbx-claude-port-"));
let port = Number(process.env.NBX_TEST_PORT || 8790 + (process.pid % 80));
const BASE = `http://127.0.0.1:${port}`;
const report = { passed: [], failed: [], startedAt: new Date().toISOString() };
const errors = [];
const logLines = [];

async function waitForServer(url, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`服务未启动：${url}`);
}

const server = spawn(python, ["tests/workspace_browser_server.py"], {
  cwd: path.join(ROOT, "backend"),
  env: {
    ...process.env,
    NBX_TEST_DATA_DIR: dataDir,
    NBX_TEST_PORT: String(port),
    LITELLM_LOCAL_MODEL_COST_MAP: "true",
    PYTHONUNBUFFERED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => logLines.push(chunk.toString()));
server.stderr.on("data", (chunk) => logLines.push(chunk.toString()));

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

async function checked(name, run) {
  try {
    await run();
    report.passed.push(name);
    console.log("PASS", name);
  } catch (error) {
    report.failed.push({ name, error: error.stack || String(error) });
    console.error("FAIL", name, error.message);
    throw error;
  }
}

let browser;
let context;
let page;
let firstTaskUrl = "";

try {
  await waitForServer(`${BASE}/agent`);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    recordVideo: { dir: VIDEO, size: { width: 1440, height: 1000 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGEERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to fetch")) return;
    errors.push(text);
    console.log("CONSOLE", text);
  });
  const shots = (name) => path.join(SHOTS, name);

  /** Wait until the newly created task is the one the page has actually opened. */
  async function newTask() {
    const previous = await page.locator("#app").getAttribute("data-task");
    await page.locator("#new-task").click();
    await page.waitForFunction(
      (before) => {
        const current = document.querySelector("#app")?.dataset.task;
        return current && current !== before;
      },
      previous,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "草稿",
      {},
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已保存",
      {},
      { timeout: 20000 },
    );
  }

  await checked("登录并建立空白任务", async () => {
    await page.goto(`${BASE}/agent`, { waitUntil: "networkidle" });
    await page.locator("#login-code").waitFor({ state: "visible" });
    await page.locator("#login-code").fill("WORKSPACE-TEST");
    await page.locator("#modal-actions button").click();
    await page.waitForURL(/\/agent\/tasks\//, { timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已保存",
      {},
      { timeout: 20000 },
    );
    await newTask();
    assert(await page.locator("#empty").isVisible(), "空态未显示");
    assert.equal(await page.locator("#composer-seat").getAttribute("data-hero"), "true");
    firstTaskUrl = page.url();
    await page.screenshot({ path: shots("01-empty-light.png") });
  });

  await checked("双主题切换与持久化", async () => {
    await page.locator("#theme-toggle").click();
    await page.locator("[data-theme-pref=dark]").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.agentTheme === "dark",
    );
    await page.screenshot({ path: shots("02-empty-dark.png") });
    await page.locator("#theme-toggle").click();
    await page.locator("[data-theme-pref=light]").click();
    await page.waitForFunction(
      () => document.documentElement.dataset.agentTheme === "light",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.agentTheme),
      "light",
    );
  });

  await checked("任务行菜单按内容收窄", async () => {
    const row = page.locator(".task-row").first();
    await row.hover();
    await page.waitForTimeout(160);
    await row.locator(".task-menu-btn").click();
    const menu = page.locator("body > .popover").first();
    await menu.waitFor({ state: "visible" });
    const box = await menu.boundingBox();
    const buttonBox = await row.locator(".task-menu-btn").boundingBox();
    assert(box.width >= 180 && box.width <= 240, `菜单宽度异常：${box.width}`);
    assert(Math.abs(box.x - buttonBox.x) <= 1, "菜单没有贴着按钮");
    assert.equal(await menu.locator("button").count(), 2, "菜单项数量不对");
    assert(
      (await menu.innerText()).includes("复制任务") &&
        (await menu.innerText()).includes("删除任务"),
      "菜单项文案不对",
    );
    await page.screenshot({ path: shots("02a-task-row-menu-light.png") });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert(
      await row.locator(".task-menu-btn").evaluate(
        (el) => el === document.activeElement,
      ),
      "Escape 后焦点没有回到菜单按钮",
    );
  });

  await checked("下拉菜单仍是自绘面板", async () => {
    assert.equal(await page.locator("select#template").count(), 1);
    assert.equal(
      await page
        .locator("#template")
        .evaluate((el) => getComputedStyle(el).opacity),
      "0",
      "原生 select 仍然露在外面",
    );
    const trigger = page
      .locator("#template")
      .locator("xpath=..")
      .locator(".aw-select-trigger");
    assert.equal(await trigger.count(), 1, "没有自绘下拉触发器");
    assert.equal(await trigger.getAttribute("role"), "combobox");
    await trigger.click();
    const panel = page.locator(".aw-listbox");
    await panel.waitFor({ state: "visible" });
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert(
      (await panel.locator(".aw-option").count()) >= 5,
      "下拉选项没有渲染",
    );
    const first = panel.locator(".aw-option").first();
    const firstBox = await first.boundingBox();
    assert.equal(Math.round(firstBox.height), 30, "下拉行高不是 30px");
    assert.equal(
      await first.locator(".aw-option-check .aw-svg").count(),
      1,
      "当前项缺少橙色勾",
    );
    await page.screenshot({ path: shots("02b-template-select-light.png") });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  });

  await checked("Claude 输入框、平滑光标、模型选择器与 Clawd", async () => {
    assert.equal(await page.locator("#model").getAttribute("type"), "hidden");
    assert.equal(await page.locator("select#model").count(), 0, "仍在用原生 select");
    assert.equal(
      await page.locator("#model-trigger").getAttribute("aria-haspopup"),
      "listbox",
    );
    // Enter 发送、Shift+Enter 换行；提示在 title 里。
    assert(
      (await page.locator("#send").getAttribute("title")).includes("Shift+Enter"),
    );
    await page.locator("#message").click();
    await page.keyboard.type("逐字平滑");
    await page.waitForTimeout(90);
    const caret = page.locator("[data-caret-layer]");
    assert.equal(await caret.count(), 1, "没有绘制光标");
    assert(
      (await caret.getAttribute("data-caret-visible")) !== null,
      "光标未显示",
    );
    assert.equal(
      await caret.evaluate((el) => getComputedStyle(el).transitionDuration),
      "0.08s",
    );
    assert(
      (
        await caret.evaluate((el) =>
          el.getAnimations().map((item) => item.animationName),
        )
      ).includes("agent-caret-blink"),
      "光标没有闪烁动画",
    );
    const before = await caret.evaluate((el) => getComputedStyle(el).transform);
    await page.keyboard.type("，继续");
    await page.waitForTimeout(35);
    const after = await caret.evaluate((el) => getComputedStyle(el).transform);
    assert.notEqual(before, after, "光标没有随输入移动");
    assert.equal(
      await caret.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(217, 119, 87)",
      "光标不是 Claude 的橙色",
    );
    await page.keyboard.press("Shift+Enter");
    assert(
      (await page.locator("#message").inputValue()).includes("\n"),
      "Shift+Enter 没有换行",
    );

    // 模型选择器：Claude 的分组卡片，而不是浏览器原生 select。
    await page.locator("#model-trigger").click();
    await page.waitForTimeout(420);
    assert.equal(
      await page.locator("#model-popover").getAttribute("data-open"),
      "true",
    );
    assert.equal(
      await page.locator(".model-row").count(),
      5,
      "模型行数量不对",
    );
    assert.equal(
      await page.locator(".model-brand-lockup").count(),
      0,
      "模型选择器不应再拼厂商 logo",
    );
    const defaultRow = page.locator(
      '.model-row[data-model-id="test-model"]',
    );
    assert(
      (await defaultRow.innerText()).includes("免费"),
      "缺少免费标签",
    );
    assert(
      (await defaultRow.innerText()).includes("免码"),
      "缺少免码标签",
    );
    assert(
      (await defaultRow.innerText()).includes("原子弹级"),
      "缺少 AA 打击级别",
    );
    assert(
      (await defaultRow.innerText()).includes("界面验收用的本地假模型。"),
      "没有使用模型自己的描述",
    );
    assert(
      (await defaultRow.locator(".model-row-rating").getAttribute("title")).includes(
        "AA 智能指数 45",
      ),
      "评级悬停文案不对",
    );
    const plainRow = page.locator(
      '.model-row[data-model-id="test-model-plain"]',
    );
    assert.equal(
      await plainRow.locator(".model-row-desc").count(),
      0,
      "无描述模型不应生成空描述行",
    );
    const plainGaps = await plainRow.evaluate((el) => {
      const row = el.getBoundingClientRect();
      const name = el.querySelector(".model-row-name").getBoundingClientRect();
      return { top: name.top - row.top, bottom: row.bottom - name.bottom };
    });
    assert(
      Math.abs(plainGaps.top - plainGaps.bottom) <= 1,
      `无描述行没有垂直居中：${plainGaps.top} / ${plainGaps.bottom}`,
    );
    await page.screenshot({ path: shots("05-model-picker-light.png") });
    // Escape closes and returns focus; ArrowDown walks the list.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator("#model-popover").getAttribute("data-open"),
      null,
    );
    await page.locator("#model-trigger").click();
    await page.waitForTimeout(350);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    assert.equal(
      await page.locator(".model-row[data-active]").count(),
      1,
      "键盘没有选中行",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.locator("#model-trigger").click();
    await page.waitForTimeout(350);
    await page
      .locator('.model-row[data-model-id="deepseek/deepseek-v4.1-flash-1017"]')
      .click();
    await page.waitForTimeout(500);
    assert.equal(
      await page.locator("#model").inputValue(),
      "deepseek/deepseek-v4.1-flash-1017",
    );
    assert(
      (await page.locator("#model-trigger").innerText()).includes("DeepSeek"),
      "模型按钮没有更新",
    );

    // Clawd 站在卡片上沿，并且按帧播放。
    assert.equal(await page.locator(".clawd").count(), 1, "缺少 Clawd");
    await page.waitForFunction(() =>
      document.querySelector(".clawd")?.hasAttribute("data-ready"),
    );
    const frameBefore = await page
      .locator(".clawd-strip")
      .evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(420);
    const frameAfter = await page
      .locator(".clawd-strip")
      .evaluate((el) => getComputedStyle(el).transform);
    assert.notEqual(frameBefore, frameAfter, "Clawd 没有播放");
    await page.screenshot({ path: shots("06-composer-clawd-light.png") });
    await page.locator("#message").fill("");
  });

  await checked("空目标直接执行、流式跟随、刷新恢复", async () => {
    await page.locator("#goal").fill("");
    await page.locator("#message").fill("");
    await page.waitForTimeout(900);
    await page.locator("#send").click();
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "执行中",
      {},
      { timeout: 20000 },
    );
    assert(await page.locator(".waiting").count(), "缺少等待行");
    await page.screenshot({ path: shots("03-streaming-light.png") });
    await page.waitForFunction(
      () => document.querySelectorAll(".reasoning").length > 0,
      {},
      { timeout: 15000 },
    );
    await page.waitForTimeout(900);
    const height = await page.locator("#transcript").evaluate((el) => el.scrollHeight);
    assert(height > 500, "对话没有形成可滚动内容");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "已完成",
      {},
      { timeout: 90000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".result-card").length > 0,
      {},
      { timeout: 30000 },
    );
    assert(await page.locator(".assistant").count() >= 2);
    assert(await page.locator(".tool-call").count() >= 2);
    assert(
      (await page.locator("#model-trigger").innerText()).includes("DeepSeek"),
      "模型选择未保存",
    );
    assert(
      (await page.locator(".turn-start").count()) >= 1,
      "空目标执行缺少开始状态行",
    );
    await page.screenshot({ path: shots("04-conversation-light.png") });
  });

  await checked("二十万字符思考：展开、全文搜索、下载", async () => {
    const countText = await page.locator(".reasoning-count").first().textContent();
    const count = Number(countText.replace(/[^\d]/g, ""));
    assert(count >= 200000, `长思考不足：${countText}`);
    await page.locator(".reasoning-head").first().click();
    await page.waitForFunction(
      () => (document.querySelector(".reasoning-text")?.textContent.length || 0) > 200000,
      {},
      { timeout: 30000 },
    );
    const loaded = await page.locator(".reasoning-text").first().evaluate(
      (el) => el.textContent.length,
    );
    assert(loaded >= count, "思考正文读取不完整");
    await page.screenshot({ path: shots("05-reasoning-expanded.png") });
    await page.locator("[data-full]").first().click();
    await page.waitForFunction(
      (n) => document.querySelector(".reader-meta")?.textContent.includes(n),
      count.toLocaleString("zh-CN"),
      { timeout: 30000 },
    );
    const meta = await page.locator(".reader-meta").textContent();
    assert(meta.includes(count.toLocaleString("zh-CN")), "阅读器字符数不一致");
    await page.locator(".reader-search input").fill("浏览器性能");
    await page.locator("[data-a=find]").click();
    await page.locator(".reader-window mark").waitFor({ state: "visible" });
    const download = page.waitForEvent("download");
    await page.locator("[data-a=download]").click();
    const file = await download;
    await file.saveAs(path.join(OUT, "reasoning.txt"));
    const downloaded = await readFile(path.join(OUT, "reasoning.txt"), "utf8");
    assert.equal(downloaded.length, count, "思考下载不完整");
    await page.locator("#modal-close").click();
  });

  await checked("长成果折叠、展开保留全文", async () => {
    await page.locator(".message-fold-toggle").first().click();
    await page.waitForFunction(
      () => {
        const blocks = [...document.querySelectorAll(".assistant-block .md")];
        return blocks.some((el) => el.textContent.includes("最终内容 END"));
      },
      {},
      { timeout: 30000 },
    );
    const texts = await page
      .locator(".assistant-block")
      .evaluateAll((blocks) => blocks.map((block) => block.textContent));
    assert(texts.some((text) => text.includes("最终内容 END")), "长成果末尾丢失");
    assert(
      Math.max(...texts.map((text) => text.length)) > 30000,
      "长成果展开后长度不足",
    );
    await page.screenshot({ path: shots("06-long-output-expanded.png") });
  });

  await checked("审阅意见、忽略与再次打开", async () => {
    const review = page.locator(".tool-call").filter({ hasText: "审阅" }).first();
    await review.click();
    await page.locator("#review-issues .aw-issue").first().waitFor();
    await page.locator("#review-issues input").first().check();
    await page.getByRole("button", { name: "忽略选中意见" }).click();
    await page.locator("#modal").waitFor({ state: "hidden" });
    await review.click();
    await page.getByText(/已忽略/).waitFor();
    await page.locator("#modal-close").click();
  });

  await checked("成果版本编辑、比较、采用、导出", async () => {
    await page.locator(".result-card").first().click();
    await page.waitForTimeout(700);
    assert(await page.locator("[data-tab=results]").getAttribute("aria-current") !== null);
    await page.locator("#versions-list .version-row").last().click();
    await page.waitForTimeout(600);
    await page.locator("#edit-version").click();
    await page.locator("#dialog-value").fill("# 人工修订\n\n保留题目原文与全部材料。");
    await page.locator("#modal-actions button").last().click();
    await page.waitForFunction(
      () => document.querySelectorAll("#versions-list .version-row").length >= 2,
      {},
      { timeout: 20000 },
    );
    await page.locator("#compare-version").click();
    await page.locator(".diff-view").waitFor();
    const diffText = await page.locator(".diff-view").textContent();
    assert(diffText.includes("原版") && diffText.includes("修改版"), "差异块缺失");
    await page.locator("#modal-close").click();
    assert(
      await page.locator("#adopt").isEnabled(),
      "采用按钮不可用，无法验证采用状态",
    );
    await page.locator("#adopt").click();
    await page
      .locator("#document-adopted")
      .waitFor({ state: "visible", timeout: 8000 });
    const download = page.waitForEvent("download");
    await page.locator("#export-md").click();
    const file = await download;
    await file.saveAs(path.join(OUT, "version.md"));
    assert((await readFile(path.join(OUT, "version.md"))).length > 0);
  });

  await checked("工作区：提示词、材料、工具、教学工具、模板", async () => {
    await newTask();
    await page.locator("[data-tab=prompt]").click();
    await page.locator("#prompt").fill("自定义提示词：只处理阅读材料，保留原文。");
    await page.waitForTimeout(1100);
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已保存",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    assert(
      (await page.locator("#prompt").inputValue()).includes("自定义提示词"),
      "提示词未保存",
    );
    await page.locator("[data-tab=materials]").click();
    await page.locator("#upload").setInputFiles({
      name: "试卷.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("第一题原文\n第二题原文\n听力原文未提供"),
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#materials-list .material-row").length === 1,
      {},
      { timeout: 20000 },
    );
    assert.equal(await page.locator("#composer-material-count").textContent(), "1");
    await page.locator("#composer-context .context-chip").first().waitFor();
    await page.locator("[data-tab=tools]").click();
    const toggle = page.locator("#tools-list .switch input").first();
    const before = await toggle.isChecked();
    await toggle.click();
    await page.waitForTimeout(900);
    assert.notEqual(await toggle.isChecked(), before);
    await page.locator("#teaching-select").selectOption({ index: 0 });
    await page.locator("#add-teaching").click();
    await page.locator("#teaching-list .teaching-item").first().waitFor();
    await page.locator("#teaching-list summary").first().click();
    await page.locator("#teaching-list textarea").first().fill("只根据阅读材料分析。");
    await page.waitForTimeout(300);
    await page.locator("[data-tab=prompt]").click();
    await page.locator("#template").selectOption({ index: 1 });
    await page.locator("#modal-actions button").last().click();
    await page.waitForTimeout(600);
    assert(await page.locator("#undo-template").isVisible());
    await page.locator("#undo-template").click();
    await page.locator("#save-template").click();
    await page.locator("#dialog-value").fill("验收模板");
    await page.locator("#modal-actions button").last().click();
    await page.waitForTimeout(700);
    await page.locator("#my-library").click();
    await page.locator("#library .tool-card").first().waitFor();
    await page.locator("#modal-close").click();
  });

  await checked("补充要求在刷新后仍是用户消息", async () => {
    await page.goto(firstTaskUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const before = await page.locator(".turn").count();
    await page.locator("#message").fill("补充：只保留阅读材料");
    await page.waitForTimeout(700);
    await page.locator("#send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".turn").length > n,
      before,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "已完成",
      {},
      { timeout: 60000 },
    );
    await page.waitForTimeout(900);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1100);
    const bubbles = await page.locator(".user-bubble").allTextContents();
    assert(
      bubbles.some((text) => text.includes("补充：只保留阅读材料")),
      "刷新后补充要求丢失",
    );
  });

  await checked("失败与停止状态可读、可恢复", async () => {
    await newTask();
    await page.locator("#goal").fill("模拟失败");
    await page.waitForTimeout(900);
    await page.locator("#send").click();
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "失败",
      {},
      { timeout: 30000 },
    );
    assert((await page.locator(".error-box").first().innerText()).length > 0);
    await page.screenshot({ path: shots("07-failed.png") });
    await newTask();
    await page.locator("#goal").fill("慢速执行");
    await page.waitForTimeout(900);
    await page.locator("#send").click();
    await page.waitForTimeout(2400);
    await page.locator("#stop").click();
    await page.waitForFunction(
      () => document.querySelector("#task-status")?.textContent === "已停止",
      {},
      { timeout: 30000 },
    );
    await page.waitForTimeout(900);
    assert((await page.locator(".error-box").last().innerText()).includes("已停止"));
    await page.screenshot({ path: shots("08-stopped.png") });
  });

  await checked("跨窗口冲突保留本地输入", async () => {
    const second = await context.newPage();
    await second.goto(firstTaskUrl, { waitUntil: "networkidle" });
    await second.waitForTimeout(900);
    await second.evaluate(() => {
      document
        .querySelector("#prompt")
        .dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await second.locator("#prompt").fill("第二窗口本地草稿，不能丢");
    await page.goto(firstTaskUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.locator("#prompt").fill("第一窗口已保存版本");
    await page.waitForFunction(
      () => document.querySelector("#save-state")?.textContent === "已保存",
      {},
      { timeout: 15000 },
    );
    await second.waitForSelector("#conflict:not([hidden])", { timeout: 15000 });
    assert.equal(
      await second.locator("#prompt").inputValue(),
      "第二窗口本地草稿，不能丢",
    );
    await second.close({ runBeforeUnload: false });
  });

  await checked("桌面、平板、手机布局与抽屉", async () => {
    await page.goto(firstTaskUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    for (const [width, height, name] of [
      [1920, 1080, "1920"],
      [1440, 1000, "1440"],
      [1366, 768, "1366"],
      [1280, 800, "1280"],
      [1024, 768, "1024"],
      [768, 1024, "768"],
      [390, 844, "390"],
      [360, 640, "360"],
      [320, 640, "320"],
      [844, 390, "844x390"],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert(!overflow, `${name} 横向溢出`);
      if (width <= 767) {
        assert(await page.locator(".mobile-switch").isVisible(), `${name} 缺少手机切换`);
      } else {
        assert(!(await page.locator(".mobile-switch").isVisible()), `${name} 不应显示手机切换`);
      }
      await page.screenshot({ path: shots(`09-layout-${name}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.locator("#menu").click();
    await page.waitForTimeout(350);
    assert(await page.locator("#nav").isVisible());
    assert(
      (await page.locator(".mobile-switch").evaluate(
        (el) => getComputedStyle(el).display,
      )) === "none",
      "抽屉打开时切换条未隐藏",
    );
    await page.locator("#close-nav").click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#app").getAttribute("data-sidebar"), "collapsed");
    await page.locator(".mobile-switch [data-view=work]").click();
    await page.waitForTimeout(350);
    assert(await page.locator("#work").isVisible());
    await page.screenshot({ path: shots("10-mobile-work.png") });
    await page.locator(".mobile-switch [data-view=chat]").click();
    await page.waitForTimeout(300);
    await page.locator(".mobile-switch [data-view=work]").click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: shots("11-mobile-workspace.png") });
    await page.locator("#workspace-close").click();
  });

  await checked("1440×1240 双主题截图（上游同视口）", async () => {
    await page.setViewportSize({ width: 1440, height: 1240 });
    await page.goto(firstTaskUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.locator("#theme-toggle").click();
    await page.locator("[data-theme-pref=light]").click();
    await page.waitForTimeout(400);
    await page.locator("#transcript").evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: shots("12-conversation-light-1440x1240.png") });
    await page.locator("#theme-toggle").click();
    await page.locator("[data-theme-pref=dark]").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: shots("13-conversation-dark-1440x1240.png") });
  });

  await checked("200 个步骤与 30 万字符成果", async () => {
    const seeded = await page.evaluate(async () => {
      const token = localStorage.getItem("nbx_auth");
      const headers = {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      };
      const cat = await (
        await fetch("/api/workspace/catalog", { headers })
      ).json();
      const task = await (
        await fetch("/api/workspace/tasks", {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "压力验收", config: cat.defaults }),
        })
      ).json();
      const result = await (
        await fetch("/__test__/pressure", {
          method: "POST",
          headers,
          body: JSON.stringify({ task_id: task.id }),
        })
      ).json();
      return { id: task.id, sha256: result.sha256 };
    });
    await page.goto(`${BASE}/agent/tasks/${seeded.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    assert(
      (await page.locator("#timeline [data-entry]").count()) >= 200,
      "200 条轨迹未完整显示",
    );
    assert((await page.locator(".tool-call").count()) >= 200, "对话中的 200 步缺失");
    const metrics = await page.evaluate(async () => {
      const durations = [];
      for (let i = 0; i < 40; i++) {
        const start = performance.now();
        document
          .querySelector(`[data-tab=${i % 2 ? "results" : "prompt"}]`)
          .click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      return {
        p95: durations[Math.floor(durations.length * 0.95)],
        max: Math.max(...durations),
        dom: document.querySelectorAll("*").length,
      };
    });
    await page.locator("[data-tab=results]").click();
    await page.locator("#versions-list .version-row").last().click();
    await page.waitForTimeout(900);
    const firstPage = await page.locator("#result-body").textContent();
    assert(firstPage.includes("30 万字符成果"), "成果首页缺失");
    assert(firstPage.length <= 13000, "成果分页没有限制单页 DOM");
    const download = page.waitForEvent("download");
    await page.locator("#export-md").click();
    const file = await download;
    await file.saveAs(path.join(OUT, "pressure.md"));
    const content = await readFile(path.join(OUT, "pressure.md"));
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      seeded.sha256,
      "30 万字符成果导出哈希不一致",
    );
    await page.locator("#result-next").click();
    await page.waitForTimeout(200);
    assert(
      !(await page.locator("#result-body").textContent()).includes("30 万字符成果"),
      "成果分页未前进",
    );
    await page.screenshot({ path: shots("14-pressure-result.png") });
    await page.locator(".view-tabs [data-mode=trajectory]").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: shots("15-pressure-trajectory.png") });
    await writeFile(
      path.join(OUT, "performance.json"),
      JSON.stringify({ metrics }, null, 2),
    );
    assert(metrics.p95 < 200, `切换 p95 过高：${metrics.p95}`);
  });

  await checked("减少动效偏好生效", async () => {
    const reduced = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(`${BASE}/agent`, { waitUntil: "networkidle" });
    await reducedPage.waitForTimeout(600);
    assert.equal(
      await reducedPage.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      true,
    );
    const duration = await reducedPage
      .locator("#message")
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    assert(
      duration === "0.01ms" || duration === "0s" || duration === "1e-05s",
      `动效未关闭：${duration}`,
    );
    await reduced.close();
  });

  assert.deepEqual(errors, [], `浏览器错误：${errors.join(" | ")}`);
  report.completedAt = new Date().toISOString();
  report.errors = errors;
  report.performance = JSON.parse(
    await readFile(path.join(OUT, "performance.json"), "utf8"),
  );
  await context.tracing.stop({ path: path.join(OUT, "trace.zip") });
  await context.close();
  await browser.close();
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(OUT, "server.log"),
    logLines.join(""),
  );
  console.log(`\nEVIDENCE ${OUT}`);
  console.log(`PASSED ${report.passed.length}`);
  if (!process.env.KEEP_EVIDENCE) {
    await rm(dataDir, { recursive: true, force: true });
  }
} catch (error) {
  report.failed.push({ name: "run", error: error.stack || String(error) });
  report.completedAt = new Date().toISOString();
  report.errors = errors;
  try {
    if (page) await page.screenshot({ path: path.join(OUT, "failure.png") });
    if (context) await context.tracing.stop({ path: path.join(OUT, "trace.zip") });
    if (context) await context.close();
    if (browser) await browser.close();
  } catch {}
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(OUT, "server.log"), logLines.join(""));
  console.error(`\nEVIDENCE ${OUT}`);
  console.error(error);
  stopServer();
  process.exitCode = 1;
} finally {
  stopServer();
}
