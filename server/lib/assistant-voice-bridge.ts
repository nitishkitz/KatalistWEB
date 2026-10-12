import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantAnswer, AssistantConversationTurn } from "./assistant";
import { runCoeyTurn, defaultTurnDeps, type TurnInput } from "./assistant-stream";
import type { CoeyEvent } from "./assistant-turn";
import {
  VOICE_LIMITS,
  VOICE_PROTOCOL_VERSION,
  acquireVoiceSlot,
  encodeAudioChunk,
  isLocalReply,
  markDone,
  markSpeaking,
  mayDeliver,
  newVoiceSession,
  onAudioFrame,
  onClientControl,
  onTranscriptFinal,
  releaseVoiceSlot,
  validateStart,
  type ClientControl,
  type ServerControl,
  type VoiceEffect,
  type VoiceErrorCode,
  type VoiceResult,
  type VoiceSession,
} from "./assistant-voice-protocol";

/** Persistent per-session speech-to-text connection. Transcripts are tagged by the bridge, never trusted as ids. */
export type SttConnection = {
  startUtterance(): void;
  send(pcm: Uint8Array): void;
  /** Ask the provider to finalize the current utterance. */
  endUtterance(): void;
  /** Discard the current utterance. The adapter drops its transcripts, closing the provider socket if audio was in flight. */
  cancelUtterance(): void;
  isOpen(): boolean;
  close(): void;
};
export type SttHandlers = {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onClose(reason: string): void;
};
export type TtsHandle = { cancel(): void; done: Promise<void> };
export type TtsRequest = {
  text: string;
  onChunk(audio: Uint8Array): void;
  signal: AbortSignal;
};

export type BridgeTransport = {
  sendText(message: string): void;
  sendBinary(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
};

export type BridgeDeps = {
  authenticate(token: string): Promise<{ userId: string; client: SupabaseClient } | null>;
  openStt(language: string, handlers: SttHandlers): Promise<SttConnection>;
  synthesize(request: TtsRequest): Promise<void>;
  ttsCodec: string;
  runTurn(
    input: TurnInput,
    userId: string,
    client: SupabaseClient,
    turnId: string,
    send: (event: CoeyEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  now(): number;
  makeId(): string;
  /** Timings, ids and error classes only. Never audio, transcripts, keys or Thing content. */
  log(entry: Record<string, unknown>): void;
};

const LANGUAGES = new Set(["en-IN", "hi-IN", "auto"]);
const BUFFER_FRAMES = 60;

/** Plain speech from an answer: markdown markers removed, bounded. */
export function speechTextFromAnswer(answer: AssistantAnswer): string {
  const text = [answer.answer_markdown, answer.notice ?? ""]
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[`_#>]/g, "")
    .replace(/([^.!?:\s])\s*\n+\s*/g, "$1. ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 480 ? `${text.slice(0, 477).trimEnd()}...` : text;
}

/**
 * One instance per WebSocket connection. Transport-agnostic so the same code
 * serves the in-app Nitro route and tests. Feed it text and binary frames and
 * call close() when the socket closes.
 */
export function createVoiceBridge(transport: BridgeTransport, deps: BridgeDeps) {
  let session: VoiceSession | null = null;
  let identity: { userId: string; client: SupabaseClient } | null = null;
  let stt: SttConnection | null = null;
  let sttOpening: Promise<SttConnection | null> | null = null;
  let language = "en-IN";
  let context: TurnInput["context"] = "work";
  let listId: string | undefined;
  let bucketId: string | undefined;
  let history: AssistantConversationTurn[] = [];
  let slotHeld = false;
  let closed = false;
  let starting: Promise<void> | null = null;
  const pendingFrames: Uint8Array[] = [];
  const pendingFinalizations = new Set<string>();
  /** Turns whose utterance the provider has been told to start; audio is buffered until then. */
  const utteranceStarted = new Set<string>();
  const turnAbort = new Map<string, AbortController>();
  const timing = new Map<string, { speechEnd?: number; ttsStart?: number; firstAudio?: boolean }>();
  let audioIndex = 0;
  let hints = { awaitingConfirmation: false, openTarget: false };

  const sendControl = (message: ServerControl) => {
    if (!closed) transport.sendText(JSON.stringify(message));
  };
  const fail = (code: VoiceErrorCode, message: string, fatal = false) => {
    sendControl({ type: "error", sessionId: session?.sessionId ?? null, code, message });
    if (fatal) shutdown(1008, code);
  };

  function shutdown(code = 1000, reason = "closed") {
    if (closed) return;
    for (const controller of turnAbort.values()) controller.abort();
    turnAbort.clear();
    try {
      stt?.close();
    } catch {
      /* provider already gone */
    }
    stt = null;
    pendingFrames.length = 0;
    pendingFinalizations.clear();
    utteranceStarted.clear();
    if (session) session = { ...session, phase: "closed" };
    if (slotHeld && identity) releaseVoiceSlot(identity.userId);
    slotHeld = false;
    closed = true;
    try {
      transport.close(code, reason);
    } catch {
      /* socket already closed */
    }
  }

  const ensureStt = async (): Promise<SttConnection | null> => {
    if (stt?.isOpen()) return stt;
    if (sttOpening) return sttOpening;
    stt = null;
    sttOpening = (async () => {
      try {
        const connection = await deps.openStt(language, {
        onPartial: (text) => {
          const turn = session?.turn;
          if (session && turn && mayDeliver(session, turn.id) && turn.status !== "checking" && !turn.finalSeen)
            sendControl({ type: "transcript_partial", sessionId: session.sessionId, turnId: turn.id, text: text.slice(0, VOICE_LIMITS.maxTranscriptChars) });
        },
        onFinal: (text) => {
          const turn = session?.turn;
          if (session && turn) handleFinal(turn.id, text);
        },
        onClose: (reason) => {
          stt = null;
          const turn = session?.turn;
          if (session && turn && (turn.status === "listening" || turn.status === "transcribing") && !closed) {
            session = { ...session, turn: { ...turn, status: "cancelled" } };
            sendControl({ type: "voice_state", sessionId: session.sessionId, turnId: turn.id, state: "error" });
            fail("provider_unavailable", "Voice recognition disconnected. Tap the microphone to try again.");
          }
          deps.log({ evt: "coey_voice_stt_closed", reason });
        },
        });
        if (closed) {
          connection.close();
          return null;
        }
        stt = connection;
        return connection;
      } catch {
        stt = null;
        return null;
      } finally {
        sttOpening = null;
      }
    })();
    return sttOpening;
  };

  const speak = async (turnId: string, text: string) => {
    if (!session || !mayDeliver(session, turnId) || !text) return;
    const controller = turnAbort.get(turnId) ?? new AbortController();
    turnAbort.set(turnId, controller);
    session = markSpeaking(session, turnId);
    sendControl({ type: "voice_state", sessionId: session.sessionId, turnId, state: "speaking" });
    const t = timing.get(turnId) ?? {};
    t.ttsStart = deps.now();
    timing.set(turnId, t);
    let index = 0;
    try {
      await deps.synthesize({
        text,
        signal: controller.signal,
        onChunk: (audio) => {
          // Nothing is delivered after an interrupt, a newer turn, or a closed session.
          if (!session || !mayDeliver(session, turnId) || controller.signal.aborted || closed) return;
          if (audio.byteLength === 0 || audio.byteLength > VOICE_LIMITS.maxAudioChunkBytes) return;
          if (!t.firstAudio) {
            t.firstAudio = true;
            deps.log({
              evt: "coey_voice_first_audio",
              turnId,
              ttsFirstChunkMs: Math.round(deps.now() - (t.ttsStart ?? deps.now())),
              speechEndToFirstAudioMs: t.speechEnd ? Math.round(deps.now() - t.speechEnd) : null,
            });
          }
          sendControl({ type: "audio_chunk_meta", sessionId: session.sessionId, turnId, index, codec: deps.ttsCodec, hasAudio: true, last: false });
          transport.sendBinary(encodeAudioChunk(audioIndex & 0xffffffff, audio));
          index += 1;
        },
      });
      if (session && mayDeliver(session, turnId)) {
        sendControl({ type: "audio_chunk_meta", sessionId: session.sessionId, turnId, index, codec: deps.ttsCodec, hasAudio: false, last: true });
        session = markDone(session, turnId);
        sendControl({ type: "voice_state", sessionId: session.sessionId, turnId, state: "idle" });
      }
    } catch {
      if (session && mayDeliver(session, turnId) && !controller.signal.aborted) {
        sendControl({ type: "voice_state", sessionId: session.sessionId, turnId, state: "error" });
        fail("provider_unavailable", "Speech playback is unavailable. The answer is shown as text.");
        session = markDone(session, turnId);
      }
    } finally {
      turnAbort.delete(turnId);
      audioIndex += 1;
    }
  };

  const runTurnFor = async (turnId: string, text: string) => {
    if (!session || !identity) return;
    const controller = new AbortController();
    turnAbort.set(turnId, controller);
    let answer: AssistantAnswer | null = null;
    const startedAt = deps.now();
    const input: TurnInput = { question: text, context, listId, bucketId, history, reuse: history.length > 0 };
    await deps.runTurn(
      input,
      identity.userId,
      identity.client,
      turnId,
      (event) => {
        if (!session || !mayDeliver(session, turnId) || controller.signal.aborted) return;
        if (event.type === "answer") answer = event.answer;
        sendControl({ type: "coey_event", sessionId: session.sessionId, turnId, event });
      },
      controller.signal,
    );
    deps.log({ evt: "coey_voice_turn", turnId, turnMs: Math.round(deps.now() - startedAt) });
    if (!session || !mayDeliver(session, turnId) || controller.signal.aborted) return;
    if (!answer) {
      session = markDone(session, turnId);
      sendControl({ type: "voice_state", sessionId: session.sessionId, turnId, state: "idle" });
      return;
    }
    const final: AssistantAnswer = answer;
    history = [...history, { role: "user" as const, content: text }, { role: "assistant" as const, content: final.answer_markdown }].slice(-6);
    await speak(turnId, speechTextFromAnswer(final));
  };

  function handleFinal(turnId: string, text: string) {
    if (!session) return;
    const result = onTranscriptFinal(session, turnId, text);
    run(result);
    if (!result.runTurn) return;
    // A bare "yes" or "open it" while the screen offers exactly that goes back to the client.
    if (isLocalReply(result.runTurn, hints) && session) {
      session = markDone(session, turnId);
      sendControl({ type: "voice_state", sessionId: session.sessionId, turnId, state: "idle" });
      return;
    }
    void runTurnFor(turnId, result.runTurn);
  }

  /** Executes protocol effects in order. The protocol decides; this only performs I/O. */
  function run(result: VoiceResult) {
    session = result.session;
    for (const effect of result.effects) perform(effect);
  }

  function perform(effect: VoiceEffect) {
    switch (effect.kind) {
      case "send":
        sendControl(effect.message);
        break;
      case "close":
        shutdown(effect.code, effect.reason);
        break;
      case "open_turn":
        pendingFrames.length = 0;
        pendingFinalizations.delete(effect.turnId);
        if (stt?.isOpen()) {
          stt.startUtterance();
          utteranceStarted.add(effect.turnId);
          break;
        }
        void ensureStt().then((conn) => {
          if (!conn) {
            fail("provider_unavailable", "Voice recognition is unavailable. You can type instead.");
            if (session?.turn?.id === effect.turnId) session = { ...session, turn: { ...session.turn, status: "cancelled" } };
            pendingFrames.length = 0;
            return;
          }
          if (session?.turn?.id !== effect.turnId || session.turn.status === "cancelled") return;
          conn.startUtterance();
          utteranceStarted.add(effect.turnId);
          for (const frame of pendingFrames.splice(0)) conn.send(frame);
          if (pendingFinalizations.delete(effect.turnId)) conn.endUtterance();
        });
        break;
      case "forward_audio":
        if (stt?.isOpen() && session?.turn?.id === effect.turnId && utteranceStarted.has(effect.turnId)) stt.send(effect.bytes);
        else if (pendingFrames.length < BUFFER_FRAMES) pendingFrames.push(effect.bytes);
        break;
      case "finalize_stt":
        timing.set(effect.turnId, { ...(timing.get(effect.turnId) ?? {}), speechEnd: deps.now() });
        if (stt?.isOpen() && utteranceStarted.has(effect.turnId)) stt.endUtterance();
        else pendingFinalizations.add(effect.turnId);
        break;
      case "cancel_turn":
        turnAbort.get(effect.turnId)?.abort();
        turnAbort.delete(effect.turnId);
        stt?.cancelUtterance();
        pendingFrames.length = 0;
        pendingFinalizations.delete(effect.turnId);
        break;
      case "speak":
        void speak(effect.turnId, effect.text);
        break;
    }
  }

  return {
    /** Handles one JSON text frame. */
    async onText(raw: string): Promise<void> {
      if (closed) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return fail("bad_message", "Malformed message.", !session);
      }
      if (!session) {
        if (starting) return;
        const valid = validateStart(message);
        if (!valid.ok) return fail(valid.code, valid.message, true);
        starting = (async () => {
          const who = await deps.authenticate(valid.msg.token);
          if (closed) return;
          if (!who) return fail("unauthenticated", "Your session is not valid. Sign in again.", true);
          if (!acquireVoiceSlot(who.userId)) return fail("session_limit", "Too many voice sessions are open.", true);
          slotHeld = true;
          identity = who;
          context = valid.msg.context;
          listId = typeof valid.msg.listId === "string" ? valid.msg.listId : undefined;
          bucketId = typeof valid.msg.bucketId === "string" ? valid.msg.bucketId : undefined;
          language = LANGUAGES.has(valid.msg.language ?? "") ? (valid.msg.language as string) : "en-IN";
          session = newVoiceSession(deps.makeId(), who.userId, deps.now());
          sendControl({ type: "ack", v: VOICE_PROTOCOL_VERSION, sessionId: session.sessionId });
          // Warm the provider connection so the first utterance does not pay for it.
          void ensureStt();
        })();
        await starting;
        return;
      }
      const control = message as ClientControl;
      if (control.type === "hint" && control.sessionId === session.sessionId) {
        hints = { awaitingConfirmation: control.awaitingConfirmation === true, openTarget: control.openTarget === true };
        return;
      }
      run(onClientControl(session, control));
    },
    /** Handles one binary audio frame. */
    onBinary(bytes: Uint8Array): void {
      if (closed) return;
      if (!session) return fail("bad_message", "Audio before start.", true);
      run(onAudioFrame(session, bytes, deps.now(), deps.makeId));
    },
    close(): void {
      shutdown(1000, "peer closed");
    },
    /** For tests. */
    get state() {
      return session;
    },
  };
}

/** Production wiring: real turn controller with the authenticated client. */
export const runTurnWithDefaults: BridgeDeps["runTurn"] = (input, userId, client, turnId, send, signal) =>
  runCoeyTurn(input, defaultTurnDeps(client, userId), turnId, send, signal);
