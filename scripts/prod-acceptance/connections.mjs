// Production acceptance: explicit connections, using the verification accounts' saved browser state.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const who = (k) => JSON.parse(readFileSync(`${SESS}/${k}.json`, "utf8"));
const results = {};
const browser = await chromium.launch();
async function open(k) {
  const ctx = await browser.newContext({ storageState: `${SESS}/${k}.state.json`, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  return { ctx, page };
}
// Supabase REST as a given user (their own token), for checks the UI cannot show.
async function rest(k, path, init = {}) {
  const s = who(k).session;
  const url = s && (await (async () => (await open(k)).page)())?.url;
  return { s, url };
}
const A = await open("A");
await A.page.goto(`${BASE}/team?openContacts=true`, { waitUntil: "networkidle" });
await A.page.waitForTimeout(1500);
const tabs = await A.page.locator("button").allInnerTexts();
results.googleContactsAbsent = !tabs.some((t) => /google/i.test(t));
await A.page.getByRole("button", { name: /^Add people$/ }).click().catch(() => {});
await A.page.fill('input[aria-label="Phone, email or Katalist link"]', who("B").phone);
await A.page.getByRole("button", { name: /^Find$/ }).click();
await A.page.waitForTimeout(2500);
const found = await A.page.locator("p.truncate.text-\\[14px\\]").first().innerText().catch(() => "");
results.foundByExactPhone = found;
await A.page.screenshot({ path: `${OUT}05-add-people-found.png` });
await A.page.getByRole("button", { name: /^Connect$/ }).first().click();
await A.page.waitForTimeout(2500);
results.requestedShown = await A.page.getByText("Requested").first().isVisible().catch(() => false);
await A.page.screenshot({ path: `${OUT}06-request-sent.png` });
// Partial name search must not list people.
await A.page.fill('input[aria-label="Phone, email or Katalist link"]', "Katalist");
await A.page.getByRole("button", { name: /^Find$/ }).click();
await A.page.waitForTimeout(2000);
results.nameSearchFindsNobody = await A.page.getByText("No Katalist account matches that exactly.").isVisible().catch(() => false);

const B = await open("B");
await B.page.goto(`${BASE}/team?openContacts=true`, { waitUntil: "networkidle" });
await B.page.waitForTimeout(1500);
await B.page.getByRole("button", { name: /^Requests/ }).click();
await B.page.waitForTimeout(1500);
results.incomingVisibleToB = await B.page.getByText("Katalist Verify A").first().isVisible().catch(() => false);
await B.page.screenshot({ path: `${OUT}07-incoming-request.png` });
await B.page.getByRole("button", { name: /^Approve$/ }).first().click();
await B.page.waitForTimeout(2500);
await B.page.getByRole("button", { name: /^Contacts/ }).click();
await B.page.waitForTimeout(1500);
results.connectedAfterAccept = await B.page.getByText("Katalist Verify A").first().isVisible().catch(() => false);
await B.page.screenshot({ path: `${OUT}08-connected.png` });
await A.ctx.close(); await B.ctx.close(); await browser.close();
console.log(JSON.stringify(results, null, 2));
