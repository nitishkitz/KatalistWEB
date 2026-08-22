import assert from "node:assert/strict";
import test from "node:test";

import { createPushController } from "@/features/notifications/push-client";

const completeSettings = {
  config: {
    apiKey: "key",
    authDomain: "katalist-d2f9e.firebaseapp.com",
    projectId: "katalist-d2f9e",
    storageBucket: "katalist-d2f9e.appspot.com",
    messagingSenderId: "123",
    appId: "1:123:web:abc",
  },
  vapidKey: "public-vapid-key",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("permission is requested only inside enablePush", async () => {
  const requestPermission = { calls: 0 };
  const getToken = { calls: [] };
  const controller = createPushController({
    settings: completeSettings,
    isSupported: () => true,
    notificationPermission: () => "default",
    requestPermission: async () => {
      requestPermission.calls += 1;
      return "granted";
    },
    registerServiceWorker: async () => ({}),
    getToken: async (input) => {
      getToken.calls.push(input);
      return "fcm-token-abcdefghijklmnopqrstuvwxyz";
    },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    storage: memoryStorage(),
  });
  assert.equal(requestPermission.calls, 0);
  const session = { access_token: "access" };
  const state = await controller.enable(session);
  assert.equal(requestPermission.calls, 1);
  assert.equal(getToken.calls[0].vapidKey, "public-vapid-key");
  assert.equal(state.kind, "enabled");
});

test("missing config and unsupported browsers never request permission", async () => {
  const requestPermission = { calls: 0 };
  const missing = createPushController({
    settings: null,
    requestPermission: async () => {
      requestPermission.calls += 1;
      return "granted";
    },
  });
  assert.equal((await missing.enable({ access_token: "access" })).kind, "unavailable");

  const unsupported = createPushController({
    settings: completeSettings,
    isSupported: () => false,
    requestPermission: async () => {
      requestPermission.calls += 1;
      return "granted";
    },
  });
  assert.equal((await unsupported.enable({ access_token: "access" })).kind, "unsupported");
  assert.equal(requestPermission.calls, 0);
});

test("denied permission is reported without registering a token", async () => {
  const getToken = { calls: 0 };
  const controller = createPushController({
    settings: completeSettings,
    isSupported: () => true,
    requestPermission: async () => "denied",
    getToken: async () => {
      getToken.calls += 1;
      return "token";
    },
  });
  assert.equal((await controller.enable({ access_token: "access" })).kind, "denied");
  assert.equal(getToken.calls, 0);
});
