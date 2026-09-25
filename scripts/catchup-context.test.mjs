import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T10-01: `fetchCatchupMoments()` (use-catchup.ts) took a `profileId` and
 * an AbortSignal but no `context` -- the query key already varied by
 * Work/Home (domain/query-keys.ts), but the fetch itself returned every
 * moment regardless of the resolved Thing's own context, so switching
 * context could show (or count) a moment that actually belongs to the
 * other context. This file exercises the fix: live and preview must both
 * filter on the resolved Thing's own context, not the query key alone.
 *
 * It also exercises the new readiness contract (`branch`/`isEmpty`) that
 * replaces trusting `!isLoading` as a stand-in for "confirmed empty".
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
let rpcRows = [];
let actorResult = { data: { id: "actor-1" }, error: null };
let thingsResult = { data: [], error: null };
let rpcPending = false; // when true, the RPC promise never settles (simulates "loading")

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => testSession,
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });
let currentContext = "work";
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: currentContext }) } });
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/demo/identities", { namedExports: { currentDemoActorId: () => "demo-actor-1" } });
mock.module("@/features/doorman/use-doorman", { namedExports: { isDoormanEnabled: () => false } });
mock.module("@/features/people/resolve-actors", { namedExports: { resolveActorPeople: async () => new Map() } });
// Identity mapping: the mocked DB rows already carry the shape a real Thing
// needs for this test (id + context), so mapDbThingRows just passes them
// through -- the real mapper's own capability/pace logic is out of scope
// for a context-filtering test.
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: async (rows) => rows.map((r) => ({ ...r })),
    THING_COLUMNS: "id",
    THING_OVERVIEW_COLUMNS: "id",
  },
});
mock.module("@/features/things/local-state", {
  namedExports: {
    accessibleDemoThings: () => [],
    getCatchupSurfaced: () => new Set(),
    getEndedSnoozeEntries: () => [],
    getGhostCandidate: () => null,
    getNotifications: () => [],
    getThing: () => null,
    personById: () => null,
    surfaceCatchupLocal: () => {},
  },
});
mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: (name) => {
      const node = {
        abortSignal: () => node,
        then: (resolve, reject) => {
          if (name === "list_catchup_moments") {
            if (rpcPending) return new Promise(() => {}); // never settles
            return Promise.resolve({ data: rpcRows, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return node;
    },
  },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "profile-1" } } }) },
      from: (table) => {
        const node = {
          select: () => node,
          eq: () => node,
          in: () => node,
          is: () => node,
          abortSignal: () => node,
          maybeSingle: async () => actorResult,
          then: (resolve) => {
            if (table === "things") return Promise.resolve(thingsResult).then(resolve);
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return node;
      },
    },
  },
});

const { useCatchup } = await import("@/features/catchup/use-catchup");

function Probe({ onValue }) {
  const value = useCatchup();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mountAndSettle(qc) {
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return () => latest;
}

test("D01: a mixed Work/Home RPC result only surfaces moments/counts for the currently active context", async () => {
  currentContext = "work";
  rpcPending = false;
  rpcRows = [
    { moment_key: "m-work", kind: "nudge", thing_id: "t-work", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "waiting_for_catch" },
    { moment_key: "m-home", kind: "nudge", thing_id: "t-home", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "waiting_for_catch" },
  ];
  actorResult = { data: { id: "actor-1" }, error: null };
  thingsResult = {
    data: [
      { id: "t-work", context: "work" },
      { id: "t-home", context: "home" },
    ],
    error: null,
  };
  const qc = newClient();
  const getLatest = await mountAndSettle(qc);

  assert.equal(getLatest().count, 1, "only the Work-context moment should count while Work is active");
  assert.equal(getLatest().moments[0]?.thing.id, "t-work");
  assert.equal(getLatest().error, null);

  cleanup();
  qc.clear();
});

test("D01b: switching the active context to Home surfaces the Home moment instead", async () => {
  currentContext = "home";
  const qc = newClient();
  const getLatest = await mountAndSettle(qc);

  assert.equal(getLatest().count, 1);
  assert.equal(getLatest().moments[0]?.thing.id, "t-home");

  cleanup();
  qc.clear();
  currentContext = "work";
});

test("D04: pending initial data reports the 'loading' branch, not a false confirmed-empty", async () => {
  rpcPending = true;
  rpcRows = [];
  const qc = newClient();
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });

  assert.equal(latest.branch, "loading");
  assert.equal(latest.isEmpty, false, "an unsettled query must never report a confirmed-empty result");

  cleanup();
  qc.clear();
  rpcPending = false;
});

test("D05: a background error with previously-cached moments stays 'ready' (stale-but-usable), not blocked", async () => {
  rpcPending = false;
  rpcRows = [{ moment_key: "m-cached", kind: "nudge", thing_id: "t-work", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "x" }];
  actorResult = { data: { id: "actor-1" }, error: null };
  thingsResult = { data: [{ id: "t-work", context: "work" }], error: null };
  currentContext = "work";
  const qc = newClient();
  const getLatest = await mountAndSettle(qc);
  assert.equal(getLatest().count, 1);
  assert.equal(getLatest().branch, "ready");

  // Now force the next fetch (a refetch) to fail while cached data remains.
  thingsResult = { data: null, error: { message: "temporary failure" } };
  await act(async () => {
    await qc.refetchQueries({ queryKey: ["catchup"] }).catch(() => {});
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.ok(getLatest().error, "the background failure must still surface as `error`");
  assert.equal(getLatest().moments.length, 1, "stale non-empty data must survive a background failure");
  assert.equal(getLatest().branch, "ready", "a transient background failure with cached non-empty data is not a confirmed access loss");
  assert.equal(getLatest().confirmedAccessLoss, false);

  cleanup();
  qc.clear();
});

test("confirmedAccessLoss is true for a structured 403/forbidden failure", async () => {
  rpcPending = false;
  rpcRows = [{ moment_key: "m-x", kind: "nudge", thing_id: "t-work", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "x" }];
  actorResult = { data: { id: "actor-1" }, error: null };
  thingsResult = { data: null, error: { status: 403, message: "forbidden" } };
  currentContext = "work";
  const qc = newClient();
  const getLatest = await mountAndSettle(qc);

  assert.ok(getLatest().error);
  assert.equal(getLatest().confirmedAccessLoss, true);
  assert.equal(getLatest().branch, "error-blocked");

  cleanup();
  qc.clear();
});
