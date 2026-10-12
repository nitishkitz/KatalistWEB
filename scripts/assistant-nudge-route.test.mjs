import assert from "node:assert/strict";
import { test, mock } from "node:test";
const actorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
let rows = [];
let calls = [];
let failedId;
const client = {
  from() {
    return {
      select() {
        return this;
      },
      in(_, selected) {
        rows = rows.filter((row) => selected.includes(row.id));
        return this;
      },
      async limit() {
        return { data: rows };
      },
    };
  },
  async rpc(_, args) {
    calls.push(args.p_thing_id);
    return args.p_thing_id === failedId
      ? { error: { message: "Cooldown active" } }
      : { data: { id: "nudge" } };
  },
};
mock.module("@tanstack/react-router", {
  namedExports: { createFileRoute: () => (config) => config },
});
mock.module("@/lib/assistant-route.server", {
  namedExports: {
    requireAssistantUser: async () => ({ client }),
    assistantJson: (body, status = 200) => Response.json(body, { status }),
  },
});
const { Route } = await import("../src/routes/api/assistant/nudge.ts");
function reset() {
  rows = ids.map((id) => ({
    id,
    title: id,
    current_assignee_actor_id: actorId,
    work_status: "not_started",
  }));
  calls = [];
  failedId = undefined;
}
function send(body) {
  return Route.server.handlers.POST({
    request: new Request("http://local/api/assistant/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}
test("API nudges only the explicit selection", async () => {
  reset();
  const response = await send({ actorId, thingIds: [ids[1]] });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [ids[1]]);
});
test("API rejects changed recipients before sending anything", async () => {
  reset();
  rows[1].current_assignee_actor_id = ids[0];
  const response = await send({ actorId, thingIds: ids });
  assert.equal(response.status, 409);
  assert.deepEqual(calls, []);
});
test("API preserves individual failures for the selection UI", async () => {
  reset();
  failedId = ids[1];
  const response = await send({ actorId, thingIds: ids });
  const body = await response.json();
  assert.equal(body.sent.length, 1);
  assert.equal(body.failed[0].thingId, ids[1]);
});
test("API rejects duplicate or oversized selections rather than silently dropping Things", async () => {
  reset();
  assert.equal((await send({ actorId, thingIds: [ids[0], ids[0]] })).status, 400);
  assert.equal((await send({ actorId, thingIds: Array(21).fill(ids[0]) })).status, 400);
  assert.deepEqual(calls, []);
});
