import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";
import { resolvePersonToProfileId } from "../../lib/resolve-person";

export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);

  const body = (await readBody(event)) as {
    listId?: string;
    personId?: string;
  } | null;

  const { listId, personId } = body || {};

  if (!listId || !personId) {
    throw createError({ statusCode: 400, message: "listId and personId are required." });
  }

  const targetProfileId = await resolvePersonToProfileId(client, personId);
  if (!targetProfileId) {
    throw createError({ statusCode: 404, message: "Could not resolve team member profile." });
  }

  const { data: removed, error } = await client.rpc("remove_list_member", {
    p_list_id: listId,
    p_profile_id: targetProfileId,
  });

  if (error) {
    throw createError({ statusCode: 403, message: error.message || "Failed to remove list member." });
  }

  return { ok: true, removed };
});
