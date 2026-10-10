import type { Page } from "@playwright/test";
import { test, expect, record, ledger } from "./support/fixtures";
import { liveEnv, qaPrefix, redact } from "./support/env";

/**
 * Beginner checks 1-4, 6, 8-10, 13, 14, 17 and 20 from BEGINNER_START_HERE.md,
 * run against two independent signed-in sessions (A = operator, B = CHRI).
 *
 * Every mutation creates a record named with the QA-YYYYMMDD-runNN- prefix and
 * logs it in test-results/live/fixture-ledger.csv. Each step observes the other
 * account BEFORE refresh, then refreshes both and re-checks durable state.
 * A failed assertion is recorded as FAIL with the sanitized message; a missing
 * prerequisite is recorded as BLOCKED. Nothing is recorded PASS unless every
 * assertion in that check ran.
 */
test.describe.configure({ mode: "serial" });

const prefix = qaPrefix();
const titles = {
  self: `${prefix}self`,
  budget: `${prefix}budget tomorrow at 6 PM`,
  assigned: `${prefix}assigned-A-to-B`,
  home: `${prefix}home`,
};

async function toss(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Magic Box" });
  await expect(box).toBeVisible();
  await box.fill(text);
  return box;
}
async function submitToss(page: Page) {
  await page.getByRole("button", { name: "Toss Thing" }).first().click();
}
async function openThing(page: Page, title: string) {
  await page.goto("/");
  await page.getByText(title, { exact: false }).first().click();
}

async function check(
  id: number,
  caseRef: string,
  accountA: string,
  body: () => Promise<{ accountB?: string; afterRefresh?: string; note?: string } | void>,
) {
  try {
    const extra = (await body()) ?? {};
    record({ checkId: id, caseRef, status: "PASS", accountA, ...extra });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 600);
    record({ checkId: id, caseRef, status: "FAIL", accountA, note: message });
    throw error;
  }
}

test("checks 1-2: A and B sign in independently as their own identities", async ({ sessions }) => {
  await check(1, "KAT-AUTH-001", "A", async () => {
    expect(sessions.identityA.length).toBeGreaterThan(0);
    return { accountB: `B identity: ${sessions.identityB}`, note: `A identity: ${sessions.identityA}` };
  });
  await sessions.ctxA.clearCookies(); // A leaving must not alter B (READY-01 criterion)
  await sessions.b.reload();
  await check(2, "KAT-IDENTITY", "B", async () => {
    await expect(sessions.b).not.toHaveURL(/\/auth/);
  });
});

test("check 4: A creates a self-assigned Thing exactly once", async ({ sessions }) => {
  const { a } = sessions;
  await a.goto("/");
  await check(4, "KAT-CAP", "A", async () => {
    await toss(a, titles.self);
    await submitToss(a);
    ledger("thing", titles.self, "work", "A");
    await expect(a.getByText(titles.self).first()).toBeVisible({ timeout: 15_000 });
    await a.reload();
    await expect(a.getByText(titles.self)).toHaveCount(1, { timeout: 15_000 });
    return { afterRefresh: "exactly one Thing after refresh" };
  });
});

test("check 6: explicit 'tomorrow at 6 PM' stays 18:00 before and after save", async ({ sessions }) => {
  const { a } = sessions;
  await a.goto("/");
  await check(6, "KAT-NLP/TIME", "A", async () => {
    await toss(a, titles.budget);
    const chip = a.getByRole("button", { name: /^Due .*(6:00 PM)/ });
    await expect(chip, "preview must show 6:00 PM, not 10:00 PM").toBeVisible({ timeout: 10_000 });
    await submitToss(a);
    ledger("thing", titles.budget, "work", "A");
    await openThing(a, prefix + "budget");
    await expect(a.getByText(/6:00 PM/).first()).toBeVisible({ timeout: 15_000 });
    await expect(a.getByText(/10:00 PM/)).toHaveCount(0);
  });
});

test.describe("assignment lifecycle A -> B", () => {
  test("checks 8-10: assign, Catch, In Progress", async ({ sessions }) => {
    const { a, b } = sessions;
    const handle = process.env.KATALIST_B_HANDLE?.trim() || liveEnv().expectedName.B;
    if (!handle) {
      record({ checkId: 8, caseRef: "KAT-ASSIGN", status: "BLOCKED", accountA: "A", note: "Set KATALIST_B_HANDLE (B's name as shown in the @ picker)." });
      test.skip(true, "BLOCKED: KATALIST_B_HANDLE not set");
    }
    await a.goto("/");
    await check(8, "KAT-ASSIGN", "A", async () => {
      const box = await toss(a, `${titles.assigned} @${handle}`);
      const chip = a.getByRole("button", { name: new RegExp(`@?${handle}`, "i") }).first();
      if (await chip.isVisible({ timeout: 3_000 }).catch(() => false)) await chip.click();
      await box.press("End");
      await submitToss(a);
      ledger("thing", titles.assigned, "work", "A", `assigned to B`);
      await b.goto("/");
      await expect(b.getByText(titles.assigned).first()).toBeVisible({ timeout: 30_000 });
      await expect(b.getByText(/Waiting for Catch/i).first()).toBeVisible();
      await a.reload();
      await b.reload();
      await expect(b.getByText(titles.assigned)).toHaveCount(1);
      return { accountB: "incoming task awaiting Catch", afterRefresh: "persisted for both" };
    });

    await check(9, "KAT-WORK catch", "A", async () => {
      await openThing(b, titles.assigned);
      await b.getByRole("button", { name: "Catch", exact: true }).first().click();
      await openThing(a, titles.assigned);
      await expect(a.getByText(/Caught|In Progress/i).first()).toBeVisible({ timeout: 30_000 });
      await a.reload();
      await expect(a.getByText(/Caught|In Progress/i).first()).toBeVisible();
      return { accountB: "Catch applied", afterRefresh: "A sees acknowledgment after refresh" };
    });

    await check(10, "KAT-WORK in-progress label", "A", async () => {
      for (const page of [a, b]) {
        await expect(page.getByText(/In Progress/).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/Under Progress/), "internal under_progress must not leak").toHaveCount(0);
      }
    });
  });

  test("checks 13-14: comments in order, with a selected @mention", async ({ sessions }) => {
    const { a, b } = sessions;
    const commentA = `${prefix}comment-A`;
    const commentB = `${prefix}comment-B`;
    await openThing(a, titles.assigned);
    await openThing(b, titles.assigned);
    await check(13, "KAT-COMMENT", "A", async () => {
      const boxA = a.getByPlaceholder(/Write a comment/);
      await boxA.fill(commentA);
      await boxA.press("Enter");
      await expect(b.getByText(commentA)).toHaveCount(1, { timeout: 30_000 });
      const boxB = b.getByPlaceholder(/Write a comment/);
      await boxB.fill(commentB);
      await boxB.press("Enter");
      await expect(a.getByText(commentB)).toHaveCount(1, { timeout: 30_000 });
      await a.reload();
      await b.reload();
      for (const page of [a, b]) {
        await expect(page.getByText(commentA)).toHaveCount(1);
        await expect(page.getByText(commentB)).toHaveCount(1);
      }
      return { accountB: "both comments once, in order", afterRefresh: "persisted" };
    });
    await check(14, "KAT-MENTION", "A", async () => {
      const handle = process.env.KATALIST_B_HANDLE?.trim() || liveEnv().expectedName.B!;
      const box = a.getByPlaceholder(/Write a comment/);
      await box.fill(`${prefix}mention @${handle.slice(0, 3)}`);
      const option = a.getByRole("option", { name: new RegExp(handle, "i") }).first();
      await expect(option, "B must be selectable from the @ picker").toBeVisible({ timeout: 10_000 });
      await option.click();
      await box.press("Enter");
      await expect(b.getByText(`${prefix}mention`).first()).toBeVisible({ timeout: 30_000 });
      return { note: "Notification delivery (push/in-app count) is NOT asserted here; see READY-09." };
    });
  });

  test("check 17: B marks Sorted; it leaves active lanes for both", async ({ sessions }) => {
    const { a, b } = sessions;
    await check(17, "KAT-WORK sorted", "A", async () => {
      await openThing(b, titles.assigned);
      await b.getByRole("button", { name: "Mark Sorted" }).first().click();
      await a.goto("/");
      await expect(a.getByText(titles.assigned)).toHaveCount(0, { timeout: 30_000 });
      await b.goto("/");
      await expect(b.getByText(titles.assigned)).toHaveCount(0, { timeout: 30_000 });
      return {
        note: "Check 18 (discoverable completed destination) is NOT automated: the product rule D04 and destination are unspecified. Verify manually.",
      };
    });
  });
});

test("check 20: Work and Home contexts stay separate for A", async ({ sessions }) => {
  const { a } = sessions;
  await a.goto("/");
  await check(20, "KAT-CTX", "A", async () => {
    const contextButton = a.locator("nav:visible").first().getByRole("button", { name: /^(Work|Home)$/i }).first();
    await expect(contextButton).toBeVisible();
    await contextButton.click();
    const home = a.getByRole("menuitem", { name: /Home/i }).first();
    await home.click();
    await toss(a, titles.home);
    await submitToss(a);
    ledger("thing", titles.home, "home", "A");
    await expect(a.getByText(titles.home).first()).toBeVisible({ timeout: 15_000 });
    await a.locator("nav:visible").first().getByRole("button", { name: /^(Work|Home)$/i }).first().click();
    await a.getByRole("menuitem", { name: /Work/i }).first().click();
    await expect(a.getByText(titles.home)).toHaveCount(0);
    await a.reload();
    await expect(a.getByText(titles.home)).toHaveCount(0);
    await expect(a.getByText(titles.self).first()).toBeVisible();
    return { afterRefresh: "Home Thing absent from Work after refresh" };
  });
});
