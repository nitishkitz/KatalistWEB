import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TOSS_CARD_EMPHASIS_MS,
  TOSS_BADGE_MS,
  TOSS_RECEIPT_EXPAND_MS,
  resolveTossDestination,
  mergeTossNoticeIntoItems,
  hydrateTossFeedbackItems,
  formatDestinationLabel,
} from "../src/features/court/toss-feedback-model.ts";

test("Toss timing constants match proposed product specifications", () => {
  assert.equal(TOSS_CARD_EMPHASIS_MS, 2000, "Card emphasis is 2000ms");
  assert.equal(TOSS_BADGE_MS, 8000, "Just added badge is 8000ms");
  assert.equal(TOSS_RECEIPT_EXPAND_MS, 8000, "Receipt expand timeout is 8000ms");
});

test("resolveTossDestination: resolves visible lane when Thing is present in visibleCourt", () => {
  const thing = { id: "t-1", title: "Review mockups", status: "next" };
  const visibleCourt = {
    now: [],
    next: [thing],
    later: [],
  };
  const rawCourt = {
    now: [],
    next: [thing],
    later: [],
  };

  const res = resolveTossDestination("t-1", rawCourt, visibleCourt);
  assert.deepEqual(res, {
    kind: "visible",
    lane: "next",
    thing,
  });
  assert.equal(formatDestinationLabel(res), "Added to Next");
});

test("resolveTossDestination: resolves filtered lane when Thing is in rawCourt but not in visibleCourt", () => {
  const thing = { id: "t-2", title: "Urgent fix", status: "now" };
  const visibleCourt = {
    now: [],
    next: [],
    later: [],
  };
  const rawCourt = {
    now: [thing],
    next: [],
    later: [],
  };

  const res = resolveTossDestination("t-2", rawCourt, visibleCourt);
  assert.deepEqual(res, {
    kind: "filtered",
    lane: "now",
    thing,
  });
  assert.equal(formatDestinationLabel(res), "Added to Now, hidden by current filters");
});

test("resolveTossDestination: returns unresolved when Thing is not in rawCourt or visibleCourt", () => {
  const visibleCourt = { now: [], next: [], later: [] };
  const rawCourt = { now: [], next: [], later: [] };

  const res = resolveTossDestination("t-missing", rawCourt, visibleCourt);
  assert.deepEqual(res, { kind: "unresolved" });
  assert.equal(formatDestinationLabel(res), "Saved · locating in Court…");

  // Missing or empty ID
  assert.deepEqual(resolveTossDestination("", rawCourt, visibleCourt), { kind: "unresolved" });
  assert.deepEqual(resolveTossDestination("t-1", null, null), { kind: "unresolved" });
});

test("mergeTossNoticeIntoItems: handles single and multiple created IDs with deduplication", () => {
  const notice1 = {
    createdIds: ["t-1"],
    title: "Write documentation",
    bucketFailedIds: [],
  };

  const items1 = mergeTossNoticeIntoItems([], notice1, null, null, 1000);
  assert.equal(items1.length, 1);
  assert.equal(items1[0].thingId, "t-1");
  assert.equal(items1[0].title, "Write documentation");
  assert.equal(items1[0].destination.kind, "unresolved");

  // Replay of same notice or existing ID does not duplicate
  const itemsReplay = mergeTossNoticeIntoItems(items1, notice1, null, null, 1005);
  assert.equal(itemsReplay.length, 1, "Deduplication prevents re-adding t-1");

  // Multi-create notice
  const notice2 = {
    createdIds: ["t-2", "t-3"],
    title: "Import tasks",
    bucketFailedIds: [],
  };

  const items2 = mergeTossNoticeIntoItems(items1, notice2, null, null, 1010);
  assert.equal(items2.length, 3, "New items merged without duplicates");
  assert.equal(items2[1].thingId, "t-2");
  assert.equal(items2[1].title, "Import tasks (1)");
  assert.equal(items2[2].thingId, "t-3");
  assert.equal(items2[2].title, "Import tasks (2)");
});

test("hydrateTossFeedbackItems: updates unresolved destinations and hydrates canonical titles", () => {
  const initialItems = [
    {
      thingId: "t-1",
      title: "Write documentation",
      destination: { kind: "unresolved" },
      status: "saved",
      createdAt: 1000,
    },
    {
      thingId: "t-2",
      title: "Import tasks (1)",
      destination: { kind: "unresolved" },
      status: "saved",
      createdAt: 1010,
    },
  ];

  // Raw court arrives after refetch
  const thing1 = { id: "t-1", title: "Write API documentation (canonical)", status: "later" };
  const thing2 = { id: "t-2", title: "Setup staging DB", status: "now" };

  const rawCourt = {
    now: [thing2],
    next: [],
    later: [thing1],
  };
  const visibleCourt = {
    now: [],
    next: [],
    later: [thing1], // t-1 is visible, t-2 is filtered
  };

  const { items: hydrated, changed } = hydrateTossFeedbackItems(initialItems, rawCourt, visibleCourt);

  assert.equal(changed, true);
  assert.equal(hydrated[0].destination.kind, "visible");
  assert.equal(hydrated[0].destination.lane, "later");
  assert.equal(hydrated[0].title, "Write API documentation (canonical)", "Title hydrated from canonical Thing");

  assert.equal(hydrated[1].destination.kind, "filtered");
  assert.equal(hydrated[1].destination.lane, "now");
  assert.equal(hydrated[1].title, "Setup staging DB", "Title hydrated from canonical Thing");
});

test("resolveTossDestination: resolves theirs destination when Thing is in theirs array", () => {
  const thing = { id: "t-theirs", title: "Review with teammate", assignee: { id: "user-2" } };
  const rawCourt = { now: [], next: [], later: [], theirs: [thing] };
  const visibleCourt = { now: [], next: [], later: [], theirs: [thing] };

  const res = resolveTossDestination("t-theirs", rawCourt, visibleCourt);
  assert.deepEqual(res, {
    kind: "theirs",
    thing,
  });
  assert.equal(formatDestinationLabel(res), "Added to With Others");
});
