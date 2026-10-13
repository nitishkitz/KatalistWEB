import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto("https://katalist-web.vercel.app/api/version");
const res = await page.evaluate(async ([url, key]) => new Promise((resolve) => {
  const ws = new WebSocket(`${url.replace("https", "wss")}/realtime/v1/websocket?apikey=${key}&vsn=2.0.0`);
  const t0 = Date.now();
  ws.onopen = () => { ws.send(JSON.stringify(["1", "1", "realtime:probe", "phx_join", { config: {} }])); };
  ws.onmessage = (m) => { resolve({ opened: true, firstMessage: String(m.data).slice(0, 200), ms: Date.now() - t0 }); ws.close(); };
  ws.onclose = (e) => resolve({ closed: true, code: e.code, reason: e.reason, ms: Date.now() - t0 });
  setTimeout(() => resolve({ timeout: true, readyState: ws.readyState }), 15000);
}), [env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY]);
console.log(JSON.stringify(res));
await browser.close();
