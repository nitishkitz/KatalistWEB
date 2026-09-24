import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeChatFeed } from "@/features/lists/chat-feed-model";

function row(id, at, body) {
  return {
    id, at, body, author: "Member", authorId: "author", avatarUrl: null,
    kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [], delivery: "sent",
  };
}

function operation(id, at, delivery = "pending") {
  return {
    input: { id, body: "Optimistic", listId: "list", authorId: "author", epoch: 0,
      kind: "message", attachment: null, mentionedProfileIds: [] },
    at, delivery, error: null,
  };
}

test("authoritative realtime echo replaces a pending operation without a duplicate row", () => {
  const result = mergeChatFeed(
    [row("same-id", "2026-09-24T12:00:00Z", "Persisted")],
    [operation("same-id", "2026-09-24T11:59:59Z")],
    { name: "Me", avatarUrl: null },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].body, "Persisted");
  assert.equal(result[0].delivery, "sent");
});

test("failed, pending, and server rows stay in stable chronological order", () => {
  const result = mergeChatFeed(
    [row("server", "2026-09-24T12:00:00Z", "First")],
    [operation("failed", "2026-09-24T12:00:02Z", "failed"), operation("pending", "2026-09-24T12:00:01Z")],
    { name: "Me", avatarUrl: null },
  );
  assert.deepEqual(result.map(({ id }) => id), ["server", "pending", "failed"]);
  assert.equal(result.at(-1).delivery, "failed");
});

test("mixed UTC timestamp formats sort by instant, not serialized text", () => {
  const result = mergeChatFeed(
    [row("later", "2026-09-24T12:00:01+00:00", "Later")],
    [operation("earlier", "2026-09-24T12:00:00.500Z")],
    { name: "Me", avatarUrl: null },
  );
  assert.deepEqual(result.map(({ id }) => id), ["earlier", "later"]);
});
