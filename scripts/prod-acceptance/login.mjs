// Production acceptance: mobile sign-in for clearly labelled verification accounts.
// Writes sessions (tokens) only to the scratchpad given as argv[2]; never prints codes or tokens.
import { chromium, devices } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = "https://katalist-web.vercel.app";
const OUT = new URL("../../output/coey-production-release/screens/", import.meta.url).pathname;
const SESS = process.argv[2];
mkdirSync(SESS, { recursive: true });
const PEOPLE = [
  { key: "A", digits: "9000000101", name: "Katalist Verify A", mobile: false },
  { key: "B", digits: "9000000102", name: "Katalist Verify B", mobile: true },
  { key: "C", digits: "9000000103", name: "Katalist Verify C", mobile: false },
];
const results = [];
const browser = await chromium.launch();
for (const p of PEOPLE) {
  const ctx = await browser.newContext(p.mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const r = { person: p.key };
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.fill("#kg-tel", p.digits);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#kg-otp", { timeout: 20000 });
  const hint = await page.locator("#kg-test-otp").innerText();
  r.codeShownBeneathField = /Temporary sign-in code: \d{6}/.test(hint) && /No SMS sent/.test(hint);
  const order = await page.evaluate(() => {
    const otp = document.querySelector("#kg-otp"), hint = document.querySelector("#kg-test-otp");
    return otp && hint ? Boolean(otp.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  r.hintAfterField = order;
  r.autofilled = (await page.inputValue("#kg-otp")) !== "";
  const code = hint.match(/(\d{6})/)[1];
  if (p.key === "A") await page.screenshot({ path: `${OUT}01-login-code-shown.png` });
  // Wrong code first.
  const wrong = code === "000000" ? "111111" : "000000";
  await page.fill("#kg-otp", wrong);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  r.wrongCodeRejected = /did not match/i.test(await page.locator("#kg-code-note").innerText().catch(() => "")) && page.url().includes("/auth");
  if (p.key === "A") await page.screenshot({ path: `${OUT}02-login-wrong-code.png` });
  await page.fill("#kg-otp", code);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#kg-profile-name", { timeout: 30000 });
  r.profileStepShown = true;
  r.emailOptional = !(await page.locator("#kg-profile-email").getAttribute("required"));
  await page.fill("#kg-profile-name", p.name);
  if (p.key === "A") await page.screenshot({ path: `${OUT}03-profile-setup.png` });
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth") && !u.pathname.startsWith("/onboarding"), { timeout: 30000 }).catch(() => {});
  if (page.url().includes("/onboarding")) { await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); }
  await page.waitForTimeout(2500);
  r.landedOn = new URL(page.url()).pathname;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  r.afterRefresh = new URL(page.url()).pathname;
  const session = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
  r.sessionUser = session?.user?.id ?? null;
  r.phoneConfirmed = Boolean(session?.user?.phone_confirmed_at);
  writeFileSync(`${SESS}/${p.key}.json`, JSON.stringify({ name: p.name, phone: `+91${p.digits}`, code, session }));
  await page.screenshot({ path: `${OUT}04-court-${p.key}${p.mobile ? "-mobile" : ""}.png` });
  await ctx.storageState({ path: `${SESS}/${p.key}.state.json` });
  await ctx.close();
  results.push(r);
}
// Return login: a fresh browser signs A in again and goes straight to Court with the same account.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle" });
  await page.fill("#kg-tel", PEOPLE[0].digits);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#kg-otp");
  const code = (await page.locator("#kg-test-otp").innerText()).match(/(\d{6})/)[1];
  await page.fill("#kg-otp", code);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const session = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
  results.push({ person: "A-return", landedOn: new URL(page.url()).pathname, sameUser: session?.user?.id === results[0].sessionUser, profileStepSkipped: !(await page.locator("#kg-profile-name").count()) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
