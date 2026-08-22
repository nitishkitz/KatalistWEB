import assert from "node:assert/strict";
import test from "node:test";

import { createPushSubscriptionHandler } from "@/features/notifications/push-subscriptions.server";

function jsonRequest(body, authorization, method = "POST") {
  return new Request("https://uat.example.test/api/push/subscriptions", {
    method,
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      "user-agent": "test-agent",
    },
    body: JSON.stringify(body),
  });
}

test("missing bearer returns 401 and performs no RPC", async () => {
  const calls = [];
  const handler = createPushSubscriptionHandler({
    getUser: async () => ({ id: "verified-user-id" }),
    rpcs: {
      register: async (...args) => {
        calls.push({ kind: "register", args });
      },
      revoke: async (...args) => {
        calls.push({ kind: "revoke", args });
      },
    },
  });
  const response = await handler(jsonRequest({ token: "fcm-token-abcdefghijklmnopqrstuvwxyz" }));
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("invalid JWT performs no service-role RPC", async () => {
  const calls = [];
  const handler = createPushSubscriptionHandler({
    getUser: async () => null,
    rpcs: {
      register: async (...args) => {
        calls.push(args);
      },
      revoke: async () => {},
    },
  });
  const response = await handler(
    jsonRequest({ token: "fcm-token-abcdefghijklmnopqrstuvwxyz" }, "Bearer invalid-jwt"),
  );
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("caller-supplied profile IDs are ignored in favor of the verified user", async () => {
  const rpc = { calls: [] };
  const handler = createPushSubscriptionHandler({
    getUser: async () => ({ id: "verified-user-id" }),
    rpcs: {
      register: async (profileId, token, userAgent) => {
        rpc.calls.push({ args: { p_profile_id: profileId, p_fcm_token: token, p_user_agent: userAgent } });
      },
      revoke: async () => {},
    },
  });
  const request = jsonRequest(
    { token: "fcm-token-abcdefghijklmnopqrstuvwxyz", profileId: "attacker-choice" },
    "Bearer valid-jwt",
  );
  const response = await handler(request);
  assert.equal(response.status, 200);
  assert.deepEqual(rpc.calls[0].args, {
    p_profile_id: "verified-user-id",
    p_fcm_token: "fcm-token-abcdefghijklmnopqrstuvwxyz",
    p_user_agent: "test-agent",
  });
});
