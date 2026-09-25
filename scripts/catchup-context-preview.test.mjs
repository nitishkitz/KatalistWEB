import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T10-01 (D02): derivePreviewMoments() (use-catchup.ts) resolved a nudge or
 * snooze_ended moment's Thing via a bare getThing(id) -- which resolves by
 * id alone, ignoring both the active Work/Home context and whether the
 * Thing is still accessible (e.g. removed from a shared list). This let a
 * moment for a Thing in the OTHER context, or one the actor can no longer
 * see, still surface. Ghost breakthroughs are the deliberate exception:
 * getGhostCandidate() surfaces a Thing from the other context by design.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { app_metadata: { provider: "demo" } } }, user: { id: "demo-actor-1" } }),
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => true } });
let currentContext = "work";
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: currentContext }) } });
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/demo/identities", { namedExports: { currentDemoActorId: () => "demo-actor-1" } });
mock.module("@/features/doorman/use-doorman", { namedExports: { isDoormanEnabled: () => true } });
mock.module("@/features/people/resolve-actors", { namedExports: { resolveActorPeople: async () => new Map() } });
mock.module("@/features/things/map-thing-rows", {
  namedExports: { mapDbThingRows: async () => [], THING_COLUMNS: "id", THING_OVERVIEW_COLUMNS: "id" },
});
mock.module("@/integrations/supabase/rpcs", {
  namedExports: { callUngeneratedRpc: () => ({ abortSignal: () => ({ then: (r) => Promise.resolve({ data: [], error: null }).then(r) }) }) },
});
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: { auth: { getUser: async () => ({ data: { user: null } }) }, from: () => ({}) } },
});

// A small fixed world: t-work-accessible is in Work and viewable; t-home-only
// is in Home only (not returned by accessibleDemoThings("work")); t-hidden is
// in Work but NOT in the accessible set (simulates "removed from a shared
// list" -- accessible-but-absent is exactly the case a bare getThing() would
// have missed). t-ghost-home is the ghost's own cross-context Thing.
// workStatus: "sorted" makes isActiveThing() (domain/thing.ts) return false
// before it would otherwise dereference `owner`/`assignee` -- these fixtures
// only need to exercise the nudge/snooze/ghost context gate, not the
// follow_up loop's own owner/assignee due-date logic.
const things = {
  "t-work-accessible": { id: "t-work-accessible", context: "work", workStatus: "sorted", cancelledAt: null },
  "t-home-only": { id: "t-home-only", context: "home", workStatus: "sorted", cancelledAt: null },
  "t-hidden": { id: "t-hidden", context: "work", workStatus: "sorted", cancelledAt: null },
  "t-ghost-home": { id: "t-ghost-home", context: "home", workStatus: "sorted", cancelledAt: null },
};

mock.module("@/features/things/local-state", {
  namedExports: {
    accessibleDemoThings: (context) =>
      Object.values(things).filter((t) => t.context === context && t.id !== "t-hidden"),
    getCatchupSurfaced: () => new Set(),
    getEndedSnoozeEntries: () => [{ thingId: "t-hidden", untilMs: Date.parse("2026-06-15T09:00:00Z") }],
    getGhostCandidate: (activeContext) => (activeContext === "work" ? things["t-ghost-home"] : null),
    getNotifications: () => [
      { id: "n1", type: "NUDGED", thingId: "t-work-accessible", at: "2026-06-15T10:00:00Z", read: false, title: "", body: "", recipientActorId: "demo-actor-1" },
      { id: "n2", type: "NUDGED", thingId: "t-home-only", at: "2026-06-15T10:00:00Z", read: false, title: "", body: "", recipientActorId: "demo-actor-1" },
    ],
    getThing: (id) => things[id],
    personById: () => null,
    surfaceCatchupLocal: () => {},
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

async function mountAndSettle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  return { qc, getLatest: () => latest };
}

test("D02: preview nudge for a Home-only Thing is excluded while Work is active", async () => {
  currentContext = "work";
  const { qc, getLatest } = await mountAndSettle();
  const keys = getLatest().moments.map((m) => m.momentKey);
  assert.ok(keys.some((k) => k.includes("n1")), "the Work-context nudge must be present");
  assert.ok(!keys.some((k) => k.includes("n2")), "the Home-only nudge must not be present while Work is active");
  cleanup();
  qc.clear();
});

test("D02: a snooze_ended moment for a Thing not in the accessible set is excluded, even though getThing() can still resolve it", async () => {
  currentContext = "work";
  const { qc, getLatest } = await mountAndSettle();
  const snoozeMoments = getLatest().moments.filter((m) => m.kind === "snooze_ended");
  assert.equal(snoozeMoments.length, 0, "t-hidden is Work-context but not accessible -- must not surface");
  cleanup();
  qc.clear();
});

test("D02: a ghost breakthrough legitimately surfaces a Thing from the OTHER context", async () => {
  currentContext = "work";
  const { qc, getLatest } = await mountAndSettle();
  const ghost = getLatest().moments.find((m) => m.kind === "ghost");
  assert.ok(ghost, "the ghost candidate must still surface");
  assert.equal(ghost.thing.id, "t-ghost-home");
  assert.equal(ghost.thing.context, "home", "ghost is deliberately cross-context, unlike nudge/snooze");
  cleanup();
  qc.clear();
});
