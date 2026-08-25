import { expect, test, type Page } from "playwright/test";

async function enterDemoCourt(page: Page) {
  await page.goto("/auth", { waitUntil: "load" });
  await page.getByRole("button", { name: /Priya Sharma/ }).click();
  const box = page.getByRole("combobox", { name: "Magic Box" });
  if (!(await box.isVisible().catch(() => false))) {
    await page.goto("/", { waitUntil: "load" });
  }
  await expect(box).toBeVisible({ timeout: 30_000 });
}

function composer(page: Page) {
  return page.getByRole("combobox", { name: "Magic Box" });
}

function composerRoot(page: Page) {
  return composer(page).locator('xpath=ancestor::div[contains(@class,"mb-3")][1]');
}

function courtThingByTitle(page: Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("button", { name: new RegExp(`^${escaped}`) });
}

async function searchCourt(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Search Court" }).fill(title);
}

test("MB-019 real composer is operable by keyboard only", async ({ page }) => {
  await enterDemoCourt(page);
  const box = composer(page);
  const root = composerRoot(page);
  await box.click();
  await page.keyboard.type("Deck for @rah");
  const people = page.getByRole("listbox", { name: "People" });
  await expect(people).toBeVisible();
  await expect(people.getByRole("option").first()).toContainText("Rahul Mehta");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Tab");
  await expect(people).toHaveCount(0);
  await expect(box).toHaveValue(/@Rahul Mehta/);
  await expect(root.getByRole("button", { name: /Rahul Mehta/ })).toBeVisible();

  await box.fill("Check date 3/5 unique-mb019");
  await expect(root.getByRole("button", { name: "Check date" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Polish text" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Voice input" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Attach files" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Toss Thing" })).toBeVisible();

  await box.click();
  await box.fill("");
  await page.keyboard.type("Escapable @rah");
  await expect(people).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(people).toHaveCount(0);
});

test("MB-019 Enter with mention menu open creates zero Things", async ({ page }) => {
  await enterDemoCourt(page);
  const title = `MB019-mention-${Date.now()}`;
  const box = composer(page);
  await box.click();
  await page.keyboard.type(`${title} @rah`);
  await expect(page.getByRole("listbox", { name: "People" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "People" })).toHaveCount(0);
  await expect(box).toHaveValue(new RegExp(title));
  await searchCourt(page, title);
  await expect(courtThingByTitle(page, title)).toHaveCount(0);
});

test("MB-016 rapid Enter against the real controller creates exactly one Thing", async ({ page }) => {
  await enterDemoCourt(page);
  const title = `MB016-${Date.now()}`;
  const box = composer(page);
  await box.fill(title);
  await box.press("Enter");
  await box.press("Enter");
  await expect(composerRoot(page).getByText("Thing tossed.")).toBeVisible();
  await searchCourt(page, title);
  await expect(courtThingByTitle(page, title)).toHaveCount(1);
});

test("MB-018 reduced motion removes flight but keeps visible confirmation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemoCourt(page);
  const title = `MB018-${Date.now()}`;
  const box = composer(page);
  const root = composerRoot(page);
  await box.fill(title);
  const confirmation = expect(root).toHaveClass(/opacity-60/);
  await page.getByRole("button", { name: "Toss Thing" }).click();
  await confirmation;
  await expect(root).not.toHaveClass(/translate/);
  await expect(root.getByText("Thing tossed.")).toBeVisible();
  await searchCourt(page, title);
  await expect(courtThingByTitle(page, title)).toHaveCount(1);
});

test("recovery UI retries and removes without creating a second Thing", async ({ page }) => {
  await enterDemoCourt(page);
  await page.evaluate(() => {
    (window as Window & { __KATALIST_MAGIC_BOX_FAIL_FINALIZE__?: boolean }).__KATALIST_MAGIC_BOX_FAIL_FINALIZE__ = true;
  });
  const title = `MB-recovery-${Date.now()}`;
  const root = composerRoot(page);
  await root.locator('input[type="file"]').setInputFiles({
    name: "brief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await expect(root.getByText("brief.pdf", { exact: true })).toBeVisible();
  await composer(page).fill(title);
  await page.getByRole("button", { name: "Toss Thing" }).click();
  await expect(root.locator("#recovery")).toHaveText("Thing created. Retry or remove the remaining attachment.");
  await searchCourt(page, title);
  await expect(courtThingByTitle(page, title)).toHaveCount(1);
  await root.getByRole("button", { name: /Remove brief.pdf/ }).click();
  await expect(root.locator("#recovery")).toHaveCount(0);
  await expect(courtThingByTitle(page, title)).toHaveCount(1);
});

test("self Toss shows Catch on the Court card and Catch succeeds once", async ({ page }) => {
  await enterDemoCourt(page);
  const title = `Catch-self-${Date.now()}`;
  const box = composer(page);
  await box.fill(title);
  await box.press("Enter");
  await expect(composerRoot(page).getByText("Thing tossed.")).toBeVisible();
  await searchCourt(page, title);
  await expect(courtThingByTitle(page, title)).toHaveCount(1);
  const catchBtn = page.getByRole("button", { name: `Catch ${title}` });
  await expect(catchBtn).toBeVisible();
  await catchBtn.click();
  await expect(page.getByText("Caught.")).toBeVisible();
  await expect(catchBtn).toHaveCount(0);
});

test("self Toss shows Catch at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDemoCourt(page);
  const title = `Catch-mobile-${Date.now()}`;
  await composer(page).fill(title);
  await page.getByRole("button", { name: "Toss Thing" }).click();
  await expect(composerRoot(page).getByText("Thing tossed.")).toBeVisible();
  await expect(page.getByText(title).first()).toBeVisible();
  const catchBtn = page.getByRole("button", { name: `Catch ${title}` });
  await expect(catchBtn).toBeVisible();
  await catchBtn.click();
  await expect(page.getByText("Caught.")).toBeVisible();
  await expect(catchBtn).toHaveCount(0);
});
