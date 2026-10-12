import { signInPreview } from "./demo-sign-in";
import { test, expect } from "@playwright/test";

/**
 * Profile "Things sorted" card -> currently solved Things list -> Thing
 * detail. Demo persona session: zero real Supabase calls. Skips (not fails)
 * when VITE_KATALIST_DEMO_MODE is not enabled.
 */
test("the Things sorted card opens the solved list and a row opens its detail with focus restored", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  await page.goto("/me", { waitUntil: "domcontentloaded" });

  const card = page.getByRole("button", { name: "View sorted Things" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  const list = page.getByRole("dialog", { name: "Sorted Things" });
  await expect(list).toBeVisible();
  await expect(list.getByText("Things assigned to you that are currently solved.")).toBeVisible();

  const rows = list.locator("[data-solved-row]");
  const count = await rows.count();
  // The demo seed has currently solved Things assigned to the persona.
  expect(count).toBeGreaterThan(0);
  {
    const first = rows.first();
    const title = (await first.locator("span.truncate").innerText()).trim();
    await expect(first.getByText("Sorted", { exact: true })).toBeVisible();
    await first.click();
    // The list surface closes while the detail is open: one modal at a time.
    await expect(page.getByRole("dialog", { name: "Sorted Things" })).toHaveCount(0);
    const detail = page.getByRole("dialog", { name: title });
    await expect(detail).toBeVisible();
    // A sorted Thing exposes neither date editing nor cancellation.
    await expect(detail.getByRole("button", { name: "Show more Thing actions" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Sorted Things" })).toBeVisible();
    await expect(page.locator(`[data-solved-row]:focus`)).toHaveCount(1);
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sorted Things" })).toHaveCount(0);
  await expect(card).toBeFocused();
});
