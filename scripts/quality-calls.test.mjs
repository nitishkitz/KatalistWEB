import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dialog = readFileSync(new URL("../src/features/calls/StartCallDialog.tsx", import.meta.url), "utf8");
const room = readFileSync(new URL("../src/features/calls/call-room.ts", import.meta.url), "utf8");
const ring = readFileSync(new URL("../src/features/calls/CallRingProvider.tsx", import.meta.url), "utf8");

test("call picker has one semantic checkbox handler and no nested row button", () => {
  assert.doesNotMatch(dialog, /<button[\s\S]*?onClick=\{\(\) => toggle\(p\.id\)\}[\s\S]*?<\/button>/);
  assert.match(dialog, /<label htmlFor=\{checkboxId\}/);
  assert.match(dialog, /onCheckedChange=\{\(nextChecked\) =>/);
  assert.match(dialog, /if \(nextChecked === true\) next\.add\(p\.id\);/);
  assert.match(dialog, /else next\.delete\(p\.id\);/);
});

test("peer state is session-bound when a slot exists and pending state is session-bound before presence", () => {
  assert.match(room, /private readonly pendingState = new Map<string, \{ sessionId\?: string; state: Partial<PeerState> \}>\(\)/);
  assert.match(room, /if \(msg\.sessionId && slot\.sessionId && msg\.sessionId !== slot\.sessionId\) return;/);
  assert.match(room, /pendingState\.set\(msg\.from, \{ sessionId: msg\.sessionId, state: msg\.state \}\)/);
  assert.match(room, /pending\.sessionId === p\.sessionId/);
  assert.match(room, /this\.pendingState\.delete\(p\.id\);/);
});

test("the ring options affordance truthfully describes its dismissal action", () => {
  assert.match(ring, /aria-label="Dismiss incoming call" title="Dismiss incoming call"/);
  assert.doesNotMatch(ring, /aria-label="More call options"/);
});
