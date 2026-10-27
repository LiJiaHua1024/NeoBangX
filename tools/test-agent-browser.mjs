// Run against tests/workspace_browser_server.py only. No production credentials.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import http from "node:http";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("BROWSER", m.text());
});
const base = "http://127.0.0.1:8765";
await mkdir(".tmp-shots", { recursive: true });
const report = [];
async function checked(label, fn) {
  await fn();
  report.push(label);
  console.log("PASS", label);
}
let mock;
try {
  await checked("login and new task", async () => {
    await page.goto(base + "/agent");
    await page.locator("#login-code").fill("WORKSPACE-TEST");
    await page.locator("#modal-actions button").click();
    await page.waitForURL(/tasks/);
    await page.waitForFunction(
      () => document.querySelector("#save-state").textContent === "已保存",
    );
  });
  const url = page.url();
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 640],
    [844, 390],
    [320, 640],
  ]) {
    await checked(`responsive ${width} × ${height}`, async () => {
      await page.setViewportSize({ width, height });
      await page.locator("[data-tab=prompt]").click();
      assert(await page.locator("#prompt").isVisible());
      if (width < 1100) assert(await page.locator("#mobile-goal").isVisible());
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert(!overflow, "page has horizontal overflow");
      await page.screenshot({ path: `.tmp-shots/agent-${width}.png` });
    });
  }
  await checked("mobile input, upload and edit prompt", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator("#mobile-goal")
      .fill("分析所有题目，保留材料，不能补写听力原文");
    await page
      .locator("#prompt")
      .fill("根据材料分析第一题和第二题，保留原文并说明缺失。");
    await page.locator("[data-tab=materials]").click();
    await page.locator("#upload").setInputFiles({
      name: "试卷.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("第一题原文\n第二题原文\n听力原文未提供"),
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#materials-list .material").length === 1,
    );
    await page.waitForFunction(
      () => document.querySelector("#save-state").textContent === "已保存",
    );
  });
  await checked("execution survives reload and delivers version", async () => {
    await page.locator("#mobile-run").click();
    await page.waitForFunction(
      () => document.querySelector("#task-status").textContent !== "草稿",
    );
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("#task-status").textContent === "已完成",
      {},
      { timeout: 45000 },
    );
    await page.locator("[data-tab=results]").click();
    await page.locator("#versions-list button").first().click();
    await page.waitForFunction(() =>
      document.querySelector("#result-body").textContent.includes("试卷分析"),
    );
    assert((await page.locator("#result-body").textContent()).length < 16000);
    await page.locator("#result-next").click();
    assert(
      !(await page.locator("#result-body").textContent()).includes("试卷分析"),
    );
  });
  await checked("long reasoning complete and bounded DOM", async () => {
    await page.locator(".view-switch [data-view=chat]").click();
    await page.locator("[data-kind=reasoning]").first().click();
    await page.waitForFunction(
      () =>
        document.querySelector(".reader-meta").textContent.includes("120,000"),
      {},
      { timeout: 10000 },
    );
    const count = await page
      .locator(".reader-window pre")
      .evaluate((el) => el.textContent.length);
    assert(count <= 12000);
    await page.locator(".reader-search input").fill("浏览器性能");
    await page.locator("[data-a=find]").click();
    assert(await page.locator(".reader-window mark").isVisible());
    await page.locator("[data-a=last]").click();
    const download = page.waitForEvent("download");
    await page.locator("[data-a=download]").click();
    const d = await download;
    await d.saveAs(".tmp-shots/reasoning.txt");
    await page.locator("#modal-close").click();
  });
  await checked(
    "review feedback can be ignored without changing the artifact",
    async () => {
      await page.locator("[data-review]").first().click();
      await page.locator("#review-issues input").first().check();
      await page
        .getByRole("button", { name: "忽略选中意见", exact: true })
        .click();
      await page.locator("#modal").waitFor({ state: "hidden" });
      await page.locator("[data-review]").first().click();
      await page.getByText(/待核实\s*已忽略/).waitFor();
      await page.locator("#modal-close").click();
    },
  );
  await checked("manual version, comparison and adoption", async () => {
    await page.locator(".view-switch [data-view=work]").click();
    await page.locator("[data-tab=results]").click();
    await page.locator("#versions-list button").first().click();
    await page.locator("#edit-version").click();
    await page.locator("#dialog-value").fill("# 人工修订\n\n保留题目原文。");
    await page.locator("#modal-actions button").last().click();
    await page.waitForFunction(
      () => document.querySelectorAll("#versions-list button").length === 2,
    );
    await page.locator("#modal").waitFor({ state: "hidden" });
    await page.locator("#compare-version").click();
    await page.locator(".reader-window").waitFor({ state: "visible" });
    await page.locator("#modal-close").click();
    await page.locator("#adopt").click();
    assert(
      (await page.locator("#versions-list").textContent()).includes("已采用"),
    );
  });
  await checked("cross window conflict preserves local text", async () => {
    const second = await context.newPage();
    await second.goto(url);
    await second.waitForSelector("#prompt");
    await second.waitForFunction(
      () => document.querySelector("#save-state").textContent === "已保存",
    );
    await second.evaluate(() => {
      document
        .querySelector("#prompt")
        .dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        );
    });
    await second.locator("#prompt").fill("第二窗口本地草稿，不能丢");
    await page.locator("[data-tab=prompt]").click();
    await page.locator("#prompt").fill("第一窗口已保存版本");
    await page.waitForFunction(
      () => document.querySelector("#save-state").textContent === "已保存",
    );
    await second.waitForSelector("#conflict:not([hidden])", { timeout: 12000 });
    assert.equal(
      await second.locator("#prompt").inputValue(),
      "第二窗口本地草稿，不能丢",
    );
    await second.close({ runBeforeUnload: false });
  });
  await checked("editable teaching tool can run on its own", async () => {
    await page.locator("[data-tab=tools]").click();
    await page.locator("#add-teaching").click();
    await page.locator("#teaching-list summary").first().click();
    await page
      .locator("#teaching-list textarea")
      .first()
      .fill("只根据提供的阅读材料进行分析，排除听力。");
    await page.getByRole("button", { name: "单独试运行", exact: true }).click();
    await page
      .locator(".entry-header strong")
      .filter({ hasText: "教学工具试运行" })
      .waitFor();
    await page.waitForFunction(
      () => document.querySelector("#task-status").textContent === "已完成",
      {},
      { timeout: 20000 },
    );
    await page.locator(".view-switch [data-view=work]").click();
    await page.locator("[data-tab=results]").click();
    await page.getByRole("button", { name: /教学工具试运行.*完整/ }).waitFor();
  });
  await checked(
    "admin MCP configure, discover, search, frontend switch",
    async () => {
      mock = http.createServer(async (req, res) => {
        if (req.method === "DELETE") {
          res.writeHead(204).end();
          return;
        }
        let body = "";
        for await (const part of req) body += part;
        const data = JSON.parse(body);
        if (!data.id) {
          res.writeHead(202).end();
          return;
        }
        const result =
          data.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "test", version: "1" },
              }
            : data.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "search_web",
                      description: "搜索测试服务",
                      inputSchema: {
                        type: "object",
                        properties: { query: { type: "string" } },
                        required: ["query"],
                      },
                    },
                  ],
                }
              : {
                  content: [
                    { type: "text", text: "测试搜索结果 https://example.com" },
                  ],
                };
        res
          .writeHead(200, {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "test",
          })
          .end(JSON.stringify({ jsonrpc: "2.0", id: data.id, result }));
      });
      await new Promise((resolve) => mock.listen(8767, "127.0.0.1", resolve));
      const admin = await context.newPage();
      admin.on("pageerror", (e) => errors.push(e.message));
      await admin.goto("http://127.0.0.1:8766/");
      // Agent 配置是管理后台的一个页签，排第二（概览之后），不再是独立页面
      const navLabels = await admin
        .locator(".nav .nav-item")
        .allTextContents();
      assert.equal(navLabels[0].trim(), "概览");
      assert.equal(navLabels[1].trim(), "Agent");
      await admin.getByRole("button", { name: "Agent", exact: true }).click();
      await admin.waitForFunction(
        () => document.querySelector("#agent-max-steps")?.value === "24",
      );
      assert.equal(
        await admin.locator(".page-title").textContent(),
        "Agent 工作台",
      );
      await admin
        .locator("#agent-mcp-url")
        .fill("http://127.0.0.1:8767/mcp");
      await admin.locator("#agent-mcp-token").fill("test-only-secret");
      await admin.locator("#agent-connect").click();
      // 连接成功后自动选中第一个工具，下拉触发器应显示 search_web
      await admin.waitForFunction(() =>
        document
          .querySelector("#agent-tool-trigger")
          ?.textContent.includes("search_web"),
      );
      await admin.locator("#agent-mcp-enabled").check();
      await admin.locator("#agent-search").click();
      await admin.waitForFunction(() =>
        (
          document.querySelector(".agent-result .payload-pre")?.textContent ||
          ""
        ).includes("测试搜索结果"),
      );
      await admin
        .locator(".config-bar")
        .getByRole("button", { name: "保存设置" })
        .click();
      await admin.waitForFunction(
        () =>
          document.querySelector(".page-dirty-hint")?.textContent ===
          "所有修改已保存",
      );
      // 令牌只写不读：保存后输入框必须清空
      assert.equal(await admin.locator("#agent-mcp-token").inputValue(), "");
      assert.equal(
        (await page.request.get(base + "/api/admin/agent")).status(),
        404,
      );
      await page.reload();
      await page.waitForFunction(
        () => document.querySelectorAll("#tools-list .tool-card").length === 5,
      );
      await page.locator("[data-tab=tools]").click();
      assert(
        await page
          .locator("#tools-list")
          .getByText("网页搜索", { exact: true })
          .isVisible(),
      );
      assert(!(await page.getByLabel("网页搜索").isDisabled()));
      await admin.close();
    },
  );
  await checked(
    "200 activities, large artifact, full export and responsive switching",
    async () => {
      const token = await page.evaluate(() => localStorage.getItem("nbx_auth"));
      const task_id = new URL(page.url()).pathname.split("/").at(-1);
      const response = await page.request.post(base + "/__test__/pressure", {
        headers: { Authorization: "Bearer " + token },
        data: { task_id },
      });
      assert.equal(response.status(), 200);
      const seed = await response.json();
      await page.reload();
      await page.waitForFunction(
        () => document.querySelectorAll("[data-entry]").length >= 200,
        {},
        { timeout: 20000 },
      );
      await page.locator("[data-tab=results]").click();
      await page.getByRole("button", { name: /压力成果.*完整/ }).click();
      await page.waitForFunction(() =>
        document
          .querySelector("#result-body")
          .textContent.includes("30 万字符"),
      );
      assert(
        (await page.locator("#result-body").textContent()).length <= 12001,
      );
      let download = page.waitForEvent("download");
      await page.locator("#export-md").click();
      let file = await download;
      await file.saveAs(".tmp-shots/agent-large.md");
      const content = await readFile(".tmp-shots/agent-large.md");
      assert.equal(
        createHash("sha256").update(content).digest("hex"),
        seed.sha256,
      );
      download = page.waitForEvent("download");
      await page.locator("#export-docx").click();
      file = await download;
      await file.saveAs(".tmp-shots/agent-large.docx");
      assert((await readFile(".tmp-shots/agent-large.docx")).length > 100000);
      const metrics = await page.evaluate(async () => {
        const durations = [];
        for (let i = 0; i < 40; i++) {
          const start = performance.now();
          document
            .querySelector(`[data-tab=${i % 2 ? "results" : "prompt"}]`)
            .click();
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
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
      console.log("PERFORMANCE", JSON.stringify(metrics));
      assert(metrics.p95 < 200);
      await writeFile(
        ".tmp-shots/agent-performance.json",
        JSON.stringify(metrics, null, 2),
      );
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".tmp-shots/agent-browser-report.json",
    JSON.stringify({ passed: report, errors }, null, 2),
  );
} catch (e) {
  console.log("ERRORS", errors);
  await page.screenshot({ path: ".tmp-shots/agent-failure.png" });
  throw e;
} finally {
  await context.close();
  await browser.close();
  if (mock) await new Promise((resolve) => mock.close(resolve));
}
