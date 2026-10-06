import {
  GATE_COLUMN_X,
  GATE_DOOR_CLOSED,
  GATE_DOOR_OPEN,
  GATE_FPS,
  GATE_TIMES,
  GATE_TRACK,
  GATE_VIDEO_H,
  GATE_VIDEO_W,
  GATE_WELCOME_LEFT,
  GATE_WELCOME_RIGHT,
} from "./scene-track";

/**
 * Imperative driver for the sign-in gate scene: maps the tracked video onto
 * the viewport, keeps the code ring pinned to Coey's ball dock, slides the
 * wall column with the gate, and plays/rewinds the clip between poses.
 *
 * It runs per animation frame, so it writes to the DOM directly instead of
 * through React state. React owns which step is rendered; this owns motion.
 * It only toggles classes on elements whose `className` prop never changes.
 */
export type GateSceneElements = {
  root: HTMLElement;
  video: HTMLVideoElement;
  ring: SVGSVGElement;
  ringPos: SVGGElement;
  ringTime: SVGCircleElement;
  litSegments: SVGCircleElement[];
  column: HTMLElement;
  welcome: HTMLElement;
};

const DOCK_LAST_T = 84 / GATE_FPS;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function sample(arr: number[], f: number): number;
function sample(arr: number[][], f: number): number[];
function sample(arr: number[] | number[][], f: number): number | number[] {
  const at = clamp(f, 0, arr.length - 1);
  const i = Math.floor(at);
  const j = Math.min(arr.length - 1, i + 1);
  const u = at - i;
  const a = arr[i];
  const b = arr[j];
  if (Array.isArray(a)) return a.map((x, k) => x + ((b as number[])[k] - x) * u);
  return a + ((b as number) - a) * u;
}

const dockAt = (t: number) => sample(GATE_TRACK.dock, t * GATE_FPS);
const stripAt = (t: number) => sample(GATE_TRACK.strip, t * GATE_FPS);

export class GateScene {
  private readonly els: GateSceneElements;
  private reduce: boolean;
  private restAt: number = GATE_TIMES.contact;
  private raf = 0;
  private job = 0;
  private destroyed = false;
  // Media time of the frame the compositor last presented. video.currentTime
  // runs ahead of / out of step with what is on screen while playing, so a
  // ring pinned to it visibly slips against the dock it should sit on.
  private shownT: number | null = null;
  private frameCb = 0;
  private geo = { s: 1, left: 0, top: 0, stacked: false };
  private fx = {
    ring: false,
    leave: null as null | { strip: number; ry: number },
    spinAt: 0,
    shakeAt: 0,
    welcome: false,
  };

  constructor(els: GateSceneElements, reduce: boolean) {
    this.els = els;
    this.reduce = reduce;
  }

  get stacked() {
    return this.geo.stacked;
  }

  /**
   * `unlocked` resumes on the finished gate (after IdentityBoundary's
   * sign-in remount) instead of the opening pose.
   */
  start({ unlocked = false } = {}) {
    this.restAt = unlocked ? GATE_TIMES.end : GATE_TIMES.contact;
    if (unlocked) this.els.welcome.style.setProperty("--kg-mx", "0%");
    this.layout();
    window.addEventListener("resize", this.layout);
    this.raf = requestAnimationFrame(this.tick);
    const { video } = this.els;
    this.watchFrames();
    if (video.readyState > 0) this.seekToRest();
    else video.addEventListener("loadeddata", this.onLoaded, { once: true });
  }

  destroy() {
    this.destroyed = true;
    this.job++;
    cancelAnimationFrame(this.raf);
    if (this.frameCb) this.els.video.cancelVideoFrameCallback?.(this.frameCb);
    window.removeEventListener("resize", this.layout);
    this.els.video.removeEventListener("loadeddata", this.onLoaded);
  }

  setReducedMotion(reduce: boolean) {
    this.reduce = reduce;
  }

  private watchFrames() {
    const { video } = this.els;
    if (!video.requestVideoFrameCallback) return;
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      this.shownT = meta.mediaTime;
      this.frameCb = video.requestVideoFrameCallback(onFrame);
    };
    this.frameCb = video.requestVideoFrameCallback(onFrame);
  }

  /** The time of the frame actually on screen. */
  private shownTime() {
    const { video } = this.els;
    if (video.paused || video.seeking || this.shownT === null) return video.currentTime || 0;
    return this.shownT;
  }

  private onLoaded = () => {
    if (this.els.video.currentTime < 0.05) this.seekToRest();
  };

  private seekToRest() {
    const { duration } = this.els.video;
    this.seek(duration ? Math.min(this.restAt, duration - 0.02) : this.restAt);
  }

  /** The frame currently on screen, for a seamless poster after a remount. */
  captureFrame(): string | null {
    const { video } = this.els;
    if (video.readyState < 2 || !video.videoWidth) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.88);
    } catch {
      return null;
    }
  }

  /* ---------- Geometry: map video pixels to the screen ---------- */

  private layout = () => {
    const { root, video } = this.els;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const stacked = vw < 720 || vw / vh < 1.15;
    root.dataset.stacked = stacked ? "true" : "false";
    const style = root.style;
    let s: number;
    let left: number;
    let top: number;
    if (!stacked) {
      const pad = Math.max(24, vw * 0.028);
      const need = clamp(vw * 0.21, 290, 430);
      const cover = Math.max(vw / GATE_VIDEO_W, vh / GATE_VIDEO_H);
      // Push the camera in slightly (anchored right) only when the wall is
      // too narrow for the form.
      s = Math.min(cover * 1.3, Math.max(cover, (need + pad) / (GATE_VIDEO_W - GATE_COLUMN_X)));
      left = clamp(
        Math.min((vw - GATE_VIDEO_W * s) / 2, vw - pad - need - GATE_COLUMN_X * s),
        vw - GATE_VIDEO_W * s,
        0,
      );
      top = (vh - GATE_VIDEO_H * s) / 2;
      const cx = left + GATE_COLUMN_X * s;
      style.setProperty("--kg-col-x", `${cx}px`);
      style.setProperty("--kg-col-w", `${Math.max(250, vw - pad - cx)}px`);
      const wx = left + GATE_WELCOME_LEFT * s;
      style.setProperty("--kg-w-x", `${wx}px`);
      style.setProperty("--kg-w-w", `${Math.min(left + GATE_WELCOME_RIGHT * s, vw - pad) - wx}px`);
    } else {
      const sh = Math.round(vh * (vw > vh ? 0.58 : 0.5));
      style.setProperty("--kg-stage-h", `${sh}px`);
      style.setProperty("--kg-col-w", `${Math.min(vw, 520) - 44}px`);
      s = Math.max(vw / GATE_VIDEO_W, sh / GATE_VIDEO_H);
      left = clamp(vw / 2 - 0.42 * GATE_VIDEO_W * s, vw - GATE_VIDEO_W * s, 0);
      top = (sh - GATE_VIDEO_H * s) / 2;
    }
    this.geo = { s, left, top, stacked };
    Object.assign(video.style, {
      width: `${GATE_VIDEO_W * s}px`,
      height: `${GATE_VIDEO_H * s}px`,
      left: `${left}px`,
      top: `${top}px`,
    });
  };

  /* ---------- Per-frame sync: ring on the dock, UI on the wall, gate reveal ---------- */

  private tick = (now: number) => {
    if (this.destroyed) return;
    const { video, ringPos, column, welcome, root } = this.els;
    const { fx, geo } = this;
    const t = this.shownTime();

    if (fx.ring && t > 3.3) fx.ring = false;
    if (fx.ring) {
      const [cx, cy, rx, ry] = dockAt(Math.min(t, DOCK_LAST_T));
      const k = (ry * geo.s) / 100;
      const sx = rx / ry;
      let dx = 0;
      let ang = 0;
      if (fx.shakeAt) {
        const e = (now - fx.shakeAt) / 1000;
        if (e < 0.5) dx = Math.sin(e * 52) * (1 - e / 0.5) * 8;
        else fx.shakeAt = 0;
      }
      if (fx.spinAt && !this.reduce) {
        const e = (now - fx.spinAt) / 1000;
        ang = 420 * e * e;
      }
      ringPos.setAttribute(
        "transform",
        `translate(${(geo.left + cx * geo.s + dx).toFixed(2)} ${(geo.top + cy * geo.s).toFixed(2)}) scale(${(k * sx).toFixed(4)} ${k.toFixed(4)}) rotate(${ang.toFixed(2)})`,
      );
    }

    if (fx.leave && !geo.stacked) {
      const ry = dockAt(Math.min(t, DOCK_LAST_T))[3];
      const dxs = (stripAt(t) - fx.leave.strip) * geo.s;
      column.style.transform = `translateX(${dxs.toFixed(1)}px) scale(${(ry / fx.leave.ry).toFixed(4)})`;
    }

    // The progress line follows the camera along its path.
    const p =
      t <= GATE_TIMES.code
        ? (t / GATE_TIMES.code) * 0.5
        : 0.5 + 0.5 * clamp((t - GATE_TIMES.code) / (5.0 - GATE_TIMES.code), 0, 1);
    root.style.setProperty("--kg-p", p.toFixed(4));

    if (fx.welcome && !geo.stacked && !this.reduce) {
      const q = clamp((GATE_DOOR_CLOSED - stripAt(t)) / (GATE_DOOR_CLOSED - GATE_DOOR_OPEN), 0, 1);
      welcome.style.setProperty("--kg-mx", `${((1 - q) * 100).toFixed(2)}%`);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /* ---------- Video choreography ---------- */

  private seek(t: number) {
    const { video } = this.els;
    video.pause();
    try {
      video.currentTime = t;
    } catch {
      // Seeking before metadata loads throws in some browsers; the
      // loadeddata handler re-seeks to the resting pose.
    }
  }

  playTo(t: number): Promise<void> {
    const my = ++this.job;
    const { video } = this.els;
    return new Promise((resolve) => {
      const end = Math.min(t, (video.duration || 5.04) - 0.02);
      if (this.reduce || video.readyState === 0 || video.currentTime >= end - 0.001) {
        this.seek(end);
        resolve();
        return;
      }
      const watch = () => {
        if (my !== this.job) return resolve();
        if (video.currentTime >= end || video.ended) {
          // Stop on the frame we reached. Seeking back to `end` after a
          // one-frame overshoot made the picture hop backwards and re-decode
          // (a visible stutter); the tracking reads the real time, so the
          // pose is still correct. Only correct a clearly late stop.
          video.pause();
          if (video.currentTime - end > 3 / GATE_FPS) this.seek(end);
          resolve();
        } else requestAnimationFrame(watch);
      };
      const played = video.play();
      (played ?? Promise.resolve()).then(
        () => requestAnimationFrame(watch),
        () => {
          this.seek(end);
          resolve();
        },
      );
    });
  }

  reverseTo(t: number, duration = 900): Promise<void> {
    const my = ++this.job;
    const { video } = this.els;
    video.pause();
    return new Promise((resolve) => {
      if (this.reduce || video.readyState === 0) {
        this.seek(t);
        resolve();
        return;
      }
      const from = video.currentTime;
      const t0 = performance.now();
      const step = () => {
        if (my !== this.job) return resolve();
        const e = Math.min(1, (performance.now() - t0) / duration);
        const k = 1 - Math.pow(1 - e, 3);
        let done = false;
        const next = () => {
          if (done) return;
          done = true;
          if (e < 1) requestAnimationFrame(step);
          else resolve();
        };
        video.addEventListener("seeked", next, { once: true });
        setTimeout(next, 120);
        video.currentTime = from + (t - from) * k;
      };
      step();
    });
  }

  /* ---------- Wall column ---------- */

  leaveColumn() {
    const t = this.els.video.currentTime || 0;
    this.fx.leave = { strip: stripAt(t), ry: dockAt(Math.min(t, DOCK_LAST_T))[3] };
    this.els.column.classList.add("is-leaving");
  }

  returnColumn() {
    this.fx.leave = null;
    this.els.column.style.transform = "";
    this.els.column.classList.remove("is-leaving");
  }

  /* ---------- Code ring ---------- */

  showRing() {
    const { ring } = this.els;
    ring.classList.remove("is-fading", "is-error", "is-charging", "is-expired", "is-waiting");
    this.fx.ring = true;
    this.fx.spinAt = 0;
    requestAnimationFrame(() => ring.classList.add("is-shown"));
  }

  /**
   * While the visitor fills in their details the dock stays alive: the dial
   * breathes slowly and one pair of segments lights per finished field, so
   * the scene reads as "almost unlocked" instead of a frozen frame.
   */
  holdForProfile() {
    const { ring } = this.els;
    ring.classList.remove("is-fading", "is-error", "is-charging", "is-expired");
    ring.classList.add("is-waiting");
    this.setTimeLeft(0);
    this.fx.ring = true;
    requestAnimationFrame(() => ring.classList.add("is-shown"));
  }

  hideRing() {
    this.els.ring.classList.remove("is-waiting");
    this.els.ring.classList.remove("is-shown", "is-charging");
    this.fx.ring = false;
  }

  setLit(count: number) {
    this.els.litSegments.forEach((seg, i) => seg.classList.toggle("is-on", i < count));
  }

  /** Fraction of the code's lifetime remaining, 0-1. */
  setTimeLeft(fraction: number) {
    this.els.ringTime.setAttribute("stroke-dasharray", `${(270 * clamp(fraction, 0, 1)).toFixed(2)} 360`);
  }

  setExpired(expired: boolean) {
    this.els.ring.classList.toggle("is-expired", expired);
    if (expired) this.setLit(0);
  }

  charge() {
    this.els.ring.classList.add("is-charging");
  }

  reject() {
    const { ring } = this.els;
    ring.classList.remove("is-charging");
    ring.classList.add("is-error");
    this.fx.shakeAt = performance.now();
  }

  clearError() {
    this.els.ring.classList.remove("is-error");
  }

  /* ---------- Sequences ---------- */

  /** Coey walks up and docks the ball while the code is sent. */
  walkToCode() {
    return this.playTo(GATE_TIMES.code);
  }

  /** Coey steps back to the opening pose. */
  backToContact(duration = 900) {
    return this.reverseTo(GATE_TIMES.contact, duration);
  }

  /** Back to the holding pose after a rejected code. */
  backToCode(duration = 500) {
    return this.reverseTo(GATE_TIMES.code, duration);
  }

  /** The dock lights up while the code is checked. */
  glow() {
    return this.playTo(GATE_TIMES.glow);
  }

  /**
   * Retrieve the ball, push, and glide the gate open. `reveal` is called
   * when the welcome should become visible -- as the gate passes it on wide
   * layouts, or once the clip finishes on stacked / reduced-motion layouts.
   */
  async unlock(reveal: () => void) {
    const { ring, welcome, video } = this.els;
    ring.classList.remove("is-charging", "is-waiting");
    this.fx.spinAt = performance.now();
    ring.classList.add("is-fading");
    this.leaveColumn();
    const finale = this.playTo(GATE_TIMES.end);
    const show = () => {
      if (!this.reduce && !this.geo.stacked) welcome.style.setProperty("--kg-mx", "100%");
      this.fx.welcome = true;
      reveal();
    };
    if (this.geo.stacked || this.reduce) {
      await finale;
      show();
    } else {
      let revealed = false;
      const until = () => {
        if (this.destroyed || revealed) return;
        if (video.currentTime >= GATE_TIMES.welcome || video.paused) {
          revealed = true;
          show();
        } else requestAnimationFrame(until);
      };
      until();
      await finale;
      if (!revealed) {
        revealed = true;
        show();
      }
    }
    this.fx.ring = false;
  }
}
