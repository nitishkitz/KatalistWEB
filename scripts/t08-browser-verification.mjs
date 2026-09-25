import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * T08 browser verification: real screenshots and computed-style
 * measurements at the plan's required viewports, using local demo/preview
 * data (never a remote deployment or real account). The caller must start
 * the current checkout with VITE_KATALIST_DEMO_MODE=true on an isolated
 * local port (matching scripts/measure-preview-routes.mjs's own
 * convention). Read-only: signs in as the built-in demo persona, no writes.
 */
const base = new URL(process.env.KATALIST_PREVIEW_BASE_URL ?? "http://localhost:4175");
if (!["localhost", "127.0.0.1"].includes(base.hostname) || base.protocol !== "http:") {
  throw new Error("Browser verification accepts only a local HTTP server.");
}

const OUT_DIR = new URL("../output/t08-browser-verification", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "tablet-landscape-1024x768", width: 1024, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "fullhd-1920x1080", width: 1920, height: 1080 },
];

const results = [];

function log(entry) {
  results.push(entry);
  console.log(JSON.stringify(entry));
}

/** Walks every visible text node's computed font-size; flags anything below 12px. */
async function findSubFloorText(page) {
  return page.evaluate(() => {
    const offenders = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      if (fontSize < 12) {
        offenders.push({
          text: node.textContent.trim().slice(0, 40),
          fontSize,
          tag: el.tagName,
          className: el.className?.toString().slice(0, 120),
        });
      }
    }
    // Dedupe identical (tag, className, fontSize) triples -- repeated list rows.
    const seen = new Set();
    return offenders.filter((o) => {
      const key = `${o.tag}|${o.className}|${o.fontSize}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/** Checks every visible native <button>/<a> for a computed hit area >= 24x24px. */
async function findTinyHitTargets(page) {
  return page.evaluate(() => {
    const offenders = [];
    for (const el of document.querySelectorAll("button, a[href]")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 24 || rect.height < 24) {
        offenders.push({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 40) || el.getAttribute("aria-label") || "(no accessible text)",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    const seen = new Set();
    return offenders.filter((o) => {
      const key = `${o.tag}|${o.text}|${o.width}x${o.height}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

const browser = await chromium.launch({ headless: true });
try {
  // Sign in once at desktop size, reuse the resulting storage state.
  const bootstrap = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const signIn = await bootstrap.newPage();
  await signIn.goto(new URL("/auth", base).href);
  await signIn.getByRole("button", { name: /Demo/ }).first().click();
  await signIn.getByRole("button", { name: /Priya Sharma/ }).click();
  await signIn.waitForURL(new URL("/", base).href);
  const state = await bootstrap.storageState();
  await bootstrap.close();

  const ROUTES = [
    { name: "court", path: "/" },
    { name: "lists-index", path: "/lists" },
    { name: "buckets-index", path: "/buckets" },
    { name: "team-hub", path: "/team" },
    { name: "me", path: "/me" },
  ];

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ storageState: state, viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    for (const route of ROUTES) {
      consoleErrors.length = 0;
      const response = await page.goto(new URL(route.path, base).href, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const shotPath = `${OUT_DIR}/${viewport.name}__${route.name}.png`;
      await page.screenshot({ path: shotPath, fullPage: false });
      const subFloorText = await findSubFloorText(page);
      const tinyTargets = await findTinyHitTargets(page);
      log({
        kind: "route",
        viewport: viewport.name,
        route: route.name,
        httpStatus: response?.status(),
        consoleErrors: [...consoleErrors],
        subFloorTextCount: subFloorText.length,
        subFloorTextSample: subFloorText.slice(0, 10),
        tinyHitTargetCount: tinyTargets.length,
        tinyHitTargetSample: tinyTargets.slice(0, 10),
        screenshot: shotPath,
      });
    }
    await context.close();
  }

  // 200% zoom check on Court at desktop viewport (Chromium's non-standard
  // `zoom` CSS property approximates browser-level zoom well enough for a
  // layout/overflow check).
  {
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page.waitForTimeout(300);
    const shotPath = `${OUT_DIR}/zoom-200pct__court.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4,
    );
    log({ kind: "zoom-200", route: "court", hasHorizontalOverflow, screenshot: shotPath });
    await context.close();
  }

  // Reduced motion + keyboard focus-visible check on Court.
  {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focusVisible = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { found: false };
      const style = getComputedStyle(el);
      return {
        found: true,
        tag: el.tagName,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });
    const shotPath = `${OUT_DIR}/reduced-motion-keyboard-focus__court.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    log({ kind: "reduced-motion-focus", route: "court", focusVisible, screenshot: shotPath });
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${results.length} result entries and screenshots to ${OUT_DIR}`);
