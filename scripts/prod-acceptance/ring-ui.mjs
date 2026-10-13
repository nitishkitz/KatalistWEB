import { chromium } from "playwright";
import { signIn, rpc } from "./api-lib.mjs";
const BASE = "https://katalist-web.vercel.app";
const SESS = process.argv[2];
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const A = await signIn("A"), B = await signIn("B");
const dm = (await rpc(A, "get_or_create_dm", { p_other_profile_id: B.id, p_context: "work" })).body;
const dmId = Array.isArray(dm) ? dm[0].id : dm.id;
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const ctxB = await browser.newContext({ storageState: `${SESS}/B.state.json`, viewport: { width: 1440, height: 900 }, permissions: ["microphone", "camera"] });
const pageB = await ctxB.newPage();
const wsLog = [];
pageB.on("console", (m) => { if (/ring|call|realtime|channel/i.test(m.text())) wsLog.push(`console ${m.type()}: ${m.text().slice(0, 160)}`); });
pageB.on("websocket", (ws) => {
  ws.on("framesent", (f) => { const t = String(f.payload); if (/call-rings|phx_join/.test(t)) wsLog.push(`sent ${t.slice(0, 220)}`); });
  ws.on("framereceived", (f) => { const t = String(f.payload); if (/call-rings|call_rings|phx_reply|postgres_changes|system/.test(t)) wsLog.push(`recv ${t.replace(/"access_token":"[^"]+"/, '"access_token":"…"').slice(0, 260)}`); });
});
await pageB.goto(`${BASE}/`, { waitUntil: "networkidle" });
await pageB.waitForTimeout(4000); // Realtime subscription settles
const ctxA = await browser.newContext({ storageState: `${SESS}/A.state.json`, viewport: { width: 1440, height: 900 }, permissions: ["microphone", "camera"] });
const pageA = await ctxA.newPage();
await pageA.goto(`${BASE}/team/${dmId}`, { waitUntil: "networkidle" });
await pageA.waitForTimeout(2500);
const t0 = Date.now();
await pageA.locator('button[aria-label="Audio call"]:visible').first().click();
await pageA.waitForTimeout(1500);
const start = pageA.getByRole("button", { name: /^(Start call|Call|Ring|Start)$/i });
if (await start.count()) await start.first().click();
let shown = false;
try { await pageB.locator('button[aria-label="Dismiss incoming call"]').waitFor({ state: "visible", timeout: 20000 }); shown = true; } catch {}
const card = shown ? (await pageB.locator('button[aria-label="Dismiss incoming call"]').locator("xpath=ancestor::div[1]/..").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160) : "";
await pageB.screenshot({ path: `${OUT}30-incoming-call-B.png` });
await pageA.screenshot({ path: `${OUT}31-calling-A.png` });
console.log(wsLog.filter((l) => /call-rings|call_rings/.test(l)).slice(0, 12).join("\n"));
console.log(JSON.stringify({ ringShownToB: shown, secondsToRing: shown ? ((Date.now() - t0) / 1000).toFixed(1) : null, card }));
if (shown) await pageB.locator('button[aria-label="Dismiss incoming call"]').click();
await browser.close();
