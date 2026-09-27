import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * T08 browser verification: real screenshots and computed-style
 * measurements at the selected desktop/tablet viewports, using local demo/preview
 * data (never a remote deployment or real account). The caller must start
 * the current checkout with VITE_KATALIST_DEMO_MODE=true on an isolated
 * local port (matching scripts/measure-preview-routes.mjs's own
 * convention). Read-only: signs in as the built-in demo persona, no writes.
 */
const base = new URL(process.env.KATALIST_PREVIEW_BASE_URL ?? "http://localhost:4175");
if (!["localhost", "127.0.0.1"].includes(base.hostname) || base.protocol !== "http:") {
  throw new Error("Browser verification accepts only a local HTTP server.");
}

const OUT_DIR = process.env.KATALIST_T08_OUTPUT_DIR ?? new URL("../output/t08-browser-verification", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

const ALL_VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024 },
  { name: "tablet-landscape-1024x768", width: 1024, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "fullhd-1920x1080", width: 1920, height: 1080 },
];
const SKIP_NARROW_VIEWPORTS = process.env.KATALIST_SKIP_NARROW_VIEWPORTS === "true";
const INCLUDE_PHONE_VIEWPORT = process.env.KATALIST_INCLUDE_PHONE_VIEWPORT === "true";
const VIEWPORTS = SKIP_NARROW_VIEWPORTS
  ? ALL_VIEWPORTS.filter(({ width }) => width >= 1024)
  : INCLUDE_PHONE_VIEWPORT
    ? ALL_VIEWPORTS
    : ALL_VIEWPORTS.filter(({ name }) => name !== "mobile-390x844");

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

/** Checks visible native/ARIA controls against the plan's desktop/touch target floors. */
async function findTinyHitTargets(page, minimumPx) {
  return page.evaluate((floor) => {
    const offenders = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < floor || rect.height < floor) {
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
  }, minimumPx);
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
    await page.addInitScript(() => {
      const metrics = { lcpMs: null, cls: 0, longTaskCount: 0, longTasksOver50ms: 0 };
      Object.defineProperty(window, "__katalistPerfMetrics", { value: metrics, configurable: false });
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) metrics.lcpMs = Math.round(entry.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) metrics.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            metrics.longTaskCount += 1;
            if (entry.duration > 50) metrics.longTasksOver50ms += 1;
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // Keep unsupported browser APIs explicitly null/zero in the report.
      }
    });
    const consoleErrors = [];
    const isolatedFixtureConnectionErrors = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const message = msg.text();
      if (message.includes("ci-fixture.supabase.co")) isolatedFixtureConnectionErrors.push(message);
      else consoleErrors.push(message);
    });

    for (const route of ROUTES) {
      consoleErrors.length = 0;
      isolatedFixtureConnectionErrors.length = 0;
      const navigationStartedAt = performance.now();
      const response = await page.goto(new URL(route.path, base).href, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const browserMetrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const observed = window.__katalistPerfMetrics;
        const memory = performance.memory;
        return {
          documentNavigationMs: navigation ? Math.round(navigation.duration) : null,
          largestContentfulPaintMs: observed?.lcpMs ?? null,
          cumulativeLayoutShift: observed ? Math.round(observed.cls * 1000) / 1000 : null,
          longTaskCount: observed?.longTaskCount ?? null,
          longTasksOver50ms: observed?.longTasksOver50ms ?? null,
          usedJsHeapBytes: typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null,
        };
      });
      const shotPath = `${OUT_DIR}/${viewport.name}__${route.name}.png`;
      await page.screenshot({ path: shotPath, fullPage: false });
      const subFloorText = await findSubFloorText(page);
      // All measured contexts use non-touch desktop Chromium, including
      // tablet portrait and landscape when selected for desktop/tablet scope.
      const hitTargetFloorPx = 32;
      const tinyTargets = await findTinyHitTargets(page, hitTargetFloorPx);
      log({
        kind: "route",
        viewport: viewport.name,
        route: route.name,
        httpStatus: response?.status(),
        navigationElapsedMs: Math.round(performance.now() - navigationStartedAt),
        browserMetrics,
        consoleErrors: [...consoleErrors],
        isolatedFixtureConnectionErrors: [...isolatedFixtureConnectionErrors],
        subFloorTextCount: subFloorText.length,
        subFloorTextSample: subFloorText.slice(0, 10),
        hitTargetFloorPx,
        tinyHitTargetCount: tinyTargets.length,
        tinyHitTargetSample: tinyTargets.slice(0, 10),
        screenshot: shotPath,
      });
    }
    await context.close();
  }

  // T15/V-03: measure real, warm SPA navigations against the production-mode
  // local preview. Prime each route once, then collect 20 user-driven link
  // navigations without reloading the document so React Query's in-memory
  // cache remains available. This is a local fixture result, not a staging
  // latency claim.
  {
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const routes = [
      { path: "/lists", label: "Lists" },
      { path: "/buckets", label: "Buckets" },
      { path: "/team", label: "Team" },
      { path: "/me", label: "Me" },
      { path: "/", label: "Court" },
    ];
    await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
    const navigate = async (route) => {
      const startedAt = performance.now();
      const link = page.locator(`nav a[href="${route.path}"]:visible`).first();
      await link.click();
      await page.waitForURL((url) => url.pathname === route.path);
      await page.locator("main").first().waitFor({ state: "visible" });
      return Math.round(performance.now() - startedAt);
    };
    for (const route of routes) await navigate(route);
    const samples = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const route of routes) samples.push({ route: route.path, durationMs: await navigate(route) });
    }
    const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1];
    log({
      kind: "warm-spa-navigation-performance",
      fixture: "local-demo-preview",
      viewport: "desktop-1440x900",
      sampleCount: samples.length,
      targetP75Ms: 300,
      p75Ms: p75,
      passed: p75 <= 300,
      samples,
    });
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

const report = {
  metadata: {
    capturedAt: new Date().toISOString(),
    testedCommit: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "working-tree",
    mode: process.env.KATALIST_PERF_FIXTURE ?? "local-demo-preview",
    browser: "Chromium (Playwright)",
    referenceDevice: "current developer machine; not a reference-device claim",
    viewportSet: VIEWPORTS.map(({ name }) => name),
    excludedViewportSet: ALL_VIEWPORTS.filter((viewport) => !VIEWPORTS.includes(viewport)).map(({ name }) => name),
  },
  results,
};
writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(report, null, 2));
console.log(`\nWrote ${results.length} result entries and screenshots to ${OUT_DIR}`);
