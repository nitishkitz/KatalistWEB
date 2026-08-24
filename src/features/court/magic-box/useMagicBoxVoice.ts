import { useCallback, useEffect, useRef, useState } from "react";
import { MAGIC_BOX_VOICE_MAX_MS } from "./types";
import { canStartVoice, canStopVoice, shouldTranscribeOnStop, type VoiceState } from "./voice-session";

export type { VoiceState };

export function mediaRecorderSupported(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";
}

export function useMagicBoxVoice(input: {
  accessToken?: string | null;
  onTranscript: (text: string) => void;
  onError: () => void;
  onAnnounce?: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceState>(() => (mediaRecorderSupported() ? "idle" : "unavailable"));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAt = useRef(0);
  const cancelledRef = useRef(false);
  const unmountedRef = useRef(false);
  const recordingIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<VoiceState>(mediaRecorderSupported() ? "idle" : "unavailable");
  stateRef.current = state;

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      cancelledRef.current = true;
      abortRef.current?.abort();
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      cleanup();
    };
  }, [cleanup]);

  const transcribe = useCallback(
    async (blob: Blob, durationMs: number, recordingId: number) => {
      if (
        !shouldTranscribeOnStop({
          cancelled: cancelledRef.current,
          unmounted: unmountedRef.current,
          recordingId,
          currentId: recordingIdRef.current,
          empty: blob.size === 0,
        })
      ) {
        if (!unmountedRef.current) setState(mediaRecorderSupported() ? "idle" : "unavailable");
        return durationMs;
      }
      setState("transcribing");
      input.onAnnounce?.("Recording stopped. Transcribing.");
      if (!input.accessToken) {
        setState("error");
        input.onError();
        return durationMs;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const form = new FormData();
        form.set("file", blob, "magic-box.webm");
        form.set("durationMs", String(durationMs));
        const res = await fetch("/api/magic-box/transcribe", {
          method: "POST",
          headers: { authorization: `Bearer ${input.accessToken}` },
          body: form,
          signal: controller.signal,
        });
        if (cancelledRef.current || unmountedRef.current || recordingId !== recordingIdRef.current) return durationMs;
        const json = (await res.json()) as { text?: string | null };
        if (!res.ok || !json.text) {
          setState("error");
          input.onError();
          return durationMs;
        }
        input.onTranscript(json.text);
        setState("idle");
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return durationMs;
        if (!unmountedRef.current) {
          setState("error");
          input.onError();
        }
      }
      return durationMs;
    },
    [input],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    cleanup();
    if (!unmountedRef.current) {
      setState(mediaRecorderSupported() ? "idle" : "unavailable");
      input.onAnnounce?.("Recording cancelled.");
    }
  }, [cleanup, input]);

  const stop = useCallback(() => {
    if (!canStopVoice(stateRef.current)) return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!mediaRecorderSupported()) {
      setState("unavailable");
      return;
    }
    if (!canStartVoice(stateRef.current)) return;
    cancelledRef.current = false;
    recordingIdRef.current += 1;
    const recordingId = recordingIdRef.current;
    setState("requesting-permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current || unmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAt.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Date.now() - startedAt.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        cleanup();
        void transcribe(blob, duration, recordingId);
      };
      recorder.start();
      setState("recording");
      input.onAnnounce?.("Recording started.");
      timerRef.current = window.setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      }, MAGIC_BOX_VOICE_MAX_MS);
    } catch {
      cleanup();
      setState("error");
      input.onError();
    }
  }, [cleanup, input, transcribe]);

  return { state, start, stop, cancel, supported: state !== "unavailable" };
}
