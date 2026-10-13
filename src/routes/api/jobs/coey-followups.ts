import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { backgroundJobsEnabled, outboundDeliveryEnabled, resetUnavailable } from "@/lib/reset-controls.server";
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
  // The Supabase scheduler sends COEY_SCHEDULER_SECRET; CRON_SECRET still works for manual runs.
  const presented = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const matches = (secret: string | undefined) =>
    Boolean(secret) && secret!.length === presented.length && timingSafeEqual(Buffer.from(secret!), Buffer.from(presented));
  if (!matches(process.env.COEY_SCHEDULER_SECRET) && !matches(process.env.CRON_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const startedAt = Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Tables added by the Coey migrations are not in the generated types yet.
  const admin = supabaseAdmin as unknown as SupabaseClient;

  // Page through every eligible schedule; nothing is silently cut off.
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("thing_schedules")
      .select("*")
      .in("state", ["open", "caught", "promised"])
      .eq("private_wait", false)
      .is("inbox_reason", null)
      .order("thing_id")
      .range(from, from + 999);
    if (error) return json({ error: "schedules unavailable" }, 500);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000 || rows.length >= 50_000) break;
  }
  const { scheduleFromRow } = await import("@/features/court/coey/schedules");
  const schedules = ((rows ?? []) as Parameters<typeof scheduleFromRow>[0][]).map(scheduleFromRow)
    .filter((s) => s.holderProfileId && s.holderProfileId !== s.senderProfileId);
  const holderIds = [...new Set(schedules.map((s) => s.holderProfileId!))];

  const cals = new Map<string, HolderCalendar>();
  // Delivery rejects a plan made against an older calendar (hours, days, holidays, leave, timezone).
  const calRevisions = new Map<string, number>();
  if (holderIds.length) {
    const [{ data: profiles }, { data: calRows }] = await Promise.all([
      admin.from("profiles").select("id, timezone").in("id", holderIds),
      admin.from("profile_calendars").select("*").in("profile_id", holderIds),
    ]);
    type CalRow = { profile_id: string; work_days: number[]; work_start: number; work_end: number; off_saturdays: number[];
      holidays: string[]; festivals: string[]; leave: Array<{ start: string; end: string }>; home_start: number; home_end: number ; revision?: number };
    const byId = new Map(((calRows ?? []) as CalRow[]).map((c) => [c.profile_id, c]));
    for (const c of byId.values()) calRevisions.set(c.profile_id, c.revision ?? 0);
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
  let carried = 0;
  for (const [holder, allItems] of batchByHolder(plan.due)) {
    // At most 50 per holder per tick, oldest due first; the rest are offered next tick.
    const items = [...allItems].sort((a, b) => a.dueAt - b.dueAt).slice(0, 50);
    carried += allItems.length - items.length;
    const cal = cals.get(holder) ?? defaultCalendar();
    const { data, error: applyError } = await admin.rpc("coey_apply_followups", {
      p_holder: holder,
      p_local_date: localParts(now, cal.timezone).date,
      p_items: items.map((i) => ({ thing_id: i.thingId, step: i.step, kind: i.kind, revision: i.revision, calendar_revision: calRevisions.get(holder) ?? 0 })),
      p_budget: COEY_CONFIG.F5_DAILY_NUDGE_BUDGET,
    });
    if (applyError) continue;
    const result = data as { delivered?: number; deferred?: boolean; notification_id?: string | null };
    delivered += result.delivered ?? 0;
    if (result.deferred) deferredByBudget += items.length;
    if (result.notification_id) notificationIds.push(result.notification_id);
  }

  // Push for steps ≥ 2 only (step 1 never creates a notification row). Pushes are
  // claimed atomically, marked sent only on success, and failures are retried.
  let pushed = 0;
  let pushFailed = 0;
  if (outboundDeliveryEnabled()) {
    const { data: claimed } = await admin.rpc("claim_coey_pushes", { p_limit: 200 });
    const list = (claimed ?? []) as Array<{ id: string; profile_id: string; title: string; body: string | null; thing_id: string | null }>;
    if (list.length) {
      const { data: tokens } = await admin.from("device_tokens").select("profile_id, token").in("profile_id", [...new Set(list.map((n) => n.profile_id))]);
      const byProfile = new Map<string, string[]>();
      for (const t of (tokens ?? []) as Array<{ profile_id: string; token: string }>) byProfile.set(t.profile_id, [...(byProfile.get(t.profile_id) ?? []), t.token]);
      const { sendPushDetailed } = await import("@/lib/fcm.server");
      for (const n of list) {
        let sent = false;
        let reason: string | undefined;
        try {
          const result = await sendPushDetailed(byProfile.get(n.profile_id) ?? [], { title: n.title, body: n.body ?? "" }, { url: "/", kind: "coey_nudge", thingId: n.thing_id ?? "" });
          sent = result.sent > 0;
          reason = sent ? undefined : result.reason ?? "not_sent";
        } catch {
          reason = "send_error";
        }
        if (sent) pushed++;
        else pushFailed++;
        await admin.rpc("finish_coey_push", { p_id: n.id, p_sent: sent, p_reason: reason ?? null });
      }
    }
  }
  // Counts only: no names, numbers, titles or tokens.
  console.info(JSON.stringify({ evt: "coey_followups_tick", schedules: schedules.length, planned: plan.due.length, delivered, deferredByBudget, carried, pushed, pushFailed, ms: Date.now() - startedAt }));
  return json({ planned: plan.due.length, delivered, deferredByBudget, deferredByWindow: plan.deferredUntil.length, carried, pushed, pushFailed });
}

export const Route = createFileRoute("/api/jobs/coey-followups")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
