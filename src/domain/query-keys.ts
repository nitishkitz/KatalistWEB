export const keys = {
  currentActor: (profileId: string | undefined) =>
    ["current-actor", profileId] as const,
  court: (profileId: string | undefined, context: string) =>
    ["court", profileId, context] as const,
  thing: (thingId: string) => ["thing", thingId] as const,
  lists: (profileId: string | undefined, context: string) =>
    ["lists", profileId, context] as const,
  list: (listId: string) => ["list", listId] as const,
  listThings: (listId: string) => ["list-things", listId] as const,
  buckets: (profileId: string | undefined, context: string) =>
    ["buckets", profileId, context] as const,
  bucket: (bucketId: string) => ["bucket", bucketId] as const,
  bucketItems: (bucketId: string) => ["bucket-items", bucketId] as const,
  accessibleThings: (profileId: string | undefined, context: string) =>
    ["accessible-things", profileId, context] as const,
  nudges: (profileId: string | undefined, context: string) =>
    ["nudges", profileId, context] as const,
  profile: (profileId: string | undefined) => ["profile", profileId] as const,
  trophy: (profileId: string | undefined) => ["trophy", profileId] as const,
  notifications: (profileId: string | undefined) =>
    ["notifications", profileId] as const,
  notificationsUnread: (profileId: string | undefined) =>
    ["notifications-unread", profileId] as const,
  shredded: (profileId: string | undefined) => ["shredded", profileId] as const,
};
