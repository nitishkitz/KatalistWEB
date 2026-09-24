import type { FullConfig } from "@playwright/test";

/**
 * T00: Vite's dev server compiles each route's SSR modules on demand, on
 * FIRST request -- when several parallel workers hit different brand-new
 * routes the instant the freshly-started server reports "ready" (it only
 * warmed up whatever it took to answer that readiness probe), that
 * concurrent cold-compile contention makes some of those first requests
 * time out or return before hydration finishes. Confirmed directly:
 * `--workers=1` (no concurrent first-hits) passed reliably every time;
 * default parallel workers against a freshly-started server flaked on
 * exactly the routes hit concurrently for the first time. Sequentially
 * warming each route once, here, before any real worker starts, removes
 * the race instead of just hiding it behind `workers: 1` for every run.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const project = config.projects.find((p) => p.use?.baseURL);
  const baseURL = project?.use?.baseURL;
  if (!baseURL) return; // staging-only runs, or no local webServer configured

  const routes = ["/auth", "/welcome", "/bridge/too-short"];
  for (const route of routes) {
    try {
      await fetch(new URL(route, baseURL));
    } catch {
      // The real test run will surface a startup failure clearly; this
      // warm-up is a best-effort optimization, not a correctness gate.
    }
  }
}
