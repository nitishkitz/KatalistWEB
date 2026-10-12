import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
import { sanitizeAssistantHistory } from "../../../../server/lib/assistant";
import {
  ASSISTANT_QUERY_LIMIT,
  PayloadTooLargeError,
  checkRateLimit,
  readBoundedJson,
} from "../../../../server/lib/assistant-limits";
import {
  SSE_HEADERS,
  createCoeyEventStream,
  defaultTurnDeps,
  runCoeyTurn,
  type TurnInput,
} from "../../../../server/lib/assistant-stream";
import { makeTurnId } from "../../../../server/lib/assistant-turn";

/**
 * Streaming twin of /api/assistant/query. The JSON route stays in place until
 * every caller has moved. Authentication, rate limit and body bounds are
 * enforced before the stream opens so failures keep real HTTP statuses.
 */
export const Route = createFileRoute("/api/assistant/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = performance.now();
        try {
          const { userId, client } = await requireAssistantUser(request);
          const authMs = Math.round(performance.now() - startedAt);
          const limited = checkRateLimit(`query:${userId}`, ASSISTANT_QUERY_LIMIT);
          if (!limited.ok)
            return new Response(
              JSON.stringify({ message: "You are asking quickly. Please wait a moment and try again." }),
              {
                status: 429,
                headers: {
                  "content-type": "application/json",
                  "cache-control": "no-store",
                  "retry-after": String(limited.retryAfterSec),
                },
              },
            );
          const body = ((await readBoundedJson(request)) ?? {}) as Record<string, unknown>;
          const question = typeof body.question === "string" ? body.question.trim() : "";
          if (!question || question.length > 800)
            return assistantJson({ message: "A question between 1 and 800 characters is required." }, 400);
          const choice = body.scopeChoice as { type?: unknown; id?: unknown } | undefined;
          const input: TurnInput = {
            question,
            listId: typeof body.listId === "string" ? body.listId : undefined,
            bucketId: typeof body.bucketId === "string" ? body.bucketId : undefined,
            context: body.context === "home" ? "home" : "work",
            history: sanitizeAssistantHistory(body.history),
            scopeChoice:
              choice && (choice.type === "list" || choice.type === "bucket") && typeof choice.id === "string"
                ? { type: choice.type, id: choice.id }
                : undefined,
            reuse: body.reuse === true,
            personChoice: typeof body.personChoice === "string" ? body.personChoice : undefined,
          };
          const deps = defaultTurnDeps(client, userId);
          const turnId = makeTurnId();
          const stream = createCoeyEventStream(
            (send, signal) => runCoeyTurn(input, deps, turnId, send, signal, authMs),
            request.signal,
          );
          return new Response(stream, { status: 200, headers: SSE_HEADERS });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof PayloadTooLargeError)
            return assistantJson({ message: "The request is too large." }, 413);
          if (error instanceof SyntaxError)
            return assistantJson({ message: "The request body must be valid JSON." }, 400);
          return assistantJson({ message: "Katalist could not prepare an answer right now." }, 502);
        }
      },
    },
  },
});
