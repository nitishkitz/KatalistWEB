export type VoiceState = "idle" | "requesting-permission" | "recording" | "transcribing" | "error" | "unavailable";

export function shouldTranscribeOnStop(input: {
  cancelled: boolean;
  unmounted: boolean;
  recordingId: number;
  currentId: number;
  empty: boolean;
}): boolean {
  if (input.cancelled || input.unmounted) return false;
  if (input.recordingId !== input.currentId) return false;
  if (input.empty) return false;
  return true;
}

export function canStartVoice(state: VoiceState): boolean {
  return state === "idle" || state === "error";
}

export function canStopVoice(state: VoiceState): boolean {
  return state === "recording";
}
