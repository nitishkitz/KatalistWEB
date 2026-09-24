import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { mapDbThingRows, THING_OVERVIEW_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { getActorId } from "@/features/people/actor-query";
import { mapDbListRows, type DbListRow } from "@/features/lists/map-list-rows";
import type { BucketCard } from "./fixtures";
import { withReadDeadline } from "@/lib/read-request";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];
type BucketProgress = { bucket_id: string; progress_completed: number; progress_total: number };

export async function fetchBucketProgress(ids: string[], signal?: AbortSignal): Promise<BucketProgress[]> {
  const rows: BucketProgress[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const request = callUngeneratedRpc("get_bucket_progress", { p_bucket_ids: ids.slice(offset, offset + 500) });
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) throw error;
    rows.push(...(data ?? []) as BucketProgress[]);
  }
  return rows;
}

/**
 * Kept in its own module (no React/JSX imports) so it's importable from a
 * plain Node test — see scripts/fetch-buckets-concurrency.test.mjs —
 * without pulling in use-buckets.ts's transitive React-hook/JSX
 * dependency graph (useAppContext -> AppContextProvider.tsx breaks the
 * plain Node test runner; same reason fetchCourt moved out of
 * use-court.ts).
 */
export async function fetchBuckets(
  qc: QueryClient,
  context: "work" | "home",
  profileId: string,
  querySignal?: AbortSignal,
): Promise<BucketCard[]> {
  // T01: all four reads below (buckets, its dependent bucket_items read,
  // then three more dependent on THAT) are one logical read operation --
  // bounded together under a single deadline (read-request.ts), not one
  // 15s window per phase, and wired to React Query's own cancellation
  // signal so a superseded/refetched call or unmount stops whichever
  // request is actually in flight.
  const { buckets, items, thingRows, listRows, progressRows } = await withReadDeadline(querySignal, async (signal) => {
    const { data: buckets, error } = await supabase
      .from("buckets")
      .select("id,name,context,updated_at")
      .eq("context", context)
      .is("archived_at", null)
      .abortSignal(signal);
    if (error) throw error;
    const ids = (buckets ?? []).map((b) => b.id);
    // Required data: a failed bucket_items/Things/Lists read must not
    // silently become "this bucket has nothing in it" — that's a false
    // empty state, not the truth. Only decorative data (none in this
    // function; see mapDbListRows' cover-URL signing) is allowed to fail
    // open.
    const { data: items, error: itemsError } = ids.length
      ? await supabase.from("bucket_items").select("bucket_id,thing_id,list_id").in("bucket_id", ids).abortSignal(signal)
      : { data: [], error: null };
    if (itemsError) throw itemsError;

    const thingIds = (items ?? []).map((i) => i.thing_id).filter(Boolean) as string[];
    const listIds = (items ?? []).map((i) => i.list_id).filter(Boolean) as string[];

    // Three independent reads: direct Thing cards, referenced List cards,
    // and one RLS-scoped unique progress aggregate. The aggregate replaces
    // transferring every member Thing solely to deduplicate progress.
    const [
      { data: thingRows, error: thingsError },
      { data: listRows, error: listsError },
      progressRows,
    ] = await Promise.all([
      thingIds.length
        ? supabase.from("things").select(THING_OVERVIEW_COLUMNS).in("id", thingIds).abortSignal(signal)
        : Promise.resolve({ data: [] as DbThingRow[], error: null }),
      listIds.length
        ? supabase.from("lists").select("id,name,context,owner_profile_id,updated_at").in("id", listIds).abortSignal(signal)
        : Promise.resolve({ data: [] as DbListRow[], error: null }),
      fetchBucketProgress(ids, signal),
    ]);
    if (thingsError) throw thingsError;
    if (listsError) throw listsError;

    return { buckets, items, thingRows, listRows, progressRows };
  });

  // Same reasoning: each mapper only needs its own rows.
  const [mappedThings, mappedLists] = await Promise.all([
    (async () => thingRows?.length
      ? mapDbThingRows(thingRows as DbThingRow[], await getActorId(qc, profileId), "overview")
      : [])(),
    mapDbListRows(qc, profileId, (listRows ?? []) as DbListRow[]),
  ]);

  const thingMap = new Map(mappedThings.map((t) => [t.id, t]));
  const listMap = new Map(mappedLists.map((l) => [l.id, l]));
  const progressByBucket = new Map(progressRows.map((row) => [row.bucket_id, row]));

  return (buckets ?? []).map((b, i) => {
    const refs = (items ?? []).filter((it) => it.bucket_id === b.id);
    const bucketThingIds = refs.map((r) => r.thing_id).filter(Boolean) as string[];
    const bucketListIds = refs.map((r) => r.list_id).filter(Boolean) as string[];
    const progress = progressByBucket.get(b.id);
    if (!progress) throw new Error(`Bucket progress unavailable for ${b.id}`);
    const progressCompleted = progress.progress_completed;
    const progressTotal = progress.progress_total;

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
      progressCompleted,
      progressTotal,
      thingIds: bucketThingIds,
      tags,
      collaborators: bucketCollaborators,
      updatedAt: new Date(b.updated_at).toLocaleString(),
      context: (b.context === "home" ? "home" : "work") as "work" | "home",
      previews,
    } satisfies BucketCard;
  });
}
