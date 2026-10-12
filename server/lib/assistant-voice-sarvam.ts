import type { SttConnection, SttHandlers, TtsRequest } from "./assistant-voice-bridge";

/**
 * Sarvam realtime STT and streaming TTS adapters (server-side only; the key
 * never leaves this process). Endpoint shapes follow Sarvam's published docs
 * (STT: /speech-to-text-realtime/ws, query language_code, model, encoding,
 * sample_rate, endpointing; header api-subscription-key). The TTS WebSocket
 * path and the codec of returned audio could not be verified live (no key was
 * available to the implementer), so they are env-configurable.
 */
export type VoiceProviderConfig = {
  apiKey: string;
  sttUrl: string;
  sttModel: string;
  ttsUrl: string;
  ttsModel: string;
  ttsSpeaker: string;
  ttsSampleRate: number;
};

export function voiceProviderConfig(env: NodeJS.ProcessEnv = process.env): VoiceProviderConfig | null {
  const apiKey = env.SARVAM_API_KEY?.trim() || env.CODE_ACTIVITY_SARVAM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    sttUrl: env.COEY_VOICE_STT_URL?.trim() || "wss://api.sarvam.ai/speech-to-text-realtime/ws",
    sttModel: env.COEY_VOICE_STT_MODEL?.trim() || "saaras:v3-realtime",
    ttsUrl: env.COEY_VOICE_TTS_URL?.trim() || "wss://api.sarvam.ai/text-to-speech/ws",
    ttsModel: env.COEY_VOICE_TTS_MODEL?.trim() || "bulbul:v4-flash",
    ttsSpeaker: env.COEY_VOICE_TTS_SPEAKER?.trim() || "simran_en_customer",
    ttsSampleRate: Number(env.COEY_VOICE_TTS_SAMPLE_RATE) || 24000,
  };
}

/** Codec label sent to the browser so it knows how to play returned chunks. */
export const ttsCodecLabel = (config: VoiceProviderConfig) => `pcm_s16le;rate=${config.ttsSampleRate}`;

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

function connect(url: string, apiKey: string, timeoutMs = 6000): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    // Node's built-in WebSocket accepts a headers option; browsers never reach this code.
    const Ctor = WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => SocketLike;
    const socket = new Ctor(url, { headers: { "api-subscription-key": apiKey } });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("provider_connect_timeout"));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("provider_connect_failed"));
    };
  });
}

const textOf = (data: unknown): string => (typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "");

export async function openSarvamStt(
  config: VoiceProviderConfig,
  language: string,
  handlers: SttHandlers,
): Promise<SttConnection> {
  const params = new URLSearchParams({
    language_code: language,
    model: config.sttModel,
    encoding: "linear16",
    sample_rate: "16000",
    endpointing: "manual",
  });
  const socket = await connect(`${config.sttUrl}?${params}`, config.apiKey);
  let open = true;
  let active = false;
  const keepAlive = setInterval(() => {
    if (open) socket.send(JSON.stringify({ event: "ping" }));
  }, 20_000);
  socket.onmessage = (event) => {
    let message: { event?: string; text?: unknown };
    try {
      message = JSON.parse(textOf(event.data));
    } catch {
      return;
    }
    if (!active || typeof message.text !== "string") return;
    if (message.event === "transcript.partial") handlers.onPartial(message.text);
    else if (message.event === "transcript.final") {
      active = false;
      handlers.onFinal(message.text);
    }
  };
  socket.onclose = (event) => {
    open = false;
    clearInterval(keepAlive);
    handlers.onClose(`code ${event.code}`);
  };
  const send = (payload: unknown) => {
    if (open && socket.readyState === 1) socket.send(JSON.stringify(payload));
  };
  return {
    isOpen: () => open,
    startUtterance() {
      active = true;
      send({ event: "speech_start" });
    },
    send(pcm) {
      if (active) send({ event: "audio_input", audio: Buffer.from(pcm).toString("base64") });
    },
    endUtterance() {
      send({ event: "speech_end" });
      send({ event: "flush" });
    },
    cancelUtterance() {
      // The provider has no cancel event. A late final would be attributed to the next
      // utterance, so an utterance in flight is dropped by closing the socket.
      if (active) {
        active = false;
        open = false;
        clearInterval(keepAlive);
        socket.close(1000, "utterance cancelled");
      }
    },
    close() {
      active = false;
      clearInterval(keepAlive);
      try {
        send({ event: "end" });
        open = false;
        socket.close(1000, "closed");
      } catch {
        /* already closed */
      }
      open = false;
    },
  };
}

export async function synthesizeSarvam(config: VoiceProviderConfig, request: TtsRequest): Promise<void> {
  const params = new URLSearchParams({ model: config.ttsModel, send_completion_event: "true" });
  const socket = await connect(`${config.ttsUrl}?${params}`, config.apiKey);
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (idle) clearTimeout(idle);
      request.signal.removeEventListener("abort", onAbort);
      try {
        socket.close(1000, "done");
      } catch {
        /* already closed */
      }
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => done();
    request.signal.addEventListener("abort", onAbort);
    const bump = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => done(new Error("tts_idle_timeout")), 10_000);
    };
    socket.onmessage = (event) => {
      if (request.signal.aborted) return done();
      bump();
      let message: { type?: string; data?: { audio?: unknown; event_type?: string } };
      try {
        message = JSON.parse(textOf(event.data));
      } catch {
        return;
      }
      if (message.type === "audio" && typeof message.data?.audio === "string") {
        request.onChunk(new Uint8Array(Buffer.from(message.data.audio, "base64")));
      } else if (message.type === "event" && message.data?.event_type === "final") done();
      else if (message.type === "error") done(new Error("tts_provider_error"));
    };
    socket.onclose = () => done(new Error("tts_closed_before_final"));
    socket.onerror = () => done(new Error("tts_socket_error"));
    bump();
    socket.send(
      JSON.stringify({
        type: "config",
        data: {
          speaker: config.ttsSpeaker,
          language_code: "en-IN",
          output_audio_codec: "linear16",
          speech_sample_rate: config.ttsSampleRate,
          min_buffer_size: 30,
          max_chunk_length: 200,
        },
      }),
    );
    socket.send(JSON.stringify({ type: "text", data: { text: request.text } }));
    socket.send(JSON.stringify({ type: "flush" }));
  });
}
