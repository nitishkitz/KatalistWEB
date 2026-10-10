import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_THING_REFERENCES,
  buildThingPermalink,
  mergeThingReferences,
  recoverLegacyThingDraft,
  makeThingReference,
  parseClipboardThingReferences,
  parseThingPermalink,
  sanitizeThingReferences,
} from "@/features/thing-references/thing-reference";

const ORIGIN = "https://app.katalist.test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("permalink round-trips to the same Thing ID", () => {
  const link = buildThingPermalink(A.toUpperCase(), ORIGIN);
  assert.equal(link, `${ORIGIN}/?thing=${A}`);
  assert.equal(parseThingPermalink(link, [ORIGIN]), A);
});

test("malformed IDs, foreign origins, unsafe schemes and extra paths are rejected", () => {
  assert.equal(buildThingPermalink("not-an-id", ORIGIN), null);
  assert.equal(buildThingPermalink(A, "javascript:alert(1)"), null);
  assert.equal(parseThingPermalink(`https://evil.test/?thing=${A}`, [ORIGIN]), null);
  assert.equal(parseThingPermalink(`javascript:alert(1)//?thing=${A}`, [ORIGIN]), null);
  assert.equal(parseThingPermalink(`${ORIGIN}/lists?thing=${A}`, [ORIGIN]), null);
  assert.equal(parseThingPermalink(`${ORIGIN}/?thing=${A}x`, [ORIGIN]), null);
  assert.equal(parseThingPermalink(`${ORIGIN}/?thing=${A} trailing words`, [ORIGIN]), null);
});

test("clipboard text is a reference paste only when every line is a supported permalink", () => {
  assert.deepEqual(parseClipboardThingReferences(`${ORIGIN}/?thing=${A}`, [ORIGIN]), [makeThingReference(A)]);
  assert.equal(parseClipboardThingReferences(`${ORIGIN}/?thing=${A}\n${ORIGIN}/?thing=${B}`, [ORIGIN]).length, 2);
  assert.equal(parseClipboardThingReferences(`see ${ORIGIN}/?thing=${A}`, [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences(`${ORIGIN}/?thing=${A}\nordinary text`, [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences("", [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences("x".repeat(5_000), [ORIGIN]), null);
});

test("legacy stack JSON becomes an ID-only reference without trusting its title or lane", () => {
  const payload = { thingId: A.toUpperCase(), fromLane: "now", title: "Untrusted copied title" };
  assert.deepEqual(parseClipboardThingReferences(JSON.stringify(payload), [ORIGIN]), [makeThingReference(A)]);
  assert.equal(parseClipboardThingReferences(JSON.stringify({ ...payload, thingId: "invalid" }), [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences(JSON.stringify({ ...payload, fromLane: "unknown" }), [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences(JSON.stringify({ ...payload, title: null }), [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences(JSON.stringify({ ...payload, extra: true }), [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences(JSON.stringify({ thingId: A }), [ORIGIN]), null);
  assert.equal(parseClipboardThingReferences('{"thingId":', [ORIGIN]), null);
});

test("merging deduplicates, preserves order, and caps the draft", () => {
  const first = mergeThingReferences([], [makeThingReference(A)]);
  assert.equal(first.added, 1);
  const again = mergeThingReferences(first.references, [makeThingReference(A), makeThingReference(B)]);
  assert.equal(again.added, 1);
  assert.equal(again.duplicates, 1);
  assert.deepEqual(again.references.map((r) => r.thingId), [A, B]);

  const many = Array.from({ length: MAX_THING_REFERENCES + 3 }, (_, i) =>
    makeThingReference(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
  );
  const capped = mergeThingReferences([], many);
  assert.equal(capped.references.length, MAX_THING_REFERENCES);
  assert.equal(capped.overflow, 3);
});

test("restored draft metadata drops unsupported versions and malformed IDs", () => {
  const restored = sanitizeThingReferences([
    { version: 1, thingId: A },
    { version: 2, thingId: B },
    { version: 1, thingId: "nope" },
    null,
    { version: 1, thingId: A },
  ]);
  assert.deepEqual(restored, [makeThingReference(A)]);
  assert.deepEqual(sanitizeThingReferences("garbage"), []);
});

test("a reference-only pending message renders its references and survives a missing-field operation", async () => {
  const { mergeChatFeed } = await import("@/features/lists/chat-feed-model");
  const base = { id: "m1", listId: "l", authorId: "u", epoch: 1, body: "", kind: "message", attachment: null, mentionedProfileIds: [] };
  const withRefs = mergeChatFeed([], [{ input: { ...base, thingReferenceIds: [A, B] }, delivery: "pending", error: null, at: "2026-10-09T10:00:00Z" }], { name: "Me", avatarUrl: null });
  assert.deepEqual(withRefs[0].thingReferences.map((r) => r.thingId), [A, B]);
  assert.deepEqual(withRefs[0].mentionedProfileIds, []);
  const legacy = mergeChatFeed([], [{ input: base, delivery: "pending", error: null, at: "2026-10-09T10:00:00Z" }], { name: "Me", avatarUrl: null });
  assert.deepEqual(legacy[0].thingReferences, []);
});

test("staged references stay with their own entity, and a retired identity can neither read nor write them", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { advanceIdentityEpoch, getIdentityEpoch, runRegisteredDisposers } = await import("@/features/realtime/identity-cache-policy");
  const { getDraft, setDraft } = await import("@/features/drafts/session-drafts");
  const qc = new QueryClient();
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p1" });
  const staged = [makeThingReference(A)];
  setDraft(qc, "list-chat-references", "list-1", { value: staged });
  assert.deepEqual(getDraft(qc, "list-chat-references", "list-1").value, staged);
  assert.equal(getDraft(qc, "list-chat-references", "list-2"), undefined);
  assert.equal(getDraft(qc, "thing-comment-references", "list-1"), undefined);

  // A late write captured under the old identity must be dropped after the identity changes.
  const staleEpoch = getIdentityEpoch(qc).epoch;
  await runRegisteredDisposers(qc);
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" });
  assert.equal(getDraft(qc, "list-chat-references", "list-1"), undefined);
  setDraft(qc, "list-chat-references", "list-1", { value: staged }, staleEpoch);
  assert.equal(getDraft(qc, "list-chat-references", "list-1"), undefined);
});


test("old raw stack drafts recover as cards without deleting ordinary instructions", () => {
  const raw = JSON.stringify({ thingId: A, fromLane: "now", title: "Old title" });
  assert.deepEqual(recoverLegacyThingDraft(raw, [makeThingReference(B)]), { value: "", references: [makeThingReference(B), makeThingReference(A)] });
  assert.deepEqual(recoverLegacyThingDraft("Review this tomorrow", []), { value: "Review this tomorrow", references: [] });
  assert.deepEqual(recoverLegacyThingDraft('{"ordinary":"JSON"}', []), { value: '{"ordinary":"JSON"}', references: [] });
});
