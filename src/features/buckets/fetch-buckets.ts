import { supabase } from "@/integrations/supabase/client";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { mapDbListRows, type DbListRow } from "@/features/lists/map-list-rows";
import type { BucketCard } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

/**
 * Kept in its own module (no React/JSX imports) so it's importable from a
 * plain Node test — see scripts/fetch-buckets-concurrency.test.mjs —
 * without pulling in use-buckets.ts's transitive React-hook/JSX
 * dependency graph (useAppContext -> AppContextProvider.tsx breaks the
 * plain Node test runner; same reason fetchCourt moved out of
 * use-court.ts).
 */
export async function fetchBuckets(context: "work" | "home", profileId: string): Promise<BucketCard[]> {
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

  // Both queries depend only on bucket_items' output above, not on each
  // other, so they run concurrently instead of things-then-lists.
  const [{ data: thingRows }, { data: listRows }] = await Promise.all([
    thingIds.length
      ? supabase.from("things").select(THING_COLUMNS).in("id", thingIds)
      : Promise.resolve({ data: [] as DbThingRow[] }),
    listIds.length
      ? supabase.from("lists").select("id,name,context,owner_profile_id,updated_at").in("id", listIds)
      : Promise.resolve({ data: [] as DbListRow[] }),
  ]);

  // Same reasoning: each mapper only needs its own rows.
  const [mappedThings, mappedLists] = await Promise.all([
    mapDbThingRows((thingRows ?? []) as DbThingRow[]),
    mapDbListRows(profileId, (listRows ?? []) as DbListRow[]),
  ]);

  const thingMap = new Map(mappedThings.map((t) => [t.id, t]));
  const listMap = new Map(mappedLists.map((l) => [l.id, l]));

  return (buckets ?? []).map((b, i) => {
    const refs = (items ?? []).filter((it) => it.bucket_id === b.id);
    const bucketThingIds = refs.map((r) => r.thing_id).filter(Boolean) as string[];
    const bucketListIds = refs.map((r) => r.list_id).filter(Boolean) as string[];
    const directThings = bucketThingIds.map((id) => thingMap.get(id)).filter(Boolean);
    const bucketLists = bucketListIds.map((id) => listMap.get(id)).filter(Boolean);
    const activeDirectThings = directThings.filter((thing) => thing?.workStatus !== "cancelled");
    const progressCompleted =
      activeDirectThings.filter((thing) => thing?.workStatus === "sorted").length +
      bucketLists.reduce((sum, list) => sum + (list?.doneCount ?? 0), 0);
    const progressTotal =
      activeDirectThings.length + bucketLists.reduce((sum, list) => sum + (list?.thingCount ?? 0), 0);

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
