import { expect, test, type Page } from "@playwright/test";

async function signInAsDemo(page: Page) {
  await page.goto("/auth");
  const demo = page.getByRole("button", { name: /^Demo$/i });
  const available = await demo.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!available) return false;
  await demo.click();
  await page.getByRole("button", { name: /Priya Sharma/i }).click();
  await page.waitForURL("/");
  return true;
}

async function expectNoPageOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    dimensions: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, innerWidth: window.innerWidth },
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 50) })),
  }));
  expect(result.overflow, `${label} has horizontal overflow: ${JSON.stringify({ dimensions: result.dimensions, offenders: result.offenders })}`).toBe(false);
}

test("Lists index/detail keeps native navigation, shared chat and responsive summaries", async ({ page }, testInfo) => {
  test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
  await page.goto("/lists");
  await expect(page.getByLabel("Search Lists")).toBeVisible();
  await expectNoPageOverflow(page, "Lists index");
  const firstList = page.locator('a[href^="/lists/"]:visible').first();
  await expect(firstList).toBeVisible();
  await firstList.focus();
  expect(await firstList.getAttribute("href")).toMatch(/^\/lists\/[0-9a-z-]+/i);
  await page.screenshot({ path: testInfo.outputPath("lists-index.png"), fullPage: false });
  await firstList.click();

  await expect(page.getByRole("button", { name: /^Things$/i })).toBeVisible();
  await page.getByRole("button", { name: /^Chat$/i }).click();
  await expect(page.getByRole("button", { name: "Search messages" })).toBeVisible();
  expect(await page.getByRole("textbox", { name: /Message / }).count()).toBe(1);
  await page.getByRole("button", { name: /Members/i }).click();
  await expect(page.getByText(/Permission Guide/i)).toBeVisible();
  await expectNoPageOverflow(page, "List detail");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize({ width: Math.max(320, Math.floor(viewport.width / 2)), height: viewport.height });
  await expectNoPageOverflow(page, "List detail at 200% zoom equivalent");
});

test("Buckets index/detail exposes truthful references and one responsive Thing detail surface", async ({ page }, testInfo) => {
  test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
  await page.goto("/buckets");
  await expect(page.getByLabel("Search Buckets")).toBeVisible();
  await expectNoPageOverflow(page, "Buckets index");
  const firstBucket = page.locator('a[href^="/buckets/"]').first();
  await expect(firstBucket).toBeVisible();
  await firstBucket.click();

  await expect(page.getByText("Private collection. Shared items keep their existing permissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add existing reference/i })).toBeVisible();
  const firstOpen = page.getByRole("button", { name: /^Open$/i }).first();
  if (await firstOpen.isVisible()) {
    await firstOpen.click();
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      await expect(page.getByRole("dialog")).toBeVisible();
    } else {
      await expect(page.getByLabel("Inline Thing details")).toBeVisible();
    }
    await page.keyboard.press("Escape");
  }
  await expectNoPageOverflow(page, "Bucket detail");
  await page.screenshot({ path: testInfo.outputPath("bucket-detail.png"), fullPage: false });
});
