import { chromium } from "playwright";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const results = {};
for (const [k, other] of [["B", "Katalist Verify A"], ["A", "Katalist Verify B"], ["C", "Katalist Verify A"]]) {
  const ctx = await browser.newContext({ storageState: `${SESS}/${k}.state.json`, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/team?openContacts=true`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Contacts/ }).click();
  await page.waitForTimeout(1500);
  results[`${k} sees ${other} as contact`] = await dialog.getByText(other).first().isVisible().catch(() => false);
  results[`${k} Google Contacts tab`] = await dialog.getByText(/Google Contacts/i).count();
  if (k === "B") await page.screenshot({ path: `${OUT}08-connected.png` });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
