import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/integrations/supabase/client", { namedExports: { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "x".repeat(40) } } }) } } } });
mock.module("@/lib/authed-fetch", { namedExports: { authedFetch: async () => Response.json({ enabled: true }) } });
const { useCoeyVoice } = await import("../src/features/court/assistant/use-coey-voice.ts");
const { CoeyVoiceControls } = await import("../src/features/court/assistant/CoeyVoiceControls.tsx");
const { encodeAudioFrame } = await import("../server/lib/assistant-voice-protocol.ts");

function makeEnv(over = {}) {
  const env = {
    sockets: [], sent: [], micStops: 0, micBlock: null, closedCtx: 0, played: [], cleared: 0,
    supported: () => true,
    fetchEnabled: async () => true,
    getToken: async () => "x".repeat(40),
    now: () => Date.now(),
    openMic: async (onBlock) => { env.micBlock = onBlock; return { stop: () => { env.micStops += 1; } }; },
    createAudioContext: () => ({
      currentTime: 0, destination: {},
      createBuffer: (_c, length, rate) => ({ duration: length / rate, copyToChannel() {} }),
      createBufferSource: () => { const s = { buffer: null, onended: null, connect() {}, start() { env.played.push(1); }, stop() { env.cleared += 1; } }; return s; },
      resume: async () => {}, close: async () => { env.closedCtx += 1; },
    }),
    createSocket: (url) => {
      const socket = { url, readyState: 0, binaryType: "", sent: [], send(d) { socket.sent.push(d); }, close() { socket.readyState = 3; }, onopen: null, onmessage: null, onclose: null, onerror: null };
      env.sockets.push(socket);
      return socket;
    },
    ...over,
  };
  return env;
}
const open = async (env) => { await waitFor(() => assert.equal(env.sockets.length, 1)); const s = env.sockets[0]; s.readyState = 1; await act(async () => { s.onopen(); }); return s; };
const server = async (s, msg) => act(async () => { s.onmessage({ data: JSON.stringify(msg) }); });
const loud = () => new Float32Array(960).fill(0.2);
const quiet = () => new Float32Array(960);

function Harness({ env, actionReady = false, context = "work" }) {
  const voice = useCoeyVoice({ context, env });
  return h("div", null,
    h(CoeyVoiceControls, { voice, actionReady }),
    h("input", { "aria-label": "typed question" }),
  );
}
const mount = (env, props = {}) => render(h(Harness, { env, ...props }));
const phaseOf = (ui) => ui.getByTestId("coey-voice").getAttribute("data-voice-phase");

test("the mic remains discoverable when voice is off and explains why without capturing audio", async () => {
  const env = makeEnv({ fetchEnabled: async () => false });
  const off = mount(env);
  await act(async () => {});
  const unavailable = await off.findByRole("button", { name: /Voice unavailable/ });
  fireEvent.click(unavailable);
  assert.match(off.getByRole("note").textContent, /not available.*workspace/i);
  assert.equal(env.sockets.length, 0);
  assert.equal(env.micBlock, null, "availability help never requests a microphone");
  assert.equal(unavailable.getAttribute("aria-expanded"), "true");
  cleanup();
});

test("an unsupported browser keeps the mic visible with a clear explanation", async () => {
  const unsupported = mount(makeEnv({ supported: () => false }));
  fireEvent.click(await unsupported.findByRole("button", { name: /Voice unavailable/ }));
  assert.match(unsupported.getByRole("note").textContent, /not supported in this browser/);
  cleanup();
});

test("all eight visible states appear in order, with a persistent mic indicator and captions", async () => {
  const env = makeEnv();
  const ui = mount(env);
  await ui.findByTestId("coey-voice");
  assert.equal(phaseOf(ui), "idle");
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  await waitFor(() => assert.equal(phaseOf(ui), "connecting"));
  const socket = await open(env);
  assert.equal(JSON.parse(socket.sent[0]).type, "start");
  assert.equal(JSON.parse(socket.sent[0]).token.length, 40);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  assert.equal(phaseOf(ui), "listening");
  assert.ok(ui.getByTestId("coey-mic-indicator"), "indicator persists while active");
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "listening" });
  await server(socket, { type: "transcript_partial", sessionId: "s1", turnId: "t1", text: "whats up" });
  assert.match(ui.getByTestId("coey-caption").textContent, /You: whats up…/);
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "transcribing" });
  assert.equal(phaseOf(ui), "transcribing");
  await server(socket, { type: "transcript_final", sessionId: "s1", turnId: "t1", text: "whats up today" });
  assert.match(ui.getByTestId("coey-caption").textContent, /You: whats up today/);
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "checking" });
  assert.equal(phaseOf(ui), "checking");
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "speaking" });
  assert.equal(phaseOf(ui), "speaking");
  assert.ok(ui.getByRole("button", { name: "Stop speaking" }));
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "idle" });
  assert.equal(phaseOf(ui), "listening");
  ui.rerender(h(Harness, { env, actionReady: true }));
  assert.equal(phaseOf(ui), "action_ready");
  await server(socket, { type: "error", sessionId: "s1", code: "provider_unavailable", message: "Speech playback is unavailable." });
  assert.equal(phaseOf(ui), "error");
  assert.match(ui.getByRole("alert").textContent, /Speech playback is unavailable/);
  cleanup();
});

test("microphone denial shows a clear message, releases everything, and typing still works", async () => {
  const env = makeEnv({ openMic: async () => { throw new DOMException("denied", "NotAllowedError"); } });
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const alert = await ui.findByRole("alert");
  assert.match(alert.textContent, /Microphone access was blocked/);
  assert.equal(env.sockets.length, 0, "no socket is opened without a microphone");
  assert.equal(env.closedCtx, 1, "audio context released");
  fireEvent.change(ui.getByLabelText("typed question"), { target: { value: "hello" } });
  assert.equal(ui.getByLabelText("typed question").value, "hello");
  assert.ok(ui.getByRole("button", { name: /Talk to Coey/ }), "voice can be retried");
  cleanup();
});

test("device loss ends the session and frees mic, socket and audio", async () => {
  const env = makeEnv();
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const socket = await open(env);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  await act(async () => { env.micBlock(new Float32Array(0), -1); });
  assert.match((await ui.findByRole("alert")).textContent, /microphone was disconnected/);
  assert.equal(env.micStops, 1);
  assert.equal(socket.readyState, 3);
  assert.equal(env.closedCtx, 1);
  cleanup();
});

test("speech is chunked into 3200-byte frames after a real utterance; silence ends it; muted sends nothing", async () => {
  const env = makeEnv();
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const socket = await open(env);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  await act(async () => { for (let i = 0; i < 4; i += 1) env.micBlock(quiet(), 48000); });
  assert.equal(socket.sent.filter((d) => typeof d !== "string").length, 0, "silence is not streamed");
  await act(async () => { for (let i = 0; i < 10; i += 1) env.micBlock(loud(), 48000); });
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "listening" });
  const frames = socket.sent.filter((d) => typeof d !== "string");
  assert.ok(frames.length >= 2);
  for (const f of frames.slice(0, -1)) assert.equal(f.byteLength, 5 + 3200);
  assert.equal(new DataView(frames[0].buffer, frames[0].byteOffset).getUint8(0), 0x01);
  await act(async () => { for (let i = 0; i < 60; i += 1) env.micBlock(quiet(), 48000); });
  const end = socket.sent.filter((d) => typeof d === "string").map(JSON.parse).find((m) => m.type === "speech_end");
  assert.equal(end.turnId, "t1");
  // Mute: nothing more leaves the device.
  fireEvent.click(ui.getByRole("button", { name: "Mute" }));
  const before = socket.sent.length;
  await act(async () => { for (let i = 0; i < 10; i += 1) env.micBlock(loud(), 48000); });
  assert.equal(socket.sent.length, before);
  assert.ok(ui.getByRole("button", { name: "Unmute" }).getAttribute("aria-pressed") === "true");
  cleanup();
});

test("barge-in clears queued playback and interrupts the server before new audio is sent", async () => {
  const env = makeEnv();
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const socket = await open(env);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "speaking" });
  await server(socket, { type: "audio_chunk_meta", sessionId: "s1", turnId: "t1", index: 0, codec: "pcm_s16le;rate=24000", hasAudio: true, last: false });
  await act(async () => { socket.onmessage({ data: encodeAudioFrame(0, new Uint8Array(480)).buffer.slice(0) }); });
  // First byte of an audio chunk is 0x02; frame helper writes 0x01, so craft the chunk directly.
  const chunk = new Uint8Array(5 + 480); chunk[0] = 0x02;
  await server(socket, { type: "audio_chunk_meta", sessionId: "s1", turnId: "t1", index: 1, codec: "pcm_s16le;rate=24000", hasAudio: true, last: false });
  await act(async () => { socket.onmessage({ data: chunk.buffer }); });
  assert.ok(env.played.length >= 1, "chunk was queued for playback");
  await act(async () => { for (let i = 0; i < 6; i += 1) env.micBlock(new Float32Array(960).fill(0.3), 48000); });
  assert.ok(env.cleared >= 1, "playback stopped");
  const order = socket.sent.map((d) => (typeof d === "string" ? JSON.parse(d).type : "audio"));
  assert.ok(order.indexOf("interrupt") !== -1 && order.indexOf("interrupt") < order.indexOf("audio"), "interrupt precedes new audio");
  cleanup();
});

test("Stop speaking, End voice, logout (unmount) and a context switch all release the microphone", async () => {
  const env = makeEnv();
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const socket = await open(env);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  await server(socket, { type: "voice_state", sessionId: "s1", turnId: "t1", state: "speaking" });
  fireEvent.click(ui.getByRole("button", { name: "Stop speaking" }));
  assert.ok(socket.sent.some((d) => typeof d === "string" && JSON.parse(d).type === "interrupt"));
  assert.equal(env.micStops, 0, "stop speaking keeps listening");
  fireEvent.click(ui.getByRole("button", { name: /End voice/ }));
  assert.equal(env.micStops, 1);
  assert.equal(phaseOf(ui), "idle");
  assert.ok(socket.sent.some((d) => typeof d === "string" && JSON.parse(d).type === "stop"));

  cleanup();
  // Context switch while live.
  const env2 = makeEnv();
  const ui2 = mount(env2);
  fireEvent.click(await ui2.findByRole("button", { name: /Talk to Coey/ }));
  const s2 = await open(env2);
  await server(s2, { type: "ack", v: 1, sessionId: "s2" });
  ui2.rerender(h(Harness, { env: env2, context: "home" }));
  await waitFor(() => assert.equal(env2.micStops, 1));
  assert.equal(s2.readyState, 3);
  cleanup();
  // Unmount (logout / navigation).
  const env3 = makeEnv();
  const ui3 = mount(env3);
  fireEvent.click(await ui3.findByRole("button", { name: /Talk to Coey/ }));
  const s3 = await open(env3);
  await server(s3, { type: "ack", v: 1, sessionId: "s3" });
  ui3.unmount();
  assert.equal(env3.micStops, 1);
  assert.equal(s3.readyState, 3);
  cleanup();
});

test("messages for another session are ignored and a lost socket reports honestly after bounded reconnects", async () => {
  const env = makeEnv();
  const ui = mount(env);
  fireEvent.click(await ui.findByRole("button", { name: /Talk to Coey/ }));
  const socket = await open(env);
  await server(socket, { type: "ack", v: 1, sessionId: "s1" });
  await server(socket, { type: "transcript_final", sessionId: "OLD", turnId: "t9", text: "ghost" });
  assert.equal(ui.queryByTestId("coey-caption"), null);
  // Repeated 1006 closes: bounded reconnects, then an honest error and full cleanup.
  await act(async () => { socket.onclose?.({ code: 1006 }); });
  for (let i = 1; i <= 3; i += 1) {
    await waitFor(() => assert.equal(env.sockets.length, i + 1));
    const current = env.sockets[i];
    current.readyState = 1;
    await act(async () => { current.onopen?.(); });
    await server(current, { type: "ack", v: 1, sessionId: `s${i + 1}` });
    await act(async () => { current.onclose?.({ code: 1006 }); });
  }
  assert.match((await ui.findByRole("alert")).textContent, /connection was lost/);
  assert.equal(env.micStops, 1);
  cleanup();
});

test("keyboard operation and reduced motion are supported by the markup", async () => {
  const ui = mount(makeEnv());
  const button = await ui.findByRole("button", { name: /Talk to Coey/ });
  assert.equal(button.tagName, "BUTTON");
  button.focus();
  assert.equal(document.activeElement, button, "focusable without a pointer");
  const src = readFileSync(new URL("../src/features/court/assistant/CoeyVoiceControls.tsx", import.meta.url), "utf8");
  assert.match(src, /motion-safe:animate-pulse/);
  assert.doesNotMatch(src.replace(/motion-safe:animate-pulse/g, ""), /\banimate-pulse\b/);
  assert.match(src, /focus-visible:ring-2/);
  cleanup();
});
