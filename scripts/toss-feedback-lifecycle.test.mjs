import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { renderHook, act } from "@testing-library/react";
import { useTossFeedback } from "../src/features/court/use-toss-feedback.ts";

test("useTossFeedback: 8-second collapse timer, hover/focus pauses, and grouping", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());

  const thing1 = { id: "thing-1", title: "Task 1", status: "now" };
  const rawCourt = { now: [thing1], next: [], later: [] };
  const visibleCourt = { now: [thing1], next: [], later: [] };

  const { result } = renderHook(() =>
    useTossFeedback({
      userId: "user-1",
      context: "work",
      rawCourt,
      visibleCourt,
    }),
  );

  assert.equal(result.current.items.length, 0);
  assert.equal(result.current.collapsed, false);

  // Commit a new toss
  act(() => {
    result.current.recordCommit({
      createdIds: ["thing-1"],
      title: "Task 1",
      bucketFailedIds: [],
    });
  });

  assert.equal(result.current.items.length, 1);
  assert.equal(result.current.items[0].thingId, "thing-1");
  assert.equal(result.current.collapsed, false, "Starts uncollapsed");
  assert.equal(result.current.announcement, "Saved: Task 1");

  // Advance clock by 4 seconds (half of TOSS_RECEIPT_EXPAND_MS)
  act(() => {
    mock.timers.tick(4000);
  });
  assert.equal(result.current.collapsed, false, "Still uncollapsed at 4s");

  // Hover pauses collapse
  act(() => {
    result.current.setIsHovered(true);
  });

  // Advance by another 6 seconds (total 10s > 8s)
  act(() => {
    mock.timers.tick(6000);
  });
  assert.equal(result.current.collapsed, false, "Hover prevents collapse");

  // Unhover restarts/resumes collapse timer
  act(() => {
    result.current.setIsHovered(false);
  });

  // Advance by 8s
  act(() => {
    mock.timers.tick(8000);
  });
  assert.equal(result.current.collapsed, true, "Collapses after 8s unhovered");

  // Second toss arrives: receipt re-expands and groups new notice
  const thing2 = { id: "thing-2", title: "Task 2", status: "now" };
  act(() => {
    result.current.recordCommit({
      createdIds: ["thing-2"],
      title: "Task 2",
      bucketFailedIds: [],
    });
  });

  assert.equal(result.current.collapsed, false, "Re-expands on new toss");
  assert.equal(result.current.items.length, 2, "Items grouped together");
  assert.equal(result.current.announcement, "Saved: Task 2");
});

test("useTossFeedback: card emphasis 2s ring and 8s badge timers", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());

  const thing1 = { id: "thing-1", title: "Task 1", status: "now" };
  const rawCourt = { now: [thing1], next: [], later: [] };
  const visibleCourt = { now: [thing1], next: [], later: [] };

  const laneRefs = {
    current: {
      now: {
        getPosition: () => ({ activeIndex: 0, activeThingId: "thing-1" }),
        focusThing: () => {},
        revealThing: () => true,
      },
    },
  };

  const { result } = renderHook(() =>
    useTossFeedback({
      userId: "user-1",
      context: "work",
      rawCourt,
      visibleCourt,
      laneRefs,
    }),
  );

  act(() => {
    result.current.recordCommit({
      createdIds: ["thing-1"],
      title: "Task 1",
      bucketFailedIds: [],
    });
  });

  // Immediately visible on stack: ring: true, badge: "just-added"
  assert.equal(result.current.feedbackByThingId["thing-1"]?.ring, true, "Ring is active initially");
  assert.equal(result.current.feedbackByThingId["thing-1"]?.badge, "just-added", "Badge is just-added initially");

  // Advance 2s: ring clears, badge remains
  act(() => {
    mock.timers.tick(2000);
  });
  assert.equal(result.current.feedbackByThingId["thing-1"]?.ring, false, "Ring expires after 2s");
  assert.equal(result.current.feedbackByThingId["thing-1"]?.badge, "just-added", "Badge remains after 2s");

  // Advance to 8s: badge clears
  act(() => {
    mock.timers.tick(6000);
  });
  assert.equal(result.current.feedbackByThingId["thing-1"]?.badge, null, "Badge expires after 8s");

  // Explicit reveal on older item gives "here-it-is" badge and 2s ring
  act(() => {
    result.current.triggerCardEmphasis("thing-1");
  });
  assert.equal(result.current.feedbackByThingId["thing-1"]?.ring, true);
  assert.equal(result.current.feedbackByThingId["thing-1"]?.badge, "here-it-is");

  act(() => {
    mock.timers.tick(2000);
  });
  assert.equal(result.current.feedbackByThingId["thing-1"]?.ring, false);
});

test("useTossFeedback: identity or context switch clears state and timers", async (t) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => mock.timers.reset());

  let currentUserId = "user-1";
  let currentContext = "work";

  const { result, rerender } = renderHook(() =>
    useTossFeedback({
      userId: currentUserId,
      context: currentContext,
      rawCourt: { now: [], next: [], later: [] },
      visibleCourt: { now: [], next: [], later: [] },
    }),
  );

  act(() => {
    result.current.recordCommit({
      createdIds: ["thing-1"],
      title: "Task 1",
      bucketFailedIds: [],
    });
  });

  assert.equal(result.current.items.length, 1);

  // Switch context to "personal"
  currentContext = "personal";
  rerender();

  assert.equal(result.current.items.length, 0, "Receipt items cleared on context switch");
  assert.equal(result.current.collapsed, false);
  assert.deepEqual(result.current.feedbackByThingId, {}, "Card feedback cleared on context switch");

  // Add item, then switch user
  act(() => {
    result.current.recordCommit({
      createdIds: ["thing-2"],
      title: "Task 2",
      bucketFailedIds: [],
    });
  });
  assert.equal(result.current.items.length, 1);

  currentUserId = "user-2";
  rerender();

  assert.equal(result.current.items.length, 0, "Receipt items cleared on user switch");
});
