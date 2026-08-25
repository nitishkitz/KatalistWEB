import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../public/firebase-messaging-sw.js"),
  "utf8",
);

test("service worker uses pinned Firebase compat 12.18.0 and trusted paths", () => {
  assert.match(source, /firebasejs\/12\.18\.0\/firebase-app-compat\.js/);
  assert.match(source, /firebasejs\/12\.18\.0\/firebase-messaging-compat\.js/);
  assert.match(source, /apiKey/);
  assert.match(source, /authDomain/);
  assert.match(source, /projectId/);
  assert.match(source, /storageBucket/);
  assert.match(source, /messagingSenderId/);
  assert.match(source, /appId/);
  assert.doesNotMatch(source, /vapidKey/);
  assert.equal((source.match(/onBackgroundMessage/g) || []).length, 1);
  assert.match(source, /showNotification/);
  assert.match(source, /notificationclick/);
  assert.match(source, /clients\.openWindow/);
  assert.match(source, /trustedPath/);
  assert.match(source, /path === "\/team"/);
  assert.match(source, /return "\/"/);
});
