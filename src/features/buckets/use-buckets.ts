import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { getBuckets } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcCreateBucket, rpcDeleteBucket, rpcRenameBucket } from "@/features/things/rpc";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { mapDbListRows, type DbListRow } from "@/features/lists/map-list-rows";
import type { BucketCard } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

async function fetchBuckets(context: "work" | "home", profileId: string): Promise<BucketCard[]> {
  const { data: buckets, error } = await supabase
    .from("buckets")
    .select("id,name,context,updated_at")
    .eq("context", context)
    .is("archived_at", null);
  if (error) throw error;
  const ids = (buckets ?? []).map((b) => b.id);
  const { data: items } = ids.length
    ? await supabase.from("bucket_items").select("bucket_id,thing_id,list_id").in("bucket_id", ids)
    : { data: [] };

  const thingIds = (items ?? []).map((i) => i.thing_id).filter(Boolean) as string[];
  const listIds = (items ?? []).map((i) => i.list_id).filter(Boolean) as string[];

  const { data: thingRows } = thingIds.length
    ? await supabase.from("things").select(THING_COLUMNS).in("id", thingIds)
    : { data: [] };

  const { data: listRows } = listIds.length
    ? await supabase.from("lists").select("id,name,context,owner_profile_id,updated_at").in("id", listIds)
    : { data: [] };

  const mappedThings = await mapDbThingRows((thingRows ?? []) as DbThingRow[]);
  const mappedLists = await mapDbListRows(profileId, (listRows ?? []) as DbListRow[]);

  const thingMap = new Map(mappedThings.map((t) => [t.id, t]));
  const listMap = new Map(mappedLists.map((l) => [l.id, l]));

  return (buckets ?? []).map((b, i) => {
    const refs = (items ?? []).filter((it) => it.bucket_id === b.id);
    const bucketThingIds = refs.map((r) => r.thing_id).filter(Boolean) as string[];
    const bucketListIds = refs.map((r) => r.list_id).filter(Boolean) as string[];

    const bucketCollaborators: { id: string; name: string; avatarUrl: string | null; initials: string }[] = [];
    const seenCollab = new Set<string>();

    for (const tid of bucketThingIds) {
      const t = thingMap.get(tid);
      if (t) {
        if (t.assignee && t.assignee.name && t.assignee.name !== "Someone" && !seenCollab.has(t.assignee.id)) {
          seenCollab.add(t.assignee.id);
          bucketCollaborators.push({
            id: t.assignee.id,
            name: t.assignee.name,
            avatarUrl: t.assignee.avatarUrl ?? null,
            initials: t.assignee.initials || t.assignee.name.slice(0, 2).toUpperCase(),
          });
        }
        if (t.owner && t.owner.name && t.owner.name !== "Someone" && !seenCollab.has(t.owner.id)) {
          seenCollab.add(t.owner.id);
          bucketCollaborators.push({
            id: t.owner.id,
            name: t.owner.name,
            avatarUrl: t.owner.avatarUrl ?? null,
            initials: t.owner.initials || t.owner.name.slice(0, 2).toUpperCase(),
          });
        }
      }
    }

    for (const lid of bucketListIds) {
      const l = listMap.get(lid);
      if (l) {
        for (const m of l.members || []) {
          if (m.name && m.name !== "Someone" && !seenCollab.has(m.name)) {
            seenCollab.add(m.name);
            bucketCollaborators.push({
              id: m.profileId || m.actorId || m.name,
              name: m.name,
              avatarUrl: m.avatarUrl ?? null,
              initials: m.initials || m.name.slice(0, 2).toUpperCase(),
            });
          }
        }
      }
    }

    const previews: BucketCard["previews"] = [];
    for (const tid of bucketThingIds.slice(0, 3)) {
      const t = thingMap.get(tid);
      if (t) {
        previews.push({
          title: t.title,
          kind: "thing",
          state: t.workStatus,
          thingId: t.id,
        });
      }
    }
    for (const lid of bucketListIds.slice(0, 2)) {
      const l = listMap.get(lid);
      if (l) {
        previews.push({
          title: l.name,
          kind: "list",
          listId: l.id,
        });
      }
    }

    const tags = [
      b.context === "work" ? "Work" : "Personal",
      b.name.toLowerCase().includes("priorit") || b.name.toLowerCase().includes("focus")
        ? "Yearly goals"
        : b.name.toLowerCase().includes("deep")
          ? "Focus"
          : "Projects",
      "Docs",
    ];

    return {
      id: b.id,
      name: b.name,
      description:
        b.name.toLowerCase().includes("priorit")
          ? "Top priorities I'm focusing on right now."
          : b.name.toLowerCase().includes("deep")
            ? "Work that requires sustained focus."
            : b.name.toLowerCase().includes("travel")
              ? "Trips I'm planning and researching."
              : b.name.toLowerCase().includes("reading")
                ? "Books and articles I want to read."
                : b.name.toLowerCase().includes("weekend")
                  ? "Ideas and plans for the weekend."
                  : b.name.toLowerCase().includes("learning")
                    ? "Courses, topics and skills I'm building."
                    : b.name.toLowerCase().includes("finance")
                      ? "Bills, payments and finance tasks."
                      : "Private focus space",
      color: COLORS[i % COLORS.length]!,
      pinned: i < 3,
      thingCount: bucketThingIds.length,
      listCount: bucketListIds.length,
      thingIds: bucketThingIds,
      tags,
      collaborators: bucketCollaborators,
      updatedAt: new Date(b.updated_at).toLocaleString(),
      context: (b.context === "home" ? "home" : "work") as "work" | "home",
      previews,
    } satisfies BucketCard;
  });
}

export function useBuckets() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.buckets(user?.id, context),
    queryFn: () => fetchBuckets(context, user?.id ?? ""),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const buckets = useMemo(() => {
    void version;
    if (preview) return getBuckets(context);
    return query.data ?? [];
  }, [preview, query.data, version, context]);

  const create = useMutation({
    mutationFn: (name: string) => rpcCreateBucket(name, context),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.buckets(user?.id, context) });
    },
  });

  return { buckets, isLoading: !preview && query.isLoading, error: query.error, preview, create };
}

export function useBucket(bucketId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.bucket(bucketId ?? "none"),
    enabled: Boolean(bucketId) && Boolean(user) && !preview,
    queryFn: async (): Promise<BucketCard | null> => {
      const { data, error } = await supabase
        .from("buckets")
        .select("id,name,context,updated_at")
        .eq("id", bucketId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: items } = await supabase
        .from("bucket_items")
        .select("thing_id,list_id")
        .eq("bucket_id", data.id);
      return {
        id: data.id,
        name: data.name,
        description: "Private focus space",
        color: "bg-violet-500",
        pinned: false,
        thingCount: (items ?? []).filter((r) => r.thing_id).length,
        listCount: (items ?? []).filter((r) => r.list_id).length,
        updatedAt: new Date(data.updated_at).toLocaleString(),
        context: (data.context === "home" ? "home" : "work") as "work" | "home",
        previews: [],
      };
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => rpcRenameBucket(bucketId!, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket"] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => rpcDeleteBucket(bucketId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket"] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
      void qc.invalidateQueries({ queryKey: ["bucket-items"] });
    },
  });

  if (preview) {
    const bucket = getBuckets().find((b) => b.id === bucketId);
    return { bucket, isLoading: false, error: null, preview: true, rename, remove };
  }
  return {
    bucket: query.data ?? undefined,
    isLoading: query.isLoading,
    error: query.error,
    preview: false,
    rename,
    remove,
  };
}
