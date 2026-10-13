import { supabase } from "@/integrations/supabase/client";
import { defaultCalendar, safeTimezone, type HolderCalendar } from "@/domain/coey/calendar";
import type { Anchor, CoeyThingView, ThingSchedule } from "@/domain/coey/model";
import { calendarFromRow } from "./use-coey-context";

export type { CoeyThingView };

type Row = {
  thing_id: string; text_raw: string; kind: ThingSchedule["kind"]; mode: ThingSchedule["mode"]; sender_profile_id: string;
  holder_profile_id: string | null; tracked_profile_id: string | null; state: ThingSchedule["state"]; inbox_reason: ThingSchedule["inboxReason"];
  private_wait: boolean; group_id: string | null; chain: string[]; pace: ThingSchedule["pace"]; pace_resolution: ThingSchedule["paceResolution"];
  action_time: (Omit<Anchor, "at"> & { at: string }) | null; event_time: (Omit<Anchor, "at"> & { at: string }) | null;
  activity_type: ThingSchedule["activityType"]; recurrence: ThingSchedule["recurrence"]; promise_at: string | null; snooze_until: string | null;
  blocked_on: ThingSchedule["blockedOn"]; last_activity_at: string; last_nudge_at: string | null; nudge_count_cycle: number;
  breakthrough_used: boolean; created_at: string; revision?: number;
};

const ms = (v: string | null) => (v ? new Date(v).getTime() : null);
const anchor = (a: Row["action_time"]): Anchor | null => (a ? { ...a, at: new Date(a.at).getTime() } : null);

export function scheduleFromRow(r: Row): ThingSchedule {
  return {
    thingId: r.thing_id, textRaw: r.text_raw, mode: r.mode, kind: r.kind, senderProfileId: r.sender_profile_id,
    holderProfileId: r.holder_profile_id, state: r.state, inboxReason: r.inbox_reason, privateWait: r.private_wait,
    groupId: r.group_id, chain: r.chain ?? [], pace: r.pace, paceResolution: r.pace_resolution,
    actionTime: anchor(r.action_time), eventTime: anchor(r.event_time), activityType: r.activity_type, recurrence: r.recurrence,
    promiseAt: ms(r.promise_at), snoozeUntil: ms(r.snooze_until), blockedOn: r.blocked_on,
    lastActivityAt: ms(r.last_activity_at) ?? Date.now(), lastNudgeAt: ms(r.last_nudge_at), nudgeCountCycle: r.nudge_count_cycle,
    breakthroughUsed: r.breakthrough_used, createdAt: ms(r.created_at) ?? Date.now(), revision: r.revision,
  };
}

/**
 * Schedules for the given Things, readable under the same visibility as the
 * Things themselves. Any failure yields an empty map: the Thing then keeps
 * its legacy presentation instead of disappearing.
 */
export async function fetchCoeySchedules(thingIds: string[]): Promise<Map<string, CoeyThingView>> {
  const out = new Map<string, CoeyThingView>();
  if (!thingIds.length) return out;
  try {
    const { data: session } = await supabase.auth.getSession();
    const viewerProfileId = session.session?.user?.id;
    if (!viewerProfileId) return out;
    const rows: Row[] = [];
    for (let i = 0; i < thingIds.length; i += 150) {
      const { data, error } = await supabase.from("thing_schedules" as never).select("*").in("thing_id", thingIds.slice(i, i + 150));
      if (error) return out;
      rows.push(...((data ?? []) as Row[]));
    }
    const holderIds = [...new Set(rows.map((r) => r.holder_profile_id).filter((id): id is string => Boolean(id)))];
    const cals = new Map<string, HolderCalendar>();
    if (holderIds.length) {
      const { data } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>)(
        "get_calendars", { p_profile_ids: holderIds },
      );
      for (const row of (data ?? []) as Parameters<typeof calendarFromRow>[0][]) cals.set(row.profile_id, calendarFromRow(row));
    }
    const fallbackTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
    const fallback = cals.get(viewerProfileId) ?? defaultCalendar(safeTimezone(fallbackTz));
    for (const r of rows) {
      const schedule = scheduleFromRow(r);
      out.set(r.thing_id, { schedule, holderCal: (schedule.holderProfileId && cals.get(schedule.holderProfileId)) || fallback, viewerProfileId });
    }
  } catch {
    return new Map();
  }
  return out;
}
