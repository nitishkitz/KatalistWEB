// react import moved to use-local-version.ts
import { isActiveThing, type Importance, type Pace, type Person, type Thing, type WorkStatus } from "@/domain/thing";
import { courtFixtures } from "@/features/court/fixtures";
import { getThingCapabilities } from "@/domain/capabilities";
import { currentDemoActorId, currentDemoPerson, demoDirectory } from "@/features/demo/identities";
import { canDemoActorViewThing, projectDemoList, roleForDemoList } from "@/features/demo/visibility";
import { listFixtures, type ListRow } from "@/features/lists/fixtures";
import { bucketFixtures, type BucketCard } from "@/features/buckets/fixtures";

export type LocalComment = { id: string; body: string; author: string; at: string };
export type LocalActivity = { id: string; event: string; at: string; detail?: string };
export type LocalMessage = { id: string; body: string; author: string; at: string };
export type LocalNotification = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  at: string;
  thingId?: string;
  recipientActorId: string;
  type?: string;
};
export type ShreddedItem = { id: string; title: string; kind: "thing" | "list"; status: string; at: string };

type BucketItem = { thingId?: string; listId?: string; title: string; kind: "thing" | "list" };

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
export function subscribeLocal(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let extras: Thing[] = [];
const patches = new Map<string, Partial<Thing>>();
const shreddedByActor = new Map<string, Set<string>>();
const shreddedLogByActor = new Map<string, ShreddedItem[]>();
const comments = new Map<string, LocalComment[]>();
const activity = new Map<string, LocalActivity[]>();
const listMessages = new Map<string, LocalMessage[]>();
let extraLists: ListRow[] = [];
let extraBuckets: BucketCard[] = [];
const bucketItems = new Map<string, BucketItem[]>();
const bucketNameById = new Map<string, string>();
const deletedBucketIdsByActor = new Map<string, Set<string>>();
const recentlyNudged = new Set<string>();
const nudgeCooldownUntil = new Map<string, number>();
let extraNotifications: LocalNotification[] = [];
/** Persona-scoped Ghost dismissals: actorId → set of thing ids. */
const ghostDismissedByActor = new Map<string, Set<string>>();
let version = 0;

function bump(event?: LocalActivity & { thingId?: string }) {
  version += 1;
  if (event?.thingId) {
    const list = activity.get(event.thingId) ?? [];
    activity.set(event.thingId, [
      { id: event.id, event: event.event, at: event.at, detail: event.detail },
      ...list,
    ]);
  }
  emit();
}

function requireCap(id: string, key: keyof ReturnType<typeof getThingCapabilities>) {
  const thing = getThing(id);
  if (!thing) throw new Error("That Thing isn’t available.");
  const caps = getThingCapabilities(thing, currentDemoActorId());
  if (!caps[key]) throw new Error("You don’t have permission to do that.");
  return thing;
}

export function catchLocal(id: string, pace: Pace = "next") {
  requireCap(id, "canCatch");
  patchThing(id, { acknowledgement: "caught", personalPace: pace, caughtAt: new Date().toISOString() }, "caught");
}
export function setPaceLocal(id: string, pace: Pace) {
  requireCap(id, "canSetPace");
  patchThing(id, { personalPace: pace }, "pace_changed");
}
export function setImportanceLocal(id: string, importance: Importance) {
  requireCap(id, "canSetImportance");
  patchThing(id, { ownerImportance: importance }, "importance_changed");
}
export function setStatusLocal(id: string, status: WorkStatus) {
  if (status === "sorted") requireCap(id, "canSort");
  else if (status === "cancelled") requireCap(id, "canCancel");
  else requireCap(id, "canSetStatus");
  const extra: Partial<Thing> = { workStatus: status };
  if (status === "sorted") extra.sortedAt = new Date().toISOString();
  if (status === "cancelled") extra.cancelledAt = new Date().toISOString();
  patchThing(id, extra, status === "sorted" ? "sorted" : status === "cancelled" ? "cancelled" : "status_changed");
}

function shreddedSetFor(actorId: string): Set<string> {
  if (!shreddedByActor.has(actorId)) shreddedByActor.set(actorId, new Set());
  return shreddedByActor.get(actorId)!;
}

export function getMergedThings(forActorId?: string): Thing[] {
  const actorId = forActorId ?? currentDemoActorId();
  const shredded = shreddedSetFor(actorId);
  const byId = new Map<string, Thing>();
  for (const t of courtFixtures) byId.set(t.id, t);
  for (const t of extras) byId.set(t.id, t);
  for (const [id, patch] of patches) {
    const current = byId.get(id);
    if (current) byId.set(id, { ...current, ...patch });
  }
  return [...byId.values()].filter((t) => !shredded.has(`thing:${t.id}`));
}

export function directoryPeople(): Person[] {
  const map = new Map<string, Person>();
  for (const p of demoDirectory()) map.set(p.id, p);
  for (const t of getMergedThings()) {
    map.set(t.creator.id, t.creator);
    map.set(t.owner.id, t.owner);
    map.set(t.assignee.id, t.assignee);
  }
  return [...map.values()];
}

export function personById(id: string): Person {
  return directoryPeople().find((p) => p.id === id) ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() };
}

/** Unfiltered lookup (ignores actor shred) — used by shred/restore resolve path. */
function getThingRaw(id: string): Thing | undefined {
  const byId = new Map<string, Thing>();
  for (const t of courtFixtures) byId.set(t.id, t);
  for (const t of extras) byId.set(t.id, t);
  for (const [pid, patch] of patches) {
    const current = byId.get(pid);
    if (current) byId.set(pid, { ...current, ...patch });
  }
  return byId.get(id);
}

export function getThing(id: string): Thing | undefined {
  const actorId = currentDemoActorId();
  const thing = getMergedThings(actorId).find((t) => t.id === id);
  if (!thing) return undefined;
  if (!canDemoActorViewThing(thing, actorId, getListsRaw())) return undefined;
  return thing;
}

export function patchThing(id: string, patch: Partial<Thing>, event?: string) {
  patches.set(id, { ...patches.get(id), ...patch, updatedAt: new Date().toISOString() });
  bump(
    event
      ? { id: crypto.randomUUID(), event, at: new Date().toISOString(), thingId: id }
      : undefined,
  );
}

export function tossLocalThing(input: {
  title: string;
  context: "work" | "home";
  ownerImportance?: Importance;
  listId?: string | null;
  listName?: string | null;
  assigneeId?: string;
  dueAt?: string;
  dueHasTime?: boolean;
}): Thing {
  const people = directoryPeople();
  const me = currentDemoPerson();
  let listId: string | null = null;
  let listName = "Standalone";
  let context = input.context;
  if (input.listId) {
    const list = getListsRaw().find((l) => l.id === input.listId);
    if (!list) throw new Error("That List isn’t available.");
    if (shreddedSetFor(me.id).has(`list:${list.id}`)) throw new Error("That List isn’t available.");
    const role = roleForDemoList(list, me.id);
    if (role !== "owner" && role !== "collaborator") {
      throw new Error("You don’t have permission to add a Thing to this List.");
    }
    listId = list.id;
    listName = list.name;
    context = list.context;
  }
  const assignee = people.find((p) => p.id === (input.assigneeId ?? me.id)) ?? me;
  const thing: Thing = {
    id: `local-${crypto.randomUUID()}`,
    title: input.title,
    creator: me,
    owner: me,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: input.ownerImportance ?? "next",
    personalPace: null,
    dueAt: input.dueAt ?? null,
    dueHasTime: Boolean(input.dueHasTime),
    context,
    listId,
    listName,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: null,
    updatedAt: new Date().toISOString(),
  };
  extras = [thing, ...extras];
  bump({ id: crypto.randomUUID(), event: "created", at: thing.updatedAt, thingId: thing.id });
  if (thing.assignee.id !== me.id) {
    pushNotification({
      recipientActorId: thing.assignee.id,
      title: "Assigned to you",
      body: thing.title,
      thingId: thing.id,
      type: "ASSIGNED",
    });
  }
  return thing;
}

export function setDueLocal(id: string, dueAt: string | null, dueHasTime: boolean) {
  requireCap(id, "canSetDue");
  patchThing(id, { dueAt, dueHasTime }, "due_changed");
}
export function reassignLocal(id: string, assigneeId: string) {
  requireCap(id, "canReassign");
  const thing = getThing(id);
  patchThing(
    id,
    {
      assignee: personById(assigneeId),
      acknowledgement: "waiting_for_catch",
      personalPace: null,
      caughtAt: null,
    },
    "reassigned",
  );
  if (thing && assigneeId !== currentDemoActorId()) {
    pushNotification({
      recipientActorId: assigneeId,
      title: "Assigned to you",
      body: thing.title,
      thingId: id,
      type: "ASSIGNED",
    });
  }
}

export function nudgeLocal(id: string) {
  requireCap(id, "canNudge");
  const until = nudgeCooldownUntil.get(id) ?? 0;
  if (Date.now() < until) throw new Error("Give it a moment — this one was just nudged.");
  const thing = getThing(id);
  if (!thing || thing.workStatus === "sorted" || thing.workStatus === "cancelled") {
    throw new Error("Sorted and Cancelled things can’t be nudged.");
  }
  const cooldownMs = 120 * 60 * 1000;
  recentlyNudged.add(id);
  nudgeCooldownUntil.set(id, Date.now() + cooldownMs);
  bump({ id: crypto.randomUUID(), event: "nudged", at: new Date().toISOString(), thingId: id });
  if (thing && thing.assignee.id !== currentDemoActorId()) {
    pushNotification({
      recipientActorId: thing.assignee.id,
      title: "Nudged",
      body: thing.title,
      thingId: id,
      type: "NUDGED",
    });
  }
}

export function canNudge(id: string) {
  const thing = getThing(id);
  if (!thing) return false;
  if (thing.workStatus === "sorted" || thing.workStatus === "cancelled") return false;
  return Date.now() >= (nudgeCooldownUntil.get(id) ?? 0);
}

export function isRecentlyNudged(id: string) {
  const until = nudgeCooldownUntil.get(id);
  if (until == null) return false;
  return Date.now() < until;
}

export function shredLocal(id: string, kind: "thing" | "list" = "thing") {
  const actorId = currentDemoActorId();
  let title = id;
  let status = "";
  if (kind === "thing") {
    const thing = getThingRaw(id);
    if (!thing || !canDemoActorViewThing(thing, actorId, getListsRaw())) {
      throw new Error("That Thing isn’t available.");
    }
    const holding = thing.owner.id === actorId || thing.assignee.id === actorId;
    if (isActiveThing(thing) && holding) {
      throw new Error("Sort, Cancel, or hand this Thing onward before shredding it.");
    }
    title = thing.title;
    status = thing.workStatus;
  } else {
    const list = getListRawById(id);
    const role = list ? roleForDemoList(list, actorId) : null;
    if (!list || !role) throw new Error("That List isn’t available.");
    if (role === "owner" || list.ownerActorId === actorId) {
      throw new Error("You can’t shred a List you own.");
    }
    title = list.name;
  }
  shreddedSetFor(actorId).add(`${kind}:${id}`);
  const log = shreddedLogByActor.get(actorId) ?? [];
  shreddedLogByActor.set(actorId, [
    { id, title, kind, status, at: new Date().toISOString() },
    ...log.filter((s) => !(s.id === id && s.kind === kind)),
  ]);
  bump({ id: crypto.randomUUID(), event: "shredded", at: new Date().toISOString(), thingId: kind === "thing" ? id : undefined });
}

export function restoreLocal(id: string, kind: "thing" | "list" = "thing") {
  const actorId = currentDemoActorId();
  shreddedSetFor(actorId).delete(`${kind}:${id}`);
  const log = shreddedLogByActor.get(actorId) ?? [];
  shreddedLogByActor.set(actorId, log.filter((s) => !(s.id === id && s.kind === kind)));
  bump({ id: crypto.randomUUID(), event: "restored", at: new Date().toISOString(), thingId: kind === "thing" ? id : undefined });
}

export function getShredded(): ShreddedItem[] {
  return shreddedLogByActor.get(currentDemoActorId()) ?? [];
}

export function addCommentLocal(thingId: string, body: string, author?: string) {
  if (!getThing(thingId)) throw new Error("That Thing isn’t available.");
  const row: LocalComment = {
    id: crypto.randomUUID(),
    body,
    author: author ?? currentDemoPerson().name,
    at: new Date().toISOString(),
  };
  comments.set(thingId, [row, ...(comments.get(thingId) ?? [])]);
  bump({ id: crypto.randomUUID(), event: "commented", at: row.at, thingId });
}

export function getComments(thingId: string): LocalComment[] {
  if (!getThing(thingId)) return [];
  return comments.get(thingId) ?? [];
}

export function getActivity(thingId: string): LocalActivity[] {
  if (!getThing(thingId)) return [];
  return activity.get(thingId) ?? [];
}

function getListsRaw(): ListRow[] {
  return [...extraLists, ...listFixtures];
}

export function getLists(): ListRow[] {
  const me = currentDemoActorId();
  return getListsRaw()
    .map((l) => projectDemoList(l, me))
    .filter((l): l is ListRow => l != null)
    .filter((l) => !shreddedSetFor(me).has(`list:${l.id}`));
}

/** Access-based Thing set for demo (includes Sorted/Cancelled). Independent of Court lanes. */
export function accessibleDemoThings(context?: "work" | "home"): Thing[] {
  const me = currentDemoActorId();
  const lists = getLists();
  return getMergedThings(me)
    .filter((t) => (context ? t.context === context : true))
    .filter((t) => canDemoActorViewThing(t, me, lists));
}

export function createListLocal(name: string, context: "work" | "home"): ListRow {
  const me = currentDemoPerson();
  const row: ListRow = {
    id: `list-${crypto.randomUUID()}`,
    name,
    context,
    role: "owner",
    ownerActorId: me.id,
    ownerLine: "Owned by you",
    members: [{ actorId: me.id, role: "owner", initials: me.initials, name: me.name }],
    memberCount: 1,
    thingCount: 0,
    doneCount: 0,
    inProgressCount: 0,
    unread: 0,
    latestActivity: "List created",
    updatedAt: "Just now",
    color: "bg-violet-500",
  };
  extraLists = [row, ...extraLists];
  bump();
  return row;
}

export function addListMessage(listId: string, body: string, author = "Me") {
  const me = currentDemoPerson();
  const list = getListById(listId);
  if (!list) throw new Error("That List isn’t available.");
  if (list.role !== "owner" && list.role !== "collaborator") {
    throw new Error("You don’t have permission to post in this List.");
  }
  const row: LocalMessage = {
    id: crypto.randomUUID(),
    body,
    author: author === "Me" ? me.name : author,
    at: new Date().toISOString(),
  };
  listMessages.set(listId, [...(listMessages.get(listId) ?? []), row]);
  bump();
}

export function getListMessages(listId: string): LocalMessage[] {
  if (!getListById(listId)) return [];
  return listMessages.get(listId) ?? [];
}

export function getBuckets(activeContext?: "work" | "home"): BucketCard[] {
  const me = currentDemoActorId();
  const deleted = deletedBucketIdsByActor.get(me) ?? new Set<string>();
  return [...extraBuckets, ...bucketFixtures]
    .filter((b) => {
      if (deleted.has(b.id)) return false;
      if (b.ownerActorId && b.ownerActorId !== me) return false;
      if (activeContext && b.context && b.context !== activeContext) return false;
      return true;
    })
    .map((b) => (bucketNameById.has(b.id) ? { ...b, name: bucketNameById.get(b.id)! } : b));
}

export function createBucketLocal(name: string, context: "work" | "home" = "work", description = ""): BucketCard {
  const row: BucketCard = {
    id: `bucket-${crypto.randomUUID()}`,
    name,
    description,
    color: "bg-violet-500",
    pinned: false,
    thingCount: 0,
    listCount: 0,
    updatedAt: "Updated just now",
    ownerActorId: currentDemoActorId(),
    context,
    previews: [],
  };
  extraBuckets = [row, ...extraBuckets];
  bump();
  return row;
}

function ownedBucket(bucketId: string): BucketCard | undefined {
  const me = currentDemoActorId();
  const bucket = getBuckets().find((b) => b.id === bucketId);
  if (!bucket || (bucket.ownerActorId && bucket.ownerActorId !== me)) return undefined;
  return bucket;
}

function requireOwnedBucket(bucketId: string): BucketCard {
  const bucket = ownedBucket(bucketId);
  if (!bucket) throw new Error("Bucket not found");
  return bucket;
}

export function addBucketRef(bucketId: string, item: BucketItem) {
  requireOwnedBucket(bucketId);
  const existing = getBucketRefs(bucketId);
  if (item.thingId && existing.some((i) => i.thingId === item.thingId)) return;
  if (item.listId && existing.some((i) => i.listId === item.listId)) return;
  bucketItems.set(bucketId, [item, ...(bucketItems.get(bucketId) ?? [])]);
  bump();
}

export function removeBucketRef(bucketId: string, thingId?: string, listId?: string) {
  requireOwnedBucket(bucketId);
  bucketItems.set(
    bucketId,
    (bucketItems.get(bucketId) ?? []).filter((i) => {
      if (thingId) return i.thingId !== thingId;
      if (listId) return i.listId !== listId;
      return true;
    }),
  );
  bump();
}

export function getBucketRefs(bucketId: string): BucketItem[] {
  if (!ownedBucket(bucketId)) return [];
  const extra = bucketItems.get(bucketId) ?? [];
  const fixture = bucketFixtures.find((b) => b.id === bucketId);
  const fromFixture =
    fixture?.previews.map((p) => ({
      title: p.title,
      kind: p.kind,
      thingId: p.thingId,
      listId: p.listId,
    })) ?? [];
  const merged: BucketItem[] = [];
  const seenThing = new Set<string>();
  const seenList = new Set<string>();
  for (const item of [...extra, ...fromFixture]) {
    if (item.thingId) {
      if (seenThing.has(item.thingId)) continue;
      seenThing.add(item.thingId);
    }
    if (item.listId) {
      if (seenList.has(item.listId)) continue;
      seenList.add(item.listId);
    }
    merged.push(item);
  }
  return merged;
}

function getListRawById(id: string): ListRow | undefined {
  return getListsRaw().find((l) => l.id === id);
}

/** Actor-aware lookup: membership + personal Shred. UI surfaces must use this. */
export function getListById(id: string): ListRow | undefined {
  return getLists().find((l) => l.id === id);
}

export function renameBucketLocal(bucketId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A Bucket needs a name.");
  requireOwnedBucket(bucketId);
  const clash = getBuckets().some(
    (b) => b.id !== bucketId && b.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) throw new Error("You already have a Bucket with that name.");
  bucketNameById.set(bucketId, trimmed);
  extraBuckets = extraBuckets.map((b) => (b.id === bucketId ? { ...b, name: trimmed } : b));
  bump();
}

export function deleteBucketLocal(bucketId: string) {
  requireOwnedBucket(bucketId);
  const me = currentDemoActorId();
  extraBuckets = extraBuckets.filter((b) => b.id !== bucketId);
  if (!deletedBucketIdsByActor.has(me)) deletedBucketIdsByActor.set(me, new Set());
  deletedBucketIdsByActor.get(me)!.add(bucketId);
  bucketItems.delete(bucketId);
  bump();
}

const notificationReadByActor = new Map<string, Set<string>>();

function readSetFor(actorId: string): Set<string> {
  if (!notificationReadByActor.has(actorId)) notificationReadByActor.set(actorId, new Set());
  return notificationReadByActor.get(actorId)!;
}

export function pushNotification(input: {
  recipientActorId: string;
  title: string;
  body: string;
  thingId?: string;
  type?: string;
}) {
  const row: LocalNotification = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    read: false,
    at: new Date().toISOString(),
    thingId: input.thingId,
    recipientActorId: input.recipientActorId,
    type: input.type,
  };
  extraNotifications = [row, ...extraNotifications];
  bump();
}

export function getNotifications(): LocalNotification[] {
  const me = currentDemoActorId();
  const reads = readSetFor(me);
  return extraNotifications
    .filter((n) => n.recipientActorId === me)
    .map((n) => ({ ...n, read: n.read || reads.has(n.id) }));
}

export function markNotificationsRead() {
  const me = currentDemoActorId();
  const reads = readSetFor(me);
  for (const n of getNotifications()) reads.add(n.id);
  extraNotifications = extraNotifications.map((n) =>
    n.recipientActorId === me ? { ...n, read: true } : n,
  );
  bump();
}

export function markNotificationRead(id: string) {
  const me = currentDemoActorId();
  readSetFor(me).add(id);
  extraNotifications = extraNotifications.map((n) =>
    n.id === id && n.recipientActorId === me ? { ...n, read: true } : n,
  );
  bump();
}

export function dismissGhost(id: string) {
  const actorId = currentDemoActorId();
  if (!ghostDismissedByActor.has(actorId)) ghostDismissedByActor.set(actorId, new Set());
  ghostDismissedByActor.get(actorId)!.add(id);
  bump();
}

export function getGhostCandidate(activeContext: "work" | "home"): Thing | null {
  const other = activeContext === "work" ? "home" : "work";
  const actorId = currentDemoActorId();
  const dismissed = ghostDismissedByActor.get(actorId) ?? new Set<string>();
  const lists = getListsRaw();
  return (
    getMergedThings(actorId).find(
      (t) =>
        t.context === other &&
        t.ownerImportance === "now" &&
        t.workStatus !== "sorted" &&
        t.workStatus !== "cancelled" &&
        !dismissed.has(t.id) &&
        canDemoActorViewThing(t, actorId, lists),
    ) ?? null
  );
}

/** Test-only: wipe demo local mutations between multipersona scenarios. */
export function resetDemoLocalStateForTests() {
  extras = [];
  patches.clear();
  shreddedByActor.clear();
  shreddedLogByActor.clear();
  comments.clear();
  activity.clear();
  listMessages.clear();
  extraLists = [];
  extraBuckets = [];
  bucketItems.clear();
  bucketNameById.clear();
  deletedBucketIdsByActor.clear();
  recentlyNudged.clear();
  nudgeCooldownUntil.clear();
  extraNotifications = [];
  ghostDismissedByActor.clear();
  notificationReadByActor.clear();
  version += 1;
  emit();
}
