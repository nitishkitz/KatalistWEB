import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getNotifications, markNotificationsRead, markNotificationRead } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { keys } from "@/domain/query-keys";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

import type { NotificationItem } from "./notification-model";
export type { NotificationItem } from "./notification-model";

export function useNotifications() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const list = useInfiniteQuery({
    queryKey: keys.notifications(user?.id),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam, signal }) => {
      let request = supabase.from("notifications")
        .select("id,title,body,read_at,created_at,kind,thing_id,list_id,actor_id")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(40);
      if (pageParam) request = request.or(`created_at.lt.${pageParam.at},and(created_at.eq.${pageParam.at},id.lt.${pageParam.id})`);
      const { data, error } = await request.abortSignal(signal);
      if (error) throw error;
      const rows: NotificationItem[] = (data ?? []).map((n) => ({
        id: n.id, title: n.title, body: n.body ?? "", read: Boolean(n.read_at), createdAt: n.created_at,
        kind: n.kind, thingId: n.thing_id, listId: n.list_id, actorId: n.actor_id,
      }));
      const last = rows.at(-1);
      return { rows, next: rows.length === 40 && last ? { at: last.createdAt, id: last.id } : undefined };
    },
    getNextPageParam: (last) => last.next,
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("unread_notification_count");
      if (error) throw error;
      return data ?? 0;
    },
    enabled: Boolean(user) && !preview,
    staleTime: 10_000,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      if (preview) {
        markNotificationsRead();
        return;
      }
      const { error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => {
      if (!isEpochCurrent(qc, mutationContext.epoch)) return;
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: ["notifications-unread", user?.id] });
    },
  });

  const markOne = useMutation({
    mutationFn: async (ids: string[]) => {
      if (preview) {
        ids.forEach(markNotificationRead);
        return;
      }
      const results = await Promise.all(ids.map((id) => supabase.rpc("mark_notification_read", { p_notification_id: id })));
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => {
      if (!isEpochCurrent(qc, mutationContext.epoch)) return;
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: ["notifications-unread", user?.id] });
    },
  });

  const items: NotificationItem[] = preview
    ? getNotifications().map((n) => ({ id: n.id, title: n.title, body: n.body, read: n.read, createdAt: n.at, kind: n.type ?? "update", thingId: n.thingId ?? null, listId: null, actorId: null }))
    : (list.data?.pages.flatMap((page) => page.rows) ?? []);
  const unreadCount = preview ? items.filter((n) => !n.read).length : (unreadQuery.data ?? 0);
  const unread = unreadCount > 0;

  return { items, unread, unreadCount, markAll, markOne, preview, isLoading: list.isLoading && !preview, error: list.error, retry: list.refetch, hasMore: list.hasNextPage, loadMore: list.fetchNextPage, loadingMore: list.isFetchingNextPage };
}
