import { test, expect, type Page } from "@playwright/test";
import { signInPreview } from "./demo-sign-in";

async function open(page: Page, title: string) {
  await page.getByText(title, { exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("owner adds formatted description, previews URLs, edits and cancels", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 1024,
    "Owned Things are in the desktop With Others panel",
  );
  test.skip(!(await signInPreview(page)), "Demo mode is disabled");
  await page.route("**/api/link-preview?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preview: {
          title: "Booking page",
          description: "Metadata from the preview service",
          host: "example.com",
          image: null,
        },
      }),
    }),
  );
  const dialog = await open(page, "Share the final QA evidence");
  const section = dialog.locator(".thing-description");
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await section.getByRole("button", { name: "+ Add description" }).click();
  const editor = section.getByRole("textbox", { name: "Description" });
  await expect(editor).toBeVisible();
  await expect(section.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await editor.fill("Travel notes");
  await editor.press("ControlOrMeta+a");
  await section.getByRole("button", { name: "Bold", exact: true }).click();
  await editor.press("End");
  await editor.press("Enter");
  await editor.press("ControlOrMeta+b");
  await editor.pressSequentially("https://example.com/");
  await editor.press("Space");
  await expect(section.getByText("Booking page")).toBeVisible();
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(section.locator("strong")).toContainText("Travel notes");
  await expect(section.getByText("Booking page").locator("..").locator("..")).toHaveAttribute(
    "target",
    "_blank",
  );
  await section.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.fill("Discard this");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(section).toContainText("Travel notes");
  await expect(section).not.toContainText("Discard this");
  const rects = await dialog.evaluate((element) => {
    const d = element.querySelector(".thing-description")!.getBoundingClientRect();
    const due = element.querySelector('[aria-label="Sender’s pace"]')?.getBoundingClientRect();
    return { description: d.top, due: due?.top };
  });
  if (rects.due) expect(rects.description).toBeLessThan(rects.due);
});

test("assignee has no description editing actions", async ({ page }) => {
  test.skip(!(await signInPreview(page)), "Demo mode is disabled");
  const dialog = await open(page, "Approve the final release checklist");
  const section = dialog.locator(".thing-description");
  await expect(section).toBeVisible();
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByRole("textbox")).toHaveCount(0);
});

test("preview failure leaves a clickable URL and allows saving; a dismissed draft restores", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 1024,
    "Owned Things are in the desktop With Others panel",
  );
  test.skip(!(await signInPreview(page)), "Demo mode is disabled");
  await page.route("**/api/link-preview?*", (route) => route.fulfill({ status: 503 }));
  let dialog = await open(page, "Share the final QA evidence");
  let section = dialog.locator(".thing-description");
  await section.getByRole("button", { name: "+ Add description" }).click();
  await section.getByRole("textbox", { name: "Description" }).fill("https://example.com/");
  await expect(section.getByRole("link", { name: /example.com/ }).last()).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  await page.keyboard.press("Escape"); // kept draft, editor intercepts Escape
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /close/i }).first().click();
  dialog = await open(page, "Share the final QA evidence");
  section = dialog.locator(".thing-description");
  await expect(section.getByRole("textbox", { name: "Description" })).toContainText(
    "https://example.com/",
  );
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await expect(section.getByRole("link").first()).toHaveAttribute(
    "rel",
    "noopener noreferrer nofollow",
  );
});
