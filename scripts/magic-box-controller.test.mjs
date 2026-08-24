import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTossGuard,
  emptySubmission,
  reduceSubmission,
  runTossPipeline,
  submissionBlocksCreate,
} from "@/features/court/magic-box/submission";
import { emptyMagicBoxState, selectDraft } from "@/features/court/magic-box/reducer";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-08-26T04:30:00.000Z");
const ctx = { now: NOW, timeZone: TZ, people: [], context: "work" };

function snapshot(text = "Buy printer paper") {
  const state = emptyMagicBoxState();
  state.rawText = text;
  state.caret = text.length;
  return selectDraft(state, ctx);
}

test("submission: idle -> creating-thing -> finalizing-attachments -> idle", () => {
  let state = emptySubmission();
  const snap = snapshot();
  state = reduceSubmission(state, { type: "BEGIN_CREATE", snapshot: snap });
  assert.equal(state.phase, "creating-thing");
  assert.equal(submissionBlocksCreate(state), true);
  state = reduceSubmission(state, { type: "CREATE_SUCCEEDED", thingId: "thing-1" });
  assert.equal(state.phase, "finalizing-attachments");
  assert.equal(state.createdThingId, "thing-1");
  state = reduceSubmission(state, { type: "ATTACHMENTS_SUCCEEDED" });
  assert.equal(state.phase, "idle");
  assert.equal(state.createdThingId, null);
});

test("submission: idle -> creating-thing -> idle on create failure", () => {
  const snap = snapshot();
  let state = reduceSubmission(emptySubmission(), { type: "BEGIN_CREATE", snapshot: snap });
  state = reduceSubmission(state, { type: "CREATE_FAILED" });
  assert.equal(state.phase, "idle");
  assert.equal(state.snapshot, null);
});

test("submission: creating-thing -> creating-thing second Toss ignored", () => {
  const guard = createTossGuard();
  assert.equal(guard.tryBegin(snapshot()), true);
  assert.equal(guard.tryBegin(snapshot("second")), false);
  assert.equal(guard.getState().phase, "creating-thing");
  assert.equal(guard.getState().snapshot.derivedTitle, "Buy printer paper");
});

test("submission: finalizing-attachments -> attachment-recovery on partial failure", () => {
  let state = reduceSubmission(emptySubmission(), { type: "BEGIN_CREATE", snapshot: snapshot() });
  state = reduceSubmission(state, { type: "CREATE_SUCCEEDED", thingId: "thing-1" });
  state = reduceSubmission(state, { type: "ATTACHMENTS_PARTIAL" });
  assert.equal(state.phase, "attachment-recovery");
  assert.equal(state.createdThingId, "thing-1");
  state = reduceSubmission(state, { type: "RECOVERY_CLEARED" });
  assert.equal(state.phase, "idle");
});

test("MB-016 Double Toss: two immediate toss() calls create exactly one Thing", async () => {
  const guard = createTossGuard();
  const snap = snapshot();
  let calls = 0;
  let resolveCreate;
  const createThing = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveCreate = resolve;
    });
  };
  const finalize = async () => ({ failedClientIds: [] });
  const first = runTossPipeline({ guard, snapshot: snap, createThing, finalize });
  const second = runTossPipeline({ guard, snapshot: snap, createThing, finalize });
  assert.equal(calls, 1);
  resolveCreate({ id: "thing-only" });
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((r) => r.status).sort(),
    ["ignored", "ok"],
  );
  assert.equal(results.find((r) => r.status === "ok").thingId, "thing-only");
});

test("create failure retains the submitted snapshot and does not finalize", async () => {
  const guard = createTossGuard();
  const snap = snapshot("Keep this draft");
  const result = await runTossPipeline({
    guard,
    snapshot: snap,
    createThing: async () => {
      throw new Error("backend");
    },
    finalize: async () => {
      throw new Error("should not finalize");
    },
  });
  assert.equal(result.status, "create-failed");
  assert.equal(guard.getState().phase, "idle");
});

test("partial finalize never re-enters create", async () => {
  const guard = createTossGuard();
  const snap = snapshot();
  const result = await runTossPipeline({
    guard,
    snapshot: snap,
    createThing: async () => ({ id: "thing-1" }),
    finalize: async () => ({ failedClientIds: ["c1"] }),
  });
  assert.equal(result.status, "recovery");
  assert.equal(guard.getState().phase, "attachment-recovery");
  assert.equal(guard.tryBegin(snap), false);
});

test("unexpected finalizer exception retains actionable client IDs and never uses unknown", async () => {
  const guard = createTossGuard();
  const file = { name: "brief.pdf", type: "application/pdf", size: 12 };
  const snap = snapshot();
  snap.attachments = [{ clientId: "c-real", file, status: "ready", stagingKey: "staging/u/c-real/brief.pdf" }];
  const result = await runTossPipeline({
    guard,
    snapshot: snap,
    createThing: async () => ({ id: "thing-1" }),
    finalize: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.status, "recovery");
  assert.deepEqual(result.failedClientIds, ["c-real"]);
  assert.equal(result.failedClientIds.includes("unknown"), false);
  assert.equal(guard.tryBegin(snap), false);
});
