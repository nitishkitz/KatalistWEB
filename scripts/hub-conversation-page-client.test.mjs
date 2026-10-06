import assert from "node:assert/strict";
import { test, mock } from "node:test";

const calls = [];
let fixtureRows = 101;
let memberRequests = 0;
let identityRequests = 0;
let countsShouldFail = false;
const owner = "profile-1";
const latest = (index) => ({
  id: `list-${index}`, name: `Group ${index}`, kind: "group", owner_profile_id: owner,
  updated_at: "2026-09-24T10:00:00Z", last_body: `Latest ${index}`,
  last_kind: "message", last_at: "2026-09-24T11:00:00Z",
  last_author_profile_id: owner, last_has_attachment: false,
  sort_at: new Date(Date.UTC(2026, 8, 24, 11, 0, 0) - index * 1000).toISOString(),
});

mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: (name, args) => {
      calls.push({ name, ...args });
      if (name === "get_hub_unread_counts") return { abortSignal: async () => ({
        data: countsShouldFail ? null : args.p_list_ids.map((list_id) => ({ list_id, unread_count: 2, mention_count: 1 })),
        error: countsShouldFail ? new Error("aggregate unavailable") : null,
      }) };
      return { abortSignal: async () => ({
        data: Array.from({
          length: Math.max(0, Math.min(101, fixtureRows - (args.p_cursor_id ? Number(args.p_cursor_id.slice(5)) + 1 : 0))),
        }, (_, index) => latest((args.p_cursor_id ? Number(args.p_cursor_id.slice(5)) + 1 : 0) + index)),
        error: null,
      }) };
    },
  },
});
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: {
    from: (table) => {
      assert.equal(table, "list_members", "rail must never request list_messages histories");
      memberRequests++;
      return { select: () => ({ in: () => ({ abortSignal: async () => ({ data: [], error: null }) }) }) };
    },
  } },
});
mock.module("@/features/people/directory", {
  namedExports: {
    fetchProfileIdentitiesByIds: async () => { identityRequests++; return [{ id: owner, display_name: "Ada", avatar_url: null }]; },
    matchAvatarByName: () => null,
  },
});
mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user: { id: owner } }), getStoredDemoSession: () => null } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });

const { fetchConversations } = await import("@/features/hub/use-conversations");

test("Hub client requests bounded pages, maps one latest preview per List, and exposes next page", async () => {
  fixtureRows = 101;
  calls.length = 0;
  const first = await fetchConversations({}, owner, "work");
  assert.equal(first.conversations.length, 100);
  assert.deepEqual(first.nextCursor, { at: latest(99).sort_at, id: "list-99" });
  assert.equal(first.conversations[0].lastMessage, "Latest 0");
  assert.equal(first.conversations[0].unreadCount, 2);
  assert.equal(first.conversations[0].mentionCount, 1);
  const next = await fetchConversations({}, owner, "work", first.nextCursor);
  assert.equal(next.conversations.length, 1);
  assert.equal(next.nextCursor, undefined);
  assert.deepEqual(calls.filter((call) => call.name === "get_hub_conversation_page").map((call) => [call.name, call.p_limit, call.p_cursor_id]), [
    ["get_hub_conversation_page", 100, null],
    ["get_hub_conversation_page", 100, "list-99"],
  ]);
});

for (const count of [0, 10, 100]) {
  test(`Hub fixture ${count} Lists uses at most one summary and one member request`, async (t) => {
    fixtureRows = count;
    calls.length = 0;
    memberRequests = 0;
    identityRequests = 0;
    const started = performance.now();
    const page = await fetchConversations({}, owner, "work");
    const elapsed = performance.now() - started;
    assert.equal(page.conversations.length, count);
    assert.equal(page.nextCursor, undefined);
    assert.equal(calls.length, count ? 2 : 1);
    assert.equal(memberRequests, count ? 1 : 0);
    assert.equal(identityRequests, count ? 1 : 0);
    t.diagnostic(`fixture=${count} summaryRequests=1 unreadAggregateRequests=${count ? 1 : 0} memberRequests=${memberRequests} scopedIdentityCalls=${identityRequests} adapterMs=${elapsed.toFixed(2)} (mocked transport, not live latency)`);
  });
}

test("failed Hub aggregate preserves conversations but marks counts unknown", async () => {
  fixtureRows = 10;
  countsShouldFail = true;
  try {
    const page = await fetchConversations({}, owner, "work");
    assert.equal(page.conversations.length, 10);
    assert.equal(page.conversations[0].unreadCount, "unknown");
    assert.equal(page.conversations[0].mentionCount, "unknown");
  } finally {
    countsShouldFail = false;
  }
});
