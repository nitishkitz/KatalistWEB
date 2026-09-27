import { test, expect } from "@playwright/test";

/**
 * J14 (section 6), browser half. The SQL/authorization-matrix half (valid/
 * expired/revoked/wrong-recipient/wrong-session/terminal/unrelated-Thing,
 * plus the new client_token idempotency migration) is already covered
 * against a real Postgres-compatible engine by T14's
 * `scripts/bridge-authorization-sql.test.mjs`. This complements that with
 * the CLIENT route's own error handling for a few more malformed/unknown
 * token shapes beyond `smoke.spec.ts`'s single too-short case -- proving
 * the SAME safe, generic message renders regardless of which invalid
 * shape a token takes, never a raw error/stack/the token itself.
 *
 * Read-only / no-side-effect, matching this directory's own contract (see
 * tests/e2e/preview/README.md): none of these tokens can ever redeem a
 * real grant (they are either too short to reach the database at all, or
 * well-formed-but-fabricated and thus rejected by the RPC's own NOT FOUND
 * branch with no INSERT).
 */

const UNSAFE_PATTERNS = /postgres|stack|at Object\.|Error:|SyntaxError|TypeError/i;

test.describe("Bridge: every invalid token shape renders the same safe, generic failure", () => {
  test("an empty token segment", async ({ page }) => {
    await page.goto("/bridge/");
    // Either a 404 route or the same generic Bridge failure -- either way,
    // never a raw error/stack.
    const body = await page.textContent("body");
    expect(body).not.toMatch(UNSAFE_PATTERNS);
  });

  test("a well-formed-length but entirely fabricated token", async ({ page }) => {
    // 64 hex-looking characters -- passes bridge-session.server.ts's
    // 20-512 length check, so this one actually reaches the redeem RPC
    // (or, in CI against unreachable fixture credentials, a connection
    // failure) -- either way must resolve to the same generic message.
    const fabricated = "a".repeat(32) + "b".repeat(32);
    await page.goto(`/bridge/${fabricated}`);
    await expect(page.getByText(/this bridge isn.t available/i)).toBeVisible({ timeout: 10_000 });
    const body = await page.textContent("body");
    expect(body).not.toMatch(UNSAFE_PATTERNS);
    expect(body).not.toContain(fabricated);
  });

  test("a token containing path-like/special characters", async ({ page }) => {
    const weird = "../../etc/passwd%00" + "x".repeat(20);
    await page.goto(`/bridge/${encodeURIComponent(weird)}`);
    const body = await page.textContent("body");
    expect(body).not.toMatch(UNSAFE_PATTERNS);
    expect(body).not.toContain(weird);
  });
});
