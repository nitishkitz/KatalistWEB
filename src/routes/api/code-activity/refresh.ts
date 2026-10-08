import { createFileRoute } from "@tanstack/react-router";

// E18. Manual Refresh: owners and collaborators only (enforced in the database), one at a time, rate limited.
export const Route = createFileRoute("/api/code-activity/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const activity = await import("@/features/code-activity/server/activity.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const body = await http.readJson(request);
        return http.toResponse(await activity.refresh(await http.buildDeps(), { user: authed.user, listId: String(body.listId ?? "") }));
      },
    },
  },
});
