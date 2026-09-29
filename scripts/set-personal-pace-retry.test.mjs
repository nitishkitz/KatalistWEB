import assert from "node:assert/strict";
import { mock, test } from "node:test";

let responses = [];
let calls = [];

mock.module("@/lib/session-mode", {
  namedExports: { isPreviewMode: () => false },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return responses.shift();
      },
    },
  },
});

const { rpcSetPersonalPace } = await import("@/features/things/rpc");
const thingId = "00000000-0000-4000-8000-000000000001";

test("a transient transport error retries the idempotent pace write once", async () => {
  calls = [];
  responses = [
    { data: null, error: { message: "Failed to fetch" } },
    { data: { id: thingId }, error: null },
  ];
  await rpcSetPersonalPace(thingId, "now");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    name: "set_personal_pace",
    args: { p_thing_id: thingId, p_personal_pace: "now" },
  });
});

test("a domain error does not retry the pace write", async () => {
  calls = [];
  responses = [{ data: null, error: { message: "Catch the Thing before setting your pace" } }];
  await assert.rejects(rpcSetPersonalPace(thingId, "later"), (error) => {
    assert.equal(error.message, "Catch the Thing before setting your pace");
    return true;
  });
  assert.equal(calls.length, 1);
});
