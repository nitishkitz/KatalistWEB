import { defineEventHandler, createError } from "h3";
import { createClient } from "@supabase/supabase-js";

export default defineEventHandler(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw createError({ statusCode: 500, message: "SUPABASE_SERVICE_ROLE_KEY is not configured." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const [{ data: profiles }, { data: actors }] = await Promise.all([
    admin.from("profiles").select("id, email, display_name, avatar_url"),
    admin.from("actors").select("id, profile_id, kind"),
  ]);

  const actorByProfile = new Map<string, string>();
  for (const a of actors ?? []) {
    if (a.profile_id) actorByProfile.set(a.profile_id, a.id);
  }

  const list = (profiles ?? []).map((p) => ({
    id: p.id,
    profile_id: p.id,
    actor_id: actorByProfile.get(p.id) || p.id,
    email: p.email,
    display_name: p.display_name && p.display_name !== "Someone" ? p.display_name : "Katalist User",
    avatar_url: p.avatar_url,
  }));

  return { ok: true, people: list };
});
