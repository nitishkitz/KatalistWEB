/**
 * P6: pure event -> canonical invalidation-target routing. No provider
 * relocation here (that's P7) -- this module only decides WHAT should
 * be invalidated for a given database change event, as a pure function
 * with no QueryClient/side effects, so it's testable in isolation and
 * reusable by whichever owner eventually calls it.
 *
 * Targets are the same raw-array key prefixes use-realtime.ts already
 * invalidates today (see the P0 inventory,
 * docs/superpowers/plans/2026-09-23-realtime-ownership-inventory.md) --
 * this is a routing/batching refactor, not a key-shape migration.
 * Preserving today's targets exactly means this module can replace
 * use-realtime.ts's inline invalidation calls without changing what
 * gets invalidated, only how the resulting invalidations are batched.
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
  ],
  thing_comments: ["thing-comments", "thing", "court"],
  thing_activity: ["thing-activity", "thing", "trophy", "lists"],
  nudges: ["nudges", "nudge-history", "catchup", "thing", "notifications"],
  notifications: ["notifications", "catchup"],
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
  return targetsFor(STATIC_TARGETS[event.table]);
}

/** Stable string key for deduplicating targets in a Set/Map (JSON.stringify is fine here -- these are always small, flat, single-element arrays). */
export function targetKey(target: InvalidationTarget): string {
  return JSON.stringify(target);
}
