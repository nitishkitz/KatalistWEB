const KEY = "katalist.magic-box.person-history";
const MAX = 50;

type HistoryRow = { actorId: string; lastUsed: number; count: number };

function readRows(): HistoryRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is HistoryRow =>
        !!row && typeof row === "object" && typeof (row as HistoryRow).actorId === "string",
    );
  } catch {
    return [];
  }
}

function writeRows(rows: HistoryRow[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    // ignore quota
  }
}

export function recordPersonToss(actorId: string) {
  if (!actorId) return;
  const now = Date.now();
  const rows = readRows();
  const existing = rows.find((r) => r.actorId === actorId);
  if (existing) {
    existing.lastUsed = now;
    existing.count += 1;
  } else {
    rows.unshift({ actorId, lastUsed: now, count: 1 });
  }
  rows.sort((a, b) => b.lastUsed - a.lastUsed);
  writeRows(rows);
}

export function readPersonHistory(): {
  recentActorIds: string[];
  frequencyByActorId: Record<string, number>;
} {
  const rows = readRows();
  const recentActorIds = [...rows].sort((a, b) => b.lastUsed - a.lastUsed).map((r) => r.actorId);
  const frequencyByActorId: Record<string, number> = {};
  for (const row of rows) frequencyByActorId[row.actorId] = row.count;
  return { recentActorIds, frequencyByActorId };
}
