import { useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";
import { keys } from "@/domain/query-keys";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getMergedThings } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { currentDemoActorId } from "@/features/demo/identities";
import { fetchSolvedThingCount, fetchSolvedThings, solvedThingsFromLocal } from "./fetch-solved-things";

/** Profile-wide count of currently solved Things; null while unavailable. */
export function useSolvedThingCount(): { count: number | null; isError: boolean; retry: () => void } {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();
  const query = useQuery({
    queryKey: [...keys.solvedThings(user?.id), "count"],
    queryFn: () => fetchSolvedThingCount(user!.id, qc),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });
  if (preview) {
    return { count: solvedThingsFromLocal(getMergedThings(), currentDemoActorId()).length, isError: false, retry: () => undefined };
  }
  return { count: query.data ?? null, isError: query.isError, retry: () => void query.refetch() };
}

/** Paginated list of currently solved Things; fetches only while `enabled`. */
export function useSolvedThings(enabled: boolean) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const version = useLocalVersion();

  const query = useInfiniteQuery({
    queryKey: [...keys.solvedThings(user?.id), "list"],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchSolvedThings(user!.id, qc, pageParam, signal),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
    enabled: enabled && Boolean(user) && !preview,
    staleTime: 10_000,
  });

  const things = useMemo<Thing[]>(() => {
    if (preview) return solvedThingsFromLocal(getMergedThings(), currentDemoActorId());
    const seen = new Set<string>();
    const out: Thing[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const thing of page.things) {
        if (seen.has(thing.id)) continue;
        seen.add(thing.id);
        out.push(thing);
      }
    }
    return out;
    // version re-derives the preview branch after local actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, query.data, version]);

  if (preview) {
    return {
      things,
      isLoading: false,
      isError: false,
      isStale: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => undefined,
      retry: () => undefined,
    };
  }
  const hasData = query.data !== undefined;
  return {
    things,
    isLoading: query.isLoading,
    isError: query.isError && !hasData,
    // A failed refetch or later page keeps the rows already loaded.
    isStale: query.isError && hasData,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      if (query.isFetchingNextPage || !query.hasNextPage) return;
      void query.fetchNextPage();
    },
    retry: () => void query.refetch(),
  };
}
