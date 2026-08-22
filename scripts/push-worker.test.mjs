import assert from "node:assert/strict";
import test from "node:test";

import { createDrainHandler, drainPushDeliveries } from "@/features/notifications/push-worker.server";

const thingId = "11111111-1111-4111-8111-111111111111";

function delivery(overrides = {}) {
  return {
    delivery_id: "delivery-1",
    subscription_id: "sub-1",
    notification_id: "notification-id",
    fcm_token: "fcm-token",
    attempt_count: 1,
    kind: "thing_assigned",
    title: "A Thing is waiting for your Catch",
    body: "Prepare launch notes",
    thing_id: thingId,
    list_id: null,
    ...overrides,
  };
}

function fakeDeps(overrides = {}) {
  const sendCalls = [];
  const finishCalls = [];
  return {
    sendCalls,
    finishCalls,
    async claim() {
      return overrides.claimed ?? [delivery()];
    },
    async send(message) {
      sendCalls.push(message);
      if (overrides.sendImpl) return overrides.sendImpl(message);
      return "projects/test/messages/1";
    },
    async finish(input) {
      finishCalls.push(input);
    },
    now: () => new Date("2026-08-22T00:00:00Z"),
    random: () => 0.5,
  };
}

test("sends a data-only payload and marks the device sent", async () => {
  const deps = fakeDeps();
  const summary = await drainPushDeliveries(deps, 10);
  assert.deepEqual(deps.sendCalls[0].data, {
    notificationId: "notification-id",
    kind: "thing_assigned",
    path: "/?thing=11111111-1111-4111-8111-111111111111",
    title: "A Thing is waiting for your Catch",
    body: "Prepare launch notes",
  });
  assert.equal(deps.finishCalls[0].result, "sent");
  assert.deepEqual(summary, { claimed: 1, sent: 1, retry: 0, dead: 0 });
});

test("retries transient Firebase errors", async () => {
  const deps = fakeDeps({
    sendImpl: async () => {
      throw Object.assign(new Error("unavailable"), { code: "messaging/server-unavailable" });
    },
  });
  const summary = await drainPushDeliveries(deps, 10);
  assert.equal(deps.finishCalls[0].result, "retry");
  assert.equal(summary.retry, 1);
});

test("revokes invalid tokens", async () => {
  const deps = fakeDeps({
    sendImpl: async () => {
      throw Object.assign(new Error("gone"), { code: "messaging/registration-token-not-registered" });
    },
  });
  await drainPushDeliveries(deps, 10);
  assert.equal(deps.finishCalls[0].result, "dead");
  assert.equal(deps.finishCalls[0].revoke, true);
});

test("permanent payload errors are dead without revoke", async () => {
  const deps = fakeDeps({
    sendImpl: async () => {
      throw Object.assign(new Error("bad"), { code: "messaging/invalid-payload" });
    },
  });
  await drainPushDeliveries(deps, 10);
  assert.equal(deps.finishCalls[0].result, "dead");
  assert.equal(deps.finishCalls[0].revoke, undefined);
});

test("max attempts become dead", async () => {
  const deps = fakeDeps({
    claimed: [delivery({ attempt_count: 9 })],
  });
  await drainPushDeliveries(deps, 10);
  assert.equal(deps.sendCalls.length, 0);
  assert.equal(deps.finishCalls[0].result, "dead");
});

test("one failure does not prevent the next claimed delivery", async () => {
  const send = { calls: [] };
  const finish = { calls: [] };
  const deps = {
    async claim() {
      return [delivery({ delivery_id: "d1" }), delivery({ delivery_id: "d2", notification_id: "n2" })];
    },
    async send(message) {
      send.calls.push(message);
      if (send.calls.length === 1) {
        throw Object.assign(new Error("bad"), { code: "messaging/invalid-payload" });
      }
      return "ok";
    },
    async finish(input) {
      finish.calls.push(input);
    },
  };
  const summary = await drainPushDeliveries(deps, 10);
  assert.equal(finish.calls[0].result, "dead");
  assert.equal(finish.calls[1].result, "sent");
  assert.deepEqual(summary, { claimed: 2, sent: 1, retry: 0, dead: 1 });
});

test("drain route requires the exact bearer secret", async () => {
  const handler = createDrainHandler({
    env: { PUSH_DRAIN_SECRET: "drain-secret" },
    deps: fakeDeps(),
  });
  assert.equal((await handler(new Request("https://uat.example.test/api/internal/notifications/drain", { method: "POST" }))).status, 401);
  const ok = await handler(
    new Request("https://uat.example.test/api/internal/notifications/drain", {
      method: "POST",
      headers: { authorization: "Bearer drain-secret" },
    }),
  );
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { claimed: 1, sent: 1, retry: 0, dead: 0 });
});

test("drain route is 404 when the secret is not configured", async () => {
  const handler = createDrainHandler({ env: {}, deps: fakeDeps() });
  assert.equal((await handler(new Request("https://uat.example.test/api/internal/notifications/drain", { method: "POST" }))).status, 404);
});
