import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VOICE_LIMITS, acquireVoiceSlot, encodeAudioFrame, markDone, markSpeaking, mayDeliver, newVoiceSession,
  onAudioFrame, onClientControl, onTranscriptFinal, parseBinaryFrame, releaseVoiceSlot, validateStart,
} from "../server/lib/assistant-voice-protocol.ts";

const pcm = (n = 3200) => new Uint8Array(n);
const mkId = (() => { let i = 0; return () => `turn-${++i}`; })();
const fresh = () => newVoiceSession("s1", "u1", 0);
const kinds = (r) => r.effects.map((e) => e.kind);
const errorCode = (r) => r.effects.find((e) => e.kind === "send" && e.message.type === "error")?.message.code;

test("start validation: version, codec, sample rate, token, context", () => {
  const ok = { type: "start", v: 1, codec: "pcm_s16le", sampleRate: 16000, context: "work", token: "x".repeat(40) };
  assert.equal(validateStart(ok).ok, true);
  assert.equal(validateStart({ ...ok, v: 2 }).code, "unsupported_version");
  assert.equal(validateStart({ ...ok, codec: "opus" }).code, "unsupported_codec");
  assert.equal(validateStart({ ...ok, sampleRate: 48000 }).code, "unsupported_codec");
  assert.equal(validateStart({ ...ok, token: "" }).code, "unauthenticated");
  assert.equal(validateStart({ ...ok, context: "x" }).code, "bad_message");
  assert.equal(validateStart(null).code, "bad_message");
  // The client cannot supply a provider key or a user id: neither is part of the message shape.
  assert.ok(!("userId" in validateStart(ok).msg) && !("apiKey" in validateStart(ok).msg));
});

test("binary frames: oversized, odd-length, truncated and wrong type are rejected", () => {
  assert.equal(parseBinaryFrame(encodeAudioFrame(0, pcm(VOICE_LIMITS.maxFrameBytes))).turnIndex, 0);
  assert.equal(parseBinaryFrame(encodeAudioFrame(0, pcm(VOICE_LIMITS.maxFrameBytes + 2))).error, "frame_too_large");
  assert.equal(parseBinaryFrame(encodeAudioFrame(0, pcm(3))).error, "bad_message");
  assert.equal(parseBinaryFrame(new Uint8Array([1, 0])).error, "bad_message");
  const wrong = encodeAudioFrame(0, pcm()); wrong[0] = 9;
  assert.equal(parseBinaryFrame(wrong).error, "bad_message");
});

test("an oversized frame closes the session and nothing reaches a provider", () => {
  const r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm(VOICE_LIMITS.maxFrameBytes + 2)), 10, mkId);
  assert.equal(errorCode(r), "frame_too_large");
  assert.ok(kinds(r).includes("close"));
  assert.ok(!kinds(r).includes("forward_audio"));
  assert.equal(r.session.phase, "closed");
});

test("first audio opens a turn, later frames of the same utterance only forward", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  assert.deepEqual(kinds(r), ["open_turn", "send", "forward_audio"]);
  const turnId = r.session.turn.id;
  r = onAudioFrame(r.session, encodeAudioFrame(0, pcm()), 60, mkId);
  assert.deepEqual(kinds(r), ["forward_audio"]);
  assert.equal(r.session.turn.id, turnId);
  r = onAudioFrame(r.session, encodeAudioFrame(5, pcm()), 100, mkId);
  assert.equal(errorCode(r), "stale_turn", "audio for a different turn index while listening is out of order");
});

test("late audio for an older or finished utterance is dropped", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(3, pcm()), 10, mkId);
  const id = r.session.turn.id;
  r = onClientControl(r.session, { type: "speech_end", sessionId: "s1", turnId: id });
  assert.deepEqual(kinds(r), ["finalize_stt", "send"]);
  const late = onAudioFrame(r.session, encodeAudioFrame(3, pcm()), 200, mkId);
  assert.deepEqual(late.effects, []);
  const older = onAudioFrame(r.session, encodeAudioFrame(2, pcm()), 210, mkId);
  assert.deepEqual(older.effects, []);
});

test("barge-in: a newer utterance cancels in-flight work, never a committed action", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const first = r.session.turn.id;
  r = onClientControl(r.session, { type: "speech_end", sessionId: "s1", turnId: first });
  r = { session: markSpeaking({ ...r.session, turn: { ...r.session.turn, status: "checking", finalSeen: true } }, first), effects: [] };
  assert.equal(r.session.turn.status, "speaking");
  const next = onAudioFrame(r.session, encodeAudioFrame(1, pcm()), 500, mkId);
  assert.deepEqual(kinds(next), ["cancel_turn", "open_turn", "send", "forward_audio"]);
  assert.equal(next.effects[0].turnId, first);
  assert.equal(mayDeliver(next.session, first), false, "no audio or events for the interrupted turn");
});

test("duplicate final transcripts run exactly one turn; finals for other turns are ignored", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const id = r.session.turn.id;
  r = onClientControl(r.session, { type: "speech_end", sessionId: "s1", turnId: id });
  const a = onTranscriptFinal(r.session, id, "  whats up today ");
  assert.equal(a.runTurn, "whats up today");
  const b = onTranscriptFinal(a.session, id, "whats up today");
  assert.equal(b.runTurn, null);
  assert.equal(onTranscriptFinal(a.session, "other", "x").runTurn, null);
  assert.equal(onTranscriptFinal(r.session, id, "   ").runTurn, null, "no-speech final starts nothing");
});

test("transcripts are bounded", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const out = onTranscriptFinal(r.session, r.session.turn.id, "a".repeat(5000));
  assert.equal(out.runTurn.length, VOICE_LIMITS.maxTranscriptChars);
});

test("interrupt stops delivery; interrupt after terminal state is a no-op", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const id = r.session.turn.id;
  const stop = onClientControl(r.session, { type: "interrupt", sessionId: "s1", turnId: id });
  assert.ok(kinds(stop).includes("cancel_turn"));
  assert.equal(mayDeliver(stop.session, id), false);
  assert.deepEqual(onClientControl(stop.session, { type: "interrupt", sessionId: "s1", turnId: id }).effects, []);
  const done = markDone(r.session, id);
  assert.deepEqual(onClientControl(done, { type: "interrupt", sessionId: "s1", turnId: id }).effects, []);
  // A stale turn id on interrupt does not cancel the current turn.
  assert.deepEqual(onClientControl(r.session, { type: "interrupt", sessionId: "s1", turnId: "old" }).effects, []);
});

test("messages for an earlier session are rejected (old-session confirmations)", () => {
  const r = onClientControl(fresh(), { type: "speech_end", sessionId: "OLD", turnId: "t" });
  assert.equal(errorCode(r), "stale_session");
  assert.equal(errorCode(onClientControl(fresh(), { type: "interrupt", sessionId: "OLD" })), "stale_session");
  assert.equal(errorCode(onClientControl(fresh(), { type: "stop", sessionId: "OLD" })), "stale_session");
});

test("stop closes the session and cancels live work", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const stop = onClientControl(r.session, { type: "stop", sessionId: "s1" });
  assert.deepEqual(kinds(stop), ["cancel_turn", "close"]);
  assert.equal(stop.session.phase, "closed");
  assert.deepEqual(onAudioFrame(stop.session, encodeAudioFrame(1, pcm()), 20, mkId).effects, []);
});

test("rate, duration and byte limits close the session", () => {
  let s = fresh();
  let last;
  for (let i = 0; i <= VOICE_LIMITS.maxFramesPerSecond; i += 1) { last = onAudioFrame(s, encodeAudioFrame(0, pcm()), 5, mkId); s = last.session; }
  assert.equal(errorCode(last), "rate_limited");
  const expired = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), VOICE_LIMITS.maxSessionMs + 1, mkId);
  assert.equal(errorCode(expired), "session_expired");
  let t = fresh(); let r; let now = 0;
  for (let i = 0; i < 600 && t.phase === "open"; i += 1) { now += 100; r = onAudioFrame(t, encodeAudioFrame(0, pcm(VOICE_LIMITS.maxFrameBytes)), now, mkId); t = r.session; }
  assert.equal(errorCode(r), "session_expired");
});

test("a turn longer than the limit is cancelled with an honest error", () => {
  let r = onAudioFrame(fresh(), encodeAudioFrame(0, pcm()), 10, mkId);
  const late = onAudioFrame(r.session, encodeAudioFrame(0, pcm()), 10 + VOICE_LIMITS.maxTurnMs + 1, mkId);
  assert.ok(kinds(late).includes("cancel_turn"));
  assert.equal(errorCode(late), "turn_too_long");
});

test("concurrent sessions per user are bounded and released", () => {
  assert.equal(acquireVoiceSlot("limit-user"), true);
  assert.equal(acquireVoiceSlot("limit-user"), true);
  assert.equal(acquireVoiceSlot("limit-user"), false);
  releaseVoiceSlot("limit-user");
  assert.equal(acquireVoiceSlot("limit-user"), true);
  releaseVoiceSlot("limit-user"); releaseVoiceSlot("limit-user");
});
