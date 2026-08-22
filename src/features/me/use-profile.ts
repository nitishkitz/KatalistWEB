import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { fetchProfileIdentities, matchProfile } from "@/features/people/directory";
import { uploadAvatarForUser } from "@/features/me/avatar-upload";

export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  phone_e164: string | null;
  active_context: "work" | "home";
};

export function useProfile() {
  const { user } = useSession();
  const live = Boolean(user);

  return useQuery({
    queryKey: ["profile", user?.id ?? "none"],
    enabled: live && Boolean(user?.id),
    queryFn: async (): Promise<ProfileRow | null> => {
      if (user?.app_metadata?.provider === "demo") {
        const personaKey = user.user_metadata?.persona_key as string | undefined;
        if (personaKey?.startsWith("local-")) {
          return {
            id: user.id,
            display_name: (user.user_metadata?.display_name as string | undefined) || "Katalist user",
            avatar_url: (user.user_metadata?.avatar_url as string | undefined) || null,
            email: user.email ?? null,
            phone_e164: user.phone ?? null,
            active_context: "work",
          };
        }
        const rows = await fetchProfileIdentities();
        const hit = matchProfile(rows, user.user_metadata?.display_name as string | undefined, user.email);
        if (!hit) return null;
        return {
          id: hit.id,
          display_name: hit.display_name,
          avatar_url: hit.avatar_url,
          email: hit.email,
          phone_e164: null,
          active_context: "work",
        };
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email, phone_e164, active_context")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
}

export function useUploadAvatar() {
  const { user } = useSession();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error("Sign in with a live account to set a photo.");
      if (user.app_metadata?.provider === "demo") {
        throw new Error("Photos are demo-only and aren’t saved to a live profile.");
      }
      return uploadAvatarForUser(user.id, file);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile", user?.id] });
      void qc.invalidateQueries({ queryKey: ["profile-directory"] });
      void qc.invalidateQueries({ queryKey: ["assignable-people"] });
      void qc.invalidateQueries({ queryKey: ["court"] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
      void qc.invalidateQueries({ queryKey: ["list"] });
      void qc.invalidateQueries({ queryKey: ["nudges"] });
      void qc.invalidateQueries({ queryKey: ["thing"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
