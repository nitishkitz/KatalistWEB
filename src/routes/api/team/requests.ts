import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { normalizeIndianPhone } from "@/features/lists/server/list-invitations";
import { listCollaborationServerEnabled } from "@/features/lists/list-flags";
import { defaultGetUser, jsonNoStore, requireSupabaseUser } from "@/lib/supabase-user.server";
import type { Database } from "@/integrations/supabase/types";
import { createHash, randomBytes } from "node:crypto";

const digest = (value: string) => `\\x${createHash("sha256").update(value).digest("hex")}`;

export const Route = createFileRoute("/api/team/requests")({
  server: { handlers: { POST: async ({ request }) => {
    if (!listCollaborationServerEnabled()) return jsonNoStore({ error: "not_found" }, 404);
    try {
      const user = await requireSupabaseUser(request, defaultGetUser);
      const { phone: rawPhone } = await request.json() as { phone?: string };
      const phone = normalizeIndianPhone(rawPhone ?? "");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profile } = await supabaseAdmin.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
      if (profile?.id === user.id) return jsonNoStore({ error: "self", message: "You are already on your Team." }, 400);
      if (!profile?.id) {
        const pepper = process.env.KATALIST_UAT_AUTH_PEPPER ?? process.env.LIST_INVITE_PEPPER ?? "";
        if (!pepper) return jsonNoStore({ error: "unavailable" }, 503);
        const token = randomBytes(32).toString("base64url");
        const created = await supabaseAdmin.rpc("create_team_invitation_server", { p_requester_profile_id: user.id, p_phone_hash: digest(`${pepper}:${phone}`), p_phone_last4: phone.slice(-4), p_token_hash: digest(token), p_expires_at: new Date(Date.now()+14*86_400_000).toISOString() });
        if (created.error) throw created.error;
        return jsonNoStore({ status: "invited", shareUrl: `${new URL(request.url).origin}/team-invitations/accept?token=${encodeURIComponent(token)}` }, 201);
      }
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const client = createClient<Database>(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await client.rpc("request_team_connection", { p_recipient_profile_id: profile.id });
      if (error) throw error;
      return jsonNoStore({ status: "pending" }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/invalid phone/i.test(message)) return jsonNoStore({ error: "invalid_phone", message: "Enter a valid 10-digit Indian mobile number." }, 400);
      return jsonNoStore({ error: "retryable", message: "Request could not be sent." }, 503);
    }
  } } },
});
