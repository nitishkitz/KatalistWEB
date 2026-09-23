import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G04: ConversationWorkspace used to call markConversationAsRead the
 * instant a conversation opened, with no check for whether the tab was
 * actually active -- a backgrounded tab holding this conversation would
 * clear "unread" for content the user never looked at. Now gated on
 * document.visibilityState, and re-checked on visibilitychange so
 * returning to an already-open conversation still marks it read.
 *
 * ConversationWorkspace has a large, heavy dependency tree (calls,
 * files, presence, lists) -- a source-based assertion here, matching
 * this suite's own established pattern for components of this size,
 * rather than a full render harness whose mocking cost would exceed the
 * value for this specific, narrow fix.
 */
const workspace = readFileSync(
  new URL("../src/features/hub/components/ConversationWorkspace.tsx", import.meta.url),
  "utf8",
);

test("marking a conversation read is gated on the tab actually being visible", () => {
  assert.match(workspace, /document\.visibilityState !== "hidden"/);
  assert.match(workspace, /markConversationAsRead\(listId, user\?\.id\)/);
});

test("re-checks on visibilitychange, so returning to an already-open conversation still marks it read", () => {
  assert.match(workspace, /addEventListener\("visibilitychange", markIfVisible\)/);
  assert.match(workspace, /removeEventListener\("visibilitychange", markIfVisible\)/);
});
