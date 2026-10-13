import { chromium } from "playwright";
const [SESS, FILE] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } })).newPage();
await page.goto("https://katalist-web.vercel.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const input = page.locator('input[type="file"]').nth(0);
await input.setInputFiles(FILE);
for (const ms of [50, 300, 1000, 3000]) {
  await page.waitForTimeout(ms);
  console.log(ms, JSON.stringify({ checking: await page.getByText("Checking file").count(), failed: await page.getByText("Failed", { exact: true }).count(), chip: await page.locator('[aria-label^="Remove ktest"]').count(), ta: await page.locator('textarea[aria-label="Magic Box"]').nth(0).inputValue(), ta2: await page.locator('textarea[aria-label="Magic Box"]').nth(1).inputValue() }));
}
await browser.close();
