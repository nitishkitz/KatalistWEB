import { signInPreview } from "./demo-sign-in";
import { test, expect, type Page } from "@playwright/test";

/**
 * Real Court detail dialog: due-date add/update/remove and Cancel Thing for
 * the Thing Owner, and neither for a non-owner. Demo persona session: zero
 * real Supabase calls. Skips (not fails) when VITE_KATALIST_DEMO_MODE is not
 * enabled for the run.
 */
const OWNED_TITLE = "Share the final QA evidence"; // owned by the persona, assigned to Rahul
const ASSIGNED_TITLE = "Approve the final release checklist"; // owned by Rahul, assigned to the persona

// Compact Court (below lg) has a different layout without the With Others
// panel used here to reach Things the persona owns, so these flows are only
// automated at desktop-class widths. Compact-width coverage is a known gap.
const COMPACT_SKIP = "compact Court layout is not covered by this spec";
const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

async function openOwned(page: Page, title: string) {
  await page.getByText(title, { exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("owner can remove, add and update a due date from the Court detail dialog", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  test.skip(isCompact(page), COMPACT_SKIP);
  const dialog = await openOwned(page, OWNED_TITLE);

  await dialog.getByRole("button", { name: "Edit due date", exact: true }).click();
  const input = page.getByLabel("Due date and time", { exact: true });
  await expect(input).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "Update date" })).toBeDisabled(); // unchanged

  await page.getByRole("button", { name: "Remove due date" }).click();
  await expect(dialog.getByRole("button", { name: "Add due date", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Add due date", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove due date" })).toHaveCount(0);
  await expect(input).toHaveValue("");
  const add = page.getByRole("button", { name: "Add date" });
  await expect(add).toBeDisabled(); // empty

  await input.fill("2030-01-15T10:30");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(dialog.getByText("No due date")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Edit due date", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove due date" })).toBeVisible();

  await input.fill("2030-02-20T09:00");
  await page.getByRole("button", { name: "Update date" }).click();
  await expect(dialog.getByText("No due date")).toHaveCount(0);
});

test("dismissing the cancel confirmation changes nothing; confirming cancels and closes the dialog", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  test.skip(isCompact(page), COMPACT_SKIP);
  const dialog = await openOwned(page, OWNED_TITLE);
  await dialog.getByRole("button", { name: "Show more Thing actions" }).click();

  page.once("dialog", (d) => {
    expect(d.message()).toBe("Are you sure you want to cancel this thing?");
    void d.dismiss();
  });
  await dialog.getByRole("button", { name: "Cancel Thing" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Cancelled", { exact: true })).toHaveCount(0);

  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "Cancel Thing" }).click();
  await expect(page.getByRole("dialog", { name: OWNED_TITLE })).toHaveCount(0);
});

test("a non-owner sees no due-date or cancel actions", async ({ page }) => {
  const signedIn = await signInPreview(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  test.skip(isCompact(page), COMPACT_SKIP);
  await page.getByRole("button", { name: `Open ${ASSIGNED_TITLE}` }).click();
  const dialog = page.getByRole("dialog", { name: ASSIGNED_TITLE });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Show more Thing actions" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel Thing" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "View due date", exact: true }).click();
  await expect(page.getByText(/Only .+, the owner, can change this date\./)).toBeVisible();
  await expect(page.getByLabel("Due date and time", { exact: true })).toHaveCount(0);
});
