import type { CoeyEvent, CoeyResultFacts, CoeyStage } from "../../../../server/lib/assistant-turn";
import type { AssistantAnswer } from "../../../../server/lib/assistant";

export type CoeyTurnState = {
  turnId: string | null;
  lastSeq: number;
  status: { stage: CoeyStage; text: string } | null;
  draft: string;
  answer: AssistantAnswer | null;
  facts: CoeyResultFacts | null;
  proposedActionIds: string[];
  terminal: "completed" | "error" | null;
  error: { code: string; message: string } | null;
};

export const initialTurnState: CoeyTurnState = {
  turnId: null,
  lastSeq: 0,
  status: null,
  draft: "",
  answer: null,
  facts: null,
  proposedActionIds: [],
  terminal: null,
  error: null,
};

/** Begins a new turn. Any state from an earlier turn is discarded. */
export function startTurn(turnId: string | null = null): CoeyTurnState {
  return { ...initialTurnState, turnId };
}

/**
 * Pure reducer. Events from another turn, duplicates, out-of-order sequence
 * numbers, and anything after a terminal event are ignored, so a late event
 * from an earlier question can never change the visible answer.
 */
export function applyCoeyEvent(state: CoeyTurnState, event: CoeyEvent): CoeyTurnState {
  if (state.terminal) return state;
  // The first event of a turn binds its server-generated id.
  if (state.turnId === null) {
    if (event.type !== "accepted") return state;
    state = { ...state, turnId: event.turnId };
  } else if (event.turnId !== state.turnId) return state;
  if (event.seq <= state.lastSeq) return state;
  const next = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "accepted":
      return next;
    case "status":
      return { ...next, status: { stage: event.stage, text: event.text } };
    case "facts_ready":
      return next;
    case "text_delta":
      return { ...next, draft: next.draft + event.text };
    case "answer":
      return { ...next, answer: event.answer, facts: event.facts ?? null, status: null, draft: "" };
    case "action_proposed":
      // Proposals are only actionable once the authoritative answer has arrived.
      return next.answer && !next.proposedActionIds.includes(event.action.id)
        ? { ...next, proposedActionIds: [...next.proposedActionIds, event.action.id] }
        : next;
    case "completed":
      return { ...next, status: null, terminal: "completed" };
    case "error":
      return {
        ...next,
        status: null,
        terminal: "error",
        error: { code: event.code, message: event.message },
      };
  }
}
