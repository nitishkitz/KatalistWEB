import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";

/**
 * D02: use-motion-preference.ts unifies the OS `prefers-reduced-motion`
 * media query and the app-level stored override behind one contract.
 * jsdom doesn't implement matchMedia, so this installs a minimal fake
 * supporting the addEventListener("change", ...) API the hook actually
 * uses, with a settable `.matches` and a way to fire "change".
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function installFakeMatchMedia(initialMatches) {
  const listeners = new Set();
  const mql = {
    matches: initialMatches,
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
  };
  window.matchMedia = () => mql;
  return {
    setMatches: (value) => {
      mql.matches = value;
      for (const cb of listeners) cb();
    },
  };
}

function Probe({ onValue }) {
  const { useMotionPreference } = probeModule;
  const { reduceMotion, setReduceMotion } = useMotionPreference();
  useEffect(() => {
    onValue({ reduceMotion, setReduceMotion });
  });
  return null;
}

let probeModule;

test("effective preference is OS OR stored, and reacts to an OS media-query change", async () => {
  probeModule = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  const fakeMql = installFakeMatchMedia(false);

  let latest = null;
  await act(async () => {
    render(h(Probe, { onValue: (v) => (latest = v) }));
  });
  assert.equal(latest.reduceMotion, false, "neither OS nor stored preference is set yet");

  await act(async () => {
    fakeMql.setMatches(true);
  });
  assert.equal(latest.reduceMotion, true, "an OS media-query change alone flips the effective value");

  await act(async () => {
    fakeMql.setMatches(false);
  });
  assert.equal(latest.reduceMotion, false, "and flips back when the OS setting is undone");

  cleanup();
});

test("the stored app-level preference alone is enough to reduce motion, and setReduceMotion persists it", async () => {
  probeModule = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  installFakeMatchMedia(false); // OS says no reduction

  let latest = null;
  await act(async () => {
    render(h(Probe, { onValue: (v) => (latest = v) }));
  });
  assert.equal(latest.reduceMotion, false);

  await act(async () => {
    latest.setReduceMotion(true);
  });
  assert.equal(latest.reduceMotion, true, "the app-level override alone is enough, with no OS preference set");
  assert.equal(window.localStorage.getItem("katalist.reduced_motion"), "1", "the choice is persisted");

  cleanup();
});

test("a same-tab write is observed by every other mounted consumer (not just a storage event, which never fires in the writing tab)", async () => {
  const { useMotionPreference } = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  installFakeMatchMedia(false);

  let a = null;
  let b = null;
  function TwoConsumers() {
    const first = useMotionPreference();
    const second = useMotionPreference();
    useEffect(() => {
      a = first;
      b = second;
    });
    return null;
  }

  await act(async () => {
    render(h(TwoConsumers));
  });
  assert.equal(a.reduceMotion, false);
  assert.equal(b.reduceMotion, false);

  await act(async () => {
    a.setReduceMotion(true);
  });
  assert.equal(a.reduceMotion, true);
  assert.equal(b.reduceMotion, true, "a second independently-mounted consumer sees the change without a page reload");

  cleanup();
});

test("getEffectiveReducedMotion (the one-shot, non-hook read) reflects the same OR contract", async () => {
  const { getEffectiveReducedMotion } = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  installFakeMatchMedia(false);

  assert.equal(getEffectiveReducedMotion(), false);
  window.localStorage.setItem("katalist.reduced_motion", "1");
  assert.equal(getEffectiveReducedMotion(), true, "a stored preference is picked up without needing a React re-render");
});

test("a localStorage that throws (privacy-mode/quota) is treated as no stored preference, not a crash", async () => {
  const { getEffectiveReducedMotion } = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  installFakeMatchMedia(false);
  // jsdom's Storage is a WebIDL legacy platform object -- overriding
  // individual methods (getItem = fn, even via defineProperty) on the
  // real instance is silently ignored, so this replaces the whole
  // `window.localStorage` binding instead, which does work.
  const realStorage = window.localStorage;
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: () => {
        throw new Error("SecurityError: storage is disabled");
      },
    },
    configurable: true,
  });
  try {
    assert.equal(getEffectiveReducedMotion(), false, "a throwing localStorage degrades to false, not an uncaught error");
  } finally {
    Object.defineProperty(window, "localStorage", { value: realStorage, configurable: true });
  }
});

test("G13: the stored preference survives a simulated reload -- a brand-new mount with no prior React state still reads it from storage", async () => {
  const { setStoredMotionPreference } = await import("@/hooks/use-motion-preference");
  window.localStorage.clear();
  installFakeMatchMedia(false);

  setStoredMotionPreference(true);
  // A real page reload discards all React state and re-imports/re-mounts
  // from scratch -- the closest in-process simulation is a fresh `render`
  // (not a rerender of an existing tree) reading storage for the first
  // time, with nothing carried over from the write above except what's
  // actually in localStorage.
  let latest = null;
  await act(async () => {
    render(h(Probe, { onValue: (v) => (latest = v) }));
  });

  assert.equal(latest.reduceMotion, true, "the preference must be read fresh from storage, not only kept in memory");
  cleanup();
});
