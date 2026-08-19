import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

export function useRealtimeInvalidation() {
  const qc = useQueryClient();
  const { session } = useSession();
  const real = Boolean(session) && session?.app_metadata?.provider !== "demo";

  useEffect(() => {
    if (!real) return;
    const channel = supabase
      .channel("katalist-movement")
      .on("postgres_changes", { event: "*", schema: "public", table: "things" }, () => {
        void qc.invalidateQueries({ queryKey: ["court"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["nudges"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thing_comments" }, () => {
        void qc.invalidateQueries({ queryKey: ["thing"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "nudges" }, () => {
        void qc.invalidateQueries({ queryKey: ["nudges"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "list_messages" }, () => {
        void qc.invalidateQueries({ queryKey: ["list"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, real]);
}
