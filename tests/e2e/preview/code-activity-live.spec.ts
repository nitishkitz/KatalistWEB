import { expect, test } from "@playwright/test";

/**
 * Code Activity LIVE acceptance in a real browser. WRITTEN BUT NEVER RUN: it needs an environment that does not exist
 * yet (an applied schema, a configured GitHub App, an allowlisted List and a saved signed-in session).
 *
 *   CODE_ACTIVITY_LIVE_E2E=true \
 *   CODE_ACTIVITY_E2E_STORAGE=/path/to/signed-in-storage-state.json \
 *   CODE_ACTIVITY_E2E_LIST_URL=http://localhost:8080/lists/<allowlisted-list-id> \
 *   npx playwright test tests/e2e/preview/code-activity-live.spec.ts
 *
 * NOTE: this spec targets the previous click-open overlay view, which is used when VITE_CODE_ACTIVITY_WORKSPACE=false.
 * The default view is the workspace; see code-activity-workspace.spec.ts.
 *
 * The List must already be connected to a test repository and refreshed once. These checks cover what the jsdom flow tests
 * cannot: focus return, the mobile full-screen overlay, horizontal overflow, and keyboard operation.
 */
const ENABLED = process.env.CODE_ACTIVITY_LIVE_E2E === "true";
const STORAGE = process.env.CODE_ACTIVITY_E2E_STORAGE;
const LIST_URL = process.env.CODE_ACTIVITY_E2E_LIST_URL;

test.describe("live Code Activity", () => {
  test.skip(!ENABLED || !STORAGE || !LIST_URL, "set CODE_ACTIVITY_LIVE_E2E, CODE_ACTIVITY_E2E_STORAGE and CODE_ACTIVITY_E2E_LIST_URL");
  test.use({ storageState: STORAGE });

  async function openTab(page: import("@playwright/test").Page) {
    await page.goto(LIST_URL as string);
    await page.getByRole("button", { name: /^Code Activity$/ }).click();
    await expect(page.locator("[data-code-activity-root]")).toBeVisible();
    await page.locator("[data-change-id]").first().waitFor();
  }

  test("a row opens the overlay, Escape closes it, and focus returns to the row", async ({ page }) => {
    await openTab(page);
    const row = page.locator("[data-change-id]").first();
    await row.focus();
    await row.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /Files/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
  });

  test("tabs inside the overlay work from the keyboard and focus stays inside the dialog", async ({ page }) => {
    await openTab(page);
    await page.locator("[data-change-id]").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /Overview/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: /Files/ })).toBeFocused();
    for (let i = 0; i < 30; i += 1) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test("on a phone the overlay fills the screen and nothing overflows horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.locator("[data-change-id]").first().click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    expect(box?.height).toBeGreaterThanOrEqual(843);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("with reduced motion requested, nothing in the tab animates continuously", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE, reducedMotion: "reduce" });
    const page = await context.newPage();
    await openTab(page);
    const animating = await page.evaluate(() => [...document.querySelectorAll("[data-code-activity-root] *")].filter((el) => getComputedStyle(el).animationName !== "none" && getComputedStyle(el).animationIterationCount === "infinite").length);
    expect(animating).toBe(0);
    await context.close();
  });

  test("Things, Chat and Members stay usable beside the tab", async ({ page }) => {
    await openTab(page);
    for (const name of [/^Things$/, /^Chat$/, /Members/]) await expect(page.getByRole("button", { name })).toBeVisible();
  });
});
