import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * P8: the ref-counted registry for the per-list list-chat broadcast
 * channel. Covers exactly the acceptance criteria named in the plan --
 * multiple consumers, last-consumer cleanup, and duplicate chat
 * delivery (each acquirer's own callback fires, but only one
 * underlying channel/subscription exists).
 */

let channelsCreated = [];
let channelsRemoved = [];

function makeFakeChannel(name) {
  const handlers = [];
  const sent = [];
  const channel = {
    name,
    handlers,
    sent,
    on: (_type, _filter, cb) => {
      handlers.push(cb);
      return channel;
    },
    subscribe: () => channel,
    send: (payload) => {
      sent.push(payload);
    },
  };
  channelsCreated.push(channel);
  return channel;
}

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      channel: (name) => makeFakeChannel(name),
      removeChannel: (channel) => {
        channelsRemoved.push(channel);
      },
    },
  },
});

const { acquireListChatChannel, broadcastListChatChange, debugRegistryState } = await import(
  "@/features/lists/list-chat-channel-registry"
);

function reset() {
  channelsCreated = [];
  channelsRemoved = [];
}

test("a single acquirer creates one channel; releasing it tears the channel down", () => {
  reset();
  const release = acquireListChatChannel("list-1", () => {});
  assert.equal(channelsCreated.length, 1);
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 1, channelOpen: true });

  release();
  assert.equal(channelsRemoved.length, 1);
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 0, channelOpen: false });
});

test("multiple consumers for the same List share one underlying channel, not one each", () => {
  reset();
  const releaseA = acquireListChatChannel("list-1", () => {});
  const releaseB = acquireListChatChannel("list-1", () => {});
  const releaseC = acquireListChatChannel("list-1", () => {});

  assert.equal(channelsCreated.length, 1, "three consumers for the same List must share one channel, not create three");
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 3, channelOpen: true });

  releaseA();
  releaseB();
  releaseC();
});

test("the channel is only detached once the LAST consumer releases it", () => {
  reset();
  const releaseA = acquireListChatChannel("list-1", () => {});
  const releaseB = acquireListChatChannel("list-1", () => {});

  releaseA();
  assert.equal(channelsRemoved.length, 0, "the channel must stay open while at least one consumer remains");
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 1, channelOpen: true });

  releaseB();
  assert.equal(channelsRemoved.length, 1, "the channel must be detached once the last consumer releases");
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 0, channelOpen: false });
});

test("a broadcast is delivered to every acquirer's own callback exactly once -- duplicate delivery is avoided by having only one channel", () => {
  reset();
  let callsA = 0;
  let callsB = 0;
  const releaseA = acquireListChatChannel("list-1", () => { callsA += 1; });
  const releaseB = acquireListChatChannel("list-1", () => { callsB += 1; });

  // Simulate the shared channel receiving one broadcast event.
  const channel = channelsCreated[0];
  for (const handler of channel.handlers) handler({});

  assert.equal(callsA, 1);
  assert.equal(callsB, 1);
  assert.equal(channelsCreated.length, 1, "only one channel ever existed to deliver this one event from");

  releaseA();
  releaseB();
});

test("different Lists get independent channels, never sharing one registry entry", () => {
  reset();
  const releaseA = acquireListChatChannel("list-1", () => {});
  const releaseB = acquireListChatChannel("list-2", () => {});

  assert.equal(channelsCreated.length, 2);
  assert.deepEqual(debugRegistryState("list-1"), { refCount: 1, channelOpen: true });
  assert.deepEqual(debugRegistryState("list-2"), { refCount: 1, channelOpen: true });

  releaseA();
  assert.deepEqual(debugRegistryState("list-2"), { refCount: 1, channelOpen: true }, "releasing list-1 must not affect list-2");
  releaseB();
});

test("releasing twice (e.g. Strict Mode double-invoking cleanup) is idempotent, not a double-decrement", () => {
  reset();
  const release = acquireListChatChannel("list-1", () => {});
  release();
  assert.equal(channelsRemoved.length, 1);
  release(); // called again
  assert.equal(channelsRemoved.length, 1, "a second release() call must not attempt to remove an already-removed channel or go negative");
});

test("broadcastListChatChange on a listId nobody has acquired is a safe no-op", () => {
  reset();
  assert.doesNotThrow(() => broadcastListChatChange("nobody-here"));
});

test("broadcastListChatChange sends on the shared channel", () => {
  reset();
  const release = acquireListChatChannel("list-1", () => {});
  broadcastListChatChange("list-1");
  assert.equal(channelsCreated[0].sent.length, 1);
  release();
});
