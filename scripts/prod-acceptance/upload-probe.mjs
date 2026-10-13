import { chromium } from "playwright";
const SESS = process.argv[2], FILE = process.argv[3];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const fails = [];
page.on("response", async (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.slice(0, 90)} ${(await r.text().catch(() => "")).slice(0, 200)}`); });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") fails.push(`console ${m.type()}: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => fails.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("requestfailed", (r) => fails.push(`FAILED ${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname.slice(0, 80)} ${r.failure()?.errorText}`));
await page.goto("https://katalist-web.vercel.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.locator('button[aria-label*="ttach" i]:visible, button:has(svg.lucide-paperclip):visible').first().click(),
]);
await chooser.setFiles(FILE);
await page.waitForTimeout(6000);
fails.push("chips after attach: " + (await page.locator('[aria-label*="ttach" i]:visible, [data-testid*="attach" i]:visible').allInnerTexts()).join(" | ").slice(0, 200));
fails.push("composer text: " + (await page.locator('form:has(textarea[aria-label="Magic Box"]):visible, div:has(> textarea[aria-label="Magic Box"]):visible').first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
await page.locator('textarea[aria-label="Magic Box"]:visible').fill("KTest attachment check");
await page.waitForTimeout(3000);
await page.locator('button[aria-label="Toss Thing"]:visible').first().click().catch((e) => fails.push("toss click " + e.message.slice(0, 80)));
await page.waitForTimeout(6000);
const chipText = (await page.locator("body").innerText()).match(/ktest-upload[^\n]*|Couldn[^\n]*|failed[^\n]*/gi);
await page.screenshot({ path: `${OUT}50-upload-probe.png` });
console.log(JSON.stringify({ fails, chipText }, null, 1));
await browser.close();
