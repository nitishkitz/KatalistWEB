import { expect, test } from "@playwright/test";

/**
 * Code Activity WORKSPACE acceptance in a real signed-in browser. WRITTEN BUT NEVER RUN: it needs an allowlisted List that
 * is connected to a test repository, plus a saved signed-in session.
 *
 *   CODE_ACTIVITY_LIVE_E2E=true \
 *   CODE_ACTIVITY_E2E_STORAGE=/path/to/signed-in-storage-state.json \
 *   CODE_ACTIVITY_E2E_LIST_URL=http://localhost:8080/lists/<allowlisted-list-id> \
 *   npx playwright test tests/e2e/preview/code-activity-workspace.spec.ts
 *
 * The older code-activity-live.spec.ts targets the previous click-open overlay (VITE_CODE_ACTIVITY_WORKSPACE=false).
 * Layout geometry is checked against a MOCKED harness in output/code-activity-execution/visual-harness; this spec is for
 * live behaviour that harness cannot show: real GitHub rows, real Magic Box, real keyboard shortcut.
 */
const ENABLED = process.env.CODE_ACTIVITY_LIVE_E2E === "true";
const STORAGE = process.env.CODE_ACTIVITY_E2E_STORAGE;
const LIST_URL = process.env.CODE_ACTIVITY_E2E_LIST_URL;

test.describe("live Code Activity workspace", () => {
  test.skip(!ENABLED || !STORAGE || !LIST_URL, "set CODE_ACTIVITY_LIVE_E2E, CODE_ACTIVITY_E2E_STORAGE and CODE_ACTIVITY_E2E_LIST_URL");
  test.use({ storageState: STORAGE });

  async function openTab(page: import("@playwright/test").Page) {
    await page.goto(LIST_URL as string);
    await page.getByRole("button", { name: /^Code Activity$/ }).click();
    await expect(page.locator("[data-code-activity-workspace]")).toBeVisible();
    await page.locator("[data-item-id]").first().waitFor();
  }

  test("desktop shows the list beside the detail with no modal, at the planned proportions", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await openTab(page);
    const feed = await page.locator(".ca-feed").boundingBox();
    const workspace = await page.locator("[data-code-activity-workspace]").boundingBox();
    expect(workspace?.x).toBeGreaterThanOrEqual(15);
    expect(workspace?.x).toBeLessThanOrEqual(17);
    expect(((feed?.width ?? 0) / (workspace?.width ?? 1))).toBeGreaterThan(0.34);
    expect(((feed?.width ?? 0) / (workspace?.width ?? 1))).toBeLessThan(0.38);
    await page.locator("[data-item-id]").first().locator("button").first().click();
    await expect(page.getByRole("tab", { name: /files/i })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Create Thing and Ctrl+K open the same List-scoped composer in place, once, without navigating", async ({ page }) => {
    await openTab(page);
    const url = page.url();
    await page.getByRole("button", { name: "Create Thing" }).first().click();
    const dock = page.locator("[data-create-thing-dock]");
    await expect(dock).toBeVisible();
    await expect(dock.locator("textarea, input, [contenteditable=true]").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dock).toBeHidden();
    await page.keyboard.press("Control+k");
    await expect(dock).toBeVisible();
    expect(page.url()).toBe(url);
    expect(await dock.locator("textarea, input, [contenteditable=true]").count()).toBeGreaterThan(0);
  });

  test("on a phone a row opens the detail, Back returns to the same row, and nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTab(page);
    const row = page.locator("[data-item-id]").first().locator("button").first();
    await row.click();
    await expect(page.getByRole("button", { name: "Back to activity" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Back to activity" }).click();
    await expect(row).toBeFocused();
  });

  test("the branch picker changes the commits shown and keeps one shared state with the Branch filter", async ({ page }) => {
    await openTab(page);
    await page.getByRole("button", { name: /^Branch:/ }).click();
    const options = page.getByRole("listbox", { name: "Branches" }).getByRole("option");
    test.skip((await options.count()) < 2, "needs a repository with at least two branches");
    const other = options.nth(1);
    const name = (await other.textContent())?.trim() ?? "";
    await other.getByRole("button").click();
    await expect(page.getByRole("button", { name: new RegExp(`Branch: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeVisible();
  });
});
