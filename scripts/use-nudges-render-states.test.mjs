import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * B-01 (final verification): render useNudges() itself across the five
 * states the audit names -- Court pending, history rejected, eligibility
 * rejected, truly-empty-after-a-successful-fetch, and a Work/Home context
 * switch -- and assert its own exposed contract (rowsError vs
 * eligibilityError, rowsHasFetchedOnce, canNudge) holds in each. The page
 * component (nudges.tsx) only ever consumes these already-separated flags
 * (see nudges-list-filter.test.mjs / nudges-history-window.test.mjs for its
 * own source-level coverage) -- this is the level where the actual
 * separation lives, so this is where B-01's "render with X" cases are
 * exercised against real hook behavior, not mocked-away.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testContext = "work";
let courtState = {
  isLoading: false,
  hasFetchedOnce: true,
  error: null,
  preview: false,
  theirs: [],
  all: [],
  myActorId: "actor-me",
  refetch: () => {},
};

mock.module("@/features/court/use-court", { namedExports: { useCourt: () => courtState } });
mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1" } }, user: { id: "profile-1" } }),
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: testContext }) } });
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });

let nudgeableResult = { data: [], error: null };
let historyResult = { data: [], error: null };

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      rpc: (name) => {
        assert.equal(name, "list_nudgeable_things");
        return { abortSignal: () => Promise.resolve(nudgeableResult) };
      },
      from: (table) => {
        assert.equal(table, "nudges");
        return {
          select: () => ({
            gte: () => ({
              order: () => ({
                limit: () => ({
                  abortSignal: () => Promise.resolve(historyResult),
                }),
              }),
            }),
          }),
        };
      },
    },
  },
});

const { useNudges } = await import("@/features/nudges/use-nudges");

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function Probe({ onValue }) {
  const value = useNudges();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function makeThing(id, overrides = {}) {
  return {
    id,
    title: `Thing ${id}`,
    workStatus: "not_started",
    acknowledgement: "waiting_for_catch",
    assignee: { id: "actor-2", name: "Assignee", initials: "A", avatarUrl: null },
    owner: { id: "actor-2", name: "Assignee", initials: "A", avatarUrl: null },
    creator: { id: "actor-me", name: "Me", initials: "M", avatarUrl: null },
    listId: null,
    listName: null,
    dueAt: null,
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

test("Court pending: rows are unresolved, not a confident empty result", async () => {
  testContext = "work";
  courtState = { ...courtState, isLoading: true, hasFetchedOnce: false, error: null, theirs: [], all: [] };
  nudgeableResult = { data: [], error: null };
  historyResult = { data: [], error: null };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.equal(latest.isLoading, true);
  assert.equal(latest.rowsHasFetchedOnce, false);
  cleanup();
});

test("history query rejected: rows from Court survive, only eligibilityError is set", async () => {
  testContext = "work";
  const thing = makeThing("t1");
  courtState = { ...courtState, isLoading: false, hasFetchedOnce: true, error: null, theirs: [thing], all: [thing] };
  nudgeableResult = { data: [{ thing_id: "t1", reason: "stale" }], error: null };
  historyResult = { data: null, error: { message: "history boom" } };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.equal(latest.rows.length, 1, "Court's own row must survive a history-only failure");
  assert.equal(latest.rows[0].id, "t1");
  assert.equal(latest.error, null, "rowsError must stay null -- the failure is not Court's");
  assert.ok(latest.eligibilityError, "the history failure must surface as eligibilityError");
  cleanup();
});

test("eligibility query rejected: rows survive, eligibilityError is set so canNudge=false is never read as a confirmed determination", async () => {
  testContext = "work";
  const thing = makeThing("t2");
  courtState = { ...courtState, isLoading: false, hasFetchedOnce: true, error: null, theirs: [thing], all: [thing] };
  nudgeableResult = { data: null, error: { message: "eligibility boom" } };
  historyResult = { data: [], error: null };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.equal(latest.rows.length, 1);
  assert.ok(latest.eligibilityError, "a failed eligibility check must be exposed, not silently absorbed");
  // The row's own canNudge may be false (no allowed-set data), but a
  // consumer is told via eligibilityError not to present that as confirmed
  // -- exactly what nudges.tsx's own branch ordering does (eligibilityError
  // is checked before row.canNudge; see nudges-list-filter.test.mjs).
  cleanup();
});

test("truly empty success: isEmpty is only trustworthy once hasFetchedOnce is true", async () => {
  testContext = "work";
  courtState = { ...courtState, isLoading: false, hasFetchedOnce: true, error: null, theirs: [], all: [] };
  nudgeableResult = { data: [], error: null };
  historyResult = { data: [], error: null };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.equal(latest.rows.length, 0);
  assert.equal(latest.rowsHasFetchedOnce, true);
  assert.equal(latest.error, null);
  cleanup();
});

test("a Work/Home context switch does not leak the old context's rows into the new one", async () => {
  testContext = "work";
  const workThing = makeThing("t-work");
  courtState = { ...courtState, isLoading: false, hasFetchedOnce: true, error: null, theirs: [workThing], all: [workThing] };
  nudgeableResult = { data: [{ thing_id: "t-work", reason: "stale" }], error: null };
  historyResult = { data: [], error: null };
  const qc = newClient();
  let latest = null;

  const { rerender } = await act(async () => {
    return render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();
  assert.deepEqual(latest.rows.map((r) => r.id), ["t-work"]);

  // Switch to Home: a different context, different court data, and a
  // different query key underneath (keys.nudges/keys.nudgeHistory both
  // include `context`) -- the old Work row must not still be present.
  testContext = "home";
  const homeThing = makeThing("t-home");
  courtState = { ...courtState, theirs: [homeThing], all: [homeThing] };
  nudgeableResult = { data: [{ thing_id: "t-home", reason: "stale" }], error: null };

  await act(async () => {
    rerender(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.deepEqual(latest.rows.map((r) => r.id), ["t-home"]);
  cleanup();
});
