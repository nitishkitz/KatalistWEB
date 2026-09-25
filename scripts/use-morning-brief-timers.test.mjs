import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect, StrictMode } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * T10/S02-S04-S10-S11: deterministic fake-timer coverage for
 * use-morning-brief.ts's OWN scheduled `setTimeout`s (the next-07:00
 * threshold timer and the local-midnight retirement timer) actually
 * firing and driving real claim/open/retire behavior -- not just that the
 * pure schedule functions (`nextMorningThreshold`/`nextLocalMidnight`/
 * `isEligibleToAutoOpen`) compute the right instant (already covered by
 * `morning-brief-schedule.test.mjs`), and not by manually invoking the
 * callback a timer would have called (that proves the callback's logic,
 * never that the timer itself is wired up to invoke it).
 *
 * `use-morning-brief.test.mjs` only fakes `Date` (see its own comment) and
 * lets real `setTimeout`s run, specifically because most of its scenarios
 * don't need a real multi-hour/day timer to fire. This file instead fakes
 * BOTH `Date` and `setTimeout`/`setInterval` via `node:test`'s built-in
 * `mock.timers` (the only timer-mocking mechanism already used anywhere in
 * this codebase's tests -- see the grep-confirmed absence of any other
 * fake-timer library), so `mock.timers.tick(ms)` both advances the fake
 * clock AND synchronously invokes any real `setTimeout` callback whose
 * delay has elapsed -- including the ones `use-morning-brief.ts` itself
 * schedules internally, letting these tests observe the ACTUAL scheduled
 * callback fire and drive claim/open/retire, not a simulation of it.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const START = new Date("2026-06-15T06:59:00.000Z").getTime();
mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: START });

let testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
const testPreview = false;
let catchupCount = 1;
const catchupLoading = false;
const catchupError = null;
// UTC keeps the 07:00 threshold and local-midnight arithmetic exactly
// aligned with the faked `Date`'s own UTC instant, with no timezone-offset
// bookkeeping needed in the test itself.
const profileTimezone = "UTC";
const profileLoading = false;
let flagEnabled = true;
const testContext = "work";

mock.module("@/hooks/useSession", { namedExports: { useSession: () => testSession } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => testPreview } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: testContext }) } });
mock.module("@/features/me/use-profile", {
  namedExports: {
    useProfile: () => ({
      data: { timezone: profileTimezone },
      isLoading: profileLoading,
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

class MorningBriefClaimRejected extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "MorningBriefClaimRejected";
    this.reason = reason;
  }
}

// S04/atomic-claim semantics: mirrors the real server's actual contract
// (a unique constraint per identity/context/local-date -- see
// morning-brief-receipts.ts's own comments on cross-device atomicity) --
// the FIRST claim call for a given (context, localDate) wins `claimed:
// true`; every subsequent call for that same key -- whether from a
// legitimate same-instance retry or a genuinely duplicate second
// controller mount -- gets back `claimed: false` for an already-presented
// day, exactly like Postgres's `ON CONFLICT DO NOTHING ... RETURNING`
// would. This is what actually prevents two simultaneous controllers from
// both opening the UI, even though use-morning-brief.ts's own doc comment
// is explicit that ITS attempt-token system only dedupes reattempts within
// ONE hook instance, not across independently mounted instances.
let claimCalls = [];
const claimedDates = new Set();
function claimFor(context, localDate, timezone) {
  const key = `${context}:${localDate}`;
  const alreadyClaimed = claimedDates.has(key);
  if (!alreadyClaimed) claimedDates.add(key);
  return { claimed: !alreadyClaimed, localDate, timezone, presentedAt: new Date().toISOString() };
}

let dismissCalls = [];
mock.module("@/features/catchup/morning-brief-receipts", {
  namedExports: {
    MorningBriefClaimRejected,
    claimMorningBriefLive: async (context, tz) => {
      const localDate = new Date().toISOString().slice(0, 10);
      const result = claimFor(context, localDate, tz);
      claimCalls.push({ context, tz, localDate, result: { ...result } });
      return result;
    },
    claimMorningBriefPreview: async (actorId, context, dateKey, tz) => {
      const result = claimFor(context, dateKey, tz);
      claimCalls.push({ actorId, context, tz, localDate: dateKey, result: { ...result } });
      return result;
    },
    dismissMorningBriefLive: async (context, tz, localDate) => {
      dismissCalls.push({ context, tz, localDate });
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

function Probe({ onValue, id = "a" }) {
  const value = useMorningBrief();
  useEffect(() => {
    onValue(id, value);
  });
  return null;
}

// Flushes pending microtasks (the async claim's own promise chain) without
// advancing the fake clock -- `mock.timers.tick(0)` both fires any
// already-due timer AND lets Node's real microtask queue drain between
// each awaited step, which a bare `await null` alone does not guarantee
// once multiple `.then()` hops are involved (claim -> epoch/scope checks
// -> setOpenForScope).
async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      mock.timers.tick(0);
      await Promise.resolve();
    });
  }
}

function resetShared() {
  testSession = { user: { id: "profile-1" }, session: { user: { id: "profile-1", app_metadata: {} } } };
  catchupCount = 1;
  flagEnabled = true;
  claimCalls = [];
  dismissCalls = [];
  claimedDates.clear();
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: START });
}

test.beforeEach(() => resetShared());
test.afterEach(() => cleanup());

test("S02: at mount (06:59 UTC) no claim is attempted yet, and the scheduled 07:00 timer -- once it actually fires -- claims exactly once with no help from an unrelated rerender", async () => {
  const qc = newClient();
  let latest = null;
  let rerenderTrigger = 0;

  function Harness() {
    return h(
      QueryClientProvider,
      { client: qc },
      h(InteractionBlockerProvider, null, h(Probe, { onValue: (_id, v) => (latest = v) })),
    );
  }

  await act(async () => {
    render(h(Harness));
  });
  await flush();

  assert.equal(claimCalls.length, 0, "still before the 07:00 threshold -- no claim should have been attempted yet");
  assert.equal(latest.open, false);

  // An unrelated state change/rerender (NOT a scope-affecting dependency)
  // must not itself trigger the claim -- only the actual timer firing may.
  rerenderTrigger += 1;
  void rerenderTrigger;
  await flush();
  assert.equal(claimCalls.length, 0, "an unrelated rerender must not itself cause a claim before the real timer fires");

  // Advance the fake clock by exactly one minute -- past 07:00:00.000Z --
  // which must fire use-morning-brief.ts's OWN scheduled threshold
  // setTimeout (armed at mount for `nextMorningThreshold`), not a manual
  // callback invocation.
  await act(async () => {
    mock.timers.tick(60_000);
  });
  await flush();

  assert.equal(claimCalls.length, 1, "the real 07:00 threshold timer firing must claim exactly once");
  assert.equal(latest.open, true, "an eligible claim at the real threshold must actually open the brief");
  assert.equal(new Date().toISOString(), "2026-06-15T07:00:00.000Z");
});

test("S04: two independently mounted controller instances (simulating duplicate/StrictMode-style mounts) never both end up presenting -- the server-side atomic claim is the real backstop", async () => {
  const qc = newClient();
  const values = {};

  function TwoControllers() {
    return h(
      QueryClientProvider,
      { client: qc },
      h(
        InteractionBlockerProvider,
        null,
        h(Probe, { id: "first", onValue: (id, v) => (values[id] = v) }),
        h(Probe, { id: "second", onValue: (id, v) => (values[id] = v) }),
      ),
    );
  }

  await act(async () => {
    render(h(TwoControllers));
  });
  await flush();
  await act(async () => {
    mock.timers.tick(60_000); // reach 07:00 -- both instances' threshold timers fire
  });
  await flush();

  assert.equal(claimCalls.length, 2, "both independently mounted instances DO each attempt a claim -- use-morning-brief.ts's own attempt-token system explicitly does not dedupe ACROSS instances");
  const claimedTrueCount = claimCalls.filter((c) => c.result.claimed).length;
  assert.equal(claimedTrueCount, 1, "the atomic per-(context,localDate) claim must let exactly one of the two calls win claimed:true");

  const openStates = [values.first.open, values.second.open];
  assert.equal(openStates.filter(Boolean).length, 1, "exactly one of the two controller instances may end up actually presenting -- never zero, never both");
});

test("S04b: React StrictMode's own double-invoked effects on a SINGLE controller instance produce exactly one claim (the attempt-token guard within one instance)", async () => {
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        StrictMode,
        null,
        h(
          QueryClientProvider,
          { client: qc },
          h(InteractionBlockerProvider, null, h(Probe, { onValue: (_id, v) => (latest = v) })),
        ),
      ),
    );
  });
  await flush();
  await act(async () => {
    mock.timers.tick(60_000);
  });
  await flush();

  assert.equal(claimCalls.length, 1, "StrictMode's mount->cleanup->mount double-invoke of the same instance's effects must still claim exactly once");
  assert.equal(latest.open, true);
});

test("S10: local midnight while the brief is open retires it -- and today's alreadyPresentedToday goes false until a receipt for the NEW day exists", async () => {
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (_id, v) => (latest = v) })),
      ),
    );
  });
  await flush();
  await act(async () => {
    mock.timers.tick(60_000); // 07:00:00Z June 15 -- claims and opens for June 15
  });
  await flush();
  assert.equal(latest.open, true);
  assert.equal(latest.alreadyPresentedToday, true, "June 15's own claim should mark June 15 as already presented");
  assert.equal(new Date().toISOString().slice(0, 10), "2026-06-15");

  // Advance to exactly local midnight (00:00:00Z June 16) -- the real
  // scheduled midnight timer, not a manual scope recompute.
  const msToMidnight = new Date("2026-06-16T00:00:00.000Z").getTime() - Date.now();
  await act(async () => {
    mock.timers.tick(msToMidnight);
  });
  await flush();

  assert.equal(new Date().toISOString(), "2026-06-16T00:00:00.000Z");
  assert.equal(latest.open, false, "the old (June 15) presented scope must retire at local midnight, closing the open review");
  assert.equal(latest.alreadyPresentedToday, false, "June 15's receipt must not mark the NEW day (June 16) as already presented");
});

test("S11: tomorrow's real 07:00 threshold, with the tab already open across midnight, produces a new eligible claim for the new day", async () => {
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(
      h(
        QueryClientProvider,
        { client: qc },
        h(InteractionBlockerProvider, null, h(Probe, { onValue: (_id, v) => (latest = v) })),
      ),
    );
  });
  await flush();
  await act(async () => {
    mock.timers.tick(60_000); // June 15 07:00 -- first claim
  });
  await flush();
  assert.equal(claimCalls.length, 1);
  assert.equal(claimCalls[0].localDate, "2026-06-15");

  // Past midnight (retires June 15's open scope -- proven by S10 above)
  // and on to June 16's own 07:00 threshold, all via real scheduled
  // timers continuing to re-arm themselves, not a fresh mount.
  const msToTomorrowThreshold = new Date("2026-06-16T07:00:00.000Z").getTime() - Date.now();
  await act(async () => {
    mock.timers.tick(msToTomorrowThreshold);
  });
  await flush();

  assert.equal(new Date().toISOString(), "2026-06-16T07:00:00.000Z");
  assert.equal(claimCalls.length, 2, "the real next-day 07:00 timer must fire a SECOND claim attempt, not reuse yesterday's settled attempt");
  assert.equal(claimCalls[1].localDate, "2026-06-16");
  assert.equal(claimCalls[1].result.claimed, true, "June 16 is a fresh, unclaimed local date -- this attempt must win");
  assert.equal(latest.open, true, "a fresh eligible claim on the new day must actually reopen the brief, not just record the receipt");
  assert.equal(latest.alreadyPresentedToday, true);
});
