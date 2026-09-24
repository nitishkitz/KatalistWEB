import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * R-05 (independent review of H-05): H-05 fixed the A-leave-B-A-completion
 * race for join()'s OWN continuation (see use-list-call-lifecycle.test.mjs),
 * but three related gaps remained, all only visible with a room that keeps
 * firing broadcast callbacks or rejecting after ownership has already moved
 * on:
 *
 *  - onReaction/onDraw/onDocPage set hook state directly, with no
 *    generation check -- a queued event from an old (superseded) room could
 *    still repaint a newer call's state.
 *  - Unmount cleanup called room.leave() without retiring the hook's own
 *    join generation, so a join() still in flight at unmount time could
 *    still emit a stale toast/state update once it later rejected.
 *  - Reaction auto-dismiss timers were not tracked/cleared on leave() or
 *    unmount, leaking timers past a call ending.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let joinGate = null;
let createdRooms = [];
let toastErrorCalls = [];

mock.module("sonner", {
  namedExports: {
    toast: {
      error: (msg) => toastErrorCalls.push(msg),
      success: () => {},
    },
  },
});

class FakeCallRoom {
  constructor(opts) {
    this.opts = opts;
    this.closed = false;
    createdRooms.push(this);
  }
  async join() {
    if (joinGate) await joinGate();
    return { getTracks: () => [], getVideoTracks: () => [] };
  }
  leave() {
    this.closed = true;
  }
  setMuted() {}
  setCameraOff() {}
  sendReaction() {}
  emitReaction(from, emoji) {
    this.opts.onReaction({ from, emoji });
  }
  emitDraw(op) {
    this.opts.onDraw(op);
  }
  emitDocPage(page) {
    this.opts.onDocPage(page);
  }
}

mock.module("@/features/calls/call-room", {
  namedExports: { CallRoom: FakeCallRoom },
});

const { useListCall } = await import("@/features/calls/use-list-call");

function Probe({ onValue }) {
  const call = useListCall("list-1", "me", "Me");
  useEffect(() => {
    onValue(call);
  });
  return null;
}

function renderProbe(onValue) {
  return render(h(InteractionBlockerProvider, null, h(Probe, { onValue })));
}

test("R-05: a stale room's onReaction after leave()+rejoin does not repaint the new call's state", async () => {
  createdRooms = [];
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });

  await act(async () => {
    await latest.join();
  });
  const roomA = createdRooms[0];

  await act(async () => {
    latest.leave();
  });
  await act(async () => {
    await latest.join();
  });
  const roomB = createdRooms[1];
  assert.notEqual(roomA, roomB);
  assert.equal(latest.reactions.length, 0);

  // Room A is stale (superseded twice over: leave() then a fresh join()),
  // but its channel handler closure still exists and could fire.
  await act(async () => {
    roomA.emitReaction("stale-peer", "🎉");
  });
  assert.equal(latest.reactions.length, 0, "a stale room's reaction must not repaint the current call's state");

  // Room B (the active room) still works normally.
  await act(async () => {
    roomB.emitReaction("live-peer", "🎉");
  });
  assert.equal(latest.reactions.length, 1, "the active room's own events still apply");

  cleanup();
});

test("R-05: a stale room's onDraw/onDocPage after leave()+rejoin does not repaint the new call's state", async () => {
  createdRooms = [];
  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });

  await act(async () => {
    await latest.join();
  });
  const roomA = createdRooms[0];
  await act(async () => {
    latest.leave();
  });
  await act(async () => {
    await latest.join();
  });
  const roomB = createdRooms[1];

  await act(async () => {
    roomA.emitDraw({ kind: "clear" });
    roomA.emitDocPage(7);
  });
  assert.equal(latest.drawOps.length, 0, "a stale room's draw op must not apply");
  assert.equal(latest.docPage, 1, "a stale room's doc-page broadcast must not apply");

  await act(async () => {
    roomB.emitDocPage(3);
  });
  assert.equal(latest.docPage, 3, "the active room's own doc-page broadcast still applies");

  cleanup();
});

test("R-05: unmounting while a join() is pending retires the generation -- a later rejection emits no stale toast", async () => {
  let gateReject;
  joinGate = () => new Promise((_resolve, reject) => (gateReject = reject));
  let latest = null;
  let unmount;
  await act(async () => {
    ({ unmount } = renderProbe((v) => (latest = v)));
  });

  let joinPromise;
  await act(async () => {
    joinPromise = latest.join();
  });
  assert.equal(latest.lifecycle, "joining");

  toastErrorCalls = [];
  unmount();

  await act(async () => {
    gateReject(new DOMException("denied", "NotAllowedError"));
    await joinPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(toastErrorCalls.length, 0, "a join() rejection arriving after unmount must not surface a toast");

  cleanup();
});

test("R-05: leave() clears pending reaction timers instead of leaking them", async () => {
  createdRooms = [];
  joinGate = null;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = new Set();
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = originalSetTimeout(fn, ms, ...args);
    scheduled.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    scheduled.delete(id);
    return originalClearTimeout(id);
  };

  let latest = null;
  await act(async () => {
    renderProbe((v) => (latest = v));
  });
  await act(async () => {
    await latest.join();
  });
  await act(async () => {
    latest.sendReaction("🎉");
  });
  assert.equal(scheduled.size, 1, "sendReaction scheduled its auto-dismiss timer");

  await act(async () => {
    latest.leave();
  });
  assert.equal(scheduled.size, 0, "leave() must clear any pending reaction timer, not leak it");

  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  cleanup();
});
