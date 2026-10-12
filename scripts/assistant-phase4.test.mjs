import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActionError,
  confirmAssistantAction,
  parseActionRequest,
  previewAssistantAction,
} from "../server/lib/assistant-actions.ts";
import { sanitizeSuggestedActions } from "../server/lib/assistant.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function fake({ things, nudgeable = [] }) {
  const calls = [];
  const builder = (table) => {
    const q = { table };
    for (const m of ["select", "in", "eq", "is", "not", "order"]) q[m] = () => q;
    q.limit = async () => ({ data: table === "things" ? things : [] });
    q.maybeSingle = async () => ({ data: table === "actors" ? { id: ACTOR } : null });
    return q;
  };
  return {
    calls,
    from: builder,
    async rpc(name, args) {
      if (name === "list_nudgeable_things") return { data: nudgeable };
      if (name === "list_assignable_people") return { data: [{ actor_id: ACTOR }] };
      calls.push([name, args]);
      return { data: { ok: true } };
    },
  };
}
const row = (id, extra = {}) => ({ id, title: `T-${id.slice(0, 2)}`, context: "work", work_status: "not_started", acknowledgement: "caught", due_at: null, current_assignee_actor_id: ACTOR, ...extra });
const req = (type, ids, params) => parseActionRequest({ type, targetIds: ids, params });

test("confirm applies once, replays duplicates, and reports partial success", async () => {
  const client = fake({ things: [row(A), row(B, { work_status: "sorted" })] });
  const preview = await previewAssistantAction(client, "u1", req("set_status", [A, B], { status: "under_progress" }));
  assert.deepEqual(preview.action.targetIds, [A]);
  assert.equal(preview.targets.find((t) => t.id === B).state, "rejected");
  const first = await confirmAssistantAction(client, "u1", { token: preview.token, idempotencyKey: "key-12345" });
  const second = await confirmAssistantAction(client, "u1", { token: preview.token, idempotencyKey: "key-12345" });
  assert.equal(client.calls.length, 1);
  assert.equal(first.results[0].state, "applied");
  assert.deepEqual(second, first);
});

test("a Thing that changed after the preview is rejected without a write", async () => {
  const client = fake({ things: [row(A)] });
  const preview = await previewAssistantAction(client, "u1", req("set_due", [A], { dueAt: "2026-10-16T00:00:00Z" }));
  const changed = fake({ things: [row(A, { current_assignee_actor_id: null })] });
  const result = await confirmAssistantAction(changed, "u1", { token: preview.token, idempotencyKey: "key-stale-1" });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].state, "rejected");
  assert.equal(changed.calls.length, 0);
});

test("tampered, foreign and keyless confirmations are refused", async () => {
  const client = fake({ things: [row(A)] });
  const { token } = await previewAssistantAction(client, "u1", req("set_status", [A], { status: "under_progress" }));
  await assert.rejects(confirmAssistantAction(client, "u1", { token: token + "x", idempotencyKey: "key-12345" }), ActionError);
  await assert.rejects(confirmAssistantAction(client, "u2", { token, idempotencyKey: "key-12345" }), ActionError);
  await assert.rejects(confirmAssistantAction(client, "u1", { token, idempotencyKey: "" }), ActionError);
  assert.equal(client.calls.length, 0);
});

test("nudges honor RPC eligibility, so cooldown Things get no token", async () => {
  const client = fake({ things: [row(A)], nudgeable: [] });
  const preview = await previewAssistantAction(client, "u1", req("prepare_nudge", [A], { actorId: ACTOR }));
  assert.equal(preview.token, null);
  assert.equal(preview.targets[0].state, "rejected");
});

test("model suggestions keep only whitelisted types and ids present in the facts", () => {
  const facts = { things: [{ id: A, assignee_actor_id: ACTOR }], people: [], nudge_recommendations: [] };
  const out = sanitizeSuggestedActions(
    [
      { type: "set_status", target_ids: [A], params: { status: "under_progress" } },
      { type: "set_status", target_ids: [B], params: { status: "under_progress" } },
      { type: "set_status", target_ids: [A], params: { status: "sorted" } },
      { type: "delete_thing", target_ids: [A] },
      { type: "assign_person", target_ids: [A], params: { assignee_actor_id: B } },
    ],
    facts,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].requires_confirmation, true);
});

test("status changes are rejected up front for uncaught Things and non-assignees", async () => {
  const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const uncaught = await previewAssistantAction(fake({ things: [row(A, { acknowledgement: "waiting_for_catch" })] }), "u1", req("set_status", [A], { status: "under_progress" }));
  assert.equal(uncaught.token, null);
  assert.equal(uncaught.targets[0].message, "Catch this Thing first.");
  const notMine = await previewAssistantAction(fake({ things: [row(A, { current_assignee_actor_id: other })] }), "u1", req("set_status", [A], { status: "under_progress" }));
  assert.equal(notMine.token, null);
  assert.match(notMine.targets[0].message, /current assignee/);
});
