import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getProfileIdentities, matchAvatarByName } from "@/features/people/directory";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { withReadDeadline } from "@/lib/read-request";

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
  /** Raw profile id of the last message's author — for unread comparisons
   *  against "was this sent by me", which a display name can't answer
   *  reliably (two people can share a name). Null when there's no message. */
  lastAuthorId: string | null;
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

async function fetchConversations(qc: QueryClient, myId: string, querySignal?: AbortSignal): Promise<Conversation[]> {
  // T01: the initial lists read plus its three dependent reads below are
  // one logical read operation -- bounded together under a single
  // deadline (read-request.ts), wired to React Query's own cancellation
  // signal so a superseded/refetched call or unmount stops whichever
  // request is actually in flight.
  const { lists, memberRows, msgRows, identities } = await withReadDeadline(querySignal, async (signal) => {
    // RLS scopes SELECT to lists the caller owns or is a member of.
    const { data: listRows, error } = await supabase
      .from("lists")
      .select("id,name,kind,owner_profile_id,updated_at")
      .in("kind", ["dm", "group"])
      .is("archived_at", null)
      .abortSignal(signal);
    if (error) throw error;
    const lists = (listRows ?? []) as Array<{
      id: string;
      name: string;
      kind: "dm" | "group";
      owner_profile_id: string;
      updated_at: string;
    }>;
    if (lists.length === 0) return { lists, memberRows: [], msgRows: [], identities: [] };

    const ids = lists.map((l) => l.id);

    const [{ data: memberRows }, { data: msgRows }, identities] = await Promise.all([
      supabase.from("list_members").select("list_id, profile_id").in("list_id", ids).abortSignal(signal),
      supabase
        .from("list_messages")
        .select("list_id, body, kind, created_at, author_profile_id, attachment")
        .in("list_id", ids)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .abortSignal(signal),
      getProfileIdentities(qc),
    ]);
    return { lists, memberRows: memberRows ?? [], msgRows: msgRows ?? [], identities };
  });
  if (lists.length === 0) return [];

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
      lastAuthorId: last?.author_profile_id ?? null,
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
    queryFn: ({ signal }) => fetchConversations(qc, user!.id, signal),
  });

  // The rail is kept fresh by RealtimeInvalidationProvider, which routes every
  // list_messages postgres_changes event to the "hub-conversations" invalidation
  // target (see event-invalidation-map.ts) -- no per-hook subscription needed here.

  const refetch = () => {
    const epoch = getIdentityEpoch(qc).epoch;
    if (isEpochCurrent(qc, epoch)) void qc.invalidateQueries({ queryKey: ["hub-conversations", user?.id] });
  };

  return { conversations: query.data ?? [], isLoading: !preview && query.isLoading, refetch };
}

/** Single conversation detail for the workspace header (name, kind, participants). */
export function useConversation(listId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["hub-conversation", listId, user?.id],
    enabled: Boolean(listId) && Boolean(user) && !preview,
    staleTime: 10_000,
    queryFn: async ({ signal }): Promise<Conversation | null> => {
      const { l, memberRows, identities } = await withReadDeadline(signal, async (combined) => {
        const { data: l, error } = await supabase
          .from("lists")
          .select("id,name,kind,owner_profile_id,updated_at")
          .eq("id", listId!)
          .abortSignal(combined)
          .maybeSingle();
        if (error) throw error;
        if (!l) return { l: null, memberRows: [], identities: [] };

        const [{ data: memberRows }, identities] = await Promise.all([
          supabase.from("list_members").select("profile_id").eq("list_id", listId!).abortSignal(combined),
          getProfileIdentities(qc),
        ]);
        return { l, memberRows: memberRows ?? [], identities };
      });
      if (!l) return null;
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
        lastAuthorId: null,
      };
    },
  });

  return { conversation: query.data ?? null, isLoading: query.isLoading };
}
