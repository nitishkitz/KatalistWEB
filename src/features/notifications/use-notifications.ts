import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getNotifications, markNotificationsRead, useLocalVersion } from "@/features/things/local-state";
import { keys } from "@/domain/query-keys";

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

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
        .select("id, title, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body ?? "",
        read: Boolean(n.read_at),
        createdAt: n.created_at,
      }));
    },
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: ["notifications-unread", user?.id] });
    },
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      if (preview) return;
      const { error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(user?.id) });
      void qc.invalidateQueries({ queryKey: ["notifications-unread", user?.id] });
    },
  });

  const items: NotificationItem[] = preview
    ? getNotifications().map((n) => ({ id: n.id, title: n.title, body: n.body, read: n.read, createdAt: "" }))
    : (list.data ?? []);
  const unread = preview ? items.some((n) => !n.read) : (unreadQuery.data ?? 0) > 0;

  return { items, unread, markAll, markOne, preview };
}
