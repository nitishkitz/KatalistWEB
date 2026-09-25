import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { isActiveThing, type Person, type Thing } from "@/domain/thing";
import { mapDbThingRows, THING_OVERVIEW_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
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
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import {
  resolveMoments,
  type CatchUpMomentKind,
  type RawCatchUpMoment,
} from "./catchup-logic";
import { withReadDeadline } from "@/lib/read-request";
import { classifyAsyncError, resolveAsyncBranch, type AsyncBranch } from "@/lib/query-policy";

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

async function fetchCatchupMoments(
  profileId: string | null,
  context: "work" | "home",
  querySignal?: AbortSignal,
): Promise<CatchUpMoment[]> {
  // T01: bounds the RPC plus its dependent reads (actor, Things) as one
  // logical read operation under a single deadline, wired to React
  // Query's own cancellation signal.
  return withReadDeadline(querySignal, async (signal) => {
    const { data, error } = await callUngeneratedRpc("list_catchup_moments").abortSignal(signal);
    if (error) throw error;
    const rows = (data ?? []) as RpcRow[];
    if (!rows.length) return [];

    // R-08: this used to make its own supabase.auth.getUser() call and read
    // only its `data`, discarding `error` -- a failed identity lookup
    // produced `auth.user === null`, indistinguishable from "genuinely
    // authenticated but has no actor row", silently mapping every moment
    // with `myActorId = null` and reporting a successful load. The caller
    // (useCatchup) already has the authenticated profile id from
    // useSession() -- the same identity source used elsewhere in this
    // codebase (e.g. use-morning-brief.ts) -- for the enabled query to even
    // run at all, so it's reused directly here instead of a second,
    // independently-fallible auth round trip.
    let myActorId: string | null = null;
    if (profileId) {
      const { data: actor, error: actorError } = await supabase
        .from("actors")
        .select("id")
        .eq("profile_id", profileId)
        .abortSignal(signal)
        .maybeSingle();
      // F-05: required for correctly viewer-scoping the resolved Things below
      // (map-thing-rows.ts uses it for capability/pace fields) -- a failure
      // here must not silently fall through to myActorId = null (which
      // would look identical to "I have no actor row", a real and different
      // state) and let the caller believe the resulting moments are
      // complete/correct.
      if (actorError) throw actorError;
      myActorId = actor?.id ?? null;
    }

    const thingIds = [...new Set(rows.map((r) => r.thing_id))];
    const { data: thingRows, error: thingsError } = await supabase
      .from("things")
      .select(THING_OVERVIEW_COLUMNS)
      .in("id", thingIds)
      .is("cancelled_at", null)
      .abortSignal(signal);
    // F-05: this is the required data the whole moments list is built from --
    // a failure here used to silently become an empty thingRows (via `?? []`),
    // which made a genuine lookup failure indistinguishable from "none of
    // these Things are visible/active", i.e. a false successful-empty result
    // that could suppress a real Morning Brief moment or Catch Up review.
    if (thingsError) throw thingsError;
    const things = await mapDbThingRows((thingRows ?? []) as DbThingRow[], myActorId, "overview");
    const thingById = new Map(things.map((t) => [t.id, t]));

    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
    const people = actorIds.length ? await resolveActorPeople(actorIds) : new Map<string, Person>();

    const doorman = isDoormanEnabled();
    const moments: CatchUpMoment[] = [];
    for (const r of rows) {
      if (r.kind === "ghost" && !doorman) continue;
      const thing = thingById.get(r.thing_id);
      if (!thing) continue; // Not resolvable/visible — skip rather than show an empty card.
      // T10-01: list_catchup_moments() (supabase/migrations/20260918120000_catchup.sql)
      // has no notion of Work/Home context -- it returns moments across both,
      // scoped only by profile/actor. The query key already varies by
      // `context` (domain/query-keys.ts), but until this filter existed the
      // returned Things were never actually narrowed to it, so switching
      // context could show (or count) a moment that belongs to the other
      // context's Thing. Filter on the resolved, capability-mapped Thing's
      // own context -- never on the raw row or a notification/RPC label.
      if (thing.context !== context) continue;
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
  });
}

/** Derive Catch Up moments from demo local-state, mirroring the live RPC. */
function derivePreviewMoments(context: "work" | "home"): CatchUpMoment[] {
  const me = currentDemoActorId();
  const raw: RawCatchUpMoment[] = [];

  // T10-01: the current context's own authorized-Thing set -- the same
  // context+access gate accessibleDemoThings() already applies for Court's
  // own rows. A moment whose underlying Thing is not in this set (wrong
  // context, or no longer accessible -- shredded/removed from a shared
  // list) must not be surfaced, even though getThing() below can still
  // resolve it by id alone. Ghost breakthroughs are the one deliberate
  // exception: getGhostCandidate() surfaces a Thing from the OTHER
  // context by design (a cross-context interruption), so this gate is
  // never applied to that category.
  const authorized = new Map(accessibleDemoThings(context).map((t) => [t.id, t] as const));

  // Nudges received by me.
  for (const n of getNotifications()) {
    if (n.type !== "NUDGED" || !n.thingId) continue;
    if (!authorized.has(n.thingId)) continue;
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
    if (!authorized.has(e.thingId)) continue;
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
    // Ghost is deliberately cross-context (see authorized's own comment
    // above) -- resolve it by id alone. Every other kind was already
    // gated through `authorized` above, so re-resolving through the same
    // map (rather than a bare getThing()) keeps this loop from
    // accidentally re-admitting a Thing that failed the context/access
    // gate if a future moment kind is added here without updating it.
    const thing = m.kind === "ghost" ? getThing(m.thingId) : authorized.get(m.thingId);
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
  /** F-05: set when the live RPC or one of its required follow-up lookups
   *  (actor id, Things) failed -- distinct from a genuinely empty result.
   *  Always null in preview (local derivation can't fail this way). A
   *  consumer deciding whether to auto-interrupt (Morning Brief) must
   *  treat this as "unknown", not "confirmed no moments". */
  error: unknown;
  /** T10-01: a real AsyncState-shaped branch (query-policy.ts's own
   *  contract, reused rather than a parallel invention) -- "pending"
   *  covers both an initial fetch and a query paused offline before its
   *  first result, "ready" is a settled result (possibly empty; see
   *  `isEmpty`), and "error" means the initial load itself never
   *  produced usable data. A background refetch failure with prior
   *  cached moments still reports "ready" (stale-but-usable), matching
   *  resolveAsyncBranch()'s own "ready" fallthrough for a non-empty,
   *  non-confirmed-loss failure. */
  branch: AsyncBranch;
  /** True once this result is a confirmed, settled fact -- zero moments
   *  because there genuinely are none right now, not because the query
   *  hasn't resolved yet. Always true in preview (local derivation is
   *  synchronous and always current). */
  isEmpty: boolean;
  /** True when `error` is a confirmed access loss (unauthenticated,
   *  forbidden, or not-found) rather than an ambiguous/transient failure
   *  a caller could plausibly retry past. Always false in preview. */
  confirmedAccessLoss: boolean;
  /** Awaitable: preview resolves once the local receipt is recorded;
   *  live resolves on the RPC's own success and rejects on its failure
   *  (including a mid-flight identity/context switch's own cache
   *  invalidation being skipped -- that never affects this promise's own
   *  settlement, only whether a stale caller's later work still runs). */
  surfaceMoment: (momentKey: string) => Promise<void>;
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
    queryFn: ({ signal }) => fetchCatchupMoments(user?.id ?? null, context, signal),
    enabled: liveAuth,
    staleTime: 15_000,
  });

  const previewMoments = useMemo(
    () => (preview ? derivePreviewMoments(context) : []),
    // localVersion re-derives on any local mutation. derivePreviewMoments()
    // reads mutable module-level local-state, not localVersion itself, so
    // the linter can't see it's a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, context, localVersion],
  );

  const surface = useMutation({
    mutationFn: async (momentKey: string) => {
      const { error } = await callUngeneratedRpc("surface_catchup_moment", {
        p_moment_key: momentKey,
      });
      if (error) throw error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => {
      if (isEpochCurrent(qc, mutationContext.epoch)) void qc.invalidateQueries({ queryKey: ["catchup"] });
    },
  });

  const surfaceMoment = useCallback(
    async (momentKey: string) => {
      if (preview) {
        // Synchronous today, but kept awaitable so a future storage-backed
        // preview receipt (T10-02) can fail without changing this
        // contract, and so callers can uniformly await both paths.
        surfaceCatchupLocal(momentKey);
        return;
      }
      await surface.mutateAsync(momentKey);
    },
    [preview, surface],
  );

  const refresh = useCallback(() => {
    if (preview) return; // local derivation is always current
    void query.refetch();
  }, [preview, query]);

  const moments = preview ? previewMoments : query.data ?? [];
  const isEmpty = moments.length === 0;
  // T10-01: `query.data !== undefined` is the "has this query ever settled
  // successfully" fact resolveAsyncBranch() needs -- `!isLoading` alone
  // cannot distinguish a genuine confirmed-empty result from a query
  // that's paused (offline, never fetched) or between renders, both of
  // which also report `isLoading: false`. Preview has no such ambiguity:
  // local derivation is synchronous and always current.
  const hasFetchedOnce = preview || query.data !== undefined;
  const branch: AsyncBranch = preview
    ? isEmpty
      ? "empty"
      : "ready"
    : resolveAsyncBranch({
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        isLoading: query.isLoading,
        error: query.error,
        isEmpty,
        hasFetchedOnce,
      });
  const confirmedAccessLoss =
    !preview &&
    query.error != null &&
    (() => {
      const kind = classifyAsyncError(query.error);
      return kind === "unauthenticated" || kind === "forbidden" || kind === "not-found";
    })();

  return {
    moments,
    count: moments.length,
    isLoading: liveAuth && query.isLoading,
    error: preview ? null : query.error,
    branch,
    isEmpty: preview ? true : hasFetchedOnce && isEmpty,
    confirmedAccessLoss,
    surfaceMoment,
    refresh,
  };
}
