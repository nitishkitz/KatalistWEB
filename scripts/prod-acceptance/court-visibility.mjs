import { chromium } from "playwright";
const SESS = process.argv[2];
const browser = await chromium.launch();
const page = await (await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } })).newPage();
const titles = { work: ["Pay the electricity bill", "Call the bank", "Send the GST summary", "Review the Q3 deck", "dealer meeting", "stock check", "fix the invoice mismatch", "Clean the storeroom", "weekly sales report", "Prepare slides", "Renew the trade licence", "follow up with Bharat"], home: ["Book movie tickets", "Buy groceries", "Breakfast with Bharat"] };
const out = {};
for (const mode of ["work", "home"]) {
  await page.goto("https://katalist-web.vercel.app/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.locator(`button:has-text("${mode === "home" ? "Home" : "Work"}"):visible`).first().click();
  await page.waitForTimeout(3500);
  const lanes = {};
  for (const lane of ["NOW", "NEXT", "LATER"]) {
    const head = page.locator(`text=/^${lane}\\s*\\d+/`).first();
    lanes[lane] = (await head.innerText().catch(() => "")).replace(/\s+/g, " ");
  }
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  // Lanes show a stack; open each lane's "view all" isn't needed: search the Court for each title.
  const missing = [];
  for (const t of titles[mode]) {
    await page.locator('input[placeholder="Search Court"]:visible').fill(t);
    await page.waitForTimeout(900);
    const found = (await page.locator("main").innerText()).toLowerCase().includes(t.toLowerCase());
    if (!found) missing.push(t);
  }
  await page.locator('input[placeholder="Search Court"]:visible').fill("");
  await page.screenshot({ path: new URL(`../../output/coey-production-release/screens/60-court-${mode}.png`, import.meta.url).pathname });
  out[mode] = { lanes, missing };
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
