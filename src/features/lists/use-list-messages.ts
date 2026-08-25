import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { addListMessage, getListMessages } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { fetchProfileIdentities, matchProfile } from "@/features/people/directory";
import { isPersonallyShreddedList, usePersonalShred } from "@/features/things/personal-shred";

export type ListChatMessage = {
  id: string;
  body: string;
  author: string;
  initials: string;
  avatarUrl?: string | null;
  at: string;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

async function fetchMessages(listId: string): Promise<ListChatMessage[]> {
  const { data, error } = await supabase
    .from("list_messages")
    .select("id, body, created_at, author_profile_id")
    .eq("list_id", listId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const identities = await fetchProfileIdentities();
  return (data ?? []).map((row) => {
    const person = identities.find((p) => p.id === row.author_profile_id);
    const author = person?.display_name ?? "Member";
    return {
      id: row.id,
      body: row.body,
      author,
      initials: initials(author),
      avatarUrl: person?.avatar_url ?? null,
      at: row.created_at,
    };
  });
}

export function useListMessages(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  useLocalVersion();

  const query = useQuery({
    queryKey: ["list-messages", listId],
    queryFn: () => fetchMessages(listId),
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
  });

  const send = useMutation({
    mutationFn: async (body: string) => {
      if (hidden) throw new Error("That List isn’t available.");
      if (preview) {
        addListMessage(listId, body);
        return;
      }
      if (!user?.id) throw new Error("Sign in to chat.");
      const { error } = await supabase.from("list_messages").insert({
        list_id: listId,
        body,
        author_profile_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });

  const messages: ListChatMessage[] =
    hidden
      ? []
      : preview
        ? getListMessages(listId).map((m) => ({ id: m.id, body: m.body, author: m.author, initials: initials(m.author), at: m.at }))
        : (query.data ?? []);

  return { messages, send, isLoading: !preview && !hidden && query.isLoading };
}

export type ReturnTypeUseListMessages = ReturnType<typeof useListMessages>;

export { matchProfile };
