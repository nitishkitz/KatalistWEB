import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { defaultCalendar, safeTimezone, type HolderCalendar } from "@/domain/coey/calendar";
import type { Candidate, Viewer } from "@/domain/coey/draft";

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as unknown as LooseRpc)(fn, args);

type CalendarRow = {
  profile_id: string; timezone: string; work_days: number[]; work_start: number; work_end: number; off_saturdays: number[];
  holidays: string[]; festivals: string[]; leave: Array<{ start: string; end: string }>; home_start: number; home_end: number;
};

export function calendarFromRow(row: CalendarRow): HolderCalendar {
  return {
    ...defaultCalendar(safeTimezone(row.timezone)),
    workDays: row.work_days.map(Number),
    workStart: row.work_start,
    workEnd: row.work_end,
    offSaturdays: row.off_saturdays.map(Number),
    holidays: row.holidays,
    festivals: row.festivals,
    leave: Array.isArray(row.leave) ? row.leave : [],
    homeStart: row.home_start,
    homeEnd: row.home_end,
  };
}

export const coeyKeys = {
  people: (userId: string | undefined) => ["coey", "people", userId] as const,
  calendars: (userId: string | undefined) => ["coey", "calendars", userId] as const,
  dismissals: (userId: string | undefined) => ["coey", "dismissals", userId] as const,
};

/**
 * Everything the plan builder needs besides the text: who the user may send
 * to (accepted connections), whom they may at least see, their calendars and
 * their muted checks. Nothing here is sent to the model.
 */
export function useCoeyContext() {
  const { session, user } = useSession();
  const live = Boolean(user) && !isPreviewSession(session);

  const people = useQuery({
    queryKey: coeyKeys.people(user?.id),
    enabled: live,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await rpc("list_visible_identities");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ profile_id: string; actor_id: string | null; display_name: string; avatar_url: string | null; connected: boolean }>;
      const me = rows.find((r) => r.profile_id === user!.id);
      const viewer: Viewer = { profileId: user!.id, actorId: me?.actor_id ?? user!.id, name: me?.display_name ?? "" };
      const candidates: Candidate[] = rows
        .filter((r) => r.profile_id !== user!.id && r.actor_id)
        .map((r) => ({ profileId: r.profile_id, actorId: r.actor_id!, name: r.display_name, avatarUrl: r.avatar_url, connected: r.connected }));
      return { viewer, candidates };
    },
  });

  const connectedIds = (people.data?.candidates ?? []).filter((c) => c.connected).map((c) => c.profileId);
  const calendars = useQuery({
    queryKey: [...coeyKeys.calendars(user?.id), connectedIds.join(",")],
    enabled: live && people.isSuccess,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("get_calendars", { p_profile_ids: [user!.id, ...connectedIds] });
      if (error) throw new Error(error.message);
      const map: Record<string, HolderCalendar> = {};
      for (const row of (data ?? []) as CalendarRow[]) map[row.profile_id] = calendarFromRow(row);
      return map;
    },
  });

  const dismissals = useQuery({
    queryKey: coeyKeys.dismissals(user?.id),
    enabled: live,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("coey_check_dismissals" as never).select("check_id, count");
      if (error) return {} as Record<string, number>;
      return Object.fromEntries(((data ?? []) as Array<{ check_id: string; count: number }>).map((d) => [d.check_id, d.count]));
    },
  });

  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const ownCal = (user && calendars.data?.[user.id]) || defaultCalendar(safeTimezone(browserTz));
  return {
    ready: people.isSuccess,
    error: people.error ? "Couldn’t load your connections." : null,
    viewer: people.data?.viewer ?? null,
    candidates: people.data?.candidates ?? [],
    calendar: ownCal,
    holderCals: calendars.data ?? {},
    dismissedCounts: dismissals.data ?? {},
  };
}

export async function recordDismissal(checkId: string) {
  const base = checkId.split(":")[0]!;
  if (!/^[A-Z][A-Za-z0-9.]{0,15}$/.test(base)) return;
  await rpc("record_check_dismissal", { p_check_id: base });
}
