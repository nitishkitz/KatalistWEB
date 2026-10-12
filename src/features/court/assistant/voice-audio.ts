/** Browser audio helpers for Coey voice. DSP is pure so it can be unit tested without a browser. */

/** Averaging decimation to 16 kHz mono signed 16-bit PCM. */
export function downsampleToPcm16(input: Float32Array, inRate: number, outRate = 16000): Int16Array {
  if (inRate === outRate) return floatToInt16(input);
  const ratio = inRate / outRate;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function rms(block: Float32Array): number {
  if (!block.length) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) sum += block[i] * block[i];
  return Math.sqrt(sum / block.length);
}

export type VadEvent = "speech_start" | "speech_end" | null;

/**
 * Energy voice-activity detector with hysteresis. Feed one level per block.
 * While Coey is speaking, `playing` raises the start threshold so its own
 * audio leaking into the microphone does not count as the user talking.
 */
export function createVad(options: { startLevel?: number; playingStartLevel?: number; stopLevel?: number; startBlocks?: number; endSilenceMs?: number } = {}) {
  const startLevel = options.startLevel ?? 0.02;
  const playingStartLevel = options.playingStartLevel ?? 0.06;
  const stopLevel = options.stopLevel ?? 0.012;
  const startBlocks = options.startBlocks ?? 2;
  const endSilenceMs = options.endSilenceMs ?? 900;
  let speaking = false;
  let loud = 0;
  let quietMs = 0;
  return {
    get speaking() {
      return speaking;
    },
    feed(level: number, blockMs: number, playing = false): VadEvent {
      if (!speaking) {
        loud = level >= (playing ? playingStartLevel : startLevel) ? loud + 1 : 0;
        if (loud >= startBlocks) {
          speaking = true;
          quietMs = 0;
          loud = 0;
          return "speech_start";
        }
        return null;
      }
      quietMs = level < stopLevel ? quietMs + blockMs : 0;
      if (quietMs >= endSilenceMs) {
        speaking = false;
        quietMs = 0;
        return "speech_end";
      }
      return null;
    },
    reset() {
      speaking = false;
      loud = 0;
      quietMs = 0;
    },
  };
}

/** Parses the codec label sent by the bridge, e.g. `pcm_s16le;rate=24000`. */
export function parseTtsCodec(label: string): { rate: number } | null {
  const match = /^pcm_s16le;rate=(\d{4,6})$/.exec(label);
  return match ? { rate: Number(match[1]) } : null;
}

/** Signed 16-bit little-endian PCM to floats. A RIFF/WAV header, if the provider sent one, is skipped. */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  let offset = 0;
  if (bytes.length > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) offset = 44;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.floor((bytes.length - offset) / 2) * 2);
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export type AudioContextLike = {
  currentTime: number;
  destination: unknown;
  createBuffer(channels: number, length: number, rate: number): { copyToChannel(data: Float32Array, channel: number): void; duration: number };
  createBufferSource(): { buffer: unknown; connect(node: unknown): void; start(when: number): void; stop(): void; onended: (() => void) | null };
  resume(): Promise<void>;
  close(): Promise<void>;
};

/** Gapless queued playback that can be cleared instantly (barge-in). */
export function createPcmPlayer(ctx: AudioContextLike, onIdle: () => void) {
  let next = 0;
  const active = new Set<{ stop(): void }>();
  return {
    get playing() {
      return active.size > 0;
    },
    enqueue(samples: Float32Array, rate: number) {
      if (!samples.length) return;
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.02, next);
      next = startAt + buffer.duration;
      active.add(source);
      source.onended = () => {
        active.delete(source);
        if (!active.size) onIdle();
      };
      source.start(startAt);
    },
    /** Stops everything that is queued or playing. No further callbacks fire for cleared sources. */
    clear() {
      for (const source of active) {
        (source as { onended?: unknown }).onended = null;
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      active.clear();
      next = 0;
    },
  };
}
