import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useState } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T10/mobile-entry: `src/routes/index.tsx` ("CourtPage") previously rendered
 * `CourtDesktop` (the ONLY thing that called `useCatchup()`/
 * `useMorningBrief()` and rendered `CatchUpBanner`/`CatchUpOverlay`) whose
 * own rendered output was CSS-hidden below the `lg` breakpoint, alongside a
 * separate `lg:hidden` mobile lane-list block with no Catch Up wiring of its
 * own -- so Morning Brief had literally no reachable entry point below
 * 1024px. This is a REAL DOM-level test of the fix (a regex/source-string
 * check on this file would have missed the two real bugs the prior T10 pass
 * found by running actual tests/Playwright instead of just reading code),
 * not a re-implementation of the production wiring: it renders the actual
 * `CourtPage` component from `src/routes/index.tsx`, stubbing only the
 * genuinely unrelated heavy subtrees (desktop-only `CourtDesktop` internals,
 * the presentational lane-list rows, and the generic Thing-detail workspace
 * UI) at their own module boundaries -- the same convention
 * `catchup-stack.test.mjs` already uses for `run-thing-action`/`useDoorman`.
 *
 * The critical fact this file exists to PROVE (not assume): `useCatchup()`
 * and `useMorningBrief()` are each called exactly ONCE per render of
 * `CourtPage`, and the exact same object each call produces is threaded to
 * both the (stubbed) desktop branch and the real mobile branch -- so there
 * is structurally exactly one automatic presentation controller regardless
 * of which breakpoint's CSS makes it visible, not two independent hook
 * instances that could each try to auto-claim the same daily scope.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const callCounts = { catchup: 0, morningBrief: 0, courtDesktop: 0 };
const morningBriefState = { open: false, dismissCalls: 0, reopenCalls: 0 };
let forceRerender = () => {};
let lastCourtDesktopProps = null;

function makeThing(id, overrides = {}) {
  return {
    id,
    title: `Thing ${id}`,
    workStatus: "not_started",
    acknowledgement: "waiting_for_catch",
    personalPace: null,
    ownerImportance: "next",
    assignee: { id: "me", name: "Me", initials: "M", avatarUrl: null },
    owner: { id: "owner-1", name: "Owner", initials: "O", avatarUrl: null },
    creator: { id: "owner-1", name: "Owner", initials: "O", avatarUrl: null },
    listName: "Standalone",
    dueAt: null,
    updatedAt: new Date().toISOString(),
    commentCount: 0,
    attachmentCount: 0,
    files: [],
    description: null,
    ...overrides,
  };
}

function makeMoment(id, overrides = {}) {
  return {
    momentKey: `nudge:${id}`,
    kind: "nudge",
    thing: makeThing(id),
    occurredAt: new Date().toISOString(),
    actor: null,
    reason: "waiting_for_catch",
    ...overrides,
  };
}

let catchupState;
function resetCatchupState() {
  catchupState = {
    moments: [makeMoment("m1")],
    error: null,
    hasFetchedOnce: true,
    isLoading: false,
    isEmpty: false,
    count: 1,
    surfaceMoment: async () => {},
    refresh: () => {},
  };
}
resetCatchupState();

// ---- module boundary stubs: genuinely unrelated heavy subtrees only ----
mock.module("@/components/layout/AppShell", {
  namedExports: {
    AppShell: (props) => h("div", { "data-testid": "app-shell" }, props.children),
  },
});
mock.module("@/components/katalist/ScreenSkeletons", {
  namedExports: { CourtSkeleton: () => h("div", { "data-testid": "court-skeleton" }) },
});
mock.module("@/features/court/use-court", {
  namedExports: {
    useCourt: () => ({
      now: [],
      next: [],
      later: [],
      theirs: [],
      theirGroups: { waiting_for_catch: [], moving: [], needs_attention: [] },
      isLoading: false,
      all: [],
      error: null,
      refetch: () => {},
      myActorId: "me",
      completedCount: 0,
    }),
  },
});
mock.module("@/features/court/MagicBox", {
  namedExports: { MagicBox: () => h("div", { "data-testid": "magic-box" }) },
});
mock.module("@/components/katalist/ThingRow", {
  namedExports: { ThingRow: () => null, ThingTableHeader: () => null },
});
mock.module("@/features/court/ThingCard", {
  namedExports: { ThingCard: () => null },
});
mock.module("@/features/things/InlineThingDetailWorkspace", {
  namedExports: {
    InlineThingDetailWorkspace: (props) =>
      h(
        "div",
        { "data-testid": "inline-detail" },
        props.thing
          ? h(
              "div",
              { "data-testid": "inline-detail-open" },
              h("span", null, props.thing.title),
              h("button", { onClick: props.onClose }, "Close detail"),
            )
          : null,
        props.children,
      ),
  },
});
mock.module("@/features/court/CourtDesktop", {
  namedExports: {
    CourtDesktop: (props) => {
      callCounts.courtDesktop += 1;
      lastCourtDesktopProps = props;
      // Real CourtDesktop wraps its own output in `hidden lg:block` -- the
      // stub preserves that class so this test can't accidentally pass by
      // coincidence if a future change re-adds a real visible desktop node.
      return h("div", { "data-testid": "court-desktop-stub", className: "hidden lg:block" });
    },
  },
});
mock.module("@/features/catchup/use-catchup", {
  namedExports: {
    useCatchup: () => {
      callCounts.catchup += 1;
      return catchupState;
    },
  },
});
mock.module("@/features/catchup/use-morning-brief", {
  namedExports: {
    useMorningBrief: () => {
      callCounts.morningBrief += 1;
      return {
        open: morningBriefState.open,
        dismiss: () => {
          morningBriefState.dismissCalls += 1;
          morningBriefState.open = false;
          forceRerender();
        },
        reopen: () => {
          morningBriefState.reopenCalls += 1;
          morningBriefState.open = true;
          forceRerender();
        },
        alreadyPresentedToday: false,
      };
    },
  },
});
// CatchUpOverlay renders CatchUpStack for real (it is the review UI itself,
// not incidental plumbing) -- CatchUpStack's own two heavy/unrelated
// dependencies are mocked here exactly as catchup-stack.test.mjs already
// does, so the moment/Thing action machinery this file doesn't test isn't
// pulled in for real.
mock.module("@/features/things/run-thing-action", {
  namedExports: {
    runThingAction: async () => ({ status: "performed" }),
  },
});
mock.module("@/features/doorman/use-doorman", {
  namedExports: {
    useDoorman: () => ({ dismiss: { mutateAsync: async () => {} } }),
    isDoormanEnabled: () => false,
  },
});

const { Route } = await import("@/routes/index.tsx");
const CourtPage = Route.options.component;

function Harness() {
  const [, setTick] = useState(0);
  forceRerender = () => setTick((t) => t + 1);
  const qc = useQueryClientOnce();
  return h(QueryClientProvider, { client: qc }, h(CourtPage));
}

let sharedQueryClient = null;
function useQueryClientOnce() {
  if (!sharedQueryClient) sharedQueryClient = new QueryClient();
  return sharedQueryClient;
}

function resetAll() {
  callCounts.catchup = 0;
  callCounts.morningBrief = 0;
  callCounts.courtDesktop = 0;
  morningBriefState.open = false;
  morningBriefState.dismissCalls = 0;
  morningBriefState.reopenCalls = 0;
  lastCourtDesktopProps = null;
  sharedQueryClient = null;
  resetCatchupState();
}

test.beforeEach(() => {
  resetAll();
});
test.afterEach(() => {
  cleanup();
});

test("exactly one useMorningBrief()/useCatchup() instance is shared between the desktop stub and the real mobile branch", () => {
  render(h(Harness));
  assert.equal(
    callCounts.morningBrief,
    1,
    "useMorningBrief must be called exactly once per CourtPage render regardless of breakpoint -- two independent calls would each auto-claim the same daily scope",
  );
  assert.equal(callCounts.catchup, 1, "useCatchup must be called exactly once per CourtPage render regardless of breakpoint");
  assert.equal(callCounts.courtDesktop, 1, "CourtDesktop itself is still mounted exactly once (its own output is CSS-hidden, not conditionally rendered)");
  assert.ok(lastCourtDesktopProps, "CourtDesktop did not receive props");
  assert.equal(
    lastCourtDesktopProps.catchup,
    catchupState,
    "CourtDesktop must receive the SAME catchup object instance the mobile branch renders from, not an independent call's result",
  );
});

test("mobile Court has a reachable Morning Brief banner with a Review action, even though CourtDesktop's own output is CSS-hidden below lg", () => {
  render(h(Harness));
  const reviewButtons = screen.getAllByRole("button", { name: /^Review/ });
  assert.ok(reviewButtons.length >= 1, "no Review button reachable in the mobile-visible tree");
});

test("clicking Review on the mobile banner opens the Morning Brief overlay dialog", () => {
  render(h(Harness));
  fireEvent.click(screen.getAllByRole("button", { name: /^Review/ })[0]);
  assert.equal(morningBriefState.reopenCalls, 1);
  assert.ok(screen.getByRole("dialog", { name: /Morning Brief/i }), "the overlay dialog did not open");
});

test("Escape dismisses the mobile Morning Brief overlay and records a real dismissal (not just a visual close)", () => {
  render(h(Harness));
  fireEvent.click(screen.getAllByRole("button", { name: /^Review/ })[0]);
  assert.ok(screen.getByRole("dialog", { name: /Morning Brief/i }));

  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

  assert.equal(morningBriefState.dismissCalls, 1, "Escape must call the real dismiss(), not merely hide the dialog");
  assert.equal(screen.queryByRole("dialog", { name: /Morning Brief/i }), null);
});

test("opening a Thing from the mobile overlay dismisses the brief and opens the Thing inline, with no separate mount", () => {
  render(h(Harness));
  fireEvent.click(screen.getAllByRole("button", { name: /^Review/ })[0]);
  assert.ok(screen.getByRole("dialog", { name: /Morning Brief/i }));

  fireEvent.click(screen.getByText("Open"));

  // At least one real dismiss() call happens (this mobile path's own
  // `openCatchUpThingMobile`, matching CourtDesktop's existing
  // `openCatchUpThing`) -- `CatchUpStack` itself ALSO invokes its `onClose`
  // prop (`morningBrief.dismiss`) when "Open" is clicked (see
  // catchup-stack.test.mjs's Q04 case), which is pre-existing desktop
  // behavior this pass did not introduce and is out of scope to change
  // here; dismiss() is safe to call more than once (see its own
  // best-effort error handling), so asserting "at least one" rather than
  // an exact count matches the real, already-shipped contract instead of
  // inventing a stricter one.
  assert.ok(morningBriefState.dismissCalls >= 1, "opening a Thing from the overlay must be a real dismissal, matching CourtDesktop's own openCatchUpThing");
  assert.equal(screen.queryByRole("dialog", { name: /Morning Brief/i }), null, "the overlay must close when a Thing is opened from it");
  assert.ok(screen.getByTestId("inline-detail-open"), "the Thing was not opened in the mobile inline detail workspace");
  assert.ok(screen.getByText("Thing m1"), "the opened Thing's own title should be shown, not a stale/wrong one");
});

test("manual Review stays reachable when there are zero moments (not gated on count > 0)", () => {
  catchupState = { ...catchupState, moments: [], count: 0, isEmpty: true };
  render(h(Harness));
  assert.ok(screen.getAllByRole("button", { name: /^Review/ })[0], "Review disappeared for a genuinely empty result");
});

test("manual Review stays reachable when the Catch Up fetch itself failed", () => {
  catchupState = {
    ...catchupState,
    moments: [],
    count: 0,
    isEmpty: false,
    error: new Error("network unavailable"),
    hasFetchedOnce: true,
  };
  render(h(Harness));
  assert.ok(screen.getAllByRole("button", { name: /^Review/ })[0], "Review disappeared on a settled error, hiding the only recovery path");
});
