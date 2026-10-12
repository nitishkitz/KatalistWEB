import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretSpokenReply, readbackText, resultText } from "../src/features/court/assistant/voice-actions.ts";
import { isLocalReply } from "../server/lib/assistant-voice-protocol.ts";

const NOW = 1_000_000;
const proposal = { proposalId: "p1", sessionId: "s1", expiresAt: NOW + 60_000 };
const ctx = (over = {}) => ({ proposal, sessionId: "s1", now: NOW, openTargets: [], ...over });

test("yes and no act only on the visible, unexpired proposal of this session", () => {
  assert.deepEqual(interpretSpokenReply("Yes.", ctx()), { kind: "confirm", proposalId: "p1" });
  assert.deepEqual(interpretSpokenReply("yes please", ctx()), { kind: "confirm", proposalId: "p1" });
  assert.deepEqual(interpretSpokenReply("No", ctx()), { kind: "cancel", proposalId: "p1" });
  assert.deepEqual(interpretSpokenReply("never mind", ctx()), { kind: "cancel", proposalId: "p1" });
});

test("a generic yes with no visible proposal does nothing", () => {
  assert.deepEqual(interpretSpokenReply("yes", ctx({ proposal: null })), { kind: "no_proposal" });
});

test("yes after expiry or from an old session never confirms", () => {
  assert.deepEqual(interpretSpokenReply("yes", ctx({ now: NOW + 60_000 })), { kind: "expired", proposalId: "p1" });
  assert.deepEqual(interpretSpokenReply("yes", ctx({ sessionId: "s2" })), { kind: "stale_session" });
  assert.deepEqual(interpretSpokenReply("yes", ctx({ sessionId: null })), { kind: "stale_session" });
});

test("yes inside a longer sentence is not a confirmation", () => {
  for (const text of ["yes and also delete everything", "yes nudge Ajju", "I said yes to the other one"])
    assert.deepEqual(interpretSpokenReply(text, ctx()), { kind: "none" }, text);
});

test("open it needs exactly one visible target", () => {
  const one = [{ type: "thing", id: "T1" }];
  assert.deepEqual(interpretSpokenReply("open it", ctx({ proposal: null, openTargets: one })), { kind: "open", target: one[0] });
  assert.deepEqual(interpretSpokenReply("Open that!", ctx({ proposal: null, openTargets: one })), { kind: "open", target: one[0] });
  assert.deepEqual(interpretSpokenReply("open it", ctx({ proposal: null, openTargets: [] })), { kind: "none" });
  assert.deepEqual(interpretSpokenReply("open it", ctx({ proposal: null, openTargets: [...one, { type: "thing", id: "T2" }] })), { kind: "none" });
});

test("a requested write command is never interpreted locally", () => {
  assert.deepEqual(interpretSpokenReply("nudge Ajju about the line chart", ctx()), { kind: "none" });
  assert.deepEqual(interpretSpokenReply("mark it as in progress", ctx()), { kind: "none" });
});

test("readback comes from the server preview and names target and change", () => {
  const text = readbackText({
    action: { label: "Set status to In progress for 2 Things" },
    targets: [{ title: "Line chart", state: "ready" }, { title: "Pie chart", state: "ready" }, { title: "Skipped one", state: "rejected" }],
  });
  assert.match(text, /Set status to In progress/);
  assert.match(text, /Line chart, Pie chart/);
  assert.doesNotMatch(text, /Skipped one/);
  assert.match(text, /Say yes to confirm/);
  assert.match(readbackText({ action: { label: "X" }, targets: [{ title: "a", state: "rejected" }] }), /Nothing is ready/);
});

test("result wording follows server state: done, partial, failure, already", () => {
  assert.equal(resultText([{ title: "a", state: "applied" }]), "Done. 1 Thing updated.");
  assert.equal(resultText([{ title: "a", state: "applied" }, { title: "b", state: "failed" }]), "Done for 1, but 1 could not be changed.");
  assert.match(resultText([{ title: "a", state: "rejected" }]), /did not go through/);
  assert.equal(resultText([{ title: "a", state: "already_applied" }]), "Everything was already up to date.");
});

test("the bridge hands short replies back to the client only when the screen offers them", () => {
  assert.equal(isLocalReply("Yes", { awaitingConfirmation: true, openTarget: false }), true);
  assert.equal(isLocalReply("yes", { awaitingConfirmation: false, openTarget: false }), false, "no proposal on screen: a new question");
  assert.equal(isLocalReply("open it", { awaitingConfirmation: false, openTarget: true }), true);
  assert.equal(isLocalReply("open it", { awaitingConfirmation: true, openTarget: false }), false);
  assert.equal(isLocalReply("yes nudge Ajju", { awaitingConfirmation: true, openTarget: true }), false);
});
