import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
import {
  ASSISTANT_ACTION_LIMIT,
  checkRateLimit,
  invalidateAssistantFacts,
  PayloadTooLargeError,
  readBoundedJson,
} from "../../../../../server/lib/assistant-limits";
import { ActionError, confirmAssistantAction } from "../../../../../server/lib/assistant-actions";

export const Route = createFileRoute("/api/assistant/action/confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, client } = await requireAssistantUser(request);
          const limited = checkRateLimit(`action:${userId}`, ASSISTANT_ACTION_LIMIT);
          if (!limited.ok)
            return new Response(
              JSON.stringify({
                message: "Too many actions in a short time. Please wait and try again.",
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
            token?: unknown;
            idempotencyKey?: unknown;
          };
          const result = await confirmAssistantAction(client, userId, body);
          invalidateAssistantFacts(userId);
          // Every Thing rejected: nothing was changed, so signal a conflict.
          return assistantJson(
            result,
            result.ok || result.results.some((r) => r.state === "failed") ? 200 : 409,
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof PayloadTooLargeError)
            return assistantJson({ message: "The request is too large." }, 413);
          if (error instanceof SyntaxError)
            return assistantJson({ message: "The request body must be valid JSON." }, 400);
          if (error instanceof ActionError)
            return assistantJson({ message: error.message }, error.status);
          return assistantJson({ message: "Katalist could not complete that action." }, 502);
        }
      },
    },
  },
});
