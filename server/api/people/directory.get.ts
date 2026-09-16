import { defineEventHandler } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

// A cross-user team directory cannot be served through a plain user-scoped
// client: profiles/actors RLS restricts each row to its own owner. The admin
// client is a deliberate, narrow exception for this read - gated on a valid
// session so it can no longer be reached anonymously.
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const admin = getSupabaseAdmin();

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
