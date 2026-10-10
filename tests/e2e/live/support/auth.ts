import { expect, type Page } from "@playwright/test";
import { liveEnv, redact, type LiveAccount } from "./env";

/**
 * Phone + fixed test-code sign-in. The phone tab only exists when the target
 * deployment sets VITE_KATALIST_FIXED_OTP; when it is absent the harness
 * reports BLOCKED (throws a recognisable error) rather than guessing.
 */
export class PhoneLoginUnavailable extends Error {}

export async function signInWithPhone(page: Page, account: LiveAccount): Promise<void> {
  try {
    await signInWithPhoneUnsafe(page, account);
  } catch (error) {
    if (error instanceof PhoneLoginUnavailable) throw error;
    // Playwright call logs can echo typed values; never let them reach reports.
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 400);
    throw new Error(`Sign-in for account ${account.alias} failed: ${message}`);
  }
}

async function signInWithPhoneUnsafe(page: Page, account: LiveAccount): Promise<void> {
  const { otp } = liveEnv();
  await page.goto("/auth");
  const tel = page.locator("#kg-tel");
  if (!(await tel.isVisible().catch(() => false))) {
    const usePhone = page.getByRole("button", { name: "Use phone instead" });
    if (await usePhone.isVisible({ timeout: 8_000 }).catch(() => false)) await usePhone.click();
  }
  if (!(await tel.isVisible({ timeout: 8_000 }).catch(() => false))) {
    throw new PhoneLoginUnavailable("Phone sign-in is not offered by this deployment (no fixed test code configured).");
  }
  await page.locator("#kg-cc").selectOption(account.dialCode);
  await tel.fill(account.phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.locator("#kg-otp").fill(otp);
  // The input auto-submits at six digits; fall through to the button if not.
  const verify = page.getByRole("button", { name: "Verify code" });
  if (await verify.isVisible().catch(() => false)) await verify.click().catch(() => {});
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30_000 });
}

/**
 * Mandatory identity gate. The Me page must show the expected display name for
 * the alias, and the other alias's name must not appear. Any mismatch aborts
 * the run before a write is attempted.
 */
export async function assertIdentity(page: Page, alias: "A" | "B"): Promise<string> {
  const env = liveEnv();
  const expected = env.expectedName[alias];
  const other = env.expectedName[alias === "A" ? "B" : "A"];
  expect(expected.toLowerCase(), "A and B expected names must differ").not.toBe(other.toLowerCase());
  await page.goto("/me");
  const body = page.locator("main, body").first();
  await expect(body.getByText(expected, { exact: false }).first(), `Me page must show ${alias}'s expected name`).toBeVisible({
    timeout: 15_000,
  });
  if (!other.toLowerCase().includes(expected.toLowerCase()) && !expected.toLowerCase().includes(other.toLowerCase())) {
    await expect(body.getByText(other, { exact: false }), `Me page for ${alias} must not show the other account's name`).toHaveCount(0);
  }
  return expected;
}
