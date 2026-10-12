import assert from "node:assert/strict";
import { test } from "node:test";
import { createVoiceBridge, speechTextFromAnswer } from "../server/lib/assistant-voice-bridge.ts";
import { AUDIO_CHUNK, encodeAudioFrame } from "../server/lib/assistant-voice-protocol.ts";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const START = { type: "start", v: 1, codec: "pcm_s16le", sampleRate: 16000, context: "work", token: "t".repeat(40) };
const pcm = () => encodeAudioFrame(0, new Uint8Array(3200).fill(7));
const answerEvent = (turnId, seq, text = "Today: 1 overdue.") => ({
  turnId, seq, type: "answer",
  answer: { intent: "attention_items", answer_markdown: `**${text}**`, citations: [], actions: [], freshness: { timezone: "UTC", is_partial: false } },
  facts: { scope: null, things: [], nudge_recommendations: [] },
});

let userCounter = 0;
function harness(overrides = {}, userId = `user-${++userCounter}`) {
  const out = { text: [], binary: [], closed: null, logs: [], sttOpened: [], sttCalls: [], ttsRequests: [], turns: [] };
  let sttHandlers;
  let id = 0;
  const transport = { sendText: (m) => out.text.push(JSON.parse(m)), sendBinary: (b) => out.binary.push(b), close: (c, r) => (out.closed = { c, r }) };
  const mkStt = () => ({
    open: true,
    isOpen() { return this.open; },
    startUtterance() { out.sttCalls.push("start"); },
    send(b) { out.sttCalls.push(`audio:${b.length}`); },
    endUtterance() { out.sttCalls.push("end"); },
    cancelUtterance() { out.sttCalls.push("cancel"); },
    close() { this.open = false; out.sttCalls.push("close"); },
  });
  const deps = {
    authenticate: async (token) => (token === START.token ? { userId, client: {} } : null),
    openStt: async (language, handlers) => { out.sttOpened.push(language); sttHandlers = handlers; const c = mkStt(); out.sttConn = c; return c; },
    synthesize: async (req) => {
      out.ttsRequests.push(req.text);
      for (const part of [1, 2, 3]) { await tick(2); if (req.signal.aborted) return; req.onChunk(new Uint8Array([part, part])); }
    },
    ttsCodec: "pcm_s16le;rate=24000",
    runTurn: async (input, userId, _client, turnId, send) => {
      out.turns.push({ input, userId });
      send({ turnId, seq: 1, type: "accepted" });
      send(answerEvent(turnId, 2));
      send({ turnId, seq: 3, type: "completed" });
    },
    now: () => Date.now(),
    makeId: () => `id-${++id}`,
    log: (e) => out.logs.push(e),
    ...overrides,
  };
  const bridge = createVoiceBridge(transport, deps);
  return { bridge, out, handlers: () => sttHandlers };
}
const start = async (h, msg = START) => { await h.bridge.onText(JSON.stringify(msg)); await tick(); };
const speakAudio = async (h) => { h.bridge.onBinary(pcm()); await tick(); };
const stateOf = (h) => h.out.text.filter((m) => m.type === "voice_state").map((m) => m.state);

test("start authenticates, acks a session and warms the provider; bad token closes", async () => {
  const h = harness();
  await start(h);
  assert.equal(h.out.text[0].type, "ack");
  assert.deepEqual(h.out.sttOpened, ["en-IN"]);
  const bad = harness();
  await start(bad, { ...START, token: "x".repeat(40) });
  assert.equal(bad.out.text[0].code, "unauthenticated");
  assert.equal(bad.out.closed.c, 1008);
  assert.deepEqual(bad.out.sttOpened, [], "no provider connection for an unauthenticated peer");
});

test("audio before start is rejected and nothing reaches a provider", async () => {
  const h = harness();
  h.bridge.onBinary(pcm());
  assert.equal(h.out.text[0].code, "bad_message");
  assert.deepEqual(h.out.sttCalls, []);
});

test("language is an allowlist; bilingual hi-IN and auto pass, anything else falls back", async () => {
  for (const [lang, expected] of [["hi-IN", "hi-IN"], ["auto", "auto"], ["fr-FR", "en-IN"], [undefined, "en-IN"]]) {
    const h = harness();
    await start(h, { ...START, language: lang });
    assert.deepEqual(h.out.sttOpened, [expected]);
  }
});

test("partial transcripts are captions only; only the final starts one turn, then speech plays in order", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  assert.deepEqual(h.out.sttCalls.slice(0, 2), ["start", "audio:3200"]);
  h.handlers().onPartial("whats up");
  h.handlers().onPartial("whats up today");
  assert.equal(h.out.turns.length, 0, "partials never start a turn");
  const turnId = h.bridge.state.turn.id;
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId: h.bridge.state.sessionId, turnId }));
  assert.ok(h.out.sttCalls.includes("end"));
  h.handlers().onFinal("whats up today");
  h.handlers().onFinal("whats up today"); // duplicate
  await tick(40);
  assert.equal(h.out.turns.length, 1);
  assert.equal(h.out.turns[0].input.question, "whats up today");
  assert.ok(h.out.turns[0].userId.startsWith("user-"));
  const types = h.out.text.map((m) => m.type);
  assert.ok(types.indexOf("transcript_partial") < types.indexOf("transcript_final"));
  assert.equal(types.filter((t) => t === "transcript_final").length, 1);
  assert.deepEqual(stateOf(h), ["listening", "transcribing", "checking", "speaking", "idle"]);
  assert.equal(h.out.ttsRequests[0], "Today: 1 overdue.", "spoken words equal the displayed answer without markdown");
  assert.deepEqual(h.out.binary.map((b) => [b[0], b[5]]), [[AUDIO_CHUNK, 1], [AUDIO_CHUNK, 2], [AUDIO_CHUNK, 3]]);
  const metas = h.out.text.filter((m) => m.type === "audio_chunk_meta");
  assert.deepEqual(metas.map((m) => [m.hasAudio, m.last]), [[true, false], [true, false], [true, false], [false, true]]);
  const events = h.out.text.filter((m) => m.type === "coey_event").map((m) => m.event.type);
  assert.deepEqual(events, ["accepted", "answer", "completed"]);
});

test("interrupt during speech stops audio: nothing is delivered after it", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  const sessionId = h.bridge.state.sessionId, turnId = h.bridge.state.turn.id;
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId, turnId }));
  h.handlers().onFinal("what is overdue");
  await tick(3); // first chunk is in flight
  await h.bridge.onText(JSON.stringify({ type: "interrupt", sessionId, turnId }));
  const delivered = h.out.binary.length;
  await tick(30);
  assert.equal(h.out.binary.length, delivered, "no audio after interrupt");
  assert.ok(!h.out.text.some((m) => m.type === "audio_chunk_meta" && m.last), "no completion marker for an interrupted turn");
  assert.equal(stateOf(h).at(-1), "idle");
});

test("a new utterance supersedes the old turn: its events and audio are dropped", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({
    runTurn: async (_i, _u, _c, turnId, send) => { send({ turnId, seq: 1, type: "accepted" }); await gate; send(answerEvent(turnId, 2, "OLD ANSWER")); },
  });
  await start(h);
  await speakAudio(h);
  const sessionId = h.bridge.state.sessionId, first = h.bridge.state.turn.id;
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId, turnId: first }));
  h.handlers().onFinal("first question");
  await tick();
  h.bridge.onBinary(encodeAudioFrame(1, new Uint8Array(3200))); // barge-in
  await tick();
  release();
  await tick(30);
  assert.ok(!JSON.stringify(h.out.text).includes("OLD ANSWER"));
  assert.equal(h.out.ttsRequests.length, 0);
  assert.notEqual(h.bridge.state.turn.id, first);
});

test("no-speech: an empty final starts no turn and returns to idle", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId: h.bridge.state.sessionId, turnId: h.bridge.state.turn.id }));
  h.handlers().onFinal("   ");
  await tick();
  assert.equal(h.out.turns.length, 0);
  assert.equal(stateOf(h).at(-1), "idle");
});

test("provider close mid-utterance reports an error; the next utterance reconnects", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  h.out.sttConn.open = false;
  h.handlers().onClose("code 1006");
  assert.equal(h.out.text.at(-1).code, "provider_unavailable");
  assert.ok(stateOf(h).includes("error"));
  h.bridge.onBinary(encodeAudioFrame(1, new Uint8Array(3200)));
  await tick();
  assert.equal(h.out.sttOpened.length, 2, "provider reopened for the next utterance");
  assert.ok(h.out.sttCalls.includes("start"));
});

test("STT unavailable at utterance start is reported without crashing; typed Ask is unaffected", async () => {
  let attempts = 0;
  const h = harness({ openStt: async () => { attempts += 1; if (attempts > 1) throw new Error("down"); return { isOpen: () => false, startUtterance() {}, send() {}, endUtterance() {}, cancelUtterance() {}, close() {} }; } });
  await start(h);
  await speakAudio(h);
  assert.equal(h.out.text.find((m) => m.type === "error").code, "provider_unavailable");
  assert.equal(h.out.closed, null, "the socket stays up so the user can retry");
});

test("TTS failure keeps the text answer and reports it honestly", async () => {
  const h = harness({ synthesize: async () => { throw new Error("tts down"); } });
  await start(h);
  await speakAudio(h);
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId: h.bridge.state.sessionId, turnId: h.bridge.state.turn.id }));
  h.handlers().onFinal("hi");
  await tick(30);
  assert.ok(h.out.text.some((m) => m.type === "coey_event" && m.event.type === "answer"));
  assert.equal(h.out.text.find((m) => m.type === "error").code, "provider_unavailable");
});

test("speak reads a bounded readback and stop releases everything", async () => {
  const h = harness();
  await start(h);
  const sessionId = h.bridge.state.sessionId;
  await h.bridge.onText(JSON.stringify({ type: "speak", sessionId, text: "Send 2 nudges to Ajju?" }));
  await tick(30);
  assert.equal(h.out.ttsRequests[0], "Send 2 nudges to Ajju?");
  await h.bridge.onText(JSON.stringify({ type: "speak", sessionId: "OLD", text: "x" }));
  assert.equal(h.out.text.at(-1).code, "stale_session");
  await h.bridge.onText(JSON.stringify({ type: "stop", sessionId }));
  assert.equal(h.out.closed.c, 1000);
  assert.ok(h.out.sttCalls.includes("close"));
});

test("closing the socket cancels in-flight turns and frees the per-user slot", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  h.bridge.close();
  assert.ok(h.out.sttCalls.includes("close"));
  const again = harness({}, "slot-user");
  await start(again);
  const third = harness({}, "slot-user");
  await start(third);
  const fourth = harness({}, "slot-user");
  await start(fourth);
  assert.equal(fourth.out.text[0].code, "session_limit", "two live sessions per user");
  again.bridge.close(); third.bridge.close();
});

test("speech ending during STT connection flushes buffered audio after connect", async () => {
  let release;
  let opens = 0;
  const gate = new Promise((resolve) => (release = resolve));
  const h = harness({
    openStt: async () => {
      opens += 1;
      await gate;
      return {
        isOpen: () => true,
        startUtterance: () => h.out.sttCalls.push("start"),
        send: (b) => h.out.sttCalls.push(`audio:${b.length}`),
        endUtterance: () => h.out.sttCalls.push("end"),
        cancelUtterance() {},
        close() {},
      };
    },
  });
  await start(h);
  h.bridge.onBinary(pcm());
  const { sessionId, turn } = h.bridge.state;
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId, turnId: turn.id }));
  release();
  await tick();
  assert.equal(opens, 1, "warmup and utterance share one provider connection");
  assert.deepEqual(h.out.sttCalls, ["start", "audio:3200", "end"]);
  h.bridge.close();
});

test("closing during authentication does not reserve a voice slot", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const userId = `slow-auth-${++userCounter}`;
  const h = harness({ authenticate: async () => { await gate; return { userId, client: {} }; } }, userId);
  const starting = h.bridge.onText(JSON.stringify(START));
  h.bridge.close();
  release();
  await starting;
  assert.equal(h.bridge.state, null);
  assert.deepEqual(h.out.sttOpened, []);
  const first = harness({}, userId), second = harness({}, userId), third = harness({}, userId);
  await start(first); await start(second); await start(third);
  assert.equal(third.out.text[0].code, "session_limit", "only the two active sessions hold slots");
  first.bridge.close(); second.bridge.close();
});

test("logs and wire messages never contain the key, token or raw audio", async () => {
  const h = harness();
  await start(h);
  await speakAudio(h);
  await h.bridge.onText(JSON.stringify({ type: "speech_end", sessionId: h.bridge.state.sessionId, turnId: h.bridge.state.turn.id }));
  h.handlers().onFinal("whats up today");
  await tick(40);
  const logs = JSON.stringify(h.out.logs);
  assert.ok(!logs.includes(START.token));
  assert.ok(!logs.includes("whats up today"), "no transcript in logs");
  assert.ok(!logs.includes("Today: 1 overdue"), "no answer text in logs");
  assert.ok(h.out.logs.some((l) => l.evt === "coey_voice_first_audio" && typeof l.ttsFirstChunkMs === "number"));
  assert.ok(!JSON.stringify(h.out.text).includes(START.token));
});

test("speech text drops markdown and is bounded", () => {
  const a = { answer_markdown: "**Ajju** has 2 Things.\n\nSecond line", notice: "Data only." };
  assert.equal(speechTextFromAnswer(a), "Ajju has 2 Things. Second line Data only.");
  assert.ok(speechTextFromAnswer({ answer_markdown: "x".repeat(2000) }).length <= 480);
});
