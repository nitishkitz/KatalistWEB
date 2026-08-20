import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getBucketRefs, getListById, getThing } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcAddToBucket, rpcRemoveFromBucket } from "@/features/things/rpc";
import { useCourt } from "@/features/court/use-court";
import { useLists } from "@/features/lists/use-lists";
import { keys } from "@/domain/query-keys";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";

export type BucketItem =
  | { kind: "thing"; thingId: string; thing: Thing }
  | { kind: "list"; listId: string; list: ListRow };

const LIST_COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

async function fetchListsByIds(profileId: string, listIds: string[]): Promise<ListRow[]> {
  if (!listIds.length) return [];
  const { data: lists, error } = await supabase
    .from("lists")
    .select("id,name,context,owner_profile_id,updated_at")
    .in("id", listIds);
  if (error) throw error;
  const ids = (lists ?? []).map((l) => l.id);
  const { data: members } = ids.length
    ? await supabase.from("list_members").select("list_id,profile_id,role,profiles(display_name,avatar_url)").in("list_id", ids)
    : { data: [] };
  const { data: things } = ids.length
    ? await supabase.from("things").select("id,list_id,work_status").in("list_id", ids)
    : { data: [] };

  return (lists ?? []).map((l, i) => {
    const listMembers = (members ?? []).filter((m) => m.list_id === l.id);
    const mine = listMembers.find((m) => m.profile_id === profileId);
    const role = l.owner_profile_id === profileId ? "owner" : (mine?.role ?? "view_only");
    const listThings = (things ?? []).filter((t) => t.list_id === l.id);
    const ownerMember = listMembers.find((m) => m.profile_id === l.owner_profile_id);
    const ownerProfile = (ownerMember as { profiles?: { display_name?: string } } | undefined)?.profiles;
    return {
      id: l.id,
      name: l.name,
      context: l.context,
      role,
      ownerLine: l.owner_profile_id === profileId ? "Owned by you" : ownerProfile?.display_name ? `Owned by ${ownerProfile.display_name}` : "Shared list",
      members: listMembers.slice(0, 5).map((m) => {
        const profile = (m as { profiles?: { display_name?: string; avatar_url?: string | null } }).profiles;
        const name = profile?.display_name ?? "Member";
        return {
          name,
          profileId: m.profile_id,
          role: (m.role ?? "collaborator") as ListRow["role"],
          initials: name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          avatarUrl: profile?.avatar_url ?? null,
        };
      }),
      memberCount: listMembers.length,
      thingCount: listThings.length,
      doneCount: listThings.filter((t) => t.work_status === "sorted").length,
      inProgressCount: listThings.filter((t) => t.work_status === "under_progress").length,
      unread: 0,
      latestActivity: "Updated",
      updatedAt: new Date(l.updated_at).toLocaleString(),
      color: LIST_COLORS[i % LIST_COLORS.length]!,
    } satisfies ListRow;
  });
}

function resolveDemoItems(bucketId: string): BucketItem[] {
  const items: BucketItem[] = [];
  for (const ref of getBucketRefs(bucketId)) {
    if (ref.kind === "thing" && ref.thingId) {
      const thing = getThing(ref.thingId);
      if (thing) items.push({ kind: "thing", thingId: thing.id, thing });
    } else if (ref.kind === "list" && ref.listId) {
      const list = getListById(ref.listId);
      if (list) items.push({ kind: "list", listId: list.id, list });
    }
  }
  return items;
}

export function useAccessibleThings() {
  const court = useCourt();
  useLocalVersion();
  return court.all;
}

export function useAccessibleLists() {
  const { lists } = useLists();
  return lists;
}

export function useBucketItems(bucketId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.bucketItems(bucketId ?? "none"),
    enabled: Boolean(bucketId) && Boolean(user) && !preview,
    queryFn: async (): Promise<BucketItem[]> => {
      const { data, error } = await supabase
        .from("bucket_items")
        .select("thing_id, list_id")
        .eq("bucket_id", bucketId!);
      if (error) throw error;
      const thingIds = (data ?? []).map((r) => r.thing_id).filter(Boolean) as string[];
      const listIds = (data ?? []).map((r) => r.list_id).filter(Boolean) as string[];

      const { data: thingRows, error: thingError } = thingIds.length
        ? await supabase.from("things").select(THING_COLUMNS).in("id", thingIds)
        : { data: [], error: null };
      if (thingError) throw thingError;
      const things = await mapDbThingRows((thingRows ?? []) as DbThingRow[]);
      const thingById = new Map(things.map((t) => [t.id, t]));
      const lists = await fetchListsByIds(user!.id, listIds);
      const listById = new Map(lists.map((l) => [l.id, l]));

      const items: BucketItem[] = [];
      for (const r of data ?? []) {
        if (r.thing_id) {
          const thing = thingById.get(r.thing_id);
          if (thing) items.push({ kind: "thing", thingId: thing.id, thing });
        } else if (r.list_id) {
          const list = listById.get(r.list_id);
          if (list) items.push({ kind: "list", listId: list.id, list });
        }
      }
      return items;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["bucket-items"] });
    void qc.invalidateQueries({ queryKey: ["bucket"] });
    void qc.invalidateQueries({ queryKey: ["buckets"] });
  };

  const add = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) => rpcAddToBucket(bucketId!, input.thingId, input.listId),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) =>
      rpcRemoveFromBucket(bucketId!, input.thingId, input.listId),
    onSuccess: invalidate,
  });

  const items: BucketItem[] = preview && bucketId ? resolveDemoItems(bucketId) : (query.data ?? []);
  return { items, add, remove, isLoading: !preview && query.isLoading, error: query.error };
}

export type { Thing };
