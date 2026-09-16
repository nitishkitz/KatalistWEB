import { createFileRoute } from "@tanstack/react-router";

// Scheduled entrypoint for the daily maintenance pass (morning brief + weekly
// spring-cleaning prompt), Phase 4 in-app. Called by an external scheduler with
// a shared secret; runs the definer RPC as service_role. Not user-facing.
export const Route = createFileRoute("/api/jobs/daily-maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        const provided = request.headers.get("x-cron-secret");
        if (!secret || provided !== secret) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("run_daily_maintenance");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ emitted: data ?? 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
