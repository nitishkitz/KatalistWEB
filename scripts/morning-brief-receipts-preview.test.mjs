import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimMorningBriefPreview,
  dismissMorningBriefPreview,
} from "@/features/catchup/morning-brief-receipts";

/**
 * F02: the preview/demo receipt adapter, tested directly against real
 * localStorage (via dom-test-setup.mjs). The live RPC adapter is tested
 * separately in morning-brief-receipts-live.test.mjs, which needs to mock
 * @/integrations/supabase/rpcs BEFORE this module's first import -- kept
 * in its own file so that mock doesn't need to coexist with this one's
 * unmocked, real import.
 */

test("claimMorningBriefPreview: first claim for a (actor, context, date) succeeds; a second is reported as not claimed", async () => {
  window.localStorage.clear();

  const first = await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");
  assert.equal(first.claimed, true);

  const second = await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");
  assert.equal(second.claimed, false);
  assert.equal(second.presentedAt, first.presentedAt, "reports the SAME presentedAt as the original claim, not a new one");
});

test("claimMorningBriefPreview: isolated per actor, per context, and per local date", async () => {
  window.localStorage.clear();

  await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");

  assert.equal(
    (await claimMorningBriefPreview("actor-2", "work", "2026-06-15", "America/New_York")).claimed,
    true,
    "a different actor gets their own slot",
  );
  assert.equal(
    (await claimMorningBriefPreview("actor-1", "home", "2026-06-15", "America/New_York")).claimed,
    true,
    "a different context gets its own slot",
  );
  assert.equal(
    (await claimMorningBriefPreview("actor-1", "work", "2026-06-16", "America/New_York")).claimed,
    true,
    "the next day gets its own slot -- this is not a rolling 24h cooldown",
  );
});

test("dismissMorningBriefPreview: a no-op without a prior claim (never creates a row on its own)", async () => {
  window.localStorage.clear();

  dismissMorningBriefPreview("actor-1", "work", "2026-06-15");
  // Still claimable afterward -- dismiss-without-claim did not consume the slot.
  const claim = await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");
  assert.equal(claim.claimed, true);
});

test("dismissMorningBriefPreview: does not un-claim -- the slot stays claimed after dismissal", async () => {
  window.localStorage.clear();

  await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");
  dismissMorningBriefPreview("actor-1", "work", "2026-06-15");

  const reclaim = await claimMorningBriefPreview("actor-1", "work", "2026-06-15", "America/New_York");
  assert.equal(reclaim.claimed, false, "dismissal must not resurrect the not-yet-shown-today state");
});
