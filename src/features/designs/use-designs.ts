import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { designApi, fetchDesignFavoriteIds, fetchDesignFolders, fetchDesignResourcePage, fetchDesignThingLinks, fetchThingDesigns } from "./api";
import { removeDesignCover, replaceDesignCover } from "./covers";
import { signDesignCovers, supabaseCoverDeps } from "./covers-supabase";
import {
  DEFAULT_DESIGN_FILTER,
  DESIGN_PAGE_SIZE,
  designKeys,
  toDesignError,
  type DesignCursor,
  type DesignOperationError,
  type DesignResourceFilter,
} from "./design-queries";
import type { AddDesignInput, UpdateDesignInput } from "./api";
import type { DesignResource } from "./records";

/**
 * Designs persist only for signed-in, non-preview sessions. A preview/demo
 * session never reads or writes the shared tables; `available` is false so the
 * UI can show an unavailable state instead of fabricating data.
 */
function useDesignsAccess(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const profileId = user?.id;
  return { preview, profileId, available: Boolean(listId) && !preview && Boolean(profileId) };
}

export function useDesignResources(listId: string, filter: DesignResourceFilter = DEFAULT_DESIGN_FILTER) {
  const { available, preview } = useDesignsAccess(listId);
  const query = useInfiniteQuery({
    queryKey: designKeys.resources(listId, filter),
    queryFn: ({ pageParam, signal }) => fetchDesignResourcePage(listId, filter, pageParam, DESIGN_PAGE_SIZE, signal),
    initialPageParam: undefined as DesignCursor | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: available,
    staleTime: 15_000,
  });
  const resources: DesignResource[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    resources,
    unavailable: preview,
    isLoading: available && query.isLoading,
    isFetching: query.isFetching,
    /** Offline with nothing fetched yet: React Query pauses instead of failing. */
    isPaused: available && query.fetchStatus === "paused",
    hasFetchedOnce: query.data !== undefined,
    error: query.error as DesignOperationError | null,
    isFetchNextPageError: query.isFetchNextPageError,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export function useDesignFolders(listId: string) {
  const { available, preview } = useDesignsAccess(listId);
  const query = useQuery({
    queryKey: designKeys.folders(listId),
    queryFn: ({ signal }) => fetchDesignFolders(listId, signal),
    enabled: available,
    staleTime: 30_000,
  });
  return {
    folders: query.data ?? [],
    unavailable: preview,
    hasFetchedOnce: query.data !== undefined,
    isLoading: available && query.isLoading,
    error: query.error as DesignOperationError | null,
    refetch: query.refetch,
  };
}

export function useDesignFavorites(listId: string) {
  const { available, profileId } = useDesignsAccess(listId);
  const query = useQuery({
    queryKey: designKeys.favorites(listId, profileId),
    queryFn: ({ signal }) => fetchDesignFavoriteIds(listId, profileId as string, signal),
    enabled: available,
    staleTime: 30_000,
  });
  return {
    favoriteIds: new Set(query.data ?? []),
    hasFetchedOnce: query.data !== undefined,
    isLoading: available && query.isLoading,
    error: query.error as DesignOperationError | null,
    refetch: query.refetch,
  };
}

export function useDesignThingLinks(listId: string, resourceId: string | null) {
  const { available } = useDesignsAccess(listId);
  const query = useQuery({
    queryKey: designKeys.links(listId, resourceId ?? ""),
    queryFn: ({ signal }) => fetchDesignThingLinks(resourceId as string, signal),
    enabled: available && Boolean(resourceId),
    staleTime: 15_000,
  });
  return {
    links: query.data ?? [],
    isLoading: available && Boolean(resourceId) && query.isLoading,
    error: query.error as DesignOperationError | null,
    refetch: query.refetch,
  };
}

/** Designs linked to a Thing, for the Thing detail. Disabled in preview and without a List. */
export function useThingDesigns(thingId: string | null | undefined, listId: string | null | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const enabled = Boolean(thingId) && Boolean(listId) && !preview && Boolean(user?.id);
  const query = useQuery({
    queryKey: designKeys.thing(thingId ?? ""),
    queryFn: ({ signal }) => fetchThingDesigns(thingId as string, signal),
    enabled,
    staleTime: 15_000,
  });
  return {
    designs: query.data ?? [],
    isLoading: enabled && query.isLoading,
    hasFetchedOnce: query.data !== undefined,
    error: query.error as DesignOperationError | null,
    refetch: query.refetch,
  };
}

/** Short-lived signed URLs for the covers of the given designs (bounded by the page size). */
export function useDesignCoverUrls(listId: string, resources: readonly DesignResource[]) {
  const { available } = useDesignsAccess(listId);
  const keys = useMemo(
    () => [...new Set(resources.flatMap((r) => (r.coverStorageKey ? [r.coverStorageKey] : [])))].sort(),
    [resources],
  );
  const query = useQuery({
    queryKey: designKeys.covers(listId, keys),
    queryFn: ({ signal }) => signDesignCovers(keys, signal),
    enabled: available && keys.length > 0,
    staleTime: 30 * 60_000, // signed for an hour
  });
  return { urls: query.data ?? new Map<string, string>(), error: query.error };
}

/**
 * Mutations capture the identity epoch before the request and only invalidate
 * caches if that identity is still current, so a late completion after a
 * sign-out or account switch cannot touch the new identity's cache.
 */
export function useDesignMutations(listId: string) {
  const qc = useQueryClient();
  const { profileId, available } = useDesignsAccess(listId);

  const guarded = <TVars, TData>(fn: (vars: TVars) => Promise<TData>, invalidate: () => void) => ({
    mutationFn: async (vars: TVars) => {
      if (!available) throw toDesignError({ message: "Designs are unavailable in this session.", code: "28000" });
      return fn(vars);
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data: TData, _vars: TVars, ctx: { epoch: number } | undefined) => {
      if (ctx && isEpochCurrent(qc, ctx.epoch)) invalidate();
    },
  });

  const refreshResources = () => void qc.invalidateQueries({ queryKey: designKeys.resourcesPrefix(listId) });
  const refreshFolders = () => void qc.invalidateQueries({ queryKey: designKeys.folders(listId) });

  return {
    addResource: useMutation(guarded((input: Omit<AddDesignInput, "listId">) => designApi.addResource({ ...input, listId }), refreshResources)),
    updateResource: useMutation(guarded((input: UpdateDesignInput) => designApi.updateResource(input), refreshResources)),
    setArchived: useMutation(
      guarded(
        (vars: { resourceId: string; archived: boolean }) => designApi.setArchived(vars.resourceId, vars.archived),
        () => {
          refreshResources();
          void qc.invalidateQueries({ queryKey: designKeys.favorites(listId, profileId) });
        },
      ),
    ),
    setFavorite: useMutation(
      guarded(
        (vars: { resourceId: string; favorite: boolean }) => designApi.setFavorite(vars.resourceId, vars.favorite),
        () => void qc.invalidateQueries({ queryKey: designKeys.favorites(listId, profileId) }),
      ),
    ),
    // Cover changes run immediately (not with Save). Caches refresh only after a confirmed success.
    replaceCover: useMutation(
      guarded(
        (vars: { resourceId: string; file: File; head: Uint8Array }) => replaceDesignCover({ listId, ...vars }, supabaseCoverDeps),
        () => {
          refreshResources();
          void qc.invalidateQueries({ queryKey: designKeys.coversPrefix(listId) });
        },
      ),
    ),
    removeCover: useMutation(
      guarded(
        (resourceId: string) => removeDesignCover(resourceId, supabaseCoverDeps),
        () => {
          refreshResources();
          void qc.invalidateQueries({ queryKey: designKeys.coversPrefix(listId) });
        },
      ),
    ),
    createFolder: useMutation(guarded((name: string) => designApi.createFolder(listId, name), refreshFolders)),
    renameFolder: useMutation(
      guarded((vars: { folderId: string; name: string }) => designApi.renameFolder(vars.folderId, vars.name), refreshFolders),
    ),
    // Deleting a folder unfiles its designs, so resource pages change too.
    deleteFolder: useMutation(
      guarded((folderId: string) => designApi.deleteFolder(folderId), () => {
        refreshFolders();
        refreshResources();
      }),
    ),
    linkThing: useMutation(
      guarded(
        (vars: { resourceId: string; thingId: string }) => designApi.linkThing(vars.resourceId, vars.thingId),
        () => {
          void qc.invalidateQueries({ queryKey: designKeys.linksPrefix(listId) });
          void qc.invalidateQueries({ queryKey: designKeys.thingPrefix });
        },
      ),
    ),
    unlinkThing: useMutation(
      guarded(
        (vars: { resourceId: string; thingId: string }) => designApi.unlinkThing(vars.resourceId, vars.thingId),
        () => {
          void qc.invalidateQueries({ queryKey: designKeys.linksPrefix(listId) });
          void qc.invalidateQueries({ queryKey: designKeys.thingPrefix });
        },
      ),
    ),
  };
}
