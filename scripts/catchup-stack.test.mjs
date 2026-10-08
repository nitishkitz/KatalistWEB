import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T10-04/T10-05: CatchUpStack.tsx replaced its frozen `useState(() =>
 * moments)` deck with a stable, append-only key order + a live keyed map,
 * and wired its actions through run-thing-action.ts's typed outcomes
 * instead of calling RPCs directly. run-thing-action.ts and useDoorman are
 * mocked at their own module boundaries (each already has its own
 * dedicated test coverage); catchup-logic.ts and the component's own
 * reconciliation/navigation logic run for real.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let runOutcome = { status: "performed" };
let runCalls = [];
let surfaceCalls = [];
let surfaceRejects = null;

mock.module("@/features/things/run-thing-action", {
  namedExports: {
    runThingAction: async (_qc, request) => {
      runCalls.push(request);
      return runOutcome;
    },
  },
});
mock.module("@/features/doorman/use-doorman", {
  namedExports: {
    useDoorman: () => ({ dismiss: { mutateAsync: async () => {} } }),
    isDoormanEnabled: () => false,
  },
});

mock.module("@/features/things/ThingDetailContent", {
  namedExports: { ThingDetailContent: ({ initialThing }) => h("h1", { "data-testid": "inline-thing-detail" }, initialThing.title) },
});

const { CatchUpStack } = await import("@/features/catchup/CatchUpStack");

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
    listName: "Standalone",
    dueAt: null,
    commentCount: 0,
    attachmentCount: 0,
    files: [],
    description: null,
    ...overrides,
  };
}

function makeMoment(thingId, overrides = {}) {
  return {
    momentKey: `nudge:${thingId}`,
    kind: "nudge",
    thing: makeThing(thingId),
    occurredAt: new Date().toISOString(),
    actor: null,
    reason: "waiting_for_catch",
    ...overrides,
  };
}

function resetShared() {
  runOutcome = { status: "performed" };
  runCalls = [];
  surfaceCalls = [];
  surfaceRejects = null;
}

function renderStack(props) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const surfaceMoment = async (momentKey) => {
    surfaceCalls.push(momentKey);
    if (surfaceRejects) {
      const err = surfaceRejects;
      surfaceRejects = null;
      throw err;
    }
  };
  const onOpenThing = mock.fn();
  const onClose = mock.fn();
  const onRefresh = mock.fn();
  let utils;
  const view = {
    onOpenThing,
    onClose,
    onRefresh,
    surfaceMoment,
    rerender: (nextProps) =>
      act(() => {
        utils.rerender(
          h(
            QueryClientProvider,
            { client: qc },
            h(CatchUpStack, {
              myActorId: "me",
              surfaceMoment,
              onOpenThing,
              onClose,
              onRefresh,
              ...nextProps,
            }),
          ),
        );
      }),
  };
  act(() => {
    utils = render(
      h(
        QueryClientProvider,
        { client: qc },
        h(CatchUpStack, { myActorId: "me", surfaceMoment, onOpenThing, onClose, onRefresh, ...props }),
      ),
    );
  });
  return view;
}

test("Q03: a new moment streaming in mid-review is appended at the end without jumping the current selection", async () => {
  resetShared();
  const a = makeMoment("a");
  const b = makeMoment("b");
  const view = renderStack({ moments: [a] });
  assert.equal(screen.getByRole("heading", { name: "Thing a" }).textContent, "Thing a");

  await view.rerender({ moments: [a, b] });
  assert.equal(screen.getByRole("heading", { name: "Thing a" }).textContent, "Thing a", "selection stayed on the first moment");
  assert.match(screen.getByTestId("catchup-pager-position").textContent, /1 of 2/);

  cleanup();
});

test("Q01: a refetch that changes a moment's own capabilities recomputes available actions immediately", async () => {
  resetShared();
  const waiting = makeMoment("a", { thing: makeThing("a", { acknowledgement: "waiting_for_catch" }) });
  const view = renderStack({ moments: [waiting] });
  assert.ok(screen.getByText("Catch & Start"), "waiting -> Catch & Start is offered");

  const caught = makeMoment("a", { thing: makeThing("a", { acknowledgement: "caught" }) });
  await view.rerender({ moments: [caught] });
  assert.equal(screen.queryByText("Catch & Start"), null, "no longer offered once already caught");
  assert.ok(screen.getByText("Set Pace"), "the newly-current capability is offered instead");

  cleanup();
});

test("Q02: a moment that disappears WITHOUT this review acting on it is marked unavailable, clearing its actions", async () => {
  resetShared();
  const a = makeMoment("a");
  const view = renderStack({ moments: [a] });
  assert.ok(screen.getByText("Catch & Start"));

  await view.rerender({ moments: [] });
  assert.equal(screen.queryByText("Catch & Start"), null);
  assert.ok(screen.getByText(/no longer available/i));

  cleanup();
});

test("A01: a failed domain action shows an error, never advances, and never surfaces a receipt", async () => {
  resetShared();
  runOutcome = { status: "failed", error: new Error("nope") };
  const a = makeMoment("a");
  const b = makeMoment("b");
  renderStack({ moments: [a, b] });

  await act(async () => {
    fireEvent.click(screen.getByText("Catch & Start"));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(runCalls.length, 1);
  assert.equal(surfaceCalls.length, 0, "a failed action never surfaces a receipt");
  assert.ok(screen.getByRole("heading", { name: "Thing a" }), "still on the same (failed) moment -- did not advance");

  cleanup();
});

test("A02: an already-in-flight outcome does not advance or surface a receipt either", async () => {
  resetShared();
  runOutcome = { status: "already-in-flight" };
  const a = makeMoment("a");
  renderStack({ moments: [a] });

  await act(async () => {
    fireEvent.click(screen.getByText("Catch & Start"));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(surfaceCalls.length, 0);
  assert.ok(screen.getByRole("heading", { name: "Thing a" }));

  cleanup();
});

test("A03/A04: domain succeeds but the receipt fails -- shows a retry affordance, and retry calls ONLY surfaceMoment (zero additional domain calls)", async () => {
  resetShared();
  runOutcome = { status: "performed" };
  surfaceRejects = new Error("receipt failed");
  const a = makeMoment("a");
  renderStack({ moments: [a] });

  await act(async () => {
    fireEvent.click(screen.getByText("Catch & Start"));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(runCalls.length, 1, "the domain action ran exactly once");
  assert.equal(surfaceCalls.length, 1, "surfaceMoment was attempted once and failed");
  assert.ok(screen.getByText(/retry acknowledgement/i));

  await act(async () => {
    fireEvent.click(screen.getByText(/retry acknowledgement/i));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(runCalls.length, 1, "retry acknowledgement never re-runs the domain action");
  assert.equal(surfaceCalls.length, 2, "retry called surfaceMoment again");

  cleanup();
});

test("A03: a successful action with a successful receipt advances to the next moment", async () => {
  resetShared();
  const a = makeMoment("a");
  const b = makeMoment("b");
  renderStack({ moments: [a, b] });

  await act(async () => {
    fireEvent.click(screen.getByText("Catch & Start"));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(surfaceCalls.length, 1);
  assert.ok(screen.getByRole("heading", { name: "Thing b" }), "advanced to the next moment");

  cleanup();
});

test("Q04: selected Thing detail stays inside the review without opening or acknowledging it", async () => {
  resetShared();
  const view = renderStack({ moments: [makeMoment("a"), makeMoment("b")] });
  assert.equal(screen.getByTestId("inline-thing-detail").textContent, "Thing a");
  assert.equal(screen.queryByText("Open"), null);
  await act(async () => { fireEvent.click(screen.getByLabelText("Next")); });
  assert.equal(screen.getByTestId("inline-thing-detail").textContent, "Thing b");
  assert.equal(view.onOpenThing.mock.calls.length, 0);
  assert.equal(view.onClose.mock.calls.length, 0);
  assert.equal(runCalls.length, 0);
  assert.equal(surfaceCalls.length, 0);
  cleanup();
});

test("Finish is explicit on the last item: Next on the final moment closes the review", async () => {
  resetShared();
  const a = makeMoment("a");
  const view = renderStack({ moments: [a] });

  await act(async () => {
    fireEvent.click(screen.getByLabelText("Finish"));
  });

  assert.equal(view.onClose.mock.calls.length, 1);

  cleanup();
});

test("Previous is disabled on the first item, enabled after moving forward", async () => {
  resetShared();
  const a = makeMoment("a");
  const b = makeMoment("b");
  renderStack({ moments: [a, b] });

  assert.equal(screen.getByLabelText("Previous").disabled, true);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Next"));
  });
  assert.equal(screen.getByLabelText("Previous").disabled, false);
  assert.ok(screen.getByRole("heading", { name: "Thing b" }));

  cleanup();
});

test("viewed count and action-completed count are tracked separately from navigation position", async () => {
  resetShared();
  const a = makeMoment("a");
  const b = makeMoment("b");
  const c = makeMoment("c");
  renderStack({ moments: [a, b, c] });

  assert.match(screen.getByTestId("catchup-viewed-summary").textContent, /Viewed 1 of 3/);

  await act(async () => {
    fireEvent.click(screen.getByLabelText("Next"));
  });
  assert.match(screen.getByTestId("catchup-viewed-summary").textContent, /Viewed 2 of 3/);
  assert.doesNotMatch(screen.getByTestId("catchup-viewed-summary").textContent, /action.*completed/i, "no actions performed yet");

  await act(async () => {
    fireEvent.click(screen.getByText("Catch & Start"));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.match(screen.getByTestId("catchup-viewed-summary").textContent, /1 action completed/);

  cleanup();
});

test("T10-06: clicking a queue item jumps directly to that moment (not just Previous/Next)", async () => {
  resetShared();
  const a = makeMoment("a");
  const b = makeMoment("b");
  const c = makeMoment("c");
  renderStack({ moments: [a, b, c] });

  assert.ok(screen.getByRole("heading", { name: "Thing a" }), "starts on the first moment");

  await act(async () => {
    fireEvent.click(screen.getByRole("navigation", { name: /moments in this review/i }).querySelectorAll("button")[2]);
  });

  assert.ok(screen.getByRole("heading", { name: "Thing c" }), "jumped directly to the third moment");
  assert.match(screen.getByTestId("catchup-pager-position").textContent, /3 of 3/);

  cleanup();
});

test('the brief hides standalone context but retains a real list name', () => {
  resetShared();
  renderStack({ moments: [makeMoment('a')] });
  assert.equal(screen.queryByText('Standalone'), null);
  assert.equal(screen.queryByText('Standalone task'), null);
  cleanup();
  renderStack({ moments: [makeMoment('b', { thing: makeThing('b', { listName: 'Design review' }) })] });
  assert.ok(screen.getByText('Design review'));
  cleanup();
});
