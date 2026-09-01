import { defineEventHandler, readBody, createError } from "h3";
import { createClient } from "@supabase/supabase-js";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as {
    listId?: string;
    personId?: string;
    role?: "collaborator" | "view_only";
  } | null;

  const { listId, personId, role = "collaborator" } = body || {};

  if (!listId || !personId) {
    throw createError({ statusCode: 400, message: "listId and personId are required." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw createError({ statusCode: 500, message: "SUPABASE_SERVICE_ROLE_KEY is not configured." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve personId to profileId
  let targetProfileId: string | null = null;
  const { data: actor } = await admin.from("actors").select("id, profile_id").eq("id", personId).maybeSingle();
  if (actor?.profile_id) targetProfileId = actor.profile_id;
  if (!targetProfileId) {
    const { data: prof } = await admin.from("profiles").select("id").eq("id", personId).maybeSingle();
    if (prof?.id) targetProfileId = prof.id;
  }
  if (!targetProfileId) {
    const { data: byName } = await admin.from("profiles").select("id").ilike("display_name", `%${personId}%`).limit(1);
    if (byName?.[0]?.id) targetProfileId = byName[0].id;
  }

  if (!targetProfileId) {
    throw createError({ statusCode: 404, message: "Could not resolve team member profile." });
  }

  const { data: member, error } = await admin
    .from("list_members")
    .update({ role })
    .eq("list_id", listId)
    .eq("profile_id", targetProfileId)
    .select()
    .single();

  if (error) {
    throw createError({ statusCode: 500, message: error.message || "Failed to update list member role." });
  }

  return { ok: true, member };
});
