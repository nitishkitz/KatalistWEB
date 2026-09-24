import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";

/**
 * T05: the Hub's main-pane landing (team.index.tsx) was a single
 * hard-coded panel that never checked whether the viewer actually had any
 * conversations/lists -- "Pick a conversation or a list on the left..."
 * was shown even to a brand-new account with nothing in the sidebar,
 * actively misleading copy for that case. It must now distinguish a
 * genuinely empty account from "plenty exist, none selected".
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@tanstack/react-router", {
  namedExports: {
    createFileRoute: () => (opts) => opts,
  },
});

let conversations = [];
let conversationsLoading = false;
let lists = [];
let listsLoading = false;
mock.module("@/features/hub/use-conversations", {
  namedExports: {
    useConversations: () => ({ conversations, isLoading: conversationsLoading }),
  },
});
mock.module("@/features/lists/use-lists", {
  namedExports: {
    useLists: () => ({ lists, isLoading: listsLoading }),
  },
});

const { Route } = await import("@/routes/team.index");
const TeamHome = Route.component;

test("a genuinely empty account (no conversations, no lists) sees copy that does not tell them to 'pick' something from an empty sidebar", async () => {
  conversations = [];
  conversationsLoading = false;
  lists = [];
  listsLoading = false;

  try {
    const { getByText, queryByText } = render(h(TeamHome));
    await act(async () => {});

    assert.ok(getByText("No conversations yet"), "an empty account gets distinct empty-state copy");
    assert.equal(
      queryByText(/Pick a conversation or a list on the left/),
      null,
      "an empty account must not be told to pick from a sidebar that has nothing in it",
    );
  } finally {
    cleanup();
  }
});

test("a populated-but-unselected account sees the original 'pick one' copy", async () => {
  conversations = [{ id: "c1" }];
  conversationsLoading = false;
  lists = [];
  listsLoading = false;

  try {
    const { getByText } = render(h(TeamHome));
    await act(async () => {});

    assert.ok(getByText(/Pick a conversation or a list on the left/), "a populated sidebar still gets the 'pick one' prompt");
  } finally {
    cleanup();
  }
});

test("while conversations/lists are still loading, neither empty-state nor populated copy is shown yet", async () => {
  conversations = [];
  conversationsLoading = true;
  lists = [];
  listsLoading = false;

  try {
    const { queryByText } = render(h(TeamHome));
    await act(async () => {});

    assert.equal(queryByText("No conversations yet"), null, "must not claim 'no conversations' while still loading");
    assert.equal(queryByText(/Pick a conversation or a list on the left/), null, "must not claim a populated sidebar while still loading");
  } finally {
    cleanup();
  }
});
