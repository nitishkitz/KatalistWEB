import assert from "node:assert/strict";
import test from "node:test";

import { classifyFirebaseError, notificationPath, retryDelayMs } from "@/features/notifications/push-delivery";

test("resolves trusted notification paths from Thing and List ids", () => {
  assert.equal(
    notificationPath({ thingId: "11111111-1111-4111-8111-111111111111", listId: null }),
    "/?thing=11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    notificationPath({ thingId: null, listId: "22222222-2222-4222-8222-222222222222" }),
    "/lists/22222222-2222-4222-8222-222222222222",
  );
  assert.equal(notificationPath({ thingId: null, listId: null }), "/");
  assert.equal(notificationPath({ thingId: "not-a-uuid", listId: "also-bad" }), "/");
});

test("classifies Firebase errors", () => {
  assert.equal(classifyFirebaseError("messaging/registration-token-not-registered"), "dead-token");
  assert.equal(classifyFirebaseError("messaging/server-unavailable"), "retry");
  assert.equal(classifyFirebaseError("messaging/invalid-payload"), "dead");
});

test("retry delays match the documented schedule at random 0.5", () => {
  const random = () => 0.5;
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((attempt) => retryDelayMs(attempt, random)),
    [1, 2, 5, 10, 30, 60, 180, 360].map((minutes) => minutes * 60 * 1000),
  );
});
