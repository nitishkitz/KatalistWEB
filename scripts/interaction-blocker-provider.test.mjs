import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useEffect, StrictMode } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useBlockWhile, useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onValue }) {
  const value = useInteractionBlocker();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function Blocker({ active, reason }) {
  useBlockWhile(active, reason);
  return null;
}

test("with nothing registered, isBlocked is false", async () => {
  let latest = null;
  await act(async () => {
    render(h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })));
  });
  assert.equal(latest.isBlocked, false);
  cleanup();
});

test("useBlockWhile(true, ...) blocks, and unblocks when the condition flips back to false", async () => {
  let latest = null;
  let rerender;
  await act(async () => {
    const r = render(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: true, reason: "active-call" }),
      ),
    );
    rerender = r.rerender;
  });
  assert.equal(latest.isBlocked, true);
  assert.deepEqual(latest.blockedReasons, ["active-call"]);

  await act(async () => {
    rerender(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: false, reason: "active-call" }),
      ),
    );
  });
  assert.equal(latest.isBlocked, false, "unregisters once the condition goes false");

  cleanup();
});

test("unmounting a blocker without flipping active first still unregisters (cleanup path)", async () => {
  let latest = null;
  let rerender;
  await act(async () => {
    const r = render(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: true, reason: "modal" }),
      ),
    );
    rerender = r.rerender;
  });
  assert.equal(latest.isBlocked, true);

  await act(async () => {
    rerender(h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })));
  });
  assert.equal(latest.isBlocked, false, "removing the blocker component unregisters via its own effect cleanup");

  cleanup();
});

test("two independent registrations of the SAME reason both must clear before isBlocked goes false", async () => {
  let latest = null;
  let rerender;
  await act(async () => {
    const r = render(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: true, reason: "modal" }),
        h(Blocker, { active: true, reason: "modal" }),
      ),
    );
    rerender = r.rerender;
  });
  assert.equal(latest.isBlocked, true);

  await act(async () => {
    rerender(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: false, reason: "modal" }),
        h(Blocker, { active: true, reason: "modal" }),
      ),
    );
  });
  assert.equal(latest.isBlocked, true, "one of two same-reason registrations releasing must not clear the other's block");

  await act(async () => {
    rerender(
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { onValue: (v) => (latest = v) }),
        h(Blocker, { active: false, reason: "modal" }),
        h(Blocker, { active: false, reason: "modal" }),
      ),
    );
  });
  assert.equal(latest.isBlocked, false, "clears once both release");

  cleanup();
});

test("Strict Mode double-invocation of a blocker's effect does not leave a phantom double-count", async () => {
  let latest = null;
  await act(async () => {
    render(
      h(
        StrictMode,
        null,
        h(
          InteractionBlockerProvider,
          null,
          h(Probe, { onValue: (v) => (latest = v) }),
          h(Blocker, { active: true, reason: "modal" }),
        ),
      ),
    );
  });
  assert.equal(latest.isBlocked, true);
  assert.deepEqual(latest.blockedReasons, ["modal"], "exactly one reason, not duplicated by Strict Mode's mount/unmount/remount");

  cleanup();
});

test("useInteractionBlocker throws outside the provider, rather than silently reporting never-blocked", async () => {
  function Bare() {
    useInteractionBlocker();
    return null;
  }
  await assert.rejects(async () => {
    await act(async () => {
      render(h(Bare));
    });
  });
  cleanup();
});
