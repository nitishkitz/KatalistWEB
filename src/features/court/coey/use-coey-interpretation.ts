import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { COEY_CONFIG } from "@/domain/coey/config";
import { INTERPRETATION_SCHEMA_VERSION, type Interpretation, type InterpretResponse } from "@/domain/coey/contract";

export type InterpretationState =
  | { status: "idle" }
  | { status: "pending"; revision: number }
  | { status: "ready"; revision: number; text: string; interpretation: Interpretation }
  | { status: "failed"; revision: number; text: string; reason: Extract<InterpretResponse, { ok: false }>["reason"] | "network" };

/** Overall deadline covers two provider attempts plus auth/network allowance. */
const CLIENT_DEADLINE_MS = 2 * COEY_CONFIG.F10_STAGE2_TIMEOUT_MS + 5000;
const RECOVERY_DELAY_MS = 250;
const isTransient = (result: InterpretationState) => result.status === "failed" &&
  (result.reason === "network" || result.reason === "timeout" || result.reason === "unavailable");

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
  const latest = useRef<{ revision: number; text: string; promise: Promise<InterpretationState>; result?: InterpretationState } | null>(null);
  const timerRef = useRef<number | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const run = useCallback((value: string, rev: number): Promise<InterpretationState> => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setState({ status: "pending", revision: rev });
    const requestId = `${rev}-${Math.random().toString(36).slice(2, 10)}`;
    const deadline = AbortSignal.timeout(CLIENT_DEADLINE_MS);
    const signal = AbortSignal.any([controller.signal, deadline]);
    const failed = (reason: Extract<InterpretationState, { status: "failed" }>["reason"]): InterpretationState =>
      ({ status: "failed", revision: rev, text: value, reason });
    const attempt = async (): Promise<{ result: InterpretationState; recover: boolean }> => {
      try {
        const res = await authedFetch("/api/coey/interpret", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schema_version: INTERPRETATION_SCHEMA_VERSION, text: value, mode, request_id: requestId, draft_revision: rev }),
          signal,
        });
        const body = (await res.json().catch(() => null)) as InterpretResponse | null;
        // Never retry auth, schema conflicts, validation or rate-limit responses.
        if (!res.ok || !body) return {
          result: failed(res.status === 429 ? "rate_limited" : "unavailable"),
          recover: [408, 500, 502, 503, 504].includes(res.status),
        };
        if (body.request_id !== requestId || body.draft_revision !== rev)
          return { result: failed("invalid_output"), recover: false };
        const result: InterpretationState = body.ok
          ? { status: "ready", revision: rev, text: value, interpretation: body.interpretation }
          : failed(body.reason);
        return { result, recover: isTransient(result) };
      } catch {
        return { result: failed(signal.aborted ? "timeout" : "network"), recover: !signal.aborted };
      }
    };
    const promise = (async (): Promise<InterpretationState> => {
      const first = await attempt();
      if (!first.recover || signal.aborted || rev !== revision.current) return first.result;
      // Interpretation is read-only: one bounded retry cannot create duplicate Things.
      // Keep the composer pending throughout recovery rather than flashing an error.
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, RECOVERY_DELAY_MS);
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
      if (signal.aborted || rev !== revision.current) return first.result;
      return (await attempt()).result;
    })();
    latest.current = { revision: rev, text: value, promise };
    void promise.then((result) => {
      if (latest.current?.promise === promise) latest.current.result = result;
      if (rev === revision.current && !controller.signal.aborted && inflight.current === controller) setState(result);
    });
    return promise;
  }, [mode]);

  useEffect(() => {
    revision.current += 1;
    const rev = revision.current;
    // Cancel immediately on edits/context changes, including recovery during the debounce.
    inflight.current?.abort();
    latest.current = null;
    setState({ status: "idle" });
    if (!enabled || !text.trim()) {
      inflight.current?.abort();
      latest.current = null;
      setState({ status: "idle" });
      return;
    }
    // The pause timer reuses a request already started for this revision (e.g. by Send).
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (latest.current?.revision === rev && latest.current.text === text) return;
      void run(text, rev);
    }, COEY_CONFIG.F10_STAGE2_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [text, mode, enabled, run]);

  useEffect(() => () => inflight.current?.abort(), []);

  /** On send: reuse the result for this exact revision, else interpret now. */
  const resolveNow = useCallback(async (): Promise<InterpretationState> => {
    const rev = revision.current;
    const value = textRef.current;
    // Send supersedes the pending pause: it must never abort the request Send awaits.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (latest.current && latest.current.revision === rev && latest.current.text === value &&
      !(latest.current.result && isTransient(latest.current.result))) return latest.current.promise;
    return run(value, rev);
  }, [run]);

  const retry = useCallback(() => {
    void run(textRef.current, revision.current);
  }, [run]);

  /** True when the state belongs to the text currently in the composer. */
  const isCurrent = (s: InterpretationState) => s.status !== "idle" && s.revision === revision.current;

  return { state, resolveNow, retry, isCurrent };
}
