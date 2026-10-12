import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import {
  AUDIO_CHUNK,
  VOICE_PROTOCOL_VERSION,
  encodeAudioFrame,
  type ServerControl,
  type VoicePhase,
} from "../../../../server/lib/assistant-voice-protocol";
import { applyCoeyEvent, initialTurnState, type CoeyTurnState } from "./turn-state";
import {
  createPcmPlayer,
  createVad,
  downsampleToPcm16,
  parseTtsCodec,
  pcm16ToFloat,
  rms,
  type AudioContextLike,
} from "./voice-audio";

export type VoiceDisplayPhase = VoicePhase;

type SocketLike = {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
};

/** Everything that touches the browser, so the state machine can be tested without one. */
export type VoiceEnv = {
  supported(): boolean;
  openMic(onBlock: (samples: Float32Array, rate: number) => void): Promise<{ stop(): void }>;
  createAudioContext(): AudioContextLike;
  createSocket(url: string): SocketLike;
  getToken(): Promise<string | null>;
  fetchEnabled(): Promise<boolean>;
  now(): number;
};

const WORKLET = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('coey-pcm',P);`;

export const browserVoiceEnv: VoiceEnv = {
  supported: () =>
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined",
  async openMic(onBlock) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "coey-pcm");
    node.port.onmessage = (event) => onBlock(event.data as Float32Array, ctx.sampleRate);
    source.connect(node);
    // Device loss (unplugged headset, revoked permission) ends the tracks.
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => onBlock(new Float32Array(0), -1));
    return {
      stop() {
        node.port.onmessage = null;
        try {
          source.disconnect();
          node.disconnect();
        } catch {
          /* already disconnected */
        }
        for (const track of stream.getTracks()) track.stop();
        void ctx.close();
      },
    };
  },
  createAudioContext: () => new AudioContext() as unknown as AudioContextLike,
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  async getToken() {
    // Dev-server browser tests have no Supabase session; this hook does not exist in production builds.
    if (import.meta.env.DEV) {
      const injected = (globalThis as { __coeyVoiceTestToken?: string }).__coeyVoiceTestToken;
      if (injected) return injected;
    }
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  async fetchEnabled() {
    try {
      const response = await authedFetch("/api/assistant/voice-config");
      if (!response.ok) return false;
      return ((await response.json()) as { enabled?: boolean }).enabled === true;
    } catch {
      return false;
    }
  },
  now: () => Date.now(),
};

export type CoeyVoiceOptions = {
  context: "work" | "home";
  listId?: string;
  bucketId?: string;
  env?: VoiceEnv;
};

export type CoeyVoice = {
  /** Browser can capture and play audio over WebSocket. */
  supported: boolean;
  /** Server readiness. An unavailable mic explains this instead of disappearing. */
  enabled: boolean;
  phase: VoicePhase;
  active: boolean;
  muted: boolean;
  sessionId: string | null;
  partial: string;
  /** Last final transcript and the turn it started. */
  transcript: { turnId: string; text: string } | null;
  /** Events of the spoken turn, folded by the same reducer as typed turns. */
  turn: CoeyTurnState;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
  interrupt(): void;
  toggleMute(): void;
  speak(text: string): void;
  setHint(hint: { awaitingConfirmation: boolean; openTarget: boolean }): void;
};

const FRAME_SAMPLES = 1600; // 100 ms at 16 kHz = 3200 bytes
const PRE_ROLL_BLOCKS = 12;

export function useCoeyVoice(options: CoeyVoiceOptions): CoeyVoice {
  const env = options.env ?? browserVoiceEnv;
  const supported = useMemo(() => env.supported(), [env]);
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [muted, setMuted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [transcript, setTranscript] = useState<{ turnId: string; text: string } | null>(null);
  const [turn, setTurn] = useState<CoeyTurnState>(initialTurnState);
  const [error, setError] = useState<string | null>(null);

  const r = useRef({
    socket: null as SocketLike | null,
    mic: null as { stop(): void } | null,
    ctx: null as AudioContextLike | null,
    player: null as ReturnType<typeof createPcmPlayer> | null,
    session: null as string | null,
    activeTurnId: null as string | null,
    stopped: true,
    muted: false,
    utterance: -1,
    inSpeech: false,
    vad: createVad(),
    preRoll: [] as Int16Array[],
    pending: new Int16Array(0) as Int16Array,
    pendingMeta: null as { rate: number } | null,
    nextHint: { awaitingConfirmation: false, openTarget: false },
    reconnects: 0,
    generation: 0,
  });

  useEffect(() => {
    let live = true;
    void env.fetchEnabled().then((value) => live && setEnabled(value));
    return () => {
      live = false;
    };
  }, [env]);

  const sendJson = (message: unknown) => {
    const socket = r.current.socket;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  };

  const releaseAudio = () => {
    const s = r.current;
    s.player?.clear();
    s.player = null;
    if (s.ctx) void s.ctx.close().catch(() => undefined);
    s.ctx = null;
    s.mic?.stop();
    s.mic = null;
  };

  const stop = useCallback(() => {
    const s = r.current;
    s.generation += 1;
    s.stopped = true;
    if (s.socket) {
      if (s.session && s.socket.readyState === 1) sendJson({ type: "stop", sessionId: s.session });
      s.socket.onclose = null;
      s.socket.onmessage = null;
      try {
        s.socket.close(1000, "client stop");
      } catch {
        /* already closed */
      }
    }
    s.socket = null;
    s.session = null;
    s.activeTurnId = null;
    s.inSpeech = false;
    s.preRoll = [];
    s.pending = new Int16Array(0);
    s.vad.reset();
    releaseAudio();
    setSessionId(null);
    setPartial("");
    setPhase("idle");
    setMuted(false);
    s.muted = false;
  }, []);

  const failWith = useCallback(
    (message: string) => {
      stop();
      setError(message);
      setPhase("error");
    },
    [stop],
  );

  const flushFrames = (force: boolean) => {
    const s = r.current;
    while (s.pending.length >= FRAME_SAMPLES || (force && s.pending.length > 0)) {
      const take = Math.min(FRAME_SAMPLES, s.pending.length);
      const chunk = s.pending.slice(0, take);
      s.pending = s.pending.slice(take);
      if (s.socket?.readyState === 1)
        s.socket.send(encodeAudioFrame(s.utterance, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    }
  };

  const onBlock = (samples: Float32Array, rate: number, generation: number) => {
    const s = r.current;
    if (generation !== s.generation) return;
    if (rate === -1) return failWith("The microphone was disconnected. Typed Ask still works.");
    if (s.muted || s.stopped || !s.session || !samples.length) return;
    const blockMs = (samples.length / rate) * 1000;
    const pcm = downsampleToPcm16(samples, rate);
    const event = s.vad.feed(rms(samples), blockMs, Boolean(s.player?.playing));
    if (event === "speech_start") {
      // Barge-in: clear playback first so the answer stops immediately, then tell the server.
      if (s.player?.playing || s.activeTurnId) {
        s.player?.clear();
        sendJson({ type: "interrupt", sessionId: s.session });
      }
      s.utterance += 1;
      s.inSpeech = true;
      setPartial("");
      setPhase("listening");
      s.pending = concatInt16([...s.preRoll, pcm]);
      s.preRoll = [];
      flushFrames(false);
      return;
    }
    if (s.inSpeech) {
      s.pending = concatInt16([s.pending, pcm]);
      flushFrames(false);
      if (event === "speech_end") {
        s.inSpeech = false;
        flushFrames(true);
        if (s.activeTurnId) {
          sendJson({ type: "speech_end", sessionId: s.session, turnId: s.activeTurnId });
          setPhase("transcribing");
        }
      }
      return;
    }
    s.preRoll.push(pcm);
    if (s.preRoll.length > PRE_ROLL_BLOCKS) s.preRoll.shift();
  };

  const handleControl = (message: ServerControl) => {
    const s = r.current;
    switch (message.type) {
      case "ack":
        s.session = message.sessionId;
        setSessionId(message.sessionId);
        setPhase("listening");
        sendJson({ type: "hint", sessionId: message.sessionId, ...s.nextHint });
        break;
      case "voice_state":
        if (message.sessionId !== s.session) return;
        if (message.state === "listening") s.activeTurnId = message.turnId;
        if (message.state === "idle") {
          if (message.turnId === s.activeTurnId) s.activeTurnId = null;
          setPhase("listening");
        } else if (message.state === "error") setPhase("error");
        else setPhase(message.state);
        break;
      case "transcript_partial":
        if (message.sessionId === s.session) setPartial(message.text);
        break;
      case "transcript_final":
        if (message.sessionId !== s.session) return;
        setPartial("");
        setTranscript({ turnId: message.turnId, text: message.text });
        setTurn(initialTurnState);
        break;
      case "coey_event":
        if (message.sessionId !== s.session) return;
        setTurn((previous) => applyCoeyEvent(previous, message.event));
        break;
      case "audio_chunk_meta":
        if (message.sessionId !== s.session) return;
        s.pendingMeta = message.hasAudio ? parseTtsCodec(message.codec) : null;
        break;
      case "error":
        if (message.code === "session_expired" && !s.stopped && s.reconnects < 3) {
          // The server closes long sessions cleanly; reconnect on the same microphone.
          s.reconnects += 1;
          s.session = null;
          s.socket?.close();
          void connectSocket(s.generation);
          return;
        }
        if (message.code === "provider_unavailable" || message.code === "bad_message" || message.code === "rate_limited") {
          setError(message.message);
          setPhase("error");
        } else failWith(message.message);
        break;
    }
  };

  const connectSocket = async (generation: number) => {
    const s = r.current;
    const token = await env.getToken();
    if (generation !== s.generation) return;
    if (!token) return failWith("Your session expired. Sign in again to use voice.");
    const protocol = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
    const host = typeof location !== "undefined" ? location.host : "localhost";
    const socket = env.createSocket(`${protocol}://${host}/api/assistant/voice`);
    socket.binaryType = "arraybuffer";
    s.socket = socket;
    socket.onopen = () => {
      if (generation !== s.generation) return;
      socket.send(
        JSON.stringify({
          type: "start",
          v: VOICE_PROTOCOL_VERSION,
          codec: "pcm_s16le",
          sampleRate: 16000,
          context: options.context,
          ...(options.listId ? { listId: options.listId } : {}),
          ...(options.bucketId ? { bucketId: options.bucketId } : {}),
          token,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (generation !== s.generation) return;
      if (typeof event.data === "string") {
        try {
          handleControl(JSON.parse(event.data) as ServerControl);
        } catch {
          /* ignore malformed control frames */
        }
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] !== AUDIO_CHUNK || !s.pendingMeta || !s.player) return;
      const meta = s.pendingMeta;
      s.pendingMeta = null;
      s.player.enqueue(pcm16ToFloat(bytes.subarray(5)), meta.rate);
    };
    socket.onclose = (event) => {
      if (generation !== s.generation || s.stopped) return;
      // 1006 is also what a function time limit looks like; try a bounded number of reconnects.
      if (s.reconnects < 3 && s.session) {
        s.reconnects += 1;
        s.session = null;
        void connectSocket(generation);
        return;
      }
      failWith(event.code === 1008 ? "Voice is not available right now. Typed Ask still works." : "The voice connection was lost. Typed Ask still works.");
    };
    socket.onerror = () => undefined;
  };

  const start = useCallback(async () => {
    const s = r.current;
    if (!supported || !enabled || !s.stopped) return;
    s.stopped = false;
    s.generation += 1;
    const generation = s.generation;
    s.reconnects = 0;
    s.utterance = -1;
    setError(null);
    setTurn(initialTurnState);
    setTranscript(null);
    setPhase("connecting");
    try {
      // Called from the click handler, so the browser treats this as a user gesture.
      s.ctx = env.createAudioContext();
      void s.ctx.resume();
      s.player = createPcmPlayer(s.ctx, () => setPhase((p) => (p === "speaking" ? "listening" : p)));
      s.mic = await env.openMic((samples, rate) => onBlock(samples, rate, generation));
      if (generation !== s.generation) {
        s.mic.stop();
        s.mic = null;
        return;
      }
      await connectSocket(generation);
    } catch (cause) {
      if (generation !== s.generation) return;
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      failWith(
        denied
          ? "Microphone access was blocked. Allow it in the browser to use voice, or keep typing."
          : "Voice could not start on this device. Typed Ask still works.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connectSocket/onBlock read live refs
  }, [supported, enabled, env, options.context, options.listId, options.bucketId, failWith]);

  const interrupt = useCallback(() => {
    const s = r.current;
    s.player?.clear();
    if (s.session) sendJson({ type: "interrupt", sessionId: s.session });
    setPhase(s.session ? "listening" : "idle");
  }, []);

  const toggleMute = useCallback(() => {
    const s = r.current;
    s.muted = !s.muted;
    setMuted(s.muted);
    if (s.muted) {
      s.inSpeech = false;
      s.vad.reset();
      s.pending = new Int16Array(0);
    }
  }, []);

  const speak = useCallback((text: string) => {
    const s = r.current;
    if (s.session) sendJson({ type: "speak", sessionId: s.session, text });
  }, []);

  const setHint = useCallback((hint: { awaitingConfirmation: boolean; openTarget: boolean }) => {
    const s = r.current;
    s.nextHint = hint;
    if (s.session) sendJson({ type: "hint", sessionId: s.session, ...hint });
  }, []);

  // Navigating away, switching Work/Home or scope, or unmounting always releases the microphone.
  useEffect(() => stop, [stop, options.context, options.listId, options.bucketId]);

  return {
    supported,
    enabled,
    phase,
    active: phase !== "idle" && phase !== "error",
    muted,
    sessionId,
    partial,
    transcript,
    turn,
    error,
    start,
    stop,
    interrupt,
    toggleMute,
    speak,
    setHint,
  };
}

function concatInt16(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
