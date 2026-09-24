import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";

/**
 * H02: useListCall previously only exposed joined/connecting booleans, with
 * no explicit "reconnecting" signal even though CallRoom already reports
 * each participant's raw RTCPeerConnection.connectionState. This proves the
 * new `lifecycle` rollup (idle -> joining -> connected -> reconnecting ->
 * back to connected, and separately joining -> error), and that an active
 * call registers a D03 InteractionBlockerProvider blocker so Morning Brief
 * cannot auto-open over it.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let joinBehavior = "resolve";
let lastRoom = null;

class FakeCallRoom {
  constructor(opts) {
    this.opts = opts;
    this.closed = false;
    lastRoom = this;
  }
  async join() {
    if (joinBehavior === "reject") {
      const err = new DOMException("denied", "NotAllowedError");
      throw err;
    }
    return { getTracks: () => [], getVideoTracks: () => [] };
  }
  leave() {
    this.closed = true;
  }
  setMuted() {}
  setCameraOff() {}
  emit(participants) {
    this.opts.onState({ participants, raisedHandQueue: [] });
  }
}

mock.module("@/features/calls/call-room", {
  namedExports: { CallRoom: FakeCallRoom },
});

const { useListCall } = await import("@/features/calls/use-list-call");

function Probe({ onValue }) {
  const call = useListCall("list-1", "me", "Me");
  const { isBlocked } = useInteractionBlocker();
  useEffect(() => {
    onValue({ call, isBlocked });
  });
  return null;
}

function renderProbe(onValue) {
  return render(h(InteractionBlockerProvider, null, h(Probe, { onValue })));
}

test("join() success reaches connected, and registers the D03 active-call blocker", async () => {
  joinBehavior = "resolve";
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });
  assert.equal(latest.call.lifecycle, "idle");
  assert.equal(latest.isBlocked, false, "not blocking before joining");

  await act(async () => {
    await latest.call.join();
  });
  assert.equal(latest.call.lifecycle, "connected");
  assert.equal(latest.isBlocked, true, "an active call must block Morning Brief's auto-open");

  await act(async () => {
    latest.call.leave();
  });
  assert.equal(latest.call.lifecycle, "ended", "leave() after being connected surfaces as ended, not silently idle");
  assert.equal(latest.isBlocked, false, "leaving releases the blocker");

  cleanup();
});

test("a peer going disconnected surfaces as reconnecting, and recovers back to connected", async () => {
  joinBehavior = "resolve";
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });
  await act(async () => {
    await latest.call.join();
  });
  assert.equal(latest.call.lifecycle, "connected");

  await act(async () => {
    lastRoom.emit([{ id: "peer-1", name: "Peer", connection: "disconnected" }]);
  });
  assert.equal(latest.call.lifecycle, "reconnecting");

  await act(async () => {
    lastRoom.emit([{ id: "peer-1", name: "Peer", connection: "connected" }]);
  });
  assert.equal(latest.call.lifecycle, "connected", "must recover once the peer's connection state clears");

  cleanup();
});

test("a join() permission failure surfaces as error with a specific message, and leaves idle (not ended)", async () => {
  joinBehavior = "reject";
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });

  await act(async () => {
    await latest.call.join();
  });
  assert.equal(latest.call.lifecycle, "error");
  assert.match(latest.call.lastError ?? "", /permission/i);
  assert.equal(latest.isBlocked, false, "a call that never connected must not hold the blocker");

  cleanup();
});
