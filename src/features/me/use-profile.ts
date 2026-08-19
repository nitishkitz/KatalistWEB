import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { fetchProfileIdentities, matchProfile } from "@/features/people/directory";

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
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const avatar_url = `${data.publicUrl}?v=${Date.now()}`;
      const { error: rowErr } = await supabase.from("profiles").update({ avatar_url }).eq("id", user.id);
      if (rowErr) throw rowErr;
      return avatar_url;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
  });
}
