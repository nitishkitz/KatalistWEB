const KEY = "katalist.magic-box.person-history";
const MAX_EVENTS = 100;

type LegacyRow = { actorId: string; lastUsed?: number; count?: number };
type HistoryEvent = { actorId: string; context: "work" | "home"; at: number };

function isEvent(row: unknown): row is HistoryEvent {
  if (!row || typeof row !== "object") return false;
  const item = row as HistoryEvent;
  return typeof item.actorId === "string" && (item.context === "work" || item.context === "home") && typeof item.at === "number";
}

function readEvents(): HistoryEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { events?: unknown }).events)) {
      return ((parsed as { events: unknown[] }).events).filter(isEvent).slice(0, MAX_EVENTS);
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      if (isEvent(row)) return [row];
      const legacy = row as LegacyRow;
      if (typeof legacy?.actorId !== "string") return [];
      const at = typeof legacy.lastUsed === "number" ? legacy.lastUsed : 0;
      const count = Math.max(1, Number(legacy.count) || 1);
      return Array.from({ length: Math.min(count, 8) }, () => ({ actorId: legacy.actorId, context: "work" as const, at }));
    });
  } catch {
    return [];
  }
}

function writeEvents(events: HistoryEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, events: events.slice(0, MAX_EVENTS) }));
  } catch {
    // ignore quota
  }
}

export function recordPersonToss(actorId: string, context: "work" | "home" = "work") {
  if (!actorId) return;
  const events = readEvents();
  events.unshift({ actorId, context, at: Date.now() });
  writeEvents(events);
}

export function readPersonHistory(context: "work" | "home" = "work"): {
  recentActorIds: string[];
  frequencyByActorId: Record<string, number>;
  sameContextActorIds: Set<string>;
} {
  const events = readEvents();
  const recentActorIds: string[] = [];
  const frequencyByActorId: Record<string, number> = {};
  const sameContextActorIds = new Set<string>();
  for (const event of [...events].sort((a, b) => b.at - a.at)) {
    if (!recentActorIds.includes(event.actorId)) recentActorIds.push(event.actorId);
    frequencyByActorId[event.actorId] = (frequencyByActorId[event.actorId] ?? 0) + 1;
    if (event.context === context) sameContextActorIds.add(event.actorId);
  }
  return { recentActorIds, frequencyByActorId, sameContextActorIds };
}
