import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ListInvitation = {
  invitationId: string;
  phoneLast4: string | null;
  role: "collaborator" | "view_only";
  createdAt: string;
  expiresAt: string;
};

async function authorizationHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useListInvitations(listId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const queryKey = ["list-invitations", listId] as const;
  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<ListInvitation[]> => {
      const { data, error } = await supabase.rpc("list_pending_list_invitations", {
        p_list_id: listId,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        invitationId: row.invitation_id,
        phoneLast4: row.phone_last4,
        role: row.role === "view_only" ? "view_only" : "collaborator",
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }));
    },
  });

  const create = async (phone: string, role: "collaborator" | "view_only") => {
    const response = await fetch(`/api/lists/${listId}/invitations`, {
      method: "POST",
      headers: { ...(await authorizationHeader()), "content-type": "application/json" },
      body: JSON.stringify({ phone, role }),
    });
    const result = await response.json() as { shareUrl?: string; message?: string };
    if (!response.ok || !result.shareUrl) {
      throw new Error(result.message ?? "Invite could not be created.");
    }
    await queryClient.invalidateQueries({ queryKey });
    return result.shareUrl;
  };

  const revoke = async (invitationId: string) => {
    const { error } = await supabase.rpc("revoke_list_invitation", {
      p_list_id: listId,
      p_invitation_id: invitationId,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey });
  };

  const replace = async (invitationId: string) => {
    const response = await fetch(`/api/lists/${listId}/invitations`, {
      method: "POST",
      headers: { ...(await authorizationHeader()), "content-type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    const result = await response.json() as { shareUrl?: string; message?: string };
    if (!response.ok || !result.shareUrl) throw new Error(result.message ?? "Invite link could not be replaced.");
    await queryClient.invalidateQueries({ queryKey });
    return result.shareUrl;
  };

  return {
    invitations: query.data ?? [],
    create,
    revoke,
    replace,
    isLoading: query.isLoading,
    error: query.error,
  };
}
