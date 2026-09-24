import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

let insertImpl = async () => ({ error: null });
let storedRows = new Map();
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: {
    from: (table) => {
      assert.equal(table, "list_messages");
      let selectedId;
      const builder = {
        insert: (row) => insertImpl(row),
        select: () => builder,
        eq: (key, value) => { if (key === "id") selectedId = value; return builder; },
        maybeSingle: async () => ({ data: storedRows.get(selectedId) ?? null, error: null }),
      };
      return builder;
    },
  } },
});

const { submitChatOperation, chatOperationsFor } = await import("@/features/lists/chat-operations");
const { advanceIdentityEpoch, runRegisteredDisposers } = await import("@/features/realtime/identity-cache-policy");

function input(id = crypto.randomUUID(), listId = crypto.randomUUID(), draftRevision = 1) {
  return {
    id, listId, authorId: crypto.randomUUID(), epoch: 0, body: "Hello", kind: "message",
    attachment: null, mentionedProfileIds: [], draftRevision,
  };
}

test("two mounted composers claiming one draft revision make one INSERT", async () => {
  const qc = new QueryClient();
  let resolveInsert;
  let writes = 0;
  insertImpl = () => { writes++; return new Promise((resolve) => { resolveInsert = resolve; }); };
  const first = input();
  const p1 = submitChatOperation(qc, first);
  const p2 = submitChatOperation(qc, { ...first, id: crypto.randomUUID() });
  assert.equal(p1, p2);
  assert.equal(writes, 1);
  resolveInsert({ error: null });
  assert.deepEqual(await p1, { id: first.id, inserted: true });
  assert.equal(chatOperationsFor(qc, first.listId).length, 1);
  qc.clear();
});

test("lost INSERT response recovers only the exact authorized persisted operation", async () => {
  const qc = new QueryClient();
  storedRows = new Map();
  const request = input();
  insertImpl = async (row) => {
    storedRows.set(row.id, row);
    return { error: new Error("response lost") };
  };
  assert.deepEqual(await submitChatOperation(qc, request), { id: request.id, inserted: false });
  assert.equal(chatOperationsFor(qc, request.listId)[0].delivery, "sent");

  const other = input();
  storedRows.set(other.id, { ...other, id: other.id, list_id: other.listId, author_profile_id: other.authorId, body: "Different", attachment: null, mentioned_profile_ids: [], kind: "message" });
  insertImpl = async () => ({ error: new Error("duplicate") });
  await assert.rejects(submitChatOperation(qc, other), /belongs to another send/);
  qc.clear();
});

test("failed send retries the same UUID; another List remains independent", async () => {
  const qc = new QueryClient();
  storedRows = new Map();
  const first = input();
  const second = input();
  let fail = true;
  const ids = [];
  insertImpl = async (row) => { ids.push(row.id); return { error: fail && row.id === first.id ? new Error("offline") : null }; };
  await assert.rejects(submitChatOperation(qc, first), /offline/);
  assert.equal(chatOperationsFor(qc, first.listId)[0].delivery, "failed");
  fail = false;
  await Promise.all([submitChatOperation(qc, first), submitChatOperation(qc, second)]);
  assert.deepEqual(ids, [first.id, first.id, second.id]);
  qc.clear();
});

test("retiring identity clears pending UI and a late response cannot adopt the next account", async () => {
  const qc = new QueryClient();
  let resolveInsert;
  insertImpl = () => new Promise((resolve) => { resolveInsert = resolve; });
  const request = input();
  const pending = submitChatOperation(qc, request);
  advanceIdentityEpoch(qc, { kind: "live", profileId: "account-b" });
  runRegisteredDisposers(qc);
  resolveInsert({ error: null });
  await pending;
  assert.equal(chatOperationsFor(qc, request.listId).length, 0);
  await assert.rejects(submitChatOperation(qc, request), /ended/);
  qc.clear();
});
