import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * chat-read-state.ts's "last read" localStorage keys used to be unscoped
 * by profile (`katalist_conversation_read_${listId}`), which leaked one
 * profile's read state onto another's on a shared device or after an
 * account switch. Verifies: (1) two profiles reading/marking the same
 * conversation don't see or overwrite each other's state, and (2) a
 * pre-scoping legacy unscoped value is never read as a fallback for either
 * profile -- it's only removed, never trusted.
 */

const { getConversationLastReadAt, markConversationAsRead } = await import("@/features/hub/chat-read-state");

function reset() {
  window.localStorage.clear();
}

test("two profiles reading the same conversation on the same device do not share a last-read mark", () => {
  reset();
  markConversationAsRead("list-1", "profile-A");
  const aTime = getConversationLastReadAt("list-1", "profile-A");
  assert.ok(aTime > 0, "profile A's own mark is readable");

  const bTime = getConversationLastReadAt("list-1", "profile-B");
  assert.equal(bTime, 0, "profile B must not see profile A's last-read mark for the same conversation");
});

test("marking as read under one profile does not affect a different profile's mark", () => {
  reset();
  markConversationAsRead("list-1", "profile-A");
  markConversationAsRead("list-1", "profile-B");
  const aTime = getConversationLastReadAt("list-1", "profile-A");
  const bTime = getConversationLastReadAt("list-1", "profile-B");
  assert.ok(aTime > 0 && bTime > 0, "both profiles have their own marks");

  // B re-marks; A's own mark must be untouched.
  const aTimeBefore = aTime;
  markConversationAsRead("list-1", "profile-B");
  assert.equal(getConversationLastReadAt("list-1", "profile-A"), aTimeBefore, "profile A's mark is unaffected by profile B's write");
});

test("a pre-scoping unscoped legacy value is never read as a fallback for any specific profile", () => {
  reset();
  // Simulate a value written by the pre-scoping build of this feature.
  window.localStorage.setItem("katalist_conversation_read_list-1", String(Date.now()));

  const time = getConversationLastReadAt("list-1", "profile-A");
  assert.equal(time, 0, "the unscoped legacy value must not be credited to profile A (or any other specific profile)");
});

test("the legacy unscoped key is cleaned up (not left to resurface) once a scoped value is written", () => {
  reset();
  window.localStorage.setItem("katalist_conversation_read_list-1", String(Date.now()));
  markConversationAsRead("list-1", "profile-A");
  assert.equal(window.localStorage.getItem("katalist_conversation_read_list-1"), null, "the legacy unscoped key is removed once a scoped write has happened");
});

test("getConversationLastReadAt/markConversationAsRead are no-ops without a known profile id", () => {
  reset();
  markConversationAsRead("list-1", undefined);
  assert.equal(getConversationLastReadAt("list-1", undefined), 0);
  assert.equal(window.localStorage.length, 0, "nothing is written to storage without a profile id to scope it to");
});
