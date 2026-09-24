import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * P5 (payload/duplicate-request reduction): fetchProfileIdentities() hits a
 * server endpoint + RPC fallbacks and used to be called directly by every
 * fetchXxx helper that needed to resolve display names (list messages,
 * conversations, contacts, hub files, list/bucket mapping...). Several of
 * those helpers commonly run concurrently on the same page (e.g. a List
 * detail's own fetch plus its chat panel's message fetch), each re-hitting
 * the directory independently. getProfileIdentities(qc) routes them all
 * through one shared react-query cache entry (the same one
 * useProfileDirectoryQuery() itself uses) via qc.fetchQuery, which
 * deduplicates concurrent calls and reuses a still-fresh result.
 */

let fetchCallCount = 0;

// H04: directory.ts's useProfileDirectoryQuery() now gates on useSession()
// (see its own comment for why -- it used to fire unconditionally,
// including for signed-out visitors). getProfileIdentities() itself
// (exercised below) never calls useSession, but the module-level import
// still needs these bindings to link -- and session-mode.ts (imported for
// the same gating) also needs getStoredDemoSession from this same module.
mock.module("@/hooks/useSession", {
  namedExports: { DEMO_PERSONAS: [], useSession: () => ({ user: null, session: null }), getStoredDemoSession: () => null },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: () => {
        const node = { select: () => node, then: (resolve) => resolve({ data: [], error: null }) };
        return node;
      },
      rpc: async () => ({ data: [], error: null }),
    },
  },
});
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async () => {
      fetchCallCount += 1;
      return { ok: false };
    },
  },
});

const { getProfileIdentities } = await import("@/features/people/directory");

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

test("getProfileIdentities dedupes concurrent callers on the same QueryClient into one fetch", async () => {
  fetchCallCount = 0;
  const qc = newClient();

  const [a, b, c] = await Promise.all([
    getProfileIdentities(qc),
    getProfileIdentities(qc),
    getProfileIdentities(qc),
  ]);

  assert.equal(fetchCallCount, 1, "three concurrent callers must share one underlying directory fetch");
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);

  qc.clear();
});

test("getProfileIdentities reuses a still-fresh cached result for a later sequential call", async () => {
  fetchCallCount = 0;
  const qc = newClient();

  await getProfileIdentities(qc);
  await getProfileIdentities(qc);

  assert.equal(fetchCallCount, 1, "a second call within staleTime must not re-hit the directory endpoint");

  qc.clear();
});

test("getProfileIdentities on two independent QueryClients does not share state", async () => {
  fetchCallCount = 0;
  const qcA = newClient();
  const qcB = newClient();

  await getProfileIdentities(qcA);
  await getProfileIdentities(qcB);

  assert.equal(fetchCallCount, 2, "each QueryClient dedupes only against its own calls, never across clients");

  qcA.clear();
  qcB.clear();
});
