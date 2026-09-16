import type { Thing, ThingFile } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { personOrSomeone, resolveActorPeople } from "@/features/people/resolve-actors";
import { authedFetch } from "@/lib/authed-fetch";
import { getThing } from "./local-state";
import { calculateCommentCounts } from "./read-state";
import { fetchRealAttachments } from "./attachments";

export const THING_COLUMNS =
  "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,cancelled_at,sorted_at,caught_at,updated_at,created_at,notes";

export type DbThingRow = {
  id: string;
  title: string;
  acknowledgement: Thing["acknowledgement"];
  work_status: Thing["workStatus"];
  owner_importance: Thing["ownerImportance"];
  assignee_personal_pace: Thing["personalPace"];
  due_at: string | null;
  due_has_time: boolean;
  context: Thing["context"];
  list_id: string | null;
  creator_actor_id: string;
  owner_actor_id: string;
  current_assignee_actor_id: string;
  cancelled_at: string | null;
  sorted_at: string | null;
  caught_at: string | null;
  updated_at: string;
  created_at: string | null;
  notes?: string | null;
};

export async function mapDbThingRows(rows: DbThingRow[], myActorId?: string | null): Promise<Thing[]> {
  if (!rows.length) return [];
  const actorIds = new Set<string>();
  for (const r of rows) {
    actorIds.add(r.creator_actor_id);
    actorIds.add(r.owner_actor_id);
    actorIds.add(r.current_assignee_actor_id);
  }
  const people = await resolveActorPeople([...actorIds]);
  const fallback = (id: string) => personOrSomeone(people, id);

  const listIds = [...new Set(rows.map((r) => r.list_id).filter(Boolean))] as string[];
  const listNames = new Map<string, string>();
  if (listIds.length) {
    // 1. Try server endpoint (RLS-scoped to Lists the caller can see)
    try {
      if (typeof window !== "undefined") {
        const res = await authedFetch("/api/lists/resolve-names", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listIds }),
        });
        if (res.ok) {
          const json = await res.json();
          for (const l of json.lists ?? []) {
            if (l.id && l.name) listNames.set(l.id, l.name);
          }
        }
      }
    } catch {
      // ignore
    }

    // 2. Try resolve_list_names RPC
    const missingAfterApi = listIds.filter((id) => !listNames.has(id));
    if (missingAfterApi.length) {
      try {
        const { data, error } = await (supabase.rpc as any)("resolve_list_names", { p_list_ids: missingAfterApi });
        if (!error && data) {
          for (const l of (data as { id: string; name: string }[])) {
            if (l.id && l.name) listNames.set(l.id, l.name);
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Direct query on lists table for any remaining
    const missing = listIds.filter((id) => !listNames.has(id));
    if (missing.length) {
      try {
        const { data: lists } = await supabase.from("lists").select("id,name").in("id", missing);
        for (const l of lists ?? []) {
          if (l.id && l.name) listNames.set(l.id, l.name);
        }
      } catch {
        // ignore
      }
    }
  }

  const commentCountsByThing = new Map<string, { commentCount: number; unreadCommentCount: number }>();
  const thingIds = rows.map((r) => r.id);
  if (thingIds.length > 0) {
    try {
      const { data: comments, error: commentsError } = await supabase
        .from("thing_comments")
        .select("thing_id, author_actor_id, created_at")
        .in("thing_id", thingIds)
        .is("deleted_at", null);

      if (!commentsError && comments) {
        const commentsByThing = new Map<string, Array<{ author_actor_id: string; created_at: string }>>();
        for (const c of comments) {
          const list = commentsByThing.get(c.thing_id) ?? [];
          list.push({ author_actor_id: c.author_actor_id, created_at: c.created_at });
          commentsByThing.set(c.thing_id, list);
        }
        for (const [tId, cList] of commentsByThing) {
          commentCountsByThing.set(
            tId,
            calculateCommentCounts(
              tId,
              cList.map((c) => ({
                authorActorId: c.author_actor_id,
                createdAt: c.created_at,
              })),
              myActorId,
            ),
          );
        }
      }
    } catch {
      // ignore
    }
  }

  // Real, persisted attachments (thing_attachments + storage). Takes
  // priority over the legacy things.notes JSON blob, whose file URLs were
  // often ephemeral blob: URLs that die outside the tab that created them.
  const realAttachmentsByThing = await fetchRealAttachments(thingIds).catch(() => new Map<string, ThingFile[]>());

  return rows.map((r) => {
    let parsedFiles: ThingFile[] | undefined;
    let descriptionText: string | null = null;

    if (r.notes) {
      try {
        const parsed = JSON.parse(r.notes);
        if (Array.isArray(parsed.files)) {
          parsedFiles = parsed.files;
        }
      } catch {
        descriptionText = r.notes;
      }
    }

    const localThing = getThing(r.id);
    const realFiles = realAttachmentsByThing.get(r.id);
    const finalFiles = realFiles?.length ? realFiles : (parsedFiles ?? localThing?.files);
    const commentData = commentCountsByThing.get(r.id) ?? { commentCount: 0, unreadCommentCount: 0 };

    return {
      id: r.id,
      title: r.title,
      creator: fallback(r.creator_actor_id),
      owner: fallback(r.owner_actor_id),
      assignee: fallback(r.current_assignee_actor_id),
      acknowledgement: r.acknowledgement,
      workStatus: r.work_status,
      ownerImportance: r.owner_importance,
      personalPace: r.assignee_personal_pace,
      dueAt: r.due_at,
      dueHasTime: r.due_has_time,
      context: r.context,
      listId: r.list_id,
      listName: r.list_id ? (listNames.get(r.list_id) ?? null) : "Standalone",
      cancelledAt: r.cancelled_at,
      sortedAt: r.sorted_at,
      caughtAt: r.caught_at,
      updatedAt: r.updated_at,
      createdAt: r.created_at ?? undefined,
      description: descriptionText,
      files: finalFiles,
      attachmentCount: finalFiles?.length,
      commentCount: commentData.commentCount,
      unreadCommentCount: commentData.unreadCommentCount,
    };
  });
}
