import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { liveEnv } from "./env";
import { signInWithPhone, assertIdentity, PhoneLoginUnavailable } from "./auth";

export const RESULTS_DIR = path.resolve("test-results/live");
const LEDGER = path.join(RESULTS_DIR, "fixture-ledger.csv");
const OBSERVATIONS = path.join(RESULTS_DIR, "observations.jsonl");

export type Observation = {
  checkId: number;
  caseRef: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  accountA: string;
  accountB?: string;
  afterRefresh?: string;
  note?: string;
};

/** Append-only; contains no credentials. Reviewed by a human before copying to EXECUTION_TRACKER.csv. */
export function record(obs: Observation) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const env = liveEnv();
  appendFileSync(
    OBSERVATIONS,
    JSON.stringify({ ...obs, build: env.build, timezone: env.timezone, at: new Date().toISOString() }) + "\n",
  );
}

export function ledger(kind: string, name: string, context: "work" | "home", owner: "A" | "B", extra = "") {
  mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(LEDGER)) writeFileSync(LEDGER, "created_at,kind,name,context,owner,note\n");
  appendFileSync(LEDGER, `${new Date().toISOString()},${kind},"${name.replace(/"/g, '""')}",${context},${owner},"${extra}"\n`);
}

type Sessions = { a: Page; b: Page; ctxA: BrowserContext; ctxB: BrowserContext; identityA: string; identityB: string };

/**
 * Two independent browser contexts (separate cookie jars / storage), the
 * automated equivalent of two browser profiles. Storage state is never saved
 * to disk, so no session token is persisted.
 */
export const test = base.extend<{ sessions: Sessions }>({
  sessions: async ({ browser }, provideSessions, testInfo) => {
    const env = liveEnv();
    // No tracing/recording is enabled on these contexts (credentials are typed on /auth).
    const ctxA = await browser.newContext({ baseURL: env.baseURL, timezoneId: env.timezone });
    const ctxB = await browser.newContext({ baseURL: env.baseURL, timezoneId: env.timezone });
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    try {
      await Promise.all([signInWithPhone(a, env.accounts.A), signInWithPhone(b, env.accounts.B)]);
      const identityA = await assertIdentity(a, "A");
      const identityB = await assertIdentity(b, "B");
      expect(identityA, "A and B must be different identities").not.toBe(identityB);
      await provideSessions({ a, b, ctxA, ctxB, identityA, identityB });
    } catch (error) {
      if (error instanceof PhoneLoginUnavailable) {
        testInfo.annotations.push({ type: "BLOCKED", description: error.message });
        testInfo.skip(true, `BLOCKED: ${error.message}`);
      }
      throw error;
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  },
});

export { expect };
