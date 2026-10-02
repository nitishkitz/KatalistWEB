import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { useSession } from "@/hooks/useSession";

export type LoggedInDeviceSession = {
  id: string;
  user_agent: string | null;
  created_at: string | null;
  last_used_at: string | null;
  is_current: boolean;
};

const deviceSessionsKey = (userId: string | undefined) => ["logged-in-devices", userId ?? "none"] as const;

export function useLoggedInDevices() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const demoSession = user?.app_metadata?.provider === "demo";

  const query = useQuery({
    queryKey: deviceSessionsKey(userId),
    enabled: Boolean(userId) && !demoSession,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<LoggedInDeviceSession[]> => {
      const { data, error } = await callUngeneratedRpc("list_my_sessions").abortSignal(signal);
      if (error) {
        if (/list_my_sessions|schema cache/i.test(error.message)) {
          throw new Error(
            "Device management isn’t enabled on this server yet. Its database migration still needs to be applied.",
          );
        }
        throw new Error(error.message);
      }
      if (!Array.isArray(data)) throw new Error("The device list returned an unexpected response.");
      return data as LoggedInDeviceSession[];
    },
  });

  const revoke = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await callUngeneratedRpc("revoke_my_session", {
        p_session_id: sessionId,
      });
      if (error) throw new Error(error.message);
      if (data !== true) throw new Error("That device session is no longer active.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviceSessionsKey(userId) });
    },
  });

  const signOutOthers = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviceSessionsKey(userId) });
    },
  });

  return { ...query, demoSession, revoke, signOutOthers };
}
