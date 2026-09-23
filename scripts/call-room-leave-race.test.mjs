import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * H02: CallRoom.join()/startScreenShare() used to assign the acquired
 * MediaStream unconditionally once getUserMedia/getDisplayMedia resolved,
 * with no check for whether leave() had already run in the meantime --
 * the browser's own permission/picker prompt can stay open long enough
 * for the caller to navigate away and call leave() before the promise
 * settles. leave() can only stop tracks it already knows about, so a
 * stream that arrives afterward would never be stopped (the camera/mic/
 * screen-share indicator stays on) and a channel could be stood up for a
 * room the caller believes is already gone.
 */

function makeTrack() {
  let stopped = false;
  return {
    kind: "video",
    get stopped() {
      return stopped;
    },
    stop: () => {
      stopped = true;
    },
  };
}

function makeStream(tracks) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
}

let getUserMediaResolve;
let getUserMediaPromise;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      channel: () => {
        const node = {
          on: () => node,
          subscribe: () => node,
          track: async () => {},
          untrack: async () => {},
        };
        return node;
      },
      removeChannel: () => {},
    },
  },
});

const { CallRoom } = await import("@/features/calls/call-room");

function resetGetUserMedia() {
  getUserMediaPromise = new Promise((resolve) => {
    getUserMediaResolve = resolve;
  });
  globalThis.navigator.mediaDevices = {
    getUserMedia: () => getUserMediaPromise,
    getDisplayMedia: () => getUserMediaPromise,
  };
}

test("join(): a getUserMedia that resolves AFTER leave() stops the returned tracks and does not proceed", async () => {
  resetGetUserMedia();
  const room = new CallRoom({
    listId: "list-1",
    selfId: "me",
    selfName: "Me",
    onState: () => {},
  });

  const joinPromise = room.join();
  room.leave(); // leave while getUserMedia is still pending

  const track = makeTrack();
  getUserMediaResolve(makeStream([track]));

  await assert.rejects(joinPromise, /left/i);
  assert.equal(track.stopped, true, "the late-arriving stream's track must be stopped, not leaked");
});

test("join(): normal path (not left) still resolves with a live stream", async () => {
  resetGetUserMedia();
  const room = new CallRoom({
    listId: "list-2",
    selfId: "me",
    selfName: "Me",
    onState: () => {},
  });

  const joinPromise = room.join();
  const track = makeTrack();
  getUserMediaResolve(makeStream([track]));

  const stream = await joinPromise;
  assert.equal(track.stopped, false, "the track must still be live -- nothing left the room");
  assert.equal(stream.getTracks()[0], track);

  room.leave();
  assert.equal(track.stopped, true, "leave() still correctly stops it afterward");
});
