import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { advanceIdentityEpoch } from "@/features/realtime/identity-cache-policy";

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
let requests = [],
  saves = [],
  respond;
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async (url, init) => {
      if (url === "/api/things/improve-description") {
        requests.push(JSON.parse(init.body));
        return respond(init.signal);
      }
      return new Response(JSON.stringify({ preview: null }), { status: 200 });
    },
  },
});
mock.module("@/features/things/description/save-description", {
  namedExports: {
    saveThingDescription: async (id, document, revision) => {
      saves.push({ id, document, revision });
      return { descriptionDocument: document, descriptionRevision: revision + 1 };
    },
  },
});
const { ThingDescription } = await import("@/features/things/description/ThingDescription");
const original = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "send report pls" }] }],
};
const improved = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Please send the report." }] }],
};
const thing = {
  id: "description-owner",
  owner: { id: "owner" },
  descriptionDocument: original,
  descriptionRevision: 1,
};
function mount(canEdit = true, document = original) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "owner" });
  const wrapper = ({ children }) =>
    h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, children));
  const ui = render(
    h(ThingDescription, { thing: { ...thing, descriptionDocument: document }, canEdit }),
    { wrapper },
  );
  return { ...ui, qc };
}
async function edit(ui) {
  fireEvent.click(ui.getByRole("button", { name: "Edit", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("textbox", { name: "Description" }).editor));
  return ui.getByRole("textbox", { name: "Description" }).editor;
}
afterEach(() => {
  cleanup();
  requests = [];
  saves = [];
});

test("Improve previews the whole draft, applies only on acceptance, and saves only on Save", async () => {
  respond = async () => new Response(JSON.stringify({ document: improved }), { status: 200 });
  const ui = mount();
  const editor = await edit(ui);
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("region", { name: "Sarvam suggestion" })));
  assert.deepEqual(requests[0], { thingId: thing.id, document: original });
  assert.equal(editor.getText(), "send report pls");
  assert.equal(saves.length, 0);
  fireEvent.click(ui.getByRole("button", { name: "Use suggestion" }));
  assert.equal(editor.getText(), "Please send the report.");
  assert.equal(saves.length, 0);
  fireEvent.click(ui.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => assert.equal(saves.length, 1));
  assert.deepEqual(saves[0].document, improved);
  ui.qc.clear();
});

test("selection scope is sent and dismissing the suggestion leaves the draft unchanged", async () => {
  respond = async () => new Response(JSON.stringify({ document: improved }), { status: 200 });
  const ui = mount();
  const editor = await edit(ui);
  act(() => editor.commands.setTextSelection({ from: 1, to: 5 }));
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Keep original" })));
  assert.deepEqual(requests[0].selection, { from: 1, to: 5 });
  fireEvent.click(ui.getByRole("button", { name: "Keep original" }));
  assert.equal(editor.getText(), "send report pls");
  assert.equal(saves.length, 0);
  ui.qc.clear();
});

test("an AI reply cannot replace a draft edited while the request was pending", async () => {
  let resolve;
  respond = () =>
    new Promise((done) => {
      resolve = done;
    });
  const ui = mount();
  const editor = await edit(ui);
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.equal(requests.length, 1));
  act(() => editor.commands.insertContent(" new information"));
  await act(async () =>
    resolve(new Response(JSON.stringify({ document: improved }), { status: 200 })),
  );
  await waitFor(() => assert.match(ui.getByRole("alert").textContent, /changed/i));
  assert.equal(ui.queryByRole("button", { name: "Use suggestion" }), null);
  assert.match(editor.getText(), /new information/);
  ui.qc.clear();
});

test("format controls follow the cursor between formatted lists and plain text", async () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "bold note", marks: [{ type: "bold" }] }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "plain note" }] },
    ],
  };
  const ui = mount(true, document);
  const editor = await edit(ui);
  act(() => editor.commands.setTextSelection(4));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Bold", exact: true }).getAttribute("aria-pressed"),
      "true",
    ),
  );
  assert.equal(
    ui.getByRole("button", { name: "Bullet list" }).getAttribute("aria-pressed"),
    "true",
  );
  act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Bold", exact: true }).getAttribute("aria-pressed"),
      "false",
    ),
  );
  assert.equal(
    ui.getByRole("button", { name: "Bullet list" }).getAttribute("aria-pressed"),
    "false",
  );
  ui.qc.clear();
});

test("undoing a list toggle restores plain text and clears its selected indicator", async () => {
  const ui = mount();
  const editor = await edit(ui);
  act(() => editor.commands.setTextSelection(1));
  fireEvent.click(ui.getByRole("button", { name: "Bullet list" }));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Bullet list" }).getAttribute("aria-pressed"),
      "true",
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Bullet list" }).getAttribute("aria-pressed"),
      "false",
    ),
  );
  assert.equal(editor.getJSON().content[0].type, "paragraph");
  ui.qc.clear();
});

test("a stopped request and a retired identity cannot show or apply a late suggestion", async () => {
  let resolve;
  respond = () =>
    new Promise((done) => {
      resolve = done;
    });
  const ui = mount();
  const editor = await edit(ui);
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.equal(requests.length, 1));
  fireEvent.click(ui.getByRole("button", { name: "Stop", exact: true }));
  await act(async () =>
    resolve(new Response(JSON.stringify({ document: improved }), { status: 200 })),
  );
  assert.equal(ui.queryByRole("region", { name: "Sarvam suggestion" }), null);
  assert.equal(editor.getText(), "send report pls");
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.equal(requests.length, 2));
  advanceIdentityEpoch(ui.qc, { kind: "live", profileId: "another-person" });
  await act(async () =>
    resolve(new Response(JSON.stringify({ document: improved }), { status: 200 })),
  );
  assert.equal(ui.queryByRole("region", { name: "Sarvam suggestion" }), null);
  assert.equal(saves.length, 0);
  ui.qc.clear();
});

test("service failure leaves the editor usable, and editing after preview disables acceptance", async () => {
  respond = async () =>
    new Response(JSON.stringify({ message: "Sarvam is temporarily unavailable." }), {
      status: 503,
    });
  const ui = mount();
  const editor = await edit(ui);
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent, /temporarily unavailable/));
  assert.equal(editor.getText(), "send report pls");
  assert.equal(
    ui.getByRole("button", { name: "Improve with Sarvam", exact: true }).disabled,
    false,
  );
  respond = async () => new Response(JSON.stringify({ document: improved }), { status: 200 });
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Use suggestion" })));
  act(() => editor.commands.insertContent(" latest"));
  assert.equal(ui.getByRole("button", { name: "Use suggestion" }).disabled, true);
  assert.equal(saves.length, 0);
  ui.qc.clear();
});

test("non-editors cannot invoke Improve", () => {
  const ui = mount(false);
  assert.equal(ui.queryByRole("button", { name: "Improve with Sarvam", exact: true }), null);
  assert.equal(requests.length, 0);
  ui.qc.clear();
});

test("undoing an accepted suggestion preserves the unsaved text from before Improve", async () => {
  respond = async () =>
    new Response(
      JSON.stringify({
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Please send the report tomorrow." }],
            },
          ],
        },
      }),
      { status: 200 },
    );
  const ui = mount();
  const editor = await edit(ui);
  act(() =>
    editor
      .chain()
      .setTextSelection(editor.state.doc.content.size - 1)
      .insertContent(" tomorrow")
      .run(),
  );
  assert.equal(editor.getText(), "send report pls tomorrow");
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.ok(ui.getByRole("button", { name: "Use suggestion" })));
  fireEvent.click(ui.getByRole("button", { name: "Use suggestion" }));
  fireEvent.click(ui.getByRole("button", { name: "Undo" }));
  assert.equal(editor.getText(), "send report pls tomorrow");
  ui.qc.clear();
});

test("a malformed suggestion cannot remove formatting or introduce a link", async () => {
  respond = async () =>
    new Response(
      JSON.stringify({
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Visit https://unexpected.example/" }],
            },
          ],
        },
      }),
      { status: 200 },
    );
  const ui = mount();
  const editor = await edit(ui);
  fireEvent.click(ui.getByRole("button", { name: "Improve with Sarvam", exact: true }));
  await waitFor(() => assert.match(ui.getByRole("alert").textContent, /links/));
  assert.equal(editor.getText(), "send report pls");
  assert.equal(ui.queryByRole("button", { name: "Use suggestion" }), null);
  ui.qc.clear();
});
