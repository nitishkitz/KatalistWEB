import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  listThingFilterStorageKey,
  useListThingsFilter,
} from "@/features/lists/use-list-things-filter";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ identityId, listId }) {
  const filter = useListThingsFilter(identityId, listId);
  return h("div", null,
    h("output", { "aria-label": "filter" }, filter.value),
    h("button", { type: "button", onClick: () => filter.setValue("mine") }, "Mine"),
  );
}

test("a reused route restores each profile+List slot without copying the previous render's value", async () => {
  window.localStorage.clear();
  window.localStorage.setItem(listThingFilterStorageKey("profile-a", "list-a"), "active");
  const view = render(h(Harness, { identityId: "profile-a", listId: "list-a" }));
  assert.equal(view.getByLabelText("filter").textContent, "active");

  await act(async () => fireEvent.click(view.getByText("Mine")));
  assert.equal(window.localStorage.getItem(listThingFilterStorageKey("profile-a", "list-a")), "mine");

  view.rerender(h(Harness, { identityId: "profile-a", listId: "list-b" }));
  assert.equal(view.getByLabelText("filter").textContent, "all");
  assert.equal(window.localStorage.getItem(listThingFilterStorageKey("profile-a", "list-b")), null);

  view.rerender(h(Harness, { identityId: "profile-b", listId: "list-a" }));
  assert.equal(view.getByLabelText("filter").textContent, "all");
  assert.equal(window.localStorage.getItem(listThingFilterStorageKey("profile-b", "list-a")), null);

  view.rerender(h(Harness, { identityId: "profile-a", listId: "list-a" }));
  assert.equal(view.getByLabelText("filter").textContent, "mine");
  cleanup();
});

test("corrupt storage falls back to All and unresolved auth never creates an anonymous slot", () => {
  window.localStorage.clear();
  window.localStorage.setItem(listThingFilterStorageKey("profile-a", "list-a"), "not-a-filter");
  const view = render(h(Harness, { identityId: "profile-a", listId: "list-a" }));
  assert.equal(view.getByLabelText("filter").textContent, "all");
  view.rerender(h(Harness, { identityId: null, listId: "list-a" }));
  fireEvent.click(view.getByText("Mine"));
  assert.equal([...Array(window.localStorage.length)].some((_, index) => window.localStorage.key(index)?.includes("null")), false);
  cleanup();
});
