import assert from "node:assert/strict";
import { test } from "node:test";
import { canStartVoice, canStopVoice, shouldTranscribeOnStop } from "@/features/court/magic-box/voice-session";

test("voice Cancel transcribes zero times even if onstop fires", () => {
  assert.equal(
    shouldTranscribeOnStop({ cancelled: true, unmounted: false, recordingId: 1, currentId: 1, empty: false }),
    false,
  );
});

test("voice Stop and the 30s cap transcribe when the recording is current", () => {
  assert.equal(
    shouldTranscribeOnStop({ cancelled: false, unmounted: false, recordingId: 2, currentId: 2, empty: false }),
    true,
  );
});

test("stale or empty or unmounted recordings do not transcribe", () => {
  assert.equal(shouldTranscribeOnStop({ cancelled: false, unmounted: true, recordingId: 1, currentId: 1, empty: false }), false);
  assert.equal(shouldTranscribeOnStop({ cancelled: false, unmounted: false, recordingId: 1, currentId: 2, empty: false }), false);
  assert.equal(shouldTranscribeOnStop({ cancelled: false, unmounted: false, recordingId: 1, currentId: 1, empty: true }), false);
});

test("start is only legal from idle/error; stop only while recording", () => {
  assert.equal(canStartVoice("idle"), true);
  assert.equal(canStartVoice("error"), true);
  assert.equal(canStartVoice("recording"), false);
  assert.equal(canStopVoice("recording"), true);
  assert.equal(canStopVoice("idle"), false);
});
