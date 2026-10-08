// Measures layout anchors in the MOCKED harness. Evidence for geometry only, never for live behaviour.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = spawn("npx", ["vite", "--config", path.join(here, "vite.config.mjs")], { cwd: path.resolve(here, "../../.."), stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { if ((await fetch("http://localhost:5199/")).ok) break; } catch {} await wait(500); }
const report = {};
const browser = await chromium.launch();
try {
  for (const [w, h] of [[1536, 1024], [1440, 900], [1200, 900], [1024, 768], [768, 1024], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto("http://localhost:5199/");
    await page.waitForSelector("[data-item-id]");
    await page.waitForTimeout(600);
    report[w] = await page.evaluate(() => {
      const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const ws = rect("[data-code-activity-workspace]");
      const feed = rect(".ca-feed");
      const detail = rect(".ca-detail");
      const first = rect("[data-item-id]");
      const small = [...document.querySelectorAll("[data-code-activity-workspace] button, [data-code-activity-workspace] a, [data-code-activity-workspace] input")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44) && getComputedStyle(el).visibility !== "hidden"; }).length;
      return { workspace: ws, feed, detail, firstRow: first, dividerX: feed ? feed.x + feed.w : null, feedShare: feed && ws ? +(feed.w / ws.w).toFixed(3) : null, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, controlsUnder44px: small, minFontPx: Math.min(...[...document.querySelectorAll("[data-code-activity-workspace] *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))) };
    });
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
writeFileSync(path.resolve(here, "../screenshots/geometry.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([w, r]) => [w, { workspaceX: r.workspace?.x, workspaceW: r.workspace?.w, dividerX: r.dividerX, feedShare: r.feedShare, firstRowH: r.firstRow?.h, overflowX: r.horizontalOverflow, minFont: r.minFontPx }])), null, 1));
