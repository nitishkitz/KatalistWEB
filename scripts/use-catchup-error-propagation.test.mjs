import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * F-05 (audit): fetchCatchupMoments() (use-catchup.ts) discarded the
 * `error` field from both its actor lookup and its required Things
 * lookup, falling through to an empty/null result either way -- a real
 * lookup failure was indistinguishable from "there is genuinely nothing
 * to show", which let a consumer (Morning Brief's auto-open) treat an
 * uncertain result as confirmed-empty. Both lookups now throw on error,
 * and useCatchup() exposes that as a new `error` field.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
let rpcRows = [];
let actorResult = { data: { id: "actor-1" }, error: null };
let thingsResult = { data: [], error: null };

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => testSession,
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: "work" }) } });
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/demo/identities", { namedExports: { currentDemoActorId: () => "demo-actor-1" } });
mock.module("@/features/doorman/use-doorman", { namedExports: { isDoormanEnabled: () => false } });
// Neither error-path test below ever reaches these -- both throw before
// mapDbThingRows/resolveActorPeople would be called -- but the module-level
// imports still need to link, and their own dependency trees (demo
// identities, etc.) go several levels deep for no benefit to these tests.
mock.module("@/features/people/resolve-actors", { namedExports: { resolveActorPeople: async () => new Map() } });
mock.module("@/features/things/map-thing-rows", {
  namedExports: { mapDbThingRows: async () => [], THING_COLUMNS: "id" },
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
    callUngeneratedRpc: async (name) => {
      if (name === "list_catchup_moments") return { data: rpcRows, error: null };
      return { data: null, error: null };
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

test("an actor-lookup error surfaces as catchup.error, not a silently-empty result", async () => {
  rpcRows = [{ moment_key: "m1", kind: "nudge", thing_id: "t1", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "x" }];
  actorResult = { data: null, error: { message: "actor lookup failed" } };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.ok(latest.error, "the actor lookup's error must surface, not be swallowed");
  assert.equal(latest.count, 0);

  cleanup();
  qc.clear();
});

test("a Things-lookup error surfaces as catchup.error, not a silently-empty result", async () => {
  rpcRows = [{ moment_key: "m1", kind: "nudge", thing_id: "t1", occurred_at: "2026-06-15T10:00:00Z", actor_id: null, reason: "x" }];
  actorResult = { data: { id: "actor-1" }, error: null };
  thingsResult = { data: null, error: { message: "things lookup failed" } };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.ok(latest.error, "the Things lookup's error must surface, not be swallowed as an empty moments list");
  assert.equal(latest.count, 0);

  cleanup();
  qc.clear();
});
