import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
import {
  answerAssistantQuestion,
  buildAssistantFacts,
  buildScopeAnswer,
} from "../../../../server/lib/assistant";
import {
  ASSISTANT_QUERY_LIMIT,
  DeadlineError,
  checkRateLimit,
  factsCacheKey,
  getCachedFacts,
  setCachedFacts,
  withDeadline,
  PayloadTooLargeError,
  readBoundedJson,
} from "../../../../server/lib/assistant-limits";
import {
  classifyAssistantIntent,
  sanitizeAssistantHistory,
  type AssistantFacts,
} from "../../../../server/lib/assistant";
import { wantsActivity } from "../../../../server/lib/assistant-activity";
import { resolveAssistantScope, verifyScopeChoice } from "../../../../server/lib/assistant-scope";

export const Route = createFileRoute("/api/assistant/query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, client } = await requireAssistantUser(request);
          const limited = checkRateLimit(`query:${userId}`, ASSISTANT_QUERY_LIMIT);
          if (!limited.ok)
            return new Response(
              JSON.stringify({
                message: "You are asking quickly. Please wait a moment and try again.",
              }),
              {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "retry-after": String(limited.retryAfterSec),
                },
              },
            );
          const body = ((await readBoundedJson(request)) ?? {}) as {
            question?: unknown;
            listId?: unknown;
            bucketId?: unknown;
            context?: unknown;
            history?: unknown;
            scopeChoice?: unknown;
            personChoice?: unknown;
            reuse?: unknown;
          };
          const question = typeof body.question === "string" ? body.question.trim() : "";
          if (!question || question.length > 800)
            return assistantJson(
              { message: "A question between 1 and 800 characters is required." },
              400,
            );
          let listId = typeof body.listId === "string" ? body.listId : undefined;
          let bucketId = typeof body.bucketId === "string" ? body.bucketId : undefined;
          const context = body.context === "home" ? "home" : "work";
          const choice = body.scopeChoice as { type?: unknown; id?: unknown } | undefined;
          if (
            choice &&
            (choice.type === "list" || choice.type === "bucket") &&
            typeof choice.id === "string"
          ) {
            const verified = await verifyScopeChoice(
              client,
              { type: choice.type, id: choice.id },
              context,
            );
            if (!verified)
              return assistantJson(
                { message: "That List or Bucket is no longer available in this context." },
                404,
              );
            listId = verified.type === "list" ? verified.id : undefined;
            bucketId = verified.type === "bucket" ? verified.id : undefined;
          } else {
            // An explicitly named List or Bucket takes precedence over the current Court scope.
            const resolution = await resolveAssistantScope(client, question, context);
            if (resolution.kind === "resolved") {
              listId = resolution.scope.type === "list" ? resolution.scope.id : undefined;
              bucketId = resolution.scope.type === "bucket" ? resolution.scope.id : undefined;
            } else if (resolution.kind !== "none") {
              return assistantJson({
                ok: true,
                answer: buildScopeAnswer(resolution, context),
                facts: { scope: null, summary: null, things: [], nudge_recommendations: [] },
              });
            }
          }
          const history = sanitizeAssistantHistory(body.history);
          // Follow-ups may reuse facts for a few seconds; refreshes and realtime refetches never do.
          const activityKey = wantsActivity(question, classifyAssistantIntent(question))
            ? question.toLowerCase().slice(0, 200)
            : "";
          const cacheKey = factsCacheKey([userId, context, listId, bucketId, activityKey]);
          const cached =
            body.reuse === true && history.length > 0
              ? getCachedFacts<AssistantFacts>(cacheKey)
              : undefined;
          const facts =
            cached ??
            (await withDeadline(
              buildAssistantFacts(client, userId, { listId, bucketId, context, question }),
              12_000,
              "facts_timeout",
            ));
          if (!cached) setCachedFacts(cacheKey, userId, facts);
          const answer = await answerAssistantQuestion(facts, question, history, request.signal,
            typeof body.personChoice === "string" ? body.personChoice : undefined);
          return assistantJson({
            ok: true,
            answer,
            facts: {
              scope: facts.scope,
              summary: facts.summary,
              things: facts.things,
              nudge_recommendations: facts.nudge_recommendations,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof PayloadTooLargeError)
            return assistantJson({ message: "The request is too large." }, 413);
          if (error instanceof SyntaxError)
            return assistantJson({ message: "The request body must be valid JSON." }, 400);
          if (error instanceof DeadlineError)
            return assistantJson(
              { message: "Katalist took too long to read your data. Please try again." },
              504,
            );
          if (request.signal.aborted) return new Response(null, { status: 499 });
          if (error instanceof Error && error.message === "scope_not_found")
            return assistantJson({ message: "That List or Bucket is no longer available." }, 404);
          return assistantJson({ message: "Katalist could not prepare an answer right now." }, 502);
        }
      },
    },
  },
});
