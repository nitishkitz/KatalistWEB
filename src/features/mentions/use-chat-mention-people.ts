import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { fetchProfileIdentitiesByIds, matchAvatarByName } from "@/features/people/directory";
import { useConversation } from "@/features/hub/use-conversations";
import { mergeMentionPeople, type MentionPerson } from "./mention-trigger";

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

/**
 * Everyone who can be @mentioned in a Team/List conversation, as profile ids.
 * The sources are merged because each alone can be empty at the moment you
 * type "@": the hub conversation record may still be a placeholder, and the
 * membership read is the authoritative one but needs a round trip. Yourself is never offered.
 */
export function useChatMentionPeople(listId: string): MentionPerson[] {
  const { user } = useSession();
  // Demo personas have no database rows to read.
  const preview = user?.app_metadata?.provider === "demo";
  const { conversation } = useConversation(listId);

  const membership = useQuery({
    queryKey: ["chat-mention-people", listId, user?.id],
    enabled: Boolean(listId) && Boolean(user) && !preview,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<MentionPerson[]> => {
      const [{ data: list, error: listError }, { data: members, error: membersError }] = await Promise.all([
        supabase.from("lists").select("owner_profile_id").eq("id", listId).abortSignal(signal).maybeSingle(),
        supabase.from("list_members").select("profile_id").eq("list_id", listId).abortSignal(signal),
      ]);
      if (listError) throw listError;
      if (membersError) throw membersError;
      const ids = [...new Set([list?.owner_profile_id, ...(members ?? []).map((m) => m.profile_id)].filter(Boolean) as string[])];
      const identities = await fetchProfileIdentitiesByIds(ids, signal);
      return identities.map((identity) => ({
        id: identity.id,
        name: identity.display_name,
        initials: initialsOf(identity.display_name),
        avatarUrl: identity.avatar_url ?? matchAvatarByName(identity.display_name),
      }));
    },
  });

  return useMemo(() => {
    const fromConversation: MentionPerson[] = (conversation?.others ?? []).map((p) => ({
      id: p.id, name: p.name, initials: p.initials, avatarUrl: p.avatarUrl,
    }));
    return mergeMentionPeople(membership.data, fromConversation).filter((p) => p.id !== user?.id);
  }, [membership.data, conversation, user?.id]);
}
