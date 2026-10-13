import { defineEventHandler } from "h3";
import { requireUser } from "../../lib/require-user";

// Names and avatars of people this user may already see: self, connections,
// request counterparts and people met through an authorized List or Thing.
// Never the whole profile directory; email is returned for self only.
export default defineEventHandler(async (event) => {
  const { client } = await requireUser(event);
  const { data, error } = await client.rpc("list_visible_identities" as never);
  if (error) return { ok: false, people: [] };
  const rows = (data ?? []) as Array<{ profile_id: string; actor_id: string | null; display_name: string; avatar_url: string | null; email: string | null; connected: boolean }>;
  return {
    ok: true,
    people: rows.map((p) => ({
      id: p.profile_id,
      profile_id: p.profile_id,
      actor_id: p.actor_id || p.profile_id,
      email: p.email,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      connected: p.connected,
    })),
  };
});
