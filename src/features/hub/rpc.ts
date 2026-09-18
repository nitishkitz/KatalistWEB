import { supabase } from "@/integrations/supabase/client";

/** Minimal shape of a conversation-kind `lists` row returned by the hub RPCs. */
export type ConversationRow = {
  id: string;
  name: string;
  kind: "dm" | "group" | "list";
  owner_profile_id: string;
  context: "work" | "home";
  created_at: string;
  updated_at: string;
};

function firstRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The conversation could not be opened.");
  return row;
}

// These RPCs are new and not present in the generated Supabase types yet, so we
// call them through a loosened signature. IMPORTANT: keep the `supabase.rpc`
// member call inline — extracting it into a variable would detach `this` from the
// client and break it ("Cannot read properties of undefined (reading 'rest')").
type LooseRpc = (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Open (or create) the caller's canonical 1:1 conversation with another person.
 * Mode-independent: a single DM per pair regardless of Work/Home.
 */
export async function rpcGetOrCreateDm(otherProfileId: string): Promise<ConversationRow> {
  const { data, error } = await (supabase.rpc as unknown as LooseRpc)("get_or_create_dm", {
    p_other_profile_id: otherProfileId,
  });
  if (error) throw error;
  return firstRow<ConversationRow>(data as ConversationRow | ConversationRow[] | null);
}

/** Create a named group conversation and add the given profiles as collaborators. */
export async function rpcCreateGroup(name: string, memberIds: string[]): Promise<ConversationRow> {
  const { data, error } = await (supabase.rpc as unknown as LooseRpc)("create_group", {
    p_name: name,
    p_member_ids: memberIds,
  });
  if (error) throw error;
  return firstRow<ConversationRow>(data as ConversationRow | ConversationRow[] | null);
}

/** Send (or auto-accept a reciprocal) connection request to another person. */
export async function rpcSendContactRequest(addresseeProfileId: string): Promise<void> {
  const { error } = await (supabase.rpc as unknown as LooseRpc)("send_contact_request", {
    p_addressee_profile_id: addresseeProfileId,
  });
  if (error) throw error;
}

/** Accept or decline an incoming connection request. */
export async function rpcRespondContactRequest(requestId: string, accept: boolean): Promise<void> {
  const { error } = await (supabase.rpc as unknown as LooseRpc)("respond_contact_request", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw error;
}

/** Withdraw a pending connection request you sent. */
export async function rpcCancelContactRequest(requestId: string): Promise<void> {
  const { error } = await (supabase.rpc as unknown as LooseRpc)("cancel_contact_request", {
    p_request_id: requestId,
  });
  if (error) throw error;
}

/** Create an email invitation for a person not yet on Katalist. Returns the token. */
export async function rpcCreateInvitation(email: string): Promise<{ id: string; token: string; email: string }> {
  const { data, error } = await (supabase.rpc as unknown as LooseRpc)("create_invitation", { p_email: email });
  if (error) throw error;
  return firstRow<{ id: string; token: string; email: string }>(
    data as { id: string; token: string; email: string } | { id: string; token: string; email: string }[] | null,
  );
}

/** Revoke a pending invitation. */
export async function rpcRevokeInvitation(id: string): Promise<void> {
  const { error } = await (supabase.rpc as unknown as LooseRpc)("revoke_invitation", { p_id: id });
  if (error) throw error;
}
