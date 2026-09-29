import type { Thing } from "@/domain/thing";
import type { NotificationItem } from "@/features/notifications/notification-model";

export type CapsuleAction = "open" | "catch" | "move" | "sort" | "nudge";
export type ActionReceipt = {
  thingId: string;
  action: CapsuleAction;
  at: number;
  title?: string;
  person?: string;
};
export type DailyReceipt = { day: string; actions: ActionReceipt[] };
export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDailyReceipt(value: string | null, day: string): DailyReceipt {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (parsed?.day !== day || !Array.isArray(parsed.actions)) return { day, actions: [] };
    return {
      day,
      actions: parsed.actions.filter(
        (item: ActionReceipt) =>
          item &&
          typeof item.thingId === "string" &&
          ["open", "catch", "move", "sort", "nudge"].includes(item.action) &&
          Number.isFinite(item.at),
      ),
    };
  } catch {
    return { day, actions: [] };
  }
}
export function scopeNotifications(items: NotificationItem[], things: Thing[]) {
  const ids = new Set(things.map((thing) => thing.id));
  return items.filter((item) => item.thingId && ids.has(item.thingId));
}
export function latestNotification(items: NotificationItem[], thingId: string) {
  return items
    .filter((item) => !item.read && item.thingId === thingId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}
export function handledToday(
  receipts: DailyReceipt,
  thingId: string,
  day: string,
  event?: NotificationItem,
) {
  if (receipts.day !== day) return false;
  const last = receipts.actions
    .filter((item) => item.thingId === thingId && item.action !== "open")
    .reduce((at, item) => Math.max(at, item.at), 0);
  if (!last) return false;
  return !event || Date.parse(event.createdAt) <= last;
}
export function scopeCounts(things: Thing[]) {
  const active = things.filter(
    (thing) => !thing.cancelledAt && !["sorted", "cancelled"].includes(thing.workStatus),
  );
  return {
    pending: active.filter(
      (thing) =>
        thing.workStatus === "not_started" && thing.acknowledgement !== "waiting_for_catch",
    ).length,
    waiting: active.filter((thing) => thing.acknowledgement === "waiting_for_catch").length,
    moving: active.filter(
      (thing) =>
        thing.workStatus === "under_progress" && thing.acknowledgement !== "waiting_for_catch",
    ).length,
    sorted: things.filter((thing) => !thing.cancelledAt && thing.workStatus === "sorted").length,
  };
}
export function receiptMessage(receipt: ActionReceipt) {
  switch (receipt.action) {
    case "nudge":
      return `You nudged ${receipt.person || "the assignee"}`;
    case "catch":
      return `You picked up “${receipt.title || "this Thing"}”`;
    case "move":
      return `You moved “${receipt.title || "this Thing"}” to Now`;
    case "sort":
      return `You sorted “${receipt.title || "this Thing"}”`;
    case "open":
      return `You opened “${receipt.title || "this Thing"}”`;
  }
}
