import { createFileRoute } from "@tanstack/react-router";
import {
  invalidateAssistantFacts,
  PayloadTooLargeError,
  readBoundedJson,
} from "../../../../server/lib/assistant-limits";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";

export const Route = createFileRoute("/api/assistant/nudge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, client } = await requireAssistantUser(request);
          const body = (await readBoundedJson(request)) as {
            thingIds?: unknown;
            actorId?: unknown;
            message?: unknown;
          };
          const thingIds = Array.isArray(body.thingIds)
            ? body.thingIds.filter((id): id is string => typeof id === "string")
            : [];
          const actorId = typeof body.actorId === "string" ? body.actorId : "";
          const message =
            typeof body.message === "string" ? body.message.trim().slice(0, 500) : undefined;
          if (
            !/^[0-9a-f-]{36}$/i.test(actorId) ||
            !thingIds.length ||
            thingIds.length > 20 ||
            new Set(thingIds).size !== thingIds.length ||
            thingIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
          )
            return assistantJson({ message: "At least one valid Thing is required." }, 400);
          const { data: things, error: readError } = await client
            .from("things")
            .select("id,title,current_assignee_actor_id,work_status,acknowledgement")
            .in("id", thingIds)
            .limit(20);
          if (readError)
            return assistantJson({ message: "The Things could not be rechecked." }, 502);
          if (!things || things.length !== thingIds.length)
            return assistantJson(
              { message: "One or more Things changed or are no longer visible." },
              409,
            );
          if (things.some((thing) => thing.current_assignee_actor_id !== actorId))
            return assistantJson(
              { message: "An assignee changed. Refresh and review your selection before sending." },
              409,
            );
          const eligible = things.filter(
            (thing) =>
              thing.current_assignee_actor_id &&
              !["sorted", "cancelled", "completed"].includes(thing.work_status),
          );
          if (!eligible.length)
            return assistantJson({ message: "There are no eligible Things left to nudge." }, 409);
          const results = await Promise.all(
            eligible.map(async (thing) => {
              const { data, error } = await client.rpc("nudge_thing", {
                p_thing_id: thing.id,
                p_reason: "quiet",
                p_message: message || null,
              });
              return {
                thingId: thing.id,
                title: thing.title,
                ok: !error && Boolean(data),
                error: error?.message,
              };
            }),
          );
          invalidateAssistantFacts(userId);
          const succeeded = results.filter((result) => result.ok);
          if (!succeeded.length)
            return assistantJson(
              {
                message: results.find((result) => result.error)?.error || "No nudge could be sent.",
              },
              409,
            );
          return assistantJson({
            ok: true,
            sent: succeeded,
            failed: results.filter((result) => !result.ok),
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof PayloadTooLargeError)
            return assistantJson({ message: "The request is too large." }, 413);
          if (error instanceof SyntaxError)
            return assistantJson({ message: "The request body must be valid JSON." }, 400);
          return assistantJson({ message: "Katalist could not send the nudge right now." }, 502);
        }
      },
    },
  },
});
