import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { listCollaborationServerEnabled } from "@/features/lists/list-flags";
import { HttpError, defaultGetUser, jsonNoStore, requireSupabaseUser } from "@/lib/supabase-user.server";

export const Route = createFileRoute("/api/team/invitations/accept")({ server: { handlers: { POST: async ({ request }) => {
  if (!listCollaborationServerEnabled()) return jsonNoStore({ error: "not_found" }, 404);
  try {
    const user = await requireSupabaseUser(request, defaultGetUser);
    const { token } = await request.json() as { token?: string };
    if (!token || token.length < 30) return jsonNoStore({ error: "invalid_invite" }, 400);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = `\\x${createHash("sha256").update(token).digest("hex")}`;
    const { error } = await supabaseAdmin.rpc("accept_team_invitation_server", { p_token_hash: hash, p_accepting_profile_id: user.id });
    if (error) throw error;
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) return jsonNoStore({ error: "unauthorized" }, error.status);
    return jsonNoStore({ error: "invalid_invite", message: "This Team invite is unavailable or expired." }, 409);
  }
} } } });
