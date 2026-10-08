import { expect, test, type Page } from "@playwright/test";

async function signInAsDemo(page: Page) {
  await page.goto("/auth");
  // The gate lists Demo Personas directly; older builds hide them behind a Demo tab.
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  if (await demoTab.isVisible().catch(() => false)) await demoTab.click();
  const persona = page.getByRole("button", { name: /Priya Sharma/i });
  const available = await persona.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!available) {
    if (process.env.CI) throw new Error("Demo personas are missing; Designs preview coverage must not skip in CI");
    return false;
  }
  await persona.click();
  await page.waitForURL("/", { timeout: 20_000 });
  return true;
}

async function expectNoPageOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1 && !element.closest(".list-workspace-tabs"))
      .slice(0, 5)
      .map((element) => ({ tag: element.tagName, className: String(element.className), text: element.textContent?.trim().slice(0, 50) })),
  }));
  expect(result.overflow, `${label} has horizontal overflow: ${JSON.stringify(result.offenders)}`).toBe(false);
}

// Preview sessions must never read or write the shared design tables, so the tab shows an explicit
// unavailable state. Real library behavior is covered by scripts/designs-ui.test.mjs (jsdom) and
// scripts/design-resources-sql.test.mjs (database rules); it needs a signed-in staging account.
test("Designs tab is reachable by keyboard, isolated in preview, and leaves other tabs working", async ({ page }) => {
  test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
  await page.goto("/lists");
  await page.locator('a[href^="/lists/"]:visible').first().click();

  const designsTab = page.getByRole("button", { name: /^Designs$/i });
  await expect(designsTab).toBeVisible();
  await designsTab.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Designs are not available in preview")).toBeVisible();
  await expect(page.getByText("No designs yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add design/ })).toHaveCount(0);
  await expectNoPageOverflow(page, "Designs tab (preview)");

  // The tab bar scrolls instead of overflowing the page, and its tabs keep a usable touch size.
  const box = await designsTab.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(30);

  // A Thing's "View in Designs" link lands on this tab (?tab=designs&design=<id>).
  const listUrl = page.url().split("?")[0];
  await page.goto(`${listUrl}?tab=designs&design=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("Designs are not available in preview")).toBeVisible();

  await page.getByRole("button", { name: /^Chat$/i }).click();
  await expect(page.getByRole("button", { name: "Search messages" })).toBeVisible();
  await page.getByRole("button", { name: /^Things$/i }).click();
  await expect(page.getByRole("button", { name: /^Things$/i })).toBeVisible();
  await page.getByRole("button", { name: /Members/i }).click();
  await expect(page.getByText(/Permission Guide/i)).toBeVisible();
});
