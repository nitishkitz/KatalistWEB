import type { SupabaseClient } from "@supabase/supabase-js";
import {
  answerAssistantQuestion,
  buildAssistantFacts,
  buildScopeAnswer,
  classifyAssistantIntent,
  type AssistantAnswer,
  type AssistantFacts,
} from "./assistant";
import { wantsActivity } from "./assistant-activity";
import { buildFastAnswer, buildGreetingAnswer, buildOutOfScopeAnswer } from "./assistant-fast-answer";
import {
  DeadlineError,
  factsCacheKey,
  getCachedFacts,
  setCachedFacts,
  withDeadline,
} from "./assistant-limits";
import { routeCoeyQuestion } from "./assistant-routing";
import { resolveAssistantScope, verifyScopeChoice } from "./assistant-scope";
import {
  encodeCoeyEvent,
  makeTimer,
  makeTurnEmitter,
  type CoeyEvent,
  type CoeyResultFacts,
  type TurnTimings,
} from "./assistant-turn";
import type { AssistantConversationTurn } from "./assistant";
import { groundWindow, loadSchedulesForFacts, mergeFollowUp, parseStructuredQuery, progressAnswer, structuredAnswer, type StructuredQuery } from "./coey/ask";
import { interpretLine } from "./coey/interpret";

export type TurnInput = {
  question: string;
  listId?: string;
  bucketId?: string;
  context: "work" | "home";
  history: AssistantConversationTurn[];
  scopeChoice?: { type: "list" | "bucket"; id: string };
  personChoice?: string;
  reuse?: boolean;
  /** Set when the Magic Box interpreted the line as a question (C0a): answered in code, no keyword routing. */
  query?: StructuredQuery | null;
  /** The structured query of the previous answer in this conversation. */
  previousQuery?: StructuredQuery | null;
};

/**
 * Seams for tests. Production passes the real implementations; the stream route
 * therefore applies exactly the scope, facts and action rules of the JSON route.
 */
export type TurnDeps = {
  client: SupabaseClient;
  userId: string;
  resolveScope: typeof resolveAssistantScope;
  verifyChoice: typeof verifyScopeChoice;
  buildFacts: typeof buildAssistantFacts;
  answer: typeof answerAssistantQuestion;
  /**
   * Interprets a typed Ask line (and its follow-ups) into a structured read
   * query, so every entry point uses the same code-executed answer. Null means
   * "not a structured question" (e.g. an action request) or unavailable.
   */
  interpretQuestion?: (question: string, history: AssistantConversationTurn[], context: "work" | "home", signal: AbortSignal, previousQuery: StructuredQuery | null) => Promise<StructuredQuery | null>;
  log?: (entry: Record<string, unknown>) => void;
};

export const defaultTurnDeps = (client: SupabaseClient, userId: string): TurnDeps => ({
  client,
  userId,
  resolveScope: resolveAssistantScope,
  verifyChoice: verifyScopeChoice,
  buildFacts: buildAssistantFacts,
  answer: answerAssistantQuestion,
  interpretQuestion: async (question, history, context, signal, previousQuery) => {
    const { data: profile } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    const earlierQuestions = history.filter((t) => t.role === "user").map((t) => t.content);
    const result = await interpretLine(question, {
      timezone: (profile as { timezone?: string } | null)?.timezone ?? "Asia/Kolkata",
      mode: context, requestId: "ask", draftRevision: 0, signal, askContext: { earlierQuestions, previousQuery },
    });
    if (!result.ok || result.interpretation.things.length !== 1) return null;
    const [thing] = result.interpretation.things;
    if (thing!.kind !== "question") return null;
    const parsed = parseStructuredQuery(thing!.question);
    return parsed ? mergeFollowUp(previousQuery, groundWindow(question, parsed), thing!.question?.continues_previous === true) : null;
  },
  log: (entry) => console.info(JSON.stringify({ evt: "coey_turn", ...entry })),
});

const resultFacts = (facts: AssistantFacts): CoeyResultFacts => ({
  scope: facts.scope,
  summary: facts.summary,
  things: facts.things,
  nudge_recommendations: facts.nudge_recommendations,
});

const emptyFacts: CoeyResultFacts = { scope: null, summary: null, things: [], nudge_recommendations: [] };

/**
 * Runs one turn and reports lifecycle events through `send`. Status events are
 * emitted only when the described operation actually starts. Exactly one
 * terminal event (`completed` or `error`) is sent unless `signal` aborts first.
 */
export async function runCoeyTurn(
  input: TurnInput,
  deps: TurnDeps,
  turnId: string,
  send: (event: CoeyEvent) => void,
  signal: AbortSignal,
  authMs = 0,
): Promise<void> {
  const emit = makeTurnEmitter(turnId);
  const timer = makeTimer();
  timer.timings.authMs = authMs;
  let route: string = "unknown";
  const emitAnswer = (
    answer: AssistantAnswer,
    facts: CoeyResultFacts,
    grounded: boolean,
  ) => {
    // Grounded deterministic text may appear first; model prose is only shown after validation.
    if (grounded && answer.answer_markdown) send(emit.next({ type: "text_delta", text: answer.answer_markdown }));
    send(emit.next({ type: "answer", answer, facts }));
  };
  const finish = (error?: { code: string; message: string }) => {
    const timings = { ...timer.finish(), route: route as TurnTimings["route"] };
    deps.log?.({ turnId, error: error?.code ?? null, ...timings });
    if (error) send(emit.next({ type: "error", code: error.code, message: error.message }));
    else send(emit.next({ type: "completed", timings }));
  };
  try {
    send(emit.next({ type: "accepted" }));
    // One interpretation path for Toss-redirected questions, direct Ask and follow-ups.
    let query = input.query ?? null;
    if (!query && deps.interpretQuestion) {
      query = await deps.interpretQuestion(input.question, input.history, input.context, signal, input.previousQuery ?? null).catch(() => null);
      if (signal.aborted) return;
    }
    input = { ...input, query };
    const topic = query?.topic ?? "things";
    if (query && topic === "off_topic") {
      route = "clarify";
      emitAnswer({ ...buildOutOfScopeAnswer(input.question), structured_query: query }, emptyFacts, true);
      return finish();
    }
    // Nudge questions use the nudge recommendations (cooldowns, permissions); not a Thing count.
    const decision = query
      ? { kind: "fast" as const, intent: topic === "nudge" ? ("nudge_recommendation" as const) : ("scope_summary" as const) }
      : routeCoeyQuestion(input.question, input.history);
    route = decision.kind;
    if (decision.kind === "greeting") {
      emitAnswer(buildGreetingAnswer(input.question), emptyFacts, true);
      return finish();
    }
    if (decision.kind === "clarify") {
      emitAnswer(buildOutOfScopeAnswer(input.question), emptyFacts, true);
      return finish();
    }

    // The status is sent before the scope lookup and facts read begin.
    send(emit.next({ type: "status", stage: "reading_facts", text: "Checking your Court" }));
    let { listId, bucketId } = input;
    if (input.scopeChoice) {
      const verified = await deps.verifyChoice(deps.client, input.scopeChoice, input.context);
      if (!verified)
        return finish({ code: "scope_unavailable", message: "That List or Bucket is no longer available in this context." });
      listId = verified.type === "list" ? verified.id : undefined;
      bucketId = verified.type === "bucket" ? verified.id : undefined;
    } else {
      const resolution = await deps.resolveScope(deps.client, input.question, input.context);
      if (resolution.kind === "resolved") {
        listId = resolution.scope.type === "list" ? resolution.scope.id : undefined;
        bucketId = resolution.scope.type === "bucket" ? resolution.scope.id : undefined;
      } else if (resolution.kind !== "none") {
        timer.mark("scopeMs");
        emitAnswer(buildScopeAnswer(resolution, input.context), emptyFacts, true);
        return finish();
      }
    }
    timer.mark("scopeMs");
    if (signal.aborted) return;

    const activityKey = wantsActivity(input.question, classifyAssistantIntent(input.question))
      ? input.question.toLowerCase().slice(0, 200)
      : "";
    const cacheKey = factsCacheKey([deps.userId, input.context, listId, bucketId, activityKey]);
    const cached =
      input.reuse === true && input.history.length > 0
        ? getCachedFacts<AssistantFacts>(cacheKey)
        : undefined;
    const facts =
      cached ??
      (await withDeadline(
        deps.buildFacts(deps.client, deps.userId, { listId, bucketId, context: input.context, question: input.question }),
        12_000,
        "facts_timeout",
      ));
    if (!cached) setCachedFacts(cacheKey, deps.userId, facts);
    timer.mark("factsMs");
    if (signal.aborted) return;
    send(emit.next({ type: "facts_ready", summary: facts.summary }));

    if (decision.kind === "model" && (process.env.SARVAM_API_KEY?.trim() || process.env.CODE_ACTIVITY_SARVAM_API_KEY?.trim()))
      send(emit.next({ type: "status", stage: "calling_model", text: "Asking the language model" }));
    const answer = !input.query
      ? await deps.answer(facts, input.question, input.history, signal, input.personChoice)
      : topic === "nudge"
        ? { ...buildFastAnswer("nudge_recommendation", facts, input.question), structured_query: input.query }
        : topic === "progress"
          ? progressAnswer(facts, input.query)
          : structuredAnswer(facts, input.query, await loadSchedulesForFacts(deps.client, facts), input.personChoice);
    timer.mark("modelMs");
    if (signal.aborted) return;
    emitAnswer(answer, resultFacts(facts), decision.kind !== "model");
    finish();
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof DeadlineError)
      return finish({ code: "facts_timeout", message: "Katalist took too long to read your data. Please try again." });
    if (error instanceof Error && error.message === "scope_not_found")
      return finish({ code: "scope_not_found", message: "That List or Bucket is no longer available." });
    return finish({ code: "assistant_failed", message: "Katalist could not prepare an answer right now." });
  }
}

/**
 * Wraps a turn in a Server-Sent Events body. Client disconnect aborts the turn
 * (and the upstream model fetch). A turn emits a handful of small frames, so
 * enqueue without a pull loop is sufficient; no frame is ever buffered unboundedly.
 */
export function createCoeyEventStream(
  run: (send: (event: CoeyEvent) => void, signal: AbortSignal) => Promise<void>,
  requestSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const signal = requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal;
  return new ReadableStream<Uint8Array>({
    async start(stream) {
      let closed = false;
      let terminal = false;
      const send = (event: CoeyEvent) => {
        if (closed || terminal || signal.aborted) return;
        if (event.type === "completed" || event.type === "error") terminal = true;
        stream.enqueue(encoder.encode(encodeCoeyEvent(event)));
      };
      try {
        await run(send, signal);
      } catch {
        // run() reports its own errors as events; anything left is a bug, so close quietly.
      } finally {
        closed = true;
        try {
          stream.close();
        } catch {
          /* already closed by cancel */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;
