import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Scheduled entrypoint for the daily maintenance pass (morning brief + weekly
// spring-cleaning prompt). Registered in vercel.json, which sends
// `Authorization: Bearer $CRON_SECRET` via GET — also accepts an
// `x-cron-secret` header + POST for manual/external calls, same convention as
// escalate-nudges.ts. Runs the definer RPC as service_role; not user-facing.
// Push delivery for the notifications this inserts is NOT done here — it
// piggybacks on escalate-nudges.ts's existing sweep of un-pushed
// morning_brief/spring_clean notifications from the last 24h, so this route
// should run shortly before it in vercel.json.
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization");
  const viaBearer = Boolean(secret) && bearer === `Bearer ${secret}`;
  const viaHeader = Boolean(secret) && request.headers.get("x-cron-secret") === secret;
  if (!secret || (!viaBearer && !viaHeader)) {
    return json({ error: "unauthorized" }, 401);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("run_daily_maintenance");
  if (error) return json({ error: error.message }, 500);
  return json({ emitted: data ?? 0 });
}

export const Route = createFileRoute("/api/jobs/daily-maintenance")({
  server: {
    handlers: {
      GET: async ({ request }) => run(request),
      POST: async ({ request }) => run(request),
    },
  },
});
