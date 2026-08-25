import { createHash, randomBytes } from "node:crypto";
import { defaultGetUser, jsonNoStore, requireSupabaseUser } from "@/lib/supabase-user.server";
import { listCollaborationServerEnabled } from "../list-flags";

export function normalizeIndianPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error("invalid phone");
  return `+91${digits}`;
}

const sha256 = (value: string | Buffer) => `\\x${createHash("sha256").update(value).digest("hex")}`;

export async function createListInvitation(request: Request, listId: string) {
  if (!listCollaborationServerEnabled()) return jsonNoStore({ error: "not_found" }, 404);
  try {
    const user = await requireSupabaseUser(request, defaultGetUser);
    const body = await request.json() as { phone?: string; role?: string };
    const phone = normalizeIndianPhone(body.phone ?? "");
    const role = body.role === "view_only" ? "view_only" : "collaborator";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
    if (profile?.id === user.id) return jsonNoStore({ error: "invalid_request", message: "You are already the Owner." }, 400);
    const token = randomBytes(32).toString("base64url");
    const pepper = process.env.KATALIST_UAT_AUTH_PEPPER ?? process.env.LIST_INVITE_PEPPER ?? "";
    if (!pepper) return jsonNoStore({ error: "unavailable" }, 503);
    const { error } = await supabaseAdmin.rpc("create_list_invitation_server", {
      p_requester_profile_id: user.id,
      p_list_id: listId,
      p_invitee_profile_id: profile?.id ?? null,
      p_phone_hash: sha256(`${pepper}:${phone}`),
      p_token_hash: sha256(token),
      p_role: role,
      p_expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });
    if (error) throw error;
    const origin = new URL(request.url).origin;
    return jsonNoStore({ shareUrl: `${origin}/list-invitations/accept?token=${encodeURIComponent(token)}` }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unauthorized|bearer|session/i.test(message)) return jsonNoStore({ error: "unauthorized" }, 401);
    if (/invalid phone/i.test(message)) return jsonNoStore({ error: "invalid_phone", message: "Enter a valid Indian mobile number." }, 400);
    if (/owner/i.test(message)) return jsonNoStore({ error: "forbidden" }, 403);
    return jsonNoStore({ error: "retryable", message: "Invite could not be created." }, 503);
  }
}

export async function acceptListInvitation(request: Request) {
  if (!listCollaborationServerEnabled()) return jsonNoStore({ error: "not_found" }, 404);
  try {
    const user = await requireSupabaseUser(request, defaultGetUser);
    const body = await request.json() as { token?: string };
    if (!body.token || body.token.length < 30) return jsonNoStore({ error: "invalid_invite" }, 400);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("accept_list_invitation_server", { p_token_hash: sha256(body.token), p_accepting_profile_id: user.id });
    if (error) throw error;
    return jsonNoStore({ listId: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unauthorized|bearer|session/i.test(message)) return jsonNoStore({ error: "unauthorized" }, 401);
    return jsonNoStore({ error: "invalid_invite", message: "This invite is unavailable or expired." }, 409);
  }
}
