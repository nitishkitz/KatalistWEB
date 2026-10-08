import { expect, test, type Page } from "@playwright/test";

/**
 * Code Activity safe connection shell. No sample data and no GitHub, AI, or database request is made by the feature.
 *
 * Run with the preview flag ON to cover the feature, and OFF to cover the production-off guarantee:
 *   VITE_KATALIST_DEMO_MODE=true VITE_CODE_ACTIVITY_PREVIEW=true npx playwright test tests/e2e/preview/code-activity.spec.ts
 *   VITE_KATALIST_DEMO_MODE=true npx playwright test tests/e2e/preview/code-activity.spec.ts
 * (The app also needs inert Supabase placeholders locally; see the feature README.)
 */
const FLAG_ON = process.env.VITE_CODE_ACTIVITY_PREVIEW === "true";

async function signInAsDemo(page: Page): Promise<boolean> {
  await page.goto("/auth");
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  if (await demoTab.isVisible({ timeout: 1_500 }).catch(() => false)) await demoTab.click();
  const persona = page.getByRole("button", { name: /Priya Sharma/i });
  const available = await persona.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!available) return false;
  await persona.click();
  await page.waitForURL("/");
  return true;
}

async function openFirstList(page: Page) {
  await page.goto("/lists");
  await page.locator('a[href^="/lists/"]:visible').first().click();
  await expect(page.getByRole("button", { name: /^Things$/ })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `${label} has horizontal overflow`).toBe(false);
}

test.describe("preview flag OFF", () => {
  test.skip(FLAG_ON, "covered by the flag-on run");

  test("the tab is absent and no Code Activity module is requested", async ({ page }) => {
    test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
    // Only the tiny gate and boundary modules may load: the List route imports them to decide whether to show the tab.
    const allowed = /\/src\/features\/code-activity\/(use-code-activity-enabled|preview-gate|CodeActivityBoundary)\.tsx?$/;
    const featureRequests: string[] = [];
    page.on("request", (r) => {
      const url = r.url().split("?")[0];
      if (/code-activity/i.test(url) && !allowed.test(url)) featureRequests.push(url);
    });
    await openFirstList(page);
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("button", { name: /^Code Activity$/ })).toHaveCount(0);
    expect(featureRequests, "no feature component or adapter may load while it is off").toEqual([]);
    for (const name of [/^Things$/, /^Chat$/, /Members/]) await expect(page.getByRole("button", { name })).toBeVisible();
  });
});

test.describe("preview flag ON", () => {
  test.skip(!FLAG_ON, "run with VITE_CODE_ACTIVITY_PREVIEW=true");

  test("existing List tabs and the call control keep working beside the new tab", async ({ page }) => {
    test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
    await openFirstList(page);
    await expect(page.getByRole("button", { name: /^Code Activity$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Chat$/ }).click();
    await expect(page.getByRole("button", { name: "Search messages" })).toBeVisible();
    await page.getByRole("button", { name: /^Code Activity$/ }).click();
    await expect(page.locator("[data-code-activity-root]")).toBeVisible();
    await page.getByRole("button", { name: /Members/ }).click();
    await expect(page.getByText(/Permission Guide/i)).toBeVisible();
    await page.getByRole("button", { name: /^Things$/ }).click();
    await expect(page.locator("[data-code-activity-root]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Call$/ })).toBeVisible();
  });

  test("the tab is an honest not-configured state with no sample data and no outside request", async ({ page }) => {
    test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
    const outside: string[] = [];
    page.on("request", (r) => {
      if (/github|sarvam|openai|anthropic/i.test(r.url()) && !r.url().includes("/src/")) outside.push(r.url());
    });
    await openFirstList(page);
    await page.getByRole("button", { name: /^Code Activity$/ }).click();
    await expect(page.getByText("GitHub connection is not configured yet")).toBeVisible();
    await expect(page.getByText(/example-org|sample data|Connected/)).toHaveCount(0);
    await expect(page.locator("[data-change-id]")).toHaveCount(0);
    expect(outside, "the feature must not contact GitHub or an AI service").toEqual([]);
    await page.getByRole("button", { name: /^Chat$/ }).click();
    await expect(page.getByRole("button", { name: "Search messages" })).toBeVisible();
  });

  test("below 1024px the shell fits without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
    await openFirstList(page);
    await page.getByRole("button", { name: /^Code Activity$/ }).click();
    await expect(page.locator("[data-code-activity-state='not-configured']")).toBeVisible();
    await expectNoHorizontalOverflow(page, "shell at 390px");
  });
});
