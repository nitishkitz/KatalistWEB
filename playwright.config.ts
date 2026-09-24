import { defineConfig, devices } from "@playwright/test";

/**
 * H04: local-coverage E2E scaffolding. Two project groups:
 *
 *  - "preview" projects run against the local dev server (`npm run dev`,
 *    port 8080, using whatever Supabase project .env.local already points
 *    at) and are safe by construction -- every spec in tests/e2e/ is
 *    read-only / no-side-effect (page loads, static content, a malformed
 *    Bridge token's safe failure state). They need no test account.
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

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tabletPortrait: { width: 768, height: 1024 },
  tabletLandscape: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
  fullHd: { width: 1920, height: 1080 },
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
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
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.desktop, baseURL: "http://localhost:8080" },
    },
    {
      name: "preview-mobile",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Pixel 7"], viewport: VIEWPORTS.mobile, baseURL: "http://localhost:8080" },
    },
    {
      name: "preview-tablet-portrait",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.tabletPortrait, baseURL: "http://localhost:8080" },
    },
    {
      name: "preview-tablet-landscape",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.tabletLandscape, baseURL: "http://localhost:8080" },
    },
    {
      name: "preview-full-hd",
      testDir: "./tests/e2e/preview",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.fullHd, baseURL: "http://localhost:8080" },
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
        command: "npm run dev",
        url: "http://localhost:8080",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
