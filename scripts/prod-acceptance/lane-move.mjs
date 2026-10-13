// Production browser: drag a Thing someone sent me from Next to Later (spec §8.4 promise),
// then check Reassign lists only connections. Verification account only.
import { chromium } from "playwright";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${SESS}/B.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const lane = (id) => page.locator(`section[aria-labelledby="court-${id}-title"]:visible`);
const card = lane("next").locator("button[draggable=true]").first();
const title = (await card.innerText()).split("\n").find((l) => l.trim().length > 3);
console.log("next lane cards:", await lane("next").locator("button[draggable=true]").count(), "later:", await lane("later").locator("button[draggable=true]").count());
await card.dragTo(lane("later"));
await page.waitForTimeout(1500);
const dialog = page.getByRole("dialog");
console.log("dialog:", (await dialog.innerText().catch(() => "(none)")).replace(/\s+/g, " ").slice(0, 300));
await page.screenshot({ path: `${OUT}60-lane-move-promise.png` });
await dialog.getByRole("button", { name: "Promise this date" }).click();
await page.waitForTimeout(4000);
console.log("toast:", (await page.locator("[data-sonner-toast]").allInnerTexts()).join(" | ").replace(/\s+/g, " "));
const laterText = (await lane("later").innerText()).replace(/\s+/g, " ");
console.log("moved card title:", title, "→ in Later:", laterText.includes(title.trim()));
await page.screenshot({ path: `${OUT}61-lane-move-after.png` });
// Reassign list
await lane("later").locator("button[draggable=true]").first().click();
await page.waitForTimeout(2500);
const reassign = page.getByRole("button", { name: /Reassign/ }).first();
if (await reassign.isEnabled().catch(() => false)) {
  await reassign.click();
  await page.waitForTimeout(800);
  console.log("reassign options:", (await page.getByRole("menuitem").allInnerTexts()).join(", "));
  await page.screenshot({ path: `${OUT}62-reassign-connections.png` });
} else console.log("reassign: disabled for this Thing");
await browser.close();
