import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Manual QA workspace, end to end, against the isolated in-memory PREVIEW adapter only.
 * It proves UI wiring and workflow rules; it does NOT prove the database, RLS or the vault (see
 * scripts/qa-schema-sql.test.mjs, scripts/qa-vault.test.mjs and the staging gate for those).
 * Set QA_CAPTURE_DIR to also write screenshots for the completion report.
 */
const CAPTURE = process.env.QA_CAPTURE_DIR;
if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
const shot = async (page: Page, name: string) => {
  if (!CAPTURE) return;
  const v = page.viewportSize();
  await page.screenshot({ path: `${CAPTURE}/${name}-${v?.width}x${v?.height}.png` });
};

async function signInAsDemo(page: Page) {
  await page.goto("/auth");
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  if (await demoTab.isVisible().catch(() => false)) await demoTab.click();
  const persona = page.getByRole("button", { name: /Priya Sharma/i });
  const available = await persona.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
  if (!available) {
    if (process.env.CI) throw new Error("Demo personas are missing; QA preview coverage must not skip in CI");
    return false;
  }
  await persona.click();
  await page.waitForURL("/", { timeout: 20_000 });
  return true;
}

async function openQa(page: Page) {
  await page.goto("/lists");
  await page.locator('a[href^="/lists/"]:visible').first().click();
  const tab = page.getByRole("button", { name: /^QA$/ });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByRole("region", { name: "Manual QA" })).toBeVisible();
}
const qa = (page: Page) => page.getByRole("region", { name: "Manual QA" });
const nav = (page: Page, name: string) => qa(page).getByRole("navigation", { name: "QA sections" }).getByRole("button", { name });

async function noOverflow(page: Page, label: string) {
  const bad = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(bad, `${label} has horizontal page overflow`).toBe(false);
}

test.describe("Manual QA (preview adapter)", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    test.skip(!(await signInAsDemo(page)), "VITE_KATALIST_DEMO_MODE is not enabled");
    await openQa(page);
  });

  test("steps 01-04: Access, credential panel, copy and reveal", async ({ page }) => {
    await expect(qa(page).getByText("Preview data.")).toBeVisible();
    for (const n of ["Access", "Test Sheet", "Runs", "Defects", "History"]) await expect(nav(page, n)).toBeVisible();
    await expect(nav(page, "Access")).toHaveAttribute("aria-current", "page");
    await expect(qa(page).getByRole("heading", { name: "Environment & access" })).toBeVisible();
    await expect(qa(page).getByRole("heading", { name: "Web application / QA" })).toBeVisible();
    await shot(page, "01-access");

    // target selection filters resources and accounts
    await qa(page).getByRole("button", { name: /Android application/ }).click();
    await expect(qa(page).getByRole("heading", { name: "Android application / QA" })).toBeVisible();
    await expect(qa(page).getByText("No testing accounts")).toBeVisible();
    await qa(page).getByRole("button", { name: /Web application/ }).click();
    await expect(qa(page).getByRole("table", { name: "Testing accounts" })).toBeVisible();

    // username copy gives visible confirmation only after the clipboard write
    await page.getByRole("button", { name: "Copy username for QA Owner" }).click();
    await expect(qa(page).getByText("Copied", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("qa.owner@example.test");

    // password is masked, reveals on request, hides again
    const pw = page.getByTestId("password-QA Owner");
    await expect(pw).toHaveText("•••••••••");
    await page.getByRole("button", { name: "Reveal password for QA Owner" }).click();
    await expect(pw).toHaveText("Preview-Only-Not-A-Real-Password");
    await shot(page, "04-credentials-reveal");
    await page.getByRole("button", { name: "Hide password for QA Owner" }).click();
    await expect(pw).toHaveText("•••••••••");
    await page.getByRole("button", { name: "Copy password for QA Owner" }).click();
    await expect(page.getByText("Password copied")).toBeAttached();

    // add credential panel (step 03)
    await qa(page).getByRole("button", { name: "Add credential" }).click();
    const panel = qa(page).getByRole("complementary", { name: "Add credential" });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Account name").fill("QA Dispatcher");
    await panel.getByLabel("Test role").fill("Dispatcher");
    await panel.getByLabel("Username / email").fill("qa.dispatcher@example.test");
    await panel.getByRole("button", { name: "Save credential" }).click();
    await expect(panel.getByText("Enter a password.")).toBeVisible();
    await panel.getByLabel("Password", { exact: true }).fill("Dispatch-Preview-1");
    await expect(panel.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await panel.getByRole("button", { name: "Show typed password" }).click();
    await expect(panel.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await shot(page, "03-add-credential");
    await panel.getByRole("button", { name: "Save credential" }).click();
    await expect(qa(page).getByRole("cell", { name: "QA Dispatcher", exact: true })).toBeVisible();
    await expect(qa(page).getByRole("complementary", { name: "Add credential" })).toHaveCount(0);

    // editing never prefills the secret and a blank password keeps it
    await page.getByRole("button", { name: "Edit QA Dispatcher" }).click();
    const edit = qa(page).getByRole("complementary", { name: "Edit QA Dispatcher" });
    await expect(edit.getByLabel("Password", { exact: true })).toHaveValue("");
    await edit.getByLabel("Test role").fill("Lead dispatcher");
    await edit.getByRole("button", { name: "Save credential" }).click();
    await expect(qa(page).getByRole("cell", { name: "Lead dispatcher" })).toBeVisible();
    await noOverflow(page, "Access");
  });

  test("steps 05-06: Test Sheet library and New run", async ({ page }) => {
    await nav(page, "Test Sheet").click();
    const grid = page.getByTestId("case-grid");
    await expect(grid.getByRole("row")).toHaveCount(11); // header + 10 seeded cases
    await shot(page, "05-test-sheet");

    // search + filter are server-style filters over the library
    await qa(page).getByLabel("Search test cases").fill("Chat");
    await expect(grid.getByRole("row")).toHaveCount(2);
    await qa(page).getByLabel("Search test cases").fill("");
    await expect(grid.getByRole("row")).toHaveCount(11);

    // create a case; editing it makes a new immutable version
    await qa(page).getByRole("button", { name: "Add case" }).click();
    const panel = qa(page).getByRole("complementary", { name: "New test case" });
    await panel.getByLabel("Title").fill("Reassign a Thing");
    await panel.getByLabel("Step 1 action").fill("Open a Thing");
    await panel.getByLabel("Step 1 expected result").fill("Detail opens");
    await panel.getByRole("button", { name: "Create case" }).click();
    await expect(grid.getByRole("button", { name: "Reassign a Thing" })).toBeVisible();
    await grid.getByRole("button", { name: "Reassign a Thing" }).click();
    const detail = qa(page).getByRole("complementary", { name: /TC-011 details/ });
    await detail.getByLabel("Title").fill("Reassign a Thing to a new owner");
    await detail.getByRole("button", { name: "Save new version" }).click();
    await qa(page).getByRole("checkbox", { name: "Archived" }).check();
    await qa(page).getByRole("checkbox", { name: "Archived" }).uncheck();

    // spreadsheet edit: arrow-key navigation, Enter to edit, Escape to cancel
    await qa(page).getByRole("button", { name: "Spreadsheet edit" }).click();
    await expect(grid).toHaveAttribute("role", "grid");
    const first = grid.locator('td[data-cell="title"]').first();
    await first.focus();
    await page.keyboard.press("Enter");
    const input = grid.getByRole("textbox").first();
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(grid.getByRole("textbox")).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(grid.locator('td[tabindex="0"]')).toHaveCount(1);

    // export downloads a real file
    const download = page.waitForEvent("download");
    await qa(page).getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "CSV · all active cases" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    const xlsx = page.waitForEvent("download");
    await qa(page).getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Excel (.xlsx) · all active cases" }).click();
    expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/);

    // select cases and start a run
    await qa(page).getByRole("button", { name: "Spreadsheet edit" }).click();
    await grid.getByRole("checkbox", { name: "Select TC-001" }).check();
    await grid.getByRole("checkbox", { name: "Select TC-002" }).check();
    await qa(page).getByRole("button", { name: "New run from selected" }).click();
    const form = qa(page).getByRole("complementary", { name: "New run" });
    await expect(form.getByText("2 selected")).toBeVisible();
    await form.getByLabel("Run name").fill("Smoke on web.143");
    await form.getByLabel("Build", { exact: true }).selectOption({ label: "web.143 · Release 2.8.1" });
    await shot(page, "06-new-run");
    await form.getByRole("button", { name: "Start run" }).click();
    await expect(qa(page).getByRole("combobox", { name: "Run" })).toHaveValue(/.+/);
    await expect(qa(page).getByRole("combobox", { name: "Run" }).locator("option:checked")).toHaveText("Smoke on web.143");
    await expect(page.getByTestId("run-grid").getByRole("row")).toHaveCount(3);
  });

  test("steps 07-12: execute, fail with evidence and a Thing, retest, complete, history", async ({ page }) => {
    await nav(page, "Runs").click();
    const grid = page.getByTestId("run-grid");
    await expect(grid.getByRole("row")).toHaveCount(11);
    await expect(page.getByTestId("run-totals")).toContainText("10 test cases");
    await shot(page, "07-execute");

    // keyboard: focus a Not Run row and press P to pass it
    const tc005 = grid.getByRole("row", { name: /TC-005/ });
    await tc005.focus();
    await page.keyboard.press("p");
    await expect(tc005).toContainText("Pass");
    await expect(page.getByTestId("run-totals")).toContainText("Pass6");

    // fail requires an actual result
    const tc008 = grid.getByRole("row", { name: /TC-008/ });
    await tc008.focus();
    await page.keyboard.press("f");
    const detail = qa(page).getByRole("complementary", { name: /TC-008 result/ });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Save result" }).click();
    await expect(detail.getByText("Describe the actual behaviour for a failed result.")).toBeVisible();
    await detail.getByLabel(/Actual result/).fill("The design does not open.");
    await detail.getByRole("button", { name: "Save result" }).click();
    await expect(detail.getByText("Last recorded")).toBeVisible();
    // At 767px and below the detail replaces the grid; the close button is the back action.
    const narrow = (page.viewportSize()?.width ?? 1440) <= 767;
    if (narrow) { await detail.getByRole("button", { name: "Close result panel" }).click(); }
    await expect(tc008).toContainText("Fail");
    if (narrow) { await tc008.click(); }

    // evidence on the saved attempt
    await detail.getByLabel("Attach evidence files").setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
    await expect(detail.getByText("screen.png")).toBeVisible();
    await expect(detail.getByAltText("Evidence screen.png")).toBeVisible();
    // disallowed type is rejected before upload
    await detail.getByLabel("Attach evidence files").setInputFiles({ name: "run.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("x") });
    await expect(detail.getByText(/file type is not allowed/)).toBeVisible();

    // create a Thing and link it
    await detail.getByRole("button", { name: "Create Thing" }).click();
    await expect(detail.getByText(/\[QA\] TC-008/)).toBeVisible();
    await shot(page, "08-failure-evidence");

    // Defects groups it with the real Thing's own status
    await nav(page, "Defects").click();
    await expect(qa(page).getByRole("table", { name: "Defects" })).toContainText("TC-008");
    await shot(page, "09-defects");

    // open the Thing, then come back to the same result
    await qa(page).getByRole("button", { name: "Open Thing" }).first().click();
    await expect(page.getByRole("button", { name: /Back to QA/ })).toBeVisible();
    await page.getByRole("button", { name: /Back to QA/ }).click();
    await expect(qa(page)).toBeVisible();

    // retest: a different build, a new run, the original untouched
    await nav(page, "Runs").click();
    await qa(page).getByRole("button", { name: "Retest" }).click();
    const dialog = page.getByRole("dialog", { name: /Retest fixed build/ });
    await expect(dialog.getByText(/will be retested/)).toBeVisible();
    await dialog.getByLabel("Build to retest").selectOption({ label: "web.143 · Release 2.8.1" });
    await shot(page, "10-retest");
    await dialog.getByRole("button", { name: "Start retest" }).click();
    await expect(qa(page).getByText(/Retest of Release 2.8 regression/)).toBeVisible();
    const retestGrid = page.getByTestId("run-grid");
    await expect(retestGrid.getByRole("row", { name: /TC-002/ })).toContainText("Not run");
    // the defect link made on the original failure is carried into the retest run
    await expect(retestGrid.getByRole("row", { name: /TC-008/ })).toContainText("[QA] TC-008");
    await expect(retestGrid.getByRole("row", { name: /TC-008/ })).toContainText("Not run");
    await qa(page).getByRole("combobox", { name: "Run" }).selectOption({ label: "Release 2.8 regression" });
    await expect(page.getByTestId("run-grid").getByRole("row", { name: /TC-002/ })).toContainText("Fail");

    // history keeps every attempt with build and tester context
    await nav(page, "History").click();
    const history = qa(page).getByRole("table", { name: "Execution history" });
    await expect(history).toContainText("web.142");
    await qa(page).getByLabel("Filter by case ID").fill("TC-002");
    await expect(history.getByRole("row")).toHaveCount(2);
    await history.getByRole("button", { name: /Show details/ }).click();
    await shot(page, "11-history");

    // complete: blocked and not-run must be accepted explicitly
    await nav(page, "Runs").click();
    await qa(page).getByRole("button", { name: "Complete run" }).click();
    const complete = page.getByRole("dialog", { name: "Complete run" });
    await expect(complete.getByRole("button", { name: "Complete run" })).toBeDisabled();
    await complete.getByRole("checkbox", { name: /Complete anyway/ }).check();
    await complete.getByRole("checkbox", { name: /Accept them as unresolved/ }).check();
    await shot(page, "12-complete");
    await complete.getByRole("button", { name: "Complete run" }).click();
    await expect(qa(page).getByText(/^Completed\./)).toBeVisible();
    await expect(qa(page).getByRole("button", { name: "Complete run" })).toHaveCount(0);
    await noOverflow(page, "Runs");
  });

  test("credential drafts stay with their target until discarded", async ({ page }) => {
    await expect(qa(page)).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await qa(page).getByRole("button", { name: "Add credential" }).click();
    const panel = qa(page).getByRole("complementary", { name: "Add credential" });
    await panel.getByLabel("Username / email").fill("draft@example.test");
    page.once("dialog", (dialog) => dialog.dismiss());
    await qa(page).getByRole("button", { name: /Android application/ }).click();
    await expect(qa(page).getByRole("heading", { name: "Web application / QA" })).toBeVisible();
    await expect(panel.getByLabel("Username / email")).toHaveValue("draft@example.test");
    page.once("dialog", (dialog) => dialog.accept());
    await qa(page).getByRole("button", { name: /Android application/ }).click();
    await expect(panel).toHaveCount(0);
    await qa(page).getByRole("button", { name: "Add credential" }).click();
    await expect(panel.getByLabel("Username / email")).toHaveValue("");
  });

  test("responsive: no page overflow and usable targets across QA views", async ({ page }) => {
    for (const view of ["Access", "Test Sheet", "Runs", "Defects", "History"]) {
      await nav(page, view).click();
      await page.waitForTimeout(300);
      await noOverflow(page, view);
    }
    await shot(page, "responsive-history");
  });
});
