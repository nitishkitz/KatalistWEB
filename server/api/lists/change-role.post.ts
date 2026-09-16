import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";
import { resolvePersonToProfileId } from "../../lib/resolve-person";

export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);

  const body = (await readBody(event)) as {
    listId?: string;
    personId?: string;
    role?: "collaborator" | "view_only";
  } | null;

  const { listId, personId, role = "collaborator" } = body || {};

  if (!listId || !personId) {
    throw createError({ statusCode: 400, message: "listId and personId are required." });
  }

  const targetProfileId = await resolvePersonToProfileId(client, personId);
  if (!targetProfileId) {
    throw createError({ statusCode: 404, message: "Could not resolve team member profile." });
  }

  const { data: member, error } = await client.rpc("change_list_role", {
    p_list_id: listId,
    p_profile_id: targetProfileId,
    p_role: role,
  });

  if (error) {
    throw createError({ statusCode: 403, message: error.message || "Failed to update list member role." });
  }

  return { ok: true, member };
});
