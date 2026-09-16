import { useQuery, type QueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";

/** Snooze interval presets offered on swipe-left (June BRD v1.1). */
export type SnoozeOption = "1h" | "6h" | "next_day";

export type PersonalSnooze = {
  /** thingId -> snoozed_until ISO string (future only). */
  until: Map<string, string>;
};

export const EMPTY_PERSONAL_SNOOZE: PersonalSnooze = { until: new Map() };

/** Compute the wake time for a chosen preset. "Next day" means 9 AM local. */
export function snoozeUntilFor(option: SnoozeOption, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  if (option === "1h") {
    d.setHours(d.getHours() + 1);
  } else if (option === "6h") {
    d.setHours(d.getHours() + 6);
  } else {
    // Next day at 9:00 AM local (the BRD's "queue for tomorrow morning" convention).
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

export const SNOOZE_OPTIONS: { id: SnoozeOption; label: string }[] = [
  { id: "1h", label: "1 hour" },
  { id: "6h", label: "6 hours" },
  { id: "next_day", label: "Next day" },
];

export function personalSnoozeFromRows(
  rows: { thing_id: string; snoozed_until: string }[],
  nowMs: number = Date.now(),
): PersonalSnooze {
  const until = new Map<string, string>();
  for (const row of rows) {
    if (row.snoozed_until && new Date(row.snoozed_until).getTime() > nowMs) {
      until.set(row.thing_id, row.snoozed_until);
    }
  }
  return { until };
}

/** Hide Things that are currently snoozed for this person. */
export function excludeSnoozedThings<T extends { id: string }>(
  things: T[],
  snooze: PersonalSnooze,
): T[] {
  if (!snooze.until.size) return things;
  return things.filter((t) => !snooze.until.has(t.id));
}

export async function fetchPersonalSnooze(): Promise<PersonalSnooze> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("thing_snooze")
    .select("thing_id, snoozed_until")
    .gt("snoozed_until", nowIso);
  if (error) throw error;
  return personalSnoozeFromRows(data ?? []);
}

/** Live personal Snooze lens. Demo/preview uses local-state instead. */
export function usePersonalSnooze(): PersonalSnooze {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: keys.snoozed(user?.id),
    enabled: Boolean(user) && !preview,
    queryFn: fetchPersonalSnooze,
    staleTime: 10_000,
  });
  return query.data ?? EMPTY_PERSONAL_SNOOZE;
}

/** Refresh every surface that a snooze can hide a Thing from. */
export async function invalidateSnoozeSurfaces(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["snoozed"] }),
    qc.invalidateQueries({ queryKey: ["court"] }),
    qc.invalidateQueries({ queryKey: ["accessible-things"] }),
  ]);
}
