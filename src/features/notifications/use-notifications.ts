import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getNotifications, markNotificationsRead, markNotificationRead } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { keys } from "@/domain/query-keys";
import { notificationPath, trustedNotificationPath } from "@/features/notifications/push-delivery";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  path: string;
};

export function mapNotificationRow(row: {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  thing_id?: string | null;
  list_id?: string | null;
  payload?: unknown;
}): NotificationItem {
  const payload = row.payload && typeof row.payload === "object" ? row.payload as { path?: unknown } : null;
  const explicitPath = typeof payload?.path === "string" ? trustedNotificationPath(payload.path) : null;
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    read: Boolean(row.read_at),
    createdAt: row.created_at,
    path: explicitPath ?? notificationPath({ thingId: row.thing_id ?? null, listId: row.list_id ?? null }),
  };
}

export function useNotifications() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const list = useQuery({
    queryKey: keys.notifications(user?.id),
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, read_at, created_at, thing_id, list_id, payload")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).map((n) => mapNotificationRow(n));
    },
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const unreadQuery = useQuery({
    queryKey: keys.notificationsUnread(user?.id),
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: keys.notificationsUnread(user?.id) });
    },
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      if (preview) {
        markNotificationRead(id);
        return;
      }
      const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: keys.notificationsUnread(user?.id) });
    },
  });

  const items: NotificationItem[] = preview
    ? getNotifications().map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        read: n.read,
        createdAt: "",
        path: "/",
      }))
    : (list.data ?? []);
  const unread = preview ? items.some((n) => !n.read) : (unreadQuery.data ?? 0) > 0;

  return { items, unread, markAll, markOne, preview };
}
