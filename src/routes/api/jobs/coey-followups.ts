import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backgroundJobsEnabled, resetUnavailable } from "@/lib/reset-controls.server";
import { localParts, defaultCalendar, safeTimezone, type HolderCalendar } from "@/domain/coey/calendar";
import { batchByHolder, planFollowUps } from "@/domain/coey/followup";
import { COEY_CONFIG } from "@/domain/coey/config";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/**
 * Coey follow-up tick (spec §9). Plans in each holder's working time, then
 * delivers each holder's batch through coey_apply_followups, which re-checks
 * eligibility atomically. Needs a scheduler that runs every few minutes; a
 * daily Vercel Hobby cron cannot provide the 4-working-hour Urgent cadence.
 * Off unless KATALIST_BACKGROUND_JOBS_ENABLED=true and CRON_SECRET matches.
 */
async function run(request: Request): Promise<Response> {
  if (!backgroundJobsEnabled()) return resetUnavailable("background_jobs_disabled");
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization");
  if (!secret || (bearer !== `Bearer ${secret}` && request.headers.get("x-cron-secret") !== secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Tables added by the Coey migrations are not in the generated types yet.
  const admin = supabaseAdmin as unknown as SupabaseClient;

  const { data: rows, error } = await admin.from("thing_schedules")
    .select("*")
    .in("state", ["open", "caught", "promised"])
    .eq("private_wait", false)
    .is("inbox_reason", null)
    .limit(5000);
  if (error) return json({ error: error.message }, 500);
  const { scheduleFromRow } = await import("@/features/court/coey/schedules");
  const schedules = ((rows ?? []) as Parameters<typeof scheduleFromRow>[0][]).map(scheduleFromRow)
    .filter((s) => s.holderProfileId && s.holderProfileId !== s.senderProfileId);
  const holderIds = [...new Set(schedules.map((s) => s.holderProfileId!))];

  const cals = new Map<string, HolderCalendar>();
  if (holderIds.length) {
    const [{ data: profiles }, { data: calRows }] = await Promise.all([
      admin.from("profiles").select("id, timezone").in("id", holderIds),
      admin.from("profile_calendars").select("*").in("profile_id", holderIds),
    ]);
    type CalRow = { profile_id: string; work_days: number[]; work_start: number; work_end: number; off_saturdays: number[];
      holidays: string[]; festivals: string[]; leave: Array<{ start: string; end: string }>; home_start: number; home_end: number };
    const byId = new Map(((calRows ?? []) as CalRow[]).map((c) => [c.profile_id, c]));
    for (const p of (profiles ?? []) as Array<{ id: string; timezone: string | null }>) {
      const c = byId.get(p.id);
      const base = defaultCalendar(safeTimezone(p.timezone));
      cals.set(p.id, c ? {
        ...base, workDays: c.work_days, workStart: c.work_start, workEnd: c.work_end, offSaturdays: c.off_saturdays,
        holidays: c.holidays, festivals: c.festivals, leave: c.leave, homeStart: c.home_start, homeEnd: c.home_end,
      } : base);
    }
  }

  const now = Date.now();
  const plan = planFollowUps(schedules.map((s) => ({ schedule: s, holderCal: cals.get(s.holderProfileId!) ?? defaultCalendar() })), now);
  let delivered = 0;
  let deferredByBudget = 0;
  const notificationIds: string[] = [];
  for (const [holder, items] of batchByHolder(plan.due)) {
    const cal = cals.get(holder) ?? defaultCalendar();
    const { data, error: applyError } = await admin.rpc("coey_apply_followups", {
      p_holder: holder,
      p_local_date: localParts(now, cal.timezone).date,
      p_items: items.map((i) => ({ thing_id: i.thingId, step: i.step, kind: i.kind, revision: i.revision })),
      p_budget: COEY_CONFIG.F5_DAILY_NUDGE_BUDGET,
    });
    if (applyError) continue;
    const result = data as { delivered?: number; deferred?: boolean; notification_id?: string | null };
    delivered += result.delivered ?? 0;
    if (result.deferred) deferredByBudget += items.length;
    if (result.notification_id) notificationIds.push(result.notification_id);
  }

  // Push for steps ≥ 2 only (step 1 never created a notification row).
  let pushed = 0;
  if (notificationIds.length) {
    try {
      const { data: pending } = await admin.from("notifications").select("id, profile_id, title, body, thing_id").in("id", notificationIds);
      const list = (pending ?? []) as Array<{ id: string; profile_id: string; title: string; body: string | null; thing_id: string | null }>;
      const { data: tokens } = await admin.from("device_tokens").select("profile_id, token").in("profile_id", [...new Set(list.map((n) => n.profile_id))]);
      const byProfile = new Map<string, string[]>();
      for (const t of (tokens ?? []) as Array<{ profile_id: string; token: string }>) byProfile.set(t.profile_id, [...(byProfile.get(t.profile_id) ?? []), t.token]);
      const { sendPush } = await import("@/lib/fcm.server");
      for (const n of list) {
        pushed += await sendPush(byProfile.get(n.profile_id) ?? [], { title: n.title, body: n.body ?? "" }, { url: "/", kind: "coey_nudge", thingId: n.thing_id ?? "" });
      }
      await admin.from("notifications").update({ pushed_at: new Date().toISOString() }).in("id", notificationIds);
    } catch {
      // Push is best-effort; the in-app record already exists.
    }
  }
  return json({ planned: plan.due.length, delivered, deferredByBudget, deferredByWindow: plan.deferredUntil.length, pushed });
}

export const Route = createFileRoute("/api/jobs/coey-followups")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
