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

// ── T10-02: bounded same-session fallback and same-realm contention ────────

test("T10-02: a throwing localStorage still yields a same-session fallback claim that survives a later read", async () => {
  window.localStorage.clear();
  const realGetItem = window.localStorage.getItem.bind(window.localStorage);
  const realSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.getItem = () => {
    throw new Error("storage disabled");
  };
  window.localStorage.setItem = () => {
    throw new Error("storage disabled");
  };
  try {
    const first = await claimMorningBriefPreview("actor-throw", "work", "2026-06-20", "America/New_York");
    assert.equal(first.claimed, true);

    // A second call in the same session (module state, not storage) must
    // see the first claim even though storage never actually persisted it.
    const second = await claimMorningBriefPreview("actor-throw", "work", "2026-06-20", "America/New_York");
    assert.equal(second.claimed, false, "the same-session fallback must remember the first claim");
    assert.equal(second.presentedAt, first.presentedAt);
  } finally {
    window.localStorage.getItem = realGetItem;
    window.localStorage.setItem = realSetItem;
  }
});

test("T10-02: malformed JSON in storage is not trusted as a receipt -- claim still succeeds fresh", async () => {
  window.localStorage.clear();
  window.localStorage.setItem("katalist.morning_brief.actor-malformed.work.2026-06-21", "{not json");

  const claim = await claimMorningBriefPreview("actor-malformed", "work", "2026-06-21", "America/New_York");
  assert.equal(claim.claimed, true, "malformed stored JSON must not be treated as an existing claim");
});

test("T10-02: malformed shape (valid JSON, wrong fields) in storage is not trusted as a receipt", async () => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "katalist.morning_brief.actor-badshape.work.2026-06-22",
    JSON.stringify({ presentedAt: "not-a-date" }),
  );

  const claim = await claimMorningBriefPreview("actor-badshape", "work", "2026-06-22", "America/New_York");
  assert.equal(claim.claimed, true, "a malformed stored shape must not be treated as an existing claim");
});

test("T10-02: two same-realm concurrent claims for the same key resolve to exactly one winner", async () => {
  window.localStorage.clear();
  const [a, b] = await Promise.all([
    claimMorningBriefPreview("actor-race", "work", "2026-06-23", "America/New_York"),
    claimMorningBriefPreview("actor-race", "work", "2026-06-23", "America/New_York"),
  ]);
  const claimedCount = [a, b].filter((r) => r.claimed).length;
  assert.equal(claimedCount, 1, "exactly one of two concurrent same-key claims must win");
  assert.equal(a.presentedAt, b.presentedAt, "the loser reports the same presentedAt as the winner");
});
