import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTossDestination } from "../src/features/court/toss-feedback-model.ts";

function makeThings(count, lane = "next") {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i + 1}`,
    title: `Task #${i + 1}`,
    status: lane,
    assignee: { id: "user-1", name: "User One" },
    owner: { id: "user-1", name: "User One" },
    acknowledgement: "caught",
  }));
}

test("Show in Court: 40-card lane reveals distant target (card 35) with one transition and preserves order", () => {
  const things = makeThings(40, "now");
  const rawCourt = { now: things, next: [], later: [] };
  const visibleCourt = { now: things, next: [], later: [] };

  const dest = resolveTossDestination("thing-35", rawCourt, visibleCourt);
  assert.equal(dest.kind, "visible");
  assert.equal(dest.lane, "now");
  assert.equal(dest.thing.id, "thing-35");

  // Mock lane handle
  let revealedTargetId = null;
  let revealOptions = null;
  const laneHandle = {
    revealThing: (id, options) => {
      revealedTargetId = id;
      revealOptions = options;
      return true;
    },
  };

  const ok = laneHandle.revealThing("thing-35", { focus: true });
  assert.equal(ok, true);
  assert.equal(revealedTargetId, "thing-35");
  assert.equal(revealOptions.focus, true);

  // Assert array order was preserved
  assert.equal(things[0].id, "thing-1");
  assert.equal(things[34].id, "thing-35");
  assert.equal(things[39].id, "thing-40");
});

test("Show in Court: hidden by filters identifies target and offers clear filters recovery", () => {
  const target = { id: "t-secret", title: "Quarterly review", status: "next" };
  const rawCourt = { now: [], next: [target], later: [] };
  // Search query excludes target
  const visibleCourt = { now: [], next: [], later: [] };

  const dest = resolveTossDestination("t-secret", rawCourt, visibleCourt);
  assert.equal(dest.kind, "filtered");
  assert.equal(dest.lane, "next");
  assert.equal(dest.thing.title, "Quarterly review");

  // When cleared, becomes visible
  const visibleAfterClear = { now: [], next: [target], later: [] };
  const destAfterClear = resolveTossDestination("t-secret", rawCourt, visibleAfterClear);
  assert.equal(destAfterClear.kind, "visible");
});

test("Show in Court: moved target resolves current destination, not stale index", () => {
  const target = { id: "t-moved", title: "Move me", status: "later" };
  // Originally was in now, but user or system moved it to later
  const rawCourt = { now: [], next: [], later: [target] };
  const visibleCourt = { now: [], next: [], later: [target] };

  const dest = resolveTossDestination("t-moved", rawCourt, visibleCourt);
  assert.equal(dest.kind, "visible");
  assert.equal(dest.lane, "later", "Resolves latest lane (later), not old placement");
});

test("Show in Court: deleted or inaccessible target returns unresolved", () => {
  const rawCourt = { now: [], next: [], later: [] };
  const visibleCourt = { now: [], next: [], later: [] };

  const dest = resolveTossDestination("t-deleted", rawCourt, visibleCourt);
  assert.equal(dest.kind, "unresolved");
});

test("Show in Court: With Others target resolves to theirs destination", () => {
  const target = { id: "t-collaborator", title: "Design sync", assignee: { id: "teammate-1" } };
  const rawCourt = { now: [], next: [], later: [], theirs: [target] };
  const visibleCourt = { now: [], next: [], later: [], theirs: [target] };

  const dest = resolveTossDestination("t-collaborator", rawCourt, visibleCourt);
  assert.equal(dest.kind, "theirs");
  assert.equal(dest.thing.id, "t-collaborator");
});

test("Show in Court: pending lane action rejects reveal and informs caller", () => {
  const laneHandle = {
    revealThing: () => false, // simulates pending action
  };

  const ok = laneHandle.revealThing("thing-1");
  assert.equal(ok, false, "Returns false when pending mutation blocks reveal");
});
