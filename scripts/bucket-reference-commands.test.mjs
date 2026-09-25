import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

let addCalls = [];
let removeCalls = [];
let addGate = null;

mock.module("@/features/things/rpc", {
  namedExports: {
    rpcAddToBucket: async (...args) => {
      addCalls.push(args);
      if (addGate) await addGate;
    },
    rpcRemoveFromBucket: async (...args) => { removeCalls.push(args); },
  },
});
mock.module("@/features/realtime/identity-cache-policy", {
  namedExports: {
    getIdentityEpoch: () => ({ epoch: 3 }),
    isEpochCurrent: (_qc, epoch) => epoch === 3,
  },
});

const { parseThingDropPayload, runBucketReferenceCommand } = await import(
  "@/features/buckets/bucket-reference-commands"
);

test("drop payload validation rejects malformed or missing Thing IDs", () => {
  assert.equal(parseThingDropPayload("not json"), null);
  assert.equal(parseThingDropPayload(JSON.stringify({ title: "No id" })), null);
  assert.deepEqual(parseThingDropPayload(JSON.stringify({ thingId: "t1", title: "A" })), {
    thingId: "t1",
    title: "A",
  });
});

test("the same Bucket/source operation is synchronously deduplicated while independent sources proceed", async () => {
  addCalls = [];
  let release;
  addGate = new Promise((resolve) => { release = resolve; });
  const qc = new QueryClient();
  const first = runBucketReferenceCommand(qc, "add", "b1", { thingId: "t1" });
  const duplicate = await runBucketReferenceCommand(qc, "add", "b1", { thingId: "t1" });
  const independent = runBucketReferenceCommand(qc, "add", "b1", { thingId: "t2" });

  assert.equal(duplicate, "already-in-flight");
  assert.deepEqual(addCalls, [["b1", "t1", undefined], ["b1", "t2", undefined]]);
  release();
  addGate = null;
  assert.equal(await first, "performed");
  assert.equal(await independent, "performed");
  qc.clear();
});

test("remove uses the same command contract and never deletes the source object", async () => {
  removeCalls = [];
  const qc = new QueryClient();
  assert.equal(await runBucketReferenceCommand(qc, "remove", "b1", { listId: "l1" }), "performed");
  assert.deepEqual(removeCalls, [["b1", undefined, "l1"]]);
  qc.clear();
});
