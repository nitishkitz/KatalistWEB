import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";

/**
 * F01/F04: use-morning-brief.ts wires the schedule model, the receipt
 * adapter, Catch Up's moments, and the interaction blocker into one
 * open/dismiss/reopen contract. Every heavy dependency is mocked at its
 * own module boundary; morning-brief-schedule.ts and
 * InteractionBlockerProvider are used for real (both already have their
 * own dedicated test files proving their own contracts in isolation).
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
let testPreview = false;
let catchupCount = 1;
let catchupLoading = false;
let profileTimezone = "America/New_York";
let flagEnabled = false;

mock.module("@/hooks/useSession", { namedExports: { useSession: () => testSession } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => testPreview } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: "work" }) } });
mock.module("@/features/me/use-profile", {
  namedExports: { useProfile: () => ({ data: { timezone: profileTimezone }, isLoading: false }) },
});
mock.module("@/features/demo/identities", { namedExports: { currentDemoActorId: () => "demo-actor-1" } });
mock.module("@/features/catchup/use-catchup", {
  namedExports: {
    useCatchup: () => ({
      moments: [],
      count: catchupCount,
      isLoading: catchupLoading,
      surfaceMoment: () => {},
      refresh: () => {},
    }),
  },
});
mock.module("@/features/catchup/morning-brief-flag", {
  namedExports: { morningBriefAutoOpenEnabled: () => flagEnabled },
});

let claimCalls = [];
let claimResult = { claimed: true, localDate: "2026-06-15", timezone: "America/New_York", presentedAt: "x" };
let dismissCalls = [];
mock.module("@/features/catchup/morning-brief-receipts", {
  namedExports: {
    claimMorningBriefLive: async (context, tz) => {
      claimCalls.push({ context, tz });
      return claimResult;
    },
    claimMorningBriefPreview: async (actorId, context, dateKey, tz) => {
      claimCalls.push({ actorId, context, dateKey, tz });
      return claimResult;
    },
    dismissMorningBriefLive: async (context, tz) => {
      dismissCalls.push({ context, tz });
    },
    dismissMorningBriefPreview: (actorId, context, dateKey) => {
      dismissCalls.push({ actorId, context, dateKey });
    },
  },
});

const { useMorningBrief } = await import("@/features/catchup/use-morning-brief");

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function Probe({ onValue }) {
  const value = useMorningBrief();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function Blocker({ blocked }) {
  useBlockWhile(blocked, "active-call");
  return null;
}

function resetShared() {
  testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
  testPreview = false;
  catchupCount = 1;
  catchupLoading = false;
  profileTimezone = "America/New_York";
  flagEnabled = false;
  claimCalls = [];
  dismissCalls = [];
  claimResult = { claimed: true, localDate: "2026-06-15", timezone: "America/New_York", presentedAt: "x" };
}

test("with the flag disabled (the default), never auto-opens even when otherwise eligible", async () => {
  resetShared();
  flagEnabled = false;
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false);
  assert.equal(claimCalls.length, 0, "the flag being off must mean no claim is even attempted");

  cleanup();
  qc.clear();
});

test("with the flag enabled and eligible, claims and opens automatically", async () => {
  resetShared();
  flagEnabled = true;
  claimResult = { claimed: true, localDate: "2026-06-15", timezone: "America/New_York", presentedAt: "x" };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 1, "exactly one claim attempt");
  assert.equal(latest.open, true);
  assert.equal(latest.alreadyPresentedToday, true);

  cleanup();
  qc.clear();
});

test("a claim that reports claimed:false (already shown today) does not open, but does mark alreadyPresentedToday", async () => {
  resetShared();
  flagEnabled = true;
  claimResult = { claimed: false, localDate: "2026-06-15", timezone: "America/New_York", presentedAt: "earlier" };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false, "already claimed by an earlier visit today -- must not auto-open again");
  assert.equal(latest.alreadyPresentedToday, true);

  cleanup();
  qc.clear();
});

test("no actionable moments: never attempts a claim at all", async () => {
  resetShared();
  flagEnabled = true;
  catchupCount = 0;
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 0);
  assert.equal(latest.open, false);

  cleanup();
  qc.clear();
});

test("an active call (via the D03 InteractionBlockerProvider) suppresses the automatic open", async () => {
  resetShared();
  flagEnabled = true;
  const qc = newClient();
  let latest = null;
  let rerender;

  // The blocker is registered and committed BEFORE Morning Brief's own
  // hook ever mounts -- matching a real scenario (a call already active
  // when the page/hook first renders), and avoiding a same-commit
  // ordering race between the blocker's registration effect and Morning
  // Brief's own claim-attempting effect.
  await act(async () => {
    const result = render(
      h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, h(Blocker, { blocked: true }))),
    );
    rerender = result.rerender;
  });

  await act(async () => {
    rerender(
      h(
        QueryClientProvider,
        { client: qc },
        h(
          InteractionBlockerProvider,
          null,
          h(Blocker, { blocked: true }),
          h(Probe, { onValue: (v) => (latest = v) }),
        ),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 0, "must not even attempt the claim while a call is active");
  assert.equal(latest.open, false);

  cleanup();
  qc.clear();
});

test("reopen() opens without touching the receipt at all", async () => {
  resetShared();
  flagEnabled = false; // auto-open path is off, but manual reopen must still work
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    latest.reopen();
  });

  assert.equal(latest.open, true);
  assert.equal(claimCalls.length, 0, "reopen never calls claim");
  assert.equal(dismissCalls.length, 0, "reopen never calls dismiss");

  cleanup();
  qc.clear();
});

test("dismiss() closes and records the receipt's dismissal", async () => {
  resetShared();
  flagEnabled = true;
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(latest.open, true, "precondition: auto-opened");

  await act(async () => {
    latest.dismiss();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false);
  assert.equal(dismissCalls.length, 1);

  cleanup();
  qc.clear();
});

test("preview/demo identity uses the preview receipt adapter, not the live one", async () => {
  resetShared();
  flagEnabled = true;
  testPreview = true;
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].actorId, "demo-actor-1", "preview identity comes from currentDemoActorId(), not user?.id");

  cleanup();
  qc.clear();
});
