/** Suggestion is never auto-applied. Composer shows an explicit "Use corrected text" action. */
import { useEffect, useRef, useState } from "react";
import { MAGIC_BOX_AI_DEBOUNCE_MS } from "./types";

export function useSarvamAssist(input: {
  text: string;
  enabled: boolean;
  accessToken?: string | null;
  onSuggestion: (text: string, requestId: string) => void;
}) {
  const [offered, setOffered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSeq = useRef(0);
  const onSuggestionRef = useRef(input.onSuggestion);
  onSuggestionRef.current = input.onSuggestion;

  useEffect(() => {
    if (!input.enabled || !input.accessToken || input.text.trim().length < 8) {
      setOffered(null);
      return;
    }
    const seq = ++requestSeq.current;
    const handle = window.setTimeout(() => {
      const controller = new AbortController();
      setBusy(true);
      void fetch("/api/magic-box/correct", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({ text: input.text, locale: "en-IN" }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (seq !== requestSeq.current) return;
          if (!res.ok) return;
          const json = (await res.json()) as { requestId?: string; correctedText?: string | null };
          if (json.correctedText && json.correctedText !== input.text) {
            setOffered(json.correctedText);
            onSuggestionRef.current(json.correctedText, json.requestId ?? `local-${seq}`);
          } else {
            setOffered(null);
          }
        })
        .catch(() => {
          if (seq === requestSeq.current) setOffered(null);
        })
        .finally(() => {
          if (seq === requestSeq.current) setBusy(false);
        });
    }, MAGIC_BOX_AI_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
      requestSeq.current += 1;
    };
  }, [input.text, input.enabled, input.accessToken]);

  return { offered, busy };
}
