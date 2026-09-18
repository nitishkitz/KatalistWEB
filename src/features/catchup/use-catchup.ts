import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { isActiveThing, type Person, type Thing } from "@/domain/thing";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { resolveActorPeople } from "@/features/people/resolve-actors";
import { useLocalVersion } from "@/features/things/use-local-version";
import { currentDemoActorId } from "@/features/demo/identities";
import {
  accessibleDemoThings,
  getCatchupSurfaced,
  getEndedSnoozeEntries,
  getGhostCandidate,
  getNotifications,
  getThing,
  personById as demoPersonById,
  surfaceCatchupLocal,
} from "@/features/things/local-state";
import { isDoormanEnabled } from "@/features/doorman/use-doorman";
import {
  resolveMoments,
  type CatchUpMomentKind,
  type RawCatchUpMoment,
} from "./catchup-logic";

export type CatchUpMoment = {
  momentKey: string;
  kind: CatchUpMomentKind;
  thing: Thing;
  occurredAt: string;
  actor?: Person | null;
  reason: string;
};

type RpcRow = {
  moment_key: string;
  kind: string;
  thing_id: string;
  occurred_at: string;
  actor_id: string | null;
  reason: string;
};

async function fetchCatchupMoments(): Promise<CatchUpMoment[]> {
  // Cast: the new RPC is not yet in the generated Supabase types.
  const { data, error } = await (supabase.rpc as any)("list_catchup_moments");
  if (error) throw error;
  const rows = (data ?? []) as RpcRow[];
  if (!rows.length) return [];

  const { data: auth } = await supabase.auth.getUser();
  let myActorId: string | null = null;
  if (auth.user) {
    const { data: actor } = await supabase
      .from("actors")
      .select("id")
      .eq("profile_id", auth.user.id)
      .maybeSingle();
    myActorId = actor?.id ?? null;
  }

  const thingIds = [...new Set(rows.map((r) => r.thing_id))];
  const { data: thingRows } = await supabase
    .from("things")
    .select(THING_COLUMNS)
    .in("id", thingIds)
    .is("cancelled_at", null);
  const things = await mapDbThingRows((thingRows ?? []) as DbThingRow[], myActorId);
  const thingById = new Map(things.map((t) => [t.id, t]));

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const people = actorIds.length ? await resolveActorPeople(actorIds) : new Map<string, Person>();

  const doorman = isDoormanEnabled();
  const moments: CatchUpMoment[] = [];
  for (const r of rows) {
    if (r.kind === "ghost" && !doorman) continue;
    const thing = thingById.get(r.thing_id);
    if (!thing) continue; // Not resolvable/visible — skip rather than show an empty card.
    moments.push({
      momentKey: r.moment_key,
      kind: r.kind as CatchUpMomentKind,
      thing,
      occurredAt: r.occurred_at,
      actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
      reason: r.reason,
    });
  }
  return moments;
}

/** Derive Catch Up moments from demo local-state, mirroring the live RPC. */
function derivePreviewMoments(context: "work" | "home"): CatchUpMoment[] {
  const me = currentDemoActorId();
  const raw: RawCatchUpMoment[] = [];

  // Nudges received by me.
  for (const n of getNotifications()) {
    if (n.type !== "NUDGED" || !n.thingId) continue;
    raw.push({
      momentKey: `nudge:local:${n.id}`,
      kind: "nudge",
      thingId: n.thingId,
      occurredAt: n.at,
      reason: "waiting_for_catch",
    });
  }

  // Personal snoozes that have naturally woken.
  for (const e of getEndedSnoozeEntries()) {
    raw.push({
      momentKey: `snooze:local:${e.thingId}:${e.untilMs}`,
      kind: "snooze_ended",
      thingId: e.thingId,
      occurredAt: new Date(e.untilMs).toISOString(),
      reason: "snooze_ended",
    });
  }

  // Active Doorman breakthrough.
  if (isDoormanEnabled()) {
    const ghost = getGhostCandidate(context);
    if (ghost) {
      raw.push({
        momentKey: `ghost:local:${ghost.id}`,
        kind: "ghost",
        thingId: ghost.id,
        occurredAt: new Date().toISOString(),
        reason: "ghost",
      });
    }
  }

  // Owner-facing follow-ups: Things I own, held by others, due within 3h/overdue.
  const now = Date.now();
  const soonMs = 3 * 60 * 60 * 1000;
  for (const t of accessibleDemoThings(context)) {
    if (!isActiveThing(t)) continue;
    if (t.owner.id !== me || t.assignee.id === me) continue;
    if (!t.dueAt) continue;
    const due = new Date(t.dueAt).getTime();
    if (Number.isNaN(due) || due - now > soonMs) continue;
    raw.push({
      momentKey: `followup:local:${t.id}:due_soon`,
      kind: "follow_up",
      thingId: t.id,
      occurredAt: t.dueAt,
      reason: "due_soon",
    });
  }

  const resolved = resolveMoments(raw, getCatchupSurfaced());
  const out: CatchUpMoment[] = [];
  for (const m of resolved) {
    const thing = getThing(m.thingId);
    if (!thing) continue;
    out.push({
      momentKey: m.momentKey,
      kind: m.kind,
      thing,
      occurredAt: m.occurredAt,
      actor: m.actorId ? demoPersonById(m.actorId) : null,
      reason: m.reason,
    });
  }
  return out;
}

export type UseCatchup = {
  moments: CatchUpMoment[];
  count: number;
  isLoading: boolean;
  surfaceMoment: (momentKey: string) => void;
  refresh: () => void;
};

export function useCatchup(): UseCatchup {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  const { context } = useAppContext();
  const qc = useQueryClient();
  const localVersion = useLocalVersion();

  const query = useQuery({
    queryKey: keys.catchup(user?.id, context),
    queryFn: fetchCatchupMoments,
    enabled: liveAuth,
    staleTime: 15_000,
  });

  const previewMoments = useMemo(
    () => (preview ? derivePreviewMoments(context) : []),
    // localVersion re-derives on any local mutation.
    [preview, context, localVersion],
  );

  const surface = useMutation({
    mutationFn: async (momentKey: string) => {
      // Cast: the new RPC is not yet in the generated Supabase types.
      const { error } = await (supabase.rpc as any)("surface_catchup_moment", {
        p_moment_key: momentKey,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catchup"] }),
  });

  const surfaceMoment = useCallback(
    (momentKey: string) => {
      if (preview) {
        surfaceCatchupLocal(momentKey);
        return;
      }
      surface.mutate(momentKey);
    },
    [preview, surface],
  );

  const refresh = useCallback(() => {
    if (preview) return; // local derivation is always current
    void query.refetch();
  }, [preview, query]);

  const moments = preview ? previewMoments : query.data ?? [];

  return {
    moments,
    count: moments.length,
    isLoading: liveAuth && query.isLoading,
    surfaceMoment,
    refresh,
  };
}
