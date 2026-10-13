import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import type { CoeyEvent, CoeyResultFacts } from "../../../../server/lib/assistant-turn";
import type { AssistantAnswer } from "../../../../server/lib/assistant";
import { applyCoeyEvent, initialTurnState, type CoeyTurnState } from "./turn-state";
import { createSseParser } from "./sse";

export type CoeyTurnRequest = {
  question: string;
  listId?: string;
  bucketId?: string;
  scopeChoice?: { type: "list" | "bucket"; id: string };
  personChoice?: string;
  context: "work" | "home";
  history: Array<{ role: "user" | "assistant"; content: string }>;
  reuse: boolean;
  /** Structured read query from Magic Box interpretation; answered in code on the server. */
  query?: { about_person: string | null; exclude_self: boolean; state: string; window: string } | null;
};

const TURN_TIMEOUT_MS = 30_000;

export type CoeyTurn = {
  state: CoeyTurnState;
  /** True from start() until a terminal event, an error, or cancel(). */
  running: boolean;
  /** True when the first event has not arrived yet (request in flight). */
  connecting: boolean;
  error: string | null;
  answer: AssistantAnswer | null;
  facts: CoeyResultFacts | null;
  /** When the authoritative answer was applied. */
  answeredAt: number;
  start: (request: CoeyTurnRequest) => void;
  cancel: () => void;
};

/**
 * Runs one Coey turn at a time over /api/assistant/stream. Starting a new turn
 * (or unmounting) aborts the previous request, and every event is checked
 * against the current run token and the reducer's turn id, so a late event
 * from an earlier question can never change what is on screen.
 */
export function useCoeyTurn(): CoeyTurn {
  const [state, setState] = useState<CoeyTurnState>(initialTurnState);
  const [running, setRunning] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [answeredAt, setAnsweredAt] = useState(0);
  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    token.current += 1;
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback((request: CoeyTurnRequest) => {
    controller.current?.abort();
    const run = ++token.current;
    const abort = new AbortController();
    controller.current = abort;
    const current = () => token.current === run && !abort.signal.aborted;
    const apply = (event: CoeyEvent) => {
      if (!current()) return;
      setState((previous) => applyCoeyEvent(previous, event));
      if (event.type === "answer") setAnsweredAt(Date.now());
      if (event.type === "completed" || event.type === "error") setRunning(false);
    };
    setState(initialTurnState);
    setRequestError(null);
    setRunning(true);

    void (async () => {
      const fail = (message: string) => {
        if (!current()) return;
        setRequestError(message);
        setRunning(false);
      };
      try {
        const response = await authedFetch("/api/assistant/stream", {
          method: "POST",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(request),
        });
        if (!current()) return;
        if (response.status === 401) return fail("Your session expired. Sign in again to keep using Ask.");
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("text/event-stream")) {
          // Older deployments have no stream route: use the JSON route rather than failing.
          if (response.status === 404 || response.status === 405 || (response.ok && !contentType.includes("json"))) {
            return await legacyQuery(request, abort.signal, apply, fail, current);
          }
          const body = contentType.includes("json")
            ? ((await response.json().catch(() => ({}))) as { message?: string })
            : {};
          return fail(body.message || "The assistant could not answer right now.");
        }
        if (!response.body) return fail("The assistant returned an unexpected response. Please try again.");
        const parser = createSseParser();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sawTerminal = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.push(decoder.decode(value, { stream: true }))) {
            if (event.type === "completed" || event.type === "error") sawTerminal = true;
            apply(event);
          }
        }
        if (!sawTerminal) fail("The connection closed before the answer finished. Please try again.");
      } catch (cause) {
        if (abort.signal.aborted && !current()) return;
        fail(
          cause instanceof DOMException && cause.name === "TimeoutError"
            ? "The assistant took too long. Please try again."
            : "The network connection was interrupted. Check your connection and try again.",
        );
      }
    })();
  }, []);

  return {
    state,
    running,
    connecting: running && state.turnId === null,
    error: requestError ?? state.error?.message ?? null,
    answer: state.answer,
    facts: state.facts,
    answeredAt,
    start,
    cancel,
  };
}

async function legacyQuery(
  request: CoeyTurnRequest,
  signal: AbortSignal,
  apply: (event: CoeyEvent) => void,
  fail: (message: string) => void,
  current: () => boolean,
) {
  const response = await authedFetch("/api/assistant/query", {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!current()) return;
  if (!(response.headers.get("content-type") ?? "").includes("json"))
    return fail("The assistant returned an unexpected response. Please try again.");
  const body = (await response.json()) as {
    answer?: AssistantAnswer;
    facts?: CoeyResultFacts;
    message?: string;
  };
  if (response.status === 401) return fail("Your session expired. Sign in again to keep using Ask.");
  if (!response.ok || !body.answer) return fail(body.message || "The assistant could not answer right now.");
  const turnId = `legacy-${Date.now()}`;
  apply({ turnId, seq: 1, type: "accepted" });
  apply({ turnId, seq: 2, type: "answer", answer: body.answer, facts: body.facts });
  apply({ turnId, seq: 3, type: "completed" });
}
