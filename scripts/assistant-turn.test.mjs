import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeCoeyEvent,
  encodeCoeyEvent,
  makeTimer,
  makeTurnEmitter,
  makeTurnId,
} from "../server/lib/assistant-turn.ts";
import { applyCoeyEvent, initialTurnState, startTurn } from "../src/features/court/assistant/turn-state.ts";

const answer = { intent: "scope_summary", answer_markdown: "ok", actions: [], citations: [] };
const run = (events, state = initialTurnState) => events.reduce(applyCoeyEvent, state);

test("turn ids are unique UUIDs and frames round-trip", () => {
  assert.notEqual(makeTurnId(), makeTurnId());
  const emit = makeTurnEmitter("t1");
  const frame = encodeCoeyEvent(emit.next({ type: "accepted" }));
  assert.match(frame, /^event: accepted\ndata: \{.*\}\n\n$/);
  const data = frame.split("\n")[1].slice(6);
  assert.deepEqual(decodeCoeyEvent(data), { type: "accepted", turnId: "t1", seq: 1 });
  assert.equal(decodeCoeyEvent("{not json"), null);
  assert.equal(decodeCoeyEvent('{"type":"x"}'), null);
});

test("emitter sequence numbers increase", () => {
  const emit = makeTurnEmitter("t");
  assert.deepEqual([emit.next({ type: "accepted" }).seq, emit.next({ type: "completed" }).seq], [1, 2]);
});

test("ordered events build one stable answer", () => {
  const e = makeTurnEmitter("t1");
  const state = run([
    e.next({ type: "accepted" }),
    e.next({ type: "status", stage: "reading_facts", text: "Checking your Court" }),
    e.next({ type: "text_delta", text: "Hel" }),
    e.next({ type: "text_delta", text: "lo" }),
  ]);
  assert.equal(state.status.stage, "reading_facts");
  assert.equal(state.draft, "Hello");
  const done = run([e.next({ type: "answer", answer }), e.next({ type: "completed" })], state);
  assert.equal(done.answer.answer_markdown, "ok");
  assert.equal(done.draft, "");
  assert.equal(done.status, null);
  assert.equal(done.terminal, "completed");
});

test("duplicate and out-of-order events are ignored", () => {
  const e = makeTurnEmitter("t1");
  const accepted = e.next({ type: "accepted" });
  const d1 = e.next({ type: "text_delta", text: "a" });
  const d2 = e.next({ type: "text_delta", text: "b" });
  const state = run([accepted, d2, d1, d2]);
  assert.equal(state.draft, "b");
});

test("late events from a prior turn never touch the current turn", () => {
  const old = makeTurnEmitter("old");
  const cur = makeTurnEmitter("cur");
  let state = run([cur.next({ type: "accepted" })]);
  state = run([old.next({ type: "accepted" }), old.next({ type: "answer", answer: { ...answer, answer_markdown: "STALE" } })], state);
  assert.equal(state.answer, null);
  state = run([cur.next({ type: "answer", answer })], state);
  assert.equal(state.answer.answer_markdown, "ok");
});

test("events before accepted do not bind a turn", () => {
  const e = makeTurnEmitter("t1");
  assert.equal(run([e.next({ type: "answer", answer })]).answer, null);
});

test("nothing is applied after a terminal event", () => {
  const e = makeTurnEmitter("t1");
  const state = run([
    e.next({ type: "accepted" }),
    e.next({ type: "error", code: "x", message: "boom" }),
    e.next({ type: "completed" }),
    e.next({ type: "answer", answer }),
  ]);
  assert.equal(state.terminal, "error");
  assert.equal(state.error.message, "boom");
  assert.equal(state.answer, null);
});

test("action proposals count only after the authoritative answer", () => {
  const e = makeTurnEmitter("t1");
  const action = { id: "a1", type: "open_thing", label: "Open", requires_confirmation: false, target_ids: ["x"] };
  const early = run([e.next({ type: "accepted" }), e.next({ type: "action_proposed", action })]);
  assert.deepEqual(early.proposedActionIds, []);
  const late = run([e.next({ type: "answer", answer }), e.next({ type: "action_proposed", action })], early);
  assert.deepEqual(late.proposedActionIds, ["a1"]);
});

test("startTurn resets all state", () => {
  const e = makeTurnEmitter("t1");
  const used = run([e.next({ type: "accepted" }), e.next({ type: "answer", answer }), e.next({ type: "completed" })]);
  assert.deepEqual(startTurn(), initialTurnState);
  assert.notEqual(used.turnId, startTurn().turnId);
});

test("timer records durations without content", () => {
  let t = 0;
  const timer = makeTimer(() => t);
  t = 5; timer.mark("authMs");
  t = 25; timer.mark("factsMs");
  t = 100;
  assert.deepEqual(timer.finish(), { authMs: 5, factsMs: 20, totalMs: 100 });
});
