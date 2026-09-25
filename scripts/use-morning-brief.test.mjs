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

// use-morning-brief.ts reads the real wall clock (`new Date()`) to decide
// whether it's past the morning threshold in the mocked profile timezone
// (America/New_York). Pinning Date to a fixed instant well past 7am ET
// makes every test deterministic regardless of what time it actually is
// when this suite runs (it was previously wall-clock-dependent and failed
// whenever run before ~7am ET). Only Date is faked -- setTimeout below
// still uses real timers.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-06-15T15:00:00Z").getTime() });

let testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
let testPreview = false;
let catchupCount = 1;
let catchupLoading = false;
let catchupError = null;
let profileTimezone = "America/New_York";
let profileLoading = false;
let flagEnabled = false;
let testContext = "work";

mock.module("@/hooks/useSession", { namedExports: { useSession: () => testSession } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => testPreview } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: testContext }) } });
mock.module("@/features/me/use-profile", {
  namedExports: {
    useProfile: () => ({
      data: { timezone: profileTimezone },
      isLoading: profileLoading,
      // T10-03: use-morning-brief.ts now classifies profile readiness from
      // `isPending`/`isError` explicitly (see ProfileReadiness), not just
      // `isLoading` -- the mock mirrors react-query v5's real contract so
      // the hook under test exercises its actual classification logic.
      isPending: profileLoading,
      isError: false,
    }),
  },
});
mock.module("@/features/demo/identities", { namedExports: { currentDemoActorId: () => "demo-actor-1" } });
mock.module("@/features/catchup/use-catchup", {
  namedExports: {
    useCatchup: () => ({
      moments: [],
      count: catchupCount,
      isLoading: catchupLoading,
      error: catchupError,
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
// F-03: a controllable gate so a test can hold the claim's own promise
// open, change something (context, a blocker, tab visibility, moments)
// while it's still pending, THEN let it resolve -- proving the
// continuation rechecks fresh state instead of trusting what was true
// when it was first called.
let claimGate = null;
let claimRejection = null;
// T10-03: use-morning-brief.ts now recognizes a premature-claim rejection
// via `instanceof MorningBriefClaimRejected` with `reason === "before-threshold"`
// (the T10-02 adapter's own normalized error type), not by pattern-matching
// a raw Error's message -- this mock class mirrors that real contract.
class MorningBriefClaimRejected extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "MorningBriefClaimRejected";
    this.reason = reason;
  }
}
mock.module("@/features/catchup/morning-brief-receipts", {
  namedExports: {
    MorningBriefClaimRejected,
    claimMorningBriefLive: async (context, tz) => {
      claimCalls.push({ context, tz });
      if (claimGate) await claimGate;
      if (claimRejection) {
        const err = claimRejection;
        claimRejection = null; // only the next call rejects, matching a one-off premature attempt
        throw err;
      }
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
  catchupError = null;
  profileTimezone = "America/New_York";
  profileLoading = false;
  flagEnabled = false;
  testContext = "work";
  claimCalls = [];
  dismissCalls = [];
  claimResult = { claimed: true, localDate: "2026-06-15", timezone: "America/New_York", presentedAt: "x" };
  claimGate = null;
  claimRejection = null;
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

test("F-03: a context switch while the claim is still in flight must not open the brief for the wrong context", async () => {
  resetShared();
  flagEnabled = true;
  let gateResolve;
  claimGate = new Promise((r) => (gateResolve = r));
  const qc = newClient();
  let latest = null;
  let rerender;

  await act(async () => {
    const result = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
    rerender = result.rerender;
  });
  // The claim is now pending (blocked on claimGate) for context "work".
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].context, "work");

  // Switch context to "home" WHILE that claim is still in flight. Also
  // drop catchup's own moment count to 0 so the NEW context's own
  // attemptClaim (a real, separate, legitimate attempt) never itself
  // calls claim -- isolating this test to exactly the race this fix
  // targets: does the STALE "work" claim's own continuation, once it
  // finally resolves, incorrectly open the brief for the context that's
  // no longer displayed.
  testContext = "home";
  catchupCount = 0;
  await act(async () => {
    rerender(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  assert.equal(claimCalls.length, 1, "the context switch's own attempt must not itself call claim (no actionable moments)");

  await act(async () => {
    gateResolve();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false, "must not auto-open using a claim that was for the context no longer displayed");
  // T10-03 correction: this previously asserted `true` on the reasoning
  // that "the claim itself still succeeded and is recorded" -- true of the
  // claim's OWN (now-retired "work") scope, but `alreadyPresentedToday` is
  // scoped to the CURRENT viewer's scope (now "home"), which has no
  // receipt of its own. A "work" receipt must not report "home" as
  // already presented, or a legitimate "home" auto-open/Review affordance
  // would wrongly disappear after an in-flight context switch.
  assert.equal(
    latest.alreadyPresentedToday,
    false,
    "the recorded receipt is for the retired 'work' scope -- it must not mark the current 'home' scope as already presented",
  );

  cleanup();
  qc.clear();
});

test("F-03: a blocking interaction appearing while the claim is in flight must suppress the open, not just delay it", async () => {
  resetShared();
  flagEnabled = true;
  let gateResolve;
  claimGate = new Promise((r) => (gateResolve = r));
  const qc = newClient();
  let latest = null;
  let rerender;

  await act(async () => {
    const result = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
    rerender = result.rerender;
  });
  assert.equal(claimCalls.length, 1);

  // A call/dialog/composer starts blocking WHILE the claim is still in flight.
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
    gateResolve();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false, "a blocker that appeared mid-claim must suppress the auto-open");
  assert.equal(latest.alreadyPresentedToday, true, "the claim itself still succeeded and is recorded");

  cleanup();
  qc.clear();
});

test("F-05: a moments fetch error never attempts a claim -- an uncertain result is not confirmed empty", async () => {
  resetShared();
  flagEnabled = true;
  catchupCount = 0;
  catchupError = new Error("network down");
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

  assert.equal(claimCalls.length, 0, "an uncertain (errored) moments result must never be treated as confirmed-empty for auto-open");
  assert.equal(latest.open, false);
  assert.equal(latest.alreadyPresentedToday, false, "no claim was even attempted, so nothing was presented");

  cleanup();
  qc.clear();
});

test("F-05: a moments fetch error appearing while a claim is already in flight suppresses the open, without discarding the claim", async () => {
  resetShared();
  flagEnabled = true;
  let gateResolve;
  claimGate = new Promise((r) => (gateResolve = r));
  const qc = newClient();
  let latest = null;
  let rerender;

  await act(async () => {
    const result = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
    rerender = result.rerender;
  });
  assert.equal(claimCalls.length, 1);

  // A background refresh of the moments query fails WHILE the claim is
  // still in flight (react-query would keep the last-good data visible,
  // but this hook must still treat the situation as uncertain, not open).
  catchupError = new Error("refetch failed");
  await act(async () => {
    rerender(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
  });
  await act(async () => {
    gateResolve();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.open, false, "a moments error appearing mid-claim must suppress the open");
  assert.equal(latest.alreadyPresentedToday, true, "the claim itself still succeeded and is recorded");

  cleanup();
  qc.clear();
});

test("R-04: while the profile timezone is still loading, never attempts a claim -- even though the browser-zone guess looks eligible", async () => {
  resetShared();
  flagEnabled = true;
  profileLoading = true;
  const qc = newClient();
  let latest = null;
  let rerender;

  await act(async () => {
    const result = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
    rerender = result.rerender;
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 0, "must not attempt a claim before the real profile timezone is known");
  assert.equal(latest.open, false);

  // The profile finishes loading -- eligibility must be re-evaluated and
  // the (now legitimate) claim attempted, without a reload/remount.
  profileLoading = false;
  await act(async () => {
    rerender(
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

  assert.equal(claimCalls.length, 1, "a claim is attempted once the profile has settled");
  assert.equal(latest.open, true);

  cleanup();
  qc.clear();
});

test("R-04: a claim rejected as premature by the server does not consume today's attempt -- a later attempt still succeeds", async () => {
  resetShared();
  flagEnabled = true;
  claimRejection = new MorningBriefClaimRejected("before-threshold", "before morning threshold");
  const qc = newClient();
  let latest = null;
  let rerender;

  await act(async () => {
    const result = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (v) => (latest = v) })),
      ),
    );
    rerender = result.rerender;
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(claimCalls.length, 1, "the premature attempt was made and rejected");
  assert.equal(latest.open, false);
  assert.equal(latest.alreadyPresentedToday, false, "a rejected premature claim was never actually presented");

  // Force a second, later attempt (e.g. the scheduled next-threshold timer,
  // or any other eligibility-affecting re-render) -- bumping catchup's own
  // count changes attemptClaim's own dependencies, standing in for that
  // later trigger. If the day's attempt had been wrongly consumed by the
  // rejected first try, this would never call claim again.
  catchupCount = 2;
  await act(async () => {
    rerender(
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

  assert.equal(claimCalls.length, 2, "the legitimate later attempt must still be allowed to claim");
  assert.equal(latest.open, true);
  assert.equal(latest.alreadyPresentedToday, true);

  cleanup();
  qc.clear();
});

test("T10-03 (corrects a prior wrong expectation): a claim delayed across a date change must not open a stale day's brief, AND must not mark the new day already-presented", async () => {
  // Independent re-review finding: the post-await recheck re-verified the
  // CURRENT clock/zone is past 07:00, but never compared that against the
  // LOCAL DATE the receipt was actually claimed for (result.localDate). A
  // sufficiently delayed claim can resolve on a day AFTER the one it
  // claimed, with the new day's own 07:00 already passed too -- opening
  // would show yesterday's already-claimed brief under today's date.
  //
  // T10-03 correction: this test previously also asserted
  // `alreadyPresentedToday === true` after the date rolled over, reasoning
  // only that "the claim itself still succeeded and is recorded". That is
  // true of the OLD scope (yesterday's), but wrong for what this flag
  // means to the CURRENT viewer: `alreadyPresentedToday` is scoped to
  // TODAY's identity/context/local-date, and today has no receipt of its
  // own yet. The old receipt is retained (for its own, now-retired scope)
  // but must not mark today -- a NEWER scope -- as already presented, or a
  // legitimate "Review" affordance for today would wrongly disappear.
  resetShared();
  flagEnabled = true;
  let gateResolve;
  claimGate = new Promise((r) => (gateResolve = r));
  // Claimed for "today" (2026-06-15, the fixed fake clock's own date in
  // America/New_York) -- matches what the client itself would have sent.
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
  assert.equal(claimCalls.length, 1, "the claim for today's date is dispatched and pending");

  // Advance the (Date-only) fake clock by exactly 24h: still well past
  // 07:00 in America/New_York the next day, but a DIFFERENT calendar date
  // than the one the pending claim above was made for.
  mock.timers.tick(24 * 60 * 60 * 1000);

  // T10-03: `currentScope`'s own local date is memoized on identity/
  // context/timezone -- by design, an unrelated render must not thrash it.
  // Only Date is mocked in this suite (not setTimeout), so the real
  // scheduled midnight-rollover timer never actually fires during a test;
  // a real return-to-foreground (visibilitychange/focus) is what forces
  // the recompute here, matching the plan's own "on focus/visibility
  // return, recompute from the current clock" requirement.
  await act(async () => {
    window.dispatchEvent(new window.Event("focus"));
  });

  await act(async () => {
    gateResolve();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(
    latest.open,
    false,
    "a claim resolving on a date after the one it actually claimed must not auto-open -- it would show a stale day's brief",
  );
  assert.equal(
    latest.alreadyPresentedToday,
    false,
    "the old receipt is for YESTERDAY's (retired) scope -- it must not mark TODAY's newer scope as already presented",
  );

  cleanup();
  qc.clear();
});
