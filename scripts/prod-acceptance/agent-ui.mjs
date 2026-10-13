// Production browser, verification account A only: the Ask agent end to end.
import { chromium } from "playwright";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let creates = 0;
page.on("request", (r) => {
  if (r.url().includes("/rpc/coey_create_things")) creates++;
  if (r.url().includes("/api/assistant/stream")) { const b = JSON.parse(r.postData() || "{}"); console.log("stream request:", JSON.stringify({ ...b, history: b.history?.length })); }
});
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const box = () => page.locator('textarea[aria-label="Magic Box"]:visible');
const panel = () => page.locator('[aria-label="Magic Box assistant"]:visible').first();

// 1. A question → agent answer with status and a nudge card.
await box().fill("who needs the nudge the most");
await page.waitForTimeout(3000);
console.log("button:", await page.locator('button[aria-label="Ask Coey"]:visible').count() ? "Ask Coey" : "Toss");
await box().press("Enter");
let statusSeen = new Set();
for (let i = 0; i < 40; i++) {
  const st = await page.locator('[role="status"]:visible').allInnerTexts().catch(() => []);
  for (const x of st) if (x.trim()) statusSeen.add(x.trim().slice(0, 40));
  if (/follow-up time|Nothing you sent/i.test(await panel().innerText().catch(() => ""))) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
console.log("statuses:", [...statusSeen].join(" | "));
console.log("answer:", (await panel().innerText()).replace(/\s+/g, " ").slice(0, 400));
await page.screenshot({ path: `${OUT}70-agent-nudge-answer.png` });
const card = panel().getByRole("button", { name: /Nudge/ }).first();
if (await card.count()) {
  await card.click(); await page.waitForTimeout(2500);
  console.log("preview:", (await panel().innerText()).replace(/\s+/g, " ").match(/You are about to[^]*?(Confirm|Cancel)/)?.[0]?.slice(0, 200));
  const confirm = panel().getByRole("button", { name: "Confirm" }).first();
  if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(3000); console.log("after confirm:", (await panel().innerText()).replace(/\s+/g, " ").match(/(Done|Skipped|Failed|Already)[^.]*/g)?.slice(0, 3)); }
  await page.screenshot({ path: `${OUT}71-agent-nudge-confirmed.png` });
} else console.log("no nudge card");

// 2. A time alone asks first.
await page.keyboard.press("Escape");
await box().fill("tomorrow");
await page.waitForTimeout(2500);
await box().press("Enter");
await page.waitForTimeout(2000);
console.log("tomorrow:", (await page.locator('[aria-label="Magic Box clarification"]:visible').innerText().catch(() => "(no clarification)")).replace(/\s+/g, " ").slice(0, 120), "creates:", creates);
await page.screenshot({ path: `${OUT}72-time-only-asks.png` });
await box().fill("");

// 3. A Coey verb + an existing Thing goes to Ask.
await box().fill("summarise the dealer price list");
await page.waitForTimeout(2500);
console.log("command button:", await page.locator('button[aria-label="Ask Coey"]:visible').count() ? "Ask Coey" : "Toss");
await browser.close();
console.log("Things created during the run:", creates);
