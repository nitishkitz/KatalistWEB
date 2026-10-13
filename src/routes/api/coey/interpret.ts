import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
import { checkRateLimit, PayloadTooLargeError, readBoundedJson } from "../../../../server/lib/assistant-limits";
import { interpretLine, MAX_INTERPRET_CHARS } from "../../../../server/lib/coey/interpret";
import { INTERPRETATION_SCHEMA_VERSION } from "@/domain/coey/contract";

// Typing triggers at most one request per 400 ms pause, plus one on send.
const INTERPRET_LIMIT = { limit: 90, windowMs: 60_000 };

export const Route = createFileRoute("/api/coey/interpret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, client } = await requireAssistantUser(request);
          const limited = checkRateLimit(`coey-interpret:${userId}`, INTERPRET_LIMIT);
          if (!limited.ok)
            return assistantJson({ message: "Slow down a moment and try again." }, 429);
          const body = ((await readBoundedJson(request, 16 * 1024)) ?? {}) as {
            text?: unknown; mode?: unknown; request_id?: unknown; draft_revision?: unknown; schema_version?: unknown;
          };
          if (body.schema_version !== INTERPRETATION_SCHEMA_VERSION)
            return assistantJson({ message: "Please refresh Katalist to continue." }, 409);
          const text = typeof body.text === "string" ? body.text : "";
          const requestId = typeof body.request_id === "string" ? body.request_id.slice(0, 64) : "";
          const draftRevision = Number.isInteger(body.draft_revision) ? Number(body.draft_revision) : -1;
          if (!text.trim() || !requestId || draftRevision < 0 || text.length > MAX_INTERPRET_CHARS)
            return assistantJson({ message: "Type something between 1 and 1,200 characters." }, 400);
          const mode = body.mode === "home" ? "home" : "work";
          const { data: profile } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
          const result = await interpretLine(text, {
            timezone: (profile as { timezone?: string } | null)?.timezone ?? "Asia/Kolkata",
            mode,
            requestId,
            draftRevision,
            signal: request.signal,
          });
          // Latency and outcome only; never the user's text.
          console.info(JSON.stringify({ evt: "coey_interpret", ok: result.ok, reason: result.ok ? undefined : result.reason, ms: result.latency_ms }));
          return assistantJson(result);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof PayloadTooLargeError) return assistantJson({ message: "That is too long." }, 413);
          if (error instanceof SyntaxError) return assistantJson({ message: "The request body must be valid JSON." }, 400);
          if (request.signal.aborted) return new Response(null, { status: 499 });
          return assistantJson({ message: "Coey could not read that right now." }, 502);
        }
      },
    },
  },
});
