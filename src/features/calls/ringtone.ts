/**
 * A looping incoming-call ringtone synthesized with the Web Audio API (no audio
 * asset needed). Plays a classic double-ring every ~2.5s until stopped, and
 * vibrates on devices that support it. Autoplay policies may block sound until
 * the user has interacted with the page — that's expected and harmless.
 */
export type Ringtone = { start: () => void; stop: () => void };

export function createRingtone(): Ringtone {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const ring = () => {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const tone = (offset: number, freq: number, dur: number) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    };
    // Double-ring: two warbling tones, brief pause, repeat.
    tone(0, 480, 0.4);
    tone(0, 620, 0.4);
    tone(0.6, 480, 0.4);
    tone(0.6, 620, 0.4);
  };

  return {
    start() {
      if (running || typeof window === "undefined") return;
      running = true;
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        void ctx.resume();
        ring();
        timer = setInterval(() => {
          if (running) ring();
        }, 2500);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([400, 200, 400, 200, 400]);
        }
      } catch {
        // Sound is best-effort.
      }
    },
    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (ctx) {
        void ctx.close().catch(() => {});
        ctx = null;
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
    },
  };
}
