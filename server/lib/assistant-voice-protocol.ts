import type { CoeyEvent } from "./assistant-turn";

/**
 * Versioned control/binary protocol for the Coey voice bridge. Pure
 * validation and state transitions: it opens no provider connections and
 * holds no secrets. Audio never travels inside a JSON CoeyEvent.
 *
 * Wire format
 *   text frames   JSON control messages (below)
 *   binary frames [type:u8][turnIndex:u32 BE][payload]
 *                 type 0x01 audio_frame  client->server, PCM s16le mono 16 kHz
 *                 type 0x02 audio_chunk  server->client, encoded audio for one turn
 */
export const VOICE_PROTOCOL_VERSION = 1;
export const VOICE_LIMITS = {
  /** 16 kHz * 2 bytes * 0.25 s. The client sends about 100 ms frames (3200 bytes). */
  maxFrameBytes: 8192,
  maxFramesPerSecond: 25,
  maxSessionMs: 270_000, // Vercel Hobby cuts WebSockets at about 300 s (measured); close first, client reconnects
  maxTurnMs: 60_000,
  maxSessionBytes: 16_000 * 2 * 120,
  maxConcurrentSessionsPerUser: 2,
  maxTranscriptChars: 800,
  maxSpeakChars: 320,
  /** Outbound audio chunk ceiling per message. */
  maxAudioChunkBytes: 64 * 1024,
} as const;
export const VOICE_CODECS = ["pcm_s16le"] as const;
export const AUDIO_FRAME = 0x01;
export const AUDIO_CHUNK = 0x02;

export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "transcribing"
  | "checking"
  | "speaking"
  | "action_ready"
  | "error";

export type ClientControl =
  | { type: "start"; v: number; codec: string; sampleRate: number; language?: string; context: "work" | "home"; listId?: string; bucketId?: string; token: string }
  | { type: "speech_end"; sessionId: string; turnId: string }
  | { type: "interrupt"; sessionId: string; turnId?: string }
  | { type: "stop"; sessionId: string }
  /** Read a short, client-composed readback aloud (e.g. an action preview). Bounded, never an action. */
  | { type: "speak"; sessionId: string; text: string }
  /**
   * Tells the bridge what the screen currently offers, so a short spoken reply
   * ("yes", "open it") is handed back to the client instead of starting a new
   * turn. The server never acts on these words; the client confirms only a
   * visible, unexpired proposal.
   */
  | { type: "hint"; sessionId: string; awaitingConfirmation: boolean; openTarget: boolean };

export type ServerControl =
  | { type: "ack"; v: number; sessionId: string }
  | { type: "voice_state"; sessionId: string; turnId: string | null; state: VoicePhase }
  | { type: "transcript_partial"; sessionId: string; turnId: string; text: string }
  | { type: "transcript_final"; sessionId: string; turnId: string; text: string }
  | { type: "coey_event"; sessionId: string; turnId: string; event: CoeyEvent }
  /** Precedes each binary audio chunk (hasAudio) or ends the turn's audio (last, no payload). */
  | { type: "audio_chunk_meta"; sessionId: string; turnId: string; index: number; codec: string; hasAudio: boolean; last: boolean }
  | { type: "error"; sessionId: string | null; code: VoiceErrorCode; message: string };

export type VoiceErrorCode =
  | "bad_message"
  | "unsupported_version"
  | "unsupported_codec"
  | "frame_too_large"
  | "rate_limited"
  | "session_limit"
  | "session_expired"
  | "turn_too_long"
  | "stale_session"
  | "stale_turn"
  | "unauthenticated"
  | "provider_unavailable";

export type VoiceTurn = {
  id: string;
  /** Client-side utterance counter from the binary header, used to detect out-of-order audio. */
  index: number;
  status: "listening" | "transcribing" | "checking" | "speaking" | "done" | "cancelled";
  startedAt: number;
  finalSeen: boolean;
};

export type VoiceSession = {
  sessionId: string;
  userId: string;
  startedAt: number;
  phase: "open" | "closed";
  frames: number;
  bytes: number;
  windowStart: number;
  windowFrames: number;
  turn: VoiceTurn | null;
  turnsStarted: number;
  lastTurnIndex: number;
};

export type VoiceEffect =
  | { kind: "open_turn"; turnId: string }
  | { kind: "forward_audio"; turnId: string; bytes: Uint8Array }
  | { kind: "finalize_stt"; turnId: string }
  | { kind: "cancel_turn"; turnId: string }
  | { kind: "speak"; turnId: string; text: string }
  | { kind: "send"; message: ServerControl }
  | { kind: "close"; code: number; reason: string };

export type VoiceResult = { session: VoiceSession; effects: VoiceEffect[] };

export function newVoiceSession(sessionId: string, userId: string, now: number): VoiceSession {
  return {
    sessionId, userId, startedAt: now, phase: "open", frames: 0, bytes: 0,
    windowStart: now, windowFrames: 0, turn: null, turnsStarted: 0, lastTurnIndex: -1,
  };
}

const reject = (session: VoiceSession, code: VoiceErrorCode, message: string, close = false): VoiceResult => ({
  session: close ? { ...session, phase: "closed" } : session,
  effects: [
    { kind: "send", message: { type: "error", sessionId: session.sessionId, code, message } },
    ...(close ? [{ kind: "close" as const, code: 1008, reason: code }] : []),
  ],
});

/** Validates the first message. Returns an error code, or null when acceptable. */
export function validateStart(message: unknown): { ok: true; msg: Extract<ClientControl, { type: "start" }> } | { ok: false; code: VoiceErrorCode; message: string } {
  const m = message as Partial<Extract<ClientControl, { type: "start" }>> | null;
  if (!m || typeof m !== "object" || m.type !== "start") return { ok: false, code: "bad_message", message: "Expected a start message." };
  if (m.v !== VOICE_PROTOCOL_VERSION) return { ok: false, code: "unsupported_version", message: "Unsupported voice protocol version." };
  if (!VOICE_CODECS.includes(m.codec as never) || m.sampleRate !== 16000)
    return { ok: false, code: "unsupported_codec", message: "Only 16 kHz PCM s16le mono audio is supported." };
  if (typeof m.token !== "string" || m.token.length < 10 || m.token.length > 8192)
    return { ok: false, code: "unauthenticated", message: "A valid session token is required." };
  if (m.context !== "work" && m.context !== "home") return { ok: false, code: "bad_message", message: "Unknown context." };
  return { ok: true, msg: m as Extract<ClientControl, { type: "start" }> };
}

/** Parses a binary frame header. Anything malformed or oversized is rejected before any provider sees it. */
export function parseBinaryFrame(data: Uint8Array): { type: number; turnIndex: number; payload: Uint8Array } | { error: VoiceErrorCode } {
  if (data.byteLength < 5) return { error: "bad_message" };
  if (data.byteLength - 5 > VOICE_LIMITS.maxFrameBytes) return { error: "frame_too_large" };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(0);
  if (type !== AUDIO_FRAME) return { error: "bad_message" };
  const payload = data.subarray(5);
  if (payload.byteLength === 0 || payload.byteLength % 2 !== 0) return { error: "bad_message" };
  return { type, turnIndex: view.getUint32(1, false), payload };
}

export function encodeAudioChunk(turnIndex: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, AUDIO_CHUNK);
  view.setUint32(1, turnIndex, false);
  out.set(payload, 5);
  return out;
}

export function encodeAudioFrame(turnIndex: number, pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + pcm.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, AUDIO_FRAME);
  view.setUint32(1, turnIndex, false);
  out.set(pcm, 5);
  return out;
}

/** Applies one inbound audio frame. */
export function onAudioFrame(
  session: VoiceSession,
  data: Uint8Array,
  now: number,
  makeTurnId: () => string,
): VoiceResult {
  if (session.phase === "closed") return { session, effects: [] };
  if (now - session.startedAt > VOICE_LIMITS.maxSessionMs)
    return reject(session, "session_expired", "This voice session reached its time limit.", true);
  const parsed = parseBinaryFrame(data);
  if ("error" in parsed) return reject(session, parsed.error, parsed.error === "frame_too_large" ? "Audio frame is too large." : "Malformed audio frame.", parsed.error === "frame_too_large");
  const windowReset = now - session.windowStart >= 1000;
  const windowFrames = (windowReset ? 0 : session.windowFrames) + 1;
  if (windowFrames > VOICE_LIMITS.maxFramesPerSecond)
    return reject({ ...session, windowStart: windowReset ? now : session.windowStart, windowFrames }, "rate_limited", "Audio is arriving too quickly.", true);
  if (session.bytes + parsed.payload.byteLength > VOICE_LIMITS.maxSessionBytes)
    return reject(session, "session_expired", "This voice session reached its audio limit.", true);

  let next: VoiceSession = {
    ...session,
    frames: session.frames + 1,
    bytes: session.bytes + parsed.payload.byteLength,
    windowStart: windowReset ? now : session.windowStart,
    windowFrames,
  };
  const effects: VoiceEffect[] = [];
  const active = next.turn && (next.turn.status === "listening");
  if (!active) {
    // Audio for an older utterance (or one after speech ended) is dropped; a higher index starts a new turn.
    if (parsed.turnIndex <= next.lastTurnIndex) return { session: next, effects: [] };
    // A new utterance interrupts anything still being said or computed, never a committed write.
    if (next.turn && next.turn.status !== "done" && next.turn.status !== "cancelled")
      effects.push({ kind: "cancel_turn", turnId: next.turn.id });
    const id = makeTurnId();
    next = {
      ...next,
      turnsStarted: next.turnsStarted + 1,
      lastTurnIndex: parsed.turnIndex,
      turn: { id, index: parsed.turnIndex, status: "listening", startedAt: now, finalSeen: false },
    };
    effects.push({ kind: "open_turn", turnId: id });
    effects.push({ kind: "send", message: { type: "voice_state", sessionId: next.sessionId, turnId: id, state: "listening" } });
  } else if (parsed.turnIndex !== next.turn!.index) {
    return reject(next, "stale_turn", "Audio did not match the active turn.");
  }
  if (now - next.turn!.startedAt > VOICE_LIMITS.maxTurnMs) {
    return {
      session: { ...next, turn: { ...next.turn!, status: "cancelled" } },
      effects: [
        ...effects,
        { kind: "cancel_turn", turnId: next.turn!.id },
        { kind: "send", message: { type: "error", sessionId: next.sessionId, code: "turn_too_long", message: "That took too long. Please try again." } },
      ],
    };
  }
  effects.push({ kind: "forward_audio", turnId: next.turn!.id, bytes: parsed.payload });
  return { session: next, effects };
}

/** Applies a client control message after `start`. Messages for another session or turn are rejected. */
export function onClientControl(session: VoiceSession, message: ClientControl): VoiceResult {
  if (session.phase === "closed") return { session, effects: [] };
  if (message.type === "start") return reject(session, "bad_message", "Session already started.");
  if (message.sessionId !== session.sessionId) return reject(session, "stale_session", "That message belongs to an earlier session.");
  const turn = session.turn;
  switch (message.type) {
    case "speech_end": {
      if (!turn || turn.id !== message.turnId) return reject(session, "stale_turn", "That turn is no longer active.");
      if (turn.status !== "listening") return { session, effects: [] };
      return {
        session: { ...session, turn: { ...turn, status: "transcribing" } },
        effects: [
          { kind: "finalize_stt", turnId: turn.id },
          { kind: "send", message: { type: "voice_state", sessionId: session.sessionId, turnId: turn.id, state: "transcribing" } },
        ],
      };
    }
    case "interrupt": {
      if (!turn || turn.status === "done" || turn.status === "cancelled") return { session, effects: [] };
      if (message.turnId && message.turnId !== turn.id) return { session, effects: [] };
      return {
        session: { ...session, turn: { ...turn, status: "cancelled" } },
        effects: [
          { kind: "cancel_turn", turnId: turn.id },
          { kind: "send", message: { type: "voice_state", sessionId: session.sessionId, turnId: turn.id, state: "idle" } },
        ],
      };
    }
    case "hint":
      return { session, effects: [] };
    case "speak": {
      const text = typeof message.text === "string" ? message.text.trim().slice(0, VOICE_LIMITS.maxSpeakChars) : "";
      if (!text) return reject(session, "bad_message", "Nothing to say.");
      const id = `speak-${session.turnsStarted + 1}`;
      return {
        session: {
          ...session,
          turnsStarted: session.turnsStarted + 1,
          turn: { id, index: session.lastTurnIndex, status: "speaking", startedAt: Date.now(), finalSeen: true },
        },
        effects: [
          ...(turn && turn.status !== "done" && turn.status !== "cancelled" ? [{ kind: "cancel_turn" as const, turnId: turn.id }] : []),
          { kind: "speak", turnId: id, text },
          { kind: "send", message: { type: "voice_state", sessionId: session.sessionId, turnId: id, state: "speaking" } },
        ],
      };
    }
    case "stop":
      return {
        session: { ...session, phase: "closed", turn: turn ? { ...turn, status: "cancelled" } : null },
        effects: [
          ...(turn && turn.status !== "done" && turn.status !== "cancelled" ? [{ kind: "cancel_turn" as const, turnId: turn.id }] : []),
          { kind: "close", code: 1000, reason: "stopped" },
        ],
      };
  }
}

/**
 * A final transcript from the provider. Only the first final for the active
 * turn counts; duplicates, finals for other turns and finals after an
 * interrupt are ignored. The returned `run_turn` flag tells the bridge to
 * invoke the shared turn controller.
 */
export function onTranscriptFinal(
  session: VoiceSession,
  turnId: string,
  text: string,
): VoiceResult & { runTurn: string | null } {
  const turn = session.turn;
  const clean = text.trim().slice(0, VOICE_LIMITS.maxTranscriptChars);
  if (session.phase === "closed" || !turn || turn.id !== turnId || turn.finalSeen || turn.status === "cancelled" || turn.status === "done")
    return { session, effects: [], runTurn: null };
  if (!clean)
    return {
      session: { ...session, turn: { ...turn, status: "done", finalSeen: true } },
      effects: [{ kind: "send", message: { type: "voice_state", sessionId: session.sessionId, turnId, state: "idle" } }],
      runTurn: null,
    };
  return {
    session: { ...session, turn: { ...turn, status: "checking", finalSeen: true } },
    effects: [
      { kind: "send", message: { type: "transcript_final", sessionId: session.sessionId, turnId, text: clean } },
      { kind: "send", message: { type: "voice_state", sessionId: session.sessionId, turnId, state: "checking" } },
    ],
    runTurn: clean,
  };
}

/** Whether output (events or audio) for `turnId` may still be delivered. False after interrupt, terminal state, or turn change. */
export function mayDeliver(session: VoiceSession, turnId: string): boolean {
  const turn = session.turn;
  return session.phase === "open" && Boolean(turn) && turn!.id === turnId && turn!.status !== "cancelled" && turn!.status !== "done";
}

export function markSpeaking(session: VoiceSession, turnId: string): VoiceSession {
  return mayDeliver(session, turnId) ? { ...session, turn: { ...session.turn!, status: "speaking" } } : session;
}

export function markDone(session: VoiceSession, turnId: string): VoiceSession {
  return session.turn?.id === turnId && session.turn.status !== "cancelled"
    ? { ...session, turn: { ...session.turn, status: "done" } }
    : session;
}

/** Per-user concurrent session accounting (per instance). */
const live = new Map<string, number>();
export function acquireVoiceSlot(userId: string): boolean {
  const count = live.get(userId) ?? 0;
  if (count >= VOICE_LIMITS.maxConcurrentSessionsPerUser) return false;
  live.set(userId, count + 1);
  return true;
}
export function releaseVoiceSlot(userId: string) {
  const count = (live.get(userId) ?? 1) - 1;
  if (count <= 0) live.delete(userId);
  else live.set(userId, count);
}

const CONFIRM_WORDS = /^(yes|yeah|yep|yup|confirm|go ahead|do it|sure|ok|okay|no|nope|cancel|never mind|dont|do not)( please| thanks| thank you)?$/;
const OPEN_WORDS = /^(open|show)( it| that| this| the first one| the first)?$/;

/** Short replies the client resolves against what is on screen. Only used when the matching hint is set. */
export function isLocalReply(text: string, hints: { awaitingConfirmation: boolean; openTarget: boolean }): boolean {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return (hints.awaitingConfirmation && CONFIRM_WORDS.test(t)) || (hints.openTarget && OPEN_WORDS.test(t));
}
