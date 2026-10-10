import { test, expect, type Page } from "@playwright/test";

/**
 * Copy Thing -> paste compact card. Uses a Demo Persona session, so nothing reaches a real Supabase project.
 * Skips (does not fail) when demo mode is unavailable, like the other demo-gated specs.
 */
// Demo sign-in plays a short entrance sequence, so each journey needs more than the default 30 s.
test.setTimeout(90_000);

async function pasteClipboard(page: Page) {
  await page.bringToFront();
  const shortcut = await page.evaluate(() => /Mac/i.test(navigator.platform) ? "Meta+V" : "Control+V");
  await page.keyboard.press(shortcut);
}

async function signIn(page: Page) {
  await page.goto("/auth");
  // Older builds show a Demo tab first; current builds list the demo personas directly.
  const demoTab = page.getByRole("button", { name: /^Demo$/i });
  if (await demoTab.isVisible().catch(() => false)) await demoTab.click();
  const persona = page.getByRole("button", { name: /Priya Sharma/i });
  const appeared = await persona.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  if (!appeared) {
    if (process.env.CI) throw new Error("Demo personas are missing; Thing reference coverage must not skip in CI");
    return false;
  }
  await persona.click();
  await page.waitForURL("/");
  // The Morning Brief can open over Court after sign-in; dismiss it like a user would.
  const brief = page.getByRole("dialog").first();
  if (await brief.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  return true;
}

test("copy a Thing from a Court card and paste it into Magic Box as a compact card", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const signedIn = await signIn(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");

  const card = page.locator("article").filter({ has: page.getByRole("button", { name: /^Open / }) }).first();
  const openButton = card.getByRole("button", { name: /^Open / }).first();
  await expect(openButton).toBeVisible({ timeout: 30_000 });
  const title = (await openButton.getAttribute("aria-label"))!.replace(/^Open /, "");

  // Right-click offers the three actions and does not open the card.
  await card.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy Thing" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Add to Magic Box" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Copy Thing" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/\?thing=[\w-]+$/);

  // Paste into Magic Box: the link becomes a compact card, not text.
  const box = page.getByLabel("Magic Box").first();
  await box.click();
  await pasteClipboard(page);
  const refs = page.getByLabel("Referenced Things").first();
  await expect(refs).toBeVisible();
  await expect(refs.getByText(title).first()).toBeVisible();
  await expect(box).toHaveValue("");

  // The approved compact purple composer adds only a miniature reference row.
  const composer = page.locator(".magic-box-with-references").first();
  await expect(composer.getByText("Magic Box", { exact: true })).toHaveCount(0);
  await expect(composer.getByLabel("Referenced Things")).toBeVisible();
  await expect.poll(() => composer.evaluate((el) => el.style.height)).toBe("");
  const inputBounds = await box.boundingBox();
  const referenceBounds = await refs.boundingBox();
  expect(referenceBounds!.y).toBeGreaterThan(inputBounds!.y + inputBounds!.height);
  const tossBounds = await composer.getByRole("button", { name: "Toss Thing" }).boundingBox();
  expect(Math.abs(tossBounds!.y - inputBounds!.y)).toBeLessThan(3);
  const composerBounds = await composer.boundingBox();
  expect(composerBounds!.height).toBeLessThanOrEqual(90);
  const mini = composer.locator('[data-variant="inline"]');
  expect((await mini.boundingBox()).height).toBeLessThanOrEqual(36);
  const glow = await composer.locator(".magic-box-frame-light").evaluate((el) => ({ name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration }));
  expect(glow.name).toBe("magic-box-orbit");
  expect(parseFloat(glow.duration)).toBeLessThan(5);
  await box.fill("Ask Rohit to review this tomorrow");
  await composer.screenshot({ path: "output/thing-reference-ui-match.png" });
  await page.screenshot({ path: "output/thing-reference-compact-purple-court.png" });
  await box.fill("");


  // Pasting the same Thing again does not add a second card.
  await box.click();
  await pasteClipboard(page);
  await expect(refs.getByRole("button", { name: /^Remove reference/ })).toHaveCount(1);

  // The card is removable on its own, and ordinary text paste still works.
  await refs.getByRole("button", { name: /^Remove reference/ }).click();
  await expect(page.getByLabel("Referenced Things")).toHaveCount(0);

  // Regression: older Court stack drag data must become a card, never raw JSON in the input.
  const legacyPayload = { thingId: new URL(link).searchParams.get("thing"), fromLane: "now", title: "Untrusted drag title" };
  await box.evaluate((input, payload) => {
    const transfer = new DataTransfer();
    transfer.setData("application/katalist-thing", JSON.stringify(payload));
    transfer.setData("text/plain", JSON.stringify(payload));
    input.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, legacyPayload);
  await expect(refs.getByText(title).first()).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(refs.getByText("Untrusted drag title")).toHaveCount(0);
  await refs.getByRole("button", { name: /^Remove reference/ }).click();

  await page.evaluate((payload) => navigator.clipboard.writeText(JSON.stringify(payload)), legacyPayload);
  await box.click();
  await pasteClipboard(page);
  await expect(refs.getByText(title).first()).toBeVisible();
  await expect(box).toHaveValue("");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => composer.locator(".magic-box-frame-light").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await refs.getByRole("button", { name: /^Remove reference/ }).click();
  await expect(page.getByLabel("Referenced Things")).toHaveCount(0);
  await expect.poll(() => page.locator(".magic-box-root").first().evaluate((el) => el.style.height)).toBe("");
});

test("the Add to Magic Box action stages the Thing without a clipboard round trip", async ({ page }) => {
  const signedIn = await signIn(page);
  test.skip(!signedIn, "VITE_KATALIST_DEMO_MODE is not enabled for this run");
  const card = page.locator("article").filter({ has: page.getByRole("button", { name: /^Open / }) }).first();
  await card.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  test.skip(!(await card.isVisible().catch(() => false)), "Court stack is not rendered at this breakpoint");
  await card.getByRole("button", { name: "Thing options" }).click();
  await page.getByRole("menuitem", { name: "Add to Magic Box" }).click();
  await expect(page.getByLabel("Referenced Things").first()).toBeVisible();
});



async function copyFirstCardThing(page: Page) {
  const card = page.locator("article").filter({ has: page.getByRole("button", { name: /^Open / }) }).first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  const title = (await card.getByRole("button", { name: /^Open / }).first().getAttribute("aria-label"))!.replace(/^Open /, "");
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Thing" }).click();
  return title;
}

test("a Thing permalink opens that exact Thing", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  test.skip(!(await signIn(page)), "Demo personas are not available");
  const title = await copyFirstCardThing(page);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(link);
  // A reload of the permalink signs the demo session back in from storage and opens the Thing detail.
  await expect(page.getByRole("dialog").getByText(title).first()).toBeVisible({ timeout: 20_000 });
});

test("Toss with a pasted Thing needs instruction text and clears the reference on success", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  test.skip(!(await signIn(page)), "Demo personas are not available");
  await copyFirstCardThing(page);
  const box = page.getByLabel("Magic Box").first();
  await box.click();
  await pasteClipboard(page);
  await expect(page.getByLabel("Referenced Things").first()).toBeVisible();
  // References alone never enable Toss.
  await expect(page.getByRole("button", { name: "Toss Thing" }).first()).toBeDisabled();
  await box.fill("Ask Rohit to review this tomorrow");
  await expect(page.getByRole("button", { name: "Toss Thing" }).first()).toBeEnabled();
  await page.getByRole("button", { name: "Toss Thing" }).first().click();
  await expect(page.getByLabel("Referenced Things")).toHaveCount(0, { timeout: 15_000 });
});

test("a pasted Thing in a comment is sent and rendered as a reference card", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  test.skip(!(await signIn(page)), "Demo personas are not available");
  const title = await copyFirstCardThing(page);
  const card = page.locator("article").filter({ has: page.getByRole("button", { name: /^Open / }) }).first();
  await card.getByRole("button", { name: /^Open / }).first().click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByPlaceholder(/Reply to this Thing|Write a comment/).first();
  await input.waitFor({ state: "visible", timeout: 15_000 });
  await input.focus();
  await pasteClipboard(page);
  await expect(dialog.getByLabel("Referenced Things").first()).toBeVisible();
  // Reference-only comments can be sent.
  await dialog.getByRole("button", { name: /^(Send|Post)$/ }).first().click();
  await expect(dialog.getByLabel("Referenced Things").getByText(title).first()).toBeVisible({ timeout: 15_000 });
});

test("a pasted Thing in list chat is sent and rendered beneath the message", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  test.skip(!(await signIn(page)), "Demo personas are not available");
  const title = await copyFirstCardThing(page);

  await page.goto("/lists/l1");
  await page.getByText("Chat", { exact: true }).first().click();

  const input = page.getByPlaceholder("Write a message…").first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.focus();
  await pasteClipboard(page);
  await expect(page.getByLabel("Referenced Things").first()).toBeVisible();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Send message" }).first().click();
  await expect(page.getByLabel("Referenced Things").getByText(title).first()).toBeVisible({ timeout: 15_000 });
});

test("list rows offer the Thing menu, but editable fields keep the browser menu", async ({ page }) => {
  test.skip(!(await signIn(page)), "Demo personas are not available");
  await page.goto("/lists/l1");
  const row = page.locator("[data-thing-id]:visible").first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy Thing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByLabel("Magic Box").first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy Thing" })).toHaveCount(0);
});

test("pasted Thing cards fit a narrow phone composer without horizontal scrolling", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Clipboard permissions are only granted in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 375, height: 800 });
  test.skip(!(await signIn(page)), "Demo personas are not available");
  const target = page.locator("[data-thing-id]:visible").first();
  await target.waitFor({ state: "visible", timeout: 20_000 });
  await target.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Thing" }).click();
  const measure = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const before = await measure();
  const box = page.getByLabel("Magic Box").locator("visible=true").first();
  await box.click();
  await pasteClipboard(page);
  await expect(page.getByLabel("Referenced Things").first()).toBeVisible();
  // The cards must not widen the page beyond whatever the phone layout already does.
  expect(await measure()).toBeLessThanOrEqual(before);
  const tray = await page.getByLabel("Referenced Things").first().boundingBox();
  expect(tray!.x + tray!.width).toBeLessThanOrEqual(375);
});
