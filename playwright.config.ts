import { defineConfig, devices } from "@playwright/test";

/**
 * H04/T00: local-coverage E2E scaffolding. Two project groups:
 *
 *  - "preview" projects run against a dedicated local dev server (its own
 *    isolated KATALIST_E2E_PORT, defaulting to 4173 -- distinct from the
 *    developer's own `npm run dev` on 8080 -- using whatever Supabase
 *    project .env.local already points at) and are safe by construction --
 *    every spec in tests/e2e/ is read-only / no-side-effect (page loads,
 *    static content, a malformed Bridge token's safe failure state). They
 *    need no test account.
 *
 *  - "staging" projects are for the plan's own authenticated, live-data
 *    checks (Capture->Catch->Sort, two real accounts, actual realtime
 *    reconnect, etc.) and are SKIPPED unless KATALIST_STAGING_BASE_URL,
 *    KATALIST_TEST_ACCOUNT_EMAIL and KATALIST_TEST_ACCOUNT_PASSWORD are
 *    all set -- per the plan's own instruction, staging tests require
 *    explicit test-account configuration, never production defaults, and
 *    must never run with real user data.
 */
const STAGING_CONFIGURED = Boolean(
  process.env.KATALIST_STAGING_BASE_URL &&
    process.env.KATALIST_TEST_ACCOUNT_EMAIL &&
    process.env.KATALIST_TEST_ACCOUNT_PASSWORD,
);

// T00: an isolated, configurable port (not the developer's own `npm run dev`
// port 8080) so this config's own webServer can safely use
// `reuseExistingServer: false` -- always starting its OWN fresh server
// against the current checkout, never silently reusing (and testing) an
// unrelated server a developer already has running. Deliberately does NOT
// attempt to free/kill whatever already owns a port; if KATALIST_E2E_PORT
// itself collides, Playwright's own webServer startup fails loudly instead.
const E2E_PORT = process.env.KATALIST_E2E_PORT || "4173";
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
// Stamped into the HTML report/traces so a failure's artifacts record which
// commit was actually under test (T00: "record the tested commit/build
// identifier in browser artifacts").
const TESTED_COMMIT = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tabletPortrait: { width: 768, height: 1024 },
  tabletLandscape: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
  fullHd: { width: 1920, height: 1080 },
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // T00: a freshly-started (not long-lived/warmed) local dev server's SSR
  // module compilation is a real bottleneck under this suite's default
  // worker concurrency -- confirmed directly: even after global-setup's
  // sequential warm-up, running all five viewport projects together at
  // default worker count still flaked on the same first-navigation routes
  // roughly 2 of 3 runs, while `workers: 1` passed reliably every time.
  // This suite is small/fast enough that serializing it locally costs
  // little; staging runs (a real, already-warm deployment) are unaffected.
  workers: STAGING_CONFIGURED ? undefined : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "preview-desktop",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.desktop, baseURL: E2E_BASE_URL },
    },
    {
      name: "preview-mobile",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Pixel 7"], viewport: VIEWPORTS.mobile, baseURL: E2E_BASE_URL },
    },
    {
      name: "preview-tablet-portrait",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.tabletPortrait, baseURL: E2E_BASE_URL },
    },
    {
      name: "preview-tablet-landscape",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.tabletLandscape, baseURL: E2E_BASE_URL },
    },
    {
      name: "preview-full-hd",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.fullHd, baseURL: E2E_BASE_URL },
    },
    // Staging: authenticated, live-data checks. Only registered when a real
    // test account is explicitly configured (see STAGING_CONFIGURED above);
    // an empty projects array for "staging" makes Playwright report these
    // specs as not-run rather than failing, so a missing test account never
    // fails the overall run.
    ...(STAGING_CONFIGURED
      ? [
          {
            name: "staging",
            testDir: "./tests/e2e/staging",
            use: {
              ...devices["Desktop Chrome"],
              viewport: VIEWPORTS.desktop,
              baseURL: process.env.KATALIST_STAGING_BASE_URL,
            },
          },
        ]
      : []),
  ],
  webServer: STAGING_CONFIGURED
    ? undefined
    : {
        // T00: always starts its OWN server on the isolated E2E_PORT rather
        // than reusing whatever a developer already has running on 8080 --
        // `reuseExistingServer: false` even locally, so a stale/different
        // checkout's dev server can never be silently tested instead of
        // this one. If E2E_PORT is itself already in use, this fails
        // loudly rather than killing whatever owns it.
        command: `vite dev --host 0.0.0.0 --port ${E2E_PORT}`,
        url: E2E_BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
  metadata: { testedCommit: TESTED_COMMIT },
});
