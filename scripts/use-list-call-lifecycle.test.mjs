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
let createdRooms = [];
// H-05: a shared gate so a test can hold a room's own join() promise open
// (modeling getUserMedia/signaling still pending) while OTHER calls
// (leave(), a second join()) happen, then release it -- proving
// useListCall's own generation guard catches a superseded join even in
// the worst case where the underlying room's join() still resolves
// normally afterward (call-room-leave-race.test.mjs already covers
// CallRoom's own lower-level closed-check separately).
let joinGate = null;

class FakeCallRoom {
  constructor(opts) {
    this.opts = opts;
    this.closed = false;
    lastRoom = this;
    createdRooms.push(this);
  }
  async join() {
    if (joinGate) await joinGate;
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

test("H-05: a join() superseded by leave()+join() must not clobber the new room's ref/state when it finally resolves", async () => {
  joinBehavior = "resolve";
  createdRooms = [];
  let gateResolve;
  joinGate = new Promise((r) => (gateResolve = r));
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });

  // Room A: join() starts, blocks on the gate (models getUserMedia/
  // signaling still pending).
  let joinAPromise;
  await act(async () => {
    joinAPromise = latest.call.join();
  });
  assert.equal(createdRooms.length, 1);
  const roomA = createdRooms[0];
  assert.equal(latest.call.lifecycle, "joining");

  // leave() while A is still pending -- A was never connected, so this is
  // idle, not "ended".
  await act(async () => {
    latest.call.leave();
  });
  assert.equal(latest.call.lifecycle, "idle");

  // Room B: a fresh join() -- allowed now that leave() reset roomRef/connecting.
  let joinBPromise;
  await act(async () => {
    joinBPromise = latest.call.join();
  });
  assert.equal(createdRooms.length, 2);
  const roomB = createdRooms[1];
  assert.notEqual(roomA, roomB);

  // Release the shared gate: A's (stale) and B's (current) join() calls
  // both resolve around now.
  await act(async () => {
    gateResolve();
    await joinAPromise;
    await joinBPromise;
  });

  assert.equal(await joinAPromise, false, "A's own join() call must report it did not become the active call");
  assert.equal(await joinBPromise, true, "B's join() call succeeds normally");
  assert.equal(latest.call.lifecycle, "connected", "the live call must be B, not clobbered back to idle/error by A");
  assert.equal(roomA.closed, true, "A's own room must still be disposed even though it never became the active call");

  cleanup();
});

test("T03: the blocker engages during 'joining' (pending getUserMedia/permission/signaling), not only once 'connected'", async () => {
  joinBehavior = "resolve";
  let gateResolve;
  joinGate = new Promise((r) => (gateResolve = r));
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });
  assert.equal(latest.isBlocked, false, "not blocking before join() is even called");

  let joinPromise;
  await act(async () => {
    joinPromise = latest.call.join();
  });
  assert.equal(latest.call.lifecycle, "joining");
  assert.equal(
    latest.isBlocked,
    true,
    "'joining' alone (before the join actually connects) must already block -- a pending permission prompt/signaling wait is still 'in a call'",
  );

  await act(async () => {
    gateResolve();
    await joinPromise;
  });
  assert.equal(latest.call.lifecycle, "connected");
  assert.equal(latest.isBlocked, true, "still blocked once connected");

  cleanup();
});
