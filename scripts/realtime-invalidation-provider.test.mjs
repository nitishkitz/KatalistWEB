import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, StrictMode, useState, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * P7 acceptance criteria for the application-level realtime owner,
 * verified against a real DOM/React render, not just the pure
 * batcher/routing-map units already covered elsewhere:
 * - a real identity change disposes the old owner and mounts a new one
 * - logout/preview owns no channel
 * - Strict Mode cleanup is idempotent (no leaked/duplicate channels)
 * - a stale (post-retirement) event callback does not invalidate
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testSession = { loading: true, session: null };
const sessionListeners = new Set();
function setTestSession(next) {
  testSession = next;
  for (const listener of sessionListeners) listener();
}
function useSessionMock() {
  const [state, setState] = useState(testSession);
  useEffect(() => {
    const listener = () => setState(testSession);
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  }, []);
  return state;
}
mock.module("@/hooks/useSession", { namedExports: { useSession: useSessionMock } });
mock.module("@/lib/session-mode", {
  namedExports: { isPreviewSession: (session) => session?.user?.app_metadata?.provider === "demo" },
});
mock.module("@/features/things/personal-shred", {
  namedExports: { invalidatePersonalSurfaces: async () => {} },
});

let channelsCreated = [];
let channelsRemoved = [];
let handlersByChannel = new Map();

function makeFakeChannel(name) {
  const handlers = [];
  handlersByChannel.set(name, handlers);
  const channel = {
    name,
    on: (_type, filter, cb) => {
      handlers.push({ filter, cb });
      return channel;
    },
    subscribe: (statusCb) => {
      statusCb?.("SUBSCRIBED");
      return channel;
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

const { IdentityBoundary } = await import("@/features/realtime/IdentityBoundary");
const { RealtimeInvalidationProvider } = await import("@/features/realtime/RealtimeInvalidationProvider");

function liveSession(profileId) {
  return { loading: false, session: { user: { id: profileId, app_metadata: {} } } };
}
function demoSession(profileId) {
  return { loading: false, session: { user: { id: profileId, app_metadata: { provider: "demo" } } } };
}

function newTestClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: 0, staleTime: 0, retry: false } } });
}

function Harness({ strict }) {
  const tree = h(IdentityBoundary, null, h(RealtimeInvalidationProvider));
  return strict ? h(StrictMode, null, tree) : tree;
}

function resetHarness() {
  testSession = { loading: true, session: null };
  sessionListeners.clear();
  channelsCreated = [];
  channelsRemoved = [];
  handlersByChannel = new Map();
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

test("a live identity creates exactly one channel; logout removes it and creates none for the logged-out state", async () => {
  resetHarness();
  const qc = newTestClient();
  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  assert.equal(channelsCreated.length, 1, "exactly one channel for the live identity");
  assert.equal(channelsRemoved.length, 0);

  await act(async () => {
    setTestSession({ loading: false, session: null }); // logout
  });
  await settle();

  assert.equal(channelsRemoved.length, 1, "the channel must be removed on logout");
  assert.equal(channelsCreated.length, 1, "logout must not create a new channel");

  unmount();
  qc.clear();
  cleanup();
});

test("preview/demo identity owns no channel at all", async () => {
  resetHarness();
  const qc = newTestClient();
  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(demoSession("demo-priya"));
  });
  await settle();

  assert.equal(channelsCreated.length, 0, "a preview/demo identity must never create a real Postgres-change channel");

  unmount();
  qc.clear();
  cleanup();
});

test("a live A -> live B switch disposes the old owner's channel and mounts exactly one new one", async () => {
  resetHarness();
  const qc = newTestClient();
  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(channelsCreated.length, 1);
  const firstChannel = channelsCreated[0];

  await act(async () => {
    setTestSession(liveSession("profile-B"));
  });
  await settle();

  assert.equal(channelsRemoved.length, 1, "the switch must dispose exactly one old owner");
  assert.equal(channelsRemoved[0], firstChannel, "the disposed channel must be A's, not some other instance");
  assert.equal(channelsCreated.length, 2, "the switch must mount exactly one new owner for B");

  unmount();
  qc.clear();
  cleanup();
});

test("Strict Mode: mounting does not leak or duplicate channels for one real transition", async () => {
  resetHarness();
  const qc = newTestClient();
  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, { strict: true }))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  // Strict Mode's dev-only double-invocation may mount/unmount/remount
  // this effect once extra, but must always end up net-one live
  // channel, not two simultaneously active ones.
  assert.equal(channelsCreated.length - channelsRemoved.length, 1, "exactly one channel must still be net-active after Strict Mode's double-invocation settles");

  unmount();
  qc.clear();
  cleanup();
});

test("an event delivered to a stale (already-retired) channel handler does not invalidate", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => {
    invalidateCallCount += 1;
    return original(...args);
  };

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  const channelName = channelsCreated[0].name;
  const handlers = handlersByChannel.get(channelName);
  assert.ok(handlers.length > 0, "sanity: at least one postgres_changes handler was registered");

  // Switch identity -- the old owner's channel is removed (real
  // Supabase would stop delivering events to it), but simulate a
  // straggling event callback firing anyway, as if the removal hadn't
  // fully taken effect yet.
  await act(async () => {
    setTestSession(liveSession("profile-B"));
  });
  await settle();

  for (const { cb } of handlers) cb({}); // simulate a stale event firing after retirement
  await settle();

  assert.equal(invalidateCallCount, 0, "a stale post-retirement event must not trigger any invalidation");

  unmount();
  qc.clear();
  cleanup();
});
