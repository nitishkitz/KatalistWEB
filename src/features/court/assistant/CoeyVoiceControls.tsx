import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { useId, useState } from "react";
import type { CoeyVoice } from "./use-coey-voice";
import type { VoicePhase } from "../../../../server/lib/assistant-voice-protocol";

const LABEL: Record<VoicePhase, string> = {
  idle: "Voice off",
  connecting: "Connecting",
  listening: "Listening",
  transcribing: "Transcribing",
  checking: "Checking your Court",
  speaking: "Speaking",
  action_ready: "Waiting for your yes or no",
  error: "Voice problem",
};

/**
 * Voice stays discoverable even when unavailable. Its help never captures
 * audio or starts a session; only a ready Talk control can do that.
 */
export function CoeyVoiceControls({ voice, actionReady = false }: { voice: CoeyVoice; actionReady?: boolean }) {
  const [showReason, setShowReason] = useState(false);
  const reasonId = useId();
  if (!voice.enabled || !voice.supported)
    return (
      <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-0 sm:flex-1" data-testid="coey-voice" data-voice-phase="unavailable">
        <button type="button" aria-label="Voice unavailable — details" aria-expanded={showReason} aria-controls={reasonId} onClick={() => setShowReason((show) => !show)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <MicOff className="h-4 w-4" aria-hidden="true" />
          Talk <span className="text-slate-500">· unavailable</span>
        </button>
        {showReason ? <div id={reasonId} role="note" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 text-slate-700 shadow-sm">
          {voice.supported ? "Voice is not available in this workspace yet. You can keep using typed Ask." : "Voice is not supported in this browser. Typing still works."}
        </div> : null}
      </div>
    );
  const phase: VoicePhase = actionReady && voice.phase === "listening" ? "action_ready" : voice.phase;
  const busy = phase === "connecting";
  return (
    <div className={`flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-0 sm:flex-1 ${voice.active || voice.error ? "rounded-lg bg-white/95 p-1.5 ring-1 ring-slate-200" : ""}`} data-testid="coey-voice" data-voice-phase={phase}>
      {voice.active ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700" role="status" aria-live="polite">
            <span
              className={`h-1.5 w-1.5 rounded-full bg-red-500 ${voice.muted ? "opacity-30" : "motion-safe:animate-pulse"}`}
              aria-hidden="true"
              data-testid="coey-mic-indicator"
            />
            {voice.muted ? "Microphone muted" : "Microphone on"} · {LABEL[phase]}
          </span>
          <button
            type="button"
            onClick={voice.toggleMute}
            aria-pressed={voice.muted}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {voice.muted ? <MicOff className="h-3 w-3" aria-hidden="true" /> : <Mic className="h-3 w-3" aria-hidden="true" />}
            {voice.muted ? "Unmute" : "Mute"}
          </button>
          {phase === "speaking" && (
            <button
              type="button"
              onClick={voice.interrupt}
              className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Stop speaking
            </button>
          )}
          <button
            type="button"
            onClick={voice.stop}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <Square className="h-3 w-3" aria-hidden="true" /> End voice
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void voice.start()}
          disabled={busy}
          aria-label="Talk to Coey"
          className="inline-flex min-h-7 items-center gap-1 rounded-md border border-violet-200 bg-white px-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Mic className="h-3 w-3" aria-hidden="true" />}
          Talk
        </button>
      )}
      {(voice.partial || (voice.active && voice.transcript)) && (
        <p className="w-full truncate text-xs text-slate-600" aria-live="polite" data-testid="coey-caption">
          {voice.partial ? `You: ${voice.partial}…` : `You: ${voice.transcript?.text}`}
        </p>
      )}
      {voice.error && (
        <p className="w-full text-xs text-red-700" role="alert">
          {voice.error}
        </p>
      )}
    </div>
  );
}
