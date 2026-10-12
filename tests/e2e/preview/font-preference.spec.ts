import { expect, test } from "@playwright/test";
import { signInPreview } from "./demo-sign-in";

test("app font starts at Poppins, previews alternatives and persists a selection", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");

  await page.goto("/me");
  await page.getByRole("button", { name: /Appearance/ }).click();
  const dialog = page.getByRole("dialog", { name: "Appearance" });
  await expect(dialog.getByRole("radio", { name: /Poppins/ })).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-katalist-font");

  await dialog.getByRole("radio", { name: /Mona Sans/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-katalist-font", "mona-sans");
  await expect.poll(() => page.locator("html").evaluate((node) => getComputedStyle(node).fontFamily)).toContain("Mona Sans");
  await page.reload();
  await page.getByRole("button", { name: /Appearance/ }).click();
  await expect(page.getByRole("dialog", { name: "Appearance" }).getByRole("radio", { name: /Mona Sans/ })).toBeChecked();

  await page.getByRole("dialog", { name: "Appearance" }).getByRole("radio", { name: /Poppins/ }).check();
  await expect(page.locator("html")).not.toHaveAttribute("data-katalist-font");
});
