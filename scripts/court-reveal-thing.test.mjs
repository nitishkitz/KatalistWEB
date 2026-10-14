import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, createRef } from "react";
import { act, render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let isReducedMotion = false;
mock.module("@/hooks/use-motion-preference", {
  namedExports: {
    getEffectiveReducedMotion: () => isReducedMotion,
    subscribeToMotionPreference: () => () => {},
  },
});

mock.module("@/features/court/coey/use-coey-lane-move", {
  namedExports: {
    useCoeyLaneMove: () => ({ dialog: null, move: async () => false }),
  },
});

mock.module("@/features/people/directory", {
  namedExports: {
    useAvatarUrl: () => null,
    matchAvatarByName: () => null,
    fetchProfileIdentitiesByIds: async () => [],
  },
});

mock.module("@/features/court/ThingStackCard", {
  namedExports: {
    ThingStackCard: ({ thing }) =>
      h("div", { "data-testid": `stack-card-${thing.id}`, "data-title": thing.title }, thing.title),
  },
});

mock.module("@/features/court/use-stack-gesture", {
  namedExports: {
    useStackGesture: () => ({
      offset: { x: 0, y: 0 },
      dragging: false,
      suppressClickRef: { current: false },
      gestureProps: {},
    }),
  },
});

mock.module("@/features/court/KatalistIcon", {
  namedExports: {
    KatalistIcon: () => h("span", { "data-testid": "icon" }),
  },
});

const { CourtLaneStack } = await import("@/features/court/CourtLaneStack");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function makeThings(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i + 1}`,
    title: `Task #${i + 1}`,
    status: "next",
    assignee: { id: "actor-1" },
    owner: { id: "actor-1" },
    acknowledgement: "caught",
  }));
}

test("revealing distant card (e.g. card 18 of 20) directly selects card 18 without mutating array order", async () => {
  cleanup();
  isReducedMotion = false;
  const qc = newClient();
  const things = makeThings(20);
  const stackRef = createRef();

  render(
    h(
      QueryClientProvider,
      { client: qc },
      h(CourtLaneStack, {
        ref: stackRef,
        lane: "next",
        things,
        courtThings: { now: [], next: things, later: [] },
        myActorId: "actor-1",
        onOpen: () => {},
        onRefresh: () => {},
      }),
    ),
  );

  assert.equal(stackRef.current.getPosition().activeIndex, 0);
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-1");

  // Reveal card 18 ("thing-18")
  let success;
  await act(async () => {
    success = stackRef.current.revealThing("thing-18");
  });

  assert.equal(success, true, "revealThing returns true on finding target");
  assert.equal(stackRef.current.getPosition().activeIndex, 17, "Target card 18 (index 17) is selected");
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-18");

  // Verify source array order was unchanged
  assert.equal(things[0].id, "thing-1");
  assert.equal(things[17].id, "thing-18");
  assert.equal(things.length, 20);
});

test("revealThing returns false for missing ID and does NOT reconcile to an adjacent card", async () => {
  cleanup();
  const qc = newClient();
  const things = makeThings(5);
  const stackRef = createRef();

  render(
    h(
      QueryClientProvider,
      { client: qc },
      h(CourtLaneStack, {
        ref: stackRef,
        lane: "next",
        things,
        courtThings: { now: [], next: things, later: [] },
        myActorId: "actor-1",
        onOpen: () => {},
        onRefresh: () => {},
      }),
    ),
  );

  assert.equal(stackRef.current.getPosition().activeIndex, 0);
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-1");

  let success;
  await act(async () => {
    success = stackRef.current.revealThing("non-existent-thing-id");
  });

  assert.equal(success, false, "Must return false for unknown ID");
  assert.equal(
    stackRef.current.getPosition().activeIndex,
    0,
    "Selection must not change or reconcile to adjacent card",
  );
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-1");
});

test("revealThing returns true immediately and skips movement if target is already active", async () => {
  cleanup();
  const qc = newClient();
  const things = makeThings(5);
  const stackRef = createRef();

  render(
    h(
      QueryClientProvider,
      { client: qc },
      h(CourtLaneStack, {
        ref: stackRef,
        lane: "next",
        things,
        courtThings: { now: [], next: things, later: [] },
        myActorId: "actor-1",
        onOpen: () => {},
        onRefresh: () => {},
      }),
    ),
  );

  assert.equal(stackRef.current.getPosition().activeThingId, "thing-1");

  let success;
  await act(async () => {
    success = stackRef.current.revealThing("thing-1");
  });

  assert.equal(success, true);
  assert.equal(stackRef.current.getPosition().activeIndex, 0);
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-1");
});

test("revealThing in reduced motion mode selects target immediately without spatial animation", async () => {
  cleanup();
  isReducedMotion = true;
  const qc = newClient();
  const things = makeThings(10);
  const stackRef = createRef();

  render(
    h(
      QueryClientProvider,
      { client: qc },
      h(CourtLaneStack, {
        ref: stackRef,
        lane: "next",
        things,
        courtThings: { now: [], next: things, later: [] },
        myActorId: "actor-1",
        onOpen: () => {},
        onRefresh: () => {},
      }),
    ),
  );

  let success;
  await act(async () => {
    success = stackRef.current.revealThing("thing-7");
  });

  assert.equal(success, true);
  assert.equal(stackRef.current.getPosition().activeIndex, 6);
  assert.equal(stackRef.current.getPosition().activeThingId, "thing-7");
  isReducedMotion = false;
});
