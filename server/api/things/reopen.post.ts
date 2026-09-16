import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

export default defineEventHandler(async (event) => {
  const { client, userId } = await requireUser(event);

  const body = (await readBody(event)) as {
    thingId?: string;
  } | null;

  const thingId = body?.thingId;
  if (!thingId) {
    throw createError({ statusCode: 400, message: "thingId is required." });
  }

  // `things` has no UPDATE RLS policy - every mutation in this codebase goes
  // through a SECURITY DEFINER RPC that checks ownership internally. No
  // reopen RPC exists yet, so the ownership check has to happen here before
  // falling back to the admin client for the actual write.
  const { data: actorRow, error: actorErr } = await client
    .from("actors")
    .select("id")
    .eq("profile_id", userId)
    .eq("kind", "user")
    .maybeSingle();

  if (actorErr || !actorRow) {
    throw createError({ statusCode: 403, message: "Could not resolve caller identity." });
  }

  const { data: thing, error: thingErr } = await client
    .from("things")
    .select("id, owner_actor_id, work_status")
    .eq("id", thingId)
    .maybeSingle();

  if (thingErr || !thing) {
    throw createError({ statusCode: 404, message: "Thing not found." });
  }

  if (thing.owner_actor_id !== actorRow.id) {
    throw createError({ statusCode: 403, message: "Only the Thing Owner can reopen it." });
  }

  if (thing.work_status !== "cancelled") {
    throw createError({ statusCode: 400, message: "Only a Cancelled Thing can be reopened." });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("things")
    .update({
      work_status: "not_started",
      cancelled_at: null,
      acknowledgement: "waiting_for_catch",
      updated_at: new Date().toISOString(),
    })
    .eq("id", thingId)
    .select()
    .single();

  if (error) {
    throw createError({ statusCode: 500, message: error.message });
  }

  return { ok: true, thing: data };
});
