import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../screenshots");
mkdirSync(out, { recursive: true });
const server = spawn("npx", ["vite", "--config", path.join(here, "vite.config.mjs")], { cwd: path.resolve(here, "../../.."), stdio: "inherit" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up() { for (let i = 0; i < 80; i++) { try { if ((await fetch("http://localhost:5199/")).ok) return; } catch {} await wait(500); } throw new Error("harness did not start"); }

const SIZES = [[1536, 1024, "1536"], [1440, 900, "1440"], [1024, 768, "1024"], [768, 1024, "768"], [390, 844, "390"], [640, 512, "zoom200-of-1280"]];
try {
  await up();
  const browser = await chromium.launch();
  for (const [w, h, name] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto("http://localhost:5199/");
    await page.waitForSelector("[data-code-activity-workspace] [data-item-id]", { timeout: 20000 });
    await page.waitForTimeout(500);
    if (w >= 1024) { await page.locator("[data-item-id^='commit:']").first().locator("button").first().click(); await page.waitForTimeout(800); }
    await page.screenshot({ path: path.join(out, `workspace-${name}.png`) });
    if (w < 1024) { await page.locator("[data-item-id^='commit:']").first().locator("button").first().click(); await page.waitForTimeout(800); await page.screenshot({ path: path.join(out, `workspace-${name}-detail.png`) }); }
    await page.close();
  }
  const p = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
  await p.goto("http://localhost:5199/"); await p.waitForSelector("[data-item-id]");
  await p.locator("[data-item-id^='commit:']").first().locator("button").first().click();
  await p.getByRole("tab", { name: /files/i }).click(); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, "workspace-1536-files.png") });
  for (const [state, wait] of [["empty", "[data-code-activity-workspace]"], ["error", "[data-code-activity-workspace]"], ["permission", "[data-code-activity-workspace]"]]) {
    const q = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    await q.goto(`http://localhost:5199/?state=${state}`); await q.waitForSelector(wait); await q.waitForTimeout(900);
    if (state === "permission") await q.getByRole("tab", { name: "Deployments" }).click();
    await q.waitForTimeout(500);
    await q.screenshot({ path: path.join(out, `workspace-1536-${state}.png`) });
    await q.close();
  }
  await browser.close();
} finally { server.kill(); }
