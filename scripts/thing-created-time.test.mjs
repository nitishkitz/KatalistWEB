import assert from "node:assert/strict";
import test from "node:test";

import { formatThingCreatedAt } from "@/features/court/thing-time";

const now = new Date("2026-08-28T12:00:00.000Z");

test("formats a recent Thing creation time as a relative label", () => {
  assert.equal(formatThingCreatedAt("2026-08-28T11:50:00.000Z", now), "10m ago");
  assert.equal(formatThingCreatedAt("2026-08-28T10:00:00.000Z", now), "2h ago");
});

test("formats older Thing creation times without fabricating missing values", () => {
  assert.equal(formatThingCreatedAt("2026-08-27T12:00:00.000Z", now), "Yesterday");
  assert.equal(formatThingCreatedAt("2026-08-25T12:00:00.000Z", now), "3d ago");
  assert.equal(formatThingCreatedAt(null, now), null);
  assert.equal(formatThingCreatedAt("not-a-date", now), null);
});
