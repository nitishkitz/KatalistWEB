/** Suggestion is never auto-applied. Composer shows an explicit "Use corrected text" action. */
import { useCallback, useEffect, useRef, useState } from "react";

export type SarvamAssist = {
  requestCorrection: () => Promise<void>;
  cancel: () => void;
  busy: boolean;
  offered: string | null;
};

export function useSarvamAssist(input: {
  text: string;
  enabled: boolean;
  accessToken?: string | null;
  onSuggestion: (text: string, requestId: string) => void;
}): SarvamAssist {
  const [offered, setOffered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onSuggestionRef = useRef(input.onSuggestion);
  onSuggestionRef.current = input.onSuggestion;
  const textRef = useRef(input.text);
  textRef.current = input.text;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const requestCorrection = useCallback(async () => {
    if (!input.enabled || !input.accessToken || textRef.current.trim().length < 8) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = textRef.current;
    setBusy(true);
    try {
      const res = await fetch("/api/magic-box/correct", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({ text: snapshot, locale: "en-IN" }),
        signal: controller.signal,
      });
      if (!res.ok) return;
      const json = (await res.json()) as { requestId?: string; correctedText?: string | null };
      if (textRef.current !== snapshot) return;
      if (json.correctedText && json.correctedText !== snapshot) {
        setOffered(json.correctedText);
        onSuggestionRef.current(json.correctedText, json.requestId ?? "local");
      } else {
        setOffered(null);
      }
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setOffered(null);
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, [input.enabled, input.accessToken]);

  return { requestCorrection, cancel, busy, offered };
}
