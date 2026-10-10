import { defineEventHandler, createError, setResponseHeader } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { googleContactsConfig } from "../../lib/contacts/google";

export default defineEventHandler(async event => {
  const { userId } = await requireUser(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const admin = getSupabaseAdmin();
  const [{ data: matches, error }, { data: sync, error: syncError }] = await Promise.all([
    admin.from("google_contact_matches").select("profile_id").eq("owner_profile_id", userId),
    admin.from("google_contact_syncs").select("synced_at, contact_count, matched_count").eq("owner_profile_id", userId).maybeSingle(),
  ]);
  if (error || syncError) throw createError({ statusCode: 503, message: "Contacts are unavailable. Try again later." });
  const ids = [...new Set((matches ?? []).map(row => row.profile_id as string))];
  const people: { id: string; name: string; initials: string; avatarUrl: string | null; role: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: profileError } = await admin.from("profiles")
      .select("id, display_name, avatar_url, occupation").in("id", ids.slice(i, i + 100));
    if (profileError) throw createError({ statusCode: 503, message: "Contacts are unavailable. Try again later." });
    for (const profile of data ?? []) {
      const name = profile.display_name?.trim() || "Katalist User";
      people.push({ id: profile.id, name, initials: name.split(/\s+/).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase(),
        avatarUrl: profile.avatar_url || null, role: profile.occupation || null });
    }
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return { configured: Boolean(googleContactsConfig()), people, syncedAt: sync?.synced_at ?? null,
    contactCount: sync?.contact_count ?? 0, matchedCount: sync?.matched_count ?? 0 };
});
