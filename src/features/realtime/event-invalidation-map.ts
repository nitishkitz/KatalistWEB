/**
 * P6/T07: pure event -> canonical invalidation-target routing. This decides WHAT should
 * be invalidated for a given database change event, as a pure function
 * with no QueryClient/side effects, so it's testable in isolation and
 * reusable by whichever owner eventually calls it.
 *
 * Targets retain the existing raw-array key convention. Complete payload IDs
 * narrow detail families; missing/partial IDs retain their broad fallback.
 */

export type RealtimeTable =
  | "things"
  | "thing_comments"
  | "thing_activity"
  | "nudges"
  | "notifications"
  | "list_messages"
  | "bucket_items"
  | "list_members"
  | "list_meetings"
  | "profile_object_state";

export type RealtimeEvent = {
  table: RealtimeTable;
  eventType?: "INSERT" | "UPDATE" | "DELETE";
  /** Available old/new row fields, when the payload provides them. DELETE payloads and some UPDATEs may have incomplete fields -- callers must not invent missing ids. */
  old?: Record<string, unknown> | null;
  new?: Record<string, unknown> | null;
};

/** A canonical query key prefix to invalidate. Always a raw array (matching the existing, un-migrated key shapes) -- see the module doc comment above. */
export type InvalidationTarget = readonly unknown[];

function targetsFor(prefixes: string[]): InvalidationTarget[] {
  return prefixes.map((p) => [p] as const);
}

/**
 * Static per-table target lists, preserved from use-realtime.ts's
 * existing inline invalidations. profile_object_state is handled
 * separately below (it delegates to invalidatePersonalSurfaces, not a
 * static list) since that's how it already works today.
 */
const STATIC_TARGETS: Record<Exclude<RealtimeTable, "profile_object_state">, string[]> = {
  things: [
    "court",
    "thing",
    "list-things",
    "lists",
    "list",
    "buckets",
    "bucket",
    "bucket-items",
    "nudges",
    "nudge-history",
    "catchup",
    "trophy",
    "notifications",
    "notifications-unread",
    "accessible-things",
    "doorman",
  ],
  thing_comments: ["thing-comments", "thing", "court"],
  thing_activity: ["thing-activity", "thing", "trophy", "lists"],
  nudges: ["nudges", "nudge-history", "catchup", "thing", "notifications"],
  notifications: ["notifications", "notifications-unread", "catchup"],
  list_messages: ["list-messages", "list-message-attachments", "list-system-history", "list-message-search", "list-pinned-messages", "list", "lists", "hub-conversations", "hub-conversation"],
  bucket_items: ["bucket", "buckets", "bucket-items"],
  // C-06: a membership change (in particular a revocation) can make a List
  // inaccessible -- every mounted surface that shows List-scoped content
  // must re-derive from a real refetch (which discovers "no longer
  // accessible" via RLS), not just List detail/index. Previously only
  // "list"/"lists" were here, so Hub's conversation sidebar/detail, List
  // chat, Hub/List files and meetings never even attempted a refetch that
  // would have discovered the access loss.
  list_members: ["list", "lists", "list-messages", "list-message-attachments", "list-system-history", "list-message-search", "list-pinned-messages", "hub-conversations", "hub-conversation", "hub-files", "list-meetings", "upcoming-meetings"],
  list_meetings: ["list-meetings", "upcoming-meetings"],
};

/**
 * Routes one realtime event to its canonical invalidation targets.
 * `profile_object_state` returns the special sentinel target
 * `["__personal-surfaces__"]` -- the caller (the batcher's consumer, in
 * P7) is expected to recognize this and call
 * invalidatePersonalSurfaces/invalidateSnoozeSurfaces itself, since
 * those are the existing, epoch-guarded, multi-caller helpers from P3 --
 * this module does not duplicate their logic or their epoch check.
 */
export function targetsForEvent(event: RealtimeEvent): InvalidationTarget[] {
  if (event.table === "profile_object_state") {
    return [["__personal-surfaces__"]];
  }
  const targets = targetsFor(STATIC_TARGETS[event.table]);
  const payloadIds = (field: string) => [...new Set([event.old?.[field], event.new?.[field]]
    .filter((value): value is string => typeof value === "string" && value.length > 0))];
  const scope = (families: string[], ids: string[]) => {
    if (ids.length === 0) return; // incomplete payload: broad fallback stays
    for (const family of families) {
      const index = targets.findIndex((target) => target.length === 1 && target[0] === family);
      if (index < 0) continue;
      targets.splice(index, 1, ...ids.map((id) => [family, id] as const));
    }
  };

  switch (event.table) {
    case "things":
      scope(["thing"], payloadIds("id"));
      // A move changes both parents; never scope to only the new List.
      scope(["list", "list-things"], payloadIds("list_id"));
      break;
    case "thing_comments":
      scope(["thing-comments", "thing"], payloadIds("thing_id"));
      break;
    case "thing_activity":
      scope(["thing-activity", "thing"], payloadIds("thing_id"));
      break;
    case "nudges":
      scope(["thing"], payloadIds("thing_id"));
      break;
    case "list_messages":
      scope(["list-messages", "list-message-attachments", "list-system-history", "list-message-search",
        "list-pinned-messages", "list", "hub-conversation"], payloadIds("list_id"));
      break;
    case "bucket_items":
      scope(["bucket", "bucket-items"], payloadIds("bucket_id"));
      break;
    case "list_members":
      scope(["list", "list-messages", "list-message-attachments", "list-system-history",
        "list-message-search", "list-pinned-messages", "hub-conversation", "hub-files",
        "list-meetings"], payloadIds("list_id"));
      break;
    case "list_meetings":
      scope(["list-meetings"], payloadIds("list_id"));
      break;
    case "notifications":
      break;
  }
  return targets;
}

/** Stable string key for deduplicating targets in a Set/Map (JSON.stringify is fine here -- these are always small, flat, single-element arrays). */
export function targetKey(target: InvalidationTarget): string {
  return JSON.stringify(target);
}
