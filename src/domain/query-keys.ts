export const keys = {
  court: (profileId: string | undefined, context: string) =>
    ["court", profileId, context] as const,
  thing: (thingId: string) => ["thing", thingId] as const,
  lists: (profileId: string | undefined, context: string) =>
    ["lists", profileId, context] as const,
  list: (listId: string) => ["list", listId] as const,
  buckets: (profileId: string | undefined, context: string) =>
    ["buckets", profileId, context] as const,
  bucket: (bucketId: string) => ["bucket", bucketId] as const,
  bucketItems: (bucketId: string) => ["bucket-items", bucketId] as const,
  accessibleThings: (profileId: string | undefined, context: string) =>
    ["accessible-things", profileId, context] as const,
  nudges: (profileId: string | undefined, context: string) =>
    ["nudges", profileId, context] as const,
  nudgeHistory: (profileId: string | undefined, context: string) =>
    ["nudge-history", profileId, context] as const,
  catchup: (profileId: string | undefined, context: string) =>
    ["catchup", profileId, context] as const,
  listMeetings: (listId: string) => ["list-meetings", listId] as const,
  listMessagesPages: (listId: string) => ["list-messages", listId, "pages"] as const,
  listMessageSearch: (listId: string, search: string) => ["list-message-search", listId, search] as const,
  listMessageAttachments: (listId: string) => ["list-message-attachments", listId] as const,
  listSystemHistory: (listId: string) => ["list-system-history", listId] as const,
  listPinnedMessages: (listId: string) => ["list-pinned-messages", listId] as const,
  thingCommentsPages: (thingId: string | null) => ["thing-comments", thingId, "pages"] as const,
  thingActivityPages: (thingId: string | null) => ["thing-activity", thingId, "pages"] as const,
  profile: (profileId: string | undefined) => ["profile", profileId] as const,
  trophy: (profileId: string | undefined) => ["trophy", profileId] as const,
  notifications: (profileId: string | undefined) =>
    ["notifications", profileId] as const,
  shredded: (profileId: string | undefined) => ["shredded", profileId] as const,
  snoozed: (profileId: string | undefined) => ["snoozed", profileId] as const,
  // Profile-scoped only, no context: the `actors` table has no context
  // column (verified against the RLS migrations referenced in
  // fetch-court.ts) -- an actor's identity does not vary by work/home.
  actor: (profileId: string | undefined) => ["actor", profileId] as const,
};
