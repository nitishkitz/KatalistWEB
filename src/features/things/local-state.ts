import { useSyncExternalStore } from "react";
import type { Importance, Pace, Person, Thing, WorkStatus } from "@/domain/thing";
import { courtFixtures } from "@/features/court/fixtures";
import { getThingCapabilities } from "@/domain/capabilities";
import { currentDemoActorId, currentDemoPerson, demoDirectory } from "@/features/demo/identities";
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
const shredded = new Set<string>();
let shreddedLog: ShreddedItem[] = [];
const comments = new Map<string, LocalComment[]>();
const activity = new Map<string, LocalActivity[]>();
const listMessages = new Map<string, LocalMessage[]>();
let extraLists: ListRow[] = [];
let extraBuckets: BucketCard[] = [];
const bucketItems = new Map<string, BucketItem[]>();
const recentlyNudged = new Set<string>();
const nudgeCooldownUntil = new Map<string, number>();
let extraNotifications: LocalNotification[] = [];
let ghostDismissed: string | null = null;
let version = 0;

function snapshot() {
  return version;
}

export function useLocalVersion() {
  return useSyncExternalStore(subscribeLocal, snapshot, snapshot);
}

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

export function getMergedThings(): Thing[] {
  const byId = new Map<string, Thing>();
  for (const t of courtFixtures) byId.set(t.id, t);
  for (const t of extras) byId.set(t.id, t);
  for (const [id, patch] of patches) {
    const current = byId.get(id);
    if (current) byId.set(id, { ...current, ...patch });
  }
  return [...byId.values()].filter((t) => !shredded.has(t.id));
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

export function getThing(id: string): Thing | undefined {
  return getMergedThings().find((t) => t.id === id);
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
  const assignee = people.find((p) => p.id === (input.assigneeId ?? me.id)) ?? me;
  const thing: Thing = {
    id: `local-${crypto.randomUUID()}`,
    title: input.title,
    creator: me,
    owner: me,
    assignee,
    acknowledgement: assignee.id === me.id ? "caught" : "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: input.ownerImportance ?? "next",
    personalPace: assignee.id === me.id ? "next" : null,
    dueAt: input.dueAt ?? null,
    dueHasTime: Boolean(input.dueHasTime),
    context: input.context,
    listId: input.listId ?? null,
    listName: input.listName ?? "Standalone",
    cancelledAt: null,
    sortedAt: null,
    caughtAt: assignee.id === me.id ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  extras = [thing, ...extras];
  bump({ id: crypto.randomUUID(), event: "created", at: thing.updatedAt, thingId: thing.id });
  return thing;
}

export function setDueLocal(id: string, dueAt: string | null, dueHasTime: boolean) {
  patchThing(id, { dueAt, dueHasTime }, "due_changed");
}
export function reassignLocal(id: string, assigneeId: string) {
  requireCap(id, "canReassign");
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
}

export function nudgeLocal(id: string) {
  requireCap(id, "canNudge");
  const until = nudgeCooldownUntil.get(id) ?? 0;
  if (Date.now() < until) throw new Error("Give it a moment — this one was just nudged.");
  const thing = getThing(id);
  if (!thing || thing.workStatus === "sorted" || thing.workStatus === "cancelled") {
    throw new Error("Sorted and Cancelled things can’t be nudged.");
  }
  recentlyNudged.add(id);
  nudgeCooldownUntil.set(id, Date.now() + 15 * 60 * 1000);
  bump({ id: crypto.randomUUID(), event: "nudged", at: new Date().toISOString(), thingId: id });
}

export function canNudge(id: string) {
  const thing = getThing(id);
  if (!thing) return false;
  if (thing.workStatus === "sorted" || thing.workStatus === "cancelled") return false;
  return Date.now() >= (nudgeCooldownUntil.get(id) ?? 0);
}

export function isRecentlyNudged(id: string) {
  return recentlyNudged.has(id);
}

export function shredLocal(id: string) {
  const thing = getThing(id);
  if (!thing) return;
  shredded.add(id);
  shreddedLog = [
    { id, title: thing.title, kind: "thing", status: thing.workStatus, at: new Date().toISOString() },
    ...shreddedLog,
  ];
  bump({ id: crypto.randomUUID(), event: "shredded", at: new Date().toISOString(), thingId: id });
}

export function restoreLocal(id: string) {
  shredded.delete(id);
  shreddedLog = shreddedLog.filter((s) => s.id !== id);
  bump({ id: crypto.randomUUID(), event: "restored", at: new Date().toISOString(), thingId: id });
}

export function getShredded(): ShreddedItem[] {
  return shreddedLog;
}

export function addCommentLocal(thingId: string, body: string, author?: string) {
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
  return comments.get(thingId) ?? [];
}

export function getActivity(thingId: string): LocalActivity[] {
  return activity.get(thingId) ?? [];
}

export function getLists(): ListRow[] {
  return [...extraLists, ...listFixtures];
}

export function createListLocal(name: string, context: "work" | "home"): ListRow {
  const row: ListRow = {
    id: `list-${crypto.randomUUID()}`,
    name,
    context,
    role: "owner",
    ownerLine: "Owned by you",
    members: [{ initials: "ME", name: "Me" }],
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
  const row: LocalMessage = { id: crypto.randomUUID(), body, author, at: new Date().toISOString() };
  listMessages.set(listId, [...(listMessages.get(listId) ?? []), row]);
  bump();
}

export function getListMessages(listId: string): LocalMessage[] {
  return listMessages.get(listId) ?? [];
}

export function getBuckets(): BucketCard[] {
  const me = currentDemoActorId();
  return [...extraBuckets, ...bucketFixtures].filter((b) => !b.ownerActorId || b.ownerActorId === me);
}

export function createBucketLocal(name: string, description = ""): BucketCard {
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
    previews: [],
  };
  extraBuckets = [row, ...extraBuckets];
  bump();
  return row;
}

export function addBucketRef(bucketId: string, item: BucketItem) {
  bucketItems.set(bucketId, [item, ...(bucketItems.get(bucketId) ?? [])]);
  bump();
}

export function removeBucketRef(bucketId: string, thingId?: string, listId?: string) {
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
  const extra = bucketItems.get(bucketId) ?? [];
  const fixture = bucketFixtures.find((b) => b.id === bucketId);
  const fromFixture =
    fixture?.previews.map((p) => ({
      title: p.title,
      kind: p.kind,
      thingId: p.thingId,
      listId: p.listId,
    })) ?? [];
  return [...extra, ...fromFixture];
}

const notificationRead = new Set<string>();

export function getNotifications(): LocalNotification[] {
  const derived: LocalNotification[] = getMergedThings()
    .filter((t) => t.acknowledgement === "waiting_for_catch" || (t.dueAt && new Date(t.dueAt).getTime() < Date.now() + 86400000))
    .slice(0, 8)
    .map((t) => ({
      id: `from-${t.id}`,
      title: t.acknowledgement === "waiting_for_catch" ? "Waiting for Catch" : "Due soon",
      body: t.title,
      read: notificationRead.has(`from-${t.id}`),
      at: t.updatedAt,
      thingId: t.id,
    }));
  return [
    ...extraNotifications.map((n) => ({ ...n, read: n.read || notificationRead.has(n.id) })),
    ...derived,
  ];
}

export function markNotificationsRead() {
  for (const n of getNotifications()) notificationRead.add(n.id);
  extraNotifications = extraNotifications.map((n) => ({ ...n, read: true }));
  bump();
}

export function markNotificationRead(id: string) {
  notificationRead.add(id);
  extraNotifications = extraNotifications.map((n) => (n.id === id ? { ...n, read: true } : n));
  bump();
}

export function dismissGhost(id: string) {
  ghostDismissed = id;
  bump();
}

export function getGhostCandidate(activeContext: "work" | "home"): Thing | null {
  const other = activeContext === "work" ? "home" : "work";
  return (
    getMergedThings().find(
      (t) =>
        t.context === other &&
        t.ownerImportance === "now" &&
        t.workStatus !== "sorted" &&
        t.workStatus !== "cancelled" &&
        t.id !== ghostDismissed,
    ) ?? null
  );
}
