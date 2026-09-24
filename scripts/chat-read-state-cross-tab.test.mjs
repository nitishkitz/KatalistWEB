import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";

/**
 * T05: useConversationReadState() only ever dispatched/listened for a
 * same-tab CustomEvent. The browser's native "storage" event -- the one
 * that actually fires in *other* tabs when localStorage changes (never in
 * the writing tab itself) -- was never listened for, so marking a
 * conversation read in one tab never updated another tab's unread badges.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { useConversationReadState } = await import("@/features/hub/chat-read-state");

test("useConversationReadState() also re-renders on a native cross-tab storage event", async () => {
  let renders = 0;
  function Probe() {
    useConversationReadState();
    renders++;
    return null;
  }

  render(h(Probe));
  const before = renders;

  await act(async () => {
    window.dispatchEvent(
      new window.StorageEvent("storage", { key: "katalist_conversation_read_profile-1_list-1", newValue: String(Date.now()) }),
    );
  });

  assert.ok(renders > before, "a native storage event for a conversation read-state key must trigger a re-render");
  cleanup();
});
