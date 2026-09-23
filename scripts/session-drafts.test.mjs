import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, getIdentityEpoch, runRegisteredDisposers } from "@/features/realtime/identity-cache-policy";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";

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
