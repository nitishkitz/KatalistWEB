export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  kind: string;
  thingId: string | null;
  listId: string | null;
  actorId: string | null;
};

export type NotificationGroup = NotificationItem & { ids: string[]; count: number };
export type NotificationThing = {
  id: string; title: string; owner_actor_id: string; current_assignee_actor_id: string;
  acknowledgement: string; work_status: string; cancelled_at: string | null;
};

export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  // Input is newest first. Keep the latest preview and all IDs for read updates.
  for (const item of items) {
    const day = item.createdAt.slice(0, 10);
    const key = item.kind === "list_message" && item.listId
      ? `chat:${item.listId}:${day}`
      : item.kind === "morning_brief" ? `brief:${day}` : item.id;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(item.id);
      existing.count += 1;
      existing.read = existing.read && item.read;
    } else groups.set(key, { ...item, ids: [item.id], count: 1 });
  }
  return [...groups.values()];
}

export function notificationActions(item: NotificationItem, thing: NotificationThing | undefined, actorId: string | null) {
  const active = Boolean(thing && !thing.cancelled_at && !["sorted", "cancelled"].includes(thing.work_status));
  const assignee = Boolean(actorId && thing?.current_assignee_actor_id === actorId);
  const owner = Boolean(actorId && thing?.owner_actor_id === actorId);
  const caught = thing?.acknowledgement === "caught";
  const attentionKind = item.kind === "thing_assigned" || item.kind === "nudged" || item.kind.startsWith("auto_nudge");
  return {
    needsAttention: item.kind === "spring_clean" || Boolean(attentionKind && active && (assignee || owner)),
    canCatch: Boolean(active && assignee && !caught && thing?.acknowledgement === "waiting_for_catch"),
    canReassign: Boolean(active && (owner || (assignee && caught))),
  };
}
