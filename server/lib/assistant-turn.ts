import type { AssistantAnswer, AssistantFacts } from "./assistant";

/**
 * Typed event envelope for one Coey turn. `answer` is authoritative; `text_delta`
 * carries only already-grounded deterministic text, never raw model tokens.
 * `completed` and `error` are terminal.
 */
export type CoeyStage = "reading_facts" | "calling_model" | "preparing_action";

export type CoeyEvent =
  | { turnId: string; seq: number; type: "accepted" }
  | { turnId: string; seq: number; type: "status"; stage: CoeyStage; text: string }
  | { turnId: string; seq: number; type: "facts_ready"; summary: AssistantFacts["summary"] }
  | { turnId: string; seq: number; type: "text_delta"; text: string }
  | { turnId: string; seq: number; type: "answer"; answer: AssistantAnswer; facts?: CoeyResultFacts }
  | { turnId: string; seq: number; type: "action_proposed"; action: AssistantAnswer["actions"][number] }
  | { turnId: string; seq: number; type: "completed"; timings?: TurnTimings }
  | { turnId: string; seq: number; type: "error"; code: string; message: string };

/** The same authorized result fields the JSON query route already returns; never the full facts. */
export type CoeyResultFacts = {
  scope: AssistantFacts["scope"] | null;
  summary?: AssistantFacts["summary"] | null;
  things: AssistantFacts["things"];
  nudge_recommendations: AssistantFacts["nudge_recommendations"];
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the emitter stamps its turn id and sequence number. */
export type CoeyEventDraft = DistributiveOmit<CoeyEvent, "turnId" | "seq">;

export function makeTurnId(): string {
  return globalThis.crypto.randomUUID();
}

/** One Server-Sent Event frame. JSON is single-line, so no data-line splitting is needed. */
export function encodeCoeyEvent(event: CoeyEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parses the `data:` payload of one SSE frame; returns null for anything malformed. */
export function decodeCoeyEvent(data: string): CoeyEvent | null {
  try {
    const value = JSON.parse(data) as Partial<CoeyEvent> | null;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.turnId !== "string" ||
      typeof value.seq !== "number" ||
      typeof value.type !== "string"
    )
      return null;
    return value as CoeyEvent;
  } catch {
    return null;
  }
}

/** Monotonic sequence source for one turn. */
export function makeTurnEmitter(turnId: string) {
  let seq = 0;
  return {
    turnId,
    next(event: CoeyEventDraft): CoeyEvent {
      seq += 1;
      return { ...event, turnId, seq } as CoeyEvent;
    },
  };
}

/** Server timing points. Durations only, never content. */
export type TurnTimings = {
  authMs?: number;
  scopeMs?: number;
  factsMs?: number;
  modelMs?: number;
  totalMs?: number;
  route?: "greeting" | "fast" | "model" | "clarify";
};

export function makeTimer(now: () => number = () => performance.now()) {
  const start = now();
  let last = start;
  const timings: TurnTimings = {};
  return {
    timings,
    mark(key: "authMs" | "scopeMs" | "factsMs" | "modelMs") {
      const t = now();
      timings[key] = Math.round(t - last);
      last = t;
    },
    skip() {
      last = now();
    },
    finish() {
      timings.totalMs = Math.round(now() - start);
      return timings;
    },
  };
}
