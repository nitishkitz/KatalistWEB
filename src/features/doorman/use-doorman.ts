import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { dismissGhost, getGhostCandidate } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useAppContext } from "@/features/context/use-app-context";
import { fetchPersonalShred } from "@/features/things/personal-shred";
import type { ContextKind, Thing } from "@/domain/thing";

export type Ghost = {
  id: string;
  title: string;
  context: ContextKind;
  thingId: string;
};

export function useDoorman() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const { context } = useAppContext();
  const qc = useQueryClient();
  useLocalVersion();

  const query = useQuery({
    queryKey: ["doorman", user?.id, context],
    enabled: Boolean(user) && !preview,
    staleTime: 20_000,
    queryFn: async (): Promise<Ghost | null> => {
      const { data: rows, error } = await supabase
        .from("doorman_state")
        .select("id, thing_id, dismissed_at, snoozed_until, breakthrough_reason")
        .is("dismissed_at", null);
      if (error) throw error;
      const shred = await fetchPersonalShred();
      const now = Date.now();
      const open = (rows ?? []).filter(
        (r) =>
          !shred.thingIds.has(r.thing_id) && (!r.snoozed_until || new Date(r.snoozed_until).getTime() < now),
      );
      if (!open.length) return null;
      const ids = open.map((r) => r.thing_id);
      const { data: things } = await supabase.from("things").select("id, title, context").in("id", ids);
      const other = (things ?? []).find((t) => t.context !== context && !shred.thingIds.has(t.id));
      if (!other) return null;
      const state = open.find((r) => r.thing_id === other.id);
      if (state) {
        await supabase.rpc("doorman_mark_presented", { p_thing_id: other.id });
      }
      return { id: other.id, title: other.title, context: other.context, thingId: other.id };
    },
  });

  const snooze = useMutation({
    mutationFn: async (thingId: string) => {
      if (preview) {
        dismissGhost(thingId);
        return;
      }
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error } = await supabase.rpc("snooze_breakthrough", { p_thing_id: thingId, p_snoozed_until: until });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["doorman"] }),
  });

  const dismiss = useMutation({
    mutationFn: async (thingId: string) => {
      if (preview) {
        dismissGhost(thingId);
        return;
      }
      const { error } = await supabase.rpc("dismiss_breakthrough", { p_thing_id: thingId });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["doorman"] }),
  });

  let ghost: Ghost | null = null;
  if (preview) {
    const g = getGhostCandidate(context);
    ghost = g ? { id: g.id, title: g.title, context: g.context, thingId: g.id } : null;
  } else {
    ghost = query.data ?? null;
  }

  return { ghost, snooze, dismiss, preview };
}

export type { Thing };
