import { createFileRoute } from "@tanstack/react-router";

// E15. Scheduled drain: processes queued webhook deliveries and reconciles due connections. Not registered with
// any scheduler by this code; an operator wires it up (see the runbook). Authenticated with the cron secret.
async function run(request: Request): Promise<Response> {
  const http = await import("@/features/code-activity/server/http.server");
  const drainer = await import("@/features/code-activity/server/drain.server");
  if (!drainer.authorizeDrain(request, process.env.CRON_SECRET)) {
    return http.toResponse({ status: 401, body: { error: "unauthorized" } });
  }
  const result = await drainer.drain(await http.buildDeps());
  return http.toResponse({ status: 200, body: { ...result } });
}

export const Route = createFileRoute("/api/jobs/code-activity-drain")({
  server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } },
});
