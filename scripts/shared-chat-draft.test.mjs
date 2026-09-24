import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSessionDraft } from "@/features/drafts/use-session-draft";
import { advanceIdentityEpoch, runRegisteredDisposers } from "@/features/realtime/identity-cache-policy";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Composer({ listId, label }) {
  const draft = useSessionDraft("list-chat", listId, "");
  return h("input", {
    "aria-label": label,
    value: draft.value,
    onChange: (event) => draft.write(event.target.value),
  });
}

test("two composers share text and attachments, but List and identity changes isolate it", async () => {
  const qc = new QueryClient();
  const component = (first, second) => h(QueryClientProvider, { client: qc },
    h(Composer, { listId: first, label: "dock" }),
    h(Composer, { listId: second, label: "call" }));
  const view = render(component("list-a", "list-a"));
  await act(async () => fireEvent.change(view.getByLabelText("dock"), { target: { value: "shared" } }));
  assert.equal(view.getByLabelText("call").value, "shared");

  const { setDraft, getDraft } = await import("@/features/drafts/session-drafts");
  await act(async () => setDraft(qc, "list-chat", "list-a", {
    value: "shared", attachments: [{ key: "uploaded", name: "file.txt" }],
  }));
  await act(async () => fireEvent.change(view.getByLabelText("call"), { target: { value: "edited" } }));
  assert.equal(getDraft(qc, "list-chat", "list-a").attachments[0].key, "uploaded",
    "editing text from the call must not erase a file staged in the dock");

  view.rerender(component("list-a", "list-b"));
  assert.equal(view.getByLabelText("dock").value, "edited");
  assert.equal(view.getByLabelText("call").value, "");

  await act(async () => {
    advanceIdentityEpoch(qc, { kind: "live", profileId: "next-account" });
    runRegisteredDisposers(qc);
  });
  assert.equal(view.getByLabelText("dock").value, "");
  assert.equal(view.getByLabelText("call").value, "");
  cleanup();
  qc.clear();
});
