import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Scheduled entrypoint for the Coey staleness escalation engine. Triggered by
// Vercel Cron (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
// Also accepts an `x-cron-secret` header for manual/external schedulers. Runs the
// definer RPC as service_role, then delivers the in-app Coey notifications it
// produced as browser pushes (idempotent via notifications.pushed_at).
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization");
  const viaBearer = Boolean(secret) && bearer === `Bearer ${secret}`;
  const viaHeader = Boolean(secret) && request.headers.get("x-cron-secret") === secret;
  if (!secret || (!viaBearer && !viaHeader)) {
    return json({ error: "unauthorized" }, 401);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("run_nudge_escalation");
  if (error) return json({ error: error.message }, 500);

  // Deliver the in-app Coey notifications this (and any prior un-pushed) run
  // produced as browser pushes, so auto-nudges reach people with the app closed.
  // Idempotent: each notification is pushed once, then stamped pushed_at.
  let pushed = 0;
  try {
    const COEY_KINDS = ["auto_nudge", "auto_nudge_stale", "morning_brief", "spring_clean"];
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending } = await supabaseAdmin
      .from("notifications")
      .select("id, profile_id, title, body, thing_id, kind")
      .is("pushed_at", null)
      .in("kind", COEY_KINDS)
      .gt("created_at", since)
      .limit(500);

    if (pending && pending.length) {
      const profileIds = [...new Set(pending.map((n) => n.profile_id).filter(Boolean))] as string[];
      const { data: toks } = await supabaseAdmin
        .from("device_tokens")
        .select("profile_id, token")
        .in("profile_id", profileIds);
      const tokensByProfile = new Map<string, string[]>();
      for (const t of toks ?? []) {
        const arr = tokensByProfile.get(t.profile_id) ?? [];
        if (t.token) arr.push(t.token);
        tokensByProfile.set(t.profile_id, arr);
      }

      const { sendPush } = await import("@/lib/fcm.server");
      for (const n of pending) {
        const tokens = tokensByProfile.get(n.profile_id) ?? [];
        if (tokens.length) {
          // Owner "gone cold" alerts belong in Nudges; assignee taps in Court.
          const url = n.kind === "auto_nudge_stale" ? "/nudges" : "/court";
          pushed += await sendPush(
            tokens,
            { title: n.title, body: n.body ?? "" },
            { url, kind: n.kind, thingId: n.thing_id ?? "" },
          );
        }
      }

      const ids = pending.map((n) => n.id);
      await supabaseAdmin
        .from("notifications")
        .update({ pushed_at: new Date().toISOString() })
        .in("id", ids);
    }
  } catch {
    // Push is best-effort; escalation already succeeded.
  }

  return json({ emitted: data ?? 0, pushed });
}

export const Route = createFileRoute("/api/jobs/escalate-nudges")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
