import assert from "node:assert/strict";
import test from "node:test";

import { getFirebaseClientSettings, getFirebaseServiceWorkerUrl } from "@/features/notifications/firebase-config";

const completeConfig = {
  apiKey: "key",
  authDomain: "katalist-d2f9e.firebaseapp.com",
  projectId: "katalist-d2f9e",
  storageBucket: "katalist-d2f9e.appspot.com",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
};

const completeEnv = {
  VITE_FIREBASE_API_KEY: "key",
  VITE_FIREBASE_AUTH_DOMAIN: "katalist-d2f9e.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "katalist-d2f9e",
  VITE_FIREBASE_STORAGE_BUCKET: "katalist-d2f9e.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
  VITE_FIREBASE_VAPID_KEY: "public-vapid-key",
};

test("returns null when any required Firebase web field is absent", () => {
  assert.equal(getFirebaseClientSettings({ VITE_FIREBASE_API_KEY: "key" }), null);
  assert.equal(getFirebaseClientSettings({ ...completeEnv, VITE_FIREBASE_VAPID_KEY: "" }), null);
});

test("returns trimmed settings when every public field is present", () => {
  const settings = getFirebaseClientSettings({
    ...completeEnv,
    VITE_FIREBASE_API_KEY: "  key  ",
  });
  assert.equal(settings?.config.apiKey, "key");
  assert.equal(settings?.vapidKey, "public-vapid-key");
});

test("builds a service-worker URL from public config only", () => {
  const url = new URL(getFirebaseServiceWorkerUrl(completeConfig), "https://uat.example.test");
  assert.equal(url.pathname, "/firebase-messaging-sw.js");
  assert.equal(url.searchParams.get("projectId"), "katalist-d2f9e");
  assert.equal(url.searchParams.has("vapidKey"), false);
});
