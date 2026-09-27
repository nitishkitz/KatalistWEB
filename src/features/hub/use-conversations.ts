import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { fetchProfileIdentitiesByIds, matchAvatarByName } from "@/features/people/directory";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { withReadDeadline } from "@/lib/read-request";
import { getConversationLastReadAt } from "./chat-read-state";

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
  /** Viewer-specific page aggregate; absent on legacy/placeholder records. */
  unreadCount?: number | "unknown";
  mentionCount?: number | "unknown";
  readWatermark?: number;
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

type HubSummaryRow = {
  id: string; name: string; kind: "dm" | "group"; owner_profile_id: string; updated_at: string;
  last_body: string | null; last_kind: string | null; last_at: string | null;
  last_author_profile_id: string | null; last_has_attachment: boolean; sort_at: string;
};
type HubUnreadRow = { list_id: string; unread_count: number; mention_count: number };

const HUB_PAGE_SIZE = 100;
type HubCursor = { at: string; id: string };

export async function fetchConversations(
  _qc: QueryClient, myId: string, cursor: HubCursor | null = null, querySignal?: AbortSignal,
): Promise<{ conversations: Conversation[]; nextCursor?: HubCursor }> {
  // T01: the initial lists read plus its three dependent reads below are
  // one logical read operation -- bounded together under a single
  // deadline (read-request.ts), wired to React Query's own cancellation
  // signal so a superseded/refetched call or unmount stops whichever
  // request is actually in flight.
  const { lists, hasMore, memberRows, identities, unreadCounts, readWatermarks } = await withReadDeadline(querySignal, async (signal) => {
    // RLS-scoped SQL returns at most 101 conversation summaries, each with
    // one latest message; full histories never cross the rail boundary.
    const { data: listRows, error } = await callUngeneratedRpc("get_hub_conversation_page", {
      p_limit: HUB_PAGE_SIZE, p_cursor_at: cursor?.at ?? null, p_cursor_id: cursor?.id ?? null,
    }).abortSignal(signal);
    if (error) throw error;
    const summaries = (listRows ?? []) as HubSummaryRow[];
    const hasMore = summaries.length > HUB_PAGE_SIZE;
    const lists = summaries.slice(0, HUB_PAGE_SIZE);
    if (lists.length === 0) return { lists, hasMore, memberRows: [], identities: [], unreadCounts: new Map<string, HubUnreadRow>(), readWatermarks: new Map<string, number>() };

    const ids = lists.map((l) => l.id);
    const readWatermarks = new Map(ids.map((id) => [id, getConversationLastReadAt(id, myId)]));

    const [membersResult, countsResult] = await Promise.all([
      supabase.from("list_members").select("list_id, profile_id").in("list_id", ids).abortSignal(signal),
      (async () => {
        try {
          return await callUngeneratedRpc("get_hub_unread_counts", {
            p_list_ids: ids,
            p_last_reads: ids.map((id) => {
              const stamp = readWatermarks.get(id) ?? 0;
              return stamp > 0 ? new Date(stamp).toISOString() : null;
            }),
          }).abortSignal(signal);
        } catch {
          return { data: null, error: new Error("Unread counts unavailable") };
        }
      })(),
    ]);
    if (membersResult.error) throw membersResult.error;
    const identities = await fetchProfileIdentitiesByIds([
      ...lists.map((list) => list.owner_profile_id),
      ...(membersResult.data ?? []).map((member) => member.profile_id),
      ...lists.map((list) => list.last_author_profile_id).filter((id): id is string => Boolean(id)),
    ], signal);
    const unreadCounts = new Map<string, HubUnreadRow>();
    if (!countsResult.error) for (const row of (countsResult.data ?? []) as HubUnreadRow[]) unreadCounts.set(row.list_id, row);
    return { lists, hasMore, memberRows: membersResult.data ?? [], identities, unreadCounts, readWatermarks };
  });
  if (lists.length === 0) return { conversations: [] };

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

  const conversations: Conversation[] = lists.map((l) => {
    const participantIds = membersByList.get(l.id) ?? [l.owner_profile_id];
    const others = participantIds.filter((id) => id !== myId).map(resolve);
    const lastAuthor = l.last_author_profile_id ? identityById.get(l.last_author_profile_id)?.display_name?.trim() ?? "" : null;
    const preview = l.last_at
      ? l.last_kind === "system"
        ? `${lastAuthor ?? "Someone"} ${l.last_body}`
        : l.last_body?.trim()
          ? l.last_body
          : l.last_has_attachment
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
      lastAt: l.last_at,
      lastAuthor,
      lastAuthorId: l.last_author_profile_id,
      unreadCount: unreadCounts.get(l.id)?.unread_count ?? "unknown",
      mentionCount: unreadCounts.get(l.id)?.mention_count ?? "unknown",
      readWatermark: readWatermarks.get(l.id) ?? 0,
    };
  });

  // Keep the server's (sort_at, id) order exactly: the next-page cursor is
  // defined in that order, including conversations without any messages.
  const last = lists.at(-1);
  return { conversations, nextCursor: hasMore && last ? { at: last.sort_at, id: last.id } : undefined };
}

export function useConversations() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useInfiniteQuery<{ conversations: Conversation[]; nextCursor?: HubCursor }, Error>({
    queryKey: ["hub-conversations", user?.id],
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
    initialPageParam: null as HubCursor | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryFn: ({ pageParam, signal }) => fetchConversations(
      qc, user!.id,
      pageParam && typeof pageParam === "object" && "at" in pageParam && "id" in pageParam
        ? pageParam as HubCursor : null,
      signal,
    ),
  });

  // The rail is kept fresh by RealtimeInvalidationProvider, which routes every
  // list_messages postgres_changes event to the "hub-conversations" invalidation
  // target (see event-invalidation-map.ts) -- no per-hook subscription needed here.

  const refetch = () => {
    const epoch = getIdentityEpoch(qc).epoch;
    if (isEpochCurrent(qc, epoch)) void qc.invalidateQueries({ queryKey: ["hub-conversations", user?.id] });
  };

  return {
    conversations: query.data?.pages.flatMap((page) => page.conversations) ?? [],
    isLoading: !preview && query.isLoading,
    error: query.error,
    refetch,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    isLoadingMore: query.isFetchingNextPage,
  };
}

/** Single conversation detail for the workspace header (name, kind, participants). */
export function useConversation(listId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();

  const query = useQuery<Conversation | null, Error>({
    queryKey: ["hub-conversation", listId, user?.id],
    enabled: Boolean(listId) && Boolean(user) && !preview,
    staleTime: 10_000,
    // T05: seed from the sidebar's already-fetched lightweight record (the
    // exact same Conversation shape) so the header can show the real
    // title/member count the instant a conversation is selected, instead of
    // a fabricated "Conversation" / "0 members" while this detail query is
    // still in flight.
    placeholderData: () => {
      if (!listId) return undefined;
      const cached = qc.getQueryData<{
        pages: Array<{ conversations: Conversation[] }>;
      } | Conversation[]>(["hub-conversations", user?.id]);
      if (Array.isArray(cached)) return cached.find((c) => c.id === listId);
      return cached?.pages.flatMap((page) => page.conversations).find((c) => c.id === listId);
    },
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

        const membersResult = await supabase.from("list_members").select("profile_id").eq("list_id", listId!).abortSignal(combined);
        if (membersResult.error) throw membersResult.error;
        const identities = await fetchProfileIdentitiesByIds([
          l.owner_profile_id, ...(membersResult.data ?? []).map((member) => member.profile_id),
        ], combined);
        return { l, memberRows: membersResult.data ?? [], identities };
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

  return {
    conversation: query.data ?? null,
    // Genuinely nothing to show yet -- distinct from "the authoritative
    // fetch is still running but we already have a seeded record from the
    // sidebar to display in the meantime".
    isLoading: !query.data && query.isLoading,
    // B-03/C-06: previously not exposed at all -- a revoked membership (the
    // List's own row now 403s/RLS-filters to nothing) settled as
    // `conversation: null` completely indistinguishable from "genuinely
    // never existed" or "still loading", so the workspace had no way to
    // show a real access-lost state instead of a broken/empty header.
    error: query.error,
    refetch: query.refetch,
  };
}
