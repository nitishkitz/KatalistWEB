import { chromium } from "playwright";
const [SESS, ...FILES] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text().slice(0, 160)); });
await page.goto("https://katalist-web.vercel.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
for (const f of FILES) {
  for (const idx of [0, 1]) {
    const input = page.locator('input[type="file"]').nth(idx);
    await input.evaluate((n) => { window.__c = 0; n.addEventListener("change", () => { window.__c++; }); });
    await input.setInputFiles(f);
    await page.waitForTimeout(3000);
    console.log(f.split("/").pop(), "input", idx, "change", await page.evaluate(() => window.__c), "chips", await page.getByText(/ktest-(upload|image)/).count(), "textarea", JSON.stringify(await page.locator('textarea[aria-label="Magic Box"]:visible').inputValue()));
  }
}
console.log("errors", JSON.stringify(errs.slice(0, 5)));
await browser.close();
