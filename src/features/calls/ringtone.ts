/**
 * A looping incoming-call ringtone synthesized with the Web Audio API (no audio
 * asset needed). Plays a classic double-ring every ~2.5s until stopped, and
 * vibrates on devices that support it.
 *
 * Browsers (especially iOS Safari) keep an AudioContext suspended until the user
 * has interacted with the page. We therefore keep ONE shared AudioContext and
 * `unlockAudio()` resumes it from any user gesture, so a later ring can play.
 */
export type Ringtone = { start: () => void; stop: () => void };

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

/**
 * Prime/resume the shared AudioContext from within a user gesture. Safe to call
 * repeatedly; it plays a silent blip on first unlock so iOS marks it "running".
 */
export function unlockAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // effectively silent
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.02);
  } catch {
    // best-effort
  }
}

export function createRingtone(): Ringtone {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const ring = () => {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const tone = (offset: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
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
      if (running) return;
      running = true;
      try {
        const ctx = getCtx();
        if (ctx && ctx.state === "suspended") void ctx.resume();
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
      // Keep the shared AudioContext alive (do not close) so it stays unlocked
      // for the next ring.
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
    },
  };
}
