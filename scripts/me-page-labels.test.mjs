import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G06: two confirmed defects in me.tsx.
 * - "This week" labeled stats.weekly, which use-trophy.ts actually
 *   computes as a rolling 7-day window (now - 7 days), not a calendar
 *   week -- the label implied a Sunday/Monday reset that never happens.
 * - The synthetic "local-<digits>@katalist.local" address phone-based
 *   sign-in synthesizes (see src/lib/auth/local-user.ts) so Supabase's
 *   email-shaped auth internals still work was displayed as if it were
 *   a real contact email.
 */
const me = readFileSync(new URL("../src/routes/me.tsx", import.meta.url), "utf8");
const trophySql = readFileSync(new URL("../supabase/migrations/20260924210000_trophy_activity_stats.sql", import.meta.url), "utf8");

test("the rolling-7-day stat is labeled accurately, not \"This week\"", () => {
  assert.doesNotMatch(me, /label:\s*"This week"/);
  assert.match(me, /label:\s*"Last 7 days"/);
  // Confirms the underlying metric really is a rolling window, not a
  // calendar week -- the label fix matches the actual computation.
  assert.match(trophySql, /created_at\s*>=\s*now\(\)\s*-\s*interval\s*'7 days'/);
});

test("a synthetic @katalist.local auth email is never shown as a contact email", () => {
  assert.match(me, /isSyntheticAuthEmail\s*=\s*rawEmail\.endsWith\("@katalist\.local"\)/);
  assert.match(me, /const email = isSyntheticAuthEmail \? "" : rawEmail/);
});

test("G13: sorted/caught/streak tiles each render an explanatory hint, not just a bare number", () => {
  assert.match(me, /hint:\s*"Every sort counts, even on the same Thing twice"/);
  assert.match(me, /hint:\s*"Every catch counts, even on the same Thing twice"/);
  assert.match(me, /hint:\s*"Consecutive days with at least one Thing sorted"/);
  assert.match(me, /\{s\.hint\}/);
});
