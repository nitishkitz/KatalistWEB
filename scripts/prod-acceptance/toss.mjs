import { chromium, devices } from "playwright";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let interpretCalls = 0, creates = 0;
page.on("request", (r) => {
  if (r.url().includes("/api/coey/interpret")) interpretCalls++;
  if (r.url().includes("/rpc/coey_create_things")) creates++;
});
const box = () => page.locator('textarea[aria-label="Magic Box"]:visible');
async function typeLine(text) {
  await box().click();
  await box().fill("");
  await box().fill(text);
  await page.waitForTimeout(2600); // pause + Sarvam
}
const vis = (label) => page.locator(`[aria-label="${label}"]:visible`).first();
const chips = async () => (await vis("What Coey understood").innerText({ timeout: 1500 }).catch(() => "")).replace(/\s+/g, " ");
const question = async () => (await vis("Magic Box clarification").innerText({ timeout: 1500 }).catch(() => "")).replace(/\s+/g, " ");
const results = [];
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// a) mentioned name stays with me
await typeLine("Call Katalist Verify B about GST");
results.push({ case: "mention stays with sender", chips: await chips(), question: await question() });
await page.screenshot({ path: `${OUT}10-toss-mention-preview.png` });
let before = creates;
await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
await page.waitForTimeout(3500);
results.push({ case: "mention saved once", creates: creates - before });

// b) delegate to a connected person
await typeLine("Katalist Verify B send the price list by Friday");
results.push({ case: "delegate to connected", chips: await chips(), question: await question() });
await page.screenshot({ path: `${OUT}11-toss-delegate-preview.png` });
before = creates;
await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
await page.waitForTimeout(3500);
results.push({ case: "delegate saved", creates: creates - before, pageQuestion: await question() });

// c) unconnected person: asks, never sends
await typeLine("Katalist Verify C send the invoice");
results.push({ case: "unconnected", chips: await chips(), question: await question() });
await page.screenshot({ path: `${OUT}12-toss-unconnected.png` });
before = creates;
await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
await page.waitForTimeout(2500);
results.push({ case: "unconnected send blocked", creates: creates - before, question: await question() });
await box().fill("");
await page.waitForTimeout(800);

// d) question opens Ask, creates nothing
await typeLine("whos on stale other than me");
results.push({ case: "question preview", chips: await chips() });
before = creates;
await box().press("Enter");
await page.waitForTimeout(6000);
const ask = (await page.getByRole("region", { name: /assistant/i }).innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
results.push({ case: "question → Ask", creates: creates - before, askPanel: ask });
await page.screenshot({ path: `${OUT}13-ask-from-toss.png` });
await page.getByRole("button", { name: /close/i }).first().click().catch(() => {});
await page.getByRole("button", { name: "Toss", exact: true }).click().catch(() => {});
await page.waitForTimeout(800);

// e) end of week asks which day
await typeLine("Send the report by end of week");
results.push({ case: "end of week", question: await question() });
await page.screenshot({ path: `${OUT}14-end-of-week.png` });
await box().fill("");
await page.waitForTimeout(800);

// f) early Enter: one request path, one Thing
before = creates; const callsBefore = interpretCalls;
await box().click();
await box().fill("Renew the shop licence");
await box().press("Enter");
await page.waitForTimeout(5000);
results.push({ case: "early Enter", creates: creates - before, interpretCalls: interpretCalls - callsBefore });

// g) gibberish is kept privately as typed
await typeLine("asdfgh jkl qwer");
results.push({ case: "gibberish preview", chips: await chips(), question: await question() });
before = creates;
await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
await page.waitForTimeout(3500);
results.push({ case: "gibberish saved", creates: creates - before });

// h) persistence and title opens the Thing
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const court = (await page.locator("main").innerText()).replace(/\s+/g, " ");
results.push({ case: "after refresh", hasMention: /Call Katalist Verify B about GST/i.test(court), hasRenew: /Renew the shop licence/i.test(court), inbox: /Inbox/.test(court) });
await page.screenshot({ path: `${OUT}15-court-after-toss.png` });

// layout: long input wraps; mic hidden
await box().fill("This is a very long line typed into the Magic Box to check that the text wraps onto several lines instead of overflowing sideways, and the Toss button stays visible at the end of it all");
await page.waitForTimeout(400);
const metrics = await box().evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth, h: el.clientHeight }));
results.push({ case: "desktop long input", wraps: metrics.scrollW <= metrics.clientW + 1 && metrics.h > 40, mic: await page.getByRole("button", { name: /voice|microphone|mic/i }).count(), tossVisible: await page.locator('button[aria-label="Toss Thing"]:visible').count() > 0 });
await page.screenshot({ path: `${OUT}16-long-input-desktop.png` });
await box().fill("");
await ctx.close();

const m = await browser.newContext({ ...devices["iPhone 13"], storageState: `${SESS}/A.state.json` });
const mp = await m.newPage();
await mp.goto(`${BASE}/`, { waitUntil: "networkidle" });
await mp.waitForTimeout(2000);
await mp.locator('textarea[aria-label="Magic Box"]:visible').fill("Katalist Verify B please send the price list and the updated dealer scheme sheet for Nalgonda before the Friday review");
await mp.waitForTimeout(3000);
const mm = await mp.locator('textarea[aria-label="Magic Box"]:visible').evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
results.push({ case: "mobile long input", wraps: mm.scrollW <= mm.clientW + 1, tossVisible: await mp.locator('button[aria-label="Toss Thing"]:visible').count() > 0 });
await mp.screenshot({ path: `${OUT}17-long-input-mobile.png` });
await m.close();
await browser.close();
console.log(JSON.stringify(results, null, 2));
