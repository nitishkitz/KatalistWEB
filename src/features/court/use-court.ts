import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, partitionCourt, theirStateFor } from "@/domain/thing";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { currentDemoActorId, currentDemoPerson } from "@/features/demo/identities";
import { accessibleDemoThings, getComments, getSnoozedIds } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { isPreviewSession } from "@/lib/session-mode";
import { excludePersonallyShreddedThings, usePersonalShred } from "@/features/things/personal-shred";
import { excludeSnoozedThings, usePersonalSnooze } from "@/features/things/personal-snooze";
import { calculateCommentCounts, getThingLastReadAt, useThingReadState } from "@/features/things/read-state";
import { fetchCourt } from "./fetch-court";

// Preview data is local, so a refetch has nothing to fetch.
const previewRefetch = () => Promise.resolve(undefined);

export function useCourt() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  const { context } = useAppContext();
  const qc = useQueryClient();
  // Preview Courts read the local store; this version must feed the memo below
  // so a Toss, catch, pace change or snooze re-derives the lanes.
  const localVersion = useLocalVersion();
  const shred = usePersonalShred();
  const snooze = usePersonalSnooze();
  const readVersion = useThingReadState();

  const query = useQuery({
    queryKey: keys.court(user?.id, context),
    queryFn: ({ signal }) => fetchCourt(context, user!.id, qc, signal),
    staleTime: 15_000,
    enabled: liveAuth,
  });
  const attachmentRecovery = useRef({ key: "", attempts: 0 });
  useEffect(() => {
    const key = `${user?.id ?? "none"}:${context}`;
    if (attachmentRecovery.current.key !== key) attachmentRecovery.current = { key, attempts: 0 };
    if (!liveAuth || !query.data?.things.some((thing) => thing.attachmentsUnavailable)) return;
    if (attachmentRecovery.current.attempts >= 2) return;
    const timer = window.setTimeout(() => {
      attachmentRecovery.current.attempts += 1;
      void query.refetch();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [context, liveAuth, query.data, query.refetch, user?.id]);

  const source = useMemo(() => {
    if (preview) {
      const me = currentDemoActorId();
      const mePerson = currentDemoPerson();
      const snoozedIds = getSnoozedIds();
      const things = accessibleDemoThings(context)
        .filter((t) => !snoozedIds.has(t.id))
        .map((t) => {
        const localComments = getComments(t.id);
        const counts = calculateCommentCounts(
          t.id,
          localComments.map((c) => ({
            author: c.author,
            createdAt: c.at,
          })),
          me,
          mePerson.name,
        );
        return {
          ...t,
          commentCount: counts.commentCount,
          unreadCommentCount: counts.unreadCommentCount,
        };
      });
      return { things, myActorId: me, live: false as const };
    }
    // T05: unreadCommentCount already arrives from mapDbThingRows ->
    // calculateCommentCounts, which already compares each comment's own
    // timestamp against getThingLastReadAt as of the last fetch -- this
    // pass only optimistically zeroes it further when the read happened
    // AT OR AFTER that fetch (so we know it truly covers every comment the
    // server counted). The old version zeroed it whenever lastRead > 0 at
    // all, with no timing check, which discarded genuinely new unread
    // comments that arrived in a later fetch after a Thing had ever been
    // read even once.
    const visibleThings = excludeSnoozedThings(
      excludePersonallyShreddedThings(query.data?.things ?? [], shred),
      snooze,
    );
    const myLiveActorId = query.data?.myActorId ?? null;
    const fetchedAt = query.dataUpdatedAt;
    const liveThings = visibleThings.map((t) => {
      const lastRead = getThingLastReadAt(t.id, myLiveActorId);
      if (lastRead > 0 && lastRead >= fetchedAt && (t.unreadCommentCount ?? 0) > 0) {
        return {
          ...t,
          unreadCommentCount: 0,
        };
      }
      return t;
    });
    return {
      things: liveThings,
      myActorId: query.data?.myActorId ?? null,
      live: true as const,
    };
    // readVersion forces re-derivation when getThingLastReadAt's mutable
    // module-level read-state changes; the memo doesn't reference
    // readVersion directly, so the linter can't see it's a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, query.data, query.dataUpdatedAt, context, shred, snooze, readVersion, localVersion]);

  const parts = partitionCourt(source.things, source.myActorId ?? "");
  const theirs = parts.theirs;
  const completedCount = useMemo(
    () => source.things.filter((t) => t.workStatus === "sorted" || Boolean(t.sortedAt)).length,
    [source.things],
  );

  return {
    isLoading: liveAuth && query.isLoading,
    // See useLists'/useBuckets' identical field: react-query's isLoading
    // reads false while a query is "paused" offline (never fetched, no
    // error, no data), which would otherwise look identical to a
    // confirmed empty Court. query.data persists across later
    // pauses/errors once populated.
    hasFetchedOnce: preview || query.data !== undefined,
    // Preview Courts are local data: an explicit refetch (e.g. the Catch Up
    // overlay's refresh) must never surface a live-fetch failure here.
    error: preview ? null : query.error,
    live: source.live,
    preview,
    now: parts.now,
    next: parts.next,
    later: parts.later,
    theirs,
    completedCount,
    all: source.things.filter(isActiveThing),
    myActorId: source.myActorId,
    theirGroups: {
      waiting_for_catch: theirs.filter((t) => theirStateFor(t) === "waiting_for_catch"),
      moving: theirs.filter((t) => theirStateFor(t) === "moving"),
      needs_attention: theirs.filter((t) => theirStateFor(t) === "needs_attention"),
    },
    refetch: preview ? previewRefetch : query.refetch,
    context,
  };
}
