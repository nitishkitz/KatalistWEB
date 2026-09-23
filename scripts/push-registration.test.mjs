import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getPushPermissionState } from "@/features/push/push-registration";

/**
 * G06: getPushPermissionState reports the actual browser state
 * (unsupported/default/granted/denied) instead of assuming push doesn't
 * exist -- Me's notifications panel used to show a static "in-app
 * notifications only, for now" regardless of what was actually true.
 *
 * jsdom has neither `Notification` nor `navigator.serviceWorker` by
 * default, so "supported" is simulated by defining both.
 */

function withSupport(notificationPermission, fn) {
  const hadNotification = "Notification" in window;
  const realNotification = window.Notification;
  const hadServiceWorker = "serviceWorker" in navigator;
  const realServiceWorker = navigator.serviceWorker;

  // The source reads the bare global `Notification` identifier (as in a
  // real browser, where it resolves the same way as `window.Notification`)
  // -- Node's own global scope needs it too, not just jsdom's `window`.
  const notification = { permission: notificationPermission };
  window.Notification = notification;
  globalThis.Notification = notification;
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  try {
    fn();
  } finally {
    if (hadNotification) window.Notification = realNotification;
    else delete window.Notification;
    delete globalThis.Notification;
    if (hadServiceWorker) Object.defineProperty(navigator, "serviceWorker", { value: realServiceWorker, configurable: true });
    else delete navigator.serviceWorker;
  }
}

test("reports 'unsupported' when Notification/serviceWorker are absent (the jsdom default)", () => {
  assert.equal(getPushPermissionState(), "unsupported");
});

test("reports the real Notification.permission value when both APIs are present", () => {
  withSupport("granted", () => {
    assert.equal(getPushPermissionState(), "granted");
  });
});

test("reports 'default' (not yet decided) accurately, distinct from denied/granted", () => {
  withSupport("default", () => {
    assert.equal(getPushPermissionState(), "default");
  });
});

test("reports 'denied' accurately", () => {
  withSupport("denied", () => {
    assert.equal(getPushPermissionState(), "denied");
  });
});
