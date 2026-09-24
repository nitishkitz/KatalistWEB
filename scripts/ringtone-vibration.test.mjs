import assert from "node:assert/strict";
import { test } from "node:test";
import { createRingtone } from "../src/features/calls/ringtone.ts";

test("an idle ringtone never calls the gesture-gated vibration API", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const vibrations = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { vibrate: (pattern) => { vibrations.push(pattern); return true; } },
  });
  try {
    const ringtone = createRingtone();
    ringtone.stop();
    ringtone.stop();
    assert.deepEqual(vibrations, []);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});

test("a ring before user activation stays silent; an activated ring stops its vibration", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const vibrations = [];
  const navigatorStub = {
    userActivation: { hasBeenActive: false },
    vibrate: (pattern) => { vibrations.push(pattern); return true; },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorStub });
  try {
    const premature = createRingtone();
    premature.start();
    premature.stop();
    assert.deepEqual(vibrations, []);

    navigatorStub.userActivation.hasBeenActive = true;
    const activated = createRingtone();
    activated.start();
    activated.stop();
    assert.deepEqual(vibrations, [[400, 200, 400, 200, 400], 0]);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});
