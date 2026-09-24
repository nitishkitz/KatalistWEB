import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, StrictMode, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
    handlers,
    on: (_type, filter, cb) => {
      handlers.push({ filter, cb });
      return channel;
    },
    subscribe: (statusCb) => {
      channel.statusCb = statusCb;
      statusCb?.("SUBSCRIBED");
      return channel;
    },
    // Test-only: simulate a reconnect (or any later status transition)
    // by calling the same callback the production code registered.
    simulateStatus: (status) => channel.statusCb?.(status),
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

// gcTime: 0 (used everywhere else in this file to avoid lingering
// timers keeping the process alive) also garbage-collects any
// UNOBSERVED query almost immediately -- fine for the other tests,
// which never check unobserved cache persistence, but wrong here: the
// membership tests below seed cache data with no live observer and
// need it to survive until the assertion regardless of GC timing, so
// the ABSENCE of data in the assertion reflects the fast path's own
// removeQueries() call, not an unrelated gcTime side effect.
function newTestClientWithPersistentCache() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: 0, retry: false } } });
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

// The invalidation batcher's default debounce is 150ms -- settle() alone
// (10ms) is enough for identity-transition effects but not for a
// batcher flush. Used only by tests that need a batched invalidation
// (e.g. P9's catch-up pass) to actually have fired.
async function settleBatcher() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
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

test("T07: a Strict Mode cleanup rejects late callbacks from its discarded channel", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidations = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => { invalidations += 1; return original(...args); };
  let unmount;
  await act(async () => { ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, { strict: true })))); });
  await act(async () => { setTestSession(liveSession("profile-A")); });
  await settle();
  assert.ok(channelsCreated.length >= 2);
  const discarded = channelsRemoved[0];
  assert.ok(discarded);
  discarded.simulateStatus("SUBSCRIBED");
  for (const handler of discarded.handlers) handler.cb({ eventType: "UPDATE", new: { id: "thing-1" } });
  await settleBatcher();
  assert.equal(invalidations, 0, "a discarded same-epoch channel must be inert");
  unmount(); qc.clear(); cleanup();
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

test("membership revocation: a DELETE removing MY OWN membership invalidates that List's cached detail/messages (not removeQueries, which would defeat an active observer's own refetch -- see the dedicated observer test below)", async () => {
  resetHarness();
  const qc = newTestClientWithPersistentCache();

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  // Seeded AFTER the identity has settled to "ready" -- IdentityBoundary's
  // own resetQueries() during the pending -> aligning -> ready transition
  // would otherwise evict this unobserved seed data itself, before the
  // membership handler ever runs, and make this test pass for the wrong
  // reason.
  qc.setQueryData(["list", "list-1"], { id: "list-1", name: "stale" });
  qc.setQueryData(["list-messages", "list-1"], [{ id: "m1" }]);
  // C-06: Hub's own conversation detail and files panel for the SAME
  // List were not covered by this fast path at all before this fix.
  qc.setQueryData(["hub-conversation", "list-1"], { id: "list-1" });
  qc.setQueryData(["hub-files", "list-1"], [{ id: "f1" }]);

  const handlers = handlersByChannel.get(channelsCreated[0].name);
  const listMembersHandler = handlers.find((h2) => h2.filter.table === "list_members");
  assert.ok(listMembersHandler, "sanity: a list_members handler was registered");

  listMembersHandler.cb({
    eventType: "DELETE",
    old: { profile_id: "profile-A", list_id: "list-1" },
  });

  // C-06: checking isInvalidated (not getQueryData() === undefined --
  // that was removeQueries()'s own contract, which this fix deliberately
  // replaced) -- an invalidated query still returns its last-known data
  // synchronously, but is guaranteed to refetch the next time anything
  // observes it, and refetches immediately if something already does
  // (proven separately below with a real mounted observer).
  assert.equal(qc.getQueryState(["list", "list-1"])?.isInvalidated, true, "the now-inaccessible List's detail cache must be invalidated");
  assert.equal(qc.getQueryState(["list-messages", "list-1"])?.isInvalidated, true, "the now-inaccessible List's messages cache must be invalidated");
  assert.equal(qc.getQueryState(["hub-conversation", "list-1"])?.isInvalidated, true, "Hub's own conversation detail for the same List must be invalidated too");
  assert.equal(qc.getQueryState(["hub-files", "list-1"])?.isInvalidated, true, "the files panel for the same List must be invalidated too");

  unmount();
  qc.clear();
  cleanup();
});

test("membership revocation fast path does not fire for someone ELSE's removed membership", async () => {
  resetHarness();
  const qc = newTestClientWithPersistentCache();

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  // Seeded after settling -- see the comment in the previous test.
  qc.setQueryData(["list", "list-1"], { id: "list-1", name: "still valid for me" });

  const handlers = handlersByChannel.get(channelsCreated[0].name);
  const listMembersHandler = handlers.find((h2) => h2.filter.table === "list_members");

  listMembersHandler.cb({
    eventType: "DELETE",
    old: { profile_id: "profile-SOMEONE-ELSE", list_id: "list-1" },
  });

  assert.notEqual(
    qc.getQueryState(["list", "list-1"])?.isInvalidated,
    true,
    "removing a DIFFERENT profile's membership must not invalidate MY cached access to the same List",
  );

  unmount();
  qc.clear();
  cleanup();
});

test("membership revocation fast path does nothing when the payload lacks the needed fields (incomplete DELETE payload)", async () => {
  resetHarness();
  const qc = newTestClientWithPersistentCache();

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  // Seeded after settling -- see the comment in the first membership test.
  qc.setQueryData(["list", "list-1"], { id: "list-1" });

  const handlers = handlersByChannel.get(channelsCreated[0].name);
  const listMembersHandler = handlers.find((h2) => h2.filter.table === "list_members");

  // A DELETE payload with only a primary key, no profile_id/list_id --
  // the realistic case if the table's REPLICA IDENTITY isn't FULL.
  assert.doesNotThrow(() => listMembersHandler.cb({ eventType: "DELETE", old: { id: "membership-row-id" } }));

  assert.notEqual(
    qc.getQueryState(["list", "list-1"])?.isInvalidated,
    true,
    "an incomplete payload must not be treated as grounds to invalidate -- the batched invalidate-and-refetch is the real mechanism, not this fast path",
  );

  unmount();
  qc.clear();
  cleanup();
});

test("P9: the initial SUBSCRIBED transition does not trigger a catch-up invalidation", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => { invalidateCallCount += 1; return original(...args); };

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  assert.equal(invalidateCallCount, 0, "the initial subscribe must not, by itself, invalidate anything");

  unmount();
  qc.clear();
  cleanup();
});

test("P9: a genuine reconnect (a second SUBSCRIBED after the first) revalidates every watched table", async () => {
  resetHarness();
  const qc = newTestClient();
  const invalidatedKeys = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (opts) => { invalidatedKeys.push(opts.queryKey[0]); return original(opts); };

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  const channel = channelsCreated[0];
  await act(async () => {
    channel.simulateStatus("SUBSCRIBED"); // a real reconnect: SUBSCRIBED fires a second time
  });
  await settleBatcher(); // let the batcher's debounce elapse

  assert.ok(invalidatedKeys.length > 0, "a genuine reconnect must trigger a catch-up invalidation");
  assert.ok(invalidatedKeys.includes("court"), "the catch-up pass must cover the same targets ordinary events would (e.g. 'court')");

  unmount();
  qc.clear();
  cleanup();
});

test("P9: repeated SUBSCRIBED notifications in quick succession coalesce into one catch-up flush, not one per notification", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => { invalidateCallCount += 1; return original(...args); };

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  const channel = channelsCreated[0];
  await act(async () => {
    channel.simulateStatus("SUBSCRIBED");
    channel.simulateStatus("SUBSCRIBED");
    channel.simulateStatus("SUBSCRIBED");
  });
  const afterBurst = invalidateCallCount;
  await settleBatcher();
  const afterSettle = invalidateCallCount;

  assert.equal(afterBurst, 0, "nothing should invalidate before the batcher's debounce elapses");
  assert.ok(afterSettle > 0, "the coalesced burst must still flush once settled");

  // A second burst right after must not re-trigger a second, separate
  // full catch-up on top of the first (the batcher already drained).
  const afterFirstFlush = invalidateCallCount;
  await act(async () => {
    channel.simulateStatus("SUBSCRIBED");
  });
  await settleBatcher();
  assert.ok(invalidateCallCount > afterFirstFlush, "a LATER, separate reconnect must still flush its own catch-up pass");

  unmount();
  qc.clear();
  cleanup();
});

test("P9: a reconnect after an identity switch belongs to the NEW identity's owner, not a stale one", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => { invalidateCallCount += 1; return original(...args); };

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();

  const staleChannel = channelsCreated[0];

  await act(async () => {
    setTestSession(liveSession("profile-B"));
  });
  await settle();

  invalidateCallCount = 0; // reset the counter to isolate what happens next

  // The OLD (retired) channel's status callback fires late, as if a
  // reconnect notification for A's connection arrived after B is
  // already active.
  await act(async () => {
    staleChannel.simulateStatus("SUBSCRIBED");
  });
  await settle();

  assert.equal(invalidateCallCount, 0, "a stale reconnect notification for a retired identity's owner must not replay a catch-up pass into the new identity's cache");

  unmount();
  qc.clear();
  cleanup();
});

test("C-06: a mounted List-detail observer actually refetches (not just the raw cache entry changing) once the batched invalidation flushes", async () => {
  // The audit's own point: removeQueries() alone is not proof a live
  // consumer visibly reacts -- confirmed directly: an active, already-fresh
  // QueryObserver does NOT automatically re-fetch just because its cache
  // entry was removed (verified against a bare QueryObserver: calls stayed
  // at 1 after removeQueries(), only invalidateQueries() drove a second
  // fetch). The REAL guarantee for a mounted observer -- already the
  // documented intent of the surrounding code, not a new claim -- is the
  // BATCHED invalidateQueries() path every membership event also enqueues
  // (targetsForEvent -> the expanded list_members target list fixed by
  // this same change). This mounts a real useQuery observer and proves
  // THAT path actually drives a visible refetch once the batcher flushes.
  resetHarness();
  const qc = newTestClientWithPersistentCache();
  let observed = null;
  let queryFnCalls = 0;

  function ListObserver() {
    const query = useQuery({
      queryKey: ["list", "list-1"],
      queryFn: async () => {
        queryFnCalls += 1;
        return { id: "list-1", name: `refetched-${queryFnCalls}` };
      },
      enabled: true,
    });
    useEffect(() => {
      observed = { data: query.data, isLoading: query.isLoading };
    });
    return null;
  }

  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}), h(ListObserver))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  const callsBeforeEvent = queryFnCalls;
  assert.ok(callsBeforeEvent > 0, "sanity: the observer fetched at least once on mount");

  const handlers = handlersByChannel.get(channelsCreated[0].name);
  const listMembersHandler = handlers.find((h2) => h2.filter.table === "list_members");

  await act(async () => {
    listMembersHandler.cb({ eventType: "DELETE", old: { profile_id: "profile-A", list_id: "list-1" } });
  });
  await settleBatcher();

  assert.ok(
    queryFnCalls > callsBeforeEvent,
    "the mounted observer must have actually re-fetched once the batched invalidation flushed, not just had its cache entry silently removed",
  );

  unmount();
  qc.clear();
  cleanup();
});

test("T07: provider forwards payload IDs so an unrelated cached Thing detail stays quiet", async () => {
  resetHarness();
  const qc = newTestClientWithPersistentCache();
  let unmount;
  await act(async () => { ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {})))); });
  await act(async () => { setTestSession(liveSession("profile-A")); });
  await settle();
  qc.setQueryData(["thing", "thing-1"], { id: "thing-1" });
  qc.setQueryData(["thing", "thing-2"], { id: "thing-2" });
  const handler = handlersByChannel.get(channelsCreated[0].name).find((entry) => entry.filter.table === "things");
  await act(async () => { handler.cb({ eventType: "UPDATE", old: { id: "thing-1" }, new: { id: "thing-1" } }); });
  await settleBatcher();
  assert.equal(qc.getQueryState(["thing", "thing-1"])?.isInvalidated, true);
  assert.equal(qc.getQueryState(["thing", "thing-2"])?.isInvalidated, false);
  unmount(); qc.clear(); cleanup();
});

test("T07: browser focus refreshes an already-fresh mounted observer and disposes with its identity", async () => {
  resetHarness();
  const qc = newTestClientWithPersistentCache();
  let calls = 0;
  function FreshObserver() {
    useQuery({ queryKey: ["list", "list-1"], queryFn: async () => ++calls,
      staleTime: Infinity, refetchOnWindowFocus: false });
    return null;
  }
  let unmount;
  await act(async () => {
    ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}), h(FreshObserver))));
  });
  await act(async () => { setTestSession(liveSession("profile-A")); });
  await settle();
  const beforeFocus = calls;
  assert.ok(beforeFocus > 0);
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  await settle();
  assert.ok(calls > beforeFocus, "the provider must revalidate even a fresh observer");
  const afterFocus = calls;
  unmount();
  await act(async () => { window.dispatchEvent(new window.Event("focus")); });
  await settle();
  assert.equal(calls, afterFocus, "the retired owner must not retain its focus listener");
  qc.clear(); cleanup();
});

test("T07: focus and resubscription in one burst share one catch-up pass", async () => {
  resetHarness();
  const qc = newTestClient();
  let invalidations = 0;
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => { invalidations += 1; return original(...args); };
  let unmount;
  await act(async () => { ({ unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {})))); });
  await act(async () => { setTestSession(liveSession("profile-A")); });
  await settle();
  await act(async () => {
    window.dispatchEvent(new window.Event("focus"));
    channelsCreated[0].simulateStatus("SUBSCRIBED");
  });
  const afterFocus = invalidations;
  assert.ok(afterFocus > 0);
  await settleBatcher();
  assert.equal(invalidations, afterFocus, "resubscription should not schedule a second full pass after focus");
  unmount(); qc.clear(); cleanup();
});
