import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: `${process.argv[2]}/B.state.json`, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const frames = [];
page.on("websocket", (ws) => {
  frames.push("OPEN");
  ws.on("framesent", (f) => frames.push("> " + String(f.payload).replace(/"access_token":"[^"]+"/g, '"access_token":"…"').slice(0, 170)));
  ws.on("framereceived", (f) => frames.push("< " + String(f.payload).slice(0, 220)));
  ws.on("socketerror", (e) => frames.push("ERR " + e));
  ws.on("close", () => frames.push("CLOSE"));
});
await page.goto("https://katalist-web.vercel.app/", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
console.log(frames.slice(0, 30).join("\n"));
await browser.close();
