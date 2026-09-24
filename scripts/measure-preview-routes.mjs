import { chromium } from "playwright";

/**
 * Read-only local browser measurements for demo/preview data. The caller must
 * start the current checkout with VITE_KATALIST_DEMO_MODE=true on an isolated
 * local port. Never points a scripted demo sign-in at a remote deployment.
 * Output is JSON-lines so it can be saved with the tested commit and dataset.
 */
const base = new URL(process.env.KATALIST_PREVIEW_BASE_URL ?? "http://localhost:4174");
if (!["localhost", "127.0.0.1"].includes(base.hostname) || base.protocol !== "http:") {
  throw new Error("Preview measurement accepts only a local HTTP server.");
}
const browser = await chromium.launch({ headless: true });
try {
  const bootstrap = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const signIn = await bootstrap.newPage();
  await signIn.goto(new URL("/auth", base).href);
  await signIn.getByRole("button", { name: /Demo/ }).first().click();
  await signIn.getByRole("button", { name: /Priya Sharma/ }).click();
  await signIn.waitForURL(new URL("/", base).href);
  const state = await bootstrap.storageState();
  await bootstrap.close();

  console.log(JSON.stringify({ kind: "metadata", commit: process.env.GITHUB_SHA ?? "local-head",
    mode: "local-demo", build: process.env.KATALIST_PREVIEW_BUILD_MODE ?? "development",
    browser: "chromium", viewport: "1440x900", sampleCountPerRoute: 1,
    note: "local demo only; not staging latency or representative dataset" }));
  for (const route of ["/", "/lists", "/buckets", "/team"]) {
    const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    for (const cache of ["cold", "warm"]) {
      let backendRequests = 0;
      let backendFailures = 0;
      const onResponse = (response) => {
        if (new URL(response.url()).pathname.startsWith("/rest/v1/")) {
          backendRequests++;
          if (!response.ok()) backendFailures++;
        }
      };
      page.on("response", onResponse);
      const started = performance.now();
      const response = await page.goto(new URL(route, base).href, { waitUntil: "networkidle" });
      const elapsedMs = Math.round(performance.now() - started);
      page.off("response", onResponse);
      console.log(JSON.stringify({ kind: "route", route, cache, httpStatus: response?.status(),
        elapsedMs, backendRequests, backendFailures }));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
