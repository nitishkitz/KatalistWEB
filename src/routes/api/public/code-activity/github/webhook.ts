import { createFileRoute } from "@tanstack/react-router";

// E14. Public by necessity (GitHub calls it); protected by the HMAC signature over the raw body. It stores compact
// identifiers and answers. All processing happens later from the queue (/api/jobs/code-activity-drain).
export const Route = createFileRoute("/api/public/code-activity/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const hook = await import("@/features/code-activity/server/webhook.server");
        const { loadWebhookSecret } = await import("@/features/code-activity/server/config.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await hook.handleWebhook(
          { secret: loadWebhookSecret(), admin: () => supabaseAdmin as unknown as import("@/features/code-activity/server/service.server").RpcClient },
          request,
        );
        return http.toResponse(result);
      },
    },
  },
});
