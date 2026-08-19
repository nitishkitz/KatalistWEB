import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

export function useRealtimeInvalidation() {
  const qc = useQueryClient();
  const { session } = useSession();
  const real = Boolean(session) && session?.user.app_metadata?.provider !== "demo";

  useEffect(() => {
    if (!real) return;
    const channel = supabase
      .channel("katalist-movement")
      .on("postgres_changes", { event: "*", schema: "public", table: "things" }, () => {
        void qc.invalidateQueries({ queryKey: ["court"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["list-things"] });
        void qc.invalidateQueries({ queryKey: ["lists"] });
        void qc.invalidateQueries({ queryKey: ["list"] });
        void qc.invalidateQueries({ queryKey: ["buckets"] });
        void qc.invalidateQueries({ queryKey: ["bucket"] });
        void qc.invalidateQueries({ queryKey: ["bucket-items"] });
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["trophy"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
        void qc.invalidateQueries({ queryKey: ["notifications-unread"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thing_comments" }, () => {
        void qc.invalidateQueries({ queryKey: ["thing-comments"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thing_activity" }, () => {
        void qc.invalidateQueries({ queryKey: ["thing-activity"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["trophy"] });
        void qc.invalidateQueries({ queryKey: ["lists"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "nudges" }, () => {
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
        void qc.invalidateQueries({ queryKey: ["notifications-unread"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "list_messages" }, () => {
        void qc.invalidateQueries({ queryKey: ["list-messages"] });
        void qc.invalidateQueries({ queryKey: ["list"] });
        void qc.invalidateQueries({ queryKey: ["lists"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bucket_items" }, () => {
        void qc.invalidateQueries({ queryKey: ["bucket"] });
        void qc.invalidateQueries({ queryKey: ["buckets"] });
        void qc.invalidateQueries({ queryKey: ["bucket-items"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "list_members" }, () => {
        void qc.invalidateQueries({ queryKey: ["list"] });
        void qc.invalidateQueries({ queryKey: ["lists"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, real]);
}
