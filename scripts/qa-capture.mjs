#!/usr/bin/env node
/**
 * Captures the QA workspace screens from an isolated demo-mode dev server.
 *
 *   KATALIST_QA_BASE=http://127.0.0.1:8091 node scripts/qa-capture.mjs [outDir]
 *
 * Start the server with demo mode and inert Supabase values (see the completion report). The script only
 * ever talks to that server; QA data comes from the in-memory preview adapter, never from a database.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.KATALIST_QA_BASE || "http://127.0.0.1:8091";
const OUT = process.argv[2] || "output/manual-qa-mockup/screenshots";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { "1440x900": { width: 1440, height: 900 }, "1920x1080": { width: 1920, height: 1080 }, "1024x768": { width: 1024, height: 768 }, "390x844": { width: 390, height: 844 } };
const only = (process.env.QA_VIEWPORTS || "1440x900,1920x1080,1024x768,390x844").split(",");

export async function openQa(page) {
  await page.goto(`${BASE}/auth`);
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  if (await demoTab.isVisible().catch(() => false)) await demoTab.click();
  await page.getByRole("button", { name: /Priya Sharma/i }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 30000 });
  await page.goto(`${BASE}/lists`);
  await page.locator('a[href^="/lists/"]:visible').first().click();
  await page.getByRole("button", { name: /^QA$/ }).click();
  await page.locator("[data-qa-root]").first().waitFor();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  for (const name of only) {
    const context = await browser.newContext({ viewport: VIEWPORTS[name] });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    await openQa(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/probe-${name}.png` });
    await context.close();
  }
  await browser.close();
}
