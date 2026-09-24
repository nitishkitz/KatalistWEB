import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, getIdentityEpoch, runRegisteredDisposers } from "@/features/realtime/identity-cache-policy";
import { getDraft, setDraft, clearDraft, getDraftRevision } from "@/features/drafts/session-drafts";

/**
 * D03: session-drafts.ts's contract -- identity-owned, per-(composer
 * kind, entity) drafts that survive same-session navigation but never
 * follow a selection to a different entity and never survive an identity
 * switch.
 */
function newClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p1" });
  return qc;
}

test("a draft is readable for the same (composer kind, entity) pair", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "hello" });
  assert.deepEqual(getDraft(qc, "thing-comment", "thing-1"), { value: "hello" });
});

test("a draft for one entity is never visible under a different entity id", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "hello" });
  assert.equal(getDraft(qc, "thing-comment", "thing-2"), undefined, "different entity, no draft");
});

test("a draft for one composer kind is never visible under a different composer kind on the same entity id", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "shared-id", { value: "comment text" });
  assert.equal(
    getDraft(qc, "bucket-note", "shared-id"),
    undefined,
    "same entity id string, different composer kind -- must not collide",
  );
});

test("clearDraft removes exactly that (composer kind, entity) pair, leaving others untouched", () => {
  const qc = newClient();
  setDraft(qc, "list-chat", "list-1", { value: "draft A" });
  setDraft(qc, "list-chat", "list-2", { value: "draft B" });
  clearDraft(qc, "list-chat", "list-1");
  assert.equal(getDraft(qc, "list-chat", "list-1"), undefined);
  assert.deepEqual(getDraft(qc, "list-chat", "list-2"), { value: "draft B" });
});

test("an identity retirement (real disposer run) clears every draft for that client", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "unsent" });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" });
  runRegisteredDisposers(qc);
  assert.equal(getDraft(qc, "thing-comment", "thing-1"), undefined, "profile switch retires every draft, not just the accessed one");
});

test("a draft becomes unreachable the instant the epoch advances, even before the disposer runs", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "unsent" });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" }); // disposer NOT run yet
  assert.equal(getDraft(qc, "thing-comment", "thing-1"), undefined, "epoch mismatch alone hides it, matching every other epoch-scoped store in this codebase");
});

test("setDraft called with an already-stale captured epoch is dropped, not misattributed to the new identity", () => {
  const qc = newClient();
  const epochAtDispatch = getIdentityEpoch(qc).epoch; // captured before the switch below
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" });
  setDraft(qc, "thing-comment", "thing-1", { value: "late write" }, epochAtDispatch);
  assert.equal(getDraft(qc, "thing-comment", "thing-1"), undefined, "a write under a stale captured epoch must not land under the new identity");
});

test("attachments are retained across a failed-send retry (same entity, no clear)", () => {
  const qc = newClient();
  setDraft(qc, "list-chat", "list-1", { value: "body", attachments: [{ key: "a", name: "photo.png" }] });
  const draft = getDraft(qc, "list-chat", "list-1");
  assert.equal(draft?.attachments?.length, 1);
});

// T02: getDraftRevision() -- a monotonically increasing edit count, separate
// from the draft's own content/presence, so a caller can tell "nothing has
// touched this draft since I looked" apart from "the draft happens to be
// empty right now" (the latter is also true right after a deliberate clear,
// which is a real decision, not "unchanged").

test("getDraftRevision starts at 0 for a never-touched (composer kind, entity) pair", () => {
  const qc = newClient();
  assert.equal(getDraftRevision(qc, "thing-comment", "thing-1"), 0);
});

test("getDraftRevision increases on setDraft", () => {
  const qc = newClient();
  const before = getDraftRevision(qc, "thing-comment", "thing-1");
  setDraft(qc, "thing-comment", "thing-1", { value: "hello" });
  assert.equal(getDraftRevision(qc, "thing-comment", "thing-1"), before + 1);
});

test("getDraftRevision increases on clearDraft when there was something to clear", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "hello" });
  const before = getDraftRevision(qc, "thing-comment", "thing-1");
  clearDraft(qc, "thing-comment", "thing-1");
  assert.equal(getDraftRevision(qc, "thing-comment", "thing-1"), before + 1);
});

test("getDraftRevision does NOT increase on an idempotent clearDraft of an already-empty slot", () => {
  // This is what makes ThingDetailContent's own explicit clearDraft() (at
  // submit time) and the write-through effect's later, redundant clear of
  // the same now-already-empty slot NOT look like two separate edits.
  const qc = newClient();
  clearDraft(qc, "thing-comment", "thing-1"); // nothing to clear
  const before = getDraftRevision(qc, "thing-comment", "thing-1");
  clearDraft(qc, "thing-comment", "thing-1"); // still nothing to clear
  assert.equal(getDraftRevision(qc, "thing-comment", "thing-1"), before);
});

test("getDraftRevision distinguishes 'never touched since submit' from 'typed something new, then deliberately cleared it'", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "" }); // simulates the submit-time clear
  const submittedRevision = getDraftRevision(qc, "thing-comment", "thing-1");

  // Case 1: nothing else happens -- a later check must see "unchanged".
  assert.equal(getDraftRevision(qc, "thing-comment", "thing-1"), submittedRevision);

  // Case 2: the user types something new, then deliberately clears it --
  // content is empty again (identical to case 1's end state), but the
  // revision must show it's NOT the same as right after submit.
  setDraft(qc, "thing-comment", "thing-1", { value: "a new draft" });
  clearDraft(qc, "thing-comment", "thing-1");
  assert.notEqual(getDraftRevision(qc, "thing-comment", "thing-1"), submittedRevision);
});

test("getDraftRevision for one (composer kind, entity) pair is independent of another", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "a" });
  const untouched = getDraftRevision(qc, "thing-comment", "thing-2");
  assert.equal(untouched, 0, "a different entity's revision must not be bumped by an unrelated setDraft");
});

test("getDraftRevision keeps counting even after an identity retirement clears the draft store", () => {
  const qc = newClient();
  setDraft(qc, "thing-comment", "thing-1", { value: "unsent" });
  const before = getDraftRevision(qc, "thing-comment", "thing-1");
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" });
  runRegisteredDisposers(qc);
  assert.notEqual(
    getDraftRevision(qc, "thing-comment", "thing-1"),
    before,
    "the disposer clearing every draft on retirement is itself a change a stale restore must see",
  );
});
