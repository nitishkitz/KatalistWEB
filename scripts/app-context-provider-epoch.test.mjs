import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useState, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, getIdentityEpoch } from "@/features/realtime/identity-cache-policy";

/**
 * P3: setContext's profile-update RPC can straddle an identity switch --
 * started under A, completing after B is active. A full, keyless
 * qc.invalidateQueries() firing after that point would force an
 * unnecessary refetch storm on B's already-settled UI, and rolling back
 * the optimistic context flip to A's `prev` value would incorrectly
 * overwrite B's own context state. Both are now guarded by the epoch
 * captured at the start of setContext.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testSession = { user: { id: "profile-A" }, session: { user: { id: "profile-A", app_metadata: {} } } };
mock.module("@/hooks/useSession", {
  namedExports: { useSession: () => testSession },
});
mock.module("@/lib/session-mode", {
  namedExports: { isPreviewSession: () => false },
});
mock.module("@/features/demo/identities", {
  namedExports: { currentDemoActorId: () => "demo" },
});

let rpcResolve;
let rpcPromise;
function resetRpcGate() {
  rpcPromise = new Promise((resolve) => {
    rpcResolve = resolve;
  });
}
resetRpcGate();

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => ({
        update: () => ({
          eq: async () => {
            await rpcPromise;
            return { error: null };
          },
        }),
        // The provider's own DB-driven context-sync effect reads
        // profiles.active_context on mount -- not under test here, so
        // it just resolves to "no row" immediately.
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    },
  },
});

const { AppContextProvider, useAppContext } = await import("@/features/context/AppContextProvider");

function newTestClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: 0, staleTime: 0, retry: false } } });
}

let latestSetContext = null;
function Consumer() {
  const { setContext } = useAppContext();
  useEffect(() => {
    latestSetContext = setContext;
  }, [setContext]);
  return null;
}

test("a context update started under A that resolves after a switch to B does not run a full invalidateQueries() or overwrite B's context", async () => {
  testSession = { user: { id: "profile-A" }, session: { user: { id: "profile-A", app_metadata: {} } } };
  resetRpcGate();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const originalInvalidate = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => {
    invalidateCallCount += 1;
    return originalInvalidate(...args);
  };

  let unmount;
  await act(async () => {
    const r = render(
      h(QueryClientProvider, { client: qc }, h(AppContextProvider, null, h(Consumer))),
    );
    unmount = r.unmount;
  });

  // Kick off a context switch under identity A -- the RPC won't resolve
  // until we release the gate below.
  let switchPromise;
  await act(async () => {
    switchPromise = latestSetContext("home");
  });

  // Simulate the identity switch happening while the RPC is still in
  // flight.
  advanceIdentityEpoch(qc, { kind: "live", profileId: "B" });

  // Now let the stale RPC resolve.
  await act(async () => {
    rpcResolve();
    await switchPromise;
  });

  assert.equal(
    invalidateCallCount,
    0,
    "a context-update completion that resolves after the identity has switched must not run a full invalidateQueries()",
  );

  unmount();
  qc.clear();
  cleanup();
});

test("a context update that resolves before any switch still runs its invalidateQueries() normally", async () => {
  testSession = { user: { id: "profile-A" }, session: { user: { id: "profile-A", app_metadata: {} } } };
  resetRpcGate();
  const qc = newTestClient();
  let invalidateCallCount = 0;
  const originalInvalidate = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => {
    invalidateCallCount += 1;
    return originalInvalidate(...args);
  };

  let unmount;
  await act(async () => {
    const r = render(
      h(QueryClientProvider, { client: qc }, h(AppContextProvider, null, h(Consumer))),
    );
    unmount = r.unmount;
  });

  await act(async () => {
    rpcResolve();
    await latestSetContext("home");
  });

  assert.equal(invalidateCallCount, 1, "the normal, no-switch path must still invalidate as before");

  unmount();
  qc.clear();
  cleanup();
});
