import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, StrictMode, useEffect, useRef, useState } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Real component-level tests for IdentityBoundary (P3), using a real DOM
 * (jsdom) and real React rendering -- the QueryClient/QueryObserver probes
 * elsewhere in this suite prove library behavior, not React boundary
 * behavior (whether a fallback is actually rendered before paint, whether
 * Strict Mode double-invocation is idempotent, whether a mounted
 * consumer's effect actually tears down on a keyed remount). None of
 * that is observable without a real DOM and real React rendering.
 *
 * gcTime: 0 / retry: false / explicit unmount()+qc.clear() in every test:
 * without these, a fresh QueryClient's default 5-minute gcTime timer (and
 * retry backoff timers, if a query ever failed) keep the Node process's
 * event loop alive well past the test itself completing, so `node --test`
 * hangs waiting for the process to exit even though every assertion
 * already passed.
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

mock.module("@/hooks/useSession", {
  namedExports: { useSession: useSessionMock },
});
mock.module("@/lib/session-mode", {
  namedExports: {
    isPreviewSession: (session) => session?.user?.app_metadata?.provider === "demo",
  },
});

const { IdentityBoundary } = await import("@/features/realtime/IdentityBoundary");

function liveSession(profileId) {
  return { loading: false, session: { user: { id: profileId, app_metadata: {} } } };
}

function newTestClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: 0, staleTime: 0, retry: false } } });
}

let mountCount = 0;
let currentOwner = "A";

function ProtectedConsumer() {
  const qc = useQueryClient();
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    mountCount += 1;
  }
  const { data, status } = useQuery({
    queryKey: ["thing", "shared-1"],
    queryFn: async () => ({ id: "shared-1", owner: currentOwner }),
  });
  void qc;
  return h(
    "div",
    { "data-testid": "protected-content" },
    status === "success" ? `owner:${data.owner}` : `status:${status}`,
  );
}

let seededMountCount = 0;
let currentProfileId = "profile-A";

// Mirrors useList()'s real shape: an entity-only-keyed query seeded via
// initialData from a PROFILE-SCOPED cache slot (keys.lists(profileId,
// context)-equivalent). This is the pattern that matters for the
// initialData-vs-resetQueries() finding in identity-cache-reset-probe.test.mjs
// -- proving here that the real boundary+remount flow never exposes it,
// not just that the underlying library behavior is as documented.
function SeededConsumer() {
  const qc = useQueryClient();
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    seededMountCount += 1;
  }
  const { data, status } = useQuery({
    queryKey: ["list", "shared-list"],
    initialData: () => qc.getQueryData(["lists", currentProfileId])?.find((l) => l.id === "shared-list"),
    initialDataUpdatedAt: 0,
    queryFn: async () => ({ id: "shared-list", owner: currentOwner }),
  });
  return h(
    "div",
    { "data-testid": "seeded-content" },
    status === "success" && data ? `owner:${data.owner}` : `status:${status}`,
  );
}

function Harness({ strict, seeded }) {
  const tree = h(IdentityBoundary, null, seeded ? h(SeededConsumer) : h(ProtectedConsumer));
  return strict ? h(StrictMode, null, tree) : tree;
}

function resetHarness() {
  testSession = { loading: true, session: null };
  sessionListeners.clear();
  mountCount = 0;
  seededMountCount = 0;
  currentProfileId = "profile-A";
  currentOwner = "A";
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

test("pending renders a distinct fallback, never protected content", async () => {
  resetHarness();
  const qc = newTestClient();
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  assert.ok(container.querySelector('[data-testid="identity-boundary-pending"]'));
  assert.equal(container.querySelector('[data-testid="protected-content"]'), null);
  unmount();
  qc.clear();
  cleanup();
});

test("a live identity resolves through aligning to ready, mounting the protected consumer exactly once, showing that identity's data", async () => {
  resetHarness();
  const qc = newTestClient();
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.querySelector('[data-testid="identity-boundary-pending"]'), null);
  assert.equal(container.querySelector('[data-testid="identity-boundary-aligning"]'), null);
  assert.ok(container.querySelector('[data-testid="protected-content"]'), "protected content must render once ready");
  assert.equal(container.textContent, "owner:A");
  assert.equal(mountCount, 1, "the consumer must have mounted exactly once for this one identity");
  unmount();
  qc.clear();
  cleanup();
});

test("a live A -> live B switch never shows A's data after the switch begins, remounts the consumer, and settles on B's data", async () => {
  resetHarness();
  const qc = newTestClient();
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.textContent, "owner:A");
  assert.equal(mountCount, 1);

  // Switch: identity changes, and the underlying data source also
  // changes what it would return for the same entity-only key.
  currentOwner = "B";
  await act(async () => {
    setTestSession(liveSession("profile-B"));
  });

  // Immediately after the switch begins (before settling), protected
  // content must never show A's stale data -- either it's gone
  // (aligning fallback) or it's already B's.
  const immediatelyAfter = container.textContent;
  assert.ok(
    !immediatelyAfter.includes("owner:A"),
    `must never show A's data after the switch begins; saw: ${immediatelyAfter}`,
  );

  await settle();

  assert.equal(container.textContent, "owner:B", "must settle on B's data");
  assert.equal(mountCount, 2, "the consumer must have been unmounted and remounted exactly once across the switch, not reused");
  unmount();
  qc.clear();
  cleanup();
});

test("repeated pending transitions and re-resolution to the same identity do not throw and still converge correctly", async () => {
  resetHarness();
  const qc = newTestClient();
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, {}))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.textContent, "owner:A");

  // Simulate a transient pending re-entry (not reachable with today's
  // useSession() implementation, but the boundary must not crash or
  // misrender if it ever happens) followed by re-resolving to the SAME
  // identity.
  await act(async () => {
    setTestSession({ loading: true, session: null });
  });
  assert.equal(
    container.querySelector('[data-testid="protected-content"]'),
    null,
    "pending must withhold protected content even after a prior ready state",
  );

  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.textContent, "owner:A", "must converge back to the same identity's data without throwing");
  unmount();
  qc.clear();
  cleanup();
});

// Confirmed (node_modules/react-dom/index.js:31) that react-dom switches
// to its development build whenever NODE_ENV !== "production" -- true
// here -- and the development build is what implements Strict Mode's
// double-invocation. This test is exercising real double-invocation
// behavior, not silently passing because a production build made
// StrictMode a no-op.
test("Strict Mode: the consumer does not appear mounted more than once for one real transition", async () => {
  resetHarness();
  const qc = newTestClient();
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, { strict: true }))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.textContent, "owner:A");
  assert.equal(
    mountCount,
    1,
    "Strict Mode's dev-only double-invocation must not cause the consumer to appear mounted more than once for one real transition",
  );
  unmount();
  qc.clear();
  cleanup();
});

test("a seeded (initialData-backed) consumer never shows A's stale seed after a live A -> live B switch, because it's remounted, not merely reset", async () => {
  // identity-cache-reset-probe.test.mjs proves resetQueries() alone
  // does NOT clear an initialData-backed observer the way it clears a
  // plain one -- it falls back to re-evaluating (possibly stale)
  // initialData while refetching. This test proves the real boundary
  // flow never exposes that: the seeded consumer is unmounted (via the
  // keyed remount) before resetQueries() even runs, so no stale
  // initialData-backed observer survives into the reset window at all.
  resetHarness();
  const qc = newTestClient();
  qc.setQueryData(["lists", "profile-A"], [{ id: "shared-list", owner: "A-seed" }]);
  let container, unmount;
  await act(async () => {
    ({ container, unmount } = render(h(QueryClientProvider, { client: qc }, h(Harness, { seeded: true }))));
  });
  await act(async () => {
    setTestSession(liveSession("profile-A"));
  });
  await settle();
  assert.equal(container.textContent, "owner:A");
  assert.equal(seededMountCount, 1);

  currentOwner = "B";
  currentProfileId = "profile-B";
  // Deliberately do NOT seed ["lists", "profile-B"] with anything --
  // simulating a fresh identity with no stale carryover at all.
  await act(async () => {
    setTestSession(liveSession("profile-B"));
  });

  const immediatelyAfter = container.textContent;
  assert.ok(
    !immediatelyAfter.includes("A-seed") && !immediatelyAfter.includes("owner:A"),
    `must never show A's seed or data after the switch begins; saw: ${immediatelyAfter}`,
  );

  await settle();
  assert.equal(container.textContent, "owner:B");
  assert.equal(seededMountCount, 2, "the seeded consumer must have been unmounted and remounted, not merely reset in place");
  unmount();
  qc.clear();
  cleanup();
});
