import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { COEY_CONFIG } from "@/domain/coey/config";
import { INTERPRETATION_SCHEMA_VERSION, type Interpretation, type InterpretResponse } from "@/domain/coey/contract";

export type InterpretationState =
  | { status: "idle" }
  | { status: "pending"; revision: number }
  | { status: "ready"; revision: number; text: string; interpretation: Interpretation }
  | { status: "failed"; revision: number; text: string; reason: Extract<InterpretResponse, { ok: false }>["reason"] | "network" };

/** Client deadline: the server's provider deadline plus network allowance. */
const CLIENT_DEADLINE_MS = COEY_CONFIG.F10_STAGE2_TIMEOUT_MS + 2500;

/**
 * Interprets the current draft after a pause (F10). Each draft text has a
 * revision; a reply is applied only if it answers the latest revision, so a
 * late response can never overwrite newer typing. At most one request is in
 * flight; a newer revision aborts the older one.
 */
export function useCoeyInterpretation(text: string, mode: "work" | "home", enabled: boolean) {
  const [state, setState] = useState<InterpretationState>({ status: "idle" });
  const revision = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const latest = useRef<{ revision: number; text: string; promise: Promise<InterpretationState> } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const run = useCallback((value: string, rev: number): Promise<InterpretationState> => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setState({ status: "pending", revision: rev });
    const requestId = `${rev}-${Math.random().toString(36).slice(2, 10)}`;
    const promise = (async (): Promise<InterpretationState> => {
      try {
        const res = await authedFetch("/api/coey/interpret", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schema_version: INTERPRETATION_SCHEMA_VERSION, text: value, mode, request_id: requestId, draft_revision: rev }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CLIENT_DEADLINE_MS)]),
        });
        const body = (await res.json().catch(() => null)) as InterpretResponse | null;
        if (!res.ok || !body) return { status: "failed", revision: rev, text: value, reason: res.status === 429 ? "rate_limited" : "unavailable" };
        if (body.request_id !== requestId || body.draft_revision !== rev) return { status: "failed", revision: rev, text: value, reason: "invalid_output" };
        return body.ok
          ? { status: "ready", revision: rev, text: value, interpretation: body.interpretation }
          : { status: "failed", revision: rev, text: value, reason: body.reason };
      } catch {
        return { status: "failed", revision: rev, text: value, reason: controller.signal.aborted ? "timeout" : "network" };
      }
    })();
    latest.current = { revision: rev, text: value, promise };
    void promise.then((result) => {
      if (rev === revision.current && !controller.signal.aborted) setState(result);
    });
    return promise;
  }, [mode]);

  useEffect(() => {
    revision.current += 1;
    const rev = revision.current;
    if (!enabled || !text.trim()) {
      inflight.current?.abort();
      latest.current = null;
      setState({ status: "idle" });
      return;
    }
    const timer = window.setTimeout(() => void run(text, rev), COEY_CONFIG.F10_STAGE2_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, mode, enabled, run]);

  useEffect(() => () => inflight.current?.abort(), []);

  /** On send: reuse the result for this exact revision, else interpret now. */
  const resolveNow = useCallback(async (): Promise<InterpretationState> => {
    const rev = revision.current;
    const value = textRef.current;
    if (latest.current && latest.current.revision === rev && latest.current.text === value) return latest.current.promise;
    return run(value, rev);
  }, [run]);

  const retry = useCallback(() => {
    void run(textRef.current, revision.current);
  }, [run]);

  /** True when the state belongs to the text currently in the composer. */
  const isCurrent = (s: InterpretationState) => s.status !== "idle" && s.revision === revision.current;

  return { state, resolveNow, retry, isCurrent };
}
