import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TossReceipt } from "../src/features/court/TossReceipt.tsx";

test("TossReceipt renders null when items is empty", () => {
  cleanup();
  const { container } = render(
    h(TossReceipt, {
      items: [],
      collapsed: false,
      expandedDetails: false,
      onExpandDetails: () => {},
      onShow: () => {},
      onOpen: () => {},
      onDismiss: () => {},
    }),
  );
  assert.equal(container.innerHTML, "");
});

test("TossReceipt renders full expanded receipt for a single item", () => {
  cleanup();
  let shownId = null;
  let openedId = null;
  let dismissedId = "not-called";

  const items = [
    {
      thingId: "thing-1",
      title: "Review Q3 Roadmap",
      destination: { kind: "visible", lane: "now", thing: { id: "thing-1", title: "Review Q3 Roadmap" } },
      status: "saved",
      createdAt: Date.now(),
    },
  ];

  const { getByText, getByLabelText } = render(
    h(TossReceipt, {
      items,
      collapsed: false,
      expandedDetails: false,
      onExpandDetails: () => {},
      onShow: (id) => {
        shownId = id;
      },
      onOpen: (id) => {
        openedId = id;
      },
      onDismiss: (id) => {
        dismissedId = id ?? null;
      },
    }),
  );

  assert.ok(getByText("Review Q3 Roadmap"));
  assert.ok(getByText("Added to Now"));

  fireEvent.click(getByText("Show in Court"));
  assert.equal(shownId, "thing-1", "Clicking Show in Court dispatches onShow with thingId");

  fireEvent.click(getByText("Open"));
  assert.equal(openedId, "thing-1", "Clicking Open dispatches onOpen with thingId");

  fireEvent.click(getByLabelText("Dismiss receipt"));
  assert.equal(dismissedId, null, "Clicking dismiss dispatches onDismiss without ID");
});

test("TossReceipt renders compact receipt when collapsed=true", () => {
  cleanup();
  let shownId = null;

  const items = [
    {
      thingId: "thing-2",
      title: "Write documentation",
      destination: { kind: "visible", lane: "next", thing: { id: "thing-2", title: "Write documentation" } },
      status: "saved",
      createdAt: Date.now(),
    },
  ];

  const { getByText } = render(
    h(TossReceipt, {
      items,
      collapsed: true,
      expandedDetails: false,
      onExpandDetails: () => {},
      onShow: (id) => {
        shownId = id;
      },
      onOpen: () => {},
      onDismiss: () => {},
    }),
  );

  assert.ok(getByText("Added to Next"));
  assert.ok(getByText("Write documentation"));

  fireEvent.click(getByText("Show"));
  assert.equal(shownId, "thing-2");
});

test("TossReceipt multi-item grouping and expand toggle", () => {
  cleanup();
  let expandedState = null;
  let shownId = null;
  let dismissedThingId = null;

  const items = [
    {
      thingId: "thing-a",
      title: "Task Alpha",
      destination: { kind: "visible", lane: "now", thing: { id: "thing-a", title: "Task Alpha" } },
      status: "saved",
      createdAt: Date.now() - 100,
    },
    {
      thingId: "thing-b",
      title: "Task Beta",
      destination: { kind: "visible", lane: "later", thing: { id: "thing-b", title: "Task Beta" } },
      status: "saved",
      createdAt: Date.now(),
    },
  ];

  const { getByText, getByLabelText, rerender } = render(
    h(TossReceipt, {
      items,
      collapsed: false,
      expandedDetails: false,
      onExpandDetails: (exp) => {
        expandedState = exp;
      },
      onShow: (id) => {
        shownId = id;
      },
      onOpen: () => {},
      onDismiss: (id) => {
        dismissedThingId = id;
      },
    }),
  );

  assert.ok(getByText("2 Things tossed"));
  fireEvent.click(getByText("View all (2)"));
  assert.equal(expandedState, true, "Clicking view all triggers onExpandDetails(true)");

  // Re-render with expandedDetails: true
  rerender(
    h(TossReceipt, {
      items,
      collapsed: false,
      expandedDetails: true,
      onExpandDetails: (exp) => {
        expandedState = exp;
      },
      onShow: (id) => {
        shownId = id;
      },
      onOpen: () => {},
      onDismiss: (id) => {
        dismissedThingId = id;
      },
    }),
  );

  assert.ok(getByText("Task Alpha"));
  assert.ok(getByText("Task Beta"));

  // Dismiss individual item
  fireEvent.click(getByLabelText("Dismiss Task Alpha"));
  assert.equal(dismissedThingId, "thing-a");
});

test("TossReceipt hover and focus callbacks propagate", () => {
  cleanup();
  let hovered = false;
  let focused = false;

  const items = [
    {
      thingId: "thing-1",
      title: "Hover test",
      destination: { kind: "visible", lane: "now", thing: { id: "thing-1", title: "Hover test" } },
      status: "saved",
      createdAt: Date.now(),
    },
  ];

  const { container } = render(
    h(TossReceipt, {
      items,
      collapsed: false,
      expandedDetails: false,
      onExpandDetails: () => {},
      onShow: () => {},
      onOpen: () => {},
      onDismiss: () => {},
      onMouseEnter: () => {
        hovered = true;
      },
      onMouseLeave: () => {
        hovered = false;
      },
      onFocus: () => {
        focused = true;
      },
      onBlur: () => {
        focused = false;
      },
    }),
  );

  const wrapper = container.querySelector(".toss-receipt-container");
  assert.ok(wrapper);

  fireEvent.mouseEnter(wrapper);
  assert.equal(hovered, true);

  fireEvent.mouseLeave(wrapper);
  assert.equal(hovered, false);

  fireEvent.focus(wrapper);
  assert.equal(focused, true);

  fireEvent.blur(wrapper);
  assert.equal(focused, false);
});
