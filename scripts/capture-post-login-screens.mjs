import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.KATALIST_CAPTURE_BASE_URL || "http://localhost:4175";
const outputDir = path.resolve(process.env.KATALIST_CAPTURE_DIR || "output/app-screenshots-2026-10-05");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const captures = [];
let sequence = 1;

const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
async function capture(name, note) {
  const file = `${String(sequence++).padStart(2, "0")}-${slug(name)}.png`;
  await page.screenshot({ path: path.join(outputDir, file), fullPage: true, animations: "disabled" });
  captures.push({ file, url: page.url(), note });
}

async function clickAndCapture(locator, name, note, { close = true } = {}) {
  if (!(await locator.first().isVisible().catch(() => false))) return false;
  await locator.first().click();
  await page.waitForTimeout(350);
  await capture(name, note);
  if (close) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  return true;
}

await fs.mkdir(outputDir, { recursive: true });
for (const file of await fs.readdir(outputDir)) {
  if (file.endsWith(".png")) await fs.unlink(path.join(outputDir, file));
}
await page.goto(`${baseURL}/auth`);
await page.getByRole("button", { name: "Use phone or email" }).click();
await page.waitForTimeout(350);
await capture("login", "Phone and email login screen (onboarding and splash intentionally excluded)");
await page.goto(`${baseURL}/auth`);
await page.getByRole("button", { name: /Priya Sharma/ }).click();
await page.waitForURL(`${baseURL}/`);
await page.waitForTimeout(1200);

await capture("court-overview", "Court main screen after login");
await clickAndCapture(page.getByRole("button", { name: /^Due$/ }), "court-filter-due", "Court Due filter selected", { close: false });
await page.getByRole("button", { name: /^All$/ }).click();
await clickAndCapture(page.getByRole("button", { name: /Sort Court/ }), "court-sort-options", "Court sort menu");
await clickAndCapture(page.getByRole("button", { name: "Filter Court" }), "court-filter-options", "Court filter panel");
const courtCard = page.locator('main button[aria-label^="Open "]:visible').first();
if (await courtCard.isVisible().catch(() => false)) {
  await courtCard.click();
  await page.waitForTimeout(350);
  const imageAttachment = page.getByText("Release-flow.svg", { exact: true });
  if (await imageAttachment.isVisible().catch(() => false)) {
    await imageAttachment.click();
    await page.waitForTimeout(900);
  }
  await capture("court-thing-detail", "Court Thing detail with owner, assignee, status, description, and file previews");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}
await clickAndCapture(page.getByRole("button", { name: /Notifications/ }), "notifications-popover", "Notification popover");
await clickAndCapture(page.getByRole("button", { name: /Catch Up/ }), "catch-up-panel", "Catch Up panel");
await clickAndCapture(page.getByRole("button", { name: "Chats and activity" }), "court-chats-activity", "Chats and activity panel");
await page.getByRole("button", { name: "Home" }).click();
await page.waitForTimeout(500);
await capture("court-home-context", "Court in Home context");
await page.getByRole("button", { name: "Work" }).click();

for (const route of ["lists", "buckets", "team", "nudges", "me"]) {
  await page.goto(`${baseURL}/${route}`);
  await page.waitForTimeout(900);
  await capture(`${route}-overview`, `${route[0].toUpperCase()}${route.slice(1)} main screen`);
}

await page.goto(`${baseURL}/lists`);
await page.waitForTimeout(700);
await clickAndCapture(page.getByRole("button", { name: /Create|New list|Add list/i }), "lists-create-dialog", "Create-list dialog");
const listLink = page.locator('a[href^="/lists/"]').first();
if (await listLink.isVisible().catch(() => false)) {
  await page.goto(`${baseURL}/lists/l1`);
  await page.waitForTimeout(700);
  await capture("list-detail-overview", "First list detail screen");
  for (const label of [/Overview/i, /Things/i, /Chat/i, /Files/i, /Members/i]) {
    const control = page.getByRole("button", { name: label }).or(page.getByRole("tab", { name: label }));
    if (await control.first().isVisible().catch(() => false)) {
      await control.first().click();
      await page.waitForTimeout(300);
      await capture(`list-detail-${String(label).replace(/\W/g, "").toLowerCase()}`, `List detail ${label} option`);
    }
  }
}

await page.goto(`${baseURL}/buckets`);
await page.waitForTimeout(700);
const bucketDialogCaptured = await clickAndCapture(page.getByRole("button", { name: /Create|New bucket|Add bucket/i }), "buckets-create-dialog", "Create-bucket dialog");
if (bucketDialogCaptured) {
  await page.goto(`${baseURL}/buckets`);
  await page.waitForTimeout(500);
}
const bucketLink = page.locator('a[href^="/buckets/"]').first();
if (await bucketLink.isVisible().catch(() => false)) {
  await bucketLink.click();
  await page.waitForTimeout(700);
  await capture("bucket-detail-overview", "First bucket detail screen");
}

await page.goto(`${baseURL}/team`);
await page.waitForTimeout(700);
for (const label of [/Contacts/i, /Start call/i, /New conversation/i]) {
  await clickAndCapture(page.getByRole("button", { name: label }), `team-${label.source.replace(/\W/g, "").toLowerCase()}`, `Team ${label.source} option`);
}
const conversation = page.locator('a[href^="/team/"]').first();
if (await conversation.isVisible().catch(() => false)) {
  await conversation.click();
  await page.waitForTimeout(700);
  await capture("team-conversation", "First team conversation");
}

await page.goto(`${baseURL}/me`);
await page.waitForTimeout(700);
for (const label of [/Edit profile/i, /Devices/i, /Theme/i, /Settings/i]) {
  await clickAndCapture(page.getByRole("button", { name: label }), `me-${label.source.replace(/\W/g, "").toLowerCase()}`, `Me ${label.source} option`);
}

const manifest = [
  "# Katalist post-login screenshots",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Viewport: 1440 × 900`,
  `Session: isolated Demo Persona (Priya Sharma)`,
  "",
  ...captures.map((entry, index) => `${index + 1}. [${entry.file}](./${entry.file}) — ${entry.note} — \`${entry.url}\``),
  "",
  "Destructive, sign-out, upload, send, nudge, delete, and other data-changing actions were intentionally excluded.",
].join("\n");
await fs.writeFile(path.join(outputDir, "README.md"), manifest);
await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(captures, null, 2));
await browser.close();
console.log(`Captured ${captures.length} screens in ${outputDir}`);
