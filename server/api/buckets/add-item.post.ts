import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";

export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);

  const body = (await readBody(event)) as {
    bucketId?: string;
    thingId?: string;
    listId?: string;
  } | null;

  const { bucketId, thingId, listId } = body || {};

  if (!bucketId || (!thingId && !listId)) {
    throw createError({ statusCode: 400, message: "bucketId and either thingId or listId are required." });
  }

  // add_to_bucket enforces bucket ownership and that the caller can already
  // view the referenced Thing/List before creating the reference.
  const { data: inserted, error } = await client.rpc("add_to_bucket", {
    p_bucket_id: bucketId,
    p_thing_id: thingId || null,
    p_list_id: listId || null,
  });

  if (error) {
    throw createError({ statusCode: 403, message: error.message || "Failed to add item to bucket." });
  }

  return { ok: true, data: inserted };
});
