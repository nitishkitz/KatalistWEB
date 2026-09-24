import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * T05: markThingAsRead() wrote to the live `notifications` table
 * unconditionally, including from a preview/demo session. Preview data is
 * local fixtures -- a preview "read" must never issue a real write against
 * a live account's notifications row.
 */

let supabaseCalled = false;
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        supabaseCalled = true;
        return { update: () => ({ eq: () => ({ is: () => ({ then: (r) => r({ data: null, error: null }) }) }) }) };
      },
    },
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => true, isPreviewSession: () => true } });

const { markThingAsRead } = await import("@/features/things/read-state");

test("markThingAsRead() does not write to the live notifications table during a preview/demo session", () => {
  window.localStorage.clear();
  supabaseCalled = false;
  markThingAsRead("thing-1", "demo-actor");

  assert.equal(supabaseCalled, false, "a preview-session read must not touch the live notifications table");
});
