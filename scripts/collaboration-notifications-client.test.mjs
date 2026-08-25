import assert from "node:assert/strict";
import test from "node:test";
import { trustedNotificationPath } from "@/features/notifications/push-delivery";
import { drainPushDeliveries } from "@/features/notifications/push-worker.server";

const listId = "11111111-1111-4111-8111-111111111111";

test("trusted notification navigation permits Team and rejects external paths", () => {
  assert.equal(trustedNotificationPath("/team"), "/team");
  assert.equal(trustedNotificationPath(`/lists/${listId}`), `/lists/${listId}`);
  assert.equal(trustedNotificationPath("https://evil.example"), "/");
});

test("push worker sends the path claimed from the notification", async () => {
  const sent = [];
  await drainPushDeliveries({
    claim: async () => [{ delivery_id: "d", subscription_id: "s", notification_id: "n", fcm_token: "token", attempt_count: 1, kind: "team_request", title: "Team request", body: null, thing_id: null, list_id: null, path: "/team" }],
    send: async (message) => { sent.push(message); return "ok"; },
    finish: async () => undefined,
  }, 1);
  assert.equal(sent[0].data.path, "/team");
});
