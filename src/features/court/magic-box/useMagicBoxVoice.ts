import { useCallback, useEffect, useRef, useState } from "react";
import { MAGIC_BOX_VOICE_MAX_MS } from "./types";

export type VoiceState = "idle" | "requesting-permission" | "recording" | "transcribing" | "error" | "unavailable";

export function mediaRecorderSupported(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";
}

export function useMagicBoxVoice(input: {
  accessToken?: string | null;
  onTranscript: (text: string) => void;
  onError: () => void;
}) {
  const [state, setState] = useState<VoiceState>(() => (mediaRecorderSupported() ? "idle" : "unavailable"));
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAt = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const cancel = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
    cleanup();
    setState(mediaRecorderSupported() ? "idle" : "unavailable");
  }, [cleanup]);

  const transcribe = useCallback(
    async (blob: Blob, durationMs: number) => {
      setState("transcribing");
      if (!input.accessToken) {
        setState("error");
        input.onError();
        return durationMs;
      }
      try {
        const form = new FormData();
        form.set("file", blob, "magic-box.webm");
        form.set("durationMs", String(durationMs));
        const res = await fetch("/api/magic-box/transcribe", {
          method: "POST",
          headers: { authorization: `Bearer ${input.accessToken}` },
          body: form,
        });
        const json = (await res.json()) as { text?: string | null };
        if (!res.ok || !json.text) {
          setState("error");
          input.onError();
          return durationMs;
        }
        input.onTranscript(json.text);
        setState("idle");
      } catch {
        setState("error");
        input.onError();
      }
      return durationMs;
    },
    [input],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!mediaRecorderSupported()) {
      setState("unavailable");
      return;
    }
    setState("requesting-permission");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        void transcribe(blob, duration);
      };
      recorder.start();
      setState("recording");
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
