import { test, expect } from "@playwright/test";

/**
 * H04: local-coverage smoke specs against the preview dev server. Every
 * spec here is deliberately read-only / no-side-effect -- no sign-in, no
 * Thing/List/Bucket creation, no writes of any kind -- so it is safe to run
 * against whatever real Supabase project .env.local points at without a
 * disposable test database. Authenticated, data-mutating flows (Capture ->
 * Catch -> Sort, two-account checks, etc.) belong in tests/e2e/staging/,
 * gated on an explicit test account per playwright.config.ts.
 */

test.describe("entry routes render without a signed-in session", () => {
  test("/auth shows the phone/email OTP entry, no crash, no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    // Default channel's OTP entry is reachable without any prior state.
    await expect(page.getByPlaceholder(/enter your phone number|you@example\.com/i)).toBeVisible();

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("/welcome renders without requiring a session", async ({ page }) => {
    const response = await page.goto("/welcome");
    expect(response?.ok()).toBeTruthy();
  });
});

test.describe("Bridge: safe failure state for a token that cannot possibly be valid", () => {
  test("a malformed token shows the generic unavailable state, never a raw error or stack trace", async ({
    page,
  }) => {
    // Deliberately too short to pass bridge-session.server.ts's own length
    // check (20-512 chars) -- fails before ever touching the database, so
    // this is genuinely side-effect-free.
    await page.goto("/bridge/too-short");

    await expect(page.getByText(/this bridge isn.t available/i)).toBeVisible();
    const body = await page.textContent("body");
    // The safe, fixed message from bridgeError() -- never a raw Postgres
    // error, stack trace, or the token itself echoed back.
    expect(body).not.toMatch(/postgres|stack|at Object\.|too-short/i);
  });
});
