import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { fetchProfileIdentities, matchAvatarByName } from "@/features/people/directory";

export type ConversationParticipant = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
};

export type Conversation = {
  id: string;
  kind: "dm" | "group";
  /** DM: the other person's name. Group: the group's name. */
  title: string;
  /** DM: the other person's avatar. Group: null (UI stacks member avatars). */
  avatarUrl: string | null;
  ownerId: string;
  /** Every participant except me. */
  others: ConversationParticipant[];
  memberCount: number;
  lastMessage: string | null;
  lastAt: string | null;
  lastAuthor: string | null;
};

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

async function fetchConversations(myId: string): Promise<Conversation[]> {
  // RLS scopes SELECT to lists the caller owns or is a member of.
  const { data: listRows, error } = await supabase
    .from("lists")
    .select("id,name,kind,owner_profile_id,updated_at")
    .in("kind", ["dm", "group"])
    .is("archived_at", null);
  if (error) throw error;
  const lists = (listRows ?? []) as Array<{
    id: string;
    name: string;
    kind: "dm" | "group";
    owner_profile_id: string;
    updated_at: string;
  }>;
  if (lists.length === 0) return [];

  const ids = lists.map((l) => l.id);

  const [{ data: memberRows }, { data: msgRows }, identities] = await Promise.all([
    supabase.from("list_members").select("list_id, profile_id").in("list_id", ids),
    supabase
      .from("list_messages")
      .select("list_id, body, kind, created_at, author_profile_id, attachment")
      .in("list_id", ids)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    fetchProfileIdentities(),
  ]);

  const identityById = new Map(identities.map((p) => [p.id, p]));
  const resolve = (id: string): ConversationParticipant => {
    const p = identityById.get(id);
    const name = p?.display_name?.trim() || "Member";
    return {
      id,
      name,
      initials: initialsOf(name),
      avatarUrl: p?.avatar_url || matchAvatarByName(name),
    };
  };

  // Participants per list (owner + members), excluding me for display.
  const membersByList = new Map<string, string[]>();
  for (const l of lists) membersByList.set(l.id, [l.owner_profile_id]);
  for (const m of (memberRows ?? []) as Array<{ list_id: string; profile_id: string }>) {
    const arr = membersByList.get(m.list_id);
    if (arr && !arr.includes(m.profile_id)) arr.push(m.profile_id);
  }

  // Latest message per list (rows are already sorted newest-first).
  const lastByList = new Map<
    string,
    { body: string; kind: string; created_at: string; author_profile_id: string; hasAttachment: boolean }
  >();
  for (const r of (msgRows ?? []) as Array<{
    list_id: string;
    body: string;
    kind: string;
    created_at: string;
    author_profile_id: string;
    attachment: unknown;
  }>) {
    if (!lastByList.has(r.list_id)) {
      lastByList.set(r.list_id, {
        body: r.body,
        kind: r.kind,
        created_at: r.created_at,
        author_profile_id: r.author_profile_id,
        hasAttachment: Boolean(r.attachment),
      });
    }
  }

  const conversations: Conversation[] = lists.map((l) => {
    const participantIds = membersByList.get(l.id) ?? [l.owner_profile_id];
    const others = participantIds.filter((id) => id !== myId).map(resolve);
    const last = lastByList.get(l.id);
    const lastAuthor = last ? identityById.get(last.author_profile_id)?.display_name?.trim() ?? "" : null;
    const preview = last
      ? last.kind === "system"
        ? `${lastAuthor ?? "Someone"} ${last.body}`
        : last.body?.trim()
          ? last.body
          : last.hasAttachment
            ? "Sent an attachment"
            : ""
      : null;

    const title = l.kind === "dm" ? others[0]?.name ?? l.name : l.name;
    const avatarUrl = l.kind === "dm" ? others[0]?.avatarUrl ?? null : null;

    return {
      id: l.id,
      kind: l.kind,
      title,
      avatarUrl,
      ownerId: l.owner_profile_id,
      others,
      memberCount: participantIds.length,
      lastMessage: preview,
      lastAt: last?.created_at ?? null,
      lastAuthor,
    };
  });

  conversations.sort((a, b) => {
    const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
    const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
    return bt - at;
  });

  return conversations;
}

export function useConversations() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["hub-conversations", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: () => fetchConversations(user!.id),
  });

  // Refresh the rail whenever any conversation's chat broadcasts a change.
  useEffect(() => {
    if (!user || preview) return;
    const channel: RealtimeChannel = supabase
      .channel("hub-conversations")
      .on("broadcast", { event: "changed" }, () => {
        void qc.invalidateQueries({ queryKey: ["hub-conversations", user.id] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, preview, qc]);

  const refetch = () => qc.invalidateQueries({ queryKey: ["hub-conversations", user?.id] });

  return { conversations: query.data ?? [], isLoading: !preview && query.isLoading, refetch };
}

/** Single conversation detail for the workspace header (name, kind, participants). */
export function useConversation(listId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["hub-conversation", listId, user?.id],
    enabled: Boolean(listId) && Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: async (): Promise<Conversation | null> => {
      const { data: l, error } = await supabase
        .from("lists")
        .select("id,name,kind,owner_profile_id,updated_at")
        .eq("id", listId!)
        .maybeSingle();
      if (error) throw error;
      if (!l) return null;

      const [{ data: memberRows }, identities] = await Promise.all([
        supabase.from("list_members").select("profile_id").eq("list_id", listId!),
        fetchProfileIdentities(),
      ]);
      const identityById = new Map(identities.map((p) => [p.id, p]));
      const resolve = (id: string): ConversationParticipant => {
        const p = identityById.get(id);
        const name = p?.display_name?.trim() || "Member";
        return { id, name, initials: initialsOf(name), avatarUrl: p?.avatar_url || matchAvatarByName(name) };
      };

      const participantIds = [l.owner_profile_id, ...((memberRows ?? []).map((m) => m.profile_id))];
      const uniqueIds = Array.from(new Set(participantIds));
      const others = uniqueIds.filter((id) => id !== user!.id).map(resolve);
      const kind = (l.kind === "dm" ? "dm" : "group") as "dm" | "group";

      return {
        id: l.id,
        kind,
        title: kind === "dm" ? others[0]?.name ?? l.name : l.name,
        avatarUrl: kind === "dm" ? others[0]?.avatarUrl ?? null : null,
        ownerId: l.owner_profile_id,
        others,
        memberCount: uniqueIds.length,
        lastMessage: null,
        lastAt: null,
        lastAuthor: null,
      };
    },
  });

  return { conversation: query.data ?? null, isLoading: query.isLoading };
}
