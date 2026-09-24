import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";

/**
 * T05: useThingReadState() only ever dispatched/listened for a same-tab
 * CustomEvent. The browser's native "storage" event -- the one that
 * actually fires in *other* tabs when localStorage changes (never in the
 * writing tab itself) -- was never listened for, so marking a Thing read
 * in one tab never updated another tab's unread badges for that Thing.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => ({ update: () => ({ eq: () => ({ is: () => ({ then: (r) => r({ data: null, error: null }) }) }) }) }),
    },
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => false, isPreviewSession: () => false } });

const { useThingReadState } = await import("@/features/things/read-state");

test("useThingReadState() also re-renders on a native cross-tab storage event, not only the same-tab custom event", async () => {
  let renders = 0;
  function Probe() {
    useThingReadState();
    renders++;
    return null;
  }

  render(h(Probe));
  const before = renders;

  await act(async () => {
    window.dispatchEvent(
      new window.StorageEvent("storage", { key: "katalist_thing_read_actor-me_thing-1", newValue: String(Date.now()) }),
    );
  });

  assert.ok(renders > before, "a native storage event for a read-state key must trigger a re-render");
  cleanup();
});
