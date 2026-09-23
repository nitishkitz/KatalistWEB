import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G06: PushRegistrar used to call Notification.requestPermission()
 * unconditionally in its mount effect, on every sign-in -- an unsolicited
 * browser permission prompt with no user-facing "Enable" action at all.
 * It must now only ever reconnect an ALREADY-granted permission; the
 * actual permission request only happens from Me's explicit "Enable"
 * button (via the same registerPushForUser it now shares with
 * PushRegistrar).
 */
const registrar = readFileSync(new URL("../src/features/push/PushRegistrar.tsx", import.meta.url), "utf8");
const pushRegistration = readFileSync(new URL("../src/features/push/push-registration.ts", import.meta.url), "utf8");
const me = readFileSync(new URL("../src/routes/me.tsx", import.meta.url), "utf8");

test("PushRegistrar's own code never calls Notification.requestPermission -- only push-registration.ts's registerPushForUser does", () => {
  assert.doesNotMatch(registrar, /Notification\.requestPermission\(/);
  assert.match(pushRegistration, /Notification\.requestPermission\(/);
});

test("PushRegistrar only proceeds when permission is already granted", () => {
  assert.match(registrar, /getPushPermissionState\(\) !== "granted"/);
});

test("registerPushForUser (the one place requestPermission is called) is only invoked from Me's explicit Enable handler and PushRegistrar's already-granted reconnect", () => {
  assert.match(me, /handleEnablePush/);
  assert.match(me, /registerPushForUser\(user\.id/);
  assert.match(registrar, /registerPushForUser\(uid/);
});

test("Me's notifications panel shows the actual permission state instead of a static \"in-app only\" claim", () => {
  assert.doesNotMatch(me, /In-app notifications only, for now/);
  assert.match(me, /pushPermission === "granted"/);
  assert.match(me, /pushPermission === "denied"/);
  assert.match(me, /pushPermission === "unsupported"/);
});
