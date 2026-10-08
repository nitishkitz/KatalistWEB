import { createFileRoute } from "@tanstack/react-router";

// E1. `{ enabled }` for everyone; a member of an enabled List also learns `configured`.
export const Route = createFileRoute("/api/code-activity/capabilities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const service = await import("@/features/code-activity/server/service.server");
        const { loadConfig } = await import("@/features/code-activity/server/config.server");
        const { loadAiConfig } = await import("@/features/code-activity/server/ai.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const listId = new URL(request.url).searchParams.get("listId") ?? "";
        return http.toResponse(await service.capabilities({ user: authed.user, listId, config: loadConfig(), aiConfigured: loadAiConfig() !== null }));
      },
    },
  },
});
