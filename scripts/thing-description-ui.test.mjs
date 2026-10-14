import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.Node = window.Node;
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => ({
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
});
window.HTMLElement.prototype.getClientRects = () => [];
let fail = false,
  calls = [];
mock.module("@/features/things/description/save-description", {
  namedExports: {
    saveThingDescription: async (id, document, revision) => {
      calls.push({ id, document, revision });
      if (fail) throw new Error("Network unavailable");
      return { descriptionDocument: document, descriptionRevision: revision + 1 };
    },
  },
});
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async () =>
      new Response(
        JSON.stringify({
          preview: {
            title: "Real booking title",
            host: "example.com",
            description: "Booking metadata",
            image: "https://example.com/thumb.jpg",
          },
        }),
        { status: 200 },
      ),
  },
});
const { ThingDescription } = await import("@/features/things/description/ThingDescription");
const { DescriptionReadView } = await import("@/features/things/description/DescriptionReadView");
const thing = {
  id: "t-description",
  title: "Tickets",
  owner: { id: "owner" },
  descriptionRevision: 0,
};
function mount(
  t = thing,
  canEdit = true,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const wrapper = ({ children }) =>
    h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, children));
  return { ...render(h(ThingDescription, { thing: t, canEdit }), { wrapper }), qc, wrapper };
}
function paste(ui, text) {
  const clipboardData = {
    getData: (format) => (format === "text/plain" ? text : ""),
    files: [],
    types: ["text/plain"],
  };
  fireEvent.paste(ui.getByRole("textbox", { name: "Description" }), { clipboardData });
}
test("owner editing supports save, cancel, draft recovery and inline network failure", async () => {
  calls = [];
  fail = false;
  let ui = mount(); console.log('owner test mounted');
  fireEvent.click(ui.getByRole("button", { name: "+ Add description" }));
  await waitFor(() => assert.ok(ui.getByRole("textbox", { name: "Description" })));
  assert.ok(ui.getByRole("button", { name: "Save" }).disabled);
  paste(ui, "Travel notes");
  await waitFor(() => assert.equal(ui.getByRole("button", { name: "Save" }).disabled, false));
  const qc = ui.qc;
  ui.unmount();
  ui = mount(thing, true, qc);
  await waitFor(() =>
    assert.match(ui.getByRole("textbox", { name: "Description" }).textContent, /Travel notes/),
  );
  fail = true;
  fireEvent.click(ui.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent, /Network unavailable/));
  assert.match(ui.getByRole("textbox", { name: "Description" }).textContent, /Travel notes/);
  fail = false;
  fireEvent.click(ui.getByRole("button", { name: "Save" }));
  await waitFor(() => assert.equal(ui.queryByRole("textbox", { name: "Description" }), null));
  assert.equal(qc.getQueryData(["thing", thing.id]).descriptionRevision, 1);
  assert.equal(calls.at(-1).revision, 0);
  cleanup();
  ui = mount({ ...thing, description: "Saved notes" });
  fireEvent.click(ui.getByRole("button", { name: "Edit", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("textbox", { name: "Description" })));
  paste(ui, " changed");
  fireEvent.click(ui.getByRole("button", { name: "Cancel", exact: true }));
  assert.match(ui.container.textContent, /Saved notes/);
  assert.doesNotMatch(ui.container.textContent, /changed/);
  cleanup();
});
test("non-owner is read-only and ownership or revision change disables an open editor", async () => {
  let ui = mount({ ...thing, description: "Saved notes" }, false);
  assert.equal(ui.queryByRole("button", { name: "Edit", exact: true }), null);
  assert.equal(ui.queryByRole("textbox"), null);
  cleanup();
  ui = mount();
  fireEvent.click(ui.getByRole("button", { name: "+ Add description" }));
  await waitFor(() => assert.ok(ui.getByRole("textbox", { name: "Description" })));
  paste(ui, "New notes");
  ui.rerender(h(ThingDescription, { thing: { ...thing, descriptionRevision: 1 }, canEdit: true }));
  assert.ok(ui.getByRole("button", { name: "Save" }).disabled);
  assert.match(ui.getByRole("alert").textContent, /another session/);
  ui.rerender(
    h(ThingDescription, { thing: { ...thing, owner: { id: "another-owner" } }, canEdit: false }),
  );
  assert.ok(ui.getByRole("button", { name: "Save" }).disabled);
  assert.match(ui.getByRole("alert").textContent, /Ownership changed/);
  cleanup();
});
test("saved formatting and safe URL previews render; metadata failure does not prevent editing", async () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Booking",
            marks: [
              { type: "bold" },
              { type: "italic" },
              { type: "link", attrs: { href: "https://example.com/" } },
            ],
          },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Train" }] }],
          },
        ],
      },
    ],
  };
  let ui = render(h(DescriptionReadView, { document }));
  assert.equal(
    ui.container.querySelector("strong em a").getAttribute("rel"),
    "noopener noreferrer nofollow",
  );
  assert.equal(ui.container.querySelector("ul li").textContent, "Train");
  cleanup();
  ui = mount({ ...thing, descriptionDocument: document }, false);
  await waitFor(() => assert.ok(ui.getByText("Real booking title")));
  const card = ui.getByText("Real booking title").closest("a");
  assert.equal(card.href, "https://example.com/");
  assert.equal(card.target, "_blank");
  cleanup();
});
