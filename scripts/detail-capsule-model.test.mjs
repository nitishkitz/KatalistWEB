import assert from "node:assert/strict";
import test from "node:test";
import { getThingCapabilities } from "../src/domain/capabilities.ts";
import {
  handledToday,
  localDayKey,
  parseDailyReceipt,
  scopeCounts,
  scopeNotifications,
} from "../src/features/catchup/detail-capsule-model.ts";

const day = "2026-09-29";
const receipt = { day, actions: [{ thingId: "one", action: "nudge", at: 2000 }] };
const thing = (id, status = "not_started", acknowledgement = "waiting_for_catch") => ({
  id,
  workStatus: status,
  acknowledgement,
  cancelledAt: null,
});
test("opening a Thing does not hide its remaining actions, including old saved receipts", () => {
  assert.equal(
    handledToday({ day, actions: [{ thingId: "one", action: "open", at: 2000 }] }, "one", day),
    false,
  );
  assert.equal(
    handledToday(
      { day, actions: [...receipt.actions, { thingId: "one", action: "open", at: 4000 }] },
      "one",
      day,
      { createdAt: new Date(3000).toISOString() },
    ),
    false,
  );
});
test("waiting Things offer Nudge to their owner and Catch to their assignee", () => {
  const waiting = { ...thing("one"), owner: { id: "owner" }, assignee: { id: "assignee" } };
  assert.equal(getThingCapabilities(waiting, "owner").canNudge, true);
  assert.equal(getThingCapabilities(waiting, "owner").canCatch, false);
  assert.equal(getThingCapabilities(waiting, "assignee").canNudge, false);
  assert.equal(getThingCapabilities(waiting, "assignee").canCatch, true);
  assert.equal(getThingCapabilities(waiting, "viewer").canNudge, false);
  assert.equal(getThingCapabilities(waiting, null).canNudge, false);
  assert.equal(
    getThingCapabilities({ ...waiting, assignee: { id: "owner" } }, "owner").canNudge,
    false,
  );
  for (const workStatus of ["sorted", "cancelled"]) {
    assert.equal(getThingCapabilities({ ...waiting, workStatus }, "owner").canNudge, false);
    assert.equal(getThingCapabilities({ ...waiting, workStatus }, "assignee").canCatch, false);
  }
});
test("a handled Thing resurfaces for a later distinct incoming nudge", () => {
  assert.equal(handledToday(receipt, "one", day), true);
  assert.equal(
    handledToday(receipt, "one", day, { createdAt: new Date(1000).toISOString() }),
    true,
  );
  assert.equal(
    handledToday(receipt, "one", day, { createdAt: new Date(3000).toISOString() }),
    false,
  );
});
test("daily receipts expire tomorrow without altering underlying status", () => {
  assert.equal(handledToday(receipt, "one", "2026-09-30"), false);
  assert.deepEqual(parseDailyReceipt(JSON.stringify(receipt), "2026-09-30"), {
    day: "2026-09-30",
    actions: [],
  });
  assert.equal(localDayKey(new Date(2026, 8, 29, 23, 59)), day);
  assert.equal(localDayKey(new Date(2026, 8, 30, 0, 0)), "2026-09-30");
});
test("scope totals reflect Things independently of attention receipts", () => {
  const things = [
    thing("one"),
    thing("two", "sorted"),
    thing("three", "under_progress", "caught"),
    thing("four", "not_started", "caught"),
    thing("five", "cancelled"),
  ];
  assert.deepEqual(scopeCounts(things), { pending: 1, waiting: 1, moving: 1, sorted: 1 });
  assert.equal(handledToday(receipt, "one", day), true);
  assert.equal(scopeCounts(things).waiting, 1);
});
test("notification scope never admits unrelated Things or list-only notices", () => {
  assert.deepEqual(
    scopeNotifications(
      [
        { id: "a", thingId: "one" },
        { id: "b", thingId: "other" },
        { id: "c", thingId: null },
      ],
      [thing("one")],
    ).map((item) => item.id),
    ["a"],
  );
});
test("corrupt daily storage is ignored without losing valid receipts", () => {
  assert.deepEqual(parseDailyReceipt("bad json", day), { day, actions: [] });
  assert.deepEqual(
    parseDailyReceipt(
      JSON.stringify({
        day,
        actions: [null, { thingId: "one", action: "invalid", at: 2 }, receipt.actions[0]],
      }),
      day,
    ),
    receipt,
  );
});
