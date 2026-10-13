// Production browser, verification account only: Coey's reusable results for three question families.
import { chromium } from "playwright";
const BASE = "https://katalist-web.vercel.app";
const [SESS, who = "B"] = process.argv.slice(2);
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/${who}.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const work = page.getByRole("button", { name: /^Work$/ }).first();
if (await work.count()) { await work.click().catch(() => {}); await page.waitForTimeout(1500); }
const box = () => page.locator('textarea[aria-label="Magic Box"]:visible');
const panel = () => page.locator('[aria-label="Magic Box assistant"]:visible').first();
const close = page.locator('button[aria-label="Close assistant answer"]:visible');
let n = 80;
for (const q of ["how many things need my attention", "who needs the nudge the most", "what have I snoozed"]) {
  if (await close.count()) { await close.first().click(); await page.waitForTimeout(500); }
  await box().fill(q); await page.waitForTimeout(2500); await box().press("Enter");
  for (let i = 0; i < 50; i++) { if (await panel().locator("h3").count()) break; await page.waitForTimeout(400); }
  await page.waitForTimeout(600);
  const heading = await panel().locator("h3").first().innerText().catch(() => "(no presentation)");
  const groups = await panel().locator("section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const disabled = await panel().locator("button[disabled]").allInnerTexts();
  const reasons = await panel().locator("p.bg-amber-50").allInnerTexts();
  console.log(`\nQ: ${q}\n  heading: ${heading}\n  groups: ${groups.join(" | ")}\n  disabled: ${disabled.join(", ")}\n  reasons: ${reasons.map((r) => r.slice(0, 90)).join(" / ")}`);
  await page.screenshot({ path: `${OUT}${n++}-results-${q.split(" ").slice(-2).join("-")}.png` });
}
await browser.close();
