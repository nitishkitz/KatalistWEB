import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * T05: read-state.ts's (Thing comment) "last read" localStorage keys used
 * to be unscoped by identity (`katalist_thing_read_${thingId}`), which
 * leaked one profile's read state onto another's on a shared device or
 * after an account switch. Same hazard and fix shape as chat-read-
 * state.ts's own identical scoping (see chat-read-state-scoping.test.mjs).
 */

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = { update: () => node, eq: () => node, is: () => node, then: (resolve) => resolve({ data: null, error: null }) };
        return node;
      },
    },
  },
});

const { getThingLastReadAt, markThingAsRead, calculateCommentCounts } = await import("@/features/things/read-state");

function reset() {
  window.localStorage.clear();
}

test("two identities reading the same Thing on the same device do not share a last-read mark", () => {
  reset();
  markThingAsRead("thing-1", "actor-A");
  const aTime = getThingLastReadAt("thing-1", "actor-A");
  assert.ok(aTime > 0, "actor A's own mark is readable");

  const bTime = getThingLastReadAt("thing-1", "actor-B");
  assert.equal(bTime, 0, "actor B must not see actor A's last-read mark for the same Thing");
});

test("marking as read under one identity does not affect a different identity's mark", () => {
  reset();
  markThingAsRead("thing-1", "actor-A");
  markThingAsRead("thing-1", "actor-B");
  const aTimeBefore = getThingLastReadAt("thing-1", "actor-A");
  assert.ok(aTimeBefore > 0);

  markThingAsRead("thing-1", "actor-B");
  assert.equal(getThingLastReadAt("thing-1", "actor-A"), aTimeBefore, "actor A's mark is unaffected by actor B's write");
});

test("a pre-scoping unscoped legacy value is never read as a fallback for any specific identity", () => {
  reset();
  // Simulate a value written by the pre-scoping build of this feature.
  window.localStorage.setItem("katalist_thing_read_thing-1", String(Date.now()));

  assert.equal(getThingLastReadAt("thing-1", "actor-A"), 0, "the unscoped legacy value must not be credited to actor A (or any other specific identity)");
});

test("the legacy unscoped key is cleaned up once a scoped value is written", () => {
  reset();
  window.localStorage.setItem("katalist_thing_read_thing-1", String(Date.now()));
  markThingAsRead("thing-1", "actor-A");
  assert.equal(window.localStorage.getItem("katalist_thing_read_thing-1"), null, "the legacy unscoped key is removed once a scoped write has happened");
});

test("getThingLastReadAt/markThingAsRead are no-ops without a known identity", () => {
  reset();
  markThingAsRead("thing-1", undefined);
  assert.equal(getThingLastReadAt("thing-1", undefined), 0);
  assert.equal(window.localStorage.length, 0, "nothing is written to storage without an identity to scope it to");
});

test("calculateCommentCounts scopes its own lastRead lookup by currentActorId -- two identities do not share unread state for the same Thing", () => {
  reset();
  const comments = [{ authorActorId: "actor-other", createdAt: "2020-01-01T00:00:00Z" }];

  // Actor A reads the Thing (marks it read at "now", well after the comment).
  markThingAsRead("thing-1", "actor-A");
  const forA = calculateCommentCounts("thing-1", comments, "actor-A");
  assert.equal(forA.unreadCommentCount, 0, "actor A has read this Thing -- an old comment is not unread to them");

  // Actor B, on the same device, never read it -- must not inherit A's read mark.
  const forB = calculateCommentCounts("thing-1", comments, "actor-B");
  assert.equal(forB.unreadCommentCount, 1, "actor B's own unread state must be independent of actor A's");
});
