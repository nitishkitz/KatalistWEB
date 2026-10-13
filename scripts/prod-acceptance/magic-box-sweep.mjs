// Thorough Magic Box sweep against production as the verification account A (Avani KTest).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const BASE = "https://katalist-web.vercel.app";
const [SESS, OUTFILE] = process.argv.slice(2);
const SHOTS = new URL("../../output/coey-production-release/screens/sweep-", import.meta.url).pathname;
const CASES = [
  // [text, mode, expect: { save: bool, question?: RegExp, chip?: RegExp, ask?: bool }]
  ["Pay the electricity bill today", "work", { save: true, chip: /You/ }],
  ["Call the bank tomorrow at 11", "work", { save: true, chip: /You.*11:00/ }],
  ["Send the GST summary EOD", "work", { save: true, chip: /6:30 pm/ }],
  ["Review the Q3 deck next Friday", "work", { save: true, chip: /Fri, 23 Oct/ }],
  ["Submit the tender on 30 October", "work", { save: true, chip: /30 Oct/ }],
  ["kal subah 10 baje dealer meeting", "work", { save: true, chip: /Wed, 14 Oct, 10:00/ }],
  ["repu sayantram stock check cheyyali", "work", { save: true, chip: /Wed, 14 Oct/ }],
  ["Urgent: fix the invoice mismatch", "work", { save: true, chip: /Now/ }],
  ["Clean the storeroom, no rush", "work", { save: true, chip: /Later/ }],
  ["Every Monday send the weekly sales report", "work", { save: true, chip: /every Monday/i }],
  ["Prepare slides before Friday's review", "work", { save: true, chip: /Fri, 16 Oct/ }],
  ["Maybe we should start a dealer loyalty scheme?", "work", { save: true, chip: /Thought/ }],
  ["The depot gate code is 4471", "work", { question: /note/i }],
  ["what's due today", "work", { ask: true }],
  ["whos waiting on me", "work", { ask: true }],
  ["asdkj qweoi zxmn", "work", { save: true, chip: /Inbox/ }],
  ["Call the CA and send the invoice to Bharat", "work", { question: /separate Things/ }],
  ["Send the audit report by end of week", "work", { question: /end of your week/ }],
  ["Call the courier at 9 am today", "work", { save: true }],
  ["Zubin send the price list", "work", { question: /can't find|find “Zubin”/i }],
  ["Bharat check the dealer stock by tomorrow", "work", { save: true, chip: /Bharat KTest/ }],
  ["Remind me to follow up with Bharat on the payment", "work", { save: true, chip: /You/ }],
  ["Urgent, Kharif plan by 30 November", "work", { question: /Urgent, or|Urgent/ }],
  ["Book movie tickets for Saturday evening", "home", { save: true }],
  ["Buy groceries today", "home", { save: true, chip: /You/ }],
  ["Breakfast with Bharat", "home", { save: true, chip: /9:00/ }],
  ["Line one of a longer note\nLine two continues the same Thing", "work", { save: true }],
  ["Renew the trade licence", "work", { save: true, earlyEnter: true }],
  ["Bharat send 40 bags DAP to Suryapet dealer kal urgent", "work", { save: true, chip: /Bharat KTest.*Now/ }],
  ["rohit get documnts", "work", { save: true }],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let creates = 0, interprets = 0;
page.on("request", (r) => { if (r.url().includes("/rpc/coey_create_things")) creates++; if (r.url().includes("/api/coey/interpret")) interprets++; });
const box = () => page.locator('textarea[aria-label="Magic Box"]:visible');
const vis = (l) => page.locator(`[aria-label="${l}"]:visible`).first();
const read = async (l) => (await vis(l).innerText({ timeout: 1200 }).catch(() => "")).replace(/\s+/g, " ").trim();
const failNote = async () => (await page.getByText("Coey couldn’t read this right now").count()) > 0;
async function setMode(mode) {
  await page.locator(`button:has-text("${mode === "home" ? "Home" : "Work"}"):visible`).first().click();
  await page.waitForTimeout(1500);
}
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
let mode = "work";
const results = [];
for (const [i, [text, wantMode, exp]] of CASES.entries()) {
  if (wantMode !== mode) { await setMode(wantMode); mode = wantMode; }
  await page.locator('button:has-text("Toss"):visible').first().click().catch(() => {});
  await box().click();
  await box().fill("");
  const before = creates, beforeI = interprets;
  if (exp.earlyEnter) {
    await box().fill(text);
    await box().press("Enter");
    await page.waitForTimeout(6000);
    results.push({ i, text, mode, saved: creates - before, interpretRequests: interprets - beforeI, earlyEnter: true });
    continue;
  }
  if (text.includes("\n")) {
    const [a, b] = text.split("\n");
    await box().type(a);
    await box().press("Shift+Enter");
    await box().type(b);
  } else {
    await box().fill(text);
  }
  await page.waitForTimeout(3000);
  const chips = await read("What Coey understood");
  const question = await read("Magic Box clarification");
  const failed = await failNote();
  await page.screenshot({ path: `${SHOTS}${String(i).padStart(2, "0")}.png` });
  let saved = 0, askOpened = false;
  if (exp.ask) {
    await box().press("Enter");
    await page.waitForTimeout(7000);
    askOpened = (await page.locator('section[aria-label="Magic Box assistant"]:visible, [aria-label="Magic Box assistant"]:visible').count()) > 0;
    saved = creates - before;
    await page.locator('button:has-text("Toss"):visible').first().click().catch(() => {});
  } else if (!question) {
    await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
    await page.waitForTimeout(3500);
    saved = creates - before;
  } else {
    // A question is pending: Toss must not save until it is answered.
    await page.locator('button[aria-label="Toss Thing"]:visible').first().click();
    await page.waitForTimeout(2500);
    saved = creates - before;
    await box().fill("");
    await page.waitForTimeout(500);
  }
  const ok =
    !failed &&
    (exp.ask ? askOpened && saved === 0 : true) &&
    (exp.question ? exp.question.test(question) && saved === 0 : true) &&
    (exp.save ? saved === 1 && !question : true) &&
    (exp.chip ? exp.chip.test(chips) : true);
  results.push({ i, text: text.replace("\n", " ⏎ "), mode, chips, question: question.slice(0, 110), saved, askOpened, failed, ok });
}
await browser.close();
writeFileSync(OUTFILE, JSON.stringify(results, null, 1));
for (const r of results) console.log(`${r.ok === false ? "FAIL" : r.earlyEnter ? "INFO" : "PASS"} [${r.mode}] ${r.text}  → ${r.earlyEnter ? `saved ${r.saved}, interpret calls ${r.interpretRequests}` : `chips: ${r.chips || "-"} | q: ${r.question || "-"} | saved ${r.saved}${r.askOpened ? " | Ask opened" : ""}${r.failed ? " | READ FAILED" : ""}`}`);
