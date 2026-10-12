import { defineEventHandler, readBody, createError, setHeader } from "h3";
import { requireUser } from "../../lib/require-user";

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  const { client } = await requireUser(event);
  const body = (await readBody(event)) as {
    thingIds?: unknown;
    actorId?: unknown;
    message?: unknown;
  } | null;
  const thingIds = Array.isArray(body?.thingIds)
    ? body.thingIds.filter((id): id is string => typeof id === "string")
    : [];
  const actorId = typeof body?.actorId === "string" ? body.actorId : "";
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : undefined;
  if (
    !/^[0-9a-f-]{36}$/i.test(actorId) ||
    !thingIds.length ||
    thingIds.length > 20 ||
    new Set(thingIds).size !== thingIds.length ||
    thingIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
  )
    throw createError({ statusCode: 400, message: "At least one valid Thing is required." });
  const { data: things, error: readError } = await client
    .from("things")
    .select("id,title,current_assignee_actor_id,work_status,acknowledgement")
    .in("id", thingIds)
    .limit(20);
  if (readError)
    throw createError({ statusCode: 502, message: "The Things could not be rechecked." });
  if (!things || things.length !== thingIds.length)
    throw createError({
      statusCode: 409,
      message: "One or more Things changed or are no longer visible.",
    });
  if (things.some((thing) => thing.current_assignee_actor_id !== actorId))
    throw createError({
      statusCode: 409,
      message: "An assignee changed. Refresh and review your selection before sending.",
    });
  const eligible = things.filter(
    (thing) =>
      thing.current_assignee_actor_id &&
      !["sorted", "cancelled", "completed"].includes(thing.work_status),
  );
  if (!eligible.length)
    throw createError({ statusCode: 409, message: "There are no eligible Things left to nudge." });
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
  const succeeded = results.filter((result) => result.ok);
  if (!succeeded.length)
    throw createError({
      statusCode: 409,
      message: results.find((result) => result.error)?.error || "No nudge could be sent.",
    });
  return { ok: true, sent: succeeded, failed: results.filter((result) => !result.ok) };
});
