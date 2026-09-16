import { defineEventHandler, readBody } from "h3";
import { requireUser } from "../../lib/require-user";

export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);

  const body = (await readBody(event)) as {
    listIds?: string[];
  } | null;

  const listIds = (body?.listIds ?? []).filter(Boolean);
  if (!listIds.length) {
    return { ok: true, lists: [] };
  }

  // User-scoped client: RLS on `lists` naturally limits results to Lists the
  // caller can see, instead of resolving names for arbitrary list ids.
  const { data, error } = await client
    .from("lists")
    .select("id, name")
    .in("id", listIds);

  if (error) {
    return { ok: false, lists: [], error: error.message };
  }

  return { ok: true, lists: data ?? [] };
});
